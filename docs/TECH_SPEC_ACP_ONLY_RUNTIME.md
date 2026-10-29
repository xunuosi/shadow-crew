# Shadow Crew ACP-only 执行面技术方案

> **版本**：v1.0.0
> **状态**：已实施
> **关联文档**：
> - [`TECH_SPEC_ACP_REMOTE_AND_MEMORY.md`](./TECH_SPEC_ACP_REMOTE_AND_MEMORY.md)
> - [`TECH_SPEC_TOPIC_CWD_ISOLATION.md`](./TECH_SPEC_TOPIC_CWD_ISOLATION.md)

---

## 1. 目标

Shadow Crew 不再提供自研内置 Agent 执行能力。所有 Agent 推理、工具调用、Session 上下文、上下文压缩和长期 Memory 均由用户连接的本地或远程 ACP 端点负责。

Shadow Crew 保留薄控制面：

- Agent 连接发现与生命周期；
- Channel / Topic / DM 业务编排；
- Workspace Binding 与 cwd；
- Session Key、恢复与清理；
- UI 消息历史、搜索、审计；
- Artifact、Patch 与用户确认。

## 2. 职责边界

| 能力 | 归属 |
| :--- | :--- |
| 模型参数与推理 | ACP 端点 |
| Session 内上下文 | ACP 端点 |
| 自动压缩 | ACP 端点 |
| 长期 Memory | ACP 端点 |
| Skills / MCP / Tool Loop | ACP 端点 |
| ACP 进程发现与连接 | Shadow Crew |
| 多 Agent 消息路由 | Shadow Crew |
| Workspace Binding / cwd | Shadow Crew |
| UI 历史与审计 | Shadow Crew |
| Patch / Artifact 归属 | Shadow Crew |
| 应用内部 LLM 调用 | Shadow Crew 全局模型配置 |

## 3. 删除内容

本次删除：

1. `crates/shadow-crew-agent` 自研 Agent 运行时；
2. 内置 Native Agent 默认 Agent 卡片；
3. ACP 预设中的 `shinobi_core`；
4. 内置 Agent 启动路径探测；
5. 从 Agent 私有模型配置向 `SHADOW_CREW_LLM_*` 环境变量注入；
6. Browser/离线环境直连 LLM Agent fallback；
7. 无 ACP 时的拟真模拟回答；
8. Shadow Crew 自动注入外挂 Memory 到 Agent Prompt；
9. 应用侧创建 Guest Clone Agent 能力。

## 4. 保留内容

保留全局模型配置与应用内部 LLM Service，用于：

- 应用内摘要；
- 结构化提取；
- 未来软件自身的分析任务；
- 模型连通性检测。

该配置不再作为 ACP Agent 的隐式执行后端。

## 5. 执行流程

### 5.1 本地 ACP

```text
用户在 Agent 面板选择本地 ACP 预设
  → 保存 command / args / env
  → 用户点击 Start
  → Shadow Crew 启动 ACP 子进程
  → initialize 握手
  → session/new / session/resume / session/load
  → session/prompt
```

### 5.2 远程 ACP

```text
用户填写 ws:// 或 wss:// 端点
  → 探测握手与 Capabilities
  → session/prompt
```

### 5.3 无 ACP

必须显式失败：

```text
当前运行环境未提供 ACP 调用通道
```

禁止改走直连 LLM、内置 Agent 或模拟文本。

## 6. Session 与上下文

Shadow Crew 只负责：

- 生成稳定 Session Scope Key；
- 保存 Agent / Scope / Binding / Session ID 映射；
- 热 Session 复用；
- 恢复失败时显式重新建 Session；
- 发送其他 Agent 的增量事件。

### 6.1 CWD 生命周期

ACP 的 `session/new` 在创建会话时接收 `cwd`。同一 ACP Session 不提供跨工作目录切换的稳定通用语义，因此 Shadow Crew 采用：

1. `Session Key` 包含显式作用域与 Workspace Binding；
2. Channel、Channel Topic、DM 主会话、DM Topic 各自拥有独立 Session；
3. Workspace Binding 创建后不可修改；
4. 需要换工作目录时创建新的 Channel/Topic，不复用旧 Session，也不尝试在旧 Session 中原地切换。

这保证即便不同 ACP 实现把 `cwd` 固定在会话创建阶段，宿主侧也不会出现 Session 与工作目录错配。

Shadow Crew 不再：

- 为 ACP Agent 生成 `<compacted-summary>`；
- 注入全局 Memory Cartridge；
- 重算 ACP 的上下文窗口；
- 代替 Agent 决定压缩时机。

## 7. 全局模型配置

Agent 未配置模型属于正常状态。ACP 端点的模型由端点自身管理。

应用设置中的全局模型配置独立存在，只供 Shadow Crew 内部调用：

```ts
interface AppInternalLlmConfig {
  provider: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}
```

## 8. 错误策略

- Agent 未启动：拒绝派发并提示 Start。
- ACP 命令为空：拒绝派发。
- initialize 被拒绝：显示端点错误，不降级。
- 本地 IPC 失败：显示 ACP 错误，不模拟回答。
- Session load 失败：按显式策略新建 Session 或由用户取消。
- 远程端点不可达：显示连接错误。

## 9. 测试边界

- 默认 Agent 列表不包含自研 Agent。
- ACP 预设不包含 `shinobi_core`。
- 无 Tauri / 无远程端点时 `sendPromptToAcpAgent` 返回显式错误。
- 源码不得再包含内置 Agent 执行 crate。
- 全局模型配置仍可读取与保存。
