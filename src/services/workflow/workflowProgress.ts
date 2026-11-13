import type { TopicWorkflowState, WorkflowStageKey } from '../../types';
import { getWorkflowModeMeta, getWorkflowStageSpec } from './workflowSpec';

export type WorkflowProgressNodeState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface WorkflowProgressNode {
  key: WorkflowStageKey;
  label: string;
  icon: string;
  state: WorkflowProgressNodeState;
  agentNames: string[];
}

export interface WorkflowProgressView {
  modeLabel: string;
  headline: string;
  compactHeadline: string;
  nodes: WorkflowProgressNode[];
  status: TopicWorkflowState['status'];
  isActive: boolean;
  isTerminal: boolean;
  isFailed: boolean;
  isBlocked: boolean;
  isCancelled: boolean;
  startedAt?: number;
  verdict?: string;
  blockingReason?: string;
  countLabel: string;
}

const STATUS_LABEL: Record<TopicWorkflowState['status'], string> = {
  idle: '待启动',
  running: '进行中',
  completed: '已完成',
  blocked: '已阻断',
  failed: '已失败',
  cancelled: '已取消',
};

/** 供 memo 组件做语义比较，避免每次父组件渲染都重绘进度条 */
export function workflowProgressSignature(view: WorkflowProgressView): string {
  return [
    view.status,
    view.verdict || '',
    view.blockingReason || '',
    view.headline,
    view.nodes
      .map((node) => `${node.key}:${node.state}:${node.agentNames.join('|')}`)
      .join(';'),
  ].join('::');
}

export function buildWorkflowProgressView(
  state: TopicWorkflowState,
  resolveAgentName?: (agentId: string) => string | undefined
): WorkflowProgressView {
  const meta = getWorkflowModeMeta(state.mode);
  const nodes: WorkflowProgressNode[] = state.stages.map((record) => {
    const spec = getWorkflowStageSpec(record.key);
    // 接力到的下一阶段在执行开始前仍处于 pending，对用户应表现为「进行中」
    const derivedState: WorkflowProgressNodeState =
      state.status === 'running' &&
      record.key === state.currentStageKey &&
      record.state === 'pending'
        ? 'active'
        : record.state;
    return {
      key: record.key,
      label: spec.label,
      icon: spec.icon,
      state: derivedState,
      agentNames: record.agentIds
        .map((id) => resolveAgentName?.(id) || id)
        .filter(Boolean),
    };
  });
  const doneCount = nodes.filter((node) => node.state === 'done').length;
  const total = nodes.filter((node) => node.state !== 'skipped').length;
  const currentRecord = state.stages.find((record) => record.key === state.currentStageKey);
  const currentSpec = state.currentStageKey
    ? getWorkflowStageSpec(state.currentStageKey)
    : undefined;
  const currentLabel = currentSpec?.label || currentRecord?.key || '';
  const isActive = state.status === 'running';
  const isTerminal = state.status === 'completed';
  const isFailed = state.status === 'failed';
  const isBlocked = state.status === 'blocked';
  const isCancelled = state.status === 'cancelled';
  const countLabel = `${doneCount}/${total}`;
  // 续跑轮次必须在进度上可辨认，避免用户误以为又跑了一遍首轮。
  const roundPrefix = state.round && state.round > 1 ? `第 ${state.round} 轮 · ` : '';

  let headline: string;
  if (isTerminal) {
    headline = `${roundPrefix}${meta.label} · 已完成${state.verdict ? `（${state.verdict}）` : ''}`;
  } else if (isBlocked) {
    headline = `${roundPrefix}${meta.label} · 已阻断`;
  } else if (isFailed) {
    headline = `${roundPrefix}${meta.label} · 执行失败`;
  } else if (isActive && currentSpec) {
    headline = `${roundPrefix}${meta.label} · ${currentSpec.icon} ${currentLabel} ${countLabel}`;
  } else {
    headline = `${roundPrefix}${meta.label} · ${STATUS_LABEL[state.status]}`;
  }

  return {
    modeLabel: meta.label,
    headline,
    compactHeadline: isActive && currentSpec ? `${currentSpec.icon} ${currentLabel} ${countLabel}` : headline,
    nodes,
    status: state.status,
    isActive,
    isTerminal,
    isFailed,
    isBlocked,
    isCancelled,
    startedAt: state.startedAt,
    verdict: state.verdict,
    blockingReason: state.blockingReason,
    countLabel,
  };
}
