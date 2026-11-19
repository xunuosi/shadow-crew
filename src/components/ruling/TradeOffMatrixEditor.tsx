import React, { useId } from 'react';
import { Check, Edit3, Plus, Trash2, X } from 'lucide-react';

export interface TradeOffMatrixEditorProps {
  points: string[];
  editingIndex: number | null;
  editingValue: string;
  newPointInput: string;
  onNewPointInputChange: (val: string) => void;
  onAddPoint: () => void;
  onStartEdit: (index: number) => void;
  onEditingValueChange: (val: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onRemovePoint: (index: number) => void;
}

/**
 * 关键权衡折中要点编辑器：支持行内点击编辑、IME 安全回车确认及增删条目。
 */
export const TradeOffMatrixEditor: React.FC<TradeOffMatrixEditorProps> = ({
  points,
  editingIndex,
  editingValue,
  newPointInput,
  onNewPointInputChange,
  onAddPoint,
  onStartEdit,
  onEditingValueChange,
  onCommitEdit,
  onCancelEdit,
  onRemovePoint,
}) => {
  const newPointFieldId = useId();

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg">
            关键权衡折中要点 (Trade-off Matrix)
          </span>
          <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-medium bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30">
            动态提炼
          </span>
          <span className="text-[11px] font-mono text-fg-muted">
            {points.length} 条
          </span>
        </div>
        <span className="text-[11px] text-fg-muted">
          点击要点即可直接编辑 · 支持增删
        </span>
      </div>

      <div className="space-y-2">
        {points.length === 0 ? (
          <div className="px-3.5 py-3 rounded-xl bg-surface-subtle border border-dashed border-border text-xs text-fg-muted text-center">
            暂无提取的权衡要点，可在下方输入框手动添加
          </div>
        ) : (
          points.map((pt, idx) => {
            const isEditing = editingIndex === idx;
            return (
              <div
                key={idx}
                className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors ${
                  isEditing
                    ? 'bg-surface border-accent ring-2 ring-accent/15'
                    : 'bg-surface-subtle border-border hover:border-border-hover'
                }`}
              >
                <span className="w-5 h-5 rounded-md bg-surface border border-border text-[10px] font-mono font-semibold text-fg-muted flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>

                {isEditing ? (
                  <div className="flex-1 flex items-center gap-1.5 min-w-0">
                    <input
                      type="text"
                      autoFocus
                      value={editingValue}
                      onChange={(e) => onEditingValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (e.nativeEvent.isComposing || e.keyCode === 229) {
                            return;
                          }
                          onCommitEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          onCancelEdit();
                        }
                      }}
                      aria-label={`编辑第 ${idx + 1} 条权衡要点`}
                      className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-surface-subtle border border-border focus:border-accent text-xs text-fg focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={onCommitEdit}
                      aria-label="保存修改"
                      title="保存修改 (Enter)"
                      className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300 cursor-pointer shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onCancelEdit}
                      aria-label="取消编辑"
                      title="取消编辑 (Esc)"
                      className="p-1.5 rounded-lg bg-surface border border-border text-fg-muted hover:text-fg hover:bg-surface-hover cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onStartEdit(idx)}
                      className="flex-1 min-w-0 text-left text-xs text-fg leading-relaxed hover:text-accent transition-colors cursor-text break-words"
                      title="点击修改该条权衡要点"
                    >
                      {pt}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onStartEdit(idx)}
                        aria-label={`编辑第 ${idx + 1} 条权衡要点`}
                        title="编辑要点"
                        className="p-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemovePoint(idx)}
                        aria-label={`删除第 ${idx + 1} 条权衡要点`}
                        title="删除要点"
                        className="p-1 rounded-md text-fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={newPointFieldId} className="sr-only">
          新增权衡考量要点
        </label>
        <input
          id={newPointFieldId}
          type="text"
          value={newPointInput}
          onChange={(e) => onNewPointInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                return;
              }
              onAddPoint();
            }
          }}
          placeholder="输入新的权衡考量，按 Enter 添加（如：以 5% 延迟换取强幂等）"
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface border border-border hover:border-border-hover focus:border-accent focus:ring-2 focus:ring-accent/15 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted"
        />
        <button
          type="button"
          onClick={onAddPoint}
          disabled={!newPointInput.trim()}
          className="px-3 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover disabled:opacity-45 disabled:cursor-not-allowed text-fg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加</span>
        </button>
      </div>
    </section>
  );
};
