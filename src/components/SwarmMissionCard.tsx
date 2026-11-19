import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileCode2,
  FolderArchive,
  GitMerge,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import { useArtifactsWindow } from '../context/ArtifactsWindowContext';
import type {
  Agent,
  SwarmMissionData,
  SwarmMissionStatus,
  TopicPatchDiffItem,
} from '../types';
import type { SwarmMissionActions } from '../hooks/useSwarmOrchestrator';
import { canAutoTriggerSwarmReduce } from '../services/swarmOrchestration';
import { isAgentOffline } from '../utils/agentRuntime';
import type { ActiveCodexDiffPayload } from './CodexDiffViewer';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import { SwarmSubTaskRow } from './SwarmSubTaskRow';

interface SwarmMissionCardProps {
  roomId: string;
  messageId: string;
  mission: SwarmMissionData;
  agents: Agent[];
  channelAgents: Agent[];
  workspaceRoot?: string;
  swarmActions?: SwarmMissionActions;
  onOpenSubThread?: (subThreadId: string) => void;
  onOpenCodexDiff?: (payload: ActiveCodexDiffPayload) => void;
}

const MISSION_STATUS_STYLES: Record<
  SwarmMissionStatus,
  { label: string; badgeClass: string }
> = {
  awaiting_approval: {
    label: '待确认派发',
    badgeClass:
      'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  },
  running_workers: {
    label: '并行执行中',
    badgeClass:
      'bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/30',
  },
  reducing: {
    label: 'Lead 汇总验收',
    badgeClass:
      'bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-500/30',
  },
  completed: {
    label: '已完成交付',
    badgeClass:
      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
  },
  cancelled: {
    label: '已取消',
    badgeClass: 'bg-surface-hover text-fg-muted border-border',
  },
};

export const SwarmMissionCard: React.FC<SwarmMissionCardProps> = ({
  roomId,
  messageId,
  mission,
  agents,
  channelAgents,
  workspaceRoot,
  swarmActions,
  onOpenSubThread,
  onOpenCodexDiff,
}) => {
  const { openArtifactsWindow } = useArtifactsWindow();
  const [showContract, setShowContract] = useState(
    mission.status === 'awaiting_approval'
  );
  const [isDecomposing, setIsDecomposing] = useState(false);

  const selectableAgents = useMemo(() => {
    const merged = [...channelAgents];
    for (const a of agents) {
      if (!merged.some((m) => m.id === a.id) && !isAgentOffline(a)) {
        merged.push(a);
      }
    }
    return merged.length > 0 ? merged : agents;
  }, [agents, channelAgents]);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents]
  );

  const leadAgent = agentMap.get(mission.leadAgentId);
  const statusMeta = MISSION_STATUS_STYLES[mission.status];
  const enabledTasks = mission.subTasks.filter((t) => t.enabled);
  const visibleTasks =
    mission.status === 'awaiting_approval' ? mission.subTasks : enabledTasks;

  const finishedCount = enabledTasks.filter(
    (t) => t.status === 'completed' || t.status === 'skipped'
  ).length;
  const runningCount = enabledTasks.filter(
    (t) => t.status === 'running'
  ).length;
  const failedOrAbortedCount = enabledTasks.filter(
    (t) => t.status === 'failed' || t.status === 'aborted'
  ).length;
  const hasAnyFileOverlap = enabledTasks.some(
    (t) => t.overlappingFiles && t.overlappingFiles.length > 0
  );
  const progressPct =
    enabledTasks.length > 0
      ? Math.round((finishedCount / enabledTasks.length) * 100)
      : 0;
  const canManualReduce =
    mission.status === 'running_workers' &&
    canAutoTriggerSwarmReduce(mission.subTasks);

  const openDiffViewer = (selectedDiff?: TopicPatchDiffItem) => {
    const diffs =
      mission.aggregatedDiffs && mission.aggregatedDiffs.length > 0
        ? mission.aggregatedDiffs
        : selectedDiff
        ? [selectedDiff]
        : [];
    if (!onOpenCodexDiff || diffs.length === 0) return;
    const primary = selectedDiff || diffs[0];
    onOpenCodexDiff({
      ...primary,
      swarmMessageId: messageId,
      topicTitle: `🐝 Swarm 汇总 Diff (${mission.missionId})`,
      allDiffs: diffs,
      executionStatus: mission.patchApplied ? 'applied' : undefined,
    });
  };

  return (
    <div
      data-testid="swarm-mission-card"
      data-swarm-status={mission.status}
      className="mt-2.5 rounded-xl border border-border bg-surface shadow-xs overflow-hidden min-w-0"
    >
      {/* Header Bar */}
      <div className="px-3.5 py-2.5 bg-surface-secondary border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <span>🐝</span>
            <span>Swarm 并行拆解看板</span>
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusMeta.badgeClass}`}
          >
            {statusMeta.label}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-fg-muted border border-border">
            {mission.triggerMode === 'explicit' ? '显式指令' : '自主提案'}
          </span>
          {leadAgent && (
            <span className="text-[11px] text-fg-muted truncate">
              Lead: {leadAgent.avatar} {leadAgent.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-fg-muted flex-wrap">
          <span>
            启用 {enabledTasks.length}/{mission.subTasks.length} 项
          </span>
          {mission.status !== 'awaiting_approval' && (
            <span className="font-medium text-fg-secondary">
              进度 {finishedCount}/{enabledTasks.length}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              openArtifactsWindow({
                scopeType: 'swarm',
                scopeId: roomId,
                channelId: mission.channelId,
                title: `Swarm · ${mission.originalTask.slice(0, 36)}`,
                subtitle: mission.sharedContractSummary || '群智协作合流结论、子任务产出与补丁 Diff',
                swarmMissions: [mission],
                focusedSwarmId: mission.missionId,
              })
            }
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-surface hover:bg-surface-hover text-fg-secondary hover:text-fg transition-colors cursor-pointer"
            title="打开本次 Swarm 任务的最终合流产物与各 Worker 中间产物"
          >
            <FolderArchive className="w-3 h-3 text-amber-500" />
            <span>产物窗口</span>
          </button>
        </div>
      </div>

      {/* Shared Contract Collapsible */}
      {mission.sharedContractSummary && (
        <div className="px-3.5 py-2 border-b border-border bg-surface-hover/40">
          <button
            type="button"
            onClick={() => setShowContract((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left text-[11px] font-medium text-fg-secondary hover:text-fg transition-colors"
          >
            <span className="truncate">
              📋 跨 Worker 共享接口契约与边界约束
            </span>
            <span className="text-[10px] text-fg-muted shrink-0">
              {showContract ? '收起' : '展开'}
            </span>
          </button>
          {showContract && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-fg-secondary whitespace-pre-wrap break-words">
              {mission.sharedContractSummary}
            </p>
          )}
        </div>
      )}

      {/* Progress Bar */}
      {(mission.status === 'running_workers' ||
        mission.status === 'reducing') && (
        <div className="px-3.5 py-1.5 bg-surface border-b border-border flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-surface-hover overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-fg-muted shrink-0">
            {progressPct}%
          </span>
        </div>
      )}

      {/* Overlap & Error Alerts */}
      {mission.status === 'awaiting_approval' && hasAnyFileOverlap && (
        <div className="px-3.5 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2 text-[11.5px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            检测到部分已启用子任务的 allowedFiles 范围存在路径交集，并发改写同一文件可能引发覆盖冲突；建议在派发前取消勾选其中一项或错开执行。
          </span>
        </div>
      )}

      {mission.reduceError && (
        <div className="px-3.5 py-2 bg-rose-500/10 border-b border-rose-500/20 flex items-start gap-2 text-[11.5px] text-rose-800 dark:text-rose-300">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{mission.reduceError}</span>
        </div>
      )}

      {/* SubTask Rows */}
      <div className="divide-y divide-border">
        {visibleTasks.map((task) => (
          <SwarmSubTaskRow
            key={task.taskId}
            roomId={roomId}
            messageId={messageId}
            missionStatus={mission.status}
            task={task}
            worker={agentMap.get(task.assignedAgentId)}
            selectableAgents={selectableAgents}
            workspaceRoot={workspaceRoot}
            swarmActions={swarmActions}
            onOpenSubThread={onOpenSubThread}
          />
        ))}
      </div>

      {/* Reducing Banner */}
      {mission.status === 'reducing' && (
        <div className="px-3.5 py-2.5 bg-purple-500/10 border-t border-purple-500/20 flex items-center gap-2 text-[12px] text-purple-800 dark:text-purple-300">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            正在唤醒总控协调官（Lead Agent）核对全量 Worker 交付与接口一致性...
          </span>
        </div>
      )}

      {/* Completed Synthesis */}
      {mission.status === 'completed' && mission.finalSynthesis && (
        <div className="px-3.5 py-3 border-t border-border bg-emerald-500/5 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Lead 终局验收综述</span>
          </div>
          <div className="text-[13px] text-fg min-w-0">
            <MarkdownRenderer content={mission.finalSynthesis} workspaceRoot={workspaceRoot} />
          </div>
        </div>
      )}

      {/* Aggregated Diffs Bar */}
      {mission.aggregatedDiffs && mission.aggregatedDiffs.length > 0 && (
        <div className="px-3.5 py-2.5 border-t border-border bg-surface-secondary flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <FileCode2 className="w-3.5 h-3.5 text-fg-secondary shrink-0" />
            <span className="text-[11.5px] font-medium text-fg-secondary">
              聚合变更 ({mission.aggregatedDiffs.length} 个文件):
            </span>
            {mission.aggregatedDiffs.slice(0, 4).map((diff) => (
              <button
                key={diff.filename}
                type="button"
                onClick={() => openDiffViewer(diff)}
                className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-surface border border-border text-fg hover:border-accent transition-colors truncate max-w-[200px]"
              >
                {diff.filename}
              </button>
            ))}
            {mission.aggregatedDiffs.length > 4 && (
              <span className="text-[11px] text-fg-muted">
                +{mission.aggregatedDiffs.length - 4}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {mission.patchApplySummary && (
              <span className="text-[11px] text-fg-secondary">
                {mission.patchApplySummary}
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                openArtifactsWindow({
                  scopeType: 'swarm',
                  scopeId: roomId,
                  channelId: mission.channelId,
                  title: `Swarm · ${mission.originalTask.slice(0, 36)}`,
                  subtitle: mission.sharedContractSummary || '群智协作合流结论、子任务产出与补丁 Diff',
                  swarmMissions: [mission],
                  focusedSwarmId: mission.missionId,
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium border border-border bg-surface text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <FolderArchive className="w-3.5 h-3.5 text-amber-500" />
              <span>产物窗口</span>
            </button>
            <button
              type="button"
              onClick={() => openDiffViewer()}
              className="px-2.5 py-1 rounded-md text-[11.5px] font-medium border border-border bg-surface text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            >
              审查 Diff
            </button>
            <button
              type="button"
              onClick={() => swarmActions?.handleApplySwarmPatch(messageId)}
              disabled={mission.patchApplied}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-55 transition-colors"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>
                {mission.patchApplied ? '已合入工作区' : '一键合入工作区'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      {(mission.status === 'awaiting_approval' ||
        mission.status === 'running_workers') && (
        <div className="px-3.5 py-2.5 border-t border-border bg-surface-secondary flex items-center justify-between gap-2 flex-wrap">
          {mission.status === 'awaiting_approval' ? (
            <>
              <span className="text-[11px] text-fg-muted">
                请核对子任务与责任人后确认派发（Workers 将纯并行隔离执行）
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isDecomposing}
                  onClick={async () => {
                    setIsDecomposing(true);
                    try {
                      await swarmActions?.handleRetrySwarmDecomposition(
                        roomId,
                        messageId
                      );
                    } finally {
                      setIsDecomposing(false);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-border bg-surface text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-50 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isDecomposing ? 'animate-spin' : ''}`}
                  />
                  <span>{isDecomposing ? '重拆中...' : '重新拆解'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    swarmActions?.handleCancelSwarmMission(roomId, messageId)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-border bg-surface text-fg-secondary hover:text-rose-600 dark:hover:text-rose-400 hover:bg-surface-hover transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>取消</span>
                </button>
                <button
                  type="button"
                  disabled={enabledTasks.length === 0 || isDecomposing}
                  onClick={() =>
                    swarmActions?.handleConfirmSwarmDispatch(roomId, messageId)
                  }
                  data-testid="swarm-confirm-dispatch"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-45 transition-colors shadow-xs"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>确认并发派发 ({enabledTasks.length})</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[11px] text-fg-muted">
                {runningCount > 0
                  ? `${runningCount} 个 Worker 并行运行中`
                  : failedOrAbortedCount > 0
                  ? `${failedOrAbortedCount} 个异常子任务等待处理（重试或跳过后自动汇总）`
                  : canManualReduce
                  ? '全部启用子任务已就绪，可触发 Lead 终局汇总'
                  : '等待子任务处理'}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {canManualReduce && (
                  <button
                    type="button"
                    onClick={() =>
                      swarmActions?.handleTriggerSwarmLeadReduce(
                        roomId,
                        messageId
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>触发 Lead 汇总</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    swarmActions?.handleCancelSwarmMission(roomId, messageId)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>终止全部任务</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
