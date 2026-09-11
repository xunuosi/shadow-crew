/**
 * Shinobi Multi-Agent Platform - Reconstructed Workspace UI
 * Fusing Block Buzz, Codex, and Google Antigravity
 */

import React, { useState, useEffect } from 'react';
import { 
  Project,
  Agent, 
  AgentTeam, 
  Channel, 
  Thread, 
  Message, 
  SubThread, 
  AcpRpcLog, 
  WorkspaceFile,
  TopicMessageData,
  DecisionRecord,
  TopicStatus
} from './types';
import { 
  INITIAL_PROJECTS,
  INITIAL_AGENTS, 
  INITIAL_TEAMS, 
  INITIAL_CHANNELS, 
  INITIAL_THREADS, 
  INITIAL_MESSAGES, 
  INITIAL_SUB_THREADS, 
  INITIAL_RPC_LOGS, 
  MOCK_WORKSPACE_FILES 
} from './data/mockData';
import { PanelLeftOpen } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ChatTimeline } from './components/ChatTimeline';
import { MessageInput } from './components/MessageInput';
import { SubThreadDrawer } from './components/SubThreadDrawer';
import { TopicThreadDrawer } from './components/TopicThreadDrawer';
import { NewTopicModal } from './components/NewTopicModal';
import { CodexDiffViewer } from './components/CodexDiffViewer';
import { AcpInspector } from './components/AcpInspector';
import { AgentTeamsModal } from './components/AgentTeamsModal';
import { CreateChannelModal } from './components/CreateChannelModal';
import { ChannelMembersModal } from './components/ChannelMembersModal';
import { DeleteChannelModal } from './components/DeleteChannelModal';
import { ConnectAgentModal } from './components/ConnectAgentModal';
import { CreateTeamModal } from './components/CreateTeamModal';
import { AgentDefaultsModal } from './components/AgentDefaultsModal';
import { RustTauriArchitectureHub } from './components/RustTauriArchitectureHub';
import { AgentDashboard } from './components/AgentDashboard';

export default function App() {
  // Main View Navigation ('chat' | 'agents') - Default to chat for PRD Messaging Space
  const [mainView, setMainView] = useState<'chat' | 'agents'>('chat');

  // Core Entities State with Local Storage Persistence
  const [agents, setAgents] = useState<Agent[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_agents');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out contaminated mock agent IDs from the bad UI revision
          const filtered = parsed.filter(
            (a: any) =>
              a.id !== 'agent-alex-ego' &&
              a.id !== 'agent-architect' &&
              a.id !== 'agent-security' &&
              a.id !== 'agent-devops'
          );
          if (filtered.length > 0) return filtered;
        }
      }
    } catch {}
    return INITIAL_AGENTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_agents', JSON.stringify(agents));
    } catch {}
  }, [agents]);

  const [teams, setTeams] = useState<AgentTeam[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_teams');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter(
            (t: any) =>
              t.id !== 'team-core-eng' &&
              !t.agentIds?.includes('agent-alex-ego')
          );
          if (filtered.length > 0) return filtered;
        }
      }
    } catch {}
    return INITIAL_TEAMS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_teams', JSON.stringify(teams));
    } catch {}
  }, [teams]);

  // L0 Projects State with Local Storage Persistence
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_projects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_PROJECTS;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('shinobi_active_project_id');
      if (saved) return saved;
    } catch {}
    return INITIAL_PROJECTS[0]?.id || 'project-shadow-crew';
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_projects', JSON.stringify(projects));
    } catch {}
  }, [projects]);

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_active_project_id', activeProjectId);
    } catch {}
  }, [activeProjectId]);

  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState<string>(
    INITIAL_CHANNELS[0]?.id || 'channel-acp-dev'
  );
  const [threads, setThreads] = useState<Thread[]>(INITIAL_THREADS);
  const [activeThreadId, setActiveThreadId] = useState<string>(
    INITIAL_THREADS[0]?.id || 'thread-acp-dev-main'
  );
  const [messages, setMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [subThreads, setSubThreads] = useState<Record<string, SubThread>>(INITIAL_SUB_THREADS);
  const [rpcLogs, setRpcLogs] = useState<AcpRpcLog[]>(INITIAL_RPC_LOGS);
  const [workspaceFiles] = useState<WorkspaceFile[]>(MOCK_WORKSPACE_FILES);

  // Topic States (PRD 三层半扁平拓扑：频道 ➔ Topic 消息卡片 ➔ 独立推演抽屉)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isNewTopicModalOpen, setIsNewTopicModalOpen] = useState<boolean>(false);

  // Filters & Search
  const [threadFilter, setThreadFilter] = useState<'all' | 'unread' | 'mentions' | 'dms'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Side Drawers & Overlays
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [activeSubThreadId, setActiveSubThreadId] = useState<string | null>(null);
  const [isCodexDiffOpen, setIsCodexDiffOpen] = useState<boolean>(false);
  const [activeDiff, setActiveDiff] = useState<any>(null);
  const [isAcpInspectorOpen, setIsAcpInspectorOpen] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  // Modals
  const [isAgentTeamsModalOpen, setIsAgentTeamsModalOpen] = useState<boolean>(false);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState<boolean>(false);
  const [isAgentDefaultsModalOpen, setIsAgentDefaultsModalOpen] = useState<boolean>(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [isChannelMembersModalOpen, setIsChannelMembersModalOpen] = useState<boolean>(false);
  const [isDeleteChannelModalOpen, setIsDeleteChannelModalOpen] = useState<boolean>(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const currentUserId = 'user-norris';

  // Computed Context
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const projectChannels = activeProjectId
    ? channels.filter((c) => !c.projectId || c.projectId === activeProjectId)
    : channels;
  const activeChannel = channels.find((c) => c.id === activeChannelId) || projectChannels[0] || channels[0];
  const activeThread = threads.find((t) => t.id === activeThreadId) || threads.find((t) => t.channelId === activeChannel?.id) || threads[0];
  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const activeSubThread = activeSubThreadId ? subThreads[activeSubThreadId] : null;
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  // Calculate unresolved topics for active channel
  const unresolvedTopicsCount = (Object.values(messages) as Message[][])
    .flat()
    .filter(
      (m) =>
        m.channelId === activeChannelId &&
        m.type === 'topic' &&
        m.topicData?.status !== 'resolved'
    ).length;

  // Find active topic data across all channel messages
  let activeTopicData: TopicMessageData | null = null;
  for (const msgList of Object.values(messages) as Message[][]) {
    for (const m of msgList) {
      if (m.type === 'topic' && m.topicData?.id === activeTopicId) {
        activeTopicData = m.topicData;
        break;
      }
    }
    if (activeTopicData) break;
  }
  const activeTopicMessages = activeTopicId ? messages[activeTopicId] || [] : [];

  // Helper to record an ACP JSON-RPC packet
  const logRpc = (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => {
    const newLog: AcpRpcLog = {
      id: `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      direction,
      agentName,
      method,
      payload,
      status: 'ok',
    };
    setRpcLogs((prev) => [newLog, ...prev]);
  };

  // Handle Channel Selection
  const handleSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    // Switch to first thread of this channel if exists
    const channelThreads = threads.filter((t) => t.channelId === channelId);
    if (channelThreads.length > 0) {
      setActiveThreadId(channelThreads[0].id);
    }
    setMainView('chat');
  };

  // Handle Direct Message Selection
  const handleSelectDirectMessage = (agent: Agent) => {
    // Check if DM thread already exists
    let dmThread = threads.find((t) => t.type === 'dm' && t.authorId === agent.id);
    if (!dmThread) {
      dmThread = {
        id: `thread-dm-${agent.id}`,
        channelId: activeChannelId,
        channelName: 'Direct messages',
        type: 'dm',
        title: `与 ${agent.name} 的私信会话`,
        authorId: agent.id,
        authorName: agent.name,
        authorAvatar: agent.avatar,
        authorHandle: agent.handle,
        timestamp: 'Just now',
        preview: `已开启与 ${agent.name} (${agent.role}) 的 1-on-1 ACP Stdio 会话。`,
        activeAgentIds: [agent.id],
      };
      setThreads((prev) => [dmThread!, ...prev]);
      setMessages((prev) => ({
        ...prev,
        [dmThread!.id]: [
          {
            id: `msg-${Date.now()}`,
            threadId: dmThread!.id,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `你好！我是 **${agent.name}**。ACP 独立进程已就绪，当前挂载协议通道：\`${agent.acpTransport}\`，随时可以开始讨论。`,
          },
        ],
      }));
    }
    setActiveThreadId(dmThread.id);
    setSelectedAgentId(agent.id);
    setMainView('chat');
  };

  // Handle Quick Launch Team Thread from Agent Dashboard
  const handleLaunchTeamThread = (team: AgentTeam) => {
    const threadId = `thread-team-${team.id}-${Date.now()}`;
    const newThread: Thread = {
      id: threadId,
      channelId: activeChannelId,
      channelName: activeChannel.name,
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

  // Handle Project Selection (L0 Project -> L1 Channel)
  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    const projChannels = channels.filter((c) => !c.projectId || c.projectId === projectId);
    if (projChannels.length > 0) {
      setActiveChannelId(projChannels[0].id);
      const chThreads = threads.filter((t) => t.channelId === projChannels[0].id);
      if (chThreads.length > 0) {
        setActiveThreadId(chThreads[0].id);
      }
    }
  };

  // Handle Channel Members Update (Invite / Remove Agent or Human)
  const handleUpdateChannelMembers = (channelId: string, updatedMemberIds: string[]) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, memberIds: updatedMemberIds } : c))
    );
  };

  // Handle Channel Deletion (Cascading Teardown)
  const handleDeleteChannel = (channelId: string) => {
    const remaining = channels.filter((c) => c.id !== channelId);
    setChannels(remaining);

    // If active channel was deleted, redirect to first channel of current project or fallback
    if (activeChannelId === channelId) {
      const projChannels = remaining.filter((c) => !c.projectId || c.projectId === activeProjectId);
      const fallback = projChannels[0] || remaining[0];
      if (fallback) {
        setActiveChannelId(fallback.id);
        const fbThreads = threads.filter((t) => t.channelId === fallback.id);
        if (fbThreads.length > 0) {
          setActiveThreadId(fbThreads[0].id);
        }
      }
    }

    // Clean up channel topics and threads
    const deletedThreads = threads.filter((t) => t.channelId === channelId).map((t) => t.id);
    setThreads((prev) => prev.filter((t) => t.channelId !== channelId));
    setMessages((prev) => {
      const nextMsgs = { ...prev };
      for (const thId of deletedThreads) {
        delete nextMsgs[thId];
      }
      return nextMsgs;
    });

    if (activeTopicData && activeTopicData.channelId === channelId) {
      setActiveTopicId(null);
    }
    setIsDeleteChannelModalOpen(false);
  };

  // Handle Creation of New Channel (Topic)
  const handleCreateChannel = (newChan: Omit<Channel, 'id' | 'unreadCount'>) => {
    const id = `channel-${Date.now()}`;
    const created: Channel = {
      ...newChan,
      id,
      unreadCount: 0,
    };
    setChannels((prev) => [...prev, created]);
    setActiveChannelId(id);

    // Seed default thread in this channel
    const defaultThread: Thread = {
      id: `thread-${Date.now()}`,
      channelId: id,
      channelName: created.name,
      type: 'thread',
      title: `${created.name} 启动与目标同步`,
      authorId: currentUserId,
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      authorHandle: '@Norris_M5Pro',
      timestamp: 'Just now',
      preview: `研讨频道已激活。类别：[${created.kind || 'feature'}]，探讨主题：${created.topic || '自由协同'}。`,
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
          content: `欢迎进入 **#${created.name}** 研讨空间！\n- **类型**：\`[${created.kind || 'feature'}]\`\n- **准入机制**：默认仅创建者入驻（Creator-only），成员需显式受邀\n- **主题方向**：${created.topic || '暂无特定方向'}\n${created.assignedAgentIds && created.assignedAgentIds.length > 0 ? `- **初始协作 Agent**：${created.assignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、')} 已就位。` : '- **提示**：当前仅创建者在频道中，可点击右上角成员管理邀请专属 Agent。'}`,
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
      channelId: activeChannel.id,
      channelName: activeChannel.name,
      type: 'thread',
      title: '新发起的工程研讨议题',
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      authorHandle: '@Norris_M5Pro',
      timestamp: 'Just now',
      preview: '新议题就绪，请在底部 Composer 中输入指令或 @Agent 召唤编队。',
      activeAgentIds: activeChannel.assignedAgentIds,
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(threadId);
    setMessages((prev) => ({
      ...prev,
      [threadId]: [
        {
          id: `msg-${Date.now()}`,
          threadId: threadId,
          authorId: 'user-norris',
          authorName: 'Norris_M5Pro',
          authorHandle: '@Norris_M5Pro',
          authorAvatar: '👨‍💻',
          isAgent: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `已开启新议题！当前研讨环境处于沙盒就绪状态。可直接 @Agent 分派任务或开启子话题深潜。`,
        },
      ],
    }));
    setMainView('chat');
  };

  // Topic Handlers (PRD 核心空间交互)
  const handleOpenTopic = (topicId: string) => {
    setActiveTopicId(topicId);
  };

  const handleCreateTopic = (topicData: {
    title: string;
    description: string;
    assignedAgentIds: string[];
  }) => {
    const topicId = `topic-${Date.now()}`;
    const newTopic: TopicMessageData = {
      id: topicId,
      channelId: activeChannel.id,
      title: topicData.title,
      description: topicData.description,
      status: 'open',
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      repliesCount: 0,
      participatingAgentIds: topicData.assignedAgentIds,
    };

    const topicCardMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: activeThread.id,
      channelId: activeChannel.id,
      type: 'topic',
      topicData: newTopic,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: '',
    };

    setMessages((prev) => ({
      ...prev,
      [activeThread.id]: [...(prev[activeThread.id] || []), topicCardMsg],
      [topicId]: [
        {
          id: `topic-msg-init-${Date.now()}`,
          threadId: topicId,
          authorId: 'user-norris',
          authorName: 'Norris_M5Pro',
          authorHandle: '@Norris_M5Pro',
          authorAvatar: '👨‍💻',
          isAgent: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `已发起议题【${topicData.title}】。\n目标背景：${topicData.description || '开始方案推演。'}\n指派 Agent：${topicData.assignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、')}。`,
        },
      ],
    }));

    setActiveTopicId(topicId);
  };

  const handleSendTopicMessage = (topicId: string, content: string) => {
    const userMsg: Message = {
      id: `topic-msg-${Date.now()}`,
      threadId: topicId,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
    };

    setMessages((prev) => {
      const topicMsgs = prev[topicId] || [];
      const nextTopicMsgs = [...topicMsgs, userMsg];

      const updatedChannelMsgs = (prev[activeThread.id] || []).map((m) => {
        if (m.type === 'topic' && m.topicData?.id === topicId) {
          return {
            ...m,
            topicData: {
              ...m.topicData,
              status: m.topicData.status === 'open' ? 'investigating' : m.topicData.status,
              repliesCount: nextTopicMsgs.length,
              latestReplyPreview: content.slice(0, 60),
            },
          };
        }
        return m;
      });

      return {
        ...prev,
        [topicId]: nextTopicMsgs,
        [activeThread.id]: updatedChannelMsgs,
      };
    });

    const mentioned = agents.filter((a) => content.includes(a.handle));
    const responder = mentioned.length > 0 ? mentioned[0] : (agents.length > 0 ? agents[0] : null);

    if (responder) {
      setTimeout(() => {
        const agentReply: Message = {
          id: `topic-reply-${Date.now()}`,
          threadId: topicId,
          authorId: responder.id,
          authorName: responder.name,
          authorHandle: responder.handle,
          authorAvatar: responder.avatar,
          isAgent: true,
          agentBadge: `${responder.modelBadge?.split(' ')[0] || 'Local'} · 协作`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `【${responder.name}】推演已反馈：\n针对此议题补充了技术边界考量，代码与中间件配置保持兼容。准备好后可点击下方“达成共识并沉淀结论”。`,
        };

        setMessages((prev) => {
          const nextTopicMsgs = [...(prev[topicId] || []), agentReply];
          const updatedChannelMsgs = (prev[activeThread.id] || []).map((m) => {
            if (m.type === 'topic' && m.topicData?.id === topicId) {
              return {
                ...m,
                topicData: {
                  ...m.topicData,
                  repliesCount: nextTopicMsgs.length,
                  latestReplyPreview: agentReply.content.slice(0, 60),
                },
              };
            }
            return m;
          });

          return {
            ...prev,
            [topicId]: nextTopicMsgs,
            [activeThread.id]: updatedChannelMsgs,
          };
        });
      }, 700);
    }
  };

  const handleResolveTopic = (
    topicId: string,
    decision: { solution: string; impactedFiles: string[]; approvers: string[] }
  ) => {
    const resolvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const decisionRecord: DecisionRecord = {
      summary: '架构方案达成一致并收敛',
      solution: decision.solution,
      impactedFiles: decision.impactedFiles,
      approvers: decision.approvers,
      resolvedAt,
    };

    setMessages((prev) => {
      const updatedChannelMsgs = (prev[activeThread.id] || []).map((m) => {
        if (m.type === 'topic' && m.topicData?.id === topicId) {
          return {
            ...m,
            topicData: {
              ...m.topicData,
              status: 'resolved' as TopicStatus,
              decisionRecord,
            },
          };
        }
        return m;
      });

      const rollupNotice: Message = {
        id: `msg-rollup-${Date.now()}`,
        threadId: activeThread.id,
        channelId: activeChannel.id,
        authorId: 'system',
        authorName: 'Shinobi 共识引擎',
        authorHandle: '@shinobi',
        authorAvatar: '🥷',
        isAgent: true,
        agentBadge: 'Consensus Rollup',
        timestamp: resolvedAt,
        content: `🎉 **议题已达成共识并解决 (Resolved & Merged)**\n\n**决策方案**：${decision.solution}\n**影响文件**：${decision.impactedFiles.join('、') || '无'}\n**签署人**：${decision.approvers.join('、')}\n\n*详细推演过程已在议题抽屉归档保存。*`,
      };

      return {
        ...prev,
        [activeThread.id]: [...updatedChannelMsgs, rollupNotice],
      };
    });
  };

  const handleReopenTopic = (topicId: string) => {
    setMessages((prev) => {
      const updatedChannelMsgs = (prev[activeThread.id] || []).map((m) => {
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
      return { ...prev, [activeThread.id]: updatedChannelMsgs };
    });
  };

  // Send Message in active thread
  const handleSendMessage = (content: string) => {
    if (!content.trim() || !activeThread) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: activeThread.id,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      reactions: [],
    };

    setMessages((prev) => ({
      ...prev,
      [activeThread.id]: [...(prev[activeThread.id] || []), userMsg],
    }));

    // Detect mentioned agents
    const mentioned = agents.filter((a) => content.includes(a.handle) || content.includes('@all'));
    const respondingAgents = mentioned.length > 0 ? mentioned : (agents.length > 0 ? [agents[0]] : []);

    if (respondingAgents.length === 0) {
      setTimeout(() => {
        const hintMsg: Message = {
          id: `msg-hint-${Date.now()}`,
          threadId: activeThread.id,
          authorId: 'system',
          authorName: 'Shinobi 系统提示',
          authorHandle: '@shinobi',
          authorAvatar: '🥷',
          isAgent: true,
          agentBadge: 'System',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: '当前工作台尚未连接任何本地 ACP Agent。\n\n请前往 **Agents & 编队** 页面，点击 `+` 接入本机可用的 Agent（如 Claude Code、OpenClaw、Shinobi Core 等）。接入后即可在此直接与你的 AI 影分身对话！',
        };
        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), hintMsg],
        }));
      }, 500);
      return;
    }

    setIsGenerating(true);
    respondingAgents.forEach((ag) => {
      setAgents((prev) => prev.map((a) => (a.id === ag.id ? { ...a, status: 'thinking' } : a)));
      logRpc(ag.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'session/prompt',
        params: { threadId: activeThread.id, prompt: content },
      });
    });

    // Handle agent response
    setTimeout(() => {
      const primaryResponder = respondingAgents[0];
      const agentReply: Message = {
        id: `msg-reply-${Date.now()}`,
        threadId: activeThread.id,
        authorId: primaryResponder.id,
        authorName: primaryResponder.name,
        authorHandle: primaryResponder.handle,
        authorAvatar: primaryResponder.avatar,
        isAgent: true,
        managedBy: primaryResponder.isManagedByYou ? 'you' : undefined,
        agentBadge: `${primaryResponder.modelBadge?.split(' ')[0] || 'Local'} · ACP`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `【${primaryResponder.name}】已通过本地 ACP Stdio 接口就绪：\n收到关于当前会话的指示，已完成状态同步。随时可以接收下一步编码或审查任务。`,
        acpTrace: {
          requestId: `acp-${Date.now()}`,
          method: 'session/prompt',
          durationMs: 220,
          workspaceAction: {
            action: 'read',
            path: primaryResponder.workspace?.activeFiles?.[0] || 'src/App.tsx',
            summary: `Target workspace: ${primaryResponder.workspace?.rootPath || '.'}`,
          },
        },
      };

      setMessages((prev) => ({
        ...prev,
        [activeThread.id]: [...(prev[activeThread.id] || []), agentReply],
      }));

      setAgents((prev) => prev.map((a) => (a.id === primaryResponder.id ? { ...a, status: 'idle' } : a)));
      setIsGenerating(false);

      logRpc(primaryResponder.name, 'agent_to_client', 'session/prompt:result', {
        jsonrpc: '2.0',
        method: 'session/prompt:result',
        result: { status: 'completed' },
      });
    }, 800);
  };

  // Add Message to SubThread
  const handleSendSubMessage = (content: string) => {
    if (!activeSubThreadId || !activeSubThread) return;
    const subMsg: Message = {
      id: `sub-msg-${Date.now()}`,
      threadId: activeThread.id,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
    };

    setSubThreads((prev) => ({
      ...prev,
      [activeSubThreadId]: {
        ...prev[activeSubThreadId],
        messages: [...prev[activeSubThreadId].messages, subMsg],
      },
    }));
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
    setMessages((prev) => {
      const threadMsgs = prev[activeThread.id] || [];
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
        } else {
          return {
            ...m,
            reactions: [...currentReactions, { emoji, count: 1, users: ['@Norris_M5Pro'] }],
          };
        }
      });
      return { ...prev, [activeThread.id]: updated };
    });
  };

  return (
    <div className="h-screen w-screen flex bg-canvas text-fg overflow-hidden font-sans select-none antialiased transition-colors duration-150">
      {/* 1. Left Primary Sidebar (Buzz / macOS Navigation) */}
      {!isSidebarCollapsed && (
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          channels={channels}
          activeChannelId={activeChannel ? activeChannel.id : ''}
          onSelectChannel={handleSelectChannel}
          onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
          agents={agents}
          teams={teams}
          onOpenAgentTeamsModal={() => setIsAgentTeamsModalOpen(true)}
          onSelectDirectMessage={handleSelectDirectMessage}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggleCollapse={() => setIsSidebarCollapsed(true)}
          onOpenRustTauriHub={() => setIsRustTauriHubOpen(true)}
          currentMainView={mainView}
          onSelectMainView={setMainView}
        />
      )}

      {isSidebarCollapsed && (
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="absolute top-2.5 left-2.5 z-30 p-1.5 bg-[#121824] hover:bg-[#1b2436] text-gray-300 hover:text-white rounded-lg border border-[#202c3e] shadow-lg cursor-pointer transition-colors"
          title="展开侧边栏"
        >
          <PanelLeftOpen className="w-4 h-4 text-cyan-400" />
        </button>
      )}

      {/* Main View Switcher: Agents & Teams Dashboard vs Topic Chat Stream */}
      {mainView === 'agents' ? (
        <AgentDashboard
          agents={agents}
          teams={teams}
          channels={channels}
          onOpenConnectAgentModal={() => setIsConnectModalOpen(true)}
          onOpenCreateTeamModal={() => setIsCreateTeamModalOpen(true)}
          onOpenAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(true)}
          onToggleAgentStatus={(agentId) => {
            setAgents((prev) =>
              prev.map((a) => {
                if (a.id === agentId) {
                  const nextStatus = a.status === 'idle' ? 'thinking' : 'idle';
                  if (nextStatus === 'thinking') {
                    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
                      (window as any).__TAURI_INTERNALS__.invoke('spawn_acp_agent', {
                        agentId: a.id,
                        command: a.acpCommandOrUrl,
                        cwd: a.workspace?.rootPath || '.',
                      }).catch((err: any) => {
                        console.warn('Spawn agent info:', err);
                      });
                    }
                  }
                  return { ...a, status: nextStatus };
                }
                return a;
              })
            );
          }}
          onLaunchTeamThread={(team) => {
            handleLaunchTeamThread(team);
          }}
          onStart1on1Chat={(agent) => {
            handleSelectDirectMessage(agent);
            setMainView('chat');
          }}
          onInspectAgent={(agentId) => {
            setSelectedAgentId(agentId);
            setIsAcpInspectorOpen(true);
          }}
          onDeleteAgent={(agentId) => {
            setAgents((prev) => prev.filter((a) => a.id !== agentId));
          }}
          onDeleteTeam={(teamId) => {
            setTeams((prev) => prev.filter((t) => t.id !== teamId));
          }}
        />
      ) : (
        <>
          {/* 2. Middle Column: Channel Main Timeline & Composer (PRD Column 2) */}
          <main className="flex-1 flex flex-col min-w-0 bg-canvas border-l border-border relative overflow-hidden transition-colors duration-150">
            <ChatTimeline
              messages={activeMessages}
              activeThread={activeThread}
              channel={activeChannel}
              agents={agents}
              onAddReaction={handleAddReaction}
              onInspectAgent={(id) => {
                setSelectedAgentId(id);
                setIsAcpInspectorOpen(true);
              }}
              onOpenTopic={handleOpenTopic}
              onOpenNewTopicModal={() => setIsNewTopicModalOpen(true)}
              onOpenSubThread={(subId) => setActiveSubThreadId(subId)}
              onOpenCodexDiff={(diff) => {
                setActiveDiff(diff);
                setIsCodexDiffOpen(true);
              }}
              onOpenAcpInspector={() => setIsAcpInspectorOpen(true)}
              onOpenMembersModal={() => setIsChannelMembersModalOpen(true)}
              onOpenDeleteChannelModal={() => setIsDeleteChannelModalOpen(true)}
            />

            <MessageInput
              onSendMessage={handleSendMessage}
              activeAgents={agents.filter((a) => activeThread.activeAgentIds?.includes(a.id))}
              isGenerating={isGenerating}
              channelName={activeChannel.name}
              onOpenNewTopicModal={() => setIsNewTopicModalOpen(true)}
            />
          </main>

          {/* 3. Right Column: Topic Thread Drawer (PRD Column 3) */}
          <TopicThreadDrawer
            isOpen={Boolean(activeTopicId && activeTopicData)}
            topic={activeTopicData}
            messages={activeTopicMessages}
            agents={agents}
            onClose={() => setActiveTopicId(null)}
            onSendMessage={handleSendTopicMessage}
            onResolveTopic={handleResolveTopic}
            onReopenTopic={handleReopenTopic}
            onOpenCodexDiff={(diff) => {
              setActiveDiff(diff);
              setIsCodexDiffOpen(true);
            }}
          />
        </>
      )}

      {/* 4. Sub-Thread Nested Discussion Drawer */}
      <SubThreadDrawer
        isOpen={Boolean(activeSubThreadId && activeSubThread)}
        subThread={activeSubThread}
        agents={agents}
        onClose={() => setActiveSubThreadId(null)}
        onSendSubMessage={handleSendSubMessage}
        onSyncBackToMainThread={handleSyncBackToMainThread}
      />

      {/* 5. Codex Diff Inspection Drawer */}
      <CodexDiffViewer
        isOpen={isCodexDiffOpen}
        onClose={() => setIsCodexDiffOpen(false)}
        activeDiff={activeDiff}
        workspaceFiles={workspaceFiles}
      />

      {/* 6. Antigravity ACP Protocol & Telemetry Inspector Drawer */}
      {isAcpInspectorOpen && selectedAgent && (
        <AcpInspector
          selectedAgent={selectedAgent}
          rpcLogs={rpcLogs}
          workspaceFiles={workspaceFiles}
          onAddAgentMemoryItem={(agentId, cat, key, content) => {
            setAgents((prev) =>
              prev.map((a) =>
                a.id === agentId
                  ? {
                      ...a,
                      memory: {
                        ...a.memory,
                        persistentItems: [
                          { id: `mem-${Date.now()}`, category: cat, key, content, lastAccessed: 'Just added' },
                          ...a.memory.persistentItems,
                        ],
                      },
                    }
                  : a
              )
            );
          }}
          onRunAgentSkill={(agentId, skillId) => {
            const ag = agents.find((a) => a.id === agentId);
            if (ag) {
              logRpc(ag.name, 'client_to_agent', 'skills/callTool', { skillId });
            }
          }}
          onOpenRustTauriHub={() => setIsRustTauriHubOpen(true)}
          onClose={() => setIsAcpInspectorOpen(false)}
        />
      )}

      {/* 7. Modals: Agent Teams Management */}
      <AgentTeamsModal
        isOpen={isAgentTeamsModalOpen}
        onClose={() => setIsAgentTeamsModalOpen(false)}
        agents={agents}
        teams={teams}
        onCreateTeam={(newTeam) => {
          const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
          setTeams((prev) => [...prev, created]);
        }}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
      />

      {/* 7.1 Modal: Create Team Popup */}
      <CreateTeamModal
        isOpen={isCreateTeamModalOpen}
        onClose={() => setIsCreateTeamModalOpen(false)}
        agents={agents}
        onCreateTeam={(newTeam) => {
          const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
          setTeams((prev) => [...prev, created]);
        }}
      />

      {/* 7.2 Modal: Agent Defaults */}
      <AgentDefaultsModal
        isOpen={isAgentDefaultsModalOpen}
        onClose={() => setIsAgentDefaultsModalOpen(false)}
      />

      {/* 8. Modals: Create Topic / Channel */}
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        activeProjectId={activeProjectId}
        currentUserId={currentUserId}
        teams={teams}
        agents={agents}
        onCreateChannel={handleCreateChannel}
      />

      {/* 8.1 Modal: Channel Members & Invites */}
      {activeChannel && (
        <ChannelMembersModal
          isOpen={isChannelMembersModalOpen}
          onClose={() => setIsChannelMembersModalOpen(false)}
          channel={activeChannel}
          agents={agents}
          currentUserId={currentUserId}
          onUpdateMembers={handleUpdateChannelMembers}
        />
      )}

      {/* 8.2 Modal: Delete Channel Confirmation */}
      {activeChannel && (
        <DeleteChannelModal
          isOpen={isDeleteChannelModalOpen}
          onClose={() => setIsDeleteChannelModalOpen(false)}
          channel={activeChannel}
          unresolvedTopicsCount={unresolvedTopicsCount}
          onConfirmDelete={handleDeleteChannel}
        />
      )}

      {/* 9. Connect New ACP Agent Modal */}
      <ConnectAgentModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnectAgent={(agentData) => {
          const newAg: Agent = {
            id: `agent-${Date.now()}`,
            name: agentData.name || 'Custom Agent',
            handle: agentData.handle || `@${(agentData.name || 'agent').toLowerCase()}`,
            avatar: agentData.avatar || '🤖',
            role: agentData.role || 'Specialized Agent',
            description: agentData.description || agentData.role || 'Custom ACP Agent',
            color: '#06b6d4',
            status: 'idle',
            modelBadge: agentData.modelBadge || 'Claude 3.7 Sonnet',
            localAcpProfile: agentData.localAcpProfile,
            envVars: agentData.envVars,
            isManagedByYou: true,
            acpTransport: agentData.acpTransport || 'stdio',
            acpCommandOrUrl: agentData.acpCommandOrUrl || 'cargo run --bin custom-agent -- --acp',
            protocolVersion: '2025-01-01 (ACP v1.0.4)',
            capabilities: {
              canUseInternalMemory: true,
              canAccessWorkspaceFiles: true,
              canExecuteSkills: true,
              canDelegateToSubAgents: true,
              supportsStreaming: true,
            },
            workspace: {
              rootPath: agentData.workspace?.rootPath || '/home/norris/workspace/shadow-crew',
              repoName: 'shadow-crew',
              gitBranch: 'main',
              permissionMode: 'full_read_write',
              activeFiles: ['src/App.tsx'],
            },
            skills: [],
            memory: {
              internalMemoryPath: `~/.local/share/shinobi/${(agentData.name || 'agent').toLowerCase()}_memory.sqlite`,
              persistentType: 'sqlite',
              persistentItems: [],
              sessionCacheCount: 0,
            },
          };
          setAgents((prev) => [...prev, newAg]);
        }}
      />

      {/* 9.1 Modal: Create New Topic */}
      <NewTopicModal
        isOpen={isNewTopicModalOpen}
        onClose={() => setIsNewTopicModalOpen(false)}
        channel={activeChannel}
        agents={agents}
        onCreateTopic={handleCreateTopic}
      />

      {/* 10. Rust + Tauri Architecture & Source Code Hub */}
      <RustTauriArchitectureHub
        isOpen={isRustTauriHubOpen}
        onClose={() => setIsRustTauriHubOpen(false)}
      />
    </div>
  );
}
