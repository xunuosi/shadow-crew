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
 * 高风险核心域正则：同时覆盖软件工程高危域（并发、锁、事务、鉴权、迁移）与通用业务高危域（资损、合规、法务、隐私、现金流、赔付、违约、不可逆决策）
 */
const CRITICAL_DOMAIN_REGEX =
  /并发|互斥锁|死锁|事务|一致性|幂等|安全|鉴权|权限|迁移|内存泄漏|持久化|沙箱|状态机|资损|合规|法律|法务|隐私|资金|账务|现金流|赔付|违约|垄断|不可逆|concurrency|mutex|deadlock|transaction|idempoten|security|auth|migration|sqlite|sandbox|fsm|compliance|financial|privacy|liability/i;

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
 * 1.5 模块依赖有向无环图 (DAG) 成环检测与破环守卫 (EDGE-03)
 * 采用三色 DFS (0=未访问, 1=递归栈访问中, 2=已完成) 剥离自依赖、无效依赖与成环回边，
 * 确保至少存在一个无前置依赖的拓扑根节点，杜绝 M1⇄M2 互锁导致的静默死锁。
 */
export function sanitizeModuleDependencyDAG(modules: TaskModuleSlice[]): TaskModuleSlice[] {
  const validIds = new Set(modules.map((m) => m.moduleId));
  const depMap = new Map<string, string[]>();

  for (const mod of modules) {
    const cleanDeps = Array.from(
      new Set(
        (mod.dependsOnModuleIds || []).filter(
          (depId) => depId && depId !== mod.moduleId && validIds.has(depId)
        )
      )
    );
    depMap.set(mod.moduleId, cleanDeps);
  }

  const color = new Map<string, 0 | 1 | 2>();
  for (const mod of modules) {
    color.set(mod.moduleId, 0);
  }

  function dfs(moduleId: string): void {
    color.set(moduleId, 1);
    const deps = depMap.get(moduleId) || [];
    const acyclicDeps: string[] = [];

    for (const depId of deps) {
      const depColor = color.get(depId) ?? 0;
      if (depColor === 1) {
        // 命中成环回边 (Back-Edge)：剥离该反向依赖边以恢复 DAG 拓扑序
        continue;
      }
      if (depColor === 0) {
        dfs(depId);
      }
      acyclicDeps.push(depId);
    }

    depMap.set(moduleId, acyclicDeps);
    color.set(moduleId, 2);
  }

  // 逆序遍历下游模块优先入栈，确保当 M1⇄M2 成环时优先剥离上游 M1 对下游 M2 的反向依赖，使 M1 成为拓扑根节点
  for (let i = modules.length - 1; i >= 0; i--) {
    const modId = modules[i].moduleId;
    if ((color.get(modId) ?? 0) === 0) {
      dfs(modId);
    }
  }

  const sanitized = modules.map((mod) => ({
    ...mod,
    dependsOnModuleIds: depMap.get(mod.moduleId) || [],
  }));

  if (sanitized.length > 0 && !sanitized.some((m) => m.dependsOnModuleIds.length === 0)) {
    sanitized[0] = {
      ...sanitized[0],
      dependsOnModuleIds: [],
    };
  }

  return sanitized;
}

export interface BeliefUpdateOptions {
  /** 是否在本次更新中清零已修复的历史证伪项（例如答辩补丁经实证核验通过） */
  resolveRefutedClaims?: boolean;
  /** 是否在本次更新中清零已修复的历史契约违规项 */
  resolveContractViolations?: boolean;
  /** 是否允许在本次更新中触发 FREEZE_MODULE（例如 verification 阶段仅记账而不提前冻结，留待 defense 阶段闭环冻结） */
  allowFreeze?: boolean;
  /** 是否为模块答辩阶段完成点（若零违规且零未决证伪则允许收敛冻结） */
  isDefenseCompletion?: boolean;
  /** 是否在达到局部重修上限后强制收敛冻结（防止死循环） */
  forceFreeze?: boolean;
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

  // 硬性控制模块数量在 2 ~ 4 个之间，防止退化为单模块或过度碎片化 (EDGE-02)
  const rawList = Array.isArray(draft.modules) ? [...draft.modules] : [];
  if (rawList.length === 0) {
    rawList.push(
      {
        moduleId: 'mod-1-core',
        title: '模块 1：核心方案与主体逻辑架构',
        responsibility: '围绕议题核心诉求制定主干执行方案、核心机制与关键状态流转规则',
        allowedFiles: [],
        dependsOn: [],
        complexityLevel: 'medium_standard',
      },
      {
        moduleId: 'mod-2-guard',
        title: '模块 2：边界风险防控与落地验收闭环',
        responsibility: '针对主方案开展极端边界反例压测、异常降级回退与可量化验收标准核验',
        allowedFiles: [],
        dependsOn: ['mod-1-core'],
        complexityLevel: 'low_deterministic',
      }
    );
  } else if (rawList.length === 1) {
    const first = rawList[0];
    const firstId = first.moduleId || 'mod-1';
    rawList[0] = { ...first, moduleId: firstId };
    rawList.push({
      moduleId: `${firstId}-guard`,
      title: '模块 2：边界风险防控与落地验收闭环',
      responsibility: `围绕「${first.title}」开展极端边界反例压测、异常回退机制与落地验收指标核验`,
      allowedFiles: [],
      dependsOn: [firstId],
      complexityLevel: 'low_deterministic',
    });
  }
  const boundedRawModules = rawList.slice(0, 4);

  // 跨模块白名单去重（保障 F_i ∩ F_j = ∅，上游声明模块独占其白名单文件，EDGE-04）
  const claimedFiles = new Set<string>();

  const rawModules: TaskModuleSlice[] = boundedRawModules.map((raw, idx) => {
    const rawFiles = Array.isArray(raw.allowedFiles) ? raw.allowedFiles : [];
    const exclusiveFiles: string[] = [];
    for (const f of rawFiles) {
      const clean = f.trim();
      if (clean && !claimedFiles.has(clean)) {
        claimedFiles.add(clean);
        exclusiveFiles.push(clean);
      }
    }

    const { priorRisk, routingMode } = estimateModulePriorRisk({
      complexityLevel: raw.complexityLevel,
      allowedFilesCount: exclusiveFiles.length,
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
      allowedFiles: exclusiveFiles,
      dependsOnModuleIds: raw.dependsOn || [],
      complexityLevel: raw.complexityLevel,
      status: 'pending',
      belief,
      scopedMessageIds: [],
    };
  });

  // 执行 DAG 拓扑破环消毒 (EDGE-03)
  const modules = sanitizeModuleDependencyDAG(rawModules);

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
  feedbackDelta: Partial<BayesianModuleBelief['feedbackVector']>,
  options?: BeliefUpdateOptions
): {
  updatedModule: TaskModuleSlice;
  posteriorAction: BayesianPosteriorAction;
  reason: string;
} {
  const prevFeedback = module.belief.feedbackVector;
  const allowFreeze = options?.allowFreeze ?? true;
  const baseContractViolations = options?.resolveContractViolations
    ? 0
    : prevFeedback.contractViolations;
  const baseRefutedClaims = options?.resolveRefutedClaims
    ? 0
    : prevFeedback.refutedClaims;

  // 严格按增量 (Delta) 累加计数型反馈指标，杜绝绝对值覆盖丢失历史计数 (EDGE-05)
  const mergedFeedback: BayesianModuleBelief['feedbackVector'] = {
    contractViolations: Math.max(
      0,
      baseContractViolations + (feedbackDelta.contractViolations ?? 0)
    ),
    verifiedClaims: Math.max(
      0,
      prevFeedback.verifiedClaims + (feedbackDelta.verifiedClaims ?? 0)
    ),
    refutedClaims: Math.max(
      0,
      baseRefutedClaims + (feedbackDelta.refutedClaims ?? 0)
    ),
    edgeCaseCount: Math.max(
      0,
      prevFeedback.edgeCaseCount + (feedbackDelta.edgeCaseCount ?? 0)
    ),
    dssScore:
      feedbackDelta.dssScore !== undefined
        ? clamp(feedbackDelta.dssScore, 0, 1)
        : prevFeedback.dssScore,
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

  const canFreezeByEvidence =
    posteriorRisk <= 0.30 ||
    (routingMode === 'fast_track' && mergedFeedback.verifiedClaims >= 1) ||
    (mergedFeedback.verifiedClaims >= 2 &&
      mergedFeedback.refutedClaims === 0 &&
      mergedFeedback.contractViolations === 0) ||
    (Boolean(options?.isDefenseCompletion) &&
      mergedFeedback.verifiedClaims >= 1 &&
      mergedFeedback.refutedClaims === 0 &&
      mergedFeedback.contractViolations === 0) ||
    Boolean(options?.forceFreeze);

  if (options?.forceFreeze && allowFreeze) {
    nextStatus = 'frozen';
    posteriorAction = 'FREEZE_MODULE';
    reason = `模块 [${module.title}] 已完成有界局部重修闭环 (后验风险=${posteriorRisk})，进入 Frozen 硬冻结状态`;
  }
  // 规则 B：原本处于 fast_track 的低风险模块若出现契约违规或后验风险跃升 >= 0.55，动态拉起红队
  else if (
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
  else if (canFreezeByEvidence) {
    if (allowFreeze) {
      nextStatus = 'frozen';
      posteriorAction = 'FREEZE_MODULE';
      reason = `模块 [${module.title}] 通过实证校验且后验风险收敛 (${posteriorRisk})，已进入 Frozen 硬冻结状态`;
    } else {
      nextStatus = 'defending';
      posteriorAction = 'CONTINUE_DEBATE';
      reason = `模块 [${module.title}] 实证校验通过 (后验风险=${posteriorRisk})，转入当前模块答辩定稿阶段`;
    }
  } else {
    if (!allowFreeze && nextStatus === 'proposing') {
      nextStatus = 'verifying';
    }
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
  const readyPending = state.modules.find((m) => {
    if (m.status !== 'pending') return false;
    return m.dependsOnModuleIds.every(
      (depId) => !allModuleIds.has(depId) || frozenIds.has(depId)
    );
  });
  if (readyPending) {
    return readyPending;
  }

  // 破环兜底守卫 (EDGE-03)：若仍存在 pending 模块但因外部环形依赖导致无就绪节点，
  // 选取未冻结依赖数最少的首个 pending 模块解锁激活，杜绝 activeModuleId=undefined 静默死锁
  const pendingModules = state.modules.filter((m) => m.status === 'pending');
  if (pendingModules.length > 0) {
    return [...pendingModules].sort((a, b) => {
      const aUnfrozen = a.dependsOnModuleIds.filter(
        (d) => allModuleIds.has(d) && !frozenIds.has(d)
      ).length;
      const bUnfrozen = b.dependsOnModuleIds.filter(
        (d) => allModuleIds.has(d) && !frozenIds.has(d)
      ).length;
      return aUnfrozen - bUnfrozen;
    })[0];
  }

  return undefined;
}

/**
 * 5. 推进模块化分治编排状态机：更新目标模块后验状态，若冻结则自动切换至下一拓扑模块
 */
export function advanceModularOrchestration(
  state: ModularOrchestrationState,
  targetModuleId: string,
  feedbackDelta: Partial<BayesianModuleBelief['feedbackVector']>,
  frozenSnippet?: string,
  options?: BeliefUpdateOptions
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
    const res = updateModuleBeliefWithFeedback(m, feedbackDelta, options);
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

export interface ModularStageTransitionInput {
  state: ModularOrchestrationState;
  currentStage: 'challenge' | 'verification' | 'defense';
  feedbackDelta: Partial<BayesianModuleBelief['feedbackVector']>;
  proposalOrDefenseSnippet?: string;
  /** 当前模块已执行的局部重修轮次 (默认 0，上限 1) */
  currentModuleRefineCount?: number;
}

export interface ModularStageTransitionResult {
  nextState: ModularOrchestrationState;
  posteriorAction: BayesianPosteriorAction;
  reason: string;
  nextGameStage: 'challenge' | 'verification' | 'defense' | 'arbitration';
  allModulesFrozen: boolean;
  frozenModuleId?: string;
  activeModuleId?: string;
  triggeredScopedRefine: boolean;
}

/**
 * 5.5 多模块闭环阶段流转控制器 (E2E-03 & EDGE-06)
 * 保障每个模块严格经历完整生命周期：
 * - verification 阶段仅记录当前模块实证计数，严禁越级冻结或切走 activeModuleId；
 * - defense 阶段根据真实实证与越界计数触发 SCOPED_DEFENSE_REFINE（有界回边重修）或 FREEZE_MODULE；
 * - 当前模块冻结后若仍有未冻结模块 (!allModulesFrozen)，自动激活下一拓扑模块并回环至 challenge 阶段，直至 N/N 全部冻结后方进入 arbitration。
 */
export function stepModularStageTransition(
  input: ModularStageTransitionInput
): ModularStageTransitionResult {
  const {
    state,
    currentStage,
    feedbackDelta,
    proposalOrDefenseSnippet,
    currentModuleRefineCount = 0,
  } = input;

  const targetModuleId =
    state.activeModuleId || getNextSchedulableModule(state)?.moduleId;

  if (!targetModuleId) {
    return {
      nextState: state,
      posteriorAction: 'FREEZE_MODULE',
      reason: '所有模块均已处于冻结终态',
      nextGameStage: 'arbitration',
      allModulesFrozen: true,
      activeModuleId: undefined,
      triggeredScopedRefine: false,
    };
  }

  if (currentStage === 'challenge') {
    const adv = advanceModularOrchestration(
      state,
      targetModuleId,
      feedbackDelta,
      undefined,
      { allowFreeze: false }
    );
    return {
      nextState: adv.nextState,
      posteriorAction: adv.action,
      reason: adv.reason,
      nextGameStage: 'verification',
      allModulesFrozen: false,
      activeModuleId: adv.nextState.activeModuleId,
      triggeredScopedRefine: false,
    };
  }

  if (currentStage === 'verification') {
    // 若当前模块处于局部重修轮次且本次验证全数通过 (refutedClaims === 0 && verifiedClaims > 0)，清零上一轮遗留证伪计数
    const resolvedInReverify =
      currentModuleRefineCount > 0 &&
      (feedbackDelta.refutedClaims ?? 0) === 0 &&
      (feedbackDelta.verifiedClaims ?? 0) > 0;

    const adv = advanceModularOrchestration(
      state,
      targetModuleId,
      feedbackDelta,
      undefined,
      {
        allowFreeze: false,
        resolveRefutedClaims: resolvedInReverify,
        resolveContractViolations: resolvedInReverify,
      }
    );
    return {
      nextState: adv.nextState,
      posteriorAction: adv.action,
      reason: adv.reason,
      nextGameStage: 'defense',
      allModulesFrozen: false,
      activeModuleId: adv.nextState.activeModuleId,
      triggeredScopedRefine: false,
    };
  }

  // currentStage === 'defense'
  const reachedRefineLimit = currentModuleRefineCount >= 1;
  const adv = advanceModularOrchestration(
    state,
    targetModuleId,
    feedbackDelta,
    proposalOrDefenseSnippet,
    {
      allowFreeze: true,
      isDefenseCompletion: true,
      resolveRefutedClaims: reachedRefineLimit,
      resolveContractViolations: reachedRefineLimit,
      forceFreeze: reachedRefineLimit,
    }
  );

  // 规则 B / 规则 C：当前模块存在未决证伪或越界违规，且未达单模块重修上限 -> 锁定当前模块回环重修
  if (
    (adv.action === 'SCOPED_DEFENSE_REFINE' ||
      adv.action === 'ESCALATE_TO_RED_TEAM') &&
    !reachedRefineLimit
  ) {
    return {
      nextState: adv.nextState,
      posteriorAction: adv.action,
      reason: adv.reason,
      nextGameStage: 'challenge',
      allModulesFrozen: false,
      activeModuleId: targetModuleId,
      triggeredScopedRefine: true,
    };
  }

  // 当前模块已收敛冻结，但仍有后续拓扑模块未冻结 -> 切换至下一模块并从 challenge 阶段启动
  if (!adv.allModulesFrozen) {
    return {
      nextState: adv.nextState,
      posteriorAction: adv.action,
      reason: adv.reason,
      nextGameStage: 'challenge',
      allModulesFrozen: false,
      frozenModuleId:
        adv.action === 'FREEZE_MODULE' ? targetModuleId : undefined,
      activeModuleId: adv.nextState.activeModuleId,
      triggeredScopedRefine: false,
    };
  }

  // 所有模块 (N/N) 均已冻结 -> 正式进入终局仲裁 (arbitration)
  return {
    nextState: adv.nextState,
    posteriorAction: adv.action,
    reason: adv.reason,
    nextGameStage: 'arbitration',
    allModulesFrozen: true,
    frozenModuleId: targetModuleId,
    activeModuleId: undefined,
    triggeredScopedRefine: false,
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
 * 7. 当提案官未显式调用 MCP 拆解工具时，基于议题与提案语义动态生成领域无关（Domain-Agnostic）的正交分治契约
 * - 严禁硬编码任何特定代码文件路径（如 src/types.ts 等），确保非研发类（商业策略、产品规划、运营风控等）与研发类任务均可自适应分治
 * - 若提案文本或议题描述中已包含结构化小节标题，则优先提取真实业务子模块；否则按「目标与边界共识 -> 核心机制与路径 -> 风险防控与落地」三元正交维度拆解
 */
export function buildDefaultDecompositionFromTopic(
  topicTitle: string,
  topicDescription: string = '',
  proposalText: string = ''
): ModuleDecompositionDraft {
  const combined = `${topicTitle}\n${topicDescription}\n${proposalText}`;
  const isCriticalCore = CRITICAL_DOMAIN_REGEX.test(combined);

  // 仅当议题或提案正文中真实出现了明确的文件路径时，才提取为关联文件，绝不凭空硬编码项目源码路径
  const mentionedFiles = Array.from(
    new Set(
      (combined.match(/(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+/g) || []).slice(0, 6)
    )
  );

  // 尝试从提案或描述的 Markdown 标题 / 编号段落中提取真实业务子模块 (2~4 个)
  const headingMatches = Array.from(
    combined.matchAll(/(?:^|\n)\s*(?:#{2,3}\s+|(?:[一二三四1-4][、.)）])\s*)([^\n:：]{4,36})/g)
  )
    .map((m) => m[1].trim().replace(/\*+/g, ''))
    .filter((t) => t.length >= 4 && !/^(背景|总结|综述|结论|附录)/.test(t));

  const uniqueHeadings = Array.from(new Set(headingMatches)).slice(0, 4);

  const dynamicModules =
    uniqueHeadings.length >= 2
      ? uniqueHeadings.map((heading, idx) => {
          const isHighRisk = CRITICAL_DOMAIN_REGEX.test(heading) || (idx === 1 && isCriticalCore);
          return {
            moduleId: `mod-${idx + 1}`,
            title: `模块 ${idx + 1}：${heading}`,
            responsibility: `聚焦「${heading}」维度的方案推演、边界校验与可行性论证`,
            allowedFiles: idx === 0 ? mentionedFiles.slice(0, 2) : idx === 1 ? mentionedFiles.slice(2, 4) : mentionedFiles.slice(4, 6),
            dependsOn: idx === 0 ? [] : [`mod-${idx}`],
            complexityLevel: (isHighRisk
              ? 'high_critical'
              : idx === 0
              ? 'low_deterministic'
              : 'medium_standard') as ModuleComplexityLevel,
          };
        })
      : [
          {
            moduleId: 'mod-1-boundary',
            title: '模块 1：核心目标定义与前提边界共识',
            responsibility: `明确「${topicTitle.slice(0, 36)}」的业务/系统边界、核心衡量指标与前置假设约束`,
            allowedFiles: mentionedFiles.slice(0, 2),
            dependsOn: [],
            complexityLevel: 'low_deterministic' as ModuleComplexityLevel,
          },
          {
            moduleId: 'mod-2-mechanism',
            title: '模块 2：核心方案机制与关键执行路径',
            responsibility: `推演「${topicTitle.slice(0, 36)}」的主体方案设计、资源分配或关键流转机制`,
            allowedFiles: mentionedFiles.slice(2, 4),
            dependsOn: ['mod-1-boundary'],
            complexityLevel: (isCriticalCore ? 'high_critical' : 'medium_standard') as ModuleComplexityLevel,
          },
          {
            moduleId: 'mod-3-governance',
            title: '模块 3：边界风险防控与落地验收标准',
            responsibility: `针对极端异常场景制定容错降级、合规风控兜底方案与量化验收标准`,
            allowedFiles: mentionedFiles.slice(4, 6),
            dependsOn: ['mod-1-boundary', 'mod-2-mechanism'],
            complexityLevel: 'low_deterministic' as ModuleComplexityLevel,
          },
        ];

  return {
    sharedContract: {
      summary: `围绕「${topicTitle.slice(0, 60)}」建立跨模块统一目标边界与核心假设契约，确保各子模块推演互不越界、逻辑自洽。`,
      typeSignatures: '',
      invariants: [
        '各模块沙箱仅聚焦自身单一职责边界，禁止偏离议题核心目标或越界推翻上游已冻结共识',
        '所有模块的方案推演必须满足全局前置假设与核心指标约束，保持跨模块输入输出口径一致',
      ],
    },
    modules: dynamicModules,
    submittedBy: 'system-gframe-initializer',
    submittedAt: new Date().toISOString(),
  };
}
