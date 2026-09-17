import React, { useEffect, useRef } from 'react';
import { Agent } from '../types';
import { Bot, Users, Sparkles, Circle } from 'lucide-react';

export interface MentionItem {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  role: string;
  modelBadge?: string;
  isManagedByYou?: boolean;
  status?: string;
  isSpecialAll?: boolean;
  isChannelMember?: boolean;
}

interface MentionSuggestionsProps {
  isOpen: boolean;
  query: string;
  agents: Agent[];
  activeMemberIds?: string[];
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}

export const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({
  isOpen,
  query,
  agents,
  activeMemberIds,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const normalizedQuery = query.toLowerCase().trim();

  // Build candidate items
  const items: MentionItem[] = [];

  // 1. @all Special Mention option
  if ('all'.includes(normalizedQuery) || normalizedQuery === '') {
    items.push({
      id: 'all',
      name: 'All Members',
      handle: '@all',
      avatar: '👥',
      role: '广播给当前频道所有协作成员及 Agent',
      isSpecialAll: true,
      isChannelMember: true,
    });
  }

  // 2. Filter available agents by name, handle, role
  const matchedAgents = agents.filter((ag) => {
    return (
      normalizedQuery === '' ||
      ag.name.toLowerCase().includes(normalizedQuery) ||
      ag.handle.toLowerCase().includes(normalizedQuery) ||
      ag.role.toLowerCase().includes(normalizedQuery)
    );
  });

  // Sort: current channel members first, followed by remaining workspace agents
  matchedAgents.sort((a, b) => {
    if (!activeMemberIds) return 0;
    const aIn = activeMemberIds.includes(a.id);
    const bIn = activeMemberIds.includes(b.id);
    if (aIn && !bIn) return -1;
    if (!aIn && bIn) return 1;
    return 0;
  });

  matchedAgents.forEach((ag) => {
    const isMember = activeMemberIds ? activeMemberIds.includes(ag.id) : true;
    items.push({
      id: ag.id,
      name: ag.name,
      handle: ag.handle,
      avatar: ag.avatar,
      role: ag.role,
      modelBadge: ag.modelBadge,
      isManagedByYou: ag.isManagedByYou,
      status: ag.status,
      isChannelMember: isMember,
    });
  });

  if (items.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border rounded-xl shadow-2xl p-3 z-50 text-xs text-fg-muted text-center animate-in fade-in slide-in-from-bottom-2">
        未找到匹配的 Agent 或成员：<code className="text-accent font-mono font-bold">@{query}</code>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col text-xs text-fg select-none animate-in fade-in slide-in-from-bottom-2 max-h-64"
    >
      <div className="h-7 px-3 border-b border-border bg-surface-subtle flex items-center justify-between text-[10px] text-fg-muted font-medium">
        <span className="flex items-center gap-1">
          <Bot className="w-3 h-3 text-accent" />
          <span>选择要 @ 提及的 Agent (按 Enter 确认)</span>
        </span>
        <span className="font-mono">↑↓ 导航 · Esc 关闭</span>
      </div>

      <div className="overflow-y-auto p-1 space-y-0.5">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;

          return (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              onMouseEnter={() => {}}
              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                isSelected
                  ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
                  : 'text-fg-secondary hover:text-fg hover:bg-surface-hover border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-md bg-surface-subtle border border-border flex items-center justify-center text-sm shrink-0">
                  {item.avatar}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-semibold text-fg text-xs">{item.name}</span>
                    <span className="font-mono text-[10px] text-accent">{item.handle}</span>
                    {item.isManagedByYou && (
                      <span className="text-[9px] px-1 rounded bg-accent/15 text-accent font-mono border border-accent/25">
                        影替身
                      </span>
                    )}
                    {item.isSpecialAll && (
                      <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono border border-amber-500/25">
                        全员广播
                      </span>
                    )}
                    {!item.isSpecialAll && item.isChannelMember && (
                      <span className="text-[9px] px-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono border border-emerald-500/25">
                        本群成员
                      </span>
                    )}
                    {!item.isSpecialAll && !item.isChannelMember && (
                      <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 font-mono border border-purple-500/25">
                        点名拉入
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-fg-muted truncate">{item.role}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {item.modelBadge && (
                  <span className="text-[9px] text-fg-muted font-mono hidden sm:inline px-1.5 py-0.5 rounded bg-surface border border-border">
                    {item.modelBadge.split(' ')[0]}
                  </span>
                )}
                {item.status && (
                  <span className="flex items-center gap-1 text-[9px] font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.status === 'thinking'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-emerald-500'
                      }`}
                    />
                    <span className="text-fg-muted">{item.status}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
