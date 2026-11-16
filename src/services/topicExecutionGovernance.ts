import type {
  ActiveAgentExecution,
  GameTheoreticStage,
  GameTheoreticState,
  TaskModuleSlice,
  TopicPatchDiffItem,
} from '../types';
import {
  computeTopologicalExecutionOrder,
  mergeTopicPatchDiffs,
} from './cogno/bayesianModuleGovernor';

type ExecutionIdentity = Pick<ActiveAgentExecution, 'agentId' | 'threadId' | 'topicId'>;

export interface TopicModuleExecutionMilestone {
  moduleId: string;
  title: string;
  summary: string;
  touchedFiles: string[];
}

export interface ModularExecutionResumeState {
  orderedModules: TaskModuleSlice[];
  completedModuleIds: Set<string>;
  accumulatedDiffs: TopicPatchDiffItem[];
  priorMilestones: TopicModuleExecutionMilestone[];
}

export interface TopicExecutionInterruptionOptions {
  summary: string;
  executionDiffs?: TopicPatchDiffItem[];
  fallbackStage?: GameTheoreticStage;
}

export function isSameTopicExecutionInFlight(
  executions: Record<string, ExecutionIdentity>,
  topicId: string,
  agentId: string
): boolean {
  return Object.values(executions).some(
    (execution) =>
      (execution.topicId === topicId || execution.threadId === topicId) &&
      execution.agentId === agentId
  );
}

export function isExecutorBusyElsewhere(
  executions: Record<string, ExecutionIdentity>,
  topicId: string,
  agentId: string
): boolean {
  return Object.values(executions).some(
    (execution) =>
      execution.agentId === agentId &&
      execution.topicId !== topicId &&
      execution.threadId !== topicId
  );
}

export function removeTopicExecutionLock<T extends ExecutionIdentity>(
  executions: Record<string, T>,
  topicId: string,
  agentId: string
): Record<string, T> {
  const next = { ...executions };
  for (const [key, execution] of Object.entries(next)) {
    if (
      execution.agentId === agentId &&
      (execution.topicId === topicId || execution.threadId === topicId)
    ) {
      delete next[key];
    }
  }
  return next;
}

/**
 * 生成断点续跑种子：已完成模块只复用持久化的 Diff 与里程碑，不重新派发 ACP。
 */
export function buildModularExecutionResumeState(
  modules: TaskModuleSlice[],
  existingDiffs: TopicPatchDiffItem[] = []
): ModularExecutionResumeState {
  const orderedModules = computeTopologicalExecutionOrder(modules);
  let accumulatedDiffs = [...existingDiffs];
  const completedModuleIds = new Set<string>();
  const priorMilestones: TopicModuleExecutionMilestone[] = [];

  for (const moduleSlice of orderedModules) {
    if (moduleSlice.executionStatus !== 'completed') continue;
    completedModuleIds.add(moduleSlice.moduleId);
    if (moduleSlice.executionDiffs && moduleSlice.executionDiffs.length > 0) {
      accumulatedDiffs = mergeTopicPatchDiffs(accumulatedDiffs, moduleSlice.executionDiffs);
    }
    priorMilestones.push({
      moduleId: moduleSlice.moduleId,
      title: moduleSlice.title,
      summary: moduleSlice.executionSummary || '前置已完成',
      touchedFiles: (moduleSlice.executionDiffs || []).map((diff) => diff.filename),
    });
  }

  return {
    orderedModules,
    completedModuleIds,
    accumulatedDiffs,
    priorMilestones,
  };
}

/**
 * 将执行状态统一收敛为可重试的 failed，保留已完成模块与已产出的 Diff。
 */
export function markTopicExecutionInterrupted(
  state: GameTheoreticState | undefined,
  options: TopicExecutionInterruptionOptions
): GameTheoreticState {
  const baseState: GameTheoreticState =
    state || { currentStage: options.fallbackStage || 'concluded' };
  const nextDiffs =
    options.executionDiffs !== undefined ? options.executionDiffs : baseState.executionDiffs;
  const modularState = baseState.modularState
    ? {
        ...baseState.modularState,
        activeExecutionModuleId: undefined,
        modules: baseState.modularState.modules.map((moduleSlice) =>
          moduleSlice.executionStatus === 'running'
            ? { ...moduleSlice, executionStatus: 'failed' as const }
            : moduleSlice
        ),
      }
    : undefined;

  return {
    ...baseState,
    executionStatus: 'failed',
    executionSummary: options.summary,
    ...(nextDiffs !== undefined ? { executionDiffs: nextDiffs } : {}),
    ...(modularState ? { modularState } : {}),
  };
}
