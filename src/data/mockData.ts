import { 
  Project,
  Agent, 
  AgentTeam, 
  Channel, 
  Thread, 
  Message, 
  SubThread, 
  AcpRpcLog, 
  WorkspaceFile 
} from '../types';

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'project-shadow-crew',
    name: 'shadow-crew',
    description: '基于 ACP 的多 Agent 替身协作工作台 (Rust + Tauri + Nostr)',
    repoUrl: 'https://github.com/shinobi-workspace/shadow-crew',
    localWorkspaceRoot: '/Users/xunuosi/Code/Lx/AI/shadow-crew',
    assignedAgentIds: ['agent-1789029918725', 'agent-shinobi-core'],
    createdAt: Date.now() - 86400000 * 7,
  },
];

// 本地 Shinobi Native Agent 与 OpenClaw Agent
export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'agent-shinobi-core',
    name: 'Shinobi Core (Rust)',
    handle: '@shinobi-core',
    avatar: '🥷',
    role: 'High-Performance Rust Native Agent',
    description: 'Local ultra-fast native agent runtime with private SQLite memory bank',
    color: '#10b981',
    status: 'idle',
    statusDetail: 'Listening on stdio (ACP v1.0.4)',
    modelBadge: 'Rust Native',
    isManagedByYou: true,
    acpTransport: 'stdio',
    acpCommandOrUrl: './target/debug/shinobi-agent',
    protocolVersion: '2025-01-01 (ACP v1.0.4)',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    },
    workspace: {
      rootPath: '/Users/xunuosi/Code/Lx/AI/shadow-crew',
      repoName: 'shadow-crew',
      gitBranch: 'main',
      permissionMode: 'full_read_write',
      activeFiles: ['crates/shinobi-agent/src/main.rs'],
    },
    skills: [],
    memory: {
      internalMemoryPath: '~/.local/share/shinobi/shinobi_agent_memory.sqlite',
      persistentType: 'sqlite',
      persistentItems: [],
      sessionCacheCount: 0,
    },
  },
  {
    id: 'agent-1789029918725',
    name: 'OpenClaw Mantis',
    handle: '@openclaw-mantis',
    avatar: '🦗',
    role: 'OpenClaw Mantis',
    description: 'Personal assistant / Autonomous multi-agent gateway daemon via openclaw acp',
    color: '#06b6d4',
    status: 'idle',
    statusDetail: 'Connected via stdio (ACP v1.0.4)',
    modelBadge: 'deepseek-v4-flash-vision-exp',
    localAcpProfile: 'OpenClaw Mantis',
    envVars: [
      {
        key: 'OPENCLAW_GATEWAY_URL',
        value: 'ws://127.0.0.1:18789',
      },
    ],
    isManagedByYou: false,
    acpTransport: 'stdio',
    acpCommandOrUrl: 'openclaw acp',
    protocolVersion: '2025-01-01 (ACP v1.0.4)',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    },
    workspace: {
      rootPath: '/Users/xunuosi/Code/Lx/AI/shadow-crew',
      repoName: 'shadow-crew',
      gitBranch: 'main',
      permissionMode: 'full_read_write',
      activeFiles: ['src/App.tsx', 'Cargo.toml', 'README.md'],
    },
    skills: [
      {
        id: 'skill-openclaw-gateway',
        name: 'openclaw:gateway_bridge',
        description: 'Bridge local ACP requests to OpenClaw WebSocket Gateway daemon',
        type: 'builtin',
      },
      {
        id: 'skill-workspace-fs',
        name: 'workspace:filesystem',
        description: 'Direct read/write access to project workspace files with diff reviews',
        type: 'builtin',
      },
    ],
    memory: {
      internalMemoryPath: '~/.local/share/shinobi/openclaw_mantis_memory.sqlite',
      persistentType: 'sqlite',
      persistentItems: [
        {
          id: 'mem-openclaw-init',
          category: 'codebase_pattern',
          key: 'openclaw_acp_bridge',
          content: 'OpenClaw Gateway connects on ws://127.0.0.1:18789 via openclaw acp adapter. Model: deepseek-corp/deepseek-v4-flash-vision-exp.',
          lastAccessed: 'Just now',
        },
      ],
      sessionCacheCount: 1,
    },
  },
];

export const INITIAL_TEAMS: AgentTeam[] = [
  {
    id: 'team-shadow-crew',
    name: 'Shadow Crew Squad',
    description: 'Autonomous multi-agent development & alter-ego squad',
    icon: '⚡',
    agentIds: ['agent-1789029918725', 'agent-shinobi-core'],
    color: '#06b6d4',
  },
];

export const INITIAL_CHANNELS: Channel[] = [];

export const INITIAL_THREADS: Thread[] = [];

export const INITIAL_MESSAGES: Record<string, Message[]> = {};

export const INITIAL_SUB_THREADS: Record<string, SubThread> = {};

export const INITIAL_RPC_LOGS: AcpRpcLog[] = [];

export const MOCK_WORKSPACE_FILES: WorkspaceFile[] = [
  {
    path: 'src/App.tsx',
    name: 'App.tsx',
    type: 'file',
    size: '37.6 KB',
  },
  {
    path: 'src/types.ts',
    name: 'types.ts',
    type: 'file',
    size: '6.4 KB',
  },
  {
    path: 'Cargo.toml',
    name: 'Cargo.toml',
    type: 'file',
    size: '1.2 KB',
  },
  {
    path: 'README.md',
    name: 'README.md',
    type: 'file',
    size: '8.5 KB',
  },
];
