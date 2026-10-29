import assert from 'node:assert/strict';
import { Channel, Message, WorkspaceBinding } from '../types';
import { buildAgentSessionKey, parseSessionKey } from './acpClient';
import {
  createChannelBinding,
  createTopicBinding,
  createDmTopicBinding,
  getDefaultDmTopicCwd,
  migrateWorkspaceGraph,
} from './workspaceBindings';

const channelBinding = createChannelBinding({
  channelId: 'channel-1',
  mode: 'default',
  createdAt: 1,
});
assert.equal(channelBinding.cwd, '~/.shadow-crew/channels/channel-1');
assert.equal(channelBinding.artifactRoot, '~/.shadow-crew/channels/channel-1/artifacts');

const topicBinding = createTopicBinding({
  topicId: 'topic-1',
  channelId: 'channel-1',
  mode: 'default',
  channelBinding,
  createdAt: 2,
});
assert.equal(topicBinding.cwd, '~/.shadow-crew/channels/channel-1/topics/topic-1');
assert.equal(
  topicBinding.artifactRoot,
  '~/.shadow-crew/channels/channel-1/topics/topic-1/artifacts'
);

const snapshotBinding = createTopicBinding({
  topicId: 'topic-2',
  channelId: 'channel-1',
  mode: 'channel_snapshot',
  channelBinding,
});
assert.equal(snapshotBinding.cwd, channelBinding.cwd);

const legacyChannel = {
  id: 'channel-legacy',
  workspaceBindingId: 'ws-channel-channel-legacy',
  creatorId: 'user-1',
  name: 'legacy',
  status: 'active',
  description: '',
  isPrivate: true,
  iconName: 'Hash',
  unreadCount: 0,
  assignedAgentIds: [],
  memberIds: ['user-1'],
  mountedWorkspace: { rootPath: '/tmp/legacy-channel' },
} as unknown as Channel;

const legacyTopicMessage = {
  id: 'msg-topic',
  threadId: 'thread-legacy',
  channelId: 'channel-legacy',
  type: 'topic',
  topicData: {
    id: 'topic-legacy',
    channelId: 'channel-legacy',
    workspaceBindingId: '',
    title: 'Legacy topic',
    status: 'open',
    authorId: 'user-1',
    authorName: 'User',
    authorAvatar: 'U',
    timestamp: 'now',
    repliesCount: 0,
    participatingAgentIds: [],
  },
  authorId: 'user-1',
  authorName: 'User',
  authorHandle: '@user',
  authorAvatar: 'U',
  isAgent: false,
  timestamp: 'now',
  content: '',
} as unknown as Message;

const migrated = migrateWorkspaceGraph(
  [legacyChannel],
  { 'thread-legacy': [legacyTopicMessage] },
  []
);
assert.equal(migrated.changed, true);
assert.equal('mountedWorkspace' in (migrated.channels[0] as any), false);

const migratedTopicBinding = migrated.workspaceBindings.find(
  (binding) => binding.ownerType === 'topic' && binding.ownerId === 'topic-legacy'
);
assert(migratedTopicBinding);
assert.equal(migratedTopicBinding?.origin, 'legacy_channel_cwd_snapshot');
assert.equal(migratedTopicBinding?.cwd, '/tmp/legacy-channel');

const sessionKey = buildAgentSessionKey({
  agentId: 'agent-1',
  roomId: 'topic-1',
  channelId: 'channel-1',
  discussionMode: 'standard',
  workspaceBindingId: topicBinding.id,
  scopeType: 'topic',
});
const parsed = parseSessionKey(sessionKey);
assert.equal(parsed.type, 'topic');
assert.equal(parsed.agentId, 'agent-1');
assert.equal(parsed.workspaceBindingId, topicBinding.id);

const channelSessionKey = buildAgentSessionKey({
  agentId: 'agent-1',
  roomId: 'thread-channel-1',
  channelId: 'channel-1',
  workspaceBindingId: channelBinding.id,
  scopeType: 'channel',
});
assert.equal(parseSessionKey(channelSessionKey).type, 'channel');

const dmTopicCwd = getDefaultDmTopicCwd('agent-1', 'dm-topic-1');
assert.equal(dmTopicCwd, '~/.shadow-crew/agents/agent-1/topics/dm-topic-1');
const dmTopicBinding = createDmTopicBinding({
  topicId: 'dm-topic-1',
  agentId: 'agent-1',
  mode: 'default',
});
assert.equal(dmTopicBinding.cwd, dmTopicCwd);
const dmTopicKey = buildAgentSessionKey({
  agentId: 'agent-1',
  roomId: 'dm-topic-1',
  workspaceBindingId: dmTopicBinding.id,
  discussionMode: 'game_theoretic',
  scopeType: 'dm_topic',
});
const parsedDmTopic = parseSessionKey(dmTopicKey);
assert.equal(parsedDmTopic.type, 'dm_topic');
assert.equal(parsedDmTopic.agentId, 'agent-1');
assert.equal(parsedDmTopic.workspaceBindingId, dmTopicBinding.id);

const bindings: WorkspaceBinding[] = [channelBinding, topicBinding, snapshotBinding];
assert.equal(new Set(bindings.map((binding) => binding.cwd)).size >= 2, true);

console.log('Workspace Binding regression suite passed (8 assertions groups).');
