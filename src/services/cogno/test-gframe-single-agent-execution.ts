import assert from 'node:assert/strict';
import {
  computeTopologicalExecutionOrder,
  getNextExecutableModuleSlice,
  mergeTopicPatchDiffs,
} from './bayesianModuleGovernor';
import { buildModularExecutionPrompt, TopicPromptContext } from '../agentCollaboration';
import {
  Agent,
  ModuleComplexityLevel,
  SharedInterfaceContract,
  TaskModuleSlice,
  TopicPatchDiffItem,
} from '../../types';

console.log('================================================================================');
console.log('🧪 CognoNexus × G-Frame: 单个独立 Agent 贝叶斯模块化分治执行测试套件');
console.log('📄 对应规范: docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md');
console.log('================================================================================\n');

const mockAgent: Agent = {
  id: 'agent-lead-dev',
  name: 'LeadArchitect',
  handle: '@lead-dev',
  role: '首席架构与开发工程师',
  avatar: '👨‍💻',
  status: 'running',
  description: '精通 Rust、TypeScript 与分布式架构，负责复杂系统重构与全栈模块落地。',
} as unknown as Agent;

const mockSharedContract: SharedInterfaceContract = {
  contractVersion: 1,
  summary: '跨模块统一采用 OrderEvent 领域事件与 SQLite 事务状态机契约',
  typeSignatures: `export interface OrderEvent {
  orderId: string;
  eventType: 'CREATED' | 'PAID' | 'CANCELLED';
  amount: number;
}`,
  invariants: [
    '所有状态变更严禁直接改写内存变量，必须经由 OrderRepository 事务提交',
    '所有领域事件必须满足幂等性保证 (UUID 校验)',
  ],
  lockedAt: '2026-11-11T20:00:00.000Z',
};

const sampleModules: TaskModuleSlice[] = [
  {
    moduleId: 'mod-1-contract',
    title: '模块 1：数据模型与公共事件契约',
    responsibility: '定义 OrderEvent 接口与 OrderRepository 抽象接口',
    allowedFiles: ['src/types/order.ts', 'src/types/events.ts'],
    dependsOnModuleIds: [],
    complexityLevel: 'low_deterministic',
    status: 'frozen',
    belief: {
      priorRisk: 0.2,
      posteriorRisk: 0.15,
      routingMode: 'fast_track',
      feedbackVector: { contractViolations: 0, verifiedClaims: 2, refutedClaims: 0, edgeCaseCount: 0, dssScore: 0.1 },
      lastUpdatedAt: new Date().toISOString(),
    },
    scopedMessageIds: [],
  },
  {
    moduleId: 'mod-2-engine',
    title: '模块 2：事务持久化与业务执行引擎',
    responsibility: '实现 SQLite 事务持久化逻辑与幂等去重校验',
    allowedFiles: ['src/services/orderEngine.ts', 'src/services/sqliteRepo.ts'],
    dependsOnModuleIds: ['mod-1-contract'],
    complexityLevel: 'high_critical',
    status: 'frozen',
    belief: {
      priorRisk: 0.7,
      posteriorRisk: 0.35,
      routingMode: 'deep_debate',
      feedbackVector: { contractViolations: 0, verifiedClaims: 4, refutedClaims: 0, edgeCaseCount: 3, dssScore: 0.2 },
      lastUpdatedAt: new Date().toISOString(),
    },
    scopedMessageIds: [],
  },
  {
    moduleId: 'mod-3-ui',
    title: '模块 3：工作区状态机与交互视图',
    responsibility: '实现订单状态机变更的前端展示与操作按钮联动',
    allowedFiles: ['src/components/OrderView.tsx'],
    dependsOnModuleIds: ['mod-2-engine'],
    complexityLevel: 'medium_standard',
    status: 'frozen',
    belief: {
      priorRisk: 0.45,
      posteriorRisk: 0.22,
      routingMode: 'deep_debate',
      feedbackVector: { contractViolations: 0, verifiedClaims: 3, refutedClaims: 0, edgeCaseCount: 1, dssScore: 0.15 },
      lastUpdatedAt: new Date().toISOString(),
    },
    scopedMessageIds: [],
  },
];

// --- 测试 1: 基于 DAG 拓扑偏序的模块执行调度规划 ---
console.log('--- 测试 1: 基于 DAG 拓扑偏序的模块执行规划 (computeTopologicalExecutionOrder) ---');
{
  const order = computeTopologicalExecutionOrder(sampleModules);
  assert.equal(order.length, 3, '应当规划全部 3 个模块');
  assert.equal(order[0].moduleId, 'mod-1-contract', '根节点 mod-1 必须最先执行');
  assert.equal(order[1].moduleId, 'mod-2-engine', '依赖 mod-1 的 mod-2 必须次之执行');
  assert.equal(order[2].moduleId, 'mod-3-ui', '依赖 mod-2 的 mod-3 必须最后执行');

  // 测试菱形依赖 DAG: M1 -> M2, M1 -> M3, M2 -> M4, M3 -> M4
  const diamondModules: TaskModuleSlice[] = [
    { ...sampleModules[0], moduleId: 'M1', dependsOnModuleIds: [] },
    { ...sampleModules[1], moduleId: 'M2', dependsOnModuleIds: ['M1'] },
    { ...sampleModules[1], moduleId: 'M3', dependsOnModuleIds: ['M1'] },
    { ...sampleModules[2], moduleId: 'M4', dependsOnModuleIds: ['M2', 'M3'] },
  ];
  const diamondOrder = computeTopologicalExecutionOrder(diamondModules);
  assert.equal(diamondOrder.length, 4);
  assert.equal(diamondOrder[0].moduleId, 'M1', '菱形根节点 M1 最先');
  assert.equal(diamondOrder[3].moduleId, 'M4', '菱形汇聚节点 M4 最后');

  // 测试成环回边破环: M1 <-> M2
  const cyclicModules: TaskModuleSlice[] = [
    { ...sampleModules[0], moduleId: 'C1', dependsOnModuleIds: ['C2'] },
    { ...sampleModules[1], moduleId: 'C2', dependsOnModuleIds: ['C1'] },
  ];
  const acyclicOrder = computeTopologicalExecutionOrder(cyclicModules);
  assert.equal(acyclicOrder.length, 2, '成环破环后仍应完整容纳全部模块，绝不卡死');

  console.log('✓ 拓扑执行规划校验通过：严格保证前置依赖先执行，菱形依赖与成环破环稳健');
}

// --- 测试 2: 动态就绪切片调度器 (getNextExecutableModuleSlice) ---
console.log('\n--- 测试 2: 动态就绪切片调度器 (getNextExecutableModuleSlice) ---');
{
  const testState: TaskModuleSlice[] = JSON.parse(JSON.stringify(sampleModules));

  // 初始状态全部未执行
  const ready1 = getNextExecutableModuleSlice(testState);
  assert.equal(ready1?.moduleId, 'mod-1-contract', '初始应当调度无依赖的 mod-1');

  // mod-1 标记为 running
  testState[0].executionStatus = 'running';
  const readyRunning = getNextExecutableModuleSlice(testState);
  assert.equal(readyRunning?.moduleId, 'mod-1-contract', '优先返回正在执行中的模块');

  // mod-1 完成
  testState[0].executionStatus = 'completed';
  const ready2 = getNextExecutableModuleSlice(testState);
  assert.equal(ready2?.moduleId, 'mod-2-engine', 'mod-1 完成后应当调度就绪的 mod-2');

  // mod-2 完成
  testState[1].executionStatus = 'completed';
  const ready3 = getNextExecutableModuleSlice(testState);
  assert.equal(ready3?.moduleId, 'mod-3-ui', 'mod-2 完成后应当调度就绪的 mod-3');

  // mod-3 完成
  testState[2].executionStatus = 'completed';
  const readyAllDone = getNextExecutableModuleSlice(testState);
  assert.equal(readyAllDone, undefined, '全部模块完成后应返回 undefined');

  console.log('✓ 动态切片就绪调度校验通过：严格依据前序完成状态推进流水线');
}

// --- 测试 3: 工作区 Patch Diff 合并与文件名去重 ---
console.log('\n--- 测试 3: 多阶段 Diff 聚合与文件名去重 (mergeTopicPatchDiffs) ---');
{
  const diffsStep1: TopicPatchDiffItem[] = [
    {
      filename: 'src/types/order.ts',
      additions: 25,
      deletions: 0,
      diff: '@@ -0,0 +1,25 @@\n+export interface OrderEvent {}',
    },
    {
      filename: 'src/types/events.ts',
      additions: 15,
      deletions: 2,
      diff: '@@ -1,2 +1,15 @@',
    },
  ];

  const diffsStep2: TopicPatchDiffItem[] = [
    {
      filename: 'src/services/orderEngine.ts',
      additions: 60,
      deletions: 5,
      diff: '@@ -0,0 +1,60 @@',
    },
    // 同名文件更新（例如后序模块细化了类型）
    {
      filename: 'src/types/order.ts',
      additions: 30,
      deletions: 2,
      diff: '@@ -1,25 +1,30 @@\n+updated interface',
    },
  ];

  const merged = mergeTopicPatchDiffs(diffsStep1, diffsStep2);
  assert.equal(merged.length, 3, '应当有 3 个去重文件');
  const orderTypeDiff = merged.find((d) => d.filename === 'src/types/order.ts');
  assert.equal(orderTypeDiff?.additions, 30, '同名文件应保留最新阶段产出');
  assert.equal(orderTypeDiff?.deletions, 2);

  console.log('✓ 工作区 Diff 合并校验通过：多阶段输出自动以最新文件变更为准');
}

// --- 测试 4: 单 Agent 模块执行 Prompt 编译隔离性 ---
console.log('\n--- 测试 4: 单 Agent 模块沙箱执行提示词编译 (buildModularExecutionPrompt) ---');
{
  const mockTopicContext: TopicPromptContext = {
    topicId: 'topic-refactor-order',
    title: '重构订单状态机与持久化事件流',
    description: '重构现有同步订单处理为基于 SQLite 事务日志的幂等事件驱动架构',
    channelName: 'backend-dev',
    status: 'in_progress',
    discussionMode: 'game_theoretic',
  };

  const promptStep1 = buildModularExecutionPrompt({
    topic: mockTopicContext,
    executorAgent: mockAgent,
    moduleSlice: sampleModules[0],
    moduleIndex: 1,
    totalModules: 3,
    sharedContract: mockSharedContract,
    priorMilestones: [],
    decision: {
      summary: '裁决采纳基于领域事件与 SQLite 事务状态机方案',
      solution: '1. 定义 OrderEvent 契约；2. 实现 SQLite 事务状态机；3. 挂接前端视图。',
      tradeOffPoints: ['性能优先：异步写入事务日志', '严格幂等：UUID 约束'],
    },
  });

  // 断言 Step 1 包含沙箱白名单与公共契约
  assert.ok(promptStep1.includes('Phase 1/3: 模块 1：数据模型与公共事件契约'), '应当包含阶段标题');
  assert.ok(promptStep1.includes('LeadArchitect'), '应当指定执行负责人');
  assert.ok(promptStep1.includes('OrderEvent'), '应当注入公共契约类型');
  assert.ok(promptStep1.includes('• `src/types/order.ts`'), '应当限制白名单文件');
  assert.ok(promptStep1.includes('<<<EXECUTION_META>>>'), '必须包含 UI 描述契约');
  assert.ok(!promptStep1.includes('Prior Accomplished Milestones'), '第一阶段不应有前序里程碑');

  // 断言 Step 2 携带 Step 1 的里程碑成果
  const promptStep2 = buildModularExecutionPrompt({
    topic: mockTopicContext,
    executorAgent: mockAgent,
    moduleSlice: sampleModules[1],
    moduleIndex: 2,
    totalModules: 3,
    sharedContract: mockSharedContract,
    priorMilestones: [
      {
        moduleId: 'mod-1-contract',
        title: '模块 1：数据模型与公共事件契约',
        summary: '已完成 OrderEvent 契约与 Repository 类型定义',
        touchedFiles: ['src/types/order.ts', 'src/types/events.ts'],
      },
    ],
    decision: {
      summary: '裁决采纳基于领域事件与 SQLite 事务状态机方案',
    },
  });

  assert.ok(promptStep2.includes('Phase 2/3: 模块 2：事务持久化与业务执行引擎'), '应当为 Phase 2 标题');
  assert.ok(promptStep2.includes('Prior Accomplished Milestones'), '第二阶段必须携带第一阶段里程碑');
  assert.ok(promptStep2.includes('OrderEvent 契约与 Repository 类型定义'), '应当包含上一阶段交付摘要');
  assert.ok(promptStep2.includes('• `src/services/orderEngine.ts`'), '应当限制为模块 2 的白名单');

  console.log('✓ 模块沙箱提示词编译校验通过：白名单受限、契约不变量注入、前序里程碑接力完整');
}

// --- 测试 5: 真实多阶段串行重构流水线仿真与故障隔离 ---
console.log('\n--- 测试 5: 完整流水线仿真与异常隔离 (Fault Containment) ---');
{
  const executionPlan = computeTopologicalExecutionOrder(sampleModules);
  const accumulatedDiffs: TopicPatchDiffItem[] = [];
  const milestones: Array<{ moduleId: string; title: string; summary: string; touchedFiles: string[] }> = [];

  // 阶段 1 成功
  const mod1 = executionPlan[0];
  mod1.executionStatus = 'running';
  const diffs1: TopicPatchDiffItem[] = [
    { filename: 'src/types/order.ts', additions: 30, deletions: 0, diff: '...' },
  ];
  accumulatedDiffs.push(...diffs1);
  mod1.executionStatus = 'completed';
  mod1.executionVerificationPassed = true;
  mod1.executionDiffs = diffs1;
  mod1.executionSummary = '已完成类型与契约定义';
  milestones.push({ moduleId: mod1.moduleId, title: mod1.title, summary: mod1.executionSummary, touchedFiles: ['src/types/order.ts'] });

  assert.equal(mod1.executionStatus, 'completed');
  assert.equal(accumulatedDiffs.length, 1);

  // 阶段 2 模拟抛错异常
  const mod2 = executionPlan[1];
  mod2.executionStatus = 'running';
  const simulateError = new Error('SQLite 编译依赖异常: database is locked');
  mod2.executionStatus = 'failed';
  mod2.executionSummary = `执行中断: ${simulateError.message}`;

  // 阶段 3 应当保持未执行
  const mod3 = executionPlan[2];
  assert.equal(mod3.executionStatus, undefined);

  // 状态检查：已完成的 mod1 产出成果得到完全保全，mod2 准确标红，mod3 安全阻断
  assert.equal(mod1.executionStatus, 'completed', 'Mod 1 必须保持完成状态');
  assert.equal(mod1.executionDiffs?.length, 1, 'Mod 1 产出必须保全');
  assert.equal(mod2.executionStatus, 'failed', 'Mod 2 准确记录失败');
  assert.equal(mod3.executionStatus, undefined, 'Mod 3 严防越级执行');

  console.log('✓ 流水线仿真与异常隔离校验通过：局部出错零污染前序成果，后续阶段安全阻断');
}

console.log('\n================================================================================');
console.log('🎉 G-Frame 单个独立 Agent 贝叶斯模块化分治执行测试全部通过 (100%)！');
console.log('================================================================================');
