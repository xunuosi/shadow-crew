import React, { useState } from 'react';
import { 
  X, 
  Cpu, 
  Terminal, 
  FolderGit2, 
  Database, 
  Layers, 
  Zap, 
  Copy, 
  Check, 
  Play, 
  Radio, 
  ShieldCheck, 
  Download, 
  FileCode, 
  ExternalLink,
  Flame,
  CheckCircle2,
  Server,
  Monitor
} from 'lucide-react';
import { NinjaIcon } from './NinjaIcon';
import { RUST_TAURI_WORKSPACE_FILES, RustSourceFile } from '../data/rustTauriSourceCode';

interface RustTauriArchitectureHubProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAgentInMainTimeline?: (agentId: string) => void;
}

export const RustTauriArchitectureHub: React.FC<RustTauriArchitectureHubProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'topology' | 'code_explorer' | 'ipc_simulator' | 'quickstart'>('topology');
  const [selectedFile, setSelectedFile] = useState<RustSourceFile>(RUST_TAURI_WORKSPACE_FILES[0]);
  const [copied, setCopied] = useState<boolean>(false);

  // IPC Simulator interactive states
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simLogs, setSimLogs] = useState<Array<{ timestamp: string; level: string; tag: string; message: string }>>([
    { timestamp: '19:24:02.110', level: 'INFO', tag: 'shinobi_server::main', message: '🥷 Axum Nostr Relay listening on ws://0.0.0.0:8080/relay' },
    { timestamp: '19:24:02.340', level: 'INFO', tag: 'shinobi_desktop::tauri', message: 'Tauri v2 runtime initialized. Window bound: 1400x900. Memory footprint: 34.2 MB' },
    { timestamp: '19:24:02.490', level: 'INFO', tag: 'shinobi_desktop::acp', message: 'Ready to spawn local ACP agents via tokio::process::Command stdio pipes' },
  ]);
  const [simMetrics, setSimMetrics] = useState({
    tauriMemory: '34.8 MB',
    electronComparison: '460 MB',
    ipcLatency: '0.14 ms',
    activeSubprocesses: 2,
    relayEventCount: 142,
  });

  if (!isOpen) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const runSimulationTest = (testType: 'spawn' | 'ipc' | 'memory' | 'relay') => {
    setIsSimulating(true);
    const now = new Date().toTimeString().split(' ')[0] + '.' + Math.floor(Math.random() * 900 + 100);

    setTimeout(() => {
      if (testType === 'spawn') {
        setSimLogs(prev => [
          ...prev,
          { timestamp: now, level: 'INFO', tag: 'shinobi_desktop::acp_manager', message: 'tokio::process::Command spawning "cargo run --bin shinobi-agent" in cwd: /workspace/shinobi' },
          { timestamp: now, level: 'INFO', tag: 'shinobi_agent::init', message: 'ACP agent online (PID: 41982). Stdio piped. Attached SQLite memory bank.' },
        ]);
        setSimMetrics(prev => ({ ...prev, activeSubprocesses: prev.activeSubprocesses + 1 }));
      } else if (testType === 'ipc') {
        setSimLogs(prev => [
          ...prev,
          { timestamp: now, level: 'DEBUG', tag: 'tauri::ipc::Channel', message: 'Zero-copy IPC buffer dispatched: acp:stream:agent-shinobi (payload size: 1.8KB, latency: 0.11ms)' },
          { timestamp: now, level: 'INFO', tag: 'shinobi_frontend::react', message: 'React UI updated with streaming typewriter chunk without re-render lag' },
        ]);
      } else if (testType === 'memory') {
        setSimLogs(prev => [
          ...prev,
          { timestamp: now, level: 'INFO', tag: 'shinobi_agent::memory', message: 'rusqlite query: "SELECT * FROM acp_memories WHERE key LIKE \'%branch%\'"' },
          { timestamp: now, level: 'INFO', tag: 'shinobi_agent::memory', message: 'Hit cached pattern [git_branch_convention] (0.3ms). Injected into ACP session prompt.' },
        ]);
      } else if (testType === 'relay') {
        setSimLogs(prev => [
          ...prev,
          { timestamp: now, level: 'INFO', tag: 'shinobi_desktop::nostr', message: 'Signed Kind 42 Event (sha256: 7f8c92...) using secp256k1 keypair' },
          { timestamp: now, level: 'INFO', tag: 'shinobi_server::relay', message: 'Axum ws broadcasted Nostr event to room [#shinobi-acp-core] (3 peers)' },
        ]);
        setSimMetrics(prev => ({ ...prev, relayEventCount: prev.relayEventCount + 1 }));
      }
      setIsSimulating(false);
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0b0e14] border border-[#232d3f] rounded-xl w-full max-w-6xl text-gray-200 overflow-hidden shadow-2xl flex flex-col h-[94vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1f2838] flex items-center justify-between bg-[#10141d] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-700/50 flex items-center justify-center text-cyan-400 p-1.5 shadow-xs">
              <NinjaIcon className="w-full h-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-gray-100 flex items-center gap-1.5">
                  <span>Shinobi 技术架构方案</span>
                  <span className="text-gray-500 font-normal text-xs">|</span>
                  <span className="text-orange-300 font-medium text-xs">Rust + Tauri (AI 影替身)</span>
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-orange-950 text-orange-400 border border-orange-800/40 font-mono">
                  Rust 2021 + Tauri v2 + Axum
                </span>
              </div>
              <p className="text-xs text-gray-400">
                双端统一 Rust 强类型契约 · Tokio 异步 stdio 进程守护 · Nostr 分布式 Relay 事件总线
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors cursor-pointer p-1.5 rounded hover:bg-[#1c2230]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#1b2230] bg-[#0d111a] px-4 text-xs font-mono shrink-0">
          <button
            onClick={() => setActiveTab('topology')}
            className={`py-2.5 px-4 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'topology'
                ? 'border-orange-500 text-orange-400 bg-[#141926]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>系统全景拓扑与优势</span>
          </button>
          <button
            onClick={() => setActiveTab('code_explorer')}
            className={`py-2.5 px-4 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'code_explorer'
                ? 'border-blue-500 text-blue-400 bg-[#141926]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>真实 Rust 源码工作区</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 font-mono">
              {RUST_TAURI_WORKSPACE_FILES.length} 个核心文件
            </span>
          </button>
          <button
            onClick={() => setActiveTab('ipc_simulator')}
            className={`py-2.5 px-4 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'ipc_simulator'
                ? 'border-emerald-500 text-emerald-400 bg-[#141926]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Tauri IPC & 进程调度仿真</span>
          </button>
          <button
            onClick={() => setActiveTab('quickstart')}
            className={`py-2.5 px-4 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'quickstart'
                ? 'border-purple-500 text-purple-400 bg-[#141926]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>工程搭建指南 (CLI)</span>
          </button>
        </div>

        {/* Tab 1: TOPOLOGY & COMPARISON */}
        {activeTab === 'topology' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Architecture Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-orange-950/40 via-amber-950/30 to-blue-950/40 border border-orange-800/40 space-y-2">
              <div className="flex items-center gap-2 text-orange-300 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-orange-400" />
                <span>为什么 “服务端 Rust (Axum) + 桌面端 Tauri (Rust+React)” 是 Block Buzz 的理想解法？</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Buzz 的本质是一个<strong>多 Agent 实时对话流 + 本地代码空间 AST 解析 + 终端管道代理</strong>的重工业工具。Tauri 摒弃了 Electron 臃肿的 Node/Chromium 独立实例，用 Rust 内核直接托管 Tokio 线程池与子进程管道，内存消耗仅为后者的 <strong>1/13</strong>，同时与服务端的 Nostr Relay 共享同一套 Serde 结构体与加解密逻辑。
              </p>
            </div>

            {/* Visual Topology Diagram */}
            <div className="p-5 rounded-xl bg-[#0e121b] border border-[#1e2637] space-y-4">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-gray-200 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-orange-400" />
                  系统数据流动分层拓扑 (Full-Stack Rust Flow)
                </span>
                <span className="text-[11px] text-emerald-400">零内存拷贝 · 强类型契约校验</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Box 1: Tauri Host */}
                <div className="p-4 rounded-lg bg-[#121724] border border-blue-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                      <Monitor className="w-4 h-4" />
                      Tauri 桌面端 (src-tauri)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 font-mono">~35MB RAM</span>
                  </div>
                  <ul className="text-xs text-gray-300 space-y-1.5 font-sans">
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-400 font-mono">•</span>
                      <span><strong>React UI 层</strong>: 响应式 Timeline、Inspector 检查器</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-400 font-mono">•</span>
                      <span><strong>Tauri IPC 管道</strong>: `invoke` 命令与 `Channel` 逐字流</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-400 font-mono">•</span>
                      <span><strong>Tokio Process 守护器</strong>: 接管 Agent stdio 输入输出</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-400 font-mono">•</span>
                      <span><strong>文件沙盒校验</strong>: 防止路径跨越逃逸</span>
                    </li>
                  </ul>
                </div>

                {/* Box 2: Local ACP Agents */}
                <div className="p-4 rounded-lg bg-[#121724] border border-emerald-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4" />
                      ACP Agent 独立运行时
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono">Stdio JSON-RPC</span>
                  </div>
                  <ul className="text-xs text-gray-300 space-y-1.5 font-sans">
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-mono">•</span>
                      <span><strong>私有持久 Memory</strong>: Agent 自备 SQLite 数据库</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-mono">•</span>
                      <span><strong>Workspace 绑定</strong>: 原生挂载工作目录 Git/文件</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-mono">•</span>
                      <span><strong>buzz-dev-mcp</strong>: 运行 Cargo/Clippy/Shell 工具</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-mono">•</span>
                      <span><strong>双向握手</strong>: 协议能力自主协商</span>
                    </li>
                  </ul>
                </div>

                {/* Box 3: Rust Axum Server */}
                <div className="p-4 rounded-lg bg-[#121724] border border-orange-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-400 flex items-center gap-1.5">
                      <Server className="w-4 h-4" />
                      服务端 (Axum Nostr Relay)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-950 text-orange-300 font-mono">Port :8080</span>
                  </div>
                  <ul className="text-xs text-gray-300 space-y-1.5 font-sans">
                    <li className="flex items-start gap-1.5">
                      <span className="text-orange-400 font-mono">•</span>
                      <span><strong>WebSocket 通信</strong>: 高并发低延迟团队事件广播</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-orange-400 font-mono">•</span>
                      <span><strong>Nostr 协议签名</strong>: secp256k1 验签，防篡改审计</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-orange-400 font-mono">•</span>
                      <span><strong>房间频道路由</strong>: tokio::sync::broadcast 消息广播</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-orange-400 font-mono">•</span>
                      <span><strong>持久历史存储</strong>: RocksDB / PostgreSQL 归档</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Performance Comparison Matrix */}
            <div className="p-5 rounded-xl bg-[#0e121b] border border-[#1e2637] space-y-3">
              <h3 className="font-bold text-gray-200 text-xs font-mono uppercase tracking-wider">
                核心架构收益对比：Tauri + Rust Server vs 传统 Electron + Node 方案
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-[#232d3f] text-gray-400 font-mono text-[11px]">
                      <th className="py-2 px-3">评估维度</th>
                      <th className="py-2 px-3 text-orange-400 font-bold">本方案: Rust Server + Tauri</th>
                      <th className="py-2 px-3 text-gray-500">传统方案: Node.js + Electron</th>
                      <th className="py-2 px-3">对 Buzz 业务的直接价值</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#18202d] text-gray-300">
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-gray-200 font-mono">待机内存占用</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-mono font-bold">30MB ~ 50MB</td>
                      <td className="py-2.5 px-3 text-red-400 font-mono">350MB ~ 800MB+</td>
                      <td className="py-2.5 px-3 text-gray-400">同时挂载 5 个以上本地 Agent 时不会造成开发者电脑卡顿</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-gray-200 font-mono">类型契约与复用</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">共享 crates/buzz-protocol</td>
                      <td className="py-2.5 px-3 text-gray-500">前后端分别维护 TS/JS 接口</td>
                      <td className="py-2.5 px-3 text-gray-400">ACP 报文与 Nostr 结构体由 Serde 一致性编译保护，杜绝字段漂移</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-gray-200 font-mono">本地 Agent 进程管理</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">Tokio 异步管道 + 零拷贝缓冲</td>
                      <td className="py-2.5 px-3 text-gray-500">Node child_process (单线程瓶颈)</td>
                      <td className="py-2.5 px-3 text-gray-400">高并发流式输出打字机体验丝滑，微秒级 stdio 事件循环</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-gray-200 font-mono">安全沙盒与文件 I/O</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">Rust 底层校验，无原生越界风险</td>
                      <td className="py-2.5 px-3 text-gray-500">易发生 contextIsolation 注入越权</td>
                      <td className="py-2.5 px-3 text-gray-400">保护用户本地源码免受不受信任 Agent 的恶意文件遍历</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-gray-200 font-mono">打包发布体积</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-mono font-bold">~15 MB 安装包</td>
                      <td className="py-2.5 px-3 text-gray-500 font-mono">150 MB+ 安装包</td>
                      <td className="py-2.5 px-3 text-gray-400">极速分发，开箱即用，原生适配 macOS / Linux / Windows</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: CODE EXPLORER */}
        {activeTab === 'code_explorer' && (
          <div className="flex-1 flex overflow-hidden">
            {/* File Directory Sidebar */}
            <div className="w-72 border-r border-[#1e2637] bg-[#0c0f17] flex flex-col shrink-0">
              <div className="p-2.5 border-b border-[#1e2637] bg-[#101420] text-xs font-mono text-gray-400 flex items-center justify-between">
                <span>Cargo Workspace 源码树</span>
                <span className="text-[10px] text-emerald-400">Ready to build</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs font-mono">
                {RUST_TAURI_WORKSPACE_FILES.map((file) => {
                  const isSelected = selectedFile.path === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFile(file)}
                      className={`w-full text-left px-2.5 py-2 rounded transition-colors flex items-center gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-orange-950/60 text-orange-300 border border-orange-800/40'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-[#151a26]'
                      }`}
                    >
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-orange-400' : 'text-gray-500'}`} />
                      <div className="truncate">
                        <div className="truncate font-semibold">{file.path}</div>
                        <div className="text-[10px] text-gray-500 truncate">{file.crate}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Code Content Viewer */}
            <div className="flex-1 flex flex-col bg-[#090b10] overflow-hidden">
              {/* File Info Bar */}
              <div className="p-3 border-b border-[#1e2637] bg-[#0f131c] flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-200">{selectedFile.path}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                    {selectedFile.language.toUpperCase()}
                  </span>
                  <span className="text-gray-400 text-[11px] font-sans">
                    — {selectedFile.description}
                  </span>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1b2232] hover:bg-[#252f44] text-gray-300 transition-colors text-xs font-sans cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-gray-400" />
                      <span>复制代码</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Area */}
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-gray-300 bg-[#090b10]">
                <pre className="select-text whitespace-pre overflow-x-auto">
                  {selectedFile.code}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: IPC & PROCESS SIMULATOR */}
        {activeTab === 'ipc_simulator' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              <div className="p-3 rounded-lg bg-[#10141f] border border-blue-900/40">
                <div className="text-[10px] text-gray-400 uppercase">Tauri 内存占用</div>
                <div className="text-lg font-bold text-blue-400 mt-1">{simMetrics.tauriMemory}</div>
                <div className="text-[10px] text-gray-500">Electron 约需 {simMetrics.electronComparison}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#10141f] border border-emerald-900/40">
                <div className="text-[10px] text-gray-400 uppercase">IPC 通信延迟</div>
                <div className="text-lg font-bold text-emerald-400 mt-1">{simMetrics.ipcLatency}</div>
                <div className="text-[10px] text-gray-500">零内存拷贝 Channel</div>
              </div>
              <div className="p-3 rounded-lg bg-[#10141f] border border-purple-900/40">
                <div className="text-[10px] text-gray-400 uppercase">活跃 Agent 子进程</div>
                <div className="text-lg font-bold text-purple-400 mt-1">{simMetrics.activeSubprocesses} PIDs</div>
                <div className="text-[10px] text-gray-500">Tokio 异步管道守护</div>
              </div>
              <div className="p-3 rounded-lg bg-[#10141f] border border-orange-900/40">
                <div className="text-[10px] text-gray-400 uppercase">Axum Relay 事件吞吐</div>
                <div className="text-lg font-bold text-orange-400 mt-1">{simMetrics.relayEventCount} Events</div>
                <div className="text-[10px] text-gray-500">secp256k1 验签广播</div>
              </div>
            </div>

            {/* Test Actions Bar */}
            <div className="p-4 rounded-lg bg-[#10141f] border border-[#1f2838] space-y-3">
              <div className="text-xs font-mono font-bold text-gray-200">
                触发 Rust 内核与 Tauri IPC 交互链路测试
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button
                  disabled={isSimulating}
                  onClick={() => runSimulationTest('spawn')}
                  className="px-3 py-1.5 rounded bg-blue-900/40 border border-blue-700/50 hover:bg-blue-800/60 text-blue-300 text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 text-blue-400" />
                  <span>测试：spawn_acp_agent (Tokio 子进程)</span>
                </button>
                <button
                  disabled={isSimulating}
                  onClick={() => runSimulationTest('ipc')}
                  className="px-3 py-1.5 rounded bg-emerald-900/40 border border-emerald-700/50 hover:bg-emerald-800/60 text-emerald-300 text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  <span>测试：Tauri Channel 零拷贝流式打字</span>
                </button>
                <button
                  disabled={isSimulating}
                  onClick={() => runSimulationTest('memory')}
                  className="px-3 py-1.5 rounded bg-purple-900/40 border border-purple-700/50 hover:bg-purple-800/60 text-purple-300 text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Database className="w-3.5 h-3.5 text-purple-400" />
                  <span>测试：rusqlite Agent 私有持久记忆召回</span>
                </button>
                <button
                  disabled={isSimulating}
                  onClick={() => runSimulationTest('relay')}
                  className="px-3 py-1.5 rounded bg-orange-900/40 border border-orange-700/50 hover:bg-orange-800/60 text-orange-300 text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Radio className="w-3.5 h-3.5 text-orange-400" />
                  <span>测试：Axum Nostr Relay 广播握手</span>
                </button>
              </div>
            </div>

            {/* Console Logs */}
            <div className="rounded-lg bg-[#07090e] border border-[#1b2230] overflow-hidden flex flex-col font-mono text-xs">
              <div className="p-2.5 bg-[#0e121a] border-b border-[#1b2230] text-gray-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Tauri + Axum 双端实时运行诊断日志</span>
                </span>
                <span className="text-[10px] text-gray-500">stdout & stderr pipe</span>
              </div>
              <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
                {simLogs.map((log, index) => (
                  <div key={index} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className="text-gray-500 shrink-0">{log.timestamp}</span>
                    <span className={`px-1 rounded text-[10px] shrink-0 ${
                      log.level === 'INFO' ? 'bg-blue-950 text-blue-400' :
                      log.level === 'DEBUG' ? 'bg-emerald-950 text-emerald-400' :
                      'bg-amber-950 text-amber-400'
                    }`}>
                      {log.level}
                    </span>
                    <span className="text-gray-400 font-semibold shrink-0">{log.tag}:</span>
                    <span className="text-gray-200">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: QUICKSTART CLI */}
        {activeTab === 'quickstart' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs font-sans">
            <div className="p-4 rounded-xl bg-[#0e121a] border border-[#1e2637] space-y-3">
              <h3 className="font-bold text-gray-200 text-sm font-mono flex items-center gap-2">
                <Terminal className="w-4 h-4 text-purple-400" />
                本地一键初始化与工程构建步骤 (5 分钟完成联调)
              </h3>
              <p className="text-gray-400 leading-relaxed">
                按照以下标准命令在本地快速建立 Cargo Workspace，并同时拉起 Axum Nostr Relay 与 Tauri 桌面端客户端：
              </p>

              {/* Step 1 */}
              <div className="space-y-1.5 pt-2">
                <div className="font-bold text-gray-300 font-mono">1. 安装前置依赖 (Rust & Tauri CLI)</div>
                <div className="p-3 rounded bg-[#07090e] border border-[#1e2637] font-mono text-emerald-400 text-xs">
                  <div>curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh</div>
                  <div>cargo install tauri-cli --version "^2.0"</div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="space-y-1.5 pt-2">
                <div className="font-bold text-gray-300 font-mono">2. 启动 Rust Axum Nostr Relay (服务端)</div>
                <div className="p-3 rounded bg-[#07090e] border border-[#1e2637] font-mono text-emerald-400 text-xs">
                  <div>cargo run -p buzz-server</div>
                  <div className="text-gray-500"># 监听端口: ws://127.0.0.1:8080/relay</div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="space-y-1.5 pt-2">
                <div className="font-bold text-gray-300 font-mono">3. 启动 Tauri 桌面端开发环境 (包含 React 前端)</div>
                <div className="p-3 rounded bg-[#07090e] border border-[#1e2637] font-mono text-emerald-400 text-xs">
                  <div>npm install</div>
                  <div>cargo tauri dev</div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="space-y-1.5 pt-2">
                <div className="font-bold text-gray-300 font-mono">4. 生产包分发构建 (生成原生桌面可执行文件)</div>
                <div className="p-3 rounded bg-[#07090e] border border-[#1e2637] font-mono text-emerald-400 text-xs">
                  <div>cargo tauri build</div>
                  <div className="text-gray-500"># macOS 输出: .dmg / .app; Windows 输出: .msi / .exe; Linux 输出: .deb / AppImage</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3.5 border-t border-[#1f2838] bg-[#0c1017] flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2 text-gray-400 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Rust Axum Relay :8080 在线</span>
            <span className="text-gray-600">|</span>
            <span>Tauri v2 IPC 引擎正常</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors cursor-pointer font-medium font-sans"
          >
            返回多 Agent 讨论室
          </button>
        </div>
      </div>
    </div>
  );
};
