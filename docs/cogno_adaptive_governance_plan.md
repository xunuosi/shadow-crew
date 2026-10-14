# Shadow-Crew CognoNexus 博弈参数自适应优化方案（接口保真适配版 V2）

## 一、 方案演进结论：采纳「核心算法吸收 + 接口保真适配（Adapter Pattern）」

结合本地技术团队的工程评审意见，本 V2 版方案将**四大自适应数学算法**与仓库既有的**严格接口契约及原生测试工具链**做了 100% 保真融合：

| 维度 | 初版方案设计 | 本地技术团队适配方案（V2 最终采用） | 工程收益对比 |
| :--- | :--- | :--- | :--- |
| **核心数学修复** | 三层抗辩词表 + 结构化实证分 + 向心收缩变换 + 漏斗边界 | **全量吸收**，建议在向心收缩上保留「正负区间不对称保护」（仅全额折减 `> neutral` 的赞同分，防止削弱 Critic 真实反对票） | 完整解决非代码与开放议题过早熔断及迟迟不收敛问题 |
| **`stepSprtGovernor` 签名与门禁** | 多态位置参数签名 | 严格保持 **`stepSprtGovernor(options: EvaluateSprtOptions): SprtGovernorState`** 单对象签名；扩展可选 `topicProfile`、`scoreHistory`，并**强制保留 `options.hasUnverifiedCriticalDispute` 硬门禁** | 对 `agentCollaboration.ts` 与现有调用链零破坏，且防止未决关键争议被漏斗边界绕过 |
| **`evaluateDynamicSycophancyScore` 契约** | 返回 `number`，另设 `evaluateSycophancy` | 严格保持 **`evaluateDynamicSycophancyScore(agent: Agent, text: string, isChallenged?: boolean): SycophancyEvaluation`** 返回完整评估结构，将新算法 `dss` 与 `discountFactorGamma` 填入既有字段 | 100% 兼容既有类型契约与存量单元测试断言 |
| **回归测试接入** | 基于 `vitest` 编写 | 使用 Node 原生 **`node:assert/strict`** 重写为独立脚本 `test-adaptive-sprt-governance.ts`，直接纳入 `npm run test:cogno` | 零新增外部测试依赖，完美融入现有 CI 与本地测试流水线 |

## 二、 核心细节补充：落地时的两处关键边界保护

在按本地技术团队方案合入代码时，建议重点关注以下两个细节以确保数学严密性：

### 1. 向心收缩的「不对称保护」（防止削弱 Critic 反对票）

当计算向心收缩 `const calibratedScore = neutral + (rawAlignmentScore - neutral) * gamma` 时：
- 若 `rawAlignmentScore >= neutral`（正向赞同区间）：全额执行 `neutral + (rawAlignmentScore - neutral) * gamma`，将虚假附和压缩回中性点 `neutral`，使当轮似然比增量趋近于 `0` 但绝不跌破 `neutral`。
- 若 `rawAlignmentScore < neutral`（负向分歧/批判区间）：**不应乘以低 `gamma` 向中性点大幅收缩**（因为谄媚的定义是“盲目顺从赞同”，如果某轮出现低对齐分 `< 0.50`，说明正在发生实质性反驳或分歧，若乘上 `gamma` 反而会掩盖分歧、延缓死锁识别）。因此建议写为：
  ```typescript
  const calibratedScore =
    rawAlignmentScore >= neutral
      ? neutral + (rawAlignmentScore - neutral) * gamma
      : neutral - (neutral - rawAlignmentScore) * (1 - 0.15 * (1 - gamma));
  ```

### 2. `stepSprtGovernor` 内部门禁的严格优先级顺序

在 `stepSprtGovernor(options: EvaluateSprtOptions)` 判定 `decisionState` 时，三个门禁的优先级从高到低应为：
1. **第一优先级（最高安全红线）**：`options.hasUnverifiedCriticalDispute === true` $\to$ 无论 $\Lambda_r$ 是否超过漏斗上界 $A(r)$，一律强制保持 `'continue'`（除非已触底触发 `'deadlock_escalation'`），确保未验证的关键缺陷绝不漏检。
2. **第二优先级（探索期门控 Warm-up Guard）**：`currentRound < minExplorationRounds` $\to$ 即使 $\Lambda_r \ge A(r)$，也保持 `'continue'`，确保开放式议题至少完成提案与首轮批判交锋。
3. **第三优先级（时变漏斗边界判定）**：当上述门禁均放行且 $\Lambda_r \ge A(r)$ 时，触发 `'early_exit'`。

## 三、 接口保真适配版参考实现代码

### 1. `src/services/cogno/sycophancyGovernor.ts` 合入代码片段

```typescript
import { Agent, SycophancyEvaluation } from '../../types';

// 原有强顺从/投降短语保留，用于触发高权重惩罚
const SYCOPHANTIC_PHRASES = [
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

const STRONG_SURRENDER_SUBSET = new Set([
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

// 第一层：工程技术防御特征（原有词表保留并扩展）
const AUTHENTIC_DEFENSE_PHRASES = [
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
  '压力测试',
  '边界条件',
  '性能权衡',
  '基准测试',
];

// 第二层：领域无关的逻辑推演、条件限定与权衡分析特征（新增：赋能非代码/开放式议题）
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
];

/**
 * 第三层：结构化与量化实证打分 (0.0 ~ 1.0)
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

  // 1. 量化数值与单位指标 (百分比、耗时、吞吐、倍率、复杂度、分位数)
  const quantMatches = text.match(
    /\b\d+(\.\d+)?\s*(%|ms|s|kb|mb|gb|qps|tps|倍|x|bp|bps|天|小时)\b|O\([^)]+\)|P9[059]/gi
  );
  if (quantMatches && quantMatches.length > 0) {
    rawScore += Math.min(0.35, quantMatches.length * 0.12);
    signals.push(`quantitative_metrics:${quantMatches.length}`);
  }

  // 2. 结构化分点论述 (Markdown 列表或 1. 2. 编号拆解)
  const bulletMatches = text.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)、])\s+\S+/g);
  if (bulletMatches && bulletMatches.length >= 2) {
    rawScore += Math.min(0.30, bulletMatches.length * 0.08);
    signals.push(`structured_points:${bulletMatches.length}`);
  }

  // 3. 代码块或内联技术符号引用
  const codeMatches = text.match(/```[\s\S]*?```|`[^`\n]{3,}`/g);
  if (codeMatches && codeMatches.length > 0) {
    rawScore += Math.min(0.25, codeMatches.length * 0.10);
    signals.push(`code_or_formal_refs:${codeMatches.length}`);
  }

  // 4. 实质论述长度
  if (text.trim().length >= 160) {
    rawScore += 0.15;
    signals.push('substantive_length');
  }

  return {
    score: Number(Math.min(1.0, rawScore).toFixed(3)),
    evidenceSignals: signals,
  };
}

export function estimateBaselineSycophancyScore(agent: Agent): number {
  if (!agent) return 0.2;
  if (typeof agent.baselineSycophancyScore === 'number') {
    return Math.min(1.0, Math.max(0.0, agent.baselineSycophancyScore));
  }
  const modelName = (
    agent.modelBadge ||
    agent.modelConfig?.modelId ||
    agent.name ||
    ''
  ).toLowerCase();
  if (modelName.includes('gpt-3.5') || modelName.includes('turbo')) return 0.35;
  if (modelName.includes('claude-2') || modelName.includes('instant')) return 0.25;
  if (modelName.includes('deepseek') || modelName.includes('r1')) return 0.15;
  return 0.2;
}

/**
 * 保持原有函数签名与返回契约:
 * evaluateDynamicSycophancyScore(agent: Agent, text: string, isChallenged?: boolean): SycophancyEvaluation
 */
export function evaluateDynamicSycophancyScore(
  agent: Agent,
  text: string,
  isChallenged: boolean = false
): SycophancyEvaluation {
  const bss = estimateBaselineSycophancyScore(agent);
  const signals: string[] = [];

  if (!text || text.trim().length === 0) {
    const defaultGamma = Number((1 - Math.min(0.6, 0.2 * bss)).toFixed(3));
    return {
      agentId: agent?.id || 'unknown',
      agentName: agent?.name || 'Unknown',
      bss,
      dss: 0,
      discountFactorGamma: defaultGamma,
      sycophancyLevel: 'authentic',
      signals: [],
      surrenderDetected: false,
      evaluatedAt: new Date().toISOString(),
    };
  }

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

  const { score: structuralScore, evidenceSignals } =
    extractStructuralEvidenceScore(text);
  signals.push(...evidenceSignals);

  // 正向附和分累计：区分强屈服与礼貌转折
  let rawDss = Math.min(
    1.0,
    strongSurrenderCount * 0.32 + mildSycophancyCount * 0.15
  );

  // 三层抗辩合力抵扣（工程防御 + 通用逻辑权衡 + 结构化实证密度）
  const totalDefenseCredit =
    engineeringDefenseCount * 0.20 +
    analyticalDefenseCount * 0.16 +
    structuralScore * 0.45;

  // 若仅有礼貌用语且具备实质抗辩论据，则完全抵消礼貌用语带来的 DSS 虚高
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

  // 信任折减因子 γ = 1 - min(0.6, 0.4 * dss + 0.2 * bss)
  const discountFactorGamma = Number(
    (1 - Math.min(0.6, 0.4 * dss + 0.2 * bss)).toFixed(3)
  );

  const surrenderDetected = dss >= 0.55 && !hasSubstantiveDefense;
  const sycophancyLevel: SycophancyEvaluation['sycophancyLevel'] =
    dss >= 0.50
      ? 'sycophantic'
      : dss >= 0.22
      ? 'mild_conformity'
      : 'authentic';

  return {
    agentId: agent?.id || 'unknown',
    agentName: agent?.name || 'Unknown',
    bss,
    dss,
    discountFactorGamma,
    sycophancyLevel,
    signals,
    surrenderDetected,
    surrenderReason: surrenderDetected
      ? 'High dynamic sycophancy under challenge without engineering, analytical, or structural defense.'
      : undefined,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * 向心收缩对齐分折减（保持原有签名，修复正向共识跌破中性基准 Bug）
 */
export function applySycophancyDiscountToSprt(
  rawAlignmentScore: number,
  discountFactorGamma: number,
  neutral: number = 0.50
): number {
  const clampedRaw = Math.min(1.0, Math.max(0.0, rawAlignmentScore));
  const gamma = Math.min(1.0, Math.max(0.0, discountFactorGamma));

  // 向心收缩思想：在正向共识区间向 neutral 收缩，绝不越过 neutral 变成负向死锁分
  const calibratedScore =
    clampedRaw >= neutral
      ? neutral + (clampedRaw - neutral) * gamma
      : neutral - (neutral - clampedRaw) * (1 - 0.15 * (1 - gamma));

  return Number(Math.min(1.0, Math.max(0.0, calibratedScore)).toFixed(3));
}
```

### 2. `src/services/cogno/sprtComputeGovernor.ts` 单对象签名扩展适配

```typescript
import { SprtGovernorState } from '../../types';
import {
  getMetricBaselineSummary,
  MetricBaselineSummary,
} from './metricBaselineTracker';

export type TopicDomainType =
  | 'deterministic_code'
  | 'architecture_design'
  | 'open_ended_general';

export interface TopicDomainProfile {
  domainType: TopicDomainType;
  minExplorationRounds: number;
  neutralThreshold: number;
  baseSensitivity: number;
  funnelDecayRate: number;
}

export interface EvaluateSprtOptions {
  currentRound: number;
  maxRounds: number;
  previousLogLikelihoodRatio: number;
  roundAlignmentScore: number;
  alpha?: number;
  beta?: number;
  sensitivity?: number;
  groundedTrueRatio?: number;
  semanticScore?: number;
  dssScore?: number;
  hasUnverifiedCriticalDispute?: boolean; // 核心安全硬门禁：存在未验证关键争议时严禁早停
  // 新增可选扩展字段（100% 向后兼容）
  topicText?: string;
  topicProfile?: Partial<TopicDomainProfile>;
  scoreHistory?: number[];
}

export function inferTopicDomainProfile(
  topicText?: string,
  override?: Partial<TopicDomainProfile>
): TopicDomainProfile {
  const codeRegex =
    /\b(function|class|interface|const|let|rust|cargo|tauri|react|typescript|sql|ast|git|diff|patch|bug|error|stacktrace|compile|test)\b|```/i;
  const archRegex =
    /(架构|模块|协议|吞吐|延迟|并发|一致性|分布式|状态机|微服务|数据库|缓存|网关|调度|容灾|降级|拓扑|接口契约)/i;

  let domainType: TopicDomainType = override?.domainType || 'open_ended_general';
  if (!override?.domainType && topicText) {
    if (codeRegex.test(topicText)) {
      domainType = 'deterministic_code';
    } else if (archRegex.test(topicText)) {
      domainType = 'architecture_design';
    }
  }

  const defaults: Record<TopicDomainType, TopicDomainProfile> = {
    deterministic_code: {
      domainType: 'deterministic_code',
      minExplorationRounds: 1,
      neutralThreshold: 0.50,
      baseSensitivity: 3.8,
      funnelDecayRate: 0.15,
    },
    architecture_design: {
      domainType: 'architecture_design',
      minExplorationRounds: 2,
      neutralThreshold: 0.49,
      baseSensitivity: 3.5,
      funnelDecayRate: 0.28,
    },
    open_ended_general: {
      domainType: 'open_ended_general',
      minExplorationRounds: 2,
      neutralThreshold: 0.47,
      baseSensitivity: 3.3,
      funnelDecayRate: 0.38,
    },
  };

  return {
    ...defaults[domainType],
    ...override,
  };
}

/**
 * 保持单对象签名 stepSprtGovernor(options: EvaluateSprtOptions): SprtGovernorState
 * 内部融合：无接地权重无损转移 + Warm-up Guard + 时变漏斗上下界 + hasUnverifiedCriticalDispute 硬门禁
 */
export function stepSprtGovernor(
  options: EvaluateSprtOptions
): SprtGovernorState {
  const profile = inferTopicDomainProfile(
    options.topicText,
    options.topicProfile
  );

  const currentRound = Math.max(1, options.currentRound);
  const maxRounds = Math.max(currentRound, options.maxRounds || 6);
  const alpha = options.alpha ?? 0.05;
  const beta = options.beta ?? 0.05;
  const neutral = profile.neutralThreshold;
  const baseSensitivity = options.sensitivity ?? profile.baseSensitivity;

  // 1. 联合观测得分计算（当非代码/开放议题 groundedTrueRatio 未提供或为 0 时，不强行压低语义分）
  const semanticInput = Math.min(
    1.0,
    Math.max(0.0, options.semanticScore ?? options.roundAlignmentScore)
  );
  const dssInput = Math.min(1.0, Math.max(0.0, options.dssScore ?? 0));
  const hasActiveGrounding =
    typeof options.groundedTrueRatio === 'number' &&
    options.groundedTrueRatio > 0.001;
  const groundedRatio = hasActiveGrounding
    ? Math.min(1.0, Math.max(0.0, options.groundedTrueRatio!))
    : 0;

  // 向心收缩校准语义分
  const gammaEquivalent = 1 - 0.4 * dssInput;
  const calibratedSemantic =
    semanticInput >= neutral
      ? neutral + (semanticInput - neutral) * gammaEquivalent
      : semanticInput;

  const combinedScore = hasActiveGrounding
    ? Number((0.40 * groundedRatio + 0.60 * calibratedSemantic).toFixed(3))
    : Number(
        Math.min(1.0, Math.max(0.0, options.roundAlignmentScore)).toFixed(3)
      );

  // 2. 在线方差阻尼与连续正共识动量
  const history = options.scoreHistory?.length
    ? [...options.scoreHistory, combinedScore]
    : [combinedScore];
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance =
    history.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / history.length;
  const volatilityDamping = 1 / Math.sqrt(1 + 6.0 * variance);
  const momentumBoost =
    history.length >= 2 && history.slice(-2).every((s) => s > neutral + 0.03)
      ? 1.15
      : 1.0;

  const effectiveSensitivity =
    baseSensitivity * volatilityDamping * momentumBoost;

  // 3. 时变漏斗形上下界计算
  const baseUpperA = Math.log((1 - beta) / alpha);
  const baseLowerB = Math.log(beta / (1 - alpha));

  let upperThresholdA = baseUpperA;
  if (
    currentRound > profile.minExplorationRounds &&
    maxRounds > profile.minExplorationRounds
  ) {
    const progress =
      (currentRound - profile.minExplorationRounds) /
      Math.max(1, maxRounds - profile.minExplorationRounds);
    const funnelFactor = Math.max(
      0.55,
      1.0 - profile.funnelDecayRate * Math.pow(progress, 1.5)
    );
    upperThresholdA = baseUpperA * funnelFactor;
  }

  upperThresholdA = Number(upperThresholdA.toFixed(4));
  const lowerThresholdB = Number(baseLowerB.toFixed(4));

  // 4. 更新累积对数似然比
  const delta = combinedScore - neutral;
  const logLikelihoodRatio = Number(
    (options.previousLogLikelihoodRatio + delta * effectiveSensitivity).toFixed(
      4
    )
  );

  // 5. 严格按优先级判定决策状态
  let decisionState: SprtGovernorState['decisionState'] = 'continue';
  let statusDescription = `Round ${currentRound}/${maxRounds}: LLR=${logLikelihoodRatio.toFixed(2)} within [${lowerThresholdB.toFixed(2)}, ${upperThresholdA.toFixed(2)}].`;

  if (logLikelihoodRatio <= lowerThresholdB) {
    decisionState = 'deadlock_escalation';
    statusDescription = `Round ${currentRound}/${maxRounds}: LLR=${logLikelihoodRatio.toFixed(2)} <= B(${lowerThresholdB.toFixed(2)}), deadlock escalation triggered.`;
  } else if (options.hasUnverifiedCriticalDispute) {
    // 优先级 1：未验证关键争议硬门禁拦截
    decisionState = 'continue';
    statusDescription = `Round ${currentRound}/${maxRounds}: Blocked Early Exit due to unverified critical dispute (hasUnverifiedCriticalDispute=true).`;
  } else if (currentRound < profile.minExplorationRounds) {
    // 优先级 2：探索期保护门控 Warm-up Guard 拦截
    decisionState = 'continue';
    statusDescription = `Round ${currentRound}/${maxRounds}: Warm-up Guard active (minExplorationRounds=${profile.minExplorationRounds}), holding Early Exit.`;
  } else if (logLikelihoodRatio >= upperThresholdA) {
    // 优先级 3：达成共识触发早停
    decisionState = 'early_exit';
    statusDescription = `Round ${currentRound}/${maxRounds}: LLR=${logLikelihoodRatio.toFixed(2)} >= Funnel A(${upperThresholdA.toFixed(2)}), consensus reached.`;
  }

  return {
    currentRound,
    maxRounds,
    logLikelihoodRatio,
    upperThresholdA,
    lowerThresholdB,
    latestAlignmentScore: combinedScore,
    decisionState,
    statusDescription,
    groundedTrueRatio: options.groundedTrueRatio,
    observationVector: {
      groundedRatio,
      semanticScore: semanticInput,
      dssScore: dssInput,
      combinedScore,
    },
  };
}
```

## 四、 基于 `node:assert/strict` 的独立回归测试脚本（`test-adaptive-sprt-governance.ts`）

可直接作为独立脚本加入 `npm run test:cogno` 执行全量断言验证：

```typescript
/**
 * test-adaptive-sprt-governance.ts
 * 使用 node:assert/strict 验证开放式议题自适应治理、三层抗辩识别、向心收缩与硬门禁保护
 */

import assert from 'node:assert/strict';
import {
  evaluateDynamicSycophancyScore,
  applySycophancyDiscountToSprt,
} from './src/services/cogno/sycophancyGovernor';
import {
  stepSprtGovernor,
  inferTopicDomainProfile,
} from './src/services/cogno/sprtComputeGovernor';
import { Agent } from './src/types';

const mockAgent = {
  id: 'agent-critic-1',
  name: 'Architecture Critic',
  modelBadge: 'Claude 3.7 Sonnet',
} as unknown as Agent;

// 用例 1：向心收缩绝不把温和正共识 (> 0.50) 翻转为负向死锁分 (< 0.50)
{
  const rawPositiveScore = 0.58;
  const gamma = 0.72;
  const calibrated = applySycophancyDiscountToSprt(rawPositiveScore, gamma, 0.50);

  assert.equal(
    calibrated > 0.50,
    true,
    `Expected calibratedScore (${calibrated}) to remain above neutral 0.50`
  );
  assert.equal(
    calibrated < rawPositiveScore,
    true,
    `Expected calibratedScore (${calibrated}) to be shrunk below raw score (${rawPositiveScore})`
  );
  console.log('✅ [Test 1 Passed] Neutral-centered shrinkage preserves positive sign:', calibrated);
}

// 用例 2：非代码/开放议题下的逻辑权衡与量化实证抗辩应正确抵扣 DSS，不误判为投降
{
  const analyticalReply =
    '您说得对，冷启动成本确实关键。但需要考虑的是，权衡来看补贴供给侧的边际成本比需求侧低 35%，前提条件是满足：1. 首月留存率 > 40%；2. 商业闭环周期控制在 60 天内。';

  const evalResult = evaluateDynamicSycophancyScore(mockAgent, analyticalReply, true);

  assert.equal(
    evalResult.dss < 0.22,
    true,
    `Expected low DSS (< 0.22) for analytical defense, got ${evalResult.dss}`
  );
  assert.equal(
    evalResult.surrenderDetected,
    false,
    'Analytical defense with metrics and structured points must not trigger surrenderDetected'
  );
  console.log('✅ [Test 2 Passed] Domain-agnostic analytical defense recognized:', {
    dss: evalResult.dss,
    gamma: evalResult.discountFactorGamma,
  });
}

// 用例 3：Warm-up Guard 与 hasUnverifiedCriticalDispute 硬门禁必须在高分下拦截早停
{
  const openProfile = inferTopicDomainProfile('讨论社区产品增长策略与商业化定位');
  assert.equal(openProfile.domainType, 'open_ended_general');
  assert.equal(openProfile.minExplorationRounds, 2);

  // 3a. 第 1 轮即便得分极高，Warm-up Guard 也必须拦截 early_exit
  const round1 = stepSprtGovernor({
    currentRound: 1,
    maxRounds: 6,
    previousLogLikelihoodRatio: 2.5,
    roundAlignmentScore: 0.95,
    topicProfile: openProfile,
  });
  assert.equal(
    round1.decisionState,
    'continue',
    'Round 1 in open-ended topic must be held by Warm-up Guard'
  );

  // 3b. 第 3 轮满足轮次且 LLR 超上界，但存在未验证关键争议 (hasUnverifiedCriticalDispute=true)，必须拦截
  const round3WithDispute = stepSprtGovernor({
    currentRound: 3,
    maxRounds: 6,
    previousLogLikelihoodRatio: 3.2,
    roundAlignmentScore: 0.90,
    hasUnverifiedCriticalDispute: true,
    topicProfile: openProfile,
  });
  assert.equal(
    round3WithDispute.decisionState,
    'continue',
    'hasUnverifiedCriticalDispute=true must strictly block early_exit'
  );
  console.log('✅ [Test 3 Passed] Warm-up Guard & hasUnverifiedCriticalDispute hard gate verified.');
}

// 用例 4：开放式议题温和正共识 (0.56 -> 0.65) 在无物理接地 (groundedTrueRatio=0) 下通过时变漏斗平滑收敛
{
  const openProfile = inferTopicDomainProfile('产品长期用户体验与社区激励机制设计');
  const rawScores = [0.56, 0.59, 0.62, 0.64, 0.65];
  const history: number[] = [];
  let llr = 0;
  let finalState = stepSprtGovernor({
    currentRound: 1,
    maxRounds: 6,
    previousLogLikelihoodRatio: 0,
    roundAlignmentScore: 0.5,
  });

  for (let i = 0; i < rawScores.length; i++) {
    const calibrated = applySycophancyDiscountToSprt(
      rawScores[i],
      0.90,
      openProfile.neutralThreshold
    );
    finalState = stepSprtGovernor({
      currentRound: i + 1,
      maxRounds: 6,
      previousLogLikelihoodRatio: llr,
      roundAlignmentScore: calibrated,
      groundedTrueRatio: 0,
      topicProfile: openProfile,
      scoreHistory: history,
    });
    llr = finalState.logLikelihoodRatio;
    history.push( calibrated );
  }

  assert.equal(
    finalState.decisionState,
    'early_exit',
    `Expected open-ended moderate consensus to converge via funnel bound by Round 5, got ${finalState.decisionState} (LLR=${finalState.logLikelihoodRatio}, A=${finalState.upperThresholdA})`
  );
  console.log('✅ [Test 4 Passed] Funnel boundary converged smoothly on Round 5:', {
    llr: finalState.logLikelihoodRatio,
    upperThresholdA: finalState.upperThresholdA,
  });
}

console.log('🎉 All 4 adaptive governance regression tests passed!');
```
