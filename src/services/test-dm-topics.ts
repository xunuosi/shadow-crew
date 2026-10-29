import assert from 'node:assert/strict';
import { DuelRolesConfig } from '../types';
import { buildAgentSessionKey, matchesSessionScope, parseSessionKey } from './acpClient';
import {
  createDmTopicBinding,
  getDefaultDmTopicCwd,
  normalizeDuelRoles,
} from './workspaceBindings';

let passed = 0;

function check(condition: boolean, label: string): void {
  assert(condition, label);
  passed += 1;
}

const agentId = 'agent-dm-1';
const topicA = 'topic-dm-a';
const topicB = 'topic-dm-b';

const expectedTopicACwd = `~/.shadow-crew/agents/${agentId}/topics/${topicA}`;
check(
  getDefaultDmTopicCwd(agentId, topicA) === expectedTopicACwd,
  'DM Topic 默认 cwd 必须使用 agents/<agentId>/topics/<topicId>'
);

const defaultBinding = createDmTopicBinding({
  topicId: topicA,
  agentId,
  mode: 'default',
  createdAt: 10,
});
check(defaultBinding.cwd === expectedTopicACwd, '默认 DM Topic Binding 使用规范路径');
check(
  defaultBinding.artifactRoot === `${expectedTopicACwd}/artifacts`,
  '默认 DM Topic 产物目录固定为自身 artifacts'
);
check(
  defaultBinding.ownerType === 'topic' && defaultBinding.ownerId === topicA,
  'DM Topic Binding 必须归属 topic owner，而非伪造 channel'
);

const customBinding = createDmTopicBinding({
  topicId: topicB,
  agentId,
  mode: 'custom',
  cwd: '/tmp/dm-custom-worktree/',
});
check(customBinding.cwd === '/tmp/dm-custom-worktree', '自定义 DM Topic cwd 会规范化尾部斜杠');
check(
  customBinding.artifactRoot ===
    `/tmp/dm-custom-worktree/.shadow-crew/agents/${agentId}/topics/${topicB}/artifacts`,
  '自定义 DM Topic 产物仍按 Agent + Topic 命名空间隔离'
);

const snapshotBinding = createDmTopicBinding({
  topicId: 'topic-dm-snapshot',
  agentId,
  mode: 'agent_snapshot',
  cwd: '/tmp/dm-agent-current',
});
check(snapshotBinding.cwd === '/tmp/dm-agent-current', 'DM Topic 可复制当前私聊 cwd 快照');
check(
  snapshotBinding.artifactRoot ===
    `/tmp/dm-agent-current/.shadow-crew/agents/${agentId}/topics/topic-dm-snapshot/artifacts`,
  'cwd 快照仍拥有独立 Topic 产物命名空间'
);

const dmMainKey = buildAgentSessionKey({
  agentId,
  roomId: 'thread-dm-agent-dm-1',
  scopeType: 'dm',
});
const dmTopicAKey = buildAgentSessionKey({
  agentId,
  roomId: topicA,
  discussionMode: 'standard',
  workspaceBindingId: defaultBinding.id,
  scopeType: 'dm_topic',
});
const dmTopicBKey = buildAgentSessionKey({
  agentId,
  roomId: topicB,
  discussionMode: 'game_theoretic',
  workspaceBindingId: customBinding.id,
  scopeType: 'dm_topic',
});

check(new Set([dmMainKey, dmTopicAKey, dmTopicBKey]).size === 3, '私聊主会话与两个 DM Topic 使用三个独立 Session Key');
check(dmMainKey.startsWith('dm:'), '私聊主会话保留 dm 命名空间');
check(dmTopicAKey.startsWith('dmtopic:'), 'DM Topic 使用独立 dmtopic 命名空间');

const parsedTopic = parseSessionKey(dmTopicBKey);
check(parsedTopic.type === 'dm_topic', 'DM Topic Session Key 可稳定解析为 dm_topic');
check(parsedTopic.agentId === agentId, 'DM Topic 解析保留归属 Agent');
check(parsedTopic.roomId === topicB, 'DM Topic 解析保留 Topic ID');
check(parsedTopic.discussionMode === 'game_theoretic', 'DM Topic 解析保留讨论模式');
check(parsedTopic.workspaceBindingId === customBinding.id, 'DM Topic 解析保留 Workspace Binding');
check(
  matchesSessionScope(dmTopicAKey, { agentId }),
  '按 Agent 清理可覆盖其 DM Topic Session'
);

const humanProposer = normalizeDuelRoles({
  proposer: 'human',
  challenger: 'agent',
});
check(
  humanProposer.proposer === 'human' && humanProposer.challenger === 'agent',
  '合法双方角色组合 A：人类提案 / Agent 对抗'
);

const agentProposer = normalizeDuelRoles({
  proposer: 'agent',
  challenger: 'human',
});
check(
  agentProposer.proposer === 'agent' && agentProposer.challenger === 'human',
  '合法双方角色组合 B：Agent 提案 / 人类对抗'
);

assert.throws(
  () =>
    normalizeDuelRoles({
      proposer: 'agent',
      challenger: 'agent',
    } as unknown as DuelRolesConfig),
  /人类和 Agent/,
  '双方角色不能由同一参与方重复担任'
);
passed += 1;

console.log(`DM Topic regression suite passed (${passed} assertions).`);
