import React, { useState, useEffect } from 'react';
import {
  AcpHarnessType,
  Agent,
  AgentTeam,
  Channel,
  CodexSourceProbeReport,
  InstalledScpackSummary,
  ScpackManifest,
} from '../types';
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
  Layers,
  PanelLeft,
  Cpu,
  Terminal,
  Copy,
  ShieldCheck,
  Package,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { AgentAvatarArtwork, TeamArtwork } from './AgentAvatarArtwork';
import { ThemeSwitcher } from './ThemeSwitcher';
import { isAgentActivelyRunning } from '../services/remoteAgentLifecycle';
import {
  probeAcpMemorySources,
  probeCodexMemorySources,
  exportAcpScpack,
  exportCodexScpack,
  importScpack,
  listInstalledScpacks,
  uninstallScpack,
  createPortableExpertAgentFromPack,
} from '../services/scpackService';

interface AgentDashboardProps {
  agents: Agent[];
  teams: AgentTeam[];
  channels: Channel[];
  onOpenConnectAgentModal: () => void;
  onOpenCreateTeamModal: () => void;
  onOpenAgentDefaultsModal?: () => void;
  onOpenPermissionCenter?: () => void;
  onToggleAgentStatus: (agentId: string) => void;
  onLaunchTeamThread: (team: AgentTeam) => void;
  onStart1on1Chat: (agent: Agent) => void;
  onInspectAgent: (agentId: string) => void;
  onEditAgent?: (agent: Agent) => void;
  onDuplicateAgent?: (agent: Agent) => void;
  onCreateExpertAgentFromPack?: (agent: Agent) => void;
  onDeleteAgent?: (agentId: string) => void;
  onDeleteTeam?: (teamId: string) => void;
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
  onOpenPermissionCenter,
  onToggleAgentStatus,
  onLaunchTeamThread,
  onStart1on1Chat,
  onInspectAgent,
  onEditAgent,
  onDuplicateAgent,
  onCreateExpertAgentFromPack,
  onDeleteAgent,
  onDeleteTeam,
  isSidebarCollapsed = false,
  onToggleSidebar,
}) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeTeamMenuId, setActiveTeamMenuId] = useState<string | null>(null);
  const [allStopped, setAllStopped] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'supported' | 'unsupported' | 'pending'>('all');

  // Portable Expert Pack (.scpack v1.0) Wizard State
  const [isScpackModalOpen, setIsScpackModalOpen] = useState(false);
  const [scpackTab, setScpackTab] = useState<'export' | 'import'>('export');
  const [selectedHarness, setSelectedHarness] = useState<AcpHarnessType>('codex');
  const [probeReport, setProbeReport] = useState<CodexSourceProbeReport | null>(null);
  const [isProbingScpack, setIsProbingScpack] = useState(false);
  const [scpackPackageName, setScpackPackageName] = useState('Codex Architecture Expert Pack');
  const [scpackVersion, setScpackVersion] = useState('1.0.0');
  const [scpackAuthor, setScpackAuthor] = useState('Senior Architect A');
  const [scpackDescription, setScpackDescription] = useState('Distilled Codex Playbooks, AGENTS.md contracts & verified debugging patterns');
  const [scpackOutputPath, setScpackOutputPath] = useState('~/.shadow-crew/exports/codex-expert.scpack');
  const [userConfirmedRedaction, setUserConfirmedRedaction] = useState(false);
  const [exportedManifest, setExportedManifest] = useState<ScpackManifest | null>(null);
  const [scpackImportPath, setScpackImportPath] = useState('~/.shadow-crew/exports/codex-expert.scpack');
  const [installedScpacks, setInstalledScpacks] = useState<InstalledScpackSummary[]>([]);
  const [scpackError, setScpackError] = useState<string | null>(null);
  const [scpackNotice, setScpackNotice] = useState<string | null>(null);

  const refreshScpacksAndProbe = async (targetHarness: AcpHarnessType = selectedHarness) => {
    setIsProbingScpack(true);
    setScpackError(null);
    try {
      const [report, packs] = await Promise.all([
        probeAcpMemorySources(targetHarness),
        listInstalledScpacks(),
      ]);
      setProbeReport(report);
      setInstalledScpacks(packs);
    } catch (e: any) {
      setScpackError(e?.message || String(e));
    } finally {
      setIsProbingScpack(false);
    }
  };

  const handleSelectHarness = (harness: AcpHarnessType) => {
    setSelectedHarness(harness);
    setScpackError(null);
    setScpackNotice(null);
    setUserConfirmedRedaction(false);
    setExportedManifest(null);
    if (harness === 'claude-code') {
      setScpackPackageName('Claude Code Engineering Expert Pack');
      setScpackDescription('Distilled Claude Code Playbooks, CLAUDE.md contracts & architectural patterns');
      setScpackOutputPath('~/.shadow-crew/exports/claude-expert.scpack');
      setScpackImportPath('~/.shadow-crew/exports/claude-expert.scpack');
    } else {
      setScpackPackageName('Codex Architecture Expert Pack');
      setScpackDescription('Distilled Codex Playbooks, AGENTS.md contracts & verified debugging patterns');
      setScpackOutputPath('~/.shadow-crew/exports/codex-expert.scpack');
      setScpackImportPath('~/.shadow-crew/exports/codex-expert.scpack');
    }
    void refreshScpacksAndProbe(harness);
  };

  const hasAgentSessionRecovery = (a: Agent) =>
    Boolean(
      a.capabilities?.supportsResumeSession ||
      a.capabilities?.supportsLoadSession ||
      (a.capabilities as any)?.loadSession
    );

  const supportedCount = agents.filter((a) => a.status !== 'idle' && hasAgentSessionRecovery(a)).length;
  const unsupportedCount = agents.filter((a) => a.status !== 'idle' && !hasAgentSessionRecovery(a)).length;
  const pendingCount = agents.filter((a) => a.status === 'idle').length;

  const filteredAgents = agents.filter((a) => {
    if (sessionFilter === 'all') return true;
    const isSupported = a.status !== 'idle' && hasAgentSessionRecovery(a);
    const isUnsupported = a.status !== 'idle' && !hasAgentSessionRecovery(a);
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
      if (isAgentActivelyRunning(ag)) {
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

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {/* Quick Theme Switcher Pill */}
          <ThemeSwitcher variant="compact" />

          <button
            onClick={() => {
              setIsScpackModalOpen(true);
              void refreshScpacksAndProbe();
            }}
            className="px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100/80 dark:bg-blue-500/15 dark:hover:bg-blue-500/25 border border-blue-300 dark:border-blue-500/30 text-xs text-blue-800 dark:text-blue-300 font-medium flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            title="导出或导入可迁移专家智能体能力包 (.scpack v1.0 · 支持 Codex & Claude Code)"
          >
            <Package className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>专家能力包 (.scpack)</span>
          </button>

          {onOpenPermissionCenter && (
            <button
              onClick={onOpenPermissionCenter}
              className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surface-hover border border-border hover:border-border-hover text-xs text-fg-secondary hover:text-fg flex items-center gap-2 transition-all cursor-pointer shadow-xs"
              title="查看与撤销本地 ACP 执行授权"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Execution permissions</span>
            </button>
          )}

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
                title="支持 ACP 原生 session/resume 或 session/load 会话恢复"
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
                title="未实现 session/resume 或 session/load，仅单次会话"
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

            return (
              <div
                key={agent.id}
                className="min-h-[20.5rem] h-auto rounded-3xl bg-surface border border-border hover:border-accent/50 hover:shadow-xl transition-all p-4 flex flex-col justify-between relative group select-none shadow-card"
              >
                {/* Top Card Row: Online Status Badge (Left) & Menu (Right) */}
                <div className="flex items-center justify-between h-6 gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                    {/* Badge State */}
                    {agent.status === 'error' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/25 text-rose-800 dark:text-rose-400 text-[11px] font-medium whitespace-nowrap shrink-0 select-none"
                        title={agent.statusDetail || "ACP 连通异常"}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                        <span className="whitespace-nowrap">error</span>
                      </span>
                    ) : agent.status === 'idle' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-500/10 border border-zinc-300 dark:border-zinc-500/25 text-zinc-700 dark:text-zinc-400 text-[11px] font-medium whitespace-nowrap shrink-0 select-none"
                        title="通信未开启，点击下方 Start 按钮连接"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" />
                        <span className="whitespace-nowrap">offline</span>
                      </span>
                    ) : (agent.isRemote || agent.acpTransport === 'websocket') && isRunning ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-500/15 border border-cyan-300 dark:border-cyan-500/35 text-cyan-800 dark:text-cyan-300 text-[11px] font-medium whitespace-nowrap shrink-0 select-none"
                        title={`远程 WebSocket 端点: ${agent.remoteUrl || agent.acpCommandOrUrl || 'ws://...'}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400 animate-pulse shrink-0" />
                        <span className="whitespace-nowrap">remote online</span>
                      </span>
                    ) : agent.status === 'running' || agent.status === 'thinking' || agent.status === 'using_skill' || agent.status === 'accessing_workspace' || agent.status === 'querying_memory' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/25 text-emerald-800 dark:text-emerald-400 text-[11px] font-medium whitespace-nowrap shrink-0 select-none"
                        title="ACP 协议已握手就绪，模型可调用"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="whitespace-nowrap">online</span>
                      </span>
                    ) : agent.status === 'auth_required' ? (
                      <span
                        onClick={(e) => {
                          if (onEditAgent) {
                            e.stopPropagation();
                            onEditAgent(agent);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] font-medium whitespace-nowrap shrink-0 select-none ${
                          onEditAgent ? 'cursor-pointer hover:border-amber-400 dark:hover:border-amber-400/80 hover:shadow-2xs transition-all' : ''
                        }`}
                        title={agent.statusDetail ? `${agent.statusDetail}（点击配置）` : "缺少或无效 API Key / 认证凭据，点击立即配置"}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse shrink-0" />
                        <span className="whitespace-nowrap">auth required</span>
                      </span>
                    ) : agent.status === 'starting' ? (
                      <span
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 border border-sky-300 dark:border-sky-500/25 text-sky-800 dark:text-sky-400 text-[11px] font-medium whitespace-nowrap shrink-0 select-none"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping shrink-0" />
                        <span className="whitespace-nowrap">connecting...</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-fg-muted font-mono pl-1 whitespace-nowrap shrink-0 select-none">
                        {agent.acpTransport || 'stdio'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0 ml-auto">
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
                      className={`absolute -bottom-2.5 left-1/2 -translate-x-1/2 pl-3 pr-2 py-1 rounded-full text-[11px] font-semibold flex items-center gap-2 transition-all shadow-md cursor-pointer ${
                        agent.status === 'starting'
                          ? 'bg-surface border border-sky-500/40 text-sky-500 hover:border-red-500/60'
                          : isRunning
                          ? 'bg-surface border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:border-red-500/60'
                          : 'bg-surface border border-border hover:border-accent text-fg-secondary hover:text-fg'
                      }`}
                      title={
                        agent.status === 'starting'
                          ? '正在建立 ACP 握手连接（点击可取消并停止）'
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
                  {/* ACP 进程协议标识；模型与记忆由端点自身管理 */}
                  {(() => {
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
                        {agent.expertPack && (
                          <div
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 border max-w-full truncate bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300"
                            title={`${agent.expertPack.badgeLabel} · Package: ${agent.expertPack.packageId} · Native Memory: Disabled (--disable memories)`}
                          >
                            <Package className="w-2.5 h-2.5 shrink-0 text-blue-600 dark:text-blue-400" />
                            <span className="truncate">{agent.expertPack.badgeLabel}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 方案 1: 单行精炼能力条 */}
                  {(() => {
                    const isHandshakePending =
                      agent.status === 'idle' ||
                      agent.status === 'starting' ||
                      agent.status === 'error' ||
                      agent.status === 'auth_required';
                    const hasResume =
                      !isHandshakePending &&
                      Boolean(agent.capabilities?.supportsResumeSession);
                    const hasLoadSession =
                      !isHandshakePending &&
                      Boolean(
                        agent.capabilities?.supportsLoadSession ??
                          (agent.capabilities as any)?.loadSession
                      );
                    const isSupported = hasResume || hasLoadSession;

                    const detailText = isHandshakePending
                      ? '待握手'
                      : hasResume
                      ? 'Resume ✓'
                      : hasLoadSession
                      ? 'Load ✓'
                      : '仅单次 ⚠️';

                    const tooltipText = isHandshakePending
                      ? '进程尚未完成握手。启动并完成 ACP initialize 探测后，将自动展示对端真实 Capabilities。'
                      : hasResume
                      ? 'ACP 对端声明支持 session/resume 轻量挂载。可直接基于现有本地历史快速续接上下文。'
                      : hasLoadSession
                      ? 'ACP 对端声明支持 session/load 全量重载。历史缺失时可通过 Replay Sink 回放补偿。'
                      : 'ACP 对端未实现 session/resume 或 session/load。每次重启将以 session/new 重新初始化，系统自动采用冷启动补偿。';

                    return (
                      <div
                        className={`mt-2 p-1.5 px-2.5 rounded-xl border flex items-center justify-between text-[11px] select-none transition-all ${
                          isHandshakePending
                            ? 'bg-surface-subtle border-border text-fg-muted'
                            : isSupported
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300'
                            : 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300'
                        }`}
                        title={tooltipText}
                      >
                        {/* 左侧：精炼主标签 */}
                        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isHandshakePending
                                ? 'bg-zinc-400 dark:bg-zinc-500'
                                : isSupported
                                ? 'bg-emerald-500 animate-pulse'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span className="font-medium whitespace-nowrap">会话恢复</span>
                        </div>

                        {/* 右侧：紧凑状态短语 */}
                        <span className="font-mono text-[10px] font-semibold whitespace-nowrap shrink-0 pl-1">
                          {detailText}
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

      {/* 4. Portable Expert Pack (.scpack v1.0) Wizard Modal */}
      {isScpackModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] bg-surface border border-border rounded-3xl shadow-2xl flex flex-col overflow-hidden text-fg">
            {/* Modal Header */}
            <div className="p-5 border-b border-border bg-surface-subtle flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-blue-50 dark:bg-blue-500/15 border border-blue-300 dark:border-blue-500/30 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-base text-fg">
                      ACP 专家能力包 (.scpack v1.0)
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300 border">
                      跨环境分发 · 支持 Codex 与 Claude Code
                    </span>
                  </div>
                  <p className="text-xs text-fg-secondary mt-0.5">
                    全离线蒸馏、两阶段脱敏门禁、RFC 8785 JCS + Ed25519 签名、B 端确定性 BM25 预检索与原生记忆隔离
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsScpackModalOpen(false)}
                className="p-1.5 rounded-xl text-fg-muted hover:text-fg hover:bg-surface border border-transparent hover:border-border cursor-pointer ml-auto shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switch Tabs */}
            <div className="px-5 pt-3 border-b border-border bg-surface-subtle flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {
                  setScpackTab('export');
                  setScpackError(null);
                  setScpackNotice(null);
                }}
                className={`px-3.5 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 cursor-pointer transition-all ${
                  scpackTab === 'export'
                    ? 'border-blue-600 text-blue-800 dark:border-blue-400 dark:text-blue-300'
                    : 'border-transparent text-fg-secondary hover:text-fg'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>A 端：探测并导出 .scpack</span>
              </button>
              <button
                onClick={() => {
                  setScpackTab('import');
                  setScpackError(null);
                  setScpackNotice(null);
                }}
                className={`px-3.5 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 cursor-pointer transition-all ${
                  scpackTab === 'import'
                    ? 'border-emerald-600 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300'
                    : 'border-transparent text-fg-secondary hover:text-fg'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>B 端：验签安装 .scpack 与创建专家分身 ({installedScpacks.length})</span>
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1 select-text">
              {scpackError && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-500/15 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 break-words font-mono text-[11px]">{scpackError}</div>
                </div>
              )}

              {scpackNotice && (
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 break-words">{scpackNotice}</div>
                </div>
              )}

              {scpackTab === 'export' ? (
                <div className="space-y-4">
                  {/* Harness Source Selector */}
                  <div className="p-3 rounded-2xl bg-surface-subtle border border-border space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-fg">
                        选择知识源运行时 (Harness)
                      </span>
                      <span className="text-[10px] text-fg-muted font-mono">
                        独立入口导出 · 支持 Codex 与 Claude Code
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleSelectHarness('codex')}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start gap-2.5 ${
                          selectedHarness === 'codex'
                            ? 'bg-blue-50/70 border-blue-400 dark:bg-blue-500/20 dark:border-blue-500/50 shadow-xs'
                            : 'bg-surface border-border hover:bg-surface-hover'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-fg flex items-center gap-1.5">
                            <span>OpenAI Codex</span>
                            <span className="text-[10px] font-mono text-fg-muted">(~/.codex)</span>
                          </div>
                          <div className="text-[11px] text-fg-secondary mt-0.5">
                            S1~S6 矩阵：Native Memories v2、Ad-hoc 笔记、Custom Skills 与 SQLite 会话
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectHarness('claude-code')}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start gap-2.5 ${
                          selectedHarness === 'claude-code'
                            ? 'bg-purple-50/70 border-purple-400 dark:bg-purple-500/20 dark:border-purple-500/50 shadow-xs'
                            : 'bg-surface border-border hover:bg-surface-hover'
                        }`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-purple-500 mt-1 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-fg flex items-center gap-1.5">
                            <span>Claude Code</span>
                            <span className="text-[10px] font-mono text-fg-muted">(~/.claude & CLAUDE.md)</span>
                          </div>
                          <div className="text-[11px] text-fg-secondary mt-0.5">
                            C1~C4 矩阵：项目记忆与 CLAUDE.md、Custom Skills、Settings 偏好与历史轨迹
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* S1 503 Degradation Banner (Codex Only) */}
                  {selectedHarness === 'codex' && probeReport?.s1_degraded_notice && (
                    <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">S1 原生记忆管线自动降级保护已触发</div>
                        <div className="mt-0.5 text-[11px]">{probeReport.s1_degraded_notice}</div>
                      </div>
                    </div>
                  )}

                  {/* Source Probe Table */}
                  <div className="p-3.5 rounded-2xl bg-surface-subtle border border-border space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-fg">
                        {selectedHarness === 'claude-code'
                          ? 'Claude Code 4 类数据源探测矩阵 (C1~C4 · 项目记忆、Skills、Settings 与历史)'
                          : 'Codex 6 类数据源探测矩阵 (S1~S6 · SQLite Online Backup 快照)'}
                      </span>
                      <button
                        onClick={() => void refreshScpacksAndProbe()}
                        disabled={isProbingScpack}
                        className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover border border-border text-[11px] text-fg-secondary hover:text-fg cursor-pointer"
                      >
                        {isProbingScpack
                          ? '探测中...'
                          : selectedHarness === 'claude-code'
                          ? '重新扫描 ~/.claude'
                          : '重新扫描 ~/.codex'}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {(probeReport?.sources || []).map((src) => (
                        <div
                          key={src.source_id}
                          className="p-2.5 rounded-xl bg-surface border border-border flex items-center justify-between gap-2 flex-wrap"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-fg">{src.label}</span>
                              {src.is_experimental && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-50 border border-purple-300 text-purple-800 dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-300 font-mono">
                                  Experimental (Non-v1.0)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-fg-secondary mt-0.5">{src.detail}</div>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ml-auto ${
                              src.availability === 'active'
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300'
                                : src.availability === 'degraded_empty_503'
                                ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300'
                                : 'bg-surface-subtle border-border text-fg-muted'
                            }`}
                          >
                            {src.availability} ({src.item_count})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Two-Stage Redaction Gate Audit */}
                  {probeReport && (
                    <div className="p-3.5 rounded-2xl bg-surface-subtle border border-border space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-bold text-fg">
                          两阶段脱敏门禁审计 (Redaction Audit · Zero-Residual Verification)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300">
                          已替换 {probeReport.redaction_audit.total_redactions} 处敏感项 · 零残留校验通过
                        </span>
                      </div>
                      <div className="text-[11px] text-fg-secondary">
                        物理黑名单已拦截：<code className="font-mono">{probeReport.redaction_audit.blacklisted_paths_skipped.join(', ') || 'auth.json, config.toml, logs_1.sqlite, history.jsonl'}</code>
                      </div>
                      <label className="pt-1 flex items-center gap-2 cursor-pointer text-fg font-medium">
                        <input
                          type="checkbox"
                          checked={userConfirmedRedaction}
                          onChange={(e) => setUserConfirmedRedaction(e.target.checked)}
                          className="rounded border-border"
                        />
                        <span>我已审阅脱敏审计结果，确认不包含未授权机密信息（必填门禁）</span>
                      </label>
                    </div>
                  )}

                  {/* Package Metadata Form */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-fg-secondary mb-1">能力包名称</label>
                      <input
                        value={scpackPackageName}
                        onChange={(e) => setScpackPackageName(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-fg-secondary mb-1">导出者署名 (Author)</label>
                      <input
                        value={scpackAuthor}
                        onChange={(e) => setScpackAuthor(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-fg-secondary mb-1">语义化版本 (SemVer)</label>
                      <input
                        value={scpackVersion}
                        onChange={(e) => setScpackVersion(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-fg-secondary mb-1">导出路径 (.scpack)</label>
                      <input
                        value={scpackOutputPath}
                        onChange={(e) => setScpackOutputPath(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      onClick={async () => {
                        setScpackError(null);
                        setScpackNotice(null);
                        try {
                          const manifest = await exportAcpScpack({
                            harness: selectedHarness,
                            packageName: scpackPackageName,
                            version: scpackVersion,
                            author: scpackAuthor,
                            description: scpackDescription,
                            outputPath: scpackOutputPath,
                            userConfirmedRedaction,
                          });
                          setExportedManifest(manifest);
                          const packs = await listInstalledScpacks();
                          setInstalledScpacks(packs);
                          setScpackNotice(
                            `已成功导出并签名 .scpack 能力包（ID: ${manifest.package_id}，Merkle Root: ${manifest.merkle_root_blake3.slice(0, 24)}...）`
                          );
                        } catch (e: any) {
                          setScpackError(e?.message || String(e));
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-semibold text-xs cursor-pointer shadow-xs"
                    >
                      签名并导出 .scpack 能力包
                    </button>
                  </div>

                  {exportedManifest && (
                    <div className="p-3 rounded-2xl bg-surface border border-border font-mono text-[11px] space-y-1">
                      <div className="font-bold text-fg">已生成 Manifest (RFC 8785 JCS + Ed25519)</div>
                      <div>package_id: {exportedManifest.package_id}</div>
                      <div>merkle_root: {exportedManifest.merkle_root_blake3}</div>
                      <div>signer_pubkey: {exportedManifest.signature?.signer_public_key_hex}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Import Bar */}
                  <div className="p-3.5 rounded-2xl bg-surface-subtle border border-border space-y-2.5">
                    <div className="font-bold text-fg">
                      从本地路径导入 .scpack 能力包（Fail-Closed 验签与只读挂载至 ~/.shadow-crew/packs/）
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={scpackImportPath}
                        onChange={(e) => setScpackImportPath(e.target.value)}
                        placeholder="输入 .scpack 文件路径..."
                        className="flex-1 min-w-[220px] px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs font-mono"
                      />
                      <button
                        onClick={async () => {
                          setScpackError(null);
                          setScpackNotice(null);
                          try {
                            const summary = await importScpack(scpackImportPath);
                            const packs = await listInstalledScpacks();
                            setInstalledScpacks(packs);
                            setScpackNotice(
                              `已验签并只读安装能力包「${summary.name}」(${summary.package_id})，包含 ${summary.playbook_count} 篇 Playbooks。`
                            );
                          } catch (e: any) {
                            setScpackError(e?.message || String(e));
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-fg font-semibold text-xs cursor-pointer shrink-0"
                      >
                        验签并安装 .scpack
                      </button>
                    </div>
                  </div>

                  {/* Installed Packs List */}
                  <div className="space-y-2.5">
                    <div className="font-bold text-fg">
                      已安装的专家能力包 (~/.shadow-crew/packs/)
                    </div>
                    {installedScpacks.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-surface-subtle border border-border text-center text-fg-muted">
                        暂无已安装的 .scpack 能力包。可先在「A 端」导出或在上方导入。
                      </div>
                    ) : (
                      installedScpacks.map((pack) => (
                        <div
                          key={pack.package_id}
                          className="p-3.5 rounded-2xl bg-surface border border-border flex items-center justify-between gap-3 flex-wrap"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-fg">{pack.name}</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-300 text-blue-800 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300">
                                v{pack.version} · {pack.source_harness === 'claude-code' ? 'Claude Code 经验' : 'Codex 经验'} · 基于 {pack.author} 的经验构建 · 本地运行时
                              </span>
                              {pack.revoked && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-50 border border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300">
                                  REVOKED
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-fg-secondary">{pack.description}</div>
                            <div className="text-[10px] font-mono text-fg-muted break-all">
                              ID: {pack.package_id} · Playbooks: {pack.playbook_count} · Merkle: {pack.merkle_root_blake3.slice(0, 22)}...
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-auto">
                            {onCreateExpertAgentFromPack && !pack.revoked && (
                              <button
                                onClick={() => {
                                  const expertAgent = createPortableExpertAgentFromPack(pack);
                                  onCreateExpertAgentFromPack(expertAgent);
                                  setScpackNotice(
                                    `已基于「${pack.name}」创建 B 端专家分身 Agent（已锁定 --disable memories 与 -s workspace-write）`
                                  );
                                }}
                                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 font-semibold text-xs cursor-pointer"
                              >
                                + 创建专家分身 Agent
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                try {
                                  await uninstallScpack(pack.package_id, true);
                                  const packs = await listInstalledScpacks();
                                  setInstalledScpacks(packs);
                                  setScpackNotice(`已吊销并卸载能力包 ${pack.package_id}`);
                                } catch (e: any) {
                                  setScpackError(e?.message || String(e));
                                }
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/15 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs cursor-pointer"
                            >
                              吊销并卸载
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
