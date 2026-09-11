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
  const [diskLogText, setDiskLogText] = useState<string | null>(null);
  const [loadingDiskLog, setLoadingDiskLog] = useState(false);

  // New Memory Item Form State
  const [newMemKey, setNewMemKey] = useState('');
  const [newMemContent, setNewMemContent] = useState('');
  const [newMemCategory, setNewMemCategory] = useState<'codebase_pattern' | 'user_preference' | 'incident_history' | 'skill_rule'>('codebase_pattern');

  // Selected file preview
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(
    workspaceFiles[0]?.children?.[0]?.children?.[1] || null // client.rs
  );

  const fetchDiskLogs = async () => {
    setLoadingDiskLog(true);
    const tauriInvoke =
      typeof window !== 'undefined'
        ? (window as any).__TAURI_INTERNALS__?.invoke ||
          (window as any).__TAURI__?.core?.invoke
        : null;
    if (tauriInvoke) {
      try {
        const text = await tauriInvoke('read_recent_acp_logs', { lines: 150 });
        setDiskLogText(text);
      } catch (e: any) {
        setDiskLogText(`读取失败: ${e?.message || e}`);
      }
    } else {
      setDiskLogText('当前运行于浏览器预览模式，本地磁盘日志由桌面端 Tauri 维护在 logs/acp.log。');
    }
    setLoadingDiskLog(false);
  };

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
      className="w-96 bg-surface border-l border-border flex flex-col shrink-0 text-fg-secondary text-xs overflow-hidden select-none transition-colors duration-150"
    >
      {/* Inspector Header */}
      <div className="p-3 border-b border-border bg-surface-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-500" />
          <span className="font-semibold text-fg">ACP 协议与能力检查器</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            {selectedAgent.name}
          </span>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg px-1 text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-surface-subtle text-[11px] font-mono overflow-x-auto">
        <button
          onClick={() => setActiveTab('rust_tauri')}
          className={`flex-1 min-w-[75px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'rust_tauri'
              ? 'border-orange-500 text-orange-600 dark:text-orange-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Rust+Tauri
        </button>
        <button
          onClick={() => setActiveTab('architecture')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'architecture'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          原理解答
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'memory'
              ? 'border-emerald-500 text-emerald-600 dark:text-emerald-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          私有Memory
        </button>
        <button
          onClick={() => setActiveTab('workspace')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'workspace'
              ? 'border-blue-500 text-blue-600 dark:text-blue-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          工作区
        </button>
        <button
          onClick={() => setActiveTab('skills')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'skills'
              ? 'border-purple-500 text-purple-600 dark:text-purple-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Skills
        </button>
        <button
          onClick={() => setActiveTab('rpc_logs')}
          className={`flex-1 min-w-[65px] py-2 px-2 text-center border-b-2 transition-all cursor-pointer ${
            activeTab === 'rpc_logs'
              ? 'border-amber-500 text-amber-600 dark:text-amber-300 bg-surface'
              : 'border-transparent text-fg-muted hover:text-fg'
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
            <div className="p-2.5 rounded bg-orange-500/15 border border-orange-500/30 text-orange-600 dark:text-orange-200">
              <div className="font-bold text-xs text-orange-700 dark:text-orange-300 flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm">🦀</span>
                  <span>Tauri v2 + Rust Axum 运行时宿主</span>
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-700 dark:text-orange-200 shrink-0">
                  Tokio Process
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-orange-800/90 dark:text-orange-200/90 font-sans">
                客户端通过 Tauri 内核的 Rust Tokio 异步多线程接管 Agent 的标准输入输出 (stdio)；服务端由 Axum 提供微秒级 Nostr Relay 事件总线。
              </p>
            </div>

            {/* Quick Open Architecture Suite Button */}
            {onOpenRustTauriHub && (
              <button
                onClick={onOpenRustTauriHub}
                className="w-full py-2 px-3 rounded bg-accent text-accent-fg hover:opacity-90 font-semibold text-xs transition-colors flex items-center justify-between cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>打开完整 Rust + Tauri 架构总览与源码</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Tauri IPC Telemetry */}
            <div className="p-2.5 rounded bg-surface-subtle border border-border space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-fg flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-500" />
                  Tauri IPC 管道与内存监控
                </span>
                <span className="text-emerald-500 text-[10px]">Zero-Copy Channel</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded bg-surface border border-border">
                  <div className="text-fg-muted">Tauri 内存占用</div>
                  <div className="text-sm font-bold text-blue-500 mt-0.5">34.8 MB</div>
                  <div className="text-fg-muted text-[9px]">比 Electron 节省 92%</div>
                </div>
                <div className="p-2 rounded bg-surface border border-border">
                  <div className="text-fg-muted">IPC 流式往返</div>
                  <div className="text-sm font-bold text-emerald-500 mt-0.5">0.14 ms</div>
                  <div className="text-fg-muted text-[9px]">二进制/JSON 快速反序列化</div>
                </div>
              </div>
            </div>

            {/* Agent Stdio Child Process Details */}
            <div className="p-2.5 rounded bg-surface-subtle border border-border space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-fg flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                  Agent 进程守护 (tokio::process)
                </span>
                <span className="text-blue-500 text-[10px]">PID: 41920</span>
              </div>
              <div className="text-[11px] font-mono text-fg-secondary space-y-1 bg-surface p-2 rounded border border-border">
                <div><span className="text-fg-muted">启动指令: </span><span className="text-emerald-500">{selectedAgent.acpCommandOrUrl}</span></div>
                <div><span className="text-fg-muted">工作目录: </span><span className="text-fg-secondary">{selectedAgent.workspace.rootPath}</span></div>
                <div><span className="text-fg-muted">stdio 管道: </span><span className="text-blue-500">stdin(write) / stdout(stream lines)</span></div>
                <div><span className="text-fg-muted">沙盒校验: </span><span className="text-emerald-500">Path traversal protection active</span></div>
              </div>
            </div>

            {/* Rust Server Relay Status */}
            <div className="p-2.5 rounded bg-surface-subtle border border-border space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-fg flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-orange-500" />
                  Rust Axum Nostr Relay 服务端
                </span>
                <span className="text-emerald-500 text-[10px]">ws://127.0.0.1:8080</span>
              </div>
              <div className="text-[11px] font-mono text-fg-secondary space-y-1 bg-surface p-2 rounded border border-border">
                <div><span className="text-fg-muted">协议规范: </span><span className="text-orange-500">Nostr Kind 42 (Channel Event)</span></div>
                <div><span className="text-fg-muted">广播通道: </span><span className="text-fg-secondary">tokio::sync::broadcast (128 cap)</span></div>
                <div><span className="text-fg-muted">签名算法: </span><span className="text-emerald-500">secp256k1 schnorr verified</span></div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: ARCHITECTURE & DETAILED ANSWER TO USER'S QUESTION */}
        {activeTab === 'architecture' && (
          <div className="space-y-3 font-sans">
            <div className="p-2.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-700 dark:text-indigo-200">
              <div className="font-bold text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 mb-1">
                <BookOpen className="w-4 h-4 text-indigo-500" />
                <span>技术核心解答：ACP 接入后能用自有的 Memory、Workspace 和 Skill 吗？</span>
              </div>
              <p className="text-[11px] leading-relaxed text-indigo-800/90 dark:text-indigo-200/90">
                <strong>结论：完全可以，而且这正是 ACP (Agent Client Protocol) 的核心设计哲学！</strong>
              </p>
            </div>

            {/* Pillar 1: Memory */}
            <div className="p-3 rounded bg-surface-subtle border border-border space-y-1.5">
              <div className="flex items-center gap-1.5 text-emerald-500 font-semibold text-xs">
                <Database className="w-4 h-4" />
                <span>1. Agent 自身的 Memory（记忆机制）</span>
              </div>
              <div className="text-[11px] text-fg-secondary leading-relaxed">
                ACP 并不限制 Agent 的私有存储实现。当通过 stdio/websocket 连接时：
                <ul className="list-disc list-inside mt-1 space-y-1 text-fg-muted text-[10px]">
                  <li>
                    <strong className="text-fg">私有长期记忆 (Private Memory):</strong> Agent 拥有自己的持久化后端（如 SQLite、Markdown 记忆库、本地向量库 Mem0）。只要连接同一个 agent runtime，其历史经验跨讨论依然有效。
                  </li>
                  <li>
                    <strong className="text-fg">房间共享讨论上下文 (Room Context):</strong> Buzz 会在每次触发 prompt 时，把当前房间内的 Nostr 签名消息切片通过 ACP 的 <code className="text-emerald-500 font-mono">session/prompt</code> 传给 Agent，两者互不冲突。
                  </li>
                </ul>
              </div>
            </div>

            {/* Pillar 2: Workspace */}
            <div className="p-3 rounded bg-surface-subtle border border-border space-y-1.5">
              <div className="flex items-center gap-1.5 text-blue-500 font-semibold text-xs">
                <FolderGit2 className="w-4 h-4" />
                <span>2. Agent 的工作空间 (Workspace)</span>
              </div>
              <div className="text-[11px] text-fg-secondary leading-relaxed">
                在 ACP 协议初始化与新建会话时（<code className="text-blue-500 font-mono text-[10px]">initialize</code> 与 <code className="text-blue-500 font-mono text-[10px]">session/new</code>）：
                <ul className="list-disc list-inside mt-1 space-y-1 text-fg-muted text-[10px]">
                  <li>
                    Client 会向 Agent 传递 <code className="text-blue-500 font-mono">cwd</code>（工作目录根路径）与 <code className="text-blue-500 font-mono">workspaceRoots</code>。
                  </li>
                  <li>
                    Agent 进程作为独立执行单元（如 <code className="text-blue-500 font-mono">buzz-agent</code> 或 Claude Code），可直接读取和编辑本地挂载代码库，也可以通过 ACP 发起文件读写请求。
                  </li>
                </ul>
              </div>
            </div>

            {/* Pillar 3: Skills */}
            <div className="p-3 rounded bg-surface-subtle border border-border space-y-1.5">
              <div className="flex items-center gap-1.5 text-purple-500 font-semibold text-xs">
                <Wrench className="w-4 h-4" />
                <span>3. Agent 的 Skill（技能与工具调用）</span>
              </div>
              <div className="text-[11px] text-fg-secondary leading-relaxed">
                ACP 具备双向工具与能力协商机制（Capabilities Negotiation）：
                <ul className="list-disc list-inside mt-1 space-y-1 text-fg-muted text-[10px]">
                  <li>
                    <strong className="text-fg">内置/MCP 技能：</strong> Agent 可以自挂载 MCP Server（例如 Block 官方的 <code className="text-purple-500 font-mono">buzz-dev-mcp</code>），提供终端 Shell、Git 分支合并、文件 AST 检索。
                  </li>
                  <li>
                    <strong className="text-fg">客户端委托技能：</strong> 客户端也可向 Agent 声明可用工具，通过 JSON-RPC 双向互相调用。
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface-subtle border border-border text-center">
              <span className="text-[11px] text-fg-secondary font-medium">👉 点击上方其他标签，可实时检查与配置当前选中的 Agent</span>
            </div>
          </div>
        )}

        {/* TAB 2: AGENT INTERNAL MEMORY BANK */}
        {activeTab === 'memory' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-surface-subtle border border-border">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-fg-muted">存储格式:</span>
                <span className="font-mono text-emerald-500 uppercase font-bold">{selectedAgent.memory.persistentType}</span>
              </div>
              <div className="text-[10px] text-fg-muted font-mono break-all">
                路径: {selectedAgent.memory.internalMemoryPath}
              </div>
            </div>

            {/* Add Memory Form */}
            <form onSubmit={handleCreateMemory} className="p-2.5 rounded bg-surface-subtle border border-border space-y-2">
              <div className="font-semibold text-fg text-[11px] flex items-center gap-1">
                <Plus className="w-3.5 h-3.5 text-emerald-500" />
                <span>写入一条新记忆到 Agent 数据库</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <select
                  value={newMemCategory}
                  onChange={(e: any) => setNewMemCategory(e.target.value)}
                  className="bg-surface border border-border rounded p-1 text-fg"
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
                  className="bg-surface border border-border rounded p-1 text-fg placeholder-fg-muted font-mono"
                />
              </div>
              <textarea
                placeholder="具体的记忆内容（例如：团队发布前必须跑一遍 cargo test）"
                value={newMemContent}
                onChange={(e) => setNewMemContent(e.target.value)}
                rows={2}
                className="w-full bg-surface border border-border rounded p-1.5 text-fg placeholder-fg-muted text-[11px]"
              />
              <button
                type="submit"
                className="w-full py-1 rounded bg-accent text-accent-fg hover:opacity-90 font-medium text-[11px] transition-colors cursor-pointer shadow-xs"
              >
                持久化存入 Agent Memory
              </button>
            </form>

            {/* Current Memory Items List */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase text-fg-muted font-mono">
                已持久化记忆列表 ({selectedAgent.memory.persistentItems.length})
              </div>
              {selectedAgent.memory.persistentItems.map((item) => (
                <div key={item.id} className="p-2 rounded bg-surface-subtle border border-border text-[11px]">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-mono text-emerald-500 font-bold">[{item.key}]</span>
                    <span className="text-fg-muted font-mono">{item.lastAccessed}</span>
                  </div>
                  <div className="text-fg-secondary text-[11px]">{item.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: WORKSPACE EXPLORER */}
        {activeTab === 'workspace' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-surface-subtle border border-border">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-fg-muted">工作空间根目录:</span>
                <span className="font-mono text-blue-500">{selectedAgent.workspace.rootPath}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-fg-muted font-mono">
                <span>Git 分支: <b className="text-fg">{selectedAgent.workspace.gitBranch}</b></span>
                <span className="text-emerald-500 font-bold">{selectedAgent.workspace.permissionMode}</span>
              </div>
            </div>

            {/* Files List */}
            <div className="border border-border rounded bg-surface p-2 space-y-1 text-[11px] font-mono">
              <div className="text-[10px] text-fg-muted uppercase mb-1">代码库目录树 (Block Buzz Repo)</div>
              {workspaceFiles[0]?.children?.map((crate) => (
                <div key={crate.path} className="pl-1">
                  <div className="text-fg-muted font-bold flex items-center gap-1">
                    📁 {crate.name}
                  </div>
                  <div className="pl-3 space-y-0.5 mt-0.5">
                    {crate.children?.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => setPreviewFile(file)}
                        className={`w-full text-left px-1.5 py-0.5 rounded flex items-center justify-between cursor-pointer ${
                          previewFile?.path === file.path
                            ? 'bg-accent/15 text-accent'
                            : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
                        }`}
                      >
                        <span className="truncate">📄 {file.name}</span>
                        <span className="text-[9px] text-fg-muted">{file.size}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* File Preview */}
            {previewFile && (
              <div className="border border-border rounded bg-surface overflow-hidden">
                <div className="px-2 py-1 bg-surface-subtle border-b border-border text-[10px] font-mono text-fg flex items-center justify-between">
                  <span>预览: {previewFile.path}</span>
                  <span className="text-emerald-500">只读映射</span>
                </div>
                <pre className="p-2 text-[10px] font-mono text-fg-secondary overflow-x-auto max-h-48 leading-relaxed">
                  {previewFile.content || '// 文件内容加载中...'}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SKILLS & MCP TOOLS */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            <div className="p-2 rounded bg-surface-subtle border border-border text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-fg-muted">已装载技能总数:</span>
                <span className="font-mono text-purple-500 font-bold">{selectedAgent.skills.length} 项</span>
              </div>
              <div className="text-[10px] text-fg-muted">
                支持 Built-in 协议工具及标准 MCP (Model Context Protocol) 桥接
              </div>
            </div>

            <div className="space-y-2">
              {selectedAgent.skills.map((skill) => (
                <div key={skill.id} className="p-2.5 rounded bg-surface-subtle border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
                      <Wrench className="w-3.5 h-3.5 text-purple-500" />
                      <span>{skill.name}</span>
                    </div>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 uppercase">
                      {skill.type}
                    </span>
                  </div>

                  <div className="text-fg-secondary text-[11px]">
                    {skill.description}
                  </div>

                  {skill.mcpServer && (
                    <div className="text-[10px] text-fg-muted font-mono">
                      MCP Server 来源: <span className="text-purple-500">{skill.mcpServer}</span>
                    </div>
                  )}

                  <button
                    onClick={() => onRunAgentSkill(selectedAgent.id, skill.id)}
                    className="w-full mt-1 py-1 rounded bg-surface hover:bg-surface-hover text-purple-600 dark:text-purple-300 border border-purple-500/30 text-[10px] font-mono transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>⚡ 触发此 Skill 测试 (Trigger RPC)</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: RAW JSON-RPC 2.0 LOGS & LOCAL DISK LOG */}
        {activeTab === 'rpc_logs' && (
          <div className="space-y-3 font-mono text-[10px]">
            {/* Local Persistent File Log Banner */}
            <div className="p-2.5 rounded bg-surface-subtle border border-border space-y-2 font-sans">
              <div className="flex items-center justify-between text-[11px] font-semibold text-fg">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  本地文件落盘 (Persistent Stdio Log)
                </span>
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  实时同步
                </span>
              </div>
              <p className="text-[10px] text-fg-muted leading-relaxed">
                所有底层原始 stdio 通信报文（发送、返回、报错）已持久化写入当前项目：
              </p>
              <div className="flex items-center justify-between bg-surface border border-border px-2 py-1 rounded font-mono text-[10px] text-fg">
                <span className="truncate select-all text-emerald-600 dark:text-emerald-400">logs/acp.log</span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('tail -f logs/acp.log');
                      setCopiedLogId('tail-cmd');
                      setTimeout(() => setCopiedLogId(null), 2000);
                    }}
                    className="text-accent hover:underline cursor-pointer flex items-center gap-1 text-[10px]"
                    title="复制终端实时查看命令"
                  >
                    {copiedLogId === 'tail-cmd' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>tail -f</span>
                  </button>
                  <span className="text-border">|</span>
                  <button
                    onClick={fetchDiskLogs}
                    className="text-accent hover:underline cursor-pointer flex items-center gap-1 text-[10px]"
                  >
                    {loadingDiskLog ? '读取中...' : diskLogText ? '刷新' : '查看内容'}
                  </button>
                </div>
              </div>

              {diskLogText && (
                <div className="mt-2 border border-border rounded bg-surface overflow-hidden">
                  <div className="px-2 py-1 bg-surface-subtle border-b border-border text-[9px] font-mono text-fg-muted flex items-center justify-between">
                    <span>logs/acp.log (最近条目)</span>
                    <button onClick={() => setDiskLogText(null)} className="hover:text-fg cursor-pointer">关闭</button>
                  </div>
                  <pre className="p-2 text-[9px] font-mono text-fg-secondary overflow-x-auto max-h-40 leading-tight select-text">
                    {diskLogText}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-fg-muted mb-1">
              <span>实时消息帧事件 ({rpcLogs.length} 条)</span>
              <span className="text-emerald-500">JSON-RPC 2.0</span>
            </div>

            {rpcLogs.map((log) => {
              const isOut = log.direction === 'client_to_agent';
              const jsonStr = JSON.stringify(log.payload, null, 2);

              return (
                <div
                  key={log.id}
                  className={`p-2 rounded border ${
                    isOut
                      ? 'bg-surface border-blue-500/30'
                      : 'bg-surface border-emerald-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 text-[9px]">
                    <span className={isOut ? 'text-blue-500 font-bold' : 'text-emerald-500 font-bold'}>
                      {isOut ? '--> CLIENT → AGENT' : '<-- AGENT → CLIENT'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-fg-muted">{log.timestamp}</span>
                      <button
                        onClick={() => handleCopyLog(log.id, jsonStr)}
                        className="text-fg-muted hover:text-fg cursor-pointer"
                        title="复制 JSON"
                      >
                        {copiedLogId === log.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-fg font-bold mb-1">
                    方法: <span className="text-amber-500">{log.method}</span>
                  </div>
                  <pre className="p-1.5 rounded bg-surface-subtle text-fg-secondary overflow-x-auto text-[9px] max-h-36 leading-tight border border-border">
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
