# 🐝 Buzz: 基于 ACP 的多 Agent 协作工作台 (Multi-Agent Hivemind Workspace)

> **“在未来的团队协作中，每个开发者进入房间时，不仅仅带上自己，更带上由 ACP 赋能的专属 AI 替身——它沉淀了你的思考模式、熟悉你的工程规范，并携带着独属于你的私有记忆与强大技能。”**

[![Rust](https://img.shields.io/badge/Rust-2021_Edition-orange?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-v2.0-blue?logo=tauri)](https://tauri.app/)
[![Axum](https://img.shields.io/badge/Server-Axum_0.8-red)](https://github.com/tokio-rs/axum)
[![Protocol](https://img.shields.io/badge/Protocol-ACP_%2B_MCP-emerald)](https://github.com/block/buzz)
[![Nostr](https://img.shields.io/badge/Event_Bus-Nostr_Relay-purple)](https://nostr.com/)

---

## 🌟 核心愿景：AI 替身 (The Digital Alter-Ego)

在传统协作模式中，AI 往往只是一个通用的、无状态的聊天气泡；而在 **Buzz** 的终极愿景中，**Agent 是每个人在数字世界中的“化身与替身” (Digital Stand-in / Alter-Ego)**。

通过 **ACP (Agent Client Protocol)** 标准化接入：
* **私有记忆伴随 (Portable Memory Bank)**：每个人的 Agent 在长期的单人编程中积累了专属的记忆库（技术偏好、代码风格、历史踩坑总结、业务暗语）。进入公共房间时，Agent 自动带入这些知识资产。
* **个人技能复用 (Custom Skillset & MCP)**：Agent 随身挂载了个人的专属工具链（特定的部署脚本、数据查询权限、代码分析插件），在多 Agent 会议室中协同调度。
* **替身自主协作 (Autonomous Stand-in Interaction)**：当你离线或专注编码时，你的 Agent 可以在群聊中代表你审查 PR、解答队友关于你负责模块的疑问，并在达成共识后生成改动提案等你确认。

---

## 🏛️ 全栈架构设计 (Full-Stack Rust + Tauri)

为了保障多 Agent 在本地同时运行时的极端轻量化与安全性，项目采用了**纯 Rust 服务端 + Tauri 桌面端**的现代化架构组合。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tauri PC 客户端 (桌面宿主)                        │
│                                                                        │
│   ┌────────────────────────────────┐   Tauri IPC (Channel 流式打字)     │
│   │     前端 UI 呈现层 (WebView)     │ ◄──────────────────────────────┐ │
│   │   React + Tailwind + Lucide    │                                │ │
│   └────────────────────────────────┘                                │ │
│                   ▲                                                 │ │
│   ┌───────────────┴──────────────────────────────────────────────┐  │ │
│   │          Tauri Rust 宿主内核 (src-tauri)                      │  │ │
│   │   • tokio 异步多线程引擎                                      │  │ │
│   │   • acp_manager: 异步 stdio 管道监听与子进程生命周期守护      │  │ │
│   │   • 零拷贝 Tauri Channel 逐字推送打字机流式输出               │  │ │
│   │   • 严格的路径沙盒安全校验 (Path Traversal 防护)              │  │ │
│   └──────────────────────────────────────────────────────────────┘  │ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket (Nostr Kind 42 加密事件流)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   服务端集群 (Axum + Tokio Nostr Relay)                 │
│   • ws://0.0.0.0:8080/relay 团队讨论总线                                │
│   • secp256k1 椭圆曲线签名鉴权，不可篡改审计日志                       │
│   • tokio::sync::broadcast 跨房间极速分发 (广播延迟 < 0.1ms)            │
└────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ (stdio JSON-RPC 2.0 报文管道)
┌───────────────────────────────────┴────────────────────────────────────┐
│                    ACP Agents (Local 独立进程 / 替身)                  │
│   • buzz-agent (Rust) / Claude Code / Gemini CLI / 自定义 Agent         │
│   • 独立拥有私有持久 Memory (rusqlite: acp_memories 表)                │
│   • 挂载 buzz-dev-mcp (Shell 执行 / AST 索引 / Git 审查工具)           │
└────────────────────────────────────────────────────────────────────────┘
```

### 技术选型优势 (vs 传统 Electron + Node 方案)

| 评估维度 | 本方案 (Rust Server + Tauri) | 传统方案 (Node.js + Electron) | 对多 Agent 替身协作的价值 |
| :--- | :--- | :--- | :--- |
| **待机内存** | **30 MB ~ 50 MB** | 350 MB ~ 800 MB+ | 同时常驻 5+ 个开发者的替身 Agent 时，电脑依然丝滑 |
| **类型一致性** | 共享 `crates/buzz-protocol` 结构体 | 前后端各自维护 TS/JS 接口 | 由 Rust `serde` 编译期保障，杜绝字段漂移 |
| **进程守护** | Tokio 异步管道无锁分发 | Node.js 单主线程事件阻塞 | 高并发流式打字与多工具并行调用零延迟 |
| **文件安全** | Rust 底层沙盒拦截跨目录攻击 | 需复杂的 contextIsolation 隔离 | 保护开发者主机源码不被恶意路径读取 |
| **安装包体积** | **~15 MB** 原生二进制 | 150 MB+ 捆绑 Chromium | 极速分发与秒级更新 |

---

## 🧠 核心三要素：Memory、Workspace 与 Skill

### 1. 记忆系统：双层共存架构 (Dual-Layer Memory)
* **私有长期记忆 (Private Long-Term Memory)**：每个 Agent 独立持有一个嵌入式 SQLite 数据库（基于 `rusqlite`）。记录了个人工作习惯、代码命名规则、架构偏好。**即使切换不同的讨论房间，这层记忆永不丢失**。
* **团队会话上下文 (Team Room Context)**：进入公共房间后，Buzz 客户端将近期带有 Nostr 签名的上下文打包进 ACP 的 `session/prompt`，让 Agent 实时与团队当前的讨论步调保持一致。

### 2. 工作空间：沙盒根路径与 Git 分支绑定 (Workspace Sandbox)
* ACP 初始化握手（`initialize`）时明确下发 `workspaceRoot`。
* Agent 针对工程文件的修改以统一的 `Unified Diff` 形式回传，并在 Tauri 桌面端由人类点击确认或一键应用，杜绝非预期篡改。

### 3. 技能扩展：MCP 无缝桥接 (Model Context Protocol Integration)
* Agent 自身作为 MCP 客户端，挂载 `buzz-dev-mcp` 或自定义 MCP Server。
* 工具执行包含：
  - `cargo_check` / `clippy_lint`：代码静态安全检查
  - `git_diff_summary`：代码分支变更提炼
  - `shell_exec`：安全受限的命令行构建

---

## 📂 Cargo Workspace 目录结构

```text
buzz/
├── Cargo.toml                       # 根目录 Cargo Workspace 定义
├── README.md                        # 本项目说明书与技术白皮书
├── crates/
│   ├── buzz-protocol/               # [公共共享库] ACP JSON-RPC 2.0 报文与 Nostr 结构体
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── acp.rs               # initialize, session/prompt, trace 数据结构
│   │       ├── nostr.rs             # Kind 42 事件与 secp256k1 签名校验
│   │       └── lib.rs
│   ├── buzz-server/                 # [服务端] 基于 Axum + Tokio 的 Nostr Relay
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs              # 启动 WebSocket 监听端口 (8080)
│   │       └── relay.rs             # tokio::sync::broadcast 消息广播路由
│   ├── buzz-desktop/                # [桌面客户端] Tauri v2 + React 界面
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json      # 窗口、权限与构建目标配置
│   │   │   └── src/
│   │   │       ├── main.rs          # Tauri Command 注册与应用主入口
│   │   │       └── acp_manager.rs   # tokio::process stdio 管道与 Channel 转发
│   │   ├── package.json
│   │   └── src/                     # React + Tailwind 前端 UI
│   ├── buzz-agent/                  # [参考 Agent] 官方 Rust ACP Agent 实现
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── memory.rs            # rusqlite 私有持久化 Memory 引擎
│   │       └── main.rs              # 监听 stdio 响应 ACP 请求
│   └── buzz-dev-mcp/                # [开发者技能扩展] MCP Server (Git/Shell/AST)
└── scripts/
    └── init_project.sh              # 一键本地构建与启动联调脚本
```

---

## ⚡ 快速开始 (Quickstart)

### 1. 环境准备
确保您的本地开发机已安装：
* [Rust](https://www.rust-lang.org/tools/install) (1.78+ / 2021 Edition)
* [Node.js](https://nodejs.org/) (18+)
* Tauri CLI v2：`cargo install tauri-cli --version "^2.0"`

### 2. 一键拉起开发环境
```bash
# 赋予脚本执行权限并运行
chmod +x ./scripts/init_project.sh
./scripts/init_project.sh
```

该脚本将自动完成：
1. 编译共享协议模块 `buzz-protocol`
2. 后台启动 Rust Axum Nostr Relay 服务端 (`ws://127.0.0.1:8080/relay`)
3. 启动 Tauri 桌面端应用 (`cargo tauri dev`) 并热加载前端 WebView

### 3. 单独构建生产安装包
```bash
# 构建完全自包含的原生桌面安装文件
cd crates/buzz-desktop
cargo tauri build
```
编译生成的安装包位于 `crates/buzz-desktop/src-tauri/target/release/bundle/`：
* **macOS**: `.dmg` / `.app`
* **Windows**: `.msi` / `.exe`
* **Linux**: `.deb` / `.AppImage`

---

## 📜 协议交互流程时序图 (ACP Flow)

```text
Human/Team Room               Tauri Rust Core               ACP Agent (替身)
       │                             │                             │
       │─── 1. 发起讨论 @agent ─────>│                             │
       │                             │─── 2. 注入房间上下文 ──────>│
       │                             │    (session/prompt)         │
       │                             │                             │
       │                             │                             ├── 3. 检索私有 Memory
       │                             │                             │    (rusqlite recall)
       │                             │                             │
       │                             │                             ├── 4. 调用工作区技能
       │                             │                             │    (buzz-dev-mcp)
       │                             │                             │
       │                             │<── 5. 逐字流式返回 (stdio) ──│
       │<── 6. Tauri Channel 打字机 ─│                             │
       │    (零拷贝流式渲染)          │                             │
       │                             │                             │
       │─── 7. 广播 Nostr Kind 42 ──>│─── 8. 转发至 Axum Relay ───>│ (全员同步)
```

---

## 🤝 参与贡献与生态愿景

我们相信，未来的开源项目协作不再仅仅是人类在 Slack/Discord 中的文字往来，而是**人类与彼此的 AI 替身在同一个房间内实时共事**。欢迎提交 Issue 或 Pull Request，共同完善 ACP 协议规范与多 Agent 替身生态！

* **官方灵感来源**：[Block Buzz (github.com/block/buzz)](https://github.com/block/buzz)
* **协议标准参考**：[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) / [Agent Client Protocol (ACP)](https://github.com/block/buzz)
* **开源许可证**：Apache-2.0
