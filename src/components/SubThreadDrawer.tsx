import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SubThread, Agent } from '../types';
import { 
  X, 
  GitBranch, 
  CornerDownRight, 
  Send, 
  CheckCircle2, 
  Sparkles,
  ArrowUpRight,
  Bot,
  Edit3
} from 'lucide-react';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import { getDraft, saveDraft, clearDraft } from '../services/draftService';

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

  // 切换子话题时，自动同步该子话题的独立草稿
  useEffect(() => {
    if (subThread?.id) {
      setReplyContent(getDraft('subthread', subThread.id));
    } else {
      setReplyContent('');
    }
  }, [subThread?.id]);

  const updateReplyContent = (valOrFn: string | ((prev: string) => string)) => {
    const next = typeof valOrFn === 'function' ? valOrFn(replyContent) : valOrFn;
    setReplyContent(next);
    if (subThread?.id) {
      saveDraft('subthread', subThread.id, next);
    }
  };

  const handleClearSubDraft = () => {
    setReplyContent('');
    if (subThread?.id) {
      clearDraft('subthread', subThread.id);
    }
  };

  const { width: drawerWidth, isDragging, handlePointerDown, resetWidth, panelRef } = useResizablePanel({
    direction: 'left',
    defaultWidth: 420,
    minWidth: 320,
    maxWidth: () => (typeof window !== 'undefined' ? Math.max(320, Math.min(800, window.innerWidth - 320)) : 600),
    storageKey: 'shinobi_subthread_drawer_width',
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSubIdRef = useRef<string | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollContainerRef.current;
    if (container) {
      if (behavior === 'smooth') {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !subThread?.id) {
      prevSubIdRef.current = null;
      return;
    }
    const isNew = prevSubIdRef.current !== subThread.id;
    prevSubIdRef.current = subThread.id;

    if (isNew) {
      scrollToBottom('auto');
      const raf = requestAnimationFrame(() => scrollToBottom('auto'));
      const timer = setTimeout(() => scrollToBottom('auto'), 50);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    } else {
      scrollToBottom('smooth');
    }
  }, [isOpen, subThread?.id, subThread?.messages?.length, scrollToBottom]);

  if (!isOpen || !subThread) return null;

  const handleSend = () => {
    if (!replyContent.trim()) return;
    onSendSubMessage(replyContent);
    setReplyContent('');
    if (subThread?.id) {
      clearDraft('subthread', subThread.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <aside
      ref={panelRef as React.RefObject<HTMLElement>}
      id="shinobi-subthread-drawer"
      style={{ width: `${drawerWidth}px`, maxWidth: '100vw' }}
      className="relative bg-surface border-l border-border flex flex-col shrink-0 text-xs text-fg-secondary shadow-2xl z-40"
    >
      <ResizeHandle
        direction="left"
        onPointerDown={handlePointerDown}
        onDoubleClick={resetWidth}
        isDragging={isDragging}
        title="拖动调整子话题抽屉宽度，双击恢复默认 420px"
      />
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
        <div className="p-2 rounded bg-surface border border-border text-fg-muted font-mono text-[10px] italic select-text">
          "{subThread.quoteSnippet}"
        </div>
      </div>

      {/* 3. Sub-Thread Message Stream */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3 select-text">
        {subThread.messages.map((msg) => (
          <div key={msg.id} className="p-2.5 rounded-xl bg-surface-subtle border border-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{msg.authorAvatar}</span>
                <span className="font-semibold text-fg text-xs">{msg.authorName}</span>
              </div>
              <span className="text-[10px] text-fg-muted font-mono">{msg.timestamp}</span>
            </div>
            <div className="mt-1">
              <MarkdownRenderer content={msg.content} />
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. Mini Composer */}
      <div className="p-3 border-t border-border bg-surface-subtle">
        <div className="relative bg-surface border border-border rounded-xl p-2 focus-within:border-purple-500 transition-all">
          <textarea
            value={replyContent}
            onChange={(e) => updateReplyContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在子话题中回复... (⌘ + Enter 发送)"
            rows={2}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none"
          />
          <div className="flex items-center justify-between pt-1 border-t border-border mt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-fg-muted font-mono">⌘ + Enter 发送</span>
              {replyContent.trim().length > 0 && (
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] select-none"
                  title="当前子话题草稿已暂存"
                >
                  <Edit3 className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-mono">草稿已暂存</span>
                  <button
                    type="button"
                    onClick={handleClearSubDraft}
                    className="p-0.5 rounded hover:text-red-400 transition-colors cursor-pointer"
                    title="清空当前子话题草稿"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!replyContent.trim()}
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition-all cursor-pointer"
              title="发送回复 (⌘ + Enter)"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
