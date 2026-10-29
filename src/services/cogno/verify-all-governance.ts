/**
 * CognoNexus 博弈论多 Agent 系统：全景自动化验证套件 (16 项核心机制逐项断言)
 * 对应文档：docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md
 *
 * 覆盖范围：
 * - 第一部分：保证 Token 消耗量不过大的 7 大代码设计 (T1 ~ T7)
 * - 第二部分：保证讨论结果趋向正确的 9 大代码设计 (A1 ~ A9)
 */

import assert from 'node:assert/strict';
import {
  stepSprtGovernor,
  fitSprtCalibrationParams,
  estimateRoundAlignmentScore,
} from './sprtComputeGovernor';
import {
  extractArgumentNodes,
  buildArgumentDag,
  localizeGraphDiffDispute,
  dehydrateContextWithAlert,
} from './lmadConflictLocalizer';
import {
  checkLoopGuard,
  buildTopicPrompt,
  buildCascadePrompt,
  getAgentGameRole,
  generateDeterministicMcdaPayload,
  CollaborationCascade,
} from '../agentCollaboration';
import {
  validateStageContract,
  validateModuleScopeContract,
  STAGE_CONTRACT_MAX_RETRIES,
} from './stageContractGate';
import {
  initializeModularOrchestrationState,
  updateModuleBeliefWithFeedback,
  computeEntropyReductionRatio,
} from './bayesianModuleGovernor';
import { calculateColMadContributions } from './colmadGovernor';
import {
  solveExactBwmOptionB,
  solveDeterministicBwm,
} from './mcdaDeterministicSolver';
import {
  tieredGroundingGovernor,
  processVerifierEvidenceChain,
} from './tieredGroundingGovernor';
import {
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
} from './sycophancyGovernor';
import {
  calculateModelDiversity,
  calculateConfidenceMatrix,
} from './modelDiversityGovernor';
import { compileMinorityReport } from './minorityReportCompiler';
import {
  extractArbitrationRulingFromAcpResponse,
  extractModuleDecompositionFromAcpResponse,
} from '../acpClient';
import { generateAdrMarkdown } from '../../components/LivingAdrCanvas';
import { Agent, TopicMessageData } from '../../types';

function mockAgent(overrides: Partial<Agent> & { id: string; name: string; handle: string; role: string }): Agent {
  return {
    avatar: '🤖',
    status: 'idle',
    description: 'Test Agent',
    color: '#6366f1',
    acpTransport: 'stdio',
    acpCommandOrUrl: 'mock-cmd',
    protocolVersion: '1.0',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    modelBadge: 'Claude 3.7 Sonnet',
    skills: [],
    workspace: {
      rootPath: '/tmp',
      repoName: 'shadow-crew',
      gitBranch: 'main',
      permissionMode: 'read_only',
      activeFiles: [],
    },
    memory: {
      internalMemoryPath: '/tmp/mem',
      persistentType: 'sqlite',
      persistentItems: [],
      sessionCacheCount: 0,
    },
    ...overrides,
  };
}

function mockCascade(overrides: Partial<CollaborationCascade> = {}): CollaborationCascade {
  return {
    cascadeId: 'cas-1',
    rootMessageId: 'msg-1',
    roomId: 'room-1',
    originalPrompt: '测试议题',
    depth: 1,
    maxDepth: 4,
    visitedAgentIds: [],
    agentCallCounts: {},
    isAborted: false,
    ...overrides,
  };
}

interface CheckResult {
  id: string;
  category: 'Token 控制 (7项)' | '准确性趋真 (9项)';
  name: string;
  paper: string;
  evidence: string;
  passed: boolean;
}

const results: CheckResult[] = [];

function verify(
  id: string,
  category: CheckResult['category'],
  name: string,
  paper: string,
  fn: () => string
) {
  try {
    const evidence = fn();
    results.push({ id, category, name, paper, evidence, passed: true });
    console.log(`  ✅ [${id}] ${name} -> ${evidence}`);
  } catch (err: any) {
    results.push({
      id,
      category,
      name,
      paper,
      evidence: err?.message || String(err),
      passed: false,
    });
    console.error(`  ❌ [${id}] ${name} 失败:`, err);
    throw err;
  }
}

async function runAllVerifications() {
  console.log('================================================================================');
  console.log('🧪 Shadow Crew (CognoNexus) 博弈论多 Agent 16 项核心设计自动化验证套件');
  console.log('📄 对照基准: docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md');
  console.log('================================================================================\n');

  console.log('--- 📉 第一部分：验证保证 Token 消耗量不过大的 7 大代码设计 ---');

  // T1: Wald-SPRT 动态早停与死锁熔断
  verify(
    'T1',
    'Token 控制 (7项)',
    'Wald-SPRT 序贯概率比早停与死锁熔断',
    'Wald-SPRT (arXiv:2605.19193)',
    () => {
      // 高置信早停测试
      const s1 = stepSprtGovernor({ currentRound: 1, alignmentScore: 0.95, alpha: 0.05, beta: 0.05 });
      const s2 = stepSprtGovernor({ priorState: s1, currentRound: 2, alignmentScore: 0.95, alpha: 0.05, beta: 0.05 });
      assert.equal(s2.decisionState, 'early_exit', '高对齐似然比突破上界 A 应触发 early_exit');

      // 死锁熔断测试
      const d1 = stepSprtGovernor({ currentRound: 1, alignmentScore: 0.05, alpha: 0.05, beta: 0.05 });
      const d2 = stepSprtGovernor({ priorState: d1, currentRound: 2, alignmentScore: 0.05, alpha: 0.05, beta: 0.05 });
      assert.equal(d2.decisionState, 'deadlock_escalation', '低对齐似然比跌破下界 B 应触发 deadlock_escalation');

      return `EarlyExit(Λ=${s2.logLikelihoodRatio}>=${s2.upperThresholdA}) & Deadlock(Λ=${d2.logLikelihoodRatio}<=${d2.lowerThresholdB})`;
    }
  );

  // T2: LMAD 局部冲突切片与三态上下文脱水
  verify(
    'T2',
    'Token 控制 (7项)',
    'LMAD 局部冲突切片 (Top-5 限制) 与三态上下文脱水',
    'LMAD (arXiv:2608.01463)',
    () => {
      const longProposal = `
        架构总览：
        首先，系统采用 Redis Cluster 实现分布式会话缓存。
        其次，系统引入一致性 Hash 环防止节点雪崩。
        再次，系统基于两阶段提交实现分布式锁保证事务隔离。
        另外，服务采用 Kafka 异步队列解耦日志落盘。
        最后，网关配置自适应限流器防止恶意流量冲击。
        同时，底层存储选用 PostgreSQL 分区表持久化历史账单。
        此外，监控模块构建 Prometheus 指标采集管道。
      `;
      const nodes = extractArgumentNodes(longProposal);
      assert.ok(nodes.length <= 5, `Top-5 节点上限生效 (实际: ${nodes.length})`);
      const dehydrated = dehydrateContextWithAlert(longProposal, '两阶段提交在断网下会引发死锁隐患', nodes);
      assert.ok(dehydrated.committedStates.length < nodes.length, '争议节点已从无争议看板剥离');
      return `抽取节点=${nodes.length}/5 (外壳=0), 脱水保留=${dehydrated.committedStates.length}条无争议事实`;
    }
  );

  // T3: 阶段靶点按需挂载与滑动窗口双重截断
  verify(
    'T3',
    'Token 控制 (7项)',
    '阶段靶点按需挂载与历史滑动窗口 300 字截断',
    'LMAD & DIANOIA',
    () => {
      const dummyAgent = mockAgent({ id: 'a1', name: 'Challenger', handle: '@challenger', role: '红队' });
      const overlongHistory = 'A'.repeat(600);
      const prompt = buildTopicPrompt({
        topic: {
          topicId: 't-1',
          title: '测试议题',
          discussionMode: 'game_theoretic',
          gameStage: 'challenge',
          gameRoles: { proposers: ['p1'], challengers: ['a1'], arbiters: [], humanIsArbiter: true },
          targetProposalText: '核心提案内容',
          recentHistory: [{ author: 'Architect', content: overlongHistory }],
        },
        userContent: '开始审查',
        targetAgent: dummyAgent,
        availableAgents: [dummyAgent],
      });
      assert.ok(!prompt.includes('A'.repeat(350)), '超过 300 字符的历史消息已被截断');
      assert.ok(prompt.includes('AAA...'), '截断后附带省略号标记');
      const relay = buildCascadePrompt({
        invokingAgent: dummyAgent,
        targetAgent: dummyAgent,
        originalUserPrompt: '测试',
        invokingAgentReply: '结论',
        cascade: mockCascade(),
        availableAgents: [dummyAgent],
      });
      assert.ok(!relay.includes('[🛡️ Shadow Crew 平台智能体协同公约'), '接力提示词不重复注入 30 行系统公约');
      return '单条历史 >300 字硬截断生效，接力 Prompt 零公约复读';
    }
  );

  // T4: “静默即成功”协同公约与 LoopGuard 回环守卫
  verify(
    'T4',
    'Token 控制 (7项)',
    '静默即成功公约与 LoopGuard 深度/频次静默守卫',
    'ColMAD (arXiv:2510.20963)',
    () => {
      const depthGuard = checkLoopGuard(
        mockCascade({ depth: 4, maxDepth: 4 }),
        'agent-1'
      );
      assert.equal(depthGuard.allowed, false);
      assert.equal(depthGuard.isSilentEnd, true, '触达最大深度时必须静默结束');

      const freqGuard = checkLoopGuard(
        mockCascade({ depth: 2, maxDepth: 6, agentCallCounts: { 'agent-1': 8 } }),
        'agent-1'
      );
      assert.equal(freqGuard.allowed, false);
      assert.equal(freqGuard.isSilentEnd, true, '单 Agent 频次超限时必须静默结束');
      return `DepthGuard(isSilentEnd=${depthGuard.isSilentEnd}) & FreqGuard(count=8 -> blocked)`;
    }
  );

  // T5: 阶段契约有界 Self-Refine 与失败硬熔断
  verify(
    'T5',
    'Token 控制 (7项)',
    '阶段契约 0-Token 本地预检与有界 Self-Refine (MAX=2)',
    'Free-MAD (arXiv:2509.11035)',
    () => {
      const bareAck = validateStageContract('proposal', '好的，收到，我完全同意上述方案。');
      assert.equal(bareAck.isValid, false, '裸确认敷衍回复必须被拦截');
      assert.equal(STAGE_CONTRACT_MAX_RETRIES, 2, '最大自修正次数严格限制为 2');
      return `裸确认拦截生效 (缺失项=${bareAck.missingRequirements.length}), MAX_RETRIES=${STAGE_CONTRACT_MAX_RETRIES}`;
    }
  );

  // T6: ColMAD 车轱辘话与冗余顺从惩罚
  verify(
    'T6',
    'Token 控制 (7项)',
    'ColMAD 车轱辘话与冗余套话负向惩罚',
    'ColMAD (arXiv:2510.20963)',
    () => {
      const redundantAgent = mockAgent({ id: 'r1', name: 'Repeater', handle: '@rep', role: 'Chatter' });
      const report = calculateColMadContributions({
        topicId: 't-col',
        agents: [redundantAgent],
        proposalText: '总的来说，综上所述，正如前面所说，如前所述，您说得对，完全认同。',
      });
      const score = report.scores['r1'];
      assert.ok(score.redundantPenalty >= 5, '车轱辘话套话惩罚计数生效');
      assert.equal(score.reputationLevel, 'redundant', '负分应标记为 redundant 冗余等级');
      return `Penalty=${score.redundantPenalty}, FactReward=${score.factReward}, Level=${score.reputationLevel}`;
    }
  );

  // T7: 神经符号数学卸载与 MCP 工具契约直通
  verify(
    'T7',
    'Token 控制 (7项)',
    'BWM 0-Token 本地数学求解与 MCP submit_arbitration_ruling 直通',
    'LLM + BWM (Applied Sciences, 2026)',
    () => {
      const t0 = performance.now();
      const bwm = solveExactBwmOptionB({
        n: 4,
        bestIdx: 0,
        worstIdx: 3,
        bestToOthers: [1, 2, 3, 5],
        othersToWorst: [5, 3, 2, 1],
      });
      const elapsedMs = (performance.now() - t0).toFixed(2);
      assert.equal(bwm.status, 'optimal');

      const draft = extractArbitrationRulingFromAcpResponse({
        raw: {
          mcp_tool_calls: [
            {
              tool_name: 'submit_arbitration_ruling',
              arguments: {
                decision_type: 'trade_off_matrix',
                summary: '采用双层缓存与异步锁折中方案',
                trade_off_points: ['保障 P99 延迟 < 10ms'],
                impacted_files: ['src/App.tsx'],
              },
            },
          ],
        },
      });
      assert.ok(draft, 'MCP submit_arbitration_ruling 工具载荷直通提取成功');
      return `BWM 0-Token 求解耗时 ${elapsedMs}ms (ξ*=${bwm.xi.toFixed(3)}), MCP 裁决直通=${draft.decisionType}`;
    }
  );

  // T8: G-Frame 模块级上下文物理隔离与快速通道节流
  verify(
    'T8',
    'Token 控制 (7项)',
    'G-Frame 模块级上下文物理隔离与贝叶斯快速通道节流',
    'G-Frame (Bayesian & Team Game)',
    () => {
      const decomp = extractModuleDecompositionFromAcpResponse({
        mcpToolCalls: [
          {
            server_name: 'shinobi-dev-mcp',
            tool_name: 'submit_module_decomposition',
            status: 'completed',
            arguments: {
              shared_contract: {
                summary: '定义统一 OrderContext 契约',
                type_signatures: 'export interface OrderContext { id: string; }',
                invariants: ['禁止跨模块越界修改'],
              },
              modules: [
                { module_id: 'M1', title: '鉴权锁模块', responsibility: 'Redis 分布式锁防并发死锁', allowed_files: ['src/auth/lock.ts'], depends_on: [], complexity_level: 'high_critical' },
                { module_id: 'M2', title: '状态展示组件', responsibility: '纯 UI 胶囊渲染', allowed_files: ['src/components/Badge.tsx'], depends_on: ['M1'], complexity_level: 'low_deterministic' },
              ],
            },
          },
        ],
      });
      assert.ok(decomp, 'MCP submit_module_decomposition 载荷直通提取成功');
      const state = initializeModularOrchestrationState(decomp);
      assert.equal(state.modules[0].belief.routingMode, 'deep_debate', '高风险模块应路由至 deep_debate');
      assert.equal(state.modules[1].belief.routingMode, 'fast_track', '低风险模块应路由至 fast_track 节省红队轮次');
      const ratio = computeEntropyReductionRatio(3600, 700, 200);
      return `模块拆解=${state.modules.length}项, M2路由=${state.modules[1].belief.routingMode}, 上下文压缩比=${(ratio * 100).toFixed(1)}%`;
    }
  );

  console.log('\n--- 🎯 第二部分：验证保证讨论结果趋向正确的 9 大代码设计 ---');

  // A1: DIANOIA 4+1 职能正交解耦与 FSM
  verify(
    'A1',
    '准确性趋真 (9项)',
    'DIANOIA 4+1 职能正交解耦与角色隔离路由',
    'DIANOIA (arXiv:2602.08586)',
    () => {
      const roles = {
        proposers: ['ag-prop'],
        challengers: ['ag-chal'],
        verifiers: ['ag-ver'],
        arbiters: ['ag-arb'],
        humanIsArbiter: true,
      };
      assert.equal(getAgentGameRole('ag-prop', roles), 'proposer');
      assert.equal(getAgentGameRole('ag-chal', roles), 'challenger');
      assert.equal(getAgentGameRole('ag-ver', roles), 'verifier');
      assert.equal(getAgentGameRole('ag-arb', roles), 'arbiter');
      return '4+1 角色 (Proposer/Challenger/Verifier/Arbiter + Human) 正交路由验证通过';
    }
  );

  // A2: Free-MAD 反从众红队四部曲批判契约
  verify(
    'A2',
    '准确性趋真 (9项)',
    'Free-MAD 反从众红队四部曲结构化门禁',
    'Free-MAD (arXiv:2509.11035)',
    () => {
      const weakChallenge = validateStageContract('challenge', '我觉得这个方案挺好的，没有什么大问题，可以继续推进实施，大家辛苦了。');
      assert.equal(weakChallenge.isValid, false, '缺乏四部曲批判维度的温和回复必须被红队门禁拦截');

      const strongChallenge = validateStageContract(
        'challenge',
        '1. 逻辑矛盾与缺陷：当前方案隐含假设底层跨机房网络绝对可靠且零延迟；2. 极端边缘工况：在高并发竞争与断网抖动场景下必然引发分布式锁死锁与脏数据穿透；3. 反例要求：请提供混沌压测实证与可复现测试用例。'
      );
      assert.equal(strongChallenge.isValid, true, '包含矛盾、假设、极端工况与实证要求且篇幅 >=70 字的四部曲应通过');
      return '温和赞同被红队门禁拦截，四部曲压测质询通过';
    }
  );

  // A3: 分级物理接地验证 (T1/T2)、原子承诺链与未实证早停硬锁
  verify(
    'A3',
    '准确性趋真 (9项)',
    'T1/T2 分级接地验证、原子承诺链与未实证早停硬锁',
    'DIANOIA & Consistency Illusion / GDP (arXiv:2606.08457)',
    () => {
      // 1. T1 权重钳制 <= 0.30
      const wT1 = tieredGroundingGovernor.clampEvidenceWeight('T1', 0.95);
      assert.equal(wT1, 0.30, 'T1 只读工具权重必须封顶为 0.30');

      // 2. T2 未签署安全宪章硬冻结
      const nodes = extractArgumentNodes('系统采用两阶段提交实现分布式锁保证强一致性。');
      const chainRes = processVerifierEvidenceChain({
        topicId: 't-gdp',
        verifierText: '```json\n[{"sourceTool":"code_sandbox","input":"test_lock()","output":"Deadlock","truthValue":false,"claimId":"arg-node-1"}]\n```',
        isSafetyCharterSigned: false,
        committedStates: nodes,
      });
      assert.equal(chainRes.evidences[0].truthValue, false);
      assert.equal(chainRes.updatedCommittedStates?.[0].status, 'refuted', '实证证伪后原子承诺节点状态必须降级为 refuted');

      // 3. 未实证早停硬锁
      const lockedSprt = stepSprtGovernor({
        currentRound: 2,
        alignmentScore: 0.95,
        priorState: {
          currentRound: 1,
          maxRounds: 4,
          logLikelihoodRatio: 2.5,
          upperThresholdA: 2.944,
          lowerThresholdB: -2.944,
          latestAlignmentScore: 0.95,
          decisionState: 'continue',
          statusDescription: '',
        },
        hasUnverifiedCriticalDispute: true,
      });
      assert.equal(lockedSprt.decisionState, 'continue', '存在未核验核心争议时严禁触发 early_exit');
      return `T1权重封顶=${wT1}, 证伪节点自动降级=refuted, 未实证早停硬锁=生效`;
    }
  );

  // A4: BSS/DSS 谄媚偏见量化、投降拦截与 γ 信任折减
  verify(
    'A4',
    '准确性趋真 (9项)',
    'BSS/DSS 谄媚偏见量化、无补丁投降拦截与 γ 折减',
    'Sycophancy Propagation (arXiv:2604.02668)',
    () => {
      const dummyAgent = mockAgent({
        id: 'ag-1',
        name: 'Follower',
        handle: '@f',
        role: 'Dev',
        modelBadge: 'qwen-7b-mini',
      });
      const surrenderText = '您说得对，完全认同您的反驳，确实是我考虑不周，我收回之前的方案，全盘放弃原方案。';
      const evalRes = evaluateDynamicSycophancyScore(dummyAgent, surrenderText);
      assert.equal(evalRes.surrenderDetected, true, '应检测到全盘投降');
      assert.ok(evalRes.discountFactorGamma < 0.65, `高谄媚发言应受到显著信任折减 (γ=${evalRes.discountFactorGamma})`);

      const discountedSprt = applySycophancyDiscountToSprt(0.92, evalRes);
      assert.ok(discountedSprt < 0.78, `虚假高对齐分 0.92 应被回拉至 ${discountedSprt}`);
      return `BSS=${evalRes.bss}, DSS=${evalRes.dss}, γ=${evalRes.discountFactorGamma}, 虚假对齐回拉: 0.92->${discountedSprt}`;
    }
  );

  // A5: ReConcile 异构模型家族检测与校准置信度加权
  verify(
    'A5',
    '准确性趋真 (9项)',
    'ReConcile 异构模型家族检测与校准置信度矩阵',
    'ReConcile (ACL / arXiv:2309.13007)',
    () => {
      const homoAgents: Agent[] = [
        mockAgent({ id: '1', name: 'A1', handle: '@a1', role: 'P', modelBadge: 'claude-3-7-sonnet' }),
        mockAgent({ id: '2', name: 'A2', handle: '@a2', role: 'C', modelBadge: 'claude-3-5-haiku' }),
      ];
      const divHomo = calculateModelDiversity(homoAgents);
      assert.equal(divHomo.isHomogeneous, true, '同家族模型必须触发同质化告警');
      assert.equal(divHomo.score, 0.25);

      const confMatrix = calculateConfidenceMatrix({
        alternatives: ['PlanA', 'PlanB'],
        criteriaIds: ['rel'],
        evidences: [{ evidenceId: 'e1', sourceTool: 'static_analyzer', inputQueryOrCode: '', rawOutput: '', truthValue: false, verifierReport: '' }],
      });
      assert.ok(confMatrix['PlanA']['rel'] < confMatrix['PlanB']['rel'], '存在证伪证据时原方案置信度必须低于红队方案');
      return `同质化检测=生效(score=0.25), 证伪后置信度对比 PlanA(${confMatrix['PlanA']['rel']}) < PlanB(${confMatrix['PlanB']['rel']})`;
    }
  );

  // A6: LLM + BWM 运筹求解与 ξ* 一致性硬门禁
  verify(
    'A6',
    '准确性趋真 (9项)',
    'LLM + BWM 运筹求解、FLAT 退化拒绝与 ξ* 一致性门禁',
    'LLM + BWM (Applied Sciences, 2026)',
    () => {
      const flatRejected = solveDeterministicBwm({
        criteria: [
          { id: 'c1', name: 'C1', direction: 'maximize' },
          { id: 'c2', name: 'C2', direction: 'maximize' },
        ],
        alternatives: ['A', 'B'],
        scoreMatrix: { A: { c1: 8, c2: 7 }, B: { c1: 6, c2: 9 } },
        bestCriterionId: 'c1',
        worstCriterionId: 'c2',
        bestToOthers: [1, 1],
        othersToWorst: [1, 1],
        throwOnDegeneracy: false,
      });
      assert.equal(flatRejected.status, 'rejected');
      assert.equal(flatRejected.rejectionReason, 'insufficient_information');

      const mcda = generateDeterministicMcdaPayload({
        topicTitle: '高并发锁与数据一致性设计',
        proposalText: '采用 Redis 分布式锁保证一致性',
        critiqueText: '主从切换存在锁丢失隐患',
        defenseText: '引入 Redlock 与异步对账补丁',
      });
      assert.equal(mcda.consistencyPassed, true);
      assert.ok(mcda.consistencyIndex <= 0.12);
      return `FLAT退化拒识=生效, 真实语料BWM求解 ξ*=${mcda.consistencyIndex}<=0.12 (最优=${mcda.ranking[0].alternative.slice(0, 12)}...)`;
    }
  );

  // A7: ColMAD 非零和协同增量事实奖励
  verify(
    'A7',
    '准确性趋真 (9项)',
    'ColMAD 非零和协同增量事实奖励与先锋声誉激励',
    'ColMAD (arXiv:2510.20963)',
    () => {
      const pioneerAgent = mockAgent({ id: 'p1', name: 'Sentinel', handle: '@sen', role: '红队', avatar: '⚔️' });
      const rep = calculateColMadContributions({
        topicId: 't-1',
        agents: [pioneerAgent],
        critiqueText: '在极端工况下，高并发竞争与网络抖动会导致脑裂、死锁与内存泄漏，存在严重单点故障。',
      });
      const s = rep.scores['p1'];
      assert.ok(s.discoveredEdgeCasesCount >= 4, '应识别出多处真实极端边界工况');
      assert.equal(s.reputationLevel, 'pioneer', '高增量事实贡献应评为 pioneer 先锋');
      return `发现边界工况=${s.discoveredEdgeCasesCount}项, FactReward=+${s.factReward}, 声誉=${s.reputationLevel}`;
    }
  );

  // A8: Disagreement-Aware 伴生《少数派异议报告》与黑天鹅触发器
  verify(
    'A8',
    '准确性趋真 (9项)',
    'Disagreement-Aware 伴生少数派异议报告与黑天鹅重启条件',
    'Disagreement-Aware (arXiv:2606.04223)',
    () => {
      const report = compileMinorityReport({
        dissentingAgentId: 'chal-1',
        dissentingAgentName: 'RedTeam_Expert',
        critiqueText: '致命隐患：异步复制在跨机房网络分区下必然丢失最近 500ms 账单流水，可能导致资金对账不平。',
      });
      assert.ok(report.coreDissentThesis.length > 5);
      assert.equal(report.reopeningTriggers.length, 3, '必须生成 3 条量化黑天鹅重启触发条件');
      return `保留异议="${report.coreDissentThesis.slice(0, 18)}...", 黑天鹅重启触发器=${report.reopeningTriggers.length}条`;
    }
  );

  // A9: 法定人数门禁與活体 ADR 架构决策画布导出
  verify(
    'A9',
    '准确性趋真 (9项)',
    '活体 ADR 决策画布 (Living ADR Canvas) 4 大章节与爆炸半径约束',
    'DIANOIA & ADR Standard',
    () => {
      const mockTopic: TopicMessageData = {
        id: 'adr-001',
        channelId: 'ch-1',
        workspaceBindingId: 'ws-topic-adr-001',
        title: '订单幂等防重与分布式锁架构决议',
        description: '解决高并发重复支付问题',
        status: 'resolved',
        authorId: 'user-1',
        authorName: 'Norris',
        authorAvatar: '👤',
        timestamp: '14:30',
        repliesCount: 5,
        discussionMode: 'game_theoretic',
        participatingAgentIds: ['p1', 'c1'],
        rulingRecord: {
          decisionType: 'trade_off_matrix',
          arbiterId: 'human',
          arbiterName: 'Norris',
          summary: '采纳本地唯一流水号 + Redis 幂等前置拦截折中方案',
          tradeOffPoints: ['优先保障资金零资损，允许极端抖动下 0.1% 降级排队'],
          impactedFiles: ['src/services/orderService.ts', 'src/db/schema.sql'],
          decidedAt: '2026-10-12 15:00',
        },
      };
      const md = generateAdrMarkdown(mockTopic, []);
      assert.ok(md.includes('## 1. 业务背景与架构假定'));
      assert.ok(md.includes('## 2. 证伪失效清单与红队边界压测'));
      assert.ok(md.includes('## 3. 接地实证与验证结论'));
      assert.ok(md.includes('## 4. 架构权衡矩阵与终局决议'));
      assert.ok(md.includes('src/services/orderService.ts'), '必须包含受影响文件爆炸半径清单');
      return `ADR Markdown 4 大标准章节与爆炸半径文件清单生成完整 (${md.length} bytes)`;
    }
  );

  // A10: G-Frame 贝叶斯后验动态升级与跨模块文件越界门禁
  verify(
    'A10',
    '准确性趋真 (9项)',
    'G-Frame 贝叶斯 Log-Odds 后验升级与跨模块文件越界门禁',
    'G-Frame (Bayesian & Team Game)',
    () => {
      const state = initializeModularOrchestrationState({
        sharedContract: {
          summary: '公共契约',
          typeSignatures: 'export interface Shared { id: string; }',
          invariants: ['禁止越界修改'],
        },
        modules: [
          { moduleId: 'M1', title: '核心网关', responsibility: '路由', allowedFiles: ['src/gateway/router.ts'], dependsOn: [], complexityLevel: 'medium_standard' },
          { moduleId: 'M2', title: '视图面板', responsibility: 'UI 渲染', allowedFiles: ['src/components/Panel.tsx'], dependsOn: ['M1'], complexityLevel: 'low_deterministic' },
        ],
      });
      const escalated = updateModuleBeliefWithFeedback(state.modules[1], {
        refutedClaims: 1,
        contractViolations: 1,
        verifiedClaims: 0,
      });
      assert.equal(escalated.posteriorAction, 'ESCALATE_TO_RED_TEAM', '证伪或违规必须触发 ESCALATE_TO_RED_TEAM');
      assert.equal(escalated.updatedModule.belief.routingMode, 'deep_debate');

      const scopeViolation = validateModuleScopeContract(
        '我们将在 src/gateway/router.ts 中修改底层状态',
        state.modules[1],
        state.modules,
        state.sharedContract
      );
      assert.equal(scopeViolation.isScopeValid, false, '跨模块修改其他模块白名单文件必须被拦截');
      return `M2后验升级=${escalated.updatedModule.belief.priorRisk}->${escalated.updatedModule.belief.posteriorRisk}(${escalated.posteriorAction}), 越界拦截=${scopeViolation.violatedFiles.join(',')}`;
    }
  );

  console.log('\n================================================================================');
  console.log(`🎉 验证汇总：共执行 ${results.length} 项核心机制断言，通过 ${results.filter((r) => r.passed).length}/${results.length} (100% 符合预期)！`);
  console.log('================================================================================');
}

runAllVerifications().catch((err) => {
  console.error('验证未通过:', err);
  process.exit(1);
});
