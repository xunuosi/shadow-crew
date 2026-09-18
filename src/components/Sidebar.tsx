import React, { useState } from 'react';
import { Channel, Agent, AgentTeam, Project, ActiveAgentExecution } from '../types';
import { 
  Hash, 
  Lock, 
  Plus, 
  Inbox,
  Users, 
  Settings, 
  Bot, 
  FolderGit2, 
  GitBranch, 
  Sparkles, 
  Search,
  MessageSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  LogOut,
  Sliders,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  UserPlus
} from 'lucide-react';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { NinjaIcon } from './NinjaIcon';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';

interface SidebarProps {
  projects?: Project[];
  activeProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  channels: Channel[];
  activeChannelId: string;
  onSelectChannel: (channelId: string) => void;
  onOpenCreateChannel: () => void;
  onOpenMembersModal?: (channelId?: string) => void;
  onOpenDeleteChannelModal?: (channelId?: string) => void;
  agents: Agent[];
  teams: AgentTeam[];
  activeExecutions?: ActiveAgentExecution[];
  onOpenAgentTeamsModal: () => void;
  onSelectDirectMessage: (agent: Agent) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeThreadId?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  currentWorkspace?: string;
  currentMainView?: 'chat' | 'agents';
  onSelectMainView?: (view: 'chat' | 'agents') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  channels,
  activeChannelId,
  onSelectChannel,
  onOpenCreateChannel,
  onOpenMembersModal,
  onOpenDeleteChannelModal,
  agents,
  teams,
  activeExecutions = [],
  onOpenAgentTeamsModal,
  onSelectDirectMessage,
  searchQuery,
  onSearchChange,
  activeThreadId,
  isCollapsed = false,
  onToggleCollapse,
  currentWorkspace = 'shadow-crew',
  currentMainView = 'chat',
  onSelectMainView,
}) => {
  const { width: sidebarWidth, isDragging, handlePointerDown, resetWidth } = useResizablePanel({
    direction: 'right',
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 480,
    storageKey: 'shinobi_sidebar_width',
  });

  return (
    <aside
      id="shinobi-primary-sidebar"
      style={{ width: `${sidebarWidth}px` }}
      className={`relative bg-surface border-r border-border flex flex-col shrink-0 select-none text-fg-secondary text-xs select-none transition-colors duration-150 ${
        isDragging ? '' : 'transition-[width] duration-150'
      }`}
    >
      {/* Draggable Right Resize Handle */}
      <ResizeHandle
        direction="right"
        onPointerDown={handlePointerDown}
        onDoubleClick={resetWidth}
        isDragging={isDragging}
        title="拖动调整侧边栏宽度，双击恢复默认 260px"
      />
      {/* 1. Window Controls & History Bar */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-surface-subtle">
        {/* macOS window traffic lights */}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80" />
        </div>

        {/* Navigation & Toggle icons */}
        <div className="flex items-center gap-1 text-fg-muted">
          <button 
            onClick={onToggleCollapse} 
            className="p-1 hover:text-fg rounded hover:bg-surface-hover transition-colors cursor-pointer"
            title="收起/展开侧边栏"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
          <button 
            className="p-1 hover:text-fg rounded hover:bg-surface-hover transition-colors cursor-pointer"
            title="后退"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button 
            className="p-1 hover:text-fg rounded hover:bg-surface-hover transition-colors cursor-pointer"
            title="前进"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 1.1 Project Switcher (L0 项目空间切换) */}
      {projects && activeProjectId && onSelectProject ? (
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          agents={agents}
        />
      ) : (
        <div className="px-3 py-2 border-b border-border bg-surface-subtle flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-300 flex items-center justify-center text-xs font-bold shrink-0 border border-purple-500/30">
              🥷
            </div>
            <div className="truncate">
              <div className="font-bold text-fg text-xs truncate flex items-center gap-1">
                <span>{currentWorkspace}</span>
              </div>
              <div className="text-[9px] text-fg-muted font-mono truncate">Active Project Space</div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Global Search Pill */}
      <div className="p-2.5">
        <div className="relative flex items-center bg-surface-subtle border border-border rounded-lg px-2.5 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30 transition-all">
          <Search className="w-3.5 h-3.5 text-fg-muted shrink-0 mr-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search channels, topics..."
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none"
          />
          <span className="text-[10px] text-fg-muted font-mono flex items-center gap-0.5 border border-border px-1 py-0.5 rounded bg-surface shrink-0">
            ⌘K
          </span>
        </div>
      </div>

      {/* 3. Primary Top Navigation (Inbox, Agents & Teams) */}
      <div className="px-2 space-y-0.5 mb-2">
        <button
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-all cursor-pointer group"
          title="所有未读与待办"
        >
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-fg-muted group-hover:text-accent transition-colors shrink-0" />
            <span className="font-medium text-xs">Inbox</span>
          </div>
          <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded font-mono border border-accent/30 shrink-0">
            3
          </span>
        </button>

        <button
          onClick={() => onSelectMainView?.('agents')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all cursor-pointer group ${
            currentMainView === 'agents'
              ? 'bg-accent/15 text-accent font-semibold border border-accent/30 shadow-xs'
              : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
          }`}
          title="管理独立 Agent 及其自由编队 (Dashboard)"
        >
          <div className="flex items-center gap-2">
            <Bot className={`w-4 h-4 transition-transform group-hover:scale-110 ${currentMainView === 'agents' ? 'text-accent' : 'text-emerald-500'}`} />
            <span className="font-medium text-xs">Agents & 编队</span>
          </div>
          <span className="text-[10px] text-fg-muted font-mono">
            {agents.length} Agent · {teams.length} 编队
          </span>
        </button>
      </div>

      {/* 4. Channels Section (功能、需求与任务频道 - 按当前项目过滤) */}
      <div className="flex-1 overflow-y-auto px-2 space-y-4">
        <div>
          <div className="px-2.5 mb-1.5 flex items-center justify-between text-[11px] text-fg-muted uppercase tracking-wider font-semibold">
            <span>Channels ({channels.filter((c) => (!activeProjectId || !c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted').length})</span>
            <button
              onClick={onOpenCreateChannel}
              className="text-fg-muted hover:text-accent p-0.5 rounded hover:bg-surface-hover transition-colors cursor-pointer"
              title="创建新功能/任务频道"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {channels.filter((c) => (!activeProjectId || !c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted').length === 0 ? (
              <button
                type="button"
                onClick={onOpenCreateChannel}
                className="w-full px-2.5 py-3 rounded-lg border border-dashed border-border hover:border-accent/40 text-fg-muted hover:text-accent transition-all cursor-pointer text-center group bg-surface-subtle/30"
              >
                <Plus className="w-4 h-4 mx-auto mb-1 opacity-70 group-hover:scale-110 transition-transform text-accent" />
                <span className="text-[11px] font-medium block">暂无频道，点击新建</span>
              </button>
            ) : (
              channels
                .filter((c) => (!activeProjectId || !c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted')
                .map((channel) => {
                const isActive = channel.id === activeChannelId;
                const memberCount = channel.memberIds?.length || 1;

                return (
                  <div
                    key={channel.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onSelectChannel(channel.id);
                      onSelectMainView?.('chat');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSelectChannel(channel.id);
                        onSelectMainView?.('chat');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-accent/15 text-accent font-semibold shadow-xs border border-accent/30'
                        : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0 flex-1 mr-1">
                      {channel.isPrivate ? (
                        <Lock className={`w-3 h-3 shrink-0 ${isActive ? 'text-amber-500' : 'text-fg-muted'}`} />
                      ) : (
                        <Hash className={`w-3 h-3 shrink-0 ${isActive ? 'text-accent' : 'text-fg-muted'}`} />
                      )}
                      
                      {/* Kind Badge */}
                      {channel.kind === 'feature' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono border border-cyan-500/20 shrink-0">
                          feat
                        </span>
                      )}
                      {channel.kind === 'requirement' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono border border-purple-500/20 shrink-0">
                          req
                        </span>
                      )}
                      {channel.kind === 'task' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono border border-amber-500/20 shrink-0">
                          task
                        </span>
                      )}

                      <span className="truncate text-xs font-medium">{channel.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Quick action buttons visible on group hover */}
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        {onOpenMembersModal && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMembersModal(channel.id);
                            }}
                            className="p-1 rounded hover:bg-accent/20 hover:text-accent text-fg-muted transition-colors cursor-pointer"
                            title="邀请 Agent / 管理成员"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onOpenDeleteChannelModal && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDeleteChannelModal(channel.id);
                            }}
                            className="p-1 rounded hover:bg-red-500/20 hover:text-red-500 text-fg-muted transition-colors cursor-pointer"
                            title="删除频道"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Member count tag (hidden on hover when actions show) */}
                      <span className="text-[9px] text-fg-muted font-mono group-hover:hidden hidden sm:inline shrink-0" title={`${memberCount} 位受邀成员`}>
                        {memberCount}人
                      </span>

                      {channel.unreadCount > 0 && (
                        <span className="text-[10px] bg-red-500/15 text-red-500 border border-red-500/30 px-1.5 py-0.5 rounded-full font-mono shrink-0">
                          {channel.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }))}
          </div>
        </div>

        {/* 5. Alter-Egos & Agents Section (专属替身与专职 Agent) */}
        <div>
          <div className="px-2.5 mb-1.5 flex items-center justify-between text-[11px] text-fg-muted uppercase tracking-wider font-semibold">
            <span>Alter-Egos & Agents</span>
            <span className="text-[10px] text-fg-muted font-mono">ACP</span>
          </div>

          <div className="space-y-0.5">
            {agents.map((agent) => {
              const formatBadge = (b?: string) => {
                if (!b) return 'ACP';
                const lower = b.toLowerCase();
                if (lower.includes('deepseek')) return 'DeepSeek';
                if (lower.includes('claude')) return 'Claude';
                if (lower.includes('codex')) return 'Codex';
                if (lower.includes('gpt')) return 'GPT-4o';
                if (lower.includes('kimi')) return 'Kimi';
                if (lower.includes('qwen')) return 'Qwen';
                const first = b.split(' ')[0];
                return first.length > 8 ? `${first.slice(0, 7)}…` : first;
              };

              const isSelected = activeThreadId === `thread-dm-${agent.id}`;
              const isAgentActive = activeExecutions.some((e) => e.agentId === agent.id);
              const isOnline = agent.status === 'running' || agent.status === 'thinking' || agent.status === 'using_skill' || agent.status === 'accessing_workspace' || agent.status === 'querying_memory';
              const isStarting = agent.status === 'starting';
              const isError = agent.status === 'error';
              const isAuth = agent.status === 'auth_required';

              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    onSelectDirectMessage(agent);
                    onSelectMainView?.('chat');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer group ${
                    isSelected
                      ? 'bg-accent/15 text-accent font-medium border border-accent/30 shadow-2xs'
                      : 'text-fg-secondary hover:text-fg hover:bg-surface-hover border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                    <div className="relative shrink-0 flex items-center justify-center text-sm">
                      {agent.avatar}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface transition-colors ${
                          isOnline
                            ? 'bg-emerald-500'
                            : isStarting
                            ? 'bg-sky-500 animate-ping'
                            : isAuth
                            ? 'bg-amber-500'
                            : isError
                            ? 'bg-red-500'
                            : 'bg-zinc-400 dark:bg-zinc-600'
                        }`}
                        title={
                          isOnline
                            ? '在线 (通信已建立)'
                            : isStarting
                            ? '正在连接...'
                            : isAuth
                            ? '需要配置密钥'
                            : isError
                            ? '通信异常'
                            : '未开启通信 (离线 · 点击 Start 开启)'
                        }
                      />
                      {isAgentActive && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-80" />
                      )}
                    </div>
                    <div className="truncate min-w-0 flex-1">
                      <div className="text-xs truncate font-medium text-fg flex items-center gap-1">
                        <span className="truncate">{agent.name}</span>
                        {agent.isManagedByYou && (
                          <span className="text-[9px] text-accent font-normal shrink-0">
                            (影替身)
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-fg-muted truncate">{agent.role}</div>
                    </div>
                  </div>

                  <span 
                    className="text-[9px] text-fg-muted font-mono px-1.5 py-0.5 rounded bg-surface-subtle border border-border shrink-0 max-w-[68px] truncate"
                    title={agent.modelBadge || 'ACP'}
                  >
                    {formatBadge(agent.modelBadge)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 6. Bottom User Card & Status (Norris_M5Pro) + Theme Switcher */}
      <div className="p-2.5 border-t border-border bg-surface-subtle">
        <div className="flex items-center justify-between bg-surface p-2 rounded-xl border border-border hover:border-accent/40 transition-colors">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs">
              N
            </div>
            <div className="truncate">
              <div className="font-semibold text-fg text-xs truncate flex items-center gap-1">
                <span>Norris_M5Pro</span>
              </div>
              <div className="text-[10px] text-emerald-500 font-mono flex items-center gap-1 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>🥷 Local Dev</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeSwitcher variant="compact" />
            <div 
              className="p-1 text-fg-muted hover:text-accent transition-colors cursor-pointer"
              title={`当前关联仓库: ${currentWorkspace}`}
            >
              <NinjaIcon className="w-4 h-4 text-accent" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
