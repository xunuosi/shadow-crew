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

export type GameRoleType = 'proposer' | 'challenger' | 'arbiter';

export type GameTheoreticStage = 'proposal' | 'challenge' | 'defense' | 'arbitration' | 'concluded';

export interface GameTheoreticState {
  currentStage: GameTheoreticStage;
  targetProposalMessageId?: string;
  targetProposalContent?: string;
  targetChallengeMessageId?: string;
  targetChallengeContent?: string;
  isChallengerResponded?: boolean;
  isArbiterExempted?: boolean;
  exemptionReason?: string;
  quorumAlert?: string;
}

export interface GameRolesConfig {
  proposers: string[];      // 主导者 Agent IDs
  challengers: string[];    // 挑战者 Agent IDs
  arbiters: string[];       // AI 仲裁者 Agent IDs
  humanIsArbiter: boolean;  // 人类开发者本人是否担任仲裁者 (持有最终裁决法槌)
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
}

export interface DecisionRecord {
  summary: string;
  solution: string;
  impactedFiles: string[];
  approvers: string[];
  resolvedAt: string;
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
