/**
 * Types for Shinobi Multi-Agent Platform (Fused with Buzz, Codex, and Antigravity)
 */

export type AcpTransport = 'stdio' | 'websocket' | 'http_sse';

export type AcpAvailabilityStatus = 'available' | 'not_adapted' | 'not_installed' | 'unknown';

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

export type AcpNativeMemoryStatus =
  | 'unknown'
  | 'enabled'
  | 'disabled'
  | 'unsupported';

/**
 * ACP 可选扩展：agentCapabilities.nativeMemory
 *
 * 原生长期记忆的存储与召回由 ACP 端点负责；Shadow Crew 只记录端点的真实声明，
 * 不会据此自动注入、迁移或清理端点私有记忆。
 */
export interface AcpNativeMemoryCapability {
  status: AcpNativeMemoryStatus;
  persistent?: boolean | null;
  crossThread?: boolean | null;
  provider?: string | null;
  scope?: 'agent' | 'workspace' | 'runtime' | 'unknown' | null;
  detail?: string | null;
  lastCheckedAt?: number;
}

export interface AgentRuntimeStatus {
  agent_id: string;
  pid: number;
  is_alive: boolean;
  is_initialized: boolean;
  auth_state: 'ok' | 'auth_required' | 'missing_key' | 'unknown';
  status: 'running' | 'auth_required' | 'starting' | 'error' | 'idle';
  status_detail?: string | null;
  supports_load_session?: boolean | null;
  supportsLoadSession?: boolean | null;
  supports_resume_session?: boolean | null;
  supportsResumeSession?: boolean | null;
  native_memory?: AcpNativeMemoryCapability | null;
  nativeMemory?: AcpNativeMemoryCapability | null;
  negotiated_protocol_version?: string | null;
  negotiatedProtocolVersion?: string | null;
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
  /** 1 = 已迁移到显式原生记忆策略的数据结构。 */
  schemaVersion: 1;
  /** native：由 ACP 端点管理；disabled：禁止启用端点原生记忆。 */
  mode: 'native' | 'disabled';
  /** 是否允许端点自动从历史对话提炼长期记忆；显式 memory 工具写入不受此项影响。 */
  autoGenerate: boolean;
  nativeCapability: AcpNativeMemoryCapability;
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
export type ModelFamily = 'anthropic' | 'openai' | 'deepseek' | 'google' | 'meta' | 'qwen' | 'zhipu' | 'local_other';

export interface ReasoningLevelItem {
  level: string; // 如 'off' | 'low' | 'medium' | 'high' 或自定义
  apiValue: string; // 传给 API 的具体参数值
}

export interface AgentModelConfig {
  provider: ModelProviderType;
  family?: ModelFamily;
  modelId: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  customContextBudget?: number;
  useGlobalDefault?: boolean;
  lastTestedAt?: number;
  lastLatencyMs?: number;
  isHealthy?: boolean;
  lastError?: string;

  // 1. 输入能力类型（文本 / 多模态图片支持）
  inputTypes?: Array<'text' | 'image'>;
  supportsImage?: boolean;

  // 2. 思考强度配置（Reasoning Levels & Effort）
  enableReasoning?: boolean; // 是否启用思考强度控制
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | string; // 当前生效的思考强度（提供默认选项）
  reasoningLevels?: ReasoningLevelItem[]; // 思考级别与 API 参数映射表

  // 3. 上下文压缩双模架构配置
  enableMicroAgentSummary?: boolean; // 是否启用微型总结 Agent 智能语义归纳 (默认启用，异常/离线时自动回退规则提取保底)
  microSummaryModelId?: string; // 微型总结 Agent 专属轻量小模型 ID (未配置时根据 provider 智能推导低延迟 Flash/Mini 模型)
}

export interface AgentWorkspaceConfig {
  rootPath: string;
  repoName: string;
  gitBranch: string;
  permissionMode: 'full_read_write' | 'read_only' | 'sandbox_diff_only';
  activeFiles: string[];
}

// ==================== ACP Portable Expert Pack (.scpack v1.0) ====================

export type ScpackErrorCode =
  | 'ERR_PACK_TOO_LARGE'
  | 'ERR_TOO_MANY_FILES'
  | 'ERR_PATH_TRAVERSAL'
  | 'ERR_SYMLINK_FORBIDDEN'
  | 'ERR_INTEGRITY_MISMATCH'
  | 'ERR_SIGNATURE_INVALID'
  | 'ERR_PACK_REVOKED'
  | 'ERR_PACK_MISSING'
  | 'ERR_SCHEMA_UNSUPPORTED'
  | 'ERR_SNAPSHOT_INCONSISTENT'
  | 'ERR_SECRET_DETECTED'
  | 'ERR_RUNTIME_MISSING'
  | 'ERR_AUTH_REQUIRED'
  | 'ERR_VERSION_MISMATCH';

export type AcpHarnessType = 'codex' | 'claude-code';

export type CodexMemorySourceId =
  | 'S1_CODEX_MEMORIES_V2'
  | 'S2_AD_HOC_MD'
  | 'S3_AGENTS_MD'
  | 'S4_CODEX_SKILLS'
  | 'S5_SQLITE_SESSIONS'
  | 'S6_CLAUDE_IMPORTER'
  | 'C1_CLAUDE_PROJECT_MEMORIES'
  | 'C2_CLAUDE_SKILLS'
  | 'C3_CLAUDE_SETTINGS'
  | 'C4_CLAUDE_HISTORY';

export type AcpMemorySourceId = CodexMemorySourceId;

export type CodexSourceAvailability =
  | 'active'
  | 'degraded_empty_503'
  | 'disabled_by_default'
  | 'missing'
  | 'locked_busy';

export interface CodexMemorySourceStatus {
  source_id: CodexMemorySourceId;
  label: string;
  availability: CodexSourceAvailability;
  item_count: number;
  detail: string;
  is_experimental: boolean;
}

export interface RedactionFinding {
  rule_id: string;
  source_path: string;
  line_number: number;
  redacted_preview: string;
  replacement_token: string;
}

export interface RedactionAuditReport {
  scanned_files: number;
  scanned_bytes: number;
  total_redactions: number;
  findings: RedactionFinding[];
  blacklisted_paths_skipped: string[];
  zero_residual_verified: boolean;
}

export interface ScpackPlaybookEntry {
  id: string;
  title: string;
  domain: string;
  source_id: CodexMemorySourceId;
  relative_path: string;
  keywords: string[];
  summary: string;
  content_markdown: string;
  blake3_digest: string;
}

export interface CodexSourceProbeReport {
  codex_home: string;
  source_harness?: AcpHarnessType;
  codex_cli_version?: string | null;
  sources: CodexMemorySourceStatus[];
  extracted_playbooks: ScpackPlaybookEntry[];
  extracted_skills: ScpackPlaybookEntry[];
  redaction_audit: RedactionAuditReport;
  snapshot_watermark: string;
  s1_degraded_notice?: string | null;
}

export interface ScpackFileDigest {
  path: string;
  size_bytes: number;
  blake3: string;
}

export interface ScpackRuntimeRequirement {
  target_runtime: string;
  acp_adapter: string;
  min_cli_version: string;
  recommended_sandbox_mode: string;
  force_disable_native_memory: boolean;
}

export interface ScpackSignatureBlock {
  algorithm: 'ed25519';
  canonicalization: 'RFC8785-JCS';
  signer_public_key_hex: string;
  signature_hex: string;
  signed_at: string;
}

export interface ScpackManifest {
  schema_version: 'scpack-1.0';
  package_id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  created_at: string;
  source_snapshot_watermark: string;
  runtime_requirement: ScpackRuntimeRequirement;
  files: ScpackFileDigest[];
  merkle_root_blake3: string;
  redaction_summary: {
    total_redactions: number;
    zero_residual_verified: boolean;
    user_confirmed: boolean;
  };
  signature?: ScpackSignatureBlock | null;
}

export interface InstalledScpackSummary {
  package_id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  install_dir: string;
  created_at: string;
  merkle_root_blake3: string;
  signer_public_key_hex: string;
  source_harness?: AcpHarnessType | string;
  primary_runtime?: string;
  playbook_count: number;
  skill_count: number;
  revoked: boolean;
}

export interface PreRetrievalMatchedPlaybook {
  id: string;
  title: string;
  domain: string;
  relative_path: string;
  bm25_score: number;
}

export interface PreRetrievalResult {
  package_id: string;
  package_name: string;
  matched_playbooks: PreRetrievalMatchedPlaybook[];
  injected_block: string;
  augmented_prompt: string;
  sanitization_warnings: string[];
}

export interface BSideRuntimeCheck {
  codex_cli_installed: boolean;
  codex_cli_version?: string | null;
  codex_acp_available: boolean;
  auth_ready: boolean;
  version_compatible: boolean;
  warning_message?: string | null;
}

export interface AgentExpertPackBinding {
  packageId: string;
  packageName: string;
  version: string;
  author: string;
  installDir: string;
  merkleRootBlake3: string;
  signerPublicKeyHex: string;
  /** B 端专家分身诚实标识：基于 A 的经验构建 · 本地运行时 */
  badgeLabel: string;
  forceDisableNativeMemory: true;
  sandboxMode: 'workspace-write';
  boundAt: string;
}

/**
 * 单 Agent 运行时预算与循环收敛策略。
 * 缺失时由 normalizeAgentRuntimePolicy 统一下发默认值，业务层不得自行猜测。
 */
export interface AgentRuntimePolicy {
  /** 单轮回复软性 Token 预算；0 表示继承模型/端点默认 */
  maxOutputTokens: number;
  /** 协同链最大轮次（1~12）；房间内取所有参与者最小值 */
  cascadeMaxHops: number;
  /** 阶段契约 Self-Refine 纠错上限（0~2）；0 表示失败后直接升级人工 */
  maxCorrectionRetries: number;
  /** 是否允许该 Agent 在回复中 @ 其他 Agent 继续接力 */
  autoRelay: boolean;
  /** 简洁模式：简单问答/修复直接给结论与最小改动 */
  conciseReplies: boolean;
  /** 流式吐字合并刷新间隔（毫秒，仅影响 UI 显示节奏，不改变计费） */
  streamFlushIntervalMs: number;
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
  runtimePolicy?: AgentRuntimePolicy;
  modelLatencyMs?: number;
  isModelHealthy?: boolean;
  isManagedByYou?: boolean;
  baselineSycophancyScore?: number; // BSS 静态历史附和分 (0.0~1.0, P0-4)
  defaultGameRole?: GameRoleType;
  
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
    supportsLoadSession?: boolean;
    supportsResumeSession?: boolean;
    loadSession?: boolean;
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

  // Portable Expert Pack (.scpack v1.0) Binding
  expertPack?: AgentExpertPackBinding;

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
  rootMessageId?: string;
  sourceMessageId?: string;
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

export type ChannelKind = 'general' | 'feature' | 'requirement' | 'task';
export type ChannelStatus = 'active' | 'archived' | 'deleted';

// L0 协同频道 (通用实时交流与协作流)
export interface Channel {
  id: string;
  workspaceBindingId: string;
  creatorId: string; // 拥有者与删除权限人
  name: string;
  kind?: ChannelKind;
  status: ChannelStatus;
  description: string;
  topic?: string;
  isPrivate: boolean; // 默认受邀准入 (true)
  iconName: string;
  unreadCount: number;
  assignedTeamId?: string;
  assignedAgentIds: string[];
  memberIds: string[]; // 频道成员列表 (默认初始仅为 [creatorId])
  createdAt?: number;
  deletedAt?: number;
}

export type WorkspaceOwnerType = 'channel' | 'topic' | 'dm';
export type WorkspaceBindingMode = 'default' | 'custom';
export type WorkspaceBindingOrigin =
  | 'created_default'
  | 'created_custom'
  | 'channel_cwd_snapshot'
  | 'legacy_channel_cwd_snapshot';

export interface WorkspaceBinding {
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  mode: WorkspaceBindingMode;
  origin: WorkspaceBindingOrigin;
  cwd: string;
  artifactRoot: string;
  createdAt: number;
}

export type AcpPermissionCapability =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'shell.execute'
  | 'network.access'
  | 'other';

export type AcpPermissionScopeType = 'channel' | 'topic' | 'dm' | 'dm_topic';

export type AcpPermissionDecision =
  | 'deny'
  | 'allow_once'
  | 'allow_session'
  | 'allow_scope';

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AcpPermissionRequest {
  requestId: string;
  agentId: string;
  sessionId: string;
  sessionKey: string;
  scopeType: AcpPermissionScopeType;
  scopeId: string;
  workspaceBindingId: string;
  cwd: string;
  capability: AcpPermissionCapability;
  toolName: string;
  toolTitle: string;
  toolKind: string;
  command?: string;
  paths: string[];
  outsideWorkspacePaths: string[];
  description?: string;
  supportsAllowOnce: boolean;
  supportsReject: boolean;
  options: AcpPermissionOption[];
  createdAt: number;
}

export interface AcpPermissionGrant {
  id: string;
  agentId: string;
  scopeType: AcpPermissionScopeType;
  scopeId: string;
  workspaceBindingId: string;
  capability: AcpPermissionCapability;
  createdAt: number;
}

// PRD 规范：Topic 议题状态与共识决策记录
export type TopicStatus = 'open' | 'investigating' | 'resolved';

export type DiscussionMode = 'standard' | 'game_theoretic';

export type TopicScopeType = 'channel' | 'dm';
export type DuelParticipantRole = 'human' | 'agent';

export type DuelRolesConfig =
  | { proposer: 'human'; challenger: 'agent' }
  | { proposer: 'agent'; challenger: 'human' };

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

export type WorkspacePatchApplyStatus = 'applied' | 'conflict' | 'archived_only' | 'failed';

export type WorkspacePatchApplyMode =
  | 'git_apply'
  | 'block_replace'
  | 'created_file'
  | 'artifact_saved'
  | 'conflict'
  | 'failed';

export interface TopicPatchDiffItem {
  filename: string;
  additions: number;
  deletions: number;
  diff: string;
  codeContent?: string;
  applied?: boolean;
  appliedMode?: WorkspacePatchApplyMode;
  applyStatus?: WorkspacePatchApplyStatus;
  applyError?: string;
  backupPath?: string;
  targetPath?: string;
}

/**
 * 宿主侧真实命令执行证据：退出码、耗时与输出尾部均由 Rust 返回，
 * 不允许前端凭空推断“验证通过”。
 */
export interface WorkspaceVerificationCommandResult {
  label: string;
  program: string;
  args: string[];
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface WorkspaceVerificationReport {
  status: 'running' | 'passed' | 'failed' | 'skipped';
  checkedAt: string;
  commands: WorkspaceVerificationCommandResult[];
  summary: string;
  skippedReason?: string;
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

export type RoleConcurrenceDecisionStatus =
  | 'concurred'
  | 'conditional'
  | 'objected'
  | 'unavailable';

export type RoleConcurrenceItemStatus =
  | 'pending'
  | RoleConcurrenceDecisionStatus
  | 'invalid';

export type RoleConcurrenceSource = 'mcp_tool' | 'contract_block';

/**
 * 参研角色通过 submit_role_concurrence 工具或 ROLE_CONCURRENCE 契约块提交的终局票。
 * 自然语言正文仅用于解释，不得作为无异议授权依据。
 */
export interface RoleConcurrenceSubmission {
  protocolVersion: 1;
  agentId: string;
  role: 'proposer' | 'challenger' | 'verifier';
  solutionDigest: string;
  status: RoleConcurrenceDecisionStatus;
  blockingIssueIds: string[];
  conditions: string[];
  rationale: string;
  evidenceRefs: string[];
  source: RoleConcurrenceSource;
  submittedAt?: string;
}

export interface RoleConcurrenceItem {
  agentId: string;
  agentName: string;
  agentHandle?: string;
  role: 'proposer' | 'challenger' | 'verifier' | 'arbiter';
  status: RoleConcurrenceItemStatus;
  statement?: string; // 角色回复的无异议确认陈词或具体观点
  timestamp?: string;
  solutionDigest?: string;
  blockingIssueIds?: string[];
  conditions?: string[];
  evidenceRefs?: string[];
  decisionSource?: RoleConcurrenceSource;
  validationError?: string;
}

export interface GameRoleConcurrenceState {
  protocolVersion: 1;
  solutionDigest: string;              // 所有有效选票必须绑定的终局方案摘要
  isConcurrencePhaseActive: boolean; // 是否处于无异议征询确认阶段
  arbiterProposalSummary?: string;   // 综合裁定官拟定敲定的方案摘要
  items: RoleConcurrenceItem[];      // 各关键参研角色的无异议保证状态
  allConcurred: boolean;             // 是否所有参与角色均已明确回复并保证无异议
  finalLivingAdrMarkdown?: string;   // 终局敲定出具的高可读性活体 ADR 画布 Markdown
  concludedAt?: string;              // 敲定时间戳
}

export interface GameTheoreticState {
  currentStage: GameTheoreticStage;
  gamePolicy?: GameTheoreticPolicy;
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
  executionPatchHistoryPath?: string;
  executionVerification?: WorkspaceVerificationReport;
  executionVerificationRepairAttempts?: number;
  executionRolledBackAt?: string;
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
  concurrenceState?: GameRoleConcurrenceState; // 全员无异议征询保证与活体看板生成状态
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
  adaptiveMeta?: {              // 自适应多域与漏斗调控元数据 (Ada-Cogno)
    domainType: string;
    neutralThreshold: number;
    sensitivity: number;
    isFunnelActive: boolean;
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

export type GameIndependenceProfile = 'strict' | 'flexible';

export interface GameTheoreticPolicy {
  /** 严格模式禁止关键角色跨职能复用；灵活模式允许复用但显式告警。 */
  independenceProfile: GameIndependenceProfile;
  /** 议题是否包含代码、日志、运行期等需要工具接地的事实断言。 */
  groundingRequired: boolean;
}

export type GameConfigurationEvaluationStatus = 'pass' | 'warning' | 'blocked';

export interface GameRoleReuseBinding {
  agentId: string;
  agentName: string;
  roles: GameRoleType[];
}

export interface GameConfigurationEvaluation {
  status: GameConfigurationEvaluationStatus;
  policy: GameTheoreticPolicy;
  roleCoverage: {
    proposer: number;
    challenger: number;
    verifier: number;
    arbiter: number;
    humanArbiter: boolean;
    defenderUsesProposer: boolean;
  };
  uniqueAgentCount: number;
  reusedRoleBindings: GameRoleReuseBinding[];
  criticalCollisions: string[];
  independenceScore: number;
  modelDiversity: ModelDiversityEvaluation;
  groundingRequired: boolean;
  groundingSatisfied: boolean;
  arbitrationConfigured: boolean;
  blockingIssues: string[];
  warnings: string[];
  summary: string;
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
  concurrenceSignOff?: {
    allConcurred: boolean;
    solutionDigest?: string;
    records: {
      role: string;
      agentId?: string;
      agentName: string;
      statement: string;
      timestamp: string;
      status?: RoleConcurrenceDecisionStatus;
      conditions?: string[];
      blockingIssueIds?: string[];
      decisionSource?: RoleConcurrenceSource;
    }[];
  };
  livingAdrMarkdown?: string; // 人类可读性强的最终 ADR 画布 Markdown
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
  scopeType: TopicScopeType;
  channelId?: string;
  dmAgentId?: string;
  dmThreadId?: string;
  workspaceBindingId: string;
  title: string;
  description?: string;
  status: TopicStatus;
  discussionMode?: DiscussionMode;
  gameRoles?: GameRolesConfig;
  duelRoles?: DuelRolesConfig;
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

  scpackRetrieval?: {
    packageId: string;
    packageName: string;
    matchedPlaybooks: PreRetrievalMatchedPlaybook[];
    sanitizationWarnings: string[];
    nativeMemoryLockedDisabled: boolean;
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

export type MessageKind = 'normal' | 'system_control' | 'rollup' | 'guard' | 'error';

export type MessageAttachmentKind = 'image' | 'file';

export interface MessageAttachmentInput {
  id: string;
  kind: MessageAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
  previewDataUrl?: string;
}

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  uri?: string;
  previewDataUrl?: string;
}

export interface Message {
  id: string;
  threadId: string;
  channelId?: string;
  type?: 'normal' | 'topic';
  kind?: MessageKind;
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
  attachments?: MessageAttachment[];
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
