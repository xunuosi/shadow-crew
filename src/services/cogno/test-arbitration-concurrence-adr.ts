import assert from 'node:assert/strict';
import {
  buildArbiterStage5Directive,
  buildRoleConcurrencePrompt,
  evaluateRoleConcurrenceStatement,
  checkAllRolesConcurred,
  prepareConcurrenceState,
  advanceRoleConcurrenceItem,
  buildFinalRulingFromConcurrence,
  compileHumanReadableLivingAdr,
  normalizeMentionHandle,
  escapeTableCell,
  formatFullDateTime,
  evaluateRulingGates,
} from './arbitrationConcurrenceGovernor';
import { generateAdrMarkdown } from '../../components/LivingAdrCanvas';
import {
  Agent,
  TopicMessageData,
  ArbitrationRulingDraft,
  GameRoleConcurrenceState,
  RulingRecord,
} from '../../types';

console.log('================================================================================');
console.log('🧪 CognoNexus: 综合裁定官最终敲定、@角色保证回复无异议与活体看板生成自动化测试');
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

// 构造测试 Agent 数据
const mockAgents: Agent[] = [
  createMockAgent({
    id: 'agent-proposer',
    name: 'Architect_Linus',
    handle: '@arch-linus',
    role: '架构师提案方',
    avatar: '🏛️',
    description: '核心系统架构设计',
  }),
  createMockAgent({
    id: 'agent-challenger',
    name: 'RedTeam_Sentinel',
    handle: '@red-sentinel',
    role: '红队对抗专家',
    avatar: '⚔️',
    description: '极限并发与网络抖动边界证伪',
  }),
  createMockAgent({
    id: 'agent-verifier',
    name: 'QA_Grounding',
    handle: '@qa-verifier',
    role: '接地实证检验员',
    avatar: '🔍',
    description: '物理代码与沙箱运行真值检验',
  }),
  createMockAgent({
    id: 'agent-arbiter',
    name: 'Chief_Arbiter_Sophia',
    handle: '@arbiter-sophia',
    role: '终局综合裁定官',
    avatar: '⚖️',
    description: '客观权衡与终局决策敲定',
  }),
];

const mockTopic: TopicMessageData = {
  id: 'topic-gt-999',
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
  participatingAgentIds: mockAgents.map((a) => a.id),
};

// -----------------------------------------------------------------------------
// 测试 1: 综合裁定官在阶段 5 的提示词引导
// 必须满足：裁定官负责最终敲定，并在正文中显式 @ 参研关键角色征询无异议确认
// -----------------------------------------------------------------------------
console.log('--- 测试 1: 综合裁定官阶段 5 Prompt 生成与显式 @ 角色征询 ---');
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

assert.ok(arbiterDirective.includes('综合裁定官 (Chief Arbitrator)'), '包含综合裁定官职责定义');
assert.ok(arbiterDirective.includes('负责本议题架构方案的最终敲定'), '明确综合裁定官负责最终敲定');
assert.ok(arbiterDirective.includes('@arch-linus'), '显式 @ 提案方智能体');
assert.ok(arbiterDirective.includes('@red-sentinel'), '显式 @ 红队对抗智能体');
assert.ok(arbiterDirective.includes('@qa-verifier'), '显式 @ 接地实证智能体');
assert.ok(arbiterDirective.includes('无异议 / Concurred'), '要求被 @ 角色保证回复无异议后敲定');
assert.ok(arbiterDirective.includes('活体决策看板 (Living ADR Canvas)'), '明确出具活体决策看板');
console.log('✓ [通过] 综合裁定官 Prompt 严格满足负责最终敲定与 @ 关键角色征询守则');

// -----------------------------------------------------------------------------
// 测试 2: 参研角色收到无异议征询时的核验 Prompt
// -----------------------------------------------------------------------------
console.log('\n--- 测试 2: 参研角色终局无异议核验 Prompt ---');
const challengerConcurrencePrompt = buildRoleConcurrencePrompt({
  roleAgent: mockAgents[1],
  roleName: 'challenger',
  arbiterName: mockAgents[3].name,
  arbiterText: '拟定裁定方案：采纳提案方 Redis 方案，但前置必须强制落地 DB 唯一版本防线。',
  topicTitle: mockTopic.title,
  topicDescription: mockTopic.description,
});

assert.ok(challengerConcurrencePrompt.includes('议题终局裁决无异议核验征询'), '包含核验征询标题');
assert.ok(challengerConcurrencePrompt.includes('Chief_Arbiter_Sophia'), '包含综合裁定官具名');
assert.ok(challengerConcurrencePrompt.includes('【无异议确认 / Concurred】'), '包含无异议确认契约要求');
console.log('✓ [通过] 参研角色无异议核验 Prompt 结构规范');

// -----------------------------------------------------------------------------
// 测试 3: 角色无异议陈述的真值评定矩阵 (Positive & Negative Matrix)
// -----------------------------------------------------------------------------
console.log('\n--- 测试 3: 角色无异议陈述评定矩阵 (Positive & Negative Matrix) ---');

// 3.1 正例：标准无异议
const pos1 = evaluateRoleConcurrenceStatement(
  '【无异议确认 / Concurred】\n经审视，裁定方案已强制 DB 唯一键作为保底防线，红队指出的一致性风险已消除，确认无异议。'
);
assert.equal(pos1.isConcurred, true, '标准无异议通过');
assert.ok(pos1.statement.includes('红队指出的一致性风险已消除'), '成功提取核心立场陈述');

// 3.2 正例：口语化自然语言认同
const pos2 = evaluateRoleConcurrenceStatement(
  '经全面核查代码实现，该方案在架构层面自洽，完全认同该终局方案并达成共识，准予通过。'
);
assert.equal(pos2.isConcurred, true, '自然语言无异议认同通过');

// 3.3 反例：仍有严重阻断性异议
const neg1 = evaluateRoleConcurrenceStatement(
  '我对此方案存在阻断性异议！跨机房网络延迟下分布式锁失效问题依然未被彻底解决。'
);
assert.equal(neg1.isConcurred, false, '存在阻断性异议正确判定为未通过');

// 3.4 反例：否决
const neg2 = evaluateRoleConcurrenceStatement(
  '方案存在致命漏洞未解决，坚决反对直接上线！'
);
assert.equal(neg2.isConcurred, false, '坚决反对正确判定为未通过');

console.log('✓ [通过] 无异议状态判定矩阵验证无误 (正向识别与反向拦截 100% 准确)');

// -----------------------------------------------------------------------------
// 测试 4: 全员无异议保证状态机推进 (State Progression)
// -----------------------------------------------------------------------------
console.log('\n--- 测试 4: 全员无异议状态机推进与流转保证 ---');

const draft: ArbitrationRulingDraft = {
  decisionType: 'trade_off_matrix',
  summary: '采纳两层防线权衡方案：内存缓存锁提速 + 数据库行级版本号硬防穿透。',
  solution: '第一阶段实现 Redis 分布式防重，第二阶段合入 DB 唯一约束与补偿重试。',
  tradeOffPoints: [
    '优先保障高并发秒杀响应速度 (90% 场景走缓存快速拦截)',
    '适度牺牲锁释放异常时的 DB 重试开销，杜绝超卖死锁',
  ],
  impactedFiles: ['src/services/orderLock.ts', 'src/db/migrations/add_unique_idempotent.sql'],
};

// 4.1 初始化征询状态
let concurrenceState = prepareConcurrenceState({
  topic: mockTopic,
  candidateAgents: mockAgents,
  arbiterDraft: draft,
  arbiterReplyText: draft.summary,
});

assert.equal(concurrenceState.isConcurrencePhaseActive, true, '征询阶段已激活');
assert.equal(concurrenceState.items.length, 3, '包含 3 位参研角色 (提案/红队/实证)');
assert.equal(concurrenceState.allConcurred, false, '初始状态尚未全员无异议');

// 4.2 角色 1 (提案方) 确认无异议
concurrenceState = advanceRoleConcurrenceItem(
  concurrenceState,
  'agent-proposer',
  '【无异议确认 / Concurred】认可增加 DB 版本号作为第二道防线，方案完备自洽。'
);
assert.equal(concurrenceState.items[0].status, 'concurred');
assert.equal(concurrenceState.allConcurred, false, '仅 1/3 确认，状态机保持 pending');
assert.equal(checkAllRolesConcurred(concurrenceState), false);

// 4.3 角色 2 (红队方) 确认无异议
concurrenceState = advanceRoleConcurrenceItem(
  concurrenceState,
  'agent-challenger',
  '【无异议确认 / Concurred】核心反例均已覆盖降级逻辑，同意终局方案敲定。'
);
assert.equal(concurrenceState.items[1].status, 'concurred');
assert.equal(concurrenceState.allConcurred, false, '2/3 确认，状态机保持 pending');

// 4.4 角色 3 (实证方) 确认无异议 -> 达成全员无异议保证！
concurrenceState = advanceRoleConcurrenceItem(
  concurrenceState,
  'agent-verifier',
  '【无异议确认 / Concurred】沙箱压测 1000 并发零重复订单，实证通过，确认无异议。'
);
assert.equal(concurrenceState.items[2].status, 'concurred');
assert.equal(concurrenceState.allConcurred, true, '全员 3/3 已保证无异议！');
assert.equal(checkAllRolesConcurred(concurrenceState), true);
assert.ok(concurrenceState.concludedAt, '记录敲定时间戳');

// 4.5 故障注入测试：角色坚持阻断异议（Objection），系统严格拒绝通过并挂起敲定
const objectedState = advanceRoleConcurrenceItem(
  prepareConcurrenceState({
    topic: mockTopic,
    candidateAgents: mockAgents,
    arbiterDraft: draft,
    arbiterReplyText: draft.summary,
  }),
  'agent-challenger',
  '【存在阻断性异议】网络分区时主从切换依然存在 50ms 锁租约漂移空窗，坚决反对直接上线！'
);
assert.equal(objectedState.items.find((i) => i.agentId === 'agent-challenger')?.status, 'objected');
assert.equal(objectedState.allConcurred, false, '有角色存在异议时 allConcurred 必须为 false');
assert.equal(checkAllRolesConcurred(objectedState), false, '严格阻止综合裁定官越级敲定');
console.log('✓ [通过] 异议挂起与防越级敲定故障注入断言通过');
console.log('✓ [通过] 全员无异议状态机推进逻辑严密，无缺漏');

// -----------------------------------------------------------------------------
// 测试 5: 综合裁定官负责最终敲定方案并出具最后的活体看板 (Living ADR Canvas)
// -----------------------------------------------------------------------------
console.log('\n--- 测试 5: 综合裁定官敲定方案与活体看板生成 ---');

const finalRuling = buildFinalRulingFromConcurrence({
  topic: mockTopic,
  arbiterAgent: mockAgents[3],
  concurrenceState,
  extractedDraft: draft,
  candidateAgents: mockAgents,
});

assert.equal(finalRuling.arbiterName, 'Chief_Arbiter_Sophia', '裁决由综合裁定官签署');
assert.equal(finalRuling.decisionType, 'trade_off_matrix', '裁定类型为权衡折中');
assert.ok(finalRuling.concurrenceSignOff?.allConcurred, '全员无异议签署标记为 true');
assert.equal(finalRuling.concurrenceSignOff?.records.length, 3, '包含 3 项角色签署记录');
assert.equal(finalRuling.executorId, undefined, '自动敲定裁决不预设执行者 (H1)，严防未授权自动代码派发');
assert.ok(finalRuling.livingAdrMarkdown, '生成了完整的活体 ADR 看板 Markdown');
console.log('✓ [通过] 综合裁定官敲定记录结构完整，签署链完备');

// -----------------------------------------------------------------------------
// 测试 6: 人类可读性强 (Human-Readable Living ADR Content) 验收
// -----------------------------------------------------------------------------
console.log('\n--- 测试 6: 人类可读性强 (Human-Readable Living ADR Content) 深度验收 ---');

const adrMarkdown = finalRuling.livingAdrMarkdown!;

// 6.1 验证通俗大白话总览
assert.ok(adrMarkdown.includes('## 🌟 1. 大白话终局方案总览 (Executive Summary)'), '包含大白话总览章节');
assert.ok(adrMarkdown.includes('💡 **决策核心**'), '包含决策核心高亮');
assert.ok(adrMarkdown.includes(draft.summary), '包含通俗决策陈述');

// 6.2 验证全员无异议共识签署链表格
assert.ok(adrMarkdown.includes('## 🤝 2. 全员无异议共识签署 (Unanimous Concurrence Sign-off)'), '包含全员无异议共识签署章节');
assert.ok(adrMarkdown.includes('Architect_Linus'), '签署表包含提案方姓名');
assert.ok(adrMarkdown.includes('RedTeam_Sentinel'), '签署表包含红队方姓名');
assert.ok(adrMarkdown.includes('QA_Grounding'), '签署表包含检验方姓名');
assert.ok(adrMarkdown.includes('✅ 无异议 (Concurred)'), '包含清晰无异议印章');

// 6.3 验证架构权衡防线与限定爆炸半径
assert.ok(adrMarkdown.includes('## 6. 架构权衡矩阵与工程防线 (Trade-off Matrix & Invariants)'), '包含权衡矩阵章节');
assert.ok(adrMarkdown.includes('## 8. 限定安全爆炸半径 (Bounded Impact Radius)'), '包含爆炸半径白名单章节');
assert.ok(adrMarkdown.includes('src/services/orderLock.ts'), '包含限定白名单文件');

// 6.4 验证落地执行清单
assert.ok(adrMarkdown.includes('## 9. 落地执行与工程交付清单 (Actionable Checklist)'), '包含落地执行清单');

// 6.5 验证 generateAdrMarkdown 在传入 topic 时的可读性映射
const topicWithRuling: TopicMessageData = {
  ...mockTopic,
  rulingRecord: finalRuling,
  gameTheoreticState: {
    currentStage: 'concluded',
    concurrenceState,
    rulingDraft: draft,
  },
};
const exportedMarkdown = generateAdrMarkdown(topicWithRuling, mockAgents);
assert.ok(exportedMarkdown.includes('Executive Summary') || exportedMarkdown.includes('大白话终局方案总览'), '导出的 ADR Markdown 具备通俗总览');
assert.ok(exportedMarkdown.includes('Unanimous Concurrence') || exportedMarkdown.includes('全员无异议共识签署'), '导出的 ADR Markdown 具备全员签署');

console.log('✓ [通过] 活体 ADR 看板的人类可读性强，通俗摘要、全员签署、权衡防线与清单一目了然！');

// -----------------------------------------------------------------------------
// 测试 7: 14 项反向对抗与边界硬门禁严格自证 (Adversarial Regression Test Suite)
// -----------------------------------------------------------------------------
console.log('\n--- 测试 7: 14 项反向对抗与边界硬门禁严格自证 ---');

// [A2] “我不认同该终局方案，存在重大风险。” -> 必须拒绝通过
const resA2 = evaluateRoleConcurrenceStatement('我不认同该终局方案，存在重大风险。');
assert.equal(resA2.isConcurred, false, '[A2] “我不认同”必须拦截判定为未通过');
console.log('✓ [A2] 否定句式拦截测试通过: “我不认同该终局方案...” -> isConcurred = false');

// [A3] “我不同意该方案，必须重构。” -> 必须拒绝通过
const resA3 = evaluateRoleConcurrenceStatement('我不同意该方案，必须重构。');
assert.equal(resA3.isConcurred, false, '[A3] “我不同意”必须拦截判定为未通过');
console.log('✓ [A3] 否定句式拦截测试通过: “我不同意该方案...” -> isConcurred = false');

// [A4] “并非无异议，建议补充熔断机制。” -> 必须拒绝通过
const resA4 = evaluateRoleConcurrenceStatement('并非无异议，建议补充熔断机制。');
assert.equal(resA4.isConcurred, false, '[A4] “并非无异议”必须拦截判定为未通过');
console.log('✓ [A4] 否定句式拦截测试通过: “并非无异议...” -> isConcurred = false');

// [A5] “I cannot concur with this plan.” -> 必须拒绝通过
const resA5 = evaluateRoleConcurrenceStatement('I cannot concur with this plan.');
assert.equal(resA5.isConcurred, false, '[A5] “cannot concur”必须拦截判定为未通过');
console.log('✓ [A5] 英文否定拦截测试通过: “I cannot concur...” -> isConcurred = false');

// [A6] “我认同整体方向，但反对直接上线。” -> 必须拒绝通过
const resA6 = evaluateRoleConcurrenceStatement('我认同整体方向，但反对直接上线。');
assert.equal(resA6.isConcurred, false, '[A6] “认同...但反对”必须拦截判定为未通过');
console.log('✓ [A6] 转折反对拦截测试通过: “我认同整体方向，但反对直接上线” -> isConcurred = false');

// [G1–G6, G11] 良性/免责/吸收反转语义放行测试 (避免合法无异议被误杀)
const resG1 = evaluateRoleConcurrenceStatement('未发现致命漏洞，确认无异议。');
assert.equal(resG1.isConcurred, true, '[G1] “未发现致命漏洞，确认无异议”必须正确判定为通过');
console.log('✓ [G1] 放行测试通过: “未发现致命漏洞，确认无异议” -> isConcurred = true');

const resG2 = evaluateRoleConcurrenceStatement('不存在阻断性异议，确认无异议。');
assert.equal(resG2.isConcurred, true, '[G2] “不存在阻断性异议，确认无异议”必须正确判定为通过');
console.log('✓ [G2] 放行测试通过: “不存在阻断性异议，确认无异议” -> isConcurred = true');

const resG3 = evaluateRoleConcurrenceStatement('方案已消除重大风险，确认无异议。');
assert.equal(resG3.isConcurred, true, '[G3] “方案已消除重大风险，确认无异议”必须正确判定为通过');
console.log('✓ [G3] 放行测试通过: “方案已消除重大风险，确认无异议” -> isConcurred = true');

const resG4 = evaluateRoleConcurrenceStatement('反对意见已被充分吸收，确认无异议。');
assert.equal(resG4.isConcurred, true, '[G4] “反对意见已被充分吸收，确认无异议”必须正确判定为通过');
console.log('✓ [G4] 放行测试通过: “反对意见已被充分吸收，确认无异议” -> isConcurred = true');

const resG5 = evaluateRoleConcurrenceStatement('方案可行，我不持异议。');
assert.equal(resG5.isConcurred, true, '[G5] “方案可行，我不持异议”必须正确判定为通过');
console.log('✓ [G5] 放行测试通过: “方案可行，我不持异议” -> isConcurred = true');

const resG6 = evaluateRoleConcurrenceStatement('该方案没有重大风险，确认无异议。');
assert.equal(resG6.isConcurred, true, '[G6] “该方案没有重大风险，确认无异议”必须正确判定为通过');
console.log('✓ [G6] 放行测试通过: “该方案没有重大风险，确认无异议” -> isConcurred = true');

const resG11 = evaluateRoleConcurrenceStatement('我不反对该方案，确认无异议。');
assert.equal(resG11.isConcurred, true, '[G11] “我不反对该方案，确认无异议”必须正确判定为通过');
console.log('✓ [G11] 放行测试通过: “我不反对该方案，确认无异议” -> isConcurred = true');

// [B1] 将含 objected/unavailable 的状态传入 buildFinalRulingFromConcurrence -> 必须抛错阻止产出伪全票
const dirtyState: GameRoleConcurrenceState = {
  isConcurrencePhaseActive: true,
  items: [
    { role: 'proposer', agentId: 'agent-proposer', agentName: 'Architect_Linus', status: 'concurred', statement: 'ok' },
    { role: 'challenger', agentId: 'agent-challenger', agentName: 'RedTeam_Sentinel', status: 'objected', statement: '反对' },
  ],
  allConcurred: false,
};
assert.throws(
  () => {
    buildFinalRulingFromConcurrence({
      topic: mockTopic,
      arbiterAgent: mockAgents[3],
      concurrenceState: dirtyState,
      extractedDraft: draft,
      candidateAgents: mockAgents,
    });
  },
  /存在未达成真实无异议确认的角色/,
  '[B1] 存在异议时调用 buildFinalRulingFromConcurrence 必须抛出异常阻止定案'
);
console.log('✓ [B1] 防伪全票强断言通过: 有异议/未全票时禁止构造终局裁决');

// [B2] advanceRoleConcurrenceItem 处理异议与离线不可用角色时如实记录状态
const testAdvanceUnavailable = advanceRoleConcurrenceItem(
  concurrenceState,
  'agent-challenger',
  '智能体离线',
  true // isUnavailable
);
const unavailItem = testAdvanceUnavailable.items.find((i) => i.agentId === 'agent-challenger');
assert.equal(unavailItem?.status, 'unavailable', '[B2] 离线/异常角色必须如实标记为 unavailable');
assert.equal(testAdvanceUnavailable.allConcurred, false, '[B2] 存在 unavailable 角色时 allConcurred 必须为 false');
assert.equal(checkAllRolesConcurred(testAdvanceUnavailable), false, '[B2] checkAllRolesConcurred 必须返回 false');
console.log('✓ [B2] 离线与不可用状态如实记录，杜绝伪造无异议');

// [C1] 看板头部“敲定日期”必须包含完整年月日
const fullDateTestStr = formatFullDateTime();
assert.match(fullDateTestStr, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '[C1] 日期必须满足 YYYY-MM-DD HH:mm 完整年月日规范');
assert.ok(adrMarkdown.includes(fullDateTestStr.slice(0, 10)), '[C1] ADR 看板中包含完整年月日');
console.log(`✓ [C1] 完整年月日日期格式化通过: ${fullDateTestStr}`);

// [C2] 看板完整保留红队对抗与实证章节资产
const topicWithEvidence: TopicMessageData = {
  ...mockTopic,
  gameTheoreticState: {
    currentStage: 'concluded',
    targetProposalContent: '提案：使用 Redis 配合租约防重。',
    targetChallengeContent: '红队证伪反例：网络抖动 500ms 时租约提前过期导致并发重入。',
    targetVerificationContent: '接地实证：Jepsen 物理测试复现重入，发现脏写入。',
    mcdaPayload: {
      solverType: 'BWM',
      criteria: [
        { id: 'safety', name: '数据安全性', direction: 'maximize' },
        { id: 'perf', name: '响应延迟', direction: 'minimize' },
      ],
      alternatives: ['Redis分布式锁', 'DB行锁版本号'],
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
      coreDissentThesis: '对纯缓存防重持有根本疑虑，主张一律前置 DB 行锁。',
      rationalityBasis: '银行级金融账务零容忍超卖。',
      reopeningTriggers: ['生产环境出现一次超卖异常报警'],
      recordedAt: fullDateTestStr,
    },
  },
};
const richAdr = compileHumanReadableLivingAdr({
  topic: topicWithEvidence,
  agents: mockAgents,
  ruling: finalRuling,
  concurrenceItems: concurrenceState.items,
});
assert.ok(richAdr.includes('## 4. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)'), '[C2] 包含红队证伪章节');
assert.ok(richAdr.includes('网络抖动 500ms 时租约提前过期导致并发重入'), '[C2] 完整保留红队对抗反例');
assert.ok(richAdr.includes('## 5. 接地实证与验证结论 (Empirical Verification)'), '[C2] 包含接地实证章节');
assert.ok(richAdr.includes('Jepsen 物理测试复现重入'), '[C2] 完整保留物理实证记录');
console.log('✓ [C2] 红队证伪与接地物理实证资产完整保留');

// [C3] 看板包含伴生少数派异议报告与黑天鹅重启触发器
assert.ok(richAdr.includes('## 7. 伴生少数派异议备案 (Minority Dissent & Black Swan Triggers)'), '[C3] 包含少数派异议章节');
assert.ok(richAdr.includes('生产环境出现一次超卖异常报警'), '[C3] 包含黑天鹅重启触发器');
console.log('✓ [C3] 少数派异议备案与黑天鹅重启触发器完整保留');

// [C4] 看板包含 MCDA BWM 运筹权衡一致性指标 ξ*
assert.ok(richAdr.includes('MCDA 运筹最优最劣法 (BWM) 数学权衡参考'), '[C4] 包含 MCDA 章节');
assert.ok(richAdr.includes('\\xi^* = 0.08'), '[C4] 包含一致性指标 ξ* 数学公式');
assert.ok(richAdr.includes('通过 (<= 0.12)'), '[C4] 包含一致性达标声明');
console.log('✓ [C4] MCDA BWM 运筹一致性指标 ξ* 严格呈现');

// [D1] 人工法槌裁决（无全员征询）导出 ADR 时不得谎称“全员无异议”
const humanGavelRuling: RulingRecord = {
  decisionType: 'adopt_proposer',
  arbiterId: 'human-user',
  arbiterName: 'Chief_Human_Arbiter',
  summary: '人类裁定官直接法槌裁决方案。',
  solution: '合入代码补丁。',
  decidedAt: fullDateTestStr,
  // concurrenceSignOff is undefined
};
const topicWithHumanGavel: TopicMessageData = {
  ...mockTopic,
  rulingRecord: humanGavelRuling,
};
const humanGavelAdr = generateAdrMarkdown(topicWithHumanGavel, mockAgents);
assert.equal(humanGavelAdr.includes('全员无异议签署'), false, '[D1] 人工裁决严禁标注全员无异议签署');
assert.ok(
  humanGavelAdr.includes('仲裁法定定案') || humanGavelAdr.includes('未附带参研角色前置无异议征询链'),
  '[D1] 如实标注仲裁法定定案，未附带前置无异议征询链'
);
console.log('✓ [D1] 人工法槌裁决看板真实性无谎报保证通过');

// [E1] 表格单元格中包含竖线时，必须安全转义，防止破坏 Markdown 表格列结构
const escapedCell = escapeTableCell('方案 A | 方案 B | 方案 C\n换行内容');
assert.equal(/(?<!\\)\|/.test(escapedCell), false, '[E1] 裸竖线已被全部转义为 \\|');
assert.ok(escapedCell.includes('\\|'), '[E1] 成功转义为 \\|');
assert.equal(escapedCell.includes('\n'), false, '[E1] 换行符已转为空格');
console.log('✓ [E1] Markdown 表格单元格转义防错列机制通过');

// [F1] 裁定官阶段 5 Prompt 生成单个 @，严禁生成 @@ 双 @ 句柄
const singleHandle = normalizeMentionHandle(mockAgents[0]); // mockAgents[0].handle is '@arch-linus'
assert.equal(singleHandle, '@arch-linus', '[F1] 规范化 handle 为单个 @');
assert.equal(singleHandle.includes('@@'), false, '[F1] 绝不出现 @@ 语法缺陷');
const arbiterDirectiveCheck = buildArbiterStage5Directive({
  topic: {
    title: mockTopic.title,
    description: mockTopic.description,
    gameRoles: mockTopic.gameRoles,
  },
  arbiterAgent: mockAgents[3],
  availableAgents: mockAgents,
});
assert.equal(arbiterDirectiveCheck.includes('@@'), false, '[F1] 裁定官提示词正文中无任何 @@ 双句柄');
assert.ok(arbiterDirectiveCheck.includes('@arch-linus'), '[F1] 包含合法的单个 @ 句柄');
console.log('✓ [F1] 阶段 5 提示词杜绝 @@ 语法缺陷检验通过');

// [J5] 零参研角色时不得进行自征询，征询阶段必须为 false
const topicNoPeers: TopicMessageData = {
  ...mockTopic,
  gameRoles: {
    proposers: [],
    challengers: [],
    verifiers: [],
    arbiters: ['agent-arbiter'],
    humanIsArbiter: false,
  },
};
const zeroPeerState = prepareConcurrenceState({
  topic: topicNoPeers,
  candidateAgents: [mockAgents[3]],
});
assert.equal(zeroPeerState.isConcurrencePhaseActive, false, '[J5] 零参研角色时不得自征询，征询阶段必须为 false');
assert.equal(zeroPeerState.items.length, 0, '[J5] 零参研角色时征询项必须为空');
console.log('✓ [J5] 零参研角色边界处理自证通过: isConcurrencePhaseActive = false');

// [L6] 门禁一致性集中评定函数 (evaluateRulingGates)
const normalGates = evaluateRulingGates(mockTopic, { consistencyPassed: true, consistencyIndex: 0.05 } as any);
assert.equal(normalGates.allGatesPassed, true, '[L6] 正常通过门禁');
const bypassedTopic: TopicMessageData = {
  ...mockTopic,
  gameTheoreticState: {
    currentStage: 'arbitration',
    isChallengerBypassed: true,
    isChallengerResponded: false,
  },
};
const bypassedGates = evaluateRulingGates(bypassedTopic, { consistencyPassed: true, consistencyIndex: 0.05 } as any);
assert.equal(bypassedGates.isChallengerQuorumMet, true, '[L6] 快速通道旁路红队时法定人数必须满足');
console.log('✓ [L6] 集中门禁评定 (evaluateRulingGates) 一致性通过');

console.log('\n================================================================================');
console.log('🎉 全部 7 组核心机制 + 原 14 项反向对抗 + 新增 G1~G6/G11/H1/J5/L6 自证 100% 通过！');
console.log('================================================================================');
