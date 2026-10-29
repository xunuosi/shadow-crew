/**
 * Shinobi Multi-Agent Platform - Reconstructed Workspace UI
 * Fusing Block Buzz, Codex, and Google Antigravity
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { 
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
  RulingRecord,
  TopicPatchDiffItem,
  SprtGovernorState,
  FastTrackConvergenceEvidence,
  ModularOrchestrationState,
  WorkspaceBinding
} from './types';
import { 
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

// 按需异步加载高体积分支抽屉与低频弹窗组件，从首屏关键渲染路径剥离
const SubThreadDrawer = lazy(() => import('./components/SubThreadDrawer').then((m) => ({ default: m.SubThreadDrawer })));
const TopicThreadDrawer = lazy(() => import('./components/TopicThreadDrawer').then((m) => ({ default: m.TopicThreadDrawer })));
const NewTopicModal = lazy(() => import('./components/NewTopicModal').then((m) => ({ default: m.NewTopicModal })));
const EditTopicModal = lazy(() => import('./components/EditTopicModal').then((m) => ({ default: m.EditTopicModal })));
const CodexDiffViewer = lazy(() => import('./components/CodexDiffViewer').then((m) => ({ default: m.CodexDiffViewer })));
const AcpInspector = lazy(() => import('./components/AcpInspector').then((m) => ({ default: m.AcpInspector })));
const AgentTeamsModal = lazy(() => import('./components/AgentTeamsModal').then((m) => ({ default: m.AgentTeamsModal })));
const CreateChannelModal = lazy(() => import('./components/CreateChannelModal').then((m) => ({ default: m.CreateChannelModal })));
const ChannelMembersModal = lazy(() => import('./components/ChannelMembersModal').then((m) => ({ default: m.ChannelMembersModal })));
const DeleteChannelModal = lazy(() => import('./components/DeleteChannelModal').then((m) => ({ default: m.DeleteChannelModal })));
const ConnectAgentModal = lazy(() => import('./components/ConnectAgentModal').then((m) => ({ default: m.ConnectAgentModal })));
const CreateTeamModal = lazy(() => import('./components/CreateTeamModal').then((m) => ({ default: m.CreateTeamModal })));
const AgentDefaultsModal = lazy(() => import('./components/AgentDefaultsModal').then((m) => ({ default: m.AgentDefaultsModal })));
const StorageSettingsModal = lazy(() => import('./components/StorageSettingsModal').then((m) => ({ default: m.StorageSettingsModal })));
const RustTauriArchitectureHub = lazy(() => import('./components/RustTauriArchitectureHub').then((m) => ({ default: m.RustTauriArchitectureHub })));
const AgentDashboard = lazy(() => import('./components/AgentDashboard').then((m) => ({ default: m.AgentDashboard })));
const MemoryExportModal = lazy(() => import('./components/MemoryExportModal').then((m) => ({ default: m.MemoryExportModal })));
const MemoryImportModal = lazy(() => import('./components/MemoryImportModal').then((m) => ({ default: m.MemoryImportModal })));
import {
  sendPromptToAcpAgent,
  clearAcpAgentSessions,
  ensureAcpAgentSession,
  buildUnifiedSessionKey,
  buildAgentSessionKey,
  matchesSessionScope,
  probeRemoteAcpConnection,
  buildAgentLaunchEnv,
  buildThinkingProcessFromAcp,
  extractArbitrationRulingFromAcpResponse,
  extractModuleDecompositionFromAcpResponse,
  extractWorkspaceDiffsFromText,
  applyTopicPatchToWorkspace,
} from './services/acpClient';
import { isAgentOffline, isAgentOnline } from './utils/agentRuntime';
import {
  saveMessagesBatchToDb,
  loadMessagesFromDb,
  loadFullWorkspaceDataFromDb,
  saveChannelsToDb,
  saveWorkspaceBindingsToDb,
  deleteWorkspaceBindingsFromDb,
  resolveWorkspaceCwd,
  saveThreadsToDb,
  saveAgentsToDb,
  saveTeamsToDb,
  saveWorkspaceStateToDb,
  isTauriEnvironment,
} from './services/dbClient';
import {
  createChannelBinding,
  createTopicBinding,
  findWorkspaceBinding,
  getDefaultChannelCwd,
  getDefaultTopicCwd,
  migrateWorkspaceGraph,
  WORKSPACE_BINDING_SCHEMA_VERSION,
} from './services/workspaceBindings';
import { DEFAULT_MODEL_NAME } from './config/models';
import { resolveAgentModelConfig, setGlobalModelConfig, clearLlmSessionHistory } from './services/llmService';
import {
  CollaborationCascade,
  normalizeAgentHandle,
  parseAgentMentions,
  isAllMention,
  checkLoopGuard,
  buildAgentPersonaPrompt,
  buildCompositeSystemPrompt,
  buildCrewRosterGuidance,
  buildCascadePrompt,
  buildTopicPrompt,
  buildExecutionPrompt,
  extractUnreadDeltaMessages,
  buildNormalModeTurnPrompt,
  aggregateTurnBarrierMentions,
  TurnAgentOutput,
  AggregatedMentionTarget,
  generateDeterministicMcdaPayload,
  compileMinorityReport,
  extractOrCompileMinorityReport,
  extractArgumentNodes,
  localizeEarliestDispute,
  dehydrateContextToCommittedStates,
  stepSprtGovernor,
  estimateRoundAlignmentScore,
  TopicPromptContext,
  logGameTheoreticTelemetry,
  validateStageContract,
  validateModuleScopeContract,
  STAGE_CONTRACT_MAX_RETRIES,
  tieredGroundingGovernor,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  evaluateDynamicSycophancyScore,
  applySycophancyDiscountToSprt,
  calculateModelDiversity,
  localizeGraphDiffDispute,
  calculateColMadContributions,
  initializeModularOrchestrationState,
  buildDefaultDecompositionFromTopic,
  advanceModularOrchestration,
  stepModularStageTransition,
  TurnEpochSnapshot,
  createTurnEpochTracker,
  captureTurnEpochSnapshot,
  isTurnEpochStale,
  bumpGlobalEpoch,
  bumpRoomEpoch,
  bumpChannelEpoch,
  bumpAgentExecutionEpoch,
  executeAbortAgentOrchestration,
  executeAbortAllOrchestration,
  executeUpdateChannelMembersOrchestration,
} from './services/agentCollaboration';

export default function App() {
  // Main View Navigation ('chat' | 'agents') - Default to chat for PRD Messaging Space
  const [mainView, setMainView] = useState<'chat' | 'agents'>('chat');

  // 关键防回滚锁：首轮从 SQLite 加载完成前，严禁各 entity 的初始挂载触发 useEffect 覆盖底层数据库
  const isWorkspaceHydratedRef = useRef(false);
  const workspaceBindingSchemaPersistedRef = useRef(false);
  const sanitizeMessages = useCallback((list: Message[]): Message[] => {
    return list.map((message) => {
      const migrated = { ...message } as Message & { projectId?: string };
      delete migrated.projectId;
      return migrated;
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem('shinobi_projects');
      localStorage.removeItem('shinobi_active_project_id');
      localStorage.removeItem('shinobi_activeProjectId');
    } catch {}
  }, []);

  // Core Entities State with Local Storage Persistence
  const [agents, setAgents] = useState<Agent[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_agents');
      if (saved) {
        const parsed = JSON.parse(saved);
          // Filter out contaminated mock agent IDs from the bad UI revision and migrate legacy workspace paths to ~/.shadow-crew
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
              if (
                !updatedWorkspace?.rootPath ||
                updatedWorkspace.rootPath === '.' ||
                updatedWorkspace.rootPath.includes('/home/norris') ||
                updatedWorkspace.rootPath.includes('/shadow-crew') ||
                updatedWorkspace.rootPath.includes('/.shinobi')
              ) {
                updatedWorkspace = {
                  ...(updatedWorkspace || {}),
                  rootPath: '~/.shadow-crew',
                  repoName: 'shadow-crew-workspace',
                  gitBranch: updatedWorkspace?.gitBranch || 'main',
                  permissionMode: updatedWorkspace?.permissionMode || 'full_read_write',
                  activeFiles: ['~/.shadow-crew/agents'],
                };
              }
              const updatedMemory = a.memory
                ? {
                    ...a.memory,
                    internalMemoryPath:
                      !a.memory.internalMemoryPath || a.memory.internalMemoryPath.includes('.local/share') || a.memory.internalMemoryPath.includes('.shinobi')
                        ? '~/.shadow-crew/global_memory.sqlite'
                        : a.memory.internalMemoryPath,
                  }
                : undefined;
              const baseAgent = {
                ...a,
                handle: normalizeAgentHandle(a.name, a.id),
                ...(updatedMemory ? { memory: updatedMemory } : {}),
                status: 'idle', // 启动默认未开启通信，需用户在面板点击 Start
                statusDetail: undefined,
              };
              if (a.id === 'agent-shinobi-core') {
                return {
                  ...baseAgent,
                  modelBadge: a.modelBadge === 'Rust Native' ? 'DeepSeek V3' : (a.modelBadge || 'DeepSeek V3'),
                  modelConfig: a.modelConfig || {
                    provider: 'deepseek',
                    modelId: 'deepseek-chat',
                    modelName: 'DeepSeek V3',
                    baseUrl: 'https://api.deepseek.com/v1',
                    useGlobalDefault: true,
                  },
                  acpCommandOrUrl: './target/debug/shadow-crew-agent',
                  workspace: updatedWorkspace || {
                    rootPath: '~/.shadow-crew',
                    repoName: 'shadow-crew-workspace',
                    gitBranch: 'main',
                    permissionMode: 'full_read_write',
                    activeFiles: ['~/.shadow-crew/global_memory.sqlite'],
                  },
                };
              }
              // 针对外部自主 ACP Agent，清理历史脏数据中把 Agent 名字错赋给 modelBadge 或 role 的情况
              if (baseAgent.modelBadge === baseAgent.name || baseAgent.modelBadge === baseAgent.localAcpProfile) {
                baseAgent.modelBadge = baseAgent.isRemote ? 'Remote ACP' : 'ACP Stdio';
              }
              if (baseAgent.role === baseAgent.name && baseAgent.description && baseAgent.description !== baseAgent.name) {
                baseAgent.role = baseAgent.description.length < 35 ? baseAgent.description : 'Autonomous ACP Daemon';
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
    if (!isWorkspaceHydratedRef.current) return;
    saveAgentsToDb(agents);
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
    if (!isWorkspaceHydratedRef.current) return;
    saveTeamsToDb(teams);
  }, [teams]);

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

  // Channels State with Local Storage Persistence & Channel-Scoped Workspace Migration
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_channels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filtered = parsed
            .filter((c: any) => !MOCK_CHANNEL_IDS.has(c.id) && c.status !== 'deleted')
            .map((c: any) => {
              const migratedChannel = { ...c };
              delete migratedChannel.projectId;
              delete migratedChannel.mountedWorkspace;
              return {
                ...migratedChannel,
                workspaceBindingId: migratedChannel.workspaceBindingId || `ws-channel-${migratedChannel.id}`,
              };
            });
          return filtered;
        }
      }
    } catch {}
    return INITIAL_CHANNELS;
  });

  const [activeChannelId, setActiveChannelId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('shinobi_active_channel_id') || localStorage.getItem('shinobi_activeChannelId');
      if (saved && !MOCK_CHANNEL_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveChannelsToDb(channels);
  }, [channels]);

  const [workspaceBindings, setWorkspaceBindings] = useState<WorkspaceBinding[]>(() => {
    try {
      const saved = localStorage.getItem('shinobi_workspace_bindings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed as WorkspaceBinding[];
      }

      const rawChannels = localStorage.getItem('shinobi_channels');
      const rawMessages = localStorage.getItem('shinobi_messages');
      const legacyChannels = rawChannels ? JSON.parse(rawChannels) : [];
      const legacyMessages = rawMessages ? JSON.parse(rawMessages) : {};
      if (Array.isArray(legacyChannels)) {
        return migrateWorkspaceGraph(
          legacyChannels,
          legacyMessages && typeof legacyMessages === 'object' ? legacyMessages : {},
          []
        ).workspaceBindings;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveWorkspaceBindingsToDb(workspaceBindings).catch((err) => {
      console.error('[App] Failed to persist Workspace Bindings:', err);
    });
  }, [workspaceBindings]);

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveWorkspaceStateToDb('activeChannelId', activeChannelId);
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
      const saved = localStorage.getItem('shinobi_active_thread_id') || localStorage.getItem('shinobi_activeThreadId');
      if (saved && !MOCK_THREAD_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveThreadsToDb(threads);
  }, [threads]);

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveWorkspaceStateToDb('activeThreadId', activeThreadId);
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
                  m.kind === 'rollup' ||
                  m.kind === 'guard' ||
                  m.agentBadge === 'Consensus Rollup' ||
                  m.agentBadge === 'Channel Guard' ||
                  (m.channelId && m.channelId !== 'direct-messages' && !m.channelId.startsWith('dm-') && !m.channelId.startsWith('agent-') && m.channelId.trim() !== '')
                ) {
                  return false;
                }
                return m.authorId === 'user-norris' || m.authorId === agentId || m.authorId === 'system';
              });
            }
          }
          return Object.fromEntries(
            Object.entries(parsed).map(([threadId, threadMessages]) => [
              threadId,
              sanitizeMessages((threadMessages || []) as Message[]),
            ])
          );
        }
      }
    } catch {}
    return INITIAL_MESSAGES;
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    try {
      const migrated = migrateWorkspaceGraph(channels, messages, workspaceBindings);
      if (migrated.changed) {
        setChannels(migrated.channels);
        setMessages(migrated.messages);
        setWorkspaceBindings(migrated.workspaceBindings);
      }
      if (!workspaceBindingSchemaPersistedRef.current) {
        workspaceBindingSchemaPersistedRef.current = true;
        localStorage.setItem(
          'shinobi_workspace_binding_schema_version',
          String(WORKSPACE_BINDING_SCHEMA_VERSION)
        );
        void saveWorkspaceStateToDb(
          'workspaceBindingSchemaVersion',
          WORKSPACE_BINDING_SCHEMA_VERSION
        );
      }
    } catch (err) {
      console.error('[App] Workspace Binding migration failed:', err);
    }
  }, [channels, messages, workspaceBindings]);

  // 首次启动从 SQLite 原生数据库加载与同步工作区核心资产与历史消息
  useEffect(() => {
    let isMounted = true;
    async function syncWorkspaceWithDb() {
      try {
        const fullData = await loadFullWorkspaceDataFromDb();
        if (!isMounted) return;

        if (fullData) {
          if (Array.isArray(fullData.channels) && fullData.channels.length > 0) {
            setChannels(fullData.channels);
          } else if (channels.length > 0) {
            await saveChannelsToDb(channels);
          }

          if (Array.isArray(fullData.workspaceBindings) && fullData.workspaceBindings.length > 0) {
            setWorkspaceBindings(fullData.workspaceBindings);
          } else if (workspaceBindings.length > 0) {
            await saveWorkspaceBindingsToDb(workspaceBindings);
          }

          if (Array.isArray(fullData.threads) && fullData.threads.length > 0) {
            setThreads(fullData.threads);
          } else if (threads.length > 0) {
            await saveThreadsToDb(threads);
          }

          if (Array.isArray(fullData.agents) && fullData.agents.length > 0) {
            let handleMigrated = false;
            const sanitizedAgents = fullData.agents.map((ag: Agent) => {
              const expectedHandle = normalizeAgentHandle(ag.name, ag.id);
              if (ag.handle !== expectedHandle) {
                handleMigrated = true;
                return {
                  ...ag,
                  handle: expectedHandle,
                };
              }
              return ag;
            });
            setAgents(sanitizedAgents);
            if (handleMigrated) {
              resetAllSessionWarmState();
              await saveAgentsToDb(sanitizedAgents);
            }
          } else if (agents.length > 0) {
            await saveAgentsToDb(agents);
          }

          if (Array.isArray(fullData.teams) && fullData.teams.length > 0) {
            setTeams(fullData.teams);
          } else if (teams.length > 0) {
            await saveTeamsToDb(teams);
          }

          const wsState = fullData.workspaceState || {};
          if (wsState.activeChannelId) {
            setActiveChannelId(wsState.activeChannelId);
          }
          if (wsState.activeThreadId) {
            setActiveThreadId(wsState.activeThreadId);
          }
          if (wsState.subThreads) {
            setSubThreads(wsState.subThreads);
          }
          if (wsState.global_model_config) setGlobalModelConfig(wsState.global_model_config);
        }

        const dbMsgs = await loadMessagesFromDb();
        if (!isMounted) return;
        const messagesFromDatabase = dbMsgs?.length ? sanitizeMessages(dbMsgs) : [];
        if (dbMsgs && dbMsgs.length > 0) {
          setMessages((prev) => {
            const next = { ...prev };
            let hasNew = false;
            for (const msg of messagesFromDatabase) {
              const key = msg.threadId || msg.channelId || 'general';
              if (!next[key]) next[key] = [];
              if (!next[key].some((m) => m.id === msg.id)) {
                next[key].push(msg);
                hasNew = true;
              }
            }
            return hasNew ? next : prev;
          });
        }

        const channelsForMigration =
          fullData && Array.isArray(fullData.channels) && fullData.channels.length > 0
            ? fullData.channels
            : channels;
        const bindingsForMigration =
          fullData && Array.isArray(fullData.workspaceBindings) && fullData.workspaceBindings.length > 0
            ? fullData.workspaceBindings
            : workspaceBindings;
        const mergedMessages = { ...messages };
        for (const message of messagesFromDatabase) {
          const key = message.threadId || message.channelId || 'general';
          const existing = mergedMessages[key] || [];
          if (!existing.some((item) => item.id === message.id)) {
            mergedMessages[key] = [...existing, message];
          }
        }
        const workspaceMigration = migrateWorkspaceGraph(
          channelsForMigration,
          mergedMessages,
          bindingsForMigration
        );
        if (workspaceMigration.changed) {
          setChannels(workspaceMigration.channels);
          setMessages(workspaceMigration.messages);
          setWorkspaceBindings(workspaceMigration.workspaceBindings);
          await Promise.all([
            saveChannelsToDb(workspaceMigration.channels),
            saveWorkspaceBindingsToDb(workspaceMigration.workspaceBindings),
          ]);
        }
        try {
          localStorage.setItem(
            'shinobi_workspace_binding_schema_version',
            String(WORKSPACE_BINDING_SCHEMA_VERSION)
          );
        } catch {}
        await saveWorkspaceStateToDb(
          'workspaceBindingSchemaVersion',
          WORKSPACE_BINDING_SCHEMA_VERSION
        );
        workspaceBindingSchemaPersistedRef.current = true;
      } catch (err) {
        console.error('[App] Failed to sync workspace with SQLite:', err);
      } finally {
        if (isMounted) {
          isWorkspaceHydratedRef.current = true;
        }
      }
    }
    syncWorkspaceWithDb();
    return () => {
      isMounted = false;
    };
  }, [sanitizeMessages]);

  // 消息持久化 (原生 SQLite 优先，同步防护 LocalStorage)
  useEffect(() => {
    const allMsgs = Object.values(messages).flat();
    if (allMsgs.length > 0) {
      saveMessagesBatchToDb(allMsgs).catch((e) => {
        console.error('[App] SQLite saveMessagesBatchToDb failed:', e);
      });
    }
    if (!isTauriEnvironment()) {
      try {
        localStorage.setItem('shinobi_messages', JSON.stringify(messages));
      } catch (err) {
        console.warn('[App] LocalStorage quota exceeded, SQLite persistence safely active.');
      }
    }
  }, [messages]);

  // SubThreads State with Local Storage Persistence
  const [subThreads, setSubThreads] = useState<Record<string, SubThread>>(() => {
    try {
      const saved = localStorage.getItem('shinobi_sub_threads') || localStorage.getItem('shinobi_subThreads');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return INITIAL_SUB_THREADS;
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveWorkspaceStateToDb('subThreads', subThreads);
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
  const [duplicatingAgent, setDuplicatingAgent] = useState<Agent | null>(null);
  const [isMemoryExportModalOpen, setIsMemoryExportModalOpen] = useState<boolean>(false);
  const [exportingAgent, setExportingAgent] = useState<Agent | null>(null);
  const [isMemoryImportModalOpen, setIsMemoryImportModalOpen] = useState<boolean>(false);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeExecutions, setActiveExecutionsState] = useState<Record<string, ActiveAgentExecution>>({});
  const [activeCascades, setActiveCascadesState] = useState<Record<string, CollaborationCascade>>({});
  const [sessionCleanupNotice, setSessionCleanupNotice] = useState<string | null>(null);
  const activeCascadesRef = useRef<Record<string, CollaborationCascade>>({});
  activeCascadesRef.current = activeCascades;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const activeExecutionsRef = useRef(activeExecutions);
  activeExecutionsRef.current = activeExecutions;

  const setActiveExecutions = useCallback(
    (
      updater:
        | Record<string, ActiveAgentExecution>
        | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
    ) => {
      const next =
        typeof updater === 'function' ? updater(activeExecutionsRef.current) : updater;
      activeExecutionsRef.current = next;
      setActiveExecutionsState(next);
    },
    []
  );

  const setActiveCascades = useCallback(
    (
      updater:
        | Record<string, CollaborationCascade>
        | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
    ) => {
      const next =
        typeof updater === 'function' ? updater(activeCascadesRef.current) : updater;
      activeCascadesRef.current = next;
      setActiveCascadesState(next);
    },
    []
  );
  const generationEpochRef = useRef<number>(0);
  const turnEpochTrackerRef = useRef(createTurnEpochTracker());

  const captureTurnEpoch = useCallback(
    (roomId: string, channelId?: string, agentId?: string): TurnEpochSnapshot =>
      captureTurnEpochSnapshot(turnEpochTrackerRef.current, { roomId, channelId, agentId }),
    []
  );

  const isTurnStale = useCallback(
    (snapshot: TurnEpochSnapshot): boolean =>
      isTurnEpochStale(turnEpochTrackerRef.current, snapshot),
    []
  );

  /**
   * 统一封装带异常捕获与用户可见提示的 ACP 会话清理调用，杜绝 fire-and-forget 未捕获 Promise rejection
   */
  const safelyClearAcpSessions = useCallback(
    async (agentId?: string, sessionKeyPrefix?: string, contextLabel: string = '会话清理') => {
      try {
        await clearAcpAgentSessions(agentId, sessionKeyPrefix);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[App] ${contextLabel}时清理底层 ACP 会话失败:`, err);
        setSessionCleanupNotice(`⚠️ ${contextLabel}清理底层 ACP 会话异常：${detail}`);
        setTimeout(() => {
          setSessionCleanupNotice((prev) => (prev && prev.includes(contextLabel) ? null : prev));
        }, 5000);
      }
    },
    []
  );

  /**
   * 同步更新 messagesRef.current 并提交 React 状态更新 (Commit Messages Synchronously)
   *
   * 根因防御：在 React 18/19 自动批处理下，若先调用了 setActiveExecutions 等其他 setState，
   * 紧随其后的 setMessages(prev => ...) 不会同步执行 updater，而是推迟至下一轮渲染。
   * 这会导致 Promise.allSettled 微任务立即进入下一跳时，messagesRef.current 缺失刚刚产出的触发消息。
   * 通过在调用 setMessages 前同步对 messagesRef.current 执行幂等更新，确保任意同步/微任务时刻读取的快照均包含最新消息。
   */
  const commitMessages = (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => {
    messagesRef.current = updater(messagesRef.current);
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  };

  // 对标 Buzz: 记录每个会话/房间与 Agent 之间的立足上下文 (Standing Context) 交付状态与持久化
  // 保证整套平台公约与团队花名册只在 Session 建立时/第 1 轮传递，后续日常交互与应用重启恢复均为纯净指令
  const loadSavedDeliveredStandingContext = (): Set<string> => {
    try {
      const raw = localStorage.getItem('shinobi_delivered_standing_context');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch {}
    return new Set();
  };

  const loadSavedSessionWatermarks = (): Map<string, string> => {
    try {
      const raw = localStorage.getItem('shinobi_session_watermarks');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Map(parsed);
        }
      }
    } catch {}
    return new Map();
  };

  const deliveredStandingContextRef = useRef<Set<string>>(loadSavedDeliveredStandingContext());
  // 对标 Buzz queue.rs: 记录每个 (roomId:agentId) 会话已投递的最新消息水位线 ID (Watermark)
  // 热会话后续唤醒与重启 resume 时仅冲刷水位线之后的未读增量事件批次 (<delta-events>)，避免重复复读历史背景
  const sessionWatermarksRef = useRef<Map<string, string>>(loadSavedSessionWatermarks());

  const persistSessionWarmState = () => {
    try {
      localStorage.setItem(
        'shinobi_delivered_standing_context',
        JSON.stringify(Array.from(deliveredStandingContextRef.current))
      );
      localStorage.setItem(
        'shinobi_session_watermarks',
        JSON.stringify(Array.from(sessionWatermarksRef.current.entries()))
      );
    } catch {}
  };

  const clearSessionWarmScope = (scope: Parameters<typeof matchesSessionScope>[1]) => {
    Array.from(deliveredStandingContextRef.current).forEach((key) => {
      if (matchesSessionScope(key, scope)) {
        deliveredStandingContextRef.current.delete(key);
      }
    });
    Array.from(sessionWatermarksRef.current.keys()).forEach((key) => {
      if (matchesSessionScope(key, scope)) {
        sessionWatermarksRef.current.delete(key);
      }
    });
    persistSessionWarmState();
  };

  const resetAllSessionWarmState = () => {
    deliveredStandingContextRef.current.clear();
    sessionWatermarksRef.current.clear();
    persistSessionWarmState();
  };
  // 记录正在执行中的三元博弈阶段交接，杜绝并发重入与重复下发 Prompt
  const inFlightHandoverRef = useRef<Set<string>>(new Set());
  // 记录各阶段 Self-Refine 重试次数 (硬门禁: 上限为 STAGE_CONTRACT_MAX_RETRIES)
  const stageRefineRetriesRef = useRef<Record<string, number>>({});

  // 提取接地实证真值率 (0.05~0.95，委托给 TieredGroundingGovernor 进行结构化/加权反事实解析)
  const extractGroundedTrueRatio = (verificationText: string): number => {
    return tieredGroundingGovernor.extractGroundedTrueRatio(verificationText);
  };

  const currentUserId = 'user-norris';

  // Computed Context
  const visibleChannels = channels.filter((c) => c.status !== 'deleted');
  const getTopicWorkspaceBinding = (topicId?: string) =>
    findWorkspaceBinding(workspaceBindings, 'topic', topicId);
  const getChannelWorkspaceBinding = (channelId?: string) =>
    findWorkspaceBinding(workspaceBindings, 'channel', channelId);

  // 1. 判断当前是否处于显式私聊模式 (Direct Message Mode)
  const isDirectMessageSelected = activeThreadId.startsWith('thread-dm-') || threads.find((t) => t.id === activeThreadId)?.type === 'dm';

  // 2. 频道解析：若在私聊模式下，强制清空 activeChannel，杜绝任何频道上下文与成员名单穿透至私聊
  const activeChannel = isDirectMessageSelected
    ? null
    : (channels.find((c) => c.id === activeChannelId && c.status !== 'deleted') || visibleChannels[0] || null);

  // 3. 线程解析：
  // - 若为私聊模式，严格锁定对应 dmThread，严禁回退至任何频道线程；
  // - 若为频道模式，严格只在该频道所属线程中查找，彻底废除 threads[0] 的盲目 cross-fallback
  const activeThread = useMemo(() => {
    const rawThread = isDirectMessageSelected
      ? (threads.find((t) => t.id === activeThreadId && t.type === 'dm') ||
         threads.find((t) => t.type === 'dm') ||
         null)
      : ((activeChannel ? threads.find((t) => t.id === activeThreadId && t.channelId === activeChannel.id && t.type !== 'dm') : null) ||
         (activeChannel ? threads.find((t) => t.channelId === activeChannel.id && t.type !== 'dm') : null) ||
         null);
    if (!rawThread) return null;
    if (rawThread.type === 'dm') {
      const dmAgent = agents.find((a) => a.id === rawThread.authorId || rawThread.id === `thread-dm-${a.id}`);
      if (dmAgent) {
        return {
          ...rawThread,
          channelId: '',
          authorName: dmAgent.name,
          authorAvatar: dmAgent.avatar,
          authorHandle: dmAgent.handle,
          title: `与 ${dmAgent.name} 的私信会话`,
          channelName: `与 ${dmAgent.name} 私聊`,
        };
      }
    }
    return rawThread;
  }, [isDirectMessageSelected, threads, activeThreadId, activeChannel, agents]);

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
    const memberIds = new Set(activeChannel.memberIds);
    return agents.filter((a) => memberIds.has(a.id));
  }, [activeChannel, agents]);

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
              const remoteSupportsLoad = match.supportsLoadSession ?? match.supports_load_session;
              const remoteSupportsResume = match.supportsResumeSession ?? match.supports_resume_session;
              const hasLoadChanged =
                remoteSupportsLoad !== undefined &&
                remoteSupportsLoad !== null &&
                a.capabilities?.supportsLoadSession !== remoteSupportsLoad;
              const hasResumeChanged =
                remoteSupportsResume !== undefined &&
                remoteSupportsResume !== null &&
                a.capabilities?.supportsResumeSession !== remoteSupportsResume;
              if (a.status !== targetStatus || a.statusDetail !== targetDetail || hasLoadChanged || hasResumeChanged) {
                hasChange = true;
                return {
                  ...a,
                  status: targetStatus,
                  statusDetail: targetDetail,
                  capabilities: {
                    ...(a.capabilities || {
                      canUseInternalMemory: true,
                      canAccessWorkspaceFiles: true,
                      canExecuteSkills: true,
                      canDelegateToSubAgents: true,
                      supportsStreaming: true,
                    }),
                    ...(remoteSupportsLoad !== undefined && remoteSupportsLoad !== null
                      ? { supportsLoadSession: remoteSupportsLoad }
                      : {}),
                    ...(remoteSupportsResume !== undefined && remoteSupportsResume !== null
                      ? { supportsResumeSession: remoteSupportsResume }
                      : {}),
                  },
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

  // 启动本地 ACP Agent 进程（Tauri stdio 拉起 / Web 运行时平滑转入）
  const spawnLocalAcpAgent = useCallback(
    async (agent: Agent) => {
      const resolvedConfig = resolveAgentModelConfig(agent);

      // 启动 Agent 进程: 初始设为 starting 握手过渡态
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id ? { ...a, status: 'starting', statusDetail: 'ACP 进程启动与协议握手中...' } : a
        )
      );

      const tauriInvoke =
        (window as any).__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke;
      if (typeof window !== 'undefined' && tauriInvoke) {
        try {
          await tauriInvoke('spawn_acp_agent', {
            agentId: agent.id,
            command: agent.acpCommandOrUrl,
            cwd: agent.workspace?.rootPath || '~/.shadow-crew',
            envVars: buildAgentLaunchEnv(agent),
          });
          syncRunningAgentsWithBackend();
        } catch (err: any) {
          console.warn('Spawn agent error:', err);
          setAgents((prev) =>
            prev.map((a) =>
              a.id === agent.id ? { ...a, status: 'error', statusDetail: String(err) } : a
            )
          );
        }
      } else {
        // Web 浏览器环境：平滑转入 running，接入 Web LLM 运行时
        setTimeout(() => {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === agent.id
                ? {
                    ...a,
                    status: 'running',
                    statusDetail: `就绪 · ${resolvedConfig.modelName || resolvedConfig.modelId} (Web 运行时)`,
                  }
                : a
            )
          );
        }, 500);
      }
    },
    [syncRunningAgentsWithBackend]
  );

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
        // 当 Agent 停止或断开连接时，仅更新 UI 状态为 idle，严禁静默销毁已持久化的会话与水位线，
        // 确保 Agent 重新连接后能优先通过 Layer 1 (session/load) 原地恢复会话上下文
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

    let unlistenSessionReset: (() => void) | undefined;
    tauriListen('acp:session_reset', (event: any) => {
      const payload = event?.payload;
      if (payload) {
        // 当底层确认触发 session/new (未命中或不支持 session/load 时)，重置该会话的水位线与公约挂载标记，
        // 使得 Layer 2 平台层在 Prompt 编译时自动注入增量与历史补偿
        if (payload.session_key) {
          deliveredStandingContextRef.current.delete(payload.session_key);
          sessionWatermarksRef.current.delete(payload.session_key);
          if (payload.agent_id) {
            const compoundKey = `${payload.session_key}:${payload.agent_id}`;
            deliveredStandingContextRef.current.delete(compoundKey);
            sessionWatermarksRef.current.delete(compoundKey);
          }
        } else if (payload.agent_id) {
          clearSessionWarmScope({ agentId: payload.agent_id });
          return;
        }
        persistSessionWarmState();
      }
    }).then((fn: any) => {
      unlistenSessionReset = fn;
    }).catch(() => {});

    let unlistenReplaySink: (() => void) | undefined;
    tauriListen('acp:replay_sink', (event: any) => {
      const payload = event?.payload;
      if (!payload || !payload.room_id || !Array.isArray(payload.messages)) return;
      const { room_id, messages: replayedMsgs } = payload;
      if (replayedMsgs.length === 0) return;

      commitMessages((prev) => {
        const existing = prev[room_id] || [];
        const existingIds = new Set(existing.map((m) => m.id));
        // 关键 Replay Sink 规约：按 messageId 严格幂等去重，仅补入本地缺少的历史条目
        const missing = replayedMsgs.filter((rm: any) => rm.messageId && !existingIds.has(rm.messageId));
        if (missing.length === 0) return prev;

        const agentMeta = agentsRef.current.find((a) => a.id === payload.agent_id);
        const converted: Message[] = missing.map((rm: any) => ({
          id: rm.messageId,
          threadId: room_id,
          authorId: rm.role === 'user' ? 'user' : (payload.agent_id || 'agent'),
          authorName: rm.role === 'user' ? 'User' : (agentMeta?.name || 'Agent'),
          authorHandle: rm.role === 'user' ? undefined : agentMeta?.handle,
          authorAvatar: rm.role === 'user' ? undefined : agentMeta?.avatar,
          isAgent: rm.role !== 'user',
          agentBadge: rm.role === 'user' ? undefined : `${agentMeta?.modelBadge?.split(' ')[0] || 'Local'} · Replay`,
          timestamp: new Date(rm.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: rm.content || '',
          isPending: false,
        }));

        // 绝不将历史回放追加到正在思考生成的 pending 消息中，与实时推演彻底解耦
        const nonPending = existing.filter((m) => !m.isPending);
        const pending = existing.filter((m) => m.isPending);
        return {
          ...prev,
          [room_id]: [...nonPending, ...converted, ...pending],
        };
      });
    }).then((fn: any) => {
      unlistenReplaySink = fn;
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
      if (unlistenSessionReset) unlistenSessionReset();
      if (unlistenReplaySink) unlistenReplaySink();
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
    let dmThread = threads.find((t) => t.type === 'dm' && (t.authorId === agent.id || t.id === `thread-dm-${agent.id}`));

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
            content: `你好！我是 **${agent.name}**。ACP 独立进程已就绪，当前挂载协议通道：\`${agent.acpTransport}\`，专属产物工作区：\`~/.shadow-crew/agents/${agent.id}/artifacts/\`。随时可以开始讨论。`,
          },
        ],
      }));
    } else {
      // If dmThread already exists, ensure its metadata matches the latest agent profile
      if (
        dmThread.channelId !== '' ||
        dmThread.authorAvatar !== agent.avatar ||
        dmThread.authorName !== agent.name ||
        dmThread.authorHandle !== agent.handle
      ) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === dmThread!.id
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
      messagesRef,
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
      safelyClearAcpSessions(undefined, `channel:${channelId}`, '删除频道'),
      safelyClearAcpSessions(undefined, `topic:${channelId}`, '删除频道'),
    ]);
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
      acpCommandOrUrl: guestAgent.acpCommandOrUrl || './target/debug/shadow-crew-agent',
      protocolVersion: '2025-01-01 (ACP v1.0.4)',
      capabilities: guestAgent.capabilities || {
        canUseInternalMemory: true,
        canAccessWorkspaceFiles: true,
        canExecuteSkills: true,
        canDelegateToSubAgents: true,
        supportsStreaming: true,
      },
      workspace: guestAgent.workspace || {
        rootPath: '~/.shadow-crew',
        repoName: 'shadow-crew-workspace',
        gitBranch: 'main',
        permissionMode: 'full_read_write',
        activeFiles: ['~/.shadow-crew/global_memory.sqlite'],
      },
      envVars: guestAgent.envVars || [],
      skills: [],
      memory: guestAgent.memory || {
        internalMemoryPath: '~/.shadow-crew/global_memory.sqlite',
        persistentType: 'sqlite',
        persistentItems: [],
        sessionCacheCount: 0,
      },
    };
    setAgents((prev) => [...prev, fullAgent]);
  };

  // Handle Creation of New Channel
  const handleCreateChannel = async (
    newChan: Omit<Channel, 'id' | 'unreadCount' | 'workspaceBindingId'>,
    workspace: { mode: 'default' | 'custom'; cwd?: string }
  ) => {
    const id = `channel-${Date.now()}`;
    const requestedCwd = workspace.mode === 'default'
      ? getDefaultChannelCwd(id)
      : workspace.cwd || '';
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
          content: `欢迎进入 **#${created.name}** 协同频道！${created.description ? `\n- **频道简介**：${created.description}` : ''}\n${created.assignedAgentIds && created.assignedAgentIds.length > 0 ? `- **在场 Agent**：${created.assignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、')} 已就绪` : '- **当前成员**：仅您本人在频道中，可点击右上角「邀请/管理 Agent」随时添加协作伙伴'}\n- **使用提示**：在下方输入框直接 \`@Agent\` 即可自由交流，或点击右上角 **「+ 新建议题」** 开启结构化专题讨论。`,
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

  const handleCreateTopic = async (
    topicData: {
      title: string;
      description: string;
      assignedAgentIds: string[];
      discussionMode?: DiscussionMode;
      gameRoles?: GameRolesConfig;
    },
    workspace: { mode: 'default' | 'channel_snapshot' | 'custom'; cwd?: string }
  ) => {
    if (!activeChannel) return; // 私聊模式下不创建频道议题
    const channelBinding = findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id);
    if (!channelBinding) {
      throw new Error(`频道 ${activeChannel.name} 缺少 Workspace Binding，无法创建议题`);
    }
    const topicId = `topic-${Date.now()}`;
    const requestedCwd = workspace.mode === 'default'
      ? getDefaultTopicCwd(activeChannel.id, topicId)
      : workspace.mode === 'channel_snapshot'
        ? channelBinding.cwd
        : workspace.cwd || '';
    const resolvedCwd = await resolveWorkspaceCwd(requestedCwd, workspace.mode === 'default');
    const topicBinding = createTopicBinding({
      topicId,
      channelId: activeChannel.id,
      mode: workspace.mode,
      channelBinding,
      cwd: resolvedCwd,
    });
    const validAssignedAgentIds = topicData.assignedAgentIds.filter((id) =>
      currentChannelAgents.some((a) => a.id === id)
    );
    const isGame = topicData.discussionMode === 'game_theoretic';
    const modelDiversity = isGame && topicData.gameRoles
      ? calculateModelDiversity(agents, topicData.gameRoles)
      : undefined;
    const initialModularState = isGame
      ? initializeModularOrchestrationState(
          buildDefaultDecompositionFromTopic(topicData.title, topicData.description)
        )
      : undefined;

    const newTopic: TopicMessageData = {
      id: topicId,
      channelId: activeChannel.id,
      workspaceBindingId: topicBinding.id,
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

    const verifiersSummary = topicData.gameRoles?.verifiers && topicData.gameRoles.verifiers.length > 0
      ? `\n- 🔍 接地者：${topicData.gameRoles.verifiers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}`
      : '';

    const diversityWarning = modelDiversity?.isHomogeneous && modelDiversity.warnings.length > 0
      ? `\n\n${modelDiversity.warnings[0]}`
      : '';

    const initContent = isGame && topicData.gameRoles
      ? `已发起 4+1 认知协同决策议题【${topicData.title}】。\n目标背景：${topicData.description || '开始架构决策攻防推演。'}\n【4+1 协同角色配置】：\n- 🏛️ 提案者：${topicData.gameRoles.proposers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- ⚔️ 红队对抗：${topicData.gameRoles.challengers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}${verifiersSummary}\n- ⚖️ 流程综合：${topicData.gameRoles.arbiters.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- 👤 终局裁判：${topicData.gameRoles.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌)' : '已委派 AI 综合仲裁'}${diversityWarning}`
      : `已发起议题【${topicData.title}】。\n目标背景：${topicData.description || '开始方案推演。'}\n指派 Agent：${validAssignedAgentIds.length > 0 ? validAssignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、') : '暂无 (可在抽屉中指派)'}。`;

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
    setEditingTopic(null);
    if (targetTopicChanId) {
      void safelyClearAcpSessions(
        undefined,
        `topic:${targetTopicChanId}:${topicId}`,
        '更新议题成员'
      );
    }
  };

  // 多智能体跨 Agent 互相 @ 与自主级联调度器 (Turn Barrier + Mention Deduplication + Watermark Delta Dispatcher)
  const dispatchCascadingAgentResponse = async (options: {
    cascadeId: string;
    invokingAgent?: Agent;
    invokingMessageId?: string;
    replyContent?: string;
    turnOutputs?: TurnAgentOutput[];
    roomId: string;
    isTopic: boolean;
    topicId?: string;
    queuedCollaborators?: Agent[];
  }) => {
    const {
      cascadeId,
      invokingAgent,
      invokingMessageId,
      replyContent,
      turnOutputs,
      roomId,
      isTopic,
      topicId,
      queuedCollaborators = [],
    } = options;
    const cascade = activeCascadesRef.current[cascadeId];
    if (!cascade || cascade.isAborted) return;

    const effectiveTurnOutputs: TurnAgentOutput[] =
      turnOutputs && turnOutputs.length > 0
        ? turnOutputs
        : invokingAgent
        ? [
            {
              agent: invokingAgent,
              messageId: invokingMessageId || cascade.rootMessageId,
              replyContent: replyContent || '',
            },
          ]
        : [];

    if (effectiveTurnOutputs.length === 0) return;

    // 获取当前频道/议题准入的候选 Agent 列表 (严格限制在当前频道或议题范围内)
    const currentChannelAgentIds = Array.from(
      new Set([
        ...(activeChannel?.assignedAgentIds || []),
        ...(activeChannel?.memberIds || []),
        ...(activeThread?.activeAgentIds || []),
      ])
    );
    const channelAgents = currentChannelAgentIds
      .map((id) => agentsRef.current.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));

    const currentTopicObj = isTopic && topicId ? getTopicData(topicId) || activeTopicData : activeTopicData;
    const sessionWorkspaceBinding = isTopic
      ? getTopicWorkspaceBinding(currentTopicObj?.id)
      : getChannelWorkspaceBinding(activeChannel?.id);
    const topicAgents =
      isTopic && topicId
        ? (currentTopicObj?.participatingAgentIds || [])
            .map((id) => agentsRef.current.find((a) => a.id === id))
            .filter((a): a is Agent => Boolean(a))
            .filter((a) => channelAgents.some((ca) => ca.id === a.id))
        : [];

    const candidateAgents =
      topicAgents.length > 0
        ? topicAgents
        : activeThread.type === 'dm'
        ? agentsRef.current.filter(
            (a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id)
          )
        : channelAgents;

    const topicTargetChannel = isTopic
      ? channels.find((c) => c.id === currentTopicObj?.channelId) || activeChannel
      : activeChannel;
    const targetChannelId = isTopic
      ? topicTargetChannel?.id || activeChannel?.id
      : activeThread?.type === 'dm'
      ? undefined
      : activeChannel?.id;

    // 1. 轮次同步屏障 (Turn Barrier) 汇总解析本轮所有并发发言中的 @mention 并去重合并
    const barrierResolution = aggregateTurnBarrierMentions({
      turnOutputs: effectiveTurnOutputs,
      candidateAgents,
      allWorkspaceAgents: agentsRef.current,
      isDm: activeThread.type === 'dm',
      queuedCollaborators,
    });

    // 渲染未受邀外部 Agent 的越界点名拦截提示
    if (barrierResolution.uninvitedMentions.length > 0) {
      const guardMessages: Message[] = barrierResolution.uninvitedMentions.map((u, idx) => ({
        id: `channel-guard-${Date.now()}-${idx}`,
        threadId: roomId,
        channelId: targetChannelId,
        authorId: 'system',
        authorName: 'Shadow Crew 频道隔离守护',
        authorHandle: '@channel-guard',
        authorAvatar: '🔒',
        isAgent: true,
        kind: 'guard',
        agentBadge: 'Channel Guard',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `🔒 **频道准入拦截**：${u.invokingAgent.name} 尝试点名了 ${u.uninvitedAgents.map((a) => `@${a.name} (${a.handle})`).join('、')}，但该 Agent **未加入当前频道**。\n\n根据受邀准入原则，未受邀成员无法跨频道接收协同调度。如需其参与推演，请点击右上角「成员管理」邀请入驻。`,
      }));
      setMessages((prev) => {
        const nextList = [...(prev[roomId] || []), ...guardMessages];
        const next = { ...prev, [roomId]: nextList };
        messagesRef.current = next;
        return next;
      });
    }

    const hadExplicitMentions = effectiveTurnOutputs.some(
      (o) => parseAgentMentions(o.replyContent, candidateAgents, o.agent.id).length > 0
    );
    const remainingQueued =
      !hadExplicitMentions && queuedCollaborators.length > 0 ? queuedCollaborators.slice(1) : queuedCollaborators;

    if (barrierResolution.nextTargets.length === 0) {
      // 协同链自然收敛结束 (Silence as Success)
      setActiveCascades((prev) => {
        const next = { ...prev };
        delete next[cascadeId];
        return next;
      });
      return;
    }

    // 2. 筛选在线且通过 LoopGuard 检查的目标 Agent
    const allowedTargets: AggregatedMentionTarget[] = [];

    for (const item of barrierResolution.nextTargets) {
      const targetAgent = item.targetAgent;

      if (isAgentOffline(targetAgent)) {
        const offlineNotice: Message = {
          id: `msg-offline-collab-${Date.now()}-${targetAgent.id}`,
          threadId: roomId,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shadow Crew 通信管控',
          authorHandle: '@connection-guard',
          authorAvatar: '🔌',
          isAgent: true,
          kind: 'system_control',
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **Agent 通信尚未开启**：协同目标 **${targetAgent.name}** 当前处于离线/未连接状态，无法接力推演。需先在左侧控制面板点击【Start】开启通信。`,
        };
        setMessages((prev) => {
          const next = { ...prev, [roomId]: [...(prev[roomId] || []), offlineNotice] };
          messagesRef.current = next;
          return next;
        });
        continue;
      }

      const loopCheck = checkLoopGuard(cascade, targetAgent.id);
      if (!loopCheck.allowed) {
        console.log(`[CollaborationCascade] Cascade ${cascadeId} target ${targetAgent.name} terminated:`, loopCheck.reason);
        if (!loopCheck.isSilentEnd) {
          const breakMsg: Message = {
            id: `circuit-break-${Date.now()}-${targetAgent.id}`,
            threadId: roomId,
            channelId: targetChannelId,
            authorId: 'system',
            authorName: 'Shadow Crew 协同管控',
            authorHandle: '@loop-guard',
            authorAvatar: '🛡️',
            isAgent: true,
            kind: 'guard',
            agentBadge: 'Circuit Breaker',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚡ **多智能体协同已停止**：${loopCheck.reason}`,
            collaborationInfo: {
              cascadeId,
              hop: cascade.depth,
              maxHops: cascade.maxDepth,
              rootMessageId: cascade.rootMessageId,
              sourceMessageId: item.sourceMessageIds[0] || cascade.rootMessageId,
              isCircuitBroken: true,
              circuitBreakReason: loopCheck.reason,
            },
          };
          setMessages((prev) => {
            const next = { ...prev, [roomId]: [...(prev[roomId] || []), breakMsg] };
            messagesRef.current = next;
            return next;
          });
        }
        continue;
      }

      allowedTargets.push(item);
    }

    if (allowedTargets.length === 0) {
      if (remainingQueued.length > 0 && remainingQueued.length < queuedCollaborators.length) {
        const fallbackOutput = effectiveTurnOutputs[effectiveTurnOutputs.length - 1];
        dispatchCascadingAgentResponse({
          cascadeId,
          turnOutputs: [fallbackOutput],
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

    // 3. 更新 Cascade 状态 (推进 Hop 深度并记录本轮所有去重后的被唤醒 Agent)
    const nextDepth = cascade.depth + 1;
    const nextCallCounts = { ...cascade.agentCallCounts };
    for (const item of allowedTargets) {
      nextCallCounts[item.targetAgent.id] = (nextCallCounts[item.targetAgent.id] || 0) + 1;
    }

    const updatedCascade: CollaborationCascade = {
      ...cascade,
      depth: nextDepth,
      visitedAgentIds: [...cascade.visitedAgentIds, ...allowedTargets.map((t) => t.targetAgent.id)],
      agentCallCounts: nextCallCounts,
    };

    activeCascadesRef.current = {
      ...activeCascadesRef.current,
      [cascadeId]: updatedCascade,
    };
    setActiveCascades((prev) => ({
      ...prev,
      [cascadeId]: updatedCascade,
    }));

    const topicContext: TopicPromptContext | undefined =
      isTopic && currentTopicObj
        ? {
            topicId: currentTopicObj.id,
            title: currentTopicObj.title,
            description: currentTopicObj.description,
            channelName: topicTargetChannel?.name || 'chat',
            status: currentTopicObj.status,
            discussionMode: currentTopicObj.discussionMode,
            gameRoles: currentTopicObj.gameRoles,
            participatingAgents: candidateAgents,
          }
        : undefined;

    setIsGenerating(true);
    const newExecs: Record<string, ActiveAgentExecution> = {};
    allowedTargets.forEach((item, idx) => {
      const targetAgent = item.targetAgent;
      const execKey = isTopic && topicId ? `${topicId}:${targetAgent.id}` : `${roomId}:${targetAgent.id}`;
      const invokerNames = item.invokingAgents.map((a) => `@${a.name}`).join('、');
      newExecs[execKey] = {
        agentId: targetAgent.id,
        agentName: targetAgent.name,
        agentAvatar: targetAgent.avatar,
        threadId: roomId,
        topicId: isTopic ? topicId : undefined,
        status: 'thinking',
        currentActionDetail: `正在响应 ${invokerNames} 的协同研讨 (Hop ${nextDepth}/${cascade.maxDepth})...`,
        startedAt: Date.now() + idx * 50,
        cascadeHop: nextDepth,
        invokingAgentName: item.invokingAgents.map((a) => a.name).join(' & '),
      };
    });

    setActiveExecutions((prev) => ({
      ...prev,
      ...newExecs,
    }));

    setAgents((prev) =>
      prev.map((a) =>
        allowedTargets.some((t) => t.targetAgent.id === a.id) && a.status !== 'running'
          ? { ...a, status: 'running' }
          : a
      )
    );

    // 4. 并行派发本跳所有去重后的目标 Agent，并在全部完成后进入下一道 Turn Barrier
    const hopOutputs: TurnAgentOutput[] = [];
    const cascadeTurnSnapshot = captureTurnEpoch(roomId, targetChannelId);

    await Promise.allSettled(
      allowedTargets.map(async (item) => {
        const { targetAgent, invokingAgents, sourceMessageIds, combinedReplies } = item;
        const agentSnapshot = captureTurnEpoch(roomId, targetChannelId, targetAgent.id);
        const primaryInvoker = invokingAgents[0] || effectiveTurnOutputs[0].agent;
        const execKey = isTopic && topicId ? `${topicId}:${targetAgent.id}` : `${roomId}:${targetAgent.id}`;
        const isDm = activeThread?.type === 'dm';
        const sessionKey = buildAgentSessionKey({
          agentId: targetAgent.id,
          roomId,
          channelId: targetChannelId,
          isDm,
          discussionMode: currentTopicObj?.discussionMode,
          workspaceBindingId: sessionWorkspaceBinding?.id,
          scopeType: activeThread.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
        });

        const preflightSystemPrompt = buildCompositeSystemPrompt({
          agent: targetAgent,
          availableAgents: candidateAgents,
          includeRoster: !isDm,
        });

        const triggerMsgIds = new Set(sourceMessageIds || []);
        const priorRoomMessages = (messagesRef.current[roomId] || []).filter(
          (m) => !m.isPending && (m.content?.trim() || m.thinkingProcess) && !triggerMsgIds.has(m.id)
        );
        const localHistoryIntact = priorRoomMessages.length > 0;

        let sessionPreflight: { isNew: boolean; recoveryMode?: 'resume' | 'load' | 'new' } | null = null;
        try {
          sessionPreflight = await ensureAcpAgentSession({
            agentId: targetAgent.id,
            roomId,
            channelId: targetChannelId,
            systemPrompt: preflightSystemPrompt,
            discussionMode: currentTopicObj?.discussionMode,
            workspaceBindingId: sessionWorkspaceBinding?.id,
            workspaceCwd: sessionWorkspaceBinding?.cwd,
            scopeType: activeThread.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
            localHistoryIntact,
          });
        } catch (err) {
          console.error(`[NormalTurn] Preflight ensureAcpAgentSession failed for ${targetAgent.name}:`, err);
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'idle' } : a)));
          syncRunningAgentsWithBackend();
          const errorReply: Message = {
            id: `msg-collab-err-${Date.now()}-${targetAgent.id}`,
            threadId: roomId,
            channelId: targetChannelId,
            authorId: targetAgent.id,
            authorName: targetAgent.name,
            authorHandle: targetAgent.handle,
            authorAvatar: targetAgent.avatar,
            isAgent: true,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}`,
          };
          commitMessages((prev) => {
            const existing = prev[roomId] || [];
            const nextRoomMsgs = existing.some((m) => m.id === errorReply.id)
              ? existing
              : [...existing, errorReply];
            return {
              ...prev,
              [roomId]: nextRoomMsgs,
            };
          });
          return;
        }

        if (sessionPreflight?.isNew || sessionPreflight?.recoveryMode === 'new') {
          deliveredStandingContextRef.current.delete(sessionKey);
          sessionWatermarksRef.current.delete(sessionKey);
          persistSessionWarmState();
        } else if (
          sessionPreflight?.recoveryMode === 'resume' ||
          sessionPreflight?.recoveryMode === 'load'
        ) {
          deliveredStandingContextRef.current.add(sessionKey);
          if (!sessionWatermarksRef.current.has(sessionKey)) {
            const transcript = messagesRef.current[roomId] || [];
            const lastPriorMsg = transcript
              .slice()
              .reverse()
              .find((m) => !m.isPending && !triggerMsgIds.has(m.id));
            if (lastPriorMsg) {
              sessionWatermarksRef.current.set(sessionKey, lastPriorMsg.id);
            }
          }
          persistSessionWarmState();
        }

        const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);
        const systemPrompt = buildCompositeSystemPrompt({
          agent: targetAgent,
          availableAgents: candidateAgents,
          includeRoster: !isStandingContextDelivered,
        });
        deliveredStandingContextRef.current.add(sessionKey);
        persistSessionWarmState();

        // 对标 Buzz queue.rs: 基于该 Agent 在当前会话的水位线提取未读增量事件批次 (<delta-events>)
        // 同时将本轮触发输出 effectiveTurnOutputs 显式合并入快照（按消息 ID 幂等去重），彻底消除异步批处理导致的漏读竞态
        const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
        const roomTranscript = messagesRef.current[roomId] || [];
        const deltaBatch = extractUnreadDeltaMessages({
          messages: roomTranscript,
          turnOutputs: effectiveTurnOutputs,
          lastWatermarkMessageId: lastWatermark,
          coldStartSinceMessageId: !isTopic ? cascade.rootMessageId : undefined,
          excludeAuthorId: targetAgent.id,
        });
        if (deltaBatch.latestWatermarkMessageId) {
          sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
          persistSessionWarmState();
        }

        const latestTriggerReplyContent =
          combinedReplies.length > 0
            ? combinedReplies[combinedReplies.length - 1].content
            : effectiveTurnOutputs[effectiveTurnOutputs.length - 1]?.replyContent || '';

        const cascadePrompt = buildNormalModeTurnPrompt({
          targetAgent,
          availableAgents: candidateAgents,
          roomId,
          isWarmSession: deltaBatch.isWarmSession,
          deltaMessages: deltaBatch.deltaMessages,
          triggerContent: latestTriggerReplyContent,
          hop: nextDepth,
          maxHops: cascade.maxDepth,
          invokingAgents,
          topic: topicContext,
          isDm: false,
        });

        try {
          const acpResp = await sendPromptToAcpAgent({
            agent: targetAgent,
            roomId,
            prompt: cascadePrompt,
            channelId: targetChannelId,
            workspaceBindingId: sessionWorkspaceBinding?.id,
            workspaceCwd: sessionWorkspaceBinding?.cwd,
            scopeType: activeThread.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
            systemPrompt,
            discussionMode: currentTopicObj?.discussionMode,
          });

          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(agentSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
            console.log('[App] Dropping cascading agent reply because history was cleared or cascade aborted');
            return;
          }

          const nextReply: Message = {
            id: `msg-collab-${Date.now()}-${targetAgent.id}`,
            threadId: roomId,
            channelId: targetChannelId,
            authorId: targetAgent.id,
            authorName: targetAgent.name,
            authorHandle: targetAgent.handle,
            authorAvatar: targetAgent.avatar,
            isAgent: true,
            agentBadge: `${targetAgent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : targetAgent.isRemote ? 'ACP Remote' : 'ACP'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已基于增量上下文批次完成审查与规约对齐'),
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
            collaborationInfo: {
              cascadeId,
              hop: nextDepth,
              maxHops: cascade.maxDepth,
              rootMessageId: cascade.rootMessageId,
              sourceMessageId: sourceMessageIds[0] || cascade.rootMessageId,
              invokedByAgentId: primaryInvoker.id,
              invokedByAgentName: invokingAgents.map((a) => a.name).join(' & '),
              invokedByAgentHandle: primaryInvoker.handle,
            },
          };

          if (isTopic && topicId) {
            commitMessages((prev) => {
              const existing = prev[topicId] || [];
              const nextTopicMsgs = existing.some((m) => m.id === nextReply.id)
                ? existing
                : [...existing, nextReply];

              let parentThreadId: string | null = null;
              for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
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
                          repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
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
            commitMessages((prev) => {
              const existing = prev[roomId] || [];
              const nextRoomMsgs = existing.some((m) => m.id === nextReply.id)
                ? existing
                : [...existing, nextReply];
              return {
                ...prev,
                [roomId]: nextRoomMsgs,
              };
            });
          }

          setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'running' } : a)));
          syncRunningAgentsWithBackend();

          hopOutputs.push({
            agent: targetAgent,
            messageId: nextReply.id,
            replyContent: acpResp.textResponse,
          });
        } catch (err) {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(agentSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
            console.log('[App] Dropping cascading agent error because history was cleared or cascade aborted');
            return;
          }

          console.error('Cascading agent dispatch failed:', err);
          const errorReply: Message = {
            id: `msg-collab-err-${Date.now()}-${targetAgent.id}`,
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
          commitMessages((prev) => {
            const existing = prev[roomId] || [];
            const nextRoomMsgs = existing.some((m) => m.id === errorReply.id)
              ? existing
              : [...existing, errorReply];
            return {
              ...prev,
              [roomId]: nextRoomMsgs,
            };
          });
        }
      })
    );

    // 5. 本跳同步屏障 (Turn Barrier) 汇合完成后，进入下一跳评估
    if (isTurnStale(cascadeTurnSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
      setActiveCascades((prev) => {
        const next = { ...prev };
        delete next[cascadeId];
        return next;
      });
      return;
    }

    if (hopOutputs.length > 0) {
      await dispatchCascadingAgentResponse({
        cascadeId,
        turnOutputs: hopOutputs,
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
    const applyUpdate = (source: Record<string, Message[]>): Record<string, Message[]> => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of (Object.entries(source) as [string, Message[]][])) {
        if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
          parentThreadId = tId;
          break;
        }
      }
      if (!parentThreadId) return source;
      return {
        ...source,
        [parentThreadId]: (source[parentThreadId] || []).map((m) => {
          if (m.type === 'topic' && m.topicData?.id === topicId) {
            return {
              ...m,
              topicData: updater(m.topicData),
            };
          }
          return m;
        }),
      };
    };

    // 同步立即更新 messagesRef.current，确保紧随其后的 triggerGameTheoreticStageHandover 立即读取到最新状态 (N1)
    messagesRef.current = applyUpdate(messagesRef.current);
    setMessages((prev) => {
      const next = applyUpdate(prev);
      messagesRef.current = next;
      return next;
    });
  };

  const triggerGameTheoreticStageHandover = async (options: {
    topicId: string;
    nextStage: 'proposal' | 'challenge' | 'verification' | 'defense' | 'arbitration';
    targetProposalText?: string;
    targetChallengeText?: string;
    targetVerificationText?: string;
    targetDefenseText?: string;
  }) => {
    const { topicId, nextStage, targetProposalText, targetChallengeText, targetVerificationText, targetDefenseText } = options;
    const currentTopic = getTopicData(topicId);
    if (!currentTopic || currentTopic.status === 'resolved') return;
    const turnSnapshot = captureTurnEpoch(topicId, currentTopic.channelId || activeChannel?.id);

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

    // 阶段 1：模块沙箱独立提案立论 (Stage: proposal, N9)
    if (nextStage === 'proposal') {
      const proposerIds = currentTopic.gameRoles?.proposers || [];
      const proposerAgent = candidateAgents.find((a) => proposerIds.includes(a.id)) || candidateAgents[0];

      if (!proposerAgent) {
        inFlightHandoverRef.current.delete(handoverKey);
        console.warn('[GameTheoretic] No proposer agent available for modular proposal handover.');
        return;
      }

      const activeMod = currentTopic.gameTheoreticState?.modularState?.modules.find(
        (m) => m.moduleId === currentTopic.gameTheoreticState?.modularState?.activeModuleId
      );

      const execKey = `${topicId}:${proposerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: proposerAgent.id,
          agentName: proposerAgent.name,
          agentAvatar: proposerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在针对模块 [${activeMod?.title || '新模块'}] 进行沙箱独立提案立论 (Stage: 🏛️ 模块提案)...`,
          startedAt: Date.now(),
          cascadeHop: 1,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === proposerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const proposalPendingId = `topic-pending-${Date.now()}-${proposerAgent.id}`;
      const proposalPendingMsg: Message = {
        id: proposalPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: proposerAgent.id,
        authorName: proposerAgent.name,
        authorHandle: proposerAgent.handle,
        authorAvatar: proposerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: `正在针对模块 [${activeMod?.title || '新模块'}] 进行沙箱独立提案立论 (Stage: 🏛️ 模块提案)...`,
        agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🏛️ 模块提案 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'proposal',
        gameRole: 'proposer',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), proposalPendingMsg],
      }));

      const latestTopicForProposal = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'proposal',
        modularState: latestTopicForProposal.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const proposalPrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: currentTopic.description || currentTopic.title,
        targetAgent: proposerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: proposerAgent,
          roomId: topicId,
          prompt: proposalPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: proposerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          console.warn('Proposer returned empty/error turn in modular proposal, pausing handover.');
          setMessages((prev) => ({
            ...prev,
            [topicId]: (prev[topicId] || []).filter((m) => m.id !== proposalPendingId),
          }));
          inFlightHandoverRef.current.delete(handoverKey);
          return;
        }

        const proposalReply: Message = {
          id: `msg-prop-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🏛️ 模块提案`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, `已基于《公共接口契约》完成模块 [${activeMod?.title || '新模块'}] 独立设计`),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
          gameStage: 'proposal',
          gameRole: 'proposer',
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: (prev[topicId] || []).map((m) => (m.id === proposalPendingId ? proposalReply : m)),
        }));

        // 推进模块状态机进入该模块的验证 (fast_track) 或挑战 (deep_debate) (N8, N9, N10, N12)
        const latestTopicBeforeNext = getTopicData(topicId) || currentTopic;
        const curModular = latestTopicBeforeNext.gameTheoreticState?.modularState;
        let nextModStage: 'challenge' | 'verification' = 'challenge';
        let updatedModularState = curModular;
        let fastTrackNoticeMsg: Message | null = null;
        let isFastTrackBypassed = false;

        // 校验接地验证官可用性，防止 fast_track 无验证官时静默空转至答辩 (N10)
        const hasVerifiers = (currentTopic.gameRoles?.verifiers || []).length > 0;

        if (curModular?.enabled && curModular.activeModuleId) {
          const modStep = stepModularStageTransition({
            state: curModular,
            currentStage: 'proposal',
            feedbackDelta: {},
            proposalOrDefenseSnippet: acpResp.textResponse,
            hasVerifiers,
          });
          nextModStage = modStep.nextGameStage === 'verification' ? 'verification' : 'challenge';
          updatedModularState = {
            ...modStep.nextState,
            modules: modStep.nextState.modules.map((m) =>
              m.moduleId === curModular.activeModuleId
                ? {
                    ...m,
                    scopedMessageIds: [...m.scopedMessageIds, proposalReply.id],
                  }
                : m
            ),
          };

          const activeCurMod = updatedModularState.modules.find(
            (m) => m.moduleId === curModular.activeModuleId
          );
          if (modStep.posteriorAction === 'ESCALATE_TO_RED_TEAM' && activeCurMod) {
            fastTrackNoticeMsg = {
              id: `msg-fast-track-downgrade-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-fast-track',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Fast Track Downgraded',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **快速通道降级告警 (Fast-Track Downgraded)**：模块「${activeCurMod.title}」先验虽符合快速通道标准，但当前议题未指派接地验证官 (Verifier)，无法执行物理接地与静态契约校验。自动降级为标准深度博弈 (deep_debate)，流转至【阶段 2: ⚔️ 反例压测】！`,
              gameStage: 'challenge',
            };
          } else if (nextModStage === 'verification' && activeCurMod) {
            isFastTrackBypassed = true;
            fastTrackNoticeMsg = {
              id: `msg-fast-track-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-fast-track',
              authorAvatar: '⚡',
              isAgent: true,
              agentBadge: 'Fast Track',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚡ **贝叶斯快速通道 (fast_track)**：模块「${activeCurMod.title}」先验风险为 ${(activeCurMod.belief.priorRisk * 100).toFixed(0)}% (< 45%)，符合低熵确定性模块标准。跳过红队对抗，直接流转至接地验证与契约对齐！`,
              gameStage: 'verification',
            };
          }
        }

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: nextModStage,
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: nextModStage,
            targetProposalContent: acpResp.textResponse,
            isChallengerResponded: false,
            isChallengerBypassed: isFastTrackBypassed || old.gameTheoreticState?.isChallengerBypassed,
            challengerBypassedReason: isFastTrackBypassed
              ? 'Bayesian Fast-Track: 模块先验风险低于阈值，依博弈规约旁路红队对抗直接进入接地验证。'
              : old.gameTheoreticState?.challengerBypassedReason,
            isVerifierResponded: false,
            isDefenseResponded: false,
            modularState: updatedModularState,
            cognoNexus: {
              ...old.gameTheoreticState?.cognoNexus,
              modularState: updatedModularState,
            },
          },
        }));

        if (fastTrackNoticeMsg) {
          const notice = fastTrackNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), notice],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: nextModStage,
          targetProposalText: acpResp.textResponse,
        });
        return;
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          return;
        }
        console.error('Modular proposal execution failed:', err);
        setMessages((prev) => ({
          ...prev,
          [topicId]: (prev[topicId] || []).filter((m) => m.id !== proposalPendingId),
        }));
        inFlightHandoverRef.current.delete(handoverKey);
        return;
      }
    }

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

      if (isAgentOffline(challengerAgent)) {
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

      const latestTopicForChallenge = getTopicData(topicId) || currentTopic;
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
        modularState: latestTopicForChallenge.gameTheoreticState?.modularState,
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
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: challengerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

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
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成反例边界与架构证伪推演'),
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

        // CognoNexus 阶段 2: 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('challenge', acpResp.textResponse, challengerAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'challenge',
          agentId: challengerAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:challenge`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '阶段契约未达标，触发 Self-Refine',
              gameStage: 'challenge',
              gameRole: 'challenger',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'challenge',
              targetProposalText,
            });
            return;
          } else {
            // 超过最大重试次数，进入 stageFailed 熔断交人类
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `红队挑战者 (${challengerAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足契约规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'challenge',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：挑战官 ${challengerAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足结构化批判规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'challenger',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:challenge`];

        // 提取论点因果节点、升级为 Claim DAG 与图差分冲突定位 (Wave 3 P1-1)
        const argumentNodes = extractArgumentNodes(targetProposalText);
        const disputePacket = localizeGraphDiffDispute(argumentNodes, acpResp.textResponse);
        const committedStates = dehydrateContextToCommittedStates(targetProposalText, acpResp.textResponse, argumentNodes);

        // 提炼并保留伴生少数派异议报告 (P0-2 Disagreement-Aware Deliberation)
        const minorityReport = compileMinorityReport({
          dissentingAgentId: challengerAgent.id,
          dissentingAgentName: challengerAgent.name,
          dissentingAgentModel: challengerAgent.modelBadge || challengerAgent.modelConfig?.modelId || challengerAgent.modelConfig?.modelName || 'Heterogeneous-LLM',
          critiqueText: acpResp.textResponse,
          proposalText: targetProposalText,
        });

        const sprtScore = estimateRoundAlignmentScore({
          proposalText: targetProposalText,
          critiqueText: acpResp.textResponse,
        });
        // 关键门禁：若存在未验证核心冲突切片，拦截 early_exit (P1-2 / P0-1)
        const hasUnverifiedDispute = Boolean(disputePacket && disputePacket.groundingStatus === 'unverified');
        const sprtState = stepSprtGovernor({
          currentRound: 2,
          alignmentScore: sprtScore,
          hasUnverifiedCriticalDispute: hasUnverifiedDispute,
        });

        // 记录 SPRT 似然比迁移打点 (R-1)
        logGameTheoreticTelemetry('decisionState_transition', topicId, {
          stage: 'challenge',
          decisionState: sprtState.decisionState,
          round: 2,
          logLikelihoodRatio: sprtState.logLikelihoodRatio,
          alignmentScore: sprtScore,
        });

        // 关键接线：非 UI 控制流消费 decisionState (R-1)
        if (sprtState.decisionState === 'deadlock_escalation') {
          // SPRT 死锁熔断：攻防严重分歧，阻断自动流转，上报人类
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'arbitration',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'arbitration',
              targetProposalContent: targetProposalText,
              targetChallengeContent: acpResp.textResponse,
              isChallengerResponded: true,
              quorumAlert: '⚠️ SPRT 似然比跌破死锁下界 (Deadlock Escalation)，攻防陷入深层价值对立，已熔断自动推演',
              sprtState,
              minorityReport,
              cognoNexus: {
                committedStates,
                currentDispute: disputePacket,
                sprtState,
                minorityReport,
              },
            },
          }));

          logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
            stage: 'challenge',
            reason: 'sprt_deadlock_escalation',
          });

          const deadlockMsg: Message = {
            id: `msg-deadlock-alert-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Deadlock Escalation',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **SPRT 死锁熔断告警 (Deadlock Escalation)**：攻防分歧已突破置信区间下界 ($LHR \\le B$)，系统判定两造陷入不可调和死锁。自动推演已阻断，请人类首席仲裁官查阅上方交锋点，在下方控制台敲响法槌直接裁决。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), deadlockMsg],
          }));
          return;
        }

        const latestTopicAfterChallenge = getTopicData(topicId) || currentTopic;
        const activeModularInChallenge = latestTopicAfterChallenge.gameTheoreticState?.modularState;
        const hasUnfrozenModules = Boolean(
          activeModularInChallenge?.enabled &&
            activeModularInChallenge.modules.some((m) => m.status !== 'frozen')
        );

        const hasVerifiers = (currentTopic.gameRoles?.verifiers || []).length > 0;
        // 若启用 G-Frame 模块化分治且尚有未冻结模块，必须经由验证/答辩完成各模块冻结，严禁提前跳入仲裁弃置后续模块 (E2E-03)
        const nextStageTarget =
          sprtState.decisionState === 'early_exit' && !hasUnfrozenModules
            ? 'arbitration'
            : hasVerifiers
            ? 'verification'
            : 'defense';

        if (sprtState.decisionState === 'early_exit' && !hasUnfrozenModules) {
          const earlyExitMsg: Message = {
            id: `msg-early-exit-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Early Exit',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚡ **SPRT 序贯检验早停 (Early Exit)**：攻防两造论据已突破置信上限 ($LHR \\ge A$)，达成高质对齐。系统自动短路后续冗余轮次，直接流转至终局仲裁！`,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), earlyExitMsg],
          }));
        }

        // 阶段 2 反例压测完成后，转入【阶段 3: 接地验证 (Verification)】或【阶段 4: 答辩修正 (Defense)】或【阶段 5: 仲裁】
        updateTopicDataInState(topicId, (old) => {
          const prevModular = old.gameTheoreticState?.modularState;
          let nextModular = prevModular;
          if (prevModular?.enabled && prevModular.activeModuleId) {
            const challengeStep = stepModularStageTransition({
              state: prevModular,
              currentStage: 'challenge',
              feedbackDelta: {
                edgeCaseCount: Math.min(
                  2,
                  committedStates.filter((c) => c.status === 'disputed' || c.status === 'refuted').length || (disputePacket ? 1 : 0)
                ),
              },
            });
            nextModular = {
              ...challengeStep.nextState,
              modules: challengeStep.nextState.modules.map((m) =>
                m.moduleId === prevModular.activeModuleId
                  ? { ...m, scopedMessageIds: [...m.scopedMessageIds, challengerReply.id] }
                  : m
              ),
            };
          }
          return {
            ...old,
            gameStage: nextStageTarget,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: nextStageTarget,
              targetProposalContent: targetProposalText,
              targetChallengeContent: acpResp.textResponse,
              isChallengerResponded: true,
              quorumAlert: undefined,
              sprtState,
              minorityReport,
              modularState: nextModular,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates,
                currentDispute: disputePacket,
                sprtState,
                minorityReport,
                modularState: nextModular,
              },
            },
          };
        });

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: nextStageTarget,
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

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping challenge error because turn was aborted or invalidated');
          return;
        }

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

    if (nextStage === 'verification') {
      const verifierIds = currentTopic.gameRoles?.verifiers || [];
      const verifierAgent = candidateAgents.find((a) => verifierIds.includes(a.id));

      if (!verifierAgent || isAgentOffline(verifierAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);

        const offlineReason = !verifierAgent
          ? '未指派或未匹配到接地验证者 (Verifier)'
          : `接地验证者 ${verifierAgent.name} 处于离线/未连接状态`;

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'defense',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'defense',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isVerifierResponded: false,
          },
        }));

        const verifierSkipNotice: Message = {
          id: `msg-verifier-skip-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@verifier-guard',
          authorAvatar: '🔍',
          isAgent: true,
          agentBadge: 'Verification Skipped',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔍 **接地验证跳过**：${offlineReason}。根据 4+1 博弈调度协议，工具接地与真实性校验缺席，自动流转至【阶段: 🛡️ 答辩修正】。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), verifierSkipNotice],
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'defense',
          targetProposalText,
          targetChallengeText,
        });
        return;
      }

      const execKey = `${topicId}:${verifierAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: verifierAgent.id,
          agentName: verifierAgent.name,
          agentAvatar: verifierAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在执行客观事实与物理逻辑接地验证 (Stage: 🔍 接地验证)...`,
          startedAt: Date.now(),
          cascadeHop: 3,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === verifierAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const verifierPendingId = `topic-pending-${Date.now()}-${verifierAgent.id}`;
      const verifierPendingMsg: Message = {
        id: verifierPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: verifierAgent.id,
        authorName: verifierAgent.name,
        authorHandle: verifierAgent.handle,
        authorAvatar: verifierAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在调取外部工具、代码解释器沙箱与事实基准进行真实性接地校验 (Stage: 🔍 接地验证)...',
        agentBadge: `${verifierAgent.modelBadge?.split(' ')[0] || 'Local'} · 🔍 接地验证 (执行中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'verification',
        gameRole: 'verifier',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), verifierPendingMsg],
      }));

      const latestTopicForVerification = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'verification',
        targetProposalText,
        targetChallengeText,
        modularState: latestTopicForVerification.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const verifierPrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: `争议切片与立论反例已就绪，请调取工具、代码沙箱或事实基准，对核心分歧断言进行接地验证，输出布尔真值与反事实压测证据。`,
        targetAgent: verifierAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: verifierAgent,
          roomId: topicId,
          prompt: verifierPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: verifierAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '接地验证者返回空响应，未生成有效验证证据。');
        }

        const verifierReply: Message = {
          id: `topic-reply-${Date.now()}-${verifierAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: verifierAgent.id,
          authorName: verifierAgent.name,
          authorHandle: verifierAgent.handle,
          authorAvatar: verifierAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${verifierAgent.modelBadge?.split(' ')[0] || 'Local'} · 🔍 接地验证`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'verification',
          gameRole: 'verifier',
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成工具执行与物理事实接地验证'),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === verifierPendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === verifierPendingId ? verifierReply : m))
            : [...existing, verifierReply];
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
                      latestReplyPreview: verifierReply.content.slice(0, 60),
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

        // 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('verification', acpResp.textResponse, verifierAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'verification',
          agentId: verifierAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:verification`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '验证契约未达标，触发 Self-Refine',
              gameStage: 'verification',
              gameRole: 'verifier',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            inFlightHandoverRef.current.delete(handoverKey);
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'verification',
              targetProposalText,
              targetChallengeText,
            });
            return;
          } else {
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `接地验证官 (${verifierAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足实证规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'verification',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：接地验证官 ${verifierAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足实证真值规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'verifier',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:verification`];

        // 全量调度分级取证执行器并计算确定性加权真值率 (P0-1 / R-3 DIANOIA)
        const { evidences, weightedTrueRatio, updatedDispute, updatedCommittedStates } = processVerifierEvidenceChain({
          topicId,
          verifierText: acpResp.textResponse,
          isSafetyCharterSigned: currentTopic.gameTheoreticState?.isSafetyCharterSigned,
          disputePacket: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute,
          committedStates: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
        });
        const groundedTrueRatio = weightedTrueRatio;

        logGameTheoreticTelemetry('grounded_ratio_injected', topicId, {
          stage: 'verification',
          groundedTrueRatio,
          verifierId: verifierAgent.id,
          evidenceCount: evidences.length,
        });

        // 阶段 3 验证完成后，基于实证计数与 fast_track/deep_debate 模式推进模块状态机 (N8 & E2E-03)
        // - fast_track 模块若验证无违规且有实证支持，直接进入 FREEZE_MODULE 闭环，跳过 defense；
        // - fast_track 模块若捕获违规或证伪反例，触发 ESCALATE_TO_RED_TEAM 动态拉起红队进入 challenge；
        // - deep_debate 模块按规约正常推进至 defense 阶段答辩。
        const latestTopicBeforeVerUpdate = getTopicData(topicId) || currentTopic;
        const prevModular = latestTopicBeforeVerUpdate.gameTheoreticState?.modularState;
        let nextModular = prevModular;
        let resolvedVerNextStage: GameTheoreticStage = 'defense';
        let verNoticeMsg: Message | null = null;
        let verContractViolations = 0;

        if (prevModular?.enabled && prevModular.activeModuleId) {
          const verifiedCount = evidences.filter((e) => e.truthValue).length;
          const refutedCount = evidences.filter((e) => !e.truthValue).length;
          const activeMod = prevModular.modules.find((m) => m.moduleId === prevModular.activeModuleId);
          const scopeCheck = activeMod
            ? validateModuleScopeContract(
                acpResp.textResponse,
                activeMod,
                prevModular.modules,
                prevModular.sharedContract
              )
            : { isScopeValid: true, contractViolations: 0, violatedFiles: [], violationDetails: [] };
          verContractViolations = scopeCheck.contractViolations;

          const modRefineKey = `${topicId}:mod-refine:${prevModular.activeModuleId}`;
          const currentModRefines = stageRefineRetriesRef.current[modRefineKey] || 0;
          const verStep = stepModularStageTransition({
            state: prevModular,
            currentStage: 'verification',
            feedbackDelta: {
              verifiedClaims: verifiedCount,
              refutedClaims: refutedCount,
              contractViolations: scopeCheck.contractViolations,
            },
            currentModuleRefineCount: currentModRefines,
          });

          nextModular = {
            ...verStep.nextState,
            modules: verStep.nextState.modules.map((m) =>
              m.moduleId === prevModular.activeModuleId
                ? { ...m, scopedMessageIds: [...m.scopedMessageIds, verifierReply.id] }
                : m
            ),
          };

          resolvedVerNextStage = verStep.nextGameStage;

          if (verStep.posteriorAction === 'ESCALATE_TO_RED_TEAM') {
            verNoticeMsg = {
              id: `msg-fast-track-escalate-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯后验升降级调控器',
              authorHandle: '@bayesian-governor',
              authorAvatar: '⚔️',
              isAgent: true,
              agentBadge: 'Escalate to Red Team',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚔️ **贝叶斯后验动态升级 (ESCALATE_TO_RED_TEAM)**：模块「${activeMod?.title || prevModular.activeModuleId}」在接地验证中捕获异常反馈 (${verStep.reason})。快速通道自动熔断，已紧急拉起 ⚔️ **红队对抗官** 进行深度反例压测！`,
              gameStage: 'challenge',
            };
          } else if (verStep.posteriorAction === 'FREEZE_MODULE') {
            const frozenCount = nextModular.modules.filter((m) => m.status === 'frozen').length;
            const nextActiveMod = nextModular.modules.find((m) => m.moduleId === nextModular.activeModuleId);
            verNoticeMsg = {
              id: `msg-fast-track-freeze-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-governor',
              authorAvatar: '🧊',
              isAgent: true,
              agentBadge: `Fast Track Frozen (${frozenCount}/${nextModular.modules.length})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🧊 **快速通道实证直通硬冻结**：模块「${activeMod?.title || prevModular.activeModuleId}」通过静态契约与接地校验，零反例零违规，已在快速通道直接锁定为 Frozen。\n\n${
                verStep.allModulesFrozen
                  ? '全部模块已完成实证收敛，正在转入终局仲裁！'
                  : `正在按 DAG 拓扑序激活下一模块「**${nextActiveMod?.title || nextModular.activeModuleId}**」进入独立沙箱提案立论...`
              }`,
              gameStage: resolvedVerNextStage,
            };
          }
        }

        updateTopicDataInState(topicId, (old) => {
          const isAllFrozenOrArbitration = resolvedVerNextStage === 'arbitration';
          const isFastTrackBypassed =
            Boolean(old.gameTheoreticState?.isChallengerBypassed) ||
            Boolean(nextModular?.enabled && nextModular.modules.every((m) => m.belief.routingMode === 'fast_track'));

          // 快速通道实证直通收敛证据与 SPRT 等价状态 (N13)
          const sprtState: SprtGovernorState = {
            currentRound: 1,
            maxRounds: 4,
            logLikelihoodRatio: 3.2,
            upperThresholdA: 2.94,
            lowerThresholdB: -2.94,
            latestAlignmentScore: 1.0,
            decisionState: 'early_exit',
            statusDescription: '快速通道实证直通收敛：静态契约对齐与物理接地 100% 通过，零反例零违规，依据博弈规约达成高置信等价收敛。',
            groundedTrueRatio: 1.0,
            calibrationStatus: 'calibrated',
            observationVector: {
              groundedRatio: 1.0,
              semanticScore: 1.0,
              dssScore: 0.0,
              combinedScore: 1.0,
            },
          };

          const fastTrackConvergenceEvidence: FastTrackConvergenceEvidence = {
            mode: 'static_empirical_fast_track',
            totalModulesCount: nextModular?.modules.length || 1,
            frozenModulesCount: nextModular?.modules.filter((m) => m.status === 'frozen').length || 1,
            verifiedClaimsCount: evidences.filter((e) => e.truthValue).length,
            contractViolationsCount: verContractViolations,
            refutedClaimsCount: evidences.filter((e) => !e.truthValue).length,
            achievedAt: new Date().toISOString(),
            summary: `快速通道 ${nextModular?.modules.length || 1}/${nextModular?.modules.length || 1} 模块全硬冻结，物理接地真值率 100%，契约违规 0 项，达成静态实证直通收敛。`,
          };

          const effectiveSprtState =
            old.gameTheoreticState?.sprtState ||
            (isAllFrozenOrArbitration && isFastTrackBypassed ? sprtState : undefined);
          const effectiveFastTrackConv =
            isFastTrackBypassed ? fastTrackConvergenceEvidence : old.gameTheoreticState?.fastTrackConvergence;

          return {
            ...old,
            gameStage: resolvedVerNextStage,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: resolvedVerNextStage,
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetVerificationContent: acpResp.textResponse,
              isVerifierResponded: true,
              // 回填制衡方响应标记与旁路审计留痕：在全 fast_track 或模块旁路下保障法定门禁不误报 (N11)
              isChallengerResponded: isAllFrozenOrArbitration
                ? (isFastTrackBypassed ? true : old.gameTheoreticState?.isChallengerResponded ?? false)
                : old.gameTheoreticState?.isChallengerResponded,
              isChallengerBypassed: isFastTrackBypassed || old.gameTheoreticState?.isChallengerBypassed,
              challengerBypassedReason: isFastTrackBypassed
                ? 'Bayesian Fast-Track: 模块经贝叶斯先验评定为低风险确定性模块，依博弈规约旁路红队对抗直接进入接地验证。'
                : old.gameTheoreticState?.challengerBypassedReason,
              sprtState: effectiveSprtState,
              fastTrackConvergence: effectiveFastTrackConv,
              minorityReport: old.gameTheoreticState?.minorityReport,
              modularState: nextModular,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                sprtState: effectiveSprtState,
                fastTrackConvergence: effectiveFastTrackConv,
                currentDispute: updatedDispute || old.gameTheoreticState?.cognoNexus?.currentDispute,
                committedStates: updatedCommittedStates || old.gameTheoreticState?.cognoNexus?.committedStates || [],
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                modularState: nextModular,
              },
            },
          };
        });

        if (verNoticeMsg) {
          const notice = verNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), notice],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: resolvedVerNextStage,
          targetProposalText,
          targetChallengeText,
          targetVerificationText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping verification error because turn was aborted or invalidated');
          return;
        }

        console.error('Verifier execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${verifierAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: verifierAgent.id,
          authorName: verifierAgent.name,
          authorHandle: verifierAgent.handle,
          authorAvatar: verifierAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **接地验证执行异常**：${err instanceof Error ? err.message : String(err)}。自动流转至答辩修正。`,
          gameStage: 'verification',
          gameRole: 'verifier',
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== verifierPendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'defense',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'defense',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isVerifierResponded: false,
          },
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'defense',
          targetProposalText,
          targetChallengeText,
        });
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'defense') {
      const proposerIds = currentTopic.gameRoles?.proposers || [];
      const proposerAgent = candidateAgents.find((a) => proposerIds.includes(a.id));

      if (!proposerAgent || isAgentOffline(proposerAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);

        const offlineReason = !proposerAgent
          ? '未指派或未匹配到主导者 (Proposer)'
          : `主导者 ${proposerAgent.name} 处于离线/未连接状态`;

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isDefenseResponded: false,
          },
        }));

        const defenseSkipNotice: Message = {
          id: `msg-defense-skip-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@defense-guard',
          authorAvatar: '🛡️',
          isAgent: true,
          agentBadge: 'Defense Skipped',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🛡️ **主导者答辩跳过**：${offlineReason}。根据博弈调度协议，主导方答辩与修正缺席，自动流转至【阶段 4: 中立仲裁】。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), defenseSkipNotice],
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        });
        return;
      }

      const execKey = `${topicId}:${proposerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: proposerAgent.id,
          agentName: proposerAgent.name,
          agentAvatar: proposerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在针对挑战反例进行技术抗辩与防御修正 (Stage: 🛡️ 答辩修正)...`,
          startedAt: Date.now(),
          cascadeHop: 3,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === proposerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const defensePendingId = `topic-pending-${Date.now()}-${proposerAgent.id}`;
      const defensePendingMsg: Message = {
        id: defensePendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: proposerAgent.id,
        authorName: proposerAgent.name,
        authorHandle: proposerAgent.handle,
        authorAvatar: proposerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在审视挑战者反例质询，设计架构防御补丁与修正方案 (Stage: 🛡️ 答辩修正)...',
        agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛡️ 答辩修正 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'defense',
        gameRole: 'proposer',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), defensePendingMsg],
      }));

      const latestTopicForDefense = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'defense',
        targetProposalText,
        targetChallengeText,
        targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        modularState: latestTopicForDefense.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const defenseUserPrompt = (targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent)
        ? `挑战者反例质询与接地验证官工具证据已送达，请针对极端场景、并发边界与实测数据给出架构防御补丁与技术抗辩。`
        : `挑战者反例质询已送达，请针对极端场景与并发边界给出架构防御补丁与技术抗辩。`;

      const defensePrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: defenseUserPrompt,
        targetAgent: proposerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: proposerAgent,
          roomId: topicId,
          prompt: defensePrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: proposerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '主导者返回空响应，未生成有效答辩修正。');
        }

        const defenseReply: Message = {
          id: `topic-reply-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛡️ 答辩修正`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'defense',
          gameRole: 'proposer',
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成反例答辩与架构防御补丁构建'),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === defensePendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === defensePendingId ? defenseReply : m))
            : [...existing, defenseReply];
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
                      latestReplyPreview: defenseReply.content.slice(0, 60),
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

        // 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('defense', acpResp.textResponse, proposerAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'defense',
          agentId: proposerAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:defense`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '答辩补丁契约未达标，触发 Self-Refine',
              gameStage: 'defense',
              gameRole: 'proposer',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'defense',
              targetProposalText,
              targetChallengeText,
              targetVerificationText,
            });
            return;
          } else {
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `提案官 (${proposerAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足答辩补丁契约规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'defense',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：提案官 ${proposerAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足答辩补丁契约规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'proposer',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:defense`];

        // Wave 2 P0-4: 评估答辩者的动态谄媚度 (Dynamic Sycophancy Score, DSS)
        const sycophancyEval = evaluateDynamicSycophancyScore(proposerAgent, acpResp.textResponse);
        logGameTheoreticTelemetry('sycophancy_evaluated', topicId, {
          stage: 'defense',
          agentId: proposerAgent.id,
          dssScore: sycophancyEval.dss,
          bssScore: sycophancyEval.bss,
          gamma: sycophancyEval.discountFactorGamma,
          surrenderDetected: sycophancyEval.surrenderDetected,
        });

        // 显式提取接地实证真值率并显式注入 SPRT (R-1 接线三件套)
        const verificationText = targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent || '';
        const groundedTrueRatio = extractGroundedTrueRatio(verificationText);
        logGameTheoreticTelemetry('grounded_ratio_injected', topicId, {
          stage: 'defense',
          groundedTrueRatio,
        });

        // CognoNexus 阶段 3: 评估答辩修正后的对齐分数与似然比 (Wave 3 P1-2: 多维观测联合向量)
        const rawSprtScoreAfterDefense = estimateRoundAlignmentScore({
          proposalText: targetProposalText,
          critiqueText: targetChallengeText,
          defenseText: acpResp.textResponse,
          groundedTrueRatio,
          dssScore: sycophancyEval.dss,
        });

        // 施加谄媚折减后的真实对齐分数 (Sharma et al. 2023)
        const sprtScoreAfterDefense = applySycophancyDiscountToSprt(rawSprtScoreAfterDefense, sycophancyEval);

        const hasUnverifiedDisputeAfterDefense = Boolean(
          currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.groundingStatus === 'unverified'
        );

        const sprtStateAfterDefense = stepSprtGovernor({
          priorState: currentTopic.gameTheoreticState?.sprtState,
          currentRound: (currentTopic.gameTheoreticState?.roundCount || 1) + 2,
          alignmentScore: sprtScoreAfterDefense,
          groundedTrueRatio,
          dssScore: sycophancyEval.dss,
          hasUnverifiedCriticalDispute: hasUnverifiedDisputeAfterDefense,
        });

        logGameTheoreticTelemetry('decisionState_transition', topicId, {
          stage: 'defense',
          decisionState: sprtStateAfterDefense.decisionState,
          round: sprtStateAfterDefense.currentRound,
          logLikelihoodRatio: sprtStateAfterDefense.logLikelihoodRatio,
          alignmentScore: sprtScoreAfterDefense,
          groundedTrueRatio,
        });

        // 关键接线：消费 decisionState (R-1)
        if (sprtStateAfterDefense.decisionState === 'deadlock_escalation') {
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'arbitration',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'arbitration',
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetDefenseContent: acpResp.textResponse,
              isDefenseResponded: true,
              quorumAlert: '⚠️ SPRT 似然比跌破死锁下界 (Deadlock Escalation)，答辩未能化解分歧，已熔断流转',
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
                sprtState: sprtStateAfterDefense,
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                latestSycophancy: sycophancyEval,
              },
            },
          }));

          logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
            stage: 'defense',
            reason: 'sprt_deadlock_escalation',
          });

          const deadlockMsg: Message = {
            id: `msg-deadlock-alert-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Deadlock Escalation',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **SPRT 死锁熔断告警 (Deadlock Escalation)**：答辩后攻防对齐度依然处于死锁区间 ($LHR \\le B$)。系统已阻断纯 AI 自动推演，请人类首席仲裁官在下方控制台敲响法槌定案。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), deadlockMsg],
          }));
          return;
        }

        // P2 二次对抗回边判定 (4 项硬条件守卫，不满足 4 条件不得回退，防止死循环) (R-4/R-6)
        const currentRoundCount = currentTopic.gameTheoreticState?.roundCount || 1;
        const originalClaims = extractArgumentNodes(targetProposalText);
        const defenseClaims = extractArgumentNodes(acpResp.textResponse);
        const hasNewUnverifiedClaims = defenseClaims.some(
          (dc) => !originalClaims.some((oc) => oc.claim === dc.claim || (oc.claim && dc.claim && (oc.claim.includes(dc.claim) || dc.claim.includes(oc.claim))))
        ) || (defenseClaims.length > 0 && defenseClaims.some((dc) => dc.status === 'disputed' || dc.status === 'refuted'));

        const shouldTriggerP2Loopback =
          sprtScoreAfterDefense < 0.45 &&
          currentRoundCount < 2 &&
          hasNewUnverifiedClaims &&
          groundedTrueRatio < 0.5;

        if (shouldTriggerP2Loopback) {
          const nextRound = currentRoundCount + 1;
          logGameTheoreticTelemetry('p2_loopback_triggered', topicId, {
            nextRound,
            sprtScoreAfterDefense,
            currentRoundCount,
            hasNewUnverifiedClaims,
            groundedTrueRatio,
          });

          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'challenge',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'challenge',
              roundCount: nextRound,
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetDefenseContent: acpResp.textResponse,
              isChallengerResponded: false,
              isVerifierResponded: false,
              isDefenseResponded: false,
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
                sprtState: sprtStateAfterDefense,
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                latestSycophancy: sycophancyEval,
              },
            },
          }));

          const loopbackNotice: Message = {
            id: `msg-p2-loopback-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'CognoNexus 博弈引擎',
            authorHandle: '@p2-loopback-guard',
            authorAvatar: '🔄',
            isAgent: true,
            agentBadge: `P2 回边 (第 ${nextRound} 轮对抗)`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔄 **触发 P2 二次对抗回边 (Round ${nextRound})**：
系统完成 4 项二次对抗硬性条件准入校验（满足全部 4 项）：
1. ✓ **对齐度未收敛**：当前综合对齐分 ${(sprtScoreAfterDefense * 100).toFixed(0)}% (< 45%)
2. ✓ **安全轮次下界**：当前处于第 ${currentRoundCount} 轮 (< 2 轮)
3. ✓ **引入未核验新断言**：答辩提出新补丁设计，需受二次深度质询
4. ✓ **实证存在冲突反例**：客观真值率 ${(groundedTrueRatio * 100).toFixed(0)}% (< 50%)

正在将答辩补丁移交 ⚔️ **红队对抗官** 发起第 ${nextRound} 轮反向质询...`,
            gameStage: 'challenge',
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), loopbackNotice],
          }));

          triggerGameTheoreticStageHandover({
            topicId,
            nextStage: 'challenge',
            targetProposalText: acpResp.textResponse, // 答辩补丁作为第 2 轮审查标的
            targetChallengeText,
            targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
            targetDefenseText: acpResp.textResponse,
          });
          return;
        }

        // 阶段 4 答辩修正完成后，基于真实实证与越界计数推进 G-Frame 模块状态机 (E2E-03 & EDGE-06)
        // - 若触发 SCOPED_DEFENSE_REFINE，回环至当前模块 challenge 阶段进行有界局部重修；
        // - 若当前模块 FREEZE_MODULE 但尚有后续模块未冻结 (!allModulesFrozen)，激活下一拓扑模块并回环至 challenge；
        // - 仅当全部模块 (N/N) 均已 Frozen 时，才流转至终局仲裁 (arbitration)。
        // 关键修复 (N1)：在调用 setState / updateTopicDataInState 前同步完成模块状态机演算与 resolvedNextStage 判定，
        // 严禁在异步批处理的 setState 更新器闭包内才对外部流转变量赋值。
        const latestTopicBeforeDefenseUpdate = getTopicData(topicId) || currentTopic;
        const prevModular = latestTopicBeforeDefenseUpdate.gameTheoreticState?.modularState;
        let nextModular = prevModular;
        let resolvedNextStage: 'proposal' | 'challenge' | 'arbitration' = 'arbitration';
        let transitionNoticeMsg: Message | null = null;

        if (prevModular?.enabled && prevModular.activeModuleId) {
          const activeMod = prevModular.modules.find(
            (m) => m.moduleId === prevModular.activeModuleId
          );
          const scopeCheck = activeMod
            ? validateModuleScopeContract(
                acpResp.textResponse,
                activeMod,
                prevModular.modules,
                prevModular.sharedContract
              )
            : { isScopeValid: true, contractViolations: 0, violatedFiles: [], violationDetails: [] };

          const parsedVerEvidences = parseVerifierOutput(verificationText);
          const refutedInVerCount = parsedVerEvidences.filter((e) => !e.truthValue).length;
          const refutedDefenseCount =
            (sycophancyEval.surrenderDetected ? 1 : 0) +
            defenseClaims.filter((c) => c.status === 'refuted').length;
          const verifiedDefenseCount =
            !sycophancyEval.surrenderDetected &&
            scopeCheck.contractViolations === 0 &&
            refutedDefenseCount === 0 &&
            (refutedInVerCount === 0 || groundedTrueRatio >= 0.5)
              ? Math.max(1, defenseClaims.filter((c) => c.status !== 'refuted').length)
              : 0;

          const modRefineKey = `${topicId}:mod-refine:${prevModular.activeModuleId}`;
          const currentModRefines = stageRefineRetriesRef.current[modRefineKey] || 0;

          const modStep = stepModularStageTransition({
            state: prevModular,
            currentStage: 'defense',
            feedbackDelta: {
              verifiedClaims: verifiedDefenseCount,
              refutedClaims: refutedDefenseCount,
              contractViolations: scopeCheck.contractViolations,
              dssScore: sycophancyEval.dss,
            },
            proposalOrDefenseSnippet: acpResp.textResponse,
            currentModuleRefineCount: currentModRefines,
          });

          nextModular = {
            ...modStep.nextState,
            modules: modStep.nextState.modules.map((m) =>
              m.moduleId === prevModular.activeModuleId
                ? { ...m, scopedMessageIds: [...m.scopedMessageIds, defenseReply.id] }
                : m
            ),
          };

          if (modStep.triggeredScopedRefine && activeMod) {
            stageRefineRetriesRef.current[modRefineKey] = currentModRefines + 1;
            resolvedNextStage = 'challenge';
            transitionNoticeMsg = {
              id: `msg-mod-refine-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'G-Frame 贝叶斯模块总控',
              authorHandle: '@gframe-governor',
              authorAvatar: '🧭',
              isAgent: true,
              agentBadge: `SCOPED_DEFENSE_REFINE (${currentModRefines + 1}/1)`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🔄 **触发模块沙箱局部重修 (SCOPED_DEFENSE_REFINE)**：${modStep.reason}。已锁定当前模块「${activeMod.title}」发起有界二次核验，已冻结上游模块不受波及。`,
              gameStage: 'challenge',
            };
          } else if (!modStep.allModulesFrozen) {
            delete stageRefineRetriesRef.current[modRefineKey];
            resolvedNextStage = 'proposal';
            const nextActiveMod = nextModular.modules.find(
              (m) => m.moduleId === nextModular?.activeModuleId
            );
            const frozenCount = nextModular.modules.filter((m) => m.status === 'frozen').length;
            transitionNoticeMsg = {
              id: `msg-mod-advance-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'G-Frame 贝叶斯模块总控',
              authorHandle: '@gframe-governor',
              authorAvatar: '🧊',
              isAgent: true,
              agentBadge: `Module Frozen (${frozenCount}/${nextModular.modules.length})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🧊 **模块收敛硬冻结 & 拓扑切换**：模块「${activeMod?.title || prevModular.activeModuleId}」已完成实证收敛并锁定为 Frozen（当前已冻结 ${frozenCount}/${nextModular.modules.length}）。\n\n正在按 DAG 拓扑序激活下一模块「**${nextActiveMod?.title || nextModular.activeModuleId}**」进入独立沙箱提案立论...`,
              gameStage: 'proposal',
            };
          } else {
            delete stageRefineRetriesRef.current[modRefineKey];
            resolvedNextStage = 'arbitration';
          }
        }

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: resolvedNextStage,
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: resolvedNextStage,
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            targetDefenseContent: acpResp.textResponse,
            isChallengerResponded: resolvedNextStage === 'arbitration',
            isVerifierResponded: resolvedNextStage === 'arbitration',
            isDefenseResponded: resolvedNextStage === 'arbitration',
            sprtState: sprtStateAfterDefense,
            minorityReport: old.gameTheoreticState?.minorityReport,
            latestSycophancy: sycophancyEval,
            modularState: nextModular,
            cognoNexus: {
              ...old.gameTheoreticState?.cognoNexus,
              committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              modularState: nextModular,
            },
          },
        }));

        if (transitionNoticeMsg) {
          const noticeToPost = transitionNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), noticeToPost],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: resolvedNextStage,
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
          targetDefenseText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping defense error because turn was aborted or invalidated');
          return;
        }

        console.error('Defense execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **主导者答辩异常**：${err instanceof Error ? err.message : String(err)}。自动流转至仲裁定案。`,
          gameStage: 'defense',
          gameRole: 'proposer',
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== defensePendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isDefenseResponded: false,
          },
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        });
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'arbitration') {
      const arbiterIds = currentTopic.gameRoles?.arbiters || [];
      const arbiterAgent = candidateAgents.find((a) => arbiterIds.includes(a.id));

      if (!arbiterAgent || isAgentOffline(arbiterAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);
      }

      if (arbiterAgent && isAgentOnline(arbiterAgent)) {
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
            currentActionDetail: `正在全面权衡方案、反例与答辩补丁，起草终局仲裁建议 (Stage: ⚖️ 仲裁定案)...`,
            startedAt: Date.now(),
            cascadeHop: 4,
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
          pendingHint: '正在审阅立论方案、反例质疑与防御答辩补丁，起草仲裁权衡矩阵 (Stage: ⚖️ 仲裁定案)...',
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

        const latestTopicForArbitration = getTopicData(topicId) || currentTopic;
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
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
          targetDefenseText,
          modularState: latestTopicForArbitration.gameTheoreticState?.modularState,
          participatingAgents: candidateAgents,
        };

        const arbiterPrompt = buildTopicPrompt({
          topic: topicContext,
          userContent: targetDefenseText
            ? `主导提案、反例压测、接地验证证据与答辩补丁已就绪，请给出客观中立的仲裁权衡矩阵与终局裁决建言。`
            : `主导方案、反例压测与接地验证证据已就绪，请给出客观中立的仲裁权衡矩阵与裁决建言。`,
          targetAgent: arbiterAgent,
          availableAgents: candidateAgents,
        });

        try {
          const acpResp = await sendPromptToAcpAgent({
            agent: arbiterAgent,
            roomId: topicId,
            prompt: arbiterPrompt,
            channelId: topicChannel?.id,
            workspaceBindingId: currentTopic.workspaceBindingId,
            workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
            scopeType: 'topic',
            systemPrompt: buildCompositeSystemPrompt({
              agent: arbiterAgent,
              availableAgents: candidateAgents,
              includeRoster: true,
            }),
            discussionMode: 'game_theoretic',
          });

          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping arbitration reply because turn was aborted or invalidated');
            return;
          }

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
            thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成立论、反例与答辩补丁的综合仲裁审查'),
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
          };

          // 契约门禁校验
          const contractValidation = validateStageContract('arbitration', acpResp.textResponse, arbiterAgent.name);
          logGameTheoreticTelemetry('stage_contract_validation', topicId, {
            stage: 'arbitration',
            agentId: arbiterAgent.id,
            isValid: contractValidation.isValid,
            missingRequirements: contractValidation.missingRequirements,
          });

          // 求解确定性运筹决策矩阵并进行一致性硬门禁检验 (R-1 / P0-3 / P0-5 ReConcile 置信度加权)
          const mcdaPayload = generateDeterministicMcdaPayload({
            arbiterText: acpResp.textResponse,
            proposalText: targetProposalText,
            critiqueText: targetChallengeText,
            defenseText: targetDefenseText,
            topicTitle: currentTopic.title,
            topicDescription: currentTopic.description,
            argumentNodes: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
            evidences: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain,
            sycophancy: currentTopic.gameTheoreticState?.latestSycophancy,
            modelDiversity: currentTopic.gameTheoreticState?.modelDiversity,
          });

          logGameTheoreticTelemetry('consistency_gate_evaluation', topicId, {
            passed: mcdaPayload.consistencyPassed,
            consistencyIndex: mcdaPayload.consistencyIndex,
            solverType: mcdaPayload.solverType,
          });

          // 计算 ColMAD 非零和协同事实贡献报表 (Wave 3 P1-3)
          const colMadReport = calculateColMadContributions({
            topicId,
            agents,
            proposalText: targetProposalText,
            critiqueText: targetChallengeText,
            verificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
            defenseText: targetDefenseText,
            argumentNodes: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
            evidences: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain,
          });

          // 提取由 Arbiter Agent 通过 submit_arbitration_ruling 工具或结构化契约提交的裁决书草案
          const extractedRulingDraft = acpResp.rulingDraft || extractArbitrationRulingFromAcpResponse(acpResp, arbiterAgent.name);

          // 将求解出的 MCDA 矩阵、ColMAD 报表与裁决草案持久化至议题博弈状态中
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              minorityReport: old.gameTheoreticState?.minorityReport,
              mcdaPayload,
              colMadReport,
              rulingDraft: extractedRulingDraft || old.gameTheoreticState?.rulingDraft,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                mcdaPayload,
                colMadReport,
              },
            },
          }));

          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: mcdaPayload.consistencyPassed ? 'Gavel Ready' : 'Consistency Warning',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: (mcdaPayload.consistencyPassed
              ? `⚖️ **AI 仲裁建言已生成 (✓ 逻辑严密一致, ξ* = ${mcdaPayload.consistencyIndex})**：立论、反例压测、接地实证与答辩补丁已完成审查。请人类首席仲裁官查阅交锋要点，在下方【仲裁法槌控制台】选择【采纳提案】、【采纳红队】或【权衡矩阵】敲响法槌定案，并可指派 Agent 进入工程代码落地实施。`
              : `⚖️ **AI 仲裁建言已生成 (⚠️ 运筹逻辑一致性未通过, ξ* = ${mcdaPayload.consistencyIndex} > 0.12)**：准则偏好存在传递性冲突。系统已硬锁定直接批准，请人类首席仲裁官查阅要点，在下方【仲裁法槌控制台】勾选特权豁免，或重新调校准则权重后定案。`
            ) + (extractedRulingDraft ? `\n\n📄 **[活体 ADR 画布更新]** 仲裁官已通过 \`submit_arbitration_ruling\` 提交标准裁决草案，法槌控制台已精准预载权衡要点。` : ''),
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
          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping arbitration error because turn was aborted or invalidated');
            return;
          }
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

    commitMessages((prev) => {
      const topicMsgs = prev[topicId] || [];
      const nextTopicMsgs = topicMsgs.some((m) => m.id === userMsg.id)
        ? topicMsgs
        : [...topicMsgs, userMsg];

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
                  repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
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

    const isTopicAll = isAllMention(content);

    let userMentionedAgents: Agent[] = [];

    if (isTopicAll) {
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
          executionStage = currentTopicStage === 'defense' ? 'defense' : 'proposal';
        } else if (activeTopicData?.gameRoles?.challengers?.includes(id)) {
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (activeTopicData?.gameRoles?.verifiers?.includes(id)) {
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (activeTopicData?.gameRoles?.arbiters?.includes(id)) {
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        }
      } else {
        // 根据三元/4+1博弈当前所处阶段分配角色，绝不并发广播给全员
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
        } else if (currentTopicStage === 'verification') {
          const verifierIds = activeTopicData?.gameRoles?.verifiers || [];
          respondingAgents = candidateAgents.filter((a) => verifierIds.includes(a.id));
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (currentTopicStage === 'defense') {
          const proposerIds = activeTopicData?.gameRoles?.proposers || [];
          respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
          targetRoleType = 'proposer';
          executionStage = 'defense';
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
        // 标准讨论模式（对标 Buzz）：当用户未显式点名特定 Agent 时，唤醒当前议题内所有已指派的在线 Agent 在 Hop 1 并发发言
        respondingAgents = candidateAgents;
      }
    }

    if (respondingAgents.length === 0) {
      return;
    }

    // 检查通信状态：分离离线与已连接的 Agent
    const offlineAgents = respondingAgents.filter((a) => isAgentOffline(a));
    const onlineAgents = respondingAgents.filter((a) => isAgentOnline(a));

    // 仅当用户显式点名了离线 Agent、处于博弈模式角色缺失，或全部候选 Agent 均离线时才弹出离线拦截提示
    const shouldWarnOfflineInTopic =
      isGameTheoretic || userMentionedAgents.length > 0 || onlineAgents.length === 0;

    if (offlineAgents.length > 0 && shouldWarnOfflineInTopic) {
      const offlineDetails = offlineAgents
        .map((a) =>
          a.status === 'error'
            ? `• **${a.name}**：连接异常${a.statusDetail ? ` — ${a.statusDetail}` : ''}`
            : `• **${a.name}**：通信尚未开启`
        )
        .join('\n');
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
          content: `🔌 **Agent 通信不可用，本轮不派发推演**：\n${offlineDetails}\n\n根据产品规范，在与其协作推演前，需先在左侧「Agents & 编队」控制面板点击对应 Agent 头像下方的【Start】按钮开启 ACP 通信连接；若显示连接异常，请先修复其运行环境后重新 Start。`,
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
              : executionStage === 'verification'
              ? '正在调用工具与沙箱进行物理事实与真实性校验 (Stage: 🔍 接地验证)...'
              : executionStage === 'defense'
              ? '正在针对反例质询构建防御答辩与架构补丁 (Stage: 🛡️ 答辩修正)...'
              : '正在进行立论、反例与接地证据审查并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...')
          : onlineAgents.length > 1 
            ? `正在并发独立推演方案与系统共识 (并行 Hop 1)...`
            : `正在深度推演议题方案与系统共识 (Hop 1)...`,
        startedAt: now + idx * 50,
        cascadeHop: isGameTheoretic ? (executionStage === 'proposal' ? 1 : executionStage === 'challenge' ? 2 : executionStage === 'verification' ? 3 : executionStage === 'defense' ? 4 : 5) : 1,
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

    // 提取议题前序研讨记录（若启用 G-Frame 模块化隔离且当前模块已有专属消息，则仅注入本模块沙箱内的历史）
    const existingTopicMsgs = messagesRef.current[topicId] || [];
    const activeModState = activeTopicData?.gameTheoreticState?.modularState;
    const activeModSlice =
      activeModState?.enabled && activeModState.activeModuleId
        ? activeModState.modules.find((m) => m.moduleId === activeModState.activeModuleId)
        : undefined;
    const scopedMsgIdSet =
      activeModSlice && activeModSlice.scopedMessageIds.length > 0
        ? new Set(activeModSlice.scopedMessageIds)
        : undefined;

    const recentHistory = existingTopicMsgs
      .filter(
        (m) =>
          m.authorId !== 'system' &&
          m.kind !== 'system_control' &&
          m.kind !== 'guard' &&
          m.kind !== 'rollup' &&
          !m.agentBadge?.includes('Guard') &&
          (!scopedMsgIdSet || scopedMsgIdSet.has(m.id))
      )
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
      targetProposalText: isGameTheoretic && (executionStage === 'challenge' || executionStage === 'verification' || executionStage === 'defense' || executionStage === 'arbitration')
        ? activeTopicData?.gameTheoreticState?.targetProposalContent
        : undefined,
      targetChallengeText: isGameTheoretic && (executionStage === 'verification' || executionStage === 'defense' || executionStage === 'arbitration')
        ? activeTopicData?.gameTheoreticState?.targetChallengeContent
        : undefined,
      targetVerificationText: isGameTheoretic && (executionStage === 'defense' || executionStage === 'arbitration')
        ? activeTopicData?.gameTheoreticState?.targetVerificationContent
        : undefined,
      targetDefenseText: isGameTheoretic && executionStage === 'arbitration'
        ? activeTopicData?.gameTheoreticState?.targetDefenseContent
        : undefined,
      modularState: activeModState,
      participatingAgents: candidateAgents,
      recentHistory,
    };

    // 2. 向 onlineAgents 下发 prompt (标准模式采用共享级联 + 水位线增量 + Turn Barrier 同步汇合)
    const sharedStandardCascadeId = `cascade-topic-${Date.now()}`;
    if (!isGameTheoretic) {
      const initialCallCounts: Record<string, number> = {};
      onlineAgents.forEach((ag) => {
        initialCallCounts[ag.id] = 1;
      });
      const sharedCascade: CollaborationCascade = {
        cascadeId: sharedStandardCascadeId,
        rootMessageId: userMsg.id,
        roomId: topicId,
        originalPrompt: content,
        depth: 1,
        maxDepth: 12,
        visitedAgentIds: onlineAgents.map((a) => a.id),
        agentCallCounts: initialCallCounts,
        isAborted: false,
      };
      activeCascadesRef.current = {
        ...activeCascadesRef.current,
        [sharedStandardCascadeId]: sharedCascade,
      };
      setActiveCascades((prev) => ({ ...prev, [sharedStandardCascadeId]: sharedCascade }));
    }

    const standardTurnOutputs: TurnAgentOutput[] = [];
    const topicTurnSnapshot = captureTurnEpoch(topicId, topicChannel?.id || activeTopicData?.channelId);

    const agentTurnPromises = onlineAgents.map(async (agent) => {
      const execKey = `${topicId}:${agent.id}`;
      const sessionKey = buildAgentSessionKey({
        agentId: agent.id,
        roomId: topicId,
        channelId: topicChannel?.id || activeTopicData?.channelId,
        isDm: false,
        discussionMode: isGameTheoretic ? 'game_theoretic' : 'standard',
        workspaceBindingId: activeTopicData?.workspaceBindingId,
        scopeType: 'topic',
      });

      const preflightSystemPrompt = buildCompositeSystemPrompt({
        agent,
        availableAgents: candidateAgents,
        includeRoster: true,
      });

      const priorTopicMessages = (messagesRef.current[topicId] || []).filter(
        (m) => !m.isPending && (m.content?.trim() || m.thinkingProcess) && m.id !== userMsg.id
      );
      const localHistoryIntact = priorTopicMessages.length > 0;

      let sessionPreflight: { isNew: boolean; recoveryMode?: 'resume' | 'load' | 'new' } | null = null;
      try {
        sessionPreflight = await ensureAcpAgentSession({
          agentId: agent.id,
          roomId: topicId,
          channelId: topicChannel?.id || activeTopicData?.channelId,
          systemPrompt: preflightSystemPrompt,
          discussionMode: isGameTheoretic ? 'game_theoretic' : 'standard',
          workspaceBindingId: activeTopicData?.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(activeTopicData?.id)?.cwd,
          scopeType: 'topic',
          localHistoryIntact,
        });
      } catch (err) {
        console.error(`[TopicTurn] Preflight ensureAcpAgentSession failed for ${agent.name}:`, err);
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
        setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, status: 'idle' } : a)));
        syncRunningAgentsWithBackend();

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
          content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
        };

        if (isGameTheoretic && executionStage === 'challenge') {
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'arbitration',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'arbitration',
              isChallengerResponded: false,
              quorumAlert: `制衡方 (${agent.name}) 发生会话初始化异常：${err instanceof Error ? err.message : String(err)}`,
            },
          }));
        }

        commitMessages((prev) => {
          const existing = prev[topicId] || [];
          return {
            ...prev,
            [topicId]: [...existing, errorReply],
          };
        });
        return null;
      }

      if (sessionPreflight?.isNew || sessionPreflight?.recoveryMode === 'new') {
        deliveredStandingContextRef.current.delete(sessionKey);
        sessionWatermarksRef.current.delete(sessionKey);
        persistSessionWarmState();
      } else if (
        sessionPreflight?.recoveryMode === 'resume' ||
        sessionPreflight?.recoveryMode === 'load'
      ) {
        deliveredStandingContextRef.current.add(sessionKey);
        if (!sessionWatermarksRef.current.has(sessionKey)) {
          const currentTopicTranscript = messagesRef.current[topicId] || [];
          const lastPriorMsg = currentTopicTranscript
            .slice()
            .reverse()
            .find((m) => !m.isPending && m.id !== userMsg.id);
          if (lastPriorMsg) {
            sessionWatermarksRef.current.set(sessionKey, lastPriorMsg.id);
          }
        }
        persistSessionWarmState();
      }

      const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);
      const systemPrompt = buildCompositeSystemPrompt({
        agent,
        availableAgents: candidateAgents,
        includeRoster: !isStandingContextDelivered,
      });

      let finalPrompt: string;
      if (isGameTheoretic) {
        finalPrompt = buildTopicPrompt({
          topic: topicContext,
          userContent: content,
          targetAgent: agent,
          availableAgents: candidateAgents,
        });
      } else {
        // 对标 Buzz: 标准模式按 (topicId:agentId) 水位线提取未读增量批次 (<delta-events>)
        const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
        const currentTopicTranscript = messagesRef.current[topicId] || [];
        const deltaBatch = extractUnreadDeltaMessages({
          messages: currentTopicTranscript,
          triggerMessages: [userMsg],
          lastWatermarkMessageId: lastWatermark,
          excludeAuthorId: agent.id,
        });
        if (deltaBatch.latestWatermarkMessageId) {
          sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
          persistSessionWarmState();
        }
        finalPrompt = buildNormalModeTurnPrompt({
          targetAgent: agent,
          availableAgents: candidateAgents,
          roomId: topicId,
          isWarmSession: deltaBatch.isWarmSession,
          deltaMessages: deltaBatch.deltaMessages,
          triggerContent: content,
          hop: 1,
          maxHops: 12,
          topic: topicContext,
          isDm: false,
          isParallelFirstTurn: onlineAgents.length > 1,
        });
      }

      deliveredStandingContextRef.current.add(sessionKey);
      persistSessionWarmState();

      const cascadeId = isGameTheoretic
        ? `cascade-topic-${Date.now()}-${agent.id}`
        : sharedStandardCascadeId;

      if (isGameTheoretic) {
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
      }

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
            ? executionStage === 'defense'
              ? '正在审视反例质询与实测数据，构建架构防御与补丁方案 (Stage: 🛡️ 答辩修正)...'
              : '正在构思核心立论方案与架构设计推演 (Stage: 🏛️ 方案立论)...'
            : targetRoleType === 'challenger'
            ? '正在对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...'
            : targetRoleType === 'verifier'
            ? '正在调取外部工具、代码解释器沙箱与事实基准进行真实性接地校验 (Stage: 🔍 接地验证)...'
            : '正在权衡方案、反例与接地证据并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...'
          : '正在思考并组织回复...',
        agentBadge: isGameTheoretic
          ? `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${
              targetRoleType === 'proposer'
                ? executionStage === 'defense'
                  ? '🛡️ 答辩修正 (思考中...)'
                  : '🏛️ 方案立论 (思考中...)'
                : targetRoleType === 'challenger'
                ? '⚔️ 反例压测 (思考中...)'
                : targetRoleType === 'verifier'
                ? '🔍 接地验证 (执行中...)'
                : '⚖️ 仲裁建言 (思考中...)'
            }`
          : `${agent.modelBadge?.split(' ')[0] || 'Local'} · 思考中...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: isGameTheoretic ? executionStage : undefined,
        gameRole: isGameTheoretic ? targetRoleType : undefined,
      };

      commitMessages((prev) => {
        const existing = prev[topicId] || [];
        const nextTopicMsgs = existing.some((m) => m.id === pendingId)
          ? existing
          : [...existing, pendingMsg];
        return {
          ...prev,
          [topicId]: nextTopicMsgs,
        };
      });

      const turnSnapshot = captureTurnEpoch(topicId, topicChannel?.id || activeTopicData?.channelId, agent.id);
      return sendPromptToAcpAgent({
        agent,
        roomId: topicId,
        prompt: finalPrompt,
        channelId: topicChannel?.id,
        workspaceBindingId: activeTopicData?.workspaceBindingId,
        workspaceCwd: getTopicWorkspaceBinding(activeTopicData?.id)?.cwd,
        scopeType: 'topic',
        systemPrompt,
        discussionMode: activeTopicData?.discussionMode,
      })
        .then((acpResp) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping topic prompt reply because turn was aborted or invalidated');
            return null;
          }

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
                    ? executionStage === 'defense'
                      ? '🛡️ 答辩修正'
                      : '🏛️ 方案立论'
                    : targetRoleType === 'challenger'
                    ? '⚔️ 反例压测'
                    : targetRoleType === 'verifier'
                    ? '🔍 接地验证'
                    : '⚖️ 仲裁建言'
                }`
              : `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : agent.isRemote ? 'ACP Remote' : '协作'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            thinkingProcess: buildThinkingProcessFromAcp(acpResp, isGameTheoretic ? '已完成博弈推演与技术边界审定' : '已检索私有记忆库并完成技术边界考量'),
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
            collaborationInfo: {
              cascadeId,
              hop: 1,
              maxHops: 12,
              rootMessageId: userMsg.id,
              sourceMessageId: userMsg.id,
              invokedByAgentId: userMsg.authorId,
              invokedByAgentName: userMsg.authorName,
              invokedByAgentHandle: userMsg.authorHandle,
            },
          };

          commitMessages((prev) => {
            const existing = prev[topicId] || [];
            const hasPending = existing.some((m) => m.id === pendingId);
            const nextTopicMsgs = hasPending
              ? existing.map((m) => (m.id === pendingId ? agentReply : m))
              : existing.some((m) => m.id === agentReply.id)
              ? existing
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
                const extractedDecomp = extractModuleDecompositionFromAcpResponse(acpResp, agent.name);
                const currentTopicData = getTopicData(topicId) || activeTopicData;
                const baseModular = extractedDecomp
                  ? initializeModularOrchestrationState(extractedDecomp)
                  : currentTopicData?.gameTheoreticState?.modularState ||
                    initializeModularOrchestrationState(
                      buildDefaultDecompositionFromTopic(currentTopicData?.title || '', currentTopicData?.description, acpResp.textResponse)
                    );

                const hasVerifiers = (currentTopicData?.gameRoles?.verifiers || []).length > 0;

                // 统一调用 stepModularStageTransition 计算首模块提案流转与快速通道判定 (N8, N10, N12)
                const propStep = stepModularStageTransition({
                  state: baseModular,
                  currentStage: 'proposal',
                  feedbackDelta: {},
                  proposalOrDefenseSnippet: acpResp.textResponse,
                  hasVerifiers,
                });

                const nextStageForM1 = propStep.nextGameStage as 'verification' | 'challenge';
                const nextModular: ModularOrchestrationState = {
                  ...propStep.nextState,
                  modules: propStep.nextState.modules.map((m) =>
                    m.moduleId === baseModular.activeModuleId
                      ? { ...m, scopedMessageIds: [...m.scopedMessageIds, agentReply.id] }
                      : m
                  ),
                };

                const activeMod = nextModular.modules.find(
                  (m) => m.moduleId === nextModular.activeModuleId
                );
                const isFastTrack = nextStageForM1 === 'verification';
                const wasDowngraded = propStep.posteriorAction === 'ESCALATE_TO_RED_TEAM';

                // 白名单正交收敛非静默审计通知 (N5)
                const dedupRecords = baseModular.whitelistDeduplications || [];
                if (dedupRecords.length > 0) {
                  const dedupNoticeMsg: Message = {
                    id: `msg-whitelist-dedup-${Date.now()}`,
                    threadId: topicId,
                    channelId: topicChannel?.id,
                    authorId: 'system',
                    authorName: 'G-Frame 白名单正交裁决器',
                    authorHandle: '@gframe-whitelist-governor',
                    authorAvatar: '🛡️',
                    isAgent: true,
                    agentBadge: `白名单拓扑归属收敛 (${dedupRecords.length} 项)`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: `🛡️ **G-Frame 白名单正交归属收敛 (Whitelist Disjoint Enforcement)**：\n` +
                      dedupRecords
                        .map((d) => `- **${d.file}**：由上游模块「${d.allocatedToModuleTitle}」独占持有，已从下游「${d.strippedFromModuleTitle}」白名单中显式收敛剥离。下游模块须经由《公共接口契约》以只读方式引入。`)
                        .join('\n'),
                  };
                  setMessages((prev) => ({
                    ...prev,
                    [topicId]: [...(prev[topicId] || []), dedupNoticeMsg],
                  }));
                }

                // fast_track 快速通道校验验证官与通知 (N8 & N10 & N12)
                if (wasDowngraded && activeMod) {
                  const downgradeNotice: Message = {
                    id: `msg-fast-track-downgrade-${Date.now()}`,
                    threadId: topicId,
                    channelId: topicChannel?.id,
                    authorId: 'system',
                    authorName: '贝叶斯快速通道调控器',
                    authorHandle: '@bayesian-fast-track',
                    authorAvatar: '⚠️',
                    isAgent: true,
                    agentBadge: 'Fast Track Downgraded',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: `⚠️ **快速通道降级告警 (Fast-Track Downgraded)**：模块「${activeMod.title}」先验虽符合快速通道标准，但当前议题未指派接地验证官 (Verifier)，无法执行物理接地与静态契约校验。自动降级为标准深度博弈 (deep_debate)，流转至【阶段 2: ⚔️ 反例压测】！`,
                    gameStage: 'challenge',
                  };
                  setMessages((prev) => ({
                    ...prev,
                    [topicId]: [...(prev[topicId] || []), downgradeNotice],
                  }));
                } else if (isFastTrack && activeMod) {
                  const fastTrackNotice: Message = {
                    id: `msg-fast-track-${Date.now()}`,
                    threadId: topicId,
                    channelId: topicChannel?.id,
                    authorId: 'system',
                    authorName: '贝叶斯快速通道调控器',
                    authorHandle: '@bayesian-fast-track',
                    authorAvatar: '⚡',
                    isAgent: true,
                    agentBadge: 'Fast Track',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: `⚡ **贝叶斯快速通道 (fast_track)**：模块「${activeMod.title}」先验风险为 ${(activeMod.belief.priorRisk * 100).toFixed(0)}% (< 45%)，符合低熵确定性模块标准。跳过红队对抗，直接流转至接地验证与契约对齐！`,
                    gameStage: 'verification',
                  };
                  setMessages((prev) => ({
                    ...prev,
                    [topicId]: [...(prev[topicId] || []), fastTrackNotice],
                  }));
                }

                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: nextStageForM1,
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: nextStageForM1,
                    targetProposalContent: acpResp.textResponse,
                    isChallengerResponded: false,
                    isChallengerBypassed: isFastTrack,
                    challengerBypassedReason: isFastTrack
                      ? 'Bayesian Fast-Track: 模块先验风险低于阈值，依博弈规约旁路红队对抗直接进入接地验证。'
                      : undefined,
                    modularState: nextModular,
                    cognoNexus: {
                      ...(old.gameTheoreticState?.cognoNexus || { committedStates: [] }),
                      modularState: nextModular,
                    },
                  },
                }));

                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: nextStageForM1,
                  targetProposalText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'challenge') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Challenger returned empty/error turn, pausing handover.');
              } else {
                const hasVerifiers = (activeTopicData?.gameRoles?.verifiers || []).length > 0;
                const nextStageTarget = hasVerifiers ? 'verification' : 'defense';
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: nextStageTarget,
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: nextStageTarget,
                    targetChallengeContent: acpResp.textResponse,
                    isChallengerResponded: true,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: nextStageTarget,
                  targetProposalText: activeTopicData?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'verification') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Verifier returned empty/error turn, pausing handover.');
              } else {
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'defense',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'defense',
                    targetVerificationContent: acpResp.textResponse,
                    isVerifierResponded: true,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'defense',
                  targetProposalText: activeTopicData?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: activeTopicData?.gameTheoreticState?.targetChallengeContent,
                  targetVerificationText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'defense') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Proposer defense returned empty/error turn, pausing handover.');
              } else {
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'arbitration',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'arbitration',
                    targetDefenseContent: acpResp.textResponse,
                    isDefenseResponded: true,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'arbitration',
                  targetProposalText: activeTopicData?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: activeTopicData?.gameTheoreticState?.targetChallengeContent,
                  targetVerificationText: activeTopicData?.gameTheoreticState?.targetVerificationContent,
                  targetDefenseText: acpResp.textResponse,
                });
              }
            }
          } else {
            // 标准讨论模式：收集本轮并发输出，待 Turn Barrier 全部汇合后统一去重触发下一跳
            standardTurnOutputs.push({
              agent,
              messageId: agentReply.id,
              replyContent: acpResp.textResponse,
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
          syncRunningAgentsWithBackend();
          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping topic prompt error because turn was aborted or invalidated');
            return null;
          }
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

          commitMessages((prev) => {
            const existing = prev[topicId] || [];
            const hasPending = existing.some((m) => m.id === pendingId);
            const nextTopicMsgs = hasPending
              ? existing.map((m) => (m.id === pendingId ? errorReply : m))
              : existing.some((m) => m.id === errorReply.id)
              ? existing
              : [...existing, errorReply];
            return {
              ...prev,
              [topicId]: nextTopicMsgs,
            };
          });
        });
    });

    // 标准讨论模式：Turn Barrier 同步屏障 —— 等待首轮所有并发 Agent 全部执行完毕后，统一聚合去重 @mention 唤醒下一跳
    if (!isGameTheoretic && agentTurnPromises.length > 0) {
      Promise.allSettled(agentTurnPromises).then(() => {
        if (isTurnStale(topicTurnSnapshot)) return;
        if (standardTurnOutputs.length > 0) {
          dispatchCascadingAgentResponse({
            cascadeId: sharedStandardCascadeId,
            turnOutputs: standardTurnOutputs,
            roomId: topicId,
            isTopic: true,
            topicId,
          });
        }
      });
    }
  };

  const dispatchTopicExecution = async (options: {
    topicId: string;
    executorId: string;
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
    };
  }) => {
    const { topicId, executorId, decision } = options;
    const currentTopic = getTopicData(topicId);
    if (!currentTopic) return;
    const turnSnapshot = captureTurnEpoch(topicId, currentTopic.channelId || activeChannel?.id, executorId);

    const executorAgent = agentsRef.current.find((a) => a.id === executorId);
    if (!executorAgent) {
      console.warn(`[Execution] Executor agent ${executorId} not found.`);
      return;
    }

    const topicChannel = channels.find((c) => c.id === currentTopic.channelId) || activeChannel;

    if (isAgentOffline(executorAgent)) {
      const offlineNotice: Message = {
        id: `msg-offline-exec-${Date.now()}`,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: 'system',
        authorName: 'Shadow Crew 落地执行守护',
        authorHandle: '@exec-guard',
        authorAvatar: '🔌',
        isAgent: true,
        agentBadge: 'Communication Required',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `🔌 **执行 Agent 通信尚未开启**：已指派 **${executorAgent.name}** 推进定案决议落地，但该 Agent 当前处于离线状态。\n\n请在左侧面板点击【Start】开启 ACP 通信后重新指派落地。`,
      };
      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), offlineNotice],
      }));
      updateTopicDataInState(topicId, (old) => ({
        ...old,
        gameTheoreticState: {
          ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
          assignedExecutorId: executorAgent.id,
          executionStatus: 'failed',
          executionSummary: '执行 Agent 处于离线状态，需开启通信后重试',
        },
      }));
      return;
    }

    // Multi-Topic Concurrency Guard: If this executor agent is currently busy on another topic, queue first
    const isBusyElsewhere = () =>
      Object.values(activeExecutionsRef.current).some(
        (e) => e.agentId === executorAgent.id && e.topicId !== topicId && e.threadId !== topicId
      );

    if (isBusyElsewhere()) {
      updateTopicDataInState(topicId, (old) => ({
        ...old,
        gameTheoreticState: {
          ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
          assignedExecutorId: executorAgent.id,
          executionStatus: 'queued',
          executionSummary: `等待 ${executorAgent.name} 完成前序并行任务...`,
        },
        decisionRecord: old.decisionRecord
          ? {
              ...old.decisionRecord,
              executorId: executorAgent.id,
              executorName: executorAgent.name,
            }
          : old.decisionRecord,
        rulingRecord: old.rulingRecord
          ? {
              ...old.rulingRecord,
              executorId: executorAgent.id,
            }
          : old.rulingRecord,
      }));

      let waitLoops = 0;
      while (isBusyElsewhere() && waitLoops < 150) {
        if (isTurnStale(turnSnapshot)) return;
        await new Promise((r) => setTimeout(r, 800));
        waitLoops++;
      }
      if (isTurnStale(turnSnapshot)) return;
    }

    const startTimeMs = Date.now();

    // Update topic execution state to running
    updateTopicDataInState(topicId, (old) => ({
      ...old,
      gameTheoreticState: {
        ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
        assignedExecutorId: executorAgent.id,
        executionStatus: 'running',
        executionStartedAt: startTimeMs,
        executionSummary: `正在由 ${executorAgent.name} 执行定案决议并生成交付成果...`,
      },
      decisionRecord: old.decisionRecord
        ? {
            ...old.decisionRecord,
            executorId: executorAgent.id,
            executorName: executorAgent.name,
          }
        : old.decisionRecord,
      rulingRecord: old.rulingRecord
        ? {
            ...old.rulingRecord,
            executorId: executorAgent.id,
          }
        : old.rulingRecord,
    }));

    // Update the channel rollup notice in-place to reflect live execution start
    setMessages((prev) => {
      let parentThreadId: string | null = null;
      for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
        if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
          parentThreadId = tId;
          break;
        }
      }
      if (!parentThreadId) return prev;
      return {
        ...prev,
        [parentThreadId]: (prev[parentThreadId] || []).map((m) => {
          if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
            const baseContent = m.content.split('\n\n---\n')[0];
            return {
              ...m,
              content: `${baseContent}\n\n---\n⏳ **决议落地进度**：已委派 **${executorAgent.name}** (${executorAgent.handle}) 正在推进定案决议落地...`,
            };
          }
          return m;
        }),
      };
    });

    const execKey = `${topicId}:${executorAgent.id}`;
    setIsGenerating(true);
    setActiveExecutions((prev) => ({
      ...prev,
      [execKey]: {
        agentId: executorAgent.id,
        agentName: executorAgent.name,
        agentAvatar: executorAgent.avatar,
        threadId: topicId,
        topicId,
        status: 'thinking',
        currentActionDetail: `正在基于定案决议执行落地任务与交付输出 (Stage: 🛠️ 决议落地)...`,
        startedAt: startTimeMs,
        cascadeHop: 5,
      },
    }));

    setAgents((prev) =>
      prev.map((a) => (a.id === executorAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
    );

    const pendingId = `topic-pending-exec-${Date.now()}-${executorAgent.id}`;
    const pendingMsg: Message = {
      id: pendingId,
      threadId: topicId,
      channelId: topicChannel?.id,
      authorId: executorAgent.id,
      authorName: executorAgent.name,
      authorHandle: executorAgent.handle,
      authorAvatar: executorAgent.avatar,
      isAgent: true,
      isPending: true,
      startedAt: startTimeMs,
      pendingHint: '正在基于定案决议与权衡约束，推进落地执行并整理交付成果 (Stage: 🛠️ 决议落地)...',
      agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛠️ 决议落地 (执行中...)`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: '',
      gameStage: 'concluded',
      relatedTopicId: topicId,
    };

    setMessages((prev) => ({
      ...prev,
      [topicId]: [...(prev[topicId] || []), pendingMsg],
    }));

    const topicContext: TopicPromptContext = {
      topicId,
      title: currentTopic.title,
      description: currentTopic.description,
      channelName: topicChannel?.name || 'chat',
      status: currentTopic.status,
      discussionMode: currentTopic.discussionMode,
      gameRoles: currentTopic.gameRoles,
      gameStage: 'concluded',
      targetProposalText: currentTopic.gameTheoreticState?.targetProposalContent,
      targetChallengeText: currentTopic.gameTheoreticState?.targetChallengeContent,
      targetDefenseText: currentTopic.gameTheoreticState?.targetDefenseContent,
    };

    const execPrompt = buildExecutionPrompt({
      topic: topicContext,
      executorAgent,
      decision: {
        summary: decision.rulingRecord?.summary || decision.solution,
        solution: decision.solution,
        tradeOffPoints: decision.rulingRecord?.tradeOffPoints,
        impactedFiles: decision.impactedFiles,
      },
    });

    try {
      const acpResp = await sendPromptToAcpAgent({
        agent: executorAgent,
        roomId: topicId,
        prompt: execPrompt,
        channelId: topicChannel?.id,
        workspaceBindingId: currentTopic.workspaceBindingId,
        workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
        scopeType: 'topic',
        systemPrompt: buildAgentPersonaPrompt(executorAgent),
        discussionMode: 'game_theoretic',
      });

      setActiveExecutions((prev) => {
        const next = { ...prev };
        delete next[execKey];
        if (Object.keys(next).length === 0) setIsGenerating(false);
        return next;
      });

      if (isTurnStale(turnSnapshot)) {
        console.log('[App] Dropping topic execution reply because turn was aborted or invalidated');
        return;
      }

      if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
        throw new Error(acpResp.isError ? acpResp.textResponse : '执行 Agent 返回空响应，未生成有效交付内容。');
      }

      const extractedDiffs =
        acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
          ? acpResp.workspaceDiffs
          : extractWorkspaceDiffsFromText(acpResp.textResponse, decision.impactedFiles);

      const execMeta = acpResp.executionMeta;
      const completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const execReply: Message = {
        id: `topic-reply-exec-${Date.now()}-${executorAgent.id}`,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: executorAgent.id,
        authorName: executorAgent.name,
        authorHandle: executorAgent.handle,
        authorAvatar: executorAgent.avatar,
        isAgent: true,
        isPending: false,
        agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · ${execMeta?.podTitle || '🛠️ 决议落地交付'}`,
        timestamp: completedAt,
        content: acpResp.textResponse,
        gameStage: 'concluded',
        thinkingProcess: buildThinkingProcessFromAcp(
          acpResp,
          execMeta?.statusSummary || '已完成定案决议落地执行交付'
        ),
        diffView: extractedDiffs.length > 0 ? extractedDiffs[0] : undefined,
        diffViews: extractedDiffs.length > 0 ? extractedDiffs : undefined,
        relatedTopicId: topicId,
        cartridgeCitation: acpResp.cartridgeCitation,
      };

      const totalAdd = extractedDiffs.reduce((s, d) => s + d.additions, 0);
      const totalDel = extractedDiffs.reduce((s, d) => s + d.deletions, 0);

      setMessages((prev) => {
        const existing = prev[topicId] || [];
        const hasPending = existing.some((m) => m.id === pendingId);
        const nextTopicMsgs = hasPending
          ? existing.map((m) => (m.id === pendingId ? execReply : m))
          : [...existing, execReply];
        let parentThreadId: string | null = null;
        for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
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
                    latestReplyPreview: execReply.content.slice(0, 60),
                    gameTheoreticState: {
                      ...(m.topicData.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
                      assignedExecutorId: executorAgent.id,
                      executionStatus: 'completed' as const,
                      executionCompletedAt: completedAt,
                      executionDiffs: extractedDiffs,
                      executionUiMeta: execMeta,
                      executionSummary:
                        execMeta?.statusSummary ||
                        (extractedDiffs.length > 0
                          ? `已生成 ${extractedDiffs.length} 个工作区交付文件 (+${totalAdd}/-${totalDel})`
                          : '已完成定案决议落地执行报告'),
                    },
                  },
                };
              }
              if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
                const baseContent = m.content.split('\n\n---\n')[0];
                return {
                  ...m,
                  diffView: extractedDiffs.length > 0 ? extractedDiffs[0] : m.diffView,
                  diffViews: extractedDiffs.length > 0 ? extractedDiffs : m.diffViews,
                  content:
                    extractedDiffs.length > 0
                      ? `${baseContent}\n\n---\n✅ **${execMeta?.podTitle || '决议落地变更已就绪'} (${completedAt})**：由 **${executorAgent.name}** 完成了 **${execMeta?.statusSummary || `${extractedDiffs.length} 个文件变更 (+${totalAdd} / -${totalDel})`}**，可在议题卡片或审查视图中一键核对并合入本地工作区。`
                      : `${baseContent}\n\n---\n✅ **${execMeta?.podTitle || '决议落地已完成'} (${completedAt})**：**${executorAgent.name}** 已在议题抽屉内完成交付（${execMeta?.statusSummary || '详见抽屉内执行报告'}）。`,
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

      if (isTurnStale(turnSnapshot)) {
        console.log('[App] Dropping topic execution error because turn was aborted or invalidated');
        return;
      }

      console.error('Executor execution failed:', err);
      const errText = err instanceof Error ? err.message : String(err);
      const errorMsg: Message = {
        id: `topic-exec-err-${Date.now()}-${executorAgent.id}`,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: executorAgent.id,
        authorName: executorAgent.name,
        authorHandle: executorAgent.handle,
        authorAvatar: executorAgent.avatar,
        isAgent: true,
        agentBadge: 'ACP Error',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `⚠️ **决议落地执行异常**：${errText}`,
        gameStage: 'concluded',
        relatedTopicId: topicId,
      };

      setMessages((prev) => {
        const existing = prev[topicId] || [];
        const filtered = existing.filter((m) => m.id !== pendingId);
        return {
          ...prev,
          [topicId]: [...filtered, errorMsg],
        };
      });

      updateTopicDataInState(topicId, (old) => ({
        ...old,
        gameTheoreticState: {
          ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
          executionStatus: 'failed',
          executionSummary: errText.slice(0, 80),
        },
      }));
    }
  };

  const handleResolveTopic = (
    topicId: string,
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
      executorId?: string;
    }
  ) => {
    const resolvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const targetExecutorId = decision.executorId || decision.rulingRecord?.executorId;
    const executorAgent = targetExecutorId ? agentsRef.current.find((a) => a.id === targetExecutorId) : undefined;

    const currentMinorityReport = decision.rulingRecord?.minorityReport || activeTopicData?.gameTheoreticState?.minorityReport;

    const rulingRecordWithExecutor: RulingRecord | undefined = decision.rulingRecord ? {
      ...decision.rulingRecord,
      executorId: targetExecutorId,
      minorityReport: decision.rulingRecord.minorityReport || currentMinorityReport,
    } : undefined;

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
              gameTheoreticState: {
                ...(m.topicData.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
                currentStage: 'concluded' as GameTheoreticStage,
                isArbiterExempted: Boolean(decision.rulingRecord?.exemptionReason),
                exemptionReason: decision.rulingRecord?.exemptionReason,
                assignedExecutorId: targetExecutorId,
                executionStatus: targetExecutorId ? 'running' : (m.topicData.gameTheoreticState?.executionStatus || 'idle'),
                minorityReport: currentMinorityReport,
              },
              decisionRecord,
              rulingRecord: rulingRecordWithExecutor,
            },
          };
        }
        return m;
      });

      let rollupContent = `⚖️ **议题已达成共识并定案 (Resolved & Merged)**\n\n**决策方案**：${decision.solution}\n${executorAgent ? `**指派落地执行**：🛠️ ${executorAgent.name} (${executorAgent.handle} · ${executorAgent.role})\n` : ''}**影响文件**：${decision.impactedFiles.join('、') || '无'}\n**签署人**：${decision.approvers.join('、')}\n\n*详细推演过程已在议题抽屉归档保存。*`;

      if (decision.rulingRecord) {
        const typeText = decision.rulingRecord.decisionType === 'adopt_proposer'
          ? '⚖️ 采纳主导方案'
          : decision.rulingRecord.decisionType === 'reject_rebuild'
          ? '🔄 采纳挑战驳回重构'
          : '📊 达成架构权衡矩阵';
        const minoritySection = currentMinorityReport
          ? `\n\n📌 **伴生少数派异议备案 (Minority Dissent)**：\n- **异议代表**：${currentMinorityReport.dissentingAgentName}\n- **保留意见**：${currentMinorityReport.coreDissentThesis}\n- **自洽逻辑**：${currentMinorityReport.rationalityBasis}\n- **黑天鹅重启条件**：\n${currentMinorityReport.reopeningTriggers.map((t) => `  • ${t}`).join('\n')}`
          : '';
        rollupContent = `⚖️ **博弈讨论仲裁定案 (${typeText})**\n\n**仲裁裁决官**：${decision.rulingRecord.arbiterName}\n**裁决结论**：${decision.rulingRecord.summary}\n${decision.solution ? `**实施/重构方案**：${decision.solution}\n` : ''}${decision.rulingRecord.tradeOffPoints && decision.rulingRecord.tradeOffPoints.length > 0 ? `**关键权衡要点**：\n${decision.rulingRecord.tradeOffPoints.map((p) => `- ${p}`).join('\n')}\n` : ''}${minoritySection}${decision.rulingRecord.exemptionReason ? `\n**特权豁免记录**：⚠️ 已执行人类首席仲裁官具名豁免 (${decision.rulingRecord.exemptionReason})\n` : ''}${executorAgent ? `\n**指派落地执行**：🛠️ ${executorAgent.name} (${executorAgent.handle} · ${executorAgent.role})\n` : ''}**影响文件**：${decision.impactedFiles.join('、') || '无'}\n**签署裁决**：${decision.approvers.join('、')}\n\n*博弈论证与仲裁全过程已归档。*`;
      }

      const rollupNotice: Message = {
        id: `msg-rollup-${topicId}`,
        threadId: parentThreadId,
        channelId: activeTopicData?.channelId || activeChannel?.id,
        authorId: 'system',
        authorName: decision.rulingRecord ? 'Shadow Crew 仲裁法槌' : 'Shadow Crew 共识引擎',
        authorHandle: decision.rulingRecord ? '@arbiter-gavel' : '@consensus-engine',
        authorAvatar: '⚖️',
        isAgent: true,
        kind: 'rollup',
        agentBadge: decision.rulingRecord ? 'Arbiter Ruling' : 'Consensus Rollup',
        timestamp: resolvedAt,
        relatedTopicId: topicId,
        content: rollupContent,
      };

      const hasExistingRollup = updatedChannelMsgs.some(
        (m) => m.relatedTopicId === topicId && (m.kind === 'rollup' || m.id.startsWith('msg-rollup-'))
      );
      const finalChannelMsgs = hasExistingRollup
        ? updatedChannelMsgs.map((m) =>
            m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-') ? rollupNotice : m
          )
        : [...updatedChannelMsgs, rollupNotice];

      return {
        ...prev,
        [parentThreadId]: finalChannelMsgs,
      };
    });

    if (targetExecutorId) {
      setTimeout(() => {
        dispatchTopicExecution({
          topicId,
          executorId: targetExecutorId,
          decision: {
            ...decision,
            rulingRecord: rulingRecordWithExecutor,
          },
        });
      }, 300);
    }
  };

  const handleExecuteTopicPatch = (topicId: string, executorId: string) => {
    const currentTopic = getTopicData(topicId);
    if (!currentTopic) return;
    dispatchTopicExecution({
      topicId,
      executorId,
      decision: {
        solution: currentTopic.decisionRecord?.solution || currentTopic.rulingRecord?.solution || currentTopic.description || currentTopic.title,
        impactedFiles: currentTopic.decisionRecord?.impactedFiles || currentTopic.rulingRecord?.impactedFiles || [],
        approvers: currentTopic.decisionRecord?.approvers || [],
        rulingRecord: currentTopic.rulingRecord,
      },
    });
  };

  const handleApplyTopicPatch = async (topicId?: string, customDiffs?: TopicPatchDiffItem[]) => {
    const targetTopicId = topicId || activeDiff?.topicId || activeTopicId;
    const currentTopic = targetTopicId ? getTopicData(targetTopicId) : null;
    const diffsToApply: TopicPatchDiffItem[] =
      customDiffs && customDiffs.length > 0
        ? customDiffs
        : currentTopic?.gameTheoreticState?.executionDiffs ||
          (activeDiff?.allDiffs && activeDiff.allDiffs.length > 0 ? activeDiff.allDiffs : activeDiff ? [activeDiff] : []);

    if (!diffsToApply || diffsToApply.length === 0) return;

    const topicChannel =
      (currentTopic?.channelId ? channels.find((c) => c.id === currentTopic.channelId) : null) ||
      activeChannel;
    const effectiveChanId = topicChannel?.id || 'general';
    const topicBinding = getTopicWorkspaceBinding(targetTopicId || currentTopic?.id);
    if (!topicBinding) {
      throw new Error(`议题 ${targetTopicId || currentTopic?.id || 'unknown'} 缺少 Workspace Binding`);
    }

    const res = await applyTopicPatchToWorkspace({
      workspaceBindingId: topicBinding.id,
      workspaceRoot: topicBinding.cwd,
      artifactRoot: topicBinding.artifactRoot,
      channelId: effectiveChanId,
      topicId: targetTopicId || 'adhoc-patch',
      patches: diffsToApply,
    });

    const appliedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updatedDiffs: TopicPatchDiffItem[] = diffsToApply.map((d) => {
      const match = res.appliedFiles.find((af) => af.filename === d.filename);
      return {
        ...d,
        applied: true,
        appliedMode: match?.mode || 'artifact_saved',
        targetPath: match?.targetPath,
      };
    });

    if (targetTopicId) {
      updateTopicDataInState(targetTopicId, (old) => ({
        ...old,
        gameTheoreticState: {
          ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
          executionStatus: 'applied',
          executionAppliedAt: appliedAt,
          executionArtifactsDir: res.artifactsDir,
          executionSummary: res.summary,
          executionDiffs: updatedDiffs,
        },
      }));

      const execMeta = currentTopic?.gameTheoreticState?.executionUiMeta;
      const applyConfirmMsg: Message = {
        id: `topic-patch-applied-${Date.now()}`,
        threadId: targetTopicId,
        channelId: topicChannel?.id,
        authorId: 'system',
        authorName: 'Shadow Crew 工作区合入引擎',
        authorHandle: '@workspace-patcher',
        authorAvatar: '⚖️',
        isAgent: true,
        agentBadge: 'Workspace Applied',
        timestamp: appliedAt,
        relatedTopicId: targetTopicId,
        content: `✅ **${execMeta?.podTitle || '决议交付文件'}已物理合入本地工作区**\n\n- **合入摘要**：${res.summary}\n- **归档目录**：\`${res.artifactsDir}\`\n- **变更文件明细**：\n${res.appliedFiles.map((f) => `  • \`${f.filename}\` → \`${f.targetPath}\` (${f.mode})`).join('\n')}`,
      };

      setMessages((prev) => {
        const existingTopicMsgs = prev[targetTopicId] || [];
        let parentThreadId: string | null = null;
        for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
          if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === targetTopicId)) {
            parentThreadId = tId;
            break;
          }
        }
        const updatedParentMsgs = parentThreadId
          ? (prev[parentThreadId] || []).map((m) => {
              if (m.relatedTopicId === targetTopicId && m.id.startsWith('msg-rollup-')) {
                const baseContent = m.content.split('\n\n---\n')[0];
                return {
                  ...m,
                  content: `${baseContent}\n\n---\n🎉 **${execMeta?.podTitle || '决议交付'}已合入工作区 (${appliedAt})**：${res.summary}（归档于 \`${res.artifactsDir}\`）`,
                };
              }
              return m;
            })
          : [];

        return {
          ...prev,
          [targetTopicId]: [...existingTopicMsgs, applyConfirmMsg],
          ...(parentThreadId ? { [parentThreadId]: updatedParentMsgs } : {}),
        };
      });
    }

    setActiveDiff((prev: any) =>
      prev
        ? {
            ...prev,
            executionStatus: 'applied',
            artifactsDir: res.artifactsDir,
            allDiffs: updatedDiffs,
          }
        : prev
    );
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
    const isGameTopic = threadId
      ? getTopicData(threadId)?.discussionMode === 'game_theoretic'
      : false;

    executeAbortAgentOrchestration({
      agentId,
      threadId,
      isGameTopic,
      activeExecutionsRef,
      activeCascadesRef,
      turnEpochTracker: turnEpochTrackerRef.current,
      inFlightHandovers: inFlightHandoverRef.current,
      generationEpochRef,
      setActiveExecutions,
      setActiveCascades,
      setIsGenerating,
      setAgents,
      setMessages: commitMessages,
    });
  };

  const handleAbortAll = (threadId?: string) => {
    executeAbortAllOrchestration({
      threadId,
      activeExecutionsRef,
      activeCascadesRef,
      turnEpochTracker: turnEpochTrackerRef.current,
      inFlightHandovers: inFlightHandoverRef.current,
      generationEpochRef,
      setActiveExecutions,
      setActiveCascades,
      setIsGenerating,
      setAgents,
      setMessages: commitMessages,
    });
  };

  // Send Message in active thread
  const handleSendMessage = (content: string) => {
    if (!content.trim() || !activeThread) return;

    const currentThreadId = activeThread.id;
    const isDmThread = activeThread.type === 'dm';

    const targetChannelId = isDmThread
      ? undefined
      : activeChannel?.id;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      threadId: currentThreadId,
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

    commitMessages((prev) => {
      const existing = prev[currentThreadId] || [];
      const nextThreadMsgs = existing.some((m) => m.id === userMsg.id)
        ? existing
        : [...existing, userMsg];
      return {
        ...prev,
        [currentThreadId]: nextThreadMsgs,
      };
    });

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
    const isChannelAll = isAllMention(content);

    let userMentionedAgents: Agent[] = [];

    if (isChannelAll) {
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

          // 频道自动邀请新成员入驻时，同步失效已有会话花名册缓存与底层 Session，使已有成员立即获知新成员
          bumpChannelEpoch(turnEpochTrackerRef.current, activeChannel.id, [currentThreadId]);
          clearSessionWarmScope({ channelId: activeChannel.id, deletedThreadIds: [currentThreadId] });
          void Promise.all([
            safelyClearAcpSessions(undefined, `channel:${activeChannel.id}`, '频道自动邀请新成员'),
            safelyClearAcpSessions(undefined, `topic:${activeChannel.id}`, '频道自动邀请新成员'),
          ]);

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
      // 普通频道模式（对标 Buzz）：当用户首次发言未显式点名特定单人时，唤醒当前频道内所有已准入的在线 Agent 在 Hop 1 并发发言
      respondingAgents = candidateAgents;
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

    // 严格检查通信状态：分离离线与在线 Agent
    const offlineAgents = respondingAgents.filter((a) => isAgentOffline(a));
    const onlineAgents = respondingAgents.filter((a) => !isAgentOffline(a));

    // 仅当用户显式 @ 了离线 Agent（或 @all），或者频道内没有任何在线 Agent 时，才弹出离线提示
    const shouldWarnOffline =
      isDmThread || isChannelAll || userMentionedAgents.length > 0 || onlineAgents.length === 0;

    if (offlineAgents.length > 0 && shouldWarnOffline) {
      const offlineNames = offlineAgents.map((a) => `**${a.name}**`).join('、');
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
          content: `🔌 **Agent 通信尚未开启**：${offlineNames} 当前处于离线/未连接状态。\n\n根据产品规范，需先在左侧「Agents & 编队」面板点击该 Agent 头像下方的【Start】按钮开启通信连接后方可协作推演。\n\n*(开启通信后，重新发送消息或在此 @ 召唤即可正常推演)*`,
        };
        setMessages((prev) => ({
          ...prev,
          [activeThread.id]: [...(prev[activeThread.id] || []), offlineNotice],
        }));
      }, 300);
    }

    if (onlineAgents.length === 0) return;

    setIsGenerating(true);
    const now = Date.now();

    // 初始化协同链状态（首轮所有并发在线 Agent 共享同一协同链实例）
    const cascadeId = `cascade-thread-${Date.now()}`;
    const initialCallCounts: Record<string, number> = {};
    onlineAgents.forEach((ag) => {
      initialCallCounts[ag.id] = 1;
    });
    const newCascade: CollaborationCascade = {
      cascadeId,
      rootMessageId: userMsg.id,
      roomId: activeThread.id,
      originalPrompt: content,
      depth: 1,
      maxDepth: 12, // 对标 Buzz: 提升至 12 轮作为不可见安全兜底
      visitedAgentIds: onlineAgents.map((ag) => ag.id),
      agentCallCounts: initialCallCounts,
      isAborted: false,
    };
    activeCascadesRef.current = {
      ...activeCascadesRef.current,
      [cascadeId]: newCascade,
    };
    setActiveCascades((prev) => ({ ...prev, [cascadeId]: newCascade }));

    const newExecs: Record<string, ActiveAgentExecution> = {};
    onlineAgents.forEach((ag, idx) => {
      // 维持 Agent 在线基线状态 ('running')，具体推演任务由 activeExecutions 独立追踪
      setAgents((prev) => prev.map((a) => (a.id === ag.id && a.status !== 'running' ? { ...a, status: 'running' } : a)));
      newExecs[`${activeThread.id}:${ag.id}`] = {
        agentId: ag.id,
        agentName: ag.name,
        agentAvatar: ag.avatar,
        threadId: activeThread.id,
        status: 'thinking',
        currentActionDetail:
          onlineAgents.length > 1
            ? '正在并发独立推演方案并对齐增量上下文 (并行 Hop 1)...'
            : '正在深度推演方案并对齐增量上下文 (Hop 1)...',
        startedAt: now + idx * 50,
        cascadeHop: 1,
      };
    });

    setActiveExecutions((prev) => ({
      ...prev,
      ...newExecs,
    }));

    const turnOutputs: TurnAgentOutput[] = [];
    const threadTurnSnapshot = captureTurnEpoch(currentThreadId, targetChannelId);

    // Hop 1 并发 Fan-out：所有在线 Agent 同时推演，并在 Turn Barrier 汇合
    const hop1Promises = onlineAgents.map(async (targetAgent, idx) => {
      const sessionKey = buildAgentSessionKey({
        agentId: targetAgent.id,
        roomId: currentThreadId,
        channelId: isDmThread ? undefined : activeChannel?.id,
        isDm: isDmThread,
        workspaceBindingId: isDmThread ? undefined : getChannelWorkspaceBinding(activeChannel?.id)?.id,
        scopeType: isDmThread ? 'dm' : 'channel',
      });

      const preflightSystemPrompt = buildCompositeSystemPrompt({
        agent: targetAgent,
        availableAgents: candidateAgents,
        includeRoster: !isDmThread,
      });

      const priorThreadMessages = (messagesRef.current[currentThreadId] || []).filter(
        (m) => !m.isPending && (m.content?.trim() || m.thinkingProcess) && m.id !== userMsg.id
      );
      const localHistoryIntact = priorThreadMessages.length > 0;

      let sessionPreflight: { isNew: boolean; recoveryMode?: 'resume' | 'load' | 'new' } | null = null;
      try {
        sessionPreflight = await ensureAcpAgentSession({
          agentId: targetAgent.id,
          roomId: currentThreadId,
          channelId: isDmThread ? undefined : activeChannel?.id,
          workspaceBindingId: isDmThread ? undefined : getChannelWorkspaceBinding(activeChannel?.id)?.id,
          workspaceCwd: isDmThread ? undefined : getChannelWorkspaceBinding(activeChannel?.id)?.cwd,
          scopeType: isDmThread ? 'dm' : 'channel',
          systemPrompt: preflightSystemPrompt,
          localHistoryIntact,
        });
      } catch (err) {
        console.error(`[ThreadTurn] Preflight ensureAcpAgentSession failed for ${targetAgent.name}:`, err);
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[`${currentThreadId}:${targetAgent.id}`];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
        setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'idle' } : a)));
        syncRunningAgentsWithBackend();

        const errorReply: Message = {
          id: `msg-err-${Date.now()}-${targetAgent.id}`,
          threadId: currentThreadId,
          channelId: targetChannelId,
          authorId: targetAgent.id,
          authorName: targetAgent.name,
          authorHandle: targetAgent.handle,
          authorAvatar: targetAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
        };
        commitMessages((prev) => {
          const existing = prev[currentThreadId] || [];
          return {
            ...prev,
            [currentThreadId]: [...existing, errorReply],
          };
        });
        return null;
      }

      if (sessionPreflight?.isNew || sessionPreflight?.recoveryMode === 'new') {
        deliveredStandingContextRef.current.delete(sessionKey);
        sessionWatermarksRef.current.delete(sessionKey);
        persistSessionWarmState();
      } else if (
        sessionPreflight?.recoveryMode === 'resume' ||
        sessionPreflight?.recoveryMode === 'load'
      ) {
        deliveredStandingContextRef.current.add(sessionKey);
        if (!sessionWatermarksRef.current.has(sessionKey)) {
          const roomTranscript = messagesRef.current[currentThreadId] || [];
          const lastPriorMsg = roomTranscript
            .slice()
            .reverse()
            .find((m) => !m.isPending && m.id !== userMsg.id);
          if (lastPriorMsg) {
            sessionWatermarksRef.current.set(sessionKey, lastPriorMsg.id);
          }
        }
        persistSessionWarmState();
      }

      const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);

      // 对标 Buzz: 组合 Agent 自身专精人设与频道级花名册公约
      const compositeSystemPrompt = buildCompositeSystemPrompt({
        agent: targetAgent,
        availableAgents: candidateAgents,
        includeRoster: !isDmThread && !isStandingContextDelivered,
      });

      const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
      const roomTranscript = messagesRef.current[currentThreadId] || [];

      const deltaBatch = extractUnreadDeltaMessages({
        messages: roomTranscript,
        triggerMessages: [userMsg],
        lastWatermarkMessageId: lastWatermark,
        coldStartSinceMessageId: userMsg.id,
        excludeAuthorId: targetAgent.id,
      });

      const finalPrompt = buildNormalModeTurnPrompt({
        targetAgent,
        availableAgents: candidateAgents,
        roomId: currentThreadId,
        isWarmSession: deltaBatch.isWarmSession,
        deltaMessages: deltaBatch.deltaMessages,
        triggerContent: content,
        hop: 1,
        maxHops: 12,
        isDm: isDmThread,
        isParallelFirstTurn: onlineAgents.length > 1,
      });

      deliveredStandingContextRef.current.add(sessionKey);
      if (deltaBatch.latestWatermarkMessageId) {
        sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
      }
      persistSessionWarmState();

      logRpc(targetAgent.name, 'client_to_agent', 'session/prompt', {
        jsonrpc: '2.0',
        id: Date.now() + idx,
        method: 'session/prompt',
        params: {
          threadId: currentThreadId,
          prompt: finalPrompt,
          channelId: targetChannelId,
          concurrentFanOut: onlineAgents.length > 1,
          deltaCount: deltaBatch.deltaMessages.length,
        },
      });

      const turnSnapshot = captureTurnEpoch(currentThreadId, targetChannelId, targetAgent.id);
      return sendPromptToAcpAgent({
        agent: targetAgent,
        roomId: currentThreadId,
        prompt: finalPrompt,
        channelId: targetChannelId,
        workspaceBindingId: isDmThread ? undefined : getChannelWorkspaceBinding(activeChannel?.id)?.id,
        workspaceCwd: isDmThread ? undefined : getChannelWorkspaceBinding(activeChannel?.id)?.cwd,
        scopeType: isDmThread ? 'dm' : 'channel',
        systemPrompt: compositeSystemPrompt,
        isDm: isDmThread,
      })
        .then((acpResp) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[`${currentThreadId}:${targetAgent.id}`];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping thread prompt reply because turn was aborted or invalidated');
            return null;
          }

          const agentReply: Message = {
            id: `msg-reply-${Date.now()}-${targetAgent.id}`,
            threadId: currentThreadId,
            channelId: targetChannelId,
            authorId: targetAgent.id,
            authorName: targetAgent.name,
            authorHandle: targetAgent.handle,
            authorAvatar: targetAgent.avatar,
            isAgent: true,
            managedBy: targetAgent.isManagedByYou ? 'you' : undefined,
            agentBadge: `${targetAgent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : targetAgent.isRemote ? 'ACP Remote' : 'ACP'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已消化增量事件流并完成技术边界考量'),
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
            collaborationInfo: isDmThread ? undefined : {
              cascadeId,
              hop: 1,
              maxHops: 12,
              rootMessageId: userMsg.id,
              sourceMessageId: userMsg.id,
              invokedByAgentId: userMsg.authorId,
              invokedByAgentName: userMsg.authorName,
              invokedByAgentHandle: userMsg.authorHandle,
            },
            acpTrace: {
              requestId: `acp-${Date.now()}-${targetAgent.id}`,
              method: 'session/prompt',
              durationMs: acpResp.durationMs,
              workspaceAction: {
                action: 'read',
                path: targetAgent.workspace?.activeFiles?.[0] || 'src/App.tsx',
                summary: `Target workspace: ${targetAgent.workspace?.rootPath || '.'}${acpResp.isRealProcess ? ' (Real stdio process)' : targetAgent.isRemote ? ' (Remote WebSocket)' : ''}`,
              },
            },
          };

          commitMessages((prev) => {
            const existing = prev[currentThreadId] || [];
            const nextThreadMsgs = existing.some((m) => m.id === agentReply.id)
              ? existing
              : [...existing, agentReply];
            return {
              ...prev,
              [currentThreadId]: nextThreadMsgs,
            };
          });

          setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'running' } : a)));
          syncRunningAgentsWithBackend();

          logRpc(targetAgent.name, 'agent_to_client', 'session/prompt:result', {
            jsonrpc: '2.0',
            method: 'session/prompt:result',
            result: { status: 'completed', isRealProcess: acpResp.isRealProcess },
          });

          turnOutputs.push({
            agent: targetAgent,
            messageId: agentReply.id,
            replyContent: acpResp.textResponse,
          });
        })
        .catch((err) => {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[`${currentThreadId}:${targetAgent.id}`];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping thread prompt error because turn was aborted or invalidated');
            return null;
          }

          console.error('Failed to send prompt to agent:', err);
          const errorReply: Message = {
            id: `msg-err-${Date.now()}-${targetAgent.id}`,
            threadId: currentThreadId,
            channelId: targetChannelId,
            authorId: targetAgent.id,
            authorName: targetAgent.name,
            authorHandle: targetAgent.handle,
            authorAvatar: targetAgent.avatar,
            isAgent: true,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
          };
          commitMessages((prev) => {
            const existing = prev[currentThreadId] || [];
            const nextThreadMsgs = existing.some((m) => m.id === errorReply.id)
              ? existing
              : [...existing, errorReply];
            return {
              ...prev,
              [currentThreadId]: nextThreadMsgs,
            };
          });
          setAgents((prev) => prev.map((a) => (a.id === targetAgent.id ? { ...a, status: 'idle' } : a)));
          syncRunningAgentsWithBackend();
        });
    });

    // Turn Barrier 同步屏障：仅在非 DM (即频道多 Agent 协同) 场景下，等待首轮所有并发 Agent 全部执行完毕后统一去重触发下一跳
    if (!isDmThread && hop1Promises.length > 0) {
      Promise.allSettled(hop1Promises).then(() => {
        if (isTurnStale(threadTurnSnapshot)) return;
        if (turnOutputs.length > 0) {
          dispatchCascadingAgentResponse({
            cascadeId,
            turnOutputs,
            roomId: currentThreadId,
            isTopic: false,
          });
        }
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
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-fg-muted">加载仪表盘...</div>}>
          <AgentDashboard
          agents={agents}
          teams={teams}
          channels={channels}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => toggleSidebar()}
          onOpenConnectAgentModal={() => {
            setEditingAgent(null);
            setDuplicatingAgent(null);
            setIsConnectModalOpen(true);
          }}
          onDuplicateAgent={async (agent) => {
            const timestamp = Date.now();
            const newId = `agent-${timestamp}`;
            const cleanName = `${agent.name} 副本`;
            const cleanHandle = `@${cleanName.toLowerCase().replace(/\s+/g, '-')}`;

            const duplicated: Agent = {
              ...agent,
              id: newId,
              name: cleanName,
              handle: cleanHandle,
              status: 'idle',
              statusDetail: undefined,
              isManagedByYou: true,
              modelConfig: agent.modelConfig ? { ...agent.modelConfig } : undefined,
              envVars: agent.envVars ? agent.envVars.map((v) => ({ ...v })) : [],
              workspace: {
                ...(agent.workspace || {
                  rootPath: '~/.shadow-crew',
                  repoName: 'shadow-crew-workspace',
                  gitBranch: 'main',
                  permissionMode: 'full_read_write',
                  activeFiles: ['~/.shadow-crew/agents'],
                }),
              },
              memory: {
                internalMemoryPath: '~/.shadow-crew/global_memory.sqlite',
                persistentType: 'sqlite',
                persistentItems: [],
                sessionCacheCount: 0,
                cartridges: agent.memory?.cartridges ? [...agent.memory.cartridges] : [],
              },
              capabilities: {
                canUseInternalMemory: true,
                canAccessWorkspaceFiles: true,
                canExecuteSkills: true,
                canDelegateToSubAgents: true,
                supportsStreaming: true,
                ...(agent.capabilities || {}),
              },
            };

            const nextAgents = [...agents, duplicated];
            setAgents(nextAgents);
            await saveAgentsToDb(nextAgents);
          }}
          onOpenCreateTeamModal={() => setIsCreateTeamModalOpen(true)}
          onOpenAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(true)}
          onEditAgent={(agent) => {
            setEditingAgent(agent);
            setDuplicatingAgent(null);
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

            const isCurrentlyRunning =
              currentAgent.status === 'running' ||
              currentAgent.status === 'starting' ||
              currentAgent.status === 'thinking' ||
              currentAgent.status === 'using_skill' ||
              currentAgent.status === 'accessing_workspace' ||
              currentAgent.status === 'querying_memory';

            if (!isCurrentlyRunning) {
              if (currentAgent.isRemote) {
                // 远程 ACP 节点：通过 WebSocket 探测连接
                setAgents((prev) =>
                  prev.map((a) =>
                    a.id === agentId ? { ...a, status: 'starting', statusDetail: '连接远程 ACP 节点中...' } : a
                  )
                );
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
                return;
              }

              // 本地 Agent 启动
              spawnLocalAcpAgent(currentAgent);
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
            clearSessionWarmScope({ agentId });
            setAgents((prev) => prev.filter((a) => a.id !== agentId));
            void clearAcpAgentSessions(agentId).catch((err) => {
              console.warn('[App] Failed to clear sessions on agent deletion:', err);
            });
          }}
          onDeleteTeam={(teamId) => {
            setTeams((prev) => prev.filter((t) => t.id !== teamId));
          }}
        />
        </Suspense>
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
                  onApplyTopicPatch={handleApplyTopicPatch}
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
                  currentWorkspace="shadow-crew"
                />

                <MessageInput
                  onSendMessage={handleSendMessage}
                  onAbort={() => activeThread && handleAbortAll(activeThread.id)}
                  activeAgents={activeThread.type === 'dm' 
                    ? agents.filter((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
                    : currentChannelAgents}
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
                agents={currentChannelAgents}
                activeExecutions={activeTopicId ? Object.values(activeExecutions).filter((e: any) => e.threadId === activeTopicId || e.topicId === activeTopicId) : []}
                allActiveExecutions={Object.values(activeExecutions)}
                onAbortAgent={(agentId) => activeTopicId && handleAbortAgent(agentId, activeTopicId)}
                onAbortAll={() => activeTopicId && handleAbortAll(activeTopicId)}
                onClose={() => setActiveTopicId(null)}
                onSendMessage={handleSendTopicMessage}
                onResolveTopic={handleResolveTopic}
                onReopenTopic={handleReopenTopic}
                onExecuteTopicPatch={handleExecuteTopicPatch}
                onApplyTopicPatch={(tid) => handleApplyTopicPatch(tid)}
                workspaceCwd={getTopicWorkspaceBinding(activeTopicId)?.cwd}
                overlappingFiles={(() => {
                  if (!activeTopicData || activeTopicData.gameTheoreticState?.executionStatus === 'applied') return [];
                  const myFiles = new Set(
                    [
                      ...(activeTopicData.rulingRecord?.impactedFiles || []),
                      ...(activeTopicData.decisionRecord?.impactedFiles || []),
                      ...(activeTopicData.gameTheoreticState?.executionDiffs?.map((d) => d.filename) || []),
                    ]
                      .map((f) => f.trim().replace(/^\.\//, ''))
                      .filter(Boolean)
                  );
                  if (myFiles.size === 0) return [];
                  const otherFiles = new Set<string>();
                  for (const m of activeMessages) {
                    if (m.type === 'topic' && m.topicData && m.topicData.id !== activeTopicData.id) {
                      if (m.topicData.gameTheoreticState?.executionStatus === 'applied') continue;
                      const tFiles = [
                        ...(m.topicData.rulingRecord?.impactedFiles || []),
                        ...(m.topicData.decisionRecord?.impactedFiles || []),
                        ...(m.topicData.gameTheoreticState?.executionDiffs?.map((d) => d.filename) || []),
                      ];
                      for (const tf of tFiles) {
                        const clean = tf.trim().replace(/^\.\//, '');
                        if (clean && myFiles.has(clean)) otherFiles.add(clean);
                      }
                    }
                  }
                  return Array.from(otherFiles);
                })()}
                onOpenCodexDiff={(diff) => {
                  setActiveDiff(diff);
                  setIsCodexDiffOpen(true);
                }}
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
            setDuplicatingAgent(null);
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
      {isAgentTeamsModalOpen && (
        <AgentTeamsModal
          isOpen={isAgentTeamsModalOpen}
          onClose={() => setIsAgentTeamsModalOpen(false)}
          agents={agents}
          teams={teams}
          onCreateTeam={(newTeam) => {
            const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
            setTeams((prev) => [...prev, created]);
          }}
          onOpenConnectModal={() => {
            setEditingAgent(null);
            setDuplicatingAgent(null);
            setIsConnectModalOpen(true);
          }}
        />
      )}

      {/* 7.1 Modal: Create Team Popup */}
      {isCreateTeamModalOpen && (
        <CreateTeamModal
          isOpen={isCreateTeamModalOpen}
          onClose={() => setIsCreateTeamModalOpen(false)}
          agents={agents}
          onCreateTeam={(newTeam) => {
            const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
            setTeams((prev) => [...prev, created]);
          }}
        />
      )}

      {/* 7.2 Modal: Agent Defaults */}
      {isAgentDefaultsModalOpen && (
        <AgentDefaultsModal
          isOpen={isAgentDefaultsModalOpen}
          onClose={() => setIsAgentDefaultsModalOpen(false)}
          onOpenStorageSettings={() => setIsStorageSettingsModalOpen(true)}
        />
      )}

      {/* 7.3 Modal: Storage Architecture & Cache Management (Option 3: SQLite) */}
      {isStorageSettingsModalOpen && (
        <StorageSettingsModal
          isOpen={isStorageSettingsModalOpen}
          onClose={() => setIsStorageSettingsModalOpen(false)}
          messages={Object.values(messages).flat()}
          onMessagesCleared={async () => {
            generationEpochRef.current++;
            bumpGlobalEpoch(turnEpochTrackerRef.current);
            inFlightHandoverRef.current.clear();
            stageRefineRetriesRef.current = {};
            handleAbortAll();
            setMessages({});
            messagesRef.current = {};
            resetAllSessionWarmState();
            clearLlmSessionHistory();
            try {
              await clearAcpAgentSessions();
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              setSessionCleanupNotice(
                `⚠️ 清空全部历史消息时底层 ACP 会话重置异常 (${reason})，已启用 Fail-Closed 保护，请检查连接后重试`
              );
              throw err;
            }
          }}
          onOpenMemoryExport={() => {
            setExportingAgent(agents[0] || null);
            setIsMemoryExportModalOpen(true);
          }}
        />
      )}

      {/* 8. Modals: Create Topic / Channel */}
      {isCreateChannelOpen && (
        <CreateChannelModal
          isOpen={isCreateChannelOpen}
          onClose={() => setIsCreateChannelOpen(false)}
          currentUserId={currentUserId}
          teams={teams}
          agents={agents}
          onCreateChannel={handleCreateChannel}
        />
      )}

      {/* 8.1 Modal: Channel Members & Invites */}
      {targetModalChannel && isChannelMembersModalOpen && (
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
      {targetModalChannel && isDeleteChannelModalOpen && (
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
      {isConnectModalOpen && (
        <ConnectAgentModal
          isOpen={isConnectModalOpen}
        onClose={() => {
          setIsConnectModalOpen(false);
          setEditingAgent(null);
          setDuplicatingAgent(null);
        }}
        initialAgent={editingAgent}
        duplicateAgent={duplicatingAgent}
        defaultWorkspaceRoot="~/.shadow-crew"
        onOpenImportModal={() => {
          setIsConnectModalOpen(false);
          setEditingAgent(null);
          setDuplicatingAgent(null);
          setIsMemoryImportModalOpen(true);
        }}
        onUpdateAgent={(agentId, updatedData) => {
          // 清空已交付公约、花名册缓存与水位线，确保后续全会话即时重装最新的人设与团队花名册
          resetAllSessionWarmState();
          void safelyClearAcpSessions(agentId, undefined, '更新 Agent 配置');

          const existingAgent = agents.find((a) => a.id === agentId);
          const wasOnline =
            !!existingAgent && existingAgent.status !== 'idle' && existingAgent.status !== 'error';
          const isRemoteAgent = updatedData.isRemote ?? existingAgent?.isRemote ?? false;

          setAgents((prev) =>
            prev.map((a) => {
              if (a.id === agentId) {
                return {
                  ...a,
                  ...updatedData,
                  status: updatedData.status !== undefined ? updatedData.status : (a.status || 'idle'),
                  workspace: {
                    ...a.workspace,
                    ...(updatedData.workspace || {}),
                  },
                };
              }
              return a;
            })
          );

          // 远程 Agent 的 online/dismiss 状态由保存时的 WebSocket 探测结果直接驱动；
          // 本地 Agent 通过进程重启自证连通性，无需额外轮询

          // 同步全量更新所有线程中由该 Agent 发起或该 Agent 的 DM 会话
          if (updatedData.name || updatedData.avatar || updatedData.handle) {
            setThreads((prev) =>
              prev.map((t) => {
                if (t.authorId === agentId || t.id === `thread-dm-${agentId}`) {
                  const newName = updatedData.name ?? t.authorName;
                  const newAvatar = updatedData.avatar ?? t.authorAvatar;
                  const newHandle = updatedData.handle ?? t.authorHandle;
                  return {
                    ...t,
                    authorName: newName,
                    authorAvatar: newAvatar,
                    authorHandle: newHandle,
                    ...(t.type === 'dm'
                      ? {
                          title: `与 ${newName} 的私信会话`,
                          channelName: `与 ${newName} 私聊`,
                        }
                      : {}),
                  };
                }
                return t;
              })
            );

            // 同步更新所有会话/频道中该 Agent 历史与当前发言的头像与昵称（包含议题卡片元数据）
            setMessages((prev) => {
              let changed = false;
              const next: Record<string, Message[]> = {};
              for (const [threadId, msgs] of Object.entries(prev)) {
                let threadChanged = false;
                const newMsgs = msgs.map((m) => {
                  const isAuthor = m.authorId === agentId;
                  const isTopicAuthor = m.topicData && m.topicData.authorId === agentId;
                  if (isAuthor || isTopicAuthor) {
                    threadChanged = true;
                    return {
                      ...m,
                      ...(isAuthor && updatedData.name ? { authorName: updatedData.name } : {}),
                      ...(isAuthor && updatedData.avatar ? { authorAvatar: updatedData.avatar } : {}),
                      ...(isAuthor && updatedData.handle ? { authorHandle: updatedData.handle } : {}),
                      ...(m.topicData ? {
                        topicData: {
                          ...m.topicData,
                          ...(isTopicAuthor && updatedData.name ? { authorName: updatedData.name } : {}),
                          ...(isTopicAuthor && updatedData.avatar ? { authorAvatar: updatedData.avatar } : {}),
                        },
                      } : {}),
                    };
                  }
                  return m;
                });
                if (threadChanged) {
                  changed = true;
                  next[threadId] = newMsgs;
                } else {
                  next[threadId] = msgs;
                }
              }
              return changed ? next : prev;
            });

            // 同步更新所有子话题 (SubThread) 中该 Agent 的历史与当前回复
            setSubThreads((prev) => {
              let changed = false;
              const next: Record<string, SubThread> = {};
              for (const [subId, sub] of Object.entries(prev)) {
                let subChanged = false;
                const newMsgs = sub.messages.map((m) => {
                  if (m.authorId === agentId) {
                    subChanged = true;
                    return {
                      ...m,
                      ...(updatedData.name ? { authorName: updatedData.name } : {}),
                      ...(updatedData.avatar ? { authorAvatar: updatedData.avatar } : {}),
                      ...(updatedData.handle ? { authorHandle: updatedData.handle } : {}),
                    };
                  }
                  return m;
                });
                if (subChanged) {
                  changed = true;
                  next[subId] = { ...sub, messages: newMsgs };
                } else {
                  next[subId] = sub;
                }
              }
              return changed ? next : prev;
            });
          }

          // 本地 Agent：停止旧进程；编辑前在线则自动以新配置重启恢复 online
          // （网关校验未通过时不再重启，保持 dismiss 状态等待用户修复配置）
          if (!isRemoteAgent && typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
            (window as any).__TAURI_INTERNALS__.invoke('stop_acp_agent', { agentId })
              .then(async () => {
                await syncRunningAgentsWithBackend();
                if (wasOnline && existingAgent && updatedData.isModelHealthy !== false) {
                  const respawnAgent: Agent = { ...existingAgent, ...updatedData } as Agent;
                  spawnLocalAcpAgent(respawnAgent);
                }
              })
              .catch(() => {});
          }
        }}
        onConnectAgent={(agentData) => {
          const newAg: Agent = {
            id: `agent-${Date.now()}`,
            name: agentData.name || 'Custom Agent',
            handle: agentData.handle || `@${(agentData.name || 'agent').toLowerCase()}`,
            avatar: agentData.avatar || '🥷',
            role: agentData.role || 'Specialized Agent',
            description: agentData.description || agentData.role || 'Custom ACP Agent',
            color: '#06b6d4',
            status: agentData.status || 'idle',
            modelBadge: agentData.modelBadge || DEFAULT_MODEL_NAME,
            modelConfig: agentData.modelConfig,
            isModelHealthy: agentData.isModelHealthy,
            modelLatencyMs: agentData.modelLatencyMs,
            statusDetail: agentData.statusDetail,
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
              rootPath: agentData.workspace?.rootPath || '~/.shadow-crew',
              repoName: 'shadow-crew-workspace',
              gitBranch: 'main',
              permissionMode: agentData.readOnlyGuard ? 'read_only' : 'full_read_write',
              activeFiles: ['~/.shadow-crew/agents'],
            },
            skills: [],
            memory: {
              internalMemoryPath: '~/.shadow-crew/global_memory.sqlite',
              persistentType: 'sqlite',
              persistentItems: [],
              sessionCacheCount: 0,
              cartridges: agentData.memory?.cartridges || [],
            },
          };
          setAgents((prev) => [...prev, newAg]);
          setDuplicatingAgent(null);
        }}
      />
      )}

      {/* 9.1 Modal: Create New Topic */}
      {isNewTopicModalOpen && (
        <NewTopicModal
          isOpen={isNewTopicModalOpen}
          onClose={() => setIsNewTopicModalOpen(false)}
          channel={activeChannel}
          channelWorkspaceCwd={
            activeChannel
              ? findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id)?.cwd
              : undefined
          }
          agents={currentChannelAgents}
          onCreateTopic={handleCreateTopic}
        />
      )}

      {/* 9.1.1 Modal: Edit Topic */}
      {Boolean(editingTopic) && (
        <EditTopicModal
          isOpen={Boolean(editingTopic)}
          topic={editingTopic}
          channel={editingTopicChannel}
          agents={editingTopicAgents}
          onClose={() => setEditingTopic(null)}
          onUpdateTopic={handleUpdateTopic}
        />
      )}

      {/* 10. Rust + Tauri Architecture & Source Code Hub */}
      {isRustTauriHubOpen && (
        <RustTauriArchitectureHub
          isOpen={isRustTauriHubOpen}
          onClose={() => setIsRustTauriHubOpen(false)}
        />
      )}

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

      {isMemoryImportModalOpen && (
        <MemoryImportModal
          isOpen={isMemoryImportModalOpen}
          agents={agents}
          defaultAgentId={selectedAgentId || undefined}
          defaultWorkspaceRoot="~/.shadow-crew"
          onClose={() => setIsMemoryImportModalOpen(false)}
          onMountCartridge={handleMountCartridge}
          onCloneGuestAgent={handleCloneGuestAgent}
        />
      )}
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
  );
}
