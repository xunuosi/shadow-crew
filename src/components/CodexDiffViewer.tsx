import React, { useState } from 'react';
import { WorkspaceFile } from '../types';
import { 
  X, 
  FileCode2, 
  FolderGit2, 
  GitCommit, 
  Copy, 
  Check, 
  Sparkles,
  GitCompare,
  FileCheck
} from 'lucide-react';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';

interface CodexDiffViewerProps {
  isOpen: boolean;
  onClose: () => void;
  activeDiff: {
    filename: string;
    additions: number;
    deletions: number;
    diff: string;
  } | null;
  workspaceFiles: WorkspaceFile[];
}

export const CodexDiffViewer: React.FC<CodexDiffViewerProps> = ({
  isOpen,
  onClose,
  activeDiff,
  workspaceFiles,
}) => {
  const [copied, setCopied] = useState(false);

  const { width: drawerWidth, isDragging, handlePointerDown, resetWidth } = useResizablePanel({
    direction: 'left',
    defaultWidth: 540,
    minWidth: 380,
    maxWidth: () => (typeof window !== 'undefined' ? Math.min(1300, window.innerWidth * 0.9) : 800),
    storageKey: 'shinobi_codex_diff_width',
  });

  if (!isOpen) return null;

  const handleCopy = () => {
    if (activeDiff) {
      navigator.clipboard.writeText(activeDiff.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const sampleDiff = activeDiff || {
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

  const diffLines = sampleDiff.diff.split('\n');

  return (
    <aside
      id="shinobi-codex-diff-drawer"
      style={{ width: `${drawerWidth}px`, maxWidth: '100vw' }}
      className={`relative bg-surface border-l border-border flex flex-col shrink-0 text-xs text-fg-secondary shadow-2xl z-40 font-mono ${
        isDragging ? '' : 'transition-[width] duration-150'
      }`}
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
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="复制完整 Diff"
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

      {/* 2. File Metadata */}
      <div className="p-3 bg-surface-subtle border-b border-border font-sans">
        <div className="flex items-center justify-between gap-1 mb-1">
          <span className="font-semibold text-fg truncate text-xs flex items-center gap-1.5 font-mono">
            <FileCode2 className="w-3.5 h-3.5 text-blue-500" />
            <span className="truncate">{sampleDiff.filename}</span>
          </span>
          <span className="text-[10px] text-fg-muted font-mono">feat/w13</span>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
          <span className="text-emerald-500 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/30">
            +{sampleDiff.additions}
          </span>
          <span className="text-red-500 bg-red-500/15 px-1.5 py-0.5 rounded border border-red-500/30">
            -{sampleDiff.deletions}
          </span>
          <span className="text-fg-muted">Unified Format</span>
        </div>
      </div>

      {/* 3. Diff Lines Stream */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 text-[11px] leading-relaxed bg-surface">
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
      <div className="p-2.5 border-t border-border bg-surface-subtle font-sans flex items-center justify-between text-[10px] text-fg-muted">
        <span className="flex items-center gap-1">
          <FolderGit2 className="w-3 h-3 text-accent" />
          <span>shadow-crew 仓库沙盒</span>
        </span>
        <button
          onClick={onClose}
          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[10px] transition-colors cursor-pointer"
        >
          一键确认合入
        </button>
      </div>
    </aside>
  );
};
