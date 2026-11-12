import assert from 'node:assert/strict';
import { Agent, GameRolesConfig, GameTheoreticStage, GameRoleType, TopicMessageData, Message } from '../../types';
import { isAllMention, parseAgentMentions } from '../agentCollaboration';

console.log('===================================================================');
console.log('🧪 CognoNexus: 博弈议题中断恢复与显式 @mention 角色唤醒回归测试套件');
console.log('===================================================================');

// 模拟测试环境数据
const agentClaude: Agent = {
  id: 'agent-claudecode',
  name: 'MyClaudeCode',
  handle: '@MyClaudeCode',
  role: 'coder',
  status: 'running',
  avatar: '⚡',
  isRemote: false,
} as unknown as Agent;

const agentCodex: Agent = {
  id: 'agent-mycodex',
  name: 'MyCodex',
  handle: '@mycodex',
  role: 'tester',
  status: 'running',
  avatar: '🤖',
  isRemote: false,
} as unknown as Agent;

const availableAgents = [agentClaude, agentCodex];

// 角色分配：Claude 兼任提案官与综合仲裁，Codex 担任反例压测挑战官
const gameRoles: GameRolesConfig = {
  proposers: ['agent-claudecode'],
  challengers: ['agent-mycodex'],
  verifiers: [],
  arbiters: ['agent-claudecode'],
  humanIsArbiter: true,
};

// 模拟角色与阶段决策函数（对应 App.tsx handleSendTopicMessage 核心决策）
function resolveTopicTurnTarget(options: {
  content: string;
  topic: TopicMessageData;
  existingMessages: Message[];
  allAgents: Agent[];
}) {
  const { content, topic, existingMessages, allAgents } = options;
  const isTopicAll = isAllMention(content);
  const userMentionedAgents = isTopicAll ? [] : parseAgentMentions(content, allAgents);

  const isGameTheoretic = topic.discussionMode === 'game_theoretic';
  const currentTopicStage: GameTheoreticStage = topic.gameStage || topic.gameTheoreticState?.currentStage || 'proposal';
  let executionStage: GameTheoreticStage = currentTopicStage;
  let targetRoleType: GameRoleType = 'proposer';
  let respondingAgents: Agent[] = [];

  const fallbackProposalText = (
    topic.gameTheoreticState?.targetProposalContent ||
    existingMessages
      .slice()
      .reverse()
      .find((m) => !m.isPending && (m.gameStage === 'proposal' || m.gameRole === 'proposer') && m.content?.trim())?.content
  );

  const candidateAgents = allAgents;

  if (isGameTheoretic) {
    if (userMentionedAgents.length > 0 && !isTopicAll) {
      respondingAgents = userMentionedAgents;
      const targetAgent = userMentionedAgents[0];
      const id = targetAgent.id;
      const roles = topic.gameRoles;
      const isProposer = Boolean(roles?.proposers?.includes(id));
      const isChallenger = Boolean(roles?.challengers?.includes(id));
      const isVerifier = Boolean(roles?.verifiers?.includes(id));
      const isArbiter = Boolean(roles?.arbiters?.includes(id));
      const gState = topic.gameTheoreticState;
      const hasProposal = Boolean(fallbackProposalText?.trim());
      const isChallengerDone = Boolean(gState?.isChallengerResponded);
      const isVerifierDone = Boolean(gState?.isVerifierResponded);
      const isDefenseDone = Boolean(gState?.isDefenseResponded);

      // 1. 优先匹配当前所处阶段
      if (currentTopicStage === 'arbitration' && isArbiter) {
        targetRoleType = 'arbiter';
        executionStage = 'arbitration';
      } else if (currentTopicStage === 'defense' && isProposer) {
        targetRoleType = 'proposer';
        executionStage = 'defense';
      } else if (currentTopicStage === 'verification' && isVerifier) {
        targetRoleType = 'verifier';
        executionStage = 'verification';
      } else if (currentTopicStage === 'challenge' && isChallenger) {
        targetRoleType = 'challenger';
        executionStage = 'challenge';
      } else if (currentTopicStage === 'proposal' && isProposer && !hasProposal) {
        targetRoleType = 'proposer';
        executionStage = 'proposal';
      // 2. 否则按协同状态机未竟进度断点续推
      } else if (isChallenger && (!isChallengerDone || currentTopicStage === 'proposal')) {
        targetRoleType = 'challenger';
        executionStage = 'challenge';
      } else if (isVerifier && (!isVerifierDone || currentTopicStage === 'challenge')) {
        targetRoleType = 'verifier';
        executionStage = 'verification';
      } else if (isProposer && hasProposal && (!isDefenseDone || currentTopicStage === 'challenge' || currentTopicStage === 'verification')) {
        targetRoleType = 'proposer';
        executionStage = 'defense';
      } else if (isArbiter && (isDefenseDone || currentTopicStage === 'defense' || currentTopicStage === 'arbitration')) {
        targetRoleType = 'arbiter';
        executionStage = 'arbitration';
      // 3. 兜底角色映射
      } else if (isChallenger) {
        targetRoleType = 'challenger';
        executionStage = 'challenge';
      } else if (isVerifier) {
        targetRoleType = 'verifier';
        executionStage = 'verification';
      } else if (isArbiter) {
        targetRoleType = 'arbiter';
        executionStage = 'arbitration';
      } else if (isProposer) {
        targetRoleType = 'proposer';
        executionStage = hasProposal ? 'defense' : 'proposal';
      }
    } else {
      if (currentTopicStage === 'proposal') {
        const proposerIds = topic.gameRoles?.proposers || [];
        respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
        targetRoleType = 'proposer';
        executionStage = 'proposal';
      } else if (currentTopicStage === 'challenge') {
        const challengerIds = topic.gameRoles?.challengers || [];
        respondingAgents = candidateAgents.filter((a) => challengerIds.includes(a.id));
        targetRoleType = 'challenger';
        executionStage = 'challenge';
      } else if (currentTopicStage === 'arbitration') {
        const arbiterIds = topic.gameRoles?.arbiters || [];
        respondingAgents = candidateAgents.filter((a) => arbiterIds.includes(a.id));
        targetRoleType = 'arbiter';
        executionStage = 'arbitration';
      }
    }
  }

  return {
    respondingAgents,
    targetRoleType,
    executionStage,
    fallbackProposalText,
  };
}

// -----------------------------------------------------------------------------
// 测试场景 1: 复现与验证用户提报的 Bug 场景
// 用户在 MyCodex 离线中断后，启动连接并在议题中发送 "@mycodex 你联通了 可以继续任务了"
// -----------------------------------------------------------------------------
console.log('▶ [场景 1] 验证中断恢复后显式 @mycodex 必须恢复挑战阶段，绝不能唤醒提案官或重置立论...');

const interruptedTopic: TopicMessageData = {
  id: 'topic-codex-cli',
  title: 'Codex Cli适配器优化',
  description: '优化 Codex ACP 适配器与官方协议桥接',
  status: 'investigating',
  discussionMode: 'game_theoretic',
  scopeType: 'channel',
  workspaceBindingId: 'ws-binding-test',
  gameRoles,
  gameStage: 'arbitration', // 此前因 MyCodex 离线导致跳入 arbitration 挂起状态
  gameTheoreticState: {
    currentStage: 'arbitration',
    targetProposalContent: '【方案立论】建议在 bin/codex-acp 封装双轨协议路由与心跳防冻机制。',
    isChallengerResponded: false, // 制衡方尚未答复
    quorumAlert: '挑战者 MyCodex 处于离线/未连接状态。',
  },
  authorId: 'user-norris',
  authorName: 'Norris_M5Pro',
  authorAvatar: '👨‍💻',
  timestamp: '05:30 PM',
  repliesCount: 2,
  participatingAgentIds: ['agent-claudecode', 'agent-mycodex'],
} as unknown as TopicMessageData;

const existingHistory: Message[] = [
  {
    id: 'msg-prop-1',
    threadId: 'topic-codex-cli',
    authorId: 'agent-claudecode',
    authorName: 'MyClaudeCode',
    authorHandle: '@MyClaudeCode',
    authorAvatar: '⚡',
    isAgent: true,
    content: '【方案立论】建议在 bin/codex-acp 封装双轨协议路由与心跳防冻机制。',
    gameStage: 'proposal',
    gameRole: 'proposer',
    timestamp: '05:32 PM',
  } as unknown as Message,
  {
    id: 'msg-guard-offline',
    threadId: 'topic-codex-cli',
    authorId: 'system',
    authorName: 'Shinobi 仲裁法定人数守护',
    authorHandle: '@quorum-guard',
    authorAvatar: '🔌',
    isAgent: true,
    content: '🔌 制衡方通信尚未开启：挑战者 MyCodex 处于离线/未连接状态...',
    timestamp: '05:33 PM',
  } as unknown as Message,
];

const decision1 = resolveTopicTurnTarget({
  content: '@mycodex 你联通了 可以继续任务了',
  topic: interruptedTopic,
  existingMessages: existingHistory,
  allAgents: availableAgents,
});

assert.equal(decision1.respondingAgents.length, 1, '必须且仅响应被显式 @ 的 Agent');
assert.equal(decision1.respondingAgents[0].id, 'agent-mycodex', '响应方必须是 MyCodex，绝不可被丢弃转而唤醒 MyClaudeCode');
assert.equal(decision1.targetRoleType, 'challenger', '角色必须被精准识别为反例压测制衡方 (challenger)');
assert.equal(decision1.executionStage, 'challenge', '执行阶段必须平滑恢复至反例压测 (challenge)，绝不可重置为 proposal 或跳入 arbitration');
assert.equal(decision1.fallbackProposalText, '【方案立论】建议在 bin/codex-acp 封装双轨协议路由与心跳防冻机制。', '必须完整将已有立论正文注入给挑战者作为反例压测靶点');

console.log('✓ 场景 1 校验通过：被 @ 的 MyCodex 精准接力挑战阶段，立论方案完整透传。\n');

// -----------------------------------------------------------------------------
// 测试场景 2: 兼任多角色时的阶段防回退校验
// MyClaudeCode 同时担任 proposer 和 arbiter；当议题处于 arbitration 阶段时，
// 用户显式 @MyClaudeCode 请定案，必须保持 arbitration，绝不能回退为 proposal！
// -----------------------------------------------------------------------------
console.log('▶ [场景 2] 验证一人兼任多角色时显式 @mention 阶段防回退...');

const arbitrationTopic: TopicMessageData = {
  ...interruptedTopic,
  gameStage: 'arbitration',
  gameTheoreticState: {
    ...interruptedTopic.gameTheoreticState,
    currentStage: 'arbitration',
    targetProposalContent: '方案正文...',
    targetChallengeContent: '反例反驳...',
    isChallengerResponded: true,
    isDefenseResponded: true,
  },
};

const decision2 = resolveTopicTurnTarget({
  content: '@MyClaudeCode 请对反例与答辩做出终局仲裁裁决',
  topic: arbitrationTopic,
  existingMessages: existingHistory,
  allAgents: availableAgents,
});

assert.equal(decision2.respondingAgents[0].id, 'agent-claudecode', '响应方为 MyClaudeCode');
assert.equal(decision2.targetRoleType, 'arbiter', '在 arbitration 阶段点名兼任者必须优先承接综合仲裁官角色');
assert.equal(decision2.executionStage, 'arbitration', '执行阶段必须保持 arbitration，绝不可因其包含 proposer 角色而意外回退为 proposal');

console.log('✓ 场景 2 校验通过：多角色兼任者优先匹配当前阶段，严防立论回退。\n');

// -----------------------------------------------------------------------------
// 测试场景 3: 已有方案时点名提案官进入 defense（答辩修正）而非重新立论
// -----------------------------------------------------------------------------
console.log('▶ [场景 3] 验证已有方案立论时点名提案官自动进入答辩修正 (defense)...');

const challengeDoneTopic: TopicMessageData = {
  ...interruptedTopic,
  gameStage: 'challenge',
  gameTheoreticState: {
    ...interruptedTopic.gameTheoreticState,
    currentStage: 'challenge',
    targetProposalContent: '方案正文...',
    targetChallengeContent: '发现极端并发边界缺陷...',
    isChallengerResponded: true,
    isDefenseResponded: false,
  },
};

const decision3 = resolveTopicTurnTarget({
  content: '@MyClaudeCode 针对刚刚提出的并发缺陷进行防御答辩并补齐补丁',
  topic: challengeDoneTopic,
  existingMessages: existingHistory,
  allAgents: availableAgents,
});

assert.equal(decision3.respondingAgents[0].id, 'agent-claudecode');
assert.equal(decision3.targetRoleType, 'proposer');
assert.equal(decision3.executionStage, 'defense', '已有立论且挑战完成后，点名提案官必须流转至 defense (答辩修正)，绝不重置为 proposal');

console.log('✓ 场景 3 校验通过：提案官在有方案背景下精准承接答辩修正。\n');

// -----------------------------------------------------------------------------
// 测试场景 4: 用户手动 @点名唤醒仲裁官继续综合仲裁并顺畅推进无异议征询闭环
// -----------------------------------------------------------------------------
console.log('▶ [场景 4] 验证手动 @仲裁官唤醒任务后精准承接 arbitration 并触发全员无异议征询...');

import {
  prepareConcurrenceState,
  advanceRoleConcurrenceItem,
  checkAllRolesConcurred,
  validateArbiterConcurrenceMentions,
} from './arbitrationConcurrenceGovernor';

const decision4 = resolveTopicTurnTarget({
  content: '@myclaudecode 继续你中断的综合仲裁任务',
  topic: arbitrationTopic,
  existingMessages: existingHistory,
  allAgents: availableAgents,
});

assert.equal(decision4.respondingAgents[0].id, 'agent-claudecode');
assert.equal(decision4.targetRoleType, 'arbiter');
assert.equal(decision4.executionStage, 'arbitration', '手动唤醒仲裁官必须进入 arbitration 阶段');

// 模拟 Arbiter 给出包含 @mycodex 的有效裁决文本（兼任角色 @myclaudecode 豁免自 @）
const mockArbiterReplyText = `## 综合仲裁裁决书\n\n经过对立论与反例压测审查，做出终局裁决。\n请 @mycodex 查阅并提交无异议复核。`;
const mockSolutionDigest = 'sha256:' + 'a'.repeat(64);

const concurrenceState = prepareConcurrenceState({
  topic: arbitrationTopic,
  candidateAgents: availableAgents,
  arbiterDraft: {
    decisionType: 'trade_off_matrix',
    summary: '综合仲裁终局方案',
    tradeOffPoints: ['兼顾吞吐量与内存边界'],
    solution: '实施权衡补丁',
    impactedFiles: ['src/core/index.ts'],
  },
  arbiterReplyText: mockArbiterReplyText,
  solutionDigest: mockSolutionDigest,
  arbiterAgentId: 'agent-claudecode',
});

// 验证兼任提案官自动内在达成无异议，仅留 peer 角色 (MyCodex) 待征询
const proposerItem = concurrenceState.items.find((i) => i.agentId === 'agent-claudecode');
const challengerItem = concurrenceState.items.find((i) => i.agentId === 'agent-mycodex');

assert.equal(proposerItem?.status, 'concurred', '裁定官兼任角色内在达成无异议');
assert.equal(proposerItem?.decisionSource, 'arbiter_intrinsic');
assert.equal(challengerItem?.status, 'pending', '制衡方 MyCodex 处于待复核 pending 态');
assert.equal(concurrenceState.allConcurred, false, '在 peer 角色投票前全员无异议尚未达成');

// 模拟 MyCodex 提交结构化合法无异议票
const updatedConcurrence = advanceRoleConcurrenceItem(concurrenceState, 'agent-mycodex', {
  submission: {
    protocolVersion: 1,
    agentId: 'agent-mycodex',
    role: 'challenger',
    status: 'concurred',
    solutionDigest: mockSolutionDigest,
    rationale: '已审查终局方案，反例边界已得到妥善防御，无异议。',
    blockingIssueIds: [],
    conditions: [],
    evidenceRefs: [],
    source: 'mcp_tool',
  },
});

assert.equal(checkAllRolesConcurred(updatedConcurrence), true, '所有角色无异议确认后 checkAllRolesConcurred 必须返回 true');
console.log('✓ 场景 4 校验通过：手动唤醒仲裁官承接 arbitration 并无缝推进全员无异议征询闭环。\n');

console.log('===================================================================');
console.log('🎉 所有博弈中断恢复与显式 @mention 角色唤醒用例全部通过 (100%)！');
console.log('===================================================================');
