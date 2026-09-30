import assert from 'assert';
import { Agent, ArgumentNode, GroundingEvidence } from '../../types';
import {
  extractArgumentNodes,
  buildArgumentDag,
  calculateAffectedSubgraph,
  localizeGraphDiffDispute,
  stepSprtGovernor,
  estimateRoundAlignmentScore,
  calculateColMadContributions,
} from './index';

console.log('=== CognoNexus Wave 3: Claim DAG, Multi-dim SPRT & ColMAD Fact Reward Test Suite ===\n');

// Mock Agents
const proposerAgent = {
  id: 'agent-proposer',
  name: 'Architect Proposer',
  handle: '@proposer',
  role: '首席架构师',
} as unknown as Agent;

const challengerAgent = {
  id: 'agent-challenger',
  name: 'RedTeam Challenger',
  handle: '@challenger',
  role: '安全红队对抗官',
} as unknown as Agent;

const verifierAgent = {
  id: 'agent-verifier',
  name: 'QA Verifier',
  handle: '@verifier',
  role: '接地验证官',
} as unknown as Agent;

const arbiterAgent = {
  id: 'agent-arbiter',
  name: 'Chief Arbiter',
  handle: '@arbiter',
  role: '流程综合仲裁官',
} as unknown as Agent;

const mockAgents = [proposerAgent, challengerAgent, verifierAgent, arbiterAgent];

// ==========================================
// Test 1: Claim DAG Topology & Causal Edges
// ==========================================
console.log('1. Testing Claim DAG Topology & Causal Edge Construction (P1-1)...');

const rawProposal = `
本方案采用 Redis Cluster 作为高吞吐分布式会话缓存层，确保全站高频只读请求在 1ms 内完成鉴权。
为了防止缓存击穿与单点负载倾斜，系统基于一致性 Hash 环进行集群分片打散。
在数据写入时，系统基于两阶段提交协议引入分布式锁，以此保证会话状态更新的绝对一致性。
接着，后端服务通过异步无锁队列批量将增量会话持久化至 MySQL 数据库。
`;

const dagNodes = extractArgumentNodes(rawProposal, proposerAgent.id, proposerAgent.name);

assert(dagNodes.length >= 3, `Must extract at least 3 argument nodes, got ${dagNodes.length}`);
console.log(`   ✓ Extracted ${dagNodes.length} DAG nodes:`);
dagNodes.forEach((n) => {
  console.log(`     - [${n.id}] Depth: ${n.depth}, Deps: [${(n.dependencies || []).join(', ')}], Impact: ${n.impactScore} -> "${n.claim.slice(0, 30)}..."`);
});

// Root node should have depth 0 and no dependencies
assert.strictEqual(dagNodes[0].depth, 0, 'First root node should have depth 0');
assert.deepStrictEqual(dagNodes[0].dependencies, [], 'First root node should have empty dependencies');

// Subsequent dependent nodes should have dependencies and depth > 0
const hasDependentNodes = dagNodes.some((n) => (n.dependencies || []).length > 0 && (n.depth || 0) > 0);
assert.strictEqual(hasDependentNodes, true, 'DAG must establish dependency edges between causally linked nodes');

// Impact score of root node should be higher as downstream nodes depend on it
assert((dagNodes[0].impactScore || 1) >= 1.0, 'Root node impact score must be >= 1.0');
console.log('   ✓ Claim DAG topology and depth hierarchy verified');

// ==========================================
// Test 2: Graph Diff Conflict Localization
// ==========================================
console.log('\n2. Testing Graph Diff Conflict Localization (Root Cause Node Tracing)...');

// Critique specifically attacks the underlying assumption of node 1 (Redis cluster partition/split-brain)
const critiqueText = `
红队安全审查指出致命漏洞：
在跨可用区网络分区（脑裂）极端场景下，Redis 集群的主从异步复制会导致分布式锁失效与脏写；
由于前置锁机制失效，后续数据库持久化与只读鉴权将全盘发生数据失真与并发竞态！
`;

const disputePacket = localizeGraphDiffDispute(dagNodes, critiqueText);

assert.ok(disputePacket.rootDisputeNodeId, 'DisputePacket must identify rootDisputeNodeId');
assert.ok(disputePacket.affectedSubgraphNodeIds, 'DisputePacket must calculate affectedSubgraphNodeIds');
console.log(`   ✓ Graph Diff Localizer pinpointed:`);
console.log(`     - Root Cause Node: [${disputePacket.rootDisputeNodeId}] "${disputePacket.proposerClaim.slice(0, 35)}..."`);
console.log(`     - Affected Subgraph Nodes: [${disputePacket.affectedSubgraphNodeIds.join(', ')}] (${disputePacket.affectedSubgraphNodeIds.length} nodes impacted)`);

// Downstream calculation check
const affectedIds = calculateAffectedSubgraph(disputePacket.rootDisputeNodeId, dagNodes);
assert(Array.isArray(affectedIds), 'calculateAffectedSubgraph must return an array');
console.log('   ✓ Backward causal tracing and affected subgraph traversal verified');

// ==========================================
// Test 3: Multi-dimensional SPRT Observation Fusion (P1-2)
// ==========================================
console.log('\n3. Testing Multi-dimensional Wald-SPRT Observation Fusion (P1-2)...');

const multiDimScore = estimateRoundAlignmentScore({
  proposalText: rawProposal,
  critiqueText,
  defenseText: '我们认同该风险，引入 Redlock 分布式锁与版本号 CAS 补丁修复并发竞争。',
  groundedTrueRatio: 0.80, // Sandbox passed 80%
  dssScore: 0.15,          // Authentic, low sycophancy
});

// Formula: Sr = 0.40 * 0.80 + 0.35 * Semantic + 0.25 * (1 - 0.15)
// 0.32 + 0.35 * Semantic + 0.2125
assert(multiDimScore >= 0.65, `Multi-dimensional fused alignment score should be high (>= 0.65), got ${multiDimScore}`);
console.log(`   ✓ Multi-dimensional Fused Score Sr: ${multiDimScore} (Grounding + Semantic + DSS)`);

// ==========================================
// Test 4: SPRT Unverified Dispute Early-Exit Hard Lock
// ==========================================
console.log('\n4. Testing SPRT Hard Lock against Early Exit when Dispute is Unverified (P1-2)...');

// When prior accumulated logLikelihoodRatio is already high (e.g. 2.5) and current round adds delta > 1.0 (total > 3.5 > A)
const highPrior = {
  logLikelihoodRatio: 2.5,
  currentRound: 1,
  maxRounds: 4,
  upperThresholdA: 2.944,
  lowerThresholdB: -2.944,
  latestAlignmentScore: 0.9,
  decisionState: 'continue',
  statusDescription: '',
} as any;

const lockedSprt = stepSprtGovernor({
  priorState: highPrior,
  currentRound: 2,
  alignmentScore: 0.95,
  groundedTrueRatio: 0.90,
  hasUnverifiedCriticalDispute: true, // Key unverified conflict still open!
});

assert.strictEqual(
  lockedSprt.decisionState,
  'continue',
  'SPRT must NOT early-exit when hasUnverifiedCriticalDispute is true!'
);
assert(lockedSprt.statusDescription.includes('强制要求接地验证官执行实证检验'), 'Status description must state lock reason');
assert.ok(lockedSprt.observationVector, 'SprtGovernorState must record observationVector');
assert.strictEqual(lockedSprt.observationVector.groundedRatio, 0.90, 'observationVector must preserve groundedRatio');
console.log(`   ✓ Early-Exit Hard Lock Enforced: decisionState=${lockedSprt.decisionState}`);
console.log(`   ✓ Observation Vector recorded: ${JSON.stringify(lockedSprt.observationVector)}`);

// When dispute is verified, early exit should be permitted
const unlockedSprt = stepSprtGovernor({
  priorState: highPrior,
  currentRound: 2,
  alignmentScore: 0.95,
  groundedTrueRatio: 0.90,
  hasUnverifiedCriticalDispute: false,
});
assert.strictEqual(unlockedSprt.decisionState, 'early_exit', 'SPRT should early-exit once dispute is verified');
console.log('   ✓ Early-Exit permitted once unverified dispute is cleared');

// ==========================================
// Test 5: ColMAD Non-zero-sum Fact Reward & Reputation (P1-3)
// ==========================================
console.log('\n5. Testing ColMAD Collaborative Fact Contribution & Reputation Engine (P1-3)...');

const mockEvidences: GroundingEvidence[] = [
  {
    evidenceId: 'ev-test-1',
    claimId: dagNodes[0]?.id,
    sourceTool: 'code_sandbox',
    inputQueryOrCode: 'test_concurrency_race_condition()',
    rawOutput: 'Redis split-brain race condition reproduced at 1000 TPS',
    verifierReport: '实证检验复现高并发脑裂数据失真反例',
    truthValue: true,
    tier: 'T1',
  },
  {
    evidenceId: 'ev-test-2',
    claimId: dagNodes[1]?.id,
    sourceTool: 'ast_grep',
    inputQueryOrCode: 'find_hash_ring()',
    rawOutput: 'Consistent hash implementation verified',
    verifierReport: '实证检验一致性 Hash 环路由逻辑正确',
    truthValue: true,
    tier: 'T1',
  },
];

const colmadReport = calculateColMadContributions({
  topicId: 'topic-wave3-test',
  agents: mockAgents,
  proposalText: rawProposal,
  critiqueText,
  verificationText: '接地实证检验通过 2 项物理测试，复现了高并发脑裂场景下的竞态边界。',
  defenseText: '针对脑裂极端工况，提供架构补丁：引入 Redlock 多节点共识与分布式租约机制。',
  argumentNodes: dagNodes,
  evidences: mockEvidences,
});

assert.ok(colmadReport.scores, 'ColMadSessionReport must contain scores');
assert.ok(colmadReport.leaderboard.length >= 3, 'Leaderboard must contain participating agents');
assert(colmadReport.totalFactDelta > 0, `Total fact delta must be positive, got ${colmadReport.totalFactDelta}`);

console.log(`   ✓ ColMAD Fact Leaderboard (Total ΔFact: +${colmadReport.totalFactDelta}):`);
colmadReport.leaderboard.forEach((item, idx) => {
  console.log(`     #${idx + 1}: ${item.agentName} -> FactReward: +${item.factReward} | EdgeCases: ${item.discoveredEdgeCasesCount} | VerifiedClaims: ${item.verifiedClaimsCount} | Level: ${item.reputationLevel}`);
});

// Proposer & Challenger should have high contributions
const challengerScore = colmadReport.scores[challengerAgent.id];
assert(challengerScore.discoveredEdgeCasesCount > 0, 'Challenger must be credited for discovering edge cases');
assert(challengerScore.factReward > 0, 'Challenger must have positive fact reward');

console.log('\n=== All Wave 3 Unit & Integration Tests Passed 100%! ===\n');
