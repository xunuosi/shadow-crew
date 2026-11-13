import { memo, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import {
  formatProgressElapsed,
  isProgressStalled,
  topicProgressViewSignature,
  type TopicProgressNodeKey,
  type TopicProgressNodeState,
  type TopicProgressView,
} from '../services/topicProgressView';

interface TopicProgressStripProps {
  view: TopicProgressView;
  /** 点击阶段节点跳转到对应消息；未提供时节点只作为只读指示 */
  onSelectNode?: (key: TopicProgressNodeKey) => void;
}

const NODE_STATE_LABEL: Record<TopicProgressNodeState, string> = {
  pending: '未开始',
  queued: '等待接力',
  active: '进行中',
  done: '已完成',
  bypassed: '已旁路',
  absent: '未响应',
  failed: '已熔断',
};

function nodeDotClass(state: TopicProgressNodeState): string {
  switch (state) {
    case 'done':
      return 'bg-emerald-500';
    case 'active':
      return 'bg-purple-500 ring-2 ring-purple-500/25 animate-pulse';
    case 'failed':
      return 'bg-rose-500';
    case 'bypassed':
    case 'absent':
      return 'bg-amber-500';
    case 'queued':
      return 'bg-amber-400/70';
    default:
      return 'bg-border';
  }
}

function TopicProgressStripInner({ view, onSelectNode }: TopicProgressStripProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!view.isActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.isActive, view.activeStartedAt, view.lastHeartbeatAt]);

  const elapsedLabel =
    view.isActive && view.activeStartedAt != null
      ? formatProgressElapsed(now - view.activeStartedAt)
      : undefined;

  const stalled = isProgressStalled(view, now);
  const stallLabel =
    stalled && view.lastHeartbeatAt != null
      ? `无心跳 ${formatProgressElapsed(now - view.lastHeartbeatAt)}`
      : undefined;

  const status = view.isFailed
    ? { Icon: AlertTriangle, className: 'text-rose-600 dark:text-rose-400' }
    : stalled || view.isBlocked
      ? { Icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' }
      : view.isTerminal
        ? { Icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' }
        : view.isActive
          ? { Icon: Loader2, className: 'text-purple-600 dark:text-purple-400 animate-spin' }
          : { Icon: Clock, className: 'text-fg-muted' };

  const StatusIcon = status.Icon;
  const nowTitle = `${view.headline}${stallLabel ? `（${stallLabel}）` : ''}`;

  return (
    <div className="@container shrink-0 border-b border-border bg-surface-subtle/60 px-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${status.className}`} />

        {/* 阶段节点圆点：窄分栏下隐藏，避免与标题争抢 */}
        {view.nodes.length > 0 && (
          <div className="hidden @md:flex items-center gap-1 shrink-0">
            {view.nodes.map((node, index) => {
              const label = `${node.icon} ${node.label} · ${NODE_STATE_LABEL[node.state]}`;
              const dot = <span className={`w-1.5 h-1.5 rounded-full ${nodeDotClass(node.state)}`} />;
              return (
                <span key={node.key} className="flex items-center gap-1">
                  {index > 0 && <span className="h-px w-2 bg-border" aria-hidden="true" />}
                  {onSelectNode ? (
                    <button
                      type="button"
                      onClick={() => onSelectNode(node.key)}
                      disabled={node.state === 'pending'}
                      title={node.state === 'pending' ? label : `跳转到${node.label}`}
                      aria-label={label}
                      className="flex items-center justify-center w-3 h-3 rounded-full transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 disabled:cursor-default disabled:hover:bg-transparent"
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
          title={nowTitle}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="hidden @md:inline">{view.headline}</span>
          <span className="@md:hidden">{view.compactHeadline}</span>
        </span>

        {view.moduleLabel && (
          <span
            className="hidden @2xl:inline shrink-0 max-w-[180px] truncate font-mono text-[10px] text-fg-muted"
            title={view.moduleLabel}
          >
            {view.moduleLabel}
          </span>
        )}

        {stallLabel ? (
          <span
            className="ml-auto shrink-0 font-mono text-[10px] text-amber-600 dark:text-amber-400"
            title="ACP 思考心跳已超过 90 秒未更新，可能卡在模型网关或工具调用"
          >
            ⚠️ {stallLabel}
          </span>
        ) : elapsedLabel ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
            {elapsedLabel}
          </span>
        ) : null}
      </div>

      {view.isFailed && view.failureText && (
        <div
          className="mt-1 flex items-start gap-1 min-w-0 text-[10px] text-rose-700 dark:text-rose-300"
          title={view.failureText}
        >
          <span className="shrink-0 font-semibold">熔断原因</span>
          <span className="truncate min-w-0">{view.failureText}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 只读进度条：仅当语义签名变化时重渲染。
 * 内部 1s 计时器只驱动自身耗时/停滞文案，不会向父组件冒泡 setState。
 */
export const TopicProgressStrip = memo(
  TopicProgressStripInner,
  (prev, next) =>
    prev.onSelectNode === next.onSelectNode &&
    topicProgressViewSignature(prev.view) === topicProgressViewSignature(next.view)
);
