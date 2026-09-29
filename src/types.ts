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

export type GameTheoreticStage = 'proposal' | 'challenge' | 'verification' | 'defense' | 'arbitration' | 'concluded' | 'stageFailed';

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
  isVerifierResponded?: boolean;
  isDefenseResponded?: boolean;
  isArbiterExempted?: boolean;
  exemptionReason?: string;
  quorumAlert?: string;
  assignedExecutorId?: string;
  executionStatus?: 'idle' | 'running' | 'completed' | 'failed';
  mcdaPayload?: McdaDecisionPayload;
  sprtState?: SprtGovernorState;
  minorityReport?: MinorityReport;
  cognoNexus?: CognoNexusState;
  roundCount?: number;                   // 当前博弈轮次计数 (P2 回边使用)
  isSafetyCharterSigned?: boolean;       // 人类是否已签署 T2 高危工具执行安全宪章
  telemetryLogIds?: string[];
}

// ==================== CognoNexus 工业级认知决策引擎类型 ====================

export interface ArgumentNode {
  id: string;
  authorId?: string;
  authorName?: string;
  claim: string;                // 核心论点/主张
  assumptions: string[];        // 依赖的前提假设
  dependencies?: string[];      // 依赖的前置论点节点 ID
  confidence: number;           // 自评置信度 (0~1)
  evidenceRefs?: string[];      // 关联的证据标识
  status?: 'supported' | 'disputed' | 'refuted'; // 三态脱水事实状态 (R-5)
}

export interface GroundingEvidence {
  evidenceId: string;
  sourceTool: 'code_sandbox' | 'rag_search' | 'sql_executor' | 'static_analyzer';
  inputQueryOrCode: string;
  rawOutput: string;
  truthValue: boolean;         // 反事实检验真值判定
  verifierReport: string;
  tier?: 'T1' | 'T2';          // T1: 只读建议 (权重<=0.3), T2: 宪章授权执行沙箱 (R-3)
  isAdvisory?: boolean;        // 是否为 T1 Advisory 建议性证据
}

export interface DisputeSpanPacket {
  disputeId: string;
  claimTopic: string;           // 争论焦点主题
  proposerClaim: string;        // 主导方立论断言
  challengerCritique: string;   // 挑战方反例断言
  rootCause: string;            // 冲突本质归因 (前提分歧 / 资源竞争 / 边界条件误判)
  groundingStatus: 'unverified' | 'verifying' | 'verified_true' | 'verified_false';
  evidenceChain?: GroundingEvidence[];
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

export interface CognoNexusState {
  committedStates: ArgumentNode[];        // 已承诺事实看板 (脱水历史)
  currentDispute?: DisputeSpanPacket;     // 当前聚焦攻防的离散冲突切片
  mcdaPayload?: McdaDecisionPayload;      // 确定性运筹数学决策矩阵
  sprtState?: SprtGovernorState;          // SPRT 调控器状态
  minorityReport?: MinorityReport;        // 少数派异议报告
}

export interface GameRolesConfig {
  proposers: string[];      // 提案智能体 Agent IDs (Proposers)
  challengers: string[];    // 红队对抗智能体 Agent IDs (Red Team / Challengers)
  verifiers?: string[];     // 接地验证智能体 Agent IDs (Grounding Verifiers)
  arbiters: string[];       // 中立综合协调官 Agent IDs (Synthesizers / Arbiters)
  humanIsArbiter: boolean;  // 人类战略决策者持有最终裁决法槌 (Human Strategic Arbiter)
}

export type RulingDecisionType = 'adopt_proposer' | 'reject_rebuild' | 'trade_off_matrix';

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
    source: 'shinobi-dev-mcp' | 'agent-builtin' | 'external-tool';
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
  diffView?: {
    filename: string;
    additions: number;
    deletions: number;
    diff: string;
  };
  
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
