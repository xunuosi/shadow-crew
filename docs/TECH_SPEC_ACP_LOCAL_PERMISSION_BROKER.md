# Shadow Crew 本地 ACP 权限代理技术方案

> **版本**：v1.0.0
> **状态**：已实施
> **范围**：本地 stdio ACP
> **不在本期范围**：WebSocket / Relay Hub 远端授权
> **关联文档**：
> - [`TECH_SPEC_ACP_ONLY_RUNTIME.md`](./TECH_SPEC_ACP_ONLY_RUNTIME.md)
> - [`TECH_SPEC_TOPIC_CWD_ISOLATION.md`](./TECH_SPEC_TOPIC_CWD_ISOLATION.md)

---

## 1. 目标

本地 ACP Agent 在读取、写入、删除文件或执行 Shell 前，可以通过标准 ACP
`session/request_permission` 请求向 Shadow Crew 申请授权。

Shadow Crew 必须在 Rust Host 内完成：

1. 识别并保存 Agent 发起的 JSON-RPC 反向请求；
2. 将请求映射到 Agent、ACP Session、Channel / Topic / DM 和 Workspace Binding；
3. 检查已有持久授权；
4. 无授权时通过 Tauri Event 通知 React；
5. 用户选择后向 ACP stdin 回复原始 `optionId`；
6. 对允许结果保存 Once / Session / Scope Grant；
7. 记录允许、拒绝、超时、撤销审计；
8. 在用户无响应、授权范围不匹配或协议缺少安全选项时 Fail-Closed。

## 2. 非目标

- 不新增自定义 ACP 方法。
- 不由前端擅自构造或伪造 ACP `optionId`。
- 不把 `allow_always` 直接等同于 Shadow Crew 的产品级永久授权。
- 不承诺在 ACP Agent 主动绕过权限系统时提供 OS 级隔离。
- 本期不处理远端 WebSocket Bridge 的授权转发。

## 3. 协议边界

ACP 使用 JSON-RPC 2.0。Shadow Crew 通常发起：

```text
client → agent: session/prompt
```

Agent 需要权限时，通过同一 stdio 通道反向发起：

```text
agent → client: session/request_permission
client → agent: selected option / cancelled
agent → client: 工具执行继续，最终返回 session/prompt 响应
```

请求中的 JSON-RPC `id` 属于 Agent 发起的反向请求，不得作为
`session/prompt` 的普通响应消费。

### 3.1 请求字段

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/request_permission",
  "params": {
    "sessionId": "acp-session-id",
    "toolCall": {
      "toolCallId": "call-id",
      "name": "Write",
      "title": "修改文件",
      "kind": "edit",
      "rawInput": {
        "file_path": "/repo/src/app.ts"
      },
      "locations": [
        {
          "path": "/repo/src/app.ts"
        }
      ]
    },
    "options": [
      {
        "optionId": "allow-once",
        "name": "允许一次",
        "kind": "allow_once"
      },
      {
        "optionId": "reject",
        "name": "拒绝",
        "kind": "reject_once"
      }
    ]
  }
}
```

### 3.2 允许响应

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

### 3.3 拒绝响应

优先返回 ACP 提供的 `reject_once` / `reject_always`。若端点没有提供拒绝项，
使用 ACP 的 `cancelled` outcome，禁止猜测一个不存在的 `optionId`。

## 4. Capability 映射

Shadow Crew 将 `toolCall.kind` 与常见工具名归一化为以下 Capability：

| Capability | 典型 ACP kind | 典型工具 |
| :--- | :--- | :--- |
| `fs.read` | `read` / `search` | Read、Grep、Search |
| `fs.write` | `edit` / `write` | Write、Edit、MultiEdit |
| `fs.delete` | `delete` | Delete、Remove |
| `shell.execute` | `execute` | Bash、Shell、Terminal |
| `network.access` | `fetch` | Fetch、HTTP |
| `other` | 其他 | 未识别工具 |

授权租约按 Capability 隔离，不允许文件写授权自动继承 Shell 或网络权限。

## 5. Scope 模型

```ts
type AcpPermissionDecision =
  | 'deny'
  | 'allow_once'
  | 'allow_session'
  | 'allow_scope';
```

持久 Grant：

```ts
interface AcpPermissionGrant {
  id: string;
  agentId: string;
  scopeType: 'channel' | 'topic' | 'dm' | 'dm_topic';
  scopeId: string;
  workspaceBindingId: string;
  capability:
    | 'fs.read'
    | 'fs.write'
    | 'fs.delete'
    | 'shell.execute'
    | 'network.access'
    | 'other';
  createdAt: number;
}
```

匹配键：

```text
agentId
  + scopeType
  + scopeId
  + workspaceBindingId
  + capability
```

规则：

- Channel：只作用于当前 Agent 在 Channel 主会话中的同 Capability 请求。
- Topic：只作用于当前 Topic 与当前 Binding，不自动继承到 Channel 或其他 Topic。
- DM：只作用于当前 Agent 与当前私聊线程。
- DM Topic：只作用于当前 Agent 与当前 DM Topic Binding。
- Session Grant 仅保存在内存中，Agent 进程退出或 Session 清理后失效。
- 请求目标位于 Binding cwd 之外时，只允许 Once 或 Deny，不允许创建 Scope Grant。
- Grant 在 Workspace Binding 变化、撤销、过期或 Agent 身份变化后失效。

## 6. Host 数据流

```text
ACP stdout
  → 识别 session/request_permission
  → 标准化工具与 Capability
  → 通过 sessionId 定位 sessionKey / Scope / Binding / cwd
  → 匹配 Session Grant 或 SQLite Scope Grant
      → 命中：选择 allow_once 并回复
      → 未命中：登记 Pending Request
                → emit acp:permission_request
                → React 展示授权卡（Event + Pending 队列轮询双通道）
                → invoke respond_acp_permission
                → Host 校验 Pending Request 与 optionId
                → 必要时持久化 Grant
                → stdin 写回 ACP 响应
  → Agent 继续执行工具并返回 Prompt
```

## 7. 前端交互

授权弹窗至少展示：

- Agent 名称；
- 当前 Channel / Topic / DM；
- 工具名称与用途；
- Capability 与风险等级；
- 完整命令；
- 目标文件路径；
- Binding 外路径告警；
- ACP 原始选项名称。

操作：

- 拒绝；
- 允许一次；
- 当前 Session 内始终允许；
- 当前 Channel / Topic / DM 始终允许该 Capability；
- 打开“执行权限中心”撤销持久 Grant。

`allow_once` 是 Shadow Crew 等待 ACP 响应时使用的协议选项；Session / Scope
复用由 Shadow Crew 自己的 Grant 表完成，避免依赖不同 ACP 实现对
`allow_always` 的不一致语义。

Tauri 端以 Rust Pending Permission Queue 为唯一事实源。React 订阅
`acp:permission_request` 事件用于实时唤醒，同时每秒轮询
`list_pending_acp_permissions`，确保事件通道异常、WebView 重载或事件丢失时，
授权卡仍能恢复且请求不会永久悬挂。

## 8. 安全不变量

1. 弹出授权前不得自动选择任何 `allow`。
2. 没有 Pending Request 时，前端不能提交授权结果。
3. `optionId` 必须存在于该请求原始 options 中。
4. 请求已完成、取消、Agent 停止或 Session 清理后，迟到响应必须丢弃。
5. 用户未选择、应用退出或 Tauri Event 投递失败时，不执行操作。
6. 一个 Grant 只覆盖一个 Agent、一个 Scope、一个 Binding 和一个 Capability。
7. Binding 外路径不能被 Scope Grant 自动放行。
8. Webview 只展示授权，不拥有授权真值；持久化与匹配必须在 Rust Host。

## 9. Capability 协商修正

当前 Host 未实现 ACP Client FS / Terminal RPC，因此不得继续声明：

```json
{
  "fs": {
    "readTextFile": true,
    "writeTextFile": true
  },
  "terminal": true
}
```

本期明确声明为 `false`，让 ACP Agent 使用其自身工具并通过
`session/request_permission` 请求授权。后续实现 ACP FS / Terminal Broker 后，
才能重新声明能力为 `true`，并让 Broker 复用同一权限系统。

## 10. 实施阶段

### Phase 1：Host Permission Broker

- 解析 `session/request_permission`；
- Pending Request 注册、查询、响应；
- 禁止自动批准；
- 等待授权时暂停 Prompt 空闲超时判定。

### Phase 2：Scope Grant

- Session 内存 Grant；
- SQLite Channel / Topic / DM / DM Topic Grant；
- Grant 列表、撤销与审计日志。

### Phase 3：UI

- 全局授权弹窗；
- 多请求队列；
- 执行权限中心；
- Binding 外路径与高风险命令提示。

### Phase 4：测试

- 能力分类与 option 选择单元测试；
- Grant 持久化、匹配、撤销测试；
- `cargo test --workspace`；
- `npm run lint`；
- `npm run build`；
- 本地模拟 ACP 子进程的 stdio 集成测试；
- 浏览器运行期 UI 回归。

## 11. 验收标准

- ACP `session/request_permission` 不再被自动批准。
- 授权弹窗可见工具、命令、路径和风险。
- 允许一次后 ACP 能继续执行。
- 当前 Session / Channel / Topic / DM 授权可复用，且不会跨 Scope 泄漏。
- 权限中心可以查看并撤销持久 Grant。
- 取消、超时、无效 optionId、无 Scope 上下文均 Fail-Closed。
- 本地 ACP 的真实读写操作由测试脚本完成端到端验证。
