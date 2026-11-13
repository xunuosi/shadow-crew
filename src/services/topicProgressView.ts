import type {
  ActiveAgentExecution,
  GameTheoreticStage,
  GameRolesConfig,
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
  | 'arbitration'
  | 'execution';

export type TopicProgressNodeState =
  | 'pending'   // 尚未到达
  | 'queued'    // 轮到自己但当前没有活跃执行（接力间隙）
  | 'active'    // 正在推演
  | 'done'      // 已完成
  | 'bypassed'  // 按策略旁路（如贝叶斯快速通道跳过红队）
  | 'absent'    // 应参与但缺席，已越过该阶段
  | 'failed';   // 该阶段熔断

export type TopicProgressMode = 'game_theoretic' | 'standard' | 'dm_duel';

export type TopicProgressPhase =
  | 'stage'        // 常规五阶段推演
  | 'concurrence'  // 仲裁后的全员无异议征询
  | 'execution'    // 定案后的工作区落地执行
  | 'blocked'      // 异议挂起 / 门禁拦截，等待人工裁决
  | 'terminal'     // 已定案 / 已落地
  | 'failed';      // 阶段熔断 / 落地失败

export interface TopicProgressNode {
  key: TopicProgressNodeKey;
  label: string;
  shortLabel: string;
  icon: string;
  action: string;
  state: TopicProgressNodeState;
  actors: string[];
}

export interface TopicActorProgress {
  done: number;
  total: number;
}

export interface TopicProgressView {
  mode: TopicProgressMode;
  phase: TopicProgressPhase;
  nodes: TopicProgressNode[];
  /** 当前（或熔断）节点在 nodes 中的 1-based 序号 */
  stepIndex: number;
  stepTotal: number;
  activeKeys: TopicProgressNodeKey[];
  activeActors: string[];
  /** 当前活跃节点最早一次执行/占位卡发起的时间戳 */
  activeStartedAt?: number;
  /** 当前活跃执行最近一次 ACP 思考心跳时间戳（取并行执行中的最大值） */
  lastHeartbeatAt?: number;
  /** 当前阶段多角色回复进度（仅当该阶段存在 2 个及以上指派角色时提供） */
  actorProgress?: TopicActorProgress;
  isActive: boolean;
  isTerminal: boolean;
  isFailed: boolean;
  /** 异议挂起 / 门禁拦截 / 等待人工介入 */
  isBlocked: boolean;
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
  execution: { label: '落地执行', shortLabel: '落地', icon: '⚙️', action: '合入工作区变更' },
};

/** 当前阶段对应的指派角色名单（用于多角色回复计数） */
const ROLE_ROSTER: Record<
  Exclude<TopicProgressNodeKey, 'decomposition' | 'execution'>,
  (roles: GameRolesConfig | undefined) => string[]
> = {
  proposal: (roles) => roles?.proposers ?? [],
  challenge: (roles) => roles?.challengers ?? [],
  verification: (roles) => roles?.verifiers ?? [],
  defense: (roles) => roles?.proposers ?? [],
  arbitration: (roles) => roles?.arbiters ?? [],
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

function nodeStageRank(node: TopicProgressNode): number {
  if (node.key === 'execution') return 99;
  return STAGE_RANK[node.key];
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

function earliestStart(
  pendingMessages: Message[],
  executions: ActiveAgentExecution[],
  extra?: number
): number | undefined {
  const candidates = [
    ...pendingMessages.map((message) => message.startedAt),
    ...executions.map((execution) => execution.startedAt),
    extra,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

function latestHeartbeat(executions: ActiveAgentExecution[]): number | undefined {
  let latest: number | undefined;
  for (const execution of executions) {
    const value = execution.lastHeartbeatAt;
    if (typeof value === 'number' && Number.isFinite(value)) {
      latest = latest === undefined ? value : Math.max(latest, value);
    }
  }
  return latest;
}

function actorText(actors: string[], action: string): string {
  if (actors.length === 0) return '处理中';
  if (actors.length === 1) return `${actors[0]} 正在${action}`;
  return `${actors[0]} 等 ${actors.length} 位角色并行推进`;
}

function compactActorText(actors: string[], fallback: string): string {
  if (actors.length === 0) return fallback;
  if (actors.length === 1) return actors[0];
  return `${actors[0]} 等 ${actors.length} 人`;
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
    if (nodeStageRank(nodes[i]) > rank) return i;
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

function collectActiveState(messages: Message[], executions: ActiveAgentExecution[]) {
  const pendingMessages = messages.filter((message) => message.isPending);
  const activeActors = uniqueNames([
    ...pendingMessages.map((message) => message.authorName),
    ...executions.map((execution) => execution.agentName),
  ]);
  return {
    pendingMessages,
    activeActors,
    isRunning: pendingMessages.length > 0 || executions.length > 0,
    activeStartedAt: earliestStart(pendingMessages, executions),
    lastHeartbeatAt: latestHeartbeat(executions),
  };
}

// ==================== 标准协同模式 ====================

function buildStandardProgressView(
  topic: TopicMessageData,
  messages: Message[],
  executions: ActiveAgentExecution[]
): TopicProgressView {
  const active = collectActiveState(messages, executions);
  const isTerminal = topic.status === 'resolved' && !active.isRunning;
  const hasEvidence =
    active.isRunning || topic.status === 'investigating' || messages.length > 0;

  let headline: string;
  let compactHeadline: string;

  if (isTerminal) {
    headline = '✅ 协同讨论已定案';
    compactHeadline = '✅ 已定案';
  } else if (active.isRunning) {
    const detail = actorText(active.activeActors, '回复');
    headline = `💬 协同讨论 · ${detail}`;
    compactHeadline = `💬 ${compactActorText(active.activeActors, '协同讨论中')}`;
  } else if (hasEvidence) {
    headline = '💬 协同讨论 · 等待接力';
    compactHeadline = '💬 等待接力';
  } else {
    headline = '💬 协同讨论 · 待启动';
    compactHeadline = '💬 待启动';
  }

  return {
    mode: 'standard',
    phase: isTerminal ? 'terminal' : 'stage',
    nodes: [],
    stepIndex: 0,
    stepTotal: 0,
    activeKeys: [],
    activeActors: active.activeActors,
    activeStartedAt: active.activeStartedAt,
    lastHeartbeatAt: active.lastHeartbeatAt,
    isActive: active.isRunning,
    isTerminal,
    isFailed: false,
    isBlocked: false,
    headline,
    compactHeadline,
  };
}

// ==================== DM 双人博弈 ====================

function buildDmDuelProgressView(
  topic: TopicMessageData,
  messages: Message[],
  executions: ActiveAgentExecution[]
): TopicProgressView {
  const active = collectActiveState(messages, executions);
  const isTerminal = topic.status === 'resolved' && !active.isRunning;
  const agentName =
    executions[0]?.agentName ??
    messages.find((message) => message.isAgent && message.authorId === topic.dmAgentId)?.authorName ??
    'Agent';
  const duel = topic.duelRoles;
  const proposerLabel = duel?.proposer === 'human' ? '👤 人类' : `🤖 ${agentName}`;
  const challengerLabel = duel?.challenger === 'human' ? '👤 人类' : `🤖 ${agentName}`;
  const agentAction = duel?.proposer === 'human' ? '质询' : '立论';

  let headline: string;
  let compactHeadline: string;

  if (isTerminal) {
    headline = `✅ 双方博弈已定案 · ${proposerLabel} 提案 / ${challengerLabel} 对抗`;
    compactHeadline = '✅ 双方博弈已定案';
  } else if (active.isRunning) {
    headline = `⚔️ 双方博弈 · ${actorText(active.activeActors, agentAction)}`;
    compactHeadline = `⚔️ ${compactActorText(active.activeActors, '双方博弈中')}`;
  } else {
    headline = `⚔️ 双方博弈 · ${proposerLabel} 提案 / ${challengerLabel} 对抗`;
    compactHeadline = '⚔️ 双方博弈 · 等待发言';
  }

  return {
    mode: 'dm_duel',
    phase: isTerminal ? 'terminal' : 'stage',
    nodes: [],
    stepIndex: 0,
    stepTotal: 0,
    activeKeys: [],
    activeActors: active.activeActors,
    activeStartedAt: active.activeStartedAt,
    lastHeartbeatAt: active.lastHeartbeatAt,
    isActive: active.isRunning,
    isTerminal,
    isFailed: false,
    isBlocked: false,
    headline,
    compactHeadline,
  };
}

// ==================== Channel 4+1 博弈推演 ====================

function buildGameTheoreticProgressView(
  topic: TopicMessageData,
  messages: Message[],
  executions: ActiveAgentExecution[]
): TopicProgressView {
  const state = topic.gameTheoreticState;
  const rawStage: GameTheoreticStage =
    topic.gameStage ?? state?.currentStage ?? 'proposal';
  const modularState = state?.modularState ?? state?.cognoNexus?.modularState;
  const executionStatus = state?.executionStatus;
  const executionSummary = state?.executionSummary?.trim();
  const resolved = topic.status === 'resolved' || rawStage === 'concluded';

  const stageFailed = rawStage === 'stageFailed';
  const executionActive =
    !stageFailed &&
    resolved &&
    (executionStatus === 'queued' || executionStatus === 'running');
  const executionFailed =
    !stageFailed && resolved && executionStatus === 'failed';
  const executionFinished =
    resolved &&
    (executionStatus === 'completed' || executionStatus === 'applied');

  const isFailed = stageFailed || executionFailed;
  const isTerminal = !isFailed && resolved && !executionActive;

  const includeDecomposition =
    Boolean(modularState?.enabled) || rawStage === 'decomposition';
  const includeVerification =
    Boolean(topic.gameRoles?.verifiers?.length) || rawStage === 'verification';
  const includeExecution =
    resolved && Boolean(executionStatus) && executionStatus !== 'idle';

  const stageKeys: TopicProgressNodeKey[] = [
    ...(includeDecomposition ? (['decomposition'] as const) : []),
    'proposal',
    'challenge',
    ...(includeVerification ? (['verification'] as const) : []),
    'defense',
    'arbitration',
  ];
  const keys: TopicProgressNodeKey[] = [
    ...stageKeys,
    ...(includeExecution ? (['execution'] as const) : []),
  ];

  const nodes: TopicProgressNode[] = keys.map((key) => ({
    key,
    ...NODE_META[key],
    state: 'pending',
    actors: [],
  }));

  const executionIndex = includeExecution ? nodes.length - 1 : -1;

  /** 当前生效节点下标（失败定位 / 执行节点 / 当前阶段） */
  const effectiveIndex = executionActive || executionFailed
    ? executionIndex
    : isFailed
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
  const currentKey = executionActive || executionFailed
    ? 'execution'
    : isFailed
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
  const activeStartedAt = earliestStart(
    activePending,
    executions,
    executionActive ? state?.executionStartedAt : undefined
  );
  const lastHeartbeatAt = latestHeartbeat(executions);

  // —— 无异议征询子阶段 ——
  const concurrence = state?.concurrenceState;
  const concurrenceItems = concurrence?.items ?? [];
  const pendingConcurrence = concurrenceItems.filter((item) => item.status === 'pending');
  const repliedConcurrence = concurrenceItems.filter((item) => item.status !== 'pending');
  const nonConcurred = concurrenceItems.filter((item) => item.status !== 'concurred');
  const isConcurrencePhase =
    !resolved &&
    !isFailed &&
    rawStage === 'arbitration' &&
    concurrenceItems.length > 0;
  const gateBlocked = messages.some((message) => message.agentBadge === 'Gate Blocked');
  const isBlocked =
    isConcurrencePhase &&
    pendingConcurrence.length === 0 &&
    (nonConcurred.length > 0 || gateBlocked);

  const hasProgressEvidence =
    isRunning ||
    executionActive ||
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
    if (node.key === 'execution') {
      node.state = executionFailed ? 'failed' : executionActive ? 'active' : 'done';
      return;
    }
    if (isTerminal || executionActive) {
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

  const activeKeys = nodes.filter((node) => node.state === 'active').map((node) => node.key);
  for (const node of nodes) {
    if (node.state === 'active') node.actors = activeActors;
  }

  // —— 多角色回复计数（当前阶段，模块内） ——
  const currentStageKey =
    !isTerminal && !isFailed && !executionActive && !isConcurrencePhase
      ? stageToNodeKey(rawStage)
      : null;
  let actorProgress: TopicActorProgress | undefined;
  if (currentStageKey && currentStageKey !== 'decomposition' && currentStageKey !== 'execution') {
    const roster = ROLE_ROSTER[currentStageKey](topic.gameRoles);
    if (roster.length > 1) {
      const moduleId = modularState?.enabled ? modularState.activeModuleId : undefined;
      const repliedIds = new Set(
        messages
          .filter(
            (message) =>
              message.gameStage === currentStageKey &&
              !message.isPending &&
              (!moduleId || message.moduleId === moduleId)
          )
          .map((message) => message.authorId)
      );
      const done = roster.filter((agentId) => repliedIds.has(agentId)).length;
      actorProgress = { done: Math.min(done, roster.length), total: roster.length };
    }
  }

  // —— 模块标签 ——
  let moduleLabel: string | undefined;
  if (modularState?.enabled && modularState.activeModuleId && modularState.modules.length > 0) {
    const index = modularState.modules.findIndex(
      (module) => module.moduleId === modularState.activeModuleId
    );
    if (index >= 0) {
      moduleLabel = `模块 ${index + 1}/${modularState.modules.length}：${modularState.modules[index].title}`;
    }
  }

  // —— 文案 ——
  const activeNode = nodes[Math.min(effectiveIndex, nodes.length - 1)];
  const stepIndex = isTerminal || executionActive || executionFailed
    ? nodes.length
    : Math.min(effectiveIndex + 1, nodes.length);
  const stepTotal = nodes.length;

  let headline: string;
  let compactHeadline: string;
  let failureText: string | undefined;

  if (isFailed) {
    if (executionFailed) {
      failureText = executionSummary || '工作区变更合入失败';
      headline = `❌ 落地失败 · ${failureText}`;
      compactHeadline = '❌ 落地失败';
    } else {
      failureText = state?.quorumAlert;
      headline = `⚠️ ${activeNode.icon} ${activeNode.label}熔断 · 等待人工介入`;
      compactHeadline = `⚠️ ${activeNode.shortLabel}熔断 · 待人工`;
    }
  } else if (executionActive) {
    const completed = modularState?.executionCompletedCount ?? 0;
    const moduleTotal = modularState?.modules.length ?? 0;
    headline = `⚙️ 落地执行 · ${executionSummary || '正在合入工作区变更'}`;
    compactHeadline =
      moduleTotal > 0 ? `⚙️ 落地 ${completed}/${moduleTotal}` : '⚙️ 落地执行中';
  } else if (isTerminal) {
    if (executionStatus === 'applied') {
      headline = '✅ 已合入工作区';
      compactHeadline = '✅ 已落地';
    } else if (executionFinished) {
      headline = '✅ 落地执行完成 · 待合入工作区';
      compactHeadline = '✅ 待合入';
    } else {
      headline = `✅ 推演已定案 · ${stepTotal}/${stepTotal} 阶段完成`;
      compactHeadline = `✅ 已定案 · ${stepTotal}/${stepTotal}`;
    }
  } else if (isBlocked) {
    if (gateBlocked) {
      headline = '⚠️ 一致性门禁拦截 · 等待人工豁免';
      compactHeadline = '⚠️ 门禁拦截 · 待人工';
    } else {
      headline = '⚠️ 无异议未达成 · 等待人工裁决';
      compactHeadline = '⚠️ 异议挂起 · 待人工';
    }
  } else if (isConcurrencePhase) {
    const done = repliedConcurrence.length;
    const total = concurrenceItems.length;
    if (pendingConcurrence.length > 0) {
      const currentActor =
        activeActors[0] ?? pendingConcurrence[0]?.agentName ?? '参研角色';
      headline = isRunning
        ? `🤝 无异议征询 ${done}/${total} · ${currentActor} 正在复核`
        : `🤝 无异议征询 ${done}/${total} · 等待下一位角色复核`;
      compactHeadline = `🤝 征询 ${done}/${total} · ${currentActor}`;
    } else {
      headline = '⚖️ 无异议已达成 · 等待终局落槌';
      compactHeadline = '⚖️ 等待终局落槌';
    }
  } else if (activeNode.state === 'active') {
    const prefix = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal})`;
    headline = `${prefix} · ${actorText(activeActors, activeNode.action)}`;
    compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · ${compactActorText(activeActors, '处理中')}`;
    if (actorProgress) {
      headline += ` · 已回复 ${actorProgress.done}/${actorProgress.total}`;
    }
  } else if (activeNode.state === 'queued') {
    headline = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal}) · 等待接力`;
    compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · 等待接力`;
    if (actorProgress) {
      headline += ` · 已回复 ${actorProgress.done}/${actorProgress.total}`;
    }
  } else {
    headline = `${activeNode.icon} ${activeNode.label} (${stepIndex}/${stepTotal}) · 待启动`;
    compactHeadline = `${stepIndex}/${stepTotal} ${activeNode.shortLabel} · 待启动`;
  }

  return {
    mode: 'game_theoretic',
    phase: isFailed
      ? 'failed'
      : executionActive
        ? 'execution'
        : isTerminal
          ? 'terminal'
          : isBlocked
            ? 'blocked'
            : isConcurrencePhase
              ? 'concurrence'
              : 'stage',
    nodes,
    stepIndex,
    stepTotal,
    activeKeys,
    activeActors,
    activeStartedAt,
    lastHeartbeatAt,
    actorProgress,
    isActive: executionActive || (!isFailed && !isBlocked && isRunning),
    isTerminal,
    isFailed,
    isBlocked,
    failureText,
    moduleLabel,
    headline,
    compactHeadline,
  };
}

/**
 * 从现有议题状态推导只读进度视图。
 * - 普通协同模式：显示活跃回复者与耗时；
 * - DM 双方博弈：显示双方角色与当前发言方；
 * - Channel 博弈推演：显示阶段节点、无异议征询、落地执行与熔断状态。
 */
export function deriveTopicProgressView(
  input: DeriveTopicProgressInput
): TopicProgressView | null {
  const { topic, messages, executions = [] } = input;
  if (!topic) return null;

  if (topic.discussionMode === 'game_theoretic') {
    return topic.scopeType === 'dm'
      ? buildDmDuelProgressView(topic, messages, executions)
      : buildGameTheoreticProgressView(topic, messages, executions);
  }

  // DM 标准私聊不展示协同进度条，避免把 1:1 对话误读为多 Agent 编排
  if (topic.scopeType === 'dm') return null;
  return buildStandardProgressView(topic, messages, executions);
}

/** 进度条的语义签名，用于 React.memo 精确跳过无关重渲染 */
export function topicProgressViewSignature(view: TopicProgressView | null): string {
  if (!view) return '';
  return [
    view.mode,
    view.phase,
    view.stepIndex,
    view.stepTotal,
    view.isActive ? 'a' : '-',
    view.isTerminal ? 't' : '-',
    view.isFailed ? 'f' : '-',
    view.isBlocked ? 'b' : '-',
    view.activeStartedAt ?? '',
    view.lastHeartbeatAt ?? '',
    view.actorProgress ? `${view.actorProgress.done}/${view.actorProgress.total}` : '',
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

/** 心跳停滞阈值：Rust 端约每 4s 发一次心跳，90s 无心跳视为疑似停滞 */
export const PROGRESS_STALL_THRESHOLD_MS = 90_000;

export function isProgressStalled(
  view: TopicProgressView,
  now: number,
  thresholdMs: number = PROGRESS_STALL_THRESHOLD_MS
): boolean {
  return (
    view.isActive &&
    typeof view.lastHeartbeatAt === 'number' &&
    now - view.lastHeartbeatAt > thresholdMs
  );
}
