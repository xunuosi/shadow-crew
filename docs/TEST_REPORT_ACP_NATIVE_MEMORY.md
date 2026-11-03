# ACP 原生长期记忆功能测试报告（三轮缺陷修复与回归复测版）

> 测试日期：2026-11-03  
> 结论：通过，可交付复测（首轮 9 项审计缺陷与第二轮 4 项残留/回归风险均已闭环）
> 规范依据：[SPEC_ACP_NATIVE_MEMORY.md](./SPEC_ACP_NATIVE_MEMORY.md)、[TECH_SPEC_ACP_ONLY_RUNTIME.md](./TECH_SPEC_ACP_ONLY_RUNTIME.md)  
> 覆盖范围：本地 stdio ACP、远程 WebSocket ACP 能力感知、Codex ACP 原生 Memory、Agent 生命周期与配置迁移、双主题 UI 对比度

---

## 1. 实现与架构摘要

1. **显式托管策略**：Agent 配置具备 `memory.mode`（`native | disabled`）与 `autoGenerate`（默认 `false`），持久化版本号 `schemaVersion = 1`。
2. **协议握手能力扩展**：ACP `initialize` 响应解析可选扩展 `agentCapabilities.nativeMemory`，严格要求 `supported === true && enabled === true` 才判定为 `enabled`，`supported === true && enabled === false` 判定为 `disabled`，`supported === false` 判定为 `unsupported`，其余缺失或半声明状态一律归入 `unknown`（遵循 `NM-01` Fail-Closed 原则）。
3. **运行期探测与离线态严格解耦（`NM-01` / `NM-09`）**：
   - 应用冷启动/重加载统一经过 `normalizeHydratedAgent()`：持久化的 `running/starting` 状态、`statusDetail` 和上次进程的 `nativeCapability` 全部作废，Agent 以 `idle + unknown + canUseInternalMemory=false` 进入工作区，再由真实运行态探测重新确认。
   - Agent 停止、本地进程退出、复制 Agent、编辑 Agent 或删除 Agent 时，均立即重置 `nativeCapability` 为 `unknown`。
4. **本地与远程双通道策略下发**：
   - 本地 stdio 通道：启动时通过受控环境变量 `SHADOW_CREW_ACP_NATIVE_MEMORY` / `SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE` 下发策略（屏蔽用户同名 ENV 伪造），并在 `initialize` 与 `session/prompt` 请求中携带 `_meta.shadowCrew.nativeMemory`。
   - 远程 WebSocket 通道：`probeRemoteAcpConnection()` 与 `sendPromptToRemoteAcpWebSocket()` 在 `initialize` 和 `session/prompt` 中同步携带 `_meta.shadowCrew.nativeMemory`，且 `autoGenerate` 严格受 `nativeMemoryEnabled` 门控；后台本地轮询 `syncRunningAgentsWithBackend` 跳过远程/WebSocket Agent，防止 3 秒轮询冲掉远程在线状态。
   - 远程 Agent 使用独立健康租约：运行中的 WebSocket Agent 每 15 秒重新探测一次，断线回落 `error + unknown`；启动、停止、编辑和删除通过 generation 取消旧探测，迟到结果不得覆盖新状态。
5. **Codex ACP 适配器（`bin/codex-acp`）**：
   - 同时消费 RPC 请求参数 `_meta.shadowCrew.nativeMemory` 与启动环境变量（`_meta` 优先），按需挂载 `--enable memories`、`memories.use_memories=true`、`memories.generate_memories=true|false`、`memories.dedicated_tools=true`。
   - `disabled` 模式显式追加 `--disable memories`、`features.memories=false` 及三项 `memories.*=false` 覆盖，确保用户全局 `config.toml` 开启 memories 时仍能强制关闭。
   - Rust `spawn_agent` / `ensure_initialized` 握手上限提升至 10 秒；初始化请求使用全局递增 ID，任何超时或拒绝都保持 `initialized=false` 并向上返回错误，后续 Prompt 仍可重新发起握手，不会永久锁死 `unknown`。
6. **双主题高对比度 UI（`NM-THEME-01`）**：
   - `ConnectAgentModal` 容器显式绑定 `data-theme={isLightMode ? 'light' : 'dark'}` 并通过 `MutationObserver` 与全局 `<html data-theme>` 同步，内部状态块与远程探测卡片全部采用显式 `isLightMode` 双主题语义色阶，彻底消除「浅字叠浅底 / 深字叠深底」。

---

## 2. 规范可追溯矩阵（Spec-to-Test Traceability）

| 规范条目 | 核心契约要求 | 验证层级 | 对应测试与断言证据 | 结果 |
| --- | --- | --- | --- | --- |
| **NM-01** | 未声明 `nativeMemory` 或 `supported: true` 但缺失 `enabled` 必须显示 `unknown`，严禁伪装为 `enabled` | 单元层 (TS + Rust) | `test-acp-native-memory.ts` (`verifyTypeContracts`) + `acp_manager.rs` (`test_check_native_memory_capability_contract`) | ✅ 通过 |
| **NM-02** | Codex 开启原生记忆时，`initialize` 返回 `enabled`，`exec` 注入 `--enable memories` 与 `dedicated_tools=true` | 适配器层 + 真实运行期层 | `verifyAdapterEnabledFlow` (fake CLI) + `verifyRealCodexFlow` (真实 Codex CLI) | ✅ 通过 |
| **NM-03** | 关闭原生记忆时，`initialize` 返回 `disabled`，`exec` 不包含任何 `memories` 参数 | 适配器层 + 协议层 | `verifyAdapterDisabledFlow` + `verifyAdapterMetaPolicyOverrideFlow` | ✅ 通过 |
| **NM-04** | 显式长期记忆在第一个 ACP Session 写入后，第二个全新 ACP Session 不带历史上下文仍可召回 | 真实运行期层 (E2E) | `verifyRealCodexFlow`（隔离 `CODEX_HOME`，跨进程跨 Session 召回 `ORBIT-7742-LYNX`） | ✅ 通过 |
| **NM-05** | 退出原适配器进程并重启新进程后，隔离 `CODEX_HOME` 下的 `memories_v2` 笔记仍可被召回 | 真实运行期层 (E2E) | `verifyRealCodexFlow`（`sourceAdapter.close()` 后拉起全新 `recallAdapter` 进程验证） | ✅ 通过 |
| **NM-06** | 清理 Shadow Crew ACP Session 仅清理会话映射，不删除端点原生长期记忆 | 宿主集成层 + E2E | `acp_manager.rs` (`test_clear_agent_sessions_with_generation_deletes_db_even_if_memory_empty`) + `NM-SESSION-CLEAR-01` | ✅ 通过 |
| **NM-07** | 旧版 Agent 数据通过 `migrateAgentMemoryV1` 集中迁移到 `schemaVersion=1`，业务层零旧字段回退 | 单元层 | `verifyTypeContracts` + `test-acp-only-runtime.ts` | ✅ 通过 |
| **NM-08** | 亮色/暗色主题 × 弹窗内部主题切换 × `enabled/disabled/unknown/unsupported` 状态组合全部可读 | UI 契约与运行期层 | `verifyRemoteWebSocketAndUiContracts` + 双主题渲染检查 | ✅ 通过 |
| **NM-09** | 离线/重启加载的 Agent 不得保留上次进程的 `enabled` 探测结果；`INITIAL_AGENTS` 离线预设必须为 `unknown` | 单元层 + 宿主状态层 | `verifyTypeContracts` (`staleOfflineAgent` / `activeOnlineAgent` / `INITIAL_AGENTS[0]`) | ✅ 通过 |
| **NM-10** | 同一 `CODEX_HOME` 共享边界清晰披露；测试使用独立临时 `CODEX_HOME` 物理隔离 | 真实运行期层 + UI 文案 | `verifyRealCodexFlow` + `ConnectAgentModal.tsx` / `AcpInspector.tsx` | ✅ 通过 |

---

## 3. 本轮代码审查发现并修复的 9 项缺陷清单

| 编号 | 严重度 | 缺陷位置与现象 | 根因分析 | 修复方案与回归验证 |
| --- | --- | --- | --- | --- |
| **#1** | P1 | `src-tauri/src/acp_manager.rs`：`spawn_agent` 握手 3 秒超时后丢失 `nativeMemory` 能力且不再重试 | `bin/codex-acp` 在 `initialize` 中同步执行 `codex --version` 与 `codex --enable memories features list`，冷启动可能超过 3s；超时分支误设 `initialized = true` 并残留 `pending_requests` | 握手超时提升至 10s；初始化请求使用全局递增 ID；首次 spawn 与 lazy initialize 超时/拒绝/通道关闭均清理 pending 且保持 `initialized=false`，上层收到显式错误，后续 Prompt 可继续重试 |
| **#2** | P1 | `src/services/agentMemory.ts`、`src/data/mockData.ts`、`src/App.tsx`：离线/重启/停止后仍残留 `nativeCapability = enabled`（违反 `NM-01`/`NM-09`） | 持久化的 status 与握手能力被误当成当前运行事实；远程 Agent 又不再经过本地进程轮询 | 新增 `normalizeHydratedAgent()`，所有持久化 Agent 在进入工作区前强制回落 `idle + unknown + canUseInternalMemory=false`；停止/离线/复制/编辑/删除均清理探测结果 |
| **#3** | P1 | `src/App.tsx`、`src/components/ConnectAgentModal.tsx`：远程 ACP Agent 启动 3 秒后被重置为 `idle`，且启动/保存时丢失 `nativeMemory` 探测结果 | `syncRunningAgentsWithBackend` 未跳过 `isRemote \|\| acpTransport === 'websocket'`；`onToggleAgentStatus` 与保存时 `healthCheck` 未消费 `probe.nativeMemory` | 本地轮询跳过远程 Agent；新增远程健康租约与 15 秒复探；启动/停止/编辑/删除使用 generation 取消旧探测；能力、load/resume 与 latency 全链路回写 |
| **#4** | P2 | `src/services/agentMemory.ts`、`src-tauri/src/acp_manager.rs`：`{ supported: true }`（缺失 `enabled`）被误判为 `enabled` | TS 使用 `value.enabled !== false`，Rust 使用 `(Some(true), _) => "enabled"`，与规范表格冲突 | TS 与 Rust 统一要求 `supported === true && enabled === true` 才返回 `"enabled"`，缺失 `enabled` 返回 `"unknown"` |
| **#5** | P2 | `bin/codex-acp`、`src/services/acpClient.ts`：适配器忽略 `_meta.shadowCrew.nativeMemory`；远程 Prompt 未用 `nativeMemoryEnabled` 门控 `autoGenerate`；disabled 无法覆盖用户 config | `bin/codex-acp` 仅读取进程启动环境变量，disabled 仅省略参数；客户端直接透传 autoGenerate | `resolveNativeMemoryPolicy(params)` 优先消费 `_meta`；disabled 显式追加 `--disable memories`、`features.memories=false` 与三项 `memories.*=false`；客户端在 disabled 时强制 autoGenerate=false |
| **#6** | P1 | `src/components/ConnectAgentModal.tsx`：全局暗色主题下出现白字叠浅绿底、亮色主题切暗色弹窗出现黑字叠深底（违反 `NM-THEME-01`） | `isLightMode` 未与 `<html data-theme>` 同步，且弹窗内部混用受全局 `<html>` 驱动的 `text-fg` / `dark:*` 与受局部 `isLightMode` 驱动的浅色背景 | 弹窗容器绑定 `data-theme={isLightMode ? 'light' : 'dark'}`，通过 `MutationObserver` 同步全局主题，并将记忆策略区与远程探测区全面改为 `isLightMode` 双主题高对比度配色 |
| **#7** | P2 | `src/components/AcpInspector.tsx`、`src/components/ConnectAgentModal.tsx`：`persistent: false` 显示为 `UNKNOWN`；`unknown` 状态伪造 `supported: false` 报文；远程 `disabled` 显示为 `未声明 ⚠️` | 三元表达式未区分 `false` 与 `undefined`；`jsonRpcSample` 无条件拼装 `nativeMemory`；远程探测条未分支处理 `disabled` | 精确区分 `YES / NO / UNKNOWN`；仅当 `nativeMemoryStatus !== 'unknown'` 时在示例报文中展示 `nativeMemory`；远程探测条对 `disabled` 显示 `已声明 (已关闭)` |
| **#8** | P2 | `src/App.tsx`、`src/components/ConnectAgentModal.tsx`：复制 Agent 时旧 `capabilities` 覆盖 `canUseInternalMemory` 且拷贝旧 `nativeCapability`；新建 Agent 丢弃 `capabilities`；仅修改 `autoGenerate` 未触发策略变更重置 | 属性展开顺序将 `...(agent.capabilities \|\| {})` 放在后面；`onConnectAgent` 硬编码 `capabilities`；`nativeMemoryPolicyChanged` 仅比较 `mode` | 修正展开顺序并重置副本 `nativeCapability` 为 `unknown`；`onConnectAgent` 保留 `agentData.capabilities`；`nativeMemoryPolicyChanged` 同时校验 `mode` 与 `autoGenerate` |
| **#9** | P3 | `src-tauri/src/acp_manager.rs`：Rust 默认 `AcpNativeMemoryCapability` 与前端 TS 默认值不一致（英文 `detail`、`scope: None`、动态时间戳） | Rust `Default` 实现未与前端 `createUnknownNativeMemoryCapability()` 对齐，导致轮询无意义刷新并覆盖中文提示 | 对齐 Rust 默认值为 `scope: Some("unknown")`、中文 `detail: Some("等待 ACP 端点握手声明")`、`last_checked_at: 0`，并在 `App.tsx` 按语义字段比对变更 |

---

### 3.1 第二轮独立复查发现的残留与新风险

| 编号 | 严重度 | 问题 | 最终修复与验证 |
| --- | --- | --- | --- |
| **R1** | P1 | lazy initialize 再次超时后仍设置 `initialized=true`，可能永久丢失能力状态 | 初始化 ID 改为全局递增；所有超时/拒绝/通道关闭均保持未初始化并向调用方返回错误，下一次 Prompt 可重新握手；新增 ID 唯一性 Rust 测试 |
| **R2** | P1 | `disabled` 只省略 `--enable`，无法覆盖用户全局 memories 配置 | 显式 `--disable memories` + `features.memories=false` + `use/generate/dedicated=false`；Fake CLI 与真实 CLI 参数解析双重验证 |
| **R3** | P1 | 持久化 `running` 状态可能在应用重启后保留旧 capability，尤其远程 Agent 不经过本地轮询 | `normalizeHydratedAgent()` 统一作废持久化运行态与握手能力；数据库 hydration 回读后立即写回干净状态 |
| **R4** | P2 | 远程 Agent 跳过本地轮询后无独立健康检查，且迟到 probe 可能把已停止 Agent 恢复为 running | 新增 `remoteAgentLifecycle` generation 租约、15 秒健康复探、断线错误回落；启动/停止/编辑/删除均取消旧 probe；新增纯函数反例测试 |

---

## 4. 分层自动化验证结果与真实性声明

| 验证层级 | 验证项 | 执行命令 | 结果与证据 | 验证性质声明 |
| --- | --- | --- | --- | --- |
| **静态类型检查** | TypeScript 全量类型校验 | `npm run lint` | 通过（0 error） | 真实编译器静态检查 |
| **生产构建检查** | Vite 前端生产打包 | `npm run build` | 通过（2015 modules transformed） | 真实生产打包 |
| **单元 + 协议 + 适配器层** | 原生记忆契约、迁移、显式 disable、Fake Codex CLI、远程 WS 探针、远程 generation/健康租约、UI 源码契约 | `npm run test:acp-native-memory` | **通过（117 assertions）** | 纯函数 + Fake Codex 子进程 JSON-RPC + Mock WebSocket + 生命周期状态机反例 |
| **真实运行期层 (E2E)** | 真实 Codex CLI 跨进程、跨 Session 原生记忆写入与召回 | `npm run test:acp-native-memory -- --real` | **通过（122 assertions，隔离 `CODEX_HOME`）** | **真实 `bin/codex-acp` + 真实本机 Codex CLI + 真实模型网关推理 + 真实 `memories_v2` 落盘与跨进程召回** |
| **ACP 运行时基线** | ACP-only 运行时与禁用历史字段回归 | `npm run test:acp-only` | 通过 | 纯函数与契约回归 |
| **Rust 宿主层** | Tauri ACP 管理器、握手解析、初始化 ID、Session 隔离、权限与 SQLite | `cargo test -p shadow-crew-desktop --no-fail-fast` | **通过（33/33 tests）** | 真实 Rust 单元与 SQLite/状态机集成测试 |
| **Rust MCP 工具层** | Dev MCP Server 工具契约与执行 | `cargo test -p shadow-crew-dev-mcp --no-fail-fast` | **通过（9/9 tests）** | 真实 Rust 单元测试 |
| **全量关联回归** | Workspace / Permission / Permission UI / Attachments / DM / CognoNexus / G-Frame Edge | `npm run test:workspace && npm run test:acp-permission && npm run test:acp-permission-ui && npm run test:chat-attachments && npm run test:dm && npm run test:cogno && npm run test:cogno:edge` | **全部通过（0 defect / 0 warn）** | 真实回归测试套件 |

### 验证覆盖边界说明（符合 `AGENTS.md` 第 2.7 节要求）

- **已覆盖的真实运行期层**：
  - 本机真实 Codex CLI（`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`）经 `bin/codex-acp` 的 `initialize` 握手探测、第一个 Session 原生 memory 工具写入（落盘至隔离 `CODEX_HOME/memories_v2/extensions/ad_hoc/notes`）、进程退出后第二个全新进程/Session 的跨线程原生 memory 召回。
  - Rust `shadow-crew-desktop` 后端状态机、握手能力解析与 SQLite 持久化测试。
- **使用 Fake / Mock 的验证层**：
  - 远程 WebSocket 握手探针（`probeRemoteAcpConnection`）与远程 Prompt 发送（`sendPromptToRemoteAcpWebSocket`）通过进程内 `MockWebSocket` 验证了完整 JSON-RPC 报文载荷、`_meta.shadowCrew.nativeMemory` 门控与错误 Fail-Closed 行为（本机未额外部署外部独立远程 WebSocket ACP 守护进程）。
  - 远程 generation/健康租约通过纯函数故障注入验证：旧 probe 在 stop/edit 后迟到完成时返回失效，不允许复活 Agent；15 秒窗口前后的刷新判定均覆盖。
  - 真实 Codex CLI 已解析并接受 `--disable memories` 与三项 `memories.*=false` 参数组合，但未在真实用户全局配置上执行破坏性开关切换；配置覆盖正确性由显式参数契约与 Fake CLI 断言共同验证。

---

## 5. 用户复测指南与用例

### NM-UI-01 配置与能力展示

1. 打开 **Agents & 编队**，编辑任意 Agent，检查底部「启用 ACP 端点原生长期记忆」卡片。
2. 关闭主开关，确认「允许自动提炼历史对话」子开关自动隐藏并重置为关闭，且显示琥珀色禁用提示。
3. 开启主开关，保存并启动本地 Codex Agent，打开右侧 **ACP Inspector → Memory** 标签页：
   - 握手完成后状态显示 `enabled`，提供方 `codex-memories`，作用域 `runtime`，持久化/跨线程显示 `YES / YES`。
   - 停止该 Agent 后，状态立即回落为 `unknown`（不再残留上次进程的 `enabled`）。

### NM-E2E-01 跨 ACP Session 召回

1. 在 Codex 会话 A 输入：
   ```text
   请长期记住：SC_NATIVE_MEMORY_CANARY_20261103 = ORBIT-7742-LYNX。
   不要使用 shell、文件或网络。完成后只回复 RECORDED。
   ```
2. 确认返回 `RECORDED`。
3. 新建另一个 Topic 或清理当前 Session 后，在新会话询问：
   ```text
   只使用 Codex 原生 memory 工具，查询 SC_NATIVE_MEMORY_CANARY_20261103 的 value。
   不要使用 shell、文件、网络或当前会话历史。不知道回答 UNKNOWN。
   ```
4. 预期返回 `ORBIT-7742-LYNX`。

### NM-DISABLED-CONFIG-01 用户配置与 disabled 优先级

1. 在测试 `CODEX_HOME/config.toml` 中临时开启 `features.memories=true` 与 `[memories]`。
2. Shadow Crew 将该 Codex Agent 设为 `disabled` 并重启。
3. 检查 ACP 能力为 `disabled`，子进程参数包含 `--disable memories` 与三项 false 配置。
4. 发送一个在旧记忆中明确存在的 canary 查询，并禁止 shell/文件读取。
5. 预期 Agent 无法通过 native memory 召回该 canary。

### NM-REMOTE-01 远程健康租约与启停竞态

1. 使用一个可断开、初始化可延迟的远程 WebSocket ACP 测试端点。
2. Shadow Crew 点击 Start 后立即 Stop/Stop All。
3. 等待超过初始化延迟时间，确认 Agent 仍保持 `idle`，不会被迟到 probe 复活。
4. 再次 Start 并等待成功，然后关闭远端服务；超过 15 秒健康复探窗口后，Agent 应从 `running` 回落为 `error`，nativeMemory 变为 `unknown`。

### NM-THEME-01 双主题与弹窗内部主题切换可读性

1. 分别在应用全局白昼主题（`data-theme="light"`）和暗夜主题（`data-theme="dark"`）下打开「编辑 Agent」弹窗。
2. 点击弹窗右上角的太阳/月亮按钮切换弹窗内部明暗模式，检查底部「启用 ACP 端点原生长期记忆」区域及「远程 ACP WebSocket 测试连接」结果区域：
   - 四种组合（全局亮/暗 × 弹窗亮/暗）下文字对比度均清晰锐利，无浅字叠浅底或深字叠深底。

---

## 6. 已知环境边界

- ACP 协议本身不规定统一的长期记忆存储格式；其他外部 Agent 需实现并声明 `agentCapabilities.nativeMemory` 或消费 `_meta.shadowCrew.nativeMemory`。
- Codex 后台自动提炼（`memories.generate_memories=true`）依赖模型网关是否注册了 Codex 内部记忆提炼模型；本机自定义网关对后台提炼模型返回 `model_not_registered`，因此默认关闭 `autoGenerate`，显式原生 memory 工具读写与跨线程召回不受影响并已真实跑通。
- 多个 Agent 共用同一 `CODEX_HOME` 时，Codex 原生长期记忆按 `scope=runtime` 共享；如需实例级物理隔离，请为不同 Agent 配置独立的 `CODEX_HOME`。
