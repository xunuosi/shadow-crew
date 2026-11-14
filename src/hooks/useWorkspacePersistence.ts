import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  Agent,
  AgentTeam,
  Channel,
  Thread,
  Message,
  SubThread,
  AcpRpcLog,
  WorkspaceFile,
  TopicMessageData,
  WorkspaceBinding,
} from '../types';
import {
  INITIAL_AGENTS,
  INITIAL_TEAMS,
  INITIAL_CHANNELS,
  INITIAL_THREADS,
  INITIAL_MESSAGES,
  INITIAL_SUB_THREADS,
  INITIAL_RPC_LOGS,
  MOCK_WORKSPACE_FILES,
} from '../data/mockData';
import { normalizeHydratedAgent } from '../services/agentMemory';
import {
  saveMessagesBatchToDb,
  loadMessagesFromDb,
  loadFullWorkspaceDataFromDb,
  saveChannelsToDb,
  saveWorkspaceBindingsToDb,
  saveThreadsToDb,
  saveAgentsToDb,
  saveTeamsToDb,
  saveWorkspaceStateToDb,
  isTauriEnvironment,
} from '../services/dbClient';
import {
  findWorkspaceBinding,
  migrateWorkspaceGraph,
  WORKSPACE_BINDING_SCHEMA_VERSION,
} from '../services/workspaceBindings';
import { setGlobalModelConfig } from '../services/llmService';
import { normalizeAgentHandle } from '../services/agentCollaboration';

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

export interface UseWorkspacePersistenceParams {
  currentUserId: string;
  activeTopicId: string | null;
  editingTopic: TopicMessageData | null;
  onResetAllSessionWarmStateRef: React.MutableRefObject<(() => void) | null>;
}

/**
 * 集中管理工作区核心实体状态初始化、SQLite/LocalStorage 双向持久化、
 * 历史脏数据清洗与绑定图迁移、派生频道/线程/议题上下文及消息同步提交辅助方法。
 */
export function useWorkspacePersistence({
  currentUserId,
  activeTopicId,
  editingTopic,
  onResetAllSessionWarmStateRef,
}: UseWorkspacePersistenceParams) {
  // 关键防回滚锁：首轮从 SQLite 加载完成前，严禁各 entity 的初始挂载触发 useEffect 覆盖底层数据库
  const isWorkspaceHydratedRef = useRef(false);
  const workspaceBindingSchemaPersistedRef = useRef(false);
  const syncRunningAgentsWithBackendRef = useRef<(() => Promise<void>) | null>(null);

  const sanitizeMessages = useCallback((list: Message[]): Message[] => {
    return list.map((message) => {
      const migrated = { ...message } as Message & { projectId?: string };
      delete migrated.projectId;
      if (migrated.isPending) {
        migrated.isPending = false;
      }
      if (
        migrated.type === 'topic' &&
        migrated.topicData?.gameTheoreticState &&
        (migrated.topicData.gameTheoreticState.executionStatus === 'running' ||
          migrated.topicData.gameTheoreticState.executionStatus === 'queued')
      ) {
        const gState = migrated.topicData.gameTheoreticState;
        migrated.topicData = {
          ...migrated.topicData,
          gameTheoreticState: {
            ...gState,
            executionStatus: 'failed',
            executionSummary: gState.executionSummary || '上次落地执行在完成前已中断',
            modularState: gState.modularState
              ? {
                  ...gState.modularState,
                  activeExecutionModuleId: undefined,
                  modules: gState.modularState.modules.map((m) =>
                    m.executionStatus === 'running' ? { ...m, executionStatus: 'failed' as const } : m
                  ),
                }
              : gState.modularState,
          },
        };
      }
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

  const agentsRef = useRef(agents);
  agentsRef.current = agents;

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
                  m.kind === 'rollup' ||
                  m.kind === 'guard' ||
                  m.agentBadge === 'Consensus Rollup' ||
                  m.agentBadge === 'Channel Guard' ||
                  (m.channelId && m.channelId !== 'direct-messages' && !m.channelId.startsWith('dm-') && !m.channelId.startsWith('agent-') && m.channelId.trim() !== '')
                ) {
                  return false;
                }
                return m.authorId === currentUserId || m.authorId === 'user-norris' || m.authorId === agentId || m.authorId === 'system';
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

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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

  const [rpcLogs, setRpcLogs] = useState<AcpRpcLog[]>(INITIAL_RPC_LOGS);
  const [workspaceFiles] = useState<WorkspaceFile[]>(MOCK_WORKSPACE_FILES);

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
              onResetAllSessionWarmStateRef.current?.();
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
            const copiedKeys = new Set<string>();
            let hasNew = false;
            for (const msg of messagesFromDatabase) {
              const key = msg.threadId || msg.channelId || 'general';
              if (!next[key]) {
                next[key] = [];
                copiedKeys.add(key);
              } else if (!copiedKeys.has(key)) {
                next[key] = [...next[key]];
                copiedKeys.add(key);
              }
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

  useEffect(() => {
    if (!isWorkspaceHydratedRef.current) return;
    saveWorkspaceStateToDb('subThreads', subThreads);
  }, [subThreads]);

  /**
   * 同步更新 messagesRef.current 并提交 React 状态更新 (Commit Messages Synchronously)
   *
   * 根因防御：在 React 18/19 自动批处理下，若先调用了 setActiveExecutions 等其他 setState，
   * 紧随其后的 setMessages(prev => ...) 不会同步执行 updater，而是推迟至下一轮渲染。
   * 这会导致 Promise.allSettled 微任务立即进入下一跳时，messagesRef.current 缺失刚刚产出的触发消息。
   * 通过在调用 setMessages 前同步对 messagesRef.current 执行幂等更新，确保任意同步/微任务时刻读取的快照均包含最新消息。
   */
  const commitMessages = useCallback(
    (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => {
      messagesRef.current = updater(messagesRef.current);
      setMessages((prev) => {
        const next = updater(prev);
        messagesRef.current = next;
        return next;
      });
    },
    []
  );

  // Computed Context
  const visibleChannels = useMemo(
    () => channels.filter((c) => c.status !== 'deleted'),
    [channels]
  );

  const getTopicWorkspaceBinding = useCallback(
    (topicId?: string) => findWorkspaceBinding(workspaceBindings, 'topic', topicId),
    [workspaceBindings]
  );

  const getChannelWorkspaceBinding = useCallback(
    (channelId?: string) => findWorkspaceBinding(workspaceBindings, 'channel', channelId),
    [workspaceBindings]
  );

  // 1. 判断当前是否处于显式私聊模式 (Direct Message Mode)
  const isDirectMessageSelected = useMemo(
    () =>
      activeThreadId.startsWith('thread-dm-') ||
      threads.find((t) => t.id === activeThreadId)?.type === 'dm',
    [activeThreadId, threads]
  );

  // 2. 频道解析：若在私聊模式下，强制清空 activeChannel，杜绝任何频道上下文与成员名单穿透至私聊
  const activeChannel = useMemo(
    () =>
      isDirectMessageSelected
        ? null
        : channels.find((c) => c.id === activeChannelId && c.status !== 'deleted') ||
          visibleChannels[0] ||
          null,
    [isDirectMessageSelected, channels, activeChannelId, visibleChannels]
  );

  // 3. 线程解析：
  // - 若为私聊模式，严格锁定对应 dmThread，严禁回退至任何频道线程；
  // - 若为频道模式，严格只在该频道所属线程中查找，彻底废除 threads[0] 的盲目 cross-fallback
  const activeThread = useMemo(() => {
    const rawThread = isDirectMessageSelected
      ? threads.find((t) => t.id === activeThreadId && t.type === 'dm') ||
        threads.find((t) => t.type === 'dm') ||
        null
      : (activeChannel
          ? threads.find((t) => t.id === activeThreadId && t.channelId === activeChannel.id && t.type !== 'dm')
          : null) ||
        (activeChannel
          ? threads.find((t) => t.channelId === activeChannel.id && t.type !== 'dm')
          : null) ||
        null;
    if (!rawThread) return null;
    if (rawThread.type === 'dm') {
      const dmAgent = agents.find(
        (a) => a.id === rawThread.authorId || rawThread.id === `thread-dm-${a.id}`
      );
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

  const activeMessages = useMemo(
    () => (activeThread ? messages[activeThread.id] || [] : []),
    [activeThread, messages]
  );

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

  const activeTopicData = useMemo<TopicMessageData | null>(() => {
    if (!activeTopicId) return null;
    for (const msgList of Object.values(messages) as Message[][]) {
      for (const m of msgList) {
        if (m.type === 'topic' && m.topicData?.id === activeTopicId) {
          return m.topicData;
        }
      }
    }
    return null;
  }, [messages, activeTopicId]);

  const activeTopicMessages = useMemo<Message[]>(
    () => (activeTopicId ? messages[activeTopicId] || [] : []),
    [messages, activeTopicId]
  );

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

  const getTopicData = useCallback((topicId: string): TopicMessageData | null => {
    for (const msgList of Object.values(messagesRef.current) as Message[][]) {
      for (const m of msgList) {
        if (m.type === 'topic' && m.topicData?.id === topicId) {
          return m.topicData;
        }
      }
    }
    return null;
  }, []);

  const updateTopicDataInState = useCallback(
    (topicId: string, updater: (oldTopic: TopicMessageData) => TopicMessageData) => {
      const applyUpdate = (source: Record<string, Message[]>): Record<string, Message[]> => {
        let parentThreadId: string | null = null;
        for (const [tId, msgList] of Object.entries(source) as [string, Message[]][]) {
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
    },
    []
  );

  return {
    agents,
    setAgents,
    teams,
    setTeams,
    channels,
    setChannels,
    activeChannelId,
    setActiveChannelId,
    workspaceBindings,
    setWorkspaceBindings,
    threads,
    setThreads,
    activeThreadId,
    setActiveThreadId,
    messages,
    setMessages,
    subThreads,
    setSubThreads,
    rpcLogs,
    setRpcLogs,
    workspaceFiles,
    messagesRef,
    agentsRef,
    syncRunningAgentsWithBackendRef,
    isWorkspaceHydratedRef,
    visibleChannels,
    getTopicWorkspaceBinding,
    getChannelWorkspaceBinding,
    isDirectMessageSelected,
    activeChannel,
    activeThread,
    activeMessages,
    currentChannelAgents,
    editingTopicChannel,
    editingTopicAgents,
    activeTopicData,
    activeTopicMessages,
    commitMessages,
    getTopicData,
    updateTopicDataInState,
  };
}
