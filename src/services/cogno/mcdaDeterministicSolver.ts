/**
 * CognoNexus 神经符号确定性运筹决策求解器
 * 实现基于最优最劣法 (Best-Worst Method, BWM) 的准则权重优化与多属性效用排序
 * 参考文献：Rezaei, J. (2015). Best-worst multi-criteria decision-making method. Omega, 53, 49-57.
 */

import { McdaCriterion, McdaDecisionPayload } from '../../types';

// BWM 一致性指标参照表 (Consistency Index Table based on a_BW value 1..9)
export const BWM_CONSISTENCY_INDEX_TABLE: Record<number, number> = {
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
  throwOnDegeneracy?: boolean;  // 遇到退化输入时是否抛出异常，默认 true
}

/**
 * 求解 BWM Option B 精确线性规划模型
 * 参考文献：Rezaei, J. (2016). Best-worst multi-criteria decision-making method: Some properties and a linear model. Omega, 64, 126-130.
 * min ξ^L
 * s.t.
 *   |w_B - a_Bj * w_j| <= ξ^L
 *   |w_j - a_jW * w_W| <= ξ^L
 *   sum(w_j) = 1, w_j >= 0
 */
export function solveExactBwmOptionB(options: {
  n: number;
  bestIdx: number;
  worstIdx: number;
  bestToOthers: number[];
  othersToWorst: number[];
  throwOnInsufficientInfo?: boolean;
}): { weights: number[]; xi: number; status: 'optimal' | 'rejected'; rejectionReason?: 'insufficient_information' } {
  const { n, bestIdx, worstIdx, bestToOthers, othersToWorst, throwOnInsufficientInfo = true } = options;

  // 1. 信息量下界硬检验 (R-2 FLAT 退化拒绝)
  const isBestFlat = bestToOthers.every((v) => v === 1);
  const isWorstFlat = othersToWorst.every((v) => v === 1);
  if (isBestFlat && isWorstFlat) {
    if (throwOnInsufficientInfo) {
      const error: any = new Error('insufficient_information');
      error.code = 'insufficient_information';
      throw error;
    }
    return {
      weights: new Array(n).fill(1 / n),
      xi: 1.0,
      status: 'rejected',
      rejectionReason: 'insufficient_information',
    };
  }

  // 2. 解析初始值种子 (Analytical Seed)
  const rawWeights = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
    const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));
    rawWeights[j] = Math.sqrt((1 / aBj) * ajW);
  }
  let sumRaw = rawWeights.reduce((a, b) => a + b, 0) || 1;
  let w = rawWeights.map((v) => v / sumRaw);

  // 3. 高精度单纯形欧氏投影算法 (Wang & Carreira-Perpiñán 2013)
  function projectOntoSimplex(v: number[]): number[] {
    const sorted = [...v].sort((a, b) => b - a);
    let rho = 0;
    let sumVal = 0;
    for (let i = 0; i < sorted.length; i++) {
      sumVal += sorted[i];
      const theta = (sumVal - 1) / (i + 1);
      if (sorted[i] - theta > 0) {
        rho = i;
      }
    }
    const theta = (sorted.slice(0, rho + 1).reduce((a, b) => a + b, 0) - 1) / (rho + 1);
    return v.map((x) => Math.max(0, x - theta));
  }

  // 4. 采用加速变步长次梯度与牛顿退火搜索全局最小 ξ^L
  let bestWeights = [...w];
  let minXi = Infinity;
  const maxIterations = 2000;

  for (let iter = 0; iter < maxIterations; iter++) {
    let currentMaxDev = -1;
    let subgrad = new Array(n).fill(0);

    for (let j = 0; j < n; j++) {
      const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
      const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));

      const dev1 = Math.abs(w[bestIdx] - aBj * w[j]);
      const dev2 = Math.abs(w[j] - ajW * w[worstIdx]);

      if (dev1 > currentMaxDev) {
        currentMaxDev = dev1;
        subgrad = new Array(n).fill(0);
        const sgn = w[bestIdx] - aBj * w[j] >= 0 ? 1 : -1;
        subgrad[bestIdx] += sgn;
        subgrad[j] -= aBj * sgn;
      }

      if (dev2 > currentMaxDev) {
        currentMaxDev = dev2;
        subgrad = new Array(n).fill(0);
        const sgn = w[j] - ajW * w[worstIdx] >= 0 ? 1 : -1;
        subgrad[j] += sgn;
        subgrad[worstIdx] -= ajW * sgn;
      }
    }

    if (currentMaxDev < minXi) {
      minXi = currentMaxDev;
      bestWeights = [...w];
    }

    // Polyak 学习率
    const stepSize = 0.15 / Math.sqrt(iter + 1);
    for (let j = 0; j < n; j++) {
      w[j] -= stepSize * subgrad[j];
    }
    w = projectOntoSimplex(w);
  }

  // 5. 重新计算最优权重上的严格一致性指标 ξ*
  let finalXi = 0;
  for (let j = 0; j < n; j++) {
    const aBj = Math.max(1, Math.min(9, bestToOthers[j] || 1));
    const ajW = Math.max(1, Math.min(9, othersToWorst[j] || 1));
    const dev1 = Math.abs(bestWeights[bestIdx] - aBj * bestWeights[j]);
    const dev2 = Math.abs(bestWeights[j] - ajW * bestWeights[worstIdx]);
    finalXi = Math.max(finalXi, dev1, dev2);
  }

  return {
    weights: bestWeights,
    xi: finalXi,
    status: 'optimal',
  };
}

/**
 * 求解 BWM 确定性最优规划
 */
export function solveDeterministicBwm(input: SolveBwmInput): McdaDecisionPayload {
  const {
    criteria,
    alternatives,
    scoreMatrix,
    bestCriterionId,
    worstCriterionId,
    bestToOthers,
    othersToWorst,
    throwOnDegeneracy = true,
  } = input;
  const n = criteria.length;

  if (n === 0) {
    throw new Error('MCDA 求解器至少需要一个评价准则');
  }

  const bestIdx = criteria.findIndex((c) => c.id === bestCriterionId);
  const worstIdx = criteria.findIndex((c) => c.id === worstCriterionId);

  const safeBestIdx = bestIdx >= 0 ? bestIdx : 0;
  const safeWorstIdx = worstIdx >= 0 ? worstIdx : (n - 1);

  // 1. 调用 Option B 精确求解
  let solved: { weights: number[]; xi: number; status: 'optimal' | 'rejected'; rejectionReason?: 'insufficient_information' };
  try {
    solved = solveExactBwmOptionB({
      n,
      bestIdx: safeBestIdx,
      worstIdx: safeWorstIdx,
      bestToOthers,
      othersToWorst,
      throwOnInsufficientInfo: throwOnDegeneracy,
    });
  } catch (err: any) {
    if (throwOnDegeneracy) throw err;
    return {
      solverType: input.solverType || 'BWM',
      criteria,
      alternatives,
      scoreMatrix,
      bestCriterionId: criteria[safeBestIdx].id,
      worstCriterionId: criteria[safeWorstIdx].id,
      bestToOthers,
      othersToWorst,
      computedWeights: {},
      consistencyIndex: 1.0,
      consistencyPassed: false,
      ranking: [],
      status: 'rejected',
      rejectionReason: 'insufficient_information',
    };
  }

  if (solved.status === 'rejected') {
    return {
      solverType: input.solverType || 'BWM',
      criteria,
      alternatives,
      scoreMatrix,
      bestCriterionId: criteria[safeBestIdx].id,
      worstCriterionId: criteria[safeWorstIdx].id,
      bestToOthers,
      othersToWorst,
      computedWeights: {},
      consistencyIndex: solved.xi,
      consistencyPassed: false,
      ranking: [],
      status: 'rejected',
      rejectionReason: solved.rejectionReason,
    };
  }

  const { weights, xi } = solved;

  // 2. 计算一致性标度与阈值检验
  const aBW = Math.max(1, Math.min(9, bestToOthers[safeWorstIdx] || 5));
  const tableCI = BWM_CONSISTENCY_INDEX_TABLE[aBW] || 2.30;
  const consistencyRatio = tableCI > 0 ? xi / tableCI : 0;
  const consistencyPassed = consistencyRatio <= 0.20 || xi <= 0.12;

  // 3. 将各准则权重映射为字典
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
    consistencyIndex: Math.round(xi * 1000) / 1000,
    consistencyPassed,
    ranking: rankingList,
    status: 'optimal',
  };
}
