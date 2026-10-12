import assert from 'node:assert/strict';
import {
  advanceModularOrchestration,
  buildDefaultDecompositionFromTopic,
  computeEntropyReductionRatio,
  estimateModulePriorRisk,
  getNextSchedulableModule,
  initializeModularOrchestrationState,
  updateModuleBeliefWithFeedback,
} from './bayesianModuleGovernor';
import { ModuleDecompositionDraft } from '../../types';

console.log('🧪 [Wave 1 Test] Starting G-Frame Bayesian Modular Governor Verification...\n');

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

  console.log('✅ [1/4] Bayesian Prior Estimation & Fast-Track/Deep-Debate Routing Passed');
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
console.log('✅ [2/4] Module DAG Initialization & Topological Root Activation Passed');

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
  console.log('✅ [3/4] Bayesian Posterior Escalation (Fast-Track -> Red Team on Contract Violation) Passed');
}

// 4. 测试完整拓扑序推进：M1 验证通过冻结 -> 自动激活 M2 -> M2 局部重修后冻结 -> 自动激活 M3 -> 全部冻结
{
  // Step A: M1 通过静态契约校验，直接冻结并推进到 M2
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

  // Step B: M2 在首次验证时发现 1 项被证伪断言 -> 触发模块沙箱内局部重修 (不污染已冻结的 M1)
  const step2a = advanceModularOrchestration(step1.nextState, 'mod-2-engine', {
    refutedClaims: 1,
    edgeCaseCount: 2,
  });
  assert.equal(step2a.action, 'SCOPED_DEFENSE_REFINE');
  assert.equal(step2a.nextState.modules[0].status, 'frozen', 'M1 must remain strictly frozen during M2 defense');
  assert.equal(step2a.nextState.modules[1].status, 'defending');
  assert.equal(step2a.nextState.activeModuleId, 'mod-2-engine');

  // Step C: M2 局部补丁通过物理验证 -> 冻结 M2 并推进到 M3
  const step2b = advanceModularOrchestration(
    step2a.nextState,
    'mod-2-engine',
    { refutedClaims: 0, contractViolations: 0, verifiedClaims: 3, edgeCaseCount: 0 },
    'Mutex lock with bounded timeout 500ms'
  );
  assert.equal(step2b.action, 'FREEZE_MODULE');
  assert.equal(step2b.nextState.modules[1].status, 'frozen');
  assert.equal(step2b.nextState.activeModuleId, 'mod-3-ui', 'After M1 & M2 freeze, M3 must be scheduled');

  // Step D: M3 快速验证通过 -> 全部模块冻结完毕
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

  // 验证信息熵压缩比计算与默认议题拆解器
  const ratio = computeEntropyReductionRatio(3600, 700, 200);
  assert.equal(ratio, 0.75, 'Entropy reduction ratio for (700+200)/3600 should be 0.75');

  const fallbackDraft = buildDefaultDecompositionFromTopic('并发数据库迁移与状态同步引擎');
  assert.equal(fallbackDraft.modules.length, 3);
  assert.equal(fallbackDraft.modules[1].complexityLevel, 'high_critical');

  console.log('✅ [4/4] Full Module DAG Progression, Blast-Radius Freezing & Entropy Ratio Passed\n');
}

console.log('🎉 [Wave 1 Complete] All G-Frame Bayesian Modular Governor assertions passed!');
