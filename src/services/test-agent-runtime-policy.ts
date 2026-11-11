/**
 * Agent 运行时预算与循环收敛策略回归测试
 *
 * 规范映射：
 * 1. 策略归一化与系统级硬上限（token / hops / retries / flush interval）
 * 2. 协同最大轮次取参与者最小值
 * 3. LoopGuard 对目标 Agent 的轮次预算执行静默收敛
 * 4. autoRelay=false 的 Agent 不得把 @mention 或排队队列拖入下一跳
 * 5. 运行时约束只在实际配置非默认值时注入系统人设
 */

import assert from 'node:assert/strict';
import type { Agent, AgentRuntimePolicy } from '../types';
import {
  DEFAULT_AGENT_RUNTIME_POLICY,
  MAX_ALLOWED_CASCADE_HOPS,
  MAX_ALLOWED_STREAM_FLUSH_INTERVAL_MS,
  buildRuntimePolicyDirective,
  normalizeAgentRuntimePolicy,
  resolveCascadeMaxHops,
  resolveCorrectionRetryLimit,
  resolveEffectiveRuntimePolicy,
} from './agentRuntimePolicy';
import {
  aggregateTurnBarrierMentions,
  checkLoopGuard,
  type CollaborationCascade,
} from './agentCollaboration';

function makeAgent(id: string, policy?: Partial<AgentRuntimePolicy>): Agent {
  return {
    id,
    name: id.toUpperCase(),
    handle: `@${id}`,
    avatar: '🤖',
    role: 'Tester',
    description: 'runtime policy test agent',
    color: '#3b82f6',
    status: 'idle',
    modelBadge: 'ACP Stdio',
    workspace: { rootPath: '.', repoName: 'test', gitBranch: 'main', permissionMode: 'full_read_write', activeFiles: [] },
    skills: [],
    envVars: [],
    acpTransport: 'stdio',
    acpCommandOrUrl: 'fake-acp',
    protocolVersion: 'test',
    capabilities: {
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    },
    memory: {
      schemaVersion: 1,
      mode: 'native',
      autoGenerate: false,
      nativeCapability: {
        status: 'unknown',
        persistent: null,
        crossThread: null,
        provider: null,
        scope: 'unknown',
        detail: null,
      },
      internalMemoryPath: '',
      persistentType: 'sqlite',
      persistentItems: [],
      sessionCacheCount: 0,
      cartridges: [],
    },
    runtimePolicy: policy ? normalizeAgentRuntimePolicy(policy) : undefined,
  } as unknown as Agent;
}

function makeCascade(depth: number, maxDepth: number, callCounts: Record<string, number> = {}): CollaborationCascade {
  return {
    cascadeId: 'cascade-test',
    rootMessageId: 'msg-root',
    roomId: 'topic-1',
    originalPrompt: 'test',
    depth,
    maxDepth,
    visitedAgentIds: [],
    agentCallCounts: callCounts,
    isAborted: false,
  };
}

function run(): void {
  console.log('=== Agent Runtime Policy Regression ===');

  // 1. 默认值与硬上限
  const defaults = normalizeAgentRuntimePolicy(undefined);
  assert.deepEqual(defaults, DEFAULT_AGENT_RUNTIME_POLICY, '1.1 缺失策略必须归一化为默认值');
  assert.equal(defaults.maxOutputTokens, 0, '1.2 默认不限制 token');
  assert.equal(defaults.autoRelay, true, '1.3 默认允许接力');
  console.log('  ✓ 1. 默认策略与自动接力基线');

  const clamped = normalizeAgentRuntimePolicy({
    maxOutputTokens: 999999,
    cascadeMaxHops: 999,
    maxCorrectionRetries: 99,
    autoRelay: false,
    conciseReplies: true,
    streamFlushIntervalMs: 99999,
  });
  assert.equal(clamped.maxOutputTokens, 32768, '2.1 token 上限夹取失败');
  assert.equal(clamped.cascadeMaxHops, MAX_ALLOWED_CASCADE_HOPS, '2.2 轮次上限夹取失败');
  assert.equal(clamped.maxCorrectionRetries, 2, '2.3 纠错次数上限夹取失败');
  assert.equal(clamped.streamFlushIntervalMs, MAX_ALLOWED_STREAM_FLUSH_INTERVAL_MS, '2.4 刷新间隔上限夹取失败');
  assert.equal(clamped.autoRelay, false, '2.5 显式 false 必须保留');
  assert.equal(clamped.conciseReplies, true, '2.6 显式 true 必须保留');
  console.log('  ✓ 2. 越界值全部收敛到系统硬上限');

  const lower = normalizeAgentRuntimePolicy({
    maxOutputTokens: -5,
    cascadeMaxHops: 0,
    maxCorrectionRetries: -1,
    streamFlushIntervalMs: -20,
  });
  assert.equal(lower.maxOutputTokens, 0, '3.1 负数 token 必须收敛为不限制');
  assert.equal(lower.cascadeMaxHops, 1, '3.2 轮次下限为 1');
  assert.equal(lower.maxCorrectionRetries, 0, '3.3 纠错下限为 0');
  assert.equal(lower.streamFlushIntervalMs, 0, '3.4 刷新下限为 0');
  console.log('  ✓ 3. 下界与非法数值收敛');

  // 4. 协同轮次取参与者最小值
  const fast = makeAgent('fast', { cascadeMaxHops: 2 });
  const slow = makeAgent('slow', { cascadeMaxHops: 8 });
  const noPolicy = makeAgent('plain');
  assert.equal(resolveCascadeMaxHops([fast, slow]), 2, '4.1 应取最小轮次');
  assert.equal(resolveCascadeMaxHops([slow, noPolicy]), 8, '4.2 无策略 Agent 视为默认 12');
  assert.equal(resolveCascadeMaxHops([]), MAX_ALLOWED_CASCADE_HOPS, '4.3 空参与者回退系统上限');
  console.log('  ✓ 4. 房间协同轮次取参与者最小值');

  // 5. 纠错次数与 Prompt 指令
  assert.equal(resolveCorrectionRetryLimit(fast), 2, '5.1 未配置纠错次数时使用默认 2');
  assert.equal(resolveCorrectionRetryLimit(makeAgent('zero', { maxCorrectionRetries: 0 })), 0, '5.2 显式 0 保留');
  const defaultDirective = buildRuntimePolicyDirective(noPolicy);
  assert.match(defaultDirective, /收敛约束/, '5.3 默认策略仍注入收敛约束，抑制无意义接话');
  assert.doesNotMatch(defaultDirective, /tokens 以内/, '5.4 默认不注入 token 预算');
  assert.doesNotMatch(defaultDirective, /简洁模式/, '5.5 默认不注入简洁模式');
  const strictDirective = buildRuntimePolicyDirective(
    makeAgent('strict', {
      maxOutputTokens: 900,
      cascadeMaxHops: 1,
      maxCorrectionRetries: 0,
      autoRelay: false,
      conciseReplies: true,
    })
  );
  assert.match(strictDirective, /900 tokens/, '5.6 token 预算必须写入指令');
  assert.match(strictDirective, /简洁模式/, '5.7 简洁模式必须写入指令');
  assert.match(strictDirective, /接力禁用/, '5.8 关闭接力必须写入指令');
  console.log('  ✓ 5. 纠错上限与系统 Prompt 指令注入');

  // 6. LoopGuard 对目标 Agent 的轮次预算
  const cascade = makeCascade(2, 12, { fast: 0 });
  const blocked = checkLoopGuard(cascade, fast.id, fast);
  assert.equal(blocked.allowed, false, '6.1 达到 Agent 轮次预算必须阻断');
  assert.equal(blocked.isSilentEnd, true, '6.2 静默收敛，不制造报错噪音');
  const allowed = checkLoopGuard(makeCascade(1, 12, { fast: 0 }), fast.id, fast);
  assert.equal(allowed.allowed, true, '6.3 未达预算必须放行');
  assert.equal(checkLoopGuard(makeCascade(12, 12), slow.id, slow).allowed, false, '6.4 全局 maxDepth 仍然生效');
  console.log('  ✓ 6. LoopGuard 按目标 Agent 预算静默收敛');

  // 7. autoRelay=false 阻断接力与排队队列
  const sender = makeAgent('sender', { autoRelay: false });
  const target = makeAgent('target');
  const workspace = [sender, target];
  const mentionOnly = aggregateTurnBarrierMentions({
    turnOutputs: [{ agent: sender, messageId: 'm1', replyContent: '@target 请复核' }],
    candidateAgents: [target],
    allWorkspaceAgents: workspace,
  });
  assert.equal(mentionOnly.nextTargets.length, 0, '7.1 关闭接力的 Agent 不得拉起下一跳');

  const queuedOnly = aggregateTurnBarrierMentions({
    turnOutputs: [{ agent: sender, messageId: 'm1', replyContent: '已完成，无需接力。' }],
    candidateAgents: [target],
    allWorkspaceAgents: workspace,
    queuedCollaborators: [target],
  });
  assert.equal(queuedOnly.nextTargets.length, 0, '7.2 所有发言者关闭接力时排队队列不得续跑');

  sender.runtimePolicy = normalizeAgentRuntimePolicy({ autoRelay: true });
  const enabled = aggregateTurnBarrierMentions({
    turnOutputs: [{ agent: sender, messageId: 'm1', replyContent: '@target 请复核' }],
    candidateAgents: [target],
    allWorkspaceAgents: workspace,
  });
  assert.equal(enabled.nextTargets.length, 1, '7.3 开启接力时正常产生下一跳');
  console.log('  ✓ 7. autoRelay 关闭时阻断点名与排队接力');

  console.log('\n🎉 Agent Runtime Policy regression passed (all assertions)');
}

run();
