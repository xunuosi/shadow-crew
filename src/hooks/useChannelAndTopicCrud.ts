import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  AgentTeam,
  Channel,
  DecisionRecord,
  DiscussionMode,
  DuelRolesConfig,
  GameRolesConfig,
  GameTheoreticPolicy,
  GameTheoreticStage,
  Message,
  RulingRecord,
  SubThread,
  Thread,
  TopicMessageData,
  TopicStatus,
  WorkspaceBinding,
} from '../types';
import { matchesSessionScope } from '../services/acpClient';
import { revokeAcpPermissionGrantsForScope } from '../services/acpPermissionClient';
import {
  buildDefaultDecompositionFromTopic,
  bumpChannelEpoch,
  bumpRoomEpoch,
  calculateModelDiversity,
  createTurnEpochTracker,
  executeUpdateChannelMembersOrchestration,
  initializeModularOrchestrationState,
} from '../services/agentCollaboration';
import {
  evaluateGameConfiguration,
  normalizeGameTheoreticPolicy,
  RECOMMENDED_GAME_THEORETIC_POLICY,
} from '../services/cogno';
import {
  deleteWorkspaceBindingsFromDb,
  resolveWorkspaceCwd,
  saveWorkspaceBindingsToDb,
} from '../services/dbClient';
import {
  createChannelBinding,
  createDmTopicBinding,
  createTopicBinding,
  findWorkspaceBinding,
  getDefaultChannelCwd,
  getDefaultDmTopicCwd,
  getDefaultTopicCwd,
  normalizeDuelRoles,
} from '../services/workspaceBindings';
import { isAgentOffline } from '../utils/agentRuntime';

/**
 * Input parameters for `useChannelAndTopicCrud`.
 */
export interface UseChannelAndTopicCrudParams {
  currentUserId: string;
  agents: Agent[];
  agentsRef: React.MutableRefObject<Agent[]>;
  channels: Channel[];
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  activeChannel: Channel | null | undefined;
  activeChannelId: string;
  setActiveChannelId: React.Dispatch<React.SetStateAction<string>>;
  workspaceBindings: WorkspaceBinding[];
  setWorkspaceBindings: React.Dispatch<React.SetStateAction<WorkspaceBinding[]>>;
  threads: Thread[];
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  activeThread: Thread | null;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string>>;
  messages: Record<string, Message[]>;
  messagesRef?: React.MutableRefObject<Record<string, Message[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  commitMessages: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  subThreads: Record<string, SubThread>;
  setSubThreads: React.Dispatch<React.SetStateAction<Record<string, SubThread>>>;
  currentChannelAgents: Agent[];
  activeTopicData: TopicMessageData | null;
  setActiveTopicId: React.Dispatch<React.SetStateAction<string | null>>;
  activeSubThreadId: string | null;
  activeSubThread: SubThread | null;
  setActiveSubThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  editingTopic: TopicMessageData | null;
  setEditingTopic: React.Dispatch<React.SetStateAction<TopicMessageData | null>>;
  editingTopicChannel: Channel | null | undefined;
  editingTopicAgents: Agent[];
  modalChannelId: string | null;
  setModalChannelId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsChannelMembersModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeleteChannelModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedAgentId: React.Dispatch<React.SetStateAction<string>>;
  setQuotingMessage: React.Dispatch<React.SetStateAction<Message | null>>;
  setMainView: React.Dispatch<React.SetStateAction<'chat' | 'agents'>>;
  activeExecutionsRef: React.MutableRefObject<Record<string, ActiveAgentExecution>>;
  turnEpochTrackerRef: React.MutableRefObject<ReturnType<typeof createTurnEpochTracker>>;
  deliveredStandingContextRef: React.MutableRefObject<Set<string>>;
  sessionWatermarksRef: React.MutableRefObject<Map<string, string>>;
  clearSessionWarmScope: (scope: Parameters<typeof matchesSessionScope>[1]) => void;
  persistSessionWarmState: () => void;
  safelyClearAcpSessions: (
    agentId?: string,
    sessionKeyPrefix?: string,
    contextLabel?: string
  ) => Promise<void>;
  handleAbortAll: (threadId?: string) => void;
  dispatchTopicExecution: (options: {
    topicId: string;
    executorId: string;
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
    };
  }) => Promise<void>;
}

/**
 * Manages channel, DM, team thread, topic CRUD, topic resolution/reopen,
 * sub-thread messaging, and emoji reaction handlers.
 */
export function useChannelAndTopicCrud(params: UseChannelAndTopicCrudParams) {
  const {
    currentUserId,
    agents,
    agentsRef,
    channels,
    setChannels,
    activeChannel,
    activeChannelId,
    setActiveChannelId,
    workspaceBindings,
    setWorkspaceBindings,
    threads,
    setThreads,
    activeThread,
    setActiveThreadId,
    messages,
    messagesRef,
    setMessages,
    commitMessages,
    setSubThreads,
    currentChannelAgents,
    activeTopicData,
    setActiveTopicId,
    activeSubThreadId,
    activeSubThread,
    setActiveSubThreadId,
    editingTopic,
    setEditingTopic,
    editingTopicChannel,
    editingTopicAgents,
    modalChannelId,
    setModalChannelId,
    setIsChannelMembersModalOpen,
    setIsDeleteChannelModalOpen,
    setSelectedAgentId,
    setQuotingMessage,
    setMainView,
    activeExecutionsRef,
    turnEpochTrackerRef,
    deliveredStandingContextRef,
    sessionWatermarksRef,
    clearSessionWarmScope,
    persistSessionWarmState,
    safelyClearAcpSessions,
    handleAbortAll,
    dispatchTopicExecution,
  } = params;

  const fallbackMessagesRef = useRef(messages);
  fallbackMessagesRef.current = messages;

  const handleOpenMembersModal = useCallback(
    (channelId?: string) => {
      if (channelId) {
        setModalChannelId(channelId);
      } else {
        setModalChannelId(activeChannel?.id || null);
      }
      setIsChannelMembersModalOpen(true);
    },
    [activeChannel?.id, setIsChannelMembersModalOpen, setModalChannelId]
  );

  const handleOpenDeleteChannelModal = useCallback(
    (channelId?: string) => {
      if (channelId) {
        setModalChannelId(channelId);
      } else {
        setModalChannelId(activeChannel?.id || null);
      }
      setIsDeleteChannelModalOpen(true);
    },
    [activeChannel?.id, setIsDeleteChannelModalOpen, setModalChannelId]
  );

  const targetModalChannel = useMemo(
    () =>
      modalChannelId
        ? channels.find((c) => c.id === modalChannelId) || activeChannel || null
        : activeChannel || null,
    [modalChannelId, channels, activeChannel]
  );

  const modalChannelUnresolvedTopics = useMemo(
    () =>
      targetModalChannel
        ? (Object.values(messages) as Message[][])
            .flat()
            .filter(
              (m) =>
                m.channelId === targetModalChannel.id &&
                m.type === 'topic' &&
                m.topicData?.status !== 'resolved'
            ).length
        : 0,
    [targetModalChannel, messages]
  );

  // Handle Channel Selection
  const handleSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    // Switch to first dedicated thread of this channel
    const channelThreads = threads.filter((t) => t.channelId === channelId && t.type !== 'dm');
    if (channelThreads.length > 0) {
      setActiveThreadId(channelThreads[0].id);
    } else {
      // 若该频道尚无专属线程，立刻按规约创建该频道的默认启动线程，绝对禁止拿 DM 线程充数
      const targetChan = channels.find((c) => c.id === channelId);
      const newThreadId = `thread-${channelId}-${Date.now()}`;
      const defaultThread: Thread = {
        id: newThreadId,
        channelId,
        channelName: targetChan?.name || 'chat',
        type: 'thread',
        title: `#${targetChan?.name || '频道'}`,
        authorId: currentUserId,
        authorName: 'Norris_M5Pro',
        authorAvatar: '👨‍💻',
        authorHandle: '@Norris_M5Pro',
        timestamp: 'Just now',
        preview: targetChan?.description || `欢迎进入 #${targetChan?.name || '频道'} 协同空间。`,
        activeAgentIds: targetChan?.assignedAgentIds || [],
      };
      setThreads((prev) => [defaultThread, ...prev]);
      setActiveThreadId(newThreadId);
      setMessages((prev) => ({
        ...prev,
        [newThreadId]: [
          {
            id: `msg-${Date.now()}`,
            threadId: newThreadId,
            channelId,
            authorId: currentUserId,
            authorName: 'Norris_M5Pro',
            authorHandle: '@Norris_M5Pro',
            authorAvatar: '👨‍💻',
            isAgent: false,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `欢迎来到 **#${targetChan?.name || '频道'}**！${targetChan?.description ? `\n- **频道简介**：${targetChan.description}` : ''}\n- **互动方式**：可直接 \`@Agent\` 进行日常对话，或点击右上角 **「+ 新建议题」** 发起结构化深度推演。`,
          },
        ],
      }));
    }
    setActiveTopicId(null);
    setQuotingMessage(null);
    setMainView('chat');
  };

  // Handle Direct Message Selection
  const handleSelectDirectMessage = (agent: Agent) => {
    // 明确清空 activeChannelId，彻底切断频道与私聊的上下文关联
    setActiveChannelId('');

    // Check if DM thread already exists
    let dmThread = threads.find(
      (t) => t.type === 'dm' && (t.authorId === agent.id || t.id === `thread-dm-${agent.id}`)
    );

    if (!dmThread) {
      dmThread = {
        id: `thread-dm-${agent.id}`,
        channelId: '',
        channelName: `与 ${agent.name} 私聊`,
        type: 'dm',
        title: `与 ${agent.name} 的私信会话`,
        authorId: agent.id,
        authorName: agent.name,
        authorAvatar: agent.avatar,
        authorHandle: agent.handle,
        timestamp: 'Just now',
        preview: `已开启与 ${agent.name} (${agent.role}) 的 1-on-1 私聊会话。`,
        activeAgentIds: [agent.id],
      };
      setThreads((prev) => [dmThread!, ...prev.filter((t) => t.id !== dmThread!.id)]);
      setMessages((prev) => ({
        ...prev,
        [dmThread!.id]: prev[dmThread!.id] || [
          {
            id: `msg-${Date.now()}`,
            threadId: dmThread!.id,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: isAgentOffline(agent)
              ? `你好！我是 **${agent.name}**。当前 ACP 端点尚未启动。请在 Agents & 编队中点击 Start 建立本地或远程 ACP 连接。你也可以先在私聊中创建独立 Topic，后续消息与产物会隔离保存。`
              : `你好！我是 **${agent.name}**。ACP 端点已连接，协议通道：\`${agent.acpTransport}\`。你可以直接讨论，也可以创建独立 Topic 隔离长任务上下文。`,
          },
        ],
      }));
    } else if (
      dmThread.channelId !== '' ||
      dmThread.authorAvatar !== agent.avatar ||
      dmThread.authorName !== agent.name ||
      dmThread.authorHandle !== agent.handle
    ) {
      // Ensure existing DM thread metadata matches the latest agent profile
      const targetDmThreadId = dmThread.id;
      setThreads((prev) =>
        prev.map((t) =>
          t.id === targetDmThreadId
            ? {
                ...t,
                channelId: '',
                authorName: agent.name,
                authorAvatar: agent.avatar,
                authorHandle: agent.handle,
                title: `与 ${agent.name} 的私信会话`,
                channelName: `与 ${agent.name} 私聊`,
              }
            : t
        )
      );
    }
    setActiveThreadId(dmThread.id);
    setSelectedAgentId(agent.id);
    setActiveTopicId(null);
    setQuotingMessage(null);
    setMainView('chat');
  };

  // Handle Quick Launch Team Thread from Agent Dashboard
  const handleLaunchTeamThread = (team: AgentTeam) => {
    const threadId = `thread-team-${team.id}-${Date.now()}`;
    const newThread: Thread = {
      id: threadId,
      channelId: activeChannel?.id || 'channel-default',
      channelName: activeChannel?.name || team.name,
      type: 'thread',
      title: `[${team.name}] 协同攻坚议题`,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      authorHandle: '@Norris_M5Pro',
      timestamp: 'Just now',
      preview: `已由编队【${team.name}】接管此议题。包含成员：${team.agentIds.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}。`,
      activeAgentIds: team.agentIds,
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(threadId);
    setMessages((prev) => ({
      ...prev,
      [threadId]: [
        {
          id: `msg-${Date.now()}`,
          threadId,
          authorId: 'user-norris',
          authorName: 'Norris_M5Pro',
          authorHandle: '@Norris_M5Pro',
          authorAvatar: '👨‍💻',
          isAgent: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `已召唤编队 **${team.icon || '⚡'} ${team.name}**！\n编队职责：${team.description}\n协同成员：${team.agentIds.map((id) => agents.find((a) => a.id === id)?.handle).filter(Boolean).join(' ')} 已就位。随时可以开启多 Agent 联合作业。`,
        },
      ],
    }));
    setMainView('chat');
  };

  // Handle Channel Members Update (Invite / Remove Agent or Human)
  const handleUpdateChannelMembers = async (channelId: string, updatedMemberIds: string[]) => {
    await executeUpdateChannelMembersOrchestration({
      channelId,
      updatedMemberIds,
      agents,
      threads,
      messagesRef: messagesRef ?? fallbackMessagesRef,
      activeExecutionsRef,
      turnEpochTracker: turnEpochTrackerRef.current,
      deliveredStandingContext: deliveredStandingContextRef.current,
      sessionWatermarks: sessionWatermarksRef.current,
      setChannels,
      setThreads,
      onAbortRoom: handleAbortAll,
      clearAcpSessionsByPrefix: safelyClearAcpSessions,
      onSessionWarmStateMutated: persistSessionWarmState,
    });
  };

  // Handle Channel Deletion (Cascading Teardown)
  const handleDeleteChannel = async (channelId: string) => {
    const remaining = channels.filter((c) => c.id !== channelId);
    setChannels(remaining);

    // If active channel was deleted, redirect to the first remaining channel.
    if (activeChannelId === channelId) {
      const fallback = remaining.find((c) => c.status !== 'deleted');
      if (fallback) {
        setActiveChannelId(fallback.id);
        const fbThreads = threads.filter((t) => t.channelId === fallback.id);
        if (fbThreads.length > 0) {
          setActiveThreadId(fbThreads[0].id);
        } else {
          setActiveThreadId('');
        }
      } else {
        setActiveChannelId('');
        setActiveThreadId('');
      }
    }

    // Clean up channel topics and threads
    const deletedThreads = threads.filter((t) => t.channelId === channelId).map((t) => t.id);
    const deletedTopicIds = new Set(
      Object.values(messages)
        .flat()
        .filter((message) => message.topicData?.channelId === channelId)
        .map((message) => message.topicData!.id)
    );
    const remainingBindings = workspaceBindings.filter((binding) => {
      if (binding.ownerType === 'channel' && binding.ownerId === channelId) return false;
      if (binding.ownerType === 'topic' && deletedTopicIds.has(binding.ownerId)) return false;
      return true;
    });
    const idsToDelete = workspaceBindings
      .filter((binding) => !remainingBindings.includes(binding))
      .map((binding) => binding.id);
    setWorkspaceBindings(remainingBindings);
    void deleteWorkspaceBindingsFromDb(idsToDelete).catch((err) => {
      console.error('[App] Failed to delete Workspace Bindings:', err);
    });
    bumpChannelEpoch(turnEpochTrackerRef.current, channelId, deletedThreads);
    setThreads((prev) => prev.filter((t) => t.channelId !== channelId));
    setMessages((prev) => {
      const nextMsgs = { ...prev };
      for (const thId of deletedThreads) {
        delete nextMsgs[thId];
      }
      return nextMsgs;
    });

    // 清理该频道的会话水位线、交付缓存以及底层 ACP 进程中对应的 session_ids
    clearSessionWarmScope({ channelId, deletedThreadIds: deletedThreads });
    if (activeTopicData && activeTopicData.channelId === channelId) {
      setActiveTopicId(null);
    }
    setIsDeleteChannelModalOpen(false);
    await Promise.all([
      revokeAcpPermissionGrantsForScope('channel', channelId),
      ...Array.from(deletedTopicIds).map((topicId) =>
        revokeAcpPermissionGrantsForScope('topic', topicId)
      ),
      safelyClearAcpSessions(undefined, `channel:${channelId}`, '删除频道'),
      safelyClearAcpSessions(undefined, `topic:${channelId}`, '删除频道'),
    ]);
  };

  // Handle Creation of New Channel
  const handleCreateChannel = async (
    newChan: Omit<Channel, 'id' | 'unreadCount' | 'workspaceBindingId'>,
    workspace: { mode: 'default' | 'custom'; cwd?: string }
  ) => {
    const id = `channel-${Date.now()}`;
    const requestedCwd =
      workspace.mode === 'default' ? getDefaultChannelCwd(id) : workspace.cwd || '';
    const resolvedCwd = await resolveWorkspaceCwd(requestedCwd, workspace.mode === 'default');
    const channelBinding = createChannelBinding({
      channelId: id,
      mode: workspace.mode,
      cwd: resolvedCwd,
    });
    const created: Channel = {
      ...newChan,
      id,
      unreadCount: 0,
      workspaceBindingId: channelBinding.id,
    };
    const nextBindings = [
      ...workspaceBindings.filter((binding) => binding.id !== channelBinding.id),
      channelBinding,
    ];
    await saveWorkspaceBindingsToDb(nextBindings);
    setWorkspaceBindings(nextBindings);
    setChannels((prev) => [...prev, created]);
    setActiveChannelId(id);

    // Seed default thread in this channel
    const defaultThread: Thread = {
      id: `thread-${Date.now()}`,
      channelId: id,
      channelName: created.name,
      type: 'thread',
      title: `#${created.name}`,
      authorId: currentUserId,
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      authorHandle: '@Norris_M5Pro',
      timestamp: 'Just now',
      preview: created.description || `欢迎进入 #${created.name} 协同频道。`,
      activeAgentIds: created.assignedAgentIds,
    };
    setThreads((prev) => [defaultThread, ...prev]);
    setActiveThreadId(defaultThread.id);
    setMessages((prev) => ({
      ...prev,
      [defaultThread.id]: [
        {
          id: `msg-${Date.now()}`,
          threadId: defaultThread.id,
          channelId: id,
          authorId: currentUserId,
          authorName: 'Norris_M5Pro',
          authorHandle: '@Norris_M5Pro',
          authorAvatar: '👨‍💻',
          isAgent: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `欢迎进入 **#${created.name}** 协同频道！${created.description ? `\n- **频道简介**：${created.description}` : ''}\n${created.assignedAgentIds && created.assignedAgentIds.length > 0 ? `- **在场 Agent**：${created.assignedAgentIds.map((agentId) => agents.find((a) => a.id === agentId)?.name).filter(Boolean).join('、')} 已就绪` : '- **当前成员**：仅您本人在频道中，可点击右上角「邀请/管理 Agent」随时添加协作伙伴'}\n- **使用提示**：在下方输入框直接 \`@Agent\` 即可自由交流，或点击右上角 **「+ 新建议题」** 开启结构化专题讨论。`,
        },
      ],
    }));
    setMainView('chat');
  };

  // Handle Creation of New Thread in current channel
  const handleNewThread = () => {
    const threadId = `thread-${Date.now()}`;
    const newThread: Thread = {
      id: threadId,
      channelId: activeChannel?.id || '',
      channelName: activeChannel?.name || '频道',
      type: 'thread',
      title: '新发起的工程研讨议题',
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      authorHandle: '@Norris_M5Pro',
      timestamp: 'Just now',
      preview: '新议题就绪，请在底部 Composer 中输入指令或 @Agent 召唤编队。',
      activeAgentIds: activeChannel?.assignedAgentIds || [],
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(threadId);
    setMessages((prev) => ({
      ...prev,
      [threadId]: [
        {
          id: `msg-${Date.now()}`,
          threadId,
          authorId: 'user-norris',
          authorName: 'Norris_M5Pro',
          authorHandle: '@Norris_M5Pro',
          authorAvatar: '👨‍💻',
          isAgent: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content:
            '已开启新议题！当前研讨环境处于沙盒就绪状态。可直接 @Agent 分派任务或开启子话题深潜。',
        },
      ],
    }));
    setMainView('chat');
  };

  // Topic Handlers (PRD 核心空间交互)
  const handleOpenTopic = (topicId: string) => {
    setActiveTopicId(topicId);
  };

  const handleCreateTopic = async (
    topicData: {
      title: string;
      description: string;
      assignedAgentIds: string[];
      discussionMode?: DiscussionMode;
      gameRoles?: GameRolesConfig;
      gamePolicy?: GameTheoreticPolicy;
      duelRoles?: DuelRolesConfig;
    },
    workspace: { mode: 'default' | 'channel_snapshot' | 'agent_snapshot' | 'custom'; cwd?: string }
  ) => {
    const isDmScope = activeThread?.type === 'dm';
    const dmThread = isDmScope ? activeThread : null;
    if (isDmScope && !dmThread) {
      throw new Error('私聊线程上下文已失效，请重新打开私聊');
    }
    const dmAgent = dmThread
      ? agents.find((agent) => agent.id === dmThread.authorId) || null
      : null;
    if ((isDmScope && !dmAgent) || (!activeChannel && !dmAgent)) {
      throw new Error('当前上下文既不是 Channel 也不是有效私聊 Agent');
    }
    const channelBinding = activeChannel
      ? findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id)
      : undefined;
    if (!isDmScope && (!activeChannel || !channelBinding)) {
      throw new Error(`频道 ${activeChannel?.name || 'unknown'} 缺少 Workspace Binding，无法创建议题`);
    }

    const topicId = `topic-${Date.now()}`;
    const requestedCwd =
      workspace.mode === 'default'
        ? isDmScope && dmAgent
          ? getDefaultDmTopicCwd(dmAgent.id, topicId)
          : getDefaultTopicCwd(activeChannel!.id, topicId)
        : workspace.mode === 'channel_snapshot'
          ? channelBinding?.cwd || ''
          : workspace.mode === 'agent_snapshot'
            ? `~/.shadow-crew/agents/${dmAgent?.id || ''}`
            : workspace.cwd || '';
    const resolvedCwd = await resolveWorkspaceCwd(requestedCwd, workspace.mode === 'default');
    const topicBinding =
      isDmScope && dmAgent
        ? createDmTopicBinding({
            topicId,
            agentId: dmAgent.id,
            mode:
              workspace.mode === 'agent_snapshot'
                ? 'agent_snapshot'
                : workspace.mode === 'custom'
                  ? 'custom'
                  : 'default',
            cwd: resolvedCwd,
          })
        : createTopicBinding({
            topicId,
            channelId: activeChannel!.id,
            mode:
              workspace.mode === 'channel_snapshot' || workspace.mode === 'agent_snapshot'
                ? 'channel_snapshot'
                : workspace.mode,
            channelBinding: channelBinding!,
            cwd: resolvedCwd,
          });
    const validAssignedAgentIds = (
      isDmScope && dmAgent ? [dmAgent.id] : topicData.assignedAgentIds
    ).filter((id) => (isDmScope ? agents : currentChannelAgents).some((a) => a.id === id));

    const isGame = topicData.discussionMode === 'game_theoretic';
    const newGamePolicy =
      isGame && !isDmScope
        ? normalizeGameTheoreticPolicy(topicData.gamePolicy ?? RECOMMENDED_GAME_THEORETIC_POLICY)
        : undefined;
    if (isGame && !isDmScope) {
      const requestedRoles: GameRolesConfig = topicData.gameRoles ?? {
        proposers: [],
        challengers: [],
        verifiers: [],
        arbiters: [],
        humanIsArbiter: false,
      };
      const evaluation = evaluateGameConfiguration({
        agents: currentChannelAgents,
        gameRoles: requestedRoles,
        policy: newGamePolicy,
      });
      if (evaluation.status === 'blocked') {
        throw new Error(`博弈配置未通过准入：${evaluation.blockingIssues.join('；')}`);
      }
    }

    const normalizedDuelRoles =
      isDmScope && isGame && topicData.duelRoles
        ? normalizeDuelRoles(topicData.duelRoles)
        : undefined;
    if (isDmScope && isGame && !normalizedDuelRoles) {
      throw new Error('私聊双方博弈议题缺少角色配置');
    }

    const modelDiversity =
      isGame && topicData.gameRoles ? calculateModelDiversity(agents, topicData.gameRoles) : undefined;
    const initialModularState =
      isGame && !isDmScope
        ? initializeModularOrchestrationState(
            buildDefaultDecompositionFromTopic(topicData.title, topicData.description)
          )
        : undefined;

    const newTopic: TopicMessageData = {
      id: topicId,
      scopeType: isDmScope ? 'dm' : 'channel',
      ...(activeChannel ? { channelId: activeChannel.id } : {}),
      ...(dmAgent && dmThread ? { dmAgentId: dmAgent.id, dmThreadId: dmThread.id } : {}),
      workspaceBindingId: topicBinding.id,
      title: topicData.title,
      description: topicData.description,
      status: 'open',
      discussionMode: topicData.discussionMode || 'standard',
      gameRoles: topicData.gameRoles,
      duelRoles: isDmScope ? normalizedDuelRoles : undefined,
      gameStage: isGame ? 'proposal' : undefined,
      gameTheoreticState: isGame
        ? {
            currentStage: 'proposal',
            gamePolicy: newGamePolicy,
            isChallengerResponded: false,
            modelDiversity,
            modularState: initialModularState,
            cognoNexus: {
              committedStates: [],
              modelDiversity,
              modularState: initialModularState,
            },
          }
        : undefined,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      repliesCount: 0,
      participatingAgentIds: validAssignedAgentIds,
    };
    const nextBindings = [
      ...workspaceBindings.filter((binding) => binding.id !== topicBinding.id),
      topicBinding,
    ];
    await saveWorkspaceBindingsToDb(nextBindings);
    setWorkspaceBindings(nextBindings);

    const targetChannelThread = isDmScope
      ? dmThread
      : threads.find((t) => t.channelId === activeChannel?.id && t.type !== 'dm') || activeThread;
    if (!targetChannelThread) return;

    const topicCardMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: targetChannelThread.id,
      channelId: activeChannel?.id,
      type: 'topic',
      topicData: newTopic,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      gameRole:
        activeTopicData?.scopeType === 'dm' && activeTopicData.discussionMode === 'game_theoretic'
          ? activeTopicData.duelRoles?.proposer === 'human'
            ? 'proposer'
            : 'challenger'
          : undefined,
      gameStage:
        activeTopicData?.scopeType === 'dm' && activeTopicData.discussionMode === 'game_theoretic'
          ? activeTopicData.duelRoles?.proposer === 'human'
            ? 'proposal'
            : 'challenge'
          : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: '',
    };

    const verifiersSummary =
      topicData.gameRoles?.verifiers && topicData.gameRoles.verifiers.length > 0
        ? `\n- 🔍 接地者：${topicData.gameRoles.verifiers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}`
        : '';

    const diversityWarning =
      modelDiversity?.isHomogeneous && modelDiversity.warnings.length > 0
        ? `\n\n${modelDiversity.warnings[0]}`
        : '';

    const dmDuelSummary =
      isDmScope && isGame && topicData.duelRoles
        ? `已发起私聊双方博弈议题【${topicData.title}】。\n目标背景：${topicData.description || '开始双方攻防推演。'}\n- ${topicData.duelRoles.proposer === 'human' ? '👤 人类担任提案方' : `🤖 ${dmAgent?.name || 'Agent'} 担任提案方`}\n- ${topicData.duelRoles.challenger === 'human' ? '👤 人类担任对抗方' : `🤖 ${dmAgent?.name || 'Agent'} 担任对抗方`}`
        : null;
    const initContent =
      dmDuelSummary ||
      (isGame && topicData.gameRoles
        ? `已发起 4+1 认知协同决策议题【${topicData.title}】。\n目标背景：${topicData.description || '开始架构决策攻防推演。'}\n【4+1 协同角色配置】：\n- 🏛️ 提案者：${topicData.gameRoles.proposers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- ⚔️ 红队对抗：${topicData.gameRoles.challengers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}${verifiersSummary}\n- ⚖️ 流程综合：${topicData.gameRoles.arbiters.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- 👤 终局裁判：${topicData.gameRoles.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌)' : '已委派 AI 综合仲裁'}${diversityWarning}`
        : `已发起议题【${topicData.title}】。\n目标背景：${topicData.description || '开始方案推演。'}\n指派 Agent：${validAssignedAgentIds.length > 0 ? validAssignedAgentIds.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') : '暂无 (可在抽屉中指派)'}。`);

    const initTopicMsg: Message = {
      id: `topic-msg-init-${Date.now()}`,
      threadId: topicId,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: initContent,
    };

    commitMessages((prev) => {
      const existingThreadMsgs = prev[targetChannelThread.id] || [];
      const nextThreadMsgs = existingThreadMsgs.some((m) => m.id === topicCardMsg.id)
        ? existingThreadMsgs
        : [...existingThreadMsgs, topicCardMsg];
      return {
        ...prev,
        [targetChannelThread.id]: nextThreadMsgs,
        [topicId]: [initTopicMsg],
      };
    });

    setActiveTopicId(topicId);
  };

  const handleUpdateTopic = (
    topicId: string,
    updatedData: {
      title: string;
      description: string;
      assignedAgentIds: string[];
      discussionMode?: DiscussionMode;
      gameRoles?: GameRolesConfig;
      gamePolicy?: GameTheoreticPolicy;
      duelRoles?: DuelRolesConfig;
    }
  ) => {
    // 过滤出该议题频道内合法的 Agent ID，避免越界
    const validAssignedAgentIds = updatedData.assignedAgentIds.filter((id) =>
      editingTopicAgents.some((a) => a.id === id)
    );

    const isDmTopic = editingTopic?.scopeType === 'dm';
    const nextDiscussionMode =
      updatedData.discussionMode ?? editingTopic?.discussionMode ?? 'standard';
    const normalizedDuelRoles =
      isDmTopic && nextDiscussionMode === 'game_theoretic' && updatedData.duelRoles
        ? normalizeDuelRoles(updatedData.duelRoles)
        : undefined;
    if (isDmTopic && nextDiscussionMode === 'game_theoretic' && !normalizedDuelRoles) {
      throw new Error('私聊双方博弈议题缺少合法的双方角色配置');
    }
    const nextGamePolicy =
      !isDmTopic && nextDiscussionMode === 'game_theoretic'
        ? normalizeGameTheoreticPolicy(
            updatedData.gamePolicy ??
              editingTopic?.gameTheoreticState?.gamePolicy ??
              RECOMMENDED_GAME_THEORETIC_POLICY
          )
        : undefined;
    if (!isDmTopic && nextDiscussionMode === 'game_theoretic') {
      const nextRoles: GameRolesConfig = updatedData.gameRoles ?? {
        proposers: [],
        challengers: [],
        verifiers: [],
        arbiters: [],
        humanIsArbiter: false,
      };
      const evaluation = evaluateGameConfiguration({
        agents: editingTopicAgents,
        gameRoles: nextRoles,
        policy: nextGamePolicy,
      });
      if (evaluation.status === 'blocked') {
        throw new Error(`博弈配置未通过准入：${evaluation.blockingIssues.join('；')}`);
      }
    }

    setMessages((prev) => {
      const next = { ...prev };

      // 1. 更新主时间线与各线程中存储的对应 topicData 卡片
      for (const [tId, msgList] of Object.entries(next)) {
        const idx = msgList.findIndex((m) => m.type === 'topic' && m.topicData?.id === topicId);
        if (idx !== -1) {
          const oldCard = msgList[idx];
          const oldTopic = oldCard.topicData!;
          const updatedTopic: TopicMessageData = {
            ...oldTopic,
            title: updatedData.title,
            description: updatedData.description,
            participatingAgentIds: validAssignedAgentIds,
            discussionMode: nextDiscussionMode,
            gameRoles: isDmTopic
              ? undefined
              : updatedData.gameRoles !== undefined
                ? updatedData.gameRoles
                : oldTopic.gameRoles,
            gameTheoreticState:
              nextDiscussionMode === 'game_theoretic' && !isDmTopic
                ? {
                    currentStage:
                      oldTopic.gameTheoreticState?.currentStage ||
                      oldTopic.gameStage ||
                      'proposal',
                    ...oldTopic.gameTheoreticState,
                    gamePolicy: nextGamePolicy,
                  }
                : oldTopic.gameTheoreticState,
            duelRoles: isDmTopic
              ? nextDiscussionMode === 'game_theoretic'
                ? normalizedDuelRoles
                : undefined
              : oldTopic.duelRoles,
          };
          const newMsgList = [...msgList];
          newMsgList[idx] = {
            ...oldCard,
            topicData: updatedTopic,
          };
          next[tId] = newMsgList;
          break;
        }
      }

      // 2. 在议题讨论抽屉内追加一条更新审计记录
      const auditMsg: Message = {
        id: `topic-msg-edit-${Date.now()}`,
        threadId: topicId,
        authorId: 'system',
        authorName: '系统通知',
        authorHandle: '@system',
        authorAvatar: '📝',
        isAgent: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `📝 **议题信息已更新**：\n- **议题标题**：${updatedData.title}\n- **议题模式**：${(updatedData.discussionMode || 'standard') === 'game_theoretic' ? '♟️ 博弈讨论模式' : '标准研讨模式'}\n- **背景目标**：${updatedData.description || '无'}\n- **协作成员**：${
          validAssignedAgentIds.length > 0
            ? validAssignedAgentIds
                .map((id) => agents.find((a) => a.id === id)?.name)
                .filter(Boolean)
                .join('、')
            : '暂无'
        }`,
      };

      next[topicId] = [...(next[topicId] || []), auditMsg];
      return next;
    });

    // 议题协作成员或模式变更后，递增该议题的代际 Epoch、中止在途旧轮次推演，并清理 standing context、水位线与底层 ACP Session，确保花名册即时同步
    bumpRoomEpoch(turnEpochTrackerRef.current, topicId);
    const hasTopicActiveExec = Object.values(activeExecutionsRef.current).some(
      (e) => e.threadId === topicId || e.topicId === topicId
    );
    if (hasTopicActiveExec) {
      handleAbortAll(topicId);
    }
    clearSessionWarmScope({ roomId: topicId });
    const targetTopicChanId = editingTopicChannel?.id || activeChannel?.id;
    const editingIsDmTopic = editingTopic?.scopeType === 'dm';
    setEditingTopic(null);
    if (editingIsDmTopic) {
      void safelyClearAcpSessions(
        undefined,
        `dmtopic:${editingTopic?.dmAgentId}:${topicId}`,
        '更新议题成员'
      );
    } else if (targetTopicChanId) {
      void safelyClearAcpSessions(
        undefined,
        `topic:${targetTopicChanId}:${topicId}`,
        '更新议题成员'
      );
    }
  };

  // 2. 议题裁决敲定处理函数 (含 Rollup 汇总与落地派发)
  const handleResolveTopic = useCallback(
    (
      topicId: string,
      decision: {
        solution: string;
        impactedFiles: string[];
        approvers: string[];
        rulingRecord?: RulingRecord;
        executorId?: string;
        autoDispatch?: boolean;
      }
    ) => {
      const resolvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const targetExecutorId = decision.executorId || decision.rulingRecord?.executorId;
      const shouldDispatch = Boolean(targetExecutorId && decision.autoDispatch !== false);
      const executorAgent = targetExecutorId
        ? agentsRef.current.find((a) => a.id === targetExecutorId)
        : undefined;

      const currentMinorityReport =
        decision.rulingRecord?.minorityReport || activeTopicData?.gameTheoreticState?.minorityReport;

      const rulingRecordWithExecutor: RulingRecord | undefined = decision.rulingRecord
        ? {
            ...decision.rulingRecord,
            executorId: targetExecutorId,
            minorityReport: decision.rulingRecord.minorityReport || currentMinorityReport,
          }
        : undefined;

      const decisionRecord: DecisionRecord = {
        summary: decision.rulingRecord ? decision.rulingRecord.summary : '架构方案达成一致并收敛',
        solution: decision.solution,
        impactedFiles: decision.impactedFiles,
        approvers: decision.approvers,
        resolvedAt,
        executorId: targetExecutorId,
        executorName: executorAgent?.name,
        minorityReport: currentMinorityReport,
      };

      setMessages((prev) => {
        let parentThreadId: string | null = null;
        for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
          if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
            parentThreadId = tId;
            break;
          }
        }
        if (!parentThreadId) return prev;

        const updatedChannelMsgs = (prev[parentThreadId] || []).map((m) => {
          if (m.type === 'topic' && m.topicData?.id === topicId) {
            return {
              ...m,
              topicData: {
                ...m.topicData,
                status: 'resolved' as TopicStatus,
                gameStage:
                  m.topicData.discussionMode === 'game_theoretic'
                    ? ('concluded' as GameTheoreticStage)
                    : m.topicData.gameStage,
                gameTheoreticState: {
                  ...(m.topicData.gameTheoreticState || {
                    currentStage: 'concluded' as GameTheoreticStage,
                  }),
                  currentStage: 'concluded' as GameTheoreticStage,
                  isArbiterExempted: Boolean(decision.rulingRecord?.exemptionReason),
                  exemptionReason: decision.rulingRecord?.exemptionReason,
                  assignedExecutorId: targetExecutorId,
                  executionStatus: shouldDispatch
                    ? 'running'
                    : m.topicData.gameTheoreticState?.executionStatus || 'idle',
                  minorityReport: currentMinorityReport,
                },
                decisionRecord,
                rulingRecord: rulingRecordWithExecutor,
              },
            };
          }
          return m;
        });

        return {
          ...prev,
          [parentThreadId]: updatedChannelMsgs,
        };
      });

      if (shouldDispatch && targetExecutorId) {
        setTimeout(() => {
          void dispatchTopicExecution({
            topicId,
            executorId: targetExecutorId,
            decision: {
              ...decision,
              rulingRecord: rulingRecordWithExecutor,
            },
          });
        }, 300);
      }
    },
    [agentsRef, activeTopicData, setMessages, dispatchTopicExecution]
  );

  const handleReopenTopic = (topicId: string) => {
    setMessages((prev) => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
        if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
          parentThreadId = tId;
          break;
        }
      }
      if (!parentThreadId) return prev;

      const updatedChannelMsgs = (prev[parentThreadId] || []).map((m) => {
        if (m.type === 'topic' && m.topicData?.id === topicId) {
          return {
            ...m,
            topicData: {
              ...m.topicData,
              status: 'investigating' as TopicStatus,
            },
          };
        }
        return m;
      });
      return { ...prev, [parentThreadId]: updatedChannelMsgs };
    });
  };

  // Add Message to SubThread
  const handleSendSubMessage = (content: string) => {
    if (!activeSubThreadId || !activeSubThread) return;
    const subMsg: Message = {
      id: `sub-msg-${Date.now()}`,
      threadId: activeThread?.id || activeSubThread.threadId || '',
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
    };

    setSubThreads((prev) => {
      const targetSubThread = prev[activeSubThreadId];
      if (!targetSubThread) return prev;
      return {
        ...prev,
        [activeSubThreadId]: {
          ...targetSubThread,
          messages: [...targetSubThread.messages, subMsg],
        },
      };
    });
  };

  // Sync SubThread consensus back to Main Thread
  const handleSyncBackToMainThread = (summary: string) => {
    if (!activeSubThreadId || !activeSubThread || !activeThread) return;
    const responder = agents[0];
    const syncMsg: Message = {
      id: `msg-sync-${Date.now()}`,
      threadId: activeThread.id,
      authorId: responder?.id || 'system',
      authorName: responder?.name || 'Shinobi 编队',
      authorHandle: responder?.handle || '@shinobi',
      authorAvatar: responder?.avatar || '🥷',
      isAgent: true,
      agentBadge: 'Sub-Thread 合流',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: `🔀 **子话题合流决议报告** [${activeSubThread.title}]\n${summary}\n• 状态: 方案已在子话题通过并冻结。`,
    };

    setMessages((prev) => ({
      ...prev,
      [activeThread.id]: [...(prev[activeThread.id] || []), syncMsg],
    }));

    setActiveSubThreadId(null);
  };

  // Add Emoji Reaction
  const handleAddReaction = (messageId: string, emoji: string) => {
    const activeThreadKey = activeThread?.id;
    if (!activeThreadKey) return;
    setMessages((prev) => {
      const threadMsgs = prev[activeThreadKey] || [];
      const updated = threadMsgs.map((m) => {
        if (m.id !== messageId) return m;
        const currentReactions = m.reactions || [];
        const existing = currentReactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...m,
            reactions: currentReactions.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1 } : r
            ),
          };
        }
        return {
          ...m,
          reactions: [...currentReactions, { emoji, count: 1, users: ['@Norris_M5Pro'] }],
        };
      });
      return { ...prev, [activeThreadKey]: updated };
    });
  };

  return {
    targetModalChannel,
    modalChannelUnresolvedTopics,
    handleOpenMembersModal,
    handleOpenDeleteChannelModal,
    handleSelectChannel,
    handleSelectDirectMessage,
    handleLaunchTeamThread,
    handleUpdateChannelMembers,
    handleDeleteChannel,
    handleCreateChannel,
    handleNewThread,
    handleOpenTopic,
    handleCreateTopic,
    handleUpdateTopic,
    handleResolveTopic,
    handleReopenTopic,
    handleSendSubMessage,
    handleSyncBackToMainThread,
    handleAddReaction,
  };
}
