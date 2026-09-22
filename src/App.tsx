/**
 * Shinobi Multi-Agent Platform - Reconstructed Workspace UI
 * Fusing Block Buzz, Codex, and Google Antigravity
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  ActiveAgentExecution,
  AgentRuntimeStatus,
  MemoryCartridge,
  DiscussionMode,
  GameRolesConfig,
  GameRoleType,
  GameTheoreticStage,
  RulingRecord
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
import { Hash, Plus, PanelLeft } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ChatTimeline } from './components/ChatTimeline';
import { MessageInput } from './components/MessageInput';
import { SubThreadDrawer } from './components/SubThreadDrawer';
import { TopicThreadDrawer } from './components/TopicThreadDrawer';
import { NewTopicModal } from './components/NewTopicModal';
import { EditTopicModal } from './components/EditTopicModal';
import { CodexDiffViewer } from './components/CodexDiffViewer';
import { AcpInspector } from './components/AcpInspector';
import { AgentTeamsModal } from './components/AgentTeamsModal';
import { CreateChannelModal } from './components/CreateChannelModal';
import { ChannelMembersModal } from './components/ChannelMembersModal';
import { DeleteChannelModal } from './components/DeleteChannelModal';
import { ConnectAgentModal } from './components/ConnectAgentModal';
import { CreateTeamModal } from './components/CreateTeamModal';
import { AgentDefaultsModal } from './components/AgentDefaultsModal';
import { StorageSettingsModal } from './components/StorageSettingsModal';
import { RustTauriArchitectureHub } from './components/RustTauriArchitectureHub';
import { AgentDashboard } from './components/AgentDashboard';
import { MemoryExportModal } from './components/MemoryExportModal';
import { MemoryImportModal } from './components/MemoryImportModal';
import { sendPromptToAcpAgent } from './services/acpClient';
import { saveMessagesBatchToDb, loadMessagesFromDb } from './services/dbClient';
import { DEFAULT_MODEL_NAME } from './config/models';
import {
  CollaborationCascade,
  parseAgentMentions,
  checkLoopGuard,
  buildCrewRosterGuidance,
  buildCascadePrompt,
  buildTopicPrompt,
  TopicPromptContext,
} from './services/agentCollaboration';

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
              const baseAgent = {
                ...a,
                status: 'idle', // 启动默认未开启通信，需用户在面板点击 Start
                statusDetail: undefined,
              };
              if (a.id === 'agent-shinobi-core') {
                return {
                  ...baseAgent,
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
              return updatedWorkspace ? { ...baseAgent, workspace: updatedWorkspace } : baseAgent;
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
            } else if (k.startsWith('thread-dm-')) {
              // 自动清洗误入私聊会话的频道历史消息、议题卡片与共识决议卡片
              const agentId = k.replace('thread-dm-', '');
              parsed[k] = (parsed[k] || []).filter((m: Message) => {
                if (
                  m.type === 'topic' ||
                  m.agentBadge === 'Consensus Rollup' ||
                  m.agentBadge === 'Channel Guard' ||
                  (m.channelId && m.channelId !== 'direct-messages')
                ) {
                  return false;
                }
                return m.authorId === 'user-norris' || m.authorId === agentId || m.authorId === 'system';
              });
            }
          }
          return parsed;
        }
      }
    } catch {}
    return INITIAL_MESSAGES;
  });

  // 首次启动从 SQLite 原生数据库加载与同步历史消息 (方案 3: 消除 5MB 限制)
  useEffect(() => {
    let isMounted = true;
    async function syncMessagesWithDb() {
      try {
        const dbMsgs = await loadMessagesFromDb();
        if (!isMounted) return;
        if (dbMsgs && dbMsgs.length > 0) {
          setMessages((prev) => {
            const next = { ...prev };
            let hasNew = false;
            for (const msg of dbMsgs) {
              const key = msg.threadId || msg.channelId || 'general';
              if (!next[key]) next[key] = [];
              if (!next[key].some((m) => m.id === msg.id)) {
                next[key].push(msg);
                hasNew = true;
              }
            }
            return hasNew ? next : prev;
          });
        } else {
          // 若 SQLite 库暂无数据，则批量导入当前本地初始化消息
          const currentList = Object.values(messages).flat();
          if (currentList.length > 0) {
            await saveMessagesBatchToDb(currentList);
          }
        }
      } catch (err) {
        console.error('[App] Failed to sync messages with SQLite:', err);
      }
    }
    syncMessagesWithDb();
    return () => {
      isMounted = false;
    };
  }, []);

  // 消息持久化 (原生 SQLite 优先，同步防护 LocalStorage)
  useEffect(() => {
    const allMsgs = Object.values(messages).flat();
    if (allMsgs.length > 0) {
      saveMessagesBatchToDb(allMsgs).catch((e) => {
        console.error('[App] SQLite saveMessagesBatchToDb failed:', e);
      });
    }
    try {
      localStorage.setItem('shinobi_messages', JSON.stringify(messages));
    } catch (err) {
      console.warn('[App] LocalStorage quota exceeded, SQLite persistence safely active.');
    }
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
  const [editingTopic, setEditingTopic] = useState<TopicMessageData | null>(null);
  const [quotingMessage, setQuotingMessage] = useState<Message | null>(null);

  // Filters & Search
  const [threadFilter, setThreadFilter] = useState<'all' | 'unread' | 'mentions' | 'dms'>('all');
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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
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
  const [isStorageSettingsModalOpen, setIsStorageSettingsModalOpen] = useState<boolean>(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [isChannelMembersModalOpen, setIsChannelMembersModalOpen] = useState<boolean>(false);
  const [isDeleteChannelModalOpen, setIsDeleteChannelModalOpen] = useState<boolean>(false);
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isMemoryExportModalOpen, setIsMemoryExportModalOpen] = useState<boolean>(false);
  const [exportingAgent, setExportingAgent] = useState<Agent | null>(null);
  const [isMemoryImportModalOpen, setIsMemoryImportModalOpen] = useState<boolean>(false);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeExecutions, setActiveExecutions] = useState<Record<string, ActiveAgentExecution>>({});
  const [activeCascades, setActiveCascades] = useState<Record<string, CollaborationCascade>>({});
  const activeCascadesRef = useRef<Record<string, CollaborationCascade>>({});
  activeCascadesRef.current = activeCascades;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // 对标 Buzz: 记录每个会话/房间与 Agent 之间的立足上下文 (Standing Context) 交付状态
  // 保证整套平台公约与团队花名册只在 Session 建立时/第 1 轮传递，后续日常交互均为纯净指令
  const deliveredStandingContextRef = useRef<Set<string>>(new Set());
  // 记录正在执行中的三元博弈阶段交接，杜绝并发重入与重复下发 Prompt
  const inFlightHandoverRef = useRef<Set<string>>(new Set());

  const currentUserId = 'user-norris';

  // Computed Context
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const projectChannels = activeProjectId
    ? channels.filter((c) => (!c.projectId || c.projectId === activeProjectId) && c.status !== 'deleted')
    : channels.filter((c) => c.status !== 'deleted');

  // 1. 判断当前是否处于显式私聊模式 (Direct Message Mode)
  const isDirectMessageSelected = activeThreadId.startsWith('thread-dm-') || threads.find((t) => t.id === activeThreadId)?.type === 'dm';

  // 2. 频道解析：若在私聊模式下，强制清空 activeChannel，杜绝任何频道上下文与成员名单穿透至私聊
  const activeChannel = isDirectMessageSelected
    ? null
    : (channels.find((c) => c.id === activeChannelId && c.status !== 'deleted') || projectChannels[0] || null);

  // 3. 线程解析：
  // - 若为私聊模式，严格锁定对应 dmThread，严禁回退至任何频道线程；
  // - 若为频道模式，严格只在该频道所属线程中查找，彻底废除 threads[0] 的盲目 cross-fallback
  const activeThread = isDirectMessageSelected
    ? (threads.find((t) => t.id === activeThreadId && t.type === 'dm') ||
       threads.find((t) => t.type === 'dm') ||
       null)
    : ((activeChannel ? threads.find((t) => t.id === activeThreadId && t.channelId === activeChannel.id && t.type !== 'dm') : null) ||
       (activeChannel ? threads.find((t) => t.channelId === activeChannel.id && t.type !== 'dm') : null) ||
       null);

  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const activeSubThread = activeSubThreadId ? subThreads[activeSubThreadId] : null;
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  // 双轨分流架构：基于会话级（Session-scoped）精准判定当前活跃视图/线程是否正在推演
  // 彻底解耦议题推演与私聊输入，防止议题后台运行锁死私聊输入框
  const isCurrentThreadGenerating = activeThread
    ? Object.values(activeExecutions).some((e: any) => e.threadId === activeThread.id)
    : false;

  // 当前频道的专属受邀成员 Agent 列表 (严格限定在当前频道的受邀成员范围内，杜绝非成员 Agent 渗入)
  const currentChannelAgents = useMemo(() => {
    if (!activeChannel) return [];
    const channelIds = new Set([
      ...(activeChannel.assignedAgentIds || []),
      ...(activeChannel.memberIds || []),
      ...(activeThread?.activeAgentIds || []),
    ]);
    return agents.filter((a) => channelIds.has(a.id));
  }, [activeChannel, activeThread?.activeAgentIds, agents]);

  // 当编辑议题时，计算该议题所属频道及该频道的可用 Agent 成员列表 (严格限定在对应频道准入成员)
  const editingTopicChannel = useMemo(() => {
    if (!editingTopic) return activeChannel;
    return channels.find((c) => c.id === editingTopic.channelId) || activeChannel;
  }, [editingTopic, channels, activeChannel]);

  const editingTopicAgents = useMemo(() => {
    if (!editingTopicChannel) return currentChannelAgents;
    const channelIds = new Set([
      ...(editingTopicChannel.assignedAgentIds || []),
      ...(editingTopicChannel.memberIds || []),
    ]);
    return agents.filter((a) => channelIds.has(a.id));
  }, [editingTopicChannel, currentChannelAgents, agents]);

  // Auto sync active IDs if state drifted (私聊模式下不自动回弹 channel ID)
  useEffect(() => {
    if (isDirectMessageSelected) return;
    if (activeChannel && activeChannel.id !== activeChannelId) {
      setActiveChannelId(activeChannel.id);
    } else if (!activeChannel && activeChannelId) {
      setActiveChannelId('');
    }
  }, [activeChannel?.id, isDirectMessageSelected]);

  useEffect(() => {
    if (activeThread && activeThread.id !== activeThreadId) {
      setActiveThreadId(activeThread.id);
    } else if (!activeThread && activeThreadId && !isDirectMessageSelected) {
      setActiveThreadId('');
    }
  }, [activeThread?.id, isDirectMessageSelected]);

  // One-time repair for TestChannel: Ensure MyClaudeCode is included, ShinobiCore is excluded, and never override user changes
  useEffect(() => {
    try {
      const MIGRATION_KEY = 'shinobi_testchannel_repaired_v4';
      if (localStorage.getItem(MIGRATION_KEY)) return;
      if (agents.length === 0) return;

      // Find Claude Code agent (MyClaudeCode)
      const claudeAgent = agents.find(
        (a) =>
          a.name.toLowerCase().includes('claude') ||
          a.handle?.toLowerCase().includes('claude') ||
          a.id.toLowerCase().includes('claude')
      );

      setChannels((prevChannels) => {
        let changed = false;
        const updated = prevChannels.map((channel) => {
          const isTestChannel =
            channel.name.toLowerCase().includes('test') ||
            channel.id.toLowerCase().includes('test');

          if (isTestChannel) {
            changed = true;
            // Exclude shinobi-core
            const newAssigned = (channel.assignedAgentIds || []).filter(
              (id) => id !== 'agent-shinobi-core'
            );
            const newMembers = (channel.memberIds || [channel.creatorId || currentUserId]).filter(
              (id) => id !== 'agent-shinobi-core'
            );

            // Include claudeAgent if found
            if (claudeAgent) {
              if (!newAssigned.includes(claudeAgent.id)) newAssigned.push(claudeAgent.id);
              if (!newMembers.includes(claudeAgent.id)) newMembers.push(claudeAgent.id);
            }

            return {
              ...channel,
              assignedAgentIds: newAssigned,
              memberIds: newMembers,
            };
          }
          return channel;
        });

        if (changed) {
          localStorage.setItem(MIGRATION_KEY, 'true');
          setThreads((prevThreads) =>
            prevThreads.map((thread) => {
              const chan = updated.find((c) => c.id === thread.channelId);
              if (
                chan &&
                (chan.name.toLowerCase().includes('test') ||
                  chan.id.toLowerCase().includes('test'))
              ) {
                return {
                  ...thread,
                  activeAgentIds: chan.assignedAgentIds,
                };
              }
              return thread;
            })
          );
          return updated;
        }

        localStorage.setItem(MIGRATION_KEY, 'true');
        return prevChannels;
      });
    } catch {}
  }, [agents, currentUserId]);

  // Synchronize Agent running status with Tauri backend process manager
  const syncRunningAgentsWithBackend = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const tauriInvoke =
      (window as any).__TAURI_INTERNALS__?.invoke ||
      (window as any).__TAURI__?.core?.invoke;
    if (!tauriInvoke) return;

    try {
      const runtimeStatuses: AgentRuntimeStatus[] = await tauriInvoke('get_agents_runtime_status');
      if (Array.isArray(runtimeStatuses)) {
        setAgents((prev) => {
          let hasChange = false;
          const next = prev.map((a) => {
            const match = runtimeStatuses.find((s) => s.agent_id === a.id);
            if (match && match.is_alive) {
              const targetStatus = match.status === 'idle' ? 'idle' : (match.status as any);
              const targetDetail = match.status_detail || undefined;
              if (a.status !== targetStatus || a.statusDetail !== targetDetail) {
                hasChange = true;
                return {
                  ...a,
                  status: targetStatus,
                  statusDetail: targetDetail,
                };
              }
              return a;
            } else {
              // If not in active backend pool, revert to idle if not currently starting
              if (a.status !== 'idle' && a.status !== 'starting') {
                hasChange = true;
                return { ...a, status: 'idle', statusDetail: undefined };
              }
              return a;
            }
          });
          return hasChange ? next : prev;
        });
        return;
      }
    } catch {
      // Fallback to legacy get_running_agent_ids
      try {
        const runningIds: string[] = await tauriInvoke('get_running_agent_ids');
        if (Array.isArray(runningIds)) {
          setAgents((prev) => {
            let hasChange = false;
            const next = prev.map((a) => {
              const isAlive = runningIds.includes(a.id);
              if (isAlive) {
                if (a.status === 'idle') {
                  hasChange = true;
                  return { ...a, status: 'running' as const };
                }
                return a;
              } else {
                if (a.status === 'running') {
                  hasChange = true;
                  return { ...a, status: 'idle' as const };
                }
                return a;
              }
            });
            return hasChange ? next : prev;
          });
        }
      } catch (err) {
        console.warn('[Sync ACP] Failed to query running agents:', err);
      }
    }
  }, []);

  // Listen for real-time ACP status changes from Tauri backend
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tauriListen =
      (window as any).__TAURI__?.event?.listen ||
      (window as any).__TAURI_INTERNALS__?.listen;
    if (!tauriListen) return;

    let unlisten: (() => void) | undefined;
    tauriListen('acp:status_change', (event: any) => {
      const payload = event?.payload;
      if (payload && payload.agent_id) {
        if (payload.status === 'stopped') {
          // Agent 停止或重启后，清空该 Agent 在各房间的交付缓存，确保新拉起后重新注入 session/new
          deliveredStandingContextRef.current.forEach((key) => {
            if (key.endsWith(`:${payload.agent_id}`)) {
              deliveredStandingContextRef.current.delete(key);
            }
          });
        }
        setAgents((prev) =>
          prev.map((a) => {
            if (a.id === payload.agent_id) {
              const newStatus = payload.status === 'stopped' ? 'idle' : payload.status;
              return {
                ...a,
                status: newStatus,
                statusDetail: payload.status_detail || undefined,
              };
            }
            return a;
          })
        );
      }
    }).then((fn: any) => {
      unlisten = fn;
    }).catch(() => {});

    let unlistenHeartbeat: (() => void) | undefined;
    tauriListen('acp:thinking_heartbeat', (event: any) => {
      const payload = event?.payload;
      if (payload && payload.agent_id) {
        const elapsed = payload.elapsed_seconds || 0;
        const hint =
          elapsed > 60
            ? `大模型正在深度推理，请耐心稍候 (${elapsed}s)...`
            : elapsed > 25
            ? `正在深入分析上下文与技术边界 (${elapsed}s)...`
            : `正在分析推演中 (${elapsed}s)...`;

        setActiveExecutions((prev) => {
          let updated = false;
          const next = { ...prev };
          for (const key in next) {
            if (next[key].agentId === payload.agent_id && next[key].status === 'thinking') {
              next[key] = {
                ...next[key],
                currentActionDetail: hint,
              };
              updated = true;
            }
          }
          return updated ? next : prev;
        });

        // 同步更新议题流中处于推演态 (isPending) 卡片的提示信息
        setMessages((prev) => {
          let updated = false;
          const next = { ...prev };
          for (const threadId in next) {
            const list = next[threadId];
            if (!list || list.length === 0) continue;
            const pendingIdx = list.findIndex(
              (m) => m.authorId === payload.agent_id && m.isPending
            );
            if (pendingIdx !== -1 && list[pendingIdx].pendingHint !== hint) {
              const updatedList = [...list];
              updatedList[pendingIdx] = {
                ...list[pendingIdx],
                pendingHint: hint,
              };
              next[threadId] = updatedList;
              updated = true;
            }
          }
          return updated ? next : prev;
        });
      }
    }).then((fn: any) => {
      unlistenHeartbeat = fn;
    }).catch(() => {});

    // 实时监听 Agent 流式 chunk 吐字，就地注入 isPending 占位卡
    let unlistenChunk: (() => void) | undefined;
    tauriListen('acp:chunk', (event: any) => {
      const payload = event?.payload;
      if (payload && payload.agent_id && payload.chunk) {
        const agentId = payload.agent_id;
        const chunkText = payload.chunk;

        setMessages((prev) => {
          let updated = false;
          const next = { ...prev };
          for (const threadId in next) {
            const list = next[threadId];
            if (!list || list.length === 0) continue;
            const pendingIdx = list.findIndex(
              (m) => m.authorId === agentId && m.isPending
            );
            if (pendingIdx !== -1) {
              const target = list[pendingIdx];
              const updatedList = [...list];
              updatedList[pendingIdx] = {
                ...target,
                content: (target.content || '') + chunkText,
              };
              next[threadId] = updatedList;
              updated = true;
            }
          }
          return updated ? next : prev;
        });
      }
    }).then((fn: any) => {
      unlistenChunk = fn;
    }).catch(() => {});

    return () => {
      if (unlisten) unlisten();
      if (unlistenHeartbeat) unlistenHeartbeat();
      if (unlistenChunk) unlistenChunk();
    };
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
        title: `${targetChan?.name || '研讨频道'} 启动与目标同步`,
        authorId: currentUserId,
        authorName: 'Norris_M5Pro',
        authorAvatar: '👨‍💻',
        authorHandle: '@Norris_M5Pro',
        timestamp: 'Just now',
        preview: `欢迎进入 #${targetChan?.name || '频道'}。类别：[${targetChan?.kind || 'feature'}]。`,
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
            content: `欢迎来到 **#${targetChan?.name || '频道'}**！\n- **类型**：\`[${targetChan?.kind || 'feature'}]\`\n- **说明**：${targetChan?.description || '自由推演与协作研讨'}\n请在下方输入框中发送消息或 @ 目标成员开始推演。`,
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
    const updatedAgentIds = updatedMemberIds.filter((id) => agents.some((a) => a.id === id));
    setChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? {
              ...c,
              memberIds: updatedMemberIds,
              assignedAgentIds: updatedAgentIds,
            }
          : c
      )
    );
    // 同步更新该频道下各个 Thread 的 activeAgentIds 列表
    setThreads((prev) =>
      prev.map((t) =>
        t.channelId === channelId
          ? { ...t, activeAgentIds: updatedAgentIds }
          : t
      )
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

  // External Memory Cartridge & Guest Alter-Ego Handlers (Non-Invasive Import)
  const handleToggleCartridge = (agentId: string, cartridgeId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== agentId) return a;
        const cartridges = (a.memory?.cartridges || []).map((c) =>
          c.id === cartridgeId ? { ...c, isEnabled: !c.isEnabled } : c
        );
        return {
          ...a,
          memory: {
            ...a.memory,
            cartridges,
          },
        };
      })
    );
  };

  const handleEjectCartridge = (agentId: string, cartridgeId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== agentId) return a;
        const cartridges = (a.memory?.cartridges || []).filter((c) => c.id !== cartridgeId);
        return {
          ...a,
          memory: {
            ...a.memory,
            cartridges,
          },
        };
      })
    );
  };

  const handleMountCartridge = (targetAgentId: string, cartridge: MemoryCartridge) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== targetAgentId) return a;
        const existing = a.memory?.cartridges || [];
        const filtered = existing.filter((c) => c.id !== cartridge.id);
        return {
          ...a,
          memory: {
            ...a.memory,
            cartridges: [...filtered, cartridge],
          },
        };
      })
    );
  };

  const handleCloneGuestAgent = (guestAgent: Partial<Agent>) => {
    const fullAgent: Agent = {
      id: `guest-${Date.now()}`,
      name: guestAgent.name || 'Guest Agent',
      handle: guestAgent.handle || `@guest_${Date.now().toString().slice(-4)}`,
      avatar: guestAgent.avatar || '🪪',
      role: guestAgent.role || 'Guest Alter-Ego',
      description: guestAgent.description || 'Imported Guest Alter-Ego Agent',
      color: '#10b981',
      status: 'idle',
      modelBadge: guestAgent.modelBadge || DEFAULT_MODEL_NAME,
      isManagedByYou: true,
      isGuestClone: true,
      guestCloneFrom: guestAgent.guestCloneFrom,
      acpTransport: guestAgent.acpTransport || 'stdio',
      acpCommandOrUrl: guestAgent.acpCommandOrUrl || './target/debug/shinobi-agent',
      protocolVersion: '2025-01-01 (ACP v1.0.4)',
      capabilities: guestAgent.capabilities || {
        canUseInternalMemory: true,
        canAccessWorkspaceFiles: true,
        canExecuteSkills: true,
        canDelegateToSubAgents: true,
        supportsStreaming: true,
      },
      workspace: guestAgent.workspace || {
        rootPath: activeProject?.localWorkspaceRoot || '.',
        repoName: 'shadow-crew',
        gitBranch: 'main',
        permissionMode: 'full_read_write',
        activeFiles: ['crates/shinobi-agent/src/main.rs'],
      },
      envVars: guestAgent.envVars || [],
      skills: [],
      memory: guestAgent.memory || {
        internalMemoryPath: `~/.local/share/shinobi/guest_${Date.now()}_memory.sqlite`,
        persistentType: 'sqlite',
        persistentItems: [],
        sessionCacheCount: 0,
      },
    };
    setAgents((prev) => [...prev, fullAgent]);
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
    discussionMode?: DiscussionMode;
    gameRoles?: GameRolesConfig;
  }) => {
    if (!activeChannel) return; // 私聊模式下不创建频道议题
    const topicId = `topic-${Date.now()}`;
    const validAssignedAgentIds = topicData.assignedAgentIds.filter((id) =>
      currentChannelAgents.some((a) => a.id === id)
    );
    const isGame = topicData.discussionMode === 'game_theoretic';
    const newTopic: TopicMessageData = {
      id: topicId,
      channelId: activeChannel.id,
      title: topicData.title,
      description: topicData.description,
      status: 'open',
      discussionMode: topicData.discussionMode || 'standard',
      gameRoles: topicData.gameRoles,
      gameStage: isGame ? 'proposal' : undefined,
      gameTheoreticState: isGame
        ? {
            currentStage: 'proposal',
            isChallengerResponded: false,
          }
        : undefined,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorAvatar: '👨‍💻',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      repliesCount: 0,
      participatingAgentIds: validAssignedAgentIds,
    };

    // 确保将议题卡片插入属于当前频道的专属线程中，绝不渗入 DM 线程
    const targetChannelThread = threads.find((t) => t.channelId === activeChannel.id && t.type !== 'dm') || activeThread;
    if (!targetChannelThread) return;

    const topicCardMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: targetChannelThread.id,
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

    const initContent = isGame && topicData.gameRoles
      ? `已发起博弈讨论议题【${topicData.title}】。\n目标背景：${topicData.description || '开始三元博弈论证。'}\n【三元博弈配置】：\n- 🏛️ 主导者：${topicData.gameRoles.proposers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- ⚔️ 挑战者：${topicData.gameRoles.challengers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- ⚖️ 仲裁者：${topicData.gameRoles.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌) · ' : ''}${topicData.gameRoles.arbiters.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || (topicData.gameRoles.humanIsArbiter ? '' : '未指定')}`
      : `已发起议题【${topicData.title}】。\n目标背景：${topicData.description || '开始方案推演。'}\n指派 Agent：${validAssignedAgentIds.length > 0 ? validAssignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、') : '暂无 (可在抽屉中指派)'}。`;

    setMessages((prev) => ({
      ...prev,
      [targetChannelThread.id]: [...(prev[targetChannelThread.id] || []), topicCardMsg],
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
          content: initContent,
        },
      ],
    }));

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
    }
  ) => {
    // 过滤出该议题频道内合法的 Agent ID，避免越界
    const validAssignedAgentIds = updatedData.assignedAgentIds.filter((id) =>
      editingTopicAgents.some((a) => a.id === id)
    );

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
            discussionMode: updatedData.discussionMode ?? oldTopic.discussionMode,
            gameRoles: updatedData.gameRoles !== undefined ? updatedData.gameRoles : oldTopic.gameRoles,
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

    setEditingTopic(null);
  };

  // 多智能体跨 Agent 互相 @ 与自主级联调度器 (Cascading Agent Mention Dispatcher)
  const dispatchCascadingAgentResponse = async (options: {
    cascadeId: string;
    invokingAgent: Agent;
    replyContent: string;
    roomId: string;
    isTopic: boolean;
    topicId?: string;
    queuedCollaborators?: Agent[];
  }) => {
    const { cascadeId, invokingAgent, replyContent, roomId, isTopic, topicId, queuedCollaborators = [] } = options;
    const cascade = activeCascadesRef.current[cascadeId];
    if (!cascade || cascade.isAborted) return;

    // 获取当前频道/议题准入的候选 Agent 列表 (严格限制在当前频道或议题范围内)
    const currentChannelAgentIds = Array.from(
      new Set([
        ...(activeChannel?.assignedAgentIds || []),
        ...(activeChannel?.memberIds || []),
        ...(activeThread?.activeAgentIds || []),
      ])
    );
    const channelAgents = currentChannelAgentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    
    const topicAgents = (isTopic && topicId)
      ? ((activeTopicData?.participatingAgentIds || [])
          .map((id) => agents.find((a) => a.id === id))
          .filter((a): a is Agent => Boolean(a))
          .filter((a) => channelAgents.some((ca) => ca.id === a.id)))
      : [];

    const candidateAgents = topicAgents.length > 0
      ? topicAgents
      : (activeThread.type === 'dm'
          ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
          : channelAgents);

    const topicTargetChannel = isTopic
      ? (channels.find((c) => c.id === activeTopicData?.channelId) || activeChannel)
      : activeChannel;
    const targetChannelId = isTopic
      ? (topicTargetChannel?.id || activeChannel?.id)
      : (activeThread?.type === 'dm' ? 'direct-messages' : activeChannel?.id);

    // 1. 严格仅从当前频道准入的候选成员中解析显式 @ 的目标 (绝不越界回退全工作区)
    let targetAgents = parseAgentMentions(replyContent, candidateAgents, invokingAgent.id);

    // 检查是否存在对未受邀外部 Agent 的越界 @ 点名
    if (activeThread.type !== 'dm') {
      const lowerReply = replyContent.toLowerCase();
      const isReplyAll = lowerReply.includes('@all') || lowerReply.includes('@所有人') || lowerReply.includes('@team');
      const uninvitedMentions = isReplyAll
        ? []
        : parseAgentMentions(replyContent, agents, invokingAgent.id)
            .filter((a) => !candidateAgents.some((ca) => ca.id === a.id));
      if (uninvitedMentions.length > 0) {
        const guardNotice: Message = {
          id: `channel-guard-${Date.now()}`,
          threadId: roomId,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shadow Crew 频道隔离守护',
          authorHandle: '@channel-guard',
          authorAvatar: '🔒',
          isAgent: true,
          agentBadge: 'Channel Guard',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔒 **频道准入拦截**：${invokingAgent.name} 尝试点名了 ${uninvitedMentions.map((a) => `@${a.name} (${a.handle})`).join('、')}，但该 Agent **未加入当前频道**。\n\n根据受邀准入原则，未受邀成员无法跨频道接收协同调度。如需其参与推演，请点击右上角「成员管理」邀请入驻。`,
        };
        setMessages((prev) => {
          const targetList = prev[roomId] || [];
          return {
            ...prev,
            [roomId]: [...targetList, guardNotice],
          };
        });
      }
    }

    // 2. 若正文中未显式 @，但存在用户最初批量 @ 进来的排队协作者
    let remainingQueued: Agent[] = [];
    let isQueuedByUserInput = false;
    if (targetAgents.length === 0 && queuedCollaborators.length > 0) {
      targetAgents = [queuedCollaborators[0]];
      remainingQueued = queuedCollaborators.slice(1);
      isQueuedByUserInput = true;
    }

    if (targetAgents.length === 0) {
      // 协同链自然收敛结束
      setActiveCascades((prev) => {
        const next = { ...prev };
        delete next[cascadeId];
        return next;
      });
      return;
    }

    const targetAgent = targetAgents[0];

    // 严格检查通信状态：若未手动点击 Start 开启通信，则进行拦截并引导，尝试继续唤醒后续已连接的协作者
    if (targetAgent.status === 'idle') {
      const offlineNotice: Message = {
        id: `msg-offline-collab-${Date.now()}`,
        threadId: roomId,
        channelId: targetChannelId,
        authorId: 'system',
        authorName: 'Shadow Crew 通信管控',
        authorHandle: '@connection-guard',
        authorAvatar: '🔌',
        isAgent: true,
        agentBadge: 'Communication Required',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `🔌 **Agent 通信尚未开启**：协同目标 **${targetAgent.name}** 当前处于离线/未连接状态，无法接力推演。需先在左侧控制面板点击【Start】开启通信。`,
      };
      setMessages((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), offlineNotice],
      }));

      if (remainingQueued.length > 0) {
        dispatchCascadingAgentResponse({
          cascadeId,
          invokingAgent,
          replyContent,
          roomId,
          isTopic,
          topicId,
          queuedCollaborators: remainingQueued,
        });
      } else {
        setActiveCascades((prev) => {
          const next = { ...prev };
          delete next[cascadeId];
          return next;
        });
      }
      return;
    }

    const loopCheck = checkLoopGuard(cascade, targetAgent.id);

    if (!loopCheck.allowed) {
      console.log(`[CollaborationCascade] Cascade ${cascadeId} terminated:`, loopCheck.reason);

      // 对标 Buzz 静默收敛哲学：
      // 常规轮次自然收敛兜底时，静默终止并清理级联状态，严禁向消息流注入打断人类思路的生硬熔断卡片。
      // 仅在非静默场景（如人工显式终止）时才输出系统提示。
      if (!loopCheck.isSilentEnd) {
        const breakMsg: Message = {
          id: `circuit-break-${Date.now()}`,
          threadId: roomId,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shadow Crew 协同管控',
          authorHandle: '@loop-guard',
          authorAvatar: '🛡️',
          isAgent: true,
          agentBadge: 'Circuit Breaker',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚡ **多智能体协同已停止**：${loopCheck.reason}`,
          collaborationInfo: {
            cascadeId,
            hop: cascade.depth,
            maxHops: cascade.maxDepth,
            isCircuitBroken: true,
            circuitBreakReason: loopCheck.reason,
          },
        };

        setMessages((prev) => {
          const targetList = prev[roomId] || [];
          return {
            ...prev,
            [roomId]: [...targetList, breakMsg],
          };
        });
      }

      setActiveCascades((prev) => {
        const next = { ...prev };
        delete next[cascadeId];
        return next;
      });
      return;
    }

    // 更新 Cascade 状态
    const nextDepth = cascade.depth + 1;
    const updatedCascade: CollaborationCascade = {
      ...cascade,
      depth: nextDepth,
      visitedAgentIds: [...cascade.visitedAgentIds, targetAgent.id],
      agentCallCounts: {
        ...cascade.agentCallCounts,
        [targetAgent.id]: (cascade.agentCallCounts[targetAgent.id] || 0) + 1,
      },
    };

    setActiveCascades((prev) => ({
      ...prev,
      [cascadeId]: updatedCascade,
    }));

    const topicContext: TopicPromptContext | undefined = isTopic && activeTopicData
      ? {
          topicId: activeTopicData.id,
          title: activeTopicData.title,
          description: activeTopicData.description,
          channelName: topicTargetChannel?.name || 'chat',
          status: activeTopicData.status,
          discussionMode: activeTopicData.discussionMode,
          gameRoles: activeTopicData.gameRoles,
          participatingAgents: candidateAgents,
        }
      : undefined;

    // 构造具有前序方案与明确协作诉求的上下文提示词 (严格使用当前频道的候选成员花名册)
    const cascadePrompt = buildCascadePrompt({
      targetAgent,
      invokingAgent,
      originalUserPrompt: cascade.originalPrompt,
      invokingAgentReply: replyContent,
      cascade: updatedCascade,
      availableAgents: candidateAgents,
      topic: topicContext,
      isQueuedByUserInput,
    });

    const execKey = isTopic && topicId ? `${topicId}:${targetAgent.id}` : `${roomId}:${targetAgent.id}`;
    setIsGenerating(true);
    setActiveExecutions((prev) => ({
      ...prev,
      [execKey]: {
        agentId: targetAgent.id,
        agentName: targetAgent.name,
        agentAvatar: targetAgent.avatar,
        threadId: roomId,
        topicId: isTopic ? topicId : undefined,
        status: 'thinking',
        currentActionDetail: isQueuedByUserInput
          ? `正在基于议题陈述独立观点 (Hop ${nextDepth}/${cascade.maxDepth})...`
          : `正在响应 @${invokingAgent.name} 的协同研讨 (Hop ${nextDepth}/${cascade.maxDepth})...`,
        startedAt: Date.now(),
        cascadeHop: nextDepth,
        invokingAgentName: invokingAgent.name,
      },
    }));

    // 维持 Agent 在线基线状态 ('running')，具体推演任务由 activeExecutions 独立追踪，杜绝状态跨会话污染
    setAgents((prev) => prev.map((a) => (a.id === targetAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a)));

    const sessionKey = `${roomId}:${targetAgent.id}`;
    const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);
    const standingContext = !isStandingContextDelivered
      ? buildCrewRosterGuidance(candidateAgents, targetAgent.id)
      : undefined;
    deliveredStandingContextRef.current.add(sessionKey);

    try {
      const acpResp = await sendPromptToAcpAgent({
        agent: targetAgent,
        roomId,
        prompt: cascadePrompt,
        projectId: activeProjectId,
        channelId: targetChannelId,
        systemPrompt: standingContext,
      });

      setActiveExecutions((prev) => {
        const next = { ...prev };
        delete next[execKey];
        if (Object.keys(next).length === 0) setIsGenerating(false);
        return next;
      });

      const nextReply: Message = {
        id: `msg-collab-${Date.now()}-${targetAgent.id}`,
        threadId: roomId,
        channelId: targetChannelId,
        authorId: targetAgent.id,
        authorName: targetAgent.name,
        authorHandle: targetAgent.handle,
        authorAvatar: targetAgent.avatar,
        isAgent: true,
        agentBadge: `${targetAgent.modelBadge?.split(' ')[0] || 'Local'} · 协同响应 (Hop ${nextDepth})`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: acpResp.textResponse,
        thinkingProcess:
          acpResp.memoryActions && acpResp.memoryActions.length > 0
            ? {
                duration: `${acpResp.durationMs}ms`,
                tokens: Math.round(acpResp.textResponse.length * 1.3),
                summary: `已基于协同上下文完成审查与规约对齐`,
                detail: acpResp.memoryActions
                  .map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`)
                  .join('\n'),
              }
            : undefined,
        diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
        cartridgeCitation: acpResp.cartridgeCitation,
        collaborationInfo: {
          cascadeId,
          hop: nextDepth,
          maxHops: cascade.maxDepth,
          invokedByAgentId: invokingAgent.id,
          invokedByAgentName: invokingAgent.name,
          invokedByAgentHandle: invokingAgent.handle,
        },
      };

      if (isTopic && topicId) {
        setMessages((prev) => {
          const nextTopicMsgs = [...(prev[topicId] || []), nextReply];
          
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
            if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
              parentThreadId = tId;
              break;
            }
          }

          const updatedParentMsgs = parentThreadId
            ? (prev[parentThreadId] || []).map((m) => {
                if (m.type === 'topic' && m.topicData?.id === topicId) {
                  return {
                    ...m,
                    topicData: {
                      ...m.topicData,
                      repliesCount: nextTopicMsgs.length,
                      latestReplyPreview: nextReply.content.slice(0, 60),
                    },
                  };
                }
                return m;
              })
            : [];

          return {
            ...prev,
            [topicId]: nextTopicMsgs,
            ...(parentThreadId ? { [parentThreadId]: updatedParentMsgs } : {}),
          };
        });
      } else {
        setMessages((prev) => ({
          ...prev,
          [roomId]: [...(prev[roomId] || []), nextReply],
        }));
      }

      setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'running' } : a)));
      syncRunningAgentsWithBackend();

      // 递归触发下一跳（同时继续携带可能剩余的未响应协作者）
      dispatchCascadingAgentResponse({
        cascadeId,
        invokingAgent: targetAgent,
        replyContent: acpResp.textResponse,
        roomId,
        isTopic,
        topicId,
        queuedCollaborators: remainingQueued,
      });
    } catch (err) {
      setActiveExecutions((prev) => {
        const next = { ...prev };
        delete next[execKey];
        if (Object.keys(next).length === 0) setIsGenerating(false);
        return next;
      });

      console.error('Cascading agent dispatch failed:', err);
      const errorReply: Message = {
        id: `msg-collab-err-${Date.now()}`,
        threadId: roomId,
        channelId: targetChannelId,
        authorId: targetAgent.id,
        authorName: targetAgent.name,
        authorHandle: targetAgent.handle,
        authorAvatar: targetAgent.avatar,
        isAgent: true,
        agentBadge: 'ACP Error',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `⚠️ **协同接力异常**：${err instanceof Error ? err.message : String(err)}`,
      };
      setMessages((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), errorReply],
      }));
    }
  };

  const getTopicData = (topicId: string): TopicMessageData | null => {
    for (const msgList of Object.values(messagesRef.current) as Message[][]) {
      for (const m of msgList) {
        if (m.type === 'topic' && m.topicData?.id === topicId) {
          return m.topicData;
        }
      }
    }
    return null;
  };

  const updateTopicDataInState = (topicId: string, updater: (oldTopic: TopicMessageData) => TopicMessageData) => {
    setMessages((prev) => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
        if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
          parentThreadId = tId;
          break;
        }
      }
      if (!parentThreadId) return prev;
      return {
        ...prev,
        [parentThreadId]: (prev[parentThreadId] || []).map((m) => {
          if (m.type === 'topic' && m.topicData?.id === topicId) {
            return {
              ...m,
              topicData: updater(m.topicData),
            };
          }
          return m;
        }),
      };
    });
  };

  const triggerGameTheoreticStageHandover = async (options: {
    topicId: string;
    nextStage: 'challenge' | 'arbitration';
    targetProposalText?: string;
    targetChallengeText?: string;
  }) => {
    const { topicId, nextStage, targetProposalText, targetChallengeText } = options;
    const currentTopic = getTopicData(topicId);
    if (!currentTopic || currentTopic.status === 'resolved') return;

    const handoverKey = `${topicId}:${nextStage}`;
    if (inFlightHandoverRef.current.has(handoverKey)) {
      console.warn(`[GameTheoretic] Handover for ${handoverKey} is already in-flight, skipping duplicate trigger.`);
      return;
    }
    inFlightHandoverRef.current.add(handoverKey);

    const topicChannel = channels.find((c) => c.id === currentTopic.channelId) || activeChannel;
    const channelAgents = (topicChannel?.assignedAgentIds || [])
      .map((id) => agentsRef.current.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    const topicAgents = (currentTopic.participatingAgentIds || [])
      .map((id) => agentsRef.current.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    const candidateAgents = topicAgents.length > 0 ? topicAgents : channelAgents;

    if (nextStage === 'challenge') {
      const challengerIds = currentTopic.gameRoles?.challengers || [];
      const challengerAgent = candidateAgents.find((a) => challengerIds.includes(a.id));

      if (!challengerAgent) {
        inFlightHandoverRef.current.delete(handoverKey);
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: '当前议题未指定或未找到可用的挑战者 (Challenger)。法定推演缺席 (Quorum Not Met)。',
          },
        }));

        const quorumNotice: Message = {
          id: `msg-quorum-alert-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@quorum-guard',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Quorum Alert',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **法定推演人数告警 (Quorum Alert)**：未指派或未匹配到制衡方 (Challenger)，法定对抗缺席。\n\n根据三元博弈规约，若无挑战者反例压测，人类首席仲裁官在终局定案时必须执行【具名豁免制衡方缺席 (Exemption)】方可敲响法槌。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), quorumNotice],
        }));
        return;
      }

      if (challengerAgent.status === 'idle') {
        inFlightHandoverRef.current.delete(handoverKey);
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: `挑战者 ${challengerAgent.name} 处于离线/未连接状态。`,
          },
        }));

        const offlineNotice: Message = {
          id: `msg-offline-challenger-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@connection-guard',
          authorAvatar: '🔌',
          isAgent: true,
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **制衡方通信尚未开启**：挑战者 **${challengerAgent.name}** 处于离线/未连接状态，无法接力反例压测。\n\n如需其完成对抗，请先在左侧面板点击【Start】开启 ACP 通信；或由人类首席仲裁官执行具名豁免后直接落槌。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), offlineNotice],
        }));
        return;
      }

      const execKey = `${topicId}:${challengerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: challengerAgent.id,
          agentName: challengerAgent.name,
          agentAvatar: challengerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...`,
          startedAt: Date.now(),
          cascadeHop: 2,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === challengerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const challengerPendingId = `topic-pending-${Date.now()}-${challengerAgent.id}`;
      const challengerPendingMsg: Message = {
        id: challengerPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: challengerAgent.id,
        authorName: challengerAgent.name,
        authorHandle: challengerAgent.handle,
        authorAvatar: challengerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在检索私有记忆并对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...',
        agentBadge: `${challengerAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚔️ 反例压测 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'challenge',
        gameRole: 'challenger',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), challengerPendingMsg],
      }));

      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'challenge',
        targetProposalText,
        participatingAgents: candidateAgents,
      };

      const challengePrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: targetProposalText || currentTopic.description || currentTopic.title,
        targetAgent: challengerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: challengerAgent,
          roomId: topicId,
          prompt: challengePrompt,
          projectId: activeProjectId,
          channelId: topicChannel?.id,
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '制衡方返回空响应，未生成有效反例压测。');
        }

        const challengerReply: Message = {
          id: `topic-reply-${Date.now()}-${challengerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: challengerAgent.id,
          authorName: challengerAgent.name,
          authorHandle: challengerAgent.handle,
          authorAvatar: challengerAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${challengerAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚔️ 反例压测`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'challenge',
          gameRole: 'challenger',
          thinkingProcess: acpResp.memoryActions && acpResp.memoryActions.length > 0 ? {
            duration: `${acpResp.durationMs}ms`,
            tokens: Math.round(acpResp.textResponse.length * 1.3),
            summary: `已完成反例边界与架构证伪推演`,
            detail: acpResp.memoryActions.map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`).join('\n'),
          } : undefined,
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === challengerPendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === challengerPendingId ? challengerReply : m))
            : [...existing, challengerReply];
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
            if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
              parentThreadId = tId;
              break;
            }
          }
          const updatedChannelMsgs = parentThreadId
            ? (prev[parentThreadId] || []).map((m) => {
                if (m.type === 'topic' && m.topicData?.id === topicId) {
                  return {
                    ...m,
                    topicData: {
                      ...m.topicData,
                      repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                      latestReplyPreview: challengerReply.content.slice(0, 60),
                    },
                  };
                }
                return m;
              })
            : [];
          return {
            ...prev,
            [topicId]: nextTopicMsgs,
            ...(parentThreadId ? { [parentThreadId]: updatedChannelMsgs } : {}),
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            targetChallengeContent: acpResp.textResponse,
            isChallengerResponded: true,
            quorumAlert: undefined,
          },
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'arbitration',
          targetProposalText,
          targetChallengeText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        console.error('Challenger execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${challengerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: challengerAgent.id,
          authorName: challengerAgent.name,
          authorHandle: challengerAgent.handle,
          authorAvatar: challengerAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **制衡方压测异常**：${err instanceof Error ? err.message : String(err)}`,
          gameStage: 'challenge',
          gameRole: 'challenger',
        };

        const quorumNotice: Message = {
          id: `msg-quorum-alert-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@quorum-guard',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Quorum Alert',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **法定推演人数告警 (Quorum Alert)**：制衡方 ${challengerAgent.name} 发生异常未能完成反例压测。法定推演人数未达标 (Quorum Not Met)。\n\n根据三元博弈规约，进入仲裁定案前须由人类首席仲裁官签署「具名豁免」方可落槌定案。`,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== challengerPendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg, quorumNotice],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: `制衡方 (${challengerAgent.name}) 反例压测异常：${err instanceof Error ? err.message : String(err)}`,
          },
        }));
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'arbitration') {
      const arbiterIds = currentTopic.gameRoles?.arbiters || [];
      const arbiterAgent = candidateAgents.find((a) => arbiterIds.includes(a.id));

      if (!arbiterAgent || arbiterAgent.status === 'idle') {
        inFlightHandoverRef.current.delete(handoverKey);
      }

      if (arbiterAgent && arbiterAgent.status !== 'idle') {
        const execKey = `${topicId}:${arbiterAgent.id}`;
        setIsGenerating(true);
        setActiveExecutions((prev) => ({
          ...prev,
          [execKey]: {
            agentId: arbiterAgent.id,
            agentName: arbiterAgent.name,
            agentAvatar: arbiterAgent.avatar,
            threadId: topicId,
            topicId,
            status: 'thinking',
            currentActionDetail: `正在权衡方案与反例要点并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...`,
            startedAt: Date.now(),
            cascadeHop: 3,
          },
        }));

        setAgents((prev) =>
          prev.map((a) => (a.id === arbiterAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
        );

        const arbiterPendingId = `topic-pending-${Date.now()}-${arbiterAgent.id}`;
        const arbiterPendingMsg: Message = {
          id: arbiterPendingId,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: arbiterAgent.id,
          authorName: arbiterAgent.name,
          authorHandle: arbiterAgent.handle,
          authorAvatar: arbiterAgent.avatar,
          isAgent: true,
          isPending: true,
          startedAt: Date.now(),
          pendingHint: '正在权衡立论方案与反例要点，起草仲裁建议 (Stage: ⚖️ 仲裁定案)...',
          agentBadge: `${arbiterAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚖️ 仲裁建言 (审议中...)`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: '',
          gameStage: 'arbitration',
          gameRole: 'arbiter',
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), arbiterPendingMsg],
        }));

        const topicContext: TopicPromptContext = {
          topicId,
          title: currentTopic.title,
          description: currentTopic.description,
          channelName: topicChannel?.name || 'chat',
          status: currentTopic.status,
          discussionMode: 'game_theoretic',
          gameRoles: currentTopic.gameRoles,
          gameStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          participatingAgents: candidateAgents,
        };

        const arbiterPrompt = buildTopicPrompt({
          topic: topicContext,
          userContent: `主导方案与反例压测已就绪，请给出客观中立的仲裁权衡矩阵与裁决建言。`,
          targetAgent: arbiterAgent,
          availableAgents: candidateAgents,
        });

        try {
          const acpResp = await sendPromptToAcpAgent({
            agent: arbiterAgent,
            roomId: topicId,
            prompt: arbiterPrompt,
            projectId: activeProjectId,
            channelId: topicChannel?.id,
          });

          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
            throw new Error(acpResp.isError ? acpResp.textResponse : '仲裁者返回空响应，未生成有效仲裁建言。');
          }

          const arbiterReply: Message = {
            id: `topic-reply-${Date.now()}-${arbiterAgent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: arbiterAgent.id,
            authorName: arbiterAgent.name,
            authorHandle: arbiterAgent.handle,
            authorAvatar: arbiterAgent.avatar,
            isAgent: true,
            isPending: false,
            agentBadge: `${arbiterAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚖️ 仲裁建言`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            gameStage: 'arbitration',
            gameRole: 'arbiter',
            thinkingProcess: acpResp.memoryActions && acpResp.memoryActions.length > 0 ? {
              duration: `${acpResp.durationMs}ms`,
              tokens: Math.round(acpResp.textResponse.length * 1.3),
              summary: `已完成立论与反例要点仲裁审查`,
              detail: acpResp.memoryActions.map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`).join('\n'),
            } : undefined,
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
          };

          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: 'Gavel Ready',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚖️ **AI 仲裁建言已生成**：立论与制衡反例要点已完成裁决审查。请人类首席仲裁官查阅双方交锋要点，在下方【仲裁法槌控制台】选择【采纳主导】、【采纳挑战】或【权衡矩阵】敲响法槌定案。`,
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const hasPending = existing.some((m) => m.id === arbiterPendingId);
            const baseMsgs = hasPending
              ? existing.map((m) => (m.id === arbiterPendingId ? arbiterReply : m))
              : [...existing, arbiterReply];
            const nextTopicMsgs = [...baseMsgs, humanNotice];
            let parentThreadId: string | null = null;
            for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
              if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                parentThreadId = tId;
                break;
              }
            }
            const updatedChannelMsgs = parentThreadId
              ? (prev[parentThreadId] || []).map((m) => {
                  if (m.type === 'topic' && m.topicData?.id === topicId) {
                    return {
                      ...m,
                      topicData: {
                        ...m.topicData,
                        repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                        latestReplyPreview: arbiterReply.content.slice(0, 60),
                      },
                    };
                  }
                  return m;
                })
              : [];
            return {
              ...prev,
              [topicId]: nextTopicMsgs,
              ...(parentThreadId ? { [parentThreadId]: updatedChannelMsgs } : {}),
            };
          });
        } catch (err) {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          console.error('AI Arbiter execution failed:', err);

          const errorMsg: Message = {
            id: `topic-reply-err-${Date.now()}-${arbiterAgent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: arbiterAgent.id,
            authorName: arbiterAgent.name,
            authorHandle: arbiterAgent.handle,
            authorAvatar: arbiterAgent.avatar,
            isAgent: true,
            agentBadge: 'Arbiter Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **仲裁推演异常**：${err instanceof Error ? err.message : String(err)}\n\n人类首席仲裁官可查看上方交锋内容，执行具名豁免后直接落槌。`,
            gameStage: 'arbitration',
            gameRole: 'arbiter',
          };

          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: 'Gavel Ready',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚖️ **仲裁阶段异常提示**：AI 仲裁推演中断。双方立论与反例要点已就绪，人类首席仲裁官可在下方【仲裁法槌控制台】敲响法槌签署终局裁决。`,
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const filtered = existing.filter((m) => m.id !== arbiterPendingId);
            return {
              ...prev,
              [topicId]: [...filtered, errorMsg, humanNotice],
            };
          });
        } finally {
          inFlightHandoverRef.current.delete(handoverKey);
        }
      } else {
        if (currentTopic.gameRoles?.humanIsArbiter) {
          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: 'Gavel Ready',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚖️ **博弈推演已进入仲裁裁决阶段**：立论方案与反例压测已就绪。请人类首席仲裁官在下方【仲裁法槌控制台】选择【采纳主导】、【采纳挑战】或【权衡矩阵】敲响法槌签署仲裁裁决书。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), humanNotice],
          }));
        }
      }
    }
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

      let parentThreadId: string | null = null;
      for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
        if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
          parentThreadId = tId;
          break;
        }
      }

      const updatedParentMsgs = parentThreadId
        ? (prev[parentThreadId] || []).map((m) => {
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
          })
        : [];

      return {
        ...prev,
        [topicId]: nextTopicMsgs,
        ...(parentThreadId ? { [parentThreadId]: updatedParentMsgs } : {}),
      };
    });

    const topicChannel = channels.find((c) => c.id === activeTopicData?.channelId) || activeChannel;
    const currentChannelAgentIds = Array.from(
      new Set([
        ...(topicChannel?.assignedAgentIds || []),
        ...(topicChannel?.memberIds || []),
      ])
    );
    let channelAssigned = currentChannelAgentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    let topicAssigned = (activeTopicData?.participatingAgentIds || [])
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a))
      .filter((a) => channelAssigned.some((ca) => ca.id === a.id));

    const lowerContent = content.toLowerCase();
    const isAllMention = lowerContent.includes('@all') || lowerContent.includes('@所有人') || lowerContent.includes('@team');

    let userMentionedAgents: Agent[] = [];

    if (isAllMention) {
      // 议题中 @all 严格限制在当前议题已参与的 Agent (或当前频道已准入的 Agent)，绝对不能越界拉取全工作区外部成员
      userMentionedAgents = topicAssigned.length > 0 ? topicAssigned : channelAssigned;
    } else {
      // 提取输入中的 @ 成员
      const allMentioned = parseAgentMentions(content, agents);
      const uninvitedMentions = allMentioned.filter(
        (a) => !channelAssigned.some((ca) => ca.id === a.id)
      );

      // 若在议题中点名了未加入当前频道的外部 Agent，进行硬拦截并出示频道准入守护提示
      if (uninvitedMentions.length > 0) {
        const guardNotice: Message = {
          id: `topic-guard-${Date.now()}`,
          threadId: topicId,
          channelId: activeTopicData?.channelId || activeChannel?.id,
          authorId: 'system',
          authorName: 'Shadow Crew 频道隔离守护',
          authorHandle: '@channel-guard',
          authorAvatar: '🔒',
          isAgent: true,
          agentBadge: 'Channel Guard',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔒 **频道准入拦截**：你尝试在议题中点名了 ${uninvitedMentions.map((a) => `@${a.name} (${a.handle})`).join('、')}，但该 Agent **未加入当前频道**。\n\n根据受邀准入原则，议题只能拉取属于频道内的 Agent 成员。如需其参与推演，请先在频道右上角「成员管理」邀请入驻。`,
        };
        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), guardNotice],
        }));
      }

      // 仅保留属于当前频道内的合法 @ 目标
      const validMentioned = allMentioned.filter((a) =>
        channelAssigned.some((ca) => ca.id === a.id)
      );

      if (validMentioned.length > 0 && activeTopicData) {
        const newlyInvitedToTopic = validMentioned.filter(
          (a) => !topicAssigned.some((ta) => ta.id === a.id)
        );
        if (newlyInvitedToTopic.length > 0) {
          const newIds = newlyInvitedToTopic.map((a) => a.id);
          const updatedParticipating = Array.from(
            new Set([...(activeTopicData.participatingAgentIds || []), ...newIds])
          );
          topicAssigned.push(...newlyInvitedToTopic);

          setMessages((prev) => {
            let parentThreadId: string | null = null;
            for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
              if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                parentThreadId = tId;
                break;
              }
            }
            if (!parentThreadId) return prev;
            const roomMsgs = prev[parentThreadId] || [];
            return {
              ...prev,
              [parentThreadId]: roomMsgs.map((m) =>
                m.topicData && m.topicData.id === topicId
                  ? { ...m, topicData: { ...m.topicData, participatingAgentIds: updatedParticipating } }
                  : m
              ),
            };
          });
        }
        userMentionedAgents = validMentioned;
      } else if (uninvitedMentions.length > 0) {
        // 用户仅点名了未准入外部成员且无其他合法目标，直接阻断，避免非预期误触发
        return;
      }
    }

    const isGameTheoretic = activeTopicData?.discussionMode === 'game_theoretic';
    const currentTopicStage: GameTheoreticStage = activeTopicData?.gameStage || activeTopicData?.gameTheoreticState?.currentStage || 'proposal';
    let executionStage: GameTheoreticStage = currentTopicStage;
    let targetRoleType: GameRoleType = 'proposer';

    const candidateAgents = topicAssigned.length > 0 ? topicAssigned : channelAssigned;
    let respondingAgents: Agent[] = [];

    if (isGameTheoretic) {
      if (userMentionedAgents.length > 0 && !isAllMention) {
        respondingAgents = userMentionedAgents;
        const id = userMentionedAgents[0].id;
        if (activeTopicData?.gameRoles?.proposers?.includes(id)) {
          targetRoleType = 'proposer';
          executionStage = 'proposal';
        } else if (activeTopicData?.gameRoles?.challengers?.includes(id)) {
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (activeTopicData?.gameRoles?.arbiters?.includes(id)) {
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        }
      } else {
        // 根据三元博弈当前所处阶段分配角色，绝不并发广播给全员
        if (currentTopicStage === 'proposal') {
          const proposerIds = activeTopicData?.gameRoles?.proposers || [];
          respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
          targetRoleType = 'proposer';
          executionStage = 'proposal';
        } else if (currentTopicStage === 'challenge') {
          const challengerIds = activeTopicData?.gameRoles?.challengers || [];
          respondingAgents = candidateAgents.filter((a) => challengerIds.includes(a.id));
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (currentTopicStage === 'arbitration') {
          const arbiterIds = activeTopicData?.gameRoles?.arbiters || [];
          respondingAgents = candidateAgents.filter((a) => arbiterIds.includes(a.id));
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        }
        if (respondingAgents.length === 0 && candidateAgents.length > 0) {
          respondingAgents = [candidateAgents[0]];
        }
      }
    } else {
      if (userMentionedAgents.length > 0) {
        respondingAgents = userMentionedAgents;
      } else if (candidateAgents.length > 0) {
        respondingAgents = [candidateAgents[0]];
      }
    }

    if (respondingAgents.length === 0) {
      return;
    }

    // 检查通信状态：分离离线与已连接的 Agent
    const offlineAgents = respondingAgents.filter((a) => a.status === 'idle');
    const onlineAgents = respondingAgents.filter((a) => a.status !== 'idle');

    if (offlineAgents.length > 0) {
      setTimeout(() => {
        const offlineNotice: Message = {
          id: `msg-offline-topic-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: isGameTheoretic ? 'Shinobi 博弈协同管控' : 'Shadow Crew 通信管控',
          authorHandle: '@connection-guard',
          authorAvatar: '🔌',
          isAgent: true,
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **Agent 通信尚未开启**：${offlineAgents.map((a) => `**${a.name}**`).join('、')} 当前处于离线/未连接状态。\n\n根据产品规范，在与其协作推演前，需先在左侧「Agents & 编队」控制面板点击对应 Agent 头像下方的【Start】按钮开启 ACP 通信连接。`,
        };
        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), offlineNotice],
        }));
      }, 300);
    }

    if (onlineAgents.length === 0) {
      return;
    }

    const now = Date.now();
    setIsGenerating(true);

    // 1. 在 UI activeExecutions 中注册推演任务
    const newExecs: Record<string, ActiveAgentExecution> = {};
    onlineAgents.forEach((agent, idx) => {
      const execKey = `${topicId}:${agent.id}`;
      newExecs[execKey] = {
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar,
        threadId: topicId,
        topicId: topicId,
        status: 'thinking',
        currentActionDetail: isGameTheoretic
          ? (executionStage === 'proposal'
              ? '正在推演并起草主导立论方案 (Stage: 🏛️ 方案立论)...'
              : executionStage === 'challenge'
              ? '正在对立论方案进行反例压测与证伪 (Stage: ⚔️ 反例压测)...'
              : '正在进行立论与反例要点审查并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...')
          : onlineAgents.length > 1 
            ? `正在并发独立推演方案与系统共识 (并行 Hop 1)...`
            : `正在深度推演议题方案与系统共识 (Hop 1)...`,
        startedAt: now + idx * 50,
        cascadeHop: isGameTheoretic ? (executionStage === 'proposal' ? 1 : executionStage === 'challenge' ? 2 : 3) : 1,
      };
    });

    setActiveExecutions((prev) => ({
      ...prev,
      ...newExecs,
    }));

    // 维持 Agent 在线基线状态 ('running')
    setAgents((prev) =>
      prev.map((a) => (onlineAgents.some((oa) => oa.id === a.id) && a.status !== 'running' ? { ...a, status: 'running' } : a))
    );

    // 提取议题前序研讨记录
    const existingTopicMsgs = messages[topicId] || [];
    const recentHistory = existingTopicMsgs
      .filter((m) => m.authorId !== 'system' && !m.agentBadge?.includes('Guard'))
      .slice(-4)
      .map((m) => ({
        author: m.authorName || m.authorHandle,
        content: m.content,
        isAgent: m.isAgent,
      }));

    const topicContext: TopicPromptContext = {
      topicId,
      title: activeTopicData?.title || '议题方案推演',
      description: activeTopicData?.description,
      channelName: topicChannel?.name || 'chat',
      status: activeTopicData?.status || 'open',
      discussionMode: activeTopicData?.discussionMode,
      gameRoles: activeTopicData?.gameRoles,
      gameStage: isGameTheoretic ? executionStage : undefined,
      targetProposalText: isGameTheoretic && executionStage === 'challenge'
        ? activeTopicData?.gameTheoreticState?.targetProposalContent
        : undefined,
      targetChallengeText: isGameTheoretic && executionStage === 'arbitration'
        ? activeTopicData?.gameTheoreticState?.targetChallengeContent
        : undefined,
      participatingAgents: candidateAgents,
      recentHistory,
    };

    // 2. 向 onlineAgents 下发 prompt
    onlineAgents.forEach((agent) => {
      const execKey = `${topicId}:${agent.id}`;
      const sessionKey = `${topicId}:${agent.id}`;
      const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);
      const standingContext = !isStandingContextDelivered
        ? buildCrewRosterGuidance(candidateAgents, agent.id)
        : undefined;

      const structuredTopicPrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: content,
        targetAgent: agent,
        availableAgents: candidateAgents,
      });

      const finalPrompt = !isStandingContextDelivered && standingContext
        ? `${structuredTopicPrompt}${standingContext}`
        : structuredTopicPrompt;

      deliveredStandingContextRef.current.add(sessionKey);

      // 初始化级联状态
      const cascadeId = `cascade-topic-${Date.now()}-${agent.id}`;
      const newCascade: CollaborationCascade = {
        cascadeId,
        rootMessageId: userMsg.id,
        roomId: topicId,
        originalPrompt: content,
        depth: 1,
        maxDepth: 12,
        visitedAgentIds: [agent.id],
        agentCallCounts: { [agent.id]: 1 },
        isAborted: false,
      };
      setActiveCascades((prev) => ({ ...prev, [cascadeId]: newCascade }));

      logRpc(agent.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'session/prompt',
        params: { roomId: topicId, prompt: finalPrompt, channelId: topicChannel?.id },
      });

      const pendingId = `topic-pending-${Date.now()}-${agent.id}`;
      const pendingMsg: Message = {
        id: pendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: agent.id,
        authorName: agent.name,
        authorHandle: agent.handle,
        authorAvatar: agent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: isGameTheoretic
          ? targetRoleType === 'proposer'
            ? '正在构思核心立论方案与架构设计推演 (Stage: 🏛️ 方案立论)...'
            : targetRoleType === 'challenger'
            ? '正在对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...'
            : '正在权衡方案与反例要点并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...'
          : '正在思考并组织回复...',
        agentBadge: isGameTheoretic
          ? `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${
              targetRoleType === 'proposer'
                ? '🏛️ 方案立论 (思考中...)'
                : targetRoleType === 'challenger'
                ? '⚔️ 反例压测 (思考中...)'
                : '⚖️ 仲裁建言 (思考中...)'
            }`
          : `${agent.modelBadge?.split(' ')[0] || 'Local'} · 思考中...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: isGameTheoretic ? executionStage : undefined,
        gameRole: isGameTheoretic ? targetRoleType : undefined,
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), pendingMsg],
      }));

      sendPromptToAcpAgent({
        agent,
        roomId: topicId,
        prompt: finalPrompt,
        projectId: activeProjectId,
        channelId: topicChannel?.id,
        systemPrompt: standingContext,
      })
        .then((acpResp) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          setAgents((prev) =>
            prev.map((a) => (a.id === agent.id ? { ...a, status: 'running' } : a))
          );
          syncRunningAgentsWithBackend();

          const agentReply: Message = {
            id: `topic-reply-${Date.now()}-${agent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            isPending: false,
            gameStage: isGameTheoretic ? executionStage : undefined,
            gameRole: isGameTheoretic ? targetRoleType : undefined,
            agentBadge: isGameTheoretic
              ? `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${
                  targetRoleType === 'proposer'
                    ? '🏛️ 方案立论'
                    : targetRoleType === 'challenger'
                    ? '⚔️ 反例压测'
                    : '⚖️ 仲裁建言'
                }`
              : `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : agent.isRemote ? 'ACP Remote' : '协作'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            thinkingProcess: acpResp.memoryActions && acpResp.memoryActions.length > 0 ? {
              duration: `${acpResp.durationMs}ms`,
              tokens: Math.round(acpResp.textResponse.length * 1.3),
              summary: isGameTheoretic ? `已完成博弈推演与技术边界审定` : `已检索私有记忆库并完成技术边界考量`,
              detail: acpResp.memoryActions.map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`).join('\n'),
            } : undefined,
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
            collaborationInfo: {
              cascadeId,
              hop: 1,
              maxHops: 8,
            },
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const hasPending = existing.some((m) => m.id === pendingId);
            const nextTopicMsgs = hasPending
              ? existing.map((m) => (m.id === pendingId ? agentReply : m))
              : [...existing, agentReply];
            let parentThreadId: string | null = null;
            for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
              if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                parentThreadId = tId;
                break;
              }
            }

            const updatedChannelMsgs = parentThreadId
              ? (prev[parentThreadId] || []).map((m) => {
                  if (m.type === 'topic' && m.topicData?.id === topicId) {
                    return {
                      ...m,
                      topicData: {
                        ...m.topicData,
                        repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                        latestReplyPreview: agentReply.content.slice(0, 60),
                      },
                    };
                  }
                  return m;
                })
              : [];

            return {
              ...prev,
              [topicId]: nextTopicMsgs,
              ...(parentThreadId ? { [parentThreadId]: updatedChannelMsgs } : {}),
            };
          });

          logRpc(agent.name, 'agent_to_client', 'session/prompt:result', {
            jsonrpc: '2.0',
            method: 'session/prompt:result',
            result: acpResp,
          });

          if (isGameTheoretic) {
            // 三元博弈协议驱动状态机接力 (Protocol FSM Handover)
            if (executionStage === 'proposal') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Proposer returned empty/error turn, pausing handover.');
              } else {
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'challenge',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'challenge',
                    targetProposalContent: acpResp.textResponse,
                    isChallengerResponded: false,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'challenge',
                  targetProposalText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'challenge') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Challenger returned empty/error turn, pausing handover.');
              } else {
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'arbitration',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'arbitration',
                    targetChallengeContent: acpResp.textResponse,
                    isChallengerResponded: true,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'arbitration',
                  targetProposalText: activeTopicData?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: acpResp.textResponse,
                });
              }
            }
          } else {
            // 标准讨论模式：常规自然语言 @ 级联接力
            dispatchCascadingAgentResponse({
              cascadeId,
              invokingAgent: agent,
              replyContent: acpResp.textResponse,
              roomId: topicId,
              isTopic: true,
              topicId,
            });
          }
        })
        .catch((err) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          setAgents((prev) =>
            prev.map((a) => (a.id === agent.id ? { ...a, status: 'idle' } : a))
          );
          console.error('Failed to send topic prompt to agent:', err);
          const errorReply: Message = {
            id: `topic-reply-err-${Date.now()}-${agent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            isPending: false,
            gameStage: isGameTheoretic ? executionStage : undefined,
            gameRole: isGameTheoretic ? targetRoleType : undefined,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
          };

          if (isGameTheoretic && executionStage === 'challenge') {
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'arbitration',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'arbitration',
                isChallengerResponded: false,
                quorumAlert: `制衡方 (${agent.name}) 发生通信异常：${err instanceof Error ? err.message : String(err)}`,
              },
            }));
          }

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const hasPending = existing.some((m) => m.id === pendingId);
            const nextTopicMsgs = hasPending
              ? existing.map((m) => (m.id === pendingId ? errorReply : m))
              : [...existing, errorReply];
            return {
              ...prev,
              [topicId]: nextTopicMsgs,
            };
          });
        });
    });
  };

  const handleResolveTopic = (
    topicId: string,
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
    }
  ) => {
    const resolvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const decisionRecord: DecisionRecord = {
      summary: decision.rulingRecord ? decision.rulingRecord.summary : '架构方案达成一致并收敛',
      solution: decision.solution,
      impactedFiles: decision.impactedFiles,
      approvers: decision.approvers,
      resolvedAt,
    };

    setMessages((prev) => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
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
              gameStage: m.topicData.discussionMode === 'game_theoretic' ? 'concluded' : m.topicData.gameStage,
              gameTheoreticState: m.topicData.discussionMode === 'game_theoretic' ? {
                ...m.topicData.gameTheoreticState,
                currentStage: 'concluded' as GameTheoreticStage,
                isArbiterExempted: Boolean(decision.rulingRecord?.exemptionReason),
                exemptionReason: decision.rulingRecord?.exemptionReason,
              } : m.topicData.gameTheoreticState,
              decisionRecord,
              rulingRecord: decision.rulingRecord,
            },
          };
        }
        return m;
      });

      let rollupContent = `🎉 **议题已达成共识并解决 (Resolved & Merged)**\n\n**决策方案**：${decision.solution}\n**影响文件**：${decision.impactedFiles.join('、') || '无'}\n**签署人**：${decision.approvers.join('、')}\n\n*详细推演过程已在议题抽屉归档保存。*`;

      if (decision.rulingRecord) {
        const typeText = decision.rulingRecord.decisionType === 'adopt_proposer'
          ? '⚖️ 采纳主导方案'
          : decision.rulingRecord.decisionType === 'reject_rebuild'
          ? '🔄 采纳挑战驳回重构'
          : '📊 达成架构权衡矩阵';
        rollupContent = `⚖️ **博弈讨论仲裁定案 (${typeText})**\n\n**仲裁裁决官**：${decision.rulingRecord.arbiterName}\n**裁决结论**：${decision.rulingRecord.summary}\n${decision.solution ? `**实施/重构方案**：${decision.solution}\n` : ''}${decision.rulingRecord.tradeOffPoints && decision.rulingRecord.tradeOffPoints.length > 0 ? `**关键权衡要点**：\n${decision.rulingRecord.tradeOffPoints.map((p) => `- ${p}`).join('\n')}\n` : ''}${decision.rulingRecord.exemptionReason ? `**特权豁免记录**：⚠️ 已执行人类首席仲裁官具名豁免 (${decision.rulingRecord.exemptionReason})\n` : ''}**影响文件**：${decision.impactedFiles.join('、') || '无'}\n**签署裁决**：${decision.approvers.join('、')}\n\n*博弈论证与仲裁全过程已归档。*`;
      }

      const rollupNotice: Message = {
        id: `msg-rollup-${Date.now()}`,
        threadId: parentThreadId,
        channelId: activeTopicData?.channelId || activeChannel?.id,
        authorId: 'system',
        authorName: decision.rulingRecord ? 'Shinobi 仲裁法槌' : 'Shinobi 共识引擎',
        authorHandle: '@shinobi',
        authorAvatar: decision.rulingRecord ? '⚖️' : '🥷',
        isAgent: true,
        agentBadge: decision.rulingRecord ? 'Arbiter Ruling' : 'Consensus Rollup',
        timestamp: resolvedAt,
        content: rollupContent,
      };

      return {
        ...prev,
        [parentThreadId]: [...updatedChannelMsgs, rollupNotice],
      };
    });
  };

  const handleReopenTopic = (topicId: string) => {
    setMessages((prev) => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
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

    if (threadId) {
      setMessages((prev) => {
        const list = prev[threadId];
        if (!list || !list.some((m) => m.authorId === agentId && m.isPending)) return prev;
        return {
          ...prev,
          [threadId]: list.map((m) =>
            m.authorId === agentId && m.isPending
              ? {
                  ...m,
                  isPending: false,
                  agentBadge: '已终止',
                  content: (m.content || '') + '\n\n*(已由用户手动终止推演)*',
                }
              : m
          ),
        };
      });
    }

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
    setActiveCascades((prev) => {
      const next: Record<string, CollaborationCascade> = {};
      (Object.entries(prev) as [string, CollaborationCascade][]).forEach(([k, v]) => {
        if (!threadId || v.roomId === threadId) {
          next[k] = { ...v, isAborted: true };
        } else {
          next[k] = v;
        }
      });
      return next;
    });

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
      if (!threadId || Object.keys(next).length === 0) {
        setIsGenerating(false);
      }
      return next;
    });

    // 重点：中止执行后 Agent 维持在线就绪状态 ('running')，绝对不能设为 'idle' (离线) 导致必须重新点击 Start
    setAgents((prev) =>
      prev.map((a) => (agentsToReset.includes(a.id) && a.status !== 'idle' ? { ...a, status: 'running' } : a))
    );
  };

  // Send Message in active thread
  const handleSendMessage = (content: string) => {
    if (!content.trim() || !activeThread) return;

    const targetChannelId = activeThread.type === 'dm' ? 'direct-messages' : activeChannel?.id;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: activeThread.id,
      channelId: targetChannelId,
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

    // Detect responding agents:
    // 1. Resolve channel assigned agents (merge assignedAgentIds, memberIds, activeAgentIds)
    const currentChannelAgentIds = Array.from(
      new Set([
        ...(activeChannel?.assignedAgentIds || []),
        ...(activeChannel?.memberIds || []),
        ...(activeThread.activeAgentIds || []),
      ])
    );
    let channelAssigned = currentChannelAgentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));

    // 2. Parse mentioned agents
    const lowerContent = content.toLowerCase();
    const isAllMention = lowerContent.includes('@all') || lowerContent.includes('@所有人') || lowerContent.includes('@team');

    let userMentionedAgents: Agent[] = [];

    if (isAllMention) {
      // 频道内 @all 严格限定在当前频道已准入的成员范围，绝不能越界拉取全工作区外部成员进频道
      userMentionedAgents = channelAssigned;
    } else {
      // 显式点名时，从工作区已登记 Agent 中解析，并允许自动邀请入驻当前频道
      userMentionedAgents = parseAgentMentions(content, agents);

      // 3. If human user mentions an agent not yet in the channel, automatically invite & add them!
      if (activeThread.type !== 'dm' && activeChannel && userMentionedAgents.length > 0) {
        const newlyInvited = userMentionedAgents.filter(
          (a) => !channelAssigned.some((ca) => ca.id === a.id)
        );

        if (newlyInvited.length > 0) {
          const newlyInvitedIds = newlyInvited.map((a) => a.id);
          const updatedAssignedIds = Array.from(
            new Set([...(activeChannel.assignedAgentIds || []), ...newlyInvitedIds])
          );
          const updatedMemberIds = Array.from(
            new Set([...(activeChannel.memberIds || []), ...newlyInvitedIds])
          );

          setChannels((prev) =>
            prev.map((c) =>
              c.id === activeChannel.id
                ? { ...c, assignedAgentIds: updatedAssignedIds, memberIds: updatedMemberIds }
                : c
            )
          );
          setThreads((prev) =>
            prev.map((t) =>
              t.channelId === activeChannel.id
                ? { ...t, activeAgentIds: updatedAssignedIds }
                : t
            )
          );

          channelAssigned.push(...newlyInvited);
        }
      }
    }

    const candidateAgents = activeThread.type === 'dm'
      ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
      : channelAssigned;

    let respondingAgents: Agent[] = [];

    if (activeThread.type === 'dm') {
      const dmTarget = candidateAgents[0];
      if (dmTarget) {
        respondingAgents = [dmTarget];
      }
    } else if (userMentionedAgents.length > 0) {
      respondingAgents = userMentionedAgents;
    } else if (candidateAgents.length > 0) {
      respondingAgents = [candidateAgents[0]];
    }

    if (respondingAgents.length === 0) {
      setTimeout(() => {
        const hintMsg: Message = {
          id: `msg-hint-${Date.now()}`,
          threadId: activeThread.id,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shinobi 系统提示',
          authorHandle: '@shinobi',
          authorAvatar: '🥷',
          isAgent: true,
          agentBadge: 'System',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: activeThread.type === 'dm'
            ? '当前工作台尚未连接该 Agent。'
            : '当前频道尚未指派任何 Agent。\n\n请在下方输入框中输入 `@` 选择并点名 Agent（如 Claude Code、OpenClaw 等）加入此频道，或点击右上角「成员管理」进行邀请！',
        };
        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), hintMsg],
        }));
      }, 500);
      return;
    }

    const primaryResponder = respondingAgents[0];

    // 严格检查通信状态：若未手动点击 Start 开启通信，则进行拦截并引导
    if (primaryResponder.status === 'idle') {
      setTimeout(() => {
        const offlineNotice: Message = {
          id: `msg-offline-${Date.now()}`,
          threadId: activeThread.id,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shadow Crew 通信管控',
          authorHandle: '@connection-guard',
          authorAvatar: '🔌',
          isAgent: true,
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **Agent 通信尚未开启**：**${primaryResponder.name}** 当前处于离线/未连接状态。\n\n根据产品规范，需先在左侧「Agents & 编队」面板点击该 Agent 头像下方的【Start】按钮开启通信连接后方可协作推演。\n\n*(开启通信后，重新发送消息或在此 @ 召唤即可正常推演)*`,
        };
        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), offlineNotice],
        }));
      }, 300);
      return;
    }

    setIsGenerating(true);
    const now = Date.now();
    const sessionKey = `${activeThread.id}:${primaryResponder.id}`;
    const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);

    // 对标 Buzz: 仅当该 Session 尚未交付过立足上下文时构造公约 (首轮通过 systemPrompt + 前置引导)
    // 注意：私聊 (DM) 模式下不需要多智能体协同公约/花名册，避免注入 "@ 级联调度公约" 等频道协同指令
    const standingContext = activeThread.type !== 'dm' && !isStandingContextDelivered
      ? buildCrewRosterGuidance(candidateAgents, primaryResponder.id)
      : undefined;

    const finalPrompt = !isStandingContextDelivered && standingContext
      ? `${content}${standingContext}`
      : content;

    deliveredStandingContextRef.current.add(sessionKey);

    // 初始化协同链状态
    const cascadeId = `cascade-thread-${Date.now()}`;
    const newCascade: CollaborationCascade = {
      cascadeId,
      rootMessageId: userMsg.id,
      roomId: activeThread.id,
      originalPrompt: content,
      depth: 1,
      maxDepth: 12, // 对标 Buzz: 提升至 12 轮作为不可见安全兜底
      visitedAgentIds: [primaryResponder.id],
      agentCallCounts: { [primaryResponder.id]: 1 },
      isAborted: false,
    };
    setActiveCascades((prev) => ({ ...prev, [cascadeId]: newCascade }));

    const newExecs: Record<string, ActiveAgentExecution> = {};
    respondingAgents.forEach((ag, idx) => {
      // 维持 Agent 在线基线状态 ('running')，具体推演任务由 activeExecutions 独立追踪
      setAgents((prev) => prev.map((a) => (a.id === ag.id && a.status !== 'running' ? { ...a, status: 'running' } : a)));
      logRpc(ag.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now() + idx,
        method: 'session/prompt',
        params: {
          threadId: activeThread.id,
          prompt: finalPrompt,
          channelId: targetChannelId,
        },
      });

      newExecs[`${activeThread.id}:${ag.id}`] = {
        agentId: ag.id,
        agentName: ag.name,
        agentAvatar: ag.avatar,
        threadId: activeThread.id,
        status: idx === 0 ? 'thinking' : 'queued',
        currentActionDetail: idx === 0 ? '正在深度推演方案并对齐上下文 (Hop 1)...' : '排队等待协同推演中...',
        startedAt: now + idx * 200,
        cascadeHop: 1,
      };
    });

    setActiveExecutions((prev) => ({
      ...prev,
      ...newExecs,
    }));

    // Handle agent response via ACP client (real stdio subprocess or fallback)
    sendPromptToAcpAgent({
      agent: primaryResponder,
      roomId: activeThread.id,
      prompt: finalPrompt,
      projectId: activeProjectId,
      channelId: targetChannelId,
      systemPrompt: standingContext,
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
          channelId: targetChannelId,
          authorId: primaryResponder.id,
          authorName: primaryResponder.name,
          authorHandle: primaryResponder.handle,
          authorAvatar: primaryResponder.avatar,
          isAgent: true,
          managedBy: primaryResponder.isManagedByYou ? 'you' : undefined,
          agentBadge: `${primaryResponder.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : primaryResponder.isRemote ? 'ACP Remote' : 'ACP'}`,
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
          cartridgeCitation: acpResp.cartridgeCitation,
          collaborationInfo: {
            cascadeId,
            hop: 1,
            maxHops: 8,
          },
          acpTrace: {
            requestId: `acp-${Date.now()}`,
            method: 'session/prompt',
            durationMs: acpResp.durationMs,
            workspaceAction: {
              action: 'read',
              path: primaryResponder.workspace?.activeFiles?.[0] || 'src/App.tsx',
              summary: `Target workspace: ${primaryResponder.workspace?.rootPath || '.'}${acpResp.isRealProcess ? ' (Real stdio process)' : primaryResponder.isRemote ? ' (Remote WebSocket)' : ''}`,
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

        // 仅在非 DM (即频道多 Agent 协同) 场景下触发跨智能体互相 @ 级联调度
        if (activeThread.type !== 'dm') {
          dispatchCascadingAgentResponse({
            cascadeId,
            invokingAgent: primaryResponder,
            replyContent: acpResp.textResponse,
            roomId: activeThread.id,
            isTopic: false,
            queuedCollaborators: respondingAgents.slice(1),
          });
        }
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
          channelId: targetChannelId,
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
      {/* 1. Left Primary Sidebar (Antigravity-style Smooth Collapsible) */}
      <div
        className={`h-full flex shrink-0 overflow-hidden ${
          isSidebarTransitioning ? 'transition-[width,opacity] duration-200 ease-in-out' : ''
        } ${isSidebarCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ width: isSidebarCollapsed ? 0 : undefined }}
        onTransitionEnd={() => setIsSidebarTransitioning(false)}
      >
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
        <AgentDashboard
          agents={agents}
          teams={teams}
          channels={channels}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => toggleSidebar()}
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
          onExportAgentMemory={(agent) => {
            setExportingAgent(agent);
            setIsMemoryExportModalOpen(true);
          }}
          onImportMemoryCartridge={() => {
            setIsMemoryImportModalOpen(true);
          }}
          onToggleAgentStatus={(agentId) => {
            const currentAgent = agents.find((a) => a.id === agentId);
            if (!currentAgent) return;
            const isCurrentlyRunning = currentAgent.status !== 'idle';

            if (!isCurrentlyRunning) {
              if (currentAgent.isRemote) {
                // 远程 ACP 节点：通过 WebSocket 探测连接
                setAgents((prev) =>
                  prev.map((a) =>
                    a.id === agentId ? { ...a, status: 'starting', statusDetail: '连接远程 ACP 节点中...' } : a
                  )
                );
                import('./services/acpClient').then(({ probeRemoteAcpConnection }) => {
                  probeRemoteAcpConnection(currentAgent.remoteUrl || currentAgent.acpCommandOrUrl, currentAgent.authToken)
                    .then((probe) => {
                      if (probe.ok) {
                        setAgents((prev) =>
                          prev.map((a) =>
                            a.id === agentId
                              ? { ...a, status: 'running', remoteLatencyMs: probe.latencyMs, statusDetail: `远程连接正常 (${probe.latencyMs}ms)` }
                              : a
                          )
                        );
                      } else {
                        setAgents((prev) =>
                          prev.map((a) =>
                            a.id === agentId ? { ...a, status: 'error', statusDetail: probe.error || '远程连接失败' } : a
                          )
                        );
                      }
                    });
                });
                return;
              }

              // 启动 Agent 进程: 初始设为 starting 握手过渡态
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agentId ? { ...a, status: 'starting', statusDetail: 'ACP 进程启动与协议握手中...' } : a
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
                      a.id === agentId ? { ...a, status: 'error', statusDetail: String(err) } : a
                    )
                  );
                });
              }
            } else {
              // 终止 Agent 进程
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agentId ? { ...a, status: 'idle', statusDetail: undefined } : a
                )
              );
              if (!currentAgent.isRemote && typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
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
          <main className="flex-1 flex flex-col min-w-[260px] bg-canvas relative overflow-hidden transition-colors duration-150">
            {activeThread && (activeThread.type === 'dm' || activeChannel) ? (
              <>
                <ChatTimeline
                  messages={activeMessages}
                  activeThread={activeThread}
                  channel={activeThread.type === 'dm' ? undefined : activeChannel}
                  agents={agents}
                  activeExecutions={Object.values(activeExecutions)}
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
                  onEditTopic={(topic) => setEditingTopic(topic)}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={() => toggleSidebar()}
                  currentWorkspace={activeProject?.name || 'shadow-crew'}
                />

                <MessageInput
                  onSendMessage={handleSendMessage}
                  onAbort={() => activeThread && handleAbortAll(activeThread.id)}
                  activeAgents={activeThread.type === 'dm' 
                    ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
                    : agents.filter((a) => {
                        const channelIds = new Set([
                          ...(activeChannel?.assignedAgentIds || []),
                          ...(activeChannel?.memberIds || []),
                          ...(activeThread.activeAgentIds || [])
                        ]);
                        return channelIds.has(a.id);
                      })}
                  allAgents={agents}
                  isGenerating={isCurrentThreadGenerating}
                  channelName={activeThread.type === 'dm' ? (activeThread.authorName || 'Agent') : (activeChannel?.name || 'chat')}
                  onOpenNewTopicModal={activeThread.type === 'dm' ? undefined : () => setIsNewTopicModalOpen(true)}
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
            agents={currentChannelAgents}
            activeExecutions={activeTopicId ? Object.values(activeExecutions).filter((e: any) => e.threadId === activeTopicId || e.topicId === activeTopicId) : []}
            onAbortAgent={(agentId) => activeTopicId && handleAbortAgent(agentId, activeTopicId)}
            onAbortAll={() => activeTopicId && handleAbortAll(activeTopicId)}
            onClose={() => setActiveTopicId(null)}
            onSendMessage={handleSendTopicMessage}
            onResolveTopic={handleResolveTopic}
            onReopenTopic={handleReopenTopic}
            onOpenCodexDiff={(diff) => {
              setActiveDiff(diff);
              setIsCodexDiffOpen(true);
            }}
            onEditTopic={() => setEditingTopic(activeTopicData)}
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
          onToggleCartridge={handleToggleCartridge}
          onEjectCartridge={handleEjectCartridge}
          onOpenExportModal={(agent) => {
            setExportingAgent(agent);
            setIsMemoryExportModalOpen(true);
          }}
          onOpenImportModal={() => {
            setIsMemoryImportModalOpen(true);
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
        onOpenStorageSettings={() => setIsStorageSettingsModalOpen(true)}
      />

      {/* 7.3 Modal: Storage Architecture & Cache Management (Option 3: SQLite) */}
      <StorageSettingsModal
        isOpen={isStorageSettingsModalOpen}
        onClose={() => setIsStorageSettingsModalOpen(false)}
        messages={Object.values(messages).flat()}
        onMessagesCleared={() => {
          setMessages({});
        }}
        onOpenMemoryExport={() => {
          setExportingAgent(agents[0] || null);
          setIsMemoryExportModalOpen(true);
        }}
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
        onOpenImportModal={() => {
          setIsConnectModalOpen(false);
          setIsMemoryImportModalOpen(true);
        }}
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
            modelBadge: agentData.modelBadge || DEFAULT_MODEL_NAME,
            localAcpProfile: agentData.localAcpProfile,
            envVars: agentData.envVars,
            isManagedByYou: true,
            isRemote: agentData.isRemote,
            remoteUrl: agentData.remoteUrl,
            authToken: agentData.authToken,
            remoteLatencyMs: agentData.remoteLatencyMs,
            readOnlyGuard: agentData.readOnlyGuard,
            isGuestClone: agentData.isGuestClone,
            guestCloneFrom: agentData.guestCloneFrom,
            acpTransport: agentData.acpTransport || (agentData.isRemote ? 'websocket' : 'stdio'),
            acpCommandOrUrl: agentData.acpCommandOrUrl || (agentData.isRemote ? (agentData.remoteUrl || 'ws://127.0.0.1:9090/acp') : 'cargo run --bin custom-agent -- --acp'),
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
              permissionMode: agentData.readOnlyGuard ? 'read_only' : 'full_read_write',
              activeFiles: ['src/App.tsx'],
            },
            skills: [],
            memory: {
              internalMemoryPath: `~/.local/share/shinobi/${(agentData.name || 'agent').toLowerCase()}_memory.sqlite`,
              persistentType: 'sqlite',
              persistentItems: [],
              sessionCacheCount: 0,
              cartridges: agentData.memory?.cartridges || [],
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
        agents={currentChannelAgents}
        onCreateTopic={handleCreateTopic}
      />

      {/* 9.1.1 Modal: Edit Topic */}
      <EditTopicModal
        isOpen={Boolean(editingTopic)}
        topic={editingTopic}
        channel={editingTopicChannel}
        agents={editingTopicAgents}
        onClose={() => setEditingTopic(null)}
        onUpdateTopic={handleUpdateTopic}
      />

      {/* 10. Rust + Tauri Architecture & Source Code Hub */}
      <RustTauriArchitectureHub
        isOpen={isRustTauriHubOpen}
        onClose={() => setIsRustTauriHubOpen(false)}
      />

      {/* 11. Memory Export & Import Modals */}
      {isMemoryExportModalOpen && exportingAgent && (
        <MemoryExportModal
          isOpen={isMemoryExportModalOpen}
          agent={exportingAgent}
          onClose={() => {
            setIsMemoryExportModalOpen(false);
            setExportingAgent(null);
          }}
        />
      )}

      <MemoryImportModal
        isOpen={isMemoryImportModalOpen}
        agents={agents}
        defaultAgentId={selectedAgentId || undefined}
        defaultWorkspaceRoot={activeProject?.localWorkspaceRoot || '.'}
        onClose={() => setIsMemoryImportModalOpen(false)}
        onMountCartridge={handleMountCartridge}
        onCloneGuestAgent={handleCloneGuestAgent}
      />
    </div>
  );
}
