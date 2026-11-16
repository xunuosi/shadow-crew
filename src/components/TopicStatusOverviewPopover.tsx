import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileText,
  LayoutGrid,
  Loader2,
  Puzzle,
  Square,
  SquareTerminal,
} from 'lucide-react';
import type {
  ActiveAgentExecution,
  Agent,
  Message,
  TopicMessageData,
  TopicPatchDiffItem,
} from '../types';
import {
  buildTopicStatusOverview,
  type TopicOverviewAgentItem,
  type TopicStageStepStatus,
} from '../services/topicStatusOverview';

interface TopicStatusOverviewPopoverProps {
  topic: TopicMessageData;
  messages: Message[];
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  allActiveExecutions?: ActiveAgentExecution[];
  topicExecutionDiffs?: TopicPatchDiffItem[];
  now?: number;
  isHeaderCollapsed: boolean;
  onToggleHeaderCollapsed: () => void;
  onAbortAgent?: (agentId: string) => void;
  onAbortAll?: () => void;
  onSwitchDrawerView: (view: 'stream' | 'adr') => void;
  onOpenCodexDiff: () => void;
  onScrollToMessage: (messageId: string) => void;
  onScrollToRulingOrBottom: () => void;
}

const DEFAULT_VISIBLE_AGENTS = 4;

function getStepChipClass(status: TopicStageStepStatus): string {
  switch (status) {
    case 'active':
      return 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 font-semibold';
    case 'completed':
      return 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30';
    case 'bypassed':
      return 'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30';
    case 'warning':
      return 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30 font-semibold';
    default:
      return 'text-fg-muted bg-surface-subtle border-border';
  }
}

function getAgentStatePillClass(item: TopicOverviewAgentItem): string {
  switch (item.runState) {
    case 'running':
    case 'streaming':
      return 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 font-semibold';
    case 'concurred':
      return 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30';
    case 'objected':
      return 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30 font-semibold';
    case 'awaiting_turn':
      return 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30';
    case 'completed_turn':
      return 'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30';
    case 'queued_elsewhere':
      return 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30';
    default:
      return 'text-fg-muted bg-surface-subtle border-border';
  }
}

function getAgentIconColor(item: TopicOverviewAgentItem): string {
  switch (item.runState) {
    case 'running':
    case 'streaming':
      return 'text-purple-600 dark:text-purple-400';
    case 'concurred':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'objected':
      return 'text-rose-600 dark:text-rose-400';
    case 'awaiting_turn':
      return 'text-amber-600 dark:text-amber-400';
    case 'completed_turn':
      return 'text-blue-600 dark:text-blue-400';
    default:
      return 'text-fg-muted';
  }
}

export const TopicStatusOverviewPopover: React.FC<TopicStatusOverviewPopoverProps> = ({
  topic,
  messages,
  agents,
  activeExecutions = [],
  allActiveExecutions = [],
  topicExecutionDiffs,
  now,
  isHeaderCollapsed,
  onToggleHeaderCollapsed,
  onAbortAgent,
  onAbortAll,
  onSwitchDrawerView,
  onOpenCodexDiff,
  onScrollToMessage,
  onScrollToRulingOrBottom,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showFilesPreview, setShowFilesPreview] = useState(false);
  const [showWorkflowDetails, setShowWorkflowDetails] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const overview = useMemo(
    () =>
      buildTopicStatusOverview({
        topic,
        messages,
        agents,
        activeExecutions,
        allActiveExecutions,
        topicExecutionDiffs,
        now,
      }),
    [topic, messages, agents, activeExecutions, allActiveExecutions, topicExecutionDiffs, now]
  );

  // Reset per-topic expansion state when switching topics
  useEffect(() => {
    setShowAllAgents(false);
    setShowFilesPreview(false);
  }, [topic.id]);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const visibleAgents = showAllAgents
    ? overview.agentItems
    : overview.agentItems.slice(0, DEFAULT_VISIBLE_AGENTS);
  const hiddenAgentCount = Math.max(0, overview.agentItems.length - DEFAULT_VISIBLE_AGENTS);

  const triggerPillClass = overview.isTopicRunning
    ? 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 hover:opacity-90'
    : overview.overallState === 'resolved'
    ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30 hover:opacity-90'
    : overview.overallState === 'stage_failed'
    ? 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30 hover:opacity-90'
    : overview.overallState === 'awaiting_ruling' || overview.overallState === 'concurrence'
    ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30 hover:opacity-90'
    : isOpen
    ? 'text-fg bg-surface-hover border-border'
    : 'text-fg-secondary bg-surface border-border hover:bg-surface-hover hover:text-fg';

  const bannerStatusStyle = overview.isTopicRunning
    ? 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30'
    : overview.overallState === 'resolved'
    ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30'
    : overview.overallState === 'stage_failed'
    ? 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30'
    : overview.overallState === 'awaiting_ruling' || overview.overallState === 'concurrence'
    ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30'
    : 'text-fg-secondary bg-surface-subtle border-border';

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Header Toolbar Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`px-2 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-[11px] font-medium shadow-2xs ${triggerPillClass}`}
        title="查看 Topic 实时流程状态与各 Agent 运行状态"
      >
        {overview.isTopicRunning ? (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-600 dark:bg-purple-400" />
          </span>
        ) : (
          <Activity className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="whitespace-nowrap">{overview.overallBadgeText}</span>
        {overview.agentItems.length > 0 && (
          <span className="hidden sm:inline font-mono text-[10px] opacity-80">
            · {overview.stageFlow.completedSteps}/{overview.stageFlow.totalSteps}
          </span>
        )}
      </button>

      {/* Popover Floating Card (Antigravity / Codex Overview Style) */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Topic 运行概览与 Agent 状态"
          className="absolute right-0 top-full mt-2 z-50 w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-surface text-fg shadow-2xl overflow-hidden"
        >
          {/* Live Topic Run-State Banner */}
          <div className="px-3.5 py-2.5 border-b border-border bg-surface-subtle flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {overview.isTopicRunning ? (
                <Loader2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 animate-spin shrink-0" />
              ) : (
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    overview.overallState === 'resolved'
                      ? 'bg-emerald-500'
                      : overview.overallState === 'stage_failed'
                      ? 'bg-rose-500'
                      : overview.overallState === 'awaiting_ruling' ||
                        overview.overallState === 'concurrence'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                  }`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-fg truncate">
                  {overview.isTopicRunning
                    ? '议题正在运行中'
                    : overview.overallState === 'resolved'
                    ? '议题已定案完结'
                    : overview.overallState === 'stage_failed'
                    ? '议题推演中断'
                    : overview.overallState === 'concurrence'
                    ? '全员无异议征询中'
                    : overview.overallState === 'awaiting_ruling'
                    ? '等待仲裁官定案'
                    : '议题当前空闲待命'}
                </div>
                <div className="text-[10px] text-fg-muted truncate" title={overview.overallSummaryText}>
                  {overview.overallSummaryText}
                </div>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] font-mono shrink-0 ${bannerStatusStyle}`}
            >
              {overview.stageFlow.completedSteps}/{overview.stageFlow.totalSteps} 阶段
            </span>
          </div>

          {/* Section 1: Overview */}
          <div className="p-2.5 space-y-1">
            <div className="px-2 py-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-fg-muted">Overview</span>
              <span className="text-[10px] font-mono text-fg-muted truncate">
                {overview.stageFlow.modeLabel}
                {overview.stageFlow.roundCount > 0 ? ` · R${overview.stageFlow.roundCount}` : ''}
              </span>
            </div>

            {/* Row 1: Review (+additions -deletions) */}
            <button
              type="button"
              onClick={() => {
                if (overview.reviewStats.diffFileCount > 0) {
                  onOpenCodexDiff();
                } else {
                  onSwitchDrawerView('adr');
                }
                setIsOpen(false);
              }}
              className="w-full px-2 py-1.5 rounded-xl hover:bg-surface-hover flex items-center justify-between gap-2 text-left transition-colors cursor-pointer min-w-0"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileDiff className="w-4 h-4 text-fg-secondary shrink-0" />
                <span className="text-[13px] font-medium text-fg">Review</span>
                {overview.reviewStats.diffFileCount > 0 && (
                  <span className="font-mono text-[12px] font-semibold flex items-center gap-1.5 shrink-0">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{overview.reviewStats.additions}
                    </span>
                    <span className="text-rose-600 dark:text-rose-400">
                      -{overview.reviewStats.deletions}
                    </span>
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-fg-muted truncate">
                {overview.reviewStats.summaryText}
              </span>
            </button>

            {/* Row 2: Files */}
            <div>
              <button
                type="button"
                onClick={() => {
                  if (overview.filesStats.impactedFilesCount > 0) {
                    setShowFilesPreview((prev) => !prev);
                  } else {
                    onSwitchDrawerView('adr');
                    setIsOpen(false);
                  }
                }}
                className="w-full px-2 py-1.5 rounded-xl hover:bg-surface-hover flex items-center justify-between gap-2 text-left transition-colors cursor-pointer min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-fg-secondary shrink-0" />
                  <span className="text-[13px] font-medium text-fg">Files</span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-mono text-fg-muted truncate">
                    {overview.filesStats.summaryText}
                  </span>
                  {overview.filesStats.impactedFilesCount > 0 && (
                    showFilesPreview ? (
                      <ChevronDown className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                    )
                  )}
                </div>
              </button>
              {showFilesPreview && overview.filesStats.impactedFilesCount > 0 && (
                <div className="mx-2 mt-1 mb-1.5 p-2 rounded-xl bg-surface-subtle border border-border space-y-1">
                  {overview.filesStats.impactedFiles.slice(0, 5).map((file) => (
                    <div
                      key={file}
                      className="text-[10px] font-mono text-fg-secondary truncate"
                      title={file}
                    >
                      {file}
                    </div>
                  ))}
                  {overview.filesStats.impactedFilesCount > 5 && (
                    <div className="text-[10px] text-fg-muted">
                      其余 {overview.filesStats.impactedFilesCount - 5} 个文件可在 ADR 画布查看
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Row 3: Terminal (Grounding & Execution) */}
            <button
              type="button"
              onClick={() => {
                onScrollToRulingOrBottom();
                setIsOpen(false);
              }}
              className="w-full px-2 py-1.5 rounded-xl hover:bg-surface-hover flex items-center justify-between gap-2 text-left transition-colors cursor-pointer min-w-0"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <SquareTerminal className="w-4 h-4 text-fg-secondary shrink-0" />
                <span className="text-[13px] font-medium text-fg">Terminal</span>
              </div>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border truncate ${
                  overview.terminalStats.executionStatus === 'running' ||
                  overview.terminalStats.executionStatus === 'queued'
                    ? 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30'
                    : overview.terminalStats.executionStatus === 'applied'
                    ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30'
                    : overview.terminalStats.executionStatus === 'failed'
                    ? 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30'
                    : 'text-fg-muted bg-surface-subtle border-border'
                }`}
              >
                {overview.terminalStats.summaryText}
              </span>
            </button>

            {/* Row 4: Workflow / Stage Flow */}
            <div>
              <button
                type="button"
                onClick={() => setShowWorkflowDetails((prev) => !prev)}
                className="w-full px-2 py-1.5 rounded-xl hover:bg-surface-hover flex items-center justify-between gap-2 text-left transition-colors cursor-pointer min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Puzzle className="w-4 h-4 text-fg-secondary shrink-0" />
                  <span className="text-[13px] font-medium text-fg">Workflow</span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-mono text-fg-secondary truncate">
                    {overview.stageFlow.currentStageLabel}
                  </span>
                  {showWorkflowDetails ? (
                    <ChevronDown className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                  )}
                </div>
              </button>

              {showWorkflowDetails && overview.stageFlow.steps.length > 0 && (
                <div className="px-2 pt-1 pb-1.5 flex flex-wrap items-center gap-1">
                  {overview.stageFlow.steps.map((step, idx) => (
                    <span
                      key={step.key}
                      className={`px-1.5 py-0.5 rounded-md border text-[10px] font-mono inline-flex items-center gap-1 ${getStepChipClass(
                        step.status
                      )}`}
                      title={step.label}
                    >
                      <span>
                        {step.status === 'completed'
                          ? '✓'
                          : step.status === 'active'
                          ? '●'
                          : step.status === 'bypassed'
                          ? '⚡'
                          : step.status === 'warning'
                          ? '!'
                          : String(idx + 1)}
                      </span>
                      <span>{step.shortLabel}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Hairline Divider */}
          <div className="border-t border-border" />

          {/* Section 2: Subagents / Topic Participating Agents */}
          <div className="p-2.5 space-y-1">
            <div className="px-2 py-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-semibold text-fg-muted">Subagents</span>
                <span className="px-1.5 py-0.2 rounded-full bg-surface-subtle border border-border text-[10px] font-mono font-semibold text-fg-secondary">
                  {overview.agentItems.length}
                </span>
              </div>
              {overview.activeAgentCount > 0 && onAbortAll && (
                <button
                  type="button"
                  onClick={() => onAbortAll()}
                  className="px-2 py-0.5 rounded-md border text-[10px] font-medium text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30 hover:opacity-90 flex items-center gap-1 cursor-pointer shrink-0"
                  title="立即停止当前议题内所有运行中的 Agent"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>全部终止</span>
                </button>
              )}
            </div>

            {visibleAgents.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-fg-muted">
                当前议题暂未分配 Agent
              </div>
            ) : (
              <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
                {visibleAgents.map((item) => {
                  const isRunningAgent =
                    item.runState === 'running' || item.runState === 'streaming';
                  return (
                    <div
                      key={item.agentId}
                      onClick={() => {
                        if (item.latestMessageId) {
                          onScrollToMessage(item.latestMessageId);
                          setIsOpen(false);
                        }
                      }}
                      className={`px-2 py-1.5 rounded-xl flex items-center justify-between gap-2 transition-colors min-w-0 ${
                        item.latestMessageId
                          ? 'hover:bg-surface-hover cursor-pointer'
                          : 'hover:bg-surface-subtle'
                      }`}
                      title={
                        item.latestMessageId
                          ? `${item.roleLabel} · 点击跳转至该 Agent 最新消息`
                          : `${item.roleLabel} · ${item.statusText}`
                      }
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isRunningAgent ? (
                          <Loader2
                            className={`w-4 h-4 animate-spin shrink-0 ${getAgentIconColor(item)}`}
                          />
                        ) : (
                          <LayoutGrid
                            className={`w-4 h-4 shrink-0 ${getAgentIconColor(item)}`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-fg truncate">
                            {item.displayTitle}
                          </div>
                          {item.actionDetail && isRunningAgent && (
                            <div
                              className="text-[10px] text-fg-muted truncate"
                              title={item.actionDetail}
                            >
                              {item.actionDetail}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isRunningAgent && item.elapsedSeconds !== undefined && (
                          <span className="text-[10px] font-mono font-semibold text-purple-700 dark:text-purple-300">
                            {item.elapsedSeconds.toFixed(1)}s
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 rounded-md border text-[10px] font-mono ${getAgentStatePillClass(
                            item
                          )}`}
                        >
                          {item.statusText}
                        </span>
                        {item.canAbort && onAbortAgent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAbortAgent(item.agentId);
                            }}
                            className="p-1 rounded-md text-rose-700 bg-rose-50 border border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30 hover:opacity-90 cursor-pointer"
                            title={`终止 ${item.agentName} 运行`}
                          >
                            <Square className="w-2.5 h-2.5 fill-current" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer: See all + Dashboard quick toggle */}
            <div className="pt-1 px-2 flex items-center justify-between gap-2 text-[11px]">
              {hiddenAgentCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllAgents((prev) => !prev)}
                  className="text-fg-secondary hover:text-fg font-medium cursor-pointer transition-colors"
                >
                  {showAllAgents ? '收起' : `See all (${overview.agentItems.length})`}
                </button>
              ) : (
                <span className="text-[10px] text-fg-muted">
                  共 {overview.agentItems.length} 位参研成员
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  onToggleHeaderCollapsed();
                  setIsOpen(false);
                }}
                className="text-[10px] font-medium text-accent hover:underline cursor-pointer"
              >
                {isHeaderCollapsed ? '展开完整看板' : '收起顶部看板'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
