import React, { useState, useEffect } from 'react';
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
  Trash2,
  Pencil,
  Globe,
  Upload,
  Download,
  Layers,
  PanelLeft,
  Cpu,
  Terminal,
  Copy,
} from 'lucide-react';
import { AgentAvatarArtwork, TeamArtwork } from './AgentAvatarArtwork';
import { ThemeSwitcher } from './ThemeSwitcher';
import { resolveAgentModelConfig, isModelConfigReady } from '../services/llmService';

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
  onEditAgent?: (agent: Agent) => void;
  onDuplicateAgent?: (agent: Agent) => void;
  onDeleteAgent?: (agentId: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  onExportAgentMemory?: (agent: Agent) => void;
  onImportMemoryCartridge?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
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
  onEditAgent,
  onDuplicateAgent,
  onDeleteAgent,
  onDeleteTeam,
  onExportAgentMemory,
  onImportMemoryCartridge,
  isSidebarCollapsed = false,
  onToggleSidebar,
}) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeTeamMenuId, setActiveTeamMenuId] = useState<string | null>(null);
  const [allStopped, setAllStopped] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'supported' | 'unsupported' | 'pending'>('all');

  const hasAgentLoadSession = (a: Agent) =>
    Boolean(a.capabilities?.supportsLoadSession ?? (a.capabilities as any)?.loadSession);

  const supportedCount = agents.filter((a) => a.status !== 'idle' && hasAgentLoadSession(a)).length;
  const unsupportedCount = agents.filter((a) => a.status !== 'idle' && !hasAgentLoadSession(a)).length;
  const pendingCount = agents.filter((a) => a.status === 'idle').length;

  const filteredAgents = agents.filter((a) => {
    if (sessionFilter === 'all') return true;
    const isSupported = a.status !== 'idle' && hasAgentLoadSession(a);
    const isUnsupported = a.status !== 'idle' && !hasAgentLoadSession(a);
    const isPending = a.status === 'idle';

    if (sessionFilter === 'supported') return isSupported;
    if (sessionFilter === 'unsupported') return isUnsupported;
    if (sessionFilter === 'pending') return isPending;
    return true;
  });

  // 点击其它区域或按 Escape 键自动回收 Agent/Team 下拉菜单
  useEffect(() => {
    if (!activeMenuId && !activeTeamMenuId) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('[data-dropdown-menu]')) {
        setActiveMenuId(null);
        setActiveTeamMenuId(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenuId(null);
        setActiveTeamMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuId, activeTeamMenuId]);

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
        <div className="flex items-center gap-3">
          {isSidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              className="p-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface border border-border transition-all cursor-pointer shadow-xs group shrink-0"
              title="展开侧边栏 (⌘B)"
            >
              <PanelLeft className="w-5 h-5 group-hover:scale-105 transition-transform" />
            </button>
          )}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-fg tracking-tight">
              Agents
            </h1>
            <p className="text-sm text-fg-secondary mt-1">
              Set up and manage your agents.
            </p>
          </div>
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-fg">ACP 会话恢复能力筛选:</span>
            <div className="flex items-center gap-1 bg-surface-subtle p-0.5 rounded-xl border border-border text-xs flex-wrap">
              <button
                onClick={() => setSessionFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  sessionFilter === 'all'
                    ? 'bg-accent text-accent-fg shadow-xs font-semibold'
                    : 'text-fg-secondary hover:text-fg'
                }`}
              >
                全部 ({agents.length})
              </button>
              <button
                onClick={() => setSessionFilter('supported')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                  sessionFilter === 'supported'
                    ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                    : 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800'
                }`}
                title="支持 ACP 原生 session/load 会话热恢复"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>支持 ({supportedCount})</span>
              </button>
              <button
                onClick={() => setSessionFilter('unsupported')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                  sessionFilter === 'unsupported'
                    ? 'bg-amber-600 text-white shadow-xs font-semibold'
                    : 'text-amber-700 dark:text-amber-400 hover:text-amber-800'
                }`}
                title="未实现 session/load，仅单次会话"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>仅单次 ({unsupportedCount})</span>
              </button>
              <button
                onClick={() => setSessionFilter('pending')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                  sessionFilter === 'pending'
                    ? 'bg-surface border border-border text-fg shadow-xs font-semibold'
                    : 'text-fg-muted hover:text-fg'
                }`}
                title="离线未探测对端 Capabilities"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                <span>待握手 ({pendingCount})</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {/* Add Agent Card (Dashed Border Card with Centered + Icon) */}
          <button
            onClick={onOpenConnectAgentModal}
            className="min-h-[20.5rem] h-auto rounded-3xl border-2 border-dashed border-border-dashed hover:border-accent bg-surface/70 hover:bg-surface-hover transition-all flex items-center justify-center cursor-pointer group shadow-card"
            title="添加新 Agent"
          >
            <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border group-hover:border-accent flex items-center justify-center text-fg-muted group-hover:text-accent group-hover:scale-110 transition-all shadow-xs">
              <Plus className="w-6 h-6 stroke-[2.5]" />
            </div>
          </button>

          {/* Individual Agent Cards */}
          {filteredAgents.map((agent) => {
            const isRunning =
              agent.status === 'running' ||
              agent.status === 'starting' ||
              agent.status === 'thinking' ||
              agent.status === 'using_skill' ||
              agent.status === 'accessing_workspace' ||
              agent.status === 'querying_memory';
            const isMenuOpen = activeMenuId === agent.id;
            const resolvedConfig = resolveAgentModelConfig(agent);
            const isModelReady = isModelConfigReady(resolvedConfig);

            return (
              <div
                key={agent.id}
                className="min-h-[20.5rem] h-auto rounded-3xl bg-surface border border-border hover:border-accent/50 hover:shadow-xl transition-all p-4 flex flex-col justify-between relative group select-none shadow-card"
              >
                {/* Top Card Row: Online Status Badge (Left) & Menu (Right) */}
                <div className="flex items-center justify-between h-6">
                  <div className="flex items-center gap-1.5 min-w-0 pr-1">
                    {/* Guest Clone Badge */}
                    {agent.isGuestClone && (
                      <span
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300 text-[10px] font-medium shrink-0"
                        title={`基于 ${agent.guestCloneFrom || '外部'} 经验的独立访客替身`}
                      >
                        <span>🪪 Guest</span>
                      </span>
                    )}

                    {/* Badge State */}
                    {agent.isModelHealthy === false || agent.status === 'error' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-[11px] font-medium"
                        title={agent.statusDetail || "连通性校验未通过或异常"}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        <span>{agent.status === 'error' ? 'error' : 'model error'}</span>
                      </span>
                    ) : agent.status === 'idle' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-500/10 border border-zinc-500/25 text-zinc-500 dark:text-zinc-400 text-[11px] font-medium"
                        title="通信未开启，点击下方 Start 按钮连接"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                        <span>offline</span>
                      </span>
                    ) : (agent.isRemote || agent.acpTransport === 'websocket') && isRunning ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[11px] font-medium shrink-0"
                        title={`远程 WebSocket 端点: ${agent.remoteUrl || agent.acpCommandOrUrl || 'ws://...'}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>remote online</span>
                      </span>
                    ) : agent.status === 'running' || agent.status === 'thinking' || agent.status === 'using_skill' || agent.status === 'accessing_workspace' || agent.status === 'querying_memory' ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium" title="ACP 协议已握手就绪，模型可调用">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span>online</span>
                      </span>
                    ) : agent.status === 'auth_required' ? (
                      <span
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/35 text-amber-600 dark:text-amber-400 text-[11px] font-medium"
                        title={agent.statusDetail || "缺少或无效 API Key"}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>auth required</span>
                      </span>
                    ) : agent.status === 'starting' ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                        <span>connecting...</span>
                      </span>
                    ) : agent.status === 'error' ? (
                      <span
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 text-[11px] font-medium"
                        title={agent.statusDetail || "启动或握手异常"}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        <span>error</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-fg-muted font-mono pl-1">
                        {agent.acpTransport || 'stdio'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5">
                    {/* Top-right Quick Edit Entry */}
                    {onEditAgent && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditAgent(agent);
                        }}
                        className="p-1 text-fg-muted hover:text-accent rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                        title="编辑 Agent 配置"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <div className="relative" data-dropdown-menu>
                      <button
                        onClick={() => setActiveMenuId(isMenuOpen ? null : agent.id)}
                        className="p-1 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <div className="absolute right-0 top-7 w-48 bg-surface border border-border rounded-2xl shadow-2xl py-1.5 z-30 text-xs animate-in fade-in zoom-in-95 duration-100">
                          {onEditAgent && (
                            <>
                              <button
                                onClick={() => {
                                  onEditAgent(agent);
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg flex items-center gap-2 cursor-pointer font-medium"
                              >
                                <Pencil className="w-3.5 h-3.5 text-accent" />
                                <span>编辑 Agent 配置</span>
                              </button>
                              <button
                                onClick={() => {
                                  onEditAgent(agent);
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg flex items-center gap-2 cursor-pointer font-medium"
                              >
                                <Cpu className="w-3.5 h-3.5 text-purple-500" />
                                <span>配置底座大模型 (LLM)</span>
                              </button>
                            </>
                          )}
                          {onDuplicateAgent && (
                            <button
                              onClick={() => {
                                onDuplicateAgent(agent);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-fg flex items-center gap-2 cursor-pointer font-medium text-blue-600 dark:text-blue-400"
                              title="复用当前配置快速生成全新独立副本 (独立 ID 与隔离记忆)"
                            >
                              <Copy className="w-3.5 h-3.5 text-blue-500" />
                              <span>快速复制 Agent (生成独立副本)</span>
                            </button>
                          )}
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

                          {/* Memory Export */}
                          {onExportAgentMemory && (
                            <button
                              onClick={() => {
                                onExportAgentMemory(agent);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-emerald-600 dark:text-emerald-400 flex items-center gap-2 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>导出记忆卡带 (.acpmem)</span>
                            </button>
                          )}

                          {/* Memory Import */}
                          {onImportMemoryCartridge && (
                            <button
                              onClick={() => {
                                onImportMemoryCartridge();
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3.5 py-1.5 hover:bg-surface-hover text-accent flex items-center gap-2 cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>挂载外挂记忆卡带</span>
                            </button>
                          )}

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
                </div>

                {/* Center: 3D Artwork Avatar with Status Capsule (Matching Screenshot) */}
                <div className="flex flex-col items-center justify-center my-auto relative">
                  <div className="relative">
                    {/* Visual 3D Artwork */}
                    <div className="group-hover:scale-105 transition-transform duration-200">
                      <AgentAvatarArtwork name={agent.name} avatar={agent.avatar} className="w-24 h-24 sm:w-26 sm:h-26" />
                    </div>

                    {/* Floating Status / Start Capsule at Bottom Center of Avatar */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAgentStatus(agent.id);
                      }}
                      disabled={agent.status === 'starting'}
                      className={`absolute -bottom-2.5 left-1/2 -translate-x-1/2 pl-3 pr-2 py-1 rounded-full text-[11px] font-semibold flex items-center gap-2 transition-all shadow-md cursor-pointer ${
                        agent.status === 'starting'
                          ? 'bg-surface border border-sky-500/40 text-sky-500 cursor-wait'
                          : isRunning
                          ? 'bg-surface border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:border-red-500/60'
                          : 'bg-surface border border-border hover:border-accent text-fg-secondary hover:text-fg'
                      }`}
                      title={
                        agent.status === 'starting'
                          ? '正在建立 ACP 握手连接...'
                          : isRunning
                          ? '点击挂起/断开通信连接'
                          : '点击启动通信并完成 ACP 握手'
                      }
                    >
                      <span>
                        {agent.status === 'starting'
                          ? 'Connecting...'
                          : isRunning
                          ? 'Stop'
                          : 'Start'}
                      </span>
                      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                        agent.status === 'starting'
                          ? 'bg-sky-500/20'
                          : isRunning
                          ? 'bg-emerald-500'
                          : 'bg-zinc-500/15'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          agent.status === 'starting'
                            ? 'bg-sky-500 animate-ping'
                            : isRunning
                            ? 'bg-white animate-pulse'
                            : 'bg-zinc-400 dark:bg-zinc-500'
                        }`} />
                      </span>
                    </button>
                  </div>
                </div>

                {/* Bottom Row: Name, Role/Description & Model Badge */}
                <div className="pt-2 border-t border-border space-y-1">
                  <div className="font-bold text-sm text-fg truncate tracking-tight" title={agent.name}>
                    {agent.name}
                  </div>
                  {(() => {
                    const secondaryText =
                      agent.role && agent.role !== agent.name
                        ? agent.role
                        : agent.description && agent.description !== agent.name
                        ? agent.description
                        : null;
                    return secondaryText ? (
                      <div className="text-xs text-fg-secondary truncate leading-relaxed" title={secondaryText}>
                        {secondaryText}
                      </div>
                    ) : null;
                  })()}
                  {/* Model / Process Protocol Badge (Option 2: 外部自主 ACP 进程显示进程协议，非模型) */}
                  {(() => {
                    const isShinobiNative =
                      agent.id === 'agent-shinobi-core' ||
                      (agent.localAcpProfile && agent.localAcpProfile.includes('Shinobi'));
                    const hasExplicitModel = Boolean(
                      agent.modelConfig &&
                      !agent.modelConfig.useGlobalDefault &&
                      agent.modelConfig.modelId &&
                      agent.modelConfig.modelId !== agent.name
                    );
                    const isModelDriven = isShinobiNative || hasExplicitModel;

                    if (isModelDriven) {
                      return (
                        <div className="pt-0.5 flex items-center gap-1.5 flex-wrap">
                          <div
                            className={`text-[10px] px-2 py-0.5 rounded-full font-mono inline-flex items-center gap-1 border max-w-full truncate ${
                              agent.isModelHealthy === false
                                ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                                : agent.isModelHealthy === true
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                : isModelReady
                                ? 'bg-accent/10 border-accent/25 text-accent'
                                : 'bg-surface-subtle border-border text-fg-muted'
                            }`}
                            title={
                              agent.isModelHealthy === false
                                ? `模型连接异常: ${agent.statusDetail || '校验失败'}`
                                : `底座模型: ${resolvedConfig.modelName || agent.modelBadge || '默认模型'}`
                            }
                          >
                            <Cpu className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">
                              {resolvedConfig.modelName || agent.modelBadge || '默认模型'}
                            </span>
                            {agent.isModelHealthy === true && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            )}
                            {agent.isModelHealthy === false && (
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    }

                    // 外部自主 ACP 进程：不展示虚假的模型名称，展示进程协议标识
                    const isRemote = agent.isRemote || agent.acpTransport === 'websocket';
                    return (
                      <div className="pt-0.5 flex items-center gap-1.5 flex-wrap">
                        <div
                          className="text-[10px] px-2 py-0.5 rounded-full font-mono inline-flex items-center gap-1 border max-w-full truncate bg-surface-subtle border-border text-fg-muted"
                          title={isRemote ? '远程 WebSocket ACP 端点' : '本地 ACP Stdio 独立子进程'}
                        >
                          {isRemote ? (
                            <Globe className="w-2.5 h-2.5 shrink-0 text-cyan-500" />
                          ) : (
                            <Terminal className="w-2.5 h-2.5 shrink-0 text-fg-muted" />
                          )}
                          <span className="truncate">
                            {isRemote ? 'Remote ACP' : 'ACP Stdio'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 方案 1: 单行精炼能力条 */}
                  {(() => {
                    const hasLoadSession = Boolean(
                      agent.capabilities?.supportsLoadSession ?? (agent.capabilities as any)?.loadSession
                    );
                    const isIdle = agent.status === 'idle';

                    return (
                      <div
                        className={`mt-2 p-1.5 px-2.5 rounded-xl border flex items-center justify-between text-[11px] select-none transition-all ${
                          isIdle
                            ? 'bg-surface-subtle border-border text-fg-muted'
                            : hasLoadSession
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-300'
                        }`}
                        title={
                          isIdle
                            ? '进程未启动。点击启动或进行连通性测试后，将自动解析对端 Capabilities。'
                            : hasLoadSession
                            ? 'ACP 对端声明支持会话热恢复。切换房间、重连或进程重启后，可无缝恢复先前的会话上下文。'
                            : 'ACP 对端未实现 session/load。每次重启或重连将以独立 session/new 重新初始化，系统自动采用全量历史追加兜底。'
                        }
                      >
                        {/* 左侧：精炼主标签 */}
                        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isIdle
                                ? 'bg-zinc-400 dark:bg-zinc-500'
                                : hasLoadSession
                                ? 'bg-emerald-500 animate-pulse'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span className="font-medium whitespace-nowrap">会话恢复</span>
                        </div>

                        {/* 右侧：紧凑状态短语 */}
                        <span className="font-mono text-[10px] font-semibold whitespace-nowrap shrink-0 pl-1">
                          {isIdle ? '待握手' : hasLoadSession ? '支持 ✓' : '仅单次 ⚠️'}
                        </span>
                      </div>
                    );
                  })()}
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

                  <div className="relative" data-dropdown-menu>
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
