# Topic 级 CWD 隔离实施与测试报告

> **报告日期**：2026-10-29  
> **实施状态**：已完成，自动化与运行期自检通过  
> **关联方案**：[`TECH_SPEC_TOPIC_CWD_ISOLATION.md`](./TECH_SPEC_TOPIC_CWD_ISOLATION.md)  
> **基线提交**：`2b9d3b6`（本次实施变更另行提交）

---

## 1. 实施摘要

本次已落地 Channel/Topic 独立 Workspace Binding 与 Topic 级 cwd 隔离：

1. Channel 创建时可选默认目录或已有自定义目录。
2. Topic 创建时可选：
   - Topic 默认目录；
   - 复制 Channel 当前 cwd 快照；
   - 已有自定义目录。
3. Workspace Binding 创建后不可修改或清空。
4. Topic 默认 cwd 固化在：

```text
~/.shadow-crew/channels/<channelId>/topics/<topicId>/
```

5. Topic 默认产物目录：

```text
~/.shadow-crew/channels/<channelId>/topics/<topicId>/artifacts/
```

6. 前端、Tauri Host 和 Native Agent 通过显式 `scopeType` 区分 Channel / Topic / DM，不再依赖 ID 前缀猜测。
7. Session Key、SQLite ACP Session、MCP Pool、Patch 合入与产物归档均包含 Workspace Binding 作用域。
8. 旧 Topic 通过一次性迁移绑定到“迁移时 Channel cwd 快照”，新 Topic 才使用独立默认目录。

---

## 2. 自动化验证结果

| 验证项 | 命令 | 结果 |
| :--- | :--- | :--- |
| TypeScript 类型检查 | `npm run lint` | ✅ 通过 |
| 前端生产构建 | `npm run build` | ✅ 通过；仅有原项目 chunk >500KB 警告 |
| Workspace Binding 专项 | `node --import tsx src/services/test-workspace-bindings.ts` | ✅ 通过 |
| Rust workspace 全量测试 | `cargo test --workspace` | ✅ 54 项通过 |
| 原生 Agent 协议集成 | `cargo test -p shadow-crew-agent --test native_resume_protocol` | ✅ 2/2 通过 |
| MCP 工具回归 | `cargo test -p shadow-crew-dev-mcp` | ✅ 9/9 通过 |
| CognoNexus 核心治理 | 8 个专项脚本 | ✅ 全部通过 |
| G-Frame 边界探测 | `test-gframe-edge-cases.ts` | ✅ DEFECT 0 / WARN 0 |

关键自动化断言：

- 同一 Channel 下两个 Topic 的 Workspace Binding ID 不同。
- 两个 Topic 的 cwd 不同。
- 两个 Topic 的 ACP Session ID 不同。
- Native Agent SQLite 分别持久化正确 Binding、cwd 和 artifactRoot。
- Channel Thread 在显式 `scopeType=channel` 下不会误判为 Topic。
- Workspace Binding 修改会被数据库层拒绝。
- 缺失 Binding 的 Topic Session 按 Fail-Closed 拒绝。
- 非法 cwd、根目录和用户主目录根被拒绝。
- 旧 Topic 迁移后保持原 Channel cwd。

---

## 3. 运行期自检结果

已在 `http://localhost:3034` 完成真实 UI 操作：

1. 创建默认目录 Channel `Runtime CWD Check`。
2. 创建 Topic `Topic CWD Isolation Runtime`。
3. 确认界面显示：

```text
~/.shadow-crew/channels/channel-<id>/topics/topic-<id>
```

4. 在同一 Channel 创建 Topic `Second Topic Isolation`。
5. 确认两个 Topic 显示不同 topicId 路径。
6. 刷新页面后重新打开 Topic。
7. 确认路径保持稳定，并显示“只读绑定”。

运行期结论：

```text
Channel 创建：通过
Topic 默认目录选择：通过
Topic 间路径隔离：通过
刷新后 Binding 持久化：通过
只读路径展示：通过
```

---

## 4. 复测准备

### 4.1 启动应用

```bash
cd /Users/xunuosi/Code/Lx/AI/shadow-crew
npm run dev:desktop
```

### 4.2 建议测试目录

```bash
mkdir -p /tmp/shadow-crew-topic-test/repo-a
mkdir -p /tmp/shadow-crew-topic-test/repo-b
```

不要在 `/`、用户主目录根或 `~/.shadow-crew` 全局根上测试自定义 cwd。

### 4.3 数据库核验入口

```bash
sqlite3 ~/.shadow-crew/global_memory.sqlite
```

常用查询：

```sql
SELECT id, owner_type, owner_id, mode, origin, cwd, artifact_root
FROM workspace_bindings
ORDER BY created_at;

SELECT agent_id, session_key, workspace_binding_id, workspace_cwd
FROM acp_sessions
ORDER BY updated_at DESC;
```

Native Agent Session 缓存：

```text
~/.shadow-crew/cache/native-agent-sessions/<agentId>.sqlite
```

---

## 5. 人工复测用例

### TC-01 Channel 默认 Binding

**步骤**

1. 创建 Channel。
2. 工作目录选择“使用频道默认目录”。
3. 创建成功后查询 `workspace_bindings`。

**预期**

- `owner_type = channel`
- `owner_id = <channelId>`
- `cwd = <HOME>/.shadow-crew/channels/<channelId>`
- `artifact_root = <cwd>/artifacts`
- Channel JSON 包含 `workspaceBindingId`

---

### TC-02 Channel 自定义 cwd

**步骤**

1. 创建 Channel。
2. 工作目录选择“指定已有目录”。
3. 输入 `/tmp/shadow-crew-topic-test/repo-a`。
4. 创建成功后查询 Binding。

**预期**

- `cwd` 为规范化绝对路径。
- `mode = custom`。
- 后续 Channel Session 使用该 cwd。

---

### TC-03 非法自定义目录

**步骤**

1. 创建 Channel 或 Topic。
2. 输入不存在的目录。
3. 提交。

**预期**

- 创建失败并显示错误。
- 不自动降级到默认目录。
- 不产生半创建 Binding。

---

### TC-04 Topic 默认目录

**步骤**

1. 在 Channel 中创建 Topic。
2. 选择“议题默认目录”。
3. 打开 Topic 抽屉。

**预期**

- 显示：

```text
~/.shadow-crew/channels/<channelId>/topics/<topicId>
```

- 显示“只读绑定”。
- 编辑 Topic 时不能修改 cwd。

---

### TC-05 同 Channel 两个 Topic 隔离

**步骤**

1. 在同一个 Channel 创建 Topic A、Topic B。
2. 均选择 Topic 默认目录。
3. 分别打开两个 Topic。

**预期**

- Topic A 路径包含 `topics/<topicAId>`。
- Topic B 路径包含 `topics/<topicBId>`。
- 两个路径不相等。
- `workspace_bindings` 中存在两个不同 Topic 记录。

---

### TC-06 复制 Channel 目录快照

**步骤**

1. Channel 使用 `/tmp/shadow-crew-topic-test/repo-a`。
2. 创建 Topic 时选择“复制频道目录”。
3. 创建后检查 Binding。

**预期**

- Topic cwd 等于 Channel 创建时的 cwd。
- `origin = channel_cwd_snapshot`。
- Topic 与 Channel 仍使用不同 Binding ID。

---

### TC-07 Topic 自定义 cwd

**步骤**

1. 创建 Topic。
2. 选择“自定义目录”。
3. 输入 `/tmp/shadow-crew-topic-test/repo-b`。

**预期**

- Topic Binding cwd 为 `/tmp/shadow-crew-topic-test/repo-b`。
- artifactRoot 位于：

```text
/tmp/shadow-crew-topic-test/repo-b/.shadow-crew/channels/<channelId>/topics/<topicId>/artifacts
```

---

### TC-08 Binding 不可修改

**步骤**

1. 查询并记录某 Topic Binding。
2. 尝试通过开发工具调用 `db_save_workspace_bindings` 修改同一 ID 的 cwd。

**预期**

- Tauri 返回错误：

```text
Workspace Binding <id> is immutable and cannot be updated
```

- 数据库原 cwd 不变。

---

### TC-09 ACP Session CWD 隔离

**步骤**

1. 启动同一 Agent。
2. 分别在 Topic A、Topic B 发送一次 Prompt。
3. 查询 `acp_sessions`。

**预期**

- 存在两个不同 `session_key`。
- 两个 `session_key` 分别包含各自 Binding ID。
- `workspace_binding_id` 不同。
- `workspace_cwd` 不同。

---

### TC-10 多 Agent 隔离

**步骤**

1. 将两个不同 Agent 加入同一 Channel。
2. 在 Topic A 中分别点名两个 Agent。

**预期**

- 每个 Agent 都拥有自己的 Session。
- 所有 Session 的 cwd 都是 Topic A 的同一 Binding cwd。
- 不出现回退到 Channel 默认目录。

---

### TC-11 重启恢复

**步骤**

1. 在 Topic A、Topic B 各完成至少一轮 Prompt。
2. 关闭桌面端。
3. 重新启动。
4. 分别继续两个 Topic。

**预期**

- 两个 Topic 恢复到各自 Session 或按平台补偿新建 Session。
- 恢复后的 cwd 仍分别为 Topic A、Topic B。
- 不发生 Session 互换。

---

### TC-12 清理隔离

**步骤**

1. 清空或停止 Topic A 的 ACP Session。
2. 查询 Topic B Session。

**预期**

- Topic A 的 Session 记录被清理。
- Topic B 的 Session 与 cwd 完全保留。

---

### TC-13 Patch 合入路径

**步骤**

1. 在 Topic A 生成并应用一个文件 Patch。
2. 检查 Topic A cwd、Topic B cwd 和归档目录。

**预期**

- 修改只出现在 Topic A Binding cwd。
- Patch 快照写入 Topic A artifactRoot。
- 不写入旧式 `channels/<channelId>/artifacts/<topicId>`。

---

### TC-14 MCP 产物路径

**步骤**

1. 在 Topic A 调用 `write_channel_artifact`。
2. 在 Topic B 调用同名工具。

**预期**

- Topic A 产物写入 Topic A artifactRoot。
- Topic B 产物写入 Topic B artifactRoot。
- 两个 MCP Pool Key 不同。

---

### TC-15 路径穿越

**步骤**

1. 在 Topic Session 中尝试读取：

```text
../<other-topic>/private.md
```

2. 尝试通过恶意 symlink 替换 Topic cwd。

**预期**

- 路径穿越被拒绝。
- symlink 替换触发 TOCTOU 校验失败。
- Session 不自动回退到 Channel cwd。

---

### TC-16 自定义目录失效

**步骤**

1. 为 Topic 绑定已存在的自定义目录。
2. 关闭应用。
3. 删除或重命名该目录。
4. 重新启动并发送 Prompt。

**预期**

- Session 创建失败。
- 明确提示 cwd 不存在。
- 不自动创建另一目录，不使用 Channel cwd 兜底。

---

### TC-17 Channel 删除

**步骤**

1. Channel 使用外部自定义目录。
2. 删除 Channel。

**预期**

- Channel/Topic Binding 记录被解除。
- ACP Session 被清理。
- 外部自定义目录本身不被删除。

---

### TC-18 远程 ACP

**步骤**

1. 将远程 ACP Agent 加入 Topic。
2. 检查发出的 `session/prompt` 扩展字段。

**预期**

- 包含 `workspaceBindingId`、`workspaceUri` 和 `scopeType`。
- 远端实现应据此使用自己的 Workspace 映射。
- 若远端不声明 Workspace 能力，不得宣称 cwd 隔离已生效。

---

## 6. 已知边界

1. cwd 隔离不是操作系统安全沙箱。能执行任意 Shell 的 Agent 仍可能主动访问父目录。
2. 远程 ACP 的 cwd 隔离取决于远端 Bridge/Agent 是否尊重 Workspace 描述。
3. 旧 Topic 按迁移策略保留 Channel cwd 快照，因此旧 Topic 之间可能继续共享原 cwd。
4. 自定义目录不会随 Channel/Topic 删除而删除。
5. 当前同一 Agent 的 Prompt 仍串行执行；未来并行化前必须完成逐调用 cwd 改造。

---

## 7. 最终结论

本次实现的自动化、协议集成、构建与运行期 UI 检查均通过。Topic 默认目录、Channel/Topic Binding 区分、Session Key、Native Agent cwd、MCP 和 Patch 链路已贯通，可按第 5 节用例进行人工复测。
