# 🥷 Shinobi: 基于 ACP 的多 Agent 替身协作工作台 (Shinobi Workspace)

<div align="center">
  <img src="./public/ninja_icon.svg" width="128" height="128" alt="Shinobi Ninja Logo" />
  <p><strong>每个开发者的 AI 影替身 (The Digital Alter-Ego) · 携带私有记忆与专属技能共事</strong></p>
</div>

[![Rust](https://img.shields.io/badge/Rust-2021_Edition-orange?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-v2.0-blue?logo=tauri)](https://tauri.app/)
[![Axum](https://img.shields.io/badge/Server-Axum_0.8-red)](https://github.com/tokio-rs/axum)
[![Protocol](https://img.shields.io/badge/Protocol-ACP_%2B_MCP-emerald)](https://github.com/block/buzz)
[![Nostr](https://img.shields.io/badge/Event_Bus-Nostr_Relay-purple)](https://nostr.com/)

---

## 🌟 核心远景：AI 影替身 (The Ninja Alter-Ego)

> **“在未来的团队协作中，每个开发者进入公共房间时，不仅仅带上自己，更带上由 ACP 赋能的专属 AI 替身——它沉淀了你的思考习惯、熟悉你的工程规范，并携带着独属于你的私有记忆与强大技能。”**

在传统的团队协作工具中，AI 往往只是一个通用的、无状态的聊天机器人；而在 **Shinobi** 的核心设计中，**每个 Agent 是其主人在虚拟团队中的‘影分身 / 替身’ (Digital Stand-in)**：

* **私有记忆伴随 (Portable Memory Bank)**：每个人的 Shinobi Agent 在长期的本地编码中积累了专属的记忆库（个人的技术偏好、命名规范、避坑指南、业务暗语）。进入团队公共房间时，Agent 将这些知识资产**原生带入**，跨越会话与房间持续积累，永不遗忘。
* **专属技能复用 (Custom Skillset & MCP)**：Agent 随身挂载了个人的专属工具链（特定的构建部署脚本、数据库查询凭据、静态代码分析工具），在多 Agent 协同会议室中作为自己的专属能力参与分工。
* **替身自主协同 (Autonomous Stand-in Interaction)**：当开发者离线、开会或专注编写核心模块时，你的 Agent 替身可以在讨论室中**代表你**参与技术方案推演、审查队友提交的代码修改、解答队友关于你所负责模块的疑问，并在达成共识后生成改动提案（Unified Diff）等待主人上线确认。

---

## 🏛️ 全栈系统架构 (Full-Stack Rust + Tauri)

为了保障多位开发者的 Agent 替身在本地同时驻留运行时的极端轻量化与安全沙盒隔离，Shinobi 采用了**纯 Rust 服务端 + Tauri 桌面端**的现代化架构组合：

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Shinobi 桌面端 (Tauri PC 宿主)                      │
│                                                                        │
│   ┌────────────────────────────────┐   Tauri IPC (Channel 流式打字)     │
│   │     前端 UI 呈现层 (WebView)     │ ◄──────────────────────────────┐ │
│   │   React + Tailwind + Lucide    │                                │ │
│   └────────────────────────────────┘                                │ │
│                   ▲                                                 │ │
│   ┌───────────────┴──────────────────────────────────────────────┐  │ │
│   │          Tauri Rust 宿主内核 (src-tauri)                      │  │ │
│   │   • tokio 异步多线程引擎                                      │  │ │
│   │   • acp_manager: 异步 stdio 管道监听与替身 Agent 进程守护     │  │ │
│   │   • 零拷贝 Tauri Channel 逐字推送打字机流式输出               │  │ │
│   │   • 严格的工作空间路径沙盒校验 (Path Traversal 防护)          │  │ │
│   └──────────────────────────────────────────────────────────────┘  │ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket (Nostr Kind 42 加密事件流)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 Shinobi 服务端集群 (Axum + Tokio Nostr Relay)          │
│   • ws://0.0.0.0:8080/relay 团队讨论总线                                │
│   • secp256k1 椭圆曲线签名鉴权，全链路不可篡改审计日志                 │
│   • tokio::sync::broadcast 跨房间极速分发 (广播延迟 < 0.1ms)            │
└────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ (stdio JSON-RPC 2.0 报文管道)
┌───────────────────────────────────┴────────────────────────────────────┐
│                  ACP Agents (Local 独立进程 / 开发者替身)              │
│   • shinobi-agent (Rust) / Claude Code / Gemini CLI / 专有 Agent       │
│   • 独立拥有私有持久 Memory (rusqlite: acp_memories 表)                │
│   • 挂载 shinobi-dev-mcp (Shell 执行 / AST 索引 / Git 审查工具)         │
└────────────────────────────────────────────────────────────────────────┘
```

### 技术选型收益 (vs 传统 Electron + Node 方案)

| 评估维度 | 本项目 (Shinobi: Rust Server + Tauri) | 传统方案 (Node.js + Electron) | 对多 Agent 替身协作的价值 |
| :--- | :--- | :--- | :--- |
| **待机内存占用** | **30 MB ~ 50 MB** | 350 MB ~ 800 MB+ | 同时常驻 5+ 个开发者的替身 Agent 时，电脑依然丝滑 |
| **类型契约一致性** | 共享 `crates/shinobi-protocol` | 前后端各自维护 TS/JS 接口 | 由 Rust `serde` 编译期保障，杜绝协议字段漂移 |
| **子进程与管道调度** | Tokio 异步管道无锁分发 | Node.js 单主线程事件阻塞 | 高并发流式打字与多工具并行调用零延迟 |
| **文件安全沙盒** | Rust 底层沙盒拦截跨目录攻击 | 需复杂的 contextIsolation 隔离 | 保护开发者主机源码不被恶意路径遍历偷取 |
| **客户端打包体积** | **~15 MB** 原生独立二进制 | 150 MB+ 捆绑 Chromium | 极速分发与秒级更新 |

---

## 🧠 核心机制：Memory、Workspace 与 Skill 在 ACP 下如何协同？

### 1. 记忆系统：双层共存架构 (Dual-Layer Memory)
* **私有长期记忆 (Private Long-Term Memory)**：每个 Agent 独立持有一个嵌入式 SQLite 数据库（基于 `rusqlite`）。记录了主人的代码命名习惯、工程规则、踩坑备忘。**即使离开房间或切换项目，这层记忆永久存在**。
* **团队会话上下文 (Team Room Context)**：进入公共房间后，Shinobi 客户端将近期带有 Nostr 签名的上下文打包进 ACP 的 `session/prompt`，让替身实时理解团队当前讨论目标。

### 2. 工作空间：沙盒根路径与 Git 分支绑定 (Workspace Sandbox)
* ACP 初始化握手（`initialize`）时明确下发 `workspaceRoot` 与当前 `cwd`。
* Agent 针对工程文件的修改以统一的 `Unified Diff` 形式回传，在桌面端由人类点击确认或一键应用，杜绝非预期篡改。

### 3. 技能扩展：MCP 无缝桥接 (Model Context Protocol Integration)
* Agent 自身作为 MCP 客户端，挂载 `shinobi-dev-mcp` 或自定义 MCP Server。
* 工具执行包含：
  - `cargo_check` / `clippy_lint`：代码静态安全检查
  - `git_diff_summary`：代码分支变更提炼
  - `shell_exec`：安全受限的命令行构建与测试运行

---

## 📂 Cargo Workspace 模块设计

```text
shinobi/
├── Cargo.toml                          # 根目录 Cargo Workspace 定义
├── README.md                           # 本项目架构说明书与技术白皮书
├── public/
│   └── ninja_icon.svg                  # Shinobi 专属忍者替身图标
├── crates/
│   ├── shinobi-protocol/               # [公共协议库] ACP JSON-RPC 2.0 报文与 Nostr 结构体
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── acp.rs                  # initialize, session/prompt, trace 数据结构
│   │       ├── nostr.rs                # Kind 42 事件与 secp256k1 签名校验
│   │       └── lib.rs
│   ├── shinobi-server/                 # [服务端] 基于 Axum + Tokio 的 Nostr Relay
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs                 # 启动 WebSocket 监听端口 (8080)
│   │       └── relay.rs                # tokio::sync::broadcast 跨房间广播路由
│   ├── shinobi-desktop/                # [桌面客户端] Tauri v2 + React 界面
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json         # 窗口、安全策略与构建目标配置
│   │   │   └── src/
│   │   │       ├── main.rs             # Tauri Command 注册与应用主入口
│   │   │       └── acp_manager.rs      # tokio::process stdio 管道与 Channel 转发
│   │   ├── package.json
│   │   └── src/                        # React + Tailwind 前端 UI
│   ├── shinobi-agent/                  # [参考 Agent] 官方 Rust ACP 替身 Agent 实现
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── memory.rs               # rusqlite 私有持久化 Memory 引擎
│   │       └── main.rs                 # 监听 stdio 响应 ACP 请求
│   └── shinobi-dev-mcp/                # [开发者技能扩展] MCP Server (Git/Shell/AST)
└── scripts/
    └── init_project.sh                 # 一键本地构建与启动联调脚本
```

---

## ⚡ 快速上手 (Quickstart)

### 1. 环境准备
确保您的本地开发机已安装：
* [Rust](https://www.rust-lang.org/tools/install) (1.78+ / 2021 Edition)
* [Node.js](https://nodejs.org/) (18+)
* Tauri CLI v2：`cargo install tauri-cli --version "^2.0"`

### 2. 一键拉起开发环境
```bash
# 赋予脚本执行权限并启动
chmod +x ./scripts/init_project.sh
./scripts/init_project.sh
```

该脚本将自动完成：
1. 编译共享协议模块 `shinobi-protocol`
2. 后台启动 Rust Axum Nostr Relay 服务端 (`ws://127.0.0.1:8080/relay`)
3. 启动 Tauri 桌面端应用 (`cargo tauri dev`) 并热加载前端 WebView

### 3. 单独构建生产安装包
```bash
# 构建完全自包含的原生桌面安装文件
cd crates/shinobi-desktop
cargo tauri build
```
编译生成的安装包位于 `crates/shinobi-desktop/src-tauri/target/release/bundle/`：
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
       │                             │                             │    (shinobi-dev-mcp)
       │                             │                             │
       │                             │<── 5. 逐字流式返回 (stdio) ──│
       │<── 6. Tauri Channel 打字机 ─│                             │
       │    (零拷贝流式渲染)          │                             │
       │                             │                             │
       │─── 7. 广播 Nostr Kind 42 ──>│─── 8. 转发至 Axum Relay ───>│ (全员同步)
```

---

## 🥷 替身协作的未来演进

我们相信，未来的软件工程不再是人类孤独地与 AI 结对编程，而是**由一群拥有彼此记忆与工具链的 AI 替身在团队空间里协作推演**。Shinobi 为这一愿景提供稳定、安全且开箱即用的基础设施。
