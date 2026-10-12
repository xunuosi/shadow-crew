import {
  BayesianModuleBelief,
  BayesianPosteriorAction,
  ModularOrchestrationState,
  ModuleComplexityLevel,
  ModuleDecompositionDraft,
  SharedInterfaceContract,
  TaskModuleSlice,
} from '../../types';

/**
 * 高风险核心技术域正则：触及并发、锁、事务、安全鉴权、数据库迁移、底层存储或沙箱执行时，先验不确定性上调
 */
const CRITICAL_DOMAIN_REGEX =
  /并发|互斥锁|死锁|事务|一致性|幂等|安全|鉴权|权限|迁移|内存泄漏|持久化|沙箱|状态机|concurrency|mutex|deadlock|transaction|idempoten|security|auth|migration|sqlite|sandbox|fsm/i;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function logit(p: number): number {
  const safeP = clamp(p, 0.01, 0.99);
  return Math.log(safeP / (1 - safeP));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * 1. 先验风险初始化方程 (Bayesian Prior Initialization)
 * P_prior(m_k) = clamp(B_level + 0.05 * max(0, |F_k| - 2) + 0.15 * I_critical(m_k), 0.10, 0.90)
 */
export function estimateModulePriorRisk(params: {
  complexityLevel: ModuleComplexityLevel;
  allowedFilesCount: number;
  responsibilityText: string;
}): {
  priorRisk: number;
  routingMode: 'fast_track' | 'deep_debate';
} {
  const baseMap: Record<ModuleComplexityLevel, number> = {
    low_deterministic: 0.20,
    medium_standard: 0.45,
    high_critical: 0.70,
  };

  const baseRisk = baseMap[params.complexityLevel] ?? 0.45;
  const fileSpreadPenalty = 0.05 * Math.max(0, params.allowedFilesCount - 2);
  const criticalDomainBonus = CRITICAL_DOMAIN_REGEX.test(params.responsibilityText) ? 0.15 : 0.0;

  const priorRisk = Number(
    clamp(baseRisk + fileSpreadPenalty + criticalDomainBonus, 0.10, 0.90).toFixed(4)
  );

  // 先验不确定性 < 0.45 走快速验证流 (fast_track)，否则走深度对抗流 (deep_debate)
  const routingMode: 'fast_track' | 'deep_debate' =
    priorRisk < 0.45 ? 'fast_track' : 'deep_debate';

  return { priorRisk, routingMode };
}

/**
 * 2. 根据阶段 0 提交的 ModuleDecompositionDraft 初始化 G-Frame 模块化分治总状态
 */
export function initializeModularOrchestrationState(
  draft: ModuleDecompositionDraft
): ModularOrchestrationState {
  const now = new Date().toISOString();

  const sharedContract: SharedInterfaceContract = {
    contractVersion: 1,
    summary: draft.sharedContract.summary.slice(0, 300),
    typeSignatures: draft.sharedContract.typeSignatures.slice(0, 1200),
    invariants: (draft.sharedContract.invariants || []).slice(0, 6),
    lockedAt: draft.submittedAt || now,
  };

  // 硬性控制模块数量在 2 ~ 4 个之间，防止碎片化
  const boundedRawModules = draft.modules.slice(0, 4);

  const modules: TaskModuleSlice[] = boundedRawModules.map((raw, idx) => {
    const { priorRisk, routingMode } = estimateModulePriorRisk({
      complexityLevel: raw.complexityLevel,
      allowedFilesCount: raw.allowedFiles.length,
      responsibilityText: `${raw.title} ${raw.responsibility}`,
    });

    const belief: BayesianModuleBelief = {
      priorRisk,
      posteriorRisk: priorRisk,
      routingMode,
      feedbackVector: {
        contractViolations: 0,
        verifiedClaims: 0,
        refutedClaims: 0,
        edgeCaseCount: 0,
        dssScore: 0,
      },
      lastUpdatedAt: now,
    };

    return {
      moduleId: raw.moduleId || `mod-${idx + 1}`,
      title: raw.title,
      responsibility: raw.responsibility,
      allowedFiles: raw.allowedFiles,
      dependsOnModuleIds: raw.dependsOn || [],
      complexityLevel: raw.complexityLevel,
      status: 'pending',
      belief,
      scopedMessageIds: [],
    };
  });

  const initialState: ModularOrchestrationState = {
    enabled: true,
    sharedContract,
    modules,
    overallEntropyReductionRatio: Number((1 - 1 / Math.max(2, modules.length)).toFixed(2)),
  };

  const firstModule = getNextSchedulableModule(initialState);
  if (firstModule) {
    firstModule.status = 'proposing';
    initialState.activeModuleId = firstModule.moduleId;
  }

  return initialState;
}

/**
 * 3. 贝叶斯后验信念更新与动态策略路由 (Posterior Belief Update & Control Policy)
 * logit(P_posterior) = logit(P_prior) + L(Γ_k)
 * L(Γ_k) = +1.20 * ContractViolations + 0.95 * RefutedClaims + 0.35 * EdgeCases - 0.80 * VerifiedClaims
 */
export function updateModuleBeliefWithFeedback(
  module: TaskModuleSlice,
  feedbackDelta: Partial<BayesianModuleBelief['feedbackVector']>
): {
  updatedModule: TaskModuleSlice;
  posteriorAction: BayesianPosteriorAction;
  reason: string;
} {
  const prevFeedback = module.belief.feedbackVector;
  const mergedFeedback: BayesianModuleBelief['feedbackVector'] = {
    contractViolations:
      feedbackDelta.contractViolations ?? prevFeedback.contractViolations,
    verifiedClaims: feedbackDelta.verifiedClaims ?? prevFeedback.verifiedClaims,
    refutedClaims: feedbackDelta.refutedClaims ?? prevFeedback.refutedClaims,
    edgeCaseCount: feedbackDelta.edgeCaseCount ?? prevFeedback.edgeCaseCount,
    dssScore: feedbackDelta.dssScore ?? prevFeedback.dssScore,
  };

  const sycophancyPenalty = Math.max(0, mergedFeedback.dssScore - 0.45) * 0.40;
  const logLikelihoodDelta =
    1.20 * mergedFeedback.contractViolations +
    0.95 * mergedFeedback.refutedClaims +
    0.35 * mergedFeedback.edgeCaseCount -
    0.80 * mergedFeedback.verifiedClaims +
    sycophancyPenalty;

  const posteriorRisk = Number(
    clamp(sigmoid(logit(module.belief.priorRisk) + logLikelihoodDelta), 0.05, 0.95).toFixed(4)
  );

  let routingMode = module.belief.routingMode;
  let nextStatus = module.status;
  let posteriorAction: BayesianPosteriorAction = 'CONTINUE_DEBATE';
  let reason = '';

  // 规则 B：原本处于 fast_track 的低风险模块若出现契约违规或后验风险跃升 >= 0.55，动态拉起红队
  if (
    routingMode === 'fast_track' &&
    (mergedFeedback.contractViolations > 0 || posteriorRisk >= 0.55)
  ) {
    routingMode = 'deep_debate';
    nextStatus = 'challenging';
    posteriorAction = 'ESCALATE_TO_RED_TEAM';
    reason = `模块 [${module.title}] 捕获异常反馈 (契约违规=${mergedFeedback.contractViolations}, 后验风险=${posteriorRisk} ≥ 0.55)，由快速通道动态升级为红队深度对抗`;
  }
  // 规则 C：存在被证伪的断言或契约冲突，锁定在当前模块沙箱内局部重修
  else if (mergedFeedback.contractViolations > 0 || mergedFeedback.refutedClaims > 0) {
    nextStatus = 'defending';
    posteriorAction = 'SCOPED_DEFENSE_REFINE';
    reason = `模块 [${module.title}] 存在未决证伪项 (证伪=${mergedFeedback.refutedClaims}, 契约违规=${mergedFeedback.contractViolations})，触发模块沙箱内局部重修`;
  }
  // 规则 A：零契约冲突、零证伪，且后验风险 <= 0.30（或已通过实证检验且无未决反例），立即冻结锁定
  else if (
    posteriorRisk <= 0.30 ||
    (routingMode === 'fast_track' && mergedFeedback.verifiedClaims >= 1) ||
    (mergedFeedback.verifiedClaims >= 2 &&
      mergedFeedback.refutedClaims === 0 &&
      mergedFeedback.contractViolations === 0)
  ) {
    nextStatus = 'frozen';
    posteriorAction = 'FREEZE_MODULE';
    reason = `模块 [${module.title}] 通过实证校验且后验风险收敛 (${posteriorRisk})，已进入 Frozen 硬冻结状态`;
  } else {
    posteriorAction = 'CONTINUE_DEBATE';
    reason = `模块 [${module.title}] 后验风险为 ${posteriorRisk}，继续当前模块沙箱推演`;
  }

  const updatedModule: TaskModuleSlice = {
    ...module,
    status: nextStatus,
    belief: {
      ...module.belief,
      posteriorRisk,
      routingMode,
      latestAction: posteriorAction,
      feedbackVector: mergedFeedback,
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  return {
    updatedModule,
    posteriorAction,
    reason,
  };
}

/**
 * 4. 基于 Module DAG 拓扑序获取下一个可调度的模块
 * 仅当某模块的所有前置依赖 dependsOnModuleIds 均已处于 'frozen' 状态时才可被激活
 */
export function getNextSchedulableModule(
  state: ModularOrchestrationState
): TaskModuleSlice | undefined {
  const frozenIds = new Set(
    state.modules.filter((m) => m.status === 'frozen').map((m) => m.moduleId)
  );
  const allModuleIds = new Set(state.modules.map((m) => m.moduleId));

  // 优先查找已经在推进中（非 pending / frozen / failed）的模块
  const activeInProgress = state.modules.find(
    (m) =>
      m.status !== 'pending' &&
      m.status !== 'frozen' &&
      m.status !== 'failed'
  );
  if (activeInProgress) {
    return activeInProgress;
  }

  // 查找所有前置依赖均已 frozen 的 pending 模块
  return state.modules.find((m) => {
    if (m.status !== 'pending') return false;
    return m.dependsOnModuleIds.every(
      (depId) => !allModuleIds.has(depId) || frozenIds.has(depId)
    );
  });
}

/**
 * 5. 推进模块化分治编排状态机：更新目标模块后验状态，若冻结则自动切换至下一拓扑模块
 */
export function advanceModularOrchestration(
  state: ModularOrchestrationState,
  targetModuleId: string,
  feedbackDelta: Partial<BayesianModuleBelief['feedbackVector']>,
  frozenSnippet?: string
): {
  nextState: ModularOrchestrationState;
  action: BayesianPosteriorAction;
  reason: string;
  allModulesFrozen: boolean;
} {
  let action: BayesianPosteriorAction = 'CONTINUE_DEBATE';
  let reason = '';

  const updatedModules = state.modules.map((m) => {
    if (m.moduleId !== targetModuleId) return m;
    const res = updateModuleBeliefWithFeedback(m, feedbackDelta);
    action = res.posteriorAction;
    reason = res.reason;
    if (res.updatedModule.status === 'frozen' && frozenSnippet) {
      res.updatedModule.frozenProposalSnippet = frozenSnippet.slice(0, 800);
    }
    return res.updatedModule;
  });

  const nextState: ModularOrchestrationState = {
    ...state,
    modules: updatedModules,
  };

  const allModulesFrozen = nextState.modules.every((m) => m.status === 'frozen');

  if (allModulesFrozen) {
    nextState.activeModuleId = undefined;
  } else {
    const nextSchedulable = getNextSchedulableModule(nextState);
    if (nextSchedulable) {
      if (nextSchedulable.status === 'pending') {
        nextSchedulable.status = 'proposing';
      }
      nextState.activeModuleId = nextSchedulable.moduleId;
    }
  }

  return {
    nextState,
    action,
    reason,
    allModulesFrozen,
  };
}

/**
 * 6. 量化模块级上下文隔离带来的信息熵/Token 压缩比
 */
export function computeEntropyReductionRatio(
  totalTopicChars: number,
  scopedModuleChars: number,
  sharedContractChars: number
): number {
  if (totalTopicChars <= 0) return 0;
  const activePayload = scopedModuleChars + sharedContractChars;
  if (activePayload >= totalTopicChars) return 0;
  return Number(clamp(1 - activePayload / totalTopicChars, 0, 0.95).toFixed(4));
}

/**
 * 7. 当提案官未显式调用 MCP 拆解工具时，基于议题语义生成确定性的 3 模块正交分治契约
 * 保证任何复杂研发议题均可无缝进入 G-Frame 模块化隔离沙箱
 */
export function buildDefaultDecompositionFromTopic(
  topicTitle: string,
  topicDescription: string = ''
): ModuleDecompositionDraft {
  const combined = `${topicTitle} ${topicDescription}`;
  const isCriticalCore = CRITICAL_DOMAIN_REGEX.test(combined);

  return {
    sharedContract: {
      summary: `围绕「${topicTitle.slice(0, 60)}」建立跨模块强类型边界契约，确保数据模型、核心服务与视图层解耦。`,
      typeSignatures: `// Shared Interface Contract (Read-Only across all Module Sandboxes)\nexport interface ModuleContractContext {\n  readonly topicScope: string;\n  readonly version: number;\n}`,
      invariants: [
        '各模块仅允许读写自身 allowedFiles 白名单内的文件，禁止跨模块越界修改',
        '下游模块必须严格消费《公共接口契约》中的类型签名，禁止私自重命名跨模块字段',
      ],
    },
    modules: [
      {
        moduleId: 'mod-1-contract-schema',
        title: '模块 1：数据结构与接口契约层',
        responsibility: `定义「${topicTitle.slice(0, 30)}」所需的核心数据结构、类型接口与常量边界`,
        allowedFiles: ['src/types.ts'],
        dependsOn: [],
        complexityLevel: 'low_deterministic',
      },
      {
        moduleId: 'mod-2-core-engine',
        title: '模块 2：核心业务与状态控制引擎',
        responsibility: `实现「${topicTitle.slice(0, 30)}」的核心状态流转、并发控制与纯函数逻辑`,
        allowedFiles: ['src/services/cogno/', 'src/services/agentCollaboration.ts'],
        dependsOn: ['mod-1-contract-schema'],
        complexityLevel: isCriticalCore ? 'high_critical' : 'medium_standard',
      },
      {
        moduleId: 'mod-3-ui-integration',
        title: '模块 3：视图组件接入与交互闭环',
        responsibility: `绑定状态看板与用户交互入口，确保双主题高对比度渲染与零横向溢出`,
        allowedFiles: ['src/components/TopicThreadDrawer.tsx', 'src/components/LivingAdrCanvas.tsx'],
        dependsOn: ['mod-1-contract-schema', 'mod-2-core-engine'],
        complexityLevel: 'low_deterministic',
      },
    ],
    submittedBy: 'system-gframe-initializer',
    submittedAt: new Date().toISOString(),
  };
}
