import assert from 'node:assert/strict';
import type {
  ActiveAgentExecution,
  Agent,
  Message,
  TopicMessageData,
} from '../types';
import { buildTopicStatusOverview } from './topicStatusOverview';

console.log('🧪 [Topic Status Overview] Starting real-time status & workflow overview tests...\n');

function makeAgent(
  id: string,
  name: string,
  status: Agent['status'] = 'running'
): Agent {
  return {
    id,
    name,
    handle: `@${name.toLowerCase()}`,
    avatar: '🤖',
    role: 'Engineer',
    description: '',
    color: 'blue',
    status,
    acpTransport: 'stdio',
    acpCommandOrUrl: 'codex-acp',
    protocolVersion: '2',
    capabilities: {
      canUseInternalMemory: false,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    workspace: {
      rootPath: '/tmp/ws',
      repoName: 'ws',
      gitBranch: 'main',
      permissionMode: 'full_read_write',
      activeFiles: [],
    },
    skills: [],
    memory: {
      schemaVersion: 1,
      mode: 'disabled',
      autoGenerate: false,
      nativeCapability: { status: 'disabled' },
      internalMemoryPath: '',
      persistentType: 'sqlite',
      persistentItems: [],
      sessionCacheCount: 0,
    },
  };
}

function makeTopic(overrides: Partial<TopicMessageData> = {}): TopicMessageData {
  return {
    id: 'topic-1',
    scopeType: 'channel',
    channelId: 'ch-1',
    workspaceBindingId: 'wb-1',
    title: 'ACP MCP 挂载修复评估',
    description: '确保 shadow-crew-dev-mcp 在 ACP v1/v2 下正常挂载',
    status: 'investigating',
    discussionMode: 'game_theoretic',
    gameStage: 'challenge',
    gameRoles: {
      proposers: ['agent-prop'],
      challengers: ['agent-red'],
      verifiers: ['agent-ver'],
      arbiters: ['agent-arb'],
      humanIsArbiter: true,
    },
    authorId: 'user-norris',
    authorName: 'Norris',
    authorAvatar: '👨‍💻',
    timestamp: '14:00',
    repliesCount: 1,
    participatingAgentIds: ['agent-prop', 'agent-red', 'agent-ver', 'agent-arb'],
    ...overrides,
  };
}

const agents: Agent[] = [
  makeAgent('agent-prop', 'Codex-Architect', 'running'),
  makeAgent('agent-red', 'Claude-RedTeam', 'running'),
  makeAgent('agent-ver', 'Verify-Sentinel', 'idle'),
  makeAgent('agent-arb', 'Arbiter-Prime', 'running'),
];

// 1. Active execution in 4+1 game_theoretic mode
{
  const now = 1_700_000_012_400;
  const activeExec: ActiveAgentExecution = {
    agentId: 'agent-red',
    agentName: 'Claude-RedTeam',
    agentAvatar: '⚔️',
    threadId: 'topic-1',
    topicId: 'topic-1',
    status: 'thinking',
    currentActionDetail: '正在压测 MCP 握手边界...',
    startedAt: 1_700_000_000_000,
  };
  const msgs: Message[] = [
    {
      id: 'm1',
      threadId: 'topic-1',
      authorId: 'agent-prop',
      authorName: 'Codex-Architect',
      authorHandle: '@codex',
      authorAvatar: '🤖',
      isAgent: true,
      timestamp: '14:01',
      content: '立论已完成',
      gameStage: 'proposal',
    },
  ];

  const model = buildTopicStatusOverview({
    topic: makeTopic(),
    messages: msgs,
    agents,
    activeExecutions: [activeExec],
    allActiveExecutions: [activeExec],
    now,
  });

  assert.equal(model.isTopicRunning, true, '有活跃 execution 时议题应显示运行中');
  assert.equal(model.overallState, 'running');
  assert.equal(model.activeAgentCount, 1);
  assert.equal(model.stageFlow.completedSteps, 1, 'challenge 阶段时 proposal 应已完成');
  assert.equal(model.stageFlow.totalSteps, 5);
  assert.equal(model.stageFlow.steps[0].status, 'completed');
  assert.equal(model.stageFlow.steps[1].status, 'active');

  // Actively running agent must sort first with elapsed time and abort affordance
  assert.equal(model.agentItems[0].agentId, 'agent-red');
  assert.equal(model.agentItems[0].runState, 'running');
  assert.equal(model.agentItems[0].canAbort, true);
  assert.equal(model.agentItems[0].displayTitle, 'Claude-RedTeam (challenge)');
  assert.ok(
    Math.abs((model.agentItems[0].elapsedSeconds ?? 0) - 12.4) < 0.05,
    '耗时应精确为 12.4s'
  );

  const verifierItem = model.agentItems.find((a) => a.agentId === 'agent-ver');
  assert.equal(verifierItem?.runState, 'offline', 'idle 状态 Agent 应标记为 offline');
}
console.log('✓ 场景 1：4+1 博弈运行态识别、阶段进度与运行中 Agent 置顶排序通过');

// 2. Streaming pending message without activeExecutions entry
{
  const now = 1_700_000_005_000;
  const pendingMsgs: Message[] = [
    {
      id: 'm-pending',
      threadId: 'topic-1',
      authorId: 'agent-prop',
      authorName: 'Codex-Architect',
      authorHandle: '@codex',
      authorAvatar: '🤖',
      isAgent: true,
      isPending: true,
      startedAt: 1_700_000_000_000,
      pendingHint: '流式写入响应',
      timestamp: '14:02',
      content: '正在流式生成修正方案...',
      gameStage: 'defense',
    },
  ];

  const model = buildTopicStatusOverview({
    topic: makeTopic({ gameStage: 'defense' }),
    messages: pendingMsgs,
    agents,
    activeExecutions: [],
    allActiveExecutions: [],
    now,
  });

  assert.equal(model.isTopicRunning, true, '存在 isPending 消息时即使 activeExecutions 为空也应显示运行中');
  assert.equal(model.agentItems[0].agentId, 'agent-prop');
  assert.equal(model.agentItems[0].runState, 'streaming');
  assert.equal(model.agentItems[0].canAbort, true);
  assert.equal(model.agentItems[0].elapsedSeconds, 5);
}
console.log('✓ 场景 2：仅存在流式 isPending 占位消息时仍能准确识别进行中状态');

// 3. Diff additions/deletions, impacted files dedup, bypassed challenger & G-Frame counters
{
  const topicWithDiffs = makeTopic({
    gameStage: 'verification',
    gameTheoreticState: {
      currentStage: 'verification',
      isChallengerBypassed: true,
      executionStatus: 'completed',
      rulingDraft: {
        decisionType: 'adopt_proposer',
        summary: '采用方案 A',
        tradeOffPoints: [],
        impactedFiles: ['./src/services/acpClient.ts', 'src-tauri/src/acp_manager.rs'],
      },
      modularState: {
        enabled: true,
        modules: [
          {
            moduleId: 'M1',
            title: 'Rust 挂载',
            responsibility: 'Mount MCP',
            allowedFiles: ['src-tauri/src/acp_manager.rs'],
            dependsOnModuleIds: [],
            complexityLevel: 'low_deterministic',
            status: 'frozen',
            executionStatus: 'completed',
            belief: {
              priorRisk: 0.2,
              posteriorRisk: 0.1,
              routingMode: 'fast_track',
              feedbackVector: {
                contractViolations: 0,
                verifiedClaims: 2,
                refutedClaims: 0,
                edgeCaseCount: 0,
                dssScore: 0.1,
              },
              lastUpdatedAt: '2026-11-14T14:00:00Z',
            },
            scopedMessageIds: [],
          },
          {
            moduleId: 'M2',
            title: '前端适配',
            responsibility: 'Normalize names',
            allowedFiles: ['src/services/acpClient.ts', 'bin/codex-acp'],
            dependsOnModuleIds: ['M1'],
            complexityLevel: 'medium_standard',
            status: 'verifying',
            executionStatus: 'pending',
            belief: {
              priorRisk: 0.5,
              posteriorRisk: 0.4,
              routingMode: 'deep_debate',
              feedbackVector: {
                contractViolations: 0,
                verifiedClaims: 1,
                refutedClaims: 0,
                edgeCaseCount: 1,
                dssScore: 0.2,
              },
              lastUpdatedAt: '2026-11-14T14:00:00Z',
            },
            scopedMessageIds: [],
          },
        ],
      },
    },
  });

  const model = buildTopicStatusOverview({
    topic: topicWithDiffs,
    messages: [],
    agents,
    topicExecutionDiffs: [
      { filename: 'src/services/acpClient.ts', additions: 80, deletions: 12, diff: '@@' },
      { filename: 'bin/codex-acp', additions: 33, deletions: 0, diff: '@@2' },
    ],
  });

  assert.equal(model.isTopicRunning, false);
  assert.equal(model.reviewStats.diffFileCount, 2);
  assert.equal(model.reviewStats.additions, 113);
  assert.equal(model.reviewStats.deletions, 12);
  assert.equal(model.filesStats.impactedFilesCount, 3, '相对路径 ./ 应去重归一化');
  assert.equal(model.filesStats.modulesTotal, 2);
  assert.equal(model.filesStats.modulesFrozen, 1);
  assert.equal(model.stageFlow.steps[1].status, 'bypassed', 'fast_track 旁路应标为 bypassed');
  assert.equal(model.terminalStats.executionStatus, 'completed');
}
console.log('✓ 场景 3：Diff 行数统计、文件去重、G-Frame 模块计数与快速通道旁路识别通过');

// 4. Idle standby vs Resolved states & agent busy elsewhere
{
  const elsewhereExec: ActiveAgentExecution = {
    agentId: 'agent-prop',
    agentName: 'Codex-Architect',
    agentAvatar: '🤖',
    threadId: 'other-channel',
    topicId: 'topic-other',
    status: 'thinking',
    startedAt: Date.now() - 3000,
  };

  const idleStandard = makeTopic({
    discussionMode: 'standard',
    gameStage: undefined,
    gameRoles: undefined,
  });
  const idleModel = buildTopicStatusOverview({
    topic: idleStandard,
    messages: [],
    agents,
    allActiveExecutions: [elsewhereExec],
  });
  assert.equal(idleModel.isTopicRunning, false);
  assert.equal(idleModel.overallState, 'idle');
  assert.equal(
    idleModel.agentItems.find((a) => a.agentId === 'agent-prop')?.runState,
    'queued_elsewhere',
    '在其他议题运行中的 Agent 不得将本议题标为 running'
  );

  const resolvedModel = buildTopicStatusOverview({
    topic: makeTopic({ status: 'resolved', gameStage: 'concluded' }),
    messages: [],
    agents,
  });
  assert.equal(resolvedModel.isTopicRunning, false);
  assert.equal(resolvedModel.overallState, 'resolved');
  assert.equal(resolvedModel.stageFlow.completedSteps, 5);
}
console.log('✓ 场景 4：标准模式空闲态、跨议题忙碌隔离与已定案状态校验通过\n');
console.log('🎉 TopicStatusOverview 全部测试用例通过！');
