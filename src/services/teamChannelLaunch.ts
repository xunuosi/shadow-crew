import type {
  Agent,
  AgentTeam,
  Channel,
  Message,
  Thread,
  WorkspaceBinding,
} from '../types';
import { createChannelBinding } from './workspaceBindings';

/**
 * 编队专属频道的确定性 ID 前缀。
 *
 * 编队「开聊」不再往当前频道里塞匿名线程（旧实现每次 Date.now() 新建线程并抢占
 * activeThreadId，导致频道原主线程无法再被访问，观感上等同于频道被覆盖），
 * 而是为每个编队建立唯一的独立频道。
 */
export const TEAM_CHANNEL_ID_PREFIX = 'channel-team-';

export const TEAM_CHANNEL_CREATOR = {
  id: 'user-norris',
  name: 'Norris_M5Pro',
  handle: '@Norris_M5Pro',
  avatar: '👨‍💻',
} as const;

/** 编队频道 ID：同一编队恒定，重复「开聊」只会聚焦既有频道而不会堆叠重复频道。 */
export function getTeamChannelId(teamId: string): string {
  return `${TEAM_CHANNEL_ID_PREFIX}${teamId}`;
}

/** 编队线程 ID：一个编队频道对应唯一主线程。 */
export function getTeamThreadId(channelId: string): string {
  return `thread-${channelId}`;
}

/**
 * 只保留真实存在于 Agent 资产库中的编队成员，并按原始顺序去重。
 * 编队快照里可能残留已被删除的 Agent，不能把幽灵 ID 写进频道成员表。
 */
export function resolveTeamAgentIds(team: AgentTeam, agents: Agent[]): string[] {
  const known = new Set(agents.map((agent) => agent.id));
  const resolved: string[] = [];
  for (const agentId of team.agentIds) {
    if (known.has(agentId) && !resolved.includes(agentId)) {
      resolved.push(agentId);
    }
  }
  return resolved;
}

export function getTeamChannelName(team: AgentTeam): string {
  return team.icon ? `${team.icon} ${team.name}` : team.name;
}

/**
 * 构建编队专属频道与其 Workspace Binding（纯函数，不做任何 DOM / 存储副作用）。
 */
export function buildTeamChannel(options: {
  team: AgentTeam;
  agents: Agent[];
  currentUserId?: string;
  cwd: string;
  mode?: 'default' | 'custom';
  createdAt: number;
}): { channel: Channel; binding: WorkspaceBinding } {
  const { team, agents, createdAt } = options;
  const currentUserId = options.currentUserId ?? TEAM_CHANNEL_CREATOR.id;
  const channelId = getTeamChannelId(team.id);
  const assignedAgentIds = resolveTeamAgentIds(team, agents);
  const binding = createChannelBinding({
    channelId,
    mode: options.mode ?? 'default',
    cwd: options.cwd,
    createdAt,
  });

  const memberIds: string[] = [currentUserId];
  for (const agentId of assignedAgentIds) {
    if (!memberIds.includes(agentId)) memberIds.push(agentId);
  }

  const channel: Channel = {
    id: channelId,
    workspaceBindingId: binding.id,
    creatorId: currentUserId,
    name: getTeamChannelName(team),
    kind: 'general',
    status: 'active',
    description: `编队协同频道：${team.description}`,
    topic: team.description,
    isPrivate: false,
    iconName: 'Users',
    unreadCount: 0,
    assignedTeamId: team.id,
    assignedAgentIds,
    memberIds,
    createdAt,
  };

  return { channel, binding };
}

/**
 * 构建编队频道的主线程与「编队就位」欢迎消息（纯函数）。
 */
export function buildTeamChannelThread(options: {
  team: AgentTeam;
  channel: Channel;
  agents: Agent[];
  now: number;
  currentUserId?: string;
}): { thread: Thread; greeting: Message } {
  const { team, channel, agents, now } = options;
  const currentUserId = options.currentUserId ?? TEAM_CHANNEL_CREATOR.id;
  const assignedAgentIds = resolveTeamAgentIds(team, agents);
  const memberNames = assignedAgentIds
    .map((agentId) => agents.find((agent) => agent.id === agentId)?.name)
    .filter((name): name is string => Boolean(name));
  const memberHandles = assignedAgentIds
    .map((agentId) => agents.find((agent) => agent.id === agentId)?.handle)
    .filter((handle): handle is string => Boolean(handle));
  const threadId = getTeamThreadId(channel.id);
  const timestamp = new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const thread: Thread = {
    id: threadId,
    channelId: channel.id,
    channelName: channel.name,
    type: 'thread',
    title: `[${team.name}] 协同攻坚议题`,
    authorId: currentUserId,
    authorName: TEAM_CHANNEL_CREATOR.name,
    authorAvatar: TEAM_CHANNEL_CREATOR.avatar,
    authorHandle: TEAM_CHANNEL_CREATOR.handle,
    timestamp: 'Just now',
    preview: `已由编队【${team.name}】接管此频道。包含成员：${memberNames.join('、') || '暂无可用成员'}。`,
    activeAgentIds: assignedAgentIds,
  };

  const greeting: Message = {
    id: `msg-${now}`,
    threadId,
    channelId: channel.id,
    authorId: currentUserId,
    authorName: TEAM_CHANNEL_CREATOR.name,
    authorHandle: TEAM_CHANNEL_CREATOR.handle,
    authorAvatar: TEAM_CHANNEL_CREATOR.avatar,
    isAgent: false,
    timestamp,
    content: `已召唤编队 **${team.icon || '⚡'} ${team.name}**，并为其建立专属协同频道 **#${channel.name}**！\n编队职责：${team.description}\n协同成员：${memberHandles.join(' ') || '（编队暂无可用成员，请先在 Agents & 编队中接入）'} 已就位。随时可以开启多 Agent 联合作业。`,
  };

  return { thread, greeting };
}
