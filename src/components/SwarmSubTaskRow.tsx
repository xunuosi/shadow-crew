import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  SkipForward,
  Square,
  StopCircle,
  Terminal,
  XCircle,
} from 'lucide-react';
import type {
  Agent,
  SwarmMissionStatus,
  SwarmSubTask,
  SwarmSubTaskStatus,
} from '../types';
import type { SwarmMissionActions } from '../hooks/useSwarmOrchestrator';
import { isAgentOffline } from '../utils/agentRuntime';
import { useFilePreview } from '../context/FilePreviewContext';

interface SwarmSubTaskRowProps {
  roomId: string;
  messageId: string;
  missionStatus: SwarmMissionStatus;
  task: SwarmSubTask;
  worker?: Agent;
  selectableAgents: Agent[];
  workspaceRoot?: string;
  swarmActions?: SwarmMissionActions;
  onOpenSubThread?: (subThreadId: string) => void;
}

const SUBTASK_STATUS_STYLES: Record<
  SwarmSubTaskStatus,
  { label: string; badgeClass: string }
> = {
  pending: {
    label: '待派发',
    badgeClass: 'bg-surface-hover text-fg-muted border-border',
  },
  running: {
    label: '隔离运行中',
    badgeClass:
      'bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/30',
  },
  completed: {
    label: '已完成',
    badgeClass:
      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
  },
  failed: {
    label: '执行失败',
    badgeClass:
      'bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30',
  },
  aborted: {
    label: '已中止',
    badgeClass:
      'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  },
  skipped: {
    label: '已跳过',
    badgeClass: 'bg-surface-hover text-fg-muted border-border',
  },
};

function renderSubTaskStatusIcon(status: SwarmSubTaskStatus) {
  switch (status) {
    case 'running':
      return (
        <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
      );
    case 'completed':
      return (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      );
    case 'failed':
      return (
        <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
      );
    case 'aborted':
      return (
        <StopCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      );
    case 'skipped':
      return <SkipForward className="w-3.5 h-3.5 text-fg-muted shrink-0" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-fg-muted shrink-0" />;
  }
}

function formatDurationCompact(ms?: number): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const SwarmSubTaskRow: React.FC<SwarmSubTaskRowProps> = ({
  roomId,
  messageId,
  missionStatus,
  task,
  worker,
  selectableAgents,
  workspaceRoot,
  swarmActions,
  onOpenSubThread,
}) => {
  const { openFilePreview } = useFilePreview();
  const [reassignAgentId, setReassignAgentId] = useState(task.assignedAgentId);
  useEffect(() => {
    setReassignAgentId(task.assignedAgentId);
  }, [task.assignedAgentId]);
  const taskStatusMeta = SUBTASK_STATUS_STYLES[task.status];
  const durationLabel = formatDurationCompact(task.durationMs);

  return (
    <div
      data-testid={`swarm-subtask-${task.taskId}`}
      className={`px-3.5 py-2.5 transition-colors ${
        !task.enabled && missionStatus === 'awaiting_approval'
          ? 'opacity-55 bg-surface-secondary/50'
          : 'bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5 flex-wrap">
        {/* Left: Checkbox (approval) or Status Icon + Details */}
        <div className="flex items-start gap-2.5 flex-1 min-w-[200px] max-w-full">
          {missionStatus === 'awaiting_approval' ? (
            <input
              type="checkbox"
              aria-label={`启用子任务 ${task.title}`}
              checked={task.enabled}
              onChange={(e) =>
                swarmActions?.handleUpdateSwarmSubTask(
                  roomId,
                  messageId,
                  task.taskId,
                  { enabled: e.target.checked }
                )
              }
              className="mt-1 h-3.5 w-3.5 rounded border-border accent-accent cursor-pointer shrink-0"
            />
          ) : (
            <div className="mt-1">{renderSubTaskStatusIcon(task.status)}</div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-medium text-fg break-words">
                {task.title}
              </span>
              {missionStatus !== 'awaiting_approval' && (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${taskStatusMeta.badgeClass}`}
                >
                  {taskStatusMeta.label}
                </span>
              )}
              {durationLabel && (
                <span className="text-[10px] text-fg-muted">{durationLabel}</span>
              )}
              {task.generatedDiffs && task.generatedDiffs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-secondary text-fg-secondary border border-border">
                  {task.generatedDiffs.length} Diff
                </span>
              )}
            </div>

            <p className="mt-0.5 text-[12px] text-fg-secondary leading-snug break-words">
              {task.description}
            </p>

            {task.allowedFiles && task.allowedFiles.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {task.allowedFiles.map((filePath) => {
                  const isOverlap = task.overlappingFiles?.includes(filePath);
                  return (
                    <button
                      key={filePath}
                      type="button"
                      onClick={() => openFilePreview(filePath, workspaceRoot)}
                      title={`点击预览文件: ${filePath}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono break-all border hover:border-accent/50 hover:text-accent transition-colors cursor-pointer ${
                        isOverlap
                          ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35'
                          : 'bg-surface-secondary text-fg-muted border-border'
                      }`}
                    >
                      {isOverlap && (
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                      )}
                      <span className="underline decoration-current/35 underline-offset-2">
                        {filePath}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {task.errorMessage && (
              <div
                className={`mt-1.5 text-[11.5px] break-words ${
                  task.status === 'skipped'
                    ? 'text-fg-muted'
                    : 'text-rose-700 dark:text-rose-300'
                }`}
              >
                {task.errorMessage}
              </div>
            )}
            {task.status === 'completed' && task.resultSummary && (
              <div className="mt-1.5 text-[11.5px] text-fg-secondary line-clamp-2 break-words">
                {task.resultSummary}
              </div>
            )}
          </div>
        </div>

        {/* Right: Approval Assignee Dropdown or Runtime Fault-Tolerance Controls */}
        <div className="flex items-center gap-1.5 flex-wrap shrink-0 max-w-full">
          {missionStatus === 'awaiting_approval' ? (
            <select
              aria-label={`指派子任务 ${task.title} 执行者`}
              value={task.assignedAgentId}
              onChange={(e) =>
                swarmActions?.handleUpdateSwarmSubTask(
                  roomId,
                  messageId,
                  task.taskId,
                  { assignedAgentId: e.target.value }
                )
              }
              className="text-[11.5px] px-2 py-1 rounded-md border border-border bg-surface-secondary text-fg focus:outline-none focus:border-accent max-w-[180px]"
            >
              {selectableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.avatar} {a.name}
                  {isAgentOffline(a) ? ' (离线)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <>
              {worker && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-surface-secondary border border-border text-fg-secondary">
                  <span>{worker.avatar}</span>
                  <span className="truncate max-w-[110px]">{worker.name}</span>
                </span>
              )}

              {task.subThreadId && onOpenSubThread && (
                <button
                  type="button"
                  onClick={() => onOpenSubThread(task.subThreadId!)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-border bg-surface-secondary text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
                  title="打开该 Worker 的独立隔离执行抽屉"
                >
                  <Terminal className="w-3 h-3" />
                  <span>详情/追问</span>
                </button>
              )}

              {task.status === 'running' && (
                <button
                  type="button"
                  onClick={() =>
                    swarmActions?.handleAbortSwarmSubTask(
                      roomId,
                      messageId,
                      task.taskId
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  <Square className="w-3 h-3" />
                  <span>中止</span>
                </button>
              )}

              {(task.status === 'failed' || task.status === 'aborted') &&
                missionStatus !== 'cancelled' && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <select
                      aria-label={`重试子任务 ${task.title} 更换执行者`}
                      value={reassignAgentId}
                      onChange={(e) => setReassignAgentId(e.target.value)}
                      className="text-[11px] px-1.5 py-1 rounded-md border border-border bg-surface-secondary text-fg max-w-[130px]"
                    >
                      {selectableAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.avatar} {a.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        swarmActions?.handleRetrySwarmSubTask(
                          roomId,
                          messageId,
                          task.taskId,
                          reassignAgentId
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>重试</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        swarmActions?.handleSkipSwarmSubTask(
                          roomId,
                          messageId,
                          task.taskId
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-border bg-surface-secondary text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
                    >
                      <SkipForward className="w-3 h-3" />
                      <span>跳过</span>
                    </button>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
