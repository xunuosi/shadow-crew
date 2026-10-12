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
