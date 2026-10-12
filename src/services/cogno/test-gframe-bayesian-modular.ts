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
import { validateModuleScopeContract } from './stageContractGate';
import { buildScopedModulePrompt } from '../agentCollaboration';
import { extractModuleDecompositionFromAcpResponse } from '../acpClient';
import { ModuleDecompositionDraft } from '../../types';

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

  console.log('✅ [1/6] Bayesian Prior Estimation & Fast-Track/Deep-Debate Routing Passed');
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
console.log('✅ [2/6] Module DAG Initialization & Topological Root Activation Passed');

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
  console.log('✅ [3/6] Bayesian Posterior Escalation (Fast-Track -> Red Team on Contract Violation) Passed');
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
    { refutedClaims: 0, contractViolations: 0, verifiedClaims: 3, edgeCaseCount: 0 },
    'Mutex lock with bounded timeout 500ms'
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

  console.log('✅ [4/6] Full Module DAG Progression, Blast-Radius Freezing & Scoped Prompt Isolation Passed');
}

// 5. 测试模块越界守卫 (validateModuleScopeContract)
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

  console.log('✅ [5/6] Out-of-Scope File Touch Detection Gate Passed');
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

  console.log('✅ [6/6] MCP submit_module_decomposition Contract Extractor Passed\n');
}

console.log('🎉 [G-Frame Wave 1 & Wave 2 Complete] All assertions passed 100%!');

