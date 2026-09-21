# 🥷 Shinobi 功能特点 × 提效场景对照表

> **文档类型**：对外产品文档的「取用底稿」（feature × scenario ledger）
> **版本**：v1.0 · **议题**：topic-1789872237972 · **核查日期**：2026-09-21
> **核查方式**：仓库源码逐条定位 + 运行时实录（`shinobi_agent_memory.db`、`src-tauri/logs/acp.log`）+
> 与 `README.md`、`docs/WHITEPAPER_SHINOBI_EFFICIENCY.md`、`docs/PRODUCT_BRIEF_SHINOBI_EFFICIENCY.md` 交叉比对
> **用途**：本文档不用于对外分发，而是**在撰写对外材料时逐条取用的判定底稿**。
> 每条能力都带 `对外可用性` 判定，防止说服材料在第一次技术评审时被一条 grep 击穿。

**对外可用性三档**

| 档位 | 含义 | 写法要求 |
|---|---|---|
| 🟢 **可直接对外** | 代码/运行时可实证 | 可正面陈述，无需限定 |
| 🟡 **限定措辞** | 有实现但有缺口 | 必须写明生效边界（"本地运行""前端实现""尚未接通外部"） |
| 🔴 **不可对外** | 与实现不符或未实装 | 从对外材料中删除；若已写入需回收 |

---

## 一、功能特点清单（代码实证版）

### 1.1 可对外主张的能力

| # | 功能特点 | 实证位置 | 对外可用性 | 建议措辞 |
|---|---|---|---|---|
| F1 | **多 Agent 级联接力**：频道内互相 @ 即自动触发下一跳，并携带前序完整语境 | `src/services/agentCollaboration.ts`（`parseAgentMentions` / `buildCascadePrompt`）；`src/App.tsx:1384` 派发链 | 🟢 | "Agent 之间可互相点名接力，讨论不依赖人类转述" |
| F2 | **回环熔断**：级联深度硬上限 12 轮，防 Token 空耗 | `src/App.tsx:2089`（`maxDepth: 12`） | 🟢 | "内置回环兜底，多 Agent 互喷不会失控" |
| F3 | **静默收敛**：无增量信息时直接收敛，不向消息流注入打断卡片 | `src/App.tsx:1555-1575`；`src/types.ts:183`（`circuitBreakReason`） | 🟢 | "讨论达共识即自然静默，不制造噪音" |
| F4 | **议题治理机制**：各 Agent 首轮独立推演、议题成员边界约束、Steering 人工插话融合 | `docs/TECH_SPEC_MULTI_AGENT_DISCUSSION_AND_STEERING.md`；`src/App.tsx:130` | 🟢 | "支持多人多 Agent 的结构化议题推演" |
| F5 | **本地 ACP 进程托管 + 逐字流式输出** | `src-tauri/src/acp_manager.rs`（tokio stdio 管道 + Tauri Channel） | 🟢 | "本地托管、逐字打字机输出、无云端中转" |
| F6 | **工作区路径沙盒**：跨目录访问被底层拒绝 | `src-tauri/src/main.rs:122-129`（`canonicalize` + `Path traversal outside workspace denied`） | 🟢 | "文件访问被限制在工作区根内" |
| F7 | **消息全量落 SQLite**（含 thread/channel 三维索引），讨论过程可回放 | `src-tauri/src/db_manager.rs:73-88`；实测 `messages` 100 行 | 🟢 | "所有讨论过程落本地库、可回放可审计" |
| F8 | **私有记忆持久化**（跨会话不丢） | `src-tauri/src/db_manager.rs:64`（`acp_memories`，WAL） | 🟡 | 必须写"具备持久化能力"，**不可**写"已沉淀了你的知识资产"（实测仅 2 条，见 3.2） |
| F9 | **记忆导出 / 卡带 / 访客只读克隆** | `src/services/memoryBundle.ts`、`MemoryExportModal.tsx`、`MemoryImportModal.tsx` | 🟡 | 必须写明"**前端实现**"——脱敏与只读目前靠 UI 自律，非架构强制 |

### 1.2 与实现不符、不可对外（本轮新发现）

| # | README/材料中的说法 | 实测 | 判定 |
|---|---|---|---|
| X1 | `shinobi-dev-mcp` 提供 `cargo_check` / `clippy_lint` / `git_diff_summary` / `shell_exec` 四类工具，"Shell 执行 / AST 索引 / Git 审查" | 源码只声明 **2 个**工具（`cargo_clippy`、`git_diff_summary`），**无 shell_exec、无 AST** | 🔴 |
| X2 | MCP 工具被 Agent 实际调用以执行静态检查 | `tools/call` 分支**返回硬编码常量**：`"Execution completed with status: SUCCESS. 0 warnings."`——**不执行任何命令**，且无论输入如何都报 SUCCESS（`crates/shinobi-dev-mcp/src/main.rs:39-50`） | 🔴 |
| X3 | Agent 挂载 shinobi MCP 工具集参与协作 | 运行时实录：`acp.log` 中 **30/30 次 `session/new` 均传 `mcpServers:[]`**——从未挂载任何 MCP Server | 🔴 |
| X4 | 纯 Rust 内核，前端只是呈现层 | 代码量：Rust 共 **2,548 行**，前端 TS/TSX 共 **20,317 行**（≈ 1 : 8） | 🟡 叙述需调整 |
| X5 | 目录结构含 `crates/shinobi-desktop` 完整桌面端 | 该目录**为空壳**，且**不在** `Cargo.toml` workspace members 中（真实宿主为顶层 `src-tauri`） | 🟡 引用结构图需修正 |

> **X1–X3 是本轮最需要决策者知道的三条**：任何"Agent 自带工具链 / 自动静态检查 / 自动跑测试"的提效主张，
> 在当前代码上**没有一条能成立**。而这三条恰恰是"提效"叙事里最容易被写进 PPT 的部分。

---

## 二、提效场景清单（按落地成熟度排序）

前置共识（沿用白皮书结论，本轮复核后维持）：
> 提效的来源不是单位时间产量，而是 **把人从关键路径上摘下来**；瓶颈已迁移到"人的审阅 + 拍板带宽"；
> 可替代度 ≈ 1 / 人工验证成本。

| # | 提效场景 | 作用机制 | 现成熟度 | 度量口径 | 前置条件（缺口） |
|---|---|---|---|---|---|
| **S1** | **技术支持答疑**（队友问"你负责的模块为什么这么设计") | 替身基于私有记忆异步代答，人不在场 | 🟡 **工程就绪、链路未通** | 人工介入率、平均等待时间、提问者判定解决率（**自带 ground truth**） | 🔴 **入站订阅未实装**：`nostr_relay_url` 是死字段（`main.rs:19` 声明、`:220` 赋值、零读取点）；宿主无 relay 订阅任务。**当前只能"问自己的替身"** |
| **S2** | **方案讨论 / 技术选型并行推演** | 多条技术路线并行出观点与取舍证据，人只做收敛 | 🟢 **同机多 Agent 已可跑**（本议题即实例） | 往返轮次、澄清问题数、决策延迟 | ⚠️ 需绑定异见位 + 结论溯源，否则退化为共识幻觉 |
| **S3** | **变更预审（代码审查前置）** | Agent 先审 diff，人只看结论与证据 | 🔴 **当前不可交付** | 返工率、漏检率 | 🔴 依赖 X1–X3 的 MCP 工具链，**未实装**（现实中只能靠宿主 Agent 自身能力，非 Shinobi 能力） |
| **S4** | **跨模块 / 新人上下文重建** | 记忆资产免去反复解释模块暗语 | ⚪ **无法验证** | 上手周期、重复解释次数 | 🔴 记忆表实测仅 **2 条**（见 3.2），无数据可证 |
| **S5** | **无人值守时段延伸（夜间/会议中推进）** | 离线窗口继续推进可机器验证的任务 | 🟡 **受限** | 离线窗口内有效推进的任务数 | 🔴 `src-tauri/src/main.rs:100` 显式禁止程序自发拉起 Agent（**有意的安全设计**）；放开需决策授权 |
| **S6** | **技术排期评估** | — | 🔴 **不授权** | — | 排期是"历史数据拟合 + 承诺兑现"，非推理题，且试点周期内无 ground truth 可闭环。**降级为范围/依赖/风险清单 + 历史耗时分布供给** |

---

## 三、本轮新增核查发现（增量证据）

### 3.1 对外材料里最危险的三个数字（建议写进评审答疑）

- **30 / 30**：`acp.log` 全部 30 次 `session/new` 的 `mcpServers` 均为空数组。
- **2 个**：`shinobi-dev-mcp` 实际声明的工具数（README 写 4 类）。
- **1 : 8**：Rust 与前端 TypeScript 代码量之比（2,548 : 20,317）。
- **22.5 MB**：`src-tauri/logs/acp.log` 当前体积，纯文本 append；且同一份 `available_commands_update` 大对象被整段重复落盘。

### 3.2 记忆资产现状（对"私有记忆库"叙事的影响）

| 项 | 实测值 |
|---|---|
| `acp_memories` 行数 | **2**（`coding_style` 1 条 + `identity` 1 条） |
| `messages` 行数 | **100** |
| 质量字段 | 无（无 `verified_by` / `last_used_at` / `feedback`） |
| 可清理性 | 注释标注为"不可清理资产" |

**含义**：记忆机制**存在且持久化**（可对外陈述能力），但**资产本身尚未形成**（不可对外陈述"已沉淀知识"）。
对外材料若写"替身携带你积累的经验"，目前会与实测数据正面对撞。

### 3.3 对外禁用句式（把这三句从任何版本中删掉）

| 禁用句式 | 原因 |
|---|---|
| "Agent 可自动运行静态检查 / 测试并给出结果" | X2：返回硬编码 SUCCESS，不执行 |
| "替身可在你离线时替你回答队友提问" | S1：入站订阅未实装 |
| "已在提效上取得 X% 提升" | 无任何指标采集链路，"提效"当前**不可证伪** |

---

## 四、可直接取用的五句主张（每句都有实证）

1. **"Shinobi 让 Agent 之间直接接力讨论，不需要人做传声筒。"**（F1）
2. **"讨论有兜底也有收敛：12 轮硬上限防失控，达成共识即静默。"**（F2/F3）
3. **"所有推演过程落在本地数据库，可回放、可审计，不出本机。"**（F5/F6/F7）
4. **"记忆和技能随身走：换议题、换频道，替身的私有记忆不丢。"**（F8，须限定"能力"而非"资产"）
5. **"它替换的不是人，而是「重复解释」和「串行等待」这两段时间。"**（价值模型）

---

## 五、证据索引

| 结论 | 位置 |
|---|---|
| MCP 仅 2 工具 / `tools/call` 硬编码 SUCCESS | `crates/shinobi-dev-mcp/src/main.rs:27-51` |
| 从未挂载 MCP | `src-tauri/logs/acp.log`（30/30 `mcpServers":[]`） |
| 级联接力 / 熔断 / 静默收敛 | `src/services/agentCollaboration.ts`、`src/App.tsx:1384/2089/1555-1575` |
| 议题成员边界 | `src/App.tsx:130` |
| 路径沙盒 | `src-tauri/src/main.rs:122-129` |
| 禁止自主拉起 | `src-tauri/src/main.rs:100` |
| `nostr_relay_url` 死字段 | `src-tauri/src/main.rs:19` / `:220`（零读取点） |
| relay 硬编码单房间、无 per-room 鉴权 | `crates/shinobi-server/src/relay.rs:46` |
| 记忆表无质量字段 | `src-tauri/src/db_manager.rs:64` |
| 消息表 + 3 索引 | `src-tauri/src/db_manager.rs:73-88` |
| 记忆库实测行数 | `shinobi_agent_memory.db`（`acp_memories` 2 行 / `messages` 100 行） |
| 代码量 | `find src -name "*.ts*" \| xargs wc -l` = 20,317；`find src-tauri/src crates -name "*.rs"` = 2,548 |

---

*本表由 OpenClaw Mantis 于第 8 轮独立核查产出。凡标 🔴 者均经源码/运行时双向验证，建议在任何对外版本中直接删除对应表述，而非软化措辞。*
