/**
 * CognoNexus 序贯概率比检验 (Wald-SPRT) 自适应计算调控器 - 多域时变漏斗升级版
 * 实现基于似然比的动态早停 (Early Exit) 与病态死锁熔断 (Deadlock Escalation)
 * 
 * 核心升级特性：
 * 1. 议题域自动画像 (deterministic_code / architecture_design / open_ended_general)
 * 2. 动态中性基线与接地权重重分配 (解决非代码议题缺少编译器单测导致的系统性负偏)
 * 3. 探索期保护门控 (Warm-up Guard) 阻止首轮破冰假共识过早熔断
 * 4. 截断式漏斗收敛边界 (Funnel SPRT) 解决开放议题温和共识迟迟不收敛的问题
 * 5. 严格门禁优先级链：保留 hasUnverifiedCriticalDispute 安全核心硬门禁
 * 
 * 参考文献：
 * - Wald, A. (1945). Sequential tests of statistical hypotheses.
 * - Tartakovsky, A. et al. (2014). Sequential Analysis: Hypothesis Testing and Changepoint Detection.
 * - Sequential Consensus for Multi-Agent LLM Debates (2026).
 */

import { ChallengeCritiquePayload, DefensePatchPayload, SprtGovernorState } from '../../types';
import {
  extractChallengeCritiqueFromAcpResponse,
  extractDefensePatchFromAcpResponse,
} from '../acpClient';
import { getMetricBaselineSummary, MetricBaselineSummary } from './metricBaselineTracker';
import { analyzeStructuredMarkdown } from './structuredTextAnalyzer';
import { ANALYTICAL_DEFENSE_PHRASES } from './sycophancyGovernor';
import { getSprtThresholdOverrides } from './sprtThresholdConfig';

export type TopicDomainType =
  | 'deterministic_code'
  | 'architecture_design'
  | 'open_ended_general';

export interface TopicDomainProfile {
  domainType: TopicDomainType;
  minExplorationRounds: number;
  neutralThreshold: number;
  baseSensitivity: number;
  funnelDecayRate: number; // 后期上界 A(r) 漏斗收缩率 (0.10 ~ 0.45)
  groundingWeightWhenPresent: number;
}

const CODE_DOMAIN_ASCII_TOKENS = new Set([
  'function',
  'class',
  'interface',
  'const',
  'let',
  'var',
  'import',
  'export',
  'return',
  'async',
  'await',
  'rust',
  'cargo',
  'tauri',
  'react',
  'typescript',
  'sql',
  'ast',
  'git',
  'diff',
  'patch',
  'bug',
  'error',
  'exception',
  'stacktrace',
  'compile',
  'lint',
  'test',
]);

const ARCH_DOMAIN_ASCII_TOKENS = new Set([
  'schema',
  'architecture',
  'protocol',
  'latency',
  'throughput',
  'scalability',
  'consensus',
]);

const ARCH_DOMAIN_ZH_TOKENS = [
  '架构',
  '模块',
  '协议',
  '吞吐',
  '延迟',
  '并发',
  '一致性',
  '分布式',
  '状态机',
  '微服务',
  '数据库',
  '缓存',
  '网关',
  '调度',
  '容灾',
  '降级',
  '拓扑',
  '接口契约',
] as const;

function extractLowerAsciiWordSet(text: string): Set<string> {
  const words = new Set<string>();
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    const isWord =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      ch === '_';
    if (isWord) {
      buf += ch;
    } else if (buf) {
      words.add(buf.toLowerCase());
      buf = '';
    }
  }
  if (buf) {
    words.add(buf.toLowerCase());
  }
  return words;
}

/**
 * 根据显式领域声明或确定性 AST/词元分类推断议题域配置画像
 */
export function inferTopicDomainProfile(
  topicText?: string,
  override?: Partial<TopicDomainProfile>,
  explicitDomainType?: TopicDomainType
): TopicDomainProfile {
  let domainType: TopicDomainType =
    explicitDomainType ||
    override?.domainType ||
    (topicText && topicText.trim().length > 0 ? 'open_ended_general' : 'deterministic_code');

  if (!explicitDomainType && !override?.domainType && topicText && topicText.trim().length > 0) {
    const ast = analyzeStructuredMarkdown(topicText);
    const asciiWords = extractLowerAsciiWordSet(topicText);
    let isCodeDomain =
      ast.fencedCodeBlocks.length > 0 || ast.diffFiles.length > 0 || ast.filePaths.length > 0;
    if (!isCodeDomain) {
      for (const tok of CODE_DOMAIN_ASCII_TOKENS) {
        if (asciiWords.has(tok)) {
          isCodeDomain = true;
          break;
        }
      }
    }

    if (isCodeDomain) {
      domainType = 'deterministic_code';
    } else {
      let isArchDomain = ARCH_DOMAIN_ZH_TOKENS.some((kw) => topicText.includes(kw));
      if (!isArchDomain) {
        for (const tok of ARCH_DOMAIN_ASCII_TOKENS) {
          if (asciiWords.has(tok)) {
            isArchDomain = true;
            break;
          }
        }
      }
      domainType = isArchDomain ? 'architecture_design' : 'open_ended_general';
    }
  }

  const defaults: Record<TopicDomainType, TopicDomainProfile> = {
    deterministic_code: {
      domainType: 'deterministic_code',
      minExplorationRounds: 1,
      neutralThreshold: 0.50,
      baseSensitivity: 3.6,
      funnelDecayRate: 0.15,
      groundingWeightWhenPresent: 0.45,
    },
    architecture_design: {
      domainType: 'architecture_design',
      minExplorationRounds: 2,
      neutralThreshold: 0.49,
      baseSensitivity: 3.5,
      funnelDecayRate: 0.28,
      groundingWeightWhenPresent: 0.25,
    },
    open_ended_general: {
      domainType: 'open_ended_general',
      minExplorationRounds: 2,
      neutralThreshold: 0.47,
      baseSensitivity: 3.3,
      funnelDecayRate: 0.38,
      groundingWeightWhenPresent: 0.15,
    },
  };

  return {
    ...defaults[domainType],
    ...override,
  };
}

export interface SprtCalibrationParams {
  alpha: number;
  beta: number;
  sensitivity: number;
  neutralThreshold: number;
  calibrationStatus: 'uncalibrated' | 'calibrated' | 'fallback';
  domainType?: TopicDomainType;
  minExplorationRounds?: number;
  funnelDecayRate?: number;
}

/**
 * 基于度量基线历史数据动态拟合 SPRT 判定参数 (R-4 校准化收敛)
 * 支持多态：兼容旧版 fitSprtCalibrationParams(summary?) 与新版 fitSprtCalibrationParams(summary?, options?)
 */
export function fitSprtCalibrationParams(
  summary?: MetricBaselineSummary,
  options?: { topicText?: string; domainType?: TopicDomainType }
): SprtCalibrationParams {
  const domainProfile = inferTopicDomainProfile(
    options?.topicText,
    options?.domainType ? { domainType: options.domainType } : undefined
  );

  const currentSummary =
    summary ||
    (typeof getMetricBaselineSummary === 'function'
      ? getMetricBaselineSummary()
      : undefined);

  if (!currentSummary || currentSummary.totalTopics < 2) {
    return {
      alpha: 0.05,
      beta: 0.05,
      sensitivity: domainProfile.baseSensitivity,
      neutralThreshold: domainProfile.neutralThreshold,
      calibrationStatus: 'uncalibrated',
      domainType: domainProfile.domainType,
      minExplorationRounds: domainProfile.minExplorationRounds,
      funnelDecayRate: domainProfile.funnelDecayRate,
    };
  }

  try {
    let alpha = 0.05;
    let beta = 0.05;

    if (currentSummary.humanInterventionRate > 0.20) {
      beta = 0.03;
    }
    if (currentSummary.autoArbitrationRate > 0.75) {
      alpha = 0.04;
    }

    const fittedSensitivity = Math.min(
      4.5,
      Math.max(2.8, domainProfile.baseSensitivity * (1 + (currentSummary.autoArbitrationRate - 0.5) * 0.4))
    );

    return {
      alpha,
      beta,
      sensitivity: Math.round(fittedSensitivity * 100) / 100,
      neutralThreshold: domainProfile.neutralThreshold,
      calibrationStatus: 'calibrated',
      domainType: domainProfile.domainType,
      minExplorationRounds: domainProfile.minExplorationRounds,
      funnelDecayRate: domainProfile.funnelDecayRate,
    };
  } catch (err) {
    console.warn('[SprtGovernor] Calibration fitting failed, falling back to default:', err);
    return {
      alpha: 0.08,
      beta: 0.08,
      sensitivity: 3.2,
      neutralThreshold: domainProfile.neutralThreshold,
      calibrationStatus: 'fallback',
      domainType: domainProfile.domainType,
      minExplorationRounds: domainProfile.minExplorationRounds,
      funnelDecayRate: domainProfile.funnelDecayRate,
    };
  }
}

export interface EvaluateSprtOptions {
  priorState?: SprtGovernorState;
  previousLogLikelihoodRatio?: number;
  currentRound: number;
  maxRounds?: number;
  alignmentScore?: number;        // 当轮综合对齐分数 (0~1)
  roundAlignmentScore?: number;   // 别名兼容
  groundedTrueRatio?: number;
  semanticScore?: number;
  dssScore?: number;              // 动态谄媚度 (P1-2 多维观测向量)
  calibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback';
  alpha?: number;                 // 第一类错误率 (假共识/虚假早停)，默认动态拟合
  beta?: number;                  // 第二类错误率 (漏报/死锁误判)，默认动态拟合
  sensitivity?: number;
  hasUnverifiedCriticalDispute?: boolean; // P1-2 / P0-1: 存在未实证核心争议时硬门禁拦截 early_exit
  // 自适应多域与时变调控扩展字段 (100% 可选向前兼容)
  topicText?: string;
  topicProfile?: Partial<TopicDomainProfile>;
  scoreHistory?: number[];
  /**
   * 离线回放专用：忽略 `sprtThresholdConfig` 中的外置阈值，完全以显式入参复现历史决策。
   * 真实流量决策链路不得设置此字段。
   */
  ignoreExternalThresholds?: boolean;
}

/**
 * 执行一步 Wald-SPRT 序贯概率比推演
 * 严格保持单对象接口签名：stepSprtGovernor(options: EvaluateSprtOptions): SprtGovernorState
 */
export function stepSprtGovernor(options: EvaluateSprtOptions): SprtGovernorState {
  const {
    priorState,
    currentRound: rawRound,
    maxRounds: rawMaxRounds,
    alignmentScore: legacyScore,
    roundAlignmentScore: modernScore,
    groundedTrueRatio,
    dssScore,
    calibrationStatus: explicitCalibrationStatus,
    alpha: explicitAlpha,
    beta: explicitBeta,
    sensitivity: explicitSensitivity,
    hasUnverifiedCriticalDispute,
    topicText,
    topicProfile: overrideProfile,
    scoreHistory,
  } = options;

  // 外置阈值（真实流量标定结果）：显式入参 > 外置配置 > 历史拟合 > 领域默认。
  // 离线回放会显式忽略外置配置，以保证历史决策可确定性复现。
  const external = options.ignoreExternalThresholds ? {} : getSprtThresholdOverrides();

  const currentRound = Math.max(1, rawRound);
  const maxRounds = Math.max(currentRound, rawMaxRounds ?? external.maxRounds ?? 4);

  // 1. 领域画像与自适应校准拟合
  const externalProfileOverride: Partial<TopicDomainProfile> = {};
  if (external.neutralThreshold !== undefined) {
    externalProfileOverride.neutralThreshold = external.neutralThreshold;
  }
  if (external.minExplorationRounds !== undefined) {
    externalProfileOverride.minExplorationRounds = external.minExplorationRounds;
  }
  if (external.funnelDecayRate !== undefined) {
    externalProfileOverride.funnelDecayRate = external.funnelDecayRate;
  }
  if (external.groundingWeightWhenPresent !== undefined) {
    externalProfileOverride.groundingWeightWhenPresent = external.groundingWeightWhenPresent;
  }
  const profile = inferTopicDomainProfile(topicText, {
    ...externalProfileOverride,
    ...overrideProfile,
  });
  const fitted = fitSprtCalibrationParams(undefined, {
    topicText,
    domainType: profile.domainType,
  });

  const alpha = explicitAlpha ?? external.alpha ?? fitted.alpha;
  const beta = explicitBeta ?? external.beta ?? fitted.beta;
  const baseSensitivity =
    explicitSensitivity ?? external.sensitivity ?? fitted.sensitivity ?? profile.baseSensitivity;
  // 领域画像（含外置覆盖）优先于拟合默认值：拟合只负责 alpha/beta/sensitivity 的自适应。
  const neutralThreshold = profile.neutralThreshold;
  const minExplorationRounds = profile.minExplorationRounds;
  const funnelDecayRate = profile.funnelDecayRate;
  const calibrationStatus = explicitCalibrationStatus ?? fitted.calibrationStatus;
  const thresholdSource: 'default' | 'fitted' | 'external' =
    Object.keys(external).length > 0
      ? 'external'
      : fitted.calibrationStatus === 'calibrated'
        ? 'fitted'
        : 'default';

  // 2. 联合观测得分与权重重分配（当非代码/开放议题无物理接地证据时，平滑转移给语义对齐分）
  const rawScore = modernScore ?? legacyScore ?? 0.50;
  const boundedScore = Math.max(0, Math.min(1, rawScore));
  const semanticInput = options.semanticScore ?? boundedScore;
  const dssInput = dssScore ?? 0.0;

  // 阈值必须高于浮点噪声：0.001 这类接近零的值意味着"几乎没有有效接地证据"，
  // 若按"有接地"处理，会把无实证议题误判为已被物理验证。
  const hasActiveGrounding =
    typeof groundedTrueRatio === 'number' &&
    !Number.isNaN(groundedTrueRatio) &&
    groundedTrueRatio >= 0.05;

  let combinedScore = boundedScore;
  if (hasActiveGrounding) {
    const wG = profile.groundingWeightWhenPresent;
    const wS = 1.0 - wG;
    combinedScore = Number((wG * groundedTrueRatio! + wS * semanticInput).toFixed(3));
  } else {
    combinedScore = boundedScore;
  }

  // 3. 在线波动率阻尼与连续同向共识动量
  const history = scoreHistory?.length
    ? [...scoreHistory, combinedScore]
    : priorState?.latestAlignmentScore !== undefined
    ? [priorState.latestAlignmentScore, combinedScore]
    : [combinedScore];

  const meanScore = history.reduce((acc, v) => acc + v, 0) / Math.max(1, history.length);
  const variance = history.reduce((acc, v) => acc + Math.pow(v - meanScore, 2), 0) / Math.max(1, history.length);
  const volatilityDamping = 1 / Math.sqrt(1 + 6.0 * variance);

  const isConsistentPositive =
    history.length >= 2 && history.slice(-2).every((s) => s > neutralThreshold + 0.03);
  const momentumBoost = isConsistentPositive ? 1.15 : 1.0;

  const effectiveSensitivity = Math.round(baseSensitivity * volatilityDamping * momentumBoost * 100) / 100;

  // 4. 计算时变漏斗形 Wald 判定上下限
  const baseUpperA = Math.round(Math.log((1 - beta) / alpha) * 1000) / 1000;
  const baseLowerB = Math.round(Math.log(beta / (1 - alpha)) * 1000) / 1000;

  let upperThresholdA = baseUpperA;
  if (currentRound > minExplorationRounds && maxRounds > minExplorationRounds) {
    const progress = (currentRound - minExplorationRounds) / Math.max(1, maxRounds - minExplorationRounds);
    const funnelFactor = Math.max(0.55, 1.0 - funnelDecayRate * Math.pow(progress, 1.5));
    upperThresholdA = Math.round(baseUpperA * funnelFactor * 1000) / 1000;
  }
  const lowerThresholdB = baseLowerB;

  // 5. 计算当前轮次似然比增量并累加
  const prevLlr = options.previousLogLikelihoodRatio ?? priorState?.logLikelihoodRatio ?? 0;
  const deltaLogLikelihood = Math.round(effectiveSensitivity * (combinedScore - neutralThreshold) * 1000) / 1000;
  const currentLambda = Math.round((prevLlr + deltaLogLikelihood) * 1000) / 1000;

  // 6. 严格按安全优先级判定决策状态迁移
  let decisionState: 'continue' | 'early_exit' | 'deadlock_escalation' = 'continue';
  let statusDescription = `轮次 ${currentRound}: 对齐分 ${(combinedScore * 100).toFixed(0)}%, 似然比 Λ=${currentLambda} (区间 [${lowerThresholdB}, ${upperThresholdA}])`;

  if (currentLambda <= lowerThresholdB) {
    // 优先级 0: 跌破下界触发死锁熔断
    decisionState = 'deadlock_escalation';
    statusDescription = `⚠️ SPRT 跌破死锁下界 (Λ=${currentLambda} <= ${lowerThresholdB})，检测到底层价值冲突，触发熔断求助人类！`;
  } else if (hasUnverifiedCriticalDispute) {
    // 优先级 1: 未核验争议核心安全硬门禁拦截（必须保留中文 '未核验' 与 '强制要求接地验证官执行实证检验' 关键字）
    decisionState = 'continue';
    statusDescription = `🔒 对齐似然比达到高位 (Λ=${currentLambda})，但存在核心未核验争议点，强制要求接地验证官执行实证检验！`;
  } else if (currentRound < minExplorationRounds) {
    // 优先级 2: 探索期保护门控 Warm-up Guard 拦截首轮早停
    decisionState = 'continue';
    statusDescription = `🛡️ 探索期保护门控生效中 (轮次 ${currentRound} < 最小探索轮次 ${minExplorationRounds})，暂缓早停以保障充分批判交锋。`;
  } else if (currentLambda >= upperThresholdA) {
    // 优先级 3: 似然比突破时变漏斗上界触发高质共识早停
    decisionState = 'early_exit';
    statusDescription = `⚡ SPRT 突破高置信上界 (Λ=${currentLambda} >= ${upperThresholdA})，已达成高质共识，触发早停！`;
  } else if (currentRound >= maxRounds) {
    // 优先级 4: 达到安全轮次上限
    decisionState = 'early_exit';
    statusDescription = `⏱️ 达到安全轮次上限 (${maxRounds} 轮)，结束发散直接转入仲裁！`;
  }

  return {
    currentRound,
    maxRounds,
    logLikelihoodRatio: currentLambda,
    upperThresholdA,
    lowerThresholdB,
    latestAlignmentScore: combinedScore,
    decisionState,
    statusDescription,
    groundedTrueRatio,
    calibrationStatus,
    observationVector: {
      groundedRatio: groundedTrueRatio ?? (hasActiveGrounding ? profile.groundingWeightWhenPresent : 0.5),
      semanticScore: semanticInput,
      dssScore: dssInput,
      combinedScore,
    },
    adaptiveMeta: {
      domainType: profile.domainType,
      neutralThreshold,
      sensitivity: effectiveSensitivity,
      isFunnelActive: upperThresholdA < baseUpperA,
      alpha,
      beta,
      minExplorationRounds,
      funnelDecayRate,
      groundingWeightWhenPresent: profile.groundingWeightWhenPresent,
      thresholdSource,
    },
  };
}

const DEFENSE_POSITIVE_SIGNALS = [
  '采纳', '补丁', '修复', '重构', '同意', '解决', '优化', '认可', '已修正', '引入锁', '降级',
  '权衡来看', '折中方案', '分阶段推进', '替代方案', '保留底线', '商业闭环',
] as const;

const DEFENSE_NEGATIVE_SIGNALS = [
  '无法认同', '拒绝修改', '并非漏洞', '不予采纳', '死锁', '严重分歧', '坚持原案', '根本不可行',
] as const;

const SEVERE_CRITIQUE_SIGNALS = ['致命', '崩溃', '数据失真'] as const;

/**
 * 基于结构化 MCP 契约 (submit_challenge_critique / submit_defense_patch) 与接地证据评估当前轮次对齐分数 (0~1)
 */
export function estimateRoundAlignmentScore(options: {
  proposalText?: string;
  critiqueText?: string;
  defenseText?: string;
  groundedTrueRatio?: number; // 0~1 工具真值检验通过比例
  dssScore?: number;          // 0~1 动态谄媚附和分 (P1-2 多维联合观测向量)
  isExempted?: boolean;
  agreementsCount?: number;
  disagreementsCount?: number;
  neutralCount?: number;
  critiquePayload?: ChallengeCritiquePayload | null;
  defensePayload?: DefensePatchPayload | null;
}): number {
  const {
    critiqueText = '',
    defenseText = '',
    groundedTrueRatio,
    dssScore,
    isExempted,
    agreementsCount,
    disagreementsCount,
    neutralCount = 0,
    critiquePayload: explicitCritiquePayload,
    defensePayload: explicitDefensePayload,
  } = options;

  if (isExempted) {
    return 0.85; // 人类特权豁免直接赋予高对齐度
  }

  // 1. 若提供了显式协议票数计数，优先基于票数快速计算
  if (typeof agreementsCount === 'number' && typeof disagreementsCount === 'number') {
    const total = agreementsCount + disagreementsCount + neutralCount;
    if (total === 0) return 0.50;
    const rawRatio = (agreementsCount + neutralCount * 0.5) / total;
    return Number(Math.min(0.95, Math.max(0.05, rawRatio)).toFixed(3));
  }

  const critiqueExtracted = explicitCritiquePayload
    ? { critiquePayload: explicitCritiquePayload, cleanedText: critiqueText }
    : extractChallengeCritiqueFromAcpResponse({ textResponse: critiqueText });
  const defenseExtracted = explicitDefensePayload
    ? { defensePayload: explicitDefensePayload, cleanedText: defenseText }
    : extractDefensePatchFromAcpResponse({ textResponse: defenseText });

  const critiquePayload = critiqueExtracted.critiquePayload;
  const defensePayload = defenseExtracted.defensePayload;
  const cleanedCritique = critiqueExtracted.cleanedText || critiqueText;
  const cleanedDefense = defenseExtracted.cleanedText || defenseText;

  // 2. 优先从结构化 MCP 契约中直接读取语义对齐信号与防卫姿态
  let semanticScore = 0.50;
  let usedStructuredSemantics = false;

  if (defensePayload) {
    usedStructuredSemantics = true;
    if (typeof defensePayload.alignmentScore === 'number') {
      semanticScore = defensePayload.alignmentScore;
    } else {
      const stanceBase: Record<DefensePatchPayload['stance'], number> = {
        partial_concession_with_patch: 0.78,
        uphold_with_patch: 0.72,
        reject_critique_with_proof: 0.42,
        full_surrender_without_patch: 0.35,
      };
      semanticScore = stanceBase[defensePayload.stance] ?? 0.55;
      if (defensePayload.patchedClaims.length > 0) {
        const resolvedCount = defensePayload.patchedClaims.filter(
          (c) => c.status === 'resolved'
        ).length;
        semanticScore += (resolvedCount / defensePayload.patchedClaims.length) * 0.12;
      }
    }
    if (typeof critiquePayload?.alignmentScore === 'number') {
      semanticScore = 0.65 * semanticScore + 0.35 * critiquePayload.alignmentScore;
    }
  } else if (typeof critiquePayload?.alignmentScore === 'number') {
    semanticScore = critiquePayload.alignmentScore;
    usedStructuredSemantics = true;
  }

  // 3. 当未提供结构化对齐字段时，回退至 AST/词表确定性语义分析
  if (!usedStructuredSemantics) {
    let posCount = 0;
    let negCount = 0;

    DEFENSE_POSITIVE_SIGNALS.forEach((sig) => {
      if (cleanedDefense.includes(sig)) posCount++;
    });
    DEFENSE_NEGATIVE_SIGNALS.forEach((sig) => {
      if (cleanedDefense.includes(sig)) negCount++;
    });
    ANALYTICAL_DEFENSE_PHRASES.forEach((sig) => {
      if (cleanedDefense.includes(sig)) posCount++;
    });

    if (cleanedDefense.length > 40) {
      if (posCount > negCount) {
        semanticScore += Math.min(0.30, 0.15 + (posCount - negCount) * 0.05);
      } else if (negCount > posCount) {
        semanticScore -= Math.min(0.30, 0.15 + (negCount - posCount) * 0.05);
      }
    }

    const hasSevereCritique =
      (critiquePayload?.fatalFlaws?.length ?? 0) > 0 ||
      SEVERE_CRITIQUE_SIGNALS.some((sig) => cleanedCritique.includes(sig));
    if (hasSevereCritique) {
      semanticScore -= 0.10;
    }
  } else if ((critiquePayload?.fatalFlaws?.length ?? 0) > 0 && typeof defensePayload?.alignmentScore !== 'number') {
    semanticScore -= 0.05;
  }

  semanticScore = Math.max(0.05, Math.min(0.95, semanticScore));

  // 4. 多维联合观测向量融合 (P1-2: Grounding + Semantic + DSS)
  let finalScore = semanticScore;
  if (typeof groundedTrueRatio === 'number' && typeof dssScore === 'number') {
    finalScore = 0.40 * groundedTrueRatio + 0.35 * semanticScore + 0.25 * (1.0 - dssScore);
  } else if (typeof groundedTrueRatio === 'number') {
    finalScore = semanticScore + (groundedTrueRatio - 0.5) * 0.3;
  } else if (typeof dssScore === 'number') {
    finalScore = semanticScore * (1 - dssScore * 0.3);
  }

  return Math.max(0.05, Math.min(0.95, Math.round(finalScore * 100) / 100));
}
