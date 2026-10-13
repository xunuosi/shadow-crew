/**
 * G-Frame 模块化分治 × 贝叶斯博弈：边界与集成风险探测套件
 * 对应文档：docs/TEST_PLAN_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md
 *
 * 覆盖尚未进入基线套件（npm run test:cogno）的用例：
 * - L1 补强：GF-03 分流阈值边界 / GF-05 模块数上限 / GF-09 DSS 惩罚单调性 / GF-16 沙箱 Prompt 负向隔离
 * - 边界异常：EDGE-01 模块数超限 / EDGE-02 模块数不足 / EDGE-03 依赖成环 /
 *            EDGE-04 白名单重叠 / EDGE-05 反馈语义 / EDGE-06 答辩阶段实证计数
 * - 集成仿真：E2E-03 App 层 FSM 接力下的多模块循环闭环
 * - 新增回归：N1 App 层状态更新器副作用 / N2 白名单去重的声明顺序依赖 /
 *            N3 目录前缀重叠误报 / N4 局部重修有界收敛
 *
 * 输出三态：
 *   ✅ PASS   —— 与 SPEC 预期一致
 *   ⚠️ WARN   —— 语义待确认（可能是设计取舍，不阻断基线）
 *   🔴 DEFECT —— 与 docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md 描述存在偏差
 *
 * 本套件不抛异常退出，用于持续观测；请结合 findings 汇总决定是否修复。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  advanceModularOrchestration,
  estimateModulePriorRisk,
  getNextSchedulableModule,
  initializeModularOrchestrationState,
  sanitizeModuleDependencyDAG,
  stepModularStageTransition,
  updateModuleBeliefWithFeedback,
} from './bayesianModuleGovernor';
import { validateModuleScopeContract } from './stageContractGate';
import { buildScopedModulePrompt } from '../agentCollaboration';
import { ModuleComplexityLevel, ModuleDecompositionDraft, TaskModuleSlice } from '../../types';

const findings: Array<{ id: string; level: 'WARN' | 'DEFECT'; message: string }> = [];

function pass(id: string, message: string) {
  console.log(`  ✅ [${id}] ${message}`);
}

function warn(id: string, message: string) {
  findings.push({ id, level: 'WARN', message });
  console.log(`  ⚠️ [${id}] ${message}`);
}

function defect(id: string, message: string) {
  findings.push({ id, level: 'DEFECT', message });
  console.log(`  🔴 [${id}] ${message}`);
}

function makeDraft(
  specs: Array<{
    id: string;
    title: string;
    responsibility: string;
    files: string[];
    dependsOn: string[];
    level: ModuleComplexityLevel;
  }>
): ModuleDecompositionDraft {
  return {
    sharedContract: {
      summary: '边界探测专用公共契约',
      typeSignatures: 'export interface ProbeContract { id: string; }',
      invariants: ['严禁跨模块越界修改'],
    },
    modules: specs.map((s) => ({
      moduleId: s.id,
      title: s.title,
      responsibility: s.responsibility,
      allowedFiles: s.files,
      dependsOn: s.dependsOn,
      complexityLevel: s.level,
    })),
  };
}

console.log('================================================================================');
console.log('🔬 G-Frame 边界与集成风险探测套件 (Edge Cases & Integration Probe)');
console.log('📄 对照基准: docs/TEST_PLAN_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md');
console.log('================================================================================\n');

// ---------------------------------------------------------------- GF-03
console.log('--- GF-03 先验分流阈值边界 (fast_track < 0.45 <= deep_debate) ---');
{
  const belowThreshold = estimateModulePriorRisk({
    complexityLevel: 'low_deterministic', // 0.20
    allowedFilesCount: 3, // +0.05
    responsibilityText: '并发安全鉴权边界校验', // +0.15 -> 0.40
  });
  const atThreshold = estimateModulePriorRisk({
    complexityLevel: 'low_deterministic', // 0.20
    allowedFilesCount: 4, // +0.10
    responsibilityText: '并发安全鉴权边界校验', // +0.15 -> 0.45
  });
  assert.equal(belowThreshold.priorRisk, 0.4);
  assert.equal(belowThreshold.routingMode, 'fast_track');
  assert.equal(atThreshold.priorRisk, 0.45);
  assert.equal(atThreshold.routingMode, 'deep_debate');
  pass('GF-03', `P_prior=0.40 -> ${belowThreshold.routingMode} ; P_prior=0.45 -> ${atThreshold.routingMode} (严格小于为界，符合 SPEC)`);
}

// ---------------------------------------------------------------- GF-05 / EDGE-01
console.log('\n--- GF-05 / EDGE-01 模块数量硬上限 (2 <= K <= 4) ---');
{
  const five = makeDraft(
    ['M1', 'M2', 'M3', 'M4', 'M5'].map((id, idx) => ({
      id,
      title: `模块 ${idx + 1}`,
      responsibility: '职责边界探测',
      files: [`src/mod${idx + 1}.ts`],
      dependsOn: idx === 0 ? [] : [`M${idx}`],
      level: 'low_deterministic' as ModuleComplexityLevel,
    }))
  );
  const state = initializeModularOrchestrationState(five);
  assert.equal(state.modules.length, 4);
  pass('GF-05/EDGE-01', `提交 5 个模块被截断为 ${state.modules.length} 个，无异常抛出`);
}

// ---------------------------------------------------------------- GF-09
console.log('\n--- GF-09 DSS 谄媚分对后验风险的惩罚单调性 ---');
{
  const base = initializeModularOrchestrationState(
    makeDraft([
      {
        id: 'M1',
        title: '谄媚探测模块',
        responsibility: '通用业务推演',
        files: ['src/a.ts', 'src/b.ts'],
        dependsOn: [],
        level: 'medium_standard',
      },
    ])
  ).modules[0];

  const clean = updateModuleBeliefWithFeedback(base, { verifiedClaims: 1, dssScore: 0.0 });
  const flattering = updateModuleBeliefWithFeedback(base, { verifiedClaims: 1, dssScore: 0.95 });
  assert.ok(
    flattering.updatedModule.belief.posteriorRisk > clean.updatedModule.belief.posteriorRisk,
    `DSS 惩罚应推高后验风险 (clean=${clean.updatedModule.belief.posteriorRisk}, flattering=${flattering.updatedModule.belief.posteriorRisk})`
  );
  pass(
    'GF-09',
    `penalty(DSS=0.95)=max(0,0.95-0.45)*0.40=0.20 生效: P_posterior ${clean.updatedModule.belief.posteriorRisk} -> ${flattering.updatedModule.belief.posteriorRisk}`
  );
}

// ---------------------------------------------------------------- GF-16
console.log('\n--- GF-16 沙箱 Prompt 负向隔离 (不泄露非依赖模块实现细节) ---');
{
  const state = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1 存储层', responsibility: '存储', files: ['src/store.ts'], dependsOn: [], level: 'low_deterministic' },
      { id: 'M2', title: 'M2 引擎层', responsibility: '引擎', files: ['src/engine.ts'], dependsOn: ['M1'], level: 'high_critical' },
      { id: 'M3', title: 'M3 视图层', responsibility: 'UI', files: ['src/view.tsx'], dependsOn: ['M2'], level: 'low_deterministic' },
    ])
  );
  const modules: TaskModuleSlice[] = state.modules.map((m) =>
    m.moduleId === 'M1'
      ? { ...m, status: 'frozen', frozenProposalSnippet: 'M1-SECRET-IMPL-存储层内部实现细节' }
      : m.moduleId === 'M2'
      ? { ...m, status: 'frozen', frozenProposalSnippet: 'M2 引擎层公开接口摘要' }
      : m
  );
  const prompt = buildScopedModulePrompt({
    activeModule: modules[2],
    sharedContract: state.sharedContract,
    allModules: modules,
  });
  assert.ok(prompt.includes('M2 引擎层公开接口摘要'), '必须注入直接上游已冻结模块摘要');
  assert.ok(!prompt.includes('M1-SECRET-IMPL'), '非依赖模块 (M1) 的实现细节不得注入');
  pass('GF-16', '仅注入直接上游 M2 摘要，非依赖模块 M1 内部实现细节零泄露');
}

// ---------------------------------------------------------------- EDGE-02
console.log('\n--- EDGE-02 模块数量不足下限 (K < 2) ---');
{
  const single = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: '唯一模块', responsibility: '全部职责', files: ['src/all.ts'], dependsOn: [], level: 'low_deterministic' },
    ])
  );
  assert.equal(single.modules.length, 2, '单模块输入应被自动补足为 2 个模块');
  assert.deepEqual(single.modules[1].dependsOnModuleIds, ['M1'], '补齐的守卫模块应依赖原模块');
  assert.ok(single.activeModuleId, '补齐后必须存在可调度的拓扑根模块');
  pass('EDGE-02', `单模块输入被自动补足为 ${single.modules.length} 个（新增「${single.modules[1].title}」依赖 M1），activeModuleId=${single.activeModuleId}`);
}

// ---------------------------------------------------------------- EDGE-03
console.log('\n--- EDGE-03 依赖成环 (破环守卫) ---');
{
  const cyclic = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: '环 M1', responsibility: '环检测', files: ['src/1.ts'], dependsOn: ['M2'], level: 'low_deterministic' },
      { id: 'M2', title: '环 M2', responsibility: '环检测', files: ['src/2.ts'], dependsOn: ['M1'], level: 'low_deterministic' },
    ])
  );
  const rootModules = cyclic.modules.filter((m) => m.dependsOnModuleIds.length === 0);
  assert.ok(rootModules.length >= 1, '破环后必须存在至少一个拓扑根节点');
  assert.ok(getNextSchedulableModule(cyclic), '破环后必须存在可调度模块');
  assert.ok(cyclic.activeModuleId, '破环后 activeModuleId 不得为空');

  // 3 节点环 A->B->C->A 也应被消毒为 DAG
  const threeCycle = sanitizeModuleDependencyDAG(
    initializeModularOrchestrationState(
      makeDraft([
        { id: 'A', title: 'A', responsibility: '环', files: [], dependsOn: ['B'], level: 'low_deterministic' },
        { id: 'B', title: 'B', responsibility: '环', files: [], dependsOn: ['C'], level: 'low_deterministic' },
        { id: 'C', title: 'C', responsibility: '环', files: [], dependsOn: ['A'], level: 'low_deterministic' },
      ])
    ).modules
  );
  const edges = threeCycle.flatMap((m) => m.dependsOnModuleIds);
  assert.ok(threeCycle.some((m) => m.dependsOnModuleIds.length === 0), '3 节点环必须被破为含根节点的 DAG');
  pass('EDGE-03', `2 节点环破环后根节点=${rootModules.map((m) => m.moduleId).join(',')}, activeModuleId=${cyclic.activeModuleId}；3 节点环剩余依赖边=${edges.length} 且存在根节点`);
}

// ---------------------------------------------------------------- EDGE-04
console.log('\n--- EDGE-04 跨模块 allowedFiles 重叠 ---');
{
  const overlapState = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1', responsibility: '共享文件写方 A', files: ['src/shared.ts', 'src/a.ts'], dependsOn: [], level: 'low_deterministic' },
      { id: 'M2', title: 'M2', responsibility: '共享文件写方 B', files: ['src/shared.ts', 'src/b.ts'], dependsOn: [], level: 'low_deterministic' },
    ])
  );
  const m1Files = overlapState.modules[0].allowedFiles;
  const m2Files = overlapState.modules[1].allowedFiles;
  const intersection = m1Files.filter((f) => m2Files.includes(f));
  assert.equal(intersection.length, 0, `初始化必须保障 F_i ∩ F_j = ∅，实际交集=${intersection.join(',')}`);

  // 绕过初始化直接构造重叠沙箱时，越界门禁必须拦截（A10 场景）
  const res = validateModuleScopeContract(
    '本模块直接修改 src/shared.ts 的接口定义',
    { ...overlapState.modules[0], allowedFiles: ['src/shared.ts', 'src/a.ts'] },
    [
      { ...overlapState.modules[0], allowedFiles: ['src/shared.ts', 'src/a.ts'] },
      { ...overlapState.modules[1], allowedFiles: ['src/shared.ts', 'src/b.ts'] },
    ],
    overlapState.sharedContract
  );
  assert.ok(res.contractViolations >= 1, '白名单重叠并发生修改时必须判定为契约违规');
  pass('EDGE-04', `初始化白名单去重生效（M1=[${m1Files.join(',')}] / M2=[${m2Files.join(',')}]，交集 0）；绕过初始化时重叠越界被拦截 (violations=${res.contractViolations})`);
}

// ---------------------------------------------------------------- EDGE-05
console.log('\n--- EDGE-05 反馈向量语义 (覆盖累计值 vs 增量累加) ---');
{
  const mod = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: '语义探测', responsibility: '语义', files: ['src/x.ts'], dependsOn: [], level: 'medium_standard' },
    ])
  ).modules[0];

  const once = updateModuleBeliefWithFeedback(mod, { contractViolations: 1, verifiedClaims: 1 });
  const twice = updateModuleBeliefWithFeedback(once.updatedModule, { contractViolations: 1, verifiedClaims: 1 });
  assert.equal(once.updatedModule.belief.feedbackVector.verifiedClaims, 1, '首次更新计数应为 1');
  assert.equal(twice.updatedModule.belief.feedbackVector.verifiedClaims, 2, '增量语义下重复反馈必须累加');
  assert.equal(twice.updatedModule.belief.feedbackVector.contractViolations, 2, '违规计数同样必须累加');
  assert.ok(
    twice.updatedModule.belief.posteriorRisk > once.updatedModule.belief.posteriorRisk,
    '累计证伪/违规后后验风险必须上升'
  );

  // resolveRefutedClaims / resolveContractViolations 可清零已修复的历史项
  const resolved = updateModuleBeliefWithFeedback(twice.updatedModule, {}, {
    resolveContractViolations: true,
    resolveRefutedClaims: true,
  });
  assert.equal(resolved.updatedModule.belief.feedbackVector.contractViolations, 0, '已修复项应可清零');
  assert.ok(
    resolved.updatedModule.belief.posteriorRisk < twice.updatedModule.belief.posteriorRisk,
    '清零已修复项后后验风险必须下降'
  );
  pass('EDGE-05', `增量语义生效：verified 1→2、violations 1→2，P_posterior ${once.updatedModule.belief.posteriorRisk}→${twice.updatedModule.belief.posteriorRisk}；resolve 清零后回落至 ${resolved.updatedModule.belief.posteriorRisk}`);
}

// ---------------------------------------------------------------- EDGE-06
console.log('\n--- EDGE-06 答辩阶段实证计数硬编码 (静态契约扫描 src/App.tsx) ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const lines = appSource.split('\n');
  // 结构化多行扫描：定位 advanceModularOrchestration 调用块内的 verifiedClaims 字面量，
  // 避免单行正则漏检（字段常跨行书写）。
  const hardcodedHit = lines.findIndex((line, idx) => {
    if (!/verifiedClaims:\s*2\s*,?/.test(line)) return false;
    const windowText = lines.slice(Math.max(0, idx - 10), idx + 5).join('\n');
    return (
      /(advanceModularOrchestration|stepModularStageTransition)/.test(windowText) &&
      /refutedClaims:\s*0\s*,?/.test(windowText)
    );
  });
  const usesComputedCounter = lines.some((l) => /verifiedClaims:\s*verifiedDefenseCount/.test(l));
  if (hardcodedHit >= 0) {
    defect(
      'EDGE-06',
      `src/App.tsx:${hardcodedHit + 1} 答辩阶段 advanceModularOrchestration 硬编码 { verifiedClaims: 2, refutedClaims: 0 }，` +
        `导致规则 C (SCOPED_DEFENSE_REFINE) 在真实运行期不可达，后验风险 P_posterior 不反映真实证伪数，` +
        `与 SPEC「实时反馈捕获 Γ_k」存在偏差`
    );
  } else if (!usesComputedCounter) {
    defect(
      'EDGE-06',
      '未发现硬编码字面量，但也未发现基于真实证据链的 verifiedDefenseCount 计数注入，反馈向量来源存疑'
    );
  } else {
    pass('EDGE-06', '硬编码已移除，答辩阶段改用真实证据链统计的 verifiedDefenseCount / refutedDefenseCount');
  }
}

// ---------------------------------------------------------------- E2E-03
console.log('\n--- E2E-03 集成仿真：完整模块生命周期与多模块循环闭环 ---');

/**
 * 按 src/App.tsx 的调用序列复刻完整 FSM（含 fast_track 双轨）：
 * proposal -> (fast_track ? verification : challenge -> verification) -> [defense] -> FREEZE
 * - defense 判定 SCOPED_DEFENSE_REFINE 时回环 challenge（上限 1 轮）；
 * - fast_track 在 verification 零违规零证伪时直接 FREEZE（跳过红队与答辩）；
 * - 当前模块冻结且仍有未冻结模块时切换到下一拓扑模块并重新走该模块的 proposal，
 *   全部模块冻结后才进入 arbitration。
 */
function runModularLifecycle(
  draft: ModuleDecompositionDraft,
  options: {
    verificationFeedback?: (
      moduleId: string,
      pass: number
    ) => { verifiedClaims?: number; refutedClaims?: number };
    defenseFeedback?: (
      moduleId: string,
      pass: number
    ) => { verifiedClaims?: number; refutedClaims?: number; contractViolations?: number; dssScore?: number };
    maxIterations?: number;
  } = {}
) {
  const refineCounts: Record<string, number> = {};
  const visits: Record<string, number> = {};
  const stagesByModule: Record<string, string[]> = {};
  const trace: string[] = [];
  const maxIterations = options.maxIterations ?? 60;
  let state = initializeModularOrchestrationState(draft);
  let stage: 'proposal' | 'challenge' | 'verification' | 'defense' | 'arbitration' = 'proposal';
  let iterations = 0;

  while (stage !== 'arbitration' && iterations < maxIterations) {
    iterations += 1;
    const activeId = state.activeModuleId;
    if (!activeId) {
      trace.push(`无 activeModuleId，提前终止 (stage=${stage})`);
      break;
    }
    visits[activeId] = (visits[activeId] || 0) + 1;
    stagesByModule[activeId] = [...(stagesByModule[activeId] || []), stage];
    const refineCount = refineCounts[activeId] || 0;

    const result =
      stage === 'proposal'
        ? stepModularStageTransition({
            state,
            currentStage: 'proposal',
            feedbackDelta: {},
            proposalOrDefenseSnippet: `${activeId} 模块级提案立论`,
          })
        : stage === 'challenge'
        ? stepModularStageTransition({
            state,
            currentStage: 'challenge',
            feedbackDelta: { edgeCaseCount: 1 },
          })
        : stage === 'verification'
        ? stepModularStageTransition({
            state,
            currentStage: 'verification',
            feedbackDelta: options.verificationFeedback
              ? options.verificationFeedback(activeId, visits[activeId])
              : { verifiedClaims: 2, refutedClaims: 0 },
            currentModuleRefineCount: refineCount,
          })
        : stepModularStageTransition({
            state,
            currentStage: 'defense',
            feedbackDelta: options.defenseFeedback
              ? options.defenseFeedback(activeId, visits[activeId])
              : { verifiedClaims: 1, refutedClaims: 0, contractViolations: 0, dssScore: 0.3 },
            proposalOrDefenseSnippet: `${activeId} 定案摘要`,
            currentModuleRefineCount: refineCount,
          });

    trace.push(
      `${stage}(${activeId}) -> ${result.posteriorAction}${result.triggeredScopedRefine ? ' [REFINE]' : ''} ; next=${result.nextGameStage}`
    );
    state = result.nextState;

    if (result.triggeredScopedRefine) {
      refineCounts[activeId] = refineCount + 1;
      stage = 'challenge';
      continue;
    }
    stage = result.nextGameStage;
  }

  return { state, trace, iterations, visits, refineCounts, stagesByModule, finalStage: stage };
}

{
  const draft = makeDraft([
    { id: 'M1', title: 'M1 低风险根模块', responsibility: '边界共识', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 高风险核心', responsibility: '并发事务引擎', files: ['src/b.ts'], dependsOn: ['M1'], level: 'high_critical' },
    { id: 'M3', title: 'M3 视图层', responsibility: 'UI 渲染', files: ['src/c.tsx'], dependsOn: ['M2'], level: 'low_deterministic' },
  ]);
  const run = runModularLifecycle(draft);
  const frozenCount = run.state.modules.filter((m) => m.status === 'frozen').length;
  const stranded = run.state.modules.filter((m) => m.status !== 'frozen');

  console.log(`    仿真轨迹: ${run.trace.join('  ||  ')}`);
  console.log(
    `    终态: ${run.state.modules.map((m) => `${m.moduleId}=${m.status}`).join(', ')} ; 已冻结 ${frozenCount}/${run.state.modules.length} ; 迭代 ${run.iterations} 次 ; 最终阶段 ${run.finalStage}`
  );

  if (frozenCount !== run.state.modules.length || stranded.length > 0) {
    defect(
      'E2E-03',
      `多模块循环未闭环：仅 ${frozenCount}/${run.state.modules.length} 模块冻结，滞留 [${stranded
        .map((m) => `${m.moduleId}:${m.status}`)
        .join(', ')}]，迭代 ${run.iterations} 次后停在 ${run.finalStage}`
    );
  } else if (run.finalStage !== 'arbitration') {
    defect('E2E-03', `模块虽全部冻结，但未进入 arbitration（停在 ${run.finalStage}）`);
  } else {
    pass(
      'E2E-03',
      `${run.state.modules.length}/${run.state.modules.length} 模块全部冻结并进入 arbitration；迭代 ${run.iterations} 次，各模块访问次数 ${JSON.stringify(run.visits)}`
    );
  }
}

// ---------------------------------------------------------------- N4
console.log('\n--- N4 局部重修有界收敛 (防死循环) ---');
{
  const draft = makeDraft([
    { id: 'M1', title: 'M1 持续证伪模块', responsibility: '并发事务与鉴权迁移', files: ['src/a.ts'], dependsOn: [], level: 'high_critical' },
    { id: 'M2', title: 'M2 下游模块', responsibility: 'UI 渲染', files: ['src/b.ts'], dependsOn: ['M1'], level: 'low_deterministic' },
  ]);
  // 答辩阶段持续产生证伪：应触发 1 轮有界局部重修后强制收敛冻结
  const run = runModularLifecycle(draft, {
    defenseFeedback: () => ({ verifiedClaims: 0, refutedClaims: 1, contractViolations: 0, dssScore: 0.8 }),
  });
  const frozenCount = run.state.modules.filter((m) => m.status === 'frozen').length;
  console.log(`    仿真轨迹: ${run.trace.join('  ||  ')}`);
  console.log(
    `    终态: ${run.state.modules.map((m) => `${m.moduleId}=${m.status}`).join(', ')} ; 迭代 ${run.iterations} 次 ; 重修次数 ${JSON.stringify(run.refineCounts)}`
  );
  assert.ok(run.iterations < 30, `持续证伪场景必须收敛，实际迭代 ${run.iterations} 次`);
  assert.equal(frozenCount, run.state.modules.length, '达到重修上限后应强制冻结全部模块');
  assert.ok(
    Object.values(run.refineCounts).every((c) => c <= 1),
    `单模块局部重修不得超过 1 轮，实际 ${JSON.stringify(run.refineCounts)}`
  );
  pass('N4', `持续证伪下仍有界收敛：${run.iterations} 次迭代、单模块重修 ${JSON.stringify(run.refineCounts)}、最终 ${frozenCount}/${run.state.modules.length} 冻结`);
}

// ---------------------------------------------------------------- N2
console.log('\n--- N2 白名单去重的声明顺序依赖 ---');
{
  // M1 在数组中声明在前但依赖 M2；两者都声明 src/shared.ts
  const state = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1 下游声明者', responsibility: '下游消费者', files: ['src/shared.ts'], dependsOn: ['M2'], level: 'low_deterministic' },
      { id: 'M2', title: 'M2 上游定义者', responsibility: '接口定义方', files: ['src/shared.ts'], dependsOn: [], level: 'low_deterministic' },
    ])
  );
  const m1Files = state.modules.find((m) => m.moduleId === 'M1')!.allowedFiles;
  const m2Files = state.modules.find((m) => m.moduleId === 'M2')!.allowedFiles;
  const upstreamLost = m1Files.includes('src/shared.ts') && !m2Files.includes('src/shared.ts');
  if (upstreamLost) {
    warn(
      'N2',
      `白名单独占权按「数组声明顺序」而非依赖拓扑分配：下游 M1（依赖 M2）抢占了 src/shared.ts，上游定义方 M2 白名单被清空。` +
        `若 M2 后续正式提案提到该文件，会被越界门禁误判为契约违规。建议按 DAG 拓扑序（上游优先）分配独占权。`
    );
  } else {
    pass('N2', `白名单独占权未出现上游丢失（M1=[${m1Files.join(',')}], M2=[${m2Files.join(',')}]）`);
  }
}

// ---------------------------------------------------------------- N3
console.log('\n--- N3 目录前缀重叠误报 ---');
{
  const dirState = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1 目录级白名单', responsibility: '组件目录', files: ['src/components/'], dependsOn: [], level: 'low_deterministic' },
      { id: 'M2', title: 'M2 文件级白名单', responsibility: '单文件', files: ['src/components/Panel.tsx'], dependsOn: [], level: 'low_deterministic' },
    ])
  );
  const benignText = '本模块仅做逻辑推演，不修改任何文件，也不触碰其他模块的产物。';
  const res = validateModuleScopeContract(
    benignText,
    dirState.modules[0],
    dirState.modules,
    dirState.sharedContract
  );
  if (res.contractViolations > 0) {
    defect(
      'N3',
      `目录前缀重叠导致「零修改」文本也被判违规 (violations=${res.contractViolations}, 文件=${res.violatedFiles.join(',')})：` +
        `M1 白名单为目录 'src/components/'，M2 为 'src/components/Panel.tsx'，前缀重叠分支在无修改动作时仍直接计入契约违规，` +
        `该模块会被反复判违规并被迫局部重修。建议前缀重叠仅在检测到真实修改动作时计数。`
    );
  } else {
    pass('N3', '目录前缀重叠未在零修改文本上误报');
  }
}

// ---------------------------------------------------------------- N1
console.log('\n--- N1 App 层状态更新器副作用 (决策变量在 setState updater 内赋值) ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const lines = appSource.split('\n');
  const declIdx = lines.findIndex((l) => /let resolvedNextStage\s*:/.test(l));
  const updaterIdx = lines.findIndex((l, i) => i > declIdx && /updateTopicDataInState\(topicId/.test(l));
  const assignIdx = lines.findIndex((l, i) => i > updaterIdx && /resolvedNextStage\s*=\s*'challenge'/.test(l));
  const useIdx = lines.findIndex((l) => /nextStage:\s*resolvedNextStage/.test(l));
  const refSyncIdx = lines.findIndex((l) => /messagesRef\.current\s*=\s*next/.test(l));

  const assignedInsideUpdater =
    declIdx >= 0 && updaterIdx > declIdx && assignIdx > updaterIdx && useIdx > assignIdx;
  if (assignedInsideUpdater) {
    defect(
      'N1',
      `src/App.tsx:${declIdx + 1} 声明 resolvedNextStage，却在第 ${updaterIdx + 1} 行的 setState 更新器内部（第 ${assignIdx + 1} 行）赋值，` +
        `随后在第 ${useIdx + 1} 行读取并据此决定 nextStage。React 不保证更新器在调用点同步执行（仅命中 eager-state 优化时才会立即求值），` +
        `一旦走异步渲染路径，resolvedNextStage 将保持初值 'arbitration'，多模块循环会静默退化回「只跑第一个模块」的旧行为。` +
        (refSyncIdx >= 0
          ? `同理 src/App.tsx:${refSyncIdx + 1} 的 messagesRef.current = next 也在更新器内部，可能让 getTopicData 读到过期模块状态。`
          : '')
    );
  } else {
    pass('N1', 'App 层未见「更新器内赋值 + 外部读取」的决策耦合');
  }
}

// ---------------------------------------------------------------- N5
console.log('\n--- N5 拓扑去重会静默剥夺模块白名单 (静默过滤反模式) ---');
{
  const state = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1 下游消费方', responsibility: '下游消费', files: ['src/shared.ts', 'src/a.ts'], dependsOn: ['M2'], level: 'low_deterministic' },
      { id: 'M2', title: 'M2 上游定义方', responsibility: '接口定义', files: ['src/shared.ts', 'src/b.ts'], dependsOn: [], level: 'low_deterministic' },
    ])
  );
  const m1 = state.modules.find((m) => m.moduleId === 'M1')!;
  const m2 = state.modules.find((m) => m.moduleId === 'M2')!;
  const dropped = ['src/shared.ts', 'src/a.ts'].filter((f) => !m1.allowedFiles.includes(f));
  console.log(`    M1 声明文件 [src/shared.ts,src/a.ts] -> 实际获得 [${m1.allowedFiles.join(',') || '空'}]；M2 获得 [${m2.allowedFiles.join(',')}]`);
  const hasAudit = (state.whitelistDeduplications?.length || 0) > 0;
  const hasContractInvariant = state.sharedContract.invariants.some(
    (inv) => inv.includes('白名单') || inv.includes('共享文件')
  );
  if (dropped.length > 0 && (!hasAudit || !hasContractInvariant)) {
    warn(
      'N5',
      `拓扑去重会「静默剥夺」下游模块的白名单文件（M1 丢失 ${dropped.join(',')}），且不产生任何用户可见提示、不写入 ADR/时间线。` +
        `后续该模块一旦提及修改该文件会被判越界并被迫重修。若分解方案本身违规（F_i ∩ F_j ≠ ∅），按 AGENTS.md 反静默过滤原则应显式告警或驳回，而非无痕裁剪。`
    );
  } else {
    pass(
      'N5',
      `拓扑去重显式审计闭环：共记录 ${state.whitelistDeduplications?.length || 0} 条留痕并写入契约不变量（M1 剥离 ${dropped.join(',')} 归属 M2，杜绝静默过滤）`
    );
  }
}

// ---------------------------------------------------------------- N6
console.log('\n--- N6 updateTopicDataInState 更新器纯度扫描 (双重求值放大副作用) ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const callName = 'updateTopicDataInState(';
  const callSites: Array<{ index: number; line: number; text: string }> = [];

  let searchFrom = 0;
  for (;;) {
    const idx = appSource.indexOf(callName, searchFrom);
    if (idx < 0) break;
    // 提取括号平衡的整段调用
    let depth = 0;
    let end = idx;
    for (let i = appSource.indexOf('(', idx); i < appSource.length; i += 1) {
      const ch = appSource[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const text = appSource.slice(idx, end + 1);
    const line = appSource.slice(0, idx).split('\n').length;
    callSites.push({ index: idx, line, text });
    searchFrom = end + 1;
  }

  const impureHits: string[] = [];
  for (const site of callSites) {
    const t = site.text;
    if (/\.current\s*=/.test(t)) impureHits.push(`L${site.line}: 更新器内直接改写 ref.current`);
    if (/delete\s+\w+\.current\[/.test(t)) impureHits.push(`L${site.line}: 更新器内 delete ref.current[...]`);
    if (/\bDate\.now\(\)/.test(t)) impureHits.push(`L${site.line}: 更新器内调用 Date.now()（双重求值将产生不同时间戳/ID）`);
    if (/\bMath\.random\(\)|randomUUID\(\)/.test(t)) impureHits.push(`L${site.line}: 更新器内使用随机数，双重求值将产生不同结果`);
    if (/\bset[A-Z]\w*\(/.test(t)) impureHits.push(`L${site.line}: 更新器内嵌套调用其它 setState`);
  }

  console.log(`    扫描到 ${callSites.length} 处 updateTopicDataInState 调用`);
  if (impureHits.length > 0) {
    impureHits.slice(0, 8).forEach((h) => console.log(`      · ${h}`));
    warn(
      'N6',
      `检测到 ${impureHits.length} 处更新器副作用：updateTopicDataInState 现在会「先对 messagesRef 求值一次、再在 setState reducer 中求值一次」` +
        `（StrictMode 开发态还会叠加双调用），任何非纯更新器都会让 ref 副本与 React State 出现分叉。明细见上。`
    );
  } else {
    pass('N6', `${callSites.length} 处更新器均为纯函数（无 ref 改写 / 无时间戳与随机数 / 无嵌套 setState）`);
  }
}

// ---------------------------------------------------------------- N7
console.log('\n--- N7 初始化去重不覆盖「目录-子文件」前缀重叠 ---');
{
  const state = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: 'M1 目录所有者', responsibility: '组件目录', files: ['src/components/'], dependsOn: [], level: 'low_deterministic' },
      { id: 'M2', title: 'M2 嵌套文件所有者', responsibility: '单文件', files: ['src/components/Panel.tsx'], dependsOn: ['M1'], level: 'low_deterministic' },
    ])
  );
  const m1 = state.modules.find((m) => m.moduleId === 'M1')!;
  const m2 = state.modules.find((m) => m.moduleId === 'M2')!;
  const prefixOverlapSurvives = m1.allowedFiles.includes('src/components/') && m2.allowedFiles.includes('src/components/Panel.tsx');

  // 目录所有者 M1 修改自身目录内的文件，是否会被嵌套声明方 M2 反判越界？
  const res = validateModuleScopeContract(
    '本模块修改 src/components/Panel.tsx 以完成目录内组件改造',
    m1,
    state.modules,
    state.sharedContract
  );
  console.log(
    `    M1=[${m1.allowedFiles.join(',')}] ; M2=[${m2.allowedFiles.join(',')}] ; M1 修改子文件的判定 violations=${res.contractViolations}`
  );
  if (prefixOverlapSurvives && res.contractViolations > 0) {
    warn(
      'N7',
      `前缀级重叠未被初始化去重消解（去重仅比对完全相同的字符串），且门禁判定偏向嵌套的具体文件：` +
        `目录所有者 M1 修改自身目录内的 src/components/Panel.tsx 被反判越界（violations=${res.contractViolations}）。` +
        `即 F_i ∩ F_j = ∅ 仅在「字面量相同」时成立，目录级授权与嵌套文件授权会共存并冲突。`
    );
  } else if (prefixOverlapSurvives) {
    pass('N7', '前缀重叠虽共存，但门禁未对目录所有者误判');
  } else {
    pass('N7', '初始化已消解前缀级重叠');
  }
}

// ---------------------------------------------------------------- N8
console.log('\n--- N8 贝叶斯 fast_track 快速通道是否真正省掉红队轮次 ---');
{
  const draft = makeDraft([
    { id: 'M1', title: 'M1 纯类型定义', responsibility: '定义数据结构与常量', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 并发事务核心', responsibility: '并发互斥锁与事务迁移', files: ['src/b.ts'], dependsOn: ['M1'], level: 'high_critical' },
    { id: 'M3', title: 'M3 视图映射', responsibility: 'UI 状态绑定渲染', files: ['src/c.tsx'], dependsOn: ['M2'], level: 'low_deterministic' },
  ]);
  const run = runModularLifecycle(draft);
  const perModule = run.state.modules.map((m) => ({
    id: m.moduleId,
    routingMode: m.belief.routingMode,
    sequence: run.stagesByModule[m.moduleId] || [],
  }));
  console.log(
    `    各模块路由模式与阶段序列: ${perModule
      .map((m) => `${m.id}[${m.routingMode}] = ${m.sequence.join('→')}`)
      .join('  ,  ')}`
  );

  const fastModules = perModule.filter((m) => m.routingMode === 'fast_track');
  const deepModules = perModule.filter((m) => m.routingMode === 'deep_debate');
  const fastSkippedRedTeam = fastModules.every((m) => !m.sequence.includes('challenge'));
  const deepUsedRedTeam = deepModules.every((m) => m.sequence.includes('challenge'));
  const costReduced =
    fastModules.length > 0 &&
    deepModules.length > 0 &&
    fastModules.every((f) => f.sequence.length < deepModules[0].sequence.length);

  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const appWired = /fast_track|routingMode/.test(appSource);
  const proposalStageWired = /nextStage:\s*'proposal'/.test(appSource) || /'proposal'\s*\|/.test(appSource);

  if (appWired && proposalStageWired && fastSkippedRedTeam && deepUsedRedTeam && costReduced) {
    pass(
      'N8',
      `fast_track 双轨已落地：低风险模块跳过红队（${fastModules
        .map((m) => `${m.id}:${m.sequence.join('→')}`)
        .join(' , ')}），高风险模块保留完整对抗（${deepModules
        .map((m) => `${m.id}:${m.sequence.join('→')}`)
        .join(' , ')}），单模块轮次由 ${deepModules[0].sequence.length} 降至 ${fastModules[0].sequence.length}（${(((deepModules[0].sequence.length - fastModules[0].sequence.length) / deepModules[0].sequence.length) * 100).toFixed(0)}% 降幅）`
    );
  } else {
    defect(
      'N8',
      `fast_track 快速通道未真正生效：appWired=${appWired}, proposalStageWired=${proposalStageWired}, ` +
        `低风险跳过红队=${fastSkippedRedTeam}, 高风险走红队=${deepUsedRedTeam}, 轮次下降=${costReduced}；` +
        `实际阶段序列 ${perModule.map((m) => `${m.id}[${m.routingMode}]:${m.sequence.join('→')}`).join(' , ')}`
    );
  }
}

// ---------------------------------------------------------------- N9
console.log('\n--- N9 每个模块是否都有独立提案轮次与专属靶点 ---');
{
  const draft = makeDraft([
    { id: 'M1', title: 'M1 根模块', responsibility: '边界共识', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 核心模块', responsibility: '核心机制', files: ['src/b.ts'], dependsOn: ['M1'], level: 'high_critical' },
    { id: 'M3', title: 'M3 落地模块', responsibility: '验收标准', files: ['src/c.ts'], dependsOn: ['M2'], level: 'low_deterministic' },
  ]);
  const run = runModularLifecycle(draft);
  const perModule = run.state.modules.map((m) => ({
    id: m.moduleId,
    sequence: run.stagesByModule[m.moduleId] || [],
    frozenSnippet: m.frozenProposalSnippet,
  }));
  const modulesWithoutProposal = perModule.filter((m) => m.sequence[0] !== 'proposal');
  console.log(
    `    各模块完整阶段序列: ${perModule.map((m) => `${m.id}=${m.sequence.join('→')}`).join('  ,  ')}`
  );

  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const moduleProposalTriggerWired = /nextStage:\s*'proposal'/.test(appSource);

  if (modulesWithoutProposal.length === 0 && moduleProposalTriggerWired) {
    pass(
      'N9',
      `每个模块均具备独立提案轮次：${perModule.map((m) => `${m.id}:${m.sequence.join('→')}`).join(' , ')}；模块切换经 App 层 'proposal' 阶段触发`
    );
  } else {
    defect(
      'N9',
      `模块提案轮次缺失：App 层 proposal 触发=${moduleProposalTriggerWired}；首个阶段非 proposal 的模块 = [${modulesWithoutProposal
        .map((m) => `${m.id}:${m.sequence.join('→')}`)
        .join(', ')}]`
    );
  }
}

// ---------------------------------------------------------------- N11
console.log('\n--- N11 全 fast_track 议题的制衡方门禁是否被误判 ---');
{
  const allFastDraft = makeDraft([
    { id: 'M1', title: 'M1 纯类型定义', responsibility: '数据结构与常量', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 视图映射', responsibility: 'UI 状态绑定渲染', files: ['src/b.tsx'], dependsOn: ['M1'], level: 'low_deterministic' },
  ]);
  const run = runModularLifecycle(allFastDraft);
  const challengeNeverRuns = Object.values(run.stagesByModule).every((seq) => !seq.includes('challenge'));
  console.log(
    `    全 fast_track 议题阶段序列: ${Object.entries(run.stagesByModule).map(([k, v]) => `${k}=${v.join('→')}`).join('  ,  ')}（红队轮次出现: ${!challengeNeverRuns}）`
  );

  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  // 截取「阶段 3 验证完成」到 trigger 之间的更新块，检查是否回填制衡方响应标记
  const verStart = appSource.indexOf('阶段 3 验证完成后');
  const verEnd = appSource.indexOf("nextStage: resolvedVerNextStage", verStart);
  const verBlock = verStart >= 0 && verEnd > verStart ? appSource.slice(verStart, verEnd) : '';
  const verBlockSetsChallenger = /isChallengerResponded/.test(verBlock);
  const fastTrackBypassMarker = /challengerBypassed|fastTrackBypassed|challengerSkippedByFastTrack/.test(appSource);

  const drawerSource = readFileSync(resolve(process.cwd(), 'src/components/TopicThreadDrawer.tsx'), 'utf8');
  const quorumGateUsesFlag = /isChallengerQuorumMet[\s\S]{0,160}?isChallengerResponded !== false/.test(drawerSource);

  if (challengeNeverRuns && quorumGateUsesFlag && !verBlockSetsChallenger && !fastTrackBypassMarker) {
    defect(
      'N11',
      `全 fast_track 议题的制衡方门禁被误判：模块全程不进入 challenge（红队被贝叶斯快速通道按设计跳过），` +
        `而「阶段 3 验证完成后」的状态更新块并未回填 isChallengerResponded，也没有任何 fast_track 旁路标记。` +
        `因 TopicThreadDrawer 的 isChallengerQuorumMet 判定为 isChallengerResponded !== false，` +
        `此类议题会显示「⚔️ 压测缺席 / 制衡方未响应」，强制人类首席仲裁官签署制衡方缺席具名豁免，` +
        `并把「制衡方缺席」写入 rulingRecord.exemptionReason —— 实际红队是被设计性旁路，而非缺席，审计留痕失真。`
    );
  } else if (!challengeNeverRuns) {
    warn('N11', '全 fast_track 场景下仍出现红队轮次，快速通道未生效，需复核 N8');
  } else {
    pass('N11', 'fast_track 旁路已正确回填制衡方响应语义（门禁不误判）');
  }
}

// ---------------------------------------------------------------- N10
console.log('\n--- N10 fast_track 分流是否校验验证官可用性 ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  // 提案完成后的模块分流块：定位 stepModularStageTransition(currentStage: 'proposal') 调用附近的窗口
  const proposalCallIdx = appSource.lastIndexOf("currentStage: 'proposal'");
  const proposalBlock = proposalCallIdx > 0 ? appSource.slice(proposalCallIdx - 200, proposalCallIdx + 900) : '';
  // 红队完成后的阶段分流块：定位 nextStageTarget 计算附近的窗口
  const challengeAnchorIdx = appSource.indexOf('const nextStageTarget');
  const challengeBlock = challengeAnchorIdx > 0 ? appSource.slice(challengeAnchorIdx - 700, challengeAnchorIdx + 700) : '';

  const proposalChecksVerifier = /hasVerifiers|verifiers/.test(proposalBlock);
  const challengeChecksVerifier = /hasVerifiers|verifiers/.test(challengeBlock);

  console.log(
    `    提案完成分流块校验验证官: ${proposalChecksVerifier}（窗口 ${proposalBlock.length} 字符）; 红队完成分流块校验验证官: ${challengeChecksVerifier}（窗口 ${challengeBlock.length} 字符）`
  );

  if (proposalBlock && challengeBlock && !proposalChecksVerifier && challengeChecksVerifier) {
    warn(
      'N10',
      `fast_track 分流未校验验证官可用性：提案完成后直接把 fast_track 模块推进到 verification，` +
        `未像红队完成分支那样检查 verifier 是否指派/在线。若议题未指派验证官，验证接力将命中「接地验证者缺席」分支并改跳 defense，` +
        `使 fast_track 模块多消耗一轮答辩，且不给用户任何「快速通道因缺少验证官而降级」的提示。`
    );
  } else if (proposalChecksVerifier && challengeChecksVerifier) {
    pass('N10', 'fast_track 分流与红队分流均校验验证官可用性');
  } else {
    warn('N10', `静态窗口判定不确定（提案块=${proposalBlock.length} 字符 / 红队块=${challengeBlock.length} 字符），建议运行期复核`);
  }
}

// ---------------------------------------------------------------- N12
console.log('\n--- N12 fast_track 降级是否就地改写 React 状态对象 ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const lines = appSource.split('\n');
  const mutationHits = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => /\.belief\.(routingMode|priorRisk|posteriorRisk|status)\s*=(?!=)/.test(line));

  // baseModular 可能直接引用上一轮 React 状态中的 modularState
  const baseAliasesPrevState =
    /const baseModular =[\s\S]{0,500}?(old|currentTopicData)\??\.gameTheoreticState\??\.modularState/.test(appSource);

  if (mutationHits.length > 0 && baseAliasesPrevState) {
    const hit = mutationHits[0];
    warn(
      'N12',
      `fast_track 降级路径就地改写 React 状态中的嵌套对象：src/App.tsx:${hit.idx + 1} 执行 \`${hit.line.trim()}\`。` +
        `该 activeMod 取自 updatedModular.modules，而 baseModular 可能是上一轮 gameTheoreticState.modularState（第 5013~5018 行），` +
        `其 belief 与历史状态共享同一引用 —— 原地赋值会连带篡改历史快照，违反不可变契约。` +
        `同一逻辑在模块提案路径（约 2339 行）已用 { ...m.belief, routingMode } 正确处理，两处实现不一致。`
    );
  } else {
    pass('N12', '模块 belief 更新均采用不可变写法');
  }
}

// ---------------------------------------------------------------- N13
console.log('\n--- N13 全 fast_track 议题是否产生 SPRT 序贯收敛证据 ---');
{
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const fastFreezeIdx = appSource.indexOf('Fast Track Frozen');
  const fastBlock = fastFreezeIdx > 0 ? appSource.slice(fastFreezeIdx - 1500, fastFreezeIdx + 2000) : '';
  const fastPathWritesSprt = /sprtState\s*[:,]/.test(fastBlock);

  const allFastDraft = makeDraft([
    { id: 'M1', title: 'M1 纯类型定义', responsibility: '数据结构与常量', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 视图映射', responsibility: 'UI 状态绑定渲染', files: ['src/b.tsx'], dependsOn: ['M1'], level: 'low_deterministic' },
  ]);
  const run = runModularLifecycle(allFastDraft);
  const challengeNeverRuns = Object.values(run.stagesByModule).every((seq) => !seq.includes('challenge'));
  const defenseNeverRuns = Object.values(run.stagesByModule).every((seq) => !seq.includes('defense'));

  console.log(
    `    全 fast_track 阶段序列: ${Object.entries(run.stagesByModule).map(([k, v]) => `${k}=${v.join('→')}`).join('  ,  ')}；快速通道分支写 sprtState: ${fastPathWritesSprt}`
  );
  if (challengeNeverRuns && defenseNeverRuns && !fastPathWritesSprt) {
    warn(
      'N13',
      `全 fast_track 议题不会产生任何 SPRT 序贯收敛证据：模块全程跳过 challenge 与 defense，` +
        `而 sprtState 仅在红队/答辩完成后写入（全仓 sprtState 写入点均位于 defense 链路）。` +
        `后果：抽屉的「Wald-SPRT 序贯调控」条不渲染，仲裁卡与 ADR 缺少 Λ 似然比收敛记录，` +
        `该议题的「收敛可信度」在审计留痕上为空 —— 建议为 fast_track 直通路径补一条轻量的静态验证收敛证据字段。`
    );
  } else if (fastPathWritesSprt) {
    pass('N13', 'fast_track 直通路径已写入 SPSS/SPRT 等价收敛证据');
  } else {
    pass('N13', `未出现「无红队且无答辩」的议题形态（challenge=${!challengeNeverRuns}, defense=${!defenseNeverRuns}）`);
  }
}

// ---------------------------------------------------------------- 汇总
console.log('\n================================================================================');
const defects = findings.filter((f) => f.level === 'DEFECT');
const warns = findings.filter((f) => f.level === 'WARN');
console.log(`📋 探测汇总：DEFECT ${defects.length} 项 / WARN ${warns.length} 项`);
if (defects.length > 0) {
  console.log('\n🔴 DEFECT (与 SPEC 偏差，建议修复)：');
  defects.forEach((f) => console.log(`   - [${f.id}] ${f.message}`));
}
if (warns.length > 0) {
  console.log('\n⚠️ WARN (语义待确认)：');
  warns.forEach((f) => console.log(`   - [${f.id}] ${f.message}`));
}
console.log(
  '\n提示：本脚本用于持续观测集成风险，不阻断 npm run test:cogno 基线；请结合 TEST_PLAN 决定修复或更新 SPEC。'
);
console.log('================================================================================');
