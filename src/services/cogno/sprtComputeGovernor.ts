/**
 * CognoNexus 序贯概率比检验 (Wald-SPRT) 自适应计算调控器
 * 实现基于似然比的动态早停 (Early Exit) 与病态死锁熔断 (Deadlock Escalation)
 * 参考文献：Wald, A. (1945). Sequential tests of statistical hypotheses. Annals of Mathematical Statistics.
 */

import { SprtGovernorState } from '../../types';
import { getMetricBaselineSummary, MetricBaselineSummary } from './metricBaselineTracker';

export interface SprtCalibrationParams {
  alpha: number;
  beta: number;
  sensitivity: number;
  neutralThreshold: number;
  calibrationStatus: 'uncalibrated' | 'calibrated' | 'fallback';
}

/**
 * 基于度量基线历史数据动态拟合 SPRT 判定参数 (R-4 校准化收敛)
 */
export function fitSprtCalibrationParams(summary?: MetricBaselineSummary): SprtCalibrationParams {
  const currentSummary = summary || (typeof getMetricBaselineSummary === 'function' ? getMetricBaselineSummary() : undefined);
  if (!currentSummary || currentSummary.totalTopics < 2) {
    return {
      alpha: 0.05,
      beta: 0.05,
      sensitivity: 3.6,
      neutralThreshold: 0.50,
      calibrationStatus: 'uncalibrated',
    };
  }

  try {
    let alpha = 0.05;
    let beta = 0.05;

    // 动态校准逻辑：根据历史自动裁定率与人工介入率调整 SPRT 的上下界敏感度
    // 1. 若人工介入率偏高 (> 20%)，需要更敏感地捕捉死锁 (提高 beta 保护)
    // 2. 若自动裁定率较高 (> 75%)，轻微提高 sensitivity 加速早停收敛
    if (currentSummary.humanInterventionRate > 0.20) {
      beta = 0.03;
    }
    if (currentSummary.autoArbitrationRate > 0.75) {
      alpha = 0.04;
    }

    const fittedSensitivity = Math.min(4.5, Math.max(2.8, 3.6 * (1 + (currentSummary.autoArbitrationRate - 0.5) * 0.4)));

    return {
      alpha,
      beta,
      sensitivity: Math.round(fittedSensitivity * 100) / 100,
      neutralThreshold: 0.50,
      calibrationStatus: 'calibrated',
    };
  } catch (err) {
    console.warn('[SprtGovernor] Calibration fitting failed, falling back to default:', err);
    return {
      alpha: 0.08,
      beta: 0.08,
      sensitivity: 3.2,
      neutralThreshold: 0.50,
      calibrationStatus: 'fallback',
    };
  }
}

export interface EvaluateSprtOptions {
  priorState?: SprtGovernorState;
  currentRound: number;
  maxRounds?: number;
  alignmentScore: number; // 当轮综合对齐分数 (0~1)
  groundedTrueRatio?: number;
  calibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback';
  alpha?: number;         // 第一类错误率 (假共识/虚假早停)，默认动态拟合
  beta?: number;          // 第二类错误率 (漏报/死锁误判)，默认动态拟合
}

/**
 * 执行一步 Wald-SPRT 序贯概率比推演
 */
export function stepSprtGovernor(options: EvaluateSprtOptions): SprtGovernorState {
  const {
    priorState,
    currentRound,
    maxRounds = 4,
    alignmentScore,
    groundedTrueRatio,
    calibrationStatus: explicitCalibrationStatus,
    alpha: explicitAlpha,
    beta: explicitBeta,
  } = options;

  // 动态拟合校准参数 (R-4)
  const fitted = fitSprtCalibrationParams();
  const alpha = explicitAlpha ?? fitted.alpha;
  const beta = explicitBeta ?? fitted.beta;
  const sensitivity = fitted.sensitivity;
  const calibrationStatus = explicitCalibrationStatus ?? fitted.calibrationStatus;

  // 1. 计算 Wald 判定上下限
  // A = ln((1 - beta) / alpha)
  // B = ln(beta / (1 - alpha))
  const upperThresholdA = Math.round(Math.log((1 - beta) / alpha) * 1000) / 1000;
  const lowerThresholdB = Math.round(Math.log(beta / (1 - alpha)) * 1000) / 1000;

  // 2. 计算当前轮次似然比增量 (Log-Likelihood Ratio Delta)
  // 设中性对齐基准为 0.50，当 Sr > 0.50 时倾向于 H1 (收敛共识)，当 Sr < 0.50 时倾向于 H0 (无效死锁)
  const boundedScore = Math.max(0, Math.min(1, alignmentScore));
  const deltaLogLikelihood = Math.round(sensitivity * (boundedScore - fitted.neutralThreshold) * 1000) / 1000;

  // 3. 累积似然比
  const priorLambda = priorState ? priorState.logLikelihoodRatio : 0;
  const currentLambda = Math.round((priorLambda + deltaLogLikelihood) * 1000) / 1000;

  // 4. 评估状态迁移
  let decisionState: 'continue' | 'early_exit' | 'deadlock_escalation' = 'continue';
  let statusDescription = `轮次 ${currentRound}: 对齐分 ${(boundedScore * 100).toFixed(0)}%, 似然比 Λ=${currentLambda} (区间 [${lowerThresholdB}, ${upperThresholdA}])`;

  if (currentLambda >= upperThresholdA) {
    decisionState = 'early_exit';
    statusDescription = `⚡ SPRT 突破高置信上界 (Λ=${currentLambda} >= ${upperThresholdA})，已达成高质共识，触发早停！`;
  } else if (currentLambda <= lowerThresholdB) {
    decisionState = 'deadlock_escalation';
    statusDescription = `⚠️ SPRT 跌破死锁下界 (Λ=${currentLambda} <= ${lowerThresholdB})，检测到底层价值冲突，触发熔断求助人类！`;
  } else if (currentRound >= maxRounds) {
    // 达到硬性安全轮次上限
    decisionState = 'early_exit';
    statusDescription = `⏱️ 达到安全轮次上限 (${maxRounds} 轮)，结束发散直接转入仲裁！`;
  }

  return {
    currentRound,
    maxRounds,
    logLikelihoodRatio: currentLambda,
    upperThresholdA,
    lowerThresholdB,
    latestAlignmentScore: boundedScore,
    decisionState,
    statusDescription,
    groundedTrueRatio,
    calibrationStatus,
  };
}

/**
 * 基于文本语义与接地证据快速评估当前轮次对齐分数 (0~1)
 */
export function estimateRoundAlignmentScore(options: {
  proposalText?: string;
  critiqueText?: string;
  defenseText?: string;
  groundedTrueRatio?: number; // 0~1 工具真值检验通过比例
  isExempted?: boolean;
}): number {
  const { proposalText = '', critiqueText = '', defenseText = '', groundedTrueRatio, isExempted } = options;

  if (isExempted) {
    return 0.85; // 人类特权豁免直接赋予高对齐度
  }

  let score = 0.50; // 默认中性基准

  // 检查答辩文本中的修复积极信号
  const defensePositiveSignals = ['采纳', '补丁', '修复', '重构', '同意', '解决', '优化', '认可', '已修正', '引入锁', '降级'];
  const defenseNegativeSignals = ['无法认同', '拒绝修改', '并非漏洞', '不予采纳', '死锁', '严重分歧', '坚持原案'];

  let posCount = 0;
  let negCount = 0;

  defensePositiveSignals.forEach((sig) => {
    if (defenseText.includes(sig)) posCount++;
  });
  defenseNegativeSignals.forEach((sig) => {
    if (defenseText.includes(sig)) negCount++;
  });

  if (defenseText.length > 50) {
    if (posCount > negCount) {
      score += 0.25;
    } else if (negCount > posCount) {
      score -= 0.20;
    }
  }

  // 检查挑战文本的攻击烈度
  if (critiqueText.includes('致命') || critiqueText.includes('崩溃') || critiqueText.includes('数据失真')) {
    score -= 0.10;
  }

  // 接地工具实证反馈增益
  if (typeof groundedTrueRatio === 'number') {
    // 如果工具实证检验全部通过，说明方案已在沙箱跑通
    score += (groundedTrueRatio - 0.5) * 0.3;
  }

  return Math.max(0.05, Math.min(0.95, Math.round(score * 100) / 100));
}
