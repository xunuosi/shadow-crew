import React, { useState } from 'react';
import { Thread } from '../types';
import { 
  ChevronDown, 
  MoreHorizontal, 
  Plus, 
  MessageSquare, 
  AtSign, 
  Filter, 
  Sparkles,
  Layers,
  GitBranch
} from 'lucide-react';

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  filterType: 'all' | 'unread' | 'mentions' | 'dms';
  onFilterChange: (filter: 'all' | 'unread' | 'mentions' | 'dms') => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  filterType,
  onFilterChange,
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const getFilterLabel = () => {
    switch (filterType) {
      case 'unread':
        return 'Unread';
      case 'mentions':
        return 'Mentions';
      case 'dms':
        return 'Direct Messages';
      default:
        return 'All';
    }
  };

  const filteredThreads = threads.filter((t) => {
    if (filterType === 'unread') return (t.unreadCount || 0) > 0;
    if (filterType === 'mentions') return t.mentions && t.mentions.length > 0;
    if (filterType === 'dms') return t.type === 'dm';
    return true;
  });

  return (
    <section
      id="shinobi-thread-list-pane"
      className="w-72 md:w-80 bg-surface border-r border-border flex flex-col shrink-0 select-none text-xs text-fg-secondary transition-colors duration-150"
    >
      {/* 1. Header with 'All ⌵' filter and actions */}
      <div className="h-10 px-3.5 border-b border-border flex items-center justify-between bg-surface-subtle select-none">
        <div className="relative">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center gap-1.5 font-semibold text-fg hover:text-accent transition-colors cursor-pointer py-1"
          >
            <span className="text-xs">{getFilterLabel()}</span>
            <ChevronDown className="w-3.5 h-3.5 text-fg-muted" />
          </button>

          {/* Filter Dropdown Menu */}
          {isFilterOpen && (
            <div className="absolute top-8 left-0 w-44 bg-surface border border-border rounded-xl shadow-xl z-50 py-1 text-xs">
              {(['all', 'unread', 'mentions', 'dms'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    onFilterChange(item);
                    setIsFilterOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 transition-colors cursor-pointer flex items-center justify-between ${
                    filterType === item ? 'bg-accent/15 text-accent font-semibold' : 'text-fg-secondary hover:bg-surface-hover'
                  }`}
                >
                  <span className="capitalize">{item === 'dms' ? 'Direct Messages' : item}</span>
                  {filterType === item && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onNewThread}
            className="p-1 rounded text-fg-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
            title="开启新议题 / 发起讨论"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="更多操作"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Thread Activity Cards Feed */}
      <div className="flex-1 overflow-y-auto divide-y divide-border-subtle p-1.5 space-y-1">
        {filteredThreads.length === 0 ? (
          <div className="p-6 text-center text-fg-muted">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-fg-muted opacity-50" />
            <p>暂无符合筛选的讨论</p>
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;

            return (
              <article
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={`p-3 rounded-xl transition-all cursor-pointer select-none group relative ${
                  isActive
                    ? 'bg-surface-hover text-fg shadow-xs border border-accent/40'
                    : 'bg-surface hover:bg-surface-hover text-fg-secondary border border-transparent'
                }`}
              >
                {/* Left active cyan line indicator */}
                {isActive && (
                  <div className="absolute left-0 top-3 bottom-3 w-1 bg-accent rounded-r-full" />
                )}

                {/* Header: Avatar, Name & Location */}
                <div className="flex items-start gap-2.5 mb-1.5">
                  <div className="w-7 h-7 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-base shrink-0 shadow-xs">
                    {thread.authorAvatar}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-xs text-fg truncate group-hover:text-accent transition-colors">
                        {thread.authorName}
                      </span>
                      <span className="text-[10px] text-fg-muted font-mono shrink-0">
                        {thread.timestamp}
                      </span>
                    </div>

                    <div className="text-[11px] text-fg-muted truncate flex items-center gap-1">
                      {thread.type === 'dm' ? (
                        <span>DM from {thread.authorName}</span>
                      ) : (
                        <span>Thread in <span className="text-accent font-mono">#{thread.channelName}</span></span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Unread Badge / Tag Indicators */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {thread.mentions && thread.mentions.slice(0, 2).map((m) => (
                      <span 
                        key={m} 
                        className="text-[9px] bg-accent/15 text-accent border border-accent/30 px-1.5 py-0.5 rounded font-mono shrink-0"
                      >
                        {m}
                      </span>
                    ))}
                    {thread.hasSubThreads && (
                      <span className="text-[9px] bg-purple-500/15 text-purple-500 border border-purple-500/30 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-mono shrink-0">
                        <GitBranch className="w-2.5 h-2.5" />
                        <span>子话题</span>
                      </span>
                    )}
                  </div>

                  {thread.unreadCount && thread.unreadCount > 0 ? (
                    <span className="text-[10px] bg-accent/15 text-accent font-mono px-1.5 py-0.5 rounded-full border border-accent/30 flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      <span>{thread.unreadCount} unread</span>
                    </span>
                  ) : null}
                </div>

                {/* Preview Snippet */}
                <p className="text-[11px] text-fg-muted line-clamp-2 leading-relaxed group-hover:text-fg-secondary transition-colors">
                  {thread.preview}
                </p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
