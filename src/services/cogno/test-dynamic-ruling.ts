/**
 * 动态裁决草案生成器单元回归测试
 */

import { generateDynamicRulingDraft, extractImpactedFilesFromContext, extractTradeOffPointsFromContext } from './dynamicRulingGenerator';
import { McdaDecisionPayload, DisputeSpanPacket } from '../../types';

console.log('=== [动态裁决草案生成器回归测试] ===\n');

// 1. 测试文件路径抽取
const sampleCorpus = {
  topicDescription: '优化 src/services/auth.ts 与 src/routes/oauth.ts 的两阶段 Token 校验逻辑',
  proposalText: '在 src/middleware/tokenValidator.ts 中增加本地 L1 缓存',
  defenseText: '采纳红队建议，在 crates/core/src/lock.rs 中增加读写锁熔断，避免 package.json 错误',
  messages: [{ content: '请核查 internal/db/schema.sql 是否兼容' }],
};

const extractedFiles = extractImpactedFilesFromContext(sampleCorpus);
console.log('[测试 1] 真实代码文件路径识别:');
console.log('  提取结果:', extractedFiles);
if (
  extractedFiles.includes('src/services/auth.ts') &&
  extractedFiles.includes('src/middleware/tokenValidator.ts') &&
  extractedFiles.includes('crates/core/src/lock.rs') &&
  !extractedFiles.includes('package.json')
) {
  console.log('  ✓ [通过] 成功从多轮研讨中提取出真实代码文件，过滤噪音');
} else {
  throw new Error(`❌ 文件路径抽取未达预期: ${extractedFiles}`);
}

// 2. 测试 MCDA 与冲突驱动的权衡要点提炼
const sampleMcda: McdaDecisionPayload = {
  solverType: 'BWM',
  criteria: [
    { id: 'rel', name: '系统健壮性与容灾抗风险', direction: 'maximize' },
    { id: 'perf', name: '吞吐量与低延迟性能', direction: 'maximize' },
    { id: 'cost', name: '资源占用与基础设施成本', direction: 'minimize' },
  ],
  alternatives: ['方案A', '方案B'],
  scoreMatrix: {},
  bestCriterionId: 'rel',
  worstCriterionId: 'cost',
  bestToOthers: [1, 2, 5],
  othersToWorst: [5, 3, 1],
  computedWeights: { rel: 0.58, perf: 0.28, cost: 0.14 },
  consistencyIndex: 0.04,
  consistencyPassed: true,
  ranking: [],
  status: 'optimal',
};

const sampleDispute: DisputeSpanPacket = {
  disputeId: 'disp-1',
  claimTopic: '分布式会话一致性与并发击穿',
  proposerClaim: '采用 Redis Cluster 双层缓存',
  challengerCritique: '热点 Key 瞬时洪峰可能穿透',
  rootCause: '缓存失效雪崩',
  groundingStatus: 'verified_true',
};

const points = extractTradeOffPointsFromContext({
  topicTitle: '海量日志高并发流式写入架构',
  rulingType: 'adopt_proposer',
  mcdaPayload: sampleMcda,
  currentDispute: sampleDispute,
  defenseText: '我们同意以 5ms 轻量延迟换取 100% 幂等与重试防穿透，限制重试次数为 3 次',
});

console.log('\n[测试 2] 关键权衡折中要点提炼:');
points.forEach((pt, i) => console.log(`  要点 ${i + 1}: ${pt}`));

if (
  points.some((p) => p.includes('系统健壮性与容灾抗风险')) &&
  points.some((p) => p.includes('分布式会话一致性与并发击穿')) &&
  points.some((p) => p.includes('换取') || p.includes('限制'))
) {
  console.log('  ✓ [通过] 成功将 MCDA 运筹权重分布、LMAD 冲突与答辩语义融合成针对性 Trade-off 要点');
} else {
  throw new Error(`❌ 权衡要点提炼未达预期: ${JSON.stringify(points)}`);
}

// 3. 测试 3 种裁决类型的动态草案生成
const draftAdopt = generateDynamicRulingDraft({
  topicTitle: '核心资金账户分布式强一致事务架构',
  rulingType: 'adopt_proposer',
  mcdaPayload: sampleMcda,
  currentDispute: sampleDispute,
});
console.log('\n[测试 3.1] 采纳主导定案陈词:');
console.log('  摘要:', draftAdopt.rulingSummary);
console.log('  指引:', draftAdopt.rulingSolution);

const draftReject = generateDynamicRulingDraft({
  topicTitle: '核心资金账户分布式强一致事务架构',
  rulingType: 'reject_rebuild',
  currentDispute: sampleDispute,
});
console.log('\n[测试 3.2] 驳回重构定案陈词:');
console.log('  摘要:', draftReject.rulingSummary);
console.log('  指引:', draftReject.rulingSolution);

if (draftAdopt.rulingSummary.includes('准予合并实施') && draftReject.rulingSummary.includes('予以驳回重构')) {
  console.log('\n✅ [全项通过] 动态裁决草案生成器全部逻辑验证达标！');
} else {
  throw new Error('❌ 裁决类型定案文案未符合预期');
}
