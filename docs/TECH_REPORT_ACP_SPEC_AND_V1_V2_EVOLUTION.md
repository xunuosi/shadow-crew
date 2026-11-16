# 🥷 ACP (Agent Client Protocol) 深度研究与 V1 vs V2 协议演进全景报告

> **报告定位**：Agent Client Protocol (ACP) 核心机制剖析、业界规范对标（Zed、Anthropic Claude Code、Codex）与 V1/V2 双轨协议演化技术报告。  
> **编写者**：`acp-spec`  
> **覆盖范围**：协议分层、JSON-RPC 契约、会话生命周期、权限中继、流式状态机、原生记忆治理与 Shadow Crew 双轨实测对齐。

---

## 1. 协议定位与全景生态：ACP vs MCP vs LSP

### 1.1 什么是 Agent Client Protocol (ACP)？
**Agent Client Protocol (ACP)** 是由 **Zed Industries**（Zed 编辑器团队）于 2025 年发起的开源开放协议标准（官方代码库：[`agentclientprotocol/agent-client-protocol`](https://github.com/agentclientprotocol/agent-client-protocol)）。其诞生的愿景被称为 **“AI 协同开发领域的 LSP (Language Server Protocol) 时刻”**。

在 ACP 出现之前，每一个 AI 编程助手（如 Anthropic Claude Code、OpenAI Codex CLI、Google Gemini CLI、Cursor、Aider）都需要为不同的 IDE/桌面端编写定制化的专有插件或粘合代码；反过来，每一个编辑器也需要针对各家 Agent 开发私有适配层，导致生态严重碎片化。

ACP 通过标准化 **Client（客户端/IDE/桌面宿主）** 与 **Agent（外部 AI 代理进程）** 之间的通信，彻底实现宿主与代理内核的解耦：
- **Client（宿主，如 Zed、JetBrains、Shadow Crew）**：负责 UI 交互、工作区管理（Workspace / CWD）、用户审批与权限代理（Permission Broker）、审计日志与上下文投递；
- **Agent（代理进程，如 Claude Code、Codex、Shinobi）**：作为独立子进程或远程服务运行，全权负责 LLM 推理、自主任务规划、多轮 Tool Loop、Session 内部上下文管理及端点长期记忆（Memory）。

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        IDE / Host (Shadow Crew)                        │
│   (UI, Workspace CWD, Permission Broker, Session Routing, Multi-Agent) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │  ACP (Agent Client Protocol)
                                    │  [JSON-RPC 2.0 / stdio / WebSocket]
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   AI Agent Runtime (Subprocess / Remote)               │
│          (Claude Code / OpenAI Codex / OpenClaw / Shinobi)             │
│   (LLM Reasoning, Autonomous ReAct Loop, Session Context, Memory)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │  MCP (Model Context Protocol)
                                    │  [JSON-RPC 2.0 / stdio / SSE]
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     External Tools & Data Sources                      │
│        (PostgreSQL, GitHub API, Local Git, Web Search, Filesystem)      │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 三大协议边界厘清：ACP vs MCP vs LSP

| 协议维度 | **LSP (Language Server Protocol)** | **MCP (Model Context Protocol)** | **ACP (Agent Client Protocol)** |
| :--- | :--- | :--- | :--- |
| **发起方** | 微软 (Microsoft) | Anthropic | Zed Industries & 社区协作 |
| **连接两端** | **IDE/编辑器 ⟷ 语言静态分析引擎**<br>(如 rust-analyzer, tsserver) | **LLM/Agent ⟷ 外部工具/数据源**<br>(如 GitHub MCP, DB MCP) | **IDE/宿主 ⟷ 自主 AI Agent 进程**<br>(如 Claude Code, Codex CLI) |
| **核心职责** | 代码补全、跳转定义、符号重构、代码诊断 | 为大模型提供工具调用（Tool Calls）与只读资源挂载 | 会话生命周期、多轮 Prompt 交互、反向权限审批、流式进度广播、工作区隔离 |
| **通信方向** | 客户端向服务器请求，服务器异步诊断通知 | Agent 主动向 Tool Server 发起调用 | **双向 JSON-RPC**：Client 发送 Prompt，Agent 反向向 Client 申请权限与汇报进度 |
| **互补关系** | ACP Agent 内部或 Client 宿主可借助 LSP 获取语义上下文 | ACP Agent 可以作为 MCP Client 挂载多种 MCP Server 丰富工具集 | ACP 是顶层宿主与 Agent 的统一通信总线 |

---

## 2. ACP 核心协议能力（Core Protocol Capabilities）

ACP 构建在 **JSON-RPC 2.0** 规范之上，具备以下 7 大核心能力：

### 2.1 进程拉起与多传输通道（Transport Agnostic）
ACP 规范解耦了业务报文与物理传输，主流支持两种通信拓扑：
1. **本地子进程通道 (`stdio`)**：
   - 宿主通过 `child_process.spawn`（Node.js / Tauri Rust）拉起 Agent 命令行二进制（如 `bin/codex-acp` 或官方 `@agentclientprotocol/codex-acp`）；
   - 使用标准输入输出（`stdin`/`stdout`），以换行符分隔的 JSON-RPC 2.0 报文通信（NDJSON）；
   - 环境变量注入：宿主向子进程注入显式策略（如 `SHADOW_CREW_ACP_NATIVE_MEMORY=1`、`PATH` 补全、沙箱模式控制）。
2. **远程与中继通道 (`WebSocket` / `SSE`)**：
   - 跨局域网（LAN / Tailscale Mesh）或通过中心 Relay Hub（如 Axum + Nostr Relay）直连 `ws://` / `wss://` 端点；
   - 携带 Query 参数或 Header 进行 Ephemeral Token 鉴权（`?token=xyz`）；
   - 抹平网络延迟，支持多人研讨室同时挂载同一个远程 Agent。

### 2.2 双向 JSON-RPC 通信范式（Bidirectional RPC）
不同于传统单向 Client-Server 架构，ACP 是真正的**双向对等通信协议**：
- **正向调用（Client → Agent）**：
  - `initialize`（握手与版本协商）
  - `session/new`（新建会话）
  - `session/load` / `session/resume`（恢复会话）
  - `session/prompt`（派发用户提问与任务目标）
  - `session/close`（安全关闭会话释放资源）
  - `session/cancel`（中断在途推理）
- **反向调用（Agent → Client）**：
  - `session/request_permission`（执行敏感工具前反向申请用户授权）
- **单向通知（Notifications, 无 id）**：
  - Agent → Client: `session/update`（流式返回文本 Chunk、思考链、命令执行状态、`turn_complete` 终态信号）

### 2.3 握手与能力协商机制 (`initialize`)
客户端启动 Agent 后的第一步必须发送 `initialize` 握手请求，双方就协议版本与功能开关达成一致：

```json
// Client -> Agent
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 2,
    "clientInfo": { "name": "shadow-crew", "version": "0.1.0" },
    "capabilities": { "tools": false }
  }
}
```

Agent 回包中返回协商确定的版本（`negotiatedProtocolVersion`）及支持的能力集合：
- `loadSession`: 是否支持会话回放/重新加载；
- `sessionCapabilities.resume`: 是否支持通过 thread_id 续接底层执行流；
- `streaming`: 是否支持逐字打字机流式推送；
- `promptCapabilities`: 是否支持多模态图片（`image: true`）与嵌入上下文（`embeddedContext: true`）；
- `nativeMemory`: 端点是否原生具备跨会话长期记忆。

### 2.4 会话生命周期与 CWD 隔离（Session Lifecycle）
1. **`session/new`**：
   - 参数接收 `cwd`（工作目录）、`systemPrompt`（系统级指引）、`additionalDirectories`（附加只读目录）、`mcpServers`（可选外挂工具源）；
   - Agent 分配并返回唯一的 `sessionId`。
2. **CWD 不可变契约（CWD Invariant）**：
   - 根据 Shadow Crew 架构规范 [`TECH_SPEC_ACP_ONLY_RUNTIME.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/TECH_SPEC_ACP_ONLY_RUNTIME.md)，ACP Session 不提供跨工作目录切换的稳定通用语义。因此 Session 与 Workspace Binding/cwd 强绑定；若切换目录，必须创建全新 Session，严禁在旧 Session 中原地篡改 `cwd`。
3. **`session/close`**：
   - 优雅释放该 Session 对应的上下文内存与临时文件，但保持长生命周期的 Agent 子进程存活。

### 2.5 提示词投递与流式交互（Prompt Execution & Streaming）
客户端发送 `session/prompt` 触发 Agent 思考。Prompt 载荷支持：
- 纯文本字符串或结构化 Content Blocks（`type: 'text'`、`type: 'image'`）；
- 图片采用 Base64 编码内嵌（`image/png;base64,...`）；
- 附件投递（File Attachments / Context Blocks）。

Agent 在执行期间通过 `session/update` 持续通知客户端：
- `agent_message_chunk`：文本或 Markdown 增量（`delta`）；
- `item.started` / `item.completed`：工具与命令执行心跳（防止客户端长超时断联）；
- `turn_complete`：本轮 Prompt 终结标记。

### 2.6 反向权限中继与安全沙箱 (`session/request_permission`)
当 Agent 在思考链中需要执行外部敏感操作（如写工作区文件、执行 Shell 脚本、发起网络请求）时，**绝不允许在后台静默执行**，必须向客户端反向发起 `session/request_permission`：

```json
// Agent -> Client
{
  "jsonrpc": "2.0",
  "id": 1005,
  "method": "session/request_permission",
  "params": {
    "sessionId": "codex-sess-1234",
    "toolCall": {
      "toolCallId": "call-bash-99",
      "name": "execute",
      "title": "执行 Shell 命令",
      "kind": "execute",
      "rawInput": { "command": "cargo test -p shadow-crew-protocol" }
    },
    "options": [
      { "optionId": "allow-once", "name": "仅允许一次", "kind": "allow_once" },
      { "optionId": "allow-session", "name": "在当前会话总是允许", "kind": "allow_session" },
      { "optionId": "reject", "name": "拒绝执行", "kind": "reject_once" }
    ]
  }
}
```

客户端（Shadow Crew Rust Host + UI）根据当前作用域策略直接匹配（Cache Hit）或弹出授权窗口供用户裁定，随后向 Agent 回复选中的 `optionId`：
```json
// Client -> Agent
{
  "jsonrpc": "2.0",
  "id": 1005,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

---

## 3. ACP V1 与 V2 核心差异深度剖析

根据 Shadow Crew 核心测试套件 [`src/services/test-acp-v2-dual-track.ts`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/test-acp-v2-dual-track.ts) 与官方适配器实现，ACP V1 到 V2 经历了一次体系性的重构与规范化：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        ACP V1 ➔ V2 演进矩阵对比                         │
├──────────────────────┬────────────────────────┬────────────────────────┤
│ 维度                 │ ACP V1 规范            │ ACP V2 规范            │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ 协议版本声明         │ 1 / "1" / "2025-01-01" │ 2 / "2.0.0"            │
│ 能力声明层级         │ 散落多处 (agent/session)│ 统一顶层 capabilities   │
│ Turn 终态确认        │ 同步直接返回 / 隐式流   │ 异步 Receipt + 回执通知│
│ Message 追踪         │ 无显式消息 ID 关联      │ 强制 messageId 唯一关联 │
│ SystemPrompt 格式    │ 扁平 String            │ 结构化 Block Object    │
│ 会话恢复标准         │ session/load 回放      │ session/resume 续接    │
│ 权限 Options 语义    │ 自由字符串              │ 规范化 OptionKind 枚举 │
│ 多模态与上下文能力   │ 无显式声明              │ promptCapabilities 门禁│
└──────────────────────┴────────────────────────┴────────────────────────┘
```

### 3.1 差异一：版本标识与双轨自适应协商机制（Dual-Track Negotiation）
- **V1 形式**：
  早期实现普遍使用日期字符串（如 `"2025-01-01"`）或整数 `1`，例如 `"2025-01-01 (ACP v1.0.4)"`。
- **V2 形式**：
  严格规范化为整数版本号 `protocolVersion: 2`，对应语义版本 `2.0.0`。
- **双轨协商实战实现**（对标 [`src-tauri/src/acp_manager.rs`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src-tauri/src/acp_manager.rs#L2430-L2510) 与 [`bin/codex-acp`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/bin/codex-acp#L668-L675)）：
  1. **首选 V2 握手**：Shadow Crew 默认在 `initialize` 发送 `protocolVersion: 2`；
  2. **自适应降级**：若外部 Agent 报错（如 `-32602 Invalid params` 或声明不识别 v2），客户端捕获错误并在同一通道自动重发 `protocolVersion: 1` 降级握手；
  3. **适配器双轨兼容**：`bin/codex-acp` 检查入参 `clientProtocolVer`，若为 `1` 或以 `"1."` / `"202"` 开头则协商为 `1`，否则协商为 `2`；
  4. **元数据回写**：握手响应中的 `_meta.negotiatedProtocolVersion` 明确记录实际协商版本（`"v1"` 或 `"v2"`），供前端 [`remoteAgentLifecycle.ts`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/remoteAgentLifecycle.ts) 动态更新 Agent 状态徽章。

### 3.2 差异二：能力声明模型重构（Unified Capabilities vs Legacy Fragmented）
- **V1 模式**：
  能力声明散落在多个根字段中，存在命名不一致：
  - `agentCapabilities: { loadSession: true, streaming: true }`
  - `sessionCapabilities: { resume: {} }`
  - 客户端能力：`clientCapabilities: { fs: { readTextFile: false }, terminal: false }`
- **V2 模式**：
  废弃分散的顶层字段，统一聚合成顶层 `capabilities` 对象：
  ```json
  {
    "protocolVersion": 2,
    "capabilities": {
      "loadSession": false,
      "streaming": true,
      "sessionCapabilities": {
        "resume": {}
      },
      "promptCapabilities": {
        "image": true,
        "embeddedContext": true
      },
      "nativeMemory": {
        "supported": true,
        "enabled": true,
        "persistent": true,
        "crossThread": true,
        "scope": "workspace",
        "provider": "codex-memories"
      }
    }
  }
  ```
- **向后兼容机制**：
  合规的 V2 适配器（如 `bin/codex-acp`）在回包中**同时填充 `capabilities` 与旧版 `agentCapabilities`**，使得只认 V1 路径的旧版客户端与严格按 V2 解析的现代宿主均能正常识别。

### 3.3 差异三：Turn 完成通知与 Receipt 异步回执生命周期
在 V1 中，`session/prompt` 的结束边界相对模糊：一些实现依赖 RPC 响应直接返回全量文本，另一些实现仅依赖流式 EOF。当底层进程执行外部命令未完全释放管道句柄时，极易发生无休止挂死。

V2 引入了严格的 **Receipt 凭据生命周期与显式 `turn_complete` 广播**：
1. **立即确认回执（Receipt Tracking）**：
   `session/prompt` 在分配处理后，返回明确的 `messageId` 与 `status: 'accepted'`：
   ```json
   {
     "jsonrpc": "2.0",
     "id": 202,
     "result": {
       "messageId": "msg-1731420000-abc12",
       "status": "accepted",
       "stopReason": "completed"
     }
   }
   ```
2. **显式终态广播（`turn_complete` Notification）**：
   流式输出完毕后，Agent 必须发送一条包含同款 `messageId` 的 `session/update` 通知：
   ```json
   {
     "jsonrpc": "2.0",
     "method": "session/update",
     "params": {
       "sessionId": "test-session-v2",
       "update": {
         "sessionUpdate": "turn_complete",
         "messageId": "msg-1731420000-abc12",
         "stopReason": "end_turn"
       }
     }
   }
   ```
3. **StopReason 终态语义分类**：
   - `end_turn`：正常自然完成对话轮次；
   - `completed`：底层任务规划完成；
   - `max_tokens`：由于 Token 预算耗尽截断；
   - `error`：发生不可恢复的错误。

### 3.4 差异四：系统提示词 Schema 演进（Structured System Prompt Object）
- **V1 模式**：
  直接传递纯文本字符串：
  ```json
  { "systemPrompt": "You are a senior Rust architect." }
  ```
- **V2 模式（官方 Schema `zSystemPrompt`）**：
  改为结构化 Typed Content Block，支持多模式追加（`mode: 'append'` / `'replace'`）：
  ```json
  {
    "systemPrompt": {
      "mode": "append",
      "content": [
        { "type": "text", "text": "You are a senior Rust architect." }
      ]
    }
  }
  ```
- **关键边界防御（Empty String Stripping）**：
  官方 `@agentclientprotocol/codex-acp` 引擎严格校验：`systemPrompt content must not be empty`。若前端传入纯空格或空字符串，V2 Bridge 必须自动剥离该字段（返回 `None`），避免触发 `-32602` 参数校验失败（参见 [`test-acp-v2-dual-track.ts` Case 7.3](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/test-acp-v2-dual-track.ts#L901-L911)）。

### 3.5 差异五：会话恢复与历史重放语义（`session/load` vs `session/resume`）
- **V1 规范**：主要定义了 `session/load`，语义偏向于从客户端或存储中将完整历史序列化后重新灌入 Agent 内存。
- **V2 规范**：针对现代具备持久化线程的 Agent（如 Codex 的 Thread ID 或 Claude Code 的 Session ID），全面转向 `session/resume`。
- **Bridge 桥接策略**：
  在官方引擎包装器中，若客户端发起 `session/load` 且协商协议为 V2，Bridge 会自动将其翻译为带有 `replayFrom: { type: 'start' }` 的 `session/resume`，并在恢复现有线程时自动剔除重复的 `systemPrompt`，防止触发官方引擎的 `changesSystemPrompt` 报错。

### 3.6 差异六：端点原生记忆治理（Native Memory First Architecture）
根据 [`SPEC_ACP_NATIVE_MEMORY.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_ACP_NATIVE_MEMORY.md)，ACP 协议本身不定义底层记忆数据库物理格式。Shadow Crew 在 V2 演进中确立了**“端点原生记忆优先”**原则：

1. **废弃应用侧外挂记忆注入**：
   彻底移除在客户端 Prompt 前置拼接 `<compacted-summary>` 或向 Agent 强塞内存卡带的做法，避免与端点原生的记忆（如 Codex memories、Claude memory）产生事实冲突与重复计费；
2. **端点能力探测与声明**：
   Agent 在 `initialize` 声明 `nativeMemory` 能力；
3. **策略指令与 Fail-Closed 覆盖**：
   - 若 Agent 配置为 `disabled`，启动子进程时不仅不传 `--enable memories`，还必须显式追加 `--disable memories`、`-c features.memories=false`、`-c memories.use_memories=false`、`-c memories.generate_memories=false` 等全套禁用参数，防止 Agent 受到用户级 `~/.codex/config.toml` 的污染；
4. **生命周期解耦**：
   关闭 ACP Session 或重启客户端仅清理前端会话映射，绝不删除端点底层的持久化记忆库。

### 3.7 差异七：防死锁流式收网（Tool Heartbeat & Anti-Freeze）
在长时间运行的命令执行场景下（如 Agent 调用 `cargo test` 或 `npm install`），传统 V1 适配器容易由于后台子进程输出管道未关闭而无限阻塞。

V2 适配器实现了两项关键防护（参见 [`test-acp-v2-dual-track.ts` Round 6](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/test-acp-v2-dual-track.ts#L620-L726)）：
1. **工具心跳实时流化**：
   在捕获到底层 CLI 的 `item.started` 时，立刻向客户端推送流式提示：
   `> ⚙️ 正在执行: \`cargo test -p shadow-crew-protocol\``
   持续刷新宿主活跃水位线；
2. **主动收获 `turn.completed` 并优雅收割**：
   捕获到 Agent 事件流中的 `turn.completed` 时，立即启动 150ms 平滑收尾定时器，收集完毕尾部输出后即刻返回 `turn_complete`，并主动对残留的休眠子进程执行收割，彻底杜绝僵尸进程与挂起死锁。

---

## 4. 关键源码与规范索引

- [`src/services/acpClient.ts`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/acpClient.ts)：前端 ACP 客户端核心服务（WebSocket 握手、协议调用、Session 映射与增量流接收）
- [`src/services/test-acp-v2-dual-track.ts`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src/services/test-acp-v2-dual-track.ts)：7 大轮次 ACP V2.0 双轨协议自动化回归测试用例
- [`bin/codex-acp`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/bin/codex-acp)：OpenAI Codex CLI 的生产级 ACP V1/V2 双轨适配器与 Bridge 门禁
- [`src-tauri/src/acp_manager.rs`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/src-tauri/src/acp_manager.rs)：Tauri Rust 宿主层 ACP 进程管理器、自适应降级握手与权限代理中枢
- [`docs/TECH_SPEC_ACP_ONLY_RUNTIME.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/TECH_SPEC_ACP_ONLY_RUNTIME.md)：Shadow Crew 纯 ACP 执行面技术方案（宿主薄控制面与 Agent 职责边界）
- [`docs/SPEC_ACP_NATIVE_MEMORY.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_ACP_NATIVE_MEMORY.md)：ACP 原生记忆能力规范与 Codex 状态机对齐
- [`docs/TECH_SPEC_ACP_LOCAL_PERMISSION_BROKER.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/TECH_SPEC_ACP_LOCAL_PERMISSION_BROKER.md)：本地 ACP 工具权限代理与 Scope Grant 方案
