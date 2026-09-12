/**
 * Shinobi Multi-Agent Platform - Reconstructed Workspace UI
 * Fusing Block Buzz, Codex, and Google Antigravity
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  TopicStatus,
  ActiveAgentExecution
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
import { PanelLeftOpen, Hash, Plus } from 'lucide-react';
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
import { sendPromptToAcpAgent } from './services/acpClient';

export default function App() {
  // Main View Navigation ('chat' | 'agents') - Default to chat for PRD Messaging Space
  const [mainView, setMainView] = useState<'chat' | 'agents'>('chat');

  // Core Entities State with Local Storage Persistence
  const [agents, setAgents] = useState<Agent[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_agents');
      if (saved) {
        const parsed = JSON.parse(saved);
          // Filter out contaminated mock agent IDs from the bad UI revision and fix legacy commands
          const filtered = parsed
            .filter(
              (a: any) =>
                a.id !== 'agent-alex-ego' &&
                a.id !== 'agent-architect' &&
                a.id !== 'agent-security' &&
                a.id !== 'agent-devops'
            )
            .map((a: any) => {
              let updatedWorkspace = a.workspace;
              if (updatedWorkspace?.rootPath?.includes('/home/norris')) {
                updatedWorkspace = {
                  ...updatedWorkspace,
                  rootPath: '/Users/xunuosi/Code/Lx/AI/shadow-crew',
                };
              }
              if (a.id === 'agent-shinobi-core') {
                return {
                  ...a,
                  acpCommandOrUrl: './target/debug/shinobi-agent',
                  workspace: updatedWorkspace || {
                    rootPath: '/Users/xunuosi/Code/Lx/AI/shadow-crew',
                    repoName: 'shadow-crew',
                    gitBranch: 'main',
                    permissionMode: 'full_read_write',
                    activeFiles: ['crates/shinobi-agent/src/main.rs'],
                  },
                };
              }
              return updatedWorkspace ? { ...a, workspace: updatedWorkspace } : a;
            });
          filtered.sort((a: any, b: any) => (a.id === 'agent-shinobi-core' ? -1 : b.id === 'agent-shinobi-core' ? 1 : 0));
          if (filtered.length > 0) return filtered;
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
  // Mock data ID blacklist to purge contaminated cache from previous sessions
  const MOCK_CHANNEL_IDS = new Set([
    'channel-acp-dev',
    'channel-general',
    'channel-task-fix',
    'channel-creator-only',
    'channel-relay-core',
  ]);
  const MOCK_THREAD_IDS = new Set([
    'thread-acp-dev-main',
    'topic-acp-auth-spec',
  ]);

  // L0 Projects State with Local Storage Persistence
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_projects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((p: any) => p.id !== 'project-buzz-mesh');
          if (filtered.length > 0) return filtered;
        }
      }
    } catch {}
    return INITIAL_PROJECTS;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('shinobi_active_project_id');
      if (saved && saved !== 'project-buzz-mesh') return saved;
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

  // Channels State with Local Storage Persistence & Mock Cleanup
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_channels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(
            (c: any) => !MOCK_CHANNEL_IDS.has(c.id) && c.status !== 'deleted'
          );
          return filtered;
        }
      }
    } catch {}
    return INITIAL_CHANNELS;
  });

  const [activeChannelId, setActiveChannelId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('shinobi_active_channel_id');
      if (saved && !MOCK_CHANNEL_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_channels', JSON.stringify(channels));
    } catch {}
  }, [channels]);

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_active_channel_id', activeChannelId);
    } catch {}
  }, [activeChannelId]);

  // Threads State with Local Storage Persistence
  const [threads, setThreads] = useState<Thread[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_threads');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(
            (t: any) => !MOCK_THREAD_IDS.has(t.id) && !MOCK_CHANNEL_IDS.has(t.channelId)
          );
          return filtered;
        }
      }
    } catch {}
    return INITIAL_THREADS;
  });

  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('shinobi_active_thread_id');
      if (saved && !MOCK_THREAD_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_threads', JSON.stringify(threads));
    } catch {}
  }, [threads]);

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_active_thread_id', activeThreadId);
    } catch {}
  }, [activeThreadId]);

  // Messages State with Local Storage Persistence
  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
    try {
      const saved = localStorage.getItem('shinobi_messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          for (const k of Object.keys(parsed)) {
            if (MOCK_THREAD_IDS.has(k) || MOCK_CHANNEL_IDS.has(k)) {
              delete parsed[k];
            }
          }
          return parsed;
        }
      }
    } catch {}
    return INITIAL_MESSAGES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_messages', JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // SubThreads State with Local Storage Persistence
  const [subThreads, setSubThreads] = useState<Record<string, SubThread>>(() => {
    try {
      const saved = localStorage.getItem('shinobi_sub_threads');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return INITIAL_SUB_THREADS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('shinobi_sub_threads', JSON.stringify(subThreads));
    } catch {}
  }, [subThreads]);

  const [rpcLogs, setRpcLogs] = useState<AcpRpcLog[]>(INITIAL_RPC_LOGS);
  const [workspaceFiles] = useState<WorkspaceFile[]>(MOCK_WORKSPACE_FILES);

  // Topic States (PRD 三层半扁平拓扑：频道 ➔ Topic 消息卡片 ➔ 独立推演抽屉)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isNewTopicModalOpen, setIsNewTopicModalOpen] = useState<boolean>(false);
  const [quotingMessage, setQuotingMessage] = useState<Message | null>(null);

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
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeExecutions, setActiveExecutions] = useState<Record<string, ActiveAgentExecution>>({});

  const currentUserId = 'user-norris';

  // Computed Context
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const projectChannels = activeProjectId
    ? channels.filter((c) => (!c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted')
    : channels.filter((c) => c.status !== 'deleted');
  const activeChannel = channels.find((c) => c.id === activeChannelId && c.status !== 'deleted') || projectChannels[0];
  const activeThread = 
    threads.find((t) => t.id === activeThreadId) ||
    (activeChannel ? threads.find((t) => t.channelId === activeChannel.id) : null) ||
    threads[0] ||
    null;
  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const activeSubThread = activeSubThreadId ? subThreads[activeSubThreadId] : null;
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  // Auto sync active IDs if state drifted
  useEffect(() => {
    if (activeChannel && activeChannel.id !== activeChannelId) {
      setActiveChannelId(activeChannel.id);
    } else if (!activeChannel && activeChannelId) {
      setActiveChannelId('');
    }
  }, [activeChannel?.id]);

  useEffect(() => {
    if (activeThread && activeThread.id !== activeThreadId) {
      setActiveThreadId(activeThread.id);
    } else if (!activeThread && activeThreadId) {
      setActiveThreadId('');
    }
  }, [activeThread?.id]);

  // Synchronize Agent running status with Tauri backend process manager
  const syncRunningAgentsWithBackend = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const tauriInvoke =
      (window as any).__TAURI_INTERNALS__?.invoke ||
      (window as any).__TAURI__?.core?.invoke;
    if (!tauriInvoke) return;

    try {
      const runningIds: string[] = await tauriInvoke('get_running_agent_ids');
      if (Array.isArray(runningIds)) {
        setAgents((prev) =>
          prev.map((a) => {
            const isAlive = runningIds.includes(a.id);
            if (isAlive) {
              if (a.status === 'idle') {
                return { ...a, status: 'running' };
              }
              return a;
            } else {
              if (a.status === 'running') {
                return { ...a, status: 'idle' };
              }
              return a;
            }
          })
        );
      }
    } catch (err) {
      console.warn('[Sync ACP] Failed to query running agents:', err);
    }
  }, []);

  // Sync on initial mount
  useEffect(() => {
    syncRunningAgentsWithBackend();
  }, [syncRunningAgentsWithBackend]);

  // Sync when switching views (e.g. chat -> agents)
  useEffect(() => {
    if (mainView === 'agents') {
      syncRunningAgentsWithBackend();
    }
  }, [mainView, syncRunningAgentsWithBackend]);

  // Periodic polling every 3 seconds to keep UI in lockstep with OS processes
  useEffect(() => {
    const timer = setInterval(() => {
      syncRunningAgentsWithBackend();
    }, 3000);
    return () => clearInterval(timer);
  }, [syncRunningAgentsWithBackend]);

  // Helper callbacks to open modals for specific channel or active channel
  const handleOpenMembersModal = (channelId?: string) => {
    if (channelId) {
      setModalChannelId(channelId);
    } else {
      setModalChannelId(activeChannel?.id || null);
    }
    setIsChannelMembersModalOpen(true);
  };

  const handleOpenDeleteChannelModal = (channelId?: string) => {
    if (channelId) {
      setModalChannelId(channelId);
    } else {
      setModalChannelId(activeChannel?.id || null);
    }
    setIsDeleteChannelModalOpen(true);
  };

  const targetModalChannel = modalChannelId
    ? channels.find((c) => c.id === modalChannelId) || activeChannel
    : activeChannel;

  // Calculate unresolved topics for modal target channel
  const modalChannelUnresolvedTopics = targetModalChannel
    ? (Object.values(messages) as Message[][])
        .flat()
        .filter(
          (m) =>
            m.channelId === targetModalChannel.id &&
            m.type === 'topic' &&
            m.topicData?.status !== 'resolved'
        ).length
    : 0;

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
    } else {
      setActiveThreadId('');
    }
    setActiveTopicId(null);
    setQuotingMessage(null);
    setMainView('chat');
  };

  // Handle Direct Message Selection
  const handleSelectDirectMessage = (agent: Agent) => {
    // Check if DM thread already exists
    let dmThread = threads.find((t) => t.type === 'dm' && (t.authorId === agent.id || t.id === `thread-dm-${agent.id}`));
    if (!dmThread) {
      dmThread = {
        id: `thread-dm-${agent.id}`,
        channelId: 'direct-messages',
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
            channelId: 'direct-messages',
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

  // Handle Project Selection (L0 Project -> L1 Channel)
  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    const projChannels = channels.filter((c) => (!c.projectId || c.projectId === projectId) && c.status !== 'deleted');
    if (projChannels.length > 0) {
      setActiveChannelId(projChannels[0].id);
      const chThreads = threads.filter((t) => t.channelId === projChannels[0].id);
      if (chThreads.length > 0) {
        setActiveThreadId(chThreads[0].id);
      } else {
        setActiveThreadId('');
      }
    } else {
      setActiveChannelId('');
      setActiveThreadId('');
    }
    setActiveTopicId(null);
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
      const projChannels = remaining.filter((c) => (!c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted');
      const fallback = projChannels[0] || remaining[0];
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

    const mentioned = agents.filter((a) => content.includes(a.handle) || content.includes('@all'));
    let responder: Agent | null = null;
    if (mentioned.length > 0) {
      responder = mentioned[0];
    } else {
      const channelAssigned = (activeChannel?.assignedAgentIds || [])
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a));
      if (channelAssigned.length > 0) {
        responder = channelAssigned[0];
      } else if (agents.length > 0) {
        responder = agents[0];
      }
    }

    if (responder) {
      const now = Date.now();
      const currentResponder = responder;
      const execKey = `${topicId}:${currentResponder.id}`;

      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: currentResponder.id,
          agentName: currentResponder.name,
          agentAvatar: currentResponder.avatar,
          threadId: topicId,
          topicId: topicId,
          status: 'thinking',
          currentActionDetail: '正在深度推演议题方案与系统共识...',
          startedAt: now,
        },
      }));

      logRpc(responder.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'session/prompt',
        params: { roomId: topicId, prompt: content, channelId: activeChannel?.id },
      });

      sendPromptToAcpAgent({
        agent: responder,
        roomId: topicId,
        prompt: content,
        projectId: activeProjectId,
        channelId: activeChannel?.id,
      })
        .then((acpResp) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            return next;
          });

          const agentReply: Message = {
            id: `topic-reply-${Date.now()}`,
            threadId: topicId,
            channelId: activeChannel?.id,
            authorId: responder.id,
            authorName: responder.name,
            authorHandle: responder.handle,
            authorAvatar: responder.avatar,
            isAgent: true,
            agentBadge: `${responder.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : '协作'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            thinkingProcess: acpResp.memoryActions && acpResp.memoryActions.length > 0 ? {
              duration: `${acpResp.durationMs}ms`,
              tokens: Math.round(acpResp.textResponse.length * 1.3),
              summary: `已检索私有记忆库并完成技术边界考量`,
              detail: acpResp.memoryActions.map(m => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`).join('\n')
            } : undefined,
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
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

          logRpc(responder.name, 'agent_to_client', 'session/prompt:result', {
            jsonrpc: '2.0',
            method: 'session/prompt:result',
            result: acpResp,
          });
        })
        .catch((err) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            return next;
          });
          console.error('Failed to send topic prompt to agent:', err);
          const errorReply: Message = {
            id: `topic-reply-err-${Date.now()}`,
            threadId: topicId,
            channelId: activeChannel?.id,
            authorId: responder.id,
            authorName: responder.name,
            authorHandle: responder.handle,
            authorAvatar: responder.avatar,
            isAgent: true,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), errorReply],
          }));
        });
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

  // Interrupt / Abort Agent Execution (Individual or Global)
  const handleAbortAgent = (agentId: string, threadId?: string) => {
    setActiveExecutions((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        const item = next[key];
        if (item.agentId === agentId && (!threadId || item.threadId === threadId)) {
          delete next[key];
        }
      });
      return next;
    });

    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, status: 'idle' } : a))
    );

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      (window as any).__TAURI_INTERNALS__.invoke('stop_acp_agent', { agentId }).catch(() => {});
    }

    setTimeout(() => {
      setActiveExecutions((current) => {
        if (Object.keys(current).length === 0) {
          setIsGenerating(false);
        }
        return current;
      });
    }, 0);
  };

  const handleAbortAll = (threadId?: string) => {
    const agentsToReset: string[] = [];
    setActiveExecutions((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        const item = next[key];
        if (!threadId || item.threadId === threadId) {
          agentsToReset.push(item.agentId);
          delete next[key];
        }
      });
      return next;
    });

    setAgents((prev) =>
      prev.map((a) => (agentsToReset.includes(a.id) ? { ...a, status: 'idle' } : a))
    );

    setIsGenerating(false);
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

    // Detect responding agents with priority fallback:
    // 1. In a 1-on-1 direct message (DM) thread, the target agent ALWAYS responds
    // 2. Explicitly @mentioned agents
    // 3. Agents assigned to the active channel
    // 4. Fallback to default local agent (Shinobi Core)
    const mentioned = agents.filter((a) => content.includes(a.handle) || content.includes('@all'));
    let respondingAgents: Agent[] = [];
    if (activeThread.type === 'dm') {
      const dmTarget = agents.find((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id));
      if (dmTarget) {
        respondingAgents = [dmTarget];
      }
    } else if (mentioned.length > 0) {
      respondingAgents = mentioned;
    } else {
      const channelAssigned = (activeChannel?.assignedAgentIds || [])
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a));
      if (channelAssigned.length > 0) {
        respondingAgents = [channelAssigned[0]];
      } else if (agents.length > 0) {
        respondingAgents = [agents[0]];
      }
    }

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
    const now = Date.now();
    const newExecs: Record<string, ActiveAgentExecution> = {};

    respondingAgents.forEach((ag, idx) => {
      setAgents((prev) => prev.map((a) => (a.id === ag.id ? { ...a, status: 'thinking' } : a)));
      logRpc(ag.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now() + idx,
        method: 'session/prompt',
        params: { threadId: activeThread.id, prompt: content },
      });

      newExecs[`${activeThread.id}:${ag.id}`] = {
        agentId: ag.id,
        agentName: ag.name,
        agentAvatar: ag.avatar,
        threadId: activeThread.id,
        status: idx === 0 ? 'thinking' : 'queued',
        currentActionDetail: idx === 0 ? '正在思考与检索上下文...' : '排队等待推演中...',
        startedAt: now + idx * 200,
      };
    });

    setActiveExecutions((prev) => ({
      ...prev,
      ...newExecs,
    }));

    // Handle agent response via ACP client (real stdio subprocess or fallback)
    const primaryResponder = respondingAgents[0];
    sendPromptToAcpAgent({
      agent: primaryResponder,
      roomId: activeThread.id,
      prompt: content,
      projectId: activeProjectId,
      channelId: activeChannel?.id,
    })
      .then((acpResp) => {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[`${activeThread.id}:${primaryResponder.id}`];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        const agentReply: Message = {
          id: `msg-reply-${Date.now()}`,
          threadId: activeThread.id,
          channelId: activeChannel?.id,
          authorId: primaryResponder.id,
          authorName: primaryResponder.name,
          authorHandle: primaryResponder.handle,
          authorAvatar: primaryResponder.avatar,
          isAgent: true,
          managedBy: primaryResponder.isManagedByYou ? 'you' : undefined,
          agentBadge: `${primaryResponder.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : 'ACP'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          thinkingProcess:
            acpResp.memoryActions && acpResp.memoryActions.length > 0
              ? {
                  duration: `${acpResp.durationMs}ms`,
                  tokens: Math.round(acpResp.textResponse.length * 1.3),
                  summary: `已检索私有记忆库并完成技术边界考量`,
                  detail: acpResp.memoryActions
                    .map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`)
                    .join('\n'),
                }
              : undefined,
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          acpTrace: {
            requestId: `acp-${Date.now()}`,
            method: 'session/prompt',
            durationMs: acpResp.durationMs,
            workspaceAction: {
              action: 'read',
              path: primaryResponder.workspace?.activeFiles?.[0] || 'src/App.tsx',
              summary: `Target workspace: ${primaryResponder.workspace?.rootPath || '.'}${acpResp.isRealProcess ? ' (Real stdio process)' : ''}`,
            },
          },
        };

        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), agentReply],
        }));

        setAgents((prev) => prev.map((a) => (a.id === primaryResponder.id ? { ...a, status: 'running' } : a)));
        syncRunningAgentsWithBackend();

        logRpc(primaryResponder.name, 'agent_to_client', 'session/prompt:result', {
          jsonrpc: '2.0',
          method: 'session/prompt:result',
          result: { status: 'completed', isRealProcess: acpResp.isRealProcess },
        });
      })
      .catch((err) => {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[`${activeThread.id}:${primaryResponder.id}`];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        console.error('Failed to send prompt to agent:', err);
        const errorReply: Message = {
          id: `msg-err-${Date.now()}`,
          threadId: activeThread.id,
          channelId: activeChannel?.id,
          authorId: primaryResponder.id,
          authorName: primaryResponder.name,
          authorHandle: primaryResponder.handle,
          authorAvatar: primaryResponder.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
        };
        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), errorReply],
        }));
        setAgents((prev) => prev.map((a) => (a.id === primaryResponder.id ? { ...a, status: 'idle' } : a)));
        syncRunningAgentsWithBackend();
      });

    // If multiple agents responding in channel, dispatch subsequent collaborators
    if (respondingAgents.length > 1) {
      respondingAgents.slice(1).forEach((secondaryAgent, sIdx) => {
        setTimeout(() => {
          setActiveExecutions((prev) => {
            const key = `${activeThread.id}:${secondaryAgent.id}`;
            if (!prev[key]) return prev;
            return {
              ...prev,
              [key]: {
                ...prev[key],
                status: 'thinking',
                currentActionDetail: '正在对齐多智能体决策与协同审查...',
              },
            };
          });

          setTimeout(() => {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[`${activeThread.id}:${secondaryAgent.id}`];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });

            const secondaryReply: Message = {
              id: `msg-reply-${Date.now()}-${secondaryAgent.id}`,
              threadId: activeThread.id,
              channelId: activeChannel?.id,
              authorId: secondaryAgent.id,
              authorName: secondaryAgent.name,
              authorHandle: secondaryAgent.handle,
              authorAvatar: secondaryAgent.avatar,
              isAgent: true,
              agentBadge: `${secondaryAgent.modelBadge?.split(' ')[0] || 'Local'} · 协同`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `已确认收到，我已针对 @${primaryResponder.name} 的推演方案完成交叉验证，相关上下文已对齐。`,
            };

            setMessages((prev) => ({
              ...prev,
              [activeThread.id]: [...(prev[activeThread.id] || []), secondaryReply],
            }));
            setAgents((prev) => prev.map((a) => (a.id === secondaryAgent.id ? { ...a, status: 'idle' } : a)));
          }, 2400);
        }, 1200 * (sIdx + 1));
      });
    }
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
    <div className="h-full w-full flex bg-canvas text-fg overflow-hidden font-sans select-none antialiased transition-colors duration-150">
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
          onOpenMembersModal={handleOpenMembersModal}
          onOpenDeleteChannelModal={handleOpenDeleteChannelModal}
          agents={agents}
          activeExecutions={Object.values(activeExecutions)}
          teams={teams}
          onOpenAgentTeamsModal={() => setIsAgentTeamsModalOpen(true)}
          onSelectDirectMessage={handleSelectDirectMessage}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggleCollapse={() => setIsSidebarCollapsed(true)}
          activeThreadId={activeThreadId}
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
          onOpenConnectAgentModal={() => {
            setEditingAgent(null);
            setIsConnectModalOpen(true);
          }}
          onOpenCreateTeamModal={() => setIsCreateTeamModalOpen(true)}
          onOpenAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(true)}
          onEditAgent={(agent) => {
            setEditingAgent(agent);
            setIsConnectModalOpen(true);
          }}
          onToggleAgentStatus={(agentId) => {
            const currentAgent = agents.find((a) => a.id === agentId);
            if (!currentAgent) return;
            const isCurrentlyRunning = currentAgent.status !== 'idle';

            if (!isCurrentlyRunning) {
              // 启动 Agent 进程
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agentId ? { ...a, status: 'running' } : a
                )
              );
              if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
                (window as any).__TAURI_INTERNALS__.invoke('spawn_acp_agent', {
                  agentId: currentAgent.id,
                  command: currentAgent.acpCommandOrUrl,
                  cwd: currentAgent.workspace?.rootPath || activeProject?.localWorkspaceRoot || '.',
                  envVars: currentAgent.envVars || [],
                }).then(() => {
                  syncRunningAgentsWithBackend();
                }).catch((err: any) => {
                  console.warn('Spawn agent error:', err);
                  setAgents((prev) =>
                    prev.map((a) =>
                      a.id === agentId ? { ...a, status: 'idle' } : a
                    )
                  );
                });
              }
            } else {
              // 终止 Agent 进程
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agentId ? { ...a, status: 'idle' } : a
                )
              );
              if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
                (window as any).__TAURI_INTERNALS__.invoke('stop_acp_agent', {
                  agentId: currentAgent.id,
                }).then(() => {
                  syncRunningAgentsWithBackend();
                }).catch((err: any) => {
                  console.warn('Stop agent error:', err);
                });
              }
            }
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
            {activeThread && (activeThread.type === 'dm' || activeChannel) ? (
              <>
                <ChatTimeline
                  messages={activeMessages}
                  activeThread={activeThread}
                  channel={activeThread.type === 'dm' ? undefined : activeChannel}
                  agents={agents}
                  activeExecutions={activeThread ? Object.values(activeExecutions).filter((e) => e.threadId === activeThread.id) : []}
                  onAbortAgent={(agentId) => activeThread && handleAbortAgent(agentId, activeThread.id)}
                  onAddReaction={handleAddReaction}
                  onInspectAgent={(id) => {
                    setSelectedAgentId(id);
                    setIsAcpInspectorOpen(true);
                  }}
                  onOpenTopic={handleOpenTopic}
                  onOpenNewTopicModal={activeThread.type === 'dm' ? undefined : () => setIsNewTopicModalOpen(true)}
                  onOpenSubThread={(subId) => setActiveSubThreadId(subId)}
                  onOpenCodexDiff={(diff) => {
                    setActiveDiff(diff);
                    setIsCodexDiffOpen(true);
                  }}
                  onOpenAcpInspector={() => setIsAcpInspectorOpen(true)}
                  onOpenMembersModal={activeThread.type === 'dm' ? undefined : () => handleOpenMembersModal(activeChannel?.id)}
                  onOpenDeleteChannelModal={activeThread.type === 'dm' ? undefined : () => handleOpenDeleteChannelModal(activeChannel?.id)}
                  onQuoteMessage={(msg) => setQuotingMessage(msg)}
                />

                <MessageInput
                  onSendMessage={handleSendMessage}
                  onAbort={() => activeThread && handleAbortAll(activeThread.id)}
                  activeAgents={activeThread.type === 'dm' 
                    ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
                    : agents.filter((a) => activeThread.activeAgentIds?.includes(a.id))}
                  allAgents={agents}
                  isGenerating={isGenerating}
                  channelName={activeThread.type === 'dm' ? (activeThread.authorName || 'Agent') : (activeChannel?.name || 'chat')}
                  onOpenNewTopicModal={activeThread.type === 'dm' ? undefined : () => setIsNewTopicModalOpen(true)}
                  quotingMessage={quotingMessage}
                  onCancelQuote={() => setQuotingMessage(null)}
                />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-canvas text-fg select-none">
                <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center text-accent mb-4 shadow-sm">
                  <Hash className="w-8 h-8 opacity-75" />
                </div>
                <h3 className="text-base font-semibold text-fg mb-1.5">当前项目暂无活跃频道</h3>
                <p className="text-xs text-fg-muted max-w-md mb-6 leading-relaxed">
                  已清空旧版测试数据。您可以在当前项目（<span className="text-accent font-mono font-medium">{activeProject?.name || '当前工作区'}</span>）下创建需求、功能或任务频道，与专职 Agent 共同推演与开发。
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
          <TopicThreadDrawer
            isOpen={Boolean(activeTopicId && activeTopicData)}
            topic={activeTopicData}
            messages={activeTopicMessages}
            agents={agents}
            activeExecutions={activeTopicId ? Object.values(activeExecutions).filter((e) => e.threadId === activeTopicId) : []}
            onAbortAgent={(agentId) => activeTopicId && handleAbortAgent(agentId, activeTopicId)}
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
          onEditAgent={(agent) => {
            setEditingAgent(agent);
            setIsConnectModalOpen(true);
          }}
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
      {targetModalChannel && (
        <ChannelMembersModal
          isOpen={isChannelMembersModalOpen}
          onClose={() => {
            setIsChannelMembersModalOpen(false);
            setModalChannelId(null);
          }}
          channel={targetModalChannel}
          agents={agents}
          currentUserId={currentUserId}
          onUpdateMembers={handleUpdateChannelMembers}
        />
      )}

      {/* 8.2 Modal: Delete Channel Confirmation */}
      {targetModalChannel && (
        <DeleteChannelModal
          isOpen={isDeleteChannelModalOpen}
          onClose={() => {
            setIsDeleteChannelModalOpen(false);
            setModalChannelId(null);
          }}
          channel={targetModalChannel}
          unresolvedTopicsCount={modalChannelUnresolvedTopics}
          onConfirmDelete={handleDeleteChannel}
        />
      )}

      {/* 9. Connect / Edit ACP Agent Modal */}
      <ConnectAgentModal
        isOpen={isConnectModalOpen}
        onClose={() => {
          setIsConnectModalOpen(false);
          setEditingAgent(null);
        }}
        initialAgent={editingAgent}
        defaultWorkspaceRoot={activeProject?.localWorkspaceRoot || '.'}
        onUpdateAgent={(agentId, updatedData) => {
          setAgents((prev) =>
            prev.map((a) => {
              if (a.id === agentId) {
                return {
                  ...a,
                  ...updatedData,
                  status: 'idle',
                  workspace: {
                    ...a.workspace,
                    ...(updatedData.workspace || {}),
                  },
                };
              }
              return a;
            })
          );
          // 若底层正在运行旧进程，主动停止以确保后续以更新后的配置/环境变量重新拉起
          if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
            (window as any).__TAURI_INTERNALS__.invoke('stop_acp_agent', { agentId })
              .then(() => syncRunningAgentsWithBackend())
              .catch(() => {});
          }
        }}
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
              rootPath: agentData.workspace?.rootPath || activeProject?.localWorkspaceRoot || '.',
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
