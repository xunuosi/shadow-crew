/**
 * Agent 运行时预算与循环收敛策略
 *
 * 目标：让用户在「每个 Agent 的身份配置」里直接控制
 * 1. 单轮输出 Token 预算（回答长度与消耗速度）
 * 2. 协同链最大轮次（防止 A ↔ B 无限互相 @）
 * 3. 阶段契约 Self-Refine 纠错次数（防止无限自我纠错）
 * 4. 是否允许该 Agent 主动 @ 其他 Agent 接力
 * 5. 简洁回答模式（简单问答/修复不再长篇铺陈）
 * 6. 流式吐字间隔（仅影响前端渲染节奏，不改变模型计费）
 *
 * 本文件只做策略归一化与宿主侧硬上限收敛，不依赖 App/UI。
 */

import type { Agent, AgentRuntimePolicy } from '../types';
import { STAGE_CONTRACT_MAX_RETRIES } from './cogno/stageContractGate';

/** 协同链系统级硬上限：即使配置更大也不得突破 */
export const MAX_ALLOWED_CASCADE_HOPS = 12;

/** 流式渲染合并上限（毫秒）：避免配置成超大值导致输出看起来卡死 */
export const MAX_ALLOWED_STREAM_FLUSH_INTERVAL_MS = 500;

export const DEFAULT_AGENT_RUNTIME_POLICY: Required<AgentRuntimePolicy> = {
  maxOutputTokens: 0,
  cascadeMaxHops: MAX_ALLOWED_CASCADE_HOPS,
  maxCorrectionRetries: STAGE_CONTRACT_MAX_RETRIES,
  autoRelay: true,
  conciseReplies: false,
  streamFlushIntervalMs: 40,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

/**
 * 将任意持久化配置归一化为合法的运行时策略。
 * 显式设置为 0 的 maxOutputTokens 表示不限制；其余数值均会被夹到安全区间。
 */
export function normalizeAgentRuntimePolicy(
  policy?: Partial<AgentRuntimePolicy> | null
): Required<AgentRuntimePolicy> {
  const raw = policy || {};
  return {
    maxOutputTokens: clampInt(raw.maxOutputTokens, 0, 32768, DEFAULT_AGENT_RUNTIME_POLICY.maxOutputTokens),
    cascadeMaxHops: clampInt(raw.cascadeMaxHops, 1, MAX_ALLOWED_CASCADE_HOPS, DEFAULT_AGENT_RUNTIME_POLICY.cascadeMaxHops),
    maxCorrectionRetries: clampInt(
      raw.maxCorrectionRetries,
      0,
      STAGE_CONTRACT_MAX_RETRIES,
      DEFAULT_AGENT_RUNTIME_POLICY.maxCorrectionRetries
    ),
    autoRelay: raw.autoRelay !== false,
    conciseReplies: raw.conciseReplies === true,
    streamFlushIntervalMs: clampInt(
      raw.streamFlushIntervalMs,
      0,
      MAX_ALLOWED_STREAM_FLUSH_INTERVAL_MS,
      DEFAULT_AGENT_RUNTIME_POLICY.streamFlushIntervalMs
    ),
  };
}

/** 判断新旧策略是否完全一致（用于持久化迁移判定，避免无意义的写库） */
export function isSameAgentRuntimePolicy(
  a: Partial<AgentRuntimePolicy> | null | undefined,
  b: Required<AgentRuntimePolicy>
): boolean {
  if (!a) return false;
  return (
    a.maxOutputTokens === b.maxOutputTokens &&
    a.cascadeMaxHops === b.cascadeMaxHops &&
    a.maxCorrectionRetries === b.maxCorrectionRetries &&
    (a.autoRelay !== false) === b.autoRelay &&
    (a.conciseReplies === true) === b.conciseReplies &&
    a.streamFlushIntervalMs === b.streamFlushIntervalMs
  );
}

/** 读取 Agent 的有效策略（缺失时返回默认值，不做隐式猜测） */
export function resolveEffectiveRuntimePolicy(
  agent?: Pick<Agent, 'runtimePolicy'> | null
): Required<AgentRuntimePolicy> {
  return normalizeAgentRuntimePolicy(agent?.runtimePolicy);
}

/**
 * 计算一组 Agent 参与协同时的有效最大轮次：取所有参与者配置的最小值。
 * 例如某 Agent 设为 2 轮，则整个房间的协同链最多 2 跳，避免被其他 Agent 拖入长循环。
 */
export function resolveCascadeMaxHops(
  agents: Array<Pick<Agent, 'runtimePolicy'>> | null | undefined
): number {
  if (!agents || agents.length === 0) return DEFAULT_AGENT_RUNTIME_POLICY.cascadeMaxHops;
  return agents.reduce(
    (min, agent) => Math.min(min, resolveEffectiveRuntimePolicy(agent).cascadeMaxHops),
    MAX_ALLOWED_CASCADE_HOPS
  );
}

/** 当前 Agent 允许的 Self-Refine 纠错次数（0 表示校验失败后直接升级人工） */
export function resolveCorrectionRetryLimit(
  agent?: Pick<Agent, 'runtimePolicy'> | null
): number {
  return resolveEffectiveRuntimePolicy(agent).maxCorrectionRetries;
}

/**
 * 生成注入到 Agent 系统人设中的运行时约束。
 * 收敛约束始终输出（抑制无意义接话）；token 预算、简洁模式、
 * 接力禁用等仅在用户显式配置时追加。
 */
export function buildRuntimePolicyDirective(
  agent?: Pick<Agent, 'runtimePolicy'> | null
): string {
  const policy = resolveEffectiveRuntimePolicy(agent);
  const lines: string[] = [];

  if (policy.maxOutputTokens > 0) {
    lines.push(
      `• 单轮输出预算：约 ${policy.maxOutputTokens} tokens 以内。优先给出【结论 + 最小可执行改动/命令】，超预算时立即收敛，禁止用无关背景铺垫凑长度。`
    );
  }

  if (policy.conciseReplies) {
    lines.push(
      '• 简洁模式：只回答当前问题。禁止复述需求、禁止罗列未要求的多种方案、禁止自我评价与客套收尾；简单修复直接给 diff/命令与验证方法。'
    );
  }

  if (!policy.autoRelay) {
    lines.push(
      '• 接力禁用：本轮回答结束后必须立即停止，不得 @ 任何其他 Agent；由宿主直接结束本轮协作。'
    );
  } else {
    lines.push(
      '• 收敛约束：仅当本轮产生可验证的新增事实、代码改动或明确风险时才 @ 下一位 Agent；若没有新增价值，直接结束回答，不要为了“接话”而点名。'
    );
  }

  if (lines.length === 0) return '';
  return `【宿主运行时预算与循环收敛约束 (Runtime Budget & Convergence)】:\n${lines.join('\n')}`;
}
