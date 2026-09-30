/**
 * Wave 1 核心真实闭环回归测试 (Wave 1 Closed-Loop Verification)
 * 验证：
 * 1. P0-1: 真实接地验证执行器 (T1/T2 审计, 原子承诺链, 加权真值率)
 * 2. P0-2: 伴生少数派异议报告编译与闭环
 * 3. P0-3: MCDA 动态运筹输入抽取与打分溯源链 (Audit Provenance)
 * 4. SPRT 未核验争议关键门禁 (Hard Gate)
 */

import {
  tieredGroundingGovernor,
  processVerifierEvidenceChain,
  parseVerifierOutput,
} from './tieredGroundingGovernor';
import { compileMinorityReport } from './minorityReportCompiler';
import { stepSprtGovernor } from './sprtComputeGovernor';
import { generateDeterministicMcdaPayload } from '../agentCollaboration';
import { ArgumentNode, DisputeSpanPacket } from '../../types';

function runWave1Tests() {
  console.log('🧪 开始执行 Wave 1 核心真实闭环回归测试...\n');

  // --- 测试 1: P0-1 结构化 JSON 证据解析与 T1/T2 分级审计 ---
  console.log('--- 测试 1: P0-1 接地验证执行器与分级审计 ---');
  const mockVerifierOutputWithJson = `
经过客观实证检验，我们对红队提出的分布式死锁反例进行了模拟与静态调用链分析。
\`\`\`json
{
  "evidences": [
    {
      "sourceTool": "static_analyzer",
      "inputQueryOrCode": "cargo clippy -- -D clippy::await_holding_lock",
      "rawOutput": "found 1 warning: mutex guard held across await point in line 42",
      "truthValue": false,
      "confidence": 0.95,
      "claimId": "arg-mutex-safety",
      "verifierReport": "检测到跨 await 持有互斥锁，高并发下存在明确死锁隐患"
    },
    {
      "sourceTool": "code_sandbox",
      "inputQueryOrCode": "cargo test --test concurrent_stress_test -- --nocapture",
      "rawOutput": "running 1 test\\ntest concurrent_stress_test ... FAILED",
      "truthValue": false,
      "confidence": 0.90,
      "claimId": "arg-concurrency",
      "verifierReport": "并发压测在 50 并发写入时触发死锁超时"
    }
  ]
}
\`\`\`
实证结论：反例确凿成立，原方案存在严重死锁风险。
`;

  // 1.1 宪章未签署时，T2 工具必须被硬冻结，T1 正常执行但权重 <= 0.3
  const initialCommittedStates: ArgumentNode[] = [
    {
      id: 'arg-mutex-safety',
      claim: '基于标准 Mutex 的互斥保护具备并发安全性',
      assumptions: ['无长耗时 await'],
      confidence: 0.8,
      status: 'supported',
    },
    {
      id: 'arg-concurrency',
      claim: '方案可支撑 50 并发平稳运行',
      assumptions: [],
      confidence: 0.85,
      status: 'supported',
    },
  ];

  const initialDispute: DisputeSpanPacket = {
    disputeId: 'disp-101',
    claimTopic: '并发死锁与锁粒度',
    proposerClaim: '互斥保护完备',
    challengerCritique: '跨异步持锁导致死锁',
    rootCause: '异步竞态',
    groundingStatus: 'unverified',
  };

  const unsignedResult = processVerifierEvidenceChain({
    topicId: 'topic-test-1',
    verifierText: mockVerifierOutputWithJson,
    isSafetyCharterSigned: false, // 未签署
    disputePacket: initialDispute,
    committedStates: initialCommittedStates,
  });

  if (unsignedResult.evidences.length !== 2) {
    throw new Error(`[FAIL] 期望解析出 2 条实证，实际解析出: ${unsignedResult.evidences.length}`);
  }

  const t1Evidence = unsignedResult.evidences.find((e) => e.tier === 'T1');
  const t2Evidence = unsignedResult.evidences.find((e) => e.tier === 'T2');

  if (!t1Evidence || !t1Evidence.isAdvisory) {
    throw new Error('[FAIL] T1 证据应标记为 isAdvisory: true');
  }

  if (!t2Evidence || !t2Evidence.rawOutput.includes('T2 硬冻结')) {
    throw new Error('[FAIL] 未签署安全宪章时，T2 证据必须被硬冻结');
  }

  // 验证原子承诺链状态更新
  const updatedNode1 = unsignedResult.updatedCommittedStates?.find((n) => n.id === 'arg-mutex-safety');
  if (updatedNode1?.status !== 'refuted') {
    throw new Error(`[FAIL] 被证伪的论点状态应更新为 'refuted'，实际为: ${updatedNode1?.status}`);
  }
  if (!updatedNode1?.evidenceRefs || updatedNode1.evidenceRefs.length === 0) {
    throw new Error('[FAIL] 论点节点未正确关联 evidenceRefs');
  }

  // 验证争议切片状态
  if (unsignedResult.updatedDispute?.groundingStatus !== 'verified_false') {
    throw new Error(`[FAIL] 加权真值率偏低时争议状态应为 'verified_false'，实际为: ${unsignedResult.updatedDispute?.groundingStatus}`);
  }

  console.log('✓ P0-1 结构化证据解析、T1/T2 分级门禁、原子承诺链绑定与真值率校验通过！');

  // --- 测试 2: P0-2 伴生少数派异议报告编译 ---
  console.log('\n--- 测试 2: P0-2 少数派异议报告编译 ---');
  const critiqueSample = `
### 1. 致命隐患：极端网络抖动下的幂等丢失
在跨地域机房网络延迟超过 200ms 或丢包率达到 5% 时，主备节点的分布式租约将发生脑裂。

### 2. 崩溃原因连锁反应
当客户端发起重试请求，当前方案缺乏去重流水号原子锁，将引发两次扣费与状态污染。

### 3. 反例压测要求
必须在丢包模拟环境下验证客户端 3 次幂等重试的表现。
`;

  const minorityReport = compileMinorityReport({
    dissentingAgentId: 'agent-red-1',
    dissentingAgentName: 'RedTeam_Sentinel',
    dissentingAgentModel: 'Claude 3.7 Sonnet',
    critiqueText: critiqueSample,
  });

  if (!minorityReport.coreDissentThesis || minorityReport.coreDissentThesis.length < 5) {
    throw new Error('[FAIL] 少数派报告未提取到核心异议立场');
  }
  if (!minorityReport.rationalityBasis || minorityReport.rationalityBasis.length < 5) {
    throw new Error('[FAIL] 少数派报告未提取到自洽逻辑依据');
  }
  if (!minorityReport.reopeningTriggers || minorityReport.reopeningTriggers.length === 0) {
    throw new Error('[FAIL] 少数派报告未生成黑天鹅重开判定条件');
  }

  console.log('✓ P0-2 少数派报告编译通过：');
  console.log(`  - 异议代表: ${minorityReport.dissentingAgentName}`);
  console.log(`  - 保留立场: ${minorityReport.coreDissentThesis}`);
  console.log(`  - 重启条件项数: ${minorityReport.reopeningTriggers.length}`);

  // --- 测试 3: P0-3 MCDA 真实研讨脉络抽取与打分溯源链 ---
  console.log('\n--- 测试 3: P0-3 MCDA 真实研讨脉络抽取与打分溯源 ---');
  const mcdaResult = generateDeterministicMcdaPayload({
    topicTitle: '分布式高并发订单幂等与锁优化',
    topicDescription: '针对高峰期 TPS 15,000 下的分布式事务与跨库一致性保障设计',
    proposalText: '核心选型建议：采用 Redis 细粒度分布式锁 + 内存漏桶限流，保障低延迟吞吐。',
    critiqueText: '反例质疑：Redis 主从切换可能存在分布式锁丢失，要求引入 Raft 强一致性租约锁。',
    defenseText: '答辩补丁：引入本地原子流水号 + 异步对账补偿，兼顾性能与极端一致性。',
    arbiterText: '综合研讨各方，当前场景应重点平衡吞吐性能与数据一致性，避免过度增加架构复杂度。',
    evidences: unsignedResult.evidences,
    argumentNodes: unsignedResult.updatedCommittedStates,
  });

  if (!mcdaResult.criteria || mcdaResult.criteria.length < 3) {
    throw new Error(`[FAIL] 期望提取出至少 3 项准则，实际提取: ${mcdaResult.criteria.length}`);
  }

  // 验证动态方案抽取
  if (!mcdaResult.alternatives.some((a) => a.includes('方案A') && a.includes('提案'))) {
    throw new Error('[FAIL] 方案A 未能动态绑定提案主题');
  }

  // 验证 scoreProvenance 溯源链
  if (!mcdaResult.scoreProvenance) {
    throw new Error('[FAIL] MCDA payload 缺失 scoreProvenance 打分溯源字典');
  }

  const altAKey = mcdaResult.alternatives[0];
  const critKey = mcdaResult.criteria[0].id;
  const reason = mcdaResult.scoreProvenance[altAKey]?.[critKey];
  if (!reason || reason.length < 2) {
    throw new Error(`[FAIL] 方案A 在准则 ${critKey} 上的打分理由缺失`);
  }

  // 验证数学求解器收敛
  if (mcdaResult.status !== 'optimal' || !mcdaResult.consistencyPassed) {
    throw new Error(`[FAIL] MCDA 求解未达到最优收敛 (status=${mcdaResult.status}, xi=${mcdaResult.consistencyIndex})`);
  }

  console.log('✓ P0-3 MCDA 真实研讨抽取与数学求解通过：');
  console.log(`  - 抽取准则: ${mcdaResult.criteria.map((c) => c.name).join(', ')}`);
  console.log(`  - 候选方案: ${mcdaResult.alternatives.join(' | ')}`);
  console.log(`  - 一致性指标: ξ* = ${mcdaResult.consistencyIndex} (通过: ${mcdaResult.consistencyPassed})`);
  console.log(`  - 方案A 溯源示例 [${critKey}]: ${reason}`);

  // --- 测试 4: SPRT 关键实证未核验早停门禁 ---
  console.log('\n--- 测试 4: SPRT 序贯检验关键实证未核验早停门禁 ---');
  // 构造似然比累积突破上界的先验状态 (priorLambda = 2.0 + delta 1.62 = 3.62 >= 2.944)
  const priorHighState: any = {
    currentRound: 1,
    maxRounds: 4,
    logLikelihoodRatio: 2.0,
    upperThresholdA: 2.944,
    lowerThresholdB: -2.944,
    latestAlignmentScore: 0.9,
    decisionState: 'continue',
    statusDescription: 'prior',
  };

  const sprtWithUnverifiedDispute = stepSprtGovernor({
    priorState: priorHighState,
    currentRound: 2,
    alignmentScore: 0.95, // 极高对齐分
    hasUnverifiedCriticalDispute: true, // 存在未验证关键争议
  });

  if (sprtWithUnverifiedDispute.decisionState === 'early_exit') {
    throw new Error('[FAIL] 存在未验证关键争议时，SPRT 必须拦截 early_exit，不能早停！');
  }
  if (!sprtWithUnverifiedDispute.statusDescription.includes('未核验')) {
    throw new Error(`[FAIL] SPRT 拦截说明不符合预期: ${sprtWithUnverifiedDispute.statusDescription}`);
  }

  // 当争议已核验时，允许正常 early_exit
  const sprtWithVerifiedDispute = stepSprtGovernor({
    priorState: priorHighState,
    currentRound: 2,
    alignmentScore: 0.95,
    hasUnverifiedCriticalDispute: false,
  });

  if (sprtWithVerifiedDispute.decisionState !== 'early_exit') {
    throw new Error(`[FAIL] 争议已核验且似然比突破上界时应触发 early_exit，实际为: ${sprtWithVerifiedDispute.decisionState}`);
  }

  console.log('✓ SPRT 关键未实证争议早停硬门禁验证通过！');

  console.log('\n🎉 Wave 1 全部 4 项核心测试 100% 通过！真实闭环稳固可靠。');
}

runWave1Tests();
