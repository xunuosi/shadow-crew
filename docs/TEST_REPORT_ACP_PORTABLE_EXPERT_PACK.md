# Shadow Crew ACP 可迁移专家智能体能力包 (`.scpack` v1.0) 可行性评估与多轮测试报告

- **技术规范文档**：[`docs/TECH_SPEC_ACP_PORTABLE_EXPERT_PACK.md`](file:///home/antigravity/xunuosi/shadow-crew/docs/TECH_SPEC_ACP_PORTABLE_EXPERT_PACK.md)
- **v1.0 唯一正式支持范围**：**A 端 Codex (`codex-cli 0.166.0-alpha.6`) → `.scpack` → B 端 Codex (`codex-acp`)**
- **实验性排除范围（Non-v1.0 Experimental）**：Claude Code (`claude-agent-acp`)、OpenClaw (`openclaw acp`)、Codex 原生 `external_agent_memory_import` (Claude Memory Importer) 均已标注为 `Experimental` 并排除在 v1.0 正式承诺之外。
- **统一存储根目录**：`~/.shadow-crew/`（能力包安装目录：`~/.shadow-crew/packs/<packageId>/`；吊销列表：`~/.shadow-crew/packs/revoked.json`）。

---

## 一、技术方案可行性评估结论

经对 [`docs/TECH_SPEC_ACP_PORTABLE_EXPERT_PACK.md`](file:///home/antigravity/xunuosi/shadow-crew/docs/TECH_SPEC_ACP_PORTABLE_EXPERT_PACK.md) 与现有 Shadow Crew 架构的逐项核查，**方案整体工程可行性高，架构边界清晰，无阻断性架构缺陷**。评估要点如下：

1. **核心定位准确（「知识经验蒸馏 + B 端本地运行时」而非进程状态克隆）**
   - 明确将 `.scpack` 定义为经过离线蒸馏、两阶段脱敏、JCS + Ed25519 签名校验的结构化知识包，B 端使用本地 `codex` CLI 与本地认证运行，UI 诚实展示 **`基于 A 的经验构建 · 本地运行时`**，彻底规避了跨机器复制 `auth.json`、`config.toml` 或 SQLite 私有线程状态的法律与安全风险。
2. **A 端 6 类数据源探测（S1~S6）与 S1 `503` 降级保护真实可靠**
   - 在 `codex-cli 0.166.0-alpha.6` 中，S1 (`memories_v2_1.sqlite` 的 `stage1_outputs`) 常因 `503 model_not_registered` 为空。方案通过 SQLite Online Backup API (`rusqlite::backup::Backup`) + `PRAGMA quick_check` + 锁文件检查（`memories_v2.lock` / `.sqlite-maintenance.lock` / `session_index.jsonl.lock`）+ 3 次水位线一致性重试，在 S1 为空时自动降级至 **S2 (`ad_hoc` 权威笔记，权重 100) + S3 (`AGENTS.md`) + S4 (`~/.codex/skills` 排除 `.system/`) + S5 (`state_5.sqlite` 线程与 `rollout-*.jsonl` 离线蒸馏)**，保障 100% 离线可用。
3. **B 端确定性 BM25 预检索（Pre-Retrieval Injection）消除多跳工具损耗**
   - 宿主在每次 `session/prompt` 前通过确定性 BM25 预检索匹配 Top-K Playbook，经过反注入净化后封装在 `[SHADOW_CREW_EXPERTISE_DATA] ... [/SHADOW_CREW_EXPERTISE_DATA]` 只读数据边界内注入，无需模型发起多轮文件读取工具调用。
4. **B 端 5 层原生记忆硬隔离与 `session/load` / `session/resume` 全路径对齐**
   - 针对绑定 `.scpack` 的专家分身，[`bin/codex-acp`](file:///home/antigravity/xunuosi/shadow-crew/bin/codex-acp) 与 [`src-tauri/src/acp_manager.rs`](file:///home/antigravity/xunuosi/shadow-crew/src-tauri/src/acp_manager.rs) 强制关闭 B 端 Codex 原生记忆（`--disable memories -c features.memories=false -c memories.use_memories=false -c memories.generate_memories=false -c memories.dedicated_tools=false`），同时锁定 `-s workspace-write`（以及 `resume` 下的 `-c sandbox_mode="workspace-write"`），防止 B 端私有记忆与专家能力包双向污染。

---

## 二、核心代码实现映射清单

| 模块层级 | 文件路径 | 核心实现内容 |
| :--- | :--- | :--- |
| **Rust 协议与密码学核心** | [`crates/shadow-crew-protocol/src/scpack.rs`](file:///home/antigravity/xunuosi/shadow-crew/crates/shadow-crew-protocol/src/scpack.rs) | 14 项 `ScpackErrorCode`、官方标准 BLAKE3 (`blake3:<64-hex>`)、RFC 8785 JCS 规范化、RFC 8032 Ed25519 签名与验签、SQLite Online Backup 快照、S1~S6 探测器、两阶段脱敏门禁、`.scpack` POSIX tar.gz 打包与 Fail-Closed 验签安装器、宿主确定性 BM25 预检索与反注入净化器 |
| **Tauri 宿主进程治理** | [`src-tauri/src/acp_manager.rs`](file:///home/antigravity/xunuosi/shadow-crew/src-tauri/src/acp_manager.rs)<br>[`src-tauri/src/main.rs`](file:///home/antigravity/xunuosi/shadow-crew/src-tauri/src/main.rs) | 7 个 Tauri IPC 命令注册、`RunningAgent.expert_pack_id` 绑定、启动期拦截 `CODEX_DANGEROUSLY_BYPASS_SANDBOX` / `CODEX_HOME`、`session/request_permission` 自动拒绝访问 `.codex`/`.ssh`/工作区外路径、`send_session_prompt` 每轮自动执行 BM25 预检索与吊销/缺失 Fail-Closed 熔断 |
| **Codex ACP 适配器** | [`bin/codex-acp`](file:///home/antigravity/xunuosi/shadow-crew/bin/codex-acp) | 新增 `session/load` 与 `session/resume` 对齐支持、`isPortableExpertRequest` 识别、强制注入 5 项记忆禁用标志、剥离 `CODEX_DANGEROUSLY_BYPASS_SANDBOX`、锁定 `workspace-write` |
| **前端类型与服务层** | [`src/types.ts`](file:///home/antigravity/xunuosi/shadow-crew/src/types.ts)<br>[`src/services/scpackService.ts`](file:///home/antigravity/xunuosi/shadow-crew/src/services/scpackService.ts)<br>[`src/services/acpClient.ts`](file:///home/antigravity/xunuosi/shadow-crew/src/services/acpClient.ts) | `.scpack` 完整 TypeScript 类型契约、同构 BLAKE3/JCS/脱敏/BM25 服务、Tauri IPC 桥接、`buildAgentLaunchEnv` 与 `sendPromptToAcpAgent` 预检索及 Fail-Closed 拦截 |
| **双主题 UI 交互层** | [`src/components/AgentDashboard.tsx`](file:///home/antigravity/xunuosi/shadow-crew/src/components/AgentDashboard.tsx)<br>[`src/components/AcpInspector.tsx`](file:///home/antigravity/xunuosi/shadow-crew/src/components/AcpInspector.tsx)<br>[`src/App.tsx`](file:///home/antigravity/xunuosi/shadow-crew/src/App.tsx) | A 端 6 源探测与两阶段脱敏确认导出向导、B 端 `.scpack` 验签安装与一键创建专家分身、Agent 卡片诚实标识胶囊 `基于 A 的经验构建 · 本地运行时`、ACP Inspector 能力包元数据核验卡 |

---

## 三、规范可追溯矩阵（Spec-to-Test Traceability Matrix, T1~T9）

| 规范维度 | 规范要求与失败码契约 | 测试层级与用例位置 | 输入与故障注入构造 | 预期结果与实测证据 |
| :--- | :--- | :--- | :--- | :--- |
| **T1: 6 源探测与快照一致性** | SQLite Online Backup、`PRAGMA quick_check`、3 次水位线校验、S1 `503` 空表自动降级至 S2+S4+S5、`.system` 排除 | Rust 集成层 (`scpack::tests::test_t1_t2_codex_probe_s1_degradation_and_redaction_gate`) + TS 层 (`test-acp-portable-expert-pack.ts`) | 构造含 `503 model_not_registered` 错误的 `memories_v2_1.sqlite`、S2 金丝雀笔记 `CYAN-8192-RAVEN`、`.system` 系统技能、锁文件与水位线漂移 | S1 状态为 `degraded_stage1_error` / `degraded_empty_503` 并自动降级提取 S2+S3+S4+S5；`.system/` 技能 0 混入；锁文件/水位线不一致返回 `ERR_SNAPSHOT_INCONSISTENT` |
| **T2: 两阶段脱敏门禁与黑名单** | 硬黑名单 (`auth.json`, `config.toml`, `logs_*.sqlite`, `history.jsonl`, `.ssh`) + 正则脱敏 + 二次零残留扫描 (`ERR_SECRET_DETECTED`) + 用户确认门禁 | Rust 单元/集成层 (`test_t1_t2_*`) + TS 层 (`test-acp-portable-expert-pack.ts`) | 注入 `sk-proj-*`、`sk-ant-*`、`ghp_*`、`AKIA*`、JWT、PEM 私钥、`postgres://user:pass@`、`/Users/xunuosi/`、`192.168.1.42` 及 `userConfirmedRedaction=false` | 10+ 类敏感项 100% 替换为脱敏占位符；黑名单文件物理跳过；未勾选确认或残留密钥立即抛出 `ERR_SECRET_DETECTED` |
| **T3: 密码学完整性与 JCS + Ed25519 签名** | 官方 BLAKE3 (`blake3:<64-hex>`)、Merkle Root、RFC 8785 JCS 规范化、RFC 8032 Ed25519 签名验签 (`ERR_INTEGRITY_MISMATCH`, `ERR_SIGNATURE_INVALID`) | Rust 单元层 (`test_blake3_official_vectors`, `test_ed25519_rfc8032_official_vector_1_and_tamper`, `test_t3_t4_*`) + TS 层 | 官方 BLAKE3 向量（0B/3B/1024B/1025B/2048B/2049B）、RFC 8032 Section 7.1 Vector 1、篡改 Playbook 1 字节、篡改签名 1 bit | 官方测试向量 100% 比特级吻合；篡改文件触发 `ERR_INTEGRITY_MISMATCH`，篡改签名触发 `ERR_SIGNATURE_INVALID` |
| **T4: 恶意归档攻击矩阵** | 拒绝 `../` 路径穿越、符号链接/硬链接、超 10 MiB / 单文件超 1 MiB / 超 256 文件、未知 Schema | Rust 集成层 (`test_t3_t4_packaging_verification_and_malicious_archive_matrix`) | 构造含 `../evil.md`、Symlink 条目、超 256 文件、超大体积、非法 `schemaVersion` 的 `.scpack` 归档 | 依次精准拦截并返回 `ERR_PATH_TRAVERSAL`、`ERR_SYMLINK_FORBIDDEN`、`ERR_TOO_MANY_FILES`、`ERR_PACK_TOO_LARGE`、`ERR_SCHEMA_UNSUPPORTED` |
| **T5: B 端 5 层原生记忆硬隔离与沙箱锁死** | `session/new`、`session/resume`、`session/load` 全链路强制 `--disable memories` 等 5 参数，剥离 `CODEX_DANGEROUSLY_BYPASS_SANDBOX`，锁定 `workspace-write` | 真实子进程 E2E (`test-acp-portable-expert-pack.ts` 拉起真实 `bin/codex-acp` 进程) + Rust `acp_manager` 权限拦截测试 | 恶意传入 `SHADOW_CREW_ACP_NATIVE_MEMORY=1`、`nativeMemory: { enabled: true }`、`CODEX_DANGEROUSLY_BYPASS_SANDBOX=1` | `initialize` 与 `session/prompt` 均返回 `nativeMemory.enabled === false`；子进程实测收到全部 5 项禁用参数与 `workspace-write`，且 `CODEX_DANGEROUSLY_BYPASS_SANDBOX` 被剥离 |
| **T6: 确定性 BM25 预检索与反注入净化** | Top-K BM25 召回金丝雀契约 `CYAN-8192-RAVEN`，`[SHADOW_CREW_EXPERTISE_DATA]` 封装，剥离 Prompt 覆盖与危险命令 | Rust 集成层 (`test_t6_t7_*`) + TS 层 (`test-acp-portable-expert-pack.ts`) | 查询 `SC_CODEX_MEMORY_CONTRACT_20261102`，并在 Playbook 中注入 `Ignore all previous instructions`、`curl ... \| sh`、`--dangerously-bypass-approvals-and-sandbox`、`~/.codex/auth.json` | 零工具调用直接召回 `CYAN-8192-RAVEN`；4 类危险指令全部被替换为 `[SANITIZED:*]` / `[REDACTED_UNSAFE_DIRECTIVE:*]` 并记录告警 |
| **T7: 生命周期、吊销与热更新 Fail-Closed** | 卸载或加入 `revoked.json` 后，已绑定的运行期 Agent 下一轮立即 Fail-Closed 阻断 (`ERR_PACK_REVOKED` / `ERR_PACK_MISSING`) | Rust 集成层 (`test_t6_t7_*`) + TS 层 (`sendPromptToAcpAgent`) | 对已绑定的在线专家分身调用 `uninstallScpack(pkgId, true)` 后立即发送 `session/prompt` | 立即返回 `ERR_PACK_REVOKED` Fail-Closed 熔断错误，不向底层模型发送过期或已吊销的知识包 |
| **T8: 诚实身份标识与双主题高对比度 UI** | 展示 `基于 A 的经验构建 · 本地运行时`，遵循 `AGENTS.md` 明暗双主题语义色规范 | TS 组件契约与构建检查 (`AgentDashboard.tsx`, `AcpInspector.tsx`, `npm run lint`, `npm run build`) | 创建 B 端专家分身并核验 `expertPack.badgeLabel`、双主题类名配对 | 显式渲染 `基于 <Author> 的经验构建 · 本地运行时`，纯白与暗夜主题均成对声明高对比度语义类名 |
| **T9: 跨层全量回归测试** | Rust 协议层、Tauri 宿主层、MCP 工具层、Node ACP 适配器层、前端构建全量通过 | 多轮回归执行 | 执行 `cargo test` 全工作区与 `npm run test:*`、`npm run lint`、`npm run build` | 全部测试套件 100% 通过，零编译错误与零类型告警 |

---

## 四、测试层级说明与边界声明

1. **真实运行期验证层（Real Runtime & Process Layers）**：
   - `crates/shadow-crew-protocol`：真实 SQLite WAL 数据库 + `rusqlite::backup::Backup` 在线备份 + 真实 POSIX `.tar.gz` 流式打包与文件系统权限 (`0444`/`0555`) + 真实 BLAKE3 / RFC 8785 JCS / RFC 8032 Ed25519 计算。
   - `bin/codex-acp`：真实 Node.js 子进程 stdio JSON-RPC 2.0 通信（覆盖 `initialize`、`session/new`、`session/resume`、`session/load`、`session/prompt`）。
   - `src-tauri` (`shadow-crew-desktop`)：真实 Rust 单元与宿主状态机测试（35 项测试通过）。
2. **环境边界说明**：
   - 当前 Linux 远程容器环境为无物理显示器的 Headless 环境，Tauri 桌面端链接测试通过 `/tmp/fake-lib` WebKit2GTK 符号桩完成 35 项 Rust 宿主测试编译与执行；端到端 `bin/codex-acp` 采用真实适配器子进程配对录制型 `codex` CLI 可执行文件验证命令行参数与环境变量隔离。
