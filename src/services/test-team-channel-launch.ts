import assert from 'node:assert/strict';
import type { Agent, AgentTeam } from '../types';
import {
  buildTeamChannel,
  buildTeamChannelThread,
  getTeamChannelId,
  getTeamThreadId,
  TEAM_CHANNEL_ID_PREFIX,
} from './teamChannelLaunch';
import { getDefaultChannelCwd } from './workspaceBindings';

/**
 * 规范条目 → 用例映射：
 * S1 编队「开聊」必须产生独立频道，不得写入/复用其他频道的 ID，更不得出现 channel-default 幽灵频道。
 * S2 同一编队的频道与线程 ID 必须确定性可复现，重复开聊只聚焦既有频道（不堆叠重复频道/线程）。
 * S3 频道成员必须来自真实 Agent 资产库，去重且剔除已删除 Agent。
 * S4 频道必须携带合法的 Workspace Binding（default 模式，cwd 落在编队频道目录）。
 * S5 编队频道主线程必须归属该频道，欢迎消息归属该线程与频道。
 */

function makeAgent(id: string, name: string, handle: string): Agent {
  return {
    id,
    name,
    handle,
    avatar: '🥷',
    status: 'idle',
    tags: [],
    modelBadge: 'Local',
  } as unknown as Agent;
}

function makeTeam(overrides: Partial<AgentTeam> = {}): AgentTeam {
  return {
    id: 'team-shadow-crew',
    name: 'Shadow Crew Squad',
    description: '负责端到端攻坚',
    icon: '⚡',
    agentIds: ['agent-a', 'agent-b'],
    color: '#3b82f6',
    ...overrides,
  };
}

const agents = [
  makeAgent('agent-a', 'Alpha', '@alpha'),
  makeAgent('agent-b', 'Beta', '@beta'),
  makeAgent('agent-c', 'Gamma', '@gamma'),
];

const team = makeTeam();
const now = 1_800_000_000_000;

// S1 + S2: 频道 ID 独立且确定
const channelId = getTeamChannelId(team.id);
assert.equal(channelId, `${TEAM_CHANNEL_ID_PREFIX}${team.id}`, 'S2: 频道 ID 必须是 team 前缀+teamId');
assert.equal(getTeamChannelId(team.id), channelId, 'S2: 重复调用必须得到同一频道 ID');
assert.notEqual(channelId, 'channel-default', 'S1: 严禁回退到 channel-default 幽灵频道');
assert.notEqual(
  getTeamChannelId('team-other'),
  channelId,
  'S1: 不同编队必须得到不同频道，互不覆盖'
);
assert.equal(getTeamThreadId(channelId), `thread-${channelId}`, 'S2: 编队线程 ID 必须确定');

// 两次构建必须完全一致（idempotent，重复开聊不会堆叠）
const first = buildTeamChannel({
  team,
  agents,
  currentUserId: 'user-norris',
  cwd: getDefaultChannelCwd(channelId),
  createdAt: now,
});
const second = buildTeamChannel({
  team,
  agents,
  currentUserId: 'user-norris',
  cwd: getDefaultChannelCwd(channelId),
  createdAt: now,
});
assert.deepEqual(first, second, 'S2: 同一编队重复构建必须完全一致');

// S3: 成员来自真实 Agent 资产库
const withGhostAndDuplicate = buildTeamChannel({
  team: makeTeam({ agentIds: ['agent-a', 'agent-a', 'agent-deleted', 'agent-c'] }),
  agents,
  currentUserId: 'user-norris',
  cwd: getDefaultChannelCwd(channelId),
  createdAt: now,
});
assert.deepEqual(
  withGhostAndDuplicate.channel.assignedAgentIds,
  ['agent-a', 'agent-c'],
  'S3: 必须去重并剔除已删除 Agent'
);
assert.deepEqual(
  withGhostAndDuplicate.channel.memberIds,
  ['user-norris', 'agent-a', 'agent-c'],
  'S3: 成员表必须是 creator 优先 + 真实编队成员'
);
assert.equal(withGhostAndDuplicate.channel.assignedTeamId, team.id, 'S1: 频道必须记录所属编队');
assert.equal(withGhostAndDuplicate.channel.status, 'active', 'S1: 新频道必须为 active');
assert.equal(withGhostAndDuplicate.channel.unreadCount, 0, 'S1: 新频道未读必须为 0');
assert.equal(withGhostAndDuplicate.channel.name, '⚡ Shadow Crew Squad', 'S1: 频道名必须携带编队标识');

// S4: Workspace Binding 合法
assert.equal(first.channel.workspaceBindingId, first.binding.id, 'S4: 频道必须绑定 binding');
assert.equal(first.binding.id, `ws-channel-${channelId}`, 'S4: binding ID 必须可确定推导');
assert.equal(first.binding.ownerType, 'channel', 'S4: binding ownerType 必须是 channel');
assert.equal(first.binding.ownerId, channelId, 'S4: binding ownerId 必须是编队频道');
assert.equal(first.binding.mode, 'default', 'S4: 编队频道默认使用 default workspace 模式');
assert.equal(
  first.binding.cwd,
  getDefaultChannelCwd(channelId),
  'S4: binding cwd 必须落在编队频道目录'
);

// S4b: 继承当前频道工作区时，binding 必须忠实记录 custom 模式与既有 cwd
const inheritedCwd = 'D:/goProject/src';
const inherited = buildTeamChannel({
  team,
  agents,
  currentUserId: 'user-norris',
  cwd: inheritedCwd,
  mode: 'custom',
  createdAt: now,
});
assert.equal(inherited.binding.mode, 'custom', 'S4b: 继承频道工作区时必须保持 custom 模式');
assert.equal(inherited.binding.cwd, inheritedCwd, 'S4b: binding cwd 必须等于继承的工作区');
assert.equal(inherited.channel.id, channelId, 'S4b: 继承工作区不影响频道确定性 ID');
assert.equal(inherited.binding.id, `ws-channel-${channelId}`, 'S4b: binding ID 仍按频道确定');

// S5: 线程与欢迎消息归属一致
const { thread, greeting } = buildTeamChannelThread({
  team,
  channel: first.channel,
  agents,
  now,
  currentUserId: 'user-norris',
});
assert.equal(thread.id, getTeamThreadId(channelId), 'S5: 线程 ID 必须确定');
assert.equal(thread.channelId, channelId, 'S5: 线程必须归属编队频道');
assert.equal(thread.channelName, first.channel.name, 'S5: 线程频道名必须与频道一致');
assert.deepEqual(thread.activeAgentIds, ['agent-a', 'agent-b'], 'S5: 线程成员必须等于编队成员');
assert.equal(greeting.threadId, thread.id, 'S5: 欢迎消息必须归属该线程');
assert.equal(greeting.channelId, channelId, 'S5: 欢迎消息必须携带频道 ID');
assert.equal(greeting.id, `msg-${now}`, 'S5: 欢迎消息 ID 必须可由时间戳确定');
assert.ok(greeting.content.includes('Shadow Crew Squad'), 'S5: 欢迎消息必须包含编队名称');
assert.ok(greeting.content.includes('#⚡ Shadow Crew Squad'), 'S5: 欢迎消息必须指明专属频道');
assert.ok(greeting.content.includes('@alpha') && greeting.content.includes('@beta'), 'S5: 欢迎消息必须列出成员 handle');

// 空编队（成员全部缺失）仍须生成可用的独立频道与明确的降级提示
const emptyTeam = buildTeamChannel({
  team: makeTeam({ id: 'team-empty', agentIds: ['agent-gone'] }),
  agents,
  currentUserId: 'user-norris',
  cwd: getDefaultChannelCwd(getTeamChannelId('team-empty')),
  createdAt: now,
});
assert.deepEqual(emptyTeam.channel.assignedAgentIds, [], 'S3: 幽灵成员必须全部剔除');
assert.deepEqual(emptyTeam.channel.memberIds, ['user-norris'], 'S3: 无可用成员时仅保留 creator');
const emptyThread = buildTeamChannelThread({
  team: makeTeam({ id: 'team-empty', agentIds: ['agent-gone'] }),
  channel: emptyTeam.channel,
  agents,
  now,
  currentUserId: 'user-norris',
});
assert.ok(
  emptyThread.greeting.content.includes('暂无可用成员'),
  'S3: 无可用成员时必须给出显式提示而非静默'
);

console.log('✅ team-channel-launch: S1~S5 编队独立频道规范断言全部通过');
