/**
 * Types for Buzz ACP Agent Hub (Block Buzz Multi-Agent Platform)
 */

export type AcpTransport = 'stdio' | 'websocket' | 'http_sse';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  type: 'builtin' | 'mcp' | 'client_delegated';
  mcpServer?: string;
  commandSnippet?: string;
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
  status: 'idle' | 'thinking' | 'using_skill' | 'accessing_workspace' | 'querying_memory';
  statusDetail?: string;
  
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
  
  // Three Core Pillars
  workspace: AgentWorkspaceConfig;
  skills: AgentSkill[];
  memory: AgentMemoryBank;
  
  isJoinedCurrentRoom: boolean;
}

export interface AcpTrace {
  requestId: string;
  method: string;
  durationMs: number;
  
  // Workspace integration trace
  workspaceAction?: {
    action: 'read' | 'write' | 'diff' | 'tree' | 'git';
    path: string;
    summary: string;
    diffSnippet?: string;
  };
  
  // Skill / MCP integration trace
  skillUsed?: {
    name: string;
    source: 'buzz-dev-mcp' | 'agent-builtin' | 'external-tool';
    input: string;
    output: string;
  };
  
  // Memory integration trace
  memoryAction?: {
    type: 'recall_internal_memory' | 'stored_new_memory' | 'synced_room_context';
    key: string;
    detail: string;
    targetBank: 'agent_private_sqlite' | 'buzz_room_timeline';
  };
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface Message {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  isAgent: boolean;
  agentBadge?: string;
  timestamp: string;
  content: string;
  signedNostrHash: string; // Like Block Buzz Nostr signed event ID
  
  // Attached ACP execution trace if performed by an agent
  acpTrace?: AcpTrace;
  reactions?: MessageReaction[];
  codeSnippets?: Array<{
    language: string;
    filename: string;
    code: string;
  }>;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  topic: string;
  isPrivate: boolean;
  iconName: string;
  unreadCount: number;
  activeAgentIds: string[];
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
