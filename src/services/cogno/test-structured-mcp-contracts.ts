/**
 * Batch 1 结构化 MCP 契约与确定性 AST 解析回归测试
 * 验证 4+1 博弈全流程优先消费结构化 MCP 工具参数/信封，并检验无正则/无截断前缀的边界反例
 */

import assert from 'assert';
import type { Agent, TaskModuleSlice } from '../../types';
import {
  extractArbitrationRulingFromAcpResponse,
  extractChallengeCritiqueFromAcpResponse,
  extractDefensePatchFromAcpResponse,
  extractProposalClaimsFromAcpResponse,
} from '../acpClient';
import { generateDeterministicMcdaPayload } from '../agentCollaboration';
import {
  calculateColMadContributions,
  compileMinorityReport,
  dehydrateContextWithAlert,
  detectSycophanticSurrender,
  estimateRoundAlignmentScore,
  evaluateDynamicSycophancyScore,
  extractArgumentNodes,
  localizeGraphDiffDispute,
  processVerifierEvidenceChain,
  synthesizeContextGroundedRulingDrafts,
  validateModuleScopeContract,
  validateStageContract,
} from './index';

const proposer = {
  id: 'agent-prop-1',
  name: 'Proposer Architect',
  handle: '@proposer',
  avatar: '🏛️',
  role: '首席架构师',
  status: 'online',
  color: '#3b82f6',
  modelBadge: 'claude-sonnet-4-5',
} as unknown as Agent;

const challenger = {
  id: 'agent-chal-1',
  name: 'RedTeam Challenger',
  handle: '@challenger',
  avatar: '⚔️',
  role: '安全红队对抗官',
  status: 'online',
  color: '#ef4444',
  modelBadge: 'gpt-4o',
} as unknown as Agent;

const verifier = {
  id: 'agent-ver-1',
  name: 'QA Verifier',
  handle: '@verifier',
  avatar: '🔍',
  role: '接地验证官',
  status: 'online',
  color: '#10b981',
  modelBadge: 'o3-mini',
} as unknown as Agent;

console.log('=== Structured MCP Contracts & Deterministic AST Regression Tests ===');

// 1. Stage 1: submit_proposal_claims -> ArgumentNodes & DAG
{
  const proposalAcp = {
    textResponse: '详细设计已在工具载荷中提交，核心围绕认证网关与限流策略隔离。',
    mcpToolCalls: [
      {
        server_name: 'shadow-crew-dev-mcp',
        tool_name: 'submit_proposal_claims',
        status: 'completed',
        arguments: {
          summary: '网关鉴权与令牌桶限流解耦设计',
          impacted_files: ['src/auth/jwtVerifier.ts', 'src/gateway/rateLimiter.ts'],
          claims: [
            {
              claim_id: 'claim-auth-1',
              claim: '采用分布式Redis缓存存储短期黑名单令牌并异步刷新公钥',
              assumptions: ['Redis 集群单可用区延迟 < 2ms'],
              confidence: 0.92,
            },
            {
              claim_id: 'claim-rate-2',
              claim: '采用分布式Redis缓存执行滑动窗口限流并在溢出时快速降级放行',
              assumptions: ['允许非核心读接口短时降级'],
              depends_on_claim_ids: ['claim-auth-1'],
              confidence: 0.88,
            },
          ],
        },
      },
    ],
  };

  const contractCheck = validateStageContract(
    'proposal',
    proposalAcp.textResponse,
    proposer.name,
    proposalAcp.mcpToolCalls
  );
  assert.strictEqual(contractCheck.isValid, true, 'Stage 1 should pass via submit_proposal_claims MCP call');

  const { proposalPayload } = extractProposalClaimsFromAcpResponse(proposalAcp);
  assert.ok(proposalPayload, 'ProposalClaimsPayload should be extracted');
  assert.strictEqual(proposalPayload?.claims.length, 2);

  const nodes = extractArgumentNodes(proposalAcp.textResponse, proposer.id, proposer.name, proposalPayload);
  assert.strictEqual(nodes.length, 2);
  assert.strictEqual(nodes[0].id, 'claim-auth-1');
  assert.strictEqual(nodes[1].id, 'claim-rate-2');
  assert.deepStrictEqual(nodes[1].dependencies, ['claim-auth-1']);
  console.log('  ✅ [1] Stage 1 submit_proposal_claims & DAG extraction passed');
}

// 2. Stage 2: extended submit_challenge_critique (shared 10-char prefix disambiguation!)
{
  const proposalClaimsNodes = extractArgumentNodes('', proposer.id, proposer.name, [
    {
      claimId: 'claim-auth-1',
      claim: '采用分布式Redis缓存存储短期黑名单令牌并异步刷新公钥',
    },
    {
      claimId: 'claim-rate-2',
      claim: '采用分布式Redis缓存执行滑动窗口限流并在溢出时快速降级放行',
      dependsOnClaimIds: ['claim-auth-1'],
    },
  ]);

  const critiqueAcp = {
    textResponse: '针对第二个限流断言的并发击穿漏洞已完成结构化提交。',
    mcpToolCalls: [
      {
        server_name: 'shadow-crew-dev-mcp',
        tool_name: 'mcp__shadow_crew_dev_mcp__submit_challenge_critique',
        status: 'completed',
        arguments: {
          summary: '滑动窗口限流在跨区脑裂时触发放行风暴',
          disputed_claim_ids: ['claim-rate-2'],
          target_claim_id: 'claim-rate-2',
          root_cause_category: 'concurrency_race',
          alignment_score: 0.35,
          reopening_triggers: ['当限流误放行率 > 5% 时立即重启本议题'],
          fatal_flaws: ['快速降级放行在突发恶意流量下会导致下游 DB 雪崩'],
          hidden_assumptions: ['默认上游网关已做 WAF 清洗'],
          failure_scenarios: ['Redis 分区超时触发全量快速放行'],
          counter_demands: ['补齐本地令牌桶兜底限流与熔断阈值'],
        },
      },
    ],
  };

  const challengeGate = validateStageContract(
    'challenge',
    critiqueAcp.textResponse,
    challenger.name,
    critiqueAcp.mcpToolCalls
  );
  assert.strictEqual(challengeGate.isValid, true, 'Stage 2 should pass via submit_challenge_critique');

  const { critiquePayload } = extractChallengeCritiqueFromAcpResponse(critiqueAcp);
  assert.ok(critiquePayload);
  assert.deepStrictEqual(critiquePayload?.disputedClaimIds, ['claim-rate-2']);
  assert.strictEqual(critiquePayload?.rootCauseCategory, 'concurrency_race');
  assert.strictEqual(critiquePayload?.alignmentScore, 0.35);

  const dehydration = dehydrateContextWithAlert(
    '',
    critiqueAcp.textResponse,
    proposalClaimsNodes,
    undefined,
    { critiquePayload }
  );
  const authNode = dehydration.allNodes.find((n) => n.id === 'claim-auth-1');
  const rateNode = dehydration.allNodes.find((n) => n.id === 'claim-rate-2');
  assert.strictEqual(authNode?.status, 'supported', 'Unchallenged shared-prefix claim must remain supported');
  assert.strictEqual(rateNode?.status, 'disputed', 'Explicitly disputed claim_id must be marked disputed');

  const dispute = localizeGraphDiffDispute(
    proposalClaimsNodes,
    critiqueAcp.textResponse,
    undefined,
    critiquePayload?.targetClaimId,
    critiquePayload
  );
  assert.ok(dispute.rootCause.includes('高并发'), 'root_cause_category should deterministically map rootCause label');

  const minorityReport = compileMinorityReport({
    dissentingAgentId: challenger.id,
    dissentingAgentName: challenger.name,
    critiqueText: critiqueAcp.textResponse,
    critiquePayload,
  });
  assert.strictEqual(minorityReport.reopeningTriggers[0], '当限流误放行率 > 5% 时立即重启本议题');
  console.log('  ✅ [2] Stage 2 extended submit_challenge_critique disambiguation & minority report passed');
}

// 3. Stage 3: submit_grounding_evidence with explicit claim_id + tier
{
  const proposalClaimsNodes = extractArgumentNodes('', proposer.id, proposer.name, [
    { claimId: 'claim-auth-1', claim: '采用分布式Redis缓存存储短期黑名单令牌' },
    { claimId: 'claim-rate-2', claim: '采用分布式Redis缓存执行滑动窗口限流' },
  ]);

  const evidenceResult = processVerifierEvidenceChain({
    topicId: 'topic-mcp-1',
    verifierText: '实证记录详见工具调用',
    mcpToolCalls: [
      {
        name: 'submit_grounding_evidence',
        arguments: {
          evidences: [
            {
              claim_id: 'claim-rate-2',
              tier: 'T2',
              source_tool: 'custom_load_tester',
              input_query_or_code: 'simulate_partition_burst()',
              raw_output: 'downstream queue saturated within 1.2s',
              truth_value: false,
              confidence: 0.94,
              verifier_report: '复现突发流量下快速降级导致下游过载',
            },
          ],
        },
      },
    ],
    committedStates: proposalClaimsNodes,
  });

  assert.strictEqual(evidenceResult.evidences.length, 1);
  assert.strictEqual(evidenceResult.evidences[0].claimId, 'claim-rate-2');
  assert.strictEqual(evidenceResult.evidences[0].tier, 'T2', 'Explicit tier T2 should be preserved');
  assert.strictEqual(
    evidenceResult.updatedCommittedStates?.find((n) => n.id === 'claim-auth-1')?.status,
    'supported',
    'Unrelated shared-prefix node must not be refuted'
  );
  assert.strictEqual(
    evidenceResult.updatedCommittedStates?.find((n) => n.id === 'claim-rate-2')?.status,
    'refuted',
    'Target claim_id node must be refuted'
  );
  console.log('  ✅ [3] Stage 3 submit_grounding_evidence claim_id & tier preservation passed');
}

// 4. Stage 4: submit_defense_patch (principled patch vs full surrender without patch)
{
  const principledAcp = {
    textResponse: '<<<DEFENSE_PATCH>>>\n' +
      JSON.stringify({
        summary: '保留网关异步刷新结构并补充本地令牌桶兜底限流',
        stance: 'partial_concession_with_patch',
        patched_claims: [
          {
            claim_id: 'claim-rate-2',
            resolution: '增加本地令牌桶 200 RPS 兜底与熔断阈值 <= 5%',
            status: 'resolved',
          },
        ],
        defense_patches: ['新增本地 TokenBucketFallback 并配置熔断指标 <= 5%'],
        quantified_metrics: ['200 RPS', 'P99 <= 12ms'],
        impacted_files: ['src/gateway/rateLimiter.ts'],
        alignment_score: 0.82,
      }) +
      '\n<<<DEFENSE_PATCH_END>>>',
  };

  const { defensePayload: principledPayload } = extractDefensePatchFromAcpResponse(principledAcp);
  assert.ok(principledPayload);
  assert.strictEqual(principledPayload?.stance, 'partial_concession_with_patch');
  assert.strictEqual(detectSycophanticSurrender(principledAcp.textResponse, principledPayload).isSurrender, false);

  const principledSyc = evaluateDynamicSycophancyScore(
    proposer,
    principledAcp.textResponse,
    true,
    principledPayload
  );
  assert(principledSyc.dss <= 0.35, `Expected low DSS for principled patch, got ${principledSyc.dss}`);

  const defenseGate = validateStageContract('defense', principledAcp.textResponse, proposer.name);
  assert.strictEqual(defenseGate.isValid, true);

  const alignment = estimateRoundAlignmentScore({
    defenseText: principledAcp.textResponse,
    defensePayload: principledPayload,
  });
  assert.strictEqual(alignment, 0.82);

  // Full surrender negative counterexample
  const surrenderAcp = {
    textResponse: '我同意',
    mcpToolCalls: [
      {
        server_name: 'shadow-crew-dev-mcp',
        tool_name: 'submit_defense_patch',
        status: 'completed',
        arguments: {
          summary: '完全认同红队意见并撤回原方案',
          stance: 'full_surrender_without_patch',
          patched_claims: [],
          defense_patches: [],
          impacted_files: [],
        },
      },
    ],
  };
  const { defensePayload: surrenderPayload } = extractDefensePatchFromAcpResponse(surrenderAcp);
  assert.strictEqual(detectSycophanticSurrender(surrenderAcp.textResponse, surrenderPayload).isSurrender, true);
  const surrenderSyc = evaluateDynamicSycophancyScore(
    proposer,
    surrenderAcp.textResponse,
    true,
    surrenderPayload
  );
  assert.strictEqual(surrenderSyc.surrenderDetected, true);
  assert(surrenderSyc.discountFactorGamma < 0.7);
  console.log('  ✅ [4] Stage 4 submit_defense_patch sycophancy & alignment passed');
}

// 5. Stage 5: submit_arbitration_ruling + mcda_matrix + RULING_DRAFT synthesizer
{
  const rulingAcp = {
    textResponse: '最终裁决已通过工具提交。',
    mcpToolCalls: [
      {
        server_name: 'shadow-crew-dev-mcp',
        tool_name: 'submit_arbitration_ruling',
        status: 'completed',
        arguments: {
          decision_type: 'trade_off_matrix',
          summary: '采纳分布式鉴权基线并强制合入本地令牌桶熔断补丁',
          trade_off_points: ['优先保障系统可用性与下游 DB 保护'],
          impacted_files: ['src/gateway/rateLimiter.ts'],
          mcda_matrix: {
            criteria: [
              { id: 'rel', name: '可靠性与过载保护', direction: 'maximize' },
              { id: 'perf', name: '吞吐性能', direction: 'maximize' },
              { id: 'comp', name: '实现复杂度', direction: 'minimize' },
            ],
            alternatives: ['方案A: 原快速放行', '方案B: 推倒重写', '方案C: 本地令牌桶兜底补丁'],
            score_matrix: {
              '方案A: 原快速放行': { rel: 4.5, perf: 8.8, comp: 4.0 },
              '方案B: 推倒重写': { rel: 9.0, perf: 7.0, comp: 9.0 },
              '方案C: 本地令牌桶兜底补丁': { rel: 9.1, perf: 8.4, comp: 5.5 },
            },
            best_criterion_id: 'rel',
            worst_criterion_id: 'comp',
            best_to_others: [1, 2, 4],
            others_to_worst: [4, 2, 1],
          },
        },
      },
    ],
  };

  const rulingDraft = extractArbitrationRulingFromAcpResponse(rulingAcp, 'Arbiter');
  assert.ok(rulingDraft?.mcdaMatrix, 'mcdaMatrix must be extracted from submit_arbitration_ruling');

  const mcda = generateDeterministicMcdaPayload({
    mcdaMatrix: rulingDraft?.mcdaMatrix,
  });
  assert.strictEqual(mcda.consistencyPassed, true);
  assert(
    mcda.ranking[0]?.alternative.includes('方案C'),
    `Expected 方案C to win, got ${mcda.ranking[0]?.alternative}`
  );

  const colmad = calculateColMadContributions({
    topicId: 'topic-mcp-1',
    agents: [proposer, challenger, verifier],
    gameRoles: {
      proposers: [proposer.id],
      challengers: [challenger.id],
      verifiers: [verifier.id],
      arbiters: [],
      humanIsArbiter: true,
    },
    proposalText: '异步刷新公钥',
    critiqueText: '极端工况：并发击穿导致雪崩',
    critiquePayload: {
      summary: '极端工况并发雪崩',
      fatalFlaws: ['并发击穿导致雪崩'],
      hiddenAssumptions: [],
      failureScenarios: ['Redis 分区超时'],
      counterDemands: [],
    },
    verificationText: '完成压测',
    evidences: [
      {
        evidenceId: 'ev-1',
        claimId: 'claim-auth-1',
        sourceTool: 'ast_grep',
        inputQueryOrCode: 'verify()',
        rawOutput: 'ok',
        truthValue: true,
        verifierReport: '通过',
        tier: 'T1',
      },
    ],
  });
  assert(colmad.scores[challenger.id].discoveredEdgeCasesCount >= 2);
  assert(colmad.scores[verifier.id].verifiedClaimsCount >= 1);

  const drafts = synthesizeContextGroundedRulingDrafts({
    topicTitle: '认证与限流演进',
    proposalPayload: {
      summary: '网关鉴权与令牌桶解耦',
      claims: [{ claimId: 'c1', claim: '采用 Redis 分布式黑名单缓存' }],
      impactedFiles: ['src/auth/jwtVerifier.ts'],
    },
    critiquePayload: {
      summary: '分区超时引发雪崩',
      fatalFlaws: ['突发流量直接透传 DB'],
      hiddenAssumptions: [],
      failureScenarios: ['Redis 分区超时'],
      counterDemands: [],
    },
    defensePayload: {
      summary: '合入本地令牌桶熔断补丁',
      stance: 'partial_concession_with_patch',
      patchedClaims: [],
      defensePatches: ['增加本地令牌桶 200 RPS 兜底'],
      impactedFiles: ['src/gateway/rateLimiter.ts'],
    },
  });
  assert(drafts.adopt_proposer.impactedFiles.includes('src/auth/jwtVerifier.ts'));
  assert(drafts.adopt_proposer.impactedFiles.includes('src/gateway/rateLimiter.ts'));
  console.log('  ✅ [5] Stage 5 submit_arbitration_ruling + mcda_matrix + ColMAD + Draft Synthesizer passed');
}

// 6. Module Scope Guard negative phrasing invariance
{
  const activeMod: TaskModuleSlice = {
    moduleId: 'm1',
    title: 'M1 Auth',
    responsibility: 'Auth',
    allowedFiles: ['src/auth/jwtVerifier.ts'],
    dependsOnModuleIds: [],
    status: 'proposing',
    complexityLevel: 'medium_standard',
    requiresRedTeam: true,
    belief: {
      priorRisk: 0.6,
      posteriorRisk: 0.6,
      routingMode: 'deep_debate',
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 0,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: new Date().toISOString(),
    },
    scopedMessageIds: [],
  };
  const otherMod: TaskModuleSlice = {
    ...activeMod,
    moduleId: 'm2',
    title: 'M2 Secret',
    allowedFiles: ['src/secret/keys.ts'],
  };

  const scopeOk = validateModuleScopeContract(
    '分析结论：不修改 src/secret/keys.ts，仅修正 src/auth/jwtVerifier.ts 中的过期校验逻辑。',
    activeMod,
    [activeMod, otherMod]
  );
  assert.strictEqual(scopeOk.isScopeValid, true, 'Negated mention of sibling module file must not trigger violation');

  const scopeViolation = validateModuleScopeContract(
    '本次将直接编辑 src/secret/keys.ts 并调整密钥加载路径。',
    activeMod,
    [activeMod, otherMod]
  );
  assert.strictEqual(scopeViolation.isScopeValid, false);
  assert.deepStrictEqual(scopeViolation.violatedFiles, ['src/secret/keys.ts']);
  console.log('  ✅ [6] Negative-phrasing invariance in validateModuleScopeContract passed');
}

console.log('\n🎉 All Batch 1 Structured MCP Contract Tests Passed 100%!');
