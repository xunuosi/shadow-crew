/**
 * CognoNexus 神经符号确定性运筹决策求解器
 * 实现基于最优最劣法 (Best-Worst Method, BWM) 的准则权重优化与多属性效用排序
 * 参考文献：Rezaei, J. (2015). Best-worst multi-criteria decision-making method. Omega, 53, 49-57.
 */

import { McdaCriterion, McdaDecisionPayload } from '../../types';

// BWM 一致性指标参照表 (Consistency Index Table based on a_BW value 1..9)
const BWM_CONSISTENCY_INDEX_TABLE: Record<number, number> = {
  1: 0.00,
  2: 0.44,
  3: 1.00,
  4: 1.63,
  5: 2.30,
  6: 3.00,
  7: 3.73,
  8: 4.47,
  9: 5.23,
};

export interface SolveBwmInput {
  solverType?: 'BWM' | 'AHP';
  criteria: McdaCriterion[];
  alternatives: string[];
  scoreMatrix: Record<string, Record<string, number>>; // 方案 -> 准则ID -> 分数 (0~10)
  bestCriterionId: string;
  worstCriterionId: string;
  bestToOthers: number[];       // 维度顺序与 criteria 一致，最优准则相对于其他准则的偏好度 (1~9)
  othersToWorst: number[];      // 维度顺序与 criteria 一致，其他准则相对于最差准则的偏好度 (1~9)
}

/**
 * 求解 BWM 线性规划/极小化最大偏差模型
 * min ξ
 * s.t.
 *   |w_B - a_Bj * w_j| <= ξ
 *   |w_j - a_jW * w_W| <= ξ
 *   sum(w_j) = 1, w_j >= 0
 */
export function solveDeterministicBwm(input: SolveBwmInput): McdaDecisionPayload {
  const { criteria, alternatives, scoreMatrix, bestCriterionId, worstCriterionId, bestToOthers, othersToWorst } = input;
  const n = criteria.length;

  if (n === 0) {
    throw new Error('MCDA 求解器至少需要一个评价准则');
  }

  const bestIdx = criteria.findIndex((c) => c.id === bestCriterionId);
  const worstIdx = criteria.findIndex((c) => c.id === worstCriterionId);

  const safeBestIdx = bestIdx >= 0 ? bestIdx : 0;
  const safeWorstIdx = worstIdx >= 0 ? worstIdx : (n - 1);

  // 1. 构建初始解析近似权重向量 (Analytical Seed)
  const rawWeights: number[] = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
    const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));
    
    // 由最优准则推算: w_j ~ w_B / a_Bj
    // 由最差准则推算: w_j ~ a_jW * w_W
    const estimateFromBest = 1 / aBj;
    const estimateFromWorst = ajW;
    rawWeights[j] = Math.sqrt(estimateFromBest * estimateFromWorst);
  }

  // 归一化初始种子
  let sumRaw = rawWeights.reduce((acc, val) => acc + val, 0);
  if (sumRaw === 0) sumRaw = 1;
  let weights = rawWeights.map((w) => w / sumRaw);

  // 2. 坐标轮换投影迭代优化 (Projected Coordinate Optimization to minimize max deviation)
  const maxIter = 400;
  const stepSize = 0.015;

  for (let iter = 0; iter < maxIter; iter++) {
    // 计算当前每个准则的偏差
    const grad = new Array(n).fill(0);
    let maxDev = -1;
    let worstCritIndex = -1;

    for (let j = 0; j < n; j++) {
      const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
      const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));

      const dev1 = Math.abs(weights[safeBestIdx] - aBj * weights[j]);
      const dev2 = Math.abs(weights[j] - ajW * weights[safeWorstIdx]);

      if (dev1 > maxDev) {
        maxDev = dev1;
        worstCritIndex = j;
      }
      if (dev2 > maxDev) {
        maxDev = dev2;
        worstCritIndex = j;
      }

      // 累加子梯度方向
      if (weights[safeBestIdx] - aBj * weights[j] > 0) {
        grad[safeBestIdx] -= stepSize;
        grad[j] += stepSize * aBj;
      } else {
        grad[safeBestIdx] += stepSize;
        grad[j] -= stepSize * aBj;
      }

      if (weights[j] - ajW * weights[safeWorstIdx] > 0) {
        grad[j] -= stepSize;
        grad[safeWorstIdx] += stepSize * ajW;
      } else {
        grad[j] += stepSize;
        grad[safeWorstIdx] -= stepSize * ajW;
      }
    }

    // 沿负梯度步进并执行单纯形投影 (Project onto simplex: sum(w)=1, w>=0)
    for (let j = 0; j < n; j++) {
      weights[j] = Math.max(0.001, weights[j] + grad[j] * 0.05);
    }
    const currentSum = weights.reduce((acc, val) => acc + val, 0);
    weights = weights.map((w) => w / currentSum);
  }

  // 3. 计算最终一致性标度 ξ* (Consistency Index)
  let consistencyIndex = 0;
  for (let j = 0; j < n; j++) {
    const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
    const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));

    const dev1 = Math.abs(weights[safeBestIdx] - aBj * weights[j]);
    const dev2 = Math.abs(weights[j] - ajW * weights[safeWorstIdx]);
    consistencyIndex = Math.max(consistencyIndex, dev1, dev2);
  }

  // 计算一致性比率 CR = ξ* / CI(a_BW)
  const aBW = Math.max(1, Math.min(9, bestToOthers[safeWorstIdx] || 5));
  const tableCI = BWM_CONSISTENCY_INDEX_TABLE[aBW] || 2.30;
  const consistencyRatio = tableCI > 0 ? consistencyIndex / tableCI : 0;
  const consistencyPassed = consistencyRatio <= 0.20 || consistencyIndex <= 0.12;

  // 4. 将各准则权重映射为字典
  const computedWeights: Record<string, number> = {};
  criteria.forEach((c, idx) => {
    computedWeights[c.id] = Math.round(weights[idx] * 1000) / 1000;
  });

  // 5. 对各备选方案执行加权多属性效用综合评分
  const rankingList = alternatives.map((alt) => {
    let totalUtility = 0;
    criteria.forEach((c, idx) => {
      const rawScore = scoreMatrix[alt]?.[c.id] ?? 5; // 默认 5 分
      const boundedScore = Math.max(0, Math.min(10, rawScore));
      
      // 正向准则归一化 (越大约好: 0~10 -> 0~1.0)
      // 逆向准则归一化 (越小越好: 如成本/延迟: 0~10 -> 10-score -> 0~1.0)
      const normalizedScore = c.direction === 'maximize' 
        ? boundedScore / 10 
        : (10 - boundedScore) / 10;

      totalUtility += weights[idx] * normalizedScore;
    });

    return {
      alternative: alt,
      totalUtility: Math.round(totalUtility * 1000) / 1000,
      rank: 1, // 稍后排序确定
    };
  });

  // 降序排序并确定位次
  rankingList.sort((a, b) => b.totalUtility - a.totalUtility);
  rankingList.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    solverType: input.solverType || 'BWM',
    criteria,
    alternatives,
    scoreMatrix,
    bestCriterionId: criteria[safeBestIdx].id,
    worstCriterionId: criteria[safeWorstIdx].id,
    bestToOthers,
    othersToWorst,
    computedWeights,
    consistencyIndex: Math.round(consistencyIndex * 1000) / 1000,
    consistencyPassed,
    ranking: rankingList,
  };
}
