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
} from './arbitrationConcurrenceGovernor';
import { generateAdrMarkdown } from '../../components/LivingAdrCanvas';
import {
  Agent,
  TopicMessageData,
  ArbitrationRulingDraft,
  GameRoleConcurrenceState,
} from '../../types';

console.log('================================================================================');
console.log('🧪 CognoNexus: 综合裁定官最终敲定、@角色保证回复无异议与活体看板生成自动化测试');
console.log('================================================================================\n');

// 构造测试 Agent 数据
const mockAgents: Agent[] = [
  {
    id: 'agent-proposer',
    name: 'Architect_Linus',
    handle: '@arch-linus',
    role: '架构师提案方',
    avatar: '🏛️',
    description: '核心系统架构设计',
    status: 'idle',
  },
  {
    id: 'agent-challenger',
    name: 'RedTeam_Sentinel',
    handle: '@red-sentinel',
    role: '红队对抗专家',
    avatar: '⚔️',
    description: '极限并发与网络抖动边界证伪',
    status: 'idle',
  },
  {
    id: 'agent-verifier',
    name: 'QA_Grounding',
    handle: '@qa-verifier',
    role: '接地实证检验员',
    avatar: '🔍',
    description: '物理代码与沙箱运行真值检验',
    status: 'idle',
  },
  {
    id: 'agent-arbiter',
    name: 'Chief_Arbiter_Sophia',
    handle: '@arbiter-sophia',
    role: '终局综合裁定官',
    avatar: '⚖️',
    description: '客观权衡与终局决策敲定',
    status: 'idle',
  },
];

const mockTopic: TopicMessageData = {
  id: 'topic-gt-999',
  scopeType: 'channel',
  workspaceBindingId: 'ws-1',
  title: '分布式订单防重与幂等状态机选型',
  description: '高并发秒杀场景下，选择 Redis 分布式锁还是数据库排他行锁与版本号。',
  status: 'active',
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
assert.ok(adrMarkdown.includes('## ⚖️ 3. 架构权衡矩阵与工程防线 (Trade-off Matrix & Invariants)'), '包含权衡矩阵章节');
assert.ok(adrMarkdown.includes('## 🛡️ 4. 限定安全爆炸半径 (Bounded Impact Radius)'), '包含爆炸半径白名单章节');
assert.ok(adrMarkdown.includes('src/services/orderLock.ts'), '包含限定白名单文件');

// 6.4 验证落地执行清单
assert.ok(adrMarkdown.includes('## 📋 5. 落地执行与工程交付清单 (Actionable Checklist)'), '包含落地执行清单');

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

console.log('\n================================================================================');
console.log('🎉 全部 6 项核心机制与边界回归测试 100% 通过！');
console.log('================================================================================');
