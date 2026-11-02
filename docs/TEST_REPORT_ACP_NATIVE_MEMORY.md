# ACP 原生长期记忆功能测试报告

> 测试日期：2026-11-02  
> 结论：通过，可交付复测  
> 规范：[SPEC_ACP_NATIVE_MEMORY.md](./SPEC_ACP_NATIVE_MEMORY.md)  
> 范围：本地 stdio ACP、远程 ACP 能力感知、Codex ACP 原生 Memory、Agent 配置迁移、双主题 UI

## 1. 实现摘要

1. Agent 增加显式 `memory.mode`（`native | disabled`）与 `autoGenerate` 策略。
2. ACP `initialize` 支持可选扩展 `agentCapabilities.nativeMemory`。
3. Rust 运行态解析并回传 `unknown | enabled | disabled | unsupported`，前端每 3 秒同步。
4. Codex ACP 适配器按策略启用：
   - `features.memories=true`
   - `memories.use_memories=true`
   - `memories.generate_memories=true|false`
   - `memories.dedicated_tools=true`
5. `session/prompt` 通过 `_meta.shadowCrew.nativeMemory` 向本地/远程端点传递策略。
6. 旧 Agent 数据集中迁移到 `schemaVersion=1`；没有在业务层散落旧字段回退。
7. ACP Session 清理、Topic 切换和 Shadow Crew 重启不会删除端点长期记忆。

## 2. 自动化验证结果

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript 类型检查 | `npm run lint` | 通过 |
| 生产构建 | `npm run build` | 通过（仅保留既有 >500 kB chunk 警告） |
| 原生记忆协议/适配器回归 | `npm run test:acp-native-memory` | 通过，60 assertions |
| 真实 Codex 跨 Session E2E | `SHADOW_CREW_REAL_NATIVE_MEMORY_TEST=1 npm run test:acp-native-memory` | 通过，65 assertions，隔离 `CODEX_HOME` |
| ACP-only 回归 | `npm run test:acp-only` | 通过 |
| Workspace / ACP Permission / Attachments / DM | 对应 `npm run test:*` | 全部通过 |
| Rust Desktop | `cargo test -p shadow-crew-desktop --no-fail-fast` | 32/32 |
| Rust MCP | `cargo test -p shadow-crew-dev-mcp --no-fail-fast` | 9/9 |
| 普通模式增量编排 | `test-normal-mode-buzz-orchestration.ts` | 54/54 |
| Mention / Compaction | 对应 TS 套件 | 13/13、140/140 |
| CognoNexus + G-Frame | `npm run test:cogno && npm run test:cogno:edge` | 全部通过，0 defect |
| UI 运行期 | Tauri dev 基础渲染 + 同源 Vite 页面 CDP 交互 | 通过；light 与 `data-theme=dark` 变体布局、开关联动及状态保存正常 |

真实 E2E 步骤：

1. 创建隔离临时 `CODEX_HOME`，仅链接本地 `config.toml`，不污染现有记忆库。
2. 启动 `bin/codex-acp`，握手确认 native memory 为 `enabled`。
3. 第一个 ACP Session 只输入“请长期记住 canary”。
4. 关闭进程，启动第二个独立 ACP Session。
5. 只询问 canary key，不提供 value。
6. 新 Session 返回正确 canary value；临时目录测试后自动删除。

## 3. 自检中发现并修复的问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 真实 Codex 写入后新 Session 为 `UNKNOWN` | 只启用 memories feature，未开启专用 memory tools | 增加 `memories.dedicated_tools=true` |
| 自动提炼在本机模型网关产生后台失败/503 | 记忆提炼 Agent 使用当前自定义网关未注册的模型 | 自动提炼改为 Agent 级显式开关，默认关闭；显式 memory 工具链路真实通过 |
| ACP Session 缓存固定写入 `$HOME/.shadow-crew` | 适配器未消费 Tauri 已注入的 `SHADOW_CREW_HOME` | 适配器统一使用 `SHADOW_CREW_HOME` |
| 旧 Agent 数据缺少记忆策略 | 历史结构只有内部展示字段 | 增加 `migrateAgentMemoryV1()` 集中迁移 |
| 用户可伪造 native memory ENV | 启动环境与用户 ENV 合并时可能重复 | 宿主过滤同名用户项，只下发受控策略值 |
| 5 秒真实模型超时 | 首次 memory tool 调用可能超过 5 秒 | 真实 E2E 请求超时提升至 45 秒 |

## 4. 复测前置条件

1. 启动 Shadow Crew 桌面端。
2. 进入 **Agents & 编队**，编辑一个 Codex Agent。
3. 开启 **启用 ACP 端点原生长期记忆**。
4. “允许自动提炼历史对话”默认可关闭；显式长期记忆不依赖此项。
5. 启动该 Agent，确认握手完成。
6. 用于复测的文本必须包含唯一随机 canary，不能出现在仓库、日志或 Prompt 后续问题中。

## 5. 用户复测用例

### NM-UI-01 配置与能力展示

**步骤**

1. 编辑 Agent，确认记忆开关可见。
2. 关闭主开关，检查自动提炼开关同步隐藏。
3. 重新开启主开关，检查自动提炼开关恢复。
4. 保存并启动 Codex Agent。
5. 打开 ACP Inspector 的 Memory 页。

**预期**

- 主开关默认允许 native mode。
- 自动提炼默认关闭。
- 握手完成后状态显示 `enabled`，提供方为 `codex-memories`，作用域为 `runtime`。
- 端点未声明扩展时显示 `unknown`，不得显示“支持”。

### NM-E2E-01 跨 ACP Session 召回

**步骤**

1. 在 Shadow Crew 的 Codex 会话 A 输入：

   ```text
   请长期记住：SC_NATIVE_MEMORY_CANARY_20261102 = ORBIT-7742-LYNX。
   不要使用 shell、文件或网络。完成后只回复 RECORDED。
   ```

2. 确认返回 `RECORDED`。
3. 新建一个不同 Topic 或私聊会话 B。
4. 在新会话只询问：

   ```text
   只使用 Codex 原生 memory 工具，查询 SC_NATIVE_MEMORY_CANARY_20261102 的 value。
   不要使用 shell、文件、网络或当前会话历史。不知道回答 UNKNOWN。
   ```

**预期**

- 会话 B 返回 `ORBIT-7742-LYNX`。
- 问题中不包含 value，排除普通对话上下文注入。
- 若多个 Agent 共用同一 Codex runtime，它们可能看到同一记忆；这是 `scope=runtime` 的预期行为。

### NM-RESTART-01 重启持久化

**步骤**

1. 完成 NM-E2E-01 写入。
2. 完全退出 Shadow Crew。
3. 重新启动，启动同一个 Codex Agent。
4. 新建会话询问同一个 canary key。

**预期**

- 仍能召回 canary。
- 若失败，检查两个进程的 `HOME`、`CODEX_HOME` 是否一致，以及原记忆库是否被手动清理。

### NM-DISABLED-01 关闭原生记忆

**步骤**

1. 关闭 Agent 的 native memory 开关并保存。
2. 重启 Agent。
3. 检查 ACP 能力面板。
4. 用新 canary 输入“请长期记住”，再开新 Session 询问。

**预期**

- 能力状态为 `disabled`。
- Codex 子进程参数不包含 memories 配置。
- 不应产生新的长期记忆召回。

### NM-SESSION-CLEAR-01 Session 清理不影响长期记忆

**步骤**

1. 写入 canary 并确认可召回。
2. 在 Shadow Crew 清理当前 ACP Session/对话。
3. 新开会话再次查询 canary key。

**预期**

- ACP Session 被重建。
- 端点长期记忆仍存在。
- 只有端点自身的记忆删除功能或直接清理其 native memory store 才会遗忘。

### NM-THEME-01 双主题可读性

**步骤**

1. 分别在 light/dark 下打开 Agent 编辑弹窗底部记忆区域。
2. 检查标题、说明、主开关、自动提炼开关和保存按钮。

**预期**

- 无浅字叠浅底、深字叠深底。
- 窄窗口无横向溢出。
- 禁用状态提示可读，语义色成对生效。

## 6. 已知环境边界

- ACP 协议不规定统一长期记忆格式；其他 Agent 必须实现并声明 `agentCapabilities.nativeMemory`，或消费 `_meta.shadowCrew.nativeMemory`。
- Codex 自动提炼依赖模型提供方是否支持其后台记忆 Agent。当前本机自定义网关会返回 `model_not_registered`，因此自动提炼默认关闭。
- 显式 memory/ad_hoc_note 工具写入、跨线程读取与新进程召回已在本机真实通过。
- 多个 Shadow Crew Agent 共用同一 `CODEX_HOME` 时，Codex 原生 Memory 是共享的；需要实例级隔离时，应使用独立运行目录/端点，或后续接入宿主级记忆命名空间。
