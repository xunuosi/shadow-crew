import {
  AcpNativeMemoryCapability,
  Agent,
  AgentMemoryBank,
} from '../types';

export const AGENT_MEMORY_SCHEMA_VERSION = 1 as const;
export const ACP_NATIVE_MEMORY_ENV = 'SHADOW_CREW_ACP_NATIVE_MEMORY';
export const ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV =
  'SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE';
export const ENDPOINT_MANAGED_MEMORY_HINT = '由 ACP 端点管理';

export function createUnknownNativeMemoryCapability(): AcpNativeMemoryCapability {
  return {
    status: 'unknown',
    persistent: null,
    crossThread: null,
    provider: null,
    scope: 'unknown',
    detail: '等待 ACP 端点握手声明',
  };
}

export function createAgentMemoryBank(
  mode: AgentMemoryBank['mode'] = 'native',
  autoGenerate = false
): AgentMemoryBank {
  return {
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    mode,
    autoGenerate: mode === 'native' && autoGenerate,
    nativeCapability: createUnknownNativeMemoryCapability(),
    internalMemoryPath: ENDPOINT_MANAGED_MEMORY_HINT,
    persistentType: 'sqlite',
    persistentItems: [],
    sessionCacheCount: 0,
    cartridges: [],
  };
}

/**
 * 集中迁移旧 Agent JSON。旧数据没有原生记忆策略，统一视为端点管理的 native 模式；
 * 握手后若端点未声明能力，UI 会显示 unknown，而不是把默认值当成已验证结果。
 */
export function migrateAgentMemoryV1(input: Agent): {
  agent: Agent;
  changed: boolean;
} {
  const existing = input.memory as Partial<AgentMemoryBank> | undefined;
  const existingPath = typeof existing?.internalMemoryPath === 'string'
    ? existing.internalMemoryPath.trim()
    : '';
  const pathNeedsRefresh =
    !existingPath ||
    existingPath.includes('.local/share') ||
    existingPath.includes('.shinobi') ||
    /^~\/\.shadow-crew\/.+_memory\.sqlite$/.test(existingPath);
  const mode = existing?.mode === 'disabled' ? 'disabled' : 'native';
  const autoGenerate = mode === 'native' && existing?.autoGenerate === true;
  // A hydrated Agent has no verified runtime process yet. Persisted handshake
  // capabilities are diagnostics from a previous process and must not be
  // treated as current truth after reload.
  const nativeCapability = createUnknownNativeMemoryCapability();
  const existingCapabilities = input.capabilities || {
    canUseInternalMemory: false,
    canAccessWorkspaceFiles: true,
    canExecuteSkills: false,
    canDelegateToSubAgents: false,
    supportsStreaming: true,
  };

  const migratedBank: AgentMemoryBank = {
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    mode,
    autoGenerate,
    nativeCapability,
    internalMemoryPath: pathNeedsRefresh
      ? ENDPOINT_MANAGED_MEMORY_HINT
      : existingPath,
    persistentType: existing?.persistentType || 'sqlite',
    persistentItems: Array.isArray(existing?.persistentItems)
      ? existing.persistentItems
      : [],
    sessionCacheCount:
      typeof existing?.sessionCacheCount === 'number'
        ? existing.sessionCacheCount
        : 0,
    cartridges: Array.isArray(existing?.cartridges)
      ? existing.cartridges
      : [],
  };

  const changed =
    existing?.schemaVersion !== AGENT_MEMORY_SCHEMA_VERSION ||
    existing?.mode !== mode ||
    existing?.autoGenerate !== autoGenerate ||
    existing?.internalMemoryPath !== migratedBank.internalMemoryPath ||
    existing?.nativeCapability?.status !== nativeCapability.status ||
    existingCapabilities.canUseInternalMemory !==
      (mode === 'native' && nativeCapability.status === 'enabled');

  return {
    agent: {
      ...input,
      memory: migratedBank,
      capabilities: {
        ...existingCapabilities,
        canUseInternalMemory:
          mode === 'native' && nativeCapability.status === 'enabled',
      },
    },
    changed,
  };
}

/**
 * Normalizes a persisted Agent before it enters the live workspace. Process
 * status and handshake capabilities are runtime facts, never durable config.
 */
export function normalizeHydratedAgent(input: Agent): {
  agent: Agent;
  changed: boolean;
} {
  const migrated = migrateAgentMemoryV1(input);
  const nextCapabilities = {
    ...(migrated.agent.capabilities || {
      canUseInternalMemory: false,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: false,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    }),
    canUseInternalMemory: false,
  };
  const hadHandshakeSessionCaps =
    nextCapabilities.supportsLoadSession !== undefined ||
    nextCapabilities.supportsResumeSession !== undefined ||
    nextCapabilities.loadSession !== undefined;
  delete nextCapabilities.supportsLoadSession;
  delete nextCapabilities.supportsResumeSession;
  delete nextCapabilities.loadSession;

  const runtimeStateChanged =
    input.status !== 'idle' ||
    input.statusDetail !== undefined ||
    hadHandshakeSessionCaps;
  return {
    agent: {
      ...migrated.agent,
      status: 'idle',
      statusDetail: undefined,
      capabilities: nextCapabilities,
    },
    changed: migrated.changed || runtimeStateChanged,
  };
}

/** 解析 ACP initialize 的可选 agentCapabilities.nativeMemory 扩展。 */
export function parseNativeMemoryCapability(
  result: unknown
): AcpNativeMemoryCapability {
  const unknown: AcpNativeMemoryCapability = {
    ...createUnknownNativeMemoryCapability(),
    detail: 'ACP 端点未声明 nativeMemory 扩展',
    lastCheckedAt: Date.now(),
  };
  if (!result || typeof result !== 'object') return unknown;

  const capabilities = (result as { agentCapabilities?: unknown }).agentCapabilities;
  if (!capabilities || typeof capabilities !== 'object') return unknown;

  const raw = (capabilities as { nativeMemory?: unknown }).nativeMemory;
  if (!raw || typeof raw !== 'object') return unknown;

  const value = raw as Record<string, unknown>;
  let status: AcpNativeMemoryCapability['status'] = 'unknown';
  if (value.supported === false) {
    status = 'unsupported';
  } else if (value.supported === true && value.enabled === false) {
    status = 'disabled';
  } else if (value.supported === true && value.enabled === true) {
    status = 'enabled';
  }

  const rawScope = typeof value.scope === 'string' ? value.scope : 'unknown';
  const scope: AcpNativeMemoryCapability['scope'] =
    rawScope === 'agent' ||
    rawScope === 'workspace' ||
    rawScope === 'runtime'
      ? rawScope
      : 'unknown';

  return {
    status,
    persistent: typeof value.persistent === 'boolean' ? value.persistent : null,
    crossThread: typeof value.crossThread === 'boolean' ? value.crossThread : null,
    provider: typeof value.provider === 'string' ? value.provider : null,
    scope,
    detail:
      typeof value.detail === 'string'
        ? value.detail
        : status === 'unknown'
          ? 'ACP 端点 nativeMemory 声明缺少有效的 supported/enabled 布尔字段'
          : null,
    lastCheckedAt: Date.now(),
  };
}
