# Shadow Crew 本地 ACP 权限代理测试报告

> **执行日期**：2026-10-29（Asia/Shanghai）
> **结论**：本地 stdio ACP 权限请求、用户决策、Scope Grant、撤销与真实写文件闭环全部通过
> **方案文档**：[`TECH_SPEC_ACP_LOCAL_PERMISSION_BROKER.md`](./TECH_SPEC_ACP_LOCAL_PERMISSION_BROKER.md)
> **范围**：本地 ACP；WebSocket 远端授权不在本期范围

---

## 1. 测试结论

本轮实现了 ACP `session/request_permission` 的完整本地闭环：

```text
本地 ACP Agent
  → session/request_permission
  → Rust Pending Permission Queue
  → React 授权弹窗
  → 用户 allow / deny / Session Grant / Scope Grant
  → Rust 写回原始 optionId
  → ACP Agent 继续或终止工具调用
```

实际 Tauri App 已验证：

- 拒绝后 ACP 收到拒绝结果，未写文件；
- 允许一次后 ACP 完成真实写文件；
- 授予当前 DM 的 `fs.write` Grant 后，下一次同类请求自动放行；
- 权限中心可查看并撤销 Grant；
- 撤销后下一次请求重新弹窗；
- 删除 Agent 会同步撤销其全部 Grant。

## 2. 本轮发现并修复

| 问题 | 根因 | 修复 |
| :--- | :--- | :--- |
| `session/request_permission` 从未真正询问用户 | Host 自动选择首个 `allow` 选项 | 改为 Pending Queue，默认等待用户决策 |
| ACP 声明支持 Client FS / Terminal，但没有实现对应 RPC | Capability 虚假声明 | 本地初始化明确声明 `fs=false`、`terminal=false`，由 ACP 自身工具执行 |
| Tauri 打包 App 中权限事件未到达 React | 误把 `__TAURI_INTERNALS__.listen` 当事件 API；打包环境事件订阅不可靠 | 增加 Rust Pending Queue 1 秒轮询兜底，事件只作为实时加速通道 |
| 不同 Agent 使用相同 JSON-RPC id 时前端互相覆盖 | 只使用 `requestId` 去重 | 改为 `agentId + requestId` 复合键 |
| Session Grant 可能在 Session 重建后继续生效 | Grant 只绑定 Scope，没有绑定 sessionId | Session Grant 加入 `sessionId`，清理 Session 时同步撤销 |
| 目录不存在时 `..` 路径可能被词法误判为工作区内 | 路径 canonicalize 失败后直接比较原始路径 | 增加词法归一化与 Binding 外路径阻断 |
| 构建 Tauri App 后 `npm run lint` 扫描 `target/debug/build` 二进制资源 | `tsconfig` 未排除 Rust target | 排除 `target` 与 `src-tauri/target` |
| 未识别工具可能被永久授权 | Capability 风险边界未知 | `other` 仅允许 Once 或 Deny |

## 3. 自动化验证

| 检查 | 命令 | 结果 |
| :--- | :--- | :--- |
| TypeScript | `npm run lint` | ✅ 通过 |
| 前端生产构建 | `npm run build` | ✅ 通过 |
| Rust workspace | `cargo test --workspace` | ✅ Desktop 25/25；Dev MCP 9/9 |
| ACP 权限协议夹具 | `node --import tsx src/services/test-acp-permission-protocol.ts` | ✅ 5/5 |
| 权限 UI 渲染与队列 | `node --import tsx src/services/test-acp-permission-ui.ts` | ✅ 14/14 |
| 普通模式编排 | `node --import tsx src/services/test-normal-mode-buzz-orchestration.ts` | ✅ 54/54 |
| 应用内部 LLM 压缩 | `node --import tsx src/services/test-llm-compaction-governance.ts` | ✅ 140/140 |
| Workspace Binding | `node --import tsx src/services/test-workspace-bindings.ts` | ✅ 通过 |
| ACP-only | `node --import tsx src/services/test-acp-only-runtime.ts` | ✅ 通过 |
| DM Topic | `node --import tsx src/services/test-dm-topics.ts` | ✅ 20/20 |
| Mention 边界 | `node --import tsx src/services/test-mention-resolution.ts` | ✅ 13/13 |
| CognoNexus | `npm run test:cogno` | ✅ 全部通过 |
| G-Frame Edge | `node --import tsx src/services/cogno/test-gframe-edge-cases.ts` | ✅ DEFECT 0 / WARN 0 |

### 3.1 Rust 权限单元测试

- `allow_always` 不会被伪装为一次性允许；
- `allow_once` 和 `reject_once` 正确映射；
- `edit` 映射为 `fs.write`，`execute` 映射为 `shell.execute`；
- Binding 外路径和 `..` 路径识别；
- ACP View 使用 camelCase 序列化；
- SQLite Scope Grant 精确匹配 Agent / Scope / Binding / Capability；
- Grant 单条撤销、Agent 全量撤销、Scope 全量撤销。

## 4. 真实 Tauri 端到端验证

测试使用本地 ACP 夹具：

```text
python3 -u src-tauri/tests/fixtures/fake_permission_acp.py
```

夹具在 `session/prompt` 后发送 `session/request_permission`，只有收到
`allow-once` 才写入测试文件。

| 场景 | 操作 | 实际结果 |
| :--- | :--- | :--- |
| E2E-01 拒绝 | 点击“拒绝” | ACP 收到拒绝，返回 `FAKE_ACP_DENIED`，文件未写入 |
| E2E-02 允许一次 | 点击“允许一次” | ACP 写入 `permission-e2e.txt`，内容为 `allowed` |
| E2E-03 DM Scope Grant | 点击“在当前 DM 始终允许此能力” | 权限中心出现 `fs.write / DM / Agent Root` Grant |
| E2E-04 Grant 复用 | 再次发送相同 Prompt | 无弹窗，ACP trace 记录 2ms 完成 |
| E2E-05 撤销 | 权限中心点击“撤销” | Grant 消失 |
| E2E-06 撤销生效 | 撤销后再次发送 | 授权弹窗重新出现 |
| E2E-07 Agent 清理 | 删除测试 Agent | 权限中心保持为空，无孤儿 Grant |

测试结束后已删除 fake Agent、测试文件与空测试目录。

## 5. 人工复测用例

### 5.1 前置

1. 执行 `npm run dev:desktop` 或启动调试 App。
2. 连接一个本地 stdio ACP Agent。
3. 使用会发起 `session/request_permission` 的 Agent 或测试夹具。

### 5.2 基础授权

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| PERM-01 | Agent 请求写入文件 | 弹窗显示 Agent、Scope、工具、路径和 ACP 原始选项 |
| PERM-02 | 点击拒绝 | Agent 收到拒绝，不执行写入 |
| PERM-03 | 重试并点击允许一次 | 工具执行一次，下一轮仍重新询问 |
| PERM-04 | 请求读取 Binding 外文件 | 显示越界告警；不可创建 Scope Grant |
| PERM-05 | 请求未知工具 | 只能允许一次或拒绝 |

### 5.3 Scope Grant

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| GRANT-01 | 选择当前 Session 始终允许 | 同一 Session 自动放行；Session 重建后失效 |
| GRANT-02 | 选择当前 DM 始终允许 | 同 Agent、同 DM、同 Capability 自动放行 |
| GRANT-03 | 选择当前 Topic 始终允许 | 不作用于 Channel 或其他 Topic |
| GRANT-04 | 选择当前 Channel 始终允许 | 只作用于当前 Channel 主会话 |
| GRANT-05 | 在权限中心撤销 | 下一次请求重新询问 |
| GRANT-06 | 删除 Agent | 该 Agent Grant 全部删除 |
| GRANT-07 | 删除 Channel | Channel Grant 及其 Topic Grant 全部删除 |

### 5.4 Fail-Closed

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| SAFE-01 | ACP 只提供 `allow_always` | 不允许伪造 once；只能拒绝或继续阻塞 |
| SAFE-02 | ACP 请求没有 `sessionId` | Host 返回 cancelled |
| SAFE-03 | Session 没有活跃 Prompt | Host 返回 cancelled |
| SAFE-04 | 用户长时间不操作 | 默认超时后取消，不自动放行 |
| SAFE-05 | 重复提交同一 Pending Request | 仅第一次生效，后续明确报错 |
| SAFE-06 | 两个 Agent 使用相同 JSON-RPC id | 两个授权请求独立排队，不互相覆盖 |

## 6. 已知边界

1. 本期只处理本地 stdio ACP，WebSocket 远端授权后续单独设计。
2. ACP 端点必须主动发送 `session/request_permission`。如果端点直接使用 `bypassPermissions` 或自行写文件，协议层无法替代 OS 沙箱。
3. Client FS / Terminal Capability 当前为 `false`；Agent 使用自身工具，并通过 ACP 权限请求询问。
4. 当前授权是 Host 级事务边界；要防止恶意 ACP 子进程绕过协议，仍需后续引入 OS 级沙箱。
5. Session Grant 只在内存中存在，ACP Session 清理后自动失效。
