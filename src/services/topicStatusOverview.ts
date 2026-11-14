import type {
  ActiveAgentExecution,
  Agent,
  GameRoleType,
  GameTheoreticStage,
  Message,
  TopicMessageData,
  TopicPatchDiffItem,
} from '../types';
import { isAgentOffline } from '../utils/agentRuntime';

export type TopicOverallRunState =
  | 'running'
  | 'patch_running'
  | 'concurrence'
  | 'awaiting_ruling'
  | 'resolved'
  | 'stage_failed'
  | 'idle';

export type TopicStageStepStatus =
  | 'completed'
  | 'active'
  | 'bypassed'
  | 'warning'
  | 'pending';

export interface TopicStageStepItem {
  key: string;
  label: string;
  shortLabel: string;
  status: TopicStageStepStatus;
}

export type TopicOverviewAgentRunState =
  | 'running'
  | 'streaming'
  | 'queued_elsewhere'
  | 'concurred'
  | 'objected'
  | 'completed_turn'
  | 'awaiting_turn'
  | 'standby'
  | 'offline';

export interface TopicOverviewAgentItem {
  agentId: string;
  agentName: string;
  agentHandle: string;
  agentAvatar: string;
  roleTag: string;
  roleLabel: string;
  displayTitle: string;
  runState: TopicOverviewAgentRunState;
  statusText: string;
  actionDetail?: string;
  elapsedSeconds?: number;
  messageCount: number;
  latestMessageId?: string;
  canAbort: boolean;
}

export interface TopicStatusOverviewModel {
  isTopicRunning: boolean;
  overallState: TopicOverallRunState;
  overallBadgeText: string;
  overallSummaryText: string;
  activeAgentCount: number;
  stageFlow: {
    modeLabel: string;
    currentStageLabel: string;
    completedSteps: number;
    totalSteps: number;
    roundCount: number;
    steps: TopicStageStepItem[];
  };
  reviewStats: {
    diffFileCount: number;
    additions: number;
    deletions: number;
    hasRulingDraft: boolean;
    isResolved: boolean;
    summaryText: string;
  };
  filesStats: {
    impactedFilesCount: number;
    impactedFiles: string[];
    modulesTotal: number;
    modulesFrozen: number;
    modulesRunning: number;
    summaryText: string;
  };
  terminalStats: {
    evidenceCount: number;
    confirmedCount: number;
    refutedCount: number;
    executionStatus: string;
    summaryText: string;
  };
  agentItems: TopicOverviewAgentItem[];
}

export interface BuildTopicStatusOverviewInput {
  topic: TopicMessageData;
  messages: Message[];
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  allActiveExecutions?: ActiveAgentExecution[];
  topicExecutionDiffs?: TopicPatchDiffItem[];
  now?: number;
}

const GAME_STAGE_ORDER: GameTheoreticStage[] = [
  'decomposition',
  'proposal',
  'challenge',
  'verification',
  'defense',
  'arbitration',
  'concluded',
];

function getStageOrderIndex(stage?: GameTheoreticStage): number {
  if (!stage) return GAME_STAGE_ORDER.indexOf('proposal');
  const idx = GAME_STAGE_ORDER.indexOf(stage);
  return idx === -1 ? GAME_STAGE_ORDER.indexOf('proposal') : idx;
}

function collectDedupedDiffs(
  topic: TopicMessageData,
  messages: Message[],
  providedDiffs?: TopicPatchDiffItem[]
): TopicPatchDiffItem[] {
  if (Array.isArray(providedDiffs) && providedDiffs.length > 0) {
    return providedDiffs;
  }
  if (topic.gameTheoreticState?.executionDiffs && topic.gameTheoreticState.executionDiffs.length > 0) {
    return topic.gameTheoreticState.executionDiffs;
  }
  const list: TopicPatchDiffItem[] = [];
  for (const msg of messages) {
    if (msg.diffViews && msg.diffViews.length > 0) {
      for (const diffItem of msg.diffViews) {
        if (!list.some((x) => x.filename === diffItem.filename && x.diff === diffItem.diff)) {
          list.push(diffItem);
        }
      }
    } else if (msg.diffView) {
      if (!list.some((x) => x.filename === msg.diffView!.filename && x.diff === msg.diffView!.diff)) {
        list.push(msg.diffView);
      }
    }
  }
  return list;
}

function collectImpactedFiles(
  topic: TopicMessageData,
  diffs: TopicPatchDiffItem[]
): string[] {
  const seen = new Set<string>();
  const addPath = (raw?: string) => {
    if (!raw || typeof raw !== 'string') return;
    const cleaned = raw.trim().replace(/^\.\//, '');
    if (cleaned) seen.add(cleaned);
  };

  topic.rulingRecord?.impactedFiles?.forEach(addPath);
  topic.decisionRecord?.impactedFiles?.forEach(addPath);
  topic.gameTheoreticState?.rulingDraft?.impactedFiles?.forEach(addPath);
  diffs.forEach((d) => addPath(d.filename));

  const modularState =
    topic.gameTheoreticState?.modularState ||
    topic.gameTheoreticState?.cognoNexus?.modularState;
  if (modularState?.modules) {
    for (const mod of modularState.modules) {
      mod.allowedFiles?.forEach(addPath);
      mod.executionDiffs?.forEach((d) => addPath(d.filename));
    }
  }

  return Array.from(seen);
}

function resolveStageFlow(
  topic: TopicMessageData,
  messages: Message[],
  isTopicRunning: boolean,
  isPatchRunning: boolean
): TopicStatusOverviewModel['stageFlow'] {
  const isResolved = topic.status === 'resolved' || topic.gameStage === 'concluded';
  const isDmDuel = topic.scopeType === 'dm' && topic.discussionMode === 'game_theoretic';
  const roundCount = topic.gameTheoreticState?.roundCount || 0;

  if (isDmDuel) {
    const stageIdx = isResolved ? 99 : getStageOrderIndex(topic.gameStage);
    const duelSteps: TopicStageStepItem[] = [
      {
        key: 'proposal',
        label: '🏛️ 提案立论',
        shortLabel: '立论',
        status:
          isResolved || stageIdx > getStageOrderIndex('proposal')
            ? 'completed'
            : 'active',
      },
      {
        key: 'challenge',
        label: '⚔️ 对抗质询',
        shortLabel: '质询',
        status:
          isResolved || stageIdx > getStageOrderIndex('challenge')
            ? 'completed'
            : stageIdx === getStageOrderIndex('challenge')
            ? 'active'
            : 'pending',
      },
      {
        key: 'defense',
        label: '🛡️ 提案方回应',
        shortLabel: '回应',
        status:
          isResolved || stageIdx > getStageOrderIndex('defense')
            ? 'completed'
            : stageIdx === getStageOrderIndex('defense')
            ? 'active'
            : 'pending',
      },
      {
        key: 'arbitration',
        label: '👤 人类决策',
        shortLabel: '裁决',
        status: isResolved
          ? 'completed'
          : stageIdx >= getStageOrderIndex('arbitration')
          ? 'active'
          : 'pending',
      },
    ];
    const activeStep = duelSteps.find((s) => s.status === 'active');
    return {
      modeLabel: '1v1 对弈模式',
      currentStageLabel: isResolved
        ? '✅ 已定案结束'
        : activeStep?.label || '🏛️ 对弈进行中',
      completedSteps: duelSteps.filter((s) => s.status === 'completed' || s.status === 'bypassed').length,
      totalSteps: duelSteps.length,
      roundCount,
      steps: duelSteps,
    };
  }

  if (topic.discussionMode === 'game_theoretic') {
    const gtState = topic.gameTheoreticState;
    const currentStage = topic.gameStage;
    const stageIdx = isResolved ? 99 : getStageOrderIndex(currentStage);
    const isStageFailed = currentStage === 'stageFailed';
    const hasVerifiers =
      Boolean(topic.gameRoles?.verifiers && topic.gameRoles.verifiers.length > 0) ||
      messages.some((m) => m.gameStage === 'verification');

    const proposalStatus: TopicStageStepStatus = isStageFailed && !gtState?.targetProposalMessageId
      ? 'warning'
      : isResolved || stageIdx > getStageOrderIndex('proposal')
      ? 'completed'
      : 'active';

    const pastChallenge = isResolved || stageIdx > getStageOrderIndex('challenge');
    const challengeStatus: TopicStageStepStatus =
      currentStage === 'challenge'
        ? 'active'
        : gtState?.isChallengerBypassed
        ? 'bypassed'
        : gtState?.isChallengerResponded === false && pastChallenge
        ? 'warning'
        : pastChallenge
        ? 'completed'
        : isStageFailed && Boolean(gtState?.targetProposalMessageId) && !gtState?.targetChallengeMessageId
        ? 'warning'
        : 'pending';

    const pastVerification = isResolved || stageIdx > getStageOrderIndex('verification');
    const verificationStatus: TopicStageStepStatus =
      currentStage === 'verification'
        ? 'active'
        : gtState?.isVerifierResponded === false && pastVerification
        ? 'warning'
        : pastVerification
        ? 'completed'
        : 'pending';

    const pastDefense = isResolved || stageIdx > getStageOrderIndex('defense');
    const defenseStatus: TopicStageStepStatus =
      currentStage === 'defense'
        ? 'active'
        : gtState?.isDefenseResponded === false && pastDefense
        ? 'warning'
        : pastDefense
        ? 'completed'
        : 'pending';

    const arbitrationStatus: TopicStageStepStatus = isResolved
      ? 'completed'
      : currentStage === 'arbitration'
      ? 'active'
      : 'pending';

    const steps: TopicStageStepItem[] = [
      { key: 'proposal', label: '🏛️ 方案立论', shortLabel: '立论', status: proposalStatus },
      {
        key: 'challenge',
        label: gtState?.isChallengerBypassed ? '⚡ 压测旁路' : '⚔️ 反例压测',
        shortLabel: gtState?.isChallengerBypassed ? '旁路' : '压测',
        status: challengeStatus,
      },
      ...(hasVerifiers
        ? [
            {
              key: 'verification',
              label: '🔍 接地验证',
              shortLabel: '验证',
              status: verificationStatus,
            },
          ]
        : []),
      { key: 'defense', label: '🛡️ 答辩修正', shortLabel: '答辩', status: defenseStatus },
      { key: 'arbitration', label: '⚖️ 综合仲裁', shortLabel: '仲裁', status: arbitrationStatus },
    ];

    const activeStep = steps.find((s) => s.status === 'active');
    let currentStageLabel = activeStep?.label || '🏛️ 方案立论';
    if (isResolved) {
      currentStageLabel = '✅ 仲裁定案已完成';
    } else if (isStageFailed) {
      currentStageLabel = '⚠️ 阶段推演中断';
    } else if (currentStage === 'decomposition') {
      currentStageLabel = '🧩 模块拓扑拆解';
    } else if (gtState?.concurrenceState?.isConcurrencePhaseActive) {
      currentStageLabel = '✍️ 全员无异议征询';
    }

    return {
      modeLabel: '4+1 博弈模式',
      currentStageLabel,
      completedSteps: steps.filter((s) => s.status === 'completed' || s.status === 'bypassed').length,
      totalSteps: steps.length,
      roundCount,
      steps,
    };
  }

  // Standard collaborative topic mode
  const hasMessages = messages.some((m) => m.isAgent);
  const steps: TopicStageStepItem[] = [
    { key: 'init', label: '💬 议题发起', shortLabel: '发起', status: 'completed' },
    {
      key: 'discuss',
      label: '🤝 协同研讨',
      shortLabel: '研讨',
      status: isResolved
        ? 'completed'
        : isTopicRunning || hasMessages
        ? 'active'
        : 'pending',
    },
    {
      key: 'conclude',
      label: '✅ 共识定案',
      shortLabel: '定案',
      status: isResolved ? 'completed' : isPatchRunning ? 'active' : 'pending',
    },
  ];

  return {
    modeLabel: '标准协作模式',
    currentStageLabel: isResolved
      ? '✅ 已达成共识'
      : isTopicRunning
      ? '🔄 协作推演中'
      : hasMessages
      ? '💬 等待继续讨论或定案'
      : '⚪ 等待召唤 Agent 启动',
    completedSteps: steps.filter((s) => s.status === 'completed').length,
    totalSteps: steps.length,
    roundCount,
    steps,
  };
}

function resolveAgentRolesInTopic(
  topic: TopicMessageData,
  agentId: string
): { roleTag: string; roleLabel: string; sortPriority: number } {
  const isDmDuel = topic.scopeType === 'dm' && topic.discussionMode === 'game_theoretic';
  if (isDmDuel) {
    return { roleTag: 'duel', roleLabel: 'DM 对弈方', sortPriority: 1 };
  }

  const tags: string[] = [];
  const labels: string[] = [];
  let minPriority = 99;

  if (topic.discussionMode === 'game_theoretic' && topic.gameRoles) {
    if (topic.gameRoles.proposers?.includes(agentId)) {
      tags.push('proposal');
      labels.push('提案官');
      minPriority = Math.min(minPriority, 1);
    }
    if (topic.gameRoles.challengers?.includes(agentId)) {
      tags.push('challenge');
      labels.push('红队对抗');
      minPriority = Math.min(minPriority, 2);
    }
    if (topic.gameRoles.verifiers?.includes(agentId)) {
      tags.push('verification');
      labels.push('接地验证');
      minPriority = Math.min(minPriority, 3);
    }
    if (topic.gameRoles.arbiters?.includes(agentId)) {
      tags.push('arbitration');
      labels.push('综合仲裁');
      minPriority = Math.min(minPriority, 4);
    }
  }

  const executorId =
    topic.rulingRecord?.executorId ||
    topic.decisionRecord?.executorId ||
    topic.gameTheoreticState?.assignedExecutorId;
  if (executorId === agentId) {
    tags.push('executor');
    labels.push('落地执行');
    minPriority = Math.min(minPriority, 5);
  }

  if (tags.length === 0) {
    return { roleTag: 'collab', roleLabel: '协作成员', sortPriority: 6 };
  }

  return {
    roleTag: tags.slice(0, 2).join('+'),
    roleLabel: labels.slice(0, 2).join(' · '),
    sortPriority: minPriority,
  };
}

function isRoleExpectedForCurrentStage(
  topic: TopicMessageData,
  agentId: string
): boolean {
  if (topic.status === 'resolved' || topic.discussionMode !== 'game_theoretic' || !topic.gameRoles) {
    return false;
  }
  const stage = topic.gameStage || 'proposal';
  const expectedMap: Partial<Record<GameTheoreticStage, string[]>> = {
    decomposition: topic.gameRoles.proposers,
    proposal: topic.gameRoles.proposers,
    challenge: topic.gameRoles.challengers,
    verification: topic.gameRoles.verifiers,
    defense: topic.gameRoles.proposers,
    arbitration: topic.gameRoles.arbiters,
  };
  const rolePool = expectedMap[stage];
  return Boolean(rolePool && rolePool.includes(agentId));
}

export function buildTopicStatusOverview(
  input: BuildTopicStatusOverviewInput
): TopicStatusOverviewModel {
  const {
    topic,
    messages,
    agents,
    activeExecutions = [],
    allActiveExecutions = [],
    topicExecutionDiffs,
    now = Date.now(),
  } = input;

  // Merge executions targeting this topic from both activeExecutions & allActiveExecutions
  const topicExecByAgent = new Map<string, ActiveAgentExecution>();
  for (const exec of [...activeExecutions, ...allActiveExecutions]) {
    if (exec.topicId === topic.id || exec.threadId === topic.id) {
      if (!topicExecByAgent.has(exec.agentId)) {
        topicExecByAgent.set(exec.agentId, exec);
      }
    }
  }

  const pendingMsgs = messages.filter((m) => m.isPending);
  const pendingMsgByAgent = new Map<string, Message>();
  for (const m of pendingMsgs) {
    if (m.authorId && !pendingMsgByAgent.has(m.authorId)) {
      pendingMsgByAgent.set(m.authorId, m);
    }
  }

  const executionStatus = topic.gameTheoreticState?.executionStatus || 'idle';
  const isPatchRunning = executionStatus === 'running' || executionStatus === 'queued';
  const activeAgentIds = new Set<string>([
    ...topicExecByAgent.keys(),
    ...pendingMsgByAgent.keys(),
  ]);
  const activeAgentCount = activeAgentIds.size;
  const isTopicRunning = activeAgentCount > 0 || isPatchRunning;

  const isResolved = topic.status === 'resolved' || topic.gameStage === 'concluded';
  const isConcurrenceActive = Boolean(topic.gameTheoreticState?.concurrenceState?.isConcurrencePhaseActive);
  const isStageFailed = topic.gameStage === 'stageFailed';

  let overallState: TopicOverallRunState = 'idle';
  let overallBadgeText = '待命中';
  let overallSummaryText = '当前没有进行中的 Agent 任务';

  if (isPatchRunning && activeAgentCount === 0) {
    overallState = 'patch_running';
    overallBadgeText = '执行中';
    overallSummaryText = '落地执行管线正在后台运行';
  } else if (isTopicRunning) {
    overallState = isPatchRunning ? 'patch_running' : 'running';
    overallBadgeText = activeAgentCount > 0 ? `进行中 (${activeAgentCount})` : '进行中';
    const names = Array.from(topicExecByAgent.values()).map((e) => e.agentName);
    if (names.length === 0) {
      pendingMsgs.forEach((m) => {
        if (m.authorName && !names.includes(m.authorName)) names.push(m.authorName);
      });
    }
    overallSummaryText =
      names.length > 0
        ? `${names.join('、')} 正在实时推演中`
        : '后台任务正在运行';
  } else if (isResolved) {
    overallState = 'resolved';
    overallBadgeText = '已定案';
    overallSummaryText = '议题已完成裁决并归档';
  } else if (isStageFailed) {
    overallState = 'stage_failed';
    overallBadgeText = '已中断';
    overallSummaryText = '当前阶段推演中断，可恢复或 @指定角色续跑';
  } else if (isConcurrenceActive) {
    overallState = 'concurrence';
    overallBadgeText = '征询中';
    overallSummaryText = '正在等待参研角色确认无异议';
  } else if (topic.gameStage === 'arbitration' || Boolean(topic.gameTheoreticState?.rulingDraft)) {
    overallState = 'awaiting_ruling';
    overallBadgeText = '待裁决';
    overallSummaryText = '各阶段研讨完成，等待首席仲裁官持锤定案';
  }

  const stageFlow = resolveStageFlow(topic, messages, isTopicRunning, isPatchRunning);

  const diffs = collectDedupedDiffs(topic, messages, topicExecutionDiffs);
  const additions = diffs.reduce((sum, d) => sum + (Number.isFinite(d.additions) ? d.additions : 0), 0);
  const deletions = diffs.reduce((sum, d) => sum + (Number.isFinite(d.deletions) ? d.deletions : 0), 0);
  const hasRulingDraft = Boolean(topic.gameTheoreticState?.rulingDraft);

  const reviewSummaryText =
    diffs.length > 0
      ? `${diffs.length} 文件变更`
      : isResolved
      ? '裁决已归档'
      : hasRulingDraft
      ? '裁决草案就绪'
      : topic.gameTheoreticState?.mcdaPayload
      ? 'MCDA 矩阵已求解'
      : '尚无待审 Diff';

  const impactedFiles = collectImpactedFiles(topic, diffs);
  const modularState =
    topic.gameTheoreticState?.modularState ||
    topic.gameTheoreticState?.cognoNexus?.modularState;
  const modulesTotal = modularState?.enabled ? modularState.modules.length : 0;
  const modulesFrozen = modularState?.enabled
    ? modularState.modules.filter((m) => m.status === 'frozen').length
    : 0;
  const modulesRunning = modularState?.enabled
    ? modularState.modules.filter((m) => m.executionStatus === 'running').length
    : 0;

  const filesSummaryText =
    modulesTotal > 0
      ? `${modulesFrozen}/${modulesTotal} 模块冻结 · ${impactedFiles.length} 文件`
      : impactedFiles.length > 0
      ? `${impactedFiles.length} 个关联文件`
      : '暂未锁定文件';

  const evidences =
    topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];
  const confirmedCount = evidences.filter((e) => e.truthValue).length;
  const refutedCount = evidences.filter((e) => !e.truthValue).length;

  let terminalSummaryText = '暂无实证/执行';
  if (executionStatus === 'running' || executionStatus === 'queued') {
    terminalSummaryText = '补丁生成中';
  } else if (executionStatus === 'applied') {
    terminalSummaryText = '已合入工作区';
  } else if (executionStatus === 'completed') {
    terminalSummaryText = '补丁待合入';
  } else if (executionStatus === 'failed') {
    terminalSummaryText = '执行异常';
  } else if (evidences.length > 0) {
    terminalSummaryText = `实证 ${confirmedCount} 通过${refutedCount > 0 ? ` / ${refutedCount} 证伪` : ''}`;
  }

  // Gather candidate agent IDs in natural role/participant order
  const orderedAgentIds: string[] = [];
  const pushAgentId = (id?: string) => {
    if (!id || typeof id !== 'string') return;
    if (!orderedAgentIds.includes(id)) orderedAgentIds.push(id);
  };

  if (topic.gameRoles) {
    topic.gameRoles.proposers?.forEach(pushAgentId);
    topic.gameRoles.challengers?.forEach(pushAgentId);
    topic.gameRoles.verifiers?.forEach(pushAgentId);
    topic.gameRoles.arbiters?.forEach(pushAgentId);
  }
  pushAgentId(topic.dmAgentId);
  topic.participatingAgentIds?.forEach(pushAgentId);
  pushAgentId(topic.rulingRecord?.executorId);
  pushAgentId(topic.decisionRecord?.executorId);
  pushAgentId(topic.gameTheoreticState?.assignedExecutorId);
  topicExecByAgent.forEach((_, agentId) => pushAgentId(agentId));
  for (const m of messages) {
    if (m.isAgent && m.authorId && m.authorId !== 'system') {
      pushAgentId(m.authorId);
    }
  }

  const concurrenceItems = topic.gameTheoreticState?.concurrenceState?.items || [];

  const agentItemsWithRank: Array<{
    item: TopicOverviewAgentItem;
    rank: number;
    rolePriority: number;
    originalIdx: number;
  }> = [];

  orderedAgentIds.forEach((agentId, originalIdx) => {
    const exec = topicExecByAgent.get(agentId);
    const pendingMsg = pendingMsgByAgent.get(agentId);
    const agent = agents.find((a) => a.id === agentId);
    const agentMsgs = messages.filter(
      (m) =>
        m.isAgent &&
        (m.authorId === agentId ||
          (agent && m.authorName?.toLowerCase() === agent.name.toLowerCase()))
    );
    const latestMsg = agentMsgs[agentMsgs.length - 1];
    const elsewhereExec = allActiveExecutions.find(
      (e) =>
        e.agentId === agentId &&
        e.topicId !== topic.id &&
        e.threadId !== topic.id
    );
    const concurrenceItem = concurrenceItems.find((c) => c.agentId === agentId);

    const agentName =
      agent?.name || exec?.agentName || latestMsg?.authorName || agentId;
    const agentHandle =
      agent?.handle || latestMsg?.authorHandle || `@${agentName}`;
    const agentAvatar =
      agent?.avatar || exec?.agentAvatar || latestMsg?.authorAvatar || '🤖';

    const { roleTag, roleLabel, sortPriority } = resolveAgentRolesInTopic(topic, agentId);
    const displayTitle = `${agentName} (${roleTag})`;

    let runState: TopicOverviewAgentRunState = 'standby';
    let statusText = isResolved ? '已归档' : '在线待命';
    let actionDetail: string | undefined;
    let elapsedSeconds: number | undefined;
    let canAbort = false;
    let rank = 3;

    if (exec) {
      runState = exec.status === 'streaming' ? 'streaming' : 'running';
      elapsedSeconds = Math.max(0, (now - exec.startedAt) / 1000);
      statusText =
        exec.status === 'streaming'
          ? '流式输出中'
          : exec.status === 'queued'
          ? '排队中'
          : '推演运行中';
      actionDetail = exec.currentActionDetail;
      canAbort = true;
      rank = 0;
    } else if (pendingMsg) {
      const hasStreamText = Boolean(pendingMsg.content && pendingMsg.content.trim().length > 0);
      runState = hasStreamText ? 'streaming' : 'running';
      elapsedSeconds = Math.max(0, (now - (pendingMsg.startedAt || now)) / 1000);
      statusText = hasStreamText ? '流式输出中' : '推演运行中';
      actionDetail = pendingMsg.pendingHint;
      canAbort = true;
      rank = 0;
    } else if (agent && isAgentOffline(agent)) {
      runState = 'offline';
      statusText = agent.status === 'error' ? '异常离线' : '未启动';
      rank = 4;
    } else if (elsewhereExec) {
      runState = 'queued_elsewhere';
      statusText = '他处忙碌';
      actionDetail = elsewhereExec.currentActionDetail;
      rank = 3;
    } else if (concurrenceItem && concurrenceItem.status !== 'pending') {
      if (concurrenceItem.status === 'concurred') {
        runState = 'concurred';
        statusText = '无异议已签';
      } else if (concurrenceItem.status === 'objected') {
        runState = 'objected';
        statusText = '保留异议';
      } else {
        runState = 'completed_turn';
        statusText = '已反馈';
      }
      rank = concurrenceItem.status === 'objected' ? 1 : 2;
    } else if (isRoleExpectedForCurrentStage(topic, agentId)) {
      runState = 'awaiting_turn';
      statusText =
        agentMsgs.length > 0 ? `当前阶段 (${agentMsgs.length})` : '当前轮次待触发';
      rank = 1;
    } else if (agentMsgs.length > 0) {
      runState = 'completed_turn';
      statusText = `已发言 (${agentMsgs.length})`;
      rank = 2;
    }

    agentItemsWithRank.push({
      item: {
        agentId,
        agentName,
        agentHandle,
        agentAvatar,
        roleTag,
        roleLabel,
        displayTitle,
        runState,
        statusText,
        actionDetail,
        elapsedSeconds,
        messageCount: agentMsgs.length,
        latestMessageId: latestMsg?.id,
        canAbort,
      },
      rank,
      rolePriority: sortPriority,
      originalIdx,
    });
  });

  agentItemsWithRank.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rolePriority !== b.rolePriority) return a.rolePriority - b.rolePriority;
    return a.originalIdx - b.originalIdx;
  });

  return {
    isTopicRunning,
    overallState,
    overallBadgeText,
    overallSummaryText,
    activeAgentCount,
    stageFlow,
    reviewStats: {
      diffFileCount: diffs.length,
      additions,
      deletions,
      hasRulingDraft,
      isResolved,
      summaryText: reviewSummaryText,
    },
    filesStats: {
      impactedFilesCount: impactedFiles.length,
      impactedFiles,
      modulesTotal,
      modulesFrozen,
      modulesRunning,
      summaryText: filesSummaryText,
    },
    terminalStats: {
      evidenceCount: evidences.length,
      confirmedCount,
      refutedCount,
      executionStatus,
      summaryText: terminalSummaryText,
    },
    agentItems: agentItemsWithRank.map((entry) => entry.item),
  };
}
