import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopicProgressStrip } from '../components/TopicProgressStrip';
import {
  deriveTopicProgressView,
  formatProgressElapsed,
  topicProgressViewSignature,
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

// —— 1. 作用域守卫：普通协同 / DM 双人博弈不展示 ——
assert.equal(
  deriveTopicProgressView({ topic: makeTopic({ discussionMode: 'standard' }), messages: [] }),
  null
);
assert.equal(
  deriveTopicProgressView({ topic: makeTopic({ scopeType: 'dm' }), messages: [] }),
  null
);
assert.equal(deriveTopicProgressView({ topic: null, messages: [] }), null);
console.log('✓ standard / DM / absent topics are excluded');

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

console.log('All Topic Progress View tests passed.');
