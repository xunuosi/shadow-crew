import React, { useState, useEffect } from 'react';
import { WorkspaceFile, TopicPatchDiffItem } from '../types';
import { 
  X, 
  FileCode2, 
  FolderGit2, 
  Copy, 
  Check, 
  GitCompare,
  CheckCircle2,
  Loader2,
  Zap
} from 'lucide-react';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';

export interface ActiveCodexDiffPayload extends TopicPatchDiffItem {
  topicId?: string;
  topicTitle?: string;
  allDiffs?: TopicPatchDiffItem[];
  executionStatus?: 'idle' | 'queued' | 'running' | 'completed' | 'applied' | 'failed';
  artifactsDir?: string;
}

interface CodexDiffViewerProps {
  isOpen: boolean;
  onClose: () => void;
  activeDiff: ActiveCodexDiffPayload | null;
  workspaceFiles: WorkspaceFile[];
  onApplyDiff?: (topicId?: string, diffs?: TopicPatchDiffItem[]) => Promise<void> | void;
}

export const CodexDiffViewer: React.FC<CodexDiffViewerProps> = ({
  isOpen,
  onClose,
  activeDiff,
  onApplyDiff,
}) => {
  const [copied, setCopied] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  useEffect(() => {
    setSelectedFileIndex(0);
    setJustApplied(false);
  }, [activeDiff?.filename, activeDiff?.topicId]);

  const { width: drawerWidth, isDragging, handlePointerDown, resetWidth, panelRef } = useResizablePanel({
    direction: 'left',
    defaultWidth: 540,
    maxWidth: () => (typeof window !== 'undefined' ? Math.max(320, Math.min(1300, window.innerWidth - 260)) : 800),
    storageKey: 'shinobi_codex_diff_width',
  });

  if (!isOpen) return null;

  const allDiffs = activeDiff?.allDiffs && activeDiff.allDiffs.length > 0
    ? activeDiff.allDiffs
    : activeDiff
    ? [activeDiff]
    : [];

  const currentItem = allDiffs[selectedFileIndex] || activeDiff || {
    filename: 'PLANS/W13_3B_FRONTEND_DESIGN_NOTE.md',
    additions: 38,
    deletions: 4,
    diff: `@@ -142,6 +142,40 @@
+## §8. W13-3B App 会话流与门控设计结论
+
+### 8.1 App.tsx 门控机制
+- currentSession 依托 App.tsx:1631 \`currentSessionId ? sessions.find(...) : null\`
+- gate: \`workflowChatSlot = (currentSession?.workflowTemplateId || execNonEmpty) ? { templateName, live } : null\`
+- live 双重检验: \`!!(await workflowsGetExecution(sessionId))?.id || marker\`
+
+### 8.2 模式入口卡与 Client-side Session Minting
+- 允许客户端以 \`crypto.randomUUID()\` 独立铸造 sessionId
+- 调用链路: mint -> addSessionToProject -> window.lanmate.workflowsStart`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentItem.diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = async () => {
    if (!onApplyDiff) {
      onClose();
      return;
    }
    setIsApplying(true);
    try {
      await onApplyDiff(activeDiff?.topicId, allDiffs.length > 0 ? allDiffs : [currentItem]);
      setJustApplied(true);
    } finally {
      setIsApplying(false);
    }
  };

  const isAlreadyApplied = activeDiff?.executionStatus === 'applied' || justApplied;
  const diffLines = currentItem.diff.split('\n');

  return (
    <aside
      ref={panelRef as React.RefObject<HTMLElement>}
      id="shinobi-codex-diff-drawer"
      style={{ 
        width: `${drawerWidth}px`, 
        maxWidth: 'calc(100vw - 260px)',
        minWidth: '320px'
      }}
      className="relative bg-surface border-l border-border flex flex-col shrink min-w-[320px] max-sm:!fixed max-sm:!inset-0 max-sm:!w-full max-sm:!max-w-full max-sm:!z-50 text-xs text-fg-secondary shadow-2xl z-40 font-mono"
    >
      <ResizeHandle
        direction="left"
        onPointerDown={handlePointerDown}
        onDoubleClick={resetWidth}
        isDragging={isDragging}
        title="拖动调整 Diff 视图宽度，双击恢复默认 540px"
      />
      {/* 1. Header */}
      <div className="h-10 px-3.5 border-b border-border flex items-center justify-between bg-surface-subtle font-sans">
        <div className="flex items-center gap-2 truncate">
          <GitCompare className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-semibold text-fg truncate text-xs">
            Codex Diff 审查视图
          </span>
          {activeDiff?.topicTitle && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30 truncate max-w-[160px]">
              {activeDiff.topicTitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="复制当前文件 Diff"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Multi-file tab bar when multiple files are present */}
      {allDiffs.length > 1 && (
        <div className="px-3 py-1.5 bg-surface border-b border-border flex items-center gap-1.5 overflow-x-auto shrink-0 font-sans">
          {allDiffs.map((item, idx) => (
            <button
              key={`${item.filename}-${idx}`}
              type="button"
              onClick={() => setSelectedFileIndex(idx)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1.5 shrink-0 border transition-all cursor-pointer ${
                idx === selectedFileIndex
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40 font-semibold'
                  : 'bg-surface-subtle text-fg-muted hover:text-fg border-border'
              }`}
            >
              <FileCode2 className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[150px]">{item.filename.split('/').pop() || item.filename}</span>
              <span className="text-emerald-500">+{item.additions}</span>
              <span className="text-red-500">-{item.deletions}</span>
            </button>
          ))}
        </div>
      )}

      {/* 2. File Metadata */}
      <div className="p-3 bg-surface-subtle border-b border-border font-sans">
        <div className="flex items-center justify-between gap-1 mb-1">
          <span className="font-semibold text-fg truncate text-xs flex items-center gap-1.5 font-mono">
            <FileCode2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="truncate">{currentItem.filename}</span>
          </span>
          <span className="text-[10px] text-fg-muted font-mono shrink-0">
            {allDiffs.length > 1 ? `文件 ${selectedFileIndex + 1}/${allDiffs.length}` : 'Workspace Patch'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] font-mono shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/30">
              +{currentItem.additions}
            </span>
            <span className="text-red-500 bg-red-500/15 px-1.5 py-0.5 rounded border border-red-500/30">
              -{currentItem.deletions}
            </span>
            <span className="text-fg-muted">Unified Diff</span>
          </div>
          {isAlreadyApplied && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>已物理合入工作区</span>
            </span>
          )}
        </div>
      </div>

      {/* 3. Diff Lines Stream */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 text-[11px] leading-relaxed bg-surface select-text">
        {diffLines.map((line, idx) => {
          let bgClass = 'hover:bg-surface-hover text-fg-muted';
          if (line.startsWith('+')) {
            bgClass = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-l-2 border-emerald-500 pl-1.5';
          } else if (line.startsWith('-')) {
            bgClass = 'bg-red-500/10 text-red-600 dark:text-red-300 border-l-2 border-red-500 pl-1.5';
          } else if (line.startsWith('@')) {
            bgClass = 'bg-blue-500/15 text-blue-600 dark:text-blue-300 pl-1 font-semibold';
          }

          return (
            <div key={idx} className={`px-1.5 py-0.5 rounded transition-colors whitespace-pre-wrap break-all ${bgClass}`}>
              {line}
            </div>
          );
        })}
      </div>

      {/* 4. Footer */}
      <div className="p-2.5 border-t border-border bg-surface-subtle font-sans flex items-center justify-between gap-2 text-[10px] text-fg-muted">
        <span className="flex items-center gap-1 truncate">
          <FolderGit2 className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="truncate">
            {activeDiff?.artifactsDir
              ? `产物归档: ${activeDiff.artifactsDir}`
              : 'shadow-crew 本地工作区 & 频道产物归档'}
          </span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {isAlreadyApplied ? (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>已合入本地仓库</span>
            </span>
          ) : (
            <button
              type="button"
              disabled={isApplying}
              onClick={handleApply}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-[11px] transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>正在合入...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  <span>一键确认合入{allDiffs.length > 1 ? ` (${allDiffs.length} 文件)` : ''}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
