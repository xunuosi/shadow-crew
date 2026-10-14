/**
 * test-adaptive-sprt-governance.ts
 * 验证开放式议题与非代码场景下的 CognoNexus 博弈自适应参数调控
 * 包含：向心收缩、三层抗辩（逻辑权衡/量化实证）、Warm-up Guard、时变漏斗形上下界与未实证关键争议硬门禁
 */

import assert from 'node:assert/strict';
import {
  evaluateDynamicSycophancyScore,
  applySycophancyDiscountToSprt,
} from './sycophancyGovernor';
import {
  stepSprtGovernor,
  inferTopicDomainProfile,
  fitSprtCalibrationParams,
} from './sprtComputeGovernor';
import { Agent } from '../../types';

console.log('=== CognoNexus: Adaptive Multi-Domain SPRT & Sycophancy Governance Suite ===\n');

const mockCriticAgent: Agent = {
  id: 'agent-critic-1',
  name: 'Architecture Critic',
  handle: '@critic',
  role: 'Critic',
  avatar: '⚖️',
  modelBadge: 'Claude 3.7 Sonnet',
  modelConfig: {
    provider: 'anthropic',
    modelId: 'claude-3-7-sonnet',
  },
} as unknown as Agent;

// =========================================================================
// 用例 1：向心收缩绝不把温和正共识 (> 0.50) 翻转为负向死锁分 (< 0.50)
// =========================================================================
console.log('1. Testing Neutral-Centered Shrinkage (Anti-Deadlock Inversion)...');
{
  const rawPositiveScore = 0.58;
  const gamma = 0.72;
  const calibrated = applySycophancyDiscountToSprt(rawPositiveScore, gamma, 0.50);

  assert.equal(
    calibrated > 0.50,
    true,
    `Expected calibratedScore (${calibrated}) to remain above neutral 0.50`
  );
  assert.equal(
    calibrated < rawPositiveScore,
    true,
    `Expected calibratedScore (${calibrated}) to be shrunk below raw score (${rawPositiveScore})`
  );
  assert.equal(
    Math.abs(calibrated - 0.558) < 0.005,
    true,
    `Expected calibratedScore close to 0.558, got ${calibrated}`
  );

  // 验证反对票（低对齐分）保留真实批判分歧，不被过度收缩抹平
  const negativeCritiqueScore = 0.30;
  const preservedCritique = applySycophancyDiscountToSprt(negativeCritiqueScore, gamma, 0.50);
  assert.equal(
    preservedCritique < 0.35,
    true,
    `Criticism score must remain well below neutral 0.50, got ${preservedCritique}`
  );
  console.log(`   ✓ Positive consensus preserved above neutral: ${rawPositiveScore} -> ${calibrated} (gamma=${gamma})`);
  console.log(`   ✓ Negative critique divergence preserved: ${negativeCritiqueScore} -> ${preservedCritique}`);
}

// =========================================================================
// 用例 2：非代码/开放议题下的逻辑权衡与量化实证抗辩应正确抵扣 DSS，不误判为投降
// =========================================================================
console.log('\n2. Testing Domain-Agnostic Analytical Defense & DSS Credit...');
{
  const analyticalReply =
    '您说得对，冷启动成本确实关键。但需要考虑的是，权衡来看补贴供给侧的边际成本比需求侧低 35%，前提条件是满足：1. 首月留存率 > 40%；2. 商业闭环周期控制在 60 天内。';

  const evalResult = evaluateDynamicSycophancyScore(mockCriticAgent, analyticalReply, true);

  assert.equal(
    evalResult.dss < 0.22,
    true,
    `Expected low DSS (< 0.22) for substantive analytical defense, got ${evalResult.dss}`
  );
  assert.equal(
    evalResult.surrenderDetected,
    false,
    'Analytical defense with metrics and structured points must not trigger surrenderDetected'
  );
  assert.equal(
    evalResult.discountFactorGamma > 0.85,
    true,
    `Discount factor gamma should remain high (got ${evalResult.discountFactorGamma})`
  );
  console.log(`   ✓ Analytical defense recognized: DSS=${evalResult.dss}, γ=${evalResult.discountFactorGamma}, surrender=${evalResult.surrenderDetected}`);
}

// =========================================================================
// 用例 3：Warm-up Guard 与 hasUnverifiedCriticalDispute 硬门禁
// =========================================================================
console.log('\n3. Testing Warm-up Guard & Unverified Dispute Hard Lock...');
{
  const openProfile = inferTopicDomainProfile('讨论下一阶段社区产品增长策略与商业化定位');
  assert.equal(openProfile.domainType, 'open_ended_general');
  assert.equal(openProfile.minExplorationRounds, 2);

  // 3a. 第 1 轮即便得分极高，Warm-up Guard 也必须拦截 early_exit
  const round1 = stepSprtGovernor({
    currentRound: 1,
    maxRounds: 6,
    previousLogLikelihoodRatio: 2.8,
    alignmentScore: 0.95,
    topicProfile: openProfile,
  });
  assert.equal(
    round1.decisionState,
    'continue',
    'Round 1 in open-ended topic must be held by Warm-up Guard'
  );
  assert.equal(
    round1.statusDescription.includes('探索期保护门控'),
    true,
    'Status description must mention Warm-up Guard'
  );
  console.log('   ✓ Warm-up Guard active in Round 1: held early_exit');

  // 3b. 第 3 轮满足轮次且 LLR 超上界，但存在未验证关键争议 (hasUnverifiedCriticalDispute=true)，必须强锁
  const round3WithDispute = stepSprtGovernor({
    currentRound: 3,
    maxRounds: 6,
    previousLogLikelihoodRatio: 3.2,
    alignmentScore: 0.90,
    hasUnverifiedCriticalDispute: true,
    topicProfile: openProfile,
  });
  assert.equal(
    round3WithDispute.decisionState,
    'continue',
    'hasUnverifiedCriticalDispute=true must strictly block early_exit'
  );
  assert.equal(
    round3WithDispute.statusDescription.includes('未核验'),
    true,
    'Status description must retain "未核验" security keyword'
  );
  assert.equal(
    round3WithDispute.statusDescription.includes('强制要求接地验证官执行实证检验'),
    true,
    'Status description must retain grounding requirement notice'
  );
  console.log('   ✓ Unverified Critical Dispute Hard Lock enforced: strictly held early_exit');
}

// =========================================================================
// 用例 4：开放式议题温和正共识 (0.56 -> 0.65) 在无物理接地 (groundedTrueRatio=0) 下通过时变漏斗平滑收敛
// =========================================================================
console.log('\n4. Testing Funnel SPRT Convergence on Open-ended Topic...');
{
  const openProfile = inferTopicDomainProfile('产品长期用户体验与社区激励机制设计');
  const rawScores = [0.56, 0.59, 0.62, 0.64, 0.65];
  const history: number[] = [];
  let llr = 0;
  let finalState: ReturnType<typeof stepSprtGovernor> | undefined;

  for (let i = 0; i < rawScores.length; i++) {
    const calibrated = applySycophancyDiscountToSprt(
      rawScores[i],
      0.90,
      openProfile.neutralThreshold
    );
    finalState = stepSprtGovernor({
      priorState: finalState,
      currentRound: i + 1,
      maxRounds: 6,
      alignmentScore: calibrated,
      groundedTrueRatio: 0, // 非代码议题无物理接地
      topicProfile: openProfile,
      scoreHistory: history,
    });
    llr = finalState.logLikelihoodRatio;
    history.push(calibrated);
  }

  assert.equal(
    finalState?.decisionState,
    'early_exit',
    `Expected open-ended moderate consensus to converge via funnel bound by Round 5, got ${finalState?.decisionState} (LLR=${finalState?.logLikelihoodRatio}, A=${finalState?.upperThresholdA})`
  );
  assert.equal(
    finalState?.upperThresholdA < 2.94,
    true,
    `Funnel upper bound A(${finalState?.upperThresholdA}) should have decayed below baseline 2.94`
  );
  console.log(`   ✓ Smooth Funnel Convergence on Round 5: LLR=${finalState?.logLikelihoodRatio} >= A(${finalState?.upperThresholdA})`);
}

// =========================================================================
// 用例 5：确定性代码域任务维持原有基线行为 (minExplorationRounds=1, theta_0=0.50)
// =========================================================================
console.log('\n5. Testing Deterministic Code Domain Baseline Behavior...');
{
  const codeProfile = inferTopicDomainProfile('重构 src/services/gateway.ts 并修复并发锁与 sql 注入 bug');
  assert.equal(codeProfile.domainType, 'deterministic_code');
  assert.equal(codeProfile.minExplorationRounds, 1);
  assert.equal(codeProfile.neutralThreshold, 0.50);

  const codeStep = stepSprtGovernor({
    currentRound: 2,
    alignmentScore: 0.95,
    previousLogLikelihoodRatio: 2.0,
    topicProfile: codeProfile,
  });
  assert.equal(codeStep.decisionState, 'early_exit');
  console.log(`   ✓ Code task correctly resolved: domain=${codeProfile.domainType}, decision=${codeStep.decisionState}`);
}

console.log('\n=========================================================================');
console.log('🎉 All 5 adaptive governance regression tests passed successfully!');
console.log('=========================================================================');
