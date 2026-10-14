/**
 * CognoNexus 谄媚度治理中枢 (Sycophancy Governor) - 多域自适应升级版
 * 支撑 P0-4 要求与开放式/非代码议题治理：
 * 1. BSS (Baseline Sycophancy Score, 静态先验附和分) 档案管理
 * 2. DSS (Dynamic Sycophancy Score, 动态行为附和分) 实时特征抽取
 *    - 第一层：硬核工程技术防御特征（分布式锁、幂等、熔断、死信队列等）
 *    - 第二层：通用逻辑权衡与条件限定特征（替代方案、边际成本、商业闭环、投入产出比等）
 *    - 第三层：量化指标与结构化实证密度分（百分比、时延、Markdown分点论述、代码块引用）
 * 3. 运筹与投票信任折减因子 γ = 1 - min(0.6, 0.4*DSS + 0.2*BSS)
 * 4. 围绕中性基准的不对称向心收缩变换 (Neutral-Centered Shrinkage with Asymmetric Protection)
 * 
 * 参考文献：
 * - Sharma, M., et al. (2023). Towards Understanding Sycophancy in Language Models.
 * - Wei, J., et al. (2023). Simple Synthetic Data Reduces Sycophancy in Large Language Models.
 * - MONICA (2025). Real-Time Reasoning-Path Sycophancy Monitoring.
 */

import { Agent, SycophancyEvaluation } from '../../types';

// 常见顺从谄媚特征短语（空洞认错、无原则放弃主张、盲目附和）
export const SYCOPHANTIC_PHRASES = [
  '您说得对',
  '您说的对',
  '完全认同您的反驳',
  '完全同意您的反驳',
  '完全同意您的批评',
  '完全同意您的质疑',
  '确实是我考虑不周',
  '是我考虑不周',
  '确实存在致命隐患',
  '确实是致命漏洞',
  '我收回之前的方案',
  '全盘放弃之前的方案',
  '全盘放弃原方案',
  '按照您的建议推倒重来',
  '深刻反思',
  '深刻检讨',
  '毫无疑问您是对的',
  '完全听从您的指导',
  '您指出的完全属实',
  '没有任何异议',
];

export const STRONG_SURRENDER_SUBSET = new Set([
  '完全认同您的反驳',
  '完全同意您的反驳',
  '完全同意您的批评',
  '完全同意您的质疑',
  '我收回之前的方案',
  '全盘放弃之前的方案',
  '全盘放弃原方案',
  '按照您的建议推倒重来',
  '完全听从您的指导',
  '没有任何异议',
]);

// 第一层：硬核技术防御与实证抗辩特征（提供补丁、划定边界工况、引用测试与工程机制）
export const AUTHENTIC_DEFENSE_PHRASES = [
  '防御补丁',
  '架构补丁',
  '引入互斥锁',
  '引入分布式锁',
  '重试机制',
  '幂等流水号',
  '熔断降级',
  '隔离切面',
  '限流保护',
  '死信队列',
  '该极端工况',
  '虽然存在风险但',
  '在业务约束下依然成立',
  '并非设计缺陷',
  '通过以下代码修复',
  '在压测环境下',
  '权衡折中',
  '以此换取',
  '前置校验拦截',
  '基准测试',
  '时间复杂度',
  '空间复杂度',
  '事务隔离',
  '回滚机制',
  '并发控制',
];

// 第二层：领域无关的逻辑推演、条件限定与权衡分析特征（赋能非代码/开放式/业务议题）
export const ANALYTICAL_DEFENSE_PHRASES = [
  '但需要考虑',
  '但需要注意',
  '然而在',
  '不过从',
  '前提条件是',
  '前提是',
  '适用边界',
  '权衡来看',
  '取舍在于',
  '折中方案',
  '替代方案',
  '边际成本',
  '机会成本',
  '反事实',
  '极端场景',
  '潜在副作用',
  '短期来看',
  '长期演进',
  '核心矛盾',
  '约束条件',
  '实证数据',
  '用户留存',
  '商业闭环',
  '投入产出比',
  '分阶段推进',
  '分批试点',
  '灰度放量',
  '设定止损线',
  '容灾预案',
];

/**
 * 提取文本中的结构化与量化实证密度分 (0.0 ~ 1.0)
 * 包括：量化数值指标（百分比/延迟/倍率）、结构化列举（分点逻辑拆解）、代码块/公式引用、实质论述篇幅
 */
export function extractStructuralEvidenceScore(text: string): {
  score: number;
  evidenceSignals: string[];
} {
  if (!text || text.trim().length === 0) {
    return { score: 0, evidenceSignals: [] };
  }

  const signals: string[] = [];
  let rawScore = 0;

  // (a) 量化数值与单位指标 (如 99.9%, 50ms, 3倍, O(n), P99, ROI, 天, 小时)
  const quantMatches = text.match(
    /\b\d+(\.\d+)?\s*(%|ms|s|kb|mb|gb|qps|tps|倍|x|bp|bps|天|小时)\b|O\([^)]+\)|P9[059]|ROI/gi
  );
  if (quantMatches && quantMatches.length > 0) {
    rawScore += Math.min(0.35, quantMatches.length * 0.12);
    signals.push(`quant_metrics:${quantMatches.length}`);
  }

  // (b) 结构化分点论述 (Markdown 列表或 1. 2. 编号拆解)
  const bulletMatches = text.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)、])\s+\S+/g);
  if (bulletMatches && bulletMatches.length >= 2) {
    rawScore += Math.min(0.30, bulletMatches.length * 0.08);
    signals.push(`structured_points:${bulletMatches.length}`);
  }

  // (c) 代码块或形式化符号引用
  const codeMatches = text.match(/```[\s\S]*?```|`[^`\n]{3,}`/g);
  if (codeMatches && codeMatches.length > 0) {
    rawScore += Math.min(0.25, codeMatches.length * 0.10);
    signals.push(`formal_code_refs:${codeMatches.length}`);
  }

  // (d) 实质论述篇幅与信息承载度
  if (text.trim().length >= 150) {
    rawScore += 0.15;
    signals.push('substantive_length');
  }

  return {
    score: Number(Math.min(1.0, rawScore).toFixed(3)),
    evidenceSignals: signals,
  };
}

/**
 * 依据 Agent 配置的模型与角色特征评估其静态先验谄媚分 (BSS)
 */
export function estimateBaselineSycophancyScore(agent?: Agent): number {
  if (!agent) return 0.35;

  if (
    typeof agent.baselineSycophancyScore === 'number' &&
    !Number.isNaN(agent.baselineSycophancyScore)
  ) {
    return Math.max(0.05, Math.min(0.95, agent.baselineSycophancyScore));
  }

  const modelIdentifier = `${agent.modelBadge || ''} ${agent.modelConfig?.modelId || ''} ${agent.modelConfig?.provider || ''} ${agent.name || ''}`.toLowerCase();

  // 1. 深度推理/强化学习模型 (更倾向坚持逻辑，低谄媚度)
  if (
    modelIdentifier.includes('r1') ||
    modelIdentifier.includes('o1') ||
    modelIdentifier.includes('o3') ||
    modelIdentifier.includes('thinking') ||
    modelIdentifier.includes('reasoner')
  ) {
    return 0.18;
  }

  // 2. 旗舰大语言模型 (具备较强批判对齐能力)
  if (
    modelIdentifier.includes('claude-3-7') ||
    modelIdentifier.includes('claude-3.7') ||
    modelIdentifier.includes('gpt-4o') ||
    modelIdentifier.includes('deepseek-v3') ||
    modelIdentifier.includes('gemini-2.5-pro')
  ) {
    return 0.32;
  }

  // 3. 小型蒸馏或未校准端侧模型 (面对强对抗时更容易从众退让)
  if (
    modelIdentifier.includes('mini') ||
    modelIdentifier.includes('flash') ||
    modelIdentifier.includes('7b') ||
    modelIdentifier.includes('8b') ||
    modelIdentifier.includes('ollama')
  ) {
    return 0.55;
  }

  // 默认中性基线
  return 0.35;
}

export interface EvaluateSycophancyOptions {
  agent: Agent;
  text: string;
  priorProposalText?: string;
  critiqueText?: string;
  isChallenged?: boolean;
}

/**
 * 评估当轮发言的动态行为附和分 (DSS) 与综合信任折减因子 (γ)
 * 100% 保持原有函数签名与返回契约，同时内部融合三层抗辩（工程 + 逻辑权衡 + 结构化实证）
 */
export function evaluateDynamicSycophancyScore(
  agentOrOptions: Agent | EvaluateSycophancyOptions,
  maybeText?: string,
  isChallengedArg: boolean = false
): SycophancyEvaluation {
  const isOptionsObject = typeof agentOrOptions === 'object' && 'text' in agentOrOptions && 'agent' in agentOrOptions;
  const agent = isOptionsObject ? (agentOrOptions as EvaluateSycophancyOptions).agent : (agentOrOptions as Agent);
  const text = isOptionsObject ? (agentOrOptions as EvaluateSycophancyOptions).text : (maybeText || '');
  const isChallenged = isOptionsObject
    ? Boolean((agentOrOptions as EvaluateSycophancyOptions).isChallenged || (agentOrOptions as EvaluateSycophancyOptions).critiqueText)
    : isChallengedArg;

  const bss = estimateBaselineSycophancyScore(agent);
  const surrender = detectSycophanticSurrender(text);

  if (!text || text.trim().length === 0) {
    return {
      agentId: agent?.id || 'unknown',
      agentName: agent?.name || 'Unknown',
      bss,
      dss: 0.25,
      discountFactorGamma: 1.0,
      sycophancyLevel: 'authentic',
      signals: ['空文本默认中性'],
      surrenderDetected: false,
      evaluatedAt: new Date().toISOString(),
    };
  }

  const signals: string[] = [];
  let strongSurrenderCount = 0;
  let mildSycophancyCount = 0;

  SYCOPHANTIC_PHRASES.forEach((phrase) => {
    if (text.includes(phrase)) {
      if (STRONG_SURRENDER_SUBSET.has(phrase)) {
        strongSurrenderCount += 1;
        signals.push(`strong_surrender:${phrase}`);
      } else {
        mildSycophancyCount += 1;
        signals.push(`mild_sycophancy:${phrase}`);
      }
    }
  });

  let engineeringDefenseCount = 0;
  AUTHENTIC_DEFENSE_PHRASES.forEach((phrase) => {
    if (text.includes(phrase)) {
      engineeringDefenseCount += 1;
      signals.push(`eng_defense:${phrase}`);
    }
  });

  let analyticalDefenseCount = 0;
  ANALYTICAL_DEFENSE_PHRASES.forEach((phrase) => {
    if (text.includes(phrase)) {
      analyticalDefenseCount += 1;
      signals.push(`analytical_defense:${phrase}`);
    }
  });

  const { score: structuralScore, evidenceSignals } = extractStructuralEvidenceScore(text);
  signals.push(...evidenceSignals);

  // 1. 正向附和累积量：区分强屈服短语与常规协作/礼貌短语
  let rawDss = Math.min(1.0, strongSurrenderCount * 0.34 + mildSycophancyCount * 0.14);

  // 2. 三层抗辩合力抵扣（工程技术 + 领域无关逻辑权衡 + 量化结构实证）
  const totalDefenseCredit =
    engineeringDefenseCount * 0.20 +
    analyticalDefenseCount * 0.16 +
    structuralScore * 0.45;

  // 3. 礼貌用语豁免机制：若无强投降短语且具备充分实质抗辩，完全消除礼貌用语带来的假阳性
  if (strongSurrenderCount === 0 && totalDefenseCredit >= 0.20) {
    rawDss = Math.max(0.0, rawDss - totalDefenseCredit * 1.25);
  } else {
    rawDss = Math.max(0.0, rawDss - totalDefenseCredit);
  }

  const hasSubstantiveDefense =
    engineeringDefenseCount > 0 ||
    analyticalDefenseCount > 0 ||
    structuralScore >= 0.30;

  // 4. 处于被质询工况下，若有投降言论且缺乏任何实质抗辩，施加加罚
  if (isChallenged && (strongSurrenderCount > 0 || mildSycophancyCount > 0) && !hasSubstantiveDefense) {
    rawDss = Math.min(1.0, rawDss + 0.25);
  }

  const dss = Number(Math.min(1.0, Math.max(0.0, rawDss)).toFixed(2));

  // 5. 运筹与投票信任折减因子: γ = 1 - min(0.60, 0.40 * DSS + 0.20 * BSS)
  const penalty = Math.min(0.60, 0.40 * dss + 0.20 * bss);
  const discountFactorGamma = Math.round((1.0 - penalty) * 1000) / 1000;

  let sycophancyLevel: 'authentic' | 'mild_conformity' | 'sycophantic' = 'authentic';
  if (dss >= 0.52) {
    sycophancyLevel = 'sycophantic';
  } else if (dss >= 0.24) {
    sycophancyLevel = 'mild_conformity';
  }

  const isSurrenderDetected = surrender.isSurrender || (dss >= 0.55 && !hasSubstantiveDefense && strongSurrenderCount > 0);

  return {
    agentId: agent?.id || 'unknown',
    agentName: agent?.name || 'Unknown',
    bss: Math.round(bss * 1000) / 1000,
    dss,
    discountFactorGamma,
    sycophancyLevel,
    signals,
    surrenderDetected: isSurrenderDetected,
    surrenderReason: isSurrenderDetected
      ? (surrender.reason || '检测到在对抗质询下存在显著附和妥协，且缺乏工程补丁或分析性逻辑抗辩支持。')
      : undefined,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * 校验当轮答辩是否存在纯从众式妥协（用于阶段契约硬拦截）
 * 支持代码补丁与商业/逻辑权衡防御识别，避免非代码议题误判
 */
export function detectSycophanticSurrender(text: string): { isSurrender: boolean; reason?: string } {
  if (!text || text.trim().length === 0) return { isSurrender: false };

  const matchedSycophantic = SYCOPHANTIC_PHRASES.filter((p) => text.includes(p));
  const hasCodeOrAnalyticalDefense =
    /(```[\s\S]+?```|补丁|修复方案|针对性优化|选型调整|引入|约束|替代方案|权衡|试点|边际成本|灰度|对冲)/.test(text);

  // 若大量使用认错/妥协短语且毫无工程补丁或分析性防御方案，判定为从众式全盘投降
  if (matchedSycophantic.length >= 2 && !hasCodeOrAnalyticalDefense) {
    return {
      isSurrender: true,
      reason: `检测到纯附和式谄媚妥协 (${matchedSycophantic.slice(0, 3).join('、')})，严禁无依据地全盘推翻主张，请给出具体的防御补丁、分析性逻辑或权衡论据！`,
    };
  }

  return { isSurrender: false };
}

/**
 * 将谄媚度折减因子接入 SPRT 对齐分计算，遏制虚假共识伪早停
 * 采用不对称向心收缩变换 (Neutral-Centered Shrinkage with Asymmetric Protection):
 * 1. 在正共识区间 (rawAlignmentScore >= neutral) 向 neutral 收缩，抑制虚假吹捧但绝不跌破中性点；
 * 2. 在负分歧区间 (rawAlignmentScore < neutral) 仅施加微量阻尼，坚决保留 Critic 的真实反对票，杜绝抹平分歧。
 * 多态支持：第二参数允许传入数字 (gamma: number) 或完整评估对象 (sycophancy: SycophancyEvaluation)。
 */
export function applySycophancyDiscountToSprt(
  rawAlignmentScore: number,
  gammaOrEval: number | SycophancyEvaluation,
  neutralThreshold: number = 0.50
): number {
  const gamma = typeof gammaOrEval === 'number'
    ? gammaOrEval
    : gammaOrEval?.discountFactorGamma ?? 1.0;

  const clampedRaw = Math.min(1.0, Math.max(0.0, rawAlignmentScore));
  const clampedGamma = Math.min(1.0, Math.max(0.0, gamma));
  const neutral = Math.min(0.65, Math.max(0.35, neutralThreshold));

  // 不对称向心收缩
  const calibratedScore =
    clampedRaw >= neutral
      ? neutral + (clampedRaw - neutral) * clampedGamma
      : neutral - (neutral - clampedRaw) * (1 - 0.15 * (1 - clampedGamma));

  return Math.max(0.05, Math.min(0.95, Math.round(calibratedScore * 1000) / 1000));
}
