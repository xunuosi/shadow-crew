/**
 * Types for Shinobi Multi-Agent Platform (Fused with Buzz, Codex, and Antigravity)
 */

export type AcpTransport = 'stdio' | 'websocket' | 'http_sse';

export type AcpAvailabilityStatus = 'available' | 'not_adapted' | 'not_installed';

export interface LocalAcpRuntime {
  id: string;
  name: string;
  description: string;
  transport: AcpTransport;
  command: string;
  default_args?: string[];
  underlying_cli?: string | null;
  availability: AcpAvailabilityStatus;
  binary_path?: string | null;
  install_hint: string;
  install_url?: string | null;
  recommended_env?: Array<[string, string]>;
}

export interface AgentRuntimeStatus {
  agent_id: string;
  pid: number;
  is_alive: boolean;
  is_initialized: boolean;
  auth_state: 'ok' | 'auth_required' | 'missing_key' | 'unknown';
  status: 'running' | 'auth_required' | 'starting' | 'error' | 'idle';
  status_detail?: string | null;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  type: 'builtin' | 'mcp' | 'client_delegated';
  mcpServer?: string;
  commandSnippet?: string;
}

export interface MemoryCartridgeItem {
  id: string;
  category: 'user_preference' | 'codebase_pattern' | 'incident_history' | 'skill_rule' | string;
  key: string;
  content: string;
  importance?: number;
  created_at?: string;
}

export interface MemoryCartridge {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  tags: string[];
  isEnabled: boolean;
  totalRecords: number;
  importedAt: string;
  memories: MemoryCartridgeItem[];
}

export interface AcpMemoryBundle {
  manifest: {
    format_version: string;
    exported_at: string;
    source_agent: {
      name: string;
      model?: string;
      role?: string;
    };
    checksum: string;
  };
  metadata: {
    description: string;
    total_records: number;
    tags: string[];
  };
  memories: MemoryCartridgeItem[];
}

export interface AgentMemoryBank {
  internalMemoryPath: string;
  persistentType: 'sqlite' | 'markdown_bank' | 'vector_store' | 'mem0';
  persistentItems: Array<{
    id: string;
    category: 'user_preference' | 'codebase_pattern' | 'incident_history' | 'skill_rule';
    key: string;
    content: string;
    lastAccessed: string;
  }>;
  cartridges?: MemoryCartridge[];
  sessionCacheCount: number;
}

export type ModelProviderType = 'openai_compatible' | 'deepseek' | 'anthropic' | 'ollama' | 'custom';

export interface AgentModelConfig {
  provider: ModelProviderType;
  modelId: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  useGlobalDefault?: boolean;
  lastTestedAt?: number;
  lastLatencyMs?: number;
  isHealthy?: boolean;
  lastError?: string;
}

export interface AgentWorkspaceConfig {
  rootPath: string;
  repoName: string;
  gitBranch: string;
  permissionMode: 'full_read_write' | 'read_only' | 'sandbox_diff_only';
  activeFiles: string[];
}

export interface Agent {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  role: string;
  description: string;
  color: string;
  status:
    | 'idle'
    | 'starting'
    | 'running'
    | 'auth_required'
    | 'error'
    | 'thinking'
    | 'using_skill'
    | 'accessing_workspace'
    | 'querying_memory';
  statusDetail?: string;
  modelBadge?: string; // e.g., 'DeepSeek V3', 'Claude 3.7 Sonnet', 'Gemini 2.5 Pro'
  modelConfig?: AgentModelConfig;
  modelLatencyMs?: number;
  isModelHealthy?: boolean;
  isManagedByYou?: boolean;
  baselineSycophancyScore?: number; // BSS 静态历史附和分 (0.0~1.0, P0-4)
  
  // ACP Protocol Config
  acpTransport: AcpTransport;
  acpCommandOrUrl: string;
  protocolVersion: string;
  capabilities: {
    canUseInternalMemory: boolean;
    canAccessWorkspaceFiles: boolean;
    canExecuteSkills: boolean;
    canDelegateToSubAgents: boolean;
    supportsStreaming: boolean;
  };

  // Local ACP Profile & Environment Variables (ENV)
  localAcpProfile?: string;
  envVars?: Array<{ key: string; value: string }>;
  tags?: string[];
  
  // Remote & Guest Clone Attributes
  isRemote?: boolean;
  remoteUrl?: string;
  authToken?: string;
  remoteLatencyMs?: number;
  readOnlyGuard?: boolean;
  isGuestClone?: boolean;
  guestCloneFrom?: string;

  // Three Core Pillars
  workspace: AgentWorkspaceConfig;
  skills: AgentSkill[];
  memory: AgentMemoryBank;
  
  isJoinedCurrentRoom?: boolean;
}

export type AgentExecutionStatus = 'queued' | 'thinking' | 'accessing_workspace' | 'querying_memory' | 'streaming';

export interface ActiveAgentExecution {
  agentId: string;
  agentName: string;
  agentAvatar: string;
  threadId: string;
  topicId?: string;
  status: AgentExecutionStatus;
  currentActionDetail?: string; // e.g. "正在检索本地工作区 src/App.tsx..."
  startedAt: number; // timestamp
  cascadeHop?: number; // 协同链跳数 (1, 2, 3...)
  invokingAgentName?: string; // 哪个 Agent 呼叫该 Agent 协同
}

export interface CollaborationInfo {
  cascadeId: string;
  hop: number;
  maxHops: number;
  invokedByAgentId?: string;
  invokedByAgentName?: string;
  invokedByAgentHandle?: string;
  isCircuitBroken?: boolean;
  circuitBreakReason?: string;
}

// 自由编队 Agent Team
export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentIds: string[];
  color: string;
}

// L0 项目实体 (顶级工作空间边界)
export interface Project {
  id: string;
  name: string;
  description: string;
  repoUrl?: string;
  localWorkspaceRoot: string;
  assignedAgentIds: string[];
  createdAt: number;
}

export type ChannelKind = 'feature' | 'requirement' | 'task';
export type ChannelStatus = 'active' | 'archived' | 'deleted';

// L1 功能/需求/任务 频道
export interface Channel {
  id: string;
  projectId: string;
  creatorId: string; // 拥有者与删除权限人
  name: string;
  kind: ChannelKind;
  status: ChannelStatus;
  description: string;
  topic?: string;
  isPrivate: boolean; // 默认受邀准入 (true)
  iconName: string;
  unreadCount: number;
  assignedTeamId?: string;
  assignedAgentIds: string[];
  memberIds: string[]; // 频道成员列表 (默认初始仅为 [creatorId])
  gitBranch?: string;
  createdAt?: number;
  deletedAt?: number;
  mountedWorkspace?: {
    rootPath?: string;
    repoName?: string;
    gitBranch?: string;
  };
}

// PRD 规范：Topic 议题状态与共识决策记录
export type TopicStatus = 'open' | 'investigating' | 'resolved';

export type DiscussionMode = 'standard' | 'game_theoretic';

export type GameRoleType = 'proposer' | 'challenger' | 'verifier' | 'arbiter';

export type GameTheoreticStage = 'decomposition' | 'proposal' | 'challenge' | 'verification' | 'defense' | 'arbitration' | 'concluded' | 'stageFailed';

/**
 * G-Frame 跨模块只读公共接口契约 (Shared Interface Contract)
 * 用于在模块上下文物理隔离的同时保证跨模块接口 100% 严丝合缝
 */
export interface SharedInterfaceContract {
  contractVersion: number;
  summary: string;                  // 核心架构边界简述 (≤ 150 字)
  typeSignatures: string;           // 跨模块共享的 TypeScript Interface / Rust Struct / API 签名定义
  invariants: string[];             // 全局不可违背的不变量约束
  lockedAt: string;
}

export type ModuleComplexityLevel = 'low_deterministic' | 'medium_standard' | 'high_critical';

export type BayesianPosteriorAction =
  | 'FREEZE_MODULE'
  | 'ESCALATE_TO_RED_TEAM'
  | 'SCOPED_DEFENSE_REFINE'
  | 'CONTINUE_DEBATE';

/**
 * G-Frame 贝叶斯模块风险信念与实时反馈状态 (Bayesian Module Belief State)
 */
export interface BayesianModuleBelief {
  priorRisk: number;                // 先验不确定性/风险概率 P_prior ∈ [0.05, 0.95]
  posteriorRisk: number;            // 后验更新后风险概率 P_posterior ∈ [0.05, 0.95]
  routingMode: 'fast_track' | 'deep_debate'; // 贝叶斯路由模式：快速验证通道 vs 深度红队对抗
  latestAction?: BayesianPosteriorAction;
  feedbackVector: {                 // 实时捕获的反馈信号向量 Γ_k
    contractViolations: number;     // 违反公共接口契约或越界修改文件次数
    verifiedClaims: number;         // 已通过物理接地验证的断言数
    refutedClaims: number;          // 被证伪的断言数
    edgeCaseCount: number;          // 红队挖掘的极端边界反例数
    dssScore: number;               // 模块内动态谄媚分
  };
  lastUpdatedAt: string;
}

/**
 * G-Frame 单一职责原子模块切片 (Task Module Slice)
 */
export interface TaskModuleSlice {
  moduleId: string;                 // 模块唯一标识，如 "mod-1-schema", "mod-2-engine"
  title: string;                    // 模块名称，如 "模块 1：核心类型与状态契约定义"
  responsibility: string;           // 单一职责边界说明
  allowedFiles: string[];           // 本模块允许读写的文件路径白名单 (爆炸半径硬约束)
  dependsOnModuleIds: string[];     // 依赖的上游模块 ID 列表 (构成 Module DAG)
  complexityLevel: ModuleComplexityLevel;
  status: 'pending' | 'proposing' | 'challenging' | 'verifying' | 'defending' | 'frozen' | 'failed';
  belief: BayesianModuleBelief;     // 贝叶斯先验-反馈-后验状态
  scopedMessageIds: string[];       // 物理隔离：仅属于本模块沙箱的消息 ID 集合
  frozenProposalSnippet?: string;   // 模块冻结定案后的最终方案摘要/契约实现
  assignedExecutorId?: string;      // 落地阶段指派给本模块的专职执行 Agent ID
  executionVerificationPassed?: boolean; // 执行期本模块静态检查/单测是否通过
}

/**
 * 由提案官在阶段 0 通过 MCP 工具 `submit_module_decomposition` 提交的结构化拆解载荷
 */
export interface ModuleDecompositionDraft {
  sharedContract: {
    summary: string;
    typeSignatures: string;
    invariants: string[];
  };
  modules: Array<{
    moduleId: string;
    title: string;
    responsibility: string;
    allowedFiles: string[];
    dependsOn: string[];
    complexityLevel: ModuleComplexityLevel;
  }>;
  submittedBy?: string;
  submittedAt?: string;
}

export interface WhitelistDeduplicationRecord {
  file: string;
  allocatedToModuleId: string;
  allocatedToModuleTitle: string;
  strippedFromModuleId: string;
  strippedFromModuleTitle: string;
  reason: string;
}

/**
 * G-Frame 模块化分治编排总状态
 */
export interface ModularOrchestrationState {
  enabled: boolean;                 // 是否启用 G-Frame 模块化隔离分治
  sharedContract?: SharedInterfaceContract;
  modules: TaskModuleSlice[];       // K 个原子模块切片 (2 ≤ K ≤ 4)
  activeModuleId?: string;          // 当前正在推演或聚焦的模块沙箱 ID
  overallEntropyReductionRatio?: number; // 相比全量上下文的 Token/信息熵压缩比 (0~1)
  whitelistDeduplications?: WhitelistDeduplicationRecord[]; // 白名单拓扑偏序收敛与去重审计记录 (N5)
}

export interface TopicPatchDiffItem {
  filename: string;
  additions: number;
  deletions: number;
  diff: string;
  codeContent?: string;
  applied?: boolean;
  appliedMode?: 'git_apply' | 'block_replace' | 'created_file' | 'artifact_saved' | 'workspace_memory';
  targetPath?: string;
}

export interface TopicExecutionUiMeta {
  /** ADR 第 5 节及抽屉栏的动态主标题（由执行 Agent 根据实际任务性质命名） */
  sectionTitle: string;
  /** 主时间轴卡片落地舱短标签（如："🛠️ 幂等锁补丁交付"、"📄 规范文档落盘"、"📋 排查执行预案"） */
  podTitle: string;
  /** 一句话交付摘要（直接展示在主时间轴卡片、并行看板与系统公告中） */
  statusSummary: string;
  /** 交付物交互形态：workspace_files 表示包含需审查/合入的工作区文件变更；report_only 表示纯方案/结论报告 */
  deliverableKind: 'workspace_files' | 'report_only';
  /** 审查/预览按钮动态文案（如："审查代码 Diff"、"预览文档变更"、"查看 SQL 脚本"） */
  reviewActionLabel?: string;
  /** 合入/写入按钮动态文案（如："一键合入本地仓库"、"写入本地文档目录"、"应用配置变更"） */
  applyActionLabel?: string;
}

export interface GameTheoreticState {
  currentStage: GameTheoreticStage;
  targetProposalMessageId?: string;
  targetProposalContent?: string;
  targetChallengeMessageId?: string;
  targetChallengeContent?: string;
  targetVerificationMessageId?: string;
  targetVerificationContent?: string;
  targetDefenseMessageId?: string;
  targetDefenseContent?: string;
  isChallengerResponded?: boolean;
  isChallengerBypassed?: boolean;        // 贝叶斯快速通道按设计旁路红队对抗标记 (N11)
  challengerBypassedReason?: string;     // 旁路审计原因说明
  isVerifierResponded?: boolean;
  isDefenseResponded?: boolean;
  isArbiterExempted?: boolean;
  exemptionReason?: string;
  quorumAlert?: string;
  assignedExecutorId?: string;
  executionStatus?: 'idle' | 'queued' | 'running' | 'completed' | 'applied' | 'failed';
  executionStartedAt?: number;
  executionCompletedAt?: string;
  executionAppliedAt?: string;
  executionSummary?: string;
  executionDiffs?: TopicPatchDiffItem[];
  executionArtifactsDir?: string;
  executionUiMeta?: TopicExecutionUiMeta;
  mcdaPayload?: McdaDecisionPayload;
  sprtState?: SprtGovernorState;
  fastTrackConvergence?: FastTrackConvergenceEvidence; // 快速通道「静态验证即收敛」证据字段 (N13)
  minorityReport?: MinorityReport;
  cognoNexus?: CognoNexusState;
  latestSycophancy?: SycophancyEvaluation; // 最新谄媚度评估记录 (P0-4)
  modelDiversity?: ModelDiversityEvaluation; // 参与角色模型异构多样性评估 (P0-5)
  colMadReport?: ColMadSessionReport;    // ColMAD 增量事实贡献与声誉报表 (P1-3)
  roundCount?: number;                   // 当前博弈轮次计数 (P2 回边使用)
  isSafetyCharterSigned?: boolean;       // 人类是否已签署 T2 高危工具执行安全宪章
  rulingDraft?: ArbitrationRulingDraft;  // 由综合仲裁官通过 submit_arbitration_ruling MCP 工具提交的结构化裁决书草案
  modularState?: ModularOrchestrationState; // G-Frame 贝叶斯与团队博弈模块化分治状态
  telemetryLogIds?: string[];
}

// ==================== CognoNexus 工业级认知决策引擎类型 ====================

export interface ArgumentNode {
  id: string;
  authorId?: string;
  authorName?: string;
  claim: string;                // 核心论点/主张
  assumptions: string[];        // 依赖的前提假设
  dependencies?: string[];      // 依赖的前置论点节点 ID (DAG 拓扑边)
  confidence: number;           // 自评置信度 (0~1)
  evidenceRefs?: string[];      // 关联的证据标识
  status?: 'supported' | 'disputed' | 'refuted'; // 三态脱水事实状态 (R-5)
  depth?: number;               // DAG 拓扑层级 (根节点为 0)
  impactScore?: number;         // 论点关键度权重 (下游被依赖程度)
}

export interface GroundingEvidence {
  evidenceId: string;
  sourceTool: 'code_sandbox' | 'rag_search' | 'sql_executor' | 'static_analyzer' | 'ast_grep' | 'read_file' | 'bash_exec' | string;
  inputQueryOrCode: string;
  rawOutput: string;
  truthValue: boolean;         // 反事实检验真值判定
  verifierReport: string;
  tier?: 'T1' | 'T2';          // T1: 只读建议 (权重<=0.3), T2: 宪章授权执行沙箱 (R-3)
  isAdvisory?: boolean;        // 是否为 T1 Advisory 建议性证据
  claimId?: string;            // 关联的原子论点节点 ID (P0-1 原子承诺链)
  confidence?: number;         // 检验置信度
}

export interface DisputeSpanPacket {
  disputeId: string;
  claimTopic: string;           // 争论焦点主题
  proposerClaim: string;        // 主导方立论断言
  challengerCritique: string;   // 挑战方反例断言
  rootCause: string;            // 冲突本质归因 (前提分歧 / 资源竞争 / 边界条件误判)
  groundingStatus: 'unverified' | 'verifying' | 'verified_true' | 'verified_false';
  evidenceChain?: GroundingEvidence[];
  rootDisputeNodeId?: string;   // LMAD DAG 定位的因果根源论点 ID (P1-1)
  affectedSubgraphNodeIds?: string[]; // 冲突引发需增量修复的下游子图节点 ID 集合 (P1-1)
}

export interface McdaCriterion {
  id: string;
  name: string;                 // 准则名称 (如：性能延迟、扩展性、实现复杂度、可靠性)
  direction: 'maximize' | 'minimize';
}

export interface McdaDecisionPayload {
  solverType: 'BWM' | 'AHP';    // 采用的确定性算法 (最优最劣法 / 层次分析法)
  criteria: McdaCriterion[];
  alternatives: string[];       // 候选方案名称 (如：[方案A: OAuth分发器, 方案B: 独立网关中间件])
  scoreMatrix: Record<string, Record<string, number>>; // alternative -> criterion -> score (0~10)
  bestCriterionId: string;      // 最优准则 ID
  worstCriterionId: string;     // 最差准则 ID
  bestToOthers: number[];       // 最优准则相对于其他准则的偏好度 (1~9)
  othersToWorst: number[];      // 其他准则相对于最差准则的偏好度 (1~9)
  computedWeights: Record<string, number>; // 线性规划求解得出的各准则确定性权重
  consistencyIndex: number;     // 逻辑一致性标度 ξ* (越接近 0 逻辑越严密一致)
  consistencyPassed: boolean;   // 是否通过一致性阈值检验 (ξ* <= 0.12)
  ranking: { alternative: string; totalUtility: number; rank: number }[]; // 最终数学综合得分排序
  status?: 'optimal' | 'rejected'; // 求解状态 (R-2 退化拒绝支持)
  rejectionReason?: 'insufficient_information' | 'inconsistent_matrix';
  scoreProvenance?: Record<string, Record<string, string>>; // 评分证据来源追溯链 (P0-3 真实讨论绑定)
  confidenceMatrix?: Record<string, Record<string, number>>; // 各方案在各准则上的校准置信度 (0.0~1.0, P0-5 ReConcile)
}

export interface SycophancyEvaluation {
  agentId: string;
  agentName: string;
  bss: number; // Baseline Sycophancy Score (0.0 ~ 1.0 静态先验附和分)
  dss: number; // Dynamic Sycophancy Score (0.0 ~ 1.0 动态行为附和分)
  discountFactorGamma: number; // γ = 1 - min(0.6, 0.4*DSS + 0.2*BSS)
  sycophancyLevel: 'authentic' | 'mild_conformity' | 'sycophantic';
  signals: string[];
  surrenderDetected?: boolean;
  surrenderReason?: string;
  evaluatedAt: string;
}

export interface ModelDiversityEvaluation {
  score: number; // 0.0 ~ 1.0 (异构多样性评分)
  isHomogeneous: boolean; // 是否同质化严重 (< 0.5)
  familyDistribution: Record<string, string[]>; // family -> [agentNames]
  warnings: string[];
}

export interface SprtGovernorState {
  currentRound: number;
  maxRounds: number;
  logLikelihoodRatio: number;   // 累积对数似然比 Λ_r
  upperThresholdA: number;      // 上界 (触发 Early Exit 共识早停)
  lowerThresholdB: number;      // 下界 (触发死锁熔断，拉起人类仲裁)
  latestAlignmentScore: number; // 最新一轮综合对齐分数 Sr (0~1)
  decisionState: 'continue' | 'early_exit' | 'deadlock_escalation';
  statusDescription: string;
  groundedTrueRatio?: number;   // 显式注入的物理接地真值率 (0~1)
  calibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback'; // 校准状态 (R-4)
  observationVector?: {         // 多维联合观测向量 (P1-2)
    groundedRatio: number;
    semanticScore: number;
    dssScore: number;
    combinedScore: number;
  };
}

/**
 * 快速通道静态验证直通收敛证据 (Fast-Track Empirical Convergence Evidence, N13)
 * 当低先验风险模块在静态契约校验与工具接地中 100% 通过且零违规时直接定案，无需经历对抗辩论链路
 */
export interface FastTrackConvergenceEvidence {
  mode: 'static_empirical_fast_track';
  totalModulesCount: number;
  frozenModulesCount: number;
  verifiedClaimsCount: number;
  contractViolationsCount: number;
  refutedClaimsCount: number;
  achievedAt: string;
  summary: string;
}

export interface MinorityReport {
  id: string;
  dissentingAgentId: string;
  dissentingAgentName: string;
  dissentingAgentModel?: string;
  coreDissentThesis: string;    // 反向对立主张与保留异议
  rationalityBasis: string;     // 未被证伪的自洽逻辑推导
  reopeningTriggers: string[];  // 黑天鹅与重开判定条件 (如：延迟超 100ms，TPS > 10,000)
  recordedAt: string;
}

export interface ColMadAgentScore {
  agentId: string;
  agentName: string;
  factReward: number; // 综合增量事实贡献分
  verifiedClaimsCount: number; // 贡献的已实证断言数
  discoveredEdgeCasesCount: number; // 发现的极端反例数
  redundantPenalty: number; // 冗余车轱辘话扣分
  reputationLevel: 'pioneer' | 'contributor' | 'neutral' | 'redundant';
}

export interface ColMadSessionReport {
  topicId: string;
  scores: Record<string, ColMadAgentScore>; // agentId -> score
  totalFactDelta: number;
  leaderboard: ColMadAgentScore[];
  generatedAt: string;
}

export interface CognoNexusState {
  committedStates: ArgumentNode[];        // 已承诺事实看板 (脱水历史)
  currentDispute?: DisputeSpanPacket;     // 当前聚焦攻防的离散冲突切片
  mcdaPayload?: McdaDecisionPayload;      // 确定性运筹数学决策矩阵
  sprtState?: SprtGovernorState;          // SPRT 调控器状态
  fastTrackConvergence?: FastTrackConvergenceEvidence; // 快速通道实证直通收敛证据 (N13)
  minorityReport?: MinorityReport;        // 少数派异议报告
  latestSycophancy?: SycophancyEvaluation; // 谄媚度评估记录 (P0-4)
  modelDiversity?: ModelDiversityEvaluation; // 角色模型异构性评估 (P0-5)
  colMadReport?: ColMadSessionReport;    // ColMAD 增量事实贡献与声誉报表 (P1-3)
  modularState?: ModularOrchestrationState; // G-Frame 贝叶斯与团队博弈模块化分治状态
}

export interface GameRolesConfig {
  proposers: string[];      // 提案智能体 Agent IDs (Proposers)
  challengers: string[];    // 红队对抗智能体 Agent IDs (Red Team / Challengers)
  verifiers?: string[];     // 接地验证智能体 Agent IDs (Grounding Verifiers)
  arbiters: string[];       // 中立综合协调官 Agent IDs (Synthesizers / Arbiters)
  humanIsArbiter: boolean;  // 人类战略决策者持有最终裁决法槌 (Human Strategic Arbiter)
}

export type RulingDecisionType = 'adopt_proposer' | 'reject_rebuild' | 'trade_off_matrix';

/**
 * 由综合仲裁官 (Arbiter) 通过 MCP 工具 `submit_arbitration_ruling`
 * 或结构化契约提交的架构裁决草案 (Architecture Decision Ruling Draft)
 */
export interface ArbitrationRulingDraft {
  decisionType: RulingDecisionType;
  summary: string;
  tradeOffPoints: string[];
  impactedFiles: string[];
  solution?: string;
  submittedBy?: string;
  submittedAt?: string;
}

export interface RulingRecord {
  decisionType: RulingDecisionType;
  arbiterId: string;
  arbiterName: string;
  summary: string;
  solution?: string;
  tradeOffPoints?: string[];
  impactedFiles?: string[];
  decidedAt: string;
  exemptionReason?: string;
  executorId?: string;
  mcdaPayload?: McdaDecisionPayload;
  minorityReport?: MinorityReport;
  sprtState?: SprtGovernorState;
}

export interface DecisionRecord {
  summary: string;
  solution: string;
  impactedFiles: string[];
  approvers: string[];
  resolvedAt: string;
  executorId?: string;
  executorName?: string;
  mcdaPayload?: McdaDecisionPayload;
  minorityReport?: MinorityReport;
}

export interface TopicMessageData {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  status: TopicStatus;
  discussionMode?: DiscussionMode;
  gameRoles?: GameRolesConfig;
  gameStage?: GameTheoreticStage;
  gameTheoreticState?: GameTheoreticState;
  rulingRecord?: RulingRecord;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  timestamp: string;
  repliesCount: number;
  participatingAgentIds: string[];
  latestReplyPreview?: string;
  decisionRecord?: DecisionRecord;
}

// 兼容老 Room 接口
export type Room = Channel;

// 二级任务线程 / 议题
export interface Thread {
  id: string;
  channelId: string;
  channelName: string;
  type: 'thread' | 'dm';
  title: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  timestamp: string;
  preview: string;
  unreadCount?: number;
  mentions?: string[];
  replyCount?: number;
  parentQuoteSnippet?: string;
  activeAgentIds: string[];
  tags?: string[];
  hasSubThreads?: boolean;
}

export interface AcpTrace {
  requestId: string;
  method: string;
  durationMs: number;
  
  workspaceAction?: {
    action: 'read' | 'write' | 'diff' | 'tree' | 'git';
    path: string;
    summary: string;
    diffSnippet?: string;
  };
  
  skillUsed?: {
    name: string;
    source: 'shadow-crew-dev-mcp' | 'shinobi-dev-mcp' | 'agent-builtin' | 'external-tool';
    input: string;
    output: string;
  };
  
  memoryAction?: {
    type: 'recall_internal_memory' | 'stored_new_memory' | 'synced_room_context';
    key: string;
    detail: string;
    targetBank: 'agent_private_sqlite' | 'shinobi_room_timeline';
  };

  cartridgeRecall?: {
    cartridgeName: string;
    recalledKeys: string[];
    tokenCost: number;
  };
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface CartridgeCitation {
  cartridgeName: string;
  recalledCount: number;
  tokenCost: number;
  items: Array<{ key: string; content: string }>;
}

export interface Message {
  id: string;
  threadId: string;
  projectId?: string;
  channelId?: string;
  type?: 'normal' | 'topic';
  topicData?: TopicMessageData;
  consensusSummary?: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  isAgent: boolean;
  managedBy?: string; // 'you' -> renders 'managed by you' tag
  agentBadge?: string;
  timestamp: string;
  content: string;
  signedNostrHash?: string;
  
  // Parent reference / quote
  replyToSnippet?: string;
  
  // Antigravity Thinking Chain
  thinkingProcess?: {
    duration: string;
    tokens: number;
    summary: string;
    detail: string;
  };
  
  // Codex Unified Diff
  diffView?: TopicPatchDiffItem;
  diffViews?: TopicPatchDiffItem[];
  relatedTopicId?: string;
  
  // Sub-Thread anchor
  subThreadId?: string;
  subThreadTitle?: string;
  subThreadRepliesCount?: number;
  
  cartridgeCitation?: CartridgeCitation;
  acpTrace?: AcpTrace;
  collaborationInfo?: CollaborationInfo;
  reactions?: MessageReaction[];
  gameRole?: GameRoleType;
  gameStage?: GameTheoreticStage;
  moduleId?: string; // G-Frame 所属原子模块沙箱 ID
  isPending?: boolean; // 正在推演/流式输出中的临时占位卡
  pendingHint?: string; // 实时推演/心跳动作描述提示
  startedAt?: number; // 任务发起时间戳
  codeSnippets?: Array<{
    language: string;
    filename: string;
    code: string;
  }>;
}

// 三级子话题 / 细节分支讨论
export interface SubThread {
  id: string;
  parentMessageId: string;
  threadId: string;
  title: string;
  quoteSnippet: string;
  messages: Message[];
  participatingAgentIds: string[];
  isResolved?: boolean;
}

export interface AcpRpcLog {
  id: string;
  timestamp: string;
  direction: 'client_to_agent' | 'agent_to_client';
  agentName: string;
  method: string;
  payload: Record<string, any>;
  status: 'ok' | 'pending' | 'error';
}

export interface WorkspaceFile {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: string;
  children?: WorkspaceFile[];
  content?: string;
}
