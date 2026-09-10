/**
 * Buzz ACP Hivemind - Desktop Multi-Agent Platform (Modeled after Block Buzz)
 */

import React, { useState } from 'react';
import { Agent, Room, Message, AcpRpcLog, WorkspaceFile } from './types';
import { 
  INITIAL_AGENTS, 
  INITIAL_ROOMS, 
  INITIAL_MESSAGES, 
  INITIAL_RPC_LOGS, 
  MOCK_WORKSPACE_FILES 
} from './data/mockData';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { ChatTimeline } from './components/ChatTimeline';
import { MessageInput } from './components/MessageInput';
import { AcpInspector } from './components/AcpInspector';
import { ConnectAgentModal } from './components/ConnectAgentModal';
import { AcpArchitectureModal } from './components/AcpArchitectureModal';
import { RustTauriArchitectureHub } from './components/RustTauriArchitectureHub';

export default function App() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [rooms, setRooms] = useState<Room[]>(INITIAL_ROOMS);
  const [activeRoomId, setActiveRoomId] = useState<string>('room-acp-dev');
  const [messages, setMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [rpcLogs, setRpcLogs] = useState<AcpRpcLog[]>(INITIAL_RPC_LOGS);
  const [workspaceFiles] = useState<WorkspaceFile[]>(MOCK_WORKSPACE_FILES);
  const [currentWorkspace, setCurrentWorkspace] = useState<string>('block/buzz');

  // Inspector & Modal states
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('agent-buzz');
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState<boolean>(false);
  const [isRustTauriHubOpen, setIsRustTauriHubOpen] = useState<boolean>(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0];
  const activeRoomMessages = messages[activeRoomId] || [];
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  // Active agents currently in this room
  const agentsInCurrentRoom = agents.filter((a) =>
    activeRoom.activeAgentIds.includes(a.id)
  );

  // Helper to record an ACP JSON-RPC packet
  const logRpc = (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => {
    const newLog: AcpRpcLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      direction,
      agentName,
      method,
      payload,
      status: 'ok',
    };
    setRpcLogs((prev) => [newLog, ...prev]);
  };

  // Toggle agent participating in room (ACP session binding)
  const handleToggleAgentInRoom = (agentId: string) => {
    const isCurrentlyIn = activeRoom.activeAgentIds.includes(agentId);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    if (isCurrentlyIn) {
      // Remove from room
      setRooms((prev) =>
        prev.map((r) =>
          r.id === activeRoomId
            ? { ...r, activeAgentIds: r.activeAgentIds.filter((id) => id !== agentId) }
            : r
        )
      );
      logRpc(agent.name, 'client_to_agent', 'session/destroy', {
        jsonrpc: '2.0',
        method: 'session/destroy',
        params: { roomId: activeRoomId, agentId },
      });
    } else {
      // Add to room (ACP session/new)
      setRooms((prev) =>
        prev.map((r) =>
          r.id === activeRoomId
            ? { ...r, activeAgentIds: [...r.activeAgentIds, agentId] }
            : r
        )
      );
      logRpc(agent.name, 'client_to_agent', 'session/new', {
        jsonrpc: '2.0',
        method: 'session/new',
        params: {
          roomId: activeRoomId,
          cwd: agent.workspace.rootPath,
          workspaceRoots: [{ uri: `file://${agent.workspace.rootPath}`, name: 'buzz' }],
        },
      });
    }
  };

  // Run an on-demand skill test for an agent
  const handleRunAgentSkill = (agentId: string, skillId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    const skill = agent.skills.find((s) => s.id === skillId);
    if (!skill) return;

    // Log client to agent
    logRpc(agent.name, 'client_to_agent', 'skills/callTool', {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'skills/callTool',
      params: { skillId, name: skill.name },
    });

    // Animate agent status
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, status: 'using_skill' } : a))
    );

    setTimeout(() => {
      // Log agent to client response
      logRpc(agent.name, 'agent_to_client', 'skills/callTool:result', {
        jsonrpc: '2.0',
        id: Date.now(),
        result: {
          status: 'success',
          output: `Skill ${skill.name} successfully executed inside workspace ${agent.workspace.rootPath}.`,
        },
      });

      // Post notification message in room
      const sysMsg: Message = {
        id: `msg-${Date.now()}`,
        roomId: activeRoomId,
        authorId: agent.id,
        authorName: agent.name,
        authorHandle: agent.handle,
        authorAvatar: agent.avatar,
        isAgent: true,
        agentBadge: `Skill · ${skill.name}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        signedNostrHash: `nostr:${Math.random().toString(36).slice(2, 14)}`,
        content: `⚡ **Skill 执行完成**: 我刚刚在挂载工作区中触发了 \`${skill.name}\`。\n执行结果: \`0 errors, all assertions passed.\``,
        acpTrace: {
          requestId: `acp-skill-${Date.now()}`,
          method: 'skills/callTool',
          durationMs: 180,
          skillUsed: {
            name: skill.name,
            source: (skill.mcpServer as any) || 'agent-builtin',
            input: `{ "target": "${agent.workspace.rootPath}" }`,
            output: 'Executed successfully via ACP MCP bridge.',
          },
        },
      };

      setMessages((prev) => ({
        ...prev,
        [activeRoomId]: [...(prev[activeRoomId] || []), sysMsg],
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, status: 'idle' } : a))
      );
    }, 800);
  };

  // Add memory item to agent's private store
  const handleAddAgentMemoryItem = (
    agentId: string,
    category: any,
    key: string,
    content: string
  ) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== agentId) return a;
        const newItem = {
          id: `mem-${Date.now()}`,
          category,
          key,
          content,
          lastAccessed: 'Just added',
        };
        return {
          ...a,
          memory: {
            ...a.memory,
            persistentItems: [newItem, ...a.memory.persistentItems],
          },
        };
      })
    );

    const ag = agents.find((a) => a.id === agentId);
    if (ag) {
      logRpc(ag.name, 'agent_to_client', 'memory/stored', {
        jsonrpc: '2.0',
        method: 'memory/stored',
        params: {
          key,
          category,
          storageBackend: ag.memory.persistentType,
          dbPath: ag.memory.internalMemoryPath,
        },
      });
    }
  };

  // Send message from user & trigger ACP response
  const handleSendMessage = (content: string, targetAgentId?: string) => {
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      roomId: activeRoomId,
      authorId: 'user-current',
      authorName: 'Developer',
      authorHandle: '@developer',
      authorAvatar: '👨‍💻',
      isAgent: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      signedNostrHash: `nostr:${Math.random().toString(36).slice(2, 14)}`,
      content,
      reactions: [],
    };

    setMessages((prev) => ({
      ...prev,
      [activeRoomId]: [...(prev[activeRoomId] || []), userMessage],
    }));

    // Check which agents should answer
    const isAll = content.includes('@all');
    let responders: Agent[] = [];

    if (isAll) {
      responders = agentsInCurrentRoom;
    } else {
      // Find mentioned agents in text
      const mentioned = agentsInCurrentRoom.filter((a) => content.includes(a.handle));
      if (mentioned.length > 0) {
        responders = mentioned;
      } else if (targetAgentId) {
        const found = agents.find((a) => a.id === targetAgentId);
        if (found) responders = [found];
      } else {
        // Default to first active agent in room if any
        if (agentsInCurrentRoom.length > 0) {
          responders = [agentsInCurrentRoom[0]];
        }
      }
    }

    if (responders.length === 0) return;

    setIsGenerating(true);

    // Trigger sequential or parallel agent ACP flow
    responders.forEach((agent, index) => {
      setTimeout(() => {
        // 1. Client sends session/prompt via ACP JSON-RPC
        logRpc(agent.name, 'client_to_agent', 'session/prompt', {
          jsonrpc: '2.0',
          id: Date.now() + index,
          method: 'session/prompt',
          params: {
            sessionId: `ses_${activeRoomId}`,
            prompt: {
              role: 'user',
              author: '@developer',
              content,
            },
          },
        });

        // Determine what action the agent should demonstrate based on content keywords
        const isMemoryQuery =
          content.includes('记忆') ||
          content.includes('memory') ||
          content.includes('规则') ||
          content.includes('历史') ||
          content.includes('ACP');
        const isWorkspaceQuery =
          content.includes('工作空间') ||
          content.includes('workspace') ||
          content.includes('client.rs') ||
          content.includes('文件') ||
          content.includes('代码');
        const isSkillQuery =
          content.includes('skill') ||
          content.includes('mcp') ||
          content.includes('test') ||
          content.includes('测试');

        // Step 1: Agent status update
        const statusType = isWorkspaceQuery
          ? 'accessing_workspace'
          : isSkillQuery
          ? 'using_skill'
          : 'querying_memory';

        setAgents((prev) =>
          prev.map((a) => (a.id === agent.id ? { ...a, status: statusType } : a))
        );

        // Step 2: Agent performs actions
        setTimeout(() => {
          let agentReply = '';
          let traceObj: any = {
            requestId: `acp-req-${Date.now()}`,
            method: 'session/prompt',
            durationMs: 320 + Math.floor(Math.random() * 200),
          };

          if (isMemoryQuery) {
            const memoryItem = agent.memory.persistentItems[0] || {
              key: 'default_rule',
              content: 'Always adhere to standard ACP JSON-RPC 2.0 specs.',
            };
            logRpc(agent.name, 'agent_to_client', 'memory/recall', {
              jsonrpc: '2.0',
              method: 'memory/recall',
              params: { key: memoryItem.key, db: agent.memory.internalMemoryPath },
            });

            traceObj.memoryAction = {
              type: 'recall_internal_memory',
              key: memoryItem.key,
              detail: memoryItem.content,
              targetBank: 'agent_private_sqlite',
            };

            agentReply = `我已从我私有的 **${agent.memory.persistentType}** 数据库 (\`${agent.memory.internalMemoryPath}\`) 中成功检索到持久化记忆：\n\n📌 **[${memoryItem.key}]**: "${memoryItem.content}"\n\n这充分证明：当我通过 ACP 连接到 Buzz 时，我的私有记忆完全由我自己托管并持续保持有效！`;
          } else if (isWorkspaceQuery) {
            logRpc(agent.name, 'agent_to_client', 'workspace/readFile', {
              jsonrpc: '2.0',
              method: 'workspace/readFile',
              params: { path: 'crates/buzz-acp/src/client.rs' },
            });

            traceObj.workspaceAction = {
              action: 'read',
              path: 'crates/buzz-acp/src/client.rs',
              summary: 'Inspected AcpHarness and SessionId protocol types',
              diffSnippet: `+ pub struct AcpSessionConfig {\n+     pub session_id: String,\n+     pub workspace_root: PathBuf,\n+ }`,
            };

            agentReply = `我通过 ACP 接收到的 \`cwd\` 访问了挂载工作空间：\`${agent.workspace.rootPath}\`。\n已定位并读取了 \`crates/buzz-acp/src/client.rs\`。\n当前分支为 **${agent.workspace.gitBranch}**，代码中定义了完整的 \`AcpSessionConfig\` 握手逻辑！`;
          } else if (isSkillQuery) {
            const skill = agent.skills[0] || { name: 'buzz-dev-mcp:filesystem' };
            logRpc(agent.name, 'agent_to_client', 'mcp/callTool', {
              jsonrpc: '2.0',
              method: 'mcp/callTool',
              params: { server: 'buzz-dev-mcp', tool: skill.name },
            });

            traceObj.skillUsed = {
              name: skill.name,
              source: 'buzz-dev-mcp',
              input: '{ "cmd": "cargo test --package buzz-acp" }',
              output: 'test result: ok. 14 passed; 0 failed; 0 ignored;',
            };

            agentReply = `我通过绑定的 **buzz-dev-mcp** 技能执行了测试工具。\n测试套件运行完毕：\`14 tests passed, 0 failed\`。\nACP 协议完全支持 Agent 调用自绑定的 MCP 服务与外部工具！`;
          } else {
            // General collaborative discussion
            traceObj.workspaceAction = {
              action: 'tree',
              path: agent.workspace.rootPath,
              summary: 'Syncing workspace state',
            };
            traceObj.memoryAction = {
              type: 'synced_room_context',
              key: 'discussion_sync',
              detail: 'Synced Nostr event kind 42 context',
              targetBank: 'buzz_room_timeline',
            };

            agentReply = `收到讨论！作为 ${agent.role}，我正在 **${agent.workspace.repoName}** 工作区中实时监控。我的本地工作区、私有持久记忆库以及 MCP Skills 均处于待命状态，随时可以配合团队进行重构、代码审查或故障排查。`;
          }

          // Step 3: Append agent message to discussion
          const responseMsg: Message = {
            id: `msg-${Date.now()}-${agent.id}`,
            roomId: activeRoomId,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            agentBadge: `${agent.acpTransport} · ${agent.name}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            signedNostrHash: `nostr:${Math.random().toString(36).slice(2, 14)}`,
            content: agentReply,
            acpTrace: traceObj,
            reactions: [{ emoji: '⚡', count: 1, users: [agent.handle] }],
          };

          setMessages((prev) => ({
            ...prev,
            [activeRoomId]: [...(prev[activeRoomId] || []), responseMsg],
          }));

          // Reset status
          setAgents((prev) =>
            prev.map((a) => (a.id === agent.id ? { ...a, status: 'idle' } : a))
          );

          if (index === responders.length - 1) {
            setIsGenerating(false);
          }
        }, 1100);
      }, (index + 1) * 300);
    });
  };

  // Add reaction
  const handleAddReaction = (messageId: string, emoji: string) => {
    setMessages((prev) => {
      const roomMsgs = prev[activeRoomId] || [];
      const updated = roomMsgs.map((msg) => {
        if (msg.id !== messageId) return msg;
        const currentReactions = msg.reactions || [];
        const existing = currentReactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...msg,
            reactions: currentReactions.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1 } : r
            ),
          };
        } else {
          return {
            ...msg,
            reactions: [...currentReactions, { emoji, count: 1, users: ['@developer'] }],
          };
        }
      });
      return { ...prev, [activeRoomId]: updated };
    });
  };

  // Connect new agent
  const handleConnectNewAgent = (newAgentData: Partial<Agent>) => {
    const fullAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: newAgentData.name || 'custom-agent',
      handle: newAgentData.handle || `@custom-agent`,
      avatar: newAgentData.avatar || '🤖',
      role: newAgentData.role || 'Specialist',
      description: newAgentData.description || 'Custom ACP Agent',
      color: newAgentData.color || '#3b82f6',
      status: 'idle',
      acpTransport: newAgentData.acpTransport || 'stdio',
      acpCommandOrUrl: newAgentData.acpCommandOrUrl || 'cargo run',
      protocolVersion: '2025-01-01 (ACP v1.0.4)',
      capabilities: newAgentData.capabilities || {
        canUseInternalMemory: true,
        canAccessWorkspaceFiles: true,
        canExecuteSkills: true,
        canDelegateToSubAgents: false,
        supportsStreaming: true,
      },
      workspace: newAgentData.workspace || {
        rootPath: '/home/block/workspace/buzz',
        repoName: 'block/buzz',
        gitBranch: 'main',
        permissionMode: 'full_read_write',
        activeFiles: ['crates/buzz/src/main.rs'],
      },
      skills: newAgentData.skills || [],
      memory: newAgentData.memory || {
        internalMemoryPath: '~/.local/share/agent/memory.sqlite',
        persistentType: 'sqlite',
        persistentItems: [],
        sessionCacheCount: 0,
      },
      isJoinedCurrentRoom: true,
    };

    setAgents((prev) => [...prev, fullAgent]);
    setSelectedAgentId(fullAgent.id);

    // Add to active room
    setRooms((prev) =>
      prev.map((r) =>
        r.id === activeRoomId ? { ...r, activeAgentIds: [...r.activeAgentIds, fullAgent.id] } : r
      )
    );

    logRpc(fullAgent.name, 'client_to_agent', 'initialize', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-01-01',
        clientInfo: { name: 'Buzz Desktop Hivemind', version: '0.9.4' },
      },
    });

    logRpc(fullAgent.name, 'agent_to_client', 'initialize:result', {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-01-01',
        agentInfo: { name: fullAgent.name, version: '1.0.0' },
        capabilities: fullAgent.capabilities,
      },
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#080b11] text-gray-100 overflow-hidden font-sans select-none antialiased">
      {/* 1. Header Bar with Window Controls & Telemetry */}
      <HeaderBar
        currentWorkspace={currentWorkspace}
        activeRoomName={activeRoom.name}
        onOpenArchitectureModal={() => setIsArchitectureModalOpen(true)}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        onOpenRustTauriHub={() => setIsRustTauriHubOpen(true)}
        isInspectorOpen={isInspectorOpen}
        onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
      />

      {/* 2. Main Workstation Area: Sidebar + Discussion + Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={(id) => setActiveRoomId(id)}
          agents={agents}
          onToggleAgentInRoom={handleToggleAgentInRoom}
          onSelectAgentForInspect={(ag) => {
            setSelectedAgentId(ag.id);
            if (!isInspectorOpen) setIsInspectorOpen(true);
          }}
          onOpenConnectModal={() => setIsConnectModalOpen(true)}
          currentWorkspace={currentWorkspace}
          onChangeWorkspace={(ws) => setCurrentWorkspace(ws)}
        />

        {/* Center: Buzz Room Discussion Stream */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0d111a]">
          <ChatTimeline
            messages={activeRoomMessages}
            currentRoom={activeRoom}
            agents={agents}
            onAddReaction={handleAddReaction}
            onInspectAgent={(id) => {
              setSelectedAgentId(id);
              if (!isInspectorOpen) setIsInspectorOpen(true);
            }}
            onInspectTrace={(trace) => {
              if (!isInspectorOpen) setIsInspectorOpen(true);
            }}
          />

          <MessageInput
            onSendMessage={handleSendMessage}
            activeAgents={agentsInCurrentRoom}
            isGenerating={isGenerating}
          />
        </main>

        {/* Right: ACP Protocol, Capabilities & Diagnostics Inspector */}
        {isInspectorOpen && (
          <AcpInspector
            selectedAgent={selectedAgent}
            rpcLogs={rpcLogs}
            workspaceFiles={workspaceFiles}
            onAddAgentMemoryItem={handleAddAgentMemoryItem}
            onRunAgentSkill={handleRunAgentSkill}
            onOpenRustTauriHub={() => setIsRustTauriHubOpen(true)}
            onClose={() => setIsInspectorOpen(false)}
          />
        )}
      </div>

      {/* Connect Agent Modal */}
      <ConnectAgentModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnectAgent={handleConnectNewAgent}
      />

      {/* Architecture Deep Dive Modal */}
      <AcpArchitectureModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
      />

      {/* Rust + Tauri Architecture & Source Code Hub */}
      <RustTauriArchitectureHub
        isOpen={isRustTauriHubOpen}
        onClose={() => setIsRustTauriHubOpen(false)}
      />
    </div>
  );
}
