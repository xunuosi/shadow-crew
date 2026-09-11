import React, { useState } from 'react';
import { Agent, AgentTeam, Channel } from '../types';
import { 
  Plus, 
  Sliders, 
  Square, 
  Play, 
  MoreVertical, 
  Info, 
  Bot, 
  Sparkles, 
  Zap,
  Trash2
} from 'lucide-react';
import { AgentAvatarArtwork, TeamArtwork } from './AgentAvatarArtwork';
import { ThemeSwitcher } from './ThemeSwitcher';

interface AgentDashboardProps {
  agents: Agent[];
  teams: AgentTeam[];
  channels: Channel[];
  onOpenConnectAgentModal: () => void;
  onOpenCreateTeamModal: () => void;
  onOpenAgentDefaultsModal?: () => void;
  onToggleAgentStatus: (agentId: string) => void;
  onLaunchTeamThread: (team: AgentTeam) => void;
  onStart1on1Chat: (agent: Agent) => void;
  onInspectAgent: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => void;
  onDeleteTeam?: (teamId: string) => void;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  agents,
  teams,
  channels,
  onOpenConnectAgentModal,
  onOpenCreateTeamModal,
  onOpenAgentDefaultsModal,
  onToggleAgentStatus,
  onLaunchTeamThread,
  onStart1on1Chat,
  onInspectAgent,
  onDeleteAgent,
  onDeleteTeam,
}) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeTeamMenuId, setActiveTeamMenuId] = useState<string | null>(null);
  const [allStopped, setAllStopped] = useState(false);

  const handleStopAll = () => {
    agents.forEach((ag) => {
      if (ag.status !== 'idle') {
        onToggleAgentStatus(ag.id);
      }
    });
    setAllStopped(true);
    setTimeout(() => setAllStopped(false), 2000);
  };

  return (
    <div 
      id="shinobi-agent-dashboard"
      className="flex-1 overflow-y-auto bg-canvas text-fg p-6 md:p-10 space-y-10 select-none font-sans transition-colors duration-150"
    >
      {/* 1. Page Header (Exact Match to Design Screenshot + Theme Switcher) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-fg tracking-tight">
            Agents
          </h1>
          <p className="text-sm text-fg-secondary mt-1">
            Set up and manage your agents.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Quick Theme Switcher Pill */}
          <ThemeSwitcher variant="compact" />

          {onOpenAgentDefaultsModal && (
            <button
              onClick={onOpenAgentDefaultsModal}
              className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surface-hover border border-border hover:border-border-hover text-xs text-fg-secondary hover:text-fg flex items-center gap-2 transition-all cursor-pointer shadow-xs"
              title="配置 Agent 全局默认值"
            >
              <Sliders className="w-3.5 h-3.5 text-fg-muted" />
              <span>Set agent defaults</span>
            </button>
          )}

          <button
            onClick={handleStopAll}
            className={`px-3.5 py-1.5 rounded-xl border text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs ${
              allStopped
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                : 'bg-surface hover:bg-surface-hover border-border hover:border-red-500/40 text-fg-secondary hover:text-red-500'
            }`}
            title="一键暂停所有运行中的 Agent 进程"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{allStopped ? '已全部暂停' : 'Stop running agents'}</span>
          </button>
        </div>
      </div>

      {/* 2. Top Section: Agents Grid (Exact Match to Design Screenshot) */}
      <section className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {/* Add Agent Card (Dashed Border Card with Centered + Icon) */}
          <button
            onClick={onOpenConnectAgentModal}
            className="h-72 rounded-3xl border-2 border-dashed border-border-dashed hover:border-accent bg-surface/70 hover:bg-surface-hover transition-all flex items-center justify-center cursor-pointer group shadow-card"
            title="添加新 Agent"
          >
            <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border group-hover:border-accent flex items-center justify-center text-fg-muted group-hover:text-accent group-hover:scale-110 transition-all shadow-xs">
              <Plus className="w-6 h-6 stroke-[2.5]" />
            </div>
          </button>

          {/* Individual Agent Cards */}
          {agents.map((agent) => {
            const isRunning = agent.status !== 'idle';
            const isMenuOpen = activeMenuId === agent.id;

            return (
              <div
                key={agent.id}
                className="h-72 rounded-3xl bg-surface border border-border hover:border-accent/50 hover:shadow-xl transition-all p-4 flex flex-col justify-between relative group select-none shadow-card"
              >
                {/* Top Card Row: Online Status Badge (Left) & Menu (Right) */}
                <div className="flex items-center justify-between h-6">
                  <div>
                    {isRunning ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span>online</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-fg-muted font-mono pl-1">
                        {agent.acpTransport || 'stdio'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuId(isMenuOpen ? null : agent.id)}
                      className="p-1 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Dropdown Menu */}
                    {isMenuOpen && (
                      <div className="absolute right-0 top-7 w-44 bg-surface border border-border rounded-2xl shadow-2xl py-1.5 z-30 text-xs animate-in fade-in zoom-in-95 duration-100">
                        <button
                          onClick={() => {
                            onStart1on1Chat(agent);
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg flex items-center gap-2 cursor-pointer"
                        >
                          <Bot className="w-3.5 h-3.5 text-accent" />
                          <span>发起 1-on-1 私信</span>
                        </button>
                        <button
                          onClick={() => {
                            onInspectAgent(agent.id);
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg flex items-center gap-2 cursor-pointer"
                        >
                          <Info className="w-3.5 h-3.5 text-purple-500" />
                          <span>查看能力与记忆 (ACP)</span>
                        </button>
                        <button
                          onClick={() => {
                            onToggleAgentStatus(agent.id);
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg-secondary flex items-center gap-2 cursor-pointer"
                        >
                          {isRunning ? (
                            <>
                              <Square className="w-3.5 h-3.5 text-red-500" />
                              <span>暂停 Agent 进程</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 text-emerald-500" />
                              <span>启动 Agent 进程</span>
                            </>
                          )}
                        </button>
                        {onDeleteAgent && (
                          <button
                            onClick={() => {
                              onDeleteAgent(agent.id);
                              setActiveMenuId(null);
                            }}
                            className="w-full text-left px-3.5 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 flex items-center gap-2 cursor-pointer border-t border-border"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>移除此 Agent</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Center: 3D Artwork Avatar with Status Capsule (Matching Screenshot) */}
                <div className="flex flex-col items-center justify-center my-auto relative">
                  <div className="relative">
                    {/* Visual 3D Artwork */}
                    <div className="group-hover:scale-105 transition-transform duration-200">
                      <AgentAvatarArtwork name={agent.name} className="w-24 h-24 sm:w-26 sm:h-26" />
                    </div>

                    {/* Floating Status / Start Capsule at Bottom Center of Avatar */}
                    <button
                      onClick={() => onToggleAgentStatus(agent.id)}
                      className={`absolute -bottom-2.5 left-1/2 -translate-x-1/2 pl-3 pr-2 py-1 rounded-full text-[11px] font-semibold flex items-center gap-2 transition-all shadow-md cursor-pointer ${
                        isRunning
                          ? 'bg-surface border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:border-red-500/60'
                          : 'bg-surface border border-border hover:border-accent text-fg-secondary hover:text-fg'
                      }`}
                      title={isRunning ? '点击挂起进程' : '点击启动进程'}
                    >
                      <span>{isRunning ? 'Stop' : 'Start'}</span>
                      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                        isRunning ? 'bg-emerald-500' : 'bg-emerald-500/25'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-white animate-pulse' : 'bg-emerald-500'}`} />
                      </span>
                    </button>
                  </div>
                </div>

                {/* Bottom Row: Name & Role/Description */}
                <div className="pt-2 border-t border-border space-y-0.5">
                  <div className="font-bold text-sm text-fg truncate tracking-tight">
                    {agent.name}
                  </div>
                  <div className="text-xs text-fg-secondary truncate leading-relaxed">
                    {agent.role || agent.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Bottom Section: Agent Teams Grid (Exact Match to Design Screenshot) */}
      <section className="space-y-4 pt-4 border-t border-border">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-fg tracking-tight">
            Agent teams
          </h2>
          <p className="text-sm text-fg-secondary mt-1">
            Group agents that you can add to a channel together.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {/* Add Team Card (Dashed Border Card with Centered + Icon) */}
          <button
            onClick={onOpenCreateTeamModal}
            className="h-72 rounded-3xl border-2 border-dashed border-border-dashed hover:border-accent bg-surface/70 hover:bg-surface-hover transition-all flex items-center justify-center cursor-pointer group shadow-card"
            title="组建协同编队"
          >
            <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border group-hover:border-accent flex items-center justify-center text-fg-muted group-hover:text-accent group-hover:scale-110 transition-all shadow-xs">
              <Plus className="w-6 h-6 stroke-[2.5]" />
            </div>
          </button>

          {/* Team Cards */}
          {teams.map((team) => {
            const teamAgents = agents.filter((a) => team.agentIds.includes(a.id));
            const isMenuOpen = activeTeamMenuId === team.id;

            return (
              <div
                key={team.id}
                className="h-72 rounded-3xl bg-surface border border-border hover:border-accent/50 hover:shadow-xl transition-all p-4 flex flex-col justify-between relative group select-none shadow-card"
              >
                {/* Top Card Row: Info Icon (Left) & Menu (Right) */}
                <div className="flex items-center justify-between h-6 text-fg-muted">
                  <div 
                    className="p-1 hover:text-fg transition-colors cursor-pointer"
                    title={`编队成员: ${teamAgents.map(a => a.name).join(', ')}`}
                  >
                    <Info className="w-4 h-4" />
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setActiveTeamMenuId(isMenuOpen ? null : team.id)}
                      className="p-1 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Team Dropdown Menu */}
                    {isMenuOpen && (
                      <div className="absolute right-0 top-7 w-44 bg-surface border border-border rounded-2xl shadow-2xl py-1.5 z-30 text-xs animate-in fade-in zoom-in-95 duration-100">
                        <button
                          onClick={() => {
                            onLaunchTeamThread(team);
                            setActiveTeamMenuId(null);
                          }}
                          className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-accent flex items-center gap-2 cursor-pointer font-medium"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>⚡ 召唤开聊 (Launch)</span>
                        </button>
                        {onDeleteTeam && (
                          <button
                            onClick={() => {
                              onDeleteTeam(team.id);
                              setActiveTeamMenuId(null);
                            }}
                            className="w-full text-left px-3.5 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 flex items-center gap-2 cursor-pointer border-t border-border"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>解散编队</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Center: Team 3D Artwork (Matching Screenshot) */}
                <div className="flex flex-col items-center justify-center my-auto">
                  <div className="group-hover:scale-105 transition-transform duration-200">
                    <TeamArtwork name={team.name} className="w-24 h-24 sm:w-26 sm:h-26" />
                  </div>
                </div>

                {/* Bottom Row: Team Name & Description */}
                <div className="pt-2 border-t border-border space-y-0.5">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm text-fg truncate tracking-tight">
                      {team.name}
                    </div>
                    {/* Quick Zap to launch thread */}
                    <button
                      onClick={() => onLaunchTeamThread(team)}
                      className="text-[10px] text-accent-text bg-accent hover:bg-accent-hover px-2.5 py-0.5 rounded-lg font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1 shadow-xs"
                      title="以此编队在当前频道发起新议题"
                    >
                      <Zap className="w-2.5 h-2.5" />
                      <span>开聊</span>
                    </button>
                  </div>
                  <div className="text-xs text-fg-secondary truncate leading-relaxed">
                    {team.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
