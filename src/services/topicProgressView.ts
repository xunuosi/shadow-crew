import type {
  ActiveAgentExecution,
  GameTheoreticStage,
  Message,
  TopicMessageData,
} from '../types';

/**
 * 议题推演进度只读视图。
 *
 * 设计边界：
 * - 纯函数，只消费已存在于 React/SQLite 中的 topic / messages / executions，
 *   不订阅任何新增 ACP 事件，不触发任何后端调用，因此不改变现有处理性能。
 * - 不做「下一步是谁」「预计剩余时间」「Self-Refine 重试次数」等无法从现有状态
 *   可靠推导的信息，避免展示猜测性结论。
 */

export type TopicProgressNodeKey =
  | 'decomposition'
  | 'proposal'
  | 'challenge'
  | 'verification'
  | 'defense'
  | 'arbitration';

export type TopicProgressNodeState =
  | 'pending'   // 尚未到达
  | 'queued'    // 轮到自己但当前没有活跃执行（接力间隙）
  | 'active'    // 正在推演
  | 'done'      // 已完成
  | 'bypassed'  // 按策略旁路（如贝叶斯快速通道跳过红队）
  | 'absent'    // 应参与但缺席，已越过该阶段
  | 'failed';   // 该阶段熔断

export interface TopicProgressNode {
  key: TopicProgressNodeKey;
  label: string;
  shortLabel: string;
  icon: string;
  action: string;
  state: TopicProgressNodeState;
  actors: string[];
}

export interface TopicProgressView {
  nodes: TopicProgressNode[];
  /** 当前（或熔断）节点在 nodes 中的 1-based 序号 */
  stepIndex: number;
  stepTotal: number;
  activeKeys: TopicProgressNodeKey[];
  activeActors: string[];
  /** 当前活跃节点最早一次执行/占位卡发起的时间戳 */
  activeStartedAt?: number;
  isActive: boolean;
  isTerminal: boolean;
  isFailed: boolean;
  failureText?: string;
  /** 例如「模块 2/3：状态契约与类型定义」 */
  moduleLabel?: string;
  headline: string;
  compactHeadline: string;
}

interface DeriveTopicProgressInput {
  topic: TopicMessageData | null | undefined;
  messages: Message[];
  executions?: ActiveAgentExecution[];
}

const STAGE_RANK: Record<GameTheoreticStage, number> = {
  decomposition: 0,
  proposal: 1,
  challenge: 2,
  verification: 3,
  defense: 4,
  arbitration: 5,
  concluded: 6,
  stageFailed: 6,
};

const NODE_META: Record<
  TopicProgressNodeKey,
  { label: string; shortLabel: string; icon: string; action: string }
> = {
  decomposition: { label: '模块拆解', shortLabel: '拆解', icon: '🧩', action: '拆解模块拓扑' },
  proposal: { label: '提案立论', shortLabel: '提案', icon: '🏛️', action: '起草提案' },
  challenge: { label: '红队挑战', shortLabel: '挑战', icon: '⚔️', action: '执行红队压力测试' },
  verification: { label: '接地验证', shortLabel: '验证', icon: '🔍', action: '执行物理接地验证' },
  defense: { label: '答辩修正', shortLabel: '答辩', icon: '🛡️', action: '提交答辩修正' },
  arbitration: { label: '综合仲裁', shortLabel: '仲裁', icon: '⚖️', action: '综合裁定' },
};

/** 把除 concluded / stageFailed 外的阶段映射为进度节点 */
function stageToNodeKey(stage: GameTheoreticStage): TopicProgressNodeKey | null {
  switch (stage) {
    case 'decomposition':
    case 'proposal':
    case 'challenge':
    case 'verification':
    case 'defense':
    case 'arbitration':
      return stage;
    default:
      return null;
  }
}

/** 当前阶段在 nodes 中的下标；若该节点未展示（如未指派验证官），落到下一个节点 */
function resolveCurrentIndex(stage: GameTheoreticStage, nodes: TopicProgressNode[]): number {
  const directKey = stageToNodeKey(stage);
  if (directKey) {
    const direct = nodes.findIndex((node) => node.key === directKey);
    if (direct >= 0) return direct;
  }

  const rank = STAGE_RANK[stage];
  for (let i = 0; i < nodes.length; i += 1) {
    if (STAGE_RANK[nodes[i].key] > rank) return i;
  }
  return nodes.length - 1;
}

/** 阶段熔断时推断失败节点：优先使用 quorumAlert 语义，再回落到最近一条阶段消息 */
function inferFailedNodeKey(
  nodes: TopicProgressNode[],
  messages: Message[],
  quorumAlert: string | undefined
): TopicProgressNodeKey {
  const has = (key: TopicProgressNodeKey) => nodes.some((node) => node.key === key);

  const patterns: Array<[RegExp, TopicProgressNodeKey]> = [
    [/答辩|修正补丁|补丁契约/, 'defense'],
    [/接地|实证|验证/, 'verification'],
    [/红队|挑战|压测/, 'challenge'],
    [/提案|立论/, 'proposal'],
    [/拆解|模块拓扑/, 'decomposition'],
  ];

  if (quorumAlert) {
    for (const [pattern, key] of patterns) {
      if (has(key) && pattern.test(quorumAlert)) return key;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const stage = messages[i].gameStage;
    if (!stage) continue;
    const key = stageToNodeKey(stage);
    if (key && has(key)) return key;
  }

  return nodes[nodes.length - 1].key;
}

function uniqueNames(names: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * 从现有议题状态推导只读进度视图。
 * 仅对 Channel 下的博弈讨论模式生效；DM 双人博弈与普通协同模式返回 null。
 */
export function deriveTopicProgressView(
  input: DeriveTopicProgressInput
): TopicProgressView | null {
  const { topic, messages, executions = [] } = input;
  if (!topic) return null;
  if (topic.discussionMode !== 'game_theoretic') return null;
  if (topic.scopeType === 'dm') return null;

  const state = topic.gameTheoreticState;
  const rawStage: GameTheoreticStage =
    topic.gameStage ?? state?.currentStage ?? 'proposal';

  const isTerminal = rawStage === 'concluded' || topic.status === 'resolved';
  const isFailed = !isTerminal && rawStage === 'stageFailed';

  const includeDecomposition =
    Boolean(state?.modularState?.enabled) || rawStage === 'decomposition';
  const includeVerification =
    Boolean(topic.gameRoles?.verifiers?.length) || rawStage === 'verification';

  const keys: TopicProgressNodeKey[] = [
    ...(includeDecomposition ? (['decomposition'] as const) : []),
    'proposal',
    'challenge',
    ...(includeVerification ? (['verification'] as const) : []),
    'defense',
    'arbitration',
  ];

  const nodes: TopicProgressNode[] = keys.map((key) => ({
    key,
    ...NODE_META[key],
    state: 'pending',
    actors: [],
  }));

  const effectiveIndex = isFailed
    ? Math.max(
        0,
        nodes.findIndex(
          (node) => node.key === inferFailedNodeKey(nodes, messages, state?.quorumAlert)
        )
      )
    : isTerminal
      ? nodes.length
      : resolveCurrentIndex(rawStage, nodes);

  // —— 活跃执行 / 占位卡 ——
  const pendingMessages = messages.filter((message) => message.isPending);
  const currentKey = isFailed
    ? nodes[effectiveIndex]?.key
    : stageToNodeKey(rawStage);
  let activePending = currentKey
    ? pendingMessages.filter((message) => message.gameStage === currentKey)
    : [];
  // G-Frame 模块拆解阶段的占位卡沿用 proposal 标记，做一次语义兜底
  if (activePending.length === 0 && pendingMessages.length > 0) {
    activePending = pendingMessages;
  }

  const isRunning = activePending.length > 0 || executions.length > 0;

  const activeActors = uniqueNames([
    ...activePending.map((message) => message.authorName),
    ...executions.map((execution) => execution.agentName),
  ]);

  const startedAtCandidates = [
    ...activePending.map((message) => message.startedAt),
    ...executions.map((execution) => execution.startedAt),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const activeStartedAt =
    startedAtCandidates.length > 0 ? Math.min(...startedAtCandidates) : undefined;

  const hasProgressEvidence =
    isRunning ||
    Boolean(state?.targetProposalContent) ||
    Boolean(state?.targetChallengeContent) ||
    Boolean(state?.targetVerificationContent) ||
    Boolean(state?.targetDefenseContent) ||
    topic.status === 'investigating' ||
    rawStage !== 'proposal';

  // —— 逐节点状态 ——
  const isPast = (index: number) => index < effectiveIndex;

  const skipStateFor = (node: TopicProgressNode, index: number): TopicProgressNodeState | null => {
    if (node.key === 'challenge') {
      if (state?.isChallengerBypassed) return 'bypassed';
      if (state?.isChallengerResponded === false && isPast(index)) return 'absent';
    }
    if (node.key === 'verification' && state?.isVerifierResponded === false && isPast(index)) {
      return 'absent';
    }
    if (node.key === 'defense' && state?.isDefenseResponded === false && isPast(index)) {
      return 'absent';
    }
    return null;
  };

  nodes.forEach((node, index) => {
    if (isTerminal) {
      node.state = skipStateFor(node, index) ?? 'done';
      return;
    }
    if (isFailed) {
      if (index < effectiveIndex) node.state = skipStateFor(node, index) ?? 'done';
      else if (index === effectiveIndex) node.state = 'failed';
      else node.state = 'pending';
      return;
    }
    if (index < effectiveIndex) {
      node.state = skipStateFor(node, index) ?? 'done';
    } else if (index === effectiveIndex) {
      node.state = isRunning ? 'active' : hasProgressEvidence ? 'queued' : 'pending';
    } else {
      node.state = 'pending';
    }
  });

  // 活跃节点上的执行者名单
  const activeKeys = nodes.filter((node) => node.state === 'active').map((node) => node.key);
  for (const node of nodes) {
    if (node.state === 'active') node.actors = activeActors;
  }

  // —— 模块标签 ——
  const modular = state?.modularState;
  let moduleLabel: string | undefined;
  if (modular?.enabled && modular.activeModuleId && modular.modules.length > 0) {
    const index = modular.modules.findIndex(
      (module) => module.moduleId === modular.activeModuleId
    );
    if (index >= 0) {
      moduleLabel = `模块 ${index + 1}/${modular.modules.length}：${modular.modules[index].title}`;
    }
  }

  // —— 文案 ——
  const activeNode = nodes[Math.min(effectiveIndex, nodes.length - 1)];
  const stepIndex = isTerminal
    ? nodes.length
    : Math.min(effectiveIndex + 1, nodes.length);
  const stepTotal = nodes.length;

  let headline: string;
  let compactHeadline: string;

  if (isTerminal) {
    headline = `✅ 推演已定案 · ${stepTotal}/${stepTotal} 阶段完成`;
    compactHeadline = `✅ 已定案 · ${stepTotal}/${stepTotal}`;
  } else if (isFailed) {
    headline = `⚠️ ${activeNode.icon} ${activeNode.label}熔断 · 等待人工介入`;
    compactHeadline = `⚠️ ${activeNode.shortLabel}熔断 · 待人工`;
  } else if (activeNode.state === 'active') {
    const prefix = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal})`;
    if (activeActors.length === 0) {
      headline = `${prefix} · 处理中`;
      compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · 处理中`;
    } else if (activeActors.length === 1) {
      headline = `${prefix} · ${activeActors[0]} 正在${activeNode.action}`;
      compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · ${activeActors[0]}`;
    } else {
      headline = `${prefix} · ${activeActors[0]} 等 ${activeActors.length} 位角色并行推进`;
      compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · ${activeActors[0]} 等 ${activeActors.length} 人`;
    }
  } else if (activeNode.state === 'queued') {
    headline = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal}) · 等待接力`;
    compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · 等待接力`;
  } else {
    headline = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal}) · 待启动`;
    compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · 待启动`;
  }

  return {
    nodes,
    stepIndex,
    stepTotal,
    activeKeys,
    activeActors,
    activeStartedAt,
    isActive: activeKeys.length > 0,
    isTerminal,
    isFailed,
    failureText: isFailed ? state?.quorumAlert : undefined,
    moduleLabel,
    headline,
    compactHeadline,
  };
}

/** 进度条的语义签名，用于 React.memo 精确跳过无关重渲染 */
export function topicProgressViewSignature(view: TopicProgressView | null): string {
  if (!view) return '';
  return [
    view.stepIndex,
    view.stepTotal,
    view.isActive ? 'a' : '-',
    view.isTerminal ? 't' : '-',
    view.isFailed ? 'f' : '-',
    view.activeStartedAt ?? '',
    view.moduleLabel ?? '',
    view.failureText ?? '',
    view.headline,
    view.compactHeadline,
    ...view.nodes.map((node) => `${node.key}:${node.state}:${node.actors.join(',')}`),
  ].join('|');
}

/** 1s 粒度的耗时文案（≤ 59s 显示秒，之后显示分秒） */
export function formatProgressElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}
