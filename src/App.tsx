/**
 * Shinobi Multi-Agent Platform - Reconstructed Workspace UI
 * Fusing Block Buzz, Codex, and Google Antigravity
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import type { Agent, AgentTeam, Message, TopicMessageData } from './types';
import { Hash, Plus, PanelLeft } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { FilePreviewProvider } from './context/FilePreviewContext';
import { ChatTimeline } from './components/ChatTimeline';
import { MessageInput } from './components/MessageInput';
import { AppModalsContainer } from './components/AppModalsContainer';
import { useWorkspacePersistence } from './hooks/useWorkspacePersistence';
import { useSessionWarmState } from './hooks/useSessionWarmState';
import { useAcpRuntimeLifecycle } from './hooks/useAcpRuntimeLifecycle';
import { useTopicExecutionPipeline } from './hooks/useTopicExecutionPipeline';
import { useChannelAndTopicCrud } from './hooks/useChannelAndTopicCrud';
import { useArbitrationConcurrence } from './hooks/useArbitrationConcurrence';
import { useGameTheoreticFsm } from './hooks/useGameTheoreticFsm';
import { useNormalModeTurnOrchestrator } from './hooks/useNormalModeTurnOrchestrator';
import { useTopicTurnOrchestrator } from './hooks/useTopicTurnOrchestrator';
import { MIN_MAIN_TIMELINE_WIDTH } from './config/layout';

// 按需异步加载高体积分支抽屉与仪表盘组件，从首屏关键渲染路径剥离
const SubThreadDrawer = lazy(() => import('./components/SubThreadDrawer').then((m) => ({ default: m.SubThreadDrawer })));
const TopicThreadDrawer = lazy(() => import('./components/TopicThreadDrawer').then((m) => ({ default: m.TopicThreadDrawer })));
const CodexDiffViewer = lazy(() => import('./components/CodexDiffViewer').then((m) => ({ default: m.CodexDiffViewer })));
const AcpInspector = lazy(() => import('./components/AcpInspector').then((m) => ({ default: m.AcpInspector })));
const AgentDashboard = lazy(() => import('./components/AgentDashboard').then((m) => ({ default: m.AgentDashboard })));

const CURRENT_USER_ID = 'user-norris';

function collectTopicImpactedFiles(topic: TopicMessageData): string[] {
  return [
    ...(topic.rulingRecord?.impactedFiles || []),
    ...(topic.decisionRecord?.impactedFiles || []),
    ...(topic.gameTheoreticState?.executionDiffs?.map((d) => d.filename) || []),
  ]
    .map((f) => f.trim().replace(/^\.\//, ''))
    .filter(Boolean);
}

export default function App() {
  // Main View Navigation ('chat' | 'agents') - Default to chat for PRD Messaging Space
  const [mainView, setMainView] = useState<'chat' | 'agents'>('chat');

  // Topic & Message Composer UI State
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isNewTopicModalOpen, setIsNewTopicModalOpen] = useState<boolean>(false);
  const [editingTopic, setEditingTopic] = useState<TopicMessageData | null>(null);
  const [quotingMessage, setQuotingMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Side Drawers & Overlays
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('shinobi_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isSidebarTransitioning, setIsSidebarTransitioning] = useState(false);

  const toggleSidebar = useCallback((targetState?: boolean) => {
    setIsSidebarTransitioning(true);
    setIsSidebarCollapsed((prev) => (typeof targetState === 'boolean' ? targetState : !prev));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_sidebar_collapsed', String(isSidebarCollapsed));
    } catch {}
  }, [isSidebarCollapsed]);

  // Split-screen & narrow layout protection: auto-collapse sidebar when topic drawer opens on narrow window (< 1120px)
  useEffect(() => {
    if (activeTopicId && typeof window !== 'undefined' && window.innerWidth < 1120 && !isSidebarCollapsed) {
      toggleSidebar(true);
    }
  }, [activeTopicId]);

  useEffect(() => {
    const handleWindowResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 1120 && activeTopicId && !isSidebarCollapsed) {
        toggleSidebar(true);
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [activeTopicId, isSidebarCollapsed, toggleSidebar]);

  // Global Keyboard Shortcut: ⌘B / Ctrl+B to toggle sidebar (Antigravity & Cursor standard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const [activeSubThreadId, setActiveSubThreadId] = useState<string | null>(null);
  const [isCodexDiffOpen, setIsCodexDiffOpen] = useState<boolean>(false);
  const [activeDiff, setActiveDiff] = useState<any>(null);
  const [isAcpInspectorOpen, setIsAcpInspectorOpen] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  // Modals
  const [isAgentTeamsModalOpen, setIsAgentTeamsModalOpen] = useState<boolean>(false);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState<boolean>(false);
  const [isAgentDefaultsModalOpen, setIsAgentDefaultsModalOpen] = useState<boolean>(false);
  const [isPermissionCenterOpen, setIsPermissionCenterOpen] = useState<boolean>(false);
  const [isStorageSettingsModalOpen, setIsStorageSettingsModalOpen] = useState<boolean>(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [isChannelMembersModalOpen, setIsChannelMembersModalOpen] = useState<boolean>(false);
  const [isDeleteChannelModalOpen, setIsDeleteChannelModalOpen] = useState<boolean>(false);
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [duplicatingAgent, setDuplicatingAgent] = useState<Agent | null>(null);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);

  const onResetAllSessionWarmStateRef = useRef<(() => void) | null>(null);

  // 1. 工作区持久化、历史数据清洗与派生上下文
  const {
    agents, setAgents, teams, setTeams, channels, setChannels,
    activeChannelId, setActiveChannelId, workspaceBindings, setWorkspaceBindings,
    threads, setThreads, activeThreadId, setActiveThreadId,
    messages, setMessages, subThreads, setSubThreads, rpcLogs, setRpcLogs, workspaceFiles,
    messagesRef, agentsRef, syncRunningAgentsWithBackendRef,
    getTopicWorkspaceBinding, getChannelWorkspaceBinding,
    activeChannel, activeThread, activeMessages,
    currentChannelAgents, editingTopicChannel, editingTopicAgents,
    activeTopicData, activeTopicMessages, commitMessages, getTopicData, updateTopicDataInState,
  } = useWorkspacePersistence({
    currentUserId: CURRENT_USER_ID,
    activeTopicId,
    editingTopic,
    onResetAllSessionWarmStateRef,
  });

  // 2. 会话热态、推演代际追踪与中止清理
  const {
    setIsGenerating, activeExecutions, setActiveExecutions, activeExecutionsRef,
    setActiveCascades, activeCascadesRef, sessionCleanupNotice, setSessionCleanupNotice,
    turnEpochTrackerRef, captureTurnEpoch, isTurnStale,
    inFlightHandoverRef, stageRefineRetriesRef,
    deliveredStandingContextRef, sessionWatermarksRef,
    persistSessionWarmState, clearSessionWarmScope, resetAllSessionWarmState,
    safelyClearAcpSessions, handleAbortAgent, handleAbortAll, handleClearAllMessages,
  } = useSessionWarmState({
    setAgents,
    setMessages,
    messagesRef,
    commitMessages,
    getTopicData,
  });

  onResetAllSessionWarmStateRef.current = resetAllSessionWarmState;

  // 3. ACP 运行时生命周期、事件订阅与 Agent CRUD
  const {
    pendingAcpPermissions, logRpc, syncRunningAgentsWithBackend,
    handleAcpPermissionDecision, handleUpdateAgent, handleConnectAgent,
    handleDuplicateAgent, handleCreateExpertAgentFromPack,
    handleToggleAgentStatus, handleDeleteAgent,
  } = useAcpRuntimeLifecycle({
    mainView, agents, setAgents, agentsRef,
    setThreads, setMessages, setSubThreads, commitMessages,
    rpcLogs, setRpcLogs, setActiveExecutions,
    deliveredStandingContextRef, sessionWatermarksRef,
    persistSessionWarmState, clearSessionWarmScope, resetAllSessionWarmState,
    safelyClearAcpSessions, syncRunningAgentsWithBackendRef, setDuplicatingAgent,
  });

  // 4. 落地执行管线 (G-Frame 模块化与单轮落地执行)
  const {
    dispatchTopicExecution,
    handleExecuteTopicPatch,
    handleApplyTopicPatch,
  } = useTopicExecutionPipeline({
    getTopicData, updateTopicDataInState, captureTurnEpoch, isTurnStale,
    channels, activeChannel, agentsRef, activeExecutionsRef,
    setActiveExecutions, setIsGenerating, setAgents, setMessages,
    getTopicWorkspaceBinding, activeTopicId, activeDiff, setActiveDiff,
  });

  const activeSubThread = activeSubThreadId ? subThreads[activeSubThreadId] || null : null;

  // 5. 频道、DM 与议题 CRUD
  const {
    targetModalChannel, modalChannelUnresolvedTopics,
    handleOpenMembersModal, handleOpenDeleteChannelModal,
    handleSelectChannel, handleSelectDirectMessage, handleLaunchTeamThread,
    handleUpdateChannelMembers, handleDeleteChannel, handleCreateChannel,
    handleOpenTopic, handleCreateTopic, handleUpdateTopic,
    handleResolveTopic, handleReopenTopic,
    handleSendSubMessage, handleSyncBackToMainThread, handleAddReaction,
  } = useChannelAndTopicCrud({
    currentUserId: CURRENT_USER_ID,
    agents, agentsRef, channels, setChannels, activeChannel, activeChannelId, setActiveChannelId,
    workspaceBindings, setWorkspaceBindings, threads, setThreads, activeThread, setActiveThreadId,
    messages, messagesRef, setMessages, commitMessages, subThreads, setSubThreads,
    currentChannelAgents, activeTopicData, setActiveTopicId,
    activeSubThreadId, activeSubThread, setActiveSubThreadId,
    editingTopic, setEditingTopic, editingTopicChannel, editingTopicAgents,
    modalChannelId, setModalChannelId, setIsChannelMembersModalOpen, setIsDeleteChannelModalOpen,
    setSelectedAgentId, setQuotingMessage, setMainView,
    activeExecutionsRef, turnEpochTrackerRef, deliveredStandingContextRef, sessionWatermarksRef,
    clearSessionWarmScope, persistSessionWarmState, safelyClearAcpSessions,
    handleAbortAll, dispatchTopicExecution,
  });

  // 6. 仲裁合流与无异议征询
  const { processArbitrationConcurrence } = useArbitrationConcurrence({
    getTopicData, activeTopicData, updateTopicDataInState,
    setMessages, setIsGenerating, setActiveExecutions, setAgents,
    agentsRef, inFlightHandoverRef, isTurnStale,
    getTopicWorkspaceBinding, handleResolveTopic,
  });

  // 7. 博弈状态机控制器 (DIANOIA 4+1 状态流转控制器)
  const { triggerGameTheoreticStageHandover } = useGameTheoreticFsm({
    getTopicData, channels, activeChannel, captureTurnEpoch, isTurnStale,
    inFlightHandoverRef, agentsRef, stageRefineRetriesRef,
    setIsGenerating, setActiveExecutions, setAgents, setMessages,
    updateTopicDataInState, getTopicWorkspaceBinding, processArbitrationConcurrence,
  });

  // 8. 普通协同模式轮次编排 (Turn Barrier & @mention 级联)
  const { dispatchCascadingAgentResponse, handleSendMessage } = useNormalModeTurnOrchestrator({
    agents, setAgents, agentsRef, channels, setChannels, activeChannel, activeThread, setThreads,
    setMessages, messagesRef, commitMessages, activeTopicData, getTopicData,
    getTopicWorkspaceBinding, getChannelWorkspaceBinding,
    activeCascadesRef, setActiveCascades, setActiveExecutions, setIsGenerating,
    turnEpochTrackerRef, captureTurnEpoch, isTurnStale,
    deliveredStandingContextRef, sessionWatermarksRef,
    persistSessionWarmState, clearSessionWarmScope, safelyClearAcpSessions,
    syncRunningAgentsWithBackend, logRpc,
  });

  // 9. 议题讨论轮次调度
  const { handleSendTopicMessage } = useTopicTurnOrchestrator({
    agents, setAgents, channels, activeChannel, activeTopicData,
    getTopicData, updateTopicDataInState, getTopicWorkspaceBinding,
    setMessages, messagesRef, commitMessages,
    setActiveExecutions, setActiveCascades, setIsGenerating,
    captureTurnEpoch, isTurnStale,
    deliveredStandingContextRef, sessionWatermarksRef, persistSessionWarmState,
    syncRunningAgentsWithBackend, logRpc,
    dispatchCascadingAgentResponse, triggerGameTheoreticStageHandover, processArbitrationConcurrence,
  });

  // Light derived view helpers
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || agents[0],
    [agents, selectedAgentId]
  );
  const activeExecutionsList = useMemo(() => Object.values(activeExecutions), [activeExecutions]);
  const isCurrentThreadGenerating = useMemo(
    () => (activeThread ? activeExecutionsList.some((e) => e.threadId === activeThread.id) : false),
    [activeThread, activeExecutionsList]
  );
  const activeWorkspaceCwd = activeChannel
    ? getChannelWorkspaceBinding(activeChannel.id)?.cwd
    : undefined;

  const overlappingFiles = useMemo(() => {
    if (!activeTopicData || activeTopicData.gameTheoreticState?.executionStatus === 'applied') return [];
    const myFiles = new Set(collectTopicImpactedFiles(activeTopicData));
    if (myFiles.size === 0) return [];
    const otherFiles = new Set<string>();
    for (const m of activeMessages) {
      if (m.type !== 'topic' || !m.topicData || m.topicData.id === activeTopicData.id) continue;
      if (m.topicData.gameTheoreticState?.executionStatus === 'applied') continue;
      for (const file of collectTopicImpactedFiles(m.topicData)) {
        if (myFiles.has(file)) otherFiles.add(file);
      }
    }
    return Array.from(otherFiles);
  }, [activeTopicData, activeMessages]);

  const composerActiveAgents = useMemo(() => {
    if (!activeThread) return [];
    return activeThread.type === 'dm'
      ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
      : currentChannelAgents;
  }, [activeThread, agents, currentChannelAgents]);

  const activeTopicDrawerAgents = useMemo(
    () =>
      activeTopicData?.scopeType === 'dm'
        ? agents.filter((agent) => agent.id === activeTopicData.dmAgentId)
        : currentChannelAgents,
    [activeTopicData, agents, currentChannelAgents]
  );

  const activeTopicExecutions = useMemo(
    () =>
      activeTopicId
        ? activeExecutionsList.filter((e) => e.threadId === activeTopicId || e.topicId === activeTopicId)
        : [],
    [activeTopicId, activeExecutionsList]
  );

  const allMessagesFlat = useMemo(() => Object.values(messages).flat(), [messages]);

  const newTopicDmAgent = useMemo(
    () => (activeThread?.type === 'dm' ? agents.find((agent) => agent.id === activeThread.authorId) : undefined),
    [activeThread, agents]
  );

  const newTopicChannelWorkspaceCwd = useMemo(() => {
    if (activeThread?.type === 'dm') return `~/.shadow-crew/agents/${activeThread.authorId}`;
    return activeChannel ? getChannelWorkspaceBinding(activeChannel.id)?.cwd : undefined;
  }, [activeThread, activeChannel, getChannelWorkspaceBinding]);

  const newTopicAgents = useMemo(
    () =>
      activeThread?.type === 'dm'
        ? agents.filter((agent) => agent.id === activeThread.authorId)
        : currentChannelAgents,
    [activeThread, agents, currentChannelAgents]
  );

  // Named UI callbacks
  const handleOpenConnectAgentModal = useCallback(() => {
    setEditingAgent(null);
    setDuplicatingAgent(null);
    setIsConnectModalOpen(true);
  }, []);

  const handleOpenEditAgentModal = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setDuplicatingAgent(null);
    setIsConnectModalOpen(true);
  }, []);

  const handleCloseConnectModal = useCallback(() => {
    setIsConnectModalOpen(false);
    setEditingAgent(null);
    setDuplicatingAgent(null);
  }, []);

  const handleStart1on1Chat = useCallback(
    (agent: Agent) => {
      handleSelectDirectMessage(agent);
      setMainView('chat');
    },
    [handleSelectDirectMessage]
  );

  const handleInspectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setIsAcpInspectorOpen(true);
  }, []);

  const handleDeleteTeam = useCallback(
    (teamId: string) => {
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    },
    [setTeams]
  );

  const handleCreateTeam = useCallback(
    (newTeam: Omit<AgentTeam, 'id'>) => {
      const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
      setTeams((prev) => [...prev, created]);
    },
    [setTeams]
  );

  const handleOpenCodexDiff = useCallback((diff: any) => {
    setActiveDiff(diff);
    setIsCodexDiffOpen(true);
  }, []);

  const handleRunAgentSkill = useCallback(
    (agentId: string, skillId: string) => {
      const ag = agents.find((a) => a.id === agentId);
      if (ag) logRpc(ag.name, 'client_to_agent', 'skills/callTool', { skillId });
    },
    [agents, logRpc]
  );

  const handleCloseChannelMembersModal = useCallback(() => {
    setIsChannelMembersModalOpen(false);
    setModalChannelId(null);
  }, []);

  const handleCloseDeleteChannelModal = useCallback(() => {
    setIsDeleteChannelModalOpen(false);
    setModalChannelId(null);
  }, []);

  return (
    <FilePreviewProvider defaultWorkspaceRoot={activeWorkspaceCwd}>
      <div className="h-full w-full flex bg-canvas text-fg overflow-hidden font-sans select-none antialiased transition-colors duration-150">
        {/* 1. Left Primary Sidebar (Antigravity-style Smooth Collapsible) */}
        <div
          className={`h-full flex shrink-0 overflow-hidden ${
            isSidebarTransitioning ? 'transition-[width,opacity] duration-200 ease-in-out' : ''
          } ${isSidebarCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'}`}
          style={{ width: isSidebarCollapsed ? 0 : undefined }}
          onTransitionEnd={() => setIsSidebarTransitioning(false)}
        >
          <Sidebar
            channels={channels}
            activeChannelId={activeChannel ? activeChannel.id : ''}
            onSelectChannel={handleSelectChannel}
            onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
            onOpenMembersModal={handleOpenMembersModal}
            onOpenDeleteChannelModal={handleOpenDeleteChannelModal}
            agents={agents}
            activeExecutions={activeExecutionsList}
            teams={teams}
            onOpenAgentTeamsModal={() => setIsAgentTeamsModalOpen(true)}
            onSelectDirectMessage={handleSelectDirectMessage}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => toggleSidebar(true)}
            activeThreadId={activeThreadId}
            currentMainView={mainView}
            onSelectMainView={setMainView}
            onOpenStorageModal={() => setIsStorageSettingsModalOpen(true)}
          />
        </div>

        {/* Main View Switcher: Agents & Teams Dashboard vs Topic Chat Stream */}
        {mainView === 'agents' ? (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-fg-muted">加载仪表盘...</div>}>
            <AgentDashboard
              agents={agents}
              teams={teams}
              channels={channels}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => toggleSidebar()}
              onOpenConnectAgentModal={handleOpenConnectAgentModal}
              onDuplicateAgent={handleDuplicateAgent}
              onCreateExpertAgentFromPack={handleCreateExpertAgentFromPack}
              onOpenCreateTeamModal={() => setIsCreateTeamModalOpen(true)}
              onOpenAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(true)}
              onOpenPermissionCenter={() => setIsPermissionCenterOpen(true)}
              onEditAgent={handleOpenEditAgentModal}
              onToggleAgentStatus={handleToggleAgentStatus}
              onLaunchTeamThread={handleLaunchTeamThread}
              onStart1on1Chat={handleStart1on1Chat}
              onInspectAgent={handleInspectAgent}
              onDeleteAgent={handleDeleteAgent}
              onDeleteTeam={handleDeleteTeam}
            />
          </Suspense>
        ) : (
          <>
            {/* 2. Middle Column: Channel Main Timeline & Composer (PRD Column 2) */}
            <main
              className="flex-1 flex flex-col min-w-0 bg-canvas relative overflow-hidden transition-colors duration-150"
              style={{ minWidth: MIN_MAIN_TIMELINE_WIDTH }}
            >
              {activeThread && (activeThread.type === 'dm' || activeChannel) ? (
                <>
                  <ChatTimeline
                    messages={activeMessages}
                    activeThread={activeThread}
                    channel={activeThread.type === 'dm' ? undefined : activeChannel}
                    agents={agents}
                    activeExecutions={activeExecutionsList}
                    onApplyTopicPatch={handleApplyTopicPatch}
                    onAbortAgent={(agentId) => activeThread && handleAbortAgent(agentId, activeThread.id)}
                    onAddReaction={handleAddReaction}
                    onInspectAgent={handleInspectAgent}
                    onOpenTopic={handleOpenTopic}
                    onOpenNewTopicModal={() => setIsNewTopicModalOpen(true)}
                    onOpenSubThread={(subId) => setActiveSubThreadId(subId)}
                    onOpenCodexDiff={handleOpenCodexDiff}
                    onOpenAcpInspector={() => setIsAcpInspectorOpen(true)}
                    onOpenMembersModal={activeThread.type === 'dm' ? undefined : () => handleOpenMembersModal(activeChannel?.id)}
                    onOpenDeleteChannelModal={activeThread.type === 'dm' ? undefined : () => handleOpenDeleteChannelModal(activeChannel?.id)}
                    onQuoteMessage={(msg) => setQuotingMessage(msg)}
                    onEditTopic={(topic) => setEditingTopic(topic)}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={() => toggleSidebar()}
                    currentWorkspace="shadow-crew"
                  />

                  <MessageInput
                    onSendMessage={handleSendMessage}
                    onAbort={() => activeThread && handleAbortAll(activeThread.id)}
                    activeAgents={composerActiveAgents}
                    isGenerating={isCurrentThreadGenerating}
                    channelName={activeThread.type === 'dm' ? (activeThread.authorName || 'Agent') : (activeChannel?.name || 'chat')}
                    onOpenNewTopicModal={() => setIsNewTopicModalOpen(true)}
                    quotingMessage={quotingMessage}
                    onCancelQuote={() => setQuotingMessage(null)}
                    isDm={activeThread.type === 'dm'}
                    draftType={activeThread.type === 'dm' ? 'dm' : 'channel'}
                    draftId={activeThread.type === 'dm' ? (activeThread.authorId || activeThread.id.replace('thread-dm-', '')) : (activeChannel?.id || activeThread.channelId || 'general')}
                  />
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-canvas text-fg select-none relative">
                  {isSidebarCollapsed && (
                    <button
                      onClick={() => toggleSidebar()}
                      className="absolute top-3 left-3 p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface border border-border/70 hover:border-border transition-all cursor-pointer flex items-center justify-center shadow-2xs group z-10"
                      title="展开侧边栏 (⌘B)"
                    >
                      <PanelLeft className="w-4 h-4 text-fg-secondary group-hover:text-fg group-hover:scale-105 transition-transform" />
                    </button>
                  )}
                  <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center text-accent mb-4 shadow-sm">
                    <Hash className="w-8 h-8 opacity-75" />
                  </div>
                  <h3 className="text-base font-semibold text-fg mb-1.5">暂无活跃频道</h3>
                  <p className="text-xs text-fg-muted max-w-md mb-6 leading-relaxed">
                    创建一个需求、功能或任务频道，与专职 Agent 共同推演与开发。
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCreateChannelOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-fg font-medium rounded-xl hover:opacity-90 transition-all shadow-sm cursor-pointer text-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>创建第一个频道</span>
                  </button>
                </div>
              )}
            </main>

            {/* 3. Right Column: Topic Thread Drawer (PRD Column 3) */}
            {Boolean(activeTopicId && activeTopicData) && (
              <Suspense fallback={null}>
                <TopicThreadDrawer
                  isOpen={Boolean(activeTopicId && activeTopicData)}
                  topic={activeTopicData}
                  messages={activeTopicMessages}
                  agents={activeTopicDrawerAgents}
                  activeExecutions={activeTopicExecutions}
                  allActiveExecutions={activeExecutionsList}
                  onAbortAgent={(agentId) => activeTopicId && handleAbortAgent(agentId, activeTopicId)}
                  onAbortAll={() => activeTopicId && handleAbortAll(activeTopicId)}
                  onClose={() => setActiveTopicId(null)}
                  onSendMessage={handleSendTopicMessage}
                  onResolveTopic={handleResolveTopic}
                  onReopenTopic={handleReopenTopic}
                  onExecuteTopicPatch={handleExecuteTopicPatch}
                  onApplyTopicPatch={handleApplyTopicPatch}
                  workspaceCwd={getTopicWorkspaceBinding(activeTopicId)?.cwd}
                  overlappingFiles={overlappingFiles}
                  onOpenCodexDiff={handleOpenCodexDiff}
                  onEditTopic={() => setEditingTopic(activeTopicData)}
                />
              </Suspense>
            )}
          </>
        )}

        <Suspense fallback={null}>
          {/* 4. Sub-Thread Nested Discussion Drawer */}
          {Boolean(activeSubThreadId && activeSubThread) && (
            <SubThreadDrawer
              isOpen={Boolean(activeSubThreadId && activeSubThread)}
              subThread={activeSubThread}
              agents={agents}
              onClose={() => setActiveSubThreadId(null)}
              onSendSubMessage={handleSendSubMessage}
              onSyncBackToMainThread={handleSyncBackToMainThread}
            />
          )}

          {/* 5. Codex Diff Inspection Drawer */}
          {isCodexDiffOpen && (
            <CodexDiffViewer
              isOpen={isCodexDiffOpen}
              onClose={() => setIsCodexDiffOpen(false)}
              activeDiff={activeDiff}
              workspaceFiles={workspaceFiles}
              onApplyDiff={handleApplyTopicPatch}
            />
          )}

          {/* 6. Antigravity ACP Protocol & Telemetry Inspector Drawer */}
          {isAcpInspectorOpen && selectedAgent && (
            <AcpInspector
              selectedAgent={selectedAgent}
              rpcLogs={rpcLogs}
              workspaceFiles={workspaceFiles}
              onRunAgentSkill={handleRunAgentSkill}
              onOpenRustTauriHub={() => setIsRustTauriHubOpen(true)}
              onEditAgent={handleOpenEditAgentModal}
              onClose={() => setIsAcpInspectorOpen(false)}
            />
          )}

          {/* 7. App Modals Container */}
          <AppModalsContainer
            isAgentTeamsModalOpen={isAgentTeamsModalOpen}
            onCloseAgentTeamsModal={() => setIsAgentTeamsModalOpen(false)}
            agents={agents}
            teams={teams}
            onCreateTeam={handleCreateTeam}
            onOpenConnectModalFromTeams={handleOpenConnectAgentModal}
            isCreateTeamModalOpen={isCreateTeamModalOpen}
            onCloseCreateTeamModal={() => setIsCreateTeamModalOpen(false)}
            isAgentDefaultsModalOpen={isAgentDefaultsModalOpen}
            onCloseAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(false)}
            onOpenStorageSettings={() => setIsStorageSettingsModalOpen(true)}
            pendingAcpPermissions={pendingAcpPermissions}
            onAcpPermissionDecision={handleAcpPermissionDecision}
            isPermissionCenterOpen={isPermissionCenterOpen}
            onClosePermissionCenter={() => setIsPermissionCenterOpen(false)}
            isStorageSettingsModalOpen={isStorageSettingsModalOpen}
            onCloseStorageSettingsModal={() => setIsStorageSettingsModalOpen(false)}
            allMessages={allMessagesFlat}
            onMessagesCleared={handleClearAllMessages}
            isCreateChannelOpen={isCreateChannelOpen}
            onCloseCreateChannelModal={() => setIsCreateChannelOpen(false)}
            currentUserId={CURRENT_USER_ID}
            onCreateChannel={handleCreateChannel}
            targetModalChannel={targetModalChannel}
            isChannelMembersModalOpen={isChannelMembersModalOpen}
            onCloseChannelMembersModal={handleCloseChannelMembersModal}
            onUpdateChannelMembers={handleUpdateChannelMembers}
            isDeleteChannelModalOpen={isDeleteChannelModalOpen}
            onCloseDeleteChannelModal={handleCloseDeleteChannelModal}
            modalChannelUnresolvedTopics={modalChannelUnresolvedTopics}
            onDeleteChannel={handleDeleteChannel}
            isConnectModalOpen={isConnectModalOpen}
            onCloseConnectModal={handleCloseConnectModal}
            editingAgent={editingAgent}
            duplicatingAgent={duplicatingAgent}
            defaultWorkspaceRoot="~/.shadow-crew"
            onUpdateAgent={handleUpdateAgent}
            onConnectAgent={handleConnectAgent}
            isNewTopicModalOpen={isNewTopicModalOpen}
            onCloseNewTopicModal={() => setIsNewTopicModalOpen(false)}
            newTopicScopeType={activeThread?.type === 'dm' ? 'dm' : 'channel'}
            newTopicChannel={activeThread?.type === 'dm' ? undefined : activeChannel}
            newTopicDmAgent={newTopicDmAgent}
            newTopicDmThreadId={activeThread?.type === 'dm' ? activeThread.id : undefined}
            newTopicChannelWorkspaceCwd={newTopicChannelWorkspaceCwd}
            newTopicAgents={newTopicAgents}
            onCreateTopic={handleCreateTopic}
            editingTopic={editingTopic}
            editingTopicChannel={editingTopicChannel}
            editingTopicAgents={editingTopicAgents}
            onCloseEditTopicModal={() => setEditingTopic(null)}
            onUpdateTopic={handleUpdateTopic}
            isRustTauriHubOpen={isRustTauriHubOpen}
            onCloseRustTauriHub={() => setIsRustTauriHubOpen(false)}
          />
        </Suspense>

        {sessionCleanupNotice && (
          <div className="fixed bottom-4 right-4 z-50 max-w-md px-3.5 py-2.5 rounded-xl border shadow-lg flex items-center gap-2.5 bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300 text-xs">
            <span className="flex-1 leading-relaxed">{sessionCleanupNotice}</span>
            <button
              type="button"
              onClick={() => setSessionCleanupNotice(null)}
              className="px-2 py-0.5 rounded-md border border-rose-300 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/25 transition-colors cursor-pointer shrink-0"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </FilePreviewProvider>
  );
}
