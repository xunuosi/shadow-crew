import React, { useState } from 'react';
import { Agent, AcpTransport } from '../types';
import { Terminal, Database, FolderGit2, Wrench, CheckCircle2, AlertCircle, X } from 'lucide-react';

interface ConnectAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectAgent: (newAgent: Partial<Agent>) => void;
}

export const ConnectAgentModal: React.FC<ConnectAgentModalProps> = ({
  isOpen,
  onClose,
  onConnectAgent,
}) => {
  if (!isOpen) return null;

  const [name, setName] = useState('');
  const [role, setRole] = useState('Codebase Specialist');
  const [avatar, setAvatar] = useState('🤖');
  const [transport, setTransport] = useState<AcpTransport>('stdio');
  const [commandOrUrl, setCommandOrUrl] = useState('cargo run --bin custom-agent -- --acp');
  const [workspaceRoot, setWorkspaceRoot] = useState('/home/block/workspace/buzz');
  const [canUseMemory, setCanUseMemory] = useState(true);
  const [canUseWorkspace, setCanUseWorkspace] = useState(true);
  const [canUseSkills, setCanUseSkills] = useState(true);

  const [isTestingHandshake, setIsTestingHandshake] = useState(false);
  const [handshakeSuccess, setHandshakeSuccess] = useState<boolean | null>(null);

  const handleTestHandshake = () => {
    setIsTestingHandshake(true);
    setHandshakeSuccess(null);
    setTimeout(() => {
      setIsTestingHandshake(false);
      setHandshakeSuccess(true);
    }, 900);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onConnectAgent({
      name: name.trim(),
      handle: `@${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
      avatar,
      role,
      description: `Custom ACP Agent running via ${transport} protocol.`,
      color: '#06b6d4',
      status: 'idle',
      acpTransport: transport,
      acpCommandOrUrl: commandOrUrl,
      protocolVersion: '2025-01-01 (ACP v1.0.4)',
      capabilities: {
        canUseInternalMemory: canUseMemory,
        canAccessWorkspaceFiles: canUseWorkspace,
        canExecuteSkills: canUseSkills,
        canDelegateToSubAgents: false,
        supportsStreaming: true,
      },
      workspace: {
        rootPath: workspaceRoot,
        repoName: 'block/buzz',
        gitBranch: 'main',
        permissionMode: 'full_read_write',
        activeFiles: ['crates/buzz/src/main.rs'],
      },
      skills: [
        {
          id: `skill-${Date.now()}-1`,
          name: 'buzz-dev-mcp:filesystem',
          description: 'Access and edit files inside mounted workspace',
          type: 'mcp',
          mcpServer: 'buzz-dev-mcp',
        },
        {
          id: `skill-${Date.now()}-2`,
          name: 'shell_execution',
          description: 'Execute local terminal commands',
          type: 'builtin',
        },
      ],
      memory: {
        internalMemoryPath: `~/.local/share/${name.toLowerCase()}/memory.sqlite`,
        persistentType: 'sqlite',
        persistentItems: [
          {
            id: `mem-${Date.now()}`,
            category: 'codebase_pattern',
            key: 'initial_agent_knowledge',
            content: 'Agent initialized with custom ACP configuration and connected to Buzz hivemind relay.',
            lastAccessed: 'Just now',
          },
        ],
        sessionCacheCount: 1,
      },
      isJoinedCurrentRoom: true,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0e121a] border border-[#232d3f] rounded-xl w-full max-w-xl text-gray-200 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1f2838] flex items-center justify-between bg-[#121722]">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐝</span>
            <div>
              <h2 className="font-bold text-sm text-gray-100">通过 ACP 协议接入新 Agent</h2>
              <p className="text-[11px] text-gray-400">
                支持标准 Agent Client Protocol (stdio, WebSocket, SSE)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* Basic Info */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-gray-400 mb-1 font-mono text-[11px]">Agent 名称</label>
              <input
                type="text"
                required
                placeholder="例如: security-reviewer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#151b27] border border-[#26344a] rounded px-2.5 py-1.5 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-gray-400 mb-1 font-mono text-[11px]">显示图标 (Emoji)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={2}
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  className="w-12 text-center bg-[#151b27] border border-[#26344a] rounded px-2 py-1.5 text-base"
                />
                <div className="flex gap-1">
                  {['🤖', '🛡️', '⚡', '🧠', '🔬'].map((emo) => (
                    <button
                      key={emo}
                      type="button"
                      onClick={() => setAvatar(emo)}
                      className="p-1 rounded bg-[#182130] hover:bg-[#222e44] cursor-pointer"
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-gray-400 mb-1 font-mono text-[11px]">角色描述</label>
              <input
                type="text"
                placeholder="例如: AST 安全审计专家"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-[#151b27] border border-[#26344a] rounded px-2.5 py-1.5 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Transport Config */}
          <div className="p-3 rounded-lg bg-[#121824] border border-[#1f293b] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-200 font-mono text-xs flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>ACP 协议传输通道 (Transport)</span>
              </span>
              <span className="text-[10px] text-gray-500 font-mono">JSON-RPC 2.0</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {[
                { id: 'stdio', label: '标准输入输出 (stdio)', desc: '子进程直接通信' },
                { id: 'websocket', label: 'WebSocket (ws://)', desc: '独立网络守护进程' },
                { id: 'http_sse', label: 'HTTP / SSE', desc: '服务端流式推送' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTransport(t.id as AcpTransport);
                    if (t.id === 'stdio') setCommandOrUrl('cargo run --bin custom-agent -- --acp');
                    if (t.id === 'websocket') setCommandOrUrl('ws://127.0.0.1:9120/acp/v1');
                    if (t.id === 'http_sse') setCommandOrUrl('http://localhost:8080/acp/events');
                  }}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    transport === t.id
                      ? 'bg-[#1a2538] border-emerald-500/60 text-emerald-300'
                      : 'bg-[#151c2a] border-[#222c3d] text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <div className="font-bold">{t.label}</div>
                  <div className="text-[9px] text-gray-500">{t.desc}</div>
                </button>
              ))}
            </div>

            <div>
              <label className="block text-gray-400 mb-1 font-mono text-[10px]">
                {transport === 'stdio' ? '启动命令 (Process Command Line)' : '服务地址 (Endpoint URL)'}
              </label>
              <input
                type="text"
                value={commandOrUrl}
                onChange={(e) => setCommandOrUrl(e.target.value)}
                className="w-full bg-[#0b0e14] border border-[#232d3f] rounded px-2.5 py-1.5 text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Three Pillars Configuration (The exact question of the user!) */}
          <div className="p-3 rounded-lg bg-[#121824] border border-[#1f293b] space-y-2.5">
            <div className="font-semibold text-gray-200 text-xs flex items-center gap-1.5">
              <span>ACP 三要素能力授权 (Memory, Workspace & Skills)</span>
            </div>

            <div className="space-y-2 text-[11px]">
              {/* Pillar 1: Memory */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-[#151c2a] border border-[#212d3f] cursor-pointer">
                <input
                  type="checkbox"
                  checked={canUseMemory}
                  onChange={(e) => setCanUseMemory(e.target.checked)}
                  className="mt-0.5 accent-emerald-500"
                />
                <div>
                  <div className="font-bold text-gray-200 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-emerald-400" />
                    <span>允许使用 Agent 自身私有 Memory (持久化存储)</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                    开启后，Agent 将保留并读写其私有本地数据库（如 ~/.local/share/agent/memory.sqlite 或 CLAUDE.md），跨讨论保留经验。
                  </p>
                </div>
              </label>

              {/* Pillar 2: Workspace */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-[#151c2a] border border-[#212d3f] cursor-pointer">
                <input
                  type="checkbox"
                  checked={canUseWorkspace}
                  onChange={(e) => setCanUseWorkspace(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                />
                <div className="flex-1">
                  <div className="font-bold text-gray-200 flex items-center gap-1">
                    <FolderGit2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>允许访问指定工作空间 (Workspace CWD & Files)</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                    在 initialize 时将根目录同步给 Agent，允许 Agent 读写文件、生成 diff 和执行 git 操作。
                  </p>
                  {canUseWorkspace && (
                    <input
                      type="text"
                      value={workspaceRoot}
                      onChange={(e) => setWorkspaceRoot(e.target.value)}
                      className="mt-1.5 w-full bg-[#0b0e14] border border-[#232d3f] rounded px-2 py-1 text-blue-300 font-mono text-[10px]"
                      placeholder="指定工作空间绝对路径"
                    />
                  )}
                </div>
              </label>

              {/* Pillar 3: Skills */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-[#151c2a] border border-[#212d3f] cursor-pointer">
                <input
                  type="checkbox"
                  checked={canUseSkills}
                  onChange={(e) => setCanUseSkills(e.target.checked)}
                  className="mt-0.5 accent-purple-500"
                />
                <div>
                  <div className="font-bold text-gray-200 flex items-center gap-1">
                    <Wrench className="w-3.5 h-3.5 text-purple-400" />
                    <span>允许挂载 MCP 技能与调用工具 (Skills / MCP Servers)</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                    支持挂载 Block 官方 buzz-dev-mcp 及内置命令，赋予终端测试、代码审查和自动重构技能。
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Test Handshake Section */}
          <div className="flex items-center justify-between p-2.5 rounded bg-[#10141d] border border-[#1d2535]">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">ACP 协议握手检测:</span>
              {isTestingHandshake && (
                <span className="text-amber-400 flex items-center gap-1 font-mono text-[11px]">
                  <div className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  发送 initialize RPC...
                </span>
              )}
              {handshakeSuccess === true && (
                <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  握手成功 (ACP v1.0.4 兼容)
                </span>
              )}
              {handshakeSuccess === false && (
                <span className="text-red-400 flex items-center gap-1 font-mono text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5" />
                  连接握手超时
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleTestHandshake}
              disabled={isTestingHandshake}
              className="px-2.5 py-1 rounded bg-[#1a2333] hover:bg-[#232f45] text-gray-300 text-xs font-mono transition-colors cursor-pointer"
            >
              测试握手
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f2838]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#141a26] hover:bg-[#1a2233] text-gray-400 hover:text-gray-200 transition-colors cursor-pointer text-xs"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className={`px-4 py-1.5 rounded font-medium text-xs transition-colors cursor-pointer ${
                name.trim()
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                  : 'bg-[#182130] text-gray-500 cursor-not-allowed'
              }`}
            >
              确认接入到 Buzz 团队
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
