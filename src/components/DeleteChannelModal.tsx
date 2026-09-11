import React, { useState } from 'react';
import { Channel, TopicMessageData } from '../types';
import { 
  AlertTriangle, 
  Trash2, 
  X, 
  ShieldAlert, 
  GitBranch 
} from 'lucide-react';

interface DeleteChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel;
  unresolvedTopicsCount: number;
  onConfirmDelete: (channelId: string) => void;
}

export const DeleteChannelModal: React.FC<DeleteChannelModalProps> = ({
  isOpen,
  onClose,
  channel,
  unresolvedTopicsCount,
  onConfirmDelete,
}) => {
  const [confirmInput, setConfirmInput] = useState('');

  if (!isOpen) return null;

  const requiresInputMatch = unresolvedTopicsCount > 0;
  const isConfirmDisabled = requiresInputMatch && confirmInput.trim() !== channel.name;

  const handleDelete = () => {
    if (isConfirmDisabled) return;
    onConfirmDelete(channel.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-red-500/40 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2 text-red-500">
            <ShieldAlert className="w-5 h-5" />
            <span className="font-bold text-sm text-fg">
              删除频道 (Cascading Teardown)
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="text-fg-secondary text-xs leading-relaxed">
            您即将删除频道 <strong className="text-fg font-mono">#{channel.name}</strong>。此操作将触发三级级联资源回收：
          </div>

          <ul className="space-y-1.5 text-[11px] text-fg-muted bg-surface-subtle p-3 rounded-xl border border-border">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>终止所有正在此频道推演的 Agent Session 并断开 stdio 管道</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>清空该频道下所有消息时间线与 Topic 议题缓存</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>释放对分支 <code className="text-fg font-mono">{channel.gitBranch || 'main'}</code> 的编辑锁定</span>
            </li>
          </ul>

          {/* Unresolved topics alert */}
          {unresolvedTopicsCount > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>防误删高危警告</span>
              </div>
              <p className="text-[11px] leading-normal text-fg-secondary">
                当前频道尚有 <strong className="text-amber-600 dark:text-amber-400">{unresolvedTopicsCount}</strong> 个进行中的未完结 Topic 议题！为防止误操作，请在下方输入频道名称 <code className="font-bold text-fg bg-surface px-1.5 py-0.5 rounded border border-border">{channel.name}</code> 确认删除：
              </p>
              <input
                type="text"
                placeholder={`输入 ${channel.name} 确认`}
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-red-500"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-14 px-5 border-t border-border flex items-center justify-end gap-2 bg-surface-subtle">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl border border-border hover:bg-surface-hover transition-all text-fg text-xs font-semibold cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleDelete}
            disabled={isConfirmDisabled}
            className={`px-4 py-1.5 rounded-xl text-white font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
              isConfirmDisabled
                ? 'bg-red-500/40 cursor-not-allowed text-white/60'
                : 'bg-red-600 hover:bg-red-700 shadow-md shadow-red-500/20'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>确认级联销毁</span>
          </button>
        </div>
      </div>
    </div>
  );
};
