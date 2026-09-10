import React from 'react';
import { 
  X, 
  Database, 
  FolderGit2, 
  Wrench, 
  BookOpen, 
  Terminal, 
  Layers, 
  CheckCircle2, 
  ArrowRight,
  ShieldCheck,
  Cpu
} from 'lucide-react';

interface AcpArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AcpArchitectureModal: React.FC<AcpArchitectureModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0b0e14] border border-[#232d3f] rounded-xl w-full max-w-4xl text-gray-200 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-[#1f2838] flex items-center justify-between bg-[#10141d]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-700/50 flex items-center justify-center text-indigo-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-base text-gray-100 flex items-center gap-2">
                <span>Block Buzz 与 ACP 架构白皮书</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40 font-mono">
                  ACP v1.0 规范解析
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                深入解答：通过 ACP 协议拉入团队的 Agent，能否使用自身 Memory、工作空间与 Skill？
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

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs font-sans">
          {/* Quick Summary Banner */}
          <div className="p-3.5 rounded-lg bg-gradient-to-r from-emerald-950/40 via-indigo-950/40 to-blue-950/40 border border-emerald-800/40 text-gray-200 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-emerald-300 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>核心结论：是的，不仅可以使用，而且三者均具备清晰的隔离与协同机制！</span>
            </div>
            <p className="text-[11px] text-gray-300 leading-relaxed pl-6">
              ACP (Agent Client Protocol) 类似语言服务协议 LSP，它的目的正是<strong>标准化客户端（如 Buzz 或编辑器）与独立 Agent Runtime 的通信</strong>。Agent 作为运行在其宿主环境（本地子进程或安全容器）中的独立实体，<strong>完全保留其私有 Memory 存储、本地工作空间文件操作权以及其挂载的 MCP Tools / Skills</strong>。
            </p>
          </div>

          {/* Visual Architecture Diagram */}
          <div className="p-4 rounded-lg bg-[#0e121a] border border-[#1e2637] space-y-2">
            <div className="text-[11px] font-mono text-gray-400 font-semibold uppercase flex items-center justify-between">
              <span>Block Buzz 与 ACP 多 Agent 协同架构拓扑图</span>
              <span className="text-emerald-400">Buzz (Nostr) ↔ ACP Harness ↔ Agent Runtime</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px] pt-1">
              {/* Layer 1: Buzz Team Platform */}
              <div className="p-3 rounded bg-[#131824] border border-blue-900/40 space-y-1.5">
                <div className="flex items-center gap-1.5 text-blue-400 font-bold text-xs">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>1. Buzz 团队协作总线</span>
                </div>
                <div className="text-[10px] text-gray-400 space-y-1">
                  <div>• 基于 Nostr 签名的分布式事件通道</div>
                  <div>• 包含人类与所有 Agent 的讨论流</div>
                  <div>• 维护<strong>房间级会话上下文 (Room Context)</strong></div>
                  <div>• 触发 @mention 时分发给对应 Agent</div>
                </div>
              </div>

              {/* Layer 2: ACP Protocol Harness */}
              <div className="p-3 rounded bg-[#131824] border border-emerald-900/40 space-y-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>2. ACP 适配层 (buzz-acp)</span>
                </div>
                <div className="text-[10px] text-gray-400 space-y-1">
                  <div>• JSON-RPC 2.0 双向通道 (stdio/WS)</div>
                  <div>• 传递工作区根路径: <code className="text-emerald-300">cwd</code></div>
                  <div>• 分发会话指令: <code className="text-emerald-300">session/prompt</code></div>
                  <div>• 代理文件读写 & 异步流式事件</div>
                </div>
              </div>

              {/* Layer 3: Independent Agent Runtime */}
              <div className="p-3 rounded bg-[#131824] border border-purple-900/40 space-y-1.5">
                <div className="flex items-center gap-1.5 text-purple-400 font-bold text-xs">
                  <Layers className="w-3.5 h-3.5" />
                  <span>3. Agent 独立运行时</span>
                </div>
                <div className="text-[10px] text-gray-400 space-y-1">
                  <div>• 拥有<strong>私有长期记忆 (SQLite/Mem0)</strong></div>
                  <div>• 挂载<strong>工作空间代码树 (Local FS)</strong></div>
                  <div>• 挂载<strong>MCP 工具集 (buzz-dev-mcp)</strong></div>
                  <div>• 结合房间上下文生成推理并提交结果</div>
                </div>
              </div>
            </div>
          </div>

          {/* Deep Dive into 3 Pillars */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-gray-200 border-b border-[#1c2436] pb-1.5">
              三大关键要素详细解析与代码规范
            </h3>

            {/* Pillar 1: Memory */}
            <div className="p-3.5 rounded-lg bg-[#111520] border border-[#20293b] space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <Database className="w-4 h-4" />
                <span>1. Memory（记忆）：双层共存架构 (Private Memory VS. Room Memory)</span>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                在 Block Buzz 体系中，Agent 的记忆被设计为<strong>两层正交分离</strong>：
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2.5 rounded bg-[#0b0e14] border border-[#1c2436]">
                  <div className="text-emerald-300 font-bold mb-1">A. Agent 自带的私有长期记忆</div>
                  <div className="text-gray-400 space-y-0.5">
                    <div>• 存储在 Agent 的私有磁盘中 (如 SQLite、Vector DB、.agent/memory)</div>
                    <div>• 跨房间、跨讨论均保持有效</div>
                    <div>• 记录代码库规范、历史踩坑经验、用户个人偏好</div>
                    <div>• <strong>完全由 Agent 自身控制读写</strong></div>
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#0b0e14] border border-[#1c2436]">
                  <div className="text-blue-300 font-bold mb-1">B. Buzz 团队房间讨论短期记忆</div>
                  <div className="text-gray-400 space-y-0.5">
                    <div>• 存储在 Buzz 的 Nostr Relay 日志中</div>
                    <div>• 属于团队多人可见的公共历史</div>
                    <div>• 每次调用时通过 ACP <code className="text-blue-300">session/prompt</code> 注入</div>
                    <div>• Agent 结合房间上下文进行针对性回答</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pillar 2: Workspace */}
            <div className="p-3.5 rounded-lg bg-[#111520] border border-[#20293b] space-y-2">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-xs">
                <FolderGit2 className="w-4 h-4" />
                <span>2. Workspace（工作空间）：本地代码目录与权限注入</span>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                当客户端拉取 Agent 参与讨论时，会在 ACP 的 <code className="text-blue-300 font-mono">session/new</code> 协议中传递宿主指定的仓库根目录：
              </p>
              <pre className="p-2 rounded bg-[#080b11] text-[10px] font-mono text-gray-300 overflow-x-auto border border-[#1c2536]">
{`// ACP session/new JSON-RPC 报文
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": {
    "sessionId": "ses_buzz_dev_01",
    "cwd": "/home/developer/projects/block-buzz",
    "workspaceRoots": [{ "uri": "file:///home/developer/projects/block-buzz", "name": "buzz" }],
    "permissionMode": "full_read_write" // 支持只读或完整读写
  }
}`}
              </pre>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                Agent 进程（如 <code className="text-blue-300 font-mono">buzz-agent</code>）可以直接在本地该目录下读取代码、运行 <code className="text-gray-200 font-mono">git diff</code>、创建分支或发起提交。如果是远程 Agent，则可以通过 ACP 的 <code className="text-blue-300 font-mono">workspace/readFile</code> 和 <code className="text-blue-300 font-mono">workspace/applyEdit</code> RPC 方法请求客户端代理操作。
              </p>
            </div>

            {/* Pillar 3: Skills & MCP */}
            <div className="p-3.5 rounded-lg bg-[#111520] border border-[#20293b] space-y-2">
              <div className="flex items-center gap-2 text-purple-400 font-bold text-xs">
                <Wrench className="w-4 h-4" />
                <span>3. Skills（技能）：MCP (Model Context Protocol) 无缝集成</span>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                Block 在开源 Buzz 时，配套开源了 <strong className="text-purple-300">buzz-dev-mcp</strong>（基于 MCP 标准的开发工具服务）。ACP 架构天然解耦了技能与通信协议：
              </p>
              <ul className="list-disc list-inside space-y-1 text-gray-400 text-[10px]">
                <li>
                  <strong className="text-gray-200">Agent 自带工具集：</strong> Agent 作为 MCP Client，可在启动时自动连接本地配置的各种 MCP Servers（如数据库查询、代码分析工具、外部 API 接口）。
                </li>
                <li>
                  <strong className="text-gray-200">双向协议协商：</strong> 在 ACP 的 <code className="text-purple-300 font-mono">initialize</code> 阶段，Agent 与 Client 会宣告双方支持的 Tools 与 Prompts。Agent 可以直接在其响应中发起工具调用（Tool Calls），完成运行测试或搜索后向讨论房间输出最终结论。
                </li>
              </ul>
            </div>
          </div>

          {/* Footer Action */}
          <div className="flex items-center justify-between pt-3 border-t border-[#1f2838]">
            <span className="text-[11px] text-gray-400">
              💡 本应用已完整实现上述机制，您可以在主界面实时观察 ACP 报文流与三要素执行轨迹！
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors cursor-pointer"
            >
              返回工作台体验
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
