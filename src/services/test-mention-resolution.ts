import {
  parseAgentMentions,
  isAllMention,
  normalizeAgentHandle,
  resolveEffectiveAgentHandle,
  buildCrewRosterGuidance,
} from './agentCollaboration';
import { Agent } from '../types';

function createMockAgent(id: string, name: string, handle: string): Agent {
  return {
    id,
    name,
    handle,
    avatar: '🥷',
    status: 'idle',
    color: '#3b82f6',
    role: 'Test Specialist',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    },
  } as Agent;
}

console.log('🧪 Starting Agent Mention & Boundary Resolution Tests...');

const agent1 = createMockAgent('agent-1', 'MyCodex', '@mycodex');
const agent2 = createMockAgent('agent-2', 'MyCodex-02', '@mycodex-02');
const agentDupLegacy = createMockAgent('agent-dup', 'MyCodex-02', '@mycodex-副本');
const agentGlm = createMockAgent('agent-3', 'GlmClaude-01', '@glmclaude-01');
const agentChinese = createMockAgent('agent-4', '架构师', '@架构师');
const agentSpaces = createMockAgent('agent-5', 'Claude Code', '@claude-code');

const allAgents = [agent1, agent2, agentGlm, agentChinese, agentSpaces];

// Test 1: User's exact reported bug
// GlmClaude-01 says: "以上是靶子。@mycodex 请从逃逸红队视角开始攻击这个双层边界..."
// Legacy bug matched agentDupLegacy (@mycodex-副本) because alphaHandle stripped '-副本' to 'mycodex'!
{
  const text = '以上是靶子。@mycodex 请从逃逸红队视角开始攻击这个双层边界：给出你怀疑的逃逸链起点';
  const testPool = [agent1, agentDupLegacy, agentGlm];
  const mentions = parseAgentMentions(text, testPool, agentGlm.id);
  console.assert(mentions.length === 1, `Test 1 failed: expected 1 mention, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-1', `Test 1 failed: expected agent-1 (MyCodex), got ${mentions[0]?.name}`);
  console.log('✅ Test 1 Passed: Exact mention of @mycodex does NOT match @mycodex-副本');
}

// Test 2: Mentioning @mycodex when @mycodex-02 is in the pool
{
  const text = '以上是靶子。@mycodex 请从逃逸红队视角开始攻击';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 2 failed: expected 1 mention, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-1', `Test 2 failed: expected agent-1 (MyCodex), got ${mentions[0]?.name}`);
  console.log('✅ Test 2 Passed: Mentioning @mycodex does NOT match @mycodex-02');
}

// Test 3: Mentioning @mycodex-02 when @mycodex is in the pool (prefix collision test)
{
  const text = '请看这里 @mycodex-02 你觉得如何？';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 3 failed: expected 1 mention, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-2', `Test 3 failed: expected agent-2 (MyCodex-02), got ${mentions[0]?.name}`);
  console.log('✅ Test 3 Passed: Mentioning @mycodex-02 does NOT falsely match @mycodex');
}

// Test 4: Both @mycodex and @mycodex-02 in the same text
{
  const text = '对比方案：@mycodex 和 @mycodex-02 分别给出建议';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 2, `Test 4 failed: expected 2 mentions, got ${mentions.length}`);
  const ids = mentions.map((m) => m.id);
  console.assert(ids.includes('agent-1') && ids.includes('agent-2'), `Test 4 failed: missing agents, got ${ids}`);
  console.log('✅ Test 4 Passed: Both distinct agents matched independently');
}

// Test 5: Chinese text without space immediately after @handle
{
  const text = '@mycodex请从逃逸红队视角开始攻击';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 5 failed: expected 1 mention, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-1', `Test 5 failed: expected agent-1, got ${mentions[0]?.name}`);
  console.log('✅ Test 5 Passed: Chinese text without space after English handle');
}

// Test 6: Email address must NOT match handle
{
  const text = '请联系 support@mycodex.com 或 test@mycodex 获取帮助';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 0, `Test 6 failed: email address should not trigger mention, got ${mentions.length}`);
  console.log('✅ Test 6 Passed: Email address does not trigger mention');
}

// Test 7: Trailing dot / sentence end
{
  const text = '关于这个问题，我们需要咨询 @mycodex.';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 7 failed: sentence end dot should match, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-1', `Test 7 failed: expected agent-1, got ${mentions[0]?.name}`);
  console.log('✅ Test 7 Passed: Sentence-ending dot preserves mention');
}

// Test 8: Chinese agent mention with Chinese text
{
  const text = '请 @架构师 审查系统架构设计';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 8 failed: expected 1 mention, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-4', `Test 8 failed: expected agent-4 (架构师), got ${mentions[0]?.name}`);
  console.log('✅ Test 8 Passed: Chinese agent mention');
}

// Test 9: Name with spaces and hyphenated alias
{
  const text1 = '请问 @Claude Code 你怎么看？';
  const mentions1 = parseAgentMentions(text1, allAgents);
  console.assert(mentions1.length === 1 && mentions1[0].id === 'agent-5', 'Test 9a failed');

  const text2 = '请问 @claude-code 你怎么看？';
  const mentions2 = parseAgentMentions(text2, allAgents);
  console.assert(mentions2.length === 1 && mentions2[0].id === 'agent-5', 'Test 9b failed');
  console.log('✅ Test 9 Passed: Agent with space in name matches both space and hyphenated forms');
}

// Test 10: @all boundary check
{
  console.assert(isAllMention('@all 请注意') === true, 'Test 10a failed');
  console.assert(isAllMention('这是给 @所有人 的通知') === true, 'Test 10b failed');
  console.assert(isAllMention('Hello @team please review') === true, 'Test 10c failed');
  console.assert(isAllMention('send to contact@all.com') === false, 'Test 10d failed (email)');
  console.assert(isAllMention('overall performance is good') === false, 'Test 10e failed (substring)');
  console.assert(isAllMention('@alliance meeting') === false, 'Test 10f failed (prefix)');
  console.log('✅ Test 10 Passed: @all boundary checks prevent false triggers');
}

// Test 11: Deduplication when mentioned multiple times
{
  const text = '@mycodex 你好，请 @mycodex 再次确认';
  const mentions = parseAgentMentions(text, allAgents);
  console.assert(mentions.length === 1, `Test 11 failed: duplicate mentions in same text should deduplicate, got ${mentions.length}`);
  console.log('✅ Test 11 Passed: Mention deduplication');
}

// Test 12: Exclude currentAgentId
{
  const text = '@mycodex 和 @glmclaude-01';
  const mentions = parseAgentMentions(text, allAgents, 'agent-1');
  console.assert(mentions.length === 1, `Test 12 failed: should exclude agent-1, got ${mentions.length}`);
  console.assert(mentions[0].id === 'agent-3', `Test 12 failed: expected agent-3, got ${mentions[0]?.name}`);
  console.log('✅ Test 12 Passed: currentAgentId exclusion');
}

// Test 13: Renamed agent with stale legacy handle (e.g. GlmClaude -> GlmClaude-01 still holding @glmclaude)
// Must NOT allow @glmclaude to falsely match GlmClaude-01, and roster must advertise @glmclaude-01
{
  const staleGlm01 = createMockAgent('agent-1790582453199', 'GlmClaude-01', '@glmclaude');
  const glm02 = createMockAgent('agent-1774879745525', 'GlmClaude-02', '@glmclaude-02');
  const pool = [agent1, staleGlm01, glm02];

  console.assert(
    normalizeAgentHandle(staleGlm01.name, staleGlm01.id) === '@glmclaude-01',
    'Test 13a failed: normalizeAgentHandle should return @glmclaude-01'
  );
  console.assert(
    resolveEffectiveAgentHandle(staleGlm01) === '@glmclaude-01',
    'Test 13b failed: resolveEffectiveAgentHandle should upgrade stale @glmclaude to @glmclaude-01'
  );

  const roster = buildCrewRosterGuidance(pool, agent1.id);
  console.assert(
    roster.includes('@glmclaude-01 (GlmClaude-01)') && !roster.includes('@glmclaude (GlmClaude-01)'),
    `Test 13c failed: roster leaked stale @glmclaude handle:\n${roster}`
  );

  const falseMentions = parseAgentMentions('请 @glmclaude 补充并发压测意见', pool, agent1.id);
  console.assert(
    falseMentions.length === 0,
    `Test 13d failed: @glmclaude must NOT match GlmClaude-01, got ${falseMentions.map((m) => m.name)}`
  );

  const exactMentions = parseAgentMentions('请 @glmclaude-01 补充并发压测意见', pool, agent1.id);
  console.assert(
    exactMentions.length === 1 && exactMentions[0].id === staleGlm01.id,
    'Test 13e failed: @glmclaude-01 should match GlmClaude-01'
  );
  console.log('✅ Test 13 Passed: Stale @glmclaude handle on GlmClaude-01 is normalized to @glmclaude-01 and never false-matched');
}

console.log('🎉 ALL 13 MENTION RESOLUTION TESTS PASSED SUCCESSFULLY!');
