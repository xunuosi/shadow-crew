# 🥷 Shadow Crew（Shinobi）

<div align="center">
  <img src="./public/ninja_icon.svg" width="120" height="120" alt="Shadow Crew Logo" />
  <p><strong>本地优先的多 Agent 协同与确定性决策工作台</strong></p>
  <p>让拥有独立记忆、工具与工作区的 Agent，在频道和议题中真正协作，而不只是轮流聊天。</p>
</div>

[![React](https://img.shields.io/badge/UI-React_19-61DAFB?logo=react)](https://react.dev/)
[![Tauri](https://img.shields.io/badge/Desktop-Tauri_2-24C8DB?logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Core-Rust_2021-000000?logo=rust)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/Storage-SQLite_+_WAL-003B57?logo=sqlite)](https://sqlite.org/)
[![ACP](https://img.shields.io/badge/Protocol-ACP_+_MCP-10B981)](https://agentclientprotocol.com/)

> Shadow Crew 是原 **Shinobi** 项目的当前产品名。它是一套运行在本地桌面端的 Agent 协作空间：用户与多个通过 **ACP（Agent Client Protocol）** 接入的 Agent 共享项目、频道、私聊与议题，并通过普通协同模式或 4+1 博弈裁决模式完成讨论、审查与落地。

---

## 当前能力

| 能力域 | 已落地的实现 |
| :--- | :--- |
| **协同空间** | 项目、频道、私聊、标准议题与博弈议题；支持成员准入、话题抽屉、中途 Steering 插话与跨议题并行执行。 |
| **普通协同模式** | 基于会话水位线的 `<delta-events>` 增量上下文、首轮并发 Fan-out、`Promise.allSettled` Turn Barrier、跨回复 `@mention` 去重和“静默即成功”收敛。 |
| **CognoNexus 4+1 决策** | Proposer → Challenger → Verifier → Defender → Arbiter + Human；FSM 单向推进、阶段契约、法定人数门禁、结构化裁决与后仲裁执行闭环。 |
| **G-Frame 模块化编排** | 2～4 个原子模块拆解、只读公共接口契约、模块上下文物理隔离、文件白名单、贝叶斯先验/后验路由与模块级冻结。 |
| **上下文治理** | 冷/热会话双态 Prompt、1M～2M 上下文模型规格、桌面端 512K 稳态预算、微型总结 Agent 与规则压缩双模降级、Session Key 作用域隔离。 |
| **ACP 运行时** | 自动发现本地 ACP、stdio 进程托管、远程 WebSocket 端点探测、流式输出、取消/中止、会话清理与故障隔离。 |
| **会话恢复** | SQLite 持久化 Session 映射；支持 `session/load` 时优先协议级恢复，否则以 `session/new` + 平台层增量上下文补偿。 |
| **本地工具链** | 内置 `shadow-crew-dev-mcp`，提供文件读写、搜索、Shell、Channel/Agent Artifact、`submit_arbitration_ruling` 与 `submit_module_decomposition`。 |
| **本地数据与审计** | SQLite 单一事实源、WAL 并发读写、工作区路径校验、符号链接/TOCTOU 防护、运行日志与消息历史本地留存。 |
| **可选基础设施** | 远程 ACP WebSocket 与独立 `shadow-crew-server` Nostr Relay 作为演进能力保留；默认本地协作不依赖远端 Relay。 |

---

## 协作与决策编排

### 1. 普通协同模式：增量上下文 + 轮内并发

适用于问答、头脑风暴、方案评审和跨工种协作。首轮可并行唤醒多个 Agent；每个 Agent 完成后立即上屏，但只有本轮全部结束后才进入下一跳判定。

```mermaid
flowchart LR
    U["用户消息"] --> F["首轮并发 Fan-out"]
    F --> A["Agent A"]
    F --> B["Agent B"]
    A --> R["消息即时上屏"]
    B --> R
    R --> T["Turn Barrier<br/>等待本轮全部 Settled"]
    T --> M["聚合、去重并校验 @mention"]
    M -->|有有效提及| N["下一轮并发"]
    M -->|无新增提及| C["静默收敛"]
    N --> T
```

关键设计：

- 每个 `(roomId, agentId)` 独立维护会话水位线，水位线在 **投递时更新**，避免并发乱序导致漏读或重复读取。
- 冷启动一次性注入议题背景与成员信息；热会话只发送未读 `<delta-events>`，减少重复上下文并提高 Prefix Cache 命中率。
- 单批最多 50 条增量事件；系统消息、Pending 占位和 Agent 自身发言会被过滤。
- 本轮多个 Agent 同时点名同一目标时只唤醒一次，并合并调用方与来源消息。
- 默认协同链最大深度为 12；无新增信息时自然静默，异常回环另有单 Agent 频次兜底。
- `<delta-events>`、`<topic-context>` 等语义边界文本会被转义，避免外部消息伪造系统指令。

详细规范：[普通模式增量上下文与并发编排规范](docs/SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md)

### 2. 博弈裁决模式：CognoNexus 4+1

适用于高风险架构选型、复杂 Bug 归因、安全边界评审等需要“攻击—验证—修正—裁决”的场景。

```mermaid
flowchart TB
    D["阶段 0 · 模块拆解<br/>G-Frame optional"] --> P["阶段 1 · 提案立论"]
    P --> C["阶段 2 · 红队挑战"]
    C --> V["阶段 3 · 接地验证"]
    V --> R["阶段 4 · 答辩与 Patch v2"]
    R --> A["阶段 5 · 权衡矩阵与仲裁"]
    A --> H{"人类法槌"}
    H -->|定案| E["阶段 6 · 执行与归档"]
    H -->|制衡方缺席| X["具名豁免或继续澄清"]
```

四类机器人角色加一位人类终审者：

| 角色 | 职责 |
| :--- | :--- |
| 🏛️ **Proposer** | 探索解空间，提交方案 v1，并根据反例输出防御补丁 v2。 |
| ⚔️ **Challenger** | 指定异议者，寻找逻辑漏洞、脆弱假设和极端失效工况。 |
| 🔍 **Verifier** | 不参与主观辩论，负责只读检索、静态检查与受控沙箱验证。 |
| ⚖️ **Arbiter** | 汇总证据与权衡矩阵，通过结构化 MCP 契约提交裁决草案。 |
| 👤 **Human** | 持有最终法槌；缺席豁免必须具名并留痕。 |

博弈模式不只依赖 Prompt 约束，而是由 FSM 和代码门禁共同控制。技术报告中的 **7 大 Token 控制机制 + 9 大结果趋真机制** 已进入主链路：

| Token 控制 | 结果趋真 |
| :--- | :--- |
| Wald-SPRT 早停与死锁熔断 | DIANOIA 4+1 职能解耦与 6 阶段 FSM |
| LMAD Top-5 论点抽取、Claim DAG 与三态脱水 | Free-MAD 去共识化红队契约 |
| 阶段靶点按需挂载与滑动窗口截断 | T1/T2 接地验证、原子承诺链与未实证早停锁 |
| 静默收敛与 LoopGuard | BSS/DSS 谄媚量化、投降拦截与信任折减 |
| 阶段契约有界 Self-Refine（最多 2 次） | ReConcile 异构模型检测与校准置信度矩阵 |
| ColMAD 冗余与车轱辘话惩罚 | LLM + BWM 确定性求解与 `ξ* ≤ 0.12` 一致性门禁 |
| 神经符号计算卸载与 MCP 契约直通 | 少数派异议报告、Quorum Gate 与活体 ADR |

完整说明：[Token 消耗控制与决策准确性保障技术报告](docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md)

### 3. G-Frame 模块化分治

复杂任务先在阶段 0 拆成 2～4 个单一职责模块，并锁定跨模块只读公共接口契约。之后每个模块只看到自己的职责、允许文件和公共契约，避免长篇全量上下文造成接口漂移与跨模块回归。

```mermaid
flowchart LR
    T["复杂研发任务"] --> S["阶段 0<br/>拓扑拆解 + 公共契约"]
    S --> M1["模块 M1 沙箱"]
    S --> M2["模块 M2 沙箱"]
    S --> M3["模块 M3 沙箱"]
    M1 --> B{"贝叶斯后验"}
    M2 --> B
    M3 --> B
    B -->|低风险| F["静态验证后冻结"]
    B -->|高风险或验证失败| R["红队挑战 / 局部重修"]
    R --> F
    F --> ADR["活体 ADR 拼装"]
    ADR --> X["按模块 DAG 分派执行"]
```

- `allowedFiles` 构成模块爆炸半径，越界修改或白名单重叠会被拦截。
- 低风险模块可走 `fast_track`；契约违规、证伪主张或边缘案例增加会推动后验风险上升并升级到 `deep_debate`。
- 已冻结模块不参与其他模块的重新生成，故障只在当前模块沙箱内局部修复。
- Wave 1（类型与贝叶斯调控器）、Wave 2（MCP 拆解与上下文隔离）、Wave 3（模块矩阵与 ADR）均已接入。

详细规范：[G-Frame 贝叶斯模块化编排规范](docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md)

---

## 系统架构

Shadow Crew 当前以 **Tauri 桌面宿主 + React 工作台** 为主路径。频道消息、实体状态、记忆与 ACP Session 均默认保存在本机 SQLite；Agent 通过 ACP 独立运行，平台只负责编排、协议桥接、状态治理与结果归档。

```mermaid
flowchart TB
    subgraph Desktop["Shadow Crew Desktop"]
        UI["React 19 + Vite<br/>频道 / 私聊 / 议题 / ADR 画布"]
        IPC["Tauri IPC Commands & Events"]
        subgraph Rust["Rust Host"]
            ACP["AcpProcessManager<br/>进程、会话、流式事件"]
            DB["DatabaseManager<br/>SQLite + WAL"]
            DISC["Agent Discovery<br/>本地 ACP 探测"]
            SAFE["Workspace Guard<br/>路径与符号链接校验"]
        end
        UI <--> IPC
        IPC <--> ACP
        IPC <--> DB
        IPC <--> DISC
        IPC <--> SAFE
    end

    ACP <-->|JSON-RPC over stdio| LOCAL["本地 ACP Agent<br/>Shadow Crew / Codex / Claude 等"]
    ACP <-->|可配置 WebSocket| REMOTE["远程 ACP 端点"]
    ACP <-->|MCP tools/call| MCP["shadow-crew-dev-mcp<br/>文件 / Shell / 裁决 / 拆解"]
    LOCAL <-->|运行时自有鉴权边界| MODEL["模型 API / CLI"]
    DB --> STORE["~/.shadow-crew/global_memory.sqlite"]
    RELAY["shadow-crew-server<br/>可选 Nostr Relay"] -.-> PROTO["shadow-crew-protocol<br/>Nostr Kind 42 / secp256k1"]
```

### 技术栈

- **桌面端**：Tauri 2、Rust、Tokio
- **前端**：React 19、TypeScript 5.8、Vite 6、Tailwind CSS 4
- **Agent 协议**：ACP JSON-RPC 2.0、MCP
- **持久化**：SQLite、WAL
- **分布式协议基础**：Axum 0.8、Nostr Kind 42、secp256k1（可选 Relay 层）

### 本地数据布局

```text
~/.shadow-crew/
├── global_memory.sqlite        # 消息、Agent、频道、议题、记忆与 ACP Session
├── channels/<channel_id>/      # 频道公共工作区、artifacts、scratch
├── agents/<agent_id>/          # Agent 私有工作区
└── logs/acp.log                # ACP 运行日志
```

可通过 `SHADOW_CREW_HOME` 调整运行根目录，通过 `SHADOW_CREW_MEMORY_DB` 指定数据库路径。日志与数据库可能包含讨论正文，分享诊断材料前应先脱敏。

---

## 项目结构

```text
shadow-crew/
├── src/                              # React 工作台与协同编排
│   ├── App.tsx                       # 应用状态、讨论主流程与执行闭环
│   ├── components/                   # 频道、议题、ADR、Agent 配置等 UI
│   ├── services/
│   │   ├── agentCollaboration.ts     # 增量上下文、Prompt 编译与 Turn Barrier
│   │   ├── acpClient.ts              # ACP 前端契约、流式事件与会话清理
│   │   ├── llmService.ts             # 模型调用、Token 预算与双模压缩
│   │   └── cogno/                    # SPRT、LMAD、BWM、G-Frame 等治理引擎
│   └── types.ts                      # 领域模型、FSM 与治理状态类型
├── src-tauri/                        # Tauri 桌面宿主
│   └── src/
│       ├── main.rs                   # Tauri Commands 与应用入口
│       ├── acp_manager.rs            # ACP 进程、Session 生命周期与恢复
│       └── db_manager.rs             # SQLite 单一事实源与存储治理
├── crates/
│   ├── shadow-crew-protocol/         # ACP / Nostr 共享协议结构
│   ├── shadow-crew-agent/            # Rust 原生参考 ACP Agent
│   ├── shadow-crew-dev-mcp/          # 内置开发与决策 MCP Server
│   └── shadow-crew-server/           # 可选 Axum Nostr Relay
├── bin/codex-acp                     # Codex ACP 适配桥
├── docs/                             # PRD、技术规范、测试方案与架构决策
├── scripts/                          # 迁移与辅助脚本
└── public/                           # 桌面与 Web 品牌资源
```

---

## 快速开始

### 环境要求

- Node.js 18+（推荐 20/22 LTS）
- 当前稳定版 Rust 与 Cargo（Edition 2021）
- 对应平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)
- 如需接入外部 Agent，请另行安装其 CLI 与 ACP 适配器

### 1. 安装依赖

```bash
npm ci
```

### 2. 预构建内置 Agent 与 MCP

```bash
cargo build -p shadow-crew-agent -p shadow-crew-dev-mcp
```

### 3. 启动桌面端

```bash
npm run dev:desktop
```

首次启动后，在 **Agents** 面板连接本地 ACP 运行时。应用会自动扫描已安装的适配器；外部 Agent 的环境变量与模型认证由对应 ACP 进程自身管理。

### 前端单独调试

```bash
npm run dev
```

仅启动 Vite 前端，适合检查布局与纯前端逻辑；ACP 进程托管、SQLite 命令和本地工作区能力需要 Tauri 宿主。

### 生产构建

```bash
npm run build
npm run tauri build
```

桌面安装包输出位置由 Tauri bundle 配置决定，当前 targets 包含 macOS、Debian 与 Windows NSIS。

### 可选：启动 Nostr Relay

```bash
cargo run -p shadow-crew-server
```

该服务默认监听 `ws://127.0.0.1:8080/relay`，属于可选基础设施；它不是本地桌面协作链路的启动前置条件。

---

## 质量门禁

提交前至少执行：

```bash
# TypeScript 类型检查
npm run lint

# 前端生产构建
npm run build

# CognoNexus + G-Frame 主回归
npm run test:cogno
npm run test:cogno:edge

# 普通模式增量上下文与并发编排
npx tsx src/services/test-normal-mode-buzz-orchestration.ts

# 上下文预算与双模压缩
npx tsx src/services/test-llm-compaction-governance.ts

# @mention 解析与边界保护
npx tsx src/services/test-mention-resolution.ts

# Rust MCP 工具契约
cargo test -p shadow-crew-dev-mcp
```

涉及 Agent 进程、Session 清理、工作区隔离或 Game FSM 的修改，还应补充对应的运行期回归。仓库交付规则见 [AGENTS.md](AGENTS.md)：完成修改后执行必要性验证，并以原子化、语义化 commit 固化结果。

---

## 技术方案索引

| 文档 | 当前定位 |
| :--- | :--- |
| [Token 消耗控制与决策准确性保障技术报告](docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md) | CognoNexus 全景技术报告；7 大 Token 控制、9 大准确性机制及 10 篇论文映射。 |
| [4+1 博弈编排协议规范](docs/SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md) | FSM、阶段载荷、Quorum Gate、后仲裁执行与 CognoNexus 核心算法。 |
| [G-Frame 贝叶斯模块化编排规范](docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md) | 模块拓扑拆解、公共契约、上下文隔离、贝叶斯调控与 Wave 1～3 落地方案。 |
| [普通模式增量上下文与并发编排规范](docs/SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md) | 生产生效中的 `<delta-events>` 水位线、冷热双态 Prompt 与 Turn Barrier。 |
| [Messaging Space PRD](docs/PRD_MESSAGING_SPACE.md) | 项目、频道、私聊、议题和成员模型。 |
| [多 Agent 讨论与 Steering PRD](docs/PRD_MULTI_AGENT_DISCUSSION_AND_STEERING.md) | 轮次治理、终止机制、中途插话与旁路议题。 |
| [远程 ACP 与记忆流转 PRD](docs/PRD_ACP_REMOTE_AND_MEMORY.md) | 跨端远程连接、`.acpmem` 记忆导出/导入与安全边界，仍按演进项治理。 |
| [远程 ACP 与记忆技术规范](docs/TECH_SPEC_ACP_REMOTE_AND_MEMORY.md) | Transport Bridge、记忆漏斗、IPC 契约与实施路线。 |
| [多 Agent 测试指南](docs/TestDocs/multi_agent_test_suite_and_guide.md) | 真实桌面端多轮接力、无屏障并发与收敛验收用例。 |

建议阅读顺序：**普通模式规范 → 4+1 协议 → Token/准确性技术报告 → G-Frame 规范 → 测试指南**。

---

## 当前边界与下一阶段

Shadow Crew 当前坚持 **local-first**：

- 默认消息、状态、记忆和 Session 都由本地 SQLite 管理；桌面端主协作链路不依赖云端 Relay。
- 远程 ACP WebSocket 已具备连接配置与请求能力，但跨端身份、配额、审计与断线恢复仍需按技术规范继续加固。
- `shadow-crew-server` 与 Nostr Kind 42 是可选协议基础；默认桌面宿主尚未把入站订阅作为主协作链路。
- 性能、节省比例等指标应以本地运行数据为准，不以理论值替代可观测结果。

下一阶段重点：

1. 完成真实桌面端 4 Agent、多轮次长链路验收，覆盖会话清理、进程重启、模式切换与增量上下文。
2. 建立热会话上下文缩减率、压缩延迟、摘要降级率、错误率与端到端延迟基线。
3. 继续推进远程 ACP、记忆包迁移和可选 Relay 的鉴权、配额与审计治理。
4. 保持 CognoNexus 与 G-Frame 回归基线，持续验证“低 Token”与“高可信裁决”不是互斥目标。

---

<div align="center">
  <strong>先把协作做真，再把规模做大。</strong>
</div>
