import React from 'react';
import { Channel, Agent, AgentTeam, Project } from '../types';
import { 
  Hash, 
  Lock, 
  Plus, 
  Inbox, 
  Bot, 
  Users, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  PanelLeftClose, 
  PanelLeftOpen,
  Sparkles,
  Command,
  Shield,
  Circle,
  FileCode,
  ListTodo
} from 'lucide-react';
import { NinjaIcon } from './NinjaIcon';
import { ThemeSwitcher } from './ThemeSwitcher';
import { ProjectSwitcher } from './ProjectSwitcher';

interface SidebarProps {
  projects?: Project[];
  activeProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  channels: Channel[];
  activeChannelId: string;
  onSelectChannel: (channelId: string) => void;
  onOpenCreateChannel: () => void;
  agents: Agent[];
  teams: AgentTeam[];
  onOpenAgentTeamsModal: () => void;
  onSelectDirectMessage: (agent: Agent) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  currentWorkspace?: string;
  onOpenRustTauriHub?: () => void;
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
  agents,
  teams,
  onOpenAgentTeamsModal,
  onSelectDirectMessage,
  searchQuery,
  onSearchChange,
  isCollapsed = false,
  onToggleCollapse,
  currentWorkspace = 'shadow-crew',
  onOpenRustTauriHub,
  currentMainView = 'chat',
  onSelectMainView,
}) => {
  return (
    <aside
      id="shinobi-primary-sidebar"
      className="w-60 bg-surface border-r border-border flex flex-col shrink-0 select-none text-fg-secondary text-xs select-none transition-colors duration-150"
    >
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
          <span className="text-[10px] text-fg-muted font-mono flex items-center gap-0.5 border border-border px-1 py-0.2 rounded bg-surface">
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
            <Inbox className="w-4 h-4 text-fg-muted group-hover:text-accent transition-colors" />
            <span className="font-medium text-xs">Inbox</span>
          </div>
          <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.2 rounded font-mono border border-accent/30">
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

        {onOpenRustTauriHub && (
          <button
            onClick={onOpenRustTauriHub}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-all cursor-pointer group"
            title="查看 Rust + Tauri 架构代码与白皮书"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-xs">Rust+Tauri 架构</span>
            </div>
            <span className="text-[9px] text-purple-500 bg-purple-500/10 px-1 py-0.2 rounded border border-purple-500/30 font-mono">
              白皮书
            </span>
          </button>
        )}
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
            {channels
              .filter((c) => (!activeProjectId || !c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted')
              .map((channel) => {
                const isActive = channel.id === activeChannelId;
                const memberCount = channel.memberIds?.length || 1;

                return (
                  <button
                    key={channel.id}
                    onClick={() => {
                      onSelectChannel(channel.id);
                      onSelectMainView?.('chat');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-accent/15 text-accent font-semibold shadow-xs border border-accent/30'
                        : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0">
                      {channel.isPrivate ? (
                        <Lock className={`w-3 h-3 shrink-0 ${isActive ? 'text-amber-500' : 'text-fg-muted'}`} />
                      ) : (
                        <Hash className={`w-3 h-3 shrink-0 ${isActive ? 'text-accent' : 'text-fg-muted'}`} />
                      )}
                      
                      {/* Kind Badge */}
                      {channel.kind === 'feature' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono border border-cyan-500/20 shrink-0">
                          feat
                        </span>
                      )}
                      {channel.kind === 'requirement' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono border border-purple-500/20 shrink-0">
                          req
                        </span>
                      )}
                      {channel.kind === 'task' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono border border-amber-500/20 shrink-0">
                          task
                        </span>
                      )}

                      <span className="truncate text-xs">{channel.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Member count tag */}
                      <span className="text-[9px] text-fg-muted font-mono hidden sm:inline" title={`${memberCount} 位受邀成员`}>
                        {memberCount}人
                      </span>

                      {channel.unreadCount > 0 && (
                        <span className="text-[10px] bg-red-500/15 text-red-500 border border-red-500/30 px-1.5 py-0.2 rounded-full font-mono">
                          {channel.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* 5. Alter-Egos & Agents Section (专属替身与专职 Agent) */}
        <div>
          <div className="px-2.5 mb-1.5 flex items-center justify-between text-[11px] text-fg-muted uppercase tracking-wider font-semibold">
            <span>Alter-Egos & Agents</span>
            <span className="text-[10px] text-fg-muted font-mono">ACP</span>
          </div>

          <div className="space-y-0.5">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  onSelectDirectMessage(agent);
                  onSelectMainView?.('chat');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-fg-secondary hover:text-fg hover:bg-surface-hover transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-2 truncate">
                  <div className="relative shrink-0 flex items-center justify-center text-sm">
                    {agent.avatar}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-surface" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs truncate font-medium text-fg flex items-center gap-1">
                      <span>{agent.name}</span>
                      {agent.isManagedByYou && (
                        <span className="text-[9px] text-accent font-normal">
                          (替身)
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-fg-muted truncate">{agent.role}</div>
                  </div>
                </div>

                <span className="text-[9px] text-fg-muted font-mono px-1 rounded bg-surface-subtle border border-border shrink-0">
                  {agent.modelBadge ? agent.modelBadge.split(' ')[0] : 'ACP'}
                </span>
              </button>
            ))}
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
