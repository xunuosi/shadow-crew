import assert from 'assert';
import { Agent, GameRolesConfig } from '../../types';
import { extractChallengeCritiqueFromAcpResponse } from '../acpClient';
import { BUILTIN_SKILLS } from '../../skills';
import {
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
  detectModelFamily,
  calculateModelDiversity,
  calculateConfidenceMatrix,
  validateStageContract,
  solveDeterministicBwm,
} from './index';

console.log('=== CognoNexus Wave 2: Sycophancy Governance & Model Diversity Test Suite ===\n');

// Mock Agents
const claudeAgent = {
  id: 'agent-claude',
  name: 'Claude Proposer',
  handle: '@claude',
  role: 'Architect',
  avatar: '🤖',
  status: 'idle',
  modelBadge: 'Claude 3.7 Sonnet',
  modelConfig: { modelId: 'claude-3-7-sonnet', provider: 'anthropic' },
} as unknown as Agent;

const deepseekAgent = {
  id: 'agent-deepseek',
  name: 'DeepSeek RedTeam',
  handle: '@deepseek',
  role: 'Security Challenger',
  avatar: '⚔️',
  status: 'idle',
  modelBadge: 'DeepSeek R1 Reasoner',
  modelConfig: { modelId: 'deepseek-reasoner-r1', provider: 'deepseek' },
} as unknown as Agent;

const gptAgent = {
  id: 'agent-gpt',
  name: 'GPT Verifier',
  handle: '@gpt',
  role: 'QA Verifier',
  avatar: '🔍',
  status: 'idle',
  modelBadge: 'GPT-4o Omniscience',
  modelConfig: { modelId: 'gpt-4o', provider: 'openai' },
} as unknown as Agent;

const geminiAgent = {
  id: 'agent-gemini',
  name: 'Gemini Arbiter',
  handle: '@gemini',
  role: 'Synthesizer',
  avatar: '⚖️',
  status: 'idle',
  modelBadge: 'Gemini 2.5 Pro',
  modelConfig: { modelId: 'gemini-2.5-pro', provider: 'google' },
} as unknown as Agent;

const miniAgent = {
  id: 'agent-mini',
  name: 'Mini Follower',
  handle: '@mini',
  role: 'Junior Dev',
  avatar: '🐣',
  status: 'idle',
  modelBadge: 'Llama-3-8b-instruct',
  modelConfig: { modelId: 'llama-3-8b', provider: 'ollama' },
} as unknown as Agent;

// ==========================================
// Test 1: BSS (Baseline Sycophancy Score)
// ==========================================
console.log('1. Testing BSS (Baseline Sycophancy Score) Estimation...');
const bssR1 = estimateBaselineSycophancyScore(deepseekAgent);
const bssClaude = estimateBaselineSycophancyScore(claudeAgent);
const bssMini = estimateBaselineSycophancyScore(miniAgent);

assert(bssR1 < bssClaude, 'R1 reasoning model should have lower BSS than standard model');
assert(bssClaude < bssMini, 'Flagship model should have lower BSS than small 8b model');
assert.strictEqual(bssR1, 0.18, 'R1 reasoning model BSS should match calibrated baseline 0.18');
console.log(`   ✓ BSS Calibrated: R1=${bssR1}, Claude=${bssClaude}, SmallModel=${bssMini}`);

// Explicit override check
const customAgent: Agent = { ...claudeAgent, baselineSycophancyScore: 0.12 };
assert.strictEqual(estimateBaselineSycophancyScore(customAgent), 0.12, 'Explicit baselineSycophancyScore should take precedence');
console.log('   ✓ Explicit BSS override verified');

// ==========================================
// Test 2: DSS (Dynamic Sycophancy Score) & Surrender Detection
// ==========================================
console.log('\n2. Testing DSS (Dynamic Sycophancy Score) & Surrender...');

const authenticDefenseText = `
针对红队提出的并发死锁质疑，我们分析了该极端工况：
1. 并非系统设计缺陷，但在并发超 5000 TPS 时确实存在隐患；
2. 架构补丁：引入分布式锁与幂等流水号，以此换取高一致性；
3. 具体实施代码如下：
\`\`\`typescript
async function acquireLock(resourceId: string): Promise<boolean> {
  return await redis.set(\`lock:\${resourceId}\`, '1', 'NX', 'EX', 5);
}
\`\`\`
在压测环境下实测延迟增量小于 3ms，达成权衡折中。
`;

const sycophanticSurrenderText = `
您说得对，完全认同您的反驳！确实是我考虑不周，确实存在致命隐患。
我收回之前的方案，全盘放弃原方案，深刻反思，没有任何异议，完全听从您的指导。
`;

const authenticEval = evaluateDynamicSycophancyScore(claudeAgent, authenticDefenseText);
assert.strictEqual(authenticEval.sycophancyLevel, 'authentic', 'Hard defense with patches should be authentic');
assert.strictEqual(authenticEval.surrenderDetected, false, 'Hard defense should not trigger surrender detection');
assert(authenticEval.dss <= 0.20, `Authentic DSS should be <= 0.20, got ${authenticEval.dss}`);
assert(authenticEval.discountFactorGamma >= 0.85, `Discount factor gamma should be >= 0.85, got ${authenticEval.discountFactorGamma}`);
console.log(`   ✓ Authentic Defense: DSS=${authenticEval.dss}, γ=${authenticEval.discountFactorGamma}, Level=${authenticEval.sycophancyLevel}`);

const sycophantEval = evaluateDynamicSycophancyScore(claudeAgent, sycophanticSurrenderText);
assert.strictEqual(sycophantEval.sycophancyLevel, 'sycophantic', 'Surrender text must be classified as sycophantic');
assert.strictEqual(sycophantEval.surrenderDetected, true, 'Surrender must be detected');
assert(sycophantEval.dss >= 0.70, `Sycophantic DSS should be >= 0.70, got ${sycophantEval.dss}`);
assert(sycophantEval.discountFactorGamma <= 0.70, `Discount factor gamma should be discounted (<= 0.70), got ${sycophantEval.discountFactorGamma}`);
console.log(`   ✓ Sycophantic Surrender: DSS=${sycophantEval.dss}, γ=${sycophantEval.discountFactorGamma}, Surrender=${sycophantEval.surrenderDetected}`);

// ==========================================
// Test 3: Stage Contract Gate Surrender Blocking
// ==========================================
console.log('\n3. Testing Stage Contract Gate Surrender Blocking...');
const surrenderValidation = validateStageContract('defense', sycophanticSurrenderText, 'Claude Proposer');
assert.strictEqual(surrenderValidation.isValid, false, 'Stage contract must reject pure sycophantic surrender');
assert(
  surrenderValidation.missingRequirements.some((r) => r.includes('附和') || r.includes('投降') || r.includes('补丁')),
  'Missing requirements must state sycophantic surrender reason'
);
console.log(`   ✓ Stage Contract Blocked: ${surrenderValidation.missingRequirements[0]}`);

const authenticValidation = validateStageContract('defense', authenticDefenseText, 'Claude Proposer');
assert.strictEqual(authenticValidation.isValid, true, 'Stage contract must accept authentic defense with code patch');
console.log('   ✓ Stage Contract Accepted authentic defense');

// ==========================================
// Test 4: SPRT Fake Consensus Discounting
// ==========================================
console.log('\n4. Testing SPRT Fake Consensus Discounting...');
const rawScore = 0.92; // Agent falsely claims 92% alignment through surrender
const discountedScore = applySycophancyDiscountToSprt(rawScore, sycophantEval);
assert(discountedScore < rawScore, 'Sycophancy discount must penalize alignment score');
assert(discountedScore <= 0.80, `Discounted score must pull towards 0.50 (got ${discountedScore})`);
console.log(`   ✓ Fake consensus penalized: ${rawScore} -> ${discountedScore} (pulls toward neutral 0.50)`);

const authenticSprtScore = applySycophancyDiscountToSprt(rawScore, authenticEval);
assert(authenticSprtScore >= 0.88, `Authentic score should experience minimal penalty (got ${authenticSprtScore})`);
console.log(`   ✓ Authentic score preserved: ${rawScore} -> ${authenticSprtScore}`);

// ==========================================
// Test 5: Model Diversity Score & Homogeneity Detection
// ==========================================
console.log('\n5. Testing Model Diversity & Homogeneity Detection...');
const homogeneousAgents: Agent[] = [
  claudeAgent,
  { ...claudeAgent, id: 'claude-challenger', name: 'Claude RedTeam' },
  { ...claudeAgent, id: 'claude-verifier', name: 'Claude Verifier' },
  { ...claudeAgent, id: 'claude-arbiter', name: 'Claude Arbiter' },
];

const homogeneousRoles: GameRolesConfig = {
  proposers: ['agent-claude'],
  challengers: ['claude-challenger'],
  verifiers: ['claude-verifier'],
  arbiters: ['claude-arbiter'],
  humanIsArbiter: false,
};

const homoEval = calculateModelDiversity(homogeneousAgents, homogeneousRoles);
assert.strictEqual(homoEval.isHomogeneous, true, 'All Claude agents must be flagged as homogeneous');
assert.strictEqual(homoEval.score, 0.25, 'Homogeneous setup should receive low diversity score 0.25');
assert(homoEval.warnings.length > 0, 'Homogeneous setup must generate bias warning');
console.log(`   ✓ Homogeneous Flagged: score=${homoEval.score}, warning="${homoEval.warnings[0].slice(0, 45)}..."`);

const heterogeneousAgents: Agent[] = [claudeAgent, deepseekAgent, gptAgent, geminiAgent];
const heterogeneousRoles: GameRolesConfig = {
  proposers: ['agent-claude'],
  challengers: ['agent-deepseek'],
  verifiers: ['agent-gpt'],
  arbiters: ['agent-gemini'],
  humanIsArbiter: false,
};

const heteroEval = calculateModelDiversity(heterogeneousAgents, heterogeneousRoles);
assert.strictEqual(heteroEval.isHomogeneous, false, 'Heterogeneous setup must not be homogeneous');
assert.strictEqual(heteroEval.score, 1.0, '4 distinct model families must score 1.00');
assert.strictEqual(Object.keys(heteroEval.familyDistribution).length, 4, 'Must register 4 distinct families');
console.log(`   ✓ Heterogeneous Verified: score=${heteroEval.score}, families=${Object.keys(heteroEval.familyDistribution).join(', ')}`);

// 回归验证：用户场景 MyCodex (DeepSeek) + GlmClaude-01 (智谱 GLM)
const userCodexAgent = {
  id: 'agent-mycodex',
  name: 'MyCodex',
  handle: '@mycodex',
  role: '逃逸红队分析师',
  modelBadge: 'deepseek-v4',
  modelConfig: { family: 'deepseek', modelId: 'deepseek-v4', provider: 'deepseek' },
  envVars: [{ key: 'OPENAI_MODEL', value: 'deepseek-v4' }],
} as unknown as Agent;

const userGlmAgent = {
  id: 'agent-glmclaude',
  name: 'GlmClaude-01',
  handle: '@glmclaude-01',
  role: '沙箱内核架构师',
  modelBadge: 'glm-5.3-flash',
  modelConfig: { family: 'zhipu', modelId: 'glm-5.3-flash', provider: 'openai_compatible' },
  envVars: [
    { key: 'ANTHROPIC_BASE_URL', value: 'https://open.bigmodel.cn/api/anthropic' },
    { key: 'ANTHROPIC_MODEL', value: 'glm-5.3-flash' },
  ],
} as unknown as Agent;

const userPairRoles: GameRolesConfig = {
  proposers: ['agent-mycodex'],
  challengers: ['agent-glmclaude'],
  arbiters: [],
  humanIsArbiter: false,
};

const userPairEval = calculateModelDiversity([userCodexAgent, userGlmAgent], userPairRoles);
assert.strictEqual(userPairEval.isHomogeneous, false, 'DeepSeek + GLM must be recognized as heterogeneous');
assert.strictEqual(userPairEval.score, 0.7, 'Two distinct families score 0.70');
assert.deepStrictEqual(userPairEval.familyDistribution['DeepSeek 家族'], ['MyCodex']);
assert.deepStrictEqual(userPairEval.familyDistribution['智谱 GLM 家族'], ['GlmClaude-01']);
console.log(`   ✓ User Regression Verified: DeepSeek + GLM recognized as heterogeneous (70%), families=${Object.keys(userPairEval.familyDistribution).join(', ')}`);

// 回归验证：未显式指定 family 时，从元数据与环境变量启发式智能推断
const codexInferred = detectModelFamily({
  id: 'codex-raw',
  name: 'MyCodex',
  handle: '@mycodex',
  role: '红队',
  envVars: [{ key: 'OPENAI_MODEL', value: 'deepseek-v4' }],
} as unknown as Agent);
assert.strictEqual(codexInferred.family, 'deepseek');

const glmInferred = detectModelFamily({
  id: 'claude-raw',
  name: 'GlmClaude-01',
  handle: '@glmclaude-01',
  role: '架构师',
  envVars: [{ key: 'ANTHROPIC_MODEL', value: 'glm-5.3-flash' }],
} as unknown as Agent);
assert.strictEqual(glmInferred.family, 'zhipu');
console.log(`   ✓ Heuristic Inference Verified: codex->${codexInferred.displayName}, claude-glm->${glmInferred.displayName}`);

// ==========================================
// Test 6: ReConcile Confidence-Weighted MCDA
// ==========================================
console.log('\n6. Testing ReConcile Confidence Matrix & MCDA Utility...');
const alternatives = ['方案A: 提案原案', '方案B: 红队对抗', '方案C: 架构补丁'];
const criteriaIds = ['rel', 'perf', 'cost'];

const confMatrix = calculateConfidenceMatrix({
  alternatives,
  criteriaIds,
  evidences: [
    {
      evidenceId: 'ev-1',
      claimId: 'claim-1',
      sourceTool: 'code_sandbox',
      inputQueryOrCode: 'run_load_test()',
      rawOutput: 'Deadlock reproduced',
      verifierReport: 'Concurrency deadlock reproduced in synthetic load test',
      tier: 'T1',
      truthValue: false, // Refuted!
      confidence: 0.3,
    },
  ],
  sycophancy: authenticEval,
});

assert(confMatrix['方案A: 提案原案']['rel'] < confMatrix['方案B: 红队对抗']['rel'], 'Refuted evidence should lower Plan A confidence relative to Plan B');
console.log(`   ✓ Evidence Grounding in Confidence: Plan A conf=${confMatrix['方案A: 提案原案']['rel']}, Plan B conf=${confMatrix['方案B: 红队对抗']['rel']}`);

const bwmResultWithConf = solveDeterministicBwm({
  solverType: 'BWM',
  criteria: [
    { id: 'rel', name: '可靠性', direction: 'maximize' },
    { id: 'perf', name: '性能', direction: 'maximize' },
    { id: 'cost', name: '成本', direction: 'minimize' },
  ],
  alternatives,
  scoreMatrix: {
    '方案A: 提案原案': { rel: 7.0, perf: 8.5, cost: 4.0 },
    '方案B: 红队对抗': { rel: 8.8, perf: 7.2, cost: 7.5 },
    '方案C: 架构补丁': { rel: 8.5, perf: 8.2, cost: 4.8 },
  },
  bestCriterionId: 'rel',
  worstCriterionId: 'cost',
  bestToOthers: [1, 2, 4],
  othersToWorst: [4, 2, 1],
  confidenceMatrix: confMatrix,
});

assert.strictEqual(bwmResultWithConf.status, 'optimal', 'BWM with confidence matrix must solve to optimal');
assert(bwmResultWithConf.ranking.length === 3, 'Must rank all 3 alternatives');
assert(bwmResultWithConf.confidenceMatrix !== undefined, 'Result payload must preserve confidenceMatrix');
console.log('   ✓ Confidence-Weighted MCDA Ranking:');
bwmResultWithConf.ranking.forEach((r) => {
  console.log(`     #${r.rank}: ${r.alternative} -> Utility ${(r.totalUtility * 10).toFixed(2)} / 10`);
});

// ==========================================
// Test 9: submit_challenge_critique MCP Tool Contract & Stage Gate
// ==========================================
console.log('\n9. Testing submit_challenge_critique Tool Contract & Stage Gate...');
const mockCritiqueToolCall = {
  server_name: 'shadow-crew-dev-mcp',
  tool_name: 'submit_challenge_critique',
  status: 'success',
  arguments: {
    fatal_flaws: ['未实现分布式幂等防重机制'],
    hidden_assumptions: ['假设下游支付网关永不超时与丢包'],
    failure_scenarios: ['网络分区时触发重复扣款导致资金损失'],
    counter_demands: ['引入全局分布式防重流水表与 2PC 兜底'],
    summary: '高并发支付丢包时可能引发重复扣款',
    target_claim_id: 'arg-node-1',
  },
};

const toolContractValidation = validateStageContract(
  'challenge',
  '针对该方案，我调用了原生红队批判工具提交四部曲质询。',
  'DeepSeek RedTeam',
  [mockCritiqueToolCall]
);
assert.strictEqual(toolContractValidation.isValid, true, 'Stage contract must pass with submit_challenge_critique tool call');
console.log('   ✓ Stage Contract Gate passed seamlessly via submit_challenge_critique tool call');

const extractedFromTool = extractChallengeCritiqueFromAcpResponse({
  textResponse: '针对方案已执行批判',
  mcpToolCalls: [mockCritiqueToolCall],
});
assert(extractedFromTool.critiquePayload !== undefined, 'Critique payload must be extracted from tool call');
assert.strictEqual(extractedFromTool.critiquePayload?.fatalFlaws[0], '未实现分布式幂等防重机制');
assert.strictEqual(extractedFromTool.critiquePayload?.targetClaimId, 'arg-node-1');
console.log('   ✓ Extracted critique payload from native MCP tool call');

// ==========================================
// Test 10: Fallback <<<CHALLENGER_CRITIQUE>>> Block Extraction
// ==========================================
console.log('\n10. Testing Fallback <<<CHALLENGER_CRITIQUE>>> Block Extraction...');
const fallbackCritiqueText = `
方案分析如下：
<<<CHALLENGER_CRITIQUE>>>
{
  "fatal_flaws": ["缓存穿透引发 DB 宕机"],
  "hidden_assumptions": ["假设所有查询 Key 均为热点有效键"],
  "failure_scenarios": ["黑客构造海量不存在 ID 并发打爆数据库"],
  "counter_demands": ["使用布隆过滤器或空值缓存"],
  "summary": "缓存击穿/穿透防护缺失",
  "target_claim_id": "arg-node-3"
}
<<<CHALLENGER_CRITIQUE_END>>>
请及时修补。
`;
const extractedFromBlock = extractChallengeCritiqueFromAcpResponse({
  textResponse: fallbackCritiqueText,
});
assert(extractedFromBlock.critiquePayload !== undefined, 'Critique payload must be extracted from fallback block');
assert.strictEqual(extractedFromBlock.critiquePayload?.fatalFlaws[0], '缓存穿透引发 DB 宕机');
assert.strictEqual(extractedFromBlock.critiquePayload?.targetClaimId, 'arg-node-3');
assert(!extractedFromBlock.cleanedText.includes('<<<CHALLENGER_CRITIQUE>>>'), 'Cleaned text must strip contract block');
console.log('   ✓ Extracted critique payload from fallback block and cleaned text');

// ==========================================
// Test 11: BUILTIN_SKILLS Registry Integrity
// ==========================================
console.log('\n11. Testing BUILTIN_SKILLS Registry Integrity...');
assert(BUILTIN_SKILLS.length === 4, 'Must register exactly 4 built-in skills');
const expectedSkillIds = [
  'skill-red-team-falsification',
  'skill-grounding-verification',
  'skill-gframe-modular-executor',
  'skill-living-adr-governance',
];
expectedSkillIds.forEach((id) => {
  const skill = BUILTIN_SKILLS.find((s) => s.id === id);
  assert(skill !== undefined, `Built-in skill ${id} must exist in registry`);
  assert.strictEqual(skill.type, 'builtin');
  assert.strictEqual(skill.mcpServer, 'shadow-crew-dev-mcp');
  assert(Boolean(skill.commandSnippet), `Skill ${id} must have commandSnippet`);
  console.log(`   ✓ Verified skill: [${skill.id}] -> ${skill.name} (${skill.commandSnippet})`);
});

console.log('\n=== All Wave 2 Unit & Integration Tests Passed 100%! ===\n');
