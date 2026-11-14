import { useState, useEffect, useCallback, useRef } from 'react';
import type React from 'react';
import type {
  AcpPermissionDecision,
  AcpPermissionRequest,
  AcpRpcLog,
  ActiveAgentExecution,
  Agent,
  AgentRuntimeStatus,
  Message,
  SubThread,
  Thread,
} from '../types';
import {
  buildAgentLaunchEnv,
  clearAcpAgentSessions,
  matchesSessionScope,
  probeRemoteAcpConnection,
  setOnAcpNativeMemoryCapabilityUpdated,
} from '../services/acpClient';
import {
  listPendingAcpPermissions,
  removePendingAcpPermission,
  respondToAcpPermission,
  revokeAcpPermissionGrantsForAgent,
  upsertPendingAcpPermission,
} from '../services/acpPermissionClient';
import {
  listenTauriEvent,
  type TauriEventPayload,
} from '../services/tauriEventClient';
import {
  createAgentMemoryBank,
  createUnknownNativeMemoryCapability,
} from '../services/agentMemory';
import { getTauriInvoke, saveAgentsToDb } from '../services/dbClient';
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
  type RemoteProbeLease,
  resetAgentHandshakeCapabilities,
  shouldRefreshRemoteProbe,
  shouldStopLocalAgentProcess,
  stopAgentRuntimeState,
} from '../services/remoteAgentLifecycle';

const REMOTE_ACP_PROBE_TIMEOUT_MS = 5_000;
const REMOTE_ACP_HEALTH_INTERVAL_MS = 5_000;
const REMOTE_ACP_HEALTH_REFRESH_MS = 15_000;
const PERMISSION_POLL_INTERVAL_MS = 1_000;
const LOCAL_BACKEND_SYNC_INTERVAL_MS = 3_000;

export interface UseAcpRuntimeLifecycleParams {
  mainView: 'chat' | 'agents';
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  agentsRef: React.MutableRefObject<Agent[]>;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  setSubThreads: React.Dispatch<React.SetStateAction<Record<string, SubThread>>>;
  commitMessages: (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => void;
  rpcLogs: AcpRpcLog[];
  setRpcLogs: React.Dispatch<React.SetStateAction<AcpRpcLog[]>>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((
          prev: Record<string, ActiveAgentExecution>
        ) => Record<string, ActiveAgentExecution>)
  ) => void;
  deliveredStandingContextRef: React.MutableRefObject<Set<string>>;
  sessionWatermarksRef: React.MutableRefObject<Map<string, string>>;
  persistSessionWarmState: () => void;
  clearSessionWarmScope: (
    scope: Parameters<typeof matchesSessionScope>[1]
  ) => void;
  resetAllSessionWarmState: () => void;
  safelyClearAcpSessions: (
    agentId?: string,
    sessionKeyPrefix?: string,
    contextLabel?: string
  ) => Promise<void>;
  syncRunningAgentsWithBackendRef: React.MutableRefObject<
    (() => Promise<void>) | null
  >;
  localSpawnGenerationRef?: React.MutableRefObject<Map<string, number>>;
  setDuplicatingAgent: React.Dispatch<React.SetStateAction<Agent | null>>;
}

export interface UseAcpRuntimeLifecycleReturn {
  pendingAcpPermissions: AcpPermissionRequest[];
  logRpc: (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => void;
  syncRunningAgentsWithBackend: (
    settleUnmatchedStarting?: boolean
  ) => Promise<void>;
  spawnLocalAcpAgent: (agent: Agent) => Promise<void>;
  runRemoteAgentProbe: (agent: Agent, markStarting: boolean) => Promise<void>;
  cancelRemoteAgentProbe: (agentId: string) => void;
  handleAcpPermissionDecision: (
    decision: AcpPermissionDecision
  ) => Promise<void>;
  handleUpdateAgent: (agentId: string, updatedData: Partial<Agent>) => void;
  handleConnectAgent: (agentData: Partial<Agent>) => void;
  handleDuplicateAgent: (agent: Agent) => Promise<void>;
  handleCreateExpertAgentFromPack: (expertAgent: Agent) => Promise<void>;
  handleToggleAgentStatus: (agentId: string) => void;
  handleDeleteAgent: (agentId: string) => void;
}

/**
 * 构造消息/子线程同步用的 Agent 基础资料补丁。
 */
function buildAuthorProfilePatch(updatedData: Partial<Agent>): Partial<Message> {
  return {
    ...(updatedData.name ? { authorName: updatedData.name } : {}),
    ...(updatedData.avatar ? { authorAvatar: updatedData.avatar } : {}),
    ...(updatedData.handle ? { authorHandle: updatedData.handle } : {}),
  };
}

/**
 * 就地更新各会话流中指定 Agent 当前处于 isPending 状态的占位消息。
 */
function updatePendingAgentMessage(
  prev: Record<string, Message[]>,
  agentId: string,
  updater: (target: Message) => Message | null
): Record<string, Message[]> {
  let updated = false;
  const next: Record<string, Message[]> = {};
  for (const [threadId, list] of Object.entries(prev)) {
    if (!list || list.length === 0) {
      next[threadId] = list;
      continue;
    }
    const pendingIdx = list.findIndex(
      (m) => m.authorId === agentId && m.isPending
    );
    if (pendingIdx !== -1) {
      const replacement = updater(list[pendingIdx]);
      if (replacement) {
        const updatedList = [...list];
        updatedList[pendingIdx] = replacement;
        next[threadId] = updatedList;
        updated = true;
        continue;
      }
    }
    next[threadId] = list;
  }
  return updated ? next : prev;
}

/**
 * 在旧版仅返回活跃 agent_id 列表时，协调本地 Agent 的运行态与握手能力。
 */
function reconcileLegacyRunningAgentIds(
  prev: Agent[],
  runningIds: string[],
  settleUnmatchedStarting: boolean
): Agent[] {
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
    }
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
  });
  return hasChange ? next : prev;
}

/**
 * 将 Agent 名称/头像/Handle 的修改同步到主线程消息与议题元数据中。
 */
function syncAgentProfileInMessages(
  prev: Record<string, Message[]>,
  agentId: string,
  updatedData: Partial<Agent>
): Record<string, Message[]> {
  let changed = false;
  const authorPatch = buildAuthorProfilePatch(updatedData);
  const next: Record<string, Message[]> = {};
  for (const [threadId, msgs] of Object.entries(prev)) {
    let threadChanged = false;
    const newMsgs = msgs.map((m) => {
      const isAuthor = m.authorId === agentId;
      const isTopicAuthor = m.topicData && m.topicData.authorId === agentId;
      if (!isAuthor && !isTopicAuthor) {
        return m;
      }
      threadChanged = true;
      return {
        ...m,
        ...(isAuthor ? authorPatch : {}),
        ...(m.topicData
          ? {
              topicData: {
                ...m.topicData,
                ...(isTopicAuthor && updatedData.name
                  ? { authorName: updatedData.name }
                  : {}),
                ...(isTopicAuthor && updatedData.avatar
                  ? { authorAvatar: updatedData.avatar }
                  : {}),
              },
            }
          : {}),
      };
    });
    if (threadChanged) {
      changed = true;
      next[threadId] = newMsgs;
    } else {
      next[threadId] = msgs;
    }
  }
  return changed ? next : prev;
}

/**
 * 将 Agent 名称/头像/Handle 的修改同步到子线程消息中。
 */
function syncAgentProfileInSubThreads(
  prev: Record<string, SubThread>,
  agentId: string,
  updatedData: Partial<Agent>
): Record<string, SubThread> {
  let changed = false;
  const authorPatch = buildAuthorProfilePatch(updatedData);
  const next: Record<string, SubThread> = {};
  for (const [subId, sub] of Object.entries(prev)) {
    let subChanged = false;
    const newMsgs = sub.messages.map((m) => {
      if (m.authorId !== agentId) return m;
      subChanged = true;
      return { ...m, ...authorPatch };
    });
    if (subChanged) {
      changed = true;
      next[subId] = { ...sub, messages: newMsgs };
    } else {
      next[subId] = sub;
    }
  }
  return changed ? next : prev;
}

/**
 * 统一管理 ACP 运行时进程生命周期、远程 WS 探针、Tauri 实时事件监听、
 * 权限审批队列、RPC 日志记录与 Agent 增删改启停操作。
 */
export function useAcpRuntimeLifecycle(
  params: UseAcpRuntimeLifecycleParams
): UseAcpRuntimeLifecycleReturn {
  const {
    mainView,
    agents,
    setAgents,
    agentsRef,
    setThreads,
    setMessages,
    setSubThreads,
    commitMessages,
    setRpcLogs,
    setActiveExecutions,
    deliveredStandingContextRef,
    sessionWatermarksRef,
    persistSessionWarmState,
    clearSessionWarmScope,
    resetAllSessionWarmState,
    safelyClearAcpSessions,
    syncRunningAgentsWithBackendRef,
    localSpawnGenerationRef: externalLocalSpawnGenerationRef,
    setDuplicatingAgent,
  } = params;

  const [pendingAcpPermissions, setPendingAcpPermissions] = useState<
    AcpPermissionRequest[]
  >([]);
  const remoteProbeRuntimeRef = useRef<Map<string, RemoteProbeLease>>(
    new Map()
  );
  const internalLocalSpawnGenerationRef = useRef<Map<string, number>>(
    new Map()
  );
  const localSpawnGenerationRef =
    externalLocalSpawnGenerationRef ?? internalLocalSpawnGenerationRef;

  // 通过 ref 持有长期事件监听器依赖的回调与最新引用，保证 Tauri 订阅仅在挂载期建立一次且不出现陈旧闭包
  const listenerCallbacksRef = useRef({
    commitMessages,
    clearSessionWarmScope,
    persistSessionWarmState,
    setActiveExecutions,
    setAgents,
    setMessages,
    agentsRef,
    deliveredStandingContextRef,
    sessionWatermarksRef,
  });
  listenerCallbacksRef.current = {
    commitMessages,
    clearSessionWarmScope,
    persistSessionWarmState,
    setActiveExecutions,
    setAgents,
    setMessages,
    agentsRef,
    deliveredStandingContextRef,
    sessionWatermarksRef,
  };

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
  }, [setAgents]);

  const cancelRemoteAgentProbe = useCallback((agentId: string) => {
    cancelRemoteProbe(remoteProbeRuntimeRef.current, agentId);
  }, []);

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
    [setAgents]
  );

  // Synchronize Agent running status with Tauri backend process manager
  const syncRunningAgentsWithBackend = useCallback(
    async (settleUnmatchedStarting = false) => {
      const tauriInvoke = getTauriInvoke();
      if (!tauriInvoke) return;

      try {
        const runtimeStatuses: AgentRuntimeStatus[] = await tauriInvoke(
          'get_agents_runtime_status'
        );
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
          const runningIds: string[] = await tauriInvoke(
            'get_running_agent_ids'
          );
          if (Array.isArray(runningIds)) {
            setAgents((prev) =>
              reconcileLegacyRunningAgentIds(
                prev,
                runningIds,
                settleUnmatchedStarting
              )
            );
          }
        } catch (err) {
          console.warn('[Sync ACP] Failed to query running agents:', err);
        }
      }
    },
    [setAgents]
  );
  syncRunningAgentsWithBackendRef.current = syncRunningAgentsWithBackend;

  // 启动本地 ACP Agent 进程（Tauri stdio 拉起 / Web 运行时提示）
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

      const tauriInvoke = getTauriInvoke();
      if (!tauriInvoke) {
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
        return;
      }

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
    },
    [localSpawnGenerationRef, setAgents, syncRunningAgentsWithBackend]
  );

  // Listen for real-time ACP status changes, permissions, replay, heartbeat and stream chunks from Tauri backend
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isUnmounted = false;
    const unlisteners: Array<() => void> = [];

    const registerListener = <T = any>(
      eventName: string,
      handler: (event: TauriEventPayload<T>) => void,
      errorLabel?: string
    ) => {
      listenTauriEvent<T>(eventName, handler)
        .then((unlistenFn) => {
          if (isUnmounted) {
            unlistenFn();
          } else {
            unlisteners.push(unlistenFn);
          }
        })
        .catch((err) => {
          if (errorLabel) {
            console.warn(errorLabel, err);
          }
        });
    };

    registerListener<AcpPermissionRequest | undefined>(
      'acp:permission_request',
      (event) => {
        const request = event?.payload;
        if (request?.requestId && request.agentId) {
          setPendingAcpPermissions((prev) =>
            upsertPendingAcpPermission(prev, request)
          );
        }
      },
      '[App] Failed to subscribe ACP permission events:'
    );

    registerListener<{ agentId?: string; requestId?: string } | undefined>(
      'acp:permission_resolved',
      (event) => {
        const agentId = event?.payload?.agentId;
        const requestId = event?.payload?.requestId;
        if (agentId && requestId) {
          setPendingAcpPermissions((prev) =>
            removePendingAcpPermission(prev, agentId, requestId)
          );
        }
      },
      '[App] Failed to subscribe ACP permission resolution events:'
    );

    const hydratePendingPermissions = () =>
      listPendingAcpPermissions()
        .then((requests) => {
          if (isUnmounted) return;
          setPendingAcpPermissions(
            [...requests].sort((a, b) => a.createdAt - b.createdAt)
          );
        })
        .catch((err) => {
          console.warn('[App] Failed to hydrate pending ACP permissions:', err);
        });

    void hydratePendingPermissions();
    const permissionPollTimer = window.setInterval(
      hydratePendingPermissions,
      PERMISSION_POLL_INTERVAL_MS
    );

    registerListener<
      | { agent_id?: string; status?: string; status_detail?: string | null }
      | undefined
    >('acp:status_change', (event) => {
      const payload = event?.payload;
      if (payload && payload.agent_id) {
        // 当 Agent 停止或断开连接时，仅更新 UI 状态为 idle 并重置握手探测能力，
        // 严禁静默销毁已持久化的会话与水位线，确保 Agent 重新连接后能优先通过 Layer 1 (session/load) 原地恢复会话上下文
        listenerCallbacksRef.current.setAgents((prev) =>
          applyLocalStatusChangeEvent(
            prev,
            payload as Parameters<typeof applyLocalStatusChangeEvent>[1]
          )
        );
      }
    });

    registerListener<{ session_key?: string; agent_id?: string } | undefined>(
      'acp:session_reset',
      (event) => {
        const payload = event?.payload;
        if (!payload) return;
        // 当底层确认触发 session/new (未命中或不支持 session/load 时)，重置该会话的水位线与公约挂载标记，
        // 使得 Layer 2 平台层在 Prompt 编译时自动注入增量与历史补偿
        const {
          deliveredStandingContextRef: standingRef,
          sessionWatermarksRef: watermarksRef,
          clearSessionWarmScope: clearScope,
          persistSessionWarmState: persistWarm,
        } = listenerCallbacksRef.current;

        if (payload.session_key) {
          standingRef.current.delete(payload.session_key);
          watermarksRef.current.delete(payload.session_key);
          if (payload.agent_id) {
            const compoundKey = `${payload.session_key}:${payload.agent_id}`;
            standingRef.current.delete(compoundKey);
            watermarksRef.current.delete(compoundKey);
          }
        } else if (payload.agent_id) {
          clearScope({ agentId: payload.agent_id });
          return;
        }
        persistWarm();
      }
    );

    registerListener<any>('acp:replay_sink', (event) => {
      const payload = event?.payload;
      if (!payload || !payload.room_id || !Array.isArray(payload.messages)) {
        return;
      }
      const { room_id, messages: replayedMsgs } = payload;
      if (replayedMsgs.length === 0) return;

      const {
        commitMessages: commitMsgs,
        agentsRef: currentAgentsRef,
      } = listenerCallbacksRef.current;

      commitMsgs((prev) => {
        const existing = prev[room_id] || [];
        const existingIds = new Set(existing.map((m) => m.id));
        // 关键 Replay Sink 规约：按 messageId 严格幂等去重，仅补入本地缺少的历史条目
        const missing = replayedMsgs.filter(
          (rm: any) => rm.messageId && !existingIds.has(rm.messageId)
        );
        if (missing.length === 0) return prev;

        const agentMeta = currentAgentsRef.current.find(
          (a) => a.id === payload.agent_id
        );
        const converted: Message[] = missing.map((rm: any) => ({
          id: rm.messageId,
          threadId: room_id,
          authorId: rm.role === 'user' ? 'user' : payload.agent_id || 'agent',
          authorName:
            rm.role === 'user' ? 'User' : agentMeta?.name || 'Agent',
          authorHandle: rm.role === 'user' ? undefined : agentMeta?.handle,
          authorAvatar: rm.role === 'user' ? undefined : agentMeta?.avatar,
          isAgent: rm.role !== 'user',
          agentBadge:
            rm.role === 'user'
              ? undefined
              : `${agentMeta?.modelBadge?.split(' ')[0] || 'Local'} · Replay`,
          timestamp: new Date(rm.timestamp || Date.now()).toLocaleTimeString(
            [],
            { hour: '2-digit', minute: '2-digit' }
          ),
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
    });

    registerListener<
      { agent_id?: string; elapsed_seconds?: number } | undefined
    >('acp:thinking_heartbeat', (event) => {
      const payload = event?.payload;
      if (!payload || !payload.agent_id) return;
      const agentId = payload.agent_id;
      const elapsed = payload.elapsed_seconds || 0;
      const hint =
        elapsed > 60
          ? `大模型正在深度推理，请耐心稍候 (${elapsed}s)...`
          : elapsed > 25
            ? `正在深入分析上下文与技术边界 (${elapsed}s)...`
            : `正在分析推演中 (${elapsed}s)...`;

      listenerCallbacksRef.current.setActiveExecutions((prev) => {
        let updated = false;
        const next = { ...prev };
        for (const key in next) {
          if (
            next[key].agentId === agentId &&
            next[key].status === 'thinking'
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
      listenerCallbacksRef.current.setMessages((prev) =>
        updatePendingAgentMessage(prev, agentId, (target) =>
          target.pendingHint !== hint
            ? { ...target, pendingHint: hint }
            : null
        )
      );
    });

    // 实时监听 Agent 流式 chunk 吐字，就地注入 isPending 占位卡
    registerListener<{ agent_id?: string; chunk?: string } | undefined>(
      'acp:chunk',
      (event) => {
        const payload = event?.payload;
        if (!payload || !payload.agent_id || !payload.chunk) return;
        const agentId = payload.agent_id;
        const chunkText = payload.chunk;

        listenerCallbacksRef.current.setMessages((prev) =>
          updatePendingAgentMessage(prev, agentId, (target) => ({
            ...target,
            content: (target.content || '') + chunkText,
          }))
        );
      }
    );

    return () => {
      isUnmounted = true;
      window.clearInterval(permissionPollTimer);
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  // Sync on initial mount
  useEffect(() => {
    void syncRunningAgentsWithBackend();
  }, [syncRunningAgentsWithBackend]);

  // Sync when switching views (e.g. chat -> agents)
  useEffect(() => {
    if (mainView === 'agents') {
      void syncRunningAgentsWithBackend();
    }
  }, [mainView, syncRunningAgentsWithBackend]);

  // Periodic polling every 3 seconds to keep UI in lockstep with OS processes
  useEffect(() => {
    const timer = setInterval(() => {
      void syncRunningAgentsWithBackend();
    }, LOCAL_BACKEND_SYNC_INTERVAL_MS);
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
          ) {
            return;
          }
          void runRemoteAgentProbe(agent, false);
        });
    };
    const timer = setInterval(
      refreshRemoteAgents,
      REMOTE_ACP_HEALTH_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [agentsRef, runRemoteAgentProbe]);

  // Helper to record an ACP JSON-RPC packet
  const logRpc = useCallback(
    (
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
    },
    [setRpcLogs]
  );

  const handleAcpPermissionDecision = useCallback(
    async (decision: AcpPermissionDecision) => {
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
    },
    [pendingAcpPermissions]
  );

  const handleUpdateAgent = useCallback(
    (agentId: string, updatedData: Partial<Agent>) => {
      cancelRemoteAgentProbe(agentId);
      const editGeneration = cancelLocalSpawn(
        localSpawnGenerationRef.current,
        agentId
      );
      resetAllSessionWarmState();
      void safelyClearAcpSessions(agentId, undefined, '更新 Agent 配置');

      const existingAgent = agents.find((a) => a.id === agentId);
      const wasOnline =
        !!existingAgent &&
        existingAgent.status !== 'idle' &&
        existingAgent.status !== 'error';
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
          if (a.id !== agentId) return a;
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

        setMessages((prev) =>
          syncAgentProfileInMessages(prev, agentId, updatedData)
        );

        setSubThreads((prev) =>
          syncAgentProfileInSubThreads(prev, agentId, updatedData)
        );
      }

      const tauriInvoke = getTauriInvoke();
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
              const respawnAgent: Agent = {
                ...existingAgent,
                ...updatedData,
              } as Agent;
              void spawnLocalAcpAgent(respawnAgent);
            }
          })
          .catch(() => {});
      }
    },
    [
      agents,
      cancelRemoteAgentProbe,
      localSpawnGenerationRef,
      resetAllSessionWarmState,
      safelyClearAcpSessions,
      setAgents,
      setMessages,
      setSubThreads,
      setThreads,
      spawnLocalAcpAgent,
      syncRunningAgentsWithBackend,
    ]
  );

  const handleConnectAgent = useCallback(
    (agentData: Partial<Agent>) => {
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
        handle:
          agentData.handle || `@${(agentData.name || 'agent').toLowerCase()}`,
        avatar: agentData.avatar || '🥷',
        role: agentData.role || 'Specialized Agent',
        description:
          agentData.description || agentData.role || 'Custom ACP Agent',
        color: '#06b6d4',
        status: initialStatus,
        modelBadge:
          agentData.modelBadge ||
          (agentData.isRemote ? 'Remote ACP' : 'ACP Stdio'),
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
        acpTransport:
          agentData.acpTransport ||
          (agentData.isRemote ? 'websocket' : 'stdio'),
        acpCommandOrUrl:
          agentData.acpCommandOrUrl ||
          (agentData.isRemote
            ? agentData.remoteUrl || 'ws://127.0.0.1:9090/acp'
            : 'cargo run --bin custom-agent -- --acp'),
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
          permissionMode: agentData.readOnlyGuard
            ? 'read_only'
            : 'full_read_write',
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
    },
    [setAgents, setDuplicatingAgent]
  );

  const handleDuplicateAgent = useCallback(
    async (agent: Agent) => {
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
            cartridges: agent.memory?.cartridges
              ? [...agent.memory.cartridges]
              : [],
          },
          capabilities: {
            canAccessWorkspaceFiles: true,
            canExecuteSkills: true,
            canDelegateToSubAgents: true,
            supportsStreaming: true,
            ...(agent.capabilities || {}),
            canUseInternalMemory: false,
          },
        },
        'idle',
        undefined
      );

      const nextAgents = [...agents, duplicated];
      setAgents(nextAgents);
      await saveAgentsToDb(nextAgents);
    },
    [agents, setAgents]
  );

  const handleCreateExpertAgentFromPack = useCallback(
    async (expertAgent: Agent) => {
      const exists = agents.some((a) => a.id === expertAgent.id);
      const finalAgent = exists
        ? { ...expertAgent, id: `${expertAgent.id}-${Date.now()}` }
        : expertAgent;
      const nextAgents = [...agents, finalAgent];
      setAgents(nextAgents);
      await saveAgentsToDb(nextAgents);
    },
    [agents, setAgents]
  );

  const handleToggleAgentStatus = useCallback(
    (agentId: string) => {
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
        void spawnLocalAcpAgent(currentAgent);
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
        const tauriInvoke = getTauriInvoke();
        if (!currentAgent.isRemote && tauriInvoke) {
          tauriInvoke('stop_acp_agent', {
            agentId: currentAgent.id,
          })
            .then(() => {
              void syncRunningAgentsWithBackend();
            })
            .catch((err: any) => {
              console.warn('Stop agent error:', err);
            });
        }
      }
    },
    [
      agents,
      agentsRef,
      localSpawnGenerationRef,
      runRemoteAgentProbe,
      setAgents,
      spawnLocalAcpAgent,
      syncRunningAgentsWithBackend,
    ]
  );

  const handleDeleteAgent = useCallback(
    (agentId: string) => {
      const deletedAgent = agentsRef.current.find(
        (agent) => agent.id === agentId
      );
      cancelRemoteAgentProbe(agentId);
      cancelLocalSpawn(localSpawnGenerationRef.current, agentId);
      clearSessionWarmScope({ agentId });
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      const tauriInvoke = getTauriInvoke();
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
        console.warn(
          '[App] Failed to revoke ACP permission grants on agent deletion:',
          err
        );
      });
      void clearAcpAgentSessions(agentId).catch((err) => {
        console.warn('[App] Failed to clear sessions on agent deletion:', err);
      });
    },
    [
      agentsRef,
      cancelRemoteAgentProbe,
      clearSessionWarmScope,
      localSpawnGenerationRef,
      setAgents,
      syncRunningAgentsWithBackend,
    ]
  );

  return {
    pendingAcpPermissions,
    logRpc,
    syncRunningAgentsWithBackend,
    spawnLocalAcpAgent,
    runRemoteAgentProbe,
    cancelRemoteAgentProbe,
    handleAcpPermissionDecision,
    handleUpdateAgent,
    handleConnectAgent,
    handleDuplicateAgent,
    handleCreateExpertAgentFromPack,
    handleToggleAgentStatus,
    handleDeleteAgent,
  };
}
