import React, { useState } from 'react';
import { SubThread, Agent } from '../types';
import { 
  X, 
  GitBranch, 
  CornerDownRight, 
  Send, 
  CheckCircle2, 
  Sparkles,
  ArrowUpRight,
  Bot
} from 'lucide-react';

interface SubThreadDrawerProps {
  isOpen: boolean;
  subThread: SubThread | null;
  agents: Agent[];
  onClose: () => void;
  onSendSubMessage: (content: string) => void;
  onSyncBackToMainThread: (summary: string) => void;
}

export const SubThreadDrawer: React.FC<SubThreadDrawerProps> = ({
  isOpen,
  subThread,
  agents,
  onClose,
  onSendSubMessage,
  onSyncBackToMainThread,
}) => {
  const [replyContent, setReplyContent] = useState('');

  if (!isOpen || !subThread) return null;

  const handleSend = () => {
    if (!replyContent.trim()) return;
    onSendSubMessage(replyContent);
    setReplyContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <aside
      id="shinobi-subthread-drawer"
      className="w-80 md:w-96 bg-surface border-l border-border flex flex-col shrink-0 text-xs text-fg-secondary shadow-2xl z-40 transition-colors duration-150"
    >
      {/* 1. Header */}
      <div className="h-10 px-3.5 border-b border-border flex items-center justify-between bg-surface-subtle">
        <div className="flex items-center gap-2 truncate">
          <GitBranch className="w-4 h-4 text-purple-500 shrink-0" />
          <span className="font-semibold text-fg truncate text-xs">
            {subThread.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onSyncBackToMainThread(`✅ 子话题决议：${subThread.title}已完成深度推演并达成共识。`)}
            className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-600 dark:text-purple-300 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            title="将子话题核心结论同步回主讨论时间线"
          >
            <ArrowUpRight className="w-3 h-3" />
            <span>合流回主线</span>
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Parent Quote Anchor */}
      <div className="p-3 bg-surface-subtle border-b border-border text-[11px]">
        <div className="text-[10px] text-purple-500 font-semibold mb-1 flex items-center gap-1">
          <CornerDownRight className="w-3 h-3" />
          <span>引用切片上下文:</span>
        </div>
        <div className="p-2 rounded bg-surface border border-border text-fg-muted font-mono text-[10px] italic">
          "{subThread.quoteSnippet}"
        </div>
      </div>

      {/* 3. Sub-Thread Message Stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {subThread.messages.map((msg) => (
          <div key={msg.id} className="p-2.5 rounded-xl bg-surface-subtle border border-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{msg.authorAvatar}</span>
                <span className="font-semibold text-fg text-xs">{msg.authorName}</span>
              </div>
              <span className="text-[10px] text-fg-muted font-mono">{msg.timestamp}</span>
            </div>
            <p className="text-[11px] text-fg-secondary leading-relaxed font-sans whitespace-pre-wrap">
              {msg.content}
            </p>
          </div>
        ))}
      </div>

      {/* 4. Mini Composer */}
      <div className="p-3 border-t border-border bg-surface-subtle">
        <div className="relative bg-surface border border-border rounded-xl p-2 focus-within:border-purple-500 transition-all">
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在子话题中回复..."
            rows={2}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none"
          />
          <div className="flex items-center justify-between pt-1 border-t border-border mt-1">
            <span className="text-[10px] text-fg-muted font-mono">Shift+Enter 换行</span>
            <button
              onClick={handleSend}
              disabled={!replyContent.trim()}
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition-all cursor-pointer"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
