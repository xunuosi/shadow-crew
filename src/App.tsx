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
  TopicMessageData,
  DecisionRecord,
  TopicStatus,
  ActiveAgentExecution,
  AgentRuntimeStatus,
  DiscussionMode,
  GameRolesConfig,
  GameRoleType,
  GameTheoreticPolicy,
  GameTheoreticStage,
  RulingRecord,
  TopicPatchDiffItem,
  SprtGovernorState,
  FastTrackConvergenceEvidence,
  ModularOrchestrationState,
  WorkspaceBinding,
  DuelRolesConfig,
  AcpPermissionDecision,
  AcpPermissionRequest,
  MessageAttachment,
  MessageAttachmentInput,
  RoleConcurrenceSubmission,
} from './types';
import { 
  INITIAL_AGENTS, 
  INITIAL_TEAMS, 
  INITIAL_CHANNELS, 
  INITIAL_THREADS, 
  INITIAL_MESSAGES, 
  INITIAL_SUB_THREADS,
  INITIAL_RPC_LOGS
} from './data/mockData';
import { Hash, Plus, PanelLeft } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { FilePreviewProvider } from './context/FilePreviewContext';
import { ThreadList } from './components/ThreadList';
import { ChatTimeline } from './components/ChatTimeline';
import { MessageInput } from './components/MessageInput';
import { AppModalsContainer } from './components/AppModalsContainer';
import { useArbitrationConcurrence } from './hooks/useArbitrationConcurrence';
import { useTopicExecutionPipeline } from './hooks/useTopicExecutionPipeline';
import { useGameTheoreticFsm } from './hooks/useGameTheoreticFsm';



// 按需异步加载高体积分支抽屉与仪表盘组件，从首屏关键渲染路径剥离
const SubThreadDrawer = lazy(() => import('./components/SubThreadDrawer').then((m) => ({ default: m.SubThreadDrawer })));
const TopicThreadDrawer = lazy(() => import('./components/TopicThreadDrawer').then((m) => ({ default: m.TopicThreadDrawer })));
const CodexDiffViewer = lazy(() => import('./components/CodexDiffViewer').then((m) => ({ default: m.CodexDiffViewer })));
const AcpInspector = lazy(() => import('./components/AcpInspector').then((m) => ({ default: m.AcpInspector })));
const AgentDashboard = lazy(() => import('./components/AgentDashboard').then((m) => ({ default: m.AgentDashboard })));
import {
  sendPromptToAcpAgent,
  type AcpAgentResponse,
  setOnAcpNativeMemoryCapabilityUpdated,
  clearAcpAgentSessions,
  ensureAcpAgentSession,
  buildUnifiedSessionKey,
  buildAgentSessionKey,
  matchesSessionScope,
  probeRemoteAcpConnection,
  buildAgentLaunchEnv,
  buildThinkingProcessFromAcp,
  extractArbitrationRulingFromAcpResponse,
  extractArbitrationRulingOptionsFromAcpResponse,
  extractRoleConcurrenceFromAcpResponse,
  extractModuleDecompositionFromAcpResponse,
  extractWorkspaceDiffsFromText,
  applyTopicPatchToWorkspace,
  parseSessionKey,
} from './services/acpClient';
import {
  resolveCascadeMaxHops,
  resolveEffectiveRuntimePolicy,
} from './services/agentRuntimePolicy';
import {
  listPendingAcpPermissions,
  removePendingAcpPermission,
  respondToAcpPermission,
  revokeAcpPermissionGrantsForAgent,
  revokeAcpPermissionGrantsForScope,
  upsertPendingAcpPermission,
} from './services/acpPermissionClient';
import { listenTauriEvent } from './services/tauriEventClient';
import {
  buildAttachmentManifest,
  persistMessageAttachments,
} from './services/chatAttachmentService';
import {
  createAgentMemoryBank,
  createUnknownNativeMemoryCapability,
  migrateAgentMemoryV1,
  normalizeHydratedAgent,
} from './services/agentMemory';
import {
  applyLocalStatusChangeEvent,
  applyPromptNativeMemoryCapability,
  applyRemoteProbeOutcome,
  beginLocalSpawn,
  beginRemoteProbe,
  cancelLocalSpawn,
  cancelRemoteProbe,
  completeLocalSpawn,
  isAgentActivelyRunning,
  isCurrentLocalSpawnGeneration,
  markRemoteAgentStarting,
  reconcileLocalAgentsRuntimeStatus,
  recordRemoteProbeSuccess,
  RemoteProbeLease,
  resetAgentHandshakeCapabilities,
  shouldStopLocalAgentProcess,
  shouldRefreshRemoteProbe,
  stopAgentRuntimeState,
} from './services/remoteAgentLifecycle';
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
  createDmTopicBinding,
  findWorkspaceBinding,
  getDefaultChannelCwd,
  getDefaultTopicCwd,
  getDefaultDmTopicCwd,
  migrateWorkspaceGraph,
  normalizeDuelRoles,
  WORKSPACE_BINDING_SCHEMA_VERSION,
} from './services/workspaceBindings';
import { setGlobalModelConfig, clearLlmSessionHistory } from './services/llmService';
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
  buildModularExecutionPrompt,
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
import {
  evaluateGameConfiguration,
  normalizeGameTheoreticPolicy,
  RECOMMENDED_GAME_THEORETIC_POLICY,
  prepareConcurrenceState,
  computeRoleConcurrenceSolutionDigest,
  advanceRoleConcurrenceItem,
  buildFinalRulingFromConcurrence,
  checkAllRolesConcurred,
  formatFullDateTime,
  evaluateRulingGates,
  computeTopologicalExecutionOrder,
  getNextExecutableModuleSlice,
  mergeTopicPatchDiffs,
} from './services/cogno';
import { MIN_MAIN_TIMELINE_WIDTH } from './config/layout';

const REMOTE_ACP_PROBE_TIMEOUT_MS = 5_000;
const REMOTE_ACP_HEALTH_INTERVAL_MS = 5_000;
const REMOTE_ACP_HEALTH_REFRESH_MS = 15_000;

const LEGACY_UI_STATE_MIGRATION_KEY = 'shinobi_legacy_ui_keys_migrated_v1';
let legacyUiStateMigrationChecked = false;

/**
 * 显式一次性迁移：把历史遗留的蛇形 / 驼峰重复键收敛为唯一规范键。
 * 迁移完成后删除旧键，业务读取只认规范键，不保留任何回退读取。
 */
function migrateLegacyUiStateKeysOnce(): void {
  if (legacyUiStateMigrationChecked || typeof window === 'undefined') return;
  legacyUiStateMigrationChecked = true;
  try {
    if (localStorage.getItem(LEGACY_UI_STATE_MIGRATION_KEY) === 'true') return;
    const pairs: Array<[legacy: string, canonical: string]> = [
      ['shinobi_active_channel_id', 'shinobi_activeChannelId'],
      ['shinobi_active_thread_id', 'shinobi_activeThreadId'],
      ['shinobi_sub_threads', 'shinobi_subThreads'],
    ];
    for (const [legacy, canonical] of pairs) {
      const legacyValue = localStorage.getItem(legacy);
      if (legacyValue === null) continue;
      if (localStorage.getItem(canonical) === null) {
        localStorage.setItem(canonical, legacyValue);
      }
      localStorage.removeItem(legacy);
    }
    localStorage.setItem(LEGACY_UI_STATE_MIGRATION_KEY, 'true');
  } catch (err) {
    console.warn('[App] 旧版 UI 状态键迁移失败，保留原数据待下次启动重试', err);
  }
}

export default function App() {
  // 必须在任何 useState 初始化器读取 localStorage 之前完成显式迁移。
  migrateLegacyUiStateKeysOnce();

  // Main View Navigation ('chat' | 'agents') - Default to chat for PRD Messaging Space
  const [mainView, setMainView] = useState<'chat' | 'agents'>('chat');

  // 关键防回滚锁：首轮从 SQLite 加载完成前，严禁各 entity 的初始挂载触发 useEffect 覆盖底层数据库
  const isWorkspaceHydratedRef = useRef(false);
  const workspaceBindingSchemaPersistedRef = useRef(false);
  const syncRunningAgentsWithBackendRef = useRef<(() => Promise<void>) | null>(null);
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
                a.id !== 'agent-devops' &&
                a.id !== 'agent-shinobi-core' &&
                !String(a.acpCommandOrUrl || '').includes('shadow-crew-agent') &&
                !String(a.acpCommandOrUrl || '').includes('shinobi-agent')
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
              const baseAgent = {
                ...a,
                handle: normalizeAgentHandle(a.name, a.id),
                status: 'idle', // 启动默认未开启通信，需用户在面板点击 Start
                statusDetail: undefined,
              };
              // 针对外部自主 ACP Agent，清理历史脏数据中把 Agent 名字错赋给 modelBadge 或 role 的情况
              if (baseAgent.modelBadge === baseAgent.name || baseAgent.modelBadge === baseAgent.localAcpProfile) {
                baseAgent.modelBadge = baseAgent.isRemote ? 'Remote ACP' : 'ACP Stdio';
              }
              if (baseAgent.role === baseAgent.name && baseAgent.description && baseAgent.description !== baseAgent.name) {
                baseAgent.role = baseAgent.description.length < 35 ? baseAgent.description : 'Autonomous ACP Daemon';
              }
              const memoryMigrated = normalizeHydratedAgent(
                (updatedWorkspace ? { ...baseAgent, workspace: updatedWorkspace } : baseAgent) as Agent
              ).agent;
              return memoryMigrated;
            });
          if (filtered.length > 0) return filtered;
      }
    } catch {}
    return INITIAL_AGENTS.map((a) => normalizeHydratedAgent(a).agent);
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    void saveAgentsToDb(agents).catch((err) => {
      console.error('[App] Failed to persist agents:', err);
    });
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
    void saveTeamsToDb(teams).catch((err) => {
      console.error('[App] Failed to persist teams:', err);
    });
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
      const saved = localStorage.getItem('shinobi_activeChannelId');
      if (saved && !MOCK_CHANNEL_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    void saveChannelsToDb(channels).catch((err) => {
      console.error('[App] Failed to persist channels:', err);
    });
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
    void saveWorkspaceStateToDb('activeChannelId', activeChannelId).catch((err) => {
      console.error('[App] Failed to persist activeChannelId:', err);
    });
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
      const saved = localStorage.getItem('shinobi_activeThreadId');
      if (saved && !MOCK_THREAD_IDS.has(saved)) return saved;
    } catch {}
    return '';
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    void saveThreadsToDb(threads).catch((err) => {
      console.error('[App] Failed to persist threads:', err);
    });
  }, [threads]);

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    void saveWorkspaceStateToDb('activeThreadId', activeThreadId).catch((err) => {
      console.error('[App] Failed to persist activeThreadId:', err);
    });
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
        ).catch((err) => {
          console.error('[App] Failed to persist workspace binding schema version:', err);
        });
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
            let memoryMigrated = false;
            const sanitizedAgents = fullData.agents.map((ag: Agent) => {
              const expectedHandle = normalizeAgentHandle(ag.name, ag.id);
              const memoryResult = normalizeHydratedAgent(ag);
              memoryMigrated = memoryMigrated || memoryResult.changed;
              if (ag.handle !== expectedHandle) {
                handleMigrated = true;
                return {
                  ...memoryResult.agent,
                  handle: expectedHandle,
                };
              }
              return memoryResult.agent;
            });
            setAgents(sanitizedAgents);
            void syncRunningAgentsWithBackendRef.current?.();
            if (handleMigrated || memoryMigrated) {
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
  // 1) 启动水合完成前不写库，避免用未加载完的内存快照覆盖已有历史；
  // 2) 600ms 防抖，避免每个流式 token 都触发一次全量 SQLite 事务。
  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    const timer = window.setTimeout(() => {
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
    }, 600);
    return () => window.clearTimeout(timer);
  }, [messages]);

  // 离开页面 / 切到后台时立即冲刷最后一次防抖窗口内的消息，
  // 否则窗口关闭前 600ms 内的编辑会丢失。
  useEffect(() => {
    const flushMessages = () => {
      if (!isWorkspaceHydratedRef.current) return;
      const allMsgs = Object.values(messagesRef.current).flat();
      if (allMsgs.length === 0) return;
      void saveMessagesBatchToDb(allMsgs).catch((e) => {
        console.error('[App] SQLite flush on page hide failed:', e);
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushMessages();
    };
    window.addEventListener('beforeunload', flushMessages);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushMessages);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // SubThreads State with Local Storage Persistence
  const [subThreads, setSubThreads] = useState<Record<string, SubThread>>(() => {
    try {
      const saved = localStorage.getItem('shinobi_subThreads');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return INITIAL_SUB_THREADS;
  });

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    void saveWorkspaceStateToDb('subThreads', subThreads).catch((err) => {
      console.error('[App] Failed to persist subThreads:', err);
    });
  }, [subThreads]);

  const [rpcLogs, setRpcLogs] = useState<AcpRpcLog[]>(INITIAL_RPC_LOGS);

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
  const [isPermissionCenterOpen, setIsPermissionCenterOpen] = useState<boolean>(false);
  const [pendingAcpPermissions, setPendingAcpPermissions] = useState<AcpPermissionRequest[]>([]);
  const [isStorageSettingsModalOpen, setIsStorageSettingsModalOpen] = useState<boolean>(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [isChannelMembersModalOpen, setIsChannelMembersModalOpen] = useState<boolean>(false);
  const [isDeleteChannelModalOpen, setIsDeleteChannelModalOpen] = useState<boolean>(false);
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [duplicatingAgent, setDuplicatingAgent] = useState<Agent | null>(null);
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
  const remoteProbeRuntimeRef = useRef<Map<string, RemoteProbeLease>>(new Map());
  const localSpawnGenerationRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setOnAcpNativeMemoryCapabilityUpdated((agentId, capability, sourceAgent) => {
      setAgents((prev) =>
        applyPromptNativeMemoryCapability(
          prev,
          agentId,
          capability,
          sourceAgent
        )
      );
    });
    return () => {
      setOnAcpNativeMemoryCapabilityUpdated(null);
    };
  }, []);

  const cancelRemoteAgentProbe = useCallback(
    (agentId: string) => {
      cancelRemoteProbe(remoteProbeRuntimeRef.current, agentId);
    },
    []
  );

  const runRemoteAgentProbe = useCallback(
    async (agent: Agent, markStarting: boolean): Promise<void> => {
      const generation = beginRemoteProbe(
        remoteProbeRuntimeRef.current,
        agent.id
      );

      if (markStarting) {
        setAgents((prev) => markRemoteAgentStarting(prev, agent.id));
      }

      let probe: Awaited<ReturnType<typeof probeRemoteAcpConnection>>;
      try {
        probe = await probeRemoteAcpConnection(
          agent.remoteUrl || agent.acpCommandOrUrl,
          agent.authToken,
          REMOTE_ACP_PROBE_TIMEOUT_MS,
          {
            enabled: agent.memory.mode === 'native',
            autoGenerate:
              agent.memory.mode === 'native' && agent.memory.autoGenerate,
          }
        );
      } catch (error) {
        probe = {
          ok: false,
          latencyMs: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      setAgents(
        (prev) =>
          applyRemoteProbeOutcome(
            prev,
            remoteProbeRuntimeRef.current,
            agent.id,
            generation,
            probe,
            markStarting
          ).agents
      );
    },
    []
  );

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
    if (editingTopic.scopeType === 'dm') return null;
    return channels.find((c) => c.id === editingTopic.channelId) || activeChannel;
  }, [editingTopic, channels, activeChannel]);

  const editingTopicAgents = useMemo(() => {
    if (editingTopic?.scopeType === 'dm') {
      return agents.filter((agent) => agent.id === editingTopic.dmAgentId);
    }
    if (!editingTopicChannel) return currentChannelAgents;
    const channelIds = new Set([
      ...(editingTopicChannel.assignedAgentIds || []),
      ...(editingTopicChannel.memberIds || []),
    ]);
    return agents.filter((a) => channelIds.has(a.id));
  }, [editingTopic, editingTopicChannel, currentChannelAgents, agents]);

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

  // Synchronize Agent running status with Tauri backend process manager
  const syncRunningAgentsWithBackend = useCallback(async (
    settleUnmatchedStarting = false
  ) => {
    if (typeof window === 'undefined') return;
    const tauriInvoke =
      (window as any).__TAURI_INTERNALS__?.invoke ||
      (window as any).__TAURI__?.core?.invoke;
    if (!tauriInvoke) return;

    try {
      const runtimeStatuses: AgentRuntimeStatus[] = await tauriInvoke('get_agents_runtime_status');
      if (Array.isArray(runtimeStatuses)) {
        setAgents(
          (prev) =>
            reconcileLocalAgentsRuntimeStatus(prev, runtimeStatuses, {
              settleUnmatchedStarting,
            }).agents
        );
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
              if (a.isRemote || a.acpTransport === 'websocket') {
                return a;
              }
              const isAlive = runningIds.includes(a.id);
              if (isAlive) {
                if (a.status === 'idle') {
                  hasChange = true;
                  return { ...a, status: 'running' as const };
                }
                return a;
              } else {
                if (
                  (a.status !== 'starting' || settleUnmatchedStarting) &&
                  (a.status !== 'idle' ||
                    a.statusDetail !== undefined ||
                    a.memory.nativeCapability.status !== 'unknown' ||
                    Boolean(a.capabilities?.canUseInternalMemory) ||
                    a.capabilities?.supportsLoadSession !== undefined ||
                    a.capabilities?.supportsResumeSession !== undefined ||
                    a.capabilities?.loadSession !== undefined)
                ) {
                  hasChange = true;
                  return resetAgentHandshakeCapabilities(a, 'idle', undefined);
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
  syncRunningAgentsWithBackendRef.current = syncRunningAgentsWithBackend;

  // 启动本地 ACP Agent 进程（Tauri stdio 拉起 / Web 运行时平滑转入）
  const spawnLocalAcpAgent = useCallback(
    async (agent: Agent) => {
      const generation = beginLocalSpawn(
        localSpawnGenerationRef.current,
        agent.id
      );
      // 启动 Agent 进程: 初始设为 starting 握手过渡态
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? resetAgentHandshakeCapabilities(
                a,
                'starting',
                'ACP 进程启动与协议握手中...'
              )
            : a
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
          if (
            !completeLocalSpawn(
              localSpawnGenerationRef.current,
              agent.id,
              generation
            )
          ) {
            // The operation that cancelled this spawn owns process cleanup,
            // preventing a late same-agentId stop from killing a newer spawn.
            await syncRunningAgentsWithBackend(true);
            return;
          }
          await syncRunningAgentsWithBackend(true);
        } catch (err: any) {
          if (
            !completeLocalSpawn(
              localSpawnGenerationRef.current,
              agent.id,
              generation
            )
          ) {
            await syncRunningAgentsWithBackend(true);
            return;
          }
          console.warn('Spawn agent error:', err);
          setAgents((prev) =>
            prev.map((a) =>
              a.id === agent.id
                ? resetAgentHandshakeCapabilities(a, 'error', String(err))
                : a
            )
          );
        }
      } else {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id
              ? resetAgentHandshakeCapabilities(
                  a,
                  'error',
                  '当前环境没有本地 ACP 进程通道，请使用桌面端或连接远程 ACP。'
                )
              : a
          )
        );
      }
    },
    [syncRunningAgentsWithBackend]
  );

  // Listen for real-time ACP status changes from Tauri backend
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tauriListen = listenTauriEvent;

    const mergePendingPermission = (request: AcpPermissionRequest) => {
      setPendingAcpPermissions((prev) => upsertPendingAcpPermission(prev, request));
    };

    let unlistenPermissionRequest: (() => void) | undefined;
    tauriListen('acp:permission_request', (event: any) => {
      const request = event?.payload as AcpPermissionRequest | undefined;
      if (request?.requestId && request.agentId) {
        mergePendingPermission(request);
      }
    }).then((fn: any) => {
      unlistenPermissionRequest = fn;
    }).catch((err) => {
      console.warn('[App] Failed to subscribe ACP permission events:', err);
    });

    let unlistenPermissionResolved: (() => void) | undefined;
    tauriListen('acp:permission_resolved', (event: any) => {
      const agentId = event?.payload?.agentId;
      const requestId = event?.payload?.requestId;
      if (agentId && requestId) {
        setPendingAcpPermissions((prev) =>
          removePendingAcpPermission(prev, agentId, requestId)
        );
      }
    }).then((fn: any) => {
      unlistenPermissionResolved = fn;
    }).catch((err) => {
      console.warn('[App] Failed to subscribe ACP permission resolution events:', err);
    });

    const hydratePendingPermissions = () =>
      listPendingAcpPermissions()
        .then((requests) => {
          setPendingAcpPermissions(
            [...requests].sort((a, b) => a.createdAt - b.createdAt)
          );
        })
        .catch((err) => {
          console.warn('[App] Failed to hydrate pending ACP permissions:', err);
        });

    void hydratePendingPermissions();
    const permissionPollTimer = window.setInterval(hydratePendingPermissions, 1000);

    let unlisten: (() => void) | undefined;
    tauriListen('acp:status_change', (event: any) => {
      const payload = event?.payload;
      if (payload && payload.agent_id) {
        // 当 Agent 停止或断开连接时，仅更新 UI 状态为 idle 并重置握手探测能力，
        // 严禁静默销毁已持久化的会话与水位线，确保 Agent 重新连接后能优先通过 Layer 1 (session/load) 原地恢复会话上下文
        setAgents((prev) => applyLocalStatusChangeEvent(prev, payload));
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

        // 心跳仅刷新本次会话所属房间，避免同一 Agent 在其他房间的 pending 卡被误更新。
        const parsed = typeof payload.session_key === 'string'
          ? parseSessionKey(payload.session_key)
          : { type: 'legacy' as const, roomId: undefined };
        const roomId = parsed.roomId;

        setActiveExecutions((prev) => {
          let updated = false;
          const next = { ...prev };
          for (const key in next) {
            if (
              next[key].agentId === payload.agent_id &&
              next[key].status === 'thinking' &&
              (!roomId || next[key].threadId === roomId)
            ) {
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
          const threadIds = roomId && prev[roomId] ? [roomId] : Object.keys(prev);
          for (const threadId of threadIds) {
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
          if (updated) messagesRef.current = next;
          return updated ? next : prev;
        });
      }
    }).then((fn: any) => {
      unlistenHeartbeat = fn;
    }).catch(() => {});

    // 实时监听 Agent 流式 chunk 吐字：
    // 1) 通过 Rust 透传的 session_key 精确路由到所属房间，杜绝跨会话串流污染；
    // 2) 按「房间 + Agent」缓冲后按 Agent 策略的间隔合并刷新，避免逐 token 触发全量 React 更新。
    type ChunkBuffer = {
      threadId: string | null;
      agentId: string;
      text: string;
      timer: number | null;
    };
    const chunkBuffers = new Map<string, ChunkBuffer>();

    const flushChunkBuffer = (key: string) => {
      const buf = chunkBuffers.get(key);
      if (!buf) return;
      chunkBuffers.delete(key);
      if (buf.timer !== null) window.clearTimeout(buf.timer);
      if (!buf.text) return;
      const text = buf.text;

      setMessages((prev) => {
        let updated = false;
        const next = { ...prev };
        const threadIds = buf.threadId ? [buf.threadId] : Object.keys(prev);
        for (const threadId of threadIds) {
          const list = next[threadId];
          if (!list || list.length === 0) continue;
          // 同一 Agent 可能因重试留下多个 pending 卡，始终追加到最新一张。
          let pendingIdx = -1;
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].authorId === buf.agentId && list[i].isPending) {
              pendingIdx = i;
              break;
            }
          }
          if (pendingIdx === -1) continue;
          const updatedList = [...list];
          updatedList[pendingIdx] = {
            ...updatedList[pendingIdx],
            content: (updatedList[pendingIdx].content || '') + text,
          };
          next[threadId] = updatedList;
          updated = true;
          if (buf.threadId) break;
        }
        if (updated) messagesRef.current = next;
        return updated ? next : prev;
      });
    };

    let unlistenChunk: (() => void) | undefined;
    tauriListen('acp:chunk', (event: any) => {
      const payload = event?.payload;
      if (!payload || !payload.agent_id || !payload.chunk) return;

      const agentId = payload.agent_id as string;
      const chunkText = payload.chunk as string;
      const parsed = typeof payload.session_key === 'string'
        ? parseSessionKey(payload.session_key)
        : { type: 'legacy' as const, roomId: undefined };
      const threadId = parsed.roomId ?? null;
      const key = `${threadId ?? 'legacy'}::${agentId}`;

      const existing = chunkBuffers.get(key);
      if (existing) {
        existing.text += chunkText;
        return;
      }

      const agent = agentsRef.current.find((a) => a.id === agentId);
      const flushInterval = resolveEffectiveRuntimePolicy(agent).streamFlushIntervalMs;
      const buf: ChunkBuffer = { threadId, agentId, text: chunkText, timer: null };
      chunkBuffers.set(key, buf);

      if (flushInterval <= 0) {
        flushChunkBuffer(key);
      } else {
        buf.timer = window.setTimeout(() => flushChunkBuffer(key), flushInterval);
      }
    }).then((fn: any) => {
      unlistenChunk = fn;
    }).catch(() => {});

    return () => {
      // 卸载前把尚未刷新的流式片段落地，避免丢字。
      for (const key of Array.from(chunkBuffers.keys())) flushChunkBuffer(key);
      window.clearInterval(permissionPollTimer);
      if (unlistenPermissionRequest) unlistenPermissionRequest();
      if (unlistenPermissionResolved) unlistenPermissionResolved();
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

  // Remote ACP endpoints are not represented by the local process manager,
  // so maintain an independent health lease for running WebSocket Agents.
  useEffect(() => {
    const refreshRemoteAgents = () => {
      const now = Date.now();
      agentsRef.current
        .filter(
          (agent) =>
            (agent.isRemote || agent.acpTransport === 'websocket') &&
            agent.status === 'running'
        )
        .forEach((agent) => {
          if (
            !shouldRefreshRemoteProbe(
              remoteProbeRuntimeRef.current,
              agent.id,
              REMOTE_ACP_HEALTH_REFRESH_MS,
              now
            )
          ) return;
          void runRemoteAgentProbe(agent, false);
        });
    };
    const timer = setInterval(
      refreshRemoteAgents,
      REMOTE_ACP_HEALTH_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [runRemoteAgentProbe]);

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
            content: isAgentOffline(agent)
              ? `你好！我是 **${agent.name}**。当前 ACP 端点尚未启动。请在 Agents & 编队中点击 Start 建立本地或远程 ACP 连接。你也可以先在私聊中创建独立 Topic，后续消息与产物会隔离保存。`
              : `你好！我是 **${agent.name}**。ACP 端点已连接，协议通道：\`${agent.acpTransport}\`。你可以直接讨论，也可以创建独立 Topic 隔离长任务上下文。`,
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
    if (!activeChannel && !dmAgent) {
      throw new Error('当前上下文既不是 Channel 也不是有效私聊 Agent');
    }
    const channelBinding = activeChannel
      ? findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id)
      : undefined;
    if (!isDmScope && !channelBinding) {
      throw new Error(`频道 ${activeChannel?.name || 'unknown'} 缺少 Workspace Binding，无法创建议题`);
    }
    const topicId = `topic-${Date.now()}`;
    const requestedCwd = workspace.mode === 'default'
      ? (isDmScope && dmAgent
          ? getDefaultDmTopicCwd(dmAgent.id, topicId)
          : getDefaultTopicCwd(activeChannel!.id, topicId))
      : workspace.mode === 'channel_snapshot'
        ? channelBinding!.cwd
        : workspace.mode === 'agent_snapshot'
          ? `~/.shadow-crew/agents/${dmAgent?.id}`
          : workspace.cwd || '';
    const resolvedCwd = await resolveWorkspaceCwd(requestedCwd, workspace.mode === 'default');
    const topicBinding = isDmScope && dmAgent
      ? createDmTopicBinding({
          topicId,
          agentId: dmAgent.id,
          mode: workspace.mode === 'agent_snapshot' ? 'agent_snapshot' : workspace.mode === 'custom' ? 'custom' : 'default',
          cwd: resolvedCwd,
        })
      : createTopicBinding({
          topicId,
          channelId: activeChannel!.id,
          mode: workspace.mode === 'channel_snapshot' || workspace.mode === 'agent_snapshot'
            ? 'channel_snapshot'
            : workspace.mode,
          channelBinding: channelBinding!,
          cwd: resolvedCwd,
        });
    const validAssignedAgentIds = (isDmScope && dmAgent ? [dmAgent.id] : topicData.assignedAgentIds).filter((id) =>
      (isDmScope ? agents : currentChannelAgents).some((a) => a.id === id)
    );
    const isGame = topicData.discussionMode === 'game_theoretic';
    const newGamePolicy = isGame && !isDmScope
      ? normalizeGameTheoreticPolicy(
          topicData.gamePolicy ?? RECOMMENDED_GAME_THEORETIC_POLICY
        )
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
        throw new Error(
          `博弈配置未通过准入：${evaluation.blockingIssues.join('；')}`
        );
      }
    }
    const normalizedDuelRoles = isDmScope && isGame && topicData.duelRoles
      ? normalizeDuelRoles(topicData.duelRoles)
      : undefined;
    if (isDmScope && isGame && !normalizedDuelRoles) {
      throw new Error('私聊双方博弈议题缺少角色配置');
    }
    const modelDiversity = isGame && topicData.gameRoles
      ? calculateModelDiversity(agents, topicData.gameRoles)
      : undefined;
    const initialModularState = isGame && !isDmScope
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
          ? (activeTopicData.duelRoles?.proposer === 'human' ? 'proposer' : 'challenger')
          : undefined,
      gameStage:
        activeTopicData?.scopeType === 'dm' && activeTopicData.discussionMode === 'game_theoretic'
          ? (activeTopicData.duelRoles?.proposer === 'human' ? 'proposal' : 'challenge')
          : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: '',
    };

    const verifiersSummary = topicData.gameRoles?.verifiers && topicData.gameRoles.verifiers.length > 0
      ? `\n- 🔍 接地者：${topicData.gameRoles.verifiers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}`
      : '';

    const diversityWarning = modelDiversity?.isHomogeneous && modelDiversity.warnings.length > 0
      ? `\n\n${modelDiversity.warnings[0]}`
      : '';

    const dmDuelSummary = isDmScope && isGame && topicData.duelRoles
      ? `已发起私聊双方博弈议题【${topicData.title}】。\n目标背景：${topicData.description || '开始双方攻防推演。'}\n- ${topicData.duelRoles.proposer === 'human' ? '👤 人类担任提案方' : `🤖 ${dmAgent?.name || 'Agent'} 担任提案方`}\n- ${topicData.duelRoles.challenger === 'human' ? '👤 人类担任对抗方' : `🤖 ${dmAgent?.name || 'Agent'} 担任对抗方`}`
      : null;
    const initContent = dmDuelSummary || (isGame && topicData.gameRoles
      ? `已发起 4+1 认知协同决策议题【${topicData.title}】。\n目标背景：${topicData.description || '开始架构决策攻防推演。'}\n【4+1 协同角色配置】：\n- 🏛️ 提案者：${topicData.gameRoles.proposers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- ⚔️ 红队对抗：${topicData.gameRoles.challengers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}${verifiersSummary}\n- ⚖️ 流程综合：${topicData.gameRoles.arbiters.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}\n- 👤 终局裁判：${topicData.gameRoles.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌)' : '已委派 AI 综合仲裁'}${diversityWarning}`
      : `已发起议题【${topicData.title}】。\n目标背景：${topicData.description || '开始方案推演。'}\n指派 Agent：${validAssignedAgentIds.length > 0 ? validAssignedAgentIds.map(id => agents.find(a => a.id === id)?.name).filter(Boolean).join('、') : '暂无 (可在抽屉中指派)'}。`);

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
        throw new Error(
          `博弈配置未通过准入：${evaluation.blockingIssues.join('；')}`
        );
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
            gameRoles: isDmTopic ? undefined : updatedData.gameRoles !== undefined ? updatedData.gameRoles : oldTopic.gameRoles,
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
    // 级联派发必须绑定一个活动线程：缺失时直接终止，而不是继续读取 null 字段。
    if (!activeThread) {
      console.warn('[App] 级联调度缺少活动线程上下文，已跳过本轮派发');
      return;
    }

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

      const loopCheck = checkLoopGuard(cascade, targetAgent.id, targetAgent);
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
          setAgents((prev) =>
            prev.map((a) =>
              a.id === targetAgent.id
                ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
                : a
            )
          );
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

          setAgents((prev) =>
            applyPromptNativeMemoryCapability(
              prev.map((a) =>
                a.id === targetAgent.id &&
                a.status !== 'starting' &&
                isAgentActivelyRunning(a)
                  ? { ...a, status: 'running' }
                  : a
              ),
              targetAgent.id,
              acpResp.nativeMemoryCapability,
              targetAgent
            )
          );
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

  // 1. 落地执行管线 (G-Frame 模块化与单轮落地执行)
  const {
    dispatchTopicExecution,
    handleExecuteTopicPatch,
    handleApplyTopicPatch,
    handleRollbackTopicPatch,
  } = useTopicExecutionPipeline({
    getTopicData,
    updateTopicDataInState,
    captureTurnEpoch,
    isTurnStale,
    channels,
    activeChannel,
    agentsRef,
    activeExecutionsRef,
    setActiveExecutions,
    setIsGenerating,
    setAgents,
    setMessages,
    getTopicWorkspaceBinding,
    activeTopicId,
    activeDiff,
    setActiveDiff,
  });

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
                executionStatus: shouldDispatch ? 'running' : (m.topicData.gameTheoreticState?.executionStatus || 'idle'),
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

    if (shouldDispatch && targetExecutorId) {
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
  }, [agentsRef, activeTopicData, activeChannel, setMessages, updateTopicDataInState, dispatchTopicExecution]);

  // 3. 仲裁合流与无异议征询 Hook
  const { processArbitrationConcurrence } = useArbitrationConcurrence({
    getTopicData,
    activeTopicData,
    updateTopicDataInState,
    setMessages,
    setIsGenerating,
    setActiveExecutions,
    setAgents,
    agentsRef,
    inFlightHandoverRef,
    isTurnStale,
    getTopicWorkspaceBinding,
    handleResolveTopic,
  });

  // 4. 博弈状态机控制器 Hook (DIANOIA 4+1 状态流转控制器)
  const { triggerGameTheoreticStageHandover } = useGameTheoreticFsm({
    getTopicData,
    channels,
    activeChannel,
    captureTurnEpoch,
    isTurnStale,
    inFlightHandoverRef,
    agentsRef,
    stageRefineRetriesRef,
    setIsGenerating,
    setActiveExecutions,
    setAgents,
    setMessages,
    updateTopicDataInState,
    getTopicWorkspaceBinding,
    processArbitrationConcurrence,
  });

  const handleSendTopicMessage = async (
    topicId: string,
    content: string,
    pendingAttachments: MessageAttachmentInput[] = []
  ) => {
    const userMessageId = `topic-msg-${Date.now()}`;
    const topicScopeType = activeTopicData?.scopeType === 'dm' ? 'dm_topic' : 'topic';
    const savedAttachments: MessageAttachment[] = await persistMessageAttachments({
      scopeType: topicScopeType,
      scopeId: topicId,
      messageId: userMessageId,
      attachments: pendingAttachments,
    });
    const attachmentManifest = buildAttachmentManifest(savedAttachments);
    const agentTurnContent = `${content}${attachmentManifest}`.trim();
    const userMsg: Message = {
      id: userMessageId,
      threadId: topicId,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      attachments: savedAttachments,
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

    const dmTopicAgentId = activeTopicData?.scopeType === 'dm' ? activeTopicData.dmAgentId : undefined;
    if (dmTopicAgentId) {
      const dmAgent = agents.find((agent) => agent.id === dmTopicAgentId);
      const topicBinding = getTopicWorkspaceBinding(topicId);
      if (!dmAgent || !topicBinding) {
        setMessages((prev) => ({
          ...prev,
          [topicId]: [
            ...(prev[topicId] || []),
            {
              id: `dm-topic-error-${Date.now()}`,
              threadId: topicId,
              authorId: 'system',
              authorName: 'Shadow Crew DM Topic',
              authorHandle: '@dm-topic-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              kind: 'error',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: '私聊议题缺少可用的 ACP Agent 或 Workspace Binding，本轮未派发。',
            },
          ],
        }));
        return;
      }
      if (isAgentOffline(dmAgent)) {
        setMessages((prev) => ({
          ...prev,
          [topicId]: [
            ...(prev[topicId] || []),
            {
              id: `dm-topic-offline-${Date.now()}`,
              threadId: topicId,
              authorId: 'system',
              authorName: 'Shadow Crew ACP Guard',
              authorHandle: '@connection-guard',
              authorAvatar: '🔌',
              isAgent: true,
              kind: 'guard',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `ACP Agent ${dmAgent.name} 当前未连接。请先启动该本地或远程 ACP 端点。`,
            },
          ],
        }));
        return;
      }

      const isGame = activeTopicData?.discussionMode === 'game_theoretic';
      const isHumanProposer = activeTopicData?.duelRoles?.proposer === 'human';
      const agentRole: GameRoleType = isGame
        ? (isHumanProposer ? 'challenger' : 'proposer')
        : 'proposer';
      const stage: GameTheoreticStage = isGame
        ? (agentRole === 'proposer' ? 'proposal' : 'challenge')
        : 'proposal';
      const sessionKey = buildAgentSessionKey({
        agentId: dmAgent.id,
        roomId: topicId,
        workspaceBindingId: topicBinding.id,
        discussionMode: activeTopicData?.discussionMode || 'standard',
        scopeType: 'dm_topic',
      });
      const priorTopicMessages = (messagesRef.current[topicId] || []).filter(
        (message) => !message.isPending && message.id !== userMsg.id && message.content?.trim()
      );
      const roomTranscript = priorTopicMessages
        .slice(-8)
        .map((message) => `${message.authorName}${message.isAgent ? ' (Agent)' : ' (Human)'}: ${message.content}`)
        .join('\n\n');
      const systemPrompt = buildCompositeSystemPrompt({
        agent: dmAgent,
        availableAgents: [dmAgent],
        includeRoster: false,
      });
      const prompt = isGame
        ? `[私聊双方博弈议题]\n标题：${activeTopicData?.title}\n背景：${activeTopicData?.description || activeTopicData?.title}\n\n[角色约束]\n你固定担任：${agentRole === 'proposer' ? '提案方' : '对抗方'}\n人类固定担任：${isHumanProposer ? '提案方' : '对抗方'}\n只允许两个角色，不得引入验证官、仲裁官或其他 Agent 角色。\n\n[最近讨论]\n${roomTranscript || '（暂无）'}\n\n[人类本轮发言]\n${agentTurnContent}\n\n请基于你的固定角色回复。提案方给出方案与约束，对抗方给出具体反例、风险和可证伪条件。`
        : `[私聊议题]\n标题：${activeTopicData?.title}\n背景：${activeTopicData?.description || activeTopicData?.title}\n\n[最近讨论]\n${roomTranscript || '（暂无）'}\n\n[人类本轮发言]\n${agentTurnContent}\n\n请直接回应并推进当前议题。`;
      const execKey = `${topicId}:${dmAgent.id}`;
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: dmAgent.id,
          agentName: dmAgent.name,
          agentAvatar: dmAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: isGame
            ? (agentRole === 'proposer' ? '正在以提案方身份立论...' : '正在以对抗方身份质询...')
            : '正在处理私聊议题...',
          startedAt: Date.now(),
        },
      }));

      void (async () => {
        try {
          await ensureAcpAgentSession({
            agentId: dmAgent.id,
            roomId: topicId,
            systemPrompt,
            discussionMode: activeTopicData?.discussionMode,
            workspaceBindingId: topicBinding.id,
            workspaceCwd: topicBinding.cwd,
            scopeType: 'dm_topic',
            localHistoryIntact: priorTopicMessages.length > 0,
          });
          const response = await sendPromptToAcpAgent({
            agent: dmAgent,
            roomId: topicId,
            prompt,
            workspaceBindingId: topicBinding.id,
            workspaceCwd: topicBinding.cwd,
            scopeType: 'dm_topic',
            systemPrompt,
            discussionMode: activeTopicData?.discussionMode,
          attachments: savedAttachments,
          });
          const agentReply: Message = {
            id: `dm-topic-reply-${Date.now()}-${dmAgent.id}`,
            threadId: topicId,
            authorId: dmAgent.id,
            authorName: dmAgent.name,
            authorHandle: dmAgent.handle,
            authorAvatar: dmAgent.avatar,
            isAgent: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: response.textResponse,
            thinkingProcess: buildThinkingProcessFromAcp(response, '已处理私聊议题上下文'),
            gameRole: isGame ? agentRole : undefined,
            gameStage: isGame ? stage : undefined,
            agentBadge: isGame
              ? (agentRole === 'proposer' ? '🏛️ 私聊提案方' : '⚔️ 私聊对抗方')
              : 'ACP · DM Topic',
            diffView: response.workspaceDiffs?.[0],
            diffViews: response.workspaceDiffs,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), agentReply],
          }));
        } catch (error) {
          setMessages((prev) => ({
            ...prev,
            [topicId]: [
              ...(prev[topicId] || []),
              {
                id: `dm-topic-reply-error-${Date.now()}`,
                threadId: topicId,
                authorId: 'system',
                authorName: 'ACP DM Topic Error',
                authorHandle: '@acp-error',
                authorAvatar: '⚠️',
                isAgent: true,
                kind: 'error',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: error instanceof Error ? error.message : String(error),
              },
            ],
          }));
        } finally {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            return next;
          });
        }
      })();
      return;
    }

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

    const existingTopicMsgs = messagesRef.current[topicId] || [];
    const currentTopicObj = getTopicData(topicId) || activeTopicData;
    const isGameTheoretic = currentTopicObj?.discussionMode === 'game_theoretic';
    const currentTopicStage: GameTheoreticStage = currentTopicObj?.gameStage || currentTopicObj?.gameTheoreticState?.currentStage || 'proposal';
    let executionStage: GameTheoreticStage = currentTopicStage;
    let targetRoleType: GameRoleType = 'proposer';

    const fallbackProposalText = (
      currentTopicObj?.gameTheoreticState?.targetProposalContent ||
      existingTopicMsgs
        .slice()
        .reverse()
        .find((m) => !m.isPending && (m.gameStage === 'proposal' || m.gameRole === 'proposer') && m.content?.trim())?.content
    );
    const fallbackChallengeText = (
      currentTopicObj?.gameTheoreticState?.targetChallengeContent ||
      existingTopicMsgs
        .slice()
        .reverse()
        .find((m) => !m.isPending && (m.gameStage === 'challenge' || m.gameRole === 'challenger') && m.content?.trim())?.content
    );
    const fallbackVerificationText = (
      currentTopicObj?.gameTheoreticState?.targetVerificationContent ||
      existingTopicMsgs
        .slice()
        .reverse()
        .find((m) => !m.isPending && (m.gameStage === 'verification' || m.gameRole === 'verifier') && m.content?.trim())?.content
    );
    const fallbackDefenseText = (
      currentTopicObj?.gameTheoreticState?.targetDefenseContent ||
      existingTopicMsgs
        .slice()
        .reverse()
        .find((m) => !m.isPending && (m.gameStage === 'defense') && m.content?.trim())?.content
    );

    const candidateAgents = topicAssigned.length > 0 ? topicAssigned : channelAssigned;
    let respondingAgents: Agent[] = [];

    if (isGameTheoretic) {
      if (userMentionedAgents.length > 0 && !isTopicAll) {
        respondingAgents = userMentionedAgents;
        const targetAgent = userMentionedAgents[0];
        const id = targetAgent.id;
        const gameRoles = currentTopicObj?.gameRoles;
        const isProposer = Boolean(gameRoles?.proposers?.includes(id));
        const isChallenger = Boolean(gameRoles?.challengers?.includes(id));
        const isVerifier = Boolean(gameRoles?.verifiers?.includes(id));
        const isArbiter = Boolean(gameRoles?.arbiters?.includes(id));
        const gState = currentTopicObj?.gameTheoreticState;
        const hasProposal = Boolean(fallbackProposalText?.trim());
        const isChallengerDone = Boolean(gState?.isChallengerResponded);
        const isVerifierDone = Boolean(gState?.isVerifierResponded);
        const isDefenseDone = Boolean(gState?.isDefenseResponded);

        // 1. 优先匹配当前所处阶段（若被点名角色正好能承接当前阶段）
        if (currentTopicStage === 'arbitration' && isArbiter) {
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        } else if (currentTopicStage === 'defense' && isProposer) {
          targetRoleType = 'proposer';
          executionStage = 'defense';
        } else if (currentTopicStage === 'verification' && isVerifier) {
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (currentTopicStage === 'challenge' && isChallenger) {
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (currentTopicStage === 'proposal' && isProposer && !hasProposal) {
          targetRoleType = 'proposer';
          executionStage = 'proposal';
        // 2. 否则按协同状态机未竟进度断点续推（如因通信中断挂起跳过，用户重新点名恢复该角色继续接力）
        } else if (isChallenger && (!isChallengerDone || currentTopicStage === 'proposal')) {
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (isVerifier && (!isVerifierDone || currentTopicStage === 'challenge')) {
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (isProposer && hasProposal && (!isDefenseDone || currentTopicStage === 'challenge' || currentTopicStage === 'verification')) {
          targetRoleType = 'proposer';
          executionStage = 'defense';
        } else if (isArbiter && (isDefenseDone || currentTopicStage === 'defense' || currentTopicStage === 'arbitration')) {
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        // 3. 兜底角色映射
        } else if (isChallenger) {
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (isVerifier) {
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (isArbiter) {
          targetRoleType = 'arbiter';
          executionStage = 'arbitration';
        } else if (isProposer) {
          targetRoleType = 'proposer';
          executionStage = hasProposal ? 'defense' : 'proposal';
        }

        // 同步更新议题阶段至最新执行阶段，并清理此前因 Agent 离线产生的法定人数警告
        if (executionStage !== currentTopicStage || gState?.quorumAlert) {
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: executionStage,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: executionStage,
              quorumAlert: undefined,
            },
          }));
        }
      } else {
        // 根据三元/4+1博弈当前所处阶段分配角色，绝不并发广播给全员
        if (currentTopicStage === 'proposal') {
          const proposerIds = currentTopicObj?.gameRoles?.proposers || [];
          respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
          targetRoleType = 'proposer';
          executionStage = 'proposal';
        } else if (currentTopicStage === 'challenge') {
          const challengerIds = currentTopicObj?.gameRoles?.challengers || [];
          respondingAgents = candidateAgents.filter((a) => challengerIds.includes(a.id));
          targetRoleType = 'challenger';
          executionStage = 'challenge';
        } else if (currentTopicStage === 'verification') {
          const verifierIds = currentTopicObj?.gameRoles?.verifiers || [];
          respondingAgents = candidateAgents.filter((a) => verifierIds.includes(a.id));
          targetRoleType = 'verifier';
          executionStage = 'verification';
        } else if (currentTopicStage === 'defense') {
          const proposerIds = currentTopicObj?.gameRoles?.proposers || [];
          respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
          targetRoleType = 'proposer';
          executionStage = 'defense';
        } else if (currentTopicStage === 'arbitration') {
          const arbiterIds = currentTopicObj?.gameRoles?.arbiters || [];
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
    const activeModState = currentTopicObj?.gameTheoreticState?.modularState;
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
      title: currentTopicObj?.title || '议题方案推演',
      description: currentTopicObj?.description,
      channelName: topicChannel?.name || 'chat',
      status: currentTopicObj?.status || 'open',
      discussionMode: currentTopicObj?.discussionMode,
      gameRoles: currentTopicObj?.gameRoles,
      gameStage: isGameTheoretic ? executionStage : undefined,
      targetProposalText: isGameTheoretic && (executionStage === 'challenge' || executionStage === 'verification' || executionStage === 'defense' || executionStage === 'arbitration')
        ? fallbackProposalText
        : undefined,
      targetChallengeText: isGameTheoretic && (executionStage === 'verification' || executionStage === 'defense' || executionStage === 'arbitration')
        ? fallbackChallengeText
        : undefined,
      targetVerificationText: isGameTheoretic && (executionStage === 'defense' || executionStage === 'arbitration')
        ? fallbackVerificationText
        : undefined,
      targetDefenseText: isGameTheoretic && executionStage === 'arbitration'
        ? fallbackDefenseText
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
        originalPrompt: agentTurnContent,
        depth: 1,
        maxDepth: resolveCascadeMaxHops(onlineAgents),
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
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id ? resetAgentHandshakeCapabilities(a, 'idle', undefined) : a
          )
        );
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
          userContent: agentTurnContent,
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
          triggerContent: agentTurnContent,
          hop: 1,
          maxHops: resolveCascadeMaxHops(onlineAgents),
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
          originalPrompt: agentTurnContent,
          depth: 1,
          maxDepth: resolveCascadeMaxHops(onlineAgents),
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
        attachments: savedAttachments,
      })
        .then(async (acpResp) => {
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
            applyPromptNativeMemoryCapability(
              prev.map((a) =>
                a.id === agent.id &&
                a.status !== 'starting' &&
                isAgentActivelyRunning(a)
                  ? { ...a, status: 'running' }
                  : a
              ),
              agent.id,
              acpResp.nativeMemoryCapability,
              agent
            )
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
              maxHops: resolveCascadeMaxHops(onlineAgents),
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
                const freshTopic = getTopicData(topicId) || activeTopicData;
                const hasVerifiers = (freshTopic?.gameRoles?.verifiers || []).length > 0;
                const nextStageTarget = hasVerifiers ? 'verification' : 'defense';
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: nextStageTarget,
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: nextStageTarget,
                    targetChallengeContent: acpResp.textResponse,
                    isChallengerResponded: true,
                    quorumAlert: undefined,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: nextStageTarget,
                  targetProposalText: fallbackProposalText || freshTopic?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'verification') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Verifier returned empty/error turn, pausing handover.');
              } else {
                const freshTopic = getTopicData(topicId) || activeTopicData;
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'defense',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'defense',
                    targetVerificationContent: acpResp.textResponse,
                    isVerifierResponded: true,
                    quorumAlert: undefined,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'defense',
                  targetProposalText: fallbackProposalText || freshTopic?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: fallbackChallengeText || freshTopic?.gameTheoreticState?.targetChallengeContent,
                  targetVerificationText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'defense') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Proposer defense returned empty/error turn, pausing handover.');
              } else {
                const freshTopic = getTopicData(topicId) || activeTopicData;
                updateTopicDataInState(topicId, (old) => ({
                  ...old,
                  gameStage: 'arbitration',
                  gameTheoreticState: {
                    ...old.gameTheoreticState,
                    currentStage: 'arbitration',
                    targetDefenseContent: acpResp.textResponse,
                    isDefenseResponded: true,
                    quorumAlert: undefined,
                  },
                }));
                triggerGameTheoreticStageHandover({
                  topicId,
                  nextStage: 'arbitration',
                  targetProposalText: fallbackProposalText || freshTopic?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: fallbackChallengeText || freshTopic?.gameTheoreticState?.targetChallengeContent,
                  targetVerificationText: fallbackVerificationText || freshTopic?.gameTheoreticState?.targetVerificationContent,
                  targetDefenseText: acpResp.textResponse,
                });
              }
            } else if (executionStage === 'arbitration') {
              if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                console.warn('Arbiter returned empty/error turn, pausing concurrence handover.');
              } else {
                const currentTopicObj = getTopicData(topicId) || activeTopicData;
                await processArbitrationConcurrence({
                  topicId,
                  arbiterAgent: agent,
                  acpResp,
                  turnSnapshot,
                  targetProposalText: fallbackProposalText || currentTopicObj?.gameTheoreticState?.targetProposalContent,
                  targetChallengeText: fallbackChallengeText || currentTopicObj?.gameTheoreticState?.targetChallengeContent,
                  targetVerificationText: fallbackVerificationText || currentTopicObj?.gameTheoreticState?.targetVerificationContent,
                  targetDefenseText: fallbackDefenseText || currentTopicObj?.gameTheoreticState?.targetDefenseContent,
                  candidateAgents,
                  topicChannel,
                  arbiterPendingId: pendingId,
                  arbiterReply: agentReply,
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
  const handleSendMessage = async (
    content: string,
    pendingAttachments: MessageAttachmentInput[] = []
  ) => {
    if ((!content.trim() && pendingAttachments.length === 0) || !activeThread) return;

    const currentThreadId = activeThread.id;
    const isDmThread = activeThread.type === 'dm';

    const targetChannelId = isDmThread
      ? undefined
      : activeChannel?.id;
    const userMessageId = `msg-${Date.now()}`;
    const scopeType = isDmThread ? 'dm' : 'channel';
    const scopeId = isDmThread ? currentThreadId : (targetChannelId || currentThreadId);
    const savedAttachments: MessageAttachment[] = await persistMessageAttachments({
      scopeType,
      scopeId,
      messageId: userMessageId,
      attachments: pendingAttachments,
    });
    const attachmentManifest = buildAttachmentManifest(savedAttachments);
    const agentTurnContent = `${content}${attachmentManifest}`.trim();

    const userMsg: Message = {
      id: userMessageId,
      threadId: currentThreadId,
      channelId: targetChannelId,
      authorId: 'user-norris',
      authorName: 'Norris_M5Pro',
      authorHandle: '@Norris_M5Pro',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      attachments: savedAttachments,
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
      originalPrompt: agentTurnContent,
      depth: 1,
      maxDepth: resolveCascadeMaxHops(onlineAgents), // 取参与 Agent 配置的最小轮次，防止长循环
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
        setAgents((prev) =>
          prev.map((a) =>
            a.id === targetAgent.id
              ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
              : a
          )
        );
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
        triggerContent: agentTurnContent,
        hop: 1,
        maxHops: resolveCascadeMaxHops(onlineAgents),
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
        attachments: savedAttachments,
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
              maxHops: resolveCascadeMaxHops(onlineAgents),
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

          setAgents((prev) =>
            applyPromptNativeMemoryCapability(
              prev.map((a) =>
                a.id === targetAgent.id &&
                a.status !== 'starting' &&
                isAgentActivelyRunning(a)
                  ? { ...a, status: 'running' }
                  : a
              ),
              targetAgent.id,
              acpResp.nativeMemoryCapability,
              targetAgent
            )
          );
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
          setAgents((prev) =>
            prev.map((a) =>
              a.id === targetAgent.id
                ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
                : a
            )
          );
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
    if (!activeSubThreadId || !activeSubThread || !activeThread) return;
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
    const mainThreadId = activeThread.id;
    const responder = agents[0];
    const syncMsg: Message = {
      id: `msg-sync-${Date.now()}`,
      threadId: mainThreadId,
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
      [mainThreadId]: [...(prev[mainThreadId] || []), syncMsg],
    }));

    setActiveSubThreadId(null);
  };

  // Add Emoji Reaction
  const handleAddReaction = (messageId: string, emoji: string) => {
    if (!activeThread) return;
    const reactionThreadId = activeThread.id;
    setMessages((prev) => {
      const threadMsgs = prev[reactionThreadId] || [];
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
      return { ...prev, [reactionThreadId]: updated };
    });
  };

  const handleAcpPermissionDecision = async (decision: AcpPermissionDecision) => {
    const request = pendingAcpPermissions[0];
    if (!request) {
      throw new Error('当前没有等待处理的 ACP 权限请求');
    }
    await respondToAcpPermission({
      agentId: request.agentId,
      requestId: request.requestId,
      decision,
    });
    setPendingAcpPermissions((prev) =>
      removePendingAcpPermission(prev, request.agentId, request.requestId)
    );
  };

  const handleClearAllMessages = useCallback(async () => {
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
  }, [handleAbortAll, resetAllSessionWarmState]);

  const handleUpdateAgent = useCallback((agentId: string, updatedData: Partial<Agent>) => {
    cancelRemoteAgentProbe(agentId);
    const editGeneration = cancelLocalSpawn(
      localSpawnGenerationRef.current,
      agentId
    );
    resetAllSessionWarmState();
    void safelyClearAcpSessions(agentId, undefined, '更新 Agent 配置');

    const existingAgent = agents.find((a) => a.id === agentId);
    const wasOnline =
      !!existingAgent && existingAgent.status !== 'idle' && existingAgent.status !== 'error';
    const wasLocalAgent = Boolean(
      existingAgent &&
        !existingAgent.isRemote &&
        existingAgent.acpTransport !== 'websocket'
    );
    const isRemoteAgent = Boolean(
      updatedData.isRemote ??
        existingAgent?.isRemote ??
        updatedData.acpTransport === 'websocket'
    );
    if (isRemoteAgent && updatedData.status === 'running') {
      recordRemoteProbeSuccess(remoteProbeRuntimeRef.current, agentId);
    }

    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          const nextStatus =
            updatedData.status !== undefined
              ? updatedData.status
              : isRemoteAgent
                ? a.status || 'idle'
                : 'idle';
          const merged: Agent = {
            ...a,
            ...updatedData,
            status: nextStatus,
            workspace: {
              ...a.workspace,
              ...(updatedData.workspace || {}),
            },
          };
          if (nextStatus !== 'running') {
            return resetAgentHandshakeCapabilities(
              merged,
              nextStatus,
              updatedData.statusDetail
            );
          }
          return merged;
        }
        return a;
      })
    );

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

    const tauriInvoke =
      typeof window !== 'undefined'
        ? (window as any).__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke
        : undefined;
    if ((wasLocalAgent || !isRemoteAgent) && tauriInvoke) {
      tauriInvoke('stop_acp_agent', { agentId })
        .then(async () => {
          await syncRunningAgentsWithBackend();
          if (
            !isRemoteAgent &&
            wasOnline &&
            existingAgent &&
            updatedData.isModelHealthy !== false &&
            isCurrentLocalSpawnGeneration(
              localSpawnGenerationRef.current,
              agentId,
              editGeneration
            )
          ) {
            const respawnAgent: Agent = { ...existingAgent, ...updatedData } as Agent;
            spawnLocalAcpAgent(respawnAgent);
          }
        })
        .catch(() => {});
    }
  }, [
    agents,
    cancelRemoteAgentProbe,
    resetAllSessionWarmState,
    safelyClearAcpSessions,
    spawnLocalAcpAgent,
    syncRunningAgentsWithBackend,
  ]);

  const handleConnectAgent = useCallback((agentData: Partial<Agent>) => {
    const initialStatus = agentData.status || 'idle';
    const isOnlineOnCreate = initialStatus === 'running';
    const baseMemory =
      agentData.memory || {
        ...createAgentMemoryBank('native'),
        nativeCapability: createUnknownNativeMemoryCapability(),
      };
    const effectiveMemory = isOnlineOnCreate
      ? baseMemory
      : {
          ...baseMemory,
          nativeCapability: createUnknownNativeMemoryCapability(),
        };
    const rawNewAg: Agent = {
      id: `agent-${Date.now()}`,
      name: agentData.name || 'Custom Agent',
      handle: agentData.handle || `@${(agentData.name || 'agent').toLowerCase()}`,
      avatar: agentData.avatar || '🥷',
      role: agentData.role || 'Specialized Agent',
      description: agentData.description || agentData.role || 'Custom ACP Agent',
      color: '#06b6d4',
      status: initialStatus,
      modelBadge: agentData.modelBadge || (agentData.isRemote ? 'Remote ACP' : 'ACP Stdio'),
      modelConfig: agentData.modelConfig,
      runtimePolicy: resolveEffectiveRuntimePolicy({
        runtimePolicy: agentData.runtimePolicy,
      }),
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
      acpTransport: agentData.acpTransport || (agentData.isRemote ? 'websocket' : 'stdio'),
      acpCommandOrUrl: agentData.acpCommandOrUrl || (agentData.isRemote ? (agentData.remoteUrl || 'ws://127.0.0.1:9090/acp') : 'cargo run --bin custom-agent -- --acp'),
      protocolVersion: '2 (ACP v2.0.0)',
      capabilities: {
        canAccessWorkspaceFiles: true,
        canExecuteSkills: true,
        canDelegateToSubAgents: true,
        supportsStreaming: true,
        ...(agentData.capabilities || {}),
        canUseInternalMemory:
          isOnlineOnCreate &&
          effectiveMemory.mode === 'native' &&
          effectiveMemory.nativeCapability.status === 'enabled',
      },
      workspace: {
        rootPath: agentData.workspace?.rootPath || '~/.shadow-crew',
        repoName: 'shadow-crew-workspace',
        gitBranch: 'main',
        permissionMode: agentData.readOnlyGuard ? 'read_only' : 'full_read_write',
        activeFiles: ['~/.shadow-crew/agents'],
      },
      skills: [],
      memory: effectiveMemory,
    };
    const newAg = isOnlineOnCreate
      ? rawNewAg
      : resetAgentHandshakeCapabilities(
          rawNewAg,
          initialStatus,
          agentData.statusDetail
        );
    setAgents((prev) => [...prev, newAg]);
    setDuplicatingAgent(null);
  }, []);

  const activeWorkspaceCwd = activeChannel
    ? findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id)?.cwd
    : undefined;

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

            const duplicated = resetAgentHandshakeCapabilities(
              {
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
                  ...createAgentMemoryBank(
                    agent.memory.mode,
                    agent.memory.autoGenerate
                  ),
                  nativeCapability: createUnknownNativeMemoryCapability(),
                  cartridges: agent.memory?.cartridges ? [...agent.memory.cartridges] : [],
                },
                capabilities: {
                  ...(agent.capabilities || {}),
                  // 派生副本默认继承完整能力，但允许源 Agent 显式关闭；内部记忆固定不可用。
                  canAccessWorkspaceFiles: agent.capabilities?.canAccessWorkspaceFiles ?? true,
                  canExecuteSkills: agent.capabilities?.canExecuteSkills ?? true,
                  canDelegateToSubAgents: agent.capabilities?.canDelegateToSubAgents ?? true,
                  supportsStreaming: agent.capabilities?.supportsStreaming ?? true,
                  canUseInternalMemory: false,
                },
              },
              'idle',
              undefined
            );

            const nextAgents = [...agents, duplicated];
            setAgents(nextAgents);
            await saveAgentsToDb(nextAgents);
          }}
          onCreateExpertAgentFromPack={async (expertAgent) => {
            const exists = agents.some((a) => a.id === expertAgent.id);
            const finalAgent = exists
              ? { ...expertAgent, id: `${expertAgent.id}-${Date.now()}` }
              : expertAgent;
            const nextAgents = [...agents, finalAgent];
            setAgents(nextAgents);
            await saveAgentsToDb(nextAgents);
          }}
          onOpenCreateTeamModal={() => setIsCreateTeamModalOpen(true)}
          onOpenAgentDefaultsModal={() => setIsAgentDefaultsModalOpen(true)}
          onOpenPermissionCenter={() => setIsPermissionCenterOpen(true)}
          onEditAgent={(agent) => {
            setEditingAgent(agent);
            setDuplicatingAgent(null);
            setIsConnectModalOpen(true);
          }}
          onToggleAgentStatus={(agentId) => {
            const currentAgent =
              agentsRef.current.find((a) => a.id === agentId) ||
              agents.find((a) => a.id === agentId);
            if (!currentAgent) return;

            const isCurrentlyRunning = isAgentActivelyRunning(
              currentAgent,
              remoteProbeRuntimeRef.current
            );

            if (!isCurrentlyRunning) {
              if (
                currentAgent.isRemote ||
                currentAgent.acpTransport === 'websocket'
              ) {
                void runRemoteAgentProbe(currentAgent, true);
                return;
              }

              // 本地 Agent 启动
              spawnLocalAcpAgent(currentAgent);
            } else {
              // 终止 Agent 进程并重置握手能力探测态
              setAgents((prev) =>
                stopAgentRuntimeState(
                  prev,
                  remoteProbeRuntimeRef.current,
                  agentId,
                  localSpawnGenerationRef.current
                )
              );
              const tauriInvoke =
                typeof window !== 'undefined'
                  ? (window as any).__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke
                  : undefined;
              if (!currentAgent.isRemote && tauriInvoke) {
                tauriInvoke('stop_acp_agent', {
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
            const deletedAgent = agentsRef.current.find((agent) => agent.id === agentId);
            cancelRemoteAgentProbe(agentId);
            cancelLocalSpawn(localSpawnGenerationRef.current, agentId);
            clearSessionWarmScope({ agentId });
            setAgents((prev) => prev.filter((a) => a.id !== agentId));
            const tauriInvoke =
              typeof window !== 'undefined'
                ? (window as any).__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke
                : undefined;
            if (
              deletedAgent &&
              shouldStopLocalAgentProcess(deletedAgent) &&
              tauriInvoke
            ) {
              void tauriInvoke('stop_acp_agent', { agentId })
                .then(() => syncRunningAgentsWithBackend(true))
                .catch((err: any) => {
                  console.warn('Delete agent process cleanup error:', err);
                });
            }
            void revokeAcpPermissionGrantsForAgent(agentId).catch((err) => {
              console.warn('[App] Failed to revoke ACP permission grants on agent deletion:', err);
            });
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
          <main
            className="flex-1 flex flex-col min-w-0 bg-canvas relative overflow-hidden transition-colors duration-150"
            style={{ minWidth: MIN_MAIN_TIMELINE_WIDTH }}
          >
            {activeThread && (activeThread.type === 'dm' || activeChannel) ? (
              <>
                <ChatTimeline
                  messages={activeMessages}
                  activeThread={activeThread}
                  channel={activeThread.type === 'dm' ? undefined : activeChannel ?? undefined}
                  agents={agents}
                  activeExecutions={Object.values(activeExecutions)}
                  onApplyTopicPatch={handleApplyTopicPatch}
                  onRollbackTopicPatch={handleRollbackTopicPatch}
                  onAbortAgent={(agentId) => activeThread && handleAbortAgent(agentId, activeThread.id)}
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
                agents={
                  activeTopicData?.scopeType === 'dm'
                    ? agents.filter((agent) => agent.id === activeTopicData.dmAgentId)
                    : currentChannelAgents
                }
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
                onRollbackTopicPatch={handleRollbackTopicPatch}
                workspaceCwd={getTopicWorkspaceBinding(activeTopicId ?? undefined)?.cwd}
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
            onApplyDiff={handleApplyTopicPatch}
          />
        )}

      {/* 6. Antigravity ACP Protocol & Telemetry Inspector Drawer */}
      {isAcpInspectorOpen && selectedAgent && (
        <AcpInspector
          selectedAgent={selectedAgent}
          rpcLogs={rpcLogs}
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
          onClose={() => setIsAcpInspectorOpen(false)}
        />
      )}

      {/* 7. App Modals Container */}
      <AppModalsContainer
        isAgentTeamsModalOpen={isAgentTeamsModalOpen}
        onCloseAgentTeamsModal={() => setIsAgentTeamsModalOpen(false)}
        agents={agents}
        teams={teams}
        onCreateTeam={(newTeam) => {
          const created: AgentTeam = { ...newTeam, id: `team-${Date.now()}` };
          setTeams((prev) => [...prev, created]);
        }}
        onOpenConnectModalFromTeams={() => {
          setEditingAgent(null);
          setDuplicatingAgent(null);
          setIsConnectModalOpen(true);
        }}
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
        allMessages={Object.values(messages).flat()}
        onMessagesCleared={handleClearAllMessages}
        isCreateChannelOpen={isCreateChannelOpen}
        onCloseCreateChannelModal={() => setIsCreateChannelOpen(false)}
        currentUserId={currentUserId}
        onCreateChannel={handleCreateChannel}
        targetModalChannel={targetModalChannel}
        isChannelMembersModalOpen={isChannelMembersModalOpen}
        onCloseChannelMembersModal={() => {
          setIsChannelMembersModalOpen(false);
          setModalChannelId(null);
        }}
        onUpdateChannelMembers={handleUpdateChannelMembers}
        isDeleteChannelModalOpen={isDeleteChannelModalOpen}
        onCloseDeleteChannelModal={() => {
          setIsDeleteChannelModalOpen(false);
          setModalChannelId(null);
        }}
        modalChannelUnresolvedTopics={modalChannelUnresolvedTopics}
        onDeleteChannel={handleDeleteChannel}
        isConnectModalOpen={isConnectModalOpen}
        onCloseConnectModal={() => {
          setIsConnectModalOpen(false);
          setEditingAgent(null);
          setDuplicatingAgent(null);
        }}
        editingAgent={editingAgent}
        duplicatingAgent={duplicatingAgent}
        defaultWorkspaceRoot="~/.shadow-crew"
        onUpdateAgent={handleUpdateAgent}
        onConnectAgent={handleConnectAgent}
        isNewTopicModalOpen={isNewTopicModalOpen}
        onCloseNewTopicModal={() => setIsNewTopicModalOpen(false)}
        newTopicScopeType={activeThread?.type === 'dm' ? 'dm' : 'channel'}
        newTopicChannel={activeThread?.type === 'dm' ? undefined : activeChannel ?? undefined}
        newTopicDmAgent={
          activeThread?.type === 'dm'
            ? agents.find((agent) => agent.id === activeThread.authorId)
            : undefined
        }
        newTopicDmThreadId={activeThread?.type === 'dm' ? activeThread.id : undefined}
        newTopicChannelWorkspaceCwd={
          activeThread?.type === 'dm'
            ? `~/.shadow-crew/agents/${activeThread.authorId}`
            : activeChannel
              ? findWorkspaceBinding(workspaceBindings, 'channel', activeChannel.id)?.cwd
              : undefined
        }
        newTopicAgents={
          activeThread?.type === 'dm'
            ? agents.filter((agent) => agent.id === activeThread.authorId)
            : currentChannelAgents
        }
        onCreateTopic={handleCreateTopic}
        editingTopic={editingTopic}
        editingTopicChannel={editingTopicChannel ?? undefined}
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
