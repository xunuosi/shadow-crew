/**
 * G-Frame 模块化分治 × 贝叶斯博弈：边界与集成风险探测套件
 * 对应文档：docs/TEST_PLAN_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md
 *
 * 覆盖尚未进入基线套件（npm run test:cogno）的用例：
 * - L1 补强：GF-03 分流阈值边界 / GF-05 模块数上限 / GF-09 DSS 惩罚单调性 / GF-16 沙箱 Prompt 负向隔离
 * - 边界异常：EDGE-01 模块数超限 / EDGE-02 模块数不足 / EDGE-03 依赖成环 /
 *            EDGE-04 白名单重叠 / EDGE-05 反馈语义 / EDGE-06 答辩阶段实证计数
 * - 集成仿真：E2E-03 App 层 FSM 接力下的多模块循环闭环
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
  assert.equal(single.modules.length, 1);
  warn(
    'EDGE-02',
    `前端初始化层不校验下限：提交 1 个模块被原样接受 (modules=${single.modules.length}, enabled=${single.enabled})。` +
      `MCP Schema 侧 minItems=2 可拦截工具调用路径，但绕过 Schema 直传无守卫。`
  );
}

// ---------------------------------------------------------------- EDGE-03
console.log('\n--- EDGE-03 依赖成环 (无环检测) ---');
{
  const cyclic = initializeModularOrchestrationState(
    makeDraft([
      { id: 'M1', title: '环 M1', responsibility: '环检测', files: ['src/1.ts'], dependsOn: ['M2'], level: 'low_deterministic' },
      { id: 'M2', title: '环 M2', responsibility: '环检测', files: ['src/2.ts'], dependsOn: ['M1'], level: 'low_deterministic' },
    ])
  );
  assert.equal(getNextSchedulableModule(cyclic), undefined);

  // 模拟 App 层：activeModuleId 为空时所有 advance 调用被 guard 跳过
  const frozenCount = cyclic.modules.filter((m) => m.status === 'frozen').length;
  defect(
    'EDGE-03',
    `依赖成环无守卫：无拓扑根节点 -> activeModuleId=${String(cyclic.activeModuleId)}, ` +
      `可见模块 ${frozenCount}/${cyclic.modules.length} 冻结，全部永久停留 '${cyclic.modules[0].status}' (集成层因 activeModuleId 为空将跳过全部推进调用)`
  );
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
  const res = validateModuleScopeContract(
    '本模块直接修改 src/shared.ts 的接口定义',
    overlapState.modules[0],
    overlapState.modules,
    overlapState.sharedContract
  );
  assert.equal(res.contractViolations, 0);
  warn(
    'EDGE-04',
    `白名单重叠时越界门禁放行 (contractViolations=${res.contractViolations})：'src/shared.ts' 同时在 M1/M2 白名单内，` +
      `两模块可同时声明修改同一文件，存在双写冲突风险；当前实现以「本模块白名单优先」判定。`
  );
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
  assert.equal(
    twice.updatedModule.belief.posteriorRisk,
    once.updatedModule.belief.posteriorRisk,
    '参数语义为「累计绝对值覆盖」，重复传入相同值不应叠加'
  );
  warn(
    'EDGE-05',
    `updateModuleBeliefWithFeedback 的 feedbackDelta 实为「累计绝对值覆盖」而非增量：重复传入相同反馈，` +
      `P_posterior 恒为 ${twice.updatedModule.belief.posteriorRisk}（未叠加）。集成层需自行累加后传入，命名易误读。`
  );
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
    const windowText = lines.slice(Math.max(0, idx - 8), idx + 4).join('\n');
    return /advanceModularOrchestration/.test(windowText) && /refutedClaims:\s*0\s*,?/.test(windowText);
  });
  if (hardcodedHit >= 0) {
    defect(
      'EDGE-06',
      `src/App.tsx:${hardcodedHit + 1} 答辩阶段 advanceModularOrchestration 硬编码 { verifiedClaims: 2, refutedClaims: 0 }，` +
        `导致规则 C (SCOPED_DEFENSE_REFINE) 在真实运行期不可达，后验风险 P_posterior 不反映真实证伪数，` +
        `与 SPEC「实时反馈捕获 Γ_k」存在偏差`
    );
  } else {
    pass('EDGE-06', '未检测到答辩阶段实证计数硬编码');
  }
}

// ---------------------------------------------------------------- E2E-03
console.log('\n--- E2E-03 集成仿真：App 层 FSM 接力下的多模块循环闭环 ---');
{
  // 按 src/App.tsx 的真实调用顺序复刻：阶段3(verification) 与 阶段4(defense) 各推进一次，
  // 随后无条件转入 arbitration，且未消费 allModulesFrozen 回流。
  const draft = makeDraft([
    { id: 'M1', title: 'M1 低风险根模块', responsibility: '边界共识', files: ['src/a.ts'], dependsOn: [], level: 'low_deterministic' },
    { id: 'M2', title: 'M2 高风险核心', responsibility: '并发事务引擎', files: ['src/b.ts'], dependsOn: ['M1'], level: 'high_critical' },
    { id: 'M3', title: 'M3 视图层', responsibility: 'UI 渲染', files: ['src/c.tsx'], dependsOn: ['M2'], level: 'low_deterministic' },
  ]);

  let state = initializeModularOrchestrationState(draft);
  const trace: string[] = [`init -> active=${state.activeModuleId}, status=${state.modules[0].status}`];

  // 阶段 3: verification 完成后 advance（携带真实证据计数）
  const verification = advanceModularOrchestration(
    state,
    state.activeModuleId!,
    { verifiedClaims: 2, refutedClaims: 0 },
    'M1 定案摘要'
  );
  trace.push(`verification(${state.activeModuleId}) -> ${verification.action} ; next active=${verification.nextState.activeModuleId}`);
  state = verification.nextState;

  // 阶段 4: defense 完成后 advance（App.tsx 中实证计数被硬编码为 2 / 0）
  const activeBeforeDefense = state.activeModuleId!;
  const defense = advanceModularOrchestration(
    state,
    activeBeforeDefense,
    { verifiedClaims: 2, refutedClaims: 0, contractViolations: 0, dssScore: 0.2 },
    'M2 定案摘要(未经红队/验证)'
  );
  trace.push(`defense(${activeBeforeDefense}) -> ${defense.action} ; next active=${defense.nextState.activeModuleId}`);
  state = defense.nextState;

  // App.tsx 此后固定进入 arbitration，不再有回流推进
  const frozenCount = state.modules.filter((m) => m.status === 'frozen').length;
  const stranded = state.modules.filter((m) => m.status !== 'frozen');

  console.log(`    仿真轨迹: ${trace.join('  ||  ')}`);
  console.log(
    `    终态: ${state.modules
      .map((m) => `${m.moduleId}=${m.status}`)
      .join(', ')} ; 已冻结 ${frozenCount}/${state.modules.length}`
  );

  if (frozenCount !== state.modules.length) {
    defect(
      'E2E-03',
      `多模块循环未闭环：仅 ${frozenCount}/${state.modules.length} 模块冻结，` +
        `滞留模块 [${stranded.map((m) => `${m.moduleId}:${m.status}`).join(', ')}] 未经历红队/验证即被仲裁流程遗弃；` +
        `且 M2 的冻结来自答辩阶段的硬编码实证计数，而非其自身沙箱的对抗验证`
    );
  } else {
    pass('E2E-03', `全部 ${state.modules.length} 个模块完成闭环冻结`);
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
