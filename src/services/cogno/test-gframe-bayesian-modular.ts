import assert from 'node:assert/strict';
import {
  advanceModularOrchestration,
  buildDefaultDecompositionFromTopic,
  computeEntropyReductionRatio,
  estimateModulePriorRisk,
  getNextSchedulableModule,
  initializeModularOrchestrationState,
  sanitizeModuleDependencyDAG,
  stepModularStageTransition,
  updateModuleBeliefWithFeedback,
} from './bayesianModuleGovernor';
import { validateModuleScopeContract } from './stageContractGate';
import { buildScopedModulePrompt } from '../agentCollaboration';
import { extractModuleDecompositionFromAcpResponse } from '../acpClient';
import {
  ModularOrchestrationState,
  ModuleDecompositionDraft,
  TaskModuleSlice,
} from '../../types';

console.log('🧪 [G-Frame Test] Starting Bayesian Modular Governor & Context Isolation Verification...\n');

// 1. 测试先验风险估计与初始路由分流 (Prior Risk & Routing)
{
  const lowModule = estimateModulePriorRisk({
    complexityLevel: 'low_deterministic',
    allowedFilesCount: 1,
    responsibilityText: '定义纯 TypeScript 接口与枚举常量',
  });
  assert.equal(lowModule.priorRisk, 0.20, 'Low deterministic module prior risk should be 0.20');
  assert.equal(lowModule.routingMode, 'fast_track', 'Low risk module should route to fast_track');

  const highModule = estimateModulePriorRisk({
    complexityLevel: 'high_critical',
    allowedFilesCount: 4,
    responsibilityText: '实现高并发互斥锁与 SQLite 事务幂等状态机迁移',
  });
  assert.ok(highModule.priorRisk >= 0.85, `Expected high critical prior >= 0.85, got ${highModule.priorRisk}`);
  assert.equal(highModule.routingMode, 'deep_debate', 'High risk module should route to deep_debate');

  console.log('✅ [1/10] Bayesian Prior Estimation & Fast-Track/Deep-Debate Routing Passed');
}

// 2. 测试模块 DAG 初始化与拓扑序激活
const sampleDraft: ModuleDecompositionDraft = {
  sharedContract: {
    summary: '定义跨模块插件存储与状态同步契约',
    typeSignatures: 'export interface PluginState { id: string; active: boolean; }',
    invariants: ['所有模块严禁越界修改非白名单文件', '严禁修改 PluginState 字段名'],
  },
  modules: [
    {
      moduleId: 'mod-1-schema',
      title: '模块 1：Schema 类型契约',
      responsibility: '定义纯数据结构与常量',
      allowedFiles: ['src/types.ts'],
      dependsOn: [],
      complexityLevel: 'low_deterministic',
    },
    {
      moduleId: 'mod-2-engine',
      title: '模块 2：并发调度与事务核心',
      responsibility: '处理并发互斥锁与持久化事务回滚',
      allowedFiles: ['src/services/engine.ts', 'src/services/store.ts'],
      dependsOn: ['mod-1-schema'],
      complexityLevel: 'high_critical',
    },
    {
      moduleId: 'mod-3-ui',
      title: '模块 3：前端视图层绑定',
      responsibility: '渲染状态胶囊与抽屉面板',
      allowedFiles: ['src/components/Drawer.tsx'],
      dependsOn: ['mod-1-schema', 'mod-2-engine'],
      complexityLevel: 'low_deterministic',
    },
  ],
};

const state0 = initializeModularOrchestrationState(sampleDraft);
assert.equal(state0.enabled, true);
assert.equal(state0.modules.length, 3);
assert.equal(state0.activeModuleId, 'mod-1-schema', 'First root module should be active initially');
assert.equal(state0.modules[0].status, 'proposing');
assert.equal(state0.modules[0].belief.routingMode, 'fast_track');
assert.equal(state0.modules[1].belief.routingMode, 'deep_debate');
console.log('✅ [2/10] Module DAG Initialization & Topological Root Activation Passed');

// 3. 测试贝叶斯后验动态升级：当 fast_track 模块发生契约违规时，动态拉起红队 (ESCALATE_TO_RED_TEAM)
{
  const mod1 = state0.modules[0];
  const escalated = updateModuleBeliefWithFeedback(mod1, {
    contractViolations: 2,
    verifiedClaims: 0,
  });
  assert.equal(
    escalated.posteriorAction,
    'ESCALATE_TO_RED_TEAM',
    'Contract violation in fast_track module must trigger ESCALATE_TO_RED_TEAM'
  );
  assert.equal(escalated.updatedModule.belief.routingMode, 'deep_debate');
  assert.ok(
    escalated.updatedModule.belief.posteriorRisk >= 0.55,
    `Posterior risk should jump >= 0.55, got ${escalated.updatedModule.belief.posteriorRisk}`
  );
  console.log('✅ [3/10] Bayesian Posterior Escalation (Fast-Track -> Red Team on Contract Violation) Passed');
}

// 4. 测试完整拓扑序推进：M1 验证通过冻结 -> 自动激活 M2 -> M2 局部重修后冻结 -> 自动激活 M3 -> 全部冻结
{
  const step1 = advanceModularOrchestration(
    state0,
    'mod-1-schema',
    { verifiedClaims: 2, contractViolations: 0, refutedClaims: 0 },
    'export interface PluginState { id: string; active: boolean; }'
  );
  assert.equal(step1.action, 'FREEZE_MODULE');
  assert.equal(step1.allModulesFrozen, false);
  assert.equal(step1.nextState.modules[0].status, 'frozen');
  assert.equal(step1.nextState.activeModuleId, 'mod-2-engine', 'After M1 freezes, M2 must be scheduled');

  const step2a = advanceModularOrchestration(step1.nextState, 'mod-2-engine', {
    refutedClaims: 1,
    edgeCaseCount: 2,
  });
  assert.equal(step2a.action, 'SCOPED_DEFENSE_REFINE');
  assert.equal(step2a.nextState.modules[0].status, 'frozen', 'M1 must remain strictly frozen during M2 defense');
  assert.equal(step2a.nextState.modules[1].status, 'defending');
  assert.equal(step2a.nextState.activeModuleId, 'mod-2-engine');

  const step2b = advanceModularOrchestration(
    step2a.nextState,
    'mod-2-engine',
    { verifiedClaims: 3 },
    'Mutex lock with bounded timeout 500ms',
    { resolveRefutedClaims: true }
  );
  assert.equal(step2b.action, 'FREEZE_MODULE');
  assert.equal(step2b.nextState.modules[1].status, 'frozen');
  assert.equal(step2b.nextState.activeModuleId, 'mod-3-ui', 'After M1 & M2 freeze, M3 must be scheduled');

  // 验证模块 3 的隔离沙箱 Prompt 编译器：注入只读契约 + 上游已冻结模块摘要
  const mod3Prompt = buildScopedModulePrompt({
    activeModule: step2b.nextState.modules[2],
    sharedContract: step2b.nextState.sharedContract,
    allModules: step2b.nextState.modules,
  });
  assert.ok(mod3Prompt.includes('export interface PluginState'), 'Must inject SharedInterfaceContract');
  assert.ok(mod3Prompt.includes('Mutex lock with bounded timeout 500ms'), 'Must inject frozen M2 dependency snippet');
  assert.ok(mod3Prompt.includes('src/components/Drawer.tsx'), 'Must specify M3 allowedFiles');

  const step3 = advanceModularOrchestration(
    step2b.nextState,
    'mod-3-ui',
    { verifiedClaims: 1, contractViolations: 0, refutedClaims: 0 },
    'TopicThreadDrawer module capsule bar'
  );
  assert.equal(step3.action, 'FREEZE_MODULE');
  assert.equal(step3.allModulesFrozen, true, 'All 3 modules must be frozen');
  assert.equal(step3.nextState.activeModuleId, undefined);
  assert.equal(getNextSchedulableModule(step3.nextState), undefined);

  const ratio = computeEntropyReductionRatio(3600, 700, 200);
  assert.equal(ratio, 0.75, 'Entropy reduction ratio for (700+200)/3600 should be 0.75');

  const fallbackDraft = buildDefaultDecompositionFromTopic('并发数据库迁移与状态同步引擎');
  assert.equal(fallbackDraft.modules.length, 3);
  assert.equal(fallbackDraft.modules[1].complexityLevel, 'high_critical');

  console.log('✅ [4/10] Full Module DAG Progression, Blast-Radius Freezing & Scoped Prompt Isolation Passed');
}

// 5. 测试模块越界守卫与白名单重叠拦截 (validateModuleScopeContract & EDGE-04)
{
  const mod1 = state0.modules[0]; // allowed: src/types.ts
  const illegalTouchText = '我们在本模块中直接修改 src/services/engine.ts 的并发锁逻辑并重写 src/components/Drawer.tsx';
  const scopeRes = validateModuleScopeContract(illegalTouchText, mod1, state0.modules, state0.sharedContract);
  assert.equal(scopeRes.isScopeValid, false, 'Touching other module files must be flagged');
  assert.equal(scopeRes.contractViolations, 2);
  assert.ok(scopeRes.violatedFiles.includes('src/services/engine.ts'));

  const legalTouchText = '我们在本模块中仅修改 src/types.ts 定义 PluginState 接口契约';
  const cleanRes = validateModuleScopeContract(legalTouchText, mod1, state0.modules, state0.sharedContract);
  assert.equal(cleanRes.isScopeValid, true);
  assert.equal(cleanRes.contractViolations, 0);

  // EDGE-04: 当两个模块白名单存在重叠时，validateModuleScopeContract 严禁放行
  const overlapModA = { ...state0.modules[0], allowedFiles: ['src/types.ts', 'src/services/engine.ts'] };
  const overlapModB = { ...state0.modules[1], allowedFiles: ['src/services/engine.ts'] };
  const overlapRes = validateModuleScopeContract(
    '我们在模块 A 中修改 src/services/engine.ts 实现逻辑',
    overlapModA,
    [overlapModA, overlapModB]
  );
  assert.equal(overlapRes.isScopeValid, false, 'EDGE-04: Overlapping whitelist file touch must be rejected');
  assert.ok(overlapRes.violatedFiles.includes('src/services/engine.ts'));

  // 同时验证 initializeModularOrchestrationState 阶段自动剥离下游重复声明的 allowedFiles
  const overlapDraft: ModuleDecompositionDraft = {
    sharedContract: { summary: '契约', typeSignatures: '', invariants: [] },
    modules: [
      {
        moduleId: 'm1',
        title: 'M1',
        responsibility: '职责1',
        allowedFiles: ['src/shared.ts', 'src/m1.ts'],
        dependsOn: [],
        complexityLevel: 'low_deterministic',
      },
      {
        moduleId: 'm2',
        title: 'M2',
        responsibility: '职责2',
        allowedFiles: ['src/shared.ts', 'src/m2.ts'],
        dependsOn: ['m1'],
        complexityLevel: 'low_deterministic',
      },
    ],
  };
  const dedupedState = initializeModularOrchestrationState(overlapDraft);
  assert.deepEqual(dedupedState.modules[0].allowedFiles, ['src/shared.ts', 'src/m1.ts']);
  assert.deepEqual(
    dedupedState.modules[1].allowedFiles,
    ['src/m2.ts'],
    'EDGE-04: Downstream module must not retain duplicate allowedFiles already owned by upstream module'
  );

  console.log('✅ [5/10] Out-of-Scope File Touch & Whitelist Overlap Gate (EDGE-04) Passed');
}

// 6. 测试 MCP submit_module_decomposition 工具载荷提取器
{
  const extracted = extractModuleDecompositionFromAcpResponse(
    {
      textResponse: '已完成模块拆解',
      mcpToolCalls: [
        {
          server_name: 'shinobi-dev-mcp',
          tool_name: 'submit_module_decomposition',
          status: 'completed',
          arguments: {
            shared_contract: {
              summary: '跨模块只读契约',
              type_signatures: 'export interface TaskContract { id: string; }',
              invariants: ['禁止跨模块越界修改'],
            },
            modules: [
              {
                module_id: 'mod-a',
                title: '模块 A',
                responsibility: '定义类型',
                allowed_files: ['src/types.ts'],
                depends_on: [],
                complexity_level: 'low_deterministic',
              },
              {
                module_id: 'mod-b',
                title: '模块 B',
                responsibility: '核心引擎',
                allowed_files: ['src/engine.ts'],
                depends_on: ['mod-a'],
                complexity_level: 'high_critical',
              },
            ],
          },
        },
      ],
    },
    'Architect_Proposer'
  );
  assert.ok(extracted, 'Must extract ModuleDecompositionDraft from MCP tool call');
  assert.equal(extracted?.modules.length, 2);
  assert.equal(extracted?.modules[0].moduleId, 'mod-a');
  assert.equal(extracted?.modules[1].complexityLevel, 'high_critical');

  console.log('✅ [6/10] MCP submit_module_decomposition Contract Extractor Passed');
}

// 7. 测试非研发类通用业务议题的动态模块拆解与无代码路径硬编码保障 (Domain-Agnostic Business Discussion)
{
  const bizDraft = buildDefaultDecompositionFromTopic(
    '2026 Q4 SaaS 会员分级定价与存量老客迁移商业化方案',
    '围绕客单价提升与续费留存率平衡展开业务推演',
    `## 一、阶梯定价与毛利测算模型\n明确基础版与企业版权益差异。\n## 二、存量老客平滑迁移与赔付合规风控\n防范老客流失与违约争议。\n## 三、渠道宣发与转化漏斗追踪\n建立首月转化率指标。`
  );
  assert.equal(bizDraft.modules.length, 3);
  assert.equal(bizDraft.sharedContract.typeSignatures, '', 'Pure business topic must not inject fake TypeScript interfaces');
  assert.deepEqual(bizDraft.modules[0].allowedFiles, [], 'Pure business topic must not hardcode src/types.ts');
  assert.ok(bizDraft.modules[0].title.includes('阶梯定价与毛利测算模型'));
  assert.equal(bizDraft.modules[1].complexityLevel, 'high_critical', 'Compliance/compensation module must be recognized as high_critical');
  console.log('✅ [7/10] Domain-Agnostic Business Discussion Decomposition (Zero R&D Hardcoding) Passed');
}

// 8. 测试 EDGE-02 (模块数下限 >= 2 补齐) 与 EDGE-05 (feedbackDelta 增量累加而非绝对值覆盖)
{
  const singleModDraft: ModuleDecompositionDraft = {
    sharedContract: { summary: '单模块输入测试', typeSignatures: '', invariants: [] },
    modules: [
      {
        moduleId: 'only-one',
        title: '唯一模块',
        responsibility: '主干逻辑',
        allowedFiles: [],
        dependsOn: [],
        complexityLevel: 'medium_standard',
      },
    ],
  };
  const paddedState = initializeModularOrchestrationState(singleModDraft);
  assert.equal(paddedState.modules.length, 2, 'EDGE-02: Single-module draft must be padded to minimum 2 modules');
  assert.equal(paddedState.activeModuleId, 'only-one');

  // EDGE-05: 连续两次增量传入 verifiedClaims: 1 或 refutedClaims: 1，应累加为 2，且传入 refutedClaims: 0 不得覆盖历史证伪数
  const initialMod = paddedState.modules[0];
  const pass1 = updateModuleBeliefWithFeedback(initialMod, { refutedClaims: 1, verifiedClaims: 1 });
  assert.equal(pass1.updatedModule.belief.feedbackVector.refutedClaims, 1);
  assert.equal(pass1.updatedModule.belief.feedbackVector.verifiedClaims, 1);

  const pass2 = updateModuleBeliefWithFeedback(pass1.updatedModule, { refutedClaims: 0, verifiedClaims: 1 });
  assert.equal(
    pass2.updatedModule.belief.feedbackVector.refutedClaims,
    1,
    'EDGE-05: Passing delta refutedClaims: 0 must not overwrite historical refutedClaims=1'
  );
  assert.equal(
    pass2.updatedModule.belief.feedbackVector.verifiedClaims,
    2,
    'EDGE-05: Passing delta verifiedClaims: 1 twice must accumulate to 2'
  );
  assert.equal(
    pass2.posteriorAction,
    'SCOPED_DEFENSE_REFINE',
    'EDGE-05/EDGE-06: Historical refutedClaims=1 must keep module in SCOPED_DEFENSE_REFINE until explicitly resolved'
  );
  console.log('✅ [8/10] Module Lower-Bound Guard (EDGE-02) & Incremental Feedback Delta (EDGE-05) Passed');
}

// 9. 测试 EDGE-03：环形依赖 (M1 ⇄ M2 及 M1->M2->M3->M1) 自动破环守卫，杜绝 activeModuleId=undefined 静默死锁
{
  const cyclicDraft: ModuleDecompositionDraft = {
    sharedContract: { summary: '环形依赖测试', typeSignatures: '', invariants: [] },
    modules: [
      {
        moduleId: 'm1',
        title: '模块 1',
        responsibility: '依赖 M2 形成互锁',
        allowedFiles: [],
        dependsOn: ['m2'],
        complexityLevel: 'low_deterministic',
      },
      {
        moduleId: 'm2',
        title: '模块 2',
        responsibility: '依赖 M1 形成互锁',
        allowedFiles: [],
        dependsOn: ['m1'],
        complexityLevel: 'medium_standard',
      },
    ],
  };
  const acyclicState = initializeModularOrchestrationState(cyclicDraft);
  assert.equal(
    acyclicState.activeModuleId,
    'm1',
    'EDGE-03: M1⇄M2 cycle must be broken so m1 becomes active topological root'
  );
  assert.equal(acyclicState.modules[0].status, 'proposing');
  assert.deepEqual(acyclicState.modules[0].dependsOnModuleIds, []);
  assert.deepEqual(acyclicState.modules[1].dependsOnModuleIds, ['m1']);

  const sanitizedTriCycle = sanitizeModuleDependencyDAG([
    { ...acyclicState.modules[0], moduleId: 'a', dependsOnModuleIds: ['c'] },
    { ...acyclicState.modules[1], moduleId: 'b', dependsOnModuleIds: ['a'] },
    { ...acyclicState.modules[1], moduleId: 'c', dependsOnModuleIds: ['b'] },
  ]);
  assert.ok(
    sanitizedTriCycle.some((m) => m.dependsOnModuleIds.length === 0),
    'EDGE-03: 3-node cycle A->C->B->A must yield at least one root module with 0 dependencies'
  );
  console.log('✅ [9/10] Cyclic Dependency Detection & Deadlock-Free Root Activation (EDGE-03) Passed');
}

// 10. 测试 E2E-03 & EDGE-06：三模块完整阶段闭环 (challenge -> verification -> defense) 与 SCOPED_DEFENSE_REFINE 真实可达性
{
  let simState = initializeModularOrchestrationState(sampleDraft);
  assert.equal(simState.activeModuleId, 'mod-1-schema');

  // --- M1: challenge -> verification -> defense -> FREEZE (1/3) ---
  let step = stepModularStageTransition({
    state: simState,
    currentStage: 'challenge',
    feedbackDelta: { edgeCaseCount: 1 },
  });
  assert.equal(step.nextGameStage, 'verification');
  assert.equal(step.activeModuleId, 'mod-1-schema');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'verification',
    feedbackDelta: { verifiedClaims: 2, refutedClaims: 0 },
  });
  assert.equal(step.nextGameStage, 'defense');
  assert.equal(
    step.activeModuleId,
    'mod-1-schema',
    'E2E-03: verification(M1) must NOT prematurely freeze M1 or switch activeModuleId to M2 before defense(M1)'
  );
  assert.notEqual(step.nextState.modules[0].status, 'frozen');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 1, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M1 Schema Frozen Patch',
  });
  assert.equal(step.posteriorAction, 'FREEZE_MODULE');
  assert.equal(step.frozenModuleId, 'mod-1-schema');
  assert.equal(step.allModulesFrozen, false);
  assert.equal(step.activeModuleId, 'mod-2-engine', 'After defense(M1) freezes M1, M2 becomes active');
  assert.equal(step.nextGameStage, 'challenge', 'E2E-03: Must loop back to challenge for M2 instead of jumping to arbitration');

  // --- M2: challenge -> verification (1 refuted claim!) -> defense (triggers Rule C: SCOPED_DEFENSE_REFINE!) ---
  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'challenge',
    feedbackDelta: { edgeCaseCount: 1 },
  });
  assert.equal(step.nextGameStage, 'verification');
  assert.equal(step.activeModuleId, 'mod-2-engine');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'verification',
    feedbackDelta: { verifiedClaims: 1, refutedClaims: 1 },
  });
  assert.equal(step.nextGameStage, 'defense');
  assert.equal(step.activeModuleId, 'mod-2-engine');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 0, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M2 First Defense Attempt',
    currentModuleRefineCount: 0,
  });
  assert.equal(
    step.posteriorAction,
    'SCOPED_DEFENSE_REFINE',
    'EDGE-06: Rule C (SCOPED_DEFENSE_REFINE) must be reachable at runtime when verification recorded refutedClaims > 0'
  );
  assert.equal(step.triggeredScopedRefine, true);
  assert.equal(step.activeModuleId, 'mod-2-engine');
  assert.equal(step.nextGameStage, 'challenge', 'SCOPED_DEFENSE_REFINE must loop back to challenge on M2');

  // --- M2 Refine Pass: challenge -> verification (resolved!) -> defense -> FREEZE (2/3) ---
  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'challenge',
    feedbackDelta: { edgeCaseCount: 0 },
    currentModuleRefineCount: 1,
  });
  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'verification',
    feedbackDelta: { verifiedClaims: 2, refutedClaims: 0 },
    currentModuleRefineCount: 1,
  });
  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 1, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M2 Refined & Verified Patch',
    currentModuleRefineCount: 1,
  });
  assert.equal(step.posteriorAction, 'FREEZE_MODULE');
  assert.equal(step.frozenModuleId, 'mod-2-engine');
  assert.equal(step.allModulesFrozen, false);
  assert.equal(step.activeModuleId, 'mod-3-ui', 'After M2 freezes, M3 becomes active');
  assert.equal(step.nextGameStage, 'challenge', 'E2E-03: Must loop back to challenge for M3');

  // --- M3: challenge -> verification -> defense -> FREEZE (3/3) -> arbitration ---
  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'challenge',
    feedbackDelta: { edgeCaseCount: 0 },
  });
  assert.equal(step.nextGameStage, 'verification');
  assert.equal(step.activeModuleId, 'mod-3-ui');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'verification',
    feedbackDelta: { verifiedClaims: 2, refutedClaims: 0 },
  });
  assert.equal(step.nextGameStage, 'defense');
  assert.equal(step.activeModuleId, 'mod-3-ui');

  step = stepModularStageTransition({
    state: step.nextState,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 1, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M3 UI Frozen Patch',
  });
  assert.equal(step.posteriorAction, 'FREEZE_MODULE');
  assert.equal(step.frozenModuleId, 'mod-3-ui');
  assert.equal(step.allModulesFrozen, true, 'E2E-03: All 3/3 modules must reach frozen state');
  assert.equal(step.activeModuleId, undefined);
  assert.equal(step.nextGameStage, 'arbitration', 'E2E-03: Only transition to arbitration after 3/3 modules are frozen');
  assert.deepEqual(
    step.nextState.modules.map((m) => m.status),
    ['frozen', 'frozen', 'frozen']
  );

  console.log('✅ [10/10] E2E-03 3/3 Multi-Module Loop Closure & EDGE-06 Runtime SCOPED_DEFENSE_REFINE Reachability Passed\n');
}

// 11. 测试 N2：白名单去重基于 DAG 拓扑偏序而非原始声明顺序 (Topological Whitelist Dedup)
{
  const invertedOrderDraft: ModuleDecompositionDraft = {
    sharedContract: {
      summary: 'DAG 拓扑白名单去重测试',
      typeSignatures: 'export interface SharedState { version: number; }',
      invariants: ['上游基底模块优先持有共享契约定义文件'],
    },
    modules: [
      {
        moduleId: 'm-downstream',
        title: '下游依赖模块 (声明在索引 0)',
        responsibility: '消费共享状态',
        allowedFiles: ['src/shared.ts', 'src/consumer.ts'],
        dependsOn: ['m-upstream'],
        complexityLevel: 'low_deterministic',
      },
      {
        moduleId: 'm-upstream',
        title: '上游基底模块 (声明在索引 1)',
        responsibility: '定义共享状态',
        allowedFiles: ['src/shared.ts', 'src/producer.ts'],
        dependsOn: [],
        complexityLevel: 'medium_standard',
      },
    ],
    submittedBy: 'agent-proposer',
    submittedAt: new Date().toISOString(),
  };

  const topoDedupState = initializeModularOrchestrationState(invertedOrderDraft);
  const upstreamMod = topoDedupState.modules.find((m) => m.moduleId === 'm-upstream');
  const downstreamMod = topoDedupState.modules.find((m) => m.moduleId === 'm-downstream');

  assert.ok(upstreamMod, 'Upstream module must exist in state');
  assert.ok(downstreamMod, 'Downstream module must exist in state');
  assert.ok(
    upstreamMod.allowedFiles.includes('src/shared.ts'),
    'N2: Upstream dependency (m-upstream) MUST retain shared file [src/shared.ts] even when declared at index 1'
  );
  assert.ok(
    !downstreamMod.allowedFiles.includes('src/shared.ts'),
    'N2: Downstream dependent (m-downstream) MUST NOT preempt shared file [src/shared.ts] over its upstream dependency'
  );
  assert.deepEqual(downstreamMod.allowedFiles, ['src/consumer.ts']);
  assert.equal(topoDedupState.activeModuleId, 'm-upstream', 'Topological root (m-upstream) must be initial active module');
  console.log('✅ [11/13] Topological Whitelist Deduplication Priority (N2) Passed');
}

// 12. 测试 N3：目录前缀重叠误报防护与具体文件归属权优先原则 (Directory Prefix Scope Gate)
{
  const m1Dir: TaskModuleSlice = {
    moduleId: 'm-components-dir',
    title: '通用组件目录模块',
    responsibility: '负责 src/components/ 通用基础组件',
    allowedFiles: ['src/components/'],
    dependsOnModuleIds: [],
    status: 'proposing',
    scopedMessageIds: [],
    complexityLevel: 'medium_standard',
    belief: {
      priorRisk: 0.25,
      posteriorRisk: 0.25,
      routingMode: 'fast_track',
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 0,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  const m2File: TaskModuleSlice = {
    moduleId: 'm-panel-file',
    title: '专用面板组件模块',
    responsibility: '负责 src/components/Panel.tsx',
    allowedFiles: ['src/components/Panel.tsx'],
    dependsOnModuleIds: ['m-components-dir'],
    status: 'pending',
    scopedMessageIds: [],
    complexityLevel: 'low_deterministic',
    belief: {
      priorRisk: 0.25,
      posteriorRisk: 0.25,
      routingMode: 'fast_track',
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 0,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  // 12.1 零修改文本绝不误报契约违规
  const zeroModResult = validateModuleScopeContract(
    '本阶段仅对系统架构与接口声明进行分析对齐，不涉及任何文件修改与代码重构。',
    m2File,
    [m1Dir, m2File]
  );
  assert.equal(
    zeroModResult.contractViolations,
    0,
    'N3: Zero-modification text must NEVER be flagged as a scope violation even with directory prefix overlap'
  );
  assert.equal(zeroModResult.isScopeValid, true);

  // 12.2 M2 修改自身拥有具体文件 Panel.tsx，不应触发 M1 的目录前缀 src/components/ 误报
  const m2SelfModResult = validateModuleScopeContract(
    '修改 src/components/Panel.tsx 实现面板独立渲染逻辑',
    m2File,
    [m1Dir, m2File]
  );
  assert.equal(
    m2SelfModResult.contractViolations,
    0,
    'N3: Modifying explicitly owned file [src/components/Panel.tsx] must NOT trigger directory prefix violation from other modules'
  );
  assert.equal(m2SelfModResult.isScopeValid, true);

  // 12.3 M2 修改未授权文件 Header.tsx，应准确判定为侵犯 M1 专属目录
  const m2UnauthorizedModResult = validateModuleScopeContract(
    '修改 src/components/Header.tsx 调整头部导航',
    m2File,
    [m1Dir, m2File]
  );
  assert.equal(
    m2UnauthorizedModResult.contractViolations,
    1,
    'N3: Modifying file under other module directory not in active allowed list must be caught as violation'
  );
  assert.equal(m2UnauthorizedModResult.violatedFiles[0], 'src/components/');

  // 12.4 M1 修改具体归属于 M2 的 Panel.tsx，应准确判定为越界修改其他模块具体文件
  const m1TrespassModResult = validateModuleScopeContract(
    '修改 src/components/Panel.tsx 强行侵入面板逻辑',
    m1Dir,
    [m1Dir, m2File]
  );
  assert.equal(
    m1TrespassModResult.contractViolations,
    1,
    'N3: Modifying specific file owned by another module must be caught as violation'
  );
  assert.equal(m1TrespassModResult.violatedFiles[0], 'src/components/Panel.tsx');

  // 12.5 EDGE-04 直接白名单重叠且修改发生时必须拦截
  const mDirect1: TaskModuleSlice = {
    ...m1Dir,
    allowedFiles: ['src/shared.ts'],
  };
  const mDirect2: TaskModuleSlice = {
    ...m2File,
    allowedFiles: ['src/shared.ts'],
  };
  const directOverlapModResult = validateModuleScopeContract(
    '编辑 src/shared.ts 注入冲突定义',
    mDirect1,
    [mDirect1, mDirect2]
  );
  assert.equal(
    directOverlapModResult.contractViolations,
    1,
    'EDGE-04: Modifying direct overlap file must be strictly intercepted'
  );
  console.log('✅ [12/13] Directory Prefix Scope Gate & Specific File Ownership (N3) Passed');
}

// 13. 测试 N1：同步阶段流转决断保证 (Deterministic Synchronous Stage Handover Flow)
{
  const testModular = initializeModularOrchestrationState(sampleDraft);
  // 模拟 defense 阶段未冻结全部模块时，同步决断流向必定为 'challenge'，全部冻结时必定为 'arbitration'
  const stepNotAllFrozen = stepModularStageTransition({
    state: testModular,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 2, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M1 Valid Patch',
  });
  const resolvedNextStageNotAll = !stepNotAllFrozen.allModulesFrozen ? 'challenge' : 'arbitration';
  assert.equal(
    resolvedNextStageNotAll,
    'challenge',
    'N1: When intermediate module freezes but subsequent modules exist, synchronous resolvedNextStage MUST be "challenge"'
  );

  // 模拟最后一模块冻结
  const lastModState: ModularOrchestrationState = {
    ...stepNotAllFrozen.nextState,
    modules: stepNotAllFrozen.nextState.modules.map((m, idx) => ({
      ...m,
      status: idx === 2 ? 'proposing' : 'frozen',
    })),
    activeModuleId: 'mod-3-ui',
  };
  const stepFinal = stepModularStageTransition({
    state: lastModState,
    currentStage: 'defense',
    feedbackDelta: { verifiedClaims: 2, refutedClaims: 0, contractViolations: 0 },
    proposalOrDefenseSnippet: 'M3 Final Patch',
  });
  const resolvedNextStageFinal = !stepFinal.allModulesFrozen ? 'challenge' : 'arbitration';
  assert.equal(
    resolvedNextStageFinal,
    'arbitration',
    'N1: When all modules are frozen, synchronous resolvedNextStage MUST be "arbitration"'
  );
  console.log('✅ [13/13] Deterministic Synchronous Stage Handover Flow (N1) Passed\n');
}

console.log('🎉 [G-Frame Complete] All 13 test suites passed 100%!');


