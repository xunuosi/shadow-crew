import React, { useId } from 'react';
import { AlertTriangle, FileCode2, Plus, X } from 'lucide-react';
import { parseImpactedFilesInput } from '../../services/cogno';

export interface ImpactedFilesChipsEditorProps {
  files: string[];
  newFileInput: string;
  overlappingFiles: string[];
  onNewFileInputChange: (val: string) => void;
  onAddFiles: () => void;
  onPasteFiles: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onRemoveFile: (filePath: string) => void;
  onClearAllFiles: () => void;
}

/**
 * 涉及受影响文件（爆炸半径）标签化编辑器：完整展示多路径 Chip，支持粘贴批量拆解与重叠告警。
 */
export const ImpactedFilesChipsEditor: React.FC<
  ImpactedFilesChipsEditorProps
> = ({
  files,
  newFileInput,
  overlappingFiles,
  onNewFileInputChange,
  onAddFiles,
  onPasteFiles,
  onRemoveFile,
  onClearAllFiles,
}) => {
  const newFileFieldId = useId();

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg">
            涉及受影响文件 (爆炸半径)
          </span>
          {files.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-medium bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
              正文识别
            </span>
          )}
          <span className="text-[11px] font-mono text-fg-muted">
            {files.length} 个文件
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-fg-muted">
            支持逗号 / 换行批量粘贴
          </span>
          {files.length > 1 && (
            <button
              type="button"
              onClick={onClearAllFiles}
              className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              清空全部
            </button>
          )}
        </div>
      </div>

      <div className="p-3 rounded-xl bg-surface-subtle border border-border space-y-2.5">
        {files.length === 0 ? (
          <div className="text-xs text-fg-muted py-1">
            暂未指定受影响文件，可在下方输入路径后添加（不限制写入范围或由执行人自定）。
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {files.map((filePath) => (
              <span
                key={filePath}
                className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-lg bg-surface border border-border text-[11px] font-mono text-fg shadow-2xs"
              >
                <FileCode2
                  className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0"
                  aria-hidden="true"
                />
                <span className="break-all leading-snug">{filePath}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(filePath)}
                  aria-label={`移除文件 ${filePath}`}
                  title={`移除 ${filePath}`}
                  className="p-0.5 rounded hover:bg-surface-hover text-fg-muted hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={newFileFieldId} className="sr-only">
            添加受影响文件路径
          </label>
          <input
            id={newFileFieldId}
            type="text"
            value={newFileInput}
            onChange={(e) => onNewFileInputChange(e.target.value)}
            onPaste={onPasteFiles}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  return;
                }
                onAddFiles();
              }
            }}
            placeholder="输入文件路径后按 Enter（如 src/services/order.ts），支持粘贴多个..."
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border hover:border-border-hover focus:border-accent focus:ring-2 focus:ring-accent/15 text-fg text-xs font-mono focus:outline-none transition-all placeholder:text-fg-muted placeholder:font-sans"
          />
          <button
            type="button"
            onClick={onAddFiles}
            disabled={parseImpactedFilesInput(newFileInput).length === 0}
            className="px-3 py-1.5 rounded-lg bg-surface border border-border hover:bg-surface-hover disabled:opacity-45 disabled:cursor-not-allowed text-fg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加</span>
          </button>
        </div>
      </div>

      {overlappingFiles.length > 0 && (
        <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300 text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            并发文件重叠提示：
            <code className="font-mono font-semibold mx-1">
              {overlappingFiles.join(', ')}
            </code>
            正在被其他未合入议题触及，建议排队合入。
          </span>
        </div>
      )}
    </section>
  );
};
