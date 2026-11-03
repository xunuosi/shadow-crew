export interface RemoteProbeLease {
  generation: number;
  inFlight: boolean;
  lastAttemptAt: number;
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

export function shouldRefreshRemoteProbe(
  store: Map<string, RemoteProbeLease>,
  agentId: string,
  refreshMs: number,
  now = Date.now()
): boolean {
  const lease = getRemoteProbeLease(store, agentId);
  return !lease.inFlight && now - lease.lastAttemptAt >= refreshMs;
}
