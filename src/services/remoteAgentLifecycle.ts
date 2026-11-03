import { AcpNativeMemoryCapability, Agent } from '../types';
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
      ? {
          ...a,
          status: 'starting',
          statusDetail: '连接远程 ACP 节点中...',
        }
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
            ...a,
            status: 'error' as const,
            isModelHealthy: false,
            statusDetail: probe.error || '远程连接失败',
            memory: {
              ...a.memory,
              nativeCapability: createUnknownNativeMemoryCapability(),
            },
            capabilities: {
              ...(a.capabilities || {
                canUseInternalMemory: false,
                canAccessWorkspaceFiles: true,
                canExecuteSkills: true,
                canDelegateToSubAgents: true,
                supportsStreaming: true,
              }),
              canUseInternalMemory: false,
            },
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

    if (
      !capabilityChanged &&
      !loadChanged &&
      !resumeChanged &&
      !statusChanged &&
      !latencyChanged &&
      !canUseChanged
    ) {
      return a;
    }

    return {
      ...a,
      status: 'running' as const,
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

export function stopAgentRuntimeState(
  agents: Agent[],
  store: Map<string, RemoteProbeLease>,
  agentId: string
): Agent[] {
  cancelRemoteProbe(store, agentId);
  return agents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          status: 'idle',
          statusDetail: undefined,
          memory: {
            ...a.memory,
            nativeCapability: createUnknownNativeMemoryCapability(),
          },
          capabilities: {
            ...(a.capabilities || {
              canUseInternalMemory: false,
              canAccessWorkspaceFiles: true,
              canExecuteSkills: true,
              canDelegateToSubAgents: true,
              supportsStreaming: true,
            }),
            canUseInternalMemory: false,
          },
        }
      : a
  );
}
