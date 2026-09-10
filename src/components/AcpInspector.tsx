import React, { useState } from 'react';
import { Agent, AcpRpcLog, WorkspaceFile } from '../types';
import { 
  Terminal, 
  Database, 
  FolderGit2, 
  Wrench, 
  Code, 
  Copy, 
  Check, 
  Plus, 
  Sparkles, 
  BookOpen, 
  FileText, 
  Cpu,
  Layers,
  ArrowRight,
  Server
} from 'lucide-react';

interface AcpInspectorProps {
  selectedAgent: Agent;
  rpcLogs: AcpRpcLog[];
  workspaceFiles: WorkspaceFile[];
  onAddAgentMemoryItem: (agentId: string, category: any, key: string, content: string) => void;
  onRunAgentSkill: (agentId: string, skillId: string) => void;
  onOpenRustTauriHub?: () => void;
  onClose: () => void;
}

export const AcpInspector: React.FC<AcpInspectorProps> = ({
  selectedAgent,
  rpcLogs,
  workspaceFiles,
  onAddAgentMemoryItem,
  onRunAgentSkill,
  onOpenRustTauriHub,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'rust_tauri' | 'memory' | 'workspace' | 'skills' | 'rpc_logs'>('rust_tauri');
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  // New Memory Item Form State
  const [newMemKey, setNewMemKey] = useState('');
  const [newMemContent, setNewMemContent] = useState('');
  const [newMemCategory, setNewMemCategory] = useState<'codebase_pattern' | 'user_preference' | 'incident_history' | 'skill_rule'>('codebase_pattern');

  // Selected file preview
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(
    workspaceFiles[0]?.children?.[0]?.children?.[1] || null // client.rs
  );

  const handleCopyLog = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLogId(id);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const handleCreateMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemKey.trim() || !newMemContent.trim()) return;
    onAddAgentMemoryItem(selectedAgent.id, newMemCategory, newMemKey.trim(), newMemContent.trim());
    setNewMemKey('');
    setNewMemContent('');
  };

  return (
    <aside
      id="buzz-acp-inspector"
      className="w-96 bg-[#0a0d14] border-l border-[#1b2230] flex flex-col shrink-0 text-gray-300 text-xs overflow-hidden select-none"
    >
      {/* Inspector Header */}
      <div className="p-3 border-b border-[#1b2230] bg-[#0e121b] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-gray-200">ACP 协议与能力检查器</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40">
            {selectedAgent.name}
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 px-1 text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1b2230] bg-[#0b0e16] text-[11px] font-mono overflow-x-auto">
        <button
          onClick={() => setActiveTab('rust_tauri')}
          className={`flex-1 min-w-[75px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'rust_tauri'
              ? 'border-orange-400 text-orange-300 bg-[#141926]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Rust+Tauri
        </button>
        <button
          onClick={() => setActiveTab('architecture')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'architecture'
              ? 'border-indigo-400 text-indigo-300 bg-[#121724]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          原理解答
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'memory'
              ? 'border-emerald-400 text-emerald-300 bg-[#121724]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          私有Memory
        </button>
        <button
          onClick={() => setActiveTab('workspace')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'workspace'
              ? 'border-blue-400 text-blue-300 bg-[#121724]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          工作区
        </button>
        <button
          onClick={() => setActiveTab('skills')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'skills'
              ? 'border-purple-400 text-purple-300 bg-[#121724]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Skills
        </button>
        <button
          onClick={() => setActiveTab('rpc_logs')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'rpc_logs'
              ? 'border-amber-400 text-amber-300 bg-[#121724]'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          RPC日志
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {/* TAB 0: RUST + TAURI RUNTIME & ARCHITECTURE */}
        {activeTab === 'rust_tauri' && (
          <div className="space-y-3 font-sans">
            {/* Banner */}
            <div className="p-2.5 rounded bg-orange-950/40 border border-orange-800/40 text-orange-200">
              <div className="font-bold text-xs text-orange-300 flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm">🦀</span>
                  <span>Tauri v2 + Rust Axum 运行时宿主</span>
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-orange-900 text-orange-200">
                  Tokio Process
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-orange-200/90 font-sans">
                客户端通过 Tauri 内核的 Rust Tokio 异步多线程接管 Agent 的标准输入输出 (stdio)；服务端由 Axum 提供微秒级 Nostr Relay 事件总线。
              </p>
            </div>

            {/* Quick Open Architecture Suite Button */}
            {onOpenRustTauriHub && (
              <button
                onClick={onOpenRustTauriHub}
                className="w-full py-2 px-3 rounded bg-gradient-to-r from-orange-900/70 to-amber-900/60 border border-orange-700/50 hover:from-orange-800/80 hover:to-amber-800/70 text-white font-semibold text-xs transition-colors flex items-center justify-between cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-orange-300" />
                  <span>打开完整 Rust + Tauri 架构总览与源码</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-orange-300" />
              </button>
            )}

            {/* Tauri IPC Telemetry */}
            <div className="p-2.5 rounded bg-[#10141f] border border-[#1f2838] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-gray-200 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  Tauri IPC 管道与内存监控
                </span>
                <span className="text-emerald-400 text-[10px]">Zero-Copy Channel</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded bg-[#090b10] border border-[#1a2130]">
                  <div className="text-gray-400">Tauri 内存占用</div>
                  <div className="text-sm font-bold text-blue-400 mt-0.5">34.8 MB</div>
                  <div className="text-gray-500 text-[9px]">比 Electron 节省 92%</div>
                </div>
                <div className="p-2 rounded bg-[#090b10] border border-[#1a2130]">
                  <div className="text-gray-400">IPC 流式往返</div>
                  <div className="text-sm font-bold text-emerald-400 mt-0.5">0.14 ms</div>
                  <div className="text-gray-500 text-[9px]">二进制/JSON 快速反序列化</div>
                </div>
              </div>
            </div>

            {/* Agent Stdio Child Process Details */}
            <div className="p-2.5 rounded bg-[#10141f] border border-[#1f2838] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-gray-200 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Agent 进程守护 (tokio::process)
                </span>
                <span className="text-blue-400 text-[10px]">PID: 41920</span>
              </div>
              <div className="text-[11px] font-mono text-gray-300 space-y-1 bg-[#090b10] p-2 rounded border border-[#1a2130]">
                <div><span className="text-gray-500">启动指令: </span><span className="text-emerald-400">{selectedAgent.acpCommandOrUrl}</span></div>
                <div><span className="text-gray-500">工作目录: </span><span className="text-gray-300">{selectedAgent.workspace.rootPath}</span></div>
                <div><span className="text-gray-500">stdio 管道: </span><span className="text-blue-300">stdin(write) / stdout(stream lines)</span></div>
                <div><span className="text-gray-500">沙盒校验: </span><span className="text-emerald-300">Path traversal protection active</span></div>
              </div>
            </div>

            {/* Rust Server Relay Status */}
            <div className="p-2.5 rounded bg-[#10141f] border border-[#1f2838] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-gray-200 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-orange-400" />
                  Rust Axum Nostr Relay 服务端
                </span>
                <span className="text-emerald-400 text-[10px]">ws://127.0.0.1:8080</span>
              </div>
              <div className="text-[11px] font-mono text-gray-300 space-y-1 bg-[#090b10] p-2 rounded border border-[#1a2130]">
                <div><span className="text-gray-500">协议规范: </span><span className="text-orange-300">Nostr Kind 42 (Channel Event)</span></div>
                <div><span className="text-gray-500">广播通道: </span><span className="text-gray-300">tokio::sync::broadcast (128 cap)</span></div>
                <div><span className="text-gray-500">签名算法: </span><span className="text-emerald-300">secp256k1 schnorr verified</span></div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: ARCHITECTURE & DETAILED ANSWER TO USER'S QUESTION */}
        {activeTab === 'architecture' && (
          <div className="space-y-3 font-sans">
            <div className="p-2.5 rounded bg-indigo-950/40 border border-indigo-800/40 text-indigo-200">
              <div className="font-bold text-sm text-indigo-300 flex items-center gap-1.5 mb-1">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                <span>技术核心解答：ACP 接入后能用自有的 Memory、Workspace 和 Skill 吗？</span>
              </div>
              <p className="text-[11px] leading-relaxed text-indigo-200/90">
                <strong>结论：完全可以，而且这正是 ACP (Agent Client Protocol) 的核心设计哲学！</strong>
              </p>
            </div>

            {/* Pillar 1: Memory */}
            <div className="p-3 rounded bg-[#111622] border border-[#212c3e] space-y-1.5">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                <Database className="w-4 h-4" />
                <span>1. Agent 自身的 Memory（记忆机制）</span>
              </div>
              <div className="text-[11px] text-gray-300 leading-relaxed">
                ACP 并不限制 Agent 的私有存储实现。当通过 stdio/websocket 连接时：
                <ul className="list-disc list-inside mt-1 space-y-1 text-gray-400 text-[10px]">
                  <li>
                    <strong className="text-gray-200">私有长期记忆 (Private Memory):</strong> Agent 拥有自己的持久化后端（如 SQLite、Markdown 记忆库、本地向量库 Mem0）。只要连接同一个 agent runtime，其历史经验跨讨论依然有效。
                  </li>
                  <li>
                    <strong className="text-gray-200">房间共享讨论上下文 (Room Context):</strong> Buzz 会在每次触发 prompt 时，把当前房间内的 Nostr 签名消息切片通过 ACP 的 <code className="text-emerald-300 font-mono">session/prompt</code> 传给 Agent，两者互不冲突。
                  </li>
                </ul>
              </div>
            </div>

            {/* Pillar 2: Workspace */}
            <div className="p-3 rounded bg-[#111622] border border-[#212c3e] space-y-1.5">
              <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-xs">
                <FolderGit2 className="w-4 h-4" />
                <span>2. Agent 的工作空间 (Workspace)</span>
              </div>
              <div className="text-[11px] text-gray-300 leading-relaxed">
                在 ACP 协议初始化与新建会话时（<code className="text-blue-300 font-mono text-[10px]">initialize</code> 与 <code className="text-blue-300 font-mono text-[10px]">session/new</code>）：
                <ul className="list-disc list-inside mt-1 space-y-1 text-gray-400 text-[10px]">
                  <li>
                    Client 会向 Agent 传递 <code className="text-blue-300 font-mono">cwd</code>（工作目录根路径）与 <code className="text-blue-300 font-mono">workspaceRoots</code>。
                  </li>
                  <li>
                    Agent 进程作为独立执行单元（如 <code className="text-blue-300 font-mono">buzz-agent</code> 或 Claude Code），可直接读取和编辑本地挂载代码库，也可以通过 ACP 发起文件读写请求。
                  </li>
                </ul>
              </div>
            </div>

            {/* Pillar 3: Skills */}
            <div className="p-3 rounded bg-[#111622] border border-[#212c3e] space-y-1.5">
              <div className="flex items-center gap-1.5 text-purple-400 font-semibold text-xs">
                <Wrench className="w-4 h-4" />
                <span>3. Agent 的 Skill（技能与工具调用）</span>
              </div>
              <div className="text-[11px] text-gray-300 leading-relaxed">
                ACP 具备双向工具与能力协商机制（Capabilities Negotiation）：
                <ul className="list-disc list-inside mt-1 space-y-1 text-gray-400 text-[10px]">
                  <li>
                    <strong className="text-gray-200">内置/MCP 技能：</strong> Agent 可以自挂载 MCP Server（例如 Block 官方的 <code className="text-purple-300 font-mono">buzz-dev-mcp</code>），提供终端 Shell、Git 分支合并、文件 AST 检索。
                  </li>
                  <li>
                    <strong className="text-gray-200">客户端委托技能：</strong> 客户端也可向 Agent 声明可用工具，通过 JSON-RPC 双向互相调用。
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#131a26] border border-[#233045] text-center">
              <span className="text-[11px] text-gray-300 font-medium">👉 点击上方其他标签，可实时检查与配置当前选中的 Agent</span>
            </div>
          </div>
        )}

        {/* TAB 2: AGENT INTERNAL MEMORY BANK */}
        {activeTab === 'memory' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-[#111622] border border-[#1f283a]">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-gray-400">存储格式:</span>
                <span className="font-mono text-emerald-400 uppercase font-bold">{selectedAgent.memory.persistentType}</span>
              </div>
              <div className="text-[10px] text-gray-500 font-mono break-all">
                路径: {selectedAgent.memory.internalMemoryPath}
              </div>
            </div>

            {/* Add Memory Form */}
            <form onSubmit={handleCreateMemory} className="p-2.5 rounded bg-[#131926] border border-[#253247] space-y-2">
              <div className="font-semibold text-gray-200 text-[11px] flex items-center gap-1">
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>写入一条新记忆到 Agent 数据库</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <select
                  value={newMemCategory}
                  onChange={(e: any) => setNewMemCategory(e.target.value)}
                  className="bg-[#0b0e14] border border-[#222d40] rounded p-1 text-gray-300"
                >
                  <option value="codebase_pattern">工程架构规则</option>
                  <option value="user_preference">用户偏好规则</option>
                  <option value="incident_history">历史事故经验</option>
                  <option value="skill_rule">技能执行约束</option>
                </select>
                <input
                  type="text"
                  placeholder="记忆检索 Key"
                  value={newMemKey}
                  onChange={(e) => setNewMemKey(e.target.value)}
                  className="bg-[#0b0e14] border border-[#222d40] rounded p-1 text-gray-300 placeholder-gray-600 font-mono"
                />
              </div>
              <textarea
                placeholder="具体的记忆内容（例如：团队发布前必须跑一遍 cargo test）"
                value={newMemContent}
                onChange={(e) => setNewMemContent(e.target.value)}
                rows={2}
                className="w-full bg-[#0b0e14] border border-[#222d40] rounded p-1.5 text-gray-300 placeholder-gray-600 text-[11px]"
              />
              <button
                type="submit"
                className="w-full py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-[11px] transition-colors cursor-pointer"
              >
                持久化存入 Agent Memory
              </button>
            </form>

            {/* Current Memory Items List */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase text-gray-500 font-mono">
                已持久化记忆列表 ({selectedAgent.memory.persistentItems.length})
              </div>
              {selectedAgent.memory.persistentItems.map((item) => (
                <div key={item.id} className="p-2 rounded bg-[#111724] border border-[#1e273a] text-[11px]">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-mono text-emerald-300 font-bold">[{item.key}]</span>
                    <span className="text-gray-500 font-mono">{item.lastAccessed}</span>
                  </div>
                  <div className="text-gray-300 text-[11px]">{item.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: WORKSPACE EXPLORER */}
        {activeTab === 'workspace' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-[#111622] border border-[#1f283a]">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-gray-400">工作空间根目录:</span>
                <span className="font-mono text-blue-400">{selectedAgent.workspace.rootPath}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                <span>Git 分支: <b className="text-gray-200">{selectedAgent.workspace.gitBranch}</b></span>
                <span className="text-emerald-400 font-bold">{selectedAgent.workspace.permissionMode}</span>
              </div>
            </div>

            {/* Files List */}
            <div className="border border-[#1f283a] rounded bg-[#0b0e14] p-2 space-y-1 text-[11px] font-mono">
              <div className="text-[10px] text-gray-500 uppercase mb-1">代码库目录树 (Block Buzz Repo)</div>
              {workspaceFiles[0]?.children?.map((crate) => (
                <div key={crate.path} className="pl-1">
                  <div className="text-gray-400 font-bold flex items-center gap-1">
                    📁 {crate.name}
                  </div>
                  <div className="pl-3 space-y-0.5 mt-0.5">
                    {crate.children?.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => setPreviewFile(file)}
                        className={`w-full text-left px-1.5 py-0.5 rounded flex items-center justify-between cursor-pointer ${
                          previewFile?.path === file.path
                            ? 'bg-[#1b2538] text-emerald-300'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-[#121824]'
                        }`}
                      >
                        <span className="truncate">📄 {file.name}</span>
                        <span className="text-[9px] text-gray-600">{file.size}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* File Preview */}
            {previewFile && (
              <div className="border border-[#1f283a] rounded bg-[#0b0e14] overflow-hidden">
                <div className="px-2 py-1 bg-[#131926] border-b border-[#1f283a] text-[10px] font-mono text-gray-300 flex items-center justify-between">
                  <span>预览: {previewFile.path}</span>
                  <span className="text-emerald-400">只读映射</span>
                </div>
                <pre className="p-2 text-[10px] font-mono text-gray-300 overflow-x-auto max-h-48 leading-relaxed">
                  {previewFile.content || '// 文件内容加载中...'}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SKILLS & MCP TOOLS */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-[#111622] border border-[#1f283a] text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-400">已装载技能总数:</span>
                <span className="font-mono text-purple-400 font-bold">{selectedAgent.skills.length} 项</span>
              </div>
              <div className="text-[10px] text-gray-500">
                支持 Built-in 协议工具及标准 MCP (Model Context Protocol) 桥接
              </div>
            </div>

            <div className="space-y-2">
              {selectedAgent.skills.map((skill) => (
                <div key={skill.id} className="p-2.5 rounded bg-[#121824] border border-[#202c3e] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-gray-200 text-xs">
                      <Wrench className="w-3.5 h-3.5 text-purple-400" />
                      <span>{skill.name}</span>
                    </div>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[#1b2538] text-purple-300 uppercase">
                      {skill.type}
                    </span>
                  </div>

                  <div className="text-gray-400 text-[11px]">
                    {skill.description}
                  </div>

                  {skill.mcpServer && (
                    <div className="text-[10px] text-gray-500 font-mono">
                      MCP Server 来源: <span className="text-purple-300">{skill.mcpServer}</span>
                    </div>
                  )}

                  <button
                    onClick={() => onRunAgentSkill(selectedAgent.id, skill.id)}
                    className="w-full mt-1 py-1 rounded bg-[#192233] hover:bg-purple-900/40 text-purple-300 border border-purple-800/40 text-[10px] font-mono transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>⚡ 触发此 Skill 测试 (Trigger RPC)</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: RAW JSON-RPC 2.0 LOGS */}
        {activeTab === 'rpc_logs' && (
          <div className="space-y-2 font-mono text-[10px]">
            <div className="flex items-center justify-between text-gray-500 mb-1">
              <span>实时 ACP 消息帧 (共 {rpcLogs.length} 条)</span>
              <span className="text-emerald-400">JSON-RPC 2.0</span>
            </div>

            {rpcLogs.map((log) => {
              const isOut = log.direction === 'client_to_agent';
              const jsonStr = JSON.stringify(log.payload, null, 2);

              return (
                <div
                  key={log.id}
                  className={`p-2 rounded border ${
                    isOut
                      ? 'bg-[#101622] border-blue-900/40'
                      : 'bg-[#111b1c] border-emerald-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 text-[9px]">
                    <span className={isOut ? 'text-blue-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {isOut ? '--> CLIENT → AGENT' : '<-- AGENT → CLIENT'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">{log.timestamp}</span>
                      <button
                        onClick={() => handleCopyLog(log.id, jsonStr)}
                        className="text-gray-400 hover:text-white cursor-pointer"
                        title="复制 JSON"
                      >
                        {copiedLogId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-gray-300 font-bold mb-1">
                    方法: <span className="text-amber-300">{log.method}</span>
                  </div>
                  <pre className="p-1.5 rounded bg-[#07090e] text-gray-300 overflow-x-auto text-[9px] max-h-36 leading-tight">
                    {jsonStr}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
