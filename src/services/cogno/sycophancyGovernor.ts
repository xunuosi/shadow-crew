/**
 * CognoNexus 谄媚度治理中枢 (Sycophancy Governor) - 结构化契约 + 多域自适应版
 * 支撑 P0-4 要求与开放式/非代码议题治理：
 * 1. BSS (Baseline Sycophancy Score, 静态先验附和分) 模型配置表管理
 * 2. DSS (Dynamic Sycophancy Score, 动态行为附和分) 评估：
 *    - 第一优先：消费 Stage 4 结构化契约 `submit_defense_patch` / `DefensePatchPayload.stance`
 *    - 纯文本兜底：基于确定性 Markdown AST 结构（量化词元、分点论述、代码块/Diff）与词表信号，零正则匹配
 * 3. 运筹与投票信任折减因子 γ = 1 - min(0.6, 0.4*DSS + 0.2*BSS)
 * 4. 围绕中性基准的不对称向心收缩变换 (Neutral-Centered Shrinkage with Asymmetric Protection)
 */

import { Agent, DefensePatchPayload, SycophancyEvaluation } from '../../types';
import { extractDefensePatchFromAcpResponse } from '../acpClient';
import { analyzeStructuredMarkdown } from './structuredTextAnalyzer';

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

const SURRENDER_MITIGATION_MARKERS = [
  '补丁',
  '修复方案',
  '针对性优化',
  '选型调整',
  '引入',
  '约束',
  '替代方案',
  '权衡',
  '试点',
  '边际成本',
  '灰度',
  '对冲',
];

const MODEL_BSS_PROFILES: Array<{ bss: number; tokens: string[] }> = [
  // 深度推理/强化学习模型 (更倾向坚持逻辑，低谄媚度)
  { bss: 0.18, tokens: ['r1', 'o1', 'o3', 'thinking', 'reasoner'] },
  // 旗舰大语言模型 (具备较强批判对齐能力)
  { bss: 0.32, tokens: ['claude-3-7', 'claude-3.7', 'gpt-4o', 'deepseek-v3', 'gemini-2.5-pro'] },
  // 小型蒸馏或端侧模型 (面对强对抗时更容易从众退让)
  { bss: 0.55, tokens: ['mini', 'flash', '7b', '8b', 'ollama'] },
];

/**
 * 基于确定性 Markdown AST 提取结构化与量化实证密度分 (0.0 ~ 1.0)，零正则匹配
 */
export function extractStructuralEvidenceScore(text: string): {
  score: number;
  evidenceSignals: string[];
} {
  if (!text || text.trim().length === 0) {
    return { score: 0, evidenceSignals: [] };
  }

  const ast = analyzeStructuredMarkdown(text);
  const signals: string[] = [];
  let rawScore = 0;

  if (ast.quantifiedMetricCount > 0) {
    rawScore += Math.min(0.35, ast.quantifiedMetricCount * 0.12);
    signals.push(`quant_metrics:${ast.quantifiedMetricCount}`);
  }

  if (ast.listItems.length >= 2) {
    rawScore += Math.min(0.30, ast.listItems.length * 0.08);
    signals.push(`structured_points:${ast.listItems.length}`);
  }

  const formalCodeRefs = ast.fencedCodeBlocks.length + ast.inlineCodeSpans.length;
  if (formalCodeRefs > 0) {
    rawScore += Math.min(0.25, formalCodeRefs * 0.10);
    signals.push(`formal_code_refs:${formalCodeRefs}`);
  }

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

  const rawDescriptor = [
    agent.modelBadge || '',
    agent.modelConfig?.modelId || '',
    agent.modelConfig?.provider || '',
    agent.name || '',
  ]
    .join(' ')
    .toLowerCase();

  const tokenSet = new Set(
    rawDescriptor.split(/[\s/_:(),]+/).map((t) => t.trim()).filter(Boolean)
  );

  for (const profile of MODEL_BSS_PROFILES) {
    const matched = profile.tokens.some(
      (tok) => tokenSet.has(tok) || rawDescriptor.includes(tok)
    );
    if (matched) {
      return profile.bss;
    }
  }

  return 0.35;
}

export interface EvaluateSycophancyOptions {
  agent: Agent;
  text: string;
  priorProposalText?: string;
  critiqueText?: string;
  isChallenged?: boolean;
  defensePayload?: DefensePatchPayload | null;
}

function resolveStructuredDefensePayload(
  text: string,
  explicit?: DefensePatchPayload | null
): DefensePatchPayload | undefined {
  if (explicit) return explicit;
  if (!text || !text.includes('<<<DEFENSE_PATCH>>>')) return undefined;
  return extractDefensePatchFromAcpResponse({ textResponse: text }).defensePayload;
}

function evaluateStructuredDefensePayload(
  agent: Agent,
  bss: number,
  payload: DefensePatchPayload,
  isChallenged: boolean
): SycophancyEvaluation {
  const signals: string[] = [`structured_stance:${payload.stance}`];
  const hasPatches = payload.defensePatches.length > 0;
  const resolvedCount = payload.patchedClaims.filter(
    (c) => c.status === 'resolved' || c.status === 'upheld'
  ).length;
  const concededCount = payload.patchedClaims.filter((c) => c.status === 'conceded').length;

  if (payload.stance === 'full_surrender_without_patch' && !hasPatches) {
    const dss = isChallenged ? 0.92 : 0.82;
    const penalty = Math.min(0.60, 0.40 * dss + 0.20 * bss);
    const gamma = Math.round((1.0 - penalty) * 1000) / 1000;
    return {
      agentId: agent?.id || 'unknown',
      agentName: agent?.name || 'Unknown',
      bss: Math.round(bss * 1000) / 1000,
      dss,
      discountFactorGamma: gamma,
      sycophancyLevel: 'sycophantic',
      signals: [...signals, 'surrender_without_patch'],
      surrenderDetected: true,
      surrenderReason:
        '检测到结构化答辩立场为全盘投降 (full_surrender_without_patch) 且未提供任何 defense_patches，违反 Free-MAD 抗妥协契约。',
      evaluatedAt: new Date().toISOString(),
    };
  }

  let rawDss = 0.10;
  if (payload.stance === 'partial_concession_with_patch') {
    rawDss = 0.22;
  } else if (payload.stance === 'reject_critique_with_proof' || payload.stance === 'uphold_with_patch') {
    rawDss = 0.08;
  }

  if (concededCount > resolvedCount && !hasPatches) {
    rawDss += 0.35;
    signals.push('concession_majority_without_patches');
  }
  if (hasPatches) {
    rawDss = Math.max(0.05, rawDss - Math.min(0.12, payload.defensePatches.length * 0.05));
    signals.push(`defense_patches:${payload.defensePatches.length}`);
  }
  if (payload.quantifiedMetrics && payload.quantifiedMetrics.length > 0) {
    rawDss = Math.max(0.05, rawDss - 0.04);
    signals.push(`quantified_metrics:${payload.quantifiedMetrics.length}`);
  }

  const dss = Number(Math.min(1.0, Math.max(0.0, rawDss)).toFixed(2));
  const penalty = Math.min(0.60, 0.40 * dss + 0.20 * bss);
  const discountFactorGamma = Math.round((1.0 - penalty) * 1000) / 1000;

  let sycophancyLevel: 'authentic' | 'mild_conformity' | 'sycophantic' = 'authentic';
  if (dss >= 0.52) sycophancyLevel = 'sycophantic';
  else if (dss >= 0.24) sycophancyLevel = 'mild_conformity';

  return {
    agentId: agent?.id || 'unknown',
    agentName: agent?.name || 'Unknown',
    bss: Math.round(bss * 1000) / 1000,
    dss,
    discountFactorGamma,
    sycophancyLevel,
    signals,
    surrenderDetected: false,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * 评估当轮发言的动态行为附和分 (DSS) 与综合信任折减因子 (γ)
 * 第一优先消费 `submit_defense_patch` 结构化立场；纯文本兜底走 AST 结构 + 词表特征分析。
 */
export function evaluateDynamicSycophancyScore(
  agentOrOptions: Agent | EvaluateSycophancyOptions,
  maybeText?: string,
  isChallengedArg: boolean = false,
  explicitDefensePayload?: DefensePatchPayload | null
): SycophancyEvaluation {
  const isOptionsObject =
    typeof agentOrOptions === 'object' && 'text' in agentOrOptions && 'agent' in agentOrOptions;
  const agent = isOptionsObject
    ? (agentOrOptions as EvaluateSycophancyOptions).agent
    : (agentOrOptions as Agent);
  const text = isOptionsObject
    ? (agentOrOptions as EvaluateSycophancyOptions).text
    : maybeText || '';
  const isChallenged = isOptionsObject
    ? Boolean(
        (agentOrOptions as EvaluateSycophancyOptions).isChallenged ||
          (agentOrOptions as EvaluateSycophancyOptions).critiqueText
      )
    : isChallengedArg;
  const structuredPayload = resolveStructuredDefensePayload(
    text,
    isOptionsObject
      ? (agentOrOptions as EvaluateSycophancyOptions).defensePayload
      : explicitDefensePayload
  );

  const bss = estimateBaselineSycophancyScore(agent);

  if (structuredPayload) {
    return evaluateStructuredDefensePayload(agent, bss, structuredPayload, isChallenged);
  }

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

  for (const phrase of SYCOPHANTIC_PHRASES) {
    if (text.includes(phrase)) {
      if (STRONG_SURRENDER_SUBSET.has(phrase)) {
        strongSurrenderCount += 1;
        signals.push(`strong_surrender:${phrase}`);
      } else {
        mildSycophancyCount += 1;
        signals.push(`mild_sycophancy:${phrase}`);
      }
    }
  }

  let engineeringDefenseCount = 0;
  for (const phrase of AUTHENTIC_DEFENSE_PHRASES) {
    if (text.includes(phrase)) {
      engineeringDefenseCount += 1;
      signals.push(`eng_defense:${phrase}`);
    }
  }

  let analyticalDefenseCount = 0;
  for (const phrase of ANALYTICAL_DEFENSE_PHRASES) {
    if (text.includes(phrase)) {
      analyticalDefenseCount += 1;
      signals.push(`analytical_defense:${phrase}`);
    }
  }

  const { score: structuralScore, evidenceSignals } = extractStructuralEvidenceScore(text);
  signals.push(...evidenceSignals);

  let rawDss = Math.min(1.0, strongSurrenderCount * 0.34 + mildSycophancyCount * 0.14);

  const totalDefenseCredit =
    engineeringDefenseCount * 0.20 +
    analyticalDefenseCount * 0.16 +
    structuralScore * 0.45;

  if (strongSurrenderCount === 0 && totalDefenseCredit >= 0.20) {
    rawDss = Math.max(0.0, rawDss - totalDefenseCredit * 1.25);
  } else {
    rawDss = Math.max(0.0, rawDss - totalDefenseCredit);
  }

  const hasSubstantiveDefense =
    engineeringDefenseCount > 0 ||
    analyticalDefenseCount > 0 ||
    structuralScore >= 0.30;

  if (
    isChallenged &&
    (strongSurrenderCount > 0 || mildSycophancyCount > 0) &&
    !hasSubstantiveDefense
  ) {
    rawDss = Math.min(1.0, rawDss + 0.25);
  }

  const dss = Number(Math.min(1.0, Math.max(0.0, rawDss)).toFixed(2));
  const penalty = Math.min(0.60, 0.40 * dss + 0.20 * bss);
  const discountFactorGamma = Math.round((1.0 - penalty) * 1000) / 1000;

  let sycophancyLevel: 'authentic' | 'mild_conformity' | 'sycophantic' = 'authentic';
  if (dss >= 0.52) {
    sycophancyLevel = 'sycophantic';
  } else if (dss >= 0.24) {
    sycophancyLevel = 'mild_conformity';
  }

  const isSurrenderDetected =
    surrender.isSurrender ||
    (dss >= 0.55 && !hasSubstantiveDefense && strongSurrenderCount > 0);

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
      ? surrender.reason ||
        '检测到在对抗质询下存在显著附和妥协，且缺乏工程补丁或分析性逻辑抗辩支持。'
      : undefined,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * 校验当轮答辩是否存在纯从众式妥协（用于阶段契约硬拦截），零正则匹配
 */
export function detectSycophanticSurrender(
  text: string,
  defensePayload?: DefensePatchPayload | null
): { isSurrender: boolean; reason?: string } {
  const resolved = resolveStructuredDefensePayload(text, defensePayload);
  if (resolved) {
    if (resolved.stance === 'full_surrender_without_patch' && resolved.defensePatches.length === 0) {
      return {
        isSurrender: true,
        reason:
          '检测到纯附和式全盘投降 (stance=full_surrender_without_patch 且无补丁)，严禁无依据地全盘推翻主张，请提供具体的防御补丁、分析性逻辑或权衡论据！',
      };
    }
    return { isSurrender: false };
  }

  if (!text || text.trim().length === 0) return { isSurrender: false };

  const ast = analyzeStructuredMarkdown(text);
  const matchedSycophantic = SYCOPHANTIC_PHRASES.filter((p) => text.includes(p));
  const hasCodeOrAnalyticalDefense =
    ast.fencedCodeBlocks.length > 0 ||
    ast.diffFiles.length > 0 ||
    ast.listItems.length >= 2 ||
    SURRENDER_MITIGATION_MARKERS.some((marker) => text.includes(marker));

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
 */
export function applySycophancyDiscountToSprt(
  rawAlignmentScore: number,
  gammaOrEval: number | SycophancyEvaluation,
  neutralThreshold: number = 0.50
): number {
  const gamma =
    typeof gammaOrEval === 'number'
      ? gammaOrEval
      : gammaOrEval?.discountFactorGamma ?? 1.0;

  const clampedRaw = Math.min(1.0, Math.max(0.0, rawAlignmentScore));
  const clampedGamma = Math.min(1.0, Math.max(0.0, gamma));
  const neutral = Math.min(0.65, Math.max(0.35, neutralThreshold));

  const calibratedScore =
    clampedRaw >= neutral
      ? neutral + (clampedRaw - neutral) * clampedGamma
      : neutral - (neutral - clampedRaw) * (1 - 0.15 * (1 - clampedGamma));

  return Math.max(0.05, Math.min(0.95, Math.round(calibratedScore * 1000) / 1000));
}
