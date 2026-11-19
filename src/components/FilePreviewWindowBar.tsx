import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from 'lucide-react';
import type { FilePreviewResult, ReadFilePreviewOptions } from '../services/fileViewerService';

interface FilePreviewWindowBarProps {
  data: FilePreviewResult;
  windowSize: number;
  windowLoading: boolean;
  jumpLineInput: string;
  onJumpLineInputChange: (next: string) => void;
  onLoadWindow: (options: ReadFilePreviewOptions, nextHighlightLine?: number) => void;
  onJumpSubmit: (e: React.FormEvent) => void;
}

/**
 * Large-file streaming window navigation toolbar (Head / Prev / Next / Tail + line jump).
 */
export const FilePreviewWindowBar: React.FC<FilePreviewWindowBarProps> = ({
  data,
  windowSize,
  windowLoading,
  jumpLineInput,
  onJumpLineInputChange,
  onLoadWindow,
  onJumpSubmit,
}) => {
  return (
    <div className="px-4 py-2 bg-surface-subtle border-b border-border flex items-center justify-between gap-2 flex-wrap shrink-0 text-[11px]">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!data.hasMoreBefore || windowLoading}
          onClick={() => onLoadWindow({ startLine: 1, maxLines: windowSize }, 1)}
          className="px-2 py-1 rounded-md bg-surface border border-border text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-45 cursor-pointer inline-flex items-center gap-1"
          title="回到文件开头"
        >
          <ChevronsLeft className="w-3 h-3" />
          <span>首页</span>
        </button>
        <button
          type="button"
          disabled={!data.hasMoreBefore || windowLoading}
          onClick={() =>
            onLoadWindow({
              startLine: Math.max(1, data.startLine - windowSize),
              maxLines: windowSize,
            })
          }
          className="px-2 py-1 rounded-md bg-surface border border-border text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-45 cursor-pointer inline-flex items-center gap-1"
          title="上一窗口"
        >
          <ChevronLeft className="w-3 h-3" />
          <span>上一窗</span>
        </button>
        <button
          type="button"
          disabled={!data.hasMoreAfter || windowLoading}
          onClick={() =>
            onLoadWindow({
              startLine: data.endLine + 1,
              maxLines: windowSize,
            })
          }
          className="px-2 py-1 rounded-md bg-surface border border-border text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-45 cursor-pointer inline-flex items-center gap-1"
          title="下一窗口"
        >
          <span>下一窗</span>
          <ChevronRight className="w-3 h-3" />
        </button>
        <button
          type="button"
          disabled={!data.hasMoreAfter || windowLoading}
          onClick={() => onLoadWindow({ tail: true, maxLines: windowSize })}
          className="px-2 py-1 rounded-md bg-surface border border-border text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-45 cursor-pointer inline-flex items-center gap-1"
          title="跳至文件末尾 (Tail)"
        >
          <span>末尾</span>
          <ChevronsRight className="w-3 h-3" />
        </button>
      </div>

      <form onSubmit={onJumpSubmit} className="flex items-center gap-1.5">
        {windowLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
        <input
          type="number"
          min={1}
          max={Math.max(1, data.totalLines)}
          value={jumpLineInput}
          onChange={(e) => onJumpLineInputChange(e.target.value)}
          placeholder="跳转行号"
          aria-label="跳转至指定行号"
          className="w-24 px-2 py-1 rounded-md bg-surface border border-border text-xs font-mono text-fg focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={windowLoading || !jumpLineInput.trim()}
          className="px-2.5 py-1 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-45 cursor-pointer"
        >
          跳转
        </button>
      </form>
    </div>
  );
};
