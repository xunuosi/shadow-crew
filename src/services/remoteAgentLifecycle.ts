import { AcpNativeMemoryCapability, Agent, AgentRuntimeStatus } from '../types';
import { createUnknownNativeMemoryCapability } from './agentMemory';

export interface RemoteProbeLease {
  generation: number;
  inFlight: boolean;
  lastAttemptAt: number;
}

export interface RemoteProbeOutcomeInput {
  ok: boolean;
  latencyMs: number;
  error?: string;
  loadSession?: boolean;
  resumeSession?: boolean;
  nativeMemory?: AcpNativeMemoryCapability;
}

export function nativeMemoryCapabilityChanged(
  current: AcpNativeMemoryCapability,
  next: AcpNativeMemoryCapability | null | undefined
): boolean {
  if (!next) return false;
  return (
    current.status !== next.status ||
    current.persistent !== next.persistent ||
    current.crossThread !== next.crossThread ||
    current.provider !== next.provider ||
    current.scope !== next.scope ||
    current.detail !== next.detail
  );
}

export function getRemoteProbeLease(
  store: Map<string, RemoteProbeLease>,
  agentId: string
): RemoteProbeLease {
  const existing = store.get(agentId);
  if (existing) return existing;
  const created: RemoteProbeLease = {
    generation: 0,
    inFlight: false,
    lastAttemptAt: 0,
  };
  store.set(agentId, created);
  return created;
}

export function beginRemoteProbe(
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  now = Date.now()
): number {
  const lease = getRemoteProbeLease(store, agentId);
  lease.generation += 1;
  lease.inFlight = true;
  lease.lastAttemptAt = now;
  return lease.generation;
}

/** Returns false when a newer start/cancel operation superseded this probe. */
export function completeRemoteProbe(
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  generation: number
): boolean {
  const lease = store.get(agentId);
  if (!lease || lease.generation !== generation) return false;
  lease.inFlight = false;
  return true;
}

export function cancelRemoteProbe(
  store: Map<string, RemoteProbeLease>,
  agentId: string
): void {
  const lease = getRemoteProbeLease(store, agentId);
  lease.generation += 1;
  lease.inFlight = false;
  lease.lastAttemptAt = 0;
}

export function beginLocalSpawn(
  store: Map<string, number>,
  agentId: string
): number {
  const nextGen = (store.get(agentId) || 0) + 1;
  store.set(agentId, nextGen);
  return nextGen;
}

export function completeLocalSpawn(
  store: Map<string, number>,
  agentId: string,
  generation: number
): boolean {
  return store.get(agentId) === generation;
}

export function cancelLocalSpawn(
  store: Map<string, number>,
  agentId: string
): void {
  store.set(agentId, (store.get(agentId) || 0) + 1);
}

export function recordRemoteProbeSuccess(
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  now = Date.now()
): void {
  const lease = getRemoteProbeLease(store, agentId);
  lease.inFlight = false;
  lease.lastAttemptAt = now;
}

export function shouldRefreshRemoteProbe(
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  refreshMs: number,
  now = Date.now()
): boolean {
  const lease = getRemoteProbeLease(store, agentId);
  return !lease.inFlight && now - lease.lastAttemptAt >= refreshMs;
}

export function isAgentActivelyRunning(
  agent: Pick<Agent, 'id' | 'status'>,
  store?: Map<string, RemoteProbeLease>
): boolean {
  if (store?.get(agent.id)?.inFlight) {
    return true;
  }
  return (
    agent.status === 'running' ||
    agent.status === 'starting' ||
    agent.status === 'thinking' ||
    agent.status === 'using_skill' ||
    agent.status === 'accessing_workspace' ||
    agent.status === 'querying_memory'
  );
}

export function markRemoteAgentStarting(
  agents: Agent[],
  agentId: string
): Agent[] {
  return agents.map((a) =>
    a.id === agentId
      ? resetAgentHandshakeCapabilities(
          a,
          'starting',
          '连接远程 ACP 节点中...'
        )
      : a
  );
}

export function applyRemoteProbeOutcome(
  agents: Agent[],
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  generation: number,
  probe: RemoteProbeOutcomeInput,
  markStarting: boolean
): { agents: Agent[]; applied: boolean } {
  if (!completeRemoteProbe(store, agentId, generation)) {
    return { agents, applied: false };
  }

  if (!probe.ok) {
    const nextAgents = agents.map((a) =>
      a.id === agentId
        ? {
            ...resetAgentHandshakeCapabilities(
              a,
              'error',
              probe.error || '远程连接失败'
            ),
            isModelHealthy: false,
          }
        : a
    );
    return { agents: nextAgents, applied: true };
  }

  const resolvedNativeCapability =
    probe.nativeMemory || createUnknownNativeMemoryCapability();
  const nextAgents = agents.map((a) => {
    if (a.id !== agentId) return a;
    const targetCanUseMemory =
      a.memory.mode === 'native' &&
      resolvedNativeCapability.status === 'enabled';
    const capabilityChanged = nativeMemoryCapabilityChanged(
      a.memory.nativeCapability,
      resolvedNativeCapability
    );
    const loadChanged =
      probe.loadSession !== undefined &&
      a.capabilities?.supportsLoadSession !== probe.loadSession;
    const resumeChanged =
      probe.resumeSession !== undefined &&
      a.capabilities?.supportsResumeSession !== probe.resumeSession;
    const statusChanged = a.status !== 'running';
    const detail = markStarting
      ? `远程连接正常 (${probe.latencyMs}ms)`
      : a.statusDetail;
    const latency = markStarting ? probe.latencyMs : a.remoteLatencyMs;
    const latencyChanged =
      markStarting && a.remoteLatencyMs !== probe.latencyMs;
    const canUseChanged =
      Boolean(a.capabilities?.canUseInternalMemory) !== targetCanUseMemory;
    const healthChanged = a.isModelHealthy !== true;

    if (
      !capabilityChanged &&
      !loadChanged &&
      !resumeChanged &&
      !statusChanged &&
      !latencyChanged &&
      !canUseChanged &&
      !healthChanged
    ) {
      return a;
    }

    return {
      ...a,
      status: 'running' as const,
      isModelHealthy: true,
      remoteLatencyMs: latency,
      statusDetail: detail,
      memory: {
        ...a.memory,
        nativeCapability: resolvedNativeCapability,
      },
      capabilities: {
        ...(a.capabilities || {
          canUseInternalMemory: false,
          canAccessWorkspaceFiles: true,
          canExecuteSkills: true,
          canDelegateToSubAgents: true,
          supportsStreaming: true,
        }),
        ...(probe.loadSession !== undefined
          ? { supportsLoadSession: probe.loadSession }
          : {}),
        ...(probe.resumeSession !== undefined
          ? { supportsResumeSession: probe.resumeSession }
          : {}),
        canUseInternalMemory: targetCanUseMemory,
      },
    };
  });
  return { agents: nextAgents, applied: true };
}

export function resetAgentHandshakeCapabilities(
  agent: Agent,
  nextStatus: Agent['status'] = 'idle',
  statusDetail: string | undefined = undefined
): Agent {
  const capabilities = {
    ...(agent.capabilities || {
      canUseInternalMemory: false,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    }),
    canUseInternalMemory: false,
  };
  // Load/resume are initialize handshake results, not stable Agent metadata.
  // They must be re-probed after every process/connection start.
  delete capabilities.supportsLoadSession;
  delete capabilities.supportsResumeSession;
  delete capabilities.loadSession;

  return {
    ...agent,
    status: nextStatus,
    statusDetail,
    memory: {
      ...agent.memory,
      nativeCapability: createUnknownNativeMemoryCapability(),
    },
    capabilities,
  };
}

export function stopAgentRuntimeState(
  agents: Agent[],
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  localSpawnStore?: Map<string, number>
): Agent[] {
  cancelRemoteProbe(store, agentId);
  if (localSpawnStore) {
    cancelLocalSpawn(localSpawnStore, agentId);
  }
  return agents.map((a) =>
    a.id === agentId ? resetAgentHandshakeCapabilities(a, 'idle', undefined) : a
  );
}

export function applyLocalStatusChangeEvent(
  agents: Agent[],
  payload: {
    agent_id: string;
    status: string;
    status_detail?: string | null;
  }
): Agent[] {
  return agents.map((a) => {
    if (a.id !== payload.agent_id) return a;
    const newStatus = (
      payload.status === 'stopped' ? 'idle' : payload.status
    ) as Agent['status'];
    const nextDetail = payload.status_detail || undefined;
    if (
      newStatus === 'idle' ||
      newStatus === 'error' ||
      newStatus === 'auth_required'
    ) {
      return resetAgentHandshakeCapabilities(a, newStatus, nextDetail);
    }
    return {
      ...a,
      status: newStatus,
      statusDetail: nextDetail,
    };
  });
}

export function reconcileLocalAgentsRuntimeStatus(
  agents: Agent[],
  runtimeStatuses: AgentRuntimeStatus[],
  options: { settleUnmatchedStarting?: boolean } = {}
): { agents: Agent[]; changed: boolean } {
  let hasChange = false;
  const next = agents.map((a) => {
    if (a.isRemote || a.acpTransport === 'websocket') {
      return a;
    }
    const match = runtimeStatuses.find((s) => s.agent_id === a.id);
    if (match && match.is_alive) {
      const targetStatus = (
        match.status === 'idle' ? 'idle' : match.status
      ) as Agent['status'];
      const targetDetail = match.status_detail || undefined;
      const isUnavailableStatus =
        targetStatus === 'idle' ||
        targetStatus === 'error' ||
        targetStatus === 'auth_required';
      if (isUnavailableStatus) {
        if (
          a.status !== targetStatus ||
          a.statusDetail !== targetDetail ||
          a.memory.nativeCapability.status !== 'unknown' ||
          Boolean(a.capabilities?.canUseInternalMemory) ||
          a.capabilities?.supportsLoadSession !== undefined ||
          a.capabilities?.supportsResumeSession !== undefined ||
          a.capabilities?.loadSession !== undefined
        ) {
          hasChange = true;
          return resetAgentHandshakeCapabilities(a, targetStatus, targetDetail);
        }
        return a;
      }
      const remoteSupportsLoad =
        match.supportsLoadSession ?? match.supports_load_session;
      const remoteSupportsResume =
        match.supportsResumeSession ?? match.supports_resume_session;
      const nativeMemory = match.nativeMemory ?? match.native_memory;
      const hasLoadChanged =
        remoteSupportsLoad !== undefined &&
        remoteSupportsLoad !== null &&
        a.capabilities?.supportsLoadSession !== remoteSupportsLoad;
      const hasResumeChanged =
        remoteSupportsResume !== undefined &&
        remoteSupportsResume !== null &&
        a.capabilities?.supportsResumeSession !== remoteSupportsResume;
      const currentCap = a.memory.nativeCapability;
      const hasMemoryChanged =
        Boolean(nativeMemory) &&
        nativeMemoryCapabilityChanged(currentCap, nativeMemory);
      const targetCanUseMemory = Boolean(
        !isUnavailableStatus &&
          a.memory.mode === 'native' &&
          (nativeMemory ? nativeMemory.status : currentCap.status) === 'enabled'
      );
      const hasCanUseMemoryChanged =
        Boolean(a.capabilities?.canUseInternalMemory) !== targetCanUseMemory;
      if (
        a.status !== targetStatus ||
        a.statusDetail !== targetDetail ||
        hasLoadChanged ||
        hasResumeChanged ||
        hasMemoryChanged ||
        hasCanUseMemoryChanged
      ) {
        hasChange = true;
        return {
          ...a,
          status: targetStatus,
          statusDetail: targetDetail,
          memory: nativeMemory
            ? {
                ...a.memory,
                nativeCapability: nativeMemory,
              }
            : a.memory,
          capabilities: {
            ...(a.capabilities || {
              canUseInternalMemory: false,
              canAccessWorkspaceFiles: true,
              canExecuteSkills: true,
              canDelegateToSubAgents: true,
              supportsStreaming: true,
            }),
            ...(remoteSupportsLoad !== undefined && remoteSupportsLoad !== null
              ? { supportsLoadSession: remoteSupportsLoad }
              : {}),
            ...(remoteSupportsResume !== undefined &&
            remoteSupportsResume !== null
              ? { supportsResumeSession: remoteSupportsResume }
              : {}),
            canUseInternalMemory: targetCanUseMemory,
          },
        };
      }
      return a;
    }

    // If not in active backend pool, revert to idle + unknown capability if not currently starting.
    // Even if `acp:status_change` already transitioned `status` to `'idle'`, any residual
    // `nativeCapability` or `canUseInternalMemory` from the exited process must be cleared.
    if (
      (a.status !== 'starting' || options.settleUnmatchedStarting === true) &&
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
  return { agents: hasChange ? next : agents, changed: hasChange };
}

export function resolveSavedAgentNativeMemoryState(options: {
  isEditMode: boolean;
  isRemoteMode: boolean;
  wasOnline: boolean;
  nativeMemoryEnabled: boolean;
  nativeMemoryAutoGenerate: boolean;
  healthCheck?: {
    ok: boolean;
    loadSession?: boolean;
    resumeSession?: boolean;
    nativeMemory?: AcpNativeMemoryCapability;
  } | null;
}): {
  status: 'running' | 'error' | 'idle';
  mode: 'native' | 'disabled';
  autoGenerate: boolean;
  nativeCapability: AcpNativeMemoryCapability;
  canUseInternalMemory: boolean;
  supportsLoadSession?: boolean;
  supportsResumeSession?: boolean;
} {
  const mode = options.nativeMemoryEnabled ? 'native' : 'disabled';
  const autoGenerate =
    options.nativeMemoryEnabled && options.nativeMemoryAutoGenerate;
  const isVerifiedOnlineRemote =
    options.isEditMode &&
    options.isRemoteMode &&
    options.wasOnline &&
    Boolean(options.healthCheck?.ok);
  const status: 'running' | 'error' | 'idle' =
    options.isEditMode && options.isRemoteMode && options.wasOnline
      ? options.healthCheck?.ok
        ? 'running'
        : 'error'
      : 'idle';
  const nativeCapability =
    isVerifiedOnlineRemote && options.healthCheck?.nativeMemory
      ? options.healthCheck.nativeMemory
      : createUnknownNativeMemoryCapability();
  const canUseInternalMemory =
    options.nativeMemoryEnabled && nativeCapability.status === 'enabled';
  const supportsLoadSession =
    isVerifiedOnlineRemote && options.healthCheck?.loadSession !== undefined
      ? options.healthCheck.loadSession
      : undefined;
  const supportsResumeSession =
    isVerifiedOnlineRemote && options.healthCheck?.resumeSession !== undefined
      ? options.healthCheck.resumeSession
      : undefined;
  return {
    status,
    mode,
    autoGenerate,
    nativeCapability,
    canUseInternalMemory,
    supportsLoadSession,
    supportsResumeSession,
  };
}

export function applyPromptNativeMemoryCapability(
  agents: Agent[],
  agentId: string,
  capability: AcpNativeMemoryCapability | null | undefined
): Agent[] {
  if (!capability || capability.status === 'unknown') {
    return agents;
  }
  return agents.map((a) => {
    if (a.id !== agentId || !isAgentActivelyRunning(a)) return a;
    const targetCanUseMemory =
      a.memory.mode === 'native' && capability.status === 'enabled';
    if (
      !nativeMemoryCapabilityChanged(a.memory.nativeCapability, capability) &&
      Boolean(a.capabilities?.canUseInternalMemory) === targetCanUseMemory
    ) {
      return a;
    }
    return {
      ...a,
      memory: {
        ...a.memory,
        nativeCapability: capability,
      },
      capabilities: {
        ...(a.capabilities || {
          canUseInternalMemory: false,
          canAccessWorkspaceFiles: true,
          canExecuteSkills: true,
          canDelegateToSubAgents: true,
          supportsStreaming: true,
        }),
        canUseInternalMemory: targetCanUseMemory,
      },
    };
  });
}
