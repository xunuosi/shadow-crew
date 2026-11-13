import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopicProgressStrip } from '../components/TopicProgressStrip';
import {
  deriveTopicProgressView,
  formatProgressElapsed,
  isProgressStalled,
  topicProgressViewSignature,
  PROGRESS_STALL_THRESHOLD_MS,
} from './topicProgressView';
import type {
  ActiveAgentExecution,
  GameTheoreticState,
  Message,
  TaskModuleSlice,
  TopicMessageData,
} from '../types';

console.log('=== Topic Progress View Test Suite ===');

function makeTopic(overrides: Partial<TopicMessageData> = {}): TopicMessageData {
  return {
    id: 'topic-1',
    scopeType: 'channel',
    workspaceBindingId: 'ws-1',
    title: '进度视图测试议题',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: {
      proposers: ['p1'],
      challengers: ['c1'],
      arbiters: ['a1'],
      humanIsArbiter: false,
    },
    authorId: 'u1',
    authorName: 'User',
    authorAvatar: '',
    timestamp: '2026-11-13T00:00:00.000Z',
    repliesCount: 0,
    participatingAgentIds: [],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    threadId: 'topic-1',
    authorId: 'agent-x',
    authorName: 'Agent X',
    authorHandle: 'agent-x',
    authorAvatar: '',
    isAgent: true,
    timestamp: '2026-11-13T00:00:00.000Z',
    content: '',
    ...overrides,
  };
}

function makeExecution(overrides: Partial<ActiveAgentExecution> = {}): ActiveAgentExecution {
  return {
    agentId: 'agent-x',
    agentName: 'Agent X',
    agentAvatar: '',
    threadId: 'topic-1',
    topicId: 'topic-1',
    status: 'thinking',
    startedAt: 1_000,
    ...overrides,
  };
}

function makeModule(
  moduleId: string,
  title: string,
  overrides: Partial<TaskModuleSlice> = {}
): TaskModuleSlice {
  return {
    moduleId,
    title,
    responsibility: '测试职责',
    allowedFiles: [],
    dependsOnModuleIds: [],
    complexityLevel: 'low_deterministic',
    status: 'pending',
    belief: {
      priorRisk: 0.2,
      posteriorRisk: 0.1,
      routingMode: 'fast_track',
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 0,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: '2026-11-13T00:00:00.000Z',
    },
    scopedMessageIds: [],
    ...overrides,
  };
}

const states = (view: ReturnType<typeof deriveTopicProgressView>) =>
  view ? view.nodes.map((node) => `${node.key}:${node.state}`).join(',') : '<null>';

// —— 1. 模式分流：标准协同 / DM 博弈各自成视图，DM 标准私聊不展示 ——
const standardIdle = deriveTopicProgressView({
  topic: makeTopic({ discussionMode: 'standard' }),
  messages: [],
});
assert.ok(standardIdle);
assert.equal(standardIdle.mode, 'standard');
assert.equal(standardIdle.nodes.length, 0);
assert.equal(standardIdle.isActive, false);
assert.ok(standardIdle.headline.includes('待启动'));

const dmDuelIdle = deriveTopicProgressView({
  topic: makeTopic({ scopeType: 'dm', duelRoles: { proposer: 'human', challenger: 'agent' } }),
  messages: [],
});
assert.ok(dmDuelIdle);
assert.equal(dmDuelIdle.mode, 'dm_duel');
assert.equal(dmDuelIdle.nodes.length, 0);
assert.ok(dmDuelIdle.headline.includes('双方博弈'));

assert.equal(
  deriveTopicProgressView({
    topic: makeTopic({ scopeType: 'dm', discussionMode: 'standard' }),
    messages: [],
  }),
  null
);
assert.equal(deriveTopicProgressView({ topic: null, messages: [] }), null);
console.log('✓ standard / DM duel / DM standard / absent topics are routed correctly');

// —— 2. 全新议题：未启动，默认停在提案节点 ——
const fresh = deriveTopicProgressView({ topic: makeTopic(), messages: [] });
assert.ok(fresh);
assert.equal(fresh.stepIndex, 1);
assert.equal(fresh.stepTotal, 4);
assert.equal(states(fresh), 'proposal:pending,challenge:pending,defense:pending,arbitration:pending');
assert.equal(fresh.isActive, false);
assert.ok(fresh.headline.includes('待启动'));
console.log('✓ fresh topic starts pending on proposal');

// —— 3. 提案进行中：占位卡与执行记录去重后作为执行者，耗时取最早值 ——
const proposalRunning = deriveTopicProgressView({
  topic: makeTopic(),
  messages: [
    makeMessage({
      id: 'm-pending',
      gameStage: 'proposal',
      isPending: true,
      authorName: '吴用',
      startedAt: 5_000,
    }),
  ],
  executions: [makeExecution({ agentName: '吴用', startedAt: 4_000 })],
});
assert.ok(proposalRunning);
assert.equal(states(proposalRunning), 'proposal:active,challenge:pending,defense:pending,arbitration:pending');
assert.deepEqual(proposalRunning.activeActors, ['吴用']);
assert.equal(proposalRunning.activeStartedAt, 4_000);
assert.ok(proposalRunning.headline.includes('吴用 正在起草提案'));
assert.ok(proposalRunning.compactHeadline.includes('1/4'));
console.log('✓ active proposal dedupes actors and takes earliest start time');

// —— 4. 红队阶段：前序节点完成，当前节点活跃 ——
const challengeRunning = deriveTopicProgressView({
  topic: makeTopic({ status: 'investigating', gameStage: 'challenge' }),
  messages: [],
  executions: [makeExecution({ agentName: '林冲' })],
});
assert.ok(challengeRunning);
assert.equal(states(challengeRunning), 'proposal:done,challenge:active,defense:pending,arbitration:pending');
assert.ok(challengeRunning.headline.includes('林冲 正在执行红队压力测试'));
console.log('✓ challenge stage marks proposal done and challenge active');

// —— 5. 贝叶斯快速通道旁路红队 ——
const bypassed = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameTheoreticState: { currentStage: 'arbitration', isChallengerBypassed: true } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(bypassed);
assert.equal(states(bypassed), 'proposal:done,challenge:bypassed,defense:done,arbitration:queued');
assert.equal(bypassed.isActive, false);
assert.ok(bypassed.headline.includes('等待接力'));
console.log('✓ bypassed challenge stays visible as bypassed, not done');

// —— 6. 接地验证官缺席：验证节点标记 absent ——
const verificationAbsent = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'defense',
    gameRoles: {
      proposers: ['p1'],
      challengers: ['c1'],
      verifiers: ['v1'],
      arbiters: ['a1'],
      humanIsArbiter: false,
    },
    gameTheoreticState: {
      currentStage: 'defense',
      isVerifierResponded: false,
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(verificationAbsent);
assert.equal(
  states(verificationAbsent),
  'proposal:done,challenge:done,verification:absent,defense:queued,arbitration:pending'
);
console.log('✓ verifier absence is surfaced as absent');

// —— 7. 答辩缺席 ——
const defenseAbsent = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameTheoreticState: {
      currentStage: 'arbitration',
      isDefenseResponded: false,
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(defenseAbsent);
assert.equal(states(defenseAbsent), 'proposal:done,challenge:done,defense:absent,arbitration:queued');
console.log('✓ defense absence is surfaced as absent');

// —— 8. 仲裁阶段多人并行 ——
const arbitrationParallel = deriveTopicProgressView({
  topic: makeTopic({ status: 'investigating', gameStage: 'arbitration' }),
  messages: [
    makeMessage({ gameStage: 'arbitration', isPending: true, authorName: '吴用', startedAt: 2_000 }),
    makeMessage({ gameStage: 'arbitration', isPending: true, authorName: '公孙胜', startedAt: 3_000 }),
    makeMessage({ gameStage: 'arbitration', isPending: true, authorName: '卢俊义', startedAt: 4_000 }),
  ],
});
assert.ok(arbitrationParallel);
assert.equal(arbitrationParallel.stepIndex, 4);
assert.equal(arbitrationParallel.activeActors.length, 3);
assert.equal(arbitrationParallel.activeStartedAt, 2_000);
assert.ok(arbitrationParallel.headline.includes('3 位角色并行推进'));
assert.ok(arbitrationParallel.compactHeadline.includes('3 人'));
console.log('✓ parallel arbitration lists all active actors');

// —— 9. 定案终态 ——
const concluded = deriveTopicProgressView({
  topic: makeTopic({ status: 'resolved', gameStage: 'concluded' }),
  messages: [],
});
assert.ok(concluded);
assert.equal(concluded.isTerminal, true);
assert.equal(concluded.isActive, false);
assert.equal(concluded.stepIndex, concluded.stepTotal);
assert.equal(states(concluded), 'proposal:done,challenge:done,defense:done,arbitration:done');
assert.ok(concluded.headline.includes('已定案'));
console.log('✓ concluded topic is terminal and fully done');

// —— 10. 阶段熔断：按 quorumAlert 语义定位失败节点 ——
const failedByAlert = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'stageFailed',
    gameTheoreticState: {
      currentStage: 'stageFailed',
      quorumAlert: '红队挑战者未产出结构化批判规范，阶段熔断',
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(failedByAlert);
assert.equal(failedByAlert.isFailed, true);
assert.equal(failedByAlert.isTerminal, false);
assert.equal(states(failedByAlert), 'proposal:done,challenge:failed,defense:pending,arbitration:pending');
assert.equal(failedByAlert.failureText, '红队挑战者未产出结构化批判规范，阶段熔断');
assert.ok(failedByAlert.headline.includes('熔断'));
console.log('✓ stage failure is located from quorumAlert semantics');

// —— 11. 阶段熔断：无告警文案时回落到最近阶段消息 ——
const failedByMessage = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'stageFailed',
    gameRoles: {
      proposers: ['p1'],
      challengers: ['c1'],
      verifiers: ['v1'],
      arbiters: ['a1'],
      humanIsArbiter: false,
    },
    gameTheoreticState: { currentStage: 'stageFailed' } as GameTheoreticState,
  }),
  messages: [makeMessage({ gameStage: 'verification', content: '接地验证未通过' })],
});
assert.ok(failedByMessage);
assert.equal(states(failedByMessage), 'proposal:done,challenge:done,verification:failed,defense:pending,arbitration:pending');
console.log('✓ stage failure falls back to the latest stage message');

// —— 12. G-Frame 模块化：拆解节点与模块标签 ——
const modular = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'challenge',
    gameTheoreticState: {
      currentStage: 'challenge',
      modularState: {
        enabled: true,
        modules: [
          makeModule('mod-1', '核心类型定义'),
          makeModule('mod-2', '状态契约与类型定义'),
        ],
        activeModuleId: 'mod-2',
      },
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(modular);
assert.equal(states(modular), 'decomposition:done,proposal:done,challenge:queued,defense:pending,arbitration:pending');
assert.equal(modular.stepTotal, 5);
assert.equal(modular.stepIndex, 3);
assert.equal(modular.moduleLabel, '模块 2/2：状态契约与类型定义');
console.log('✓ modular orchestration prepends decomposition and exposes module label');

// —— 13. 未指派验证官但阶段已到 verification：节点临时纳入 ——
const verificationStageWithoutRole = deriveTopicProgressView({
  topic: makeTopic({ status: 'investigating', gameStage: 'verification' }),
  messages: [makeMessage({ gameStage: 'verification', isPending: true, authorName: '戴宗' })],
});
assert.ok(verificationStageWithoutRole);
assert.equal(
  states(verificationStageWithoutRole),
  'proposal:done,challenge:done,verification:active,defense:pending,arbitration:pending'
);
console.log('✓ verification node is included when the stage itself is current');

// —— 14. 等待接力：有推进证据但无活跃执行 ——
const queued = deriveTopicProgressView({
  topic: makeTopic({ status: 'investigating', gameStage: 'challenge' }),
  messages: [],
  executions: [],
});
assert.ok(queued);
assert.equal(states(queued), 'proposal:done,challenge:queued,defense:pending,arbitration:pending');
assert.ok(queued.headline.includes('等待接力'));
assert.equal(queued.isActive, false);
console.log('✓ stage gap renders as queued instead of active');

// —— 15. 签名稳定性：语义相同即签名字节一致 ——
const signatureA = topicProgressViewSignature(
  deriveTopicProgressView({ topic: makeTopic(), messages: [] })
);
const signatureB = topicProgressViewSignature(
  deriveTopicProgressView({ topic: makeTopic(), messages: [] })
);
assert.equal(signatureA, signatureB);
const signatureC = topicProgressViewSignature(
  deriveTopicProgressView({ topic: makeTopic({ gameStage: 'challenge' }), messages: [] })
);
assert.notEqual(signatureA, signatureC);
console.log('✓ progress signature is stable and changes with semantics');

// —— 16. 耗时格式化边界 ——
assert.equal(formatProgressElapsed(-5_000), '0s');
assert.equal(formatProgressElapsed(59_999), '59s');
assert.equal(formatProgressElapsed(60_000), '1m00s');
assert.equal(formatProgressElapsed(3_661_000), '61m01s');
console.log('✓ elapsed formatting handles zero, negative, and minute boundaries');

// —— 17. 静态渲染冒烟：进行中 / 熔断 / 终态的关键语义与语义色必须出现在 DOM ——
const renderView = (view: ReturnType<typeof deriveTopicProgressView>) => {
  assert.ok(view);
  return renderToStaticMarkup(createElement(TopicProgressStrip, { view }));
};

const activeRender = renderView(
  deriveTopicProgressView({
    topic: makeTopic({ status: 'investigating', gameStage: 'proposal' }),
    messages: [
      makeMessage({
        gameStage: 'proposal',
        isPending: true,
        authorName: '吴用',
        startedAt: Date.now(),
      }),
    ],
  })
);
assert.ok(activeRender.includes('animate-spin'));
assert.ok(activeRender.includes('吴用 正在起草提案'));
assert.ok(activeRender.includes('text-purple-600'));

const failedRender = renderView(
  deriveTopicProgressView({
    topic: makeTopic({
      status: 'investigating',
      gameStage: 'stageFailed',
      gameTheoreticState: {
        currentStage: 'stageFailed',
        quorumAlert: '红队挑战者未产出结构化批判规范，阶段熔断',
      } as GameTheoreticState,
    }),
    messages: [],
  })
);
assert.ok(failedRender.includes('熔断原因'));
assert.ok(failedRender.includes('text-rose-600'));

const terminalRender = renderView(
  deriveTopicProgressView({
    topic: makeTopic({ status: 'resolved', gameStage: 'concluded' }),
    messages: [],
  })
);
assert.ok(terminalRender.includes('text-emerald-600'));
assert.ok(terminalRender.includes('已定案'));
console.log('✓ static render exposes active / failed / terminal semantics and theme colors');

// —— 18. 无异议征询：仲裁完成后的逐角色复核必须可见 ——
const concurrenceState = (items: Array<{ agentId: string; agentName: string; role: 'proposer' | 'challenger' | 'verifier' | 'arbiter'; status: 'pending' | 'concurred' | 'objected' | 'conditional' | 'unavailable' | 'invalid' }>, allConcurred = false) => ({
  protocolVersion: 1 as const,
  solutionDigest: 'digest-1',
  isConcurrencePhaseActive: true,
  items,
  allConcurred,
});

const concurrenceActive = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameRoles: {
      proposers: ['p1', 'p2'],
      challengers: ['c1'],
      arbiters: ['a1'],
      humanIsArbiter: false,
    },
    gameTheoreticState: {
      currentStage: 'arbitration',
      concurrenceState: concurrenceState([
        { agentId: 'a1', agentName: '公孙胜', role: 'arbiter', status: 'concurred' },
        { agentId: 'p1', agentName: '吴用', role: 'proposer', status: 'pending' },
        { agentId: 'p2', agentName: '卢俊义', role: 'proposer', status: 'pending' },
      ]),
    } as GameTheoreticState,
  }),
  messages: [
    makeMessage({
      gameStage: 'arbitration',
      isPending: true,
      authorName: '吴用',
      startedAt: 5_000,
    }),
  ],
  executions: [makeExecution({ agentName: '吴用' })],
});
assert.ok(concurrenceActive);
assert.equal(concurrenceActive.phase, 'concurrence');
assert.equal(concurrenceActive.isActive, true);
assert.equal(concurrenceActive.isBlocked, false);
assert.ok(concurrenceActive.headline.includes('无异议征询 1/3'));
assert.ok(concurrenceActive.headline.includes('吴用 正在复核'));
console.log('✓ concurrence sub-phase exposes replied/total and current reviewer');

// —— 19. 无异议未达成：非 concurred 票必须阻断并转人工 ——
const concurrenceBlocked = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameTheoreticState: {
      currentStage: 'arbitration',
      concurrenceState: concurrenceState(
        [
          { agentId: 'a1', agentName: '公孙胜', role: 'arbiter', status: 'concurred' },
          { agentId: 'p1', agentName: '吴用', role: 'proposer', status: 'objected' },
          { agentId: 'p2', agentName: '卢俊义', role: 'proposer', status: 'concurred' },
        ],
        false
      ),
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(concurrenceBlocked);
assert.equal(concurrenceBlocked.phase, 'blocked');
assert.equal(concurrenceBlocked.isBlocked, true);
assert.equal(concurrenceBlocked.isActive, false);
assert.ok(concurrenceBlocked.headline.includes('无异议未达成'));
console.log('✓ objected concurrence blocks and hands off to a human');

// —— 20. 一致性门禁拦截：全员 concurred 但门禁消息存在 ——
const gateBlocked = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameTheoreticState: {
      currentStage: 'arbitration',
      concurrenceState: concurrenceState(
        [
          { agentId: 'a1', agentName: '公孙胜', role: 'arbiter', status: 'concurred' },
          { agentId: 'p1', agentName: '吴用', role: 'proposer', status: 'concurred' },
        ],
        true
      ),
    } as GameTheoreticState,
  }),
  messages: [makeMessage({ agentBadge: 'Gate Blocked', content: '一致性硬门禁未通过' })],
});
assert.ok(gateBlocked);
assert.equal(gateBlocked.phase, 'blocked');
assert.ok(gateBlocked.headline.includes('门禁拦截'));
console.log('✓ gate-blocked concurrence is surfaced distinctly');

// —— 21. 全员 concurred 且无门禁：等待终局落槌 ——
const concurrenceDone = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'arbitration',
    gameTheoreticState: {
      currentStage: 'arbitration',
      concurrenceState: concurrenceState(
        [
          { agentId: 'a1', agentName: '公孙胜', role: 'arbiter', status: 'concurred' },
          { agentId: 'p1', agentName: '吴用', role: 'proposer', status: 'concurred' },
        ],
        true
      ),
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(concurrenceDone);
assert.equal(concurrenceDone.phase, 'concurrence');
assert.equal(concurrenceDone.isBlocked, false);
assert.ok(concurrenceDone.headline.includes('等待终局落槌'));
console.log('✓ fully concurred phase waits for the final ruling');

// —— 22. 定案后的落地执行：不得提前显示「已定案」终态 ——
const executing = deriveTopicProgressView({
  topic: makeTopic({
    status: 'resolved',
    gameStage: 'concluded',
    gameTheoreticState: {
      currentStage: 'concluded',
      executionStatus: 'running',
      executionStartedAt: 9_000,
      executionSummary: '正在执行模块 [2/3: 状态契约与类型定义]',
      modularState: {
        enabled: true,
        modules: [
          makeModule('mod-1', '核心类型定义'),
          makeModule('mod-2', '状态契约与类型定义'),
          makeModule('mod-3', 'UI 接线'),
        ],
        activeModuleId: 'mod-2',
        executionCompletedCount: 1,
      },
    } as GameTheoreticState,
  }),
  messages: [],
  executions: [],
});
assert.ok(executing);
assert.equal(executing.phase, 'execution');
assert.equal(executing.isTerminal, false);
assert.equal(executing.isActive, true);
assert.equal(executing.activeStartedAt, 9_000);
assert.equal(
  states(executing),
  'decomposition:done,proposal:done,challenge:done,defense:done,arbitration:done,execution:active'
);
assert.ok(executing.headline.includes('落地执行'));
assert.ok(executing.headline.includes('状态契约与类型定义'));
assert.equal(executing.compactHeadline, '⚙️ 落地 1/3');
console.log('✓ running execution is a separate phase instead of premature terminal');

// —— 23. 落地失败：定位执行节点并展示失败原因 ——
const executionFailed = deriveTopicProgressView({
  topic: makeTopic({
    status: 'resolved',
    gameStage: 'concluded',
    gameTheoreticState: {
      currentStage: 'concluded',
      executionStatus: 'failed',
      executionSummary: '工作区合并冲突：src/App.tsx',
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(executionFailed);
assert.equal(executionFailed.phase, 'failed');
assert.equal(executionFailed.isFailed, true);
assert.equal(executionFailed.failureText, '工作区合并冲突：src/App.tsx');
assert.ok(executionFailed.headline.includes('落地失败'));
assert.ok(states(executionFailed).endsWith('execution:failed'));
console.log('✓ execution failure is surfaced with its reason');

// —— 24. 落地完成 / 已合入：终态文案区分 ——
const executionCompleted = deriveTopicProgressView({
  topic: makeTopic({
    status: 'resolved',
    gameStage: 'concluded',
    gameTheoreticState: {
      currentStage: 'concluded',
      executionStatus: 'completed',
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(executionCompleted);
assert.equal(executionCompleted.isTerminal, true);
assert.ok(executionCompleted.headline.includes('待合入工作区'));

const executionApplied = deriveTopicProgressView({
  topic: makeTopic({
    status: 'resolved',
    gameStage: 'concluded',
    gameTheoreticState: {
      currentStage: 'concluded',
      executionStatus: 'applied',
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(executionApplied);
assert.equal(executionApplied.isTerminal, true);
assert.equal(executionApplied.phase, 'terminal');
assert.ok(executionApplied.headline.includes('已合入工作区'));
console.log('✓ completed / applied execution states are distinguished');

// —— 25. cognoNexus.modularState 回落：双镜像位置均应读取 ——
const mirroredModular = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'challenge',
    gameTheoreticState: {
      currentStage: 'challenge',
      cognoNexus: {
        modularState: {
          enabled: true,
          modules: [makeModule('mod-1', '核心类型定义'), makeModule('mod-2', '状态契约与类型定义')],
          activeModuleId: 'mod-2',
        },
      },
    } as GameTheoreticState,
  }),
  messages: [],
});
assert.ok(mirroredModular);
assert.ok(states(mirroredModular).startsWith('decomposition:done'));
assert.equal(mirroredModular.moduleLabel, '模块 2/2：状态契约与类型定义');
console.log('✓ modular state falls back to cognoNexus mirror');

// —— 26. 多角色阶段回复计数 ——
const multiActor = deriveTopicProgressView({
  topic: makeTopic({
    status: 'investigating',
    gameStage: 'proposal',
    gameRoles: {
      proposers: ['p1', 'p2'],
      challengers: ['c1'],
      arbiters: ['a1'],
      humanIsArbiter: false,
    },
  }),
  messages: [
    makeMessage({ authorId: 'p1', authorName: '吴用', gameStage: 'proposal' }),
    makeMessage({ authorId: 'p2', authorName: '卢俊义', gameStage: 'proposal', isPending: true }),
  ],
  executions: [makeExecution({ agentId: 'p2', agentName: '卢俊义' })],
});
assert.ok(multiActor);
assert.deepEqual(multiActor.actorProgress, { done: 1, total: 2 });
assert.ok(multiActor.headline.includes('已回复 1/2'));
console.log('✓ per-stage participant reply counts are derived from the roster');

// —— 27. 停滞判定：仅活跃且心跳超阈值时告警 ——
const heartbeatNow = 1_000_000;
const activeWithHeartbeat = deriveTopicProgressView({
  topic: makeTopic({ status: 'investigating', gameStage: 'proposal' }),
  messages: [
    makeMessage({
      gameStage: 'proposal',
      isPending: true,
      authorName: '吴用',
      startedAt: heartbeatNow - 30_000,
    }),
  ],
  executions: [
    makeExecution({ agentName: '吴用', startedAt: heartbeatNow - 30_000, lastHeartbeatAt: heartbeatNow - 5_000 }),
  ],
});
assert.ok(activeWithHeartbeat);
assert.equal(activeWithHeartbeat.lastHeartbeatAt, heartbeatNow - 5_000);
assert.equal(isProgressStalled(activeWithHeartbeat, heartbeatNow), false);
assert.equal(
  isProgressStalled(activeWithHeartbeat, heartbeatNow + PROGRESS_STALL_THRESHOLD_MS + 1),
  true
);
assert.equal(isProgressStalled(concluded, heartbeatNow + PROGRESS_STALL_THRESHOLD_MS * 10), false);
console.log('✓ stall detection uses heartbeat age only while active');

// —— 28. 标准协同模式：活跃回复者与终态 ——
const standardActive = deriveTopicProgressView({
  topic: makeTopic({ discussionMode: 'standard', status: 'investigating' }),
  messages: [
    makeMessage({ isPending: true, authorName: '宋江', startedAt: 2_000 }),
  ],
});
assert.ok(standardActive);
assert.equal(standardActive.mode, 'standard');
assert.equal(standardActive.isActive, true);
assert.ok(standardActive.headline.includes('宋江 正在回复'));

const standardTerminal = deriveTopicProgressView({
  topic: makeTopic({ discussionMode: 'standard', status: 'resolved' }),
  messages: [],
});
assert.ok(standardTerminal);
assert.equal(standardTerminal.isTerminal, true);
assert.ok(standardTerminal.headline.includes('已定案'));
console.log('✓ standard collaboration mode exposes active responders and terminal state');

// —— 29. DM 双方博弈：当前发言方与人类/Agent 角色映射 ——
const dmDuelActive = deriveTopicProgressView({
  topic: makeTopic({
    scopeType: 'dm',
    dmAgentId: 'agent-dm',
    duelRoles: { proposer: 'human', challenger: 'agent' },
    status: 'investigating',
  }),
  messages: [
    makeMessage({
      authorId: 'agent-dm',
      authorName: '燕青',
      isPending: true,
      startedAt: 3_000,
    }),
  ],
  executions: [makeExecution({ agentId: 'agent-dm', agentName: '燕青', startedAt: 3_000 })],
});
assert.ok(dmDuelActive);
assert.equal(dmDuelActive.mode, 'dm_duel');
assert.ok(dmDuelActive.headline.includes('燕青 正在质询'));
assert.equal(dmDuelActive.activeStartedAt, 3_000);
console.log('✓ DM duel maps the active side to the configured roles');

// —— 30. 节点点击：提供回调时渲染可访问按钮，未开始节点禁用 ——
const clickableMarkup = renderToStaticMarkup(
  createElement(TopicProgressStrip, {
    view: activeWithHeartbeat,
    onSelectNode: () => {},
  })
);
assert.ok(clickableMarkup.includes('<button'));
assert.ok(clickableMarkup.includes('跳转到提案立论'));
assert.ok(clickableMarkup.includes('disabled=""'));
console.log('✓ node dots become jump buttons when a handler is provided');

// —— 31. 标准 / DM / 执行态静态渲染冒烟 ——
const standardMarkup = renderToStaticMarkup(
  createElement(TopicProgressStrip, { view: standardActive })
);
assert.ok(standardMarkup.includes('协同讨论'));
assert.ok(standardMarkup.includes('animate-spin'));

const dmMarkup = renderToStaticMarkup(
  createElement(TopicProgressStrip, { view: dmDuelActive })
);
assert.ok(dmMarkup.includes('双方博弈'));

const executionMarkup = renderToStaticMarkup(
  createElement(TopicProgressStrip, { view: executing })
);
assert.ok(executionMarkup.includes('落地执行'));
assert.ok(executionMarkup.includes('text-purple-600'));

const blockedMarkup = renderToStaticMarkup(
  createElement(TopicProgressStrip, { view: concurrenceBlocked })
);
assert.ok(blockedMarkup.includes('text-amber-600'));
console.log('✓ static render covers standard / DM / execution / blocked phases');

console.log('All Topic Progress View tests passed.');
