import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  advanceRoleConcurrenceItem,
  buildArbiterBlockedConcurrenceInquiryDirective,
  buildArbiterStage5Directive,
  buildFinalRulingFromConcurrence,
  buildRoleConcurrencePrompt,
  checkAllRolesConcurred,
  compileHumanReadableLivingAdr,
  computeRoleConcurrenceSolutionDigest,
  escapeTableCell,
  evaluateArbitrationConcurrenceSkip,
  evaluateRulingGates,
  formatConcurrenceBlockingSummary,
  formatFullDateTime,
  hasExplicitArbitrationRulingContract,
  normalizeMentionHandle,
  prepareConcurrenceState,
  shouldSkipRedundantArbitrationConcurrence,
  validateArbiterConcurrenceMentions,
} from './arbitrationConcurrenceGovernor';
import { extractRoleConcurrenceFromAcpResponse } from '../acpClient';
import { buildScopedModulePrompt, buildTopicPrompt } from '../agentCollaboration';
import { useArbitrationConcurrence } from '../../hooks/useArbitrationConcurrence';
import { generateAdrMarkdown, LivingAdrCanvas } from '../../components/LivingAdrCanvas';
import {
  Agent,
  ArbitrationRulingDraft,
  Channel,
  GameRoleConcurrenceState,
  Message,
  RoleConcurrenceSubmission,
  RulingRecord,
  TopicMessageData,
} from '../../types';

console.log('================================================================================');
console.log('🧪 CognoNexus: 结构化角色无异议票、终局敲定与活体看板 P0 回归');
console.log('================================================================================\n');

function createMockAgent(partial: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    handle: `@${partial.name.toLowerCase()}`,
    role: 'Expert',
    avatar: '🤖',
    status: 'idle',
    color: '#3b82f6',
    acpTransport: 'stdio',
    acpCommandOrUrl: 'mock',
    protocolVersion: '1.0',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    workspace: { cwd: '/mock' },
    skills: [],
    memory: { historyLimit: 100 },
    ...partial,
  } as Agent;
}

const mockAgents: Agent[] = [
  createMockAgent({
    id: 'agent-proposer',
    name: 'Architect_Linus',
    handle: '@arch-linus',
    role: '架构师提案方',
    description: '核心系统架构设计',
  }),
  createMockAgent({
    id: 'agent-challenger',
    name: 'RedTeam_Sentinel',
    handle: '@red-sentinel',
    role: '红队对抗专家',
    description: '极限并发与网络抖动边界证伪',
  }),
  createMockAgent({
    id: 'agent-verifier',
    name: 'QA_Grounding',
    handle: '@qa-verifier',
    role: '接地实证检验员',
    description: '物理代码与沙箱运行真值检验',
  }),
  createMockAgent({
    id: 'agent-arbiter',
    name: 'Chief_Arbiter_Sophia',
    handle: '@arbiter-sophia',
    role: '终局综合裁定官',
    description: '客观权衡与终局决策敲定',
  }),
];

const mockTopic: TopicMessageData = {
  id: 'topic-gt-structured-999',
  scopeType: 'channel',
  workspaceBindingId: 'ws-1',
  title: '分布式订单防重与幂等状态机选型',
  description: '高并发秒杀场景下，选择 Redis 分布式锁还是数据库排他行锁与版本号。',
  status: 'open',
  discussionMode: 'game_theoretic',
  gameStage: 'arbitration',
  gameRoles: {
    proposers: ['agent-proposer'],
    challengers: ['agent-challenger'],
    verifiers: ['agent-verifier'],
    arbiters: ['agent-arbiter'],
    humanIsArbiter: false,
  },
  authorId: 'user-1',
  authorName: 'TechLead',
  authorAvatar: '👤',
  timestamp: '10:00',
  repliesCount: 6,
  participatingAgentIds: mockAgents.map((agent) => agent.id),
};

const draft: ArbitrationRulingDraft = {
  decisionType: 'trade_off_matrix',
  summary: '采纳两层防线权衡方案：内存缓存锁提速 + 数据库行级版本号硬防穿透。',
  solution: '第一阶段实现 Redis 分布式防重，第二阶段合入 DB 唯一约束与补偿重试。',
  tradeOffPoints: [
    '优先保障高并发秒杀响应速度，90% 场景走缓存快速拦截',
    '适度牺牲锁释放异常时的 DB 重试开销，杜绝超卖死锁',
  ],
  impactedFiles: [
    'src/services/orderLock.ts',
    'src/db/migrations/add_unique_idempotent.sql',
  ],
};

const arbiterMentions = '@arch-linus @red-sentinel @qa-verifier 请完成最终结构化核验。';

function makeSubmission(
  agentId: string,
  role: 'proposer' | 'challenger' | 'verifier',
  solutionDigest: string,
  overrides: Partial<RoleConcurrenceSubmission> = {}
): RoleConcurrenceSubmission {
  return {
    protocolVersion: 1,
    agentId,
    role,
    solutionDigest,
    status: 'concurred',
    blockingIssueIds: [],
    conditions: [],
    rationale: '关键争议已被结构化防线覆盖，确认无异议。',
    evidenceRefs: ['EV-01'],
    source: 'contract_block',
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function roleBlock(submission: Omit<RoleConcurrenceSubmission, 'source' | 'submittedAt'>): string {
  return `<<<ROLE_CONCURRENCE>>>\n${JSON.stringify({
    protocol_version: submission.protocolVersion,
    agent_id: submission.agentId,
    role: submission.role,
    solution_digest: submission.solutionDigest,
    status: submission.status,
    blocking_issue_ids: submission.blockingIssueIds,
    conditions: submission.conditions,
    rationale: submission.rationale,
    evidence_refs: submission.evidenceRefs,
  }, null, 2)}\n<<<ROLE_CONCURRENCE_END>>>`;
}

console.log('--- 测试 1: 综合裁定官 Prompt 与真实 @ 输出校验 ---');
const arbiterDirective = buildArbiterStage5Directive({
  topic: {
    title: mockTopic.title,
    description: mockTopic.description,
    gameRoles: mockTopic.gameRoles,
    targetProposalText: '提案：采用 Redis Redlock 配合 30s 自动续期租约。',
    targetChallengeText: '挑战：时钟漂移和 GC 暂停可能导致锁并发穿透。',
  },
  arbiterAgent: mockAgents[3],
  availableAgents: mockAgents,
  verificationSection: '\n实证：Jepsen 混沌网络测试在 500ms 分区时发现脏写入。',
  defenseSection: '\n答辩：引入逻辑递增 Sequence 与 DB 唯一约束兜底防线。',
});

assert.ok(arbiterDirective.includes('负责本议题架构方案的最终敲定'));
assert.ok(arbiterDirective.includes('@arch-linus'));
assert.ok(arbiterDirective.includes('@red-sentinel'));
assert.ok(arbiterDirective.includes('@qa-verifier'));
assert.ok(arbiterDirective.includes('活体决策看板'));
assert.equal(arbiterDirective.includes('@@'), false);

const mentionValidation = validateArbiterConcurrenceMentions({
  arbiterReplyText: arbiterMentions,
  expectedAgents: mockAgents.slice(0, 3),
});
assert.equal(mentionValidation.isValid, true);
const doubleAtValidation = validateArbiterConcurrenceMentions({
  arbiterReplyText: '@@arch-linus @red-sentinel @qa-verifier',
  expectedAgents: mockAgents.slice(0, 3),
});
assert.deepEqual(doubleAtValidation.missingHandles, ['@arch-linus']);
assert.throws(
  () => prepareConcurrenceState({
    topic: mockTopic,
    candidateAgents: mockAgents,
    arbiterDraft: draft,
    arbiterReplyText: '没有点名任何参研角色。',
    solutionDigest: `sha256:${'a'.repeat(64)}`,
  }),
  /未逐一 @ 全部参研角色/
);
console.log('✓ Prompt 要求与宿主真实 @ 校验均生效；缺任一角色或 @@ 双句柄均阻断');

console.log('\n--- 测试 2: 角色结构化投票 Prompt ---');
const solutionDigest = await computeRoleConcurrenceSolutionDigest({
  topic: mockTopic,
  arbiterDraft: draft,
  arbiterReplyText: arbiterMentions,
});
assert.match(solutionDigest, /^sha256:[a-f0-9]{64}$/);
const challengerConcurrencePrompt = buildRoleConcurrencePrompt({
  roleAgent: mockAgents[1],
  roleName: 'challenger',
  arbiterName: mockAgents[3].name,
  arbiterText: draft.summary,
  solutionDigest,
  topicTitle: mockTopic.title,
  topicDescription: mockTopic.description,
});
assert.ok(challengerConcurrencePrompt.includes('submit_role_concurrence'));
assert.ok(challengerConcurrencePrompt.includes('<<<ROLE_CONCURRENCE>>>'));
assert.ok(challengerConcurrencePrompt.includes(solutionDigest));
assert.ok(challengerConcurrencePrompt.includes('自然语言正文只解释判断，绝不能替代结构化票'));
assert.ok(challengerConcurrencePrompt.includes('status=concurred 时'));
assert.ok(challengerConcurrencePrompt.includes('conditions 必须都为空数组'));
const retryPrompt = buildRoleConcurrencePrompt({
  roleAgent: mockAgents[1],
  roleName: 'challenger',
  arbiterName: mockAgents[3].name,
  arbiterText: draft.summary,
  solutionDigest,
  topicTitle: mockTopic.title,
  topicDescription: mockTopic.description,
  validationError: '上一次未提交结构化票',
});
assert.ok(retryPrompt.includes('上一次结构化票无效，必须修正'));
assert.ok(retryPrompt.includes('上一次未提交结构化票'));
console.log('✓ 角色 Prompt 强制工具契约、固定摘要与失败关闭语义');

console.log('\n--- 测试 3: 自然语言绝不参与授权（P0 原始击穿矩阵）---');
const p0NaturalLanguageCases = [
  '未发现明显漏洞，但仍保留意见。',
  '不存在阻断性异议，但暂缓上线。',
  '没有重大风险，但需要进一步验证。',
  '我不反对该方案，但先不要敲定。',
  '没有发现致命漏洞，待补测后再定。',
  '无异议？不可能。',
  '确认无异议。',
  '【无异议确认 / Concurred】方案可行。',
];
for (const text of p0NaturalLanguageCases) {
  const extraction = extractRoleConcurrenceFromAcpResponse({ textResponse: text });
  assert.equal(extraction.submission, undefined, `自然语言不得产生结构化票: ${text}`);
  assert.match(extraction.error || '', /未提交有效的 submit_role_concurrence/);
}
console.log(`✓ ${p0NaturalLanguageCases.length} 个自然语言正反例全部失败关闭，不再进行语料/正则授权`);

console.log('\n--- 测试 4: 严格结构化票解析与一致性校验 ---');
const conditionalPayload = {
  ...makeSubmission('agent-challenger', 'challenger', solutionDigest, {
    status: 'conditional',
    conditions: ['完成 500ms 网络分区混沌压测'],
    rationale: '方案方向可接受，但需补测后上线。',
  }),
};
const conditionalExtraction = extractRoleConcurrenceFromAcpResponse({
  textResponse: `经审视，先补测。\n${roleBlock(conditionalPayload)}`,
});
assert.equal(conditionalExtraction.submission?.status, 'conditional');
assert.deepEqual(conditionalExtraction.submission?.conditions, ['完成 500ms 网络分区混沌压测']);
assert.equal(conditionalExtraction.cleanedText, '经审视，先补测。');

const invalidConcurrent = extractRoleConcurrenceFromAcpResponse({
  textResponse: roleBlock({
    ...makeSubmission('agent-challenger', 'challenger', solutionDigest, {
      conditions: ['仍需补测'],
    }),
  }),
});
assert.equal(invalidConcurrent.submission, undefined);
assert.match(invalidConcurrent.error || '', /conditions 必须为空/);

const emptyConditional = extractRoleConcurrenceFromAcpResponse({
  textResponse: roleBlock(makeSubmission('agent-challenger', 'challenger', solutionDigest, {
    status: 'conditional',
    conditions: [],
  })),
});
assert.equal(emptyConditional.submission, undefined);
assert.match(emptyConditional.error || '', /conditional 时必须至少提供一项 conditions/);

const emptyObjection = extractRoleConcurrenceFromAcpResponse({
  textResponse: roleBlock(makeSubmission('agent-challenger', 'challenger', solutionDigest, {
    status: 'objected',
    blockingIssueIds: [],
  })),
});
assert.equal(emptyObjection.submission, undefined);
assert.match(emptyObjection.error || '', /objected 时必须至少提供一个 blocking_issue_id/);

const toolCallPayload = {
  protocol_version: 1,
  agent_id: 'agent-verifier',
  role: 'verifier',
  solution_digest: solutionDigest,
  status: 'concurred',
  blocking_issue_ids: [],
  conditions: [],
  rationale: '沙箱实证通过。',
  evidence_refs: ['EV-02'],
};
const toolExtraction = extractRoleConcurrenceFromAcpResponse({
  textResponse: '已完成实证。',
  mcpToolCalls: [{
    server_name: 'shadow-crew-dev-mcp',
    tool_name: 'submit_role_concurrence',
    status: 'completed',
    arguments: toolCallPayload,
  }],
});
assert.equal(toolExtraction.submission?.source, 'mcp_tool');
assert.equal(toolExtraction.submission?.status, 'concurred');

const blockForTool = roleBlock(makeSubmission('agent-verifier', 'verifier', solutionDigest));
const mismatchExtraction = extractRoleConcurrenceFromAcpResponse({
  textResponse: blockForTool,
  mcpToolCalls: [{
    server_name: 'shadow-crew-dev-mcp',
    tool_name: 'submit_role_concurrence',
    status: 'completed',
    arguments: {
      ...toolCallPayload,
      rationale: '与契约块不同的理由',
    },
  }],
});
assert.equal(mismatchExtraction.submission, undefined);
assert.match(mismatchExtraction.error || '', /不一致/);

const failedToolExtraction = extractRoleConcurrenceFromAcpResponse({
  textResponse: '工具调用失败。',
  mcpToolCalls: [{
    server_name: 'shadow-crew-dev-mcp',
    tool_name: 'submit_role_concurrence',
    status: 'failed',
  }],
});
assert.equal(failedToolExtraction.submission, undefined);
assert.match(failedToolExtraction.error || '', /工具调用状态异常/);

const conflictingTools = extractRoleConcurrenceFromAcpResponse({
  textResponse: '检测到多个工具票。',
  mcpToolCalls: [
    {
      server_name: 'shadow-crew-dev-mcp',
      tool_name: 'submit_role_concurrence',
      status: 'completed',
      arguments: toolCallPayload,
    },
    {
      server_name: 'shadow-crew-dev-mcp',
      tool_name: 'submit_role_concurrence',
      status: 'completed',
      arguments: {
        ...toolCallPayload,
        status: 'conditional',
        conditions: ['另一张票'],
      },
    },
  ],
});
assert.equal(conflictingTools.submission, undefined);
assert.match(conflictingTools.error || '', /多张内容不一致/);

const duplicateBlocks = extractRoleConcurrenceFromAcpResponse({
  textResponse: `${roleBlock(conditionalPayload)}\n${roleBlock(conditionalPayload)}`,
});
assert.match(duplicateBlocks.error || '', /多个 ROLE_CONCURRENCE/);
console.log('✓ 工具载荷、JSON 契约、条件票、冲突载荷与重复票校验通过');

console.log('\n--- 测试 5: 状态机只接受绑定同一方案摘要的有效票 ---');
let concurrenceState = prepareConcurrenceState({
  topic: mockTopic,
  candidateAgents: mockAgents,
  arbiterDraft: draft,
  arbiterReplyText: `${arbiterMentions}\n${draft.summary}`,
  solutionDigest,
});
assert.equal(concurrenceState.protocolVersion, 1);
assert.equal(concurrenceState.solutionDigest, solutionDigest);
assert.equal(concurrenceState.items.length, 3);
assert.equal(concurrenceState.allConcurred, false);

concurrenceState = advanceRoleConcurrenceItem(concurrenceState, 'agent-proposer', {
  submission: makeSubmission('agent-proposer', 'proposer', solutionDigest),
});
concurrenceState = advanceRoleConcurrenceItem(concurrenceState, 'agent-challenger', {
  submission: makeSubmission('agent-challenger', 'challenger', solutionDigest),
});
assert.equal(concurrenceState.allConcurred, false);

const digestMismatchState = advanceRoleConcurrenceItem(concurrenceState, 'agent-verifier', {
  submission: makeSubmission('agent-verifier', 'verifier', `sha256:${'b'.repeat(64)}`),
});
assert.equal(digestMismatchState.items[2].status, 'invalid');
assert.match(digestMismatchState.items[2].validationError || '', /solution_digest/);
assert.equal(checkAllRolesConcurred(digestMismatchState), false);
assert.throws(
  () => buildFinalRulingFromConcurrence({
    topic: mockTopic,
    arbiterAgent: mockAgents[3],
    concurrenceState: digestMismatchState,
    extractedDraft: draft,
    candidateAgents: mockAgents,
  }),
  /存在未达成真实无异议确认的角色/
);

const naturalLanguageOnlyState = advanceRoleConcurrenceItem(concurrenceState, 'agent-verifier', {
  validationError: '未提交有效的 ROLE_CONCURRENCE 契约块',
});
assert.equal(naturalLanguageOnlyState.items[2].status, 'invalid');
assert.equal(checkAllRolesConcurred(naturalLanguageOnlyState), false);

concurrenceState = advanceRoleConcurrenceItem(concurrenceState, 'agent-verifier', {
  submission: makeSubmission('agent-verifier', 'verifier', solutionDigest, {
    source: 'mcp_tool',
  }),
});
assert.equal(concurrenceState.allConcurred, true);
assert.equal(checkAllRolesConcurred(concurrenceState), true);
console.log('✓ 无效票、摘要错绑、自然语言回退均阻断；三张同摘要有效票才可推进');

console.log('\n--- 测试 6: 条件票、异议票与离线票不参与无异议 ---');
const conditionalState = advanceRoleConcurrenceItem(
  prepareConcurrenceState({
    topic: mockTopic,
    candidateAgents: mockAgents,
    arbiterDraft: draft,
    arbiterReplyText: arbiterMentions,
    solutionDigest,
  }),
  'agent-challenger',
  {
    submission: makeSubmission('agent-challenger', 'challenger', solutionDigest, {
      status: 'conditional',
      conditions: ['完成跨机房压测'],
    }),
  }
);
assert.equal(conditionalState.items[1].status, 'conditional');
assert.equal(checkAllRolesConcurred(conditionalState), false);

const objectedState = advanceRoleConcurrenceItem(
  prepareConcurrenceState({
    topic: mockTopic,
    candidateAgents: mockAgents,
    arbiterDraft: draft,
    arbiterReplyText: arbiterMentions,
    solutionDigest,
  }),
  'agent-challenger',
  {
    submission: makeSubmission('agent-challenger', 'challenger', solutionDigest, {
      status: 'objected',
      blockingIssueIds: ['RISK-01'],
      rationale: '主从切换仍存在租约漂移空窗。',
    }),
  }
);
assert.equal(objectedState.items[1].status, 'objected');
assert.deepEqual(objectedState.items[1].blockingIssueIds, ['RISK-01']);
assert.equal(checkAllRolesConcurred(objectedState), false);

const unavailableState = advanceRoleConcurrenceItem(
  prepareConcurrenceState({
    topic: mockTopic,
    candidateAgents: mockAgents,
    arbiterDraft: draft,
    arbiterReplyText: arbiterMentions,
    solutionDigest,
  }),
  'agent-verifier',
  { unavailableReason: 'Agent 离线' }
);
assert.equal(unavailableState.items[2].status, 'unavailable');
assert.equal(checkAllRolesConcurred(unavailableState), false);
console.log('✓ conditional / objected / unavailable 均保持阻塞');

console.log('\n--- 测试 7: 综合裁定官终局裁决与活体看板 ---');
const finalRuling = buildFinalRulingFromConcurrence({
  topic: mockTopic,
  arbiterAgent: mockAgents[3],
  concurrenceState,
  extractedDraft: draft,
  candidateAgents: mockAgents,
});
assert.equal(finalRuling.arbiterName, 'Chief_Arbiter_Sophia');
assert.equal(finalRuling.executorId, undefined);
assert.equal(finalRuling.concurrenceSignOff?.allConcurred, true);
assert.equal(finalRuling.concurrenceSignOff?.solutionDigest, solutionDigest);
assert.equal(finalRuling.concurrenceSignOff?.records.length, 3);
assert.ok(finalRuling.concurrenceSignOff?.records.every((record) => record.decisionSource));
assert.ok(finalRuling.livingAdrMarkdown?.includes('全员无异议共识签署'));

const richTopic: TopicMessageData = {
  ...mockTopic,
  gameTheoreticState: {
    currentStage: 'concluded',
    targetProposalContent: '提案：使用 Redis 配合租约防重。',
    targetChallengeContent: '红队证伪反例：500ms 网络抖动时租约提前过期。',
    targetVerificationContent: '接地实证：Jepsen 测试复现重入，DB 唯一键阻断脏写。',
    mcdaPayload: {
      solverType: 'BWM',
      criteria: [
        { id: 'safety', name: '数据安全性', direction: 'maximize' },
        { id: 'perf', name: '响应延迟', direction: 'minimize' },
      ],
      alternatives: ['Redis 分布式锁', 'DB 行锁版本号'],
      scoreMatrix: {},
      bestCriterionId: 'safety',
      worstCriterionId: 'perf',
      bestToOthers: [1, 3],
      othersToWorst: [3, 1],
      computedWeights: { safety: 0.7, perf: 0.3 },
      consistencyIndex: 0.08,
      consistencyPassed: true,
      ranking: [],
    },
    minorityReport: {
      id: 'mr-test-1',
      dissentingAgentId: 'agent-challenger',
      dissentingAgentName: 'RedTeam_Sentinel',
      coreDissentThesis: '对纯缓存防重持有根本疑虑，主张保留 DB 行锁。',
      rationalityBasis: '金融账务场景零容忍超卖。',
      reopeningTriggers: ['生产环境出现一次超卖异常报警'],
      recordedAt: fullDateTestStr(),
    },
    cognoNexus: {
      committedStates: [
        {
          id: 'n1',
          claim: '唯一键是最终一致性真相。',
          assumptions: ['所有写路径携带幂等键'],
          confidence: 0.92,
          depth: 0,
          impactScore: 2,
        },
      ],
      currentDispute: {
        disputeId: 'dispute-01',
        claimTopic: '主从切换时锁是否可靠',
        proposerClaim: 'Redis 锁可快速削峰',
        challengerCritique: '主从切换期间租约可能漂移',
        rootCause: '缓存锁序不等同于业务幂等',
        groundingStatus: 'verified_true',
        evidenceChain: [
          {
            evidenceId: 'EV-01',
            sourceTool: 'chaos-sandbox',
            inputQueryOrCode: 'inject network partition 500ms',
            rawOutput: 'lock reentry=2, duplicate orders=0',
            truthValue: true,
            verifierReport: '500ms 分区下锁重入，但唯一键阻断重复落单。',
          },
        ],
      },
    },
  },
  rulingRecord: finalRuling,
};
const richAdr = compileHumanReadableLivingAdr({
  topic: richTopic,
  agents: mockAgents,
  ruling: finalRuling,
  concurrenceItems: concurrenceState.items,
});
const sectionHeadings = richAdr.split('\n').filter((line) => line.startsWith('## '));
assert.equal(sectionHeadings.length, 9);
assert.ok(richAdr.includes('## 4. 证伪失效清单与红队边界压测'));
assert.ok(richAdr.includes('## 5. 接地实证与验证结论'));
assert.ok(richAdr.includes('## 7. 伴生少数派异议备案'));
assert.ok(richAdr.includes('## 8. 限定安全爆炸半径'));
assert.ok(richAdr.includes('## 9. 落地执行与工程交付清单'));
assert.ok(richAdr.includes('生产环境出现一次超卖异常报警'));
assert.ok(richAdr.includes('\\xi^* = 0.08'));
assert.equal(
  generateAdrMarkdown({ ...mockTopic, rulingRecord: finalRuling }, mockAgents),
  finalRuling.livingAdrMarkdown
);
const renderedLivingAdr = renderToStaticMarkup(
  React.createElement(LivingAdrCanvas, {
    topic: richTopic,
    agents: mockAgents,
  })
);
assert.ok(renderedLivingAdr.includes('7. 伴生少数派异议备案'));
assert.ok(renderedLivingAdr.includes('黑天鹅重启触发器'));
assert.ok(renderedLivingAdr.includes('生产环境出现一次超卖异常报警'));
assert.ok(renderedLivingAdr.includes('8. 限定安全爆炸半径'));
assert.ok(renderedLivingAdr.includes('9. 落地执行与工程交付清单'));
assert.ok(renderedLivingAdr.includes('核心补丁实现'));
console.log(`✓ 9 章人类可读看板完整生成，签署摘要 ${solutionDigest.slice(0, 18)}…`);

console.log('\n--- 测试 8: 零参研角色、表格转义与门禁 ---');
const zeroPeerState = prepareConcurrenceState({
  topic: {
    ...mockTopic,
    gameRoles: {
      proposers: [],
      challengers: [],
      verifiers: [],
      arbiters: ['agent-arbiter'],
      humanIsArbiter: false,
    },
  },
  candidateAgents: [mockAgents[3]],
  solutionDigest,
});
assert.equal(zeroPeerState.isConcurrencePhaseActive, false);
assert.equal(zeroPeerState.items.length, 0);
assert.equal(normalizeMentionHandle(mockAgents[0]), '@arch-linus');
assert.equal(escapeTableCell('A | B\nC'), 'A \\| B C');
assert.equal(formatFullDateTime(new Date('2026-11-10T03:04:00Z')).length, 16);
assert.equal(evaluateRulingGates(mockTopic, { consistencyPassed: true } as any).allGatesPassed, true);
assert.equal(evaluateRulingGates({
  ...mockTopic,
  gameTheoreticState: {
    currentStage: 'arbitration',
    isChallengerBypassed: true,
    isChallengerResponded: false,
  },
}, { consistencyPassed: true } as any).isChallengerQuorumMet, true);
console.log('✓ 零角色、mention 规范化、表格转义、日期与门禁边界通过');

console.log('\n--- 测试 9: 综合裁定官兼任角色豁免正文自 @ 与内在默认无异议 ---');
// 1. 验证裁定官提示词：排除裁定官自身 @ 句柄
const dualRoleDirective = buildArbiterStage5Directive({
  topic: {
    title: mockTopic.title,
    description: mockTopic.description,
    gameRoles: {
      proposers: ['agent-proposer'],
      challengers: ['agent-challenger'],
      verifiers: ['agent-verifier'],
      arbiters: ['agent-proposer'],
      humanIsArbiter: false,
    },
  },
  arbiterAgent: mockAgents[0], // agent-proposer 既是提案官又是裁定官
  availableAgents: mockAgents,
});
assert.ok(!dualRoleDirective.includes('@arch-linus'));
assert.ok(dualRoleDirective.includes('@red-sentinel'));
assert.ok(dualRoleDirective.includes('@qa-verifier'));

// 2. 验证 prepareConcurrenceState：正文仅 @ 其他参研成员时不报错，且兼任角色内在达成无异议
const dualRoleTopic: TopicMessageData = {
  ...mockTopic,
  gameRoles: {
    proposers: ['agent-proposer'],
    challengers: ['agent-challenger'],
    verifiers: ['agent-verifier'],
    arbiters: ['agent-proposer'],
    humanIsArbiter: false,
  },
};
const dualRoleState = prepareConcurrenceState({
  topic: dualRoleTopic,
  candidateAgents: mockAgents,
  arbiterDraft: draft,
  arbiterReplyText: '终局裁决：优先采用方案C架构补丁。请 @red-sentinel @qa-verifier 进行最终审视。',
  solutionDigest,
  arbiterAgentId: 'agent-proposer',
});
assert.equal(dualRoleState.isConcurrencePhaseActive, true);
assert.equal(dualRoleState.items.length, 3);
const linusItem = dualRoleState.items.find((i) => i.agentId === 'agent-proposer');
assert.ok(linusItem);
assert.equal(linusItem?.status, 'concurred');
assert.equal(linusItem?.solutionDigest, solutionDigest);
assert.ok(linusItem?.statement?.includes('综合裁定官兼任'));
assert.equal(linusItem?.decisionSource, 'arbiter_intrinsic');
const redItem = dualRoleState.items.find((i) => i.agentId === 'agent-challenger');
assert.equal(redItem?.status, 'pending');

// 3. 验证 @AgentName 显示名兼容匹配 (RedTeam_Sentinel -> @RedTeam_Sentinel)
const displayNameValidation = validateArbiterConcurrenceMentions({
  arbiterReplyText: '请 @RedTeam_Sentinel 和 @QA_Grounding 进行审视。',
  expectedAgents: [mockAgents[1], mockAgents[2]],
});
assert.equal(displayNameValidation.isValid, true);
assert.deepEqual(displayNameValidation.missingHandles, []);
console.log('✓ 裁定官兼任时正文自 @ 豁免、内在无异议初始化与 @AgentName 显示名兼容校验全部通过');

// ============================================================================
// 测试 10：3 个 conditional 票阻塞期间 `@all 到哪步了？` 追问：摘要、裁定官答疑指令与 Prompt 注入
// ============================================================================
console.log('[10] 验证 3 个 conditional 票阻塞期间 `@all 到哪步了？` 追问摘要与 Prompt 注入...');
let blockedState = prepareConcurrenceState({
  topic: mockTopic,
  candidateAgents: mockAgents,
  arbiterDraft: draft,
  arbiterReplyText: `终局裁决草案：采纳两层防线权衡方案。${arbiterMentions}`,
  solutionDigest,
  arbiterAgentId: 'agent-arbiter',
});

const blockedConditionMap: Record<string, { role: 'proposer' | 'challenger' | 'verifier'; cond: string; stmt: string }> = {
  'agent-proposer': {
    role: 'proposer',
    cond: '需补充静态 HTML 单文件负向边界锁定说明，禁止引入额外表单与 fetch 请求',
    stmt: '仅在满足静态页面零脚本扩展前提下同意方案。',
  },
  'agent-challenger': {
    role: 'challenger',
    cond: '需明确高并发锁过期时的幂等补偿退避策略',
    stmt: '若补齐幂等退避窗口边界条件则不再异议。',
  },
  'agent-verifier': {
    role: 'verifier',
    cond: '需在接地实证 JSON 中显式给出布尔字段 truth_value 并通过验证',
    stmt: '等待真实构建与接地真值布尔判定落盘。',
  },
};

for (const [agentId, cfg] of Object.entries(blockedConditionMap)) {
  blockedState = advanceRoleConcurrenceItem(blockedState, agentId, {
    submission: makeSubmission(agentId, cfg.role, solutionDigest, {
      status: 'conditional',
      rationale: cfg.stmt,
      conditions: [cfg.cond],
    }),
  });
}
assert.equal(blockedState.isConcurrencePhaseActive, true);
assert.equal(blockedState.allConcurred, false);
assert.equal(checkAllRolesConcurred(blockedState), false);

const blockingSummary = formatConcurrenceBlockingSummary(blockedState);
assert.ok(blockingSummary.includes('Architect_Linus') && blockingSummary.includes('@arch-linus'));
assert.ok(blockingSummary.includes('RedTeam_Sentinel') && blockingSummary.includes('@red-sentinel'));
assert.ok(blockingSummary.includes('QA_Grounding') && blockingSummary.includes('@qa-verifier'));
assert.ok(blockingSummary.includes('条件保留') && blockingSummary.includes('conditional'));
for (const cfg of Object.values(blockedConditionMap)) {
  assert.ok(blockingSummary.includes(cfg.cond), `阻塞摘要必须包含条件: ${cfg.cond}`);
}

const blockedInquiryDirective = buildArbiterBlockedConcurrenceInquiryDirective(blockedState);
assert.ok(blockedInquiryDirective.includes('阶段 5 阻塞答疑与状态说明守则'));
assert.ok(blockedInquiryDirective.includes('默认模式 · 仅解释当前进展与阻塞条件'));
assert.ok(blockedInquiryDirective.includes('重跑完整的阶段 5 综合仲裁流程'));
assert.ok(blockedInquiryDirective.includes('勿加 `@` 符号'));

const blockedInquiryPrompt = buildTopicPrompt({
  topic: {
    topicId: mockTopic.id,
    title: mockTopic.title,
    description: mockTopic.description,
    channelName: 'arch-review',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: mockTopic.gameRoles,
    gameStage: 'arbitration',
    concurrenceState: blockedState,
    participatingAgents: mockAgents,
  },
  userContent: '@all 到哪步了？',
  targetAgent: mockAgents[3],
  availableAgents: mockAgents,
});
assert.ok(blockedInquiryPrompt.includes(blockedConditionMap['agent-proposer'].cond));
assert.ok(blockedInquiryPrompt.includes(blockedConditionMap['agent-challenger'].cond));
assert.ok(blockedInquiryPrompt.includes(blockedConditionMap['agent-verifier'].cond));
assert.ok(blockedInquiryPrompt.includes('默认模式 · 仅解释当前进展与阻塞条件'));
assert.ok(!blockedInquiryPrompt.includes('你必须先调用 MCP 工具 `submit_arbitration_ruling`'));

// 兼任提案官与裁定官的智能体在 arbitration 阶段收到阻塞态时，也必须命中仲裁阶段阻塞追问指令，而不是提案阶段指令
const dualRoleBlockedPrompt = buildTopicPrompt({
  topic: {
    topicId: dualRoleTopic.id,
    title: dualRoleTopic.title,
    description: dualRoleTopic.description,
    channelName: 'arch-review',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: dualRoleTopic.gameRoles,
    gameStage: 'arbitration',
    concurrenceState: blockedState,
    participatingAgents: mockAgents,
  },
  userContent: '@all 到哪步了？',
  targetAgent: mockAgents[0],
  availableAgents: mockAgents,
});
assert.ok(dualRoleBlockedPrompt.includes('阶段 5 阻塞答疑与状态说明守则'));
assert.ok(!dualRoleBlockedPrompt.includes('作为提案立论官，请提出架构级最优解方案'));

// 对照组：concurrenceState 未激活或已全票通过时，仍注入常规第 5 阶段仲裁指令
const normalStage5Prompt = buildTopicPrompt({
  topic: {
    topicId: mockTopic.id,
    title: mockTopic.title,
    description: mockTopic.description,
    channelName: 'arch-review',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: mockTopic.gameRoles,
    gameStage: 'arbitration',
    concurrenceState: { ...blockedState, allConcurred: true },
    participatingAgents: mockAgents,
  },
  userContent: '请给出最终裁决',
  targetAgent: mockAgents[3],
  availableAgents: mockAgents,
});
assert.ok(normalStage5Prompt.includes('submit_arbitration_ruling'));
assert.ok(!normalStage5Prompt.includes('阶段 5 阻塞答疑与状态说明守则'));
console.log('✓ 3 个 conditional 票阻塞摘要、裁定官答疑防重入指令与 Stage 5 Prompt 条件切换全部通过');

// ============================================================================
// 测试 11：shouldSkipRedundantArbitrationConcurrence / evaluateArbitrationConcurrenceSkip 门禁边界矩阵
// ============================================================================
console.log('[11] 验证冗余无异议征询跳过门禁与显式新裁决契约重开判定...');
const skipSameDigest = shouldSkipRedundantArbitrationConcurrence({
  existingConcurrenceState: blockedState,
  nextSolutionDigest: blockedState.solutionDigest,
  hasExplicitNewRulingContract: false,
});
assert.equal(skipSameDigest.skip, true);
assert.ok(skipSameDigest.reason && skipSameDigest.reason.length > 0);

const noSkipDigestChanged = shouldSkipRedundantArbitrationConcurrence({
  existingConcurrenceState: blockedState,
  nextSolutionDigest: 'sha256:materially-different-solution',
  hasExplicitNewRulingContract: false,
});
assert.equal(noSkipDigestChanged.skip, false);

const noSkipExplicitContract = shouldSkipRedundantArbitrationConcurrence({
  existingConcurrenceState: blockedState,
  nextSolutionDigest: blockedState.solutionDigest,
  hasExplicitNewRulingContract: true,
});
assert.equal(noSkipExplicitContract.skip, false);

const noSkipAlreadyConcurred = shouldSkipRedundantArbitrationConcurrence({
  existingConcurrenceState: { ...blockedState, allConcurred: true },
  nextSolutionDigest: blockedState.solutionDigest,
  hasExplicitNewRulingContract: false,
});
assert.equal(noSkipAlreadyConcurred.skip, false);

const noSkipInactive = shouldSkipRedundantArbitrationConcurrence({
  existingConcurrenceState: { ...blockedState, isConcurrencePhaseActive: false },
  nextSolutionDigest: blockedState.solutionDigest,
  hasExplicitNewRulingContract: false,
});
assert.equal(noSkipInactive.skip, false);

assert.equal(hasExplicitArbitrationRulingContract({ textResponse: '目前仍在等待 3 位角色解除阻塞条件。' }), false);
assert.equal(hasExplicitArbitrationRulingContract({ textResponse: '更新草案如下：\n<<<RULING_DRAFT>>>\n{"summary":"x"}\n<<<END_RULING_DRAFT>>>' }), true);
assert.equal(hasExplicitArbitrationRulingContract({ textResponse: '三方案对比：\n<<<RULING_DRAFT_OPTIONS>>>\n{}' }), true);
assert.equal(
  hasExplicitArbitrationRulingContract({
    textResponse: '已提交裁决',
    mcpToolCalls: [{ name: 'mcp__shadow_crew__submit_arbitration_ruling', status: 'success' }],
  }),
  true
);
assert.equal(
  hasExplicitArbitrationRulingContract({
    textResponse: '调用失败',
    mcpToolCalls: [{ name: 'submit_arbitration_ruling', status: 'error', isError: true }],
  }),
  false
);
assert.equal(hasExplicitArbitrationRulingContract({ textResponse: '新裁决对象', rulingDraft: draft }), true);

const blockedTopicWithDraft: TopicMessageData = {
  ...mockTopic,
  gameStage: 'arbitration',
  gameTheoreticState: {
    currentStage: 'arbitration',
    rulingDraft: draft,
    concurrenceState: blockedState,
  },
};

const skipEvalOnPlainInquiry = await evaluateArbitrationConcurrenceSkip({
  topic: blockedTopicWithDraft,
  acpResp: {
    textResponse: '目前推进到第 5 阶段：尚有 3 位成员投出 conditional，阻塞条件分别涉及静态 HTML 边界、幂等退避与布尔值实证。',
    mcpToolCalls: [],
  },
});
assert.equal(skipEvalOnPlainInquiry.hasExplicitNewRulingContract, false);
assert.equal(skipEvalOnPlainInquiry.nextSolutionDigest, blockedState.solutionDigest);
assert.equal(skipEvalOnPlainInquiry.skip, true);

const noSkipEvalWhenExplicitContract = await evaluateArbitrationConcurrenceSkip({
  topic: blockedTopicWithDraft,
  acpResp: {
    textResponse: `已针对全部 3 项条件修订最终裁决。${arbiterMentions}`,
    rulingDraft: {
      ...draft,
      summary: '修订终局裁决：静态 HTML 零脚本实现 + 补齐全部 3 项条件约束。',
    },
    mcpToolCalls: [{ name: 'submit_arbitration_ruling', status: 'success' }],
  },
});
assert.equal(noSkipEvalWhenExplicitContract.hasExplicitNewRulingContract, true);
assert.equal(noSkipEvalWhenExplicitContract.skip, false);

const topicWithChangedDefense: TopicMessageData = {
  ...blockedTopicWithDraft,
  gameTheoreticState: {
    ...blockedTopicWithDraft.gameTheoreticState,
    targetDefenseContent: '答辩新增：明确移除所有动态 JS、form 提交与持久化调用，仅保留静态 HTML。',
  },
};
const noSkipEvalWhenMaterialChange = await evaluateArbitrationConcurrenceSkip({
  topic: topicWithChangedDefense,
  acpResp: {
    textResponse: '根据答辩增量更新进入复核。',
  },
});
assert.notEqual(noSkipEvalWhenMaterialChange.nextSolutionDigest, blockedState.solutionDigest);
assert.equal(noSkipEvalWhenMaterialChange.skip, false);
console.log('✓ shouldSkipRedundantArbitrationConcurrence 与 evaluateArbitrationConcurrenceSkip 完整决策矩阵通过');

// ============================================================================
// 测试 12：Anti-Scope-Drift 负向边界 Prompt 与 Verifier truth_value/truthValue JSON 提醒
// ============================================================================
console.log('[12] 验证模块化/答辩防范围漂移负向边界约束与 Verifier truth_value 提醒...');
const scopedPrompt = buildScopedModulePrompt({
  activeModule: {
    moduleId: 'mod-static-landing',
    title: '静态展示页模块',
    responsibility: '实现纯静态 HTML+CSS 单文件着陆页（禁止 JS、表单、fetch 或本地持久化）',
    allowedFiles: ['public/index.html'],
    dependsOnModuleIds: [],
    complexityLevel: 'low_deterministic',
    status: 'proposing',
    belief: {
      priorRisk: 0.1,
      posteriorRisk: 0.1,
      routingMode: 'fast_track',
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 1,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: new Date().toISOString(),
    },
    scopedMessageIds: [],
  },
  sharedContract: {
    contractVersion: 1,
    summary: '纯静态 HTML+CSS 单文件着陆页（严禁引入 JavaScript、<form>、fetch 或持久化）',
    typeSignatures: '<!-- static HTML/CSS only -->',
    invariants: ['仅允许语义化 HTML 与 CSS，严禁动态脚本'],
    lockedAt: new Date().toISOString(),
  },
});
assert.ok(scopedPrompt.includes('防范围漂移与负向边界铁律'));
assert.ok(scopedPrompt.includes('纯静态 HTML+CSS') && scopedPrompt.includes('严禁私自引入 JS'));
assert.ok(scopedPrompt.includes('fetch') && scopedPrompt.includes('<form>'));

const defensePrompt = buildTopicPrompt({
  topic: {
    topicId: mockTopic.id,
    title: '纯静态 HTML 展示页（禁止 JS / 表单 / fetch / 持久化）',
    channelName: 'frontend',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: mockTopic.gameRoles,
    gameStage: 'defense',
    targetChallengeText: '质疑边界条件',
    participatingAgents: mockAgents,
  },
  userContent: '请答辩',
  targetAgent: mockAgents[0],
  availableAgents: mockAgents,
});
assert.ok(defensePrompt.includes('防范围漂移与负向边界铁律'));
assert.ok(defensePrompt.includes('纯静态 HTML+CSS') && defensePrompt.includes('JavaScript') && defensePrompt.includes('fetch'));

const verifierPrompt = buildTopicPrompt({
  topic: {
    topicId: mockTopic.id,
    title: mockTopic.title,
    channelName: 'arch-review',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: mockTopic.gameRoles,
    gameStage: 'verification',
    targetProposalText: '提案内容',
    targetChallengeText: '红队质询内容',
    participatingAgents: mockAgents,
  },
  userContent: '请完成接地实证',
  targetAgent: mockAgents[2],
  availableAgents: mockAgents,
});
assert.ok(verifierPrompt.includes('truth_value') && verifierPrompt.includes('truthValue'));
assert.ok(verifierPrompt.includes('布尔字段'));
console.log('✓ buildScopedModulePrompt、defense 防范围漂移约束与 verifier truth_value/truthValue 提醒校验通过');

// ============================================================================
// 测试 13：真实 React 19 Hook 集成校验 useArbitrationConcurrence 跳过保护与状态完整保留
// ============================================================================
console.log('[13] 验证 React 19 Hook (useArbitrationConcurrence) 在阻塞态追问下跳过重开且完整保留投票状态...');
{
  const g = globalThis as Record<string, unknown>;
  const prevDoc = g.document;
  const prevWin = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const prevIframe = g.HTMLIFrameElement;

  if (!g.HTMLIFrameElement) {
    g.HTMLIFrameElement = class HTMLIFrameElement {};
  }
  const createMinimalDomNode = (tag: string) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    style: {},
    childNodes: [] as unknown[],
    ownerDocument: null as unknown,
    appendChild(c: unknown) {
      this.childNodes.push(c);
      return c;
    },
    removeChild(c: unknown) {
      const idx = this.childNodes.indexOf(c);
      if (idx >= 0) this.childNodes.splice(idx, 1);
      return c;
    },
    insertBefore(c: unknown) {
      this.childNodes.push(c);
      return c;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
  });
  const doc = {
    nodeType: 9,
    createElement: (tag: string) => {
      const el = createMinimalDomNode(tag);
      el.ownerDocument = doc;
      return el;
    },
    createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text, ownerDocument: null }),
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    body: createMinimalDomNode('body'),
  };
  g.document = doc;
  g.window = { event: undefined, document: doc, HTMLIFrameElement: g.HTMLIFrameElement };
  g.IS_REACT_ACT_ENVIRONMENT = true;

  let root: ReturnType<typeof createRoot> | null = null;
  try {
    let topicStateRef: TopicMessageData = JSON.parse(JSON.stringify(blockedTopicWithDraft));
    const topicCardMessage: Message = {
      id: 'msg-topic-card-1',
      threadId: 'thread-ch-1',
      channelId: 'ch-1',
      authorId: 'user-1',
      authorName: 'TechLead',
      authorHandle: '@techlead',
      authorAvatar: '👤',
      isAgent: false,
      timestamp: '10:00',
      content: '发起议题',
      type: 'topic',
      topicData: topicStateRef,
    };
    const initialArbiterMsg: Message = {
      id: 'msg-arbiter-initial',
      threadId: topicStateRef.id,
      channelId: 'ch-1',
      authorId: mockAgents[3].id,
      authorName: mockAgents[3].name,
      authorHandle: mockAgents[3].handle,
      authorAvatar: mockAgents[3].avatar,
      isAgent: true,
      timestamp: '10:05',
      content: `终局方案草案。${arbiterMentions}`,
      gameStage: 'arbitration',
      gameRole: 'arbiter',
    };
    const pendingInquiryMsg: Message = {
      id: 'msg-arbiter-inquiry-pending',
      threadId: topicStateRef.id,
      channelId: 'ch-1',
      authorId: mockAgents[3].id,
      authorName: mockAgents[3].name,
      authorHandle: mockAgents[3].handle,
      authorAvatar: mockAgents[3].avatar,
      isAgent: true,
      isPending: true,
      timestamp: '10:12',
      content: '',
      gameStage: 'arbitration',
      gameRole: 'arbiter',
    };

    let messagesState: Record<string, Message[]> = {
      'thread-ch-1': [topicCardMessage],
      [topicStateRef.id]: [initialArbiterMsg, pendingInquiryMsg],
    };
    let updateTopicCallCount = 0;
    let activeExecUpdateCount = 0;
    let resolveTopicCalled = false;
    let staleOnNextCheck = false;
    const inFlightHandover = new Set<string>(['handover-inquiry']);
    const agentsRefObj = { current: mockAgents };

    const setMessagesMock: React.Dispatch<React.SetStateAction<Record<string, Message[]>>> = (updater) => {
      messagesState = typeof updater === 'function' ? updater(messagesState) : updater;
    };

    const topicChannel: Channel = {
      id: 'ch-1',
      workspaceBindingId: 'ws-1',
      name: 'arch-review',
      description: 'Architecture Review',
      creatorId: 'user-1',
      status: 'active',
      isPrivate: false,
      iconName: 'hash',
      unreadCount: 0,
      memberIds: mockAgents.map((a) => a.id),
      assignedAgentIds: mockAgents.map((a) => a.id),
    };

    let capturedProcessArbitration:
      | ReturnType<typeof useArbitrationConcurrence>['processArbitrationConcurrence']
      | null = null;

    function HookHarness() {
      const { processArbitrationConcurrence } = useArbitrationConcurrence({
        getTopicData: () => topicStateRef,
        activeTopicData: topicStateRef,
        updateTopicDataInState: (_tId, updater) => {
          updateTopicCallCount += 1;
          topicStateRef = updater(topicStateRef);
          staleOnNextCheck = true;
        },
        setMessages: setMessagesMock,
        setIsGenerating: () => {},
        setActiveExecutions: () => {
          activeExecUpdateCount += 1;
        },
        setAgents: () => {},
        agentsRef: agentsRefObj,
        inFlightHandoverRef: { current: inFlightHandover },
        isTurnStale: () => staleOnNextCheck,
        getTopicWorkspaceBinding: () => undefined,
        handleResolveTopic: () => {
          resolveTopicCalled = true;
        },
      });
      capturedProcessArbitration = processArbitrationConcurrence;
      return null;
    }

    const container = doc.createElement('div') as unknown as Element;
    root = createRoot(container);
    await React.act(async () => {
      root!.render(React.createElement(HookHarness));
    });
    assert.ok(capturedProcessArbitration);

    const inquiryReplyMsg: Message = {
      id: 'msg-arbiter-inquiry-reply',
      threadId: topicStateRef.id,
      channelId: 'ch-1',
      authorId: mockAgents[3].id,
      authorName: mockAgents[3].name,
      authorHandle: mockAgents[3].handle,
      authorAvatar: mockAgents[3].avatar,
      isAgent: true,
      timestamp: '10:12',
      content: '当前处于第 5 阶段征询阻塞态：3 位参研成员均给出 conditional，待解除对应条件后再推进敲定。',
      gameStage: 'arbitration',
      gameRole: 'arbiter',
    };

    await capturedProcessArbitration!({
      topicId: topicStateRef.id,
      arbiterAgent: mockAgents[3],
      acpResp: {
        textResponse: inquiryReplyMsg.content,
        mcpToolCalls: [],
        isEmptyTurn: false,
        isError: false,
      } as any,
      turnSnapshot: { epoch: 1, sessionEpoch: 1, threadId: topicStateRef.id } as any,
      candidateAgents: mockAgents,
      topicChannel,
      arbiterPendingId: pendingInquiryMsg.id,
      arbiterReply: inquiryReplyMsg,
      handoverKey: 'handover-inquiry',
    });

    assert.equal(updateTopicCallCount, 0, '追问跳过时禁止覆写 concurrenceState');
    assert.equal(activeExecUpdateCount, 0, '追问跳过时禁止拉起参研角色轮询执行');
    assert.equal(resolveTopicCalled, false);
    assert.equal(inFlightHandover.has('handover-inquiry'), false, 'handoverKey 应在 finally 中正常清理');
    assert.equal(topicStateRef.gameTheoreticState?.concurrenceState?.isConcurrencePhaseActive, true);
    assert.equal(topicStateRef.gameTheoreticState?.concurrenceState?.allConcurred, false);
    assert.equal(
      topicStateRef.gameTheoreticState?.concurrenceState?.solutionDigest,
      blockedState.solutionDigest
    );
    assert.equal(
      topicStateRef.gameTheoreticState?.concurrenceState?.items.filter((i) => i.status === 'conditional').length,
      3,
      '既有 3 票 conditional 与阻塞条件必须完整保留'
    );
    for (const [agentId, cfg] of Object.entries(blockedConditionMap)) {
      const preserved = topicStateRef.gameTheoreticState?.concurrenceState?.items.find(
        (i) => i.agentId === agentId
      );
      assert.deepEqual(preserved?.conditions, [cfg.cond]);
    }
    const msgsAfterInquiry = messagesState[topicStateRef.id] || [];
    assert.equal(msgsAfterInquiry.length, 2, '仅应替换 pending 为裁定官答疑，不得追加系统征询通知');
    assert.ok(msgsAfterInquiry.some((m) => m.id === inquiryReplyMsg.id));
    assert.ok(!msgsAfterInquiry.some((m) => m.id === pendingInquiryMsg.id));
    assert.ok(!msgsAfterInquiry.some((m) => m.agentBadge === 'Concurrence Verification'));
    const updatedCard = messagesState['thread-ch-1']?.[0]?.topicData;
    assert.equal(updatedCard?.repliesCount, 2);
    assert.equal(updatedCard?.latestReplyPreview, inquiryReplyMsg.content.slice(0, 60));

    // 对照验证：当仲裁官提交了显式新裁决契约 (acpResp.rulingDraft) 时，正常重开新一轮无异议征询并发送系统通知
    const revisedDraft: ArbitrationRulingDraft = {
      ...draft,
      summary: '修订方案：完整回应 3 项阻塞条件并锁定静态 HTML 边界。',
      solution: '锁定静态 HTML 单文件实现，补充幂等退避窗口与接地真值布尔校验。',
    };
    const revisedArbiterMsg: Message = {
      ...inquiryReplyMsg,
      id: 'msg-arbiter-revised-reply',
      content: `已根据 3 项条件修订方案。${arbiterMentions}`,
    };
    await capturedProcessArbitration!({
      topicId: topicStateRef.id,
      arbiterAgent: mockAgents[3],
      acpResp: {
        textResponse: revisedArbiterMsg.content,
        rulingDraft: revisedDraft,
        mcpToolCalls: [{ name: 'submit_arbitration_ruling', status: 'success' }],
        isEmptyTurn: false,
        isError: false,
      } as any,
      turnSnapshot: { epoch: 2, sessionEpoch: 1, threadId: topicStateRef.id } as any,
      candidateAgents: mockAgents,
      topicChannel,
      arbiterReply: revisedArbiterMsg,
    });

    assert.equal(updateTopicCallCount, 1, '提交显式新裁决契约时必须正常更新征询状态');
    assert.notEqual(
      topicStateRef.gameTheoreticState?.concurrenceState?.solutionDigest,
      blockedState.solutionDigest,
      '新裁决契约必须绑定新的方案摘要'
    );
    assert.equal(
      topicStateRef.gameTheoreticState?.concurrenceState?.items.filter((i) => i.status === 'pending').length,
      3,
      '新方案重开征询时各参研角色应恢复 pending 等待独立审视'
    );
    const msgsAfterRevision = messagesState[topicStateRef.id] || [];
    assert.ok(msgsAfterRevision.some((m) => m.id === revisedArbiterMsg.id));
    assert.ok(msgsAfterRevision.some((m) => m.agentBadge === 'Concurrence Verification'));
  } finally {
    if (root) {
      await React.act(async () => {
        root!.unmount();
      });
    }
    g.document = prevDoc;
    g.window = prevWin;
    g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    g.HTMLIFrameElement = prevIframe;
  }
}
console.log('✓ useArbitrationConcurrence 阻塞态防重入跳过与新契约正常重开集成测试通过');

console.log('\n================================================================================');
console.log('🎉 结构化无异议票 P0/P1 回归全部通过：自然语言零授权，阻塞追问防重入，范围漂移受控');
console.log('================================================================================');

function fullDateTestStr(): string {
  return formatFullDateTime();
}
