# Shadow Crew Topic 级 CWD 隔离技术方案

> **文档版本**：v1.0.0  
> **状态**：已实施并通过自动化与运行期验证 (Implemented)
> **面向对象**：产品、前端、Tauri/Rust、ACP Agent、MCP 与测试工程师  
> **关联文档**：
> - [`PRD_MESSAGING_SPACE.md`](./PRD_MESSAGING_SPACE.md)
> - [`TECH_SPEC_MESSAGING_SPACE.md`](./TECH_SPEC_MESSAGING_SPACE.md)
> - [`TECH_SPEC_ACP_REMOTE_AND_MEMORY.md`](./TECH_SPEC_ACP_REMOTE_AND_MEMORY.md)
> - [`SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md`](./SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md)

---

## 1. 方案摘要

本方案将 Channel 与 Topic 的执行目录彻底解耦：

1. Channel、Channel Topic 和 DM Topic 都拥有自己的不可变 `Workspace Binding`；DM 主会话使用固定的 Agent 专属目录。
2. `cwd` 在实体创建时一次性确定，创建后永久不可修改。
3. Topic 不再从 Channel 动态推导 `cwd`，也不再隐式回退到 Channel 目录。
4. ACP Session Key、SQLite 会话记录、MCP Pool、产物目录、Patch 合入和清理屏障全部以 `workspaceBindingId` 为作用域。
5. 同一 Agent 在同一 Channel 的不同 Topic 中拥有独立 ACP Session 和独立 `cwd`。
6. 当前阶段保留“同一 Agent 串行 Prompt”安全策略；未来并行执行必须先完成逐调用 `cwd` 改造，不能直接解除串行锁。
7. Channel 是系统最外层业务实体，不再归属 Project；Channel 与 Topic 之间只保留组织关系，不共享运行工作空间。

Topic 默认工作目录定稿为：

```text
~/.shadow-crew/channels/<channelId>/topics/<topicId>/
```

该路径是 Topic 的默认 `cwd`；不得继续使用 `channels/<channelId>/artifacts/<topicId>` 作为 Topic 目录。

核心不变量：

```text
一个 Channel / Topic / DM Topic
  = 一个不可变 Workspace Binding
  = 一个确定的 cwd
  = 一个确定的 artifactRoot

DM 主会话
  = ~/.shadow-crew/agents/<agentId>/
  = ~/.shadow-crew/agents/<agentId>/artifacts/
  = 不创建可变 Workspace Binding
```

---

## 2. 背景与约束

### 2.1 当前实现

当前系统已经具备：

- 前端 Session Key 区分 Channel、Topic、DM、讨论模式和 Agent。
- Channel、Channel Topic、DM Topic 分别持久化 Workspace Binding。
- DM 主会话固定使用 `~/.shadow-crew/agents/<agentId>/`，DM Topic 使用独立 Binding。
- 同一 Agent 使用独立 ACP 进程，不同 Agent 可以并行。
- 同一 Agent 的 Prompt 由 `prompt_lock` 串行下发。
- ACP Session 在 SQLite 中持久化 `workspace_cwd`，恢复时校验路径。
- 本地和远程 ACP Prompt 均显式传递 `workspaceBindingId`、`workspaceUri/cwd` 与 `scopeType`。
- Topic Binding 缺失时 Fail-Closed，不猜测或回退到 Channel cwd。

### 2.2 ACP 协议约束

ACP 的 `cwd` 属于 Session 生命周期属性：

- `session/new` 创建 Session 时绑定 `cwd`。
- `session/load` 加载 Session 时可携带 `cwd`。
- 没有标准化的 `session/set_cwd`。
- 同一 Session 不应在执行过程中切换 `cwd`。

因此，工作空间必须在实体创建时固化；需要更换工作目录时，只能新建 Channel 或 Topic，并创建新的 ACP Session。

### 2.3 CWD 隔离不等于安全沙箱

本方案解决的是“默认执行目录、会话身份和产物归属互相串扰”问题。

仅设置 `cwd` 不能阻止 Agent 主动执行：

```bash
cd ..
cat ../other-topic/secret.txt
```

若威胁模型包含不可信 Agent 或任意 Shell 代码，必须额外使用操作系统沙箱、容器或命令级文件系统权限控制。该能力不在本方案第一阶段范围内。

---

## 3. 设计目标与非目标

### 3.1 目标

- Topic 之间具有不同且稳定的默认 cwd。
- Channel 主消息流与 Topic 讨论流完全独立。
- Session 恢复必须校验实体、Agent、讨论模式和 Workspace Binding。
- Patch、产物、MCP 工具和文件浏览都使用所属实体的 Binding。
- 自定义 cwd 不可在创建后修改，不允许静默回退到默认路径。
- 旧 Topic 通过显式版本迁移保持原有执行行为。
- 当前串行 Agent 模式下不出现跨 Topic cwd 串扰。

### 3.2 非目标

- 本方案不实现 Channel/Topic 的 Git worktree 自动管理。
- 本方案不自动把历史产物从旧路径搬迁到新路径。
- 本方案不允许运行时切换 cwd。
- 本方案不把 cwd 当作恶意代码的完整安全边界。
- 本方案不改变 Topic 的业务层级和消息拓扑。

---

## 4. 核心领域模型

### 4.1 Workspace Binding

新增不可变实体 `WorkspaceBinding`：

```ts
type WorkspaceOwnerType = 'channel' | 'topic' | 'dm';

type WorkspaceBindingMode = 'default' | 'custom';

type WorkspaceBindingOrigin =
  | 'created_default'
  | 'created_custom'
  | 'channel_cwd_snapshot'
  | 'legacy_channel_cwd_snapshot';

interface WorkspaceBinding {
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  mode: WorkspaceBindingMode;
  origin: WorkspaceBindingOrigin;
  cwd: string;              // 规范化绝对路径
  artifactRoot: string;     // 规范化绝对产物目录
  createdAt: number;
}
```

约束：

- `ownerType + ownerId` 全局唯一。
- `cwd` 和 `artifactRoot` 存储规范化绝对路径，不存储 `~` 或相对路径。
- Binding 创建后没有更新接口。
- 不支持把 `cwd` 清空、重设或切换到默认值。
- Binding 被删除时，只解除与业务实体的关系；用户选择的外部目录不得删除。

### 4.2 实体关联

```ts
interface Channel {
  // 既有字段省略
  workspaceBindingId: string;
}

interface TopicMessageData {
  // 既有字段省略
  workspaceBindingId: string;
}
```

Topic 使用独立 Binding，不保存“继承 Channel”的动态引用。若用户在创建 Topic 时选择“复制频道当前 cwd”，迁移和运行时也只使用保存后的 Topic Binding 快照。

### 4.3 SQLite 持久化

新增规范化表：

```sql
CREATE TABLE IF NOT EXISTS workspace_bindings (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    origin TEXT NOT NULL,
    cwd TEXT NOT NULL,
    artifact_root TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(owner_type, owner_id)
);
```

`acp_sessions` 增加：

```sql
workspace_binding_id TEXT NOT NULL
```

Session 恢复条件必须同时满足：

```text
agentId
sender scope
discussionMode（Topic）
workspaceBindingId
workspace_cwd
system_prompt
```

任一字段不匹配时，旧 Session 不得恢复。

---

## 5. CWD 与产物路径

### 5.1 Channel 默认路径

```text
cwd          = ~/.shadow-crew/channels/<channelId>/
artifactRoot = ~/.shadow-crew/channels/<channelId>/artifacts/
```

### 5.2 Topic 默认路径

```text
cwd          = ~/.shadow-crew/channels/<channelId>/topics/<topicId>/
artifactRoot = ~/.shadow-crew/channels/<channelId>/topics/<topicId>/artifacts/
```

Topic 默认目录虽然在物理上位于 Channel 目录内部，但其执行作用域是 Topic 自己的 Binding。ACP Session 的 `cwd` 与 `ownerRoot` 必须设置为 Topic cwd，而不是 Channel cwd。

该路径为本方案的最终定稿：

```text
$HOME/.shadow-crew/channels/<channelId>/topics/<topicId>/
```

运行期可显示为 `~/.shadow-crew/channels/<channelId>/topics/<topicId>/`，但绑定和 Session 持久化必须保存展开后的规范化绝对路径。

### 5.3 DM 默认路径

DM 主会话：

```text
cwd          = ~/.shadow-crew/agents/<agentId>/
artifactRoot = ~/.shadow-crew/agents/<agentId>/artifacts/
```

DM Topic：

```text
cwd          = ~/.shadow-crew/agents/<agentId>/topics/<topicId>/
artifactRoot = ~/.shadow-crew/agents/<agentId>/topics/<topicId>/artifacts/
```

DM 主会话与每个 DM Topic 必须创建不同 ACP Session。

### 5.4 自定义 cwd

创建时允许用户选择已经存在且具备读写权限的目录。

推荐默认产物目录：

```text
<customCwd>/.shadow-crew/channels/<channelId>/artifacts/
<customCwd>/.shadow-crew/channels/<channelId>/topics/<topicId>/artifacts/
```

创建时必须完成：

1. 展开 `~`。
2. `canonicalize` 为绝对路径。
3. 验证目录存在、可访问、可写。
4. 拒绝 `/`、用户主目录根、Shadow Crew 全局根等过宽目录。
5. 检查与现有 Binding 是否共享同一 cwd，并提示潜在文件冲突。
6. 用户确认后，原子创建 Binding 与业务实体。

创建失败时不得自动降级到默认目录。

---

## 6. 创建流程

### 6.1 创建 Channel

可选模式：

```text
Channel 默认目录
选择自定义目录
```

事务步骤：

1. 校验 Channel 元数据。
2. 解析并校验 cwd。
3. 创建 `WorkspaceBinding`。
4. 创建 Channel 并写入 `workspaceBindingId`。
5. 创建默认主消息 Thread。
6. 提交事务。

### 6.2 创建 Topic

可选模式：

```text
Topic 默认目录
复制 Channel 当前 cwd（保存为 Topic 快照）
选择自定义目录
```

无论选择哪种模式，Topic Binding 都必须独立存在。

事务步骤：

1. 读取并校验 Channel。
2. 解析 Topic cwd。
3. 创建 Topic Binding。
4. 创建 Topic 消息并保存 `workspaceBindingId`。
5. 提交事务。

### 6.3 创建后不可修改

前端只展示只读路径和复制按钮，不提供编辑入口。

后端任何 Workspace Binding 更新请求都直接拒绝。需要更换目录时：

```text
新建 Channel / Topic
  → 创建新 Binding
  → 创建新 ACP Session
```

---

## 7. Session 身份与解析规则

### 7.1 Session Key

统一定义：

```text
channel:{channelId}:{roomId}:ws-{workspaceBindingId}:{agentId}
topic:{channelId}:{topicId}:{discussionMode}:ws-{workspaceBindingId}:{agentId}
dm:{agentId}:{dmThreadId}
dmtopic:{agentId}:{topicId}:{discussionMode}:ws-{workspaceBindingId}
```

Host 内部已经按 Agent 隔离 `RunningAgent`；上述前两类 Key 中的末尾 `agentId` 是前端水位线与执行状态复合键，Host 统一 Key 可省略该后缀。DM Topic Key 自身包含 Agent ID，用于跨 Agent 清理与解析。

### 7.2 Session Workspace Scope

Host 统一解析以下结构：

```ts
interface SessionWorkspaceScope {
  scopeType: 'channel' | 'topic' | 'dm' | 'dm_topic';
  channelId?: string;
  ownerId: string;
  agentId: string;
  workspaceBindingId: string;
  discussionMode?: 'standard' | 'game_theoretic';
  cwd: string;
  ownerRoot: string;
  artifactRoot: string;
}
```

解析规则：

```text
Channel Session → Channel Binding
Topic Session   → Topic Binding
DM Session      → ~/.shadow-crew/agents/<agentId>/
DM Topic Session → Topic Binding
```

禁止规则：

```ts
const cwd =
  topic.workspaceBinding.cwd ||
  channel.workspaceBinding.cwd ||
  DEFAULT_ROOT;
```

Binding 缺失、损坏或路径不可用时必须 Fail-Closed。

### 7.3 Session 生命周期

- Channel / Topic / DM / DM Topic 的作用域必须由显式 `scopeType` 传递，禁止根据 ID 前缀猜测。
- Topic 创建后首次调用 Agent 时创建 ACP Session。
- Session 创建后，`workspaceBindingId + cwd` 永久稳定。
- Session 恢复只允许在同一 Binding 中进行。
- 删除 Topic 时关闭该 Topic 下所有 Agent Session，不影响同 Channel 的其他 Topic。
- Agent 重启后，根据 Binding 和 Session Key 恢复到相同 cwd。
- Binding 路径不可用时拒绝执行，并提示恢复目录或新建 Topic。

---

## 8. Host 执行链路

### 8.1 ensure session

`ensure_session_locked` 必须接收 `SessionWorkspaceScope`，禁止在函数内部调用 Channel 目录推导 Topic cwd。

处理顺序：

1. 校验 Binding 与实体归属。
2. 校验 Binding 不可变。
3. 规范化并复验 cwd。
4. 构造包含 `workspaceBindingId` 的 Session Key。
5. 查找内存 Session Registry。
6. 查找 SQLite `acp_sessions`。
7. 校验 Agent、Scope、Mode、Binding 和 cwd。
8. 匹配时执行 `session/resume` 或 `session/load`。
9. 不匹配时关闭旧 Session，并执行 `session/new`。

### 8.2 send prompt

Prompt 派发必须携带完整 Scope：

```json
{
  "sessionId": "...",
  "sessionKey": "topic:channel-1:topic-1:standard:agent-1:binding-1",
  "workspaceBindingId": "binding-1",
  "cwd": "/canonical/topic/cwd",
  "channelId": "channel-1",
  "topicId": "topic-1"
}
```

非标准 ACP Agent 可以忽略扩展字段，但 Host 必须继续以自身 Scope 为真值来源。

### 8.3 当前并发策略

第一阶段保持：

```text
同一 Agent：全部 Session 的 Prompt 串行
不同 Agent：可以并行
```

串行化只保证当前 ACP Promise 与 stdio 交互顺序稳定，不能被误认为同一 Agent 已具备并行 Prompt 能力。

---

## 9. ACP Endpoint 与 Session 运行时

### 9.1 Session State

Shadow Crew 持久化的 ACP Session State 至少保存：

```text
session_id
session_key
workspace_binding_id
workspace_dir
owner_dir / owner_root
artifact_root
mcp_pool_key
```

### 9.2 Topic ownerRoot

ACP `session/new`、`session/load`、`session/resume` 与 Prompt 元数据中的 `ownerRoot/cwd` 必须等于 Topic cwd。

以下行为禁止：

- Topic Session 复用 Channel cwd 作为 ownerRoot。
- Topic A 将 Channel 根目录作为可遍历边界。
- 路径校验只检查“是否位于 Channel 下”。

### 9.3 文件与工具调用

Agent 端点的文件与工具执行由 ACP 端点负责，Shadow Crew 不实现内置工具循环，但必须传递显式 Workspace Context：

要求：

- `session/new` 明确传 `cwd`、`workspaceRoot`、`workspaceBindingId`、`artifactRoot`。
- `session/prompt` 重放相同 Workspace Context，并传 `scopeType`。
- 远程 ACP 传 `workspaceBindingId`、`workspaceUri`、`scopeType`。
- Agent 端点若返回 Diff 或 Artifact，Host 只允许归档到当前 Binding 的 artifactRoot。
- Shadow Crew 不尝试在 Session 建立后修改 ACP 端点的真实进程 cwd。

### 9.4 并发扩展方案

若未来要求同一 Agent 并行处理多个 Topic，按优先级选择：

1. **首选**：确认目标 ACP 端点支持并发 Session 与逐 Session cwd。
2. **兼容回退**：ACP 进程池按 `agentId + workspaceBindingId` 分片。
3. **禁止**：多个 Session 共享一个进程级 cwd 并并发执行。

---

## 10. MCP 隔离

MCP Pool Key 改为：

```text
mcp:{agentId}:{channelId}:{workspaceBindingId}
```

MCP 子进程启动时必须接收：

```text
SHADOW_CREW_CHANNEL_ID
SHADOW_CREW_TOPIC_ID（Topic 场景）
SHADOW_CREW_WORKSPACE_BINDING_ID
SHADOW_CREW_WORKSPACE_CWD
SHADOW_CREW_ARTIFACT_ROOT
```

所有 MCP 工具不得再只根据 `channelId` 推导产物目录。

建议将现有的 `write_channel_artifact` 泛化为：

```text
write_workspace_artifact
```

输入至少包含：

```text
workspaceBindingId
relativePath
content
```

Host/MCP 根据 Binding 解析实际保存路径，并校验目标位于 `artifactRoot` 内。

---

## 11. Patch 与产物归档

`apply_workspace_patch` 的输入改为：

```ts
interface ApplyWorkspacePatchOptions {
  workspaceBindingId: string;
  channelId: string;
  topicId?: string;
  patches: WorkspacePatchItem[];
}
```

Host 根据 `workspaceBindingId` 解析：

```text
applyRoot    = binding.cwd
artifactRoot = binding.artifactRoot
```

规则：

- 代码 Patch 应用到 Binding cwd。
- Patch 快照、重构文件和执行记录写入 Binding artifactRoot。
- 归档目录不得再通过 `~/.shadow-crew/channels/<channelId>/artifacts/<topicId>` 硬编码。
- 合入记录同时保存 `workspaceBindingId`、相对路径和内容摘要。
- 产物链接使用稳定的 `artifactId + bindingId + relativePath`，不把绝对路径作为唯一身份。
- 多个 Topic 共享同一 cwd 时，Patch 合入前仍需执行跨 Topic 文件冲突检测。

---

## 12. 远程 ACP

远程 Agent 不共享本地文件系统，因此不能把本地 cwd 当作远端目录。

远程 Workspace 描述应使用逻辑标识：

```ts
interface RemoteWorkspaceDescriptor {
  workspaceBindingId: string;
  workspaceUri: string;
  displayName: string;
}
```

要求：

1. 远程 `session/new` 或握手阶段必须声明远程 Workspace。
2. 后续 `session/prompt` 必须携带相同 `workspaceBindingId`。
3. 不支持 Workspace 声明的远程 ACP 只能标记为“非隔离执行”。
4. 不得把本地 `/Users/...` 路径直接作为远程 Agent 的可靠工作目录。

---

## 13. 安全与失败策略

### 13.1 创建阶段

- cwd 必须存在且可写。
- 规范化后拒绝根目录和过宽系统目录。
- 拒绝包含路径穿越的输入。
- 根目录被 symlink 替换时拒绝创建。
- 外部目录选择必须由用户显式确认。

### 13.2 执行阶段

- 每次创建 Session 时复验 cwd。
- 每次工具调用前校验路径仍位于 ownerRoot。
- 目录被删除、替换为 symlink 或失去权限时立即 Fail-Closed。
- 不得回退到 Channel cwd、Topic 默认目录或全局 Shadow Crew 根目录。

### 13.3 删除阶段

- 删除 Channel/Topic 时关闭相关 Session。
- 删除系统默认目录可由受控清理流程处理。
- 删除自定义 cwd 必须由用户单独确认，默认只解除绑定。
- 取消选择“清理工作空间”时绝不删除外部目录。

---

## 14. 旧数据迁移

迁移标识：

```text
workspace-binding-v1
```

迁移步骤：

1. 备份 SQLite 数据库。
2. 为现有 Channel 创建 Binding：
   - 有有效 `mountedWorkspace.rootPath` 时保存为自定义 Binding。
   - 无有效路径时使用 Channel 默认目录。
3. 为现有 Topic 创建 `legacy_channel_cwd_snapshot` Binding：
   - `cwd` 等于迁移时所属 Channel 的实际 cwd。
   - 保持旧 Topic 当前执行行为不变。
4. 新创建 Topic 才使用 `~/.shadow-crew/channels/<channelId>/topics/<topicId>/` 默认目录。
5. 更新 Session Key，使其包含 `workspaceBindingId`。
6. 关闭旧 Session，并删除对应旧 `acp_sessions` 记录。
7. 将迁移版本写入 `workspace_state`。

迁移要求：

- 一次性执行，幂等。
- 迁移逻辑集中在数据加载/版本迁移入口。
- 禁止在业务代码中散落 `topic.cwd || channel.cwd`。
- 迁移失败时整体回滚，不留下半迁移数据。
- 调试期脏数据按数据治理规则直接清理，不做猜测性兼容。

---

## 15. UX 约束

### 15.1 创建界面

Channel 创建：

```text
工作目录
  ○ 使用 Channel 默认目录
  ○ 选择自定义目录
```

Topic 创建：

```text
工作目录
  ○ 使用 Topic 默认目录
  ○ 复制频道当前目录
  ○ 选择自定义目录
```

两种界面都必须显示解析后的绝对路径和产物目录。

### 15.2 创建后

- 路径只读，显示锁图标。
- 提供“打开工作目录”和“复制路径”。
- 不提供“更改工作目录”。
- 路径失效时显示阻断性错误，不展示已有 Session 为可用状态。
- 需要更换目录时，引导新建 Topic，并提示旧 Topic 不可迁移 Session。

---

## 16. 实施阶段

### Phase 1：数据与迁移

- 新增 `WorkspaceBinding` 类型。
- 新增 `workspace_bindings` 表。
- Channel、Topic 写入 `workspaceBindingId`。
- `acp_sessions` 增加 Binding 字段。
- 实现 `workspace-binding-v1` 迁移。

### Phase 2：Host 与 Session

- 实现统一 `resolveSessionWorkspaceScope`。
- Channel/Topic/DM 分流解析。
- Session Key 增加 Binding。
- Session 恢复校验 Binding 与 cwd。
- 清理屏障按 Binding 和 Topic 精确作用。

### Phase 3：ACP Endpoint 与 MCP

- Topic ownerRoot 切换为 Topic cwd。
- ACP Session 显式传递 Workspace Context。
- MCP Pool Key 加入 Binding。
- 产物工具由 Channel 维度切换到 Binding 维度。

### Phase 4：Patch 与 UI

- Patch 合入和归档使用 Binding。
- Channel/Topic 创建界面支持默认与自定义 cwd。
- 创建后路径锁定。
- 错误状态、打开目录和冲突提示接入。

### Phase 5：并发与远程 ACP

- 完成逐调用 cwd 后，评估解除同一 Agent 串行锁。
- 对不支持 Session cwd 的外部 Agent 提供按 Binding 分片的进程池。
- 远程 ACP 接入 Workspace Descriptor。

---

## 17. 验收标准

### 17.1 数据与迁移

- [ ] 每个 Channel 恰好有一个 Binding。
- [ ] 每个 Topic 恰好有一个 Binding。
- [ ] Topic 创建后不能修改或清空 cwd。
- [ ] 旧 Topic 迁移后仍使用迁移前的 Channel cwd。
- [ ] 新 Topic 使用 `~/.shadow-crew/channels/<channelId>/topics/<topicId>/` 默认 cwd。
- [ ] 迁移重复执行不会产生重复 Binding。

### 17.2 Session 隔离

- [ ] 同一 Agent 在同一 Channel 的两个 Topic 中生成不同 Session ID。
- [ ] 两个 Session 的 `workspaceBindingId` 和 `workspace_cwd` 均不同。
- [ ] 清理 Topic A Session 不影响 Topic B。
- [ ] 重启后两个 Topic 分别恢复到各自 cwd。
- [ ] Session Key、SQLite、MCP Pool 和清理屏障使用同一 Binding 标识。

### 17.3 执行隔离

- [ ] Topic A 执行 `pwd` 返回 Topic A cwd。
- [ ] Topic B 执行 `pwd` 返回 Topic B cwd。
- [ ] Topic A 的文件写入不出现在 Topic B 目录。
- [ ] Topic A 的 Patch 和产物写入 Binding artifactRoot。
- [ ] Topic A 通过 `../topic-B` 访问相邻 Topic 时被路径策略拒绝。
- [ ] cwd 被删除、移动或替换为 symlink 后，执行立即失败。
- [ ] 路径失败时不会回退到 Channel cwd。

### 17.4 并发

- [ ] 当前串行模式下，连续切换 Topic Prompt 不会串 cwd。
- [ ] 不同 Agent 并行执行不同 Topic 时互不影响。
- [ ] 若解除同一 Agent 串行锁，必须新增并发 `pwd`、文件写入和 Session 恢复测试。
- [ ] 不支持 Session 级 cwd 的外部 Agent 必须使用进程池回退或被明确标记为非隔离。

### 17.5 MCP 与产物

- [ ] 不同 Topic 不会复用同一个 MCP 工作空间上下文。
- [ ] MCP 产物只能写入所属 Binding artifactRoot。
- [ ] Patch 合入路径与展示路径一致。
- [ ] 打开产物目录时定位到 Topic Binding 对应目录。

---

## 18. 当前代码改造落点

| 改造点 | 当前文件 |
| :--- | :--- |
| Channel/Topic 类型与 Binding 字段 | `src/types.ts` |
| Channel/Topic 创建与界面 | `src/App.tsx`、`src/components/EditTopicModal.tsx` |
| Session Key 与前端屏障 | `src/services/acpClient.ts`、`src/services/agentCollaboration.ts` |
| Host Session 创建、恢复与 Prompt | `src-tauri/src/acp_manager.rs` |
| Binding、Session 持久化 | `src-tauri/src/db_manager.rs` |
| Patch 合入与归档 | `src-tauri/src/main.rs`、`src/services/acpClient.ts` |
| ACP 端点 Session 与 cwd | `src-tauri/src/acp_manager.rs`、外部 ACP 实现 |
| MCP 产物工具 | `crates/shadow-crew-dev-mcp/src/tools/fs.rs` |
| 远程 ACP Workspace 声明 | `src/services/acpClient.ts`、远程 Bridge |

---

## 19. 最终结论

Topic 级 cwd 隔离的正确边界不是“在 Prompt 临时传一个目录”，而是：

```text
Topic 是独立执行作用域
Workspace Binding 是唯一工作空间真值
ACP Session 在单个 Binding 内长期存在
cwd 在 Topic 创建时固化
所有执行与产物链路只消费 Binding
```

这样可以从根本上避免同 Channel 下多个 Topic 共用 cwd、Session 恢复串目录、MCP 池污染和产物归属错误，同时保持与 ACP Session 生命周期一致。
