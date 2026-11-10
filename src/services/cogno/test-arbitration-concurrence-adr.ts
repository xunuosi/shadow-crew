import assert from 'node:assert/strict';
import {
  advanceRoleConcurrenceItem,
  buildArbiterStage5Directive,
  buildFinalRulingFromConcurrence,
  buildRoleConcurrencePrompt,
  checkAllRolesConcurred,
  compileHumanReadableLivingAdr,
  computeRoleConcurrenceSolutionDigest,
  escapeTableCell,
  evaluateRulingGates,
  formatFullDateTime,
  normalizeMentionHandle,
  prepareConcurrenceState,
  validateArbiterConcurrenceMentions,
} from './arbitrationConcurrenceGovernor';
import { extractRoleConcurrenceFromAcpResponse } from '../acpClient';
import { generateAdrMarkdown } from '../../components/LivingAdrCanvas';
import {
  Agent,
  ArbitrationRulingDraft,
  GameRoleConcurrenceState,
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

console.log('\n================================================================================');
console.log('🎉 结构化无异议票 P0 回归全部通过：自然语言零授权，条件/异议/错绑/缺 @ 全部阻塞');
console.log('================================================================================');

function fullDateTestStr(): string {
  return formatFullDateTime();
}
