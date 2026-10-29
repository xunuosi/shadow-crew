import { Channel, DuelRolesConfig, Message, WorkspaceBinding } from '../types';

export const WORKSPACE_HOME = '~/.shadow-crew';
export const WORKSPACE_BINDING_SCHEMA_VERSION = 1;

export function getDefaultChannelCwd(channelId: string): string {
  return `${WORKSPACE_HOME}/channels/${channelId}`;
}

export function getDefaultTopicCwd(channelId: string, topicId: string): string {
  return `${getDefaultChannelCwd(channelId)}/topics/${topicId}`;
}

export function getDefaultDmTopicCwd(agentId: string, topicId: string): string {
  return `${WORKSPACE_HOME}/agents/${agentId}/topics/${topicId}`;
}

export function getDefaultArtifactRoot(cwd: string): string {
  return `${cwd.replace(/\/+$/, '')}/artifacts`;
}

export function normalizeWorkspaceCwd(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('工作目录不能为空');
  }
  return trimmed.replace(/\/+$/, '') || '/';
}

export function normalizeDuelRoles(roles: DuelRolesConfig): DuelRolesConfig {
  if (roles.proposer === 'human' && roles.challenger === 'agent') {
    return { proposer: 'human', challenger: 'agent' };
  }
  if (roles.proposer === 'agent' && roles.challenger === 'human') {
    return { proposer: 'agent', challenger: 'human' };
  }
  throw new Error('私聊双方博弈必须由人类和 Agent 各担任一个角色');
}

export function createChannelBinding(options: {
  channelId: string;
  mode: 'default' | 'custom';
  cwd?: string;
  createdAt?: number;
}): WorkspaceBinding {
  const cwd = normalizeWorkspaceCwd(
    options.cwd || (options.mode === 'default' ? getDefaultChannelCwd(options.channelId) : '')
  );
  return {
    id: `ws-channel-${options.channelId}`,
    ownerType: 'channel',
    ownerId: options.channelId,
    mode: options.mode,
    origin: options.mode === 'default' ? 'created_default' : 'created_custom',
    cwd,
    artifactRoot: options.mode === 'default'
      ? getDefaultArtifactRoot(cwd)
      : `${cwd}/.shadow-crew/channels/${options.channelId}/artifacts`,
    createdAt: options.createdAt ?? Date.now(),
  };
}

export function createTopicBinding(options: {
  topicId: string;
  channelId: string;
  mode: 'default' | 'channel_snapshot' | 'custom';
  channelBinding: WorkspaceBinding;
  cwd?: string;
  createdAt?: number;
}): WorkspaceBinding {
  if (options.mode === 'default') {
    const cwd = normalizeWorkspaceCwd(
      options.cwd || getDefaultTopicCwd(options.channelId, options.topicId)
    );
    return {
      id: `ws-topic-${options.topicId}`,
      ownerType: 'topic',
      ownerId: options.topicId,
      mode: 'default',
      origin: 'created_default',
      cwd,
      artifactRoot: getDefaultArtifactRoot(cwd),
      createdAt: options.createdAt ?? Date.now(),
    };
  }

  if (options.mode === 'channel_snapshot') {
    return {
      id: `ws-topic-${options.topicId}`,
      ownerType: 'topic',
      ownerId: options.topicId,
      mode: 'custom',
      origin: 'channel_cwd_snapshot',
      cwd: options.channelBinding.cwd,
      artifactRoot: `${options.channelBinding.cwd}/.shadow-crew/channels/${options.channelId}/topics/${options.topicId}/artifacts`,
      createdAt: options.createdAt ?? Date.now(),
    };
  }

  const cwd = normalizeWorkspaceCwd(options.cwd || '');
  return {
    id: `ws-topic-${options.topicId}`,
    ownerType: 'topic',
    ownerId: options.topicId,
    mode: 'custom',
    origin: 'created_custom',
    cwd,
    artifactRoot: `${cwd}/.shadow-crew/channels/${options.channelId}/topics/${options.topicId}/artifacts`,
    createdAt: options.createdAt ?? Date.now(),
  };
}

export function createDmTopicBinding(options: {
  topicId: string;
  agentId: string;
  mode: 'default' | 'agent_snapshot' | 'custom';
  agentBinding?: WorkspaceBinding;
  cwd?: string;
  createdAt?: number;
}): WorkspaceBinding {
  if (options.mode === 'default') {
    const cwd = normalizeWorkspaceCwd(
      options.cwd || getDefaultDmTopicCwd(options.agentId, options.topicId)
    );
    return {
      id: `ws-topic-${options.topicId}`,
      ownerType: 'topic',
      ownerId: options.topicId,
      mode: 'default',
      origin: 'created_default',
      cwd,
      artifactRoot: getDefaultArtifactRoot(cwd),
      createdAt: options.createdAt ?? Date.now(),
    };
  }

  if (options.mode === 'agent_snapshot') {
    const agentCwd =
      options.cwd ||
      options.agentBinding?.cwd ||
      `${WORKSPACE_HOME}/agents/${options.agentId}`;
    return {
      id: `ws-topic-${options.topicId}`,
      ownerType: 'topic',
      ownerId: options.topicId,
      mode: 'custom',
      origin: 'channel_cwd_snapshot',
      cwd: agentCwd,
      artifactRoot: `${agentCwd}/.shadow-crew/agents/${options.agentId}/topics/${options.topicId}/artifacts`,
      createdAt: options.createdAt ?? Date.now(),
    };
  }

  const cwd = normalizeWorkspaceCwd(options.cwd || '');
  return {
    id: `ws-topic-${options.topicId}`,
    ownerType: 'topic',
    ownerId: options.topicId,
    mode: 'custom',
    origin: 'created_custom',
    cwd,
    artifactRoot: `${cwd}/.shadow-crew/agents/${options.agentId}/topics/${options.topicId}/artifacts`,
    createdAt: options.createdAt ?? Date.now(),
  };
}

function bindingKey(ownerType: WorkspaceBinding['ownerType'], ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

export interface WorkspaceGraphMigrationResult {
  channels: Channel[];
  messages: Record<string, Message[]>;
  workspaceBindings: WorkspaceBinding[];
  changed: boolean;
}

/**
 * 显式版本迁移：旧 Channel 使用当时 mountedWorkspace；旧 Topic 使用 Channel cwd 快照。
 * 新建 Topic 不经过此函数，而是使用 topics/<topicId> 默认绑定。
 */
export function migrateWorkspaceGraph(
  inputChannels: Channel[],
  inputMessages: Record<string, Message[]>,
  inputBindings: WorkspaceBinding[]
): WorkspaceGraphMigrationResult {
  let changed = false;
  const bindings = [...inputBindings];
  const bindingMap = new Map(
    bindings.map((binding) => [bindingKey(binding.ownerType, binding.ownerId), binding])
  );
  const channelBindingMap = new Map<string, WorkspaceBinding>();

  const channels = inputChannels.map((channel) => {
    const ownerKey = bindingKey('channel', channel.id);
    let binding = bindingMap.get(ownerKey);
    const legacyCwd = (channel as Channel & {
      mountedWorkspace?: { rootPath?: string };
    }).mountedWorkspace?.rootPath;

    if (!binding) {
      const cwd = legacyCwd || getDefaultChannelCwd(channel.id);
      binding = {
        id: channel.workspaceBindingId || `ws-channel-${channel.id}`,
        ownerType: 'channel',
        ownerId: channel.id,
        mode: legacyCwd ? 'custom' : 'default',
        origin: legacyCwd ? 'created_custom' : 'created_default',
        cwd,
        artifactRoot: getDefaultArtifactRoot(cwd),
        createdAt: channel.createdAt ?? Date.now(),
      };
      bindings.push(binding);
      bindingMap.set(ownerKey, binding);
      changed = true;
    }

    channelBindingMap.set(channel.id, binding);
    if (channel.workspaceBindingId !== binding.id) {
      changed = true;
    }
    const migratedChannel = { ...channel, workspaceBindingId: binding.id } as Channel & {
      mountedWorkspace?: unknown;
    };
    if ('mountedWorkspace' in migratedChannel) {
      delete migratedChannel.mountedWorkspace;
      changed = true;
    }
    return migratedChannel;
  });

  const messages = Object.fromEntries(
    Object.entries(inputMessages).map(([threadId, threadMessages]) => [
      threadId,
      threadMessages.map((message) => {
        if (!message.topicData) return message;

        const topicId = message.topicData.id;
        const topicScopeType = message.topicData.scopeType || 'channel';
        const topicOwnerKey = bindingKey('topic', topicId);
        let topicBinding = bindingMap.get(topicOwnerKey);
        if (!topicBinding) {
          const channelBinding = channelBindingMap.get(message.topicData.channelId || '');
          if (!channelBinding) {
            throw new Error(
              `Cannot migrate Topic ${topicId}: Channel ${message.topicData.channelId || '(none)'} has no Workspace Binding`
            );
          }
          topicBinding = {
            id: message.topicData.workspaceBindingId || `ws-topic-${topicId}`,
            ownerType: 'topic',
            ownerId: topicId,
            mode: 'custom',
            origin: 'legacy_channel_cwd_snapshot',
            cwd: channelBinding.cwd,
            artifactRoot: `${channelBinding.artifactRoot.replace(/\/+$/, '')}/${topicId}`,
            createdAt: channelBinding.createdAt,
          };
          bindings.push(topicBinding);
          bindingMap.set(topicOwnerKey, topicBinding);
          changed = true;
        }

        if (message.topicData.workspaceBindingId === topicBinding.id) {
          return message;
        }
        changed = true;
        return {
          ...message,
          topicData: {
            ...message.topicData,
            scopeType: topicScopeType,
            workspaceBindingId: topicBinding.id,
          },
        };
      }),
    ])
  );

  return { channels, messages, workspaceBindings: bindings, changed };
}

export function findWorkspaceBinding(
  bindings: WorkspaceBinding[],
  ownerType: WorkspaceBinding['ownerType'],
  ownerId: string | undefined
): WorkspaceBinding | undefined {
  if (!ownerId) return undefined;
  return bindings.find(
    (binding) => binding.ownerType === ownerType && binding.ownerId === ownerId
  );
}
