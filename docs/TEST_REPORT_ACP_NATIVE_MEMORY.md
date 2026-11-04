# ACP 原生长期记忆功能测试报告（五轮深度复核与行为回归终版）

> 测试日期：2026-11-04
> 结论：通过，可交付复测（历轮审计缺陷及本轮新增的远程健康恢复、真实 TOML 合并、SSR 暗色首帧、Codex 特性探测三态化 4 项问题均已闭环）
> 规范依据：[SPEC_ACP_NATIVE_MEMORY.md](./SPEC_ACP_NATIVE_MEMORY.md)、[TECH_SPEC_ACP_ONLY_RUNTIME.md](./TECH_SPEC_ACP_ONLY_RUNTIME.md)
> 覆盖范围：本地 stdio ACP、远程 WebSocket ACP 能力感知、Codex ACP 原生 Memory、Agent 生命周期与配置迁移、双主题 UI 行为渲染与对比度

---

## 1. 实现与架构摘要

1. **显式托管策略**：Agent 配置具备 `memory.mode`（`native | disabled`）与 `autoGenerate`（默认 `false`），持久化版本号 `schemaVersion = 1`。
2. **协议握手能力扩展**：ACP `initialize` 响应解析可选扩展 `agentCapabilities.nativeMemory`，严格要求 `supported === true && enabled === true` 才判定为 `enabled`，`supported === true && enabled === false` 判定为 `disabled`，`supported === false` 判定为 `unsupported`，其余缺失或半声明状态一律归入 `unknown`（遵循 `NM-05` Fail-Closed 原则）。
3. **运行期探测与离线态严格解耦（`NM-05` / `NM-09`）**：
   - 应用冷启动/重加载统一经过 `normalizeHydratedAgent()`（覆盖 `localStorage` 初始化回退、`INITIAL_AGENTS` 预设以及 SQLite `syncWorkspaceWithDb` 异步 hydration 全入口）：持久化的 `running/starting` 状态、`statusDetail` 和上次进程的 `nativeCapability` 全部作废，Agent 以 `idle + unknown + canUseInternalMemory=false` 进入工作区，并在 SQLite hydration 完成后立即触发 `syncRunningAgentsWithBackend` 同步真实运行态。
   - Agent 停止、本地进程退出、复制 Agent、编辑 Agent 或删除 Agent 时，均立即重置 `nativeCapability` 为 `unknown`。
4. **本地与远程双通道策略下发与生命周期状态机**：
   - 本地 stdio 通道：启动时通过受控环境变量 `SHADOW_CREW_ACP_NATIVE_MEMORY` / `SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE` 下发策略（屏蔽用户同名 ENV 伪造），并在 `initialize` 与 `session/prompt` 请求中携带 `_meta.shadowCrew.nativeMemory`。
   - 远程 WebSocket 通道：`probeRemoteAcpConnection()` 与 `sendPromptToRemoteAcpWebSocket()` 在 `initialize` 和 `session/prompt` 中同步携带 `_meta.shadowCrew.nativeMemory`，且 `autoGenerate` 严格受 `nativeMemoryEnabled` 门控；后台本地轮询 `syncRunningAgentsWithBackend` 跳过远程/WebSocket Agent，防止 3 秒轮询冲掉远程在线状态。
   - 远程 Agent 使用独立健康租约与显式状态机函数（`markRemoteAgentStarting` / `applyRemoteProbeOutcome` / `stopAgentRuntimeState` / `recordRemoteProbeSuccess` / `isAgentActivelyRunning`）：运行中的 WebSocket Agent 每 15 秒重新探测一次，断线回落 `error + isModelHealthy=false + unknown`；启动、停止、编辑和删除通过 generation 取消旧探测，迟到结果不得覆盖新状态；`starting` 状态支持随时点击卡片胶囊或“Stop running agents”中断，且 `error / auth_required` 不会被“Stop running agents”误启动。
5. **Codex ACP 适配器（`bin/codex-acp`）与 Rust 握手重试机制**：
   - 同时消费 RPC 请求参数 `_meta.shadowCrew.nativeMemory` 与启动环境变量（`_meta` 优先），按需挂载 `--enable memories`、`memories.use_memories=true`、`memories.generate_memories=true|false`、`memories.dedicated_tools=true`。
   - `disabled` 模式显式追加 `--disable memories`、`features.memories=false` 及三项 `memories.*=false` 覆盖，确保用户全局 `config.toml` 开启 `[features] memories = true` 时仍能强制关闭。
   - `codexNativeMemoryFeatureSupported()` 返回 `true | false | null` 三态：单次请求最多重试 2 次，成功结果进程内缓存，连续异常返回 `null` 且不缓存；握手据此上报 `unknown`，不再将“无法探测”伪装为 `unsupported`。`disabled` 策略在探测结论未知时仍注入覆盖参数，按 Fail-Closed 处理。
   - 探针预算控制在 Rust 10 秒握手上限内：版本探测 1.5 秒，原生能力最多 2 × 2.5 秒；后续 `initialize/session/prompt` 可再次探测。
   - Rust `spawn_agent` / `ensure_initialized`（含 `execute_lazy_initialize_handshake`）握手上限提升至 10 秒；初始化请求使用全局递增 ID，连续多次超时或拒绝都保持 `initialized=false`、清理 `pending_requests` 并向上返回错误，后续 Prompt 仍可重新发起握手并在恢复后写回真实 `nativeMemory` 能力，不会永久锁死 `unknown`。
6. **双主题高对比度 UI（`NM-THEME-01`）**：
   - `ConnectAgentModal` 支持显式 `initialThemeMode` 作为 SSR/内嵌环境的确定性首帧主题；浏览器生产路径仍从 `<html data-theme>` 初始化，并通过 `MutationObserver` 同步。容器绑定 `data-theme`，内部状态块与远程探测卡片采用显式双主题语义色阶。

---

## 2. 规范可追溯矩阵（Spec-to-Test Traceability）

| 规范条目 | 核心契约要求 | 验证层级 | 对应测试与断言证据 | 结果 |
| --- | --- | --- | --- | --- |
| **NM-01** | 旧 Agent JSON 一次性迁移为 `schemaVersion=1`，能力默认 `unknown`，业务层零旧字段回退 | 单元层 | `verifyTypeContracts` + `test-acp-only-runtime.ts` | ✅ 通过 |
| **NM-02** | native 模式仅在实际支持 memories 时声明 `enabled`，并注入启用参数 | 适配器层 + 真实运行期层 | `verifyAdapterEnabledFlow` + `verifyRealCodexFlow` | ✅ 通过 |
| **NM-03** | disabled 模式能力可判定时声明 `disabled`，并注入完整 disable/false 覆盖 | 适配器层 + 真实运行期层 | `verifyAdapterDisabledFlow` + `verifyAdapterMetaPolicyOverrideFlow` + `verifyRealCodexFlow` | ✅ 通过 |
| **NM-04** | 用户伪造同名 ENV 时，宿主 Agent 策略必须覆盖 | 单元层 | `verifyTypeContracts` (`buildAgentLaunchEnv`) | ✅ 通过 |
| **NM-05** | 缺失或半声明 `nativeMemory` 必须为 `unknown`，不得冒充支持 | 单元层 (TS + Rust) | `verifyTypeContracts` + `test_check_native_memory_capability_contract` | ✅ 通过 |
| **NM-06** | 同一 Codex 会话第二轮使用 `resume <thread_id>` 保持上下文连续 | 适配器层 | `verifyAdapterEnabledFlow` 的第二次 `session/prompt` 参数断言 | ✅ 通过 |
| **NM-07** | 第一个 ACP Session 写入后，全新进程/会话不带历史仍可召回 | 真实运行期层 | `verifyRealCodexFlow`（隔离 `CODEX_HOME` 召回 `ORBIT-7742-LYNX`） | ✅ 通过 |
| **NM-08** | 清理 Shadow Crew ACP Session 不删除端点原生长期记忆 | Rust 宿主层 | `test_clear_agent_sessions_with_generation_deletes_db_even_if_memory_empty` | ✅ 通过 |
| **NM-09** | 重启/重载必须重新握手，不信任上次进程的 `enabled` 结果 | 单元层 + Rust 宿主层 | `normalizeHydratedAgent` 行为断言 + lazy initialize 恢复测试 | ✅ 通过 |
| **NM-10** | 连续两次 initialize 超时后保持可重试，第三次成功恢复能力 | Rust 异步行为测试 | `test_initialize_twice_timeout_remains_retryable_and_recovers_capabilities` | ✅ 通过 |
| **NM-11** | 用户全局 TOML 开启 memories 时，disabled 仍强制关闭且不召回 canary | Fake CLI + 真实 E2E | 真实配置经 TOML section upsert 后验证 `supported=true / enabled=false` 且查询不含 canary | ✅ 通过 |
| **NM-12** | 远程启动/停止/编辑/删除发生 probe 竞态时，迟到结果不得覆盖新状态 | 状态机行为测试 | `verifyTypeContracts` 的 generation 租约断言 | ✅ 通过 |
| **NM-13** | 远程 15 秒复探断线回落 `error + isModelHealthy=false + unknown`；后续成功必须同时恢复 health | 状态机行为测试 | 断线断言 + “仅 health 不同”的成功恢复判别用例 | ✅ 通过 |
| **NM-14** | Codex 特性探测单次有界重试；持续异常上报 `unknown` 而非 `unsupported`，后续请求可重试 | 适配器层反例测试 | `verifyAdapterFeatureProbeRetryFlow`（1 次失败后恢复；持续失败时属性缺失、重试次数有界、disable 覆盖不丢失） | ✅ 通过 |
| **NM-15** | SSR/内嵌环境亮暗首帧可通过显式初始主题确定性渲染 | React SSR 行为渲染层 | `verifyRemoteWebSocketAndUiContracts` 对显式 `dark` 容器及语义色类进行断言 | ✅ 通过 |

---

## 3. 历史轮次与本轮深度复查修复清单

### 3.1 首轮代码审查发现并修复的 9 项缺陷

| 编号 | 严重度 | 缺陷位置与现象 | 根因分析 | 修复方案与回归验证 |
| --- | --- | --- | --- | --- |
| **#1** | P1 | `src-tauri/src/acp_manager.rs`：`spawn_agent` 握手 3 秒超时后丢失 `nativeMemory` 能力且不再重试 | `bin/codex-acp` 在 `initialize` 中同步执行 `codex --version` 与 `codex --enable memories features list`，冷启动可能超过 3s；超时分支误设 `initialized = true` 并残留 `pending_requests` | 握手超时提升至 10s；初始化请求使用全局递增 ID；首次 spawn 与 lazy initialize 超时/拒绝/通道关闭均清理 pending 且保持 `initialized=false`，上层收到显式错误，后续 Prompt 可继续重试 |
| **#2** | P1 | `src/services/agentMemory.ts`、`src/data/mockData.ts`、`src/App.tsx`：离线/重启/停止后仍残留 `nativeCapability = enabled`（违反 `NM-05`/`NM-09`） | 持久化的 status 与握手能力被误当成当前运行事实；远程 Agent 又不再经过本地进程轮询 | 新增 `normalizeHydratedAgent()`，所有持久化 Agent 在进入工作区前强制回落 `idle + unknown + canUseInternalMemory=false`；停止/离线/复制/编辑/删除均清理探测结果 |
| **#3** | P1 | `src/App.tsx`、`src/components/ConnectAgentModal.tsx`：远程 ACP Agent 启动 3 秒后被重置为 `idle`，且启动/保存时丢失 `nativeMemory` 探测结果 | `syncRunningAgentsWithBackend` 未跳过 `isRemote \|\| acpTransport === 'websocket'`；`onToggleAgentStatus` 与保存时 `healthCheck` 未消费 `probe.nativeMemory` | 本地轮询跳过远程 Agent；新增远程健康租约与 15 秒复探；启动/停止/编辑/删除使用 generation 取消旧探测；能力、load/resume 与 latency 全链路回写 |
| **#4** | P2 | `src/services/agentMemory.ts`、`src-tauri/src/acp_manager.rs`：`{ supported: true }`（缺失 `enabled`）被误判为 `enabled` | TS 使用 `value.enabled !== false`，Rust 使用 `(Some(true), _) => "enabled"`，与规范表格冲突 | TS 与 Rust 统一要求 `supported === true && enabled === true` 才返回 `"enabled"`，缺失 `enabled` 返回 `"unknown"` |
| **#5** | P2 | `bin/codex-acp`、`src/services/acpClient.ts`：适配器忽略 `_meta.shadowCrew.nativeMemory`；远程 Prompt 未用 `nativeMemoryEnabled` 门控 `autoGenerate`；disabled 无法覆盖用户 config | `bin/codex-acp` 仅读取进程启动环境变量，disabled 仅省略参数；客户端直接透传 autoGenerate | `resolveNativeMemoryPolicy(params)` 优先消费 `_meta`；disabled 显式追加 `--disable memories`、`features.memories=false` 与三项 `memories.*=false`；客户端在 disabled 时强制 autoGenerate=false |
| **#6** | P1 | `src/components/ConnectAgentModal.tsx`：全局暗色主题下出现白字叠浅绿底、亮色主题切暗色弹窗出现黑字叠深底（违反 `NM-THEME-01`） | `isLightMode` 未与 `<html data-theme>` 同步，且弹窗内部混用受全局 `<html>` 驱动的 `text-fg` / `dark:*` 与受局部 `isLightMode` 驱动的浅色背景 | 弹窗容器绑定 `data-theme={isLightMode ? 'light' : 'dark'}`，通过 `MutationObserver` 同步全局主题，并将记忆策略区与远程探测区全面改为 `isLightMode` 双主题高对比度配色 |
| **#7** | P2 | `src/components/AcpInspector.tsx`、`src/components/ConnectAgentModal.tsx`：`persistent: false` 显示为 `UNKNOWN`；`unknown` 状态伪造 `supported: false` 报文；远程 `disabled` 显示为 `未声明 ⚠️` | 三元表达式未区分 `false` 与 `undefined`；`jsonRpcSample` 无条件拼装 `nativeMemory`；远程探测条未分支处理 `disabled` | 精确区分 `YES / NO / UNKNOWN`；仅当 `nativeMemoryStatus !== 'unknown'` 时在示例报文中展示 `nativeMemory`；远程探测条对 `disabled` 显示 `已声明 (已关闭)` |
| **#8** | P2 | `src/App.tsx`、`src/components/ConnectAgentModal.tsx`：复制 Agent 时旧 `capabilities` 覆盖 `canUseInternalMemory` 且拷贝旧 `nativeCapability`；新建 Agent 丢弃 `capabilities`；仅修改 `autoGenerate` 未触发策略变更重置 | 属性展开顺序将 `...(agent.capabilities \|\| {})` 放在后面；`onConnectAgent` 硬编码 `capabilities`；`nativeMemoryPolicyChanged` 仅比较 `mode` | 修正展开顺序并重置副本 `nativeCapability` 为 `unknown`；`onConnectAgent` 保留 `agentData.capabilities`；`nativeMemoryPolicyChanged` 同时校验 `mode` 与 `autoGenerate` |
| **#9** | P3 | `src-tauri/src/acp_manager.rs`：Rust 默认 `AcpNativeMemoryCapability` 与前端 TS 默认值不一致（英文 `detail`、`scope: None`、动态时间戳） | Rust `Default` 实现未与前端 `createUnknownNativeMemoryCapability()` 对齐，导致轮询无意义刷新并覆盖中文提示 | 对齐 Rust 默认值为 `scope: Some("unknown")`、中文 `detail: Some("等待 ACP 端点握手声明")`、`last_checked_at: 0`，并在 `App.tsx` 按语义字段比对变更 |

### 3.2 第二轮与第三轮针对 5 项重点问题的深度核查与彻底闭环

| 问题项 | 之前修复状态 | 本轮深度复查发现的残留/次生缺陷 | 最终闭环修复与验证 |
| --- | --- | --- | --- |
| **P1：`disabled` 无法覆盖用户全局 `memories` 配置** | `bin/codex-acp` 已追加 `--disable memories` 与 `-c features.memories=false` 等参数 | 1. 探测 `catch` 把异常压成 `supported=false`，无法区分“明确不支持”与“本次探测失败”。<br>2. Fake CLI 与真实 E2E 未完整验证用户 TOML 中已有 `[features]/[memories]` 时能否原位覆盖。 | 1. 探测改为 `true/false/null` 三态、有界重试，持续失败上报 `unknown`。<br>2. Fake CLI 在 `[features] memories = true` 下验证四个 effective 值均被关闭。<br>3. 真实 E2E 通过 TOML section upsert 原位更新用户配置，断言能力 `supported=true / enabled=false`，且不产生 TOML parse error、不召回 `ORBIT-7742-LYNX`。 |
| **P1：`lazy initialize` 第二次超时仍永久锁定** | `acp_manager.rs` 已移除超时分支的 `self.initialized.store(true)` | Rust 测试仅测试了 `next_init_request_id()` 递增，缺少“连续两次 `initialize` 超时后仍可第三次重试并恢复 `nativeMemory` 能力”的真实异步握手测试。 | 抽离 `execute_lazy_initialize_handshake` 并在 `acp_manager.rs` 新增 `test_initialize_twice_timeout_remains_retryable_and_recovers_capabilities`，验证连续两次超时后 `initialized == false`、`pending_requests` 归零，第三次成功握手后恢复 `initialized == true` 且 `native_memory_capability.status == "enabled"`。 |
| **P2：远程 Agent 可能永久显示在线** | `App.tsx` 已增加 15s 远程复探，SQLite hydration 已接入 `normalizeHydratedAgent` | 1. `localStorage` 初始化入口（`App.tsx` 第 287/295 行）仍调用 `migrateAgentMemoryV1` 而非 `normalizeHydratedAgent`，若 SQLite 尚未返回或失败会短暂暴露持久化的 `running + enabled`。<br>2. SQLite hydration 完成后把所有 Agent 置为 `idle`，但未立即重新触发 `syncRunningAgentsWithBackend()`。 | 1. `localStorage` 与 `INITIAL_AGENTS` 全入口统一使用 `normalizeHydratedAgent`。<br>2. SQLite hydration 完成后立即调用 `syncRunningAgentsWithBackendRef.current?.()` 同步后端运行态与远程探测。 |
| **P2：远程启动/停止存在异步竞态** | 已引入 `remoteAgentLifecycle.ts` 的 `generation` 租约 | 1. `AgentDashboard.tsx` 的 `handleStopAll` 使用 `ag.status !== 'idle'` 判断运行态，导致处于 `error` 或 `auth_required` 的 Agent 在点击“Stop running agents”时反而被触发启动！<br>2. Agent 卡片状态胶囊按钮设置了 `disabled={agent.status === 'starting'}`，导致用户在慢探测期间无法点击胶囊取消启动。<br>3. `onToggleAgentStatus` 读取闭包 `agents` 而非 `agentsRef.current`；`onUpdateAgent` 在保存刚完成健康探测的远程在线 Agent 时误调 `cancelRemoteAgentProbe` 导致 5s 后重复探测。 | 1. 新增 `isAgentActivelyRunning(agent, store)`，`handleStopAll` 仅停止真正运行中或探测中的 Agent，绝不误启动 `error / auth_required` Agent。<br>2. 移除卡片胶囊按钮在 `starting` 态的 `disabled` 锁死，支持随时点击中断握手。<br>3. `onToggleAgentStatus` 改读 `agentsRef.current` 并接入 `markRemoteAgentStarting` / `applyRemoteProbeOutcome` / `stopAgentRuntimeState`；`onUpdateAgent` 在远程在线复测成功后调用 `recordRemoteProbeSuccess` 记录租约时间。 |
| **P3：测试覆盖偏差（源码字符串断言与缺口）** | 仍使用 `readFileSync` 字符串匹配校验 UI 与宿主生命周期 | `verifyRemoteWebSocketAndUiContracts` 存在 8 处 `readFileSync(...).includes(...)` 源码扫描断言，且缺少 `Agent[]` 状态机层面的远程断线与启停竞态行为测试。 | 1. 全面移除 `readFileSync` 源码字符串断言。<br>2. 使用 `renderToStaticMarkup` 对 `<AcpInspector />`（`rust_tauri` 与 `memory` 双标签页 × 4 种能力状态）及 `<ConnectAgentModal />`（亮/暗主题、远程探测状态胶囊、主从复选框联动）进行真实组件树渲染断言。<br>3. 对 `Agent[]` 状态迁移函数执行「启动→探测中停止→迟到响应丢弃→重连成功→15s 复探断线回落 `error + unknown`」完整行为测试。 |

### 3.3 本轮新增 4 项问题与闭环

| 编号 | 严重度 | 缺陷现象与根因 | 修复与判别性验证 |
| --- | --- | --- | --- |
| **R5-1** | P1 | 远程 probe 断线后 `isModelHealthy=false`；后续成功 probe 只恢复 `running` 和能力，未恢复健康标志，导致 Agent 显示在线但健康态残留异常 | `applyRemoteProbeOutcome` 在成功分支写入 `isModelHealthy=true`，并把 health 变化纳入提前返回判据；新增“仅 health 不同、其余字段完全一致”的用例，旧实现会返回原对象并保留 `false`，现实现必须物化新对象并恢复 `true` |
| **R5-2** | P1 | 真实 E2E 向已有 `config.toml` 尾部直接追加 `[features]/[memories]`，用户配置已含同名 section 时会产生重复表/TOML 解析错误；“不召回 canary”可能被启动失败误判为通过 | 新增按 section/key 原位 upsert 的测试夹具；真实运行断言 `supported=true`、`enabled=false`、输出不含 `TOML parse error / failed to load / Codex 执行退出`，再断言不含 canary |
| **R5-3** | P2 | `ConnectAgentModal` SSR 时没有 `document`，暗色首帧只能回退为亮色，原有 SSR“暗色”用例实际未验证暗色组件树 | 新增可选 `initialThemeMode` 作为确定性首帧输入；SSR 显式渲染 dark，断言 `data-theme="dark"`、暗色主背景及 emerald/amber/slate 语义色同时存在，且不存在 `data-theme="light"` |
| **R5-4** | P2 | Codex 特性探测异常时返回并可能展示 `supported=false`，把“探测不可判定”伪造为“明确不支持”；原逻辑也没有有界重试 | 探测改为 `true/false/null`，单请求最多 2 次；明确结果缓存，`null` 不缓存。Fake CLI 覆盖“首轮失败后成功”和“持续失败”两路径，后者断言 supported/enabled 属性缺失、探测次数有界、下一请求会重新尝试，disabled 覆盖仍生效 |

---

## 4. 分层自动化验证结果与真实性声明

| 验证层级 | 验证项 | 执行命令 | 结果与证据 | 验证性质声明 |
| --- | --- | --- | --- | --- |
| **静态类型检查** | TypeScript 全量类型校验 | `npm run lint` | 通过（0 error） | 真实编译器静态检查 |
| **生产构建检查** | Vite 前端生产打包 | `npm run build` | 通过（2016 modules transformed） | 真实生产打包 |
| **单元 + 协议 + 状态机 + UI 渲染层** | 原生记忆契约、迁移、用户 TOML 覆盖、Codex 探测三态/重试、远程 WS、状态机与 React SSR | `npm run test:acp-native-memory` | **通过（200 assertions）** | 纯函数 + Fake Codex 子进程 JSON-RPC + Mock WebSocket + 状态机行为测试 + React `renderToStaticMarkup` 组件树渲染 |
| **真实运行期层 (E2E)** | 真实 Codex CLI 跨进程写入、跨 Session 召回 + 用户 TOML `memories=true` 下 `disabled` 强制阻断召回 | `npm run test:acp-native-memory -- --real` | **通过（210 assertions，隔离 `CODEX_HOME`）** | **真实 `bin/codex-acp` + 真实本机 Codex CLI + 真实模型网关推理 + 真实 `memories_v2` 落盘、跨进程召回与 `disabled` 阻断召回** |
| **ACP 运行时基线** | ACP-only 运行时与禁用历史字段回归 | `npm run test:acp-only` | 通过 | 纯函数与契约回归 |
| **Rust 宿主层** | Tauri ACP 管理器、握手解析、连续两次超时重试恢复、Session 隔离、权限与 SQLite | `cargo test -p shadow-crew-desktop --no-fail-fast` | **通过（34/34 tests）** | 真实 Rust 单元与异步握手/SQLite 状态机集成测试 |
| **Rust MCP 工具层** | Dev MCP Server 工具契约与执行 | `cargo test -p shadow-crew-dev-mcp --no-fail-fast` | **通过（9/9 tests）** | 真实 Rust 单元测试 |

### 验证覆盖边界说明（符合 `AGENTS.md` 第 2.7 节要求）

- **已覆盖的真实运行期层**：
  - 本机真实 Codex CLI（`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`）经 `bin/codex-acp` 的 `initialize` 握手探测、第一个 Session 原生 memory 工具写入（落盘至隔离 `CODEX_HOME/memories_v2/extensions/ad_hoc/notes`）、进程退出后第二个全新进程/Session 的跨线程原生 memory 召回，以及在隔离 `CODEX_HOME/config.toml` 原位 upsert `[features]/[memories]` 后以 `disabled` 模式启动第三个真实 Codex 进程，验证 `supported=true / enabled=false` 且无法召回 canary。
  - Rust `shadow-crew-desktop` 后端状态机、连续两次 `initialize` 超时后第三次握手恢复、握手能力解析与 SQLite 持久化测试。
  - 真实 E2E 首次运行遇到一次 45 秒模型响应超时（不是确定性断言失败）；补充分阶段诊断后连续两次完整通过（207、210 assertions），均完成真实写入、跨进程召回和 disabled 阻断。
- **使用 Fake / Mock / SSR 的验证层**：
  - 远程 WebSocket 握手探针（`probeRemoteAcpConnection`）与远程 Prompt 发送（`sendPromptToRemoteAcpWebSocket`）通过进程内 `MockWebSocket` 验证了完整 JSON-RPC 报文载荷、`_meta.shadowCrew.nativeMemory` 门控与错误 Fail-Closed 行为；远程 Agent 启停竞态、迟到 probe 拒绝与 15 秒断线回落通过 `remoteAgentLifecycle.ts` 状态机对 `Agent[]` 进行了行为验证。
  - `AcpInspector` 与 `ConnectAgentModal` 通过 `react-dom/server` 的 `renderToStaticMarkup` 执行了组件树渲染与状态矩阵验证；暗色首帧通过显式 `initialThemeMode` 验证，不属于真实桌面 UI 截图证据。

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

1. 在测试 `CODEX_HOME/config.toml` 中开启 `features.memories=true` 与 `[memories]`。
2. Shadow Crew 将该 Codex Agent 设为 `disabled` 并重启。
3. 检查 ACP 能力为 `disabled`，子进程参数包含 `--disable memories`、`features.memories=false` 与三项 `memories.*=false` 配置。
4. 发送一个在旧记忆中明确存在的 canary 查询，并禁止 shell/文件读取。
5. 预期 Agent 无法通过 native memory 召回该 canary。

### NM-REMOTE-01 远程健康租约与启停竞态

1. 使用一个可断开、初始化可延迟的远程 WebSocket ACP 测试端点。
2. Shadow Crew 点击 Start 后立即点击卡片上的 `starting` 胶囊（或顶部 `Stop running agents`）。
3. 等待超过初始化延迟时间，确认 Agent 仍保持 `idle`，不会被迟到 probe 复活；且处于 `error` 状态的 Agent 不会被 `Stop running agents` 误触发启动。
4. 再次 Start 并等待成功，然后关闭远端服务；超过 15 秒健康复探窗口后，Agent 应从 `running` 回落为 `error`，`nativeMemory` 变为 `unknown`。

### NM-THEME-01 双主题与弹窗内部主题切换可读性

1. 分别在应用全局白昼主题（`data-theme="light"`）和暗夜主题（`data-theme="dark"`）下打开「编辑 Agent」弹窗。
2. 点击弹窗右上角的太阳/月亮按钮切换弹窗内部明暗模式，检查底部「启用 ACP 端点原生长期记忆」区域及「远程 ACP WebSocket 测试连接」结果区域：
   - 四种组合（全局亮/暗 × 弹窗亮/暗）下文字对比度均清晰锐利，无浅字叠浅底或深字叠深底。

---

## 6. 已知环境边界

- ACP 协议本身不规定统一的长期记忆存储格式；其他外部 Agent 需实现并声明 `agentCapabilities.nativeMemory` 或消费 `_meta.shadowCrew.nativeMemory`。
- Codex 后台自动提炼（`memories.generate_memories=true`）依赖模型网关是否注册了 Codex 内部记忆提炼模型；本机自定义网关对后台提炼模型返回 `model_not_registered`，因此默认关闭 `autoGenerate`，显式原生 memory 工具读写与跨线程召回不受影响并已真实跑通。
- 多个 Agent 共用同一 `CODEX_HOME` 时，Codex 原生长期记忆按 `scope=runtime` 共享；如需实例级物理隔离，请为不同 Agent 配置独立的 `CODEX_HOME`。
