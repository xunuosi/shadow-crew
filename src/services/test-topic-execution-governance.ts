import assert from 'node:assert/strict';
import type {
  ActiveAgentExecution,
  GameTheoreticState,
  TaskModuleSlice,
  TopicPatchDiffItem,
} from '../types';
import {
  buildModularExecutionResumeState,
  isExecutorBusyElsewhere,
  isSameTopicExecutionInFlight,
  markTopicExecutionInterrupted,
  removeTopicExecutionLock,
} from './topicExecutionGovernance';

console.log('🧪 [Topic Execution Governance] Starting execution guard and recovery verification...\n');

const runningExecution = {
  agentId: 'agent-exec',
  threadId: 'topic-1',
  topicId: 'topic-1',
} as ActiveAgentExecution;

const executions = { 'topic-1:agent-exec': runningExecution };

assert.equal(
  isSameTopicExecutionInFlight(executions, 'topic-1', 'agent-exec'),
  true,
  '同一议题同一执行官必须命中重入守卫'
);
assert.equal(
  isSameTopicExecutionInFlight(executions, 'topic-1', 'agent-other'),
  false,
  '不同执行官不应命中同一重入守卫'
);
assert.equal(
  isSameTopicExecutionInFlight(executions, 'topic-2', 'agent-exec'),
  false,
  '同一执行官在其他议题不构成同议题重入'
);
assert.equal(
  isExecutorBusyElsewhere(
    {
      'topic-1:agent-exec': runningExecution,
    },
    'topic-2',
    'agent-exec'
  ),
  true,
  '执行官在其他议题忙碌时必须进入 queued'
);

const nextExecutions = removeTopicExecutionLock(executions, 'topic-1', 'agent-exec');
assert.deepEqual(nextExecutions, {}, '中断收敛必须释放同议题执行锁');
assert.equal(executions['topic-1:agent-exec'] === runningExecution, true, '释放执行锁不得原地修改输入');

const diffM1: TopicPatchDiffItem = {
  filename: 'src/types/order.ts',
  additions: 12,
  deletions: 0,
  diff: '+export interface Order {}',
};
const diffM2: TopicPatchDiffItem = {
  filename: 'src/services/order.ts',
  additions: 20,
  deletions: 2,
  diff: '+export class OrderService {}',
};

const makeModule = (
  moduleId: string,
  dependsOnModuleIds: string[],
  executionStatus: TaskModuleSlice['executionStatus'],
  executionDiffs?: TopicPatchDiffItem[]
): TaskModuleSlice => ({
  moduleId,
  title: `模块 ${moduleId}`,
  responsibility: '测试模块',
  allowedFiles: executionDiffs?.map((diff) => diff.filename) || [],
  dependsOnModuleIds,
  complexityLevel: 'medium_standard',
  status: executionStatus === 'completed' ? 'frozen' : 'failed',
  belief: {
    priorRisk: 0.45,
    posteriorRisk: 0.3,
    routingMode: 'deep_debate',
    feedbackVector: {
      contractViolations: 0,
      verifiedClaims: 1,
      refutedClaims: 0,
      edgeCaseCount: 0,
      dssScore: 0,
    },
    lastUpdatedAt: '2026-11-14T00:00:00.000Z',
  },
  scopedMessageIds: [],
  executionStatus,
  executionDiffs,
  executionSummary: executionStatus === 'completed' ? '模块已完成' : undefined,
});

const resumeState = buildModularExecutionResumeState(
  [
    makeModule('m1', [], 'completed', [diffM1]),
    makeModule('m2', ['m1'], 'failed'),
    makeModule('m3', ['m2'], undefined),
  ],
  [diffM2]
);

assert.equal(resumeState.orderedModules.length, 3);
assert.deepEqual(
  Array.from(resumeState.completedModuleIds),
  ['m1'],
  '断点续跑只能跳过 already completed 模块'
);
assert.equal(resumeState.priorMilestones.length, 1);
assert.deepEqual(
  resumeState.accumulatedDiffs.map((diff) => diff.filename).sort(),
  ['src/services/order.ts', 'src/types/order.ts'],
  '续跑种子必须合并已有顶层 Diff 与完成模块 Diff'
);

const interruptedState: GameTheoreticState = {
  currentStage: 'concluded',
  executionStatus: 'running',
  executionDiffs: [diffM2],
  modularState: {
    enabled: true,
    modules: [
      makeModule('m1', [], 'completed', [diffM1]),
      makeModule('m2', ['m1'], 'running'),
      makeModule('m3', ['m2'], undefined),
    ],
    activeExecutionModuleId: 'm2',
  },
};

const failedState = markTopicExecutionInterrupted(interruptedState, {
  summary: 'G-Frame 落地执行已中断',
  executionDiffs: [diffM1, diffM2],
});

assert.equal(failedState.executionStatus, 'failed');
assert.equal(failedState.executionSummary, 'G-Frame 落地执行已中断');
assert.equal(failedState.modularState?.activeExecutionModuleId, undefined);
assert.equal(failedState.modularState?.modules[0].executionStatus, 'completed');
assert.equal(failedState.modularState?.modules[1].executionStatus, 'failed');
assert.equal(failedState.modularState?.modules[2].executionStatus, undefined);
assert.equal(failedState.executionDiffs?.length, 2, '中断收敛不得丢失已生成 Diff');

const queuedOnly = markTopicExecutionInterrupted(
  {
    currentStage: 'concluded',
    executionStatus: 'queued',
  },
  { summary: '排队执行已取消' }
);
assert.equal(queuedOnly.executionStatus, 'failed');
assert.equal(queuedOnly.executionSummary, '排队执行已取消');

console.log('✓ 同议题重入与跨议题忙碌守卫通过');
console.log('✓ completed 模块跳过、Diff 合并与断点续跑种子通过');
console.log('✓ stale/中断状态统一收敛为 failed，保留 completed 模块与 Diff');
console.log('\n🎉 Topic Execution Governance tests passed.\n');
