import { memo, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { WorkflowStageKey } from '../types';
import { formatProgressElapsed } from '../services/topicProgressView';
import {
  workflowProgressSignature,
  type WorkflowProgressNodeState,
  type WorkflowProgressView,
} from '../services/workflow';

interface WorkflowProgressStripProps {
  view: WorkflowProgressView;
  /** 点击阶段节点跳转到该阶段的消息 */
  onSelectStage?: (key: WorkflowStageKey) => void;
}

const NODE_STATE_LABEL: Record<WorkflowProgressNodeState, string> = {
  pending: '未开始',
  active: '进行中',
  done: '已完成',
  failed: '已失败',
  skipped: '已跳过',
};

function nodeDotClass(state: WorkflowProgressNodeState): string {
  switch (state) {
    case 'done':
      return 'bg-emerald-500';
    case 'active':
      return 'bg-emerald-500 ring-2 ring-emerald-500/25 animate-pulse';
    case 'failed':
      return 'bg-rose-500';
    case 'skipped':
      return 'bg-amber-400/70';
    default:
      return 'bg-border';
  }
}

function WorkflowProgressStripInner({ view, onSelectStage }: WorkflowProgressStripProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!view.isActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.isActive, view.startedAt]);

  const elapsedLabel =
    view.isActive && view.startedAt != null
      ? formatProgressElapsed(now - view.startedAt)
      : undefined;

  const status = view.isFailed
    ? { Icon: AlertTriangle, className: 'text-rose-600 dark:text-rose-400' }
    : view.isBlocked
      ? { Icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' }
      : view.isTerminal
        ? { Icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' }
        : view.isActive
          ? { Icon: Loader2, className: 'text-emerald-600 dark:text-emerald-400 animate-spin' }
          : { Icon: Clock, className: 'text-fg-muted' };

  const StatusIcon = status.Icon;
  const activeNode = view.nodes.find((node) => node.state === 'active');
  const activeAgents = activeNode?.agentNames.filter(Boolean) || [];

  return (
    <div className="@container shrink-0 border-b border-border bg-surface-subtle/60 px-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${status.className}`} />

        {view.nodes.length > 0 && (
          <div className="hidden @md:flex items-center gap-1 shrink-0">
            {view.nodes.map((node, index) => {
              const label = `${node.icon} ${node.label} · ${NODE_STATE_LABEL[node.state]}`;
              const dot = (
                <span className={`w-1.5 h-1.5 rounded-full ${nodeDotClass(node.state)}`} />
              );
              return (
                <span key={node.key} className="flex items-center gap-1">
                  {index > 0 && <span className="h-px w-2 bg-border" aria-hidden="true" />}
                  {onSelectStage ? (
                    <button
                      type="button"
                      onClick={() => onSelectStage(node.key)}
                      disabled={node.state === 'pending'}
                      title={node.state === 'pending' ? label : `跳转到${node.label}`}
                      aria-label={label}
                      className="flex items-center justify-center w-3 h-3 rounded-full transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      {dot}
                    </button>
                  ) : (
                    <span title={label}>{dot}</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        <span
          className="truncate min-w-0 text-[11px] font-medium text-fg"
          title={view.headline}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="hidden @md:inline">{view.headline}</span>
          <span className="@md:hidden">{view.compactHeadline}</span>
        </span>

        {activeAgents.length > 0 && (
          <span
            className="hidden @2xl:inline shrink-0 max-w-[180px] truncate text-[10px] text-fg-muted"
            title={activeAgents.join('、')}
          >
            {activeAgents.join('、')}
          </span>
        )}

        {elapsedLabel ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
            {elapsedLabel}
          </span>
        ) : null}
      </div>

      {view.isBlocked && view.blockingReason && (
        <div
          className="mt-1 flex items-start gap-1 min-w-0 text-[10px] text-amber-700 dark:text-amber-300"
          title={view.blockingReason}
        >
          <span className="shrink-0 font-semibold">阻断原因</span>
          <span className="truncate min-w-0">{view.blockingReason}</span>
        </div>
      )}
      {view.isFailed && view.blockingReason && (
        <div
          className="mt-1 flex items-start gap-1 min-w-0 text-[10px] text-rose-700 dark:text-rose-300"
          title={view.blockingReason}
        >
          <span className="shrink-0 font-semibold">失败原因</span>
          <span className="truncate min-w-0">{view.blockingReason}</span>
        </div>
      )}
    </div>
  );
}

export const WorkflowProgressStrip = memo(
  WorkflowProgressStripInner,
  (prev, next) =>
    prev.onSelectStage === next.onSelectStage &&
    workflowProgressSignature(prev.view) === workflowProgressSignature(next.view)
);
