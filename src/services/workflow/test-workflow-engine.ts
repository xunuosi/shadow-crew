import assert from 'node:assert/strict';
import type { Agent, TopicWorkflowState, WorkflowStageKey } from '../../types';
import {
  aggregateReviewVerdict,
  applyStageOutcome,
  buildWorkflowProgressView,
  buildWorkflowPrompt,
  createWorkflowPlan,
  initializeWorkflowState,
  isVerificationPassed,
  markWorkflowStageActive,
  parseDesignArtifact,
  parseReviewReport,
  parseVerificationReport,
  truncateArtifactForPrompt,
  type WorkflowStageOutput,
} from './index';
import {
  REVIEW_REPORT_CLOSE,
  REVIEW_REPORT_OPEN,
  VERIFY_REPORT_CLOSE,
  VERIFY_REPORT_OPEN,
} from './workflowGates';

console.log('=== Workflow Spec / Engine Test Suite ===');

const authorAgent = {
  id: 'agent-author',
  name: 'Backend Dev',
  handle: '@backend',
  role: 'Backend Engineer',
  description: '实现后端接口',
} as unknown as Agent;
const criticAgent = {
  id: 'agent-critic',
  name: 'Security Reviewer',
  handle: '@security',
  role: 'Security Reviewer',
  description: '安全与代码评审',
} as unknown as Agent;
const verifierAgent = {
  id: 'agent-verifier',
  name: 'QA Bot',
  handle: '@qa',
  role: 'QA Automation',
  description: '自动化测试与验收',
} as unknown as Agent;

function output(
  agent: Agent,
  content: string,
  extra: Partial<WorkflowStageOutput> = {}
): WorkflowStageOutput {
  return {
    agentId: agent.id,
    agentName: agent.name,
    messageId: `msg-${agent.id}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    ...extra,
  };
}

function runStage(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey,
  outputs: WorkflowStageOutput[]
): ReturnType<typeof applyStageOutcome> {
  return applyStageOutcome(state, stageKey, outputs, 1_700_000_000_000);
}

function reviewBlock(payload: unknown): string {
  return `评审说明...\n${REVIEW_REPORT_OPEN}\n${JSON.stringify(payload)}\n${REVIEW_REPORT_CLOSE}\n结束`;
}

function verifyBlock(payload: unknown): string {
  return `验收说明...\n${VERIFY_REPORT_OPEN}\n${JSON.stringify(payload)}\n${VERIFY_REPORT_CLOSE}\n结束`;
}

const longDraft = `# Edge 业务实现梳理\n${'主笔正文段落，包含调用链与证据 file:line。'.repeat(20)}\n结论：已确认核心链路。`;
const designWithCriteria = [
  '# 实现方案',
  '## 改动文件清单',
  '- src/services/edge/edgeClient.ts',
  '- src/hooks/useEdge.ts',
  '## 验收标准',
  '- npm run lint 通过',
  '- npm run test:edge 通过',
].join('\n');

// 1. 角色分配：交付模式 3 人时主笔/评审/验收必须分离
{
  const plan = createWorkflowPlan('build', [authorAgent, criticAgent, verifierAgent]);
  assert.equal(plan.blockingIssues.length, 0);
  assert.equal(plan.roles.author, authorAgent.id);
  assert.equal(plan.roles.criticIds.length, 1);
  assert.notEqual(plan.roles.criticIds[0], authorAgent.id);
  assert.equal(plan.roles.verifierId, verifierAgent.id);
  assert.notEqual(plan.roles.verifierId, plan.roles.criticIds[0]);
  console.log('✓ build 三角色分离');
}

// 2. 交付模式仅 2 人时必须显式警告验收独立性下降（不得静默）
{
  const plan = createWorkflowPlan('build', [authorAgent, criticAgent]);
  assert.equal(plan.blockingIssues.length, 0);
  assert.equal(plan.roles.verifierId, plan.roles.criticIds[0]);
  assert.ok(plan.warnings.some((warning) => warning.includes('验收独立性下降')));
  console.log('✓ build 双人降级显式警告');
}

// 3. 评审模式单人必须阻断
{
  const plan = createWorkflowPlan('review', [authorAgent]);
  assert.ok(plan.blockingIssues.length > 0);
  const init = initializeWorkflowState('review', [authorAgent], 'token');
  assert.equal(init.state.status, 'blocked');
  assert.ok(init.state.blockingReason?.includes('至少需要'));
  console.log('✓ review 单人配置阻断');
}

// 4. 咨询模式：主笔 → 独立核验 → 定稿
{
  let { state } = initializeWorkflowState('consult', [authorAgent, criticAgent], 'token-consult');
  const draft = runStage(state, 'consult_draft', [output(authorAgent, longDraft)]);
  assert.equal(draft.decision.kind, 'advance');
  assert.equal(draft.decision.nextStageKey, 'consult_crosscheck');
  state = draft.state;

  const crosscheck = runStage(state, 'consult_crosscheck', [
    output(criticAgent, reviewBlock({ verdict: 'conditional', findings: [{ severity: 'major', title: '遗漏降级路径', evidence: 'edgeClient.ts:88' }] })),
  ]);
  assert.equal(crosscheck.decision.nextStageKey, 'consult_finalize');
  state = crosscheck.state;

  const finalize = runStage(state, 'consult_finalize', [output(authorAgent, `${longDraft}\n核验意见处理：已补充降级路径。`)]);
  assert.equal(finalize.decision.kind, 'complete');
  assert.equal(finalize.state.status, 'completed');
  assert.equal(finalize.state.verdict, 'DELIVERED');
  console.log('✓ consult 完整链路');
}

// 5. 咨询模式无评审者时跳过核验阶段
{
  const { state } = initializeWorkflowState('consult', [authorAgent], 'token-solo');
  const draft = runStage(state, 'consult_draft', [output(authorAgent, longDraft)]);
  assert.equal(draft.decision.nextStageKey, 'consult_finalize');
  console.log('✓ consult 单人跳过核验');
}

// 6. 主笔空回合必须显式失败
{
  const { state } = initializeWorkflowState('consult', [authorAgent], 'token-empty');
  const draft = runStage(state, 'consult_draft', [output(authorAgent, '好的，我来看看。')]);
  assert.equal(draft.decision.kind, 'failed');
  assert.equal(draft.state.status, 'failed');
  console.log('✓ consult 空产出显式失败');
}

// 7. 评审模式：一份无效 + 一份有效 → 继续但记录排除说明；全部无效 → blocked
{
  const { state } = initializeWorkflowState('review', [criticAgent, verifierAgent], 'token-review');
  const partial = runStage(state, 'review_scan', [
    output(criticAgent, '我觉得这个方案不太行'), // 无结构化块
    output(verifierAgent, reviewBlock({ verdict: 'approve', findings: [] })),
  ]);
  assert.equal(partial.decision.kind, 'advance');
  assert.ok(partial.decision.notes.some((note) => note.includes('格式无效')));

  const allInvalid = runStage(state, 'review_scan', [
    output(criticAgent, '没有结构化输出'),
    output(verifierAgent, '也没有'),
  ]);
  assert.equal(allInvalid.decision.kind, 'blocked');
  assert.equal(allInvalid.state.status, 'blocked');
  console.log('✓ review 无效报告 fail-closed');
}

// 8. 评审结论聚合：blocker → BLOCK；major → CONDITIONAL；干净 → APPROVE
{
  assert.equal(
    aggregateReviewVerdict([
      parseReviewReport(reviewBlock({ verdict: 'approve', findings: [{ severity: 'blocker', title: '越权写入', evidence: 'a.ts:1' }] })),
    ]),
    'block'
  );
  assert.equal(
    aggregateReviewVerdict([
      parseReviewReport(reviewBlock({ verdict: 'conditional', findings: [{ severity: 'major', title: '缺回滚', evidence: 'b.ts:2' }] })),
    ]),
    'conditional'
  );
  assert.equal(
    aggregateReviewVerdict([parseReviewReport(reviewBlock({ verdict: 'approve', findings: [] }))]),
    'approve'
  );

  let { state } = initializeWorkflowState('review', [criticAgent, verifierAgent], 'token-review-2');
  state = runStage(state, 'review_scan', [
    output(criticAgent, reviewBlock({ verdict: 'block', findings: [{ severity: 'blocker', title: 'SQL 注入', evidence: 'query.sql:12' }] })),
  ]).state;
  const synth = runStage(state, 'review_synthesize', [
    output(authorAgent, '汇总裁定：共 1 条阻断项（SQL 注入），必须修复后方可上线。其余建议项另行跟踪。\nVERDICT: BLOCK'),
  ]);
  assert.equal(synth.state.status, 'completed');
  assert.equal(synth.state.verdict, 'BLOCK');
  console.log('✓ review 结论聚合');
}

// 9. 评审缺少证据的发现必须降级，不得作为 blocker
{
  const report = parseReviewReport(
    reviewBlock({ verdict: 'block', findings: [{ severity: 'blocker', title: '感觉有问题' }] })
  );
  assert.equal(report.valid, true);
  assert.equal(report.findings[0].severity, 'minor');
  assert.equal(report.unverifiedFindings, 1);
  assert.equal(aggregateReviewVerdict([report]), 'conditional');
  console.log('✓ review 无证据发现降级');
}

// 10. 交付模式：方案缺验收标准 → 首次返工，第二次带说明继续
{
  const { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-build');
  const first = runStage(state, 'build_design', [
    output(authorAgent, `# 方案\n改动文件：src/a.ts\n${'说明'.repeat(80)}`),
  ]);
  assert.equal(first.decision.kind, 'retry');
  assert.equal(first.state.counters.designRevisions, 1);

  const second = runStage(first.state, 'build_design', [
    output(authorAgent, `# 方案\n改动文件：src/a.ts\n${'说明'.repeat(80)}`),
  ]);
  assert.equal(second.decision.kind, 'advance');
  assert.equal(second.decision.nextStageKey, 'build_design_review');
  assert.ok(second.decision.notes.some((note) => note.includes('兜底标准')));
  console.log('✓ build 缺少验收标准返工一次');
}

// 11. 方案评审 blocker → 回退设计；两轮返工后仍阻断则 blocked
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-build-2');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;

  const review = runStage(state, 'build_design_review', [
    output(criticAgent, reviewBlock({ verdict: 'block', findings: [{ severity: 'blocker', title: '缺少兼容迁移', evidence: 'schema.sql:9' }] })),
  ]);
  assert.equal(review.decision.kind, 'retry');
  assert.equal(review.decision.nextStageKey, 'build_design');
  assert.equal(review.state.counters.designRevisions, 1);

  let loopState = runStage(review.state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  const secondReview = runStage(loopState, 'build_design_review', [
    output(criticAgent, reviewBlock({ verdict: 'block', findings: [{ severity: 'blocker', title: '仍缺兼容迁移', evidence: 'schema.sql:9' }] })),
  ]);
  assert.equal(secondReview.decision.kind, 'retry');
  assert.equal(secondReview.state.counters.designRevisions, 2);

  loopState = runStage(secondReview.state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  const thirdReview = runStage(loopState, 'build_design_review', [
    output(criticAgent, reviewBlock({ verdict: 'block', findings: [{ severity: 'blocker', title: '仍缺兼容迁移', evidence: 'schema.sql:9' }] })),
  ]);
  assert.equal(thirdReview.decision.kind, 'blocked');
  assert.equal(thirdReview.state.status, 'blocked');
  console.log('✓ build 设计返工上限阻断');
}

// 12. 实施阶段没有真实文件/命令证据 → 显式失败
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-build-3');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  state = runStage(state, 'build_design_review', [
    output(criticAgent, reviewBlock({ verdict: 'approve', findings: [] })),
  ]).state;
  const impl = runStage(state, 'build_implement', [
    output(authorAgent, '我已经在脑子里把功能实现好了，整体逻辑非常清晰，所有边界都已经考虑完整，不需要再落盘修改任何文件。'),
  ]);
  assert.equal(impl.decision.kind, 'failed');
  assert.ok(impl.decision.reason?.includes('真实文件改动'));
  console.log('✓ build 无落盘证据失败');
}

// 13. 验收 fail-closed：verdict=pass 但零检查 → 不可通过
{
  const report = parseVerificationReport(verifyBlock({ verdict: 'pass', checks: [], failures: [] }));
  assert.equal(report.valid, true);
  assert.equal(isVerificationPassed(report), false);

  const ok = parseVerificationReport(
    verifyBlock({ verdict: 'pass', checks: [{ command: 'npm run lint', output: 'ok', passed: true }], failures: [] })
  );
  assert.equal(isVerificationPassed(ok), true);

  const noBlock = parseVerificationReport('验收通过，没问题');
  assert.equal(noBlock.valid, false);
  assert.equal(isVerificationPassed(noBlock), false);
  console.log('✓ verify fail-closed');
}

// 14. 完整交付链路：设计 → 评审 → 实现 → 验收 → 交付
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-build-4');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  state = runStage(state, 'build_design_review', [
    output(criticAgent, reviewBlock({ verdict: 'conditional', findings: [{ severity: 'major', title: '补充错误码', evidence: 'api.md:3' }] })),
  ]).state;
  state = runStage(state, 'build_implement', [
    output(authorAgent, '改动 src/services/edge/edgeClient.ts:12，运行 npm run lint 通过。', {
      filesTouched: ['src/services/edge/edgeClient.ts'],
    }),
  ]).state;
  const verify = runStage(state, 'build_verify', [
    output(verifierAgent, verifyBlock({
      verdict: 'pass',
      checks: [{ command: 'npm run lint', output: 'ok', passed: true }],
      failures: [],
    })),
  ]);
  assert.equal(verify.decision.nextStageKey, 'build_accept');
  const accept = runStage(verify.state, 'build_accept', [
    output(authorAgent, '交付摘要：改动 edgeClient，lint 通过，回滚方式 git revert。'),
  ]);
  assert.equal(accept.state.status, 'completed');
  assert.equal(accept.state.verdict, 'ACCEPTED');
  console.log('✓ build 完整链路');
}

// 15. 返修 2 轮仍失败 → blocked
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-build-5');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  state = runStage(state, 'build_design_review', [output(criticAgent, reviewBlock({ verdict: 'approve', findings: [] }))]).state;
  state = runStage(state, 'build_implement', [output(authorAgent, '改了 src/a.ts:1', { filesTouched: ['src/a.ts'] })]).state;

  for (let round = 0; round < 3; round += 1) {
    const verify = runStage(state, 'build_verify', [
      output(verifierAgent, verifyBlock({ verdict: 'fail', checks: [{ command: 'npm test', output: 'fail', passed: false }] })),
    ]);
    state = verify.state;
    if (verify.decision.kind === 'blocked') {
      assert.ok(verify.decision.reason?.includes('返修 2 轮'));
      assert.equal(verify.state.status, 'blocked');
      break;
    }
    assert.equal(verify.decision.nextStageKey, 'build_fix');
    state = runStage(state, 'build_fix', [output(authorAgent, '已修复 src/a.ts:1')]).state;
  }
  assert.equal(state.status, 'blocked');
  console.log('✓ build 返修上限 blocked');
}

// 16. 交接物注入完整原文，不做 1500 字脱水
{
  const marker = 'FULL_CONTEXT_MARKER_';
  const longPlan = `${'上下文'.repeat(3000)}${marker}${'尾部'.repeat(500)}\n验收标准\n- npm run lint`;
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-prompt');
  state = runStage(state, 'build_design', [output(authorAgent, longPlan)]).state;
  state = runStage(state, 'build_design_review', [output(criticAgent, reviewBlock({ verdict: 'approve', findings: [] }))]).state;

  const implementPrompt = buildWorkflowPrompt({
    topicTitle: '实现 Edge 客户端',
    topicDescription: '补充降级路径',
    state,
    stageKey: 'build_implement',
    targetAgent: authorAgent,
    participants: [authorAgent, criticAgent, verifierAgent],
    attempt: 1,
  });
  assert.ok(implementPrompt.includes('FULL_CONTEXT_MARKER_'), '方案原文必须完整注入');
  assert.ok(!implementPrompt.includes('中间省略'), '未超预算时不应截断');
  assert.ok(implementPrompt.includes('验收标准'));

  const short = truncateArtifactForPrompt('A'.repeat(100) + 'B'.repeat(100), 100);
  assert.ok(short.startsWith('A'.repeat(70)));
  assert.ok(short.endsWith('B'.repeat(30)));
  assert.ok(short.includes('中间省略'));
  console.log('✓ 交接物完整原文注入');
}

// 17. 验收 Prompt 不得注入实现者自述，只给文件定位
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-prompt-2');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  state = runStage(state, 'build_design_review', [output(criticAgent, reviewBlock({ verdict: 'approve', findings: [] }))]).state;
  state = runStage(state, 'build_implement', [
    output(authorAgent, 'IMPLEMENTER_NARRATIVE_SECRET 我已完美实现。', { filesTouched: ['src/services/edge/edgeClient.ts'] }),
  ]).state;

  const verifyPrompt = buildWorkflowPrompt({
    topicTitle: '实现 Edge 客户端',
    state,
    stageKey: 'build_verify',
    targetAgent: verifierAgent,
    participants: [authorAgent, criticAgent, verifierAgent],
    attempt: 1,
    acceptanceCriteria: '- npm run lint 通过',
  });
  assert.ok(!verifyPrompt.includes('IMPLEMENTER_NARRATIVE_SECRET'), '验收者不得看到实现者自述');
  assert.ok(verifyPrompt.includes('src/services/edge/edgeClient.ts'));
  assert.ok(verifyPrompt.includes('ACCEPTANCE_CRITERIA'));
  console.log('✓ verify 隔离实现者自述');
}

// 18. 进度视图：阶段状态与结论可见
{
  let { state } = initializeWorkflowState('consult', [authorAgent, criticAgent], 'token-progress');
  state = runStage(state, 'consult_draft', [output(authorAgent, longDraft)]).state;
  const view = buildWorkflowProgressView(state);
  assert.equal(view.modeLabel, '咨询产出');
  assert.equal(view.nodes[0].state, 'done');
  assert.equal(view.nodes[1].state, 'active');
  assert.ok(view.headline.includes('独立核验'));
  assert.equal(view.isActive, true);
  console.log('✓ 进度视图');
}

// 19. 重新激活阶段会清理下游已完成状态，避免返工后残留旧结论
{
  let { state } = initializeWorkflowState('build', [authorAgent, criticAgent, verifierAgent], 'token-reset');
  state = runStage(state, 'build_design', [output(authorAgent, designWithCriteria)]).state;
  state = runStage(state, 'build_design_review', [output(criticAgent, reviewBlock({ verdict: 'approve', findings: [] }))]).state;
  const reactivated = markWorkflowStageActive(state, 'build_design', [authorAgent.id]);
  assert.equal(reactivated.stages.find((r) => r.key === 'build_design')?.state, 'active');
  assert.equal(reactivated.stages.find((r) => r.key === 'build_design_review')?.state, 'pending');
  console.log('✓ 返工重置下游状态');
}

// 20. 解析设计产物的验收标准与文件计划
{
  const check = parseDesignArtifact(designWithCriteria);
  assert.equal(check.hasAcceptanceCriteria, true);
  assert.equal(check.hasFilePlan, true);
  assert.ok(check.acceptanceCriteria.includes('npm run lint'));
  const missing = parseDesignArtifact('随便写点方案，没有问题。');
  assert.equal(missing.hasAcceptanceCriteria, false);
  console.log('✓ 设计产物解析');
}

console.log('\n✅ Workflow test suite passed');
