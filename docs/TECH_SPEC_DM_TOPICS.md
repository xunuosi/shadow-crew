# Shadow Crew 私聊 Topic 与双方博弈技术方案

> **版本**：v1.0.0
> **状态**：已实施
> **关联文档**：
> - [`TECH_SPEC_TOPIC_CWD_ISOLATION.md`](./TECH_SPEC_TOPIC_CWD_ISOLATION.md)
> - [`TECH_SPEC_ACP_ONLY_RUNTIME.md`](./TECH_SPEC_ACP_ONLY_RUNTIME.md)

---

## 1. 目标

私聊不再只有一个无限增长的会话入口。用户可以为私聊 Agent 创建：

1. 普通 Topic；
2. 双方博弈 Topic。

Topic 用于任务分叉、上下文隔离、独立 cwd 和长期历史治理，不替代 DM 主会话。

## 2. DM 数据模型

Topic 增加显式作用域：

```ts
type TopicScopeType = 'channel' | 'dm';

interface TopicMessageData {
  scopeType: TopicScopeType;
  channelId?: string;
  dmAgentId?: string;
  dmThreadId?: string;
  workspaceBindingId: string;
}
```

Channel Topic 保持不变；DM Topic 不伪造 Channel。

## 3. 默认 CWD

DM 主会话：

```text
~/.shadow-crew/agents/<agentId>/
```

DM Topic：

```text
~/.shadow-crew/agents/<agentId>/topics/<topicId>/
```

DM Topic 产物：

```text
~/.shadow-crew/agents/<agentId>/topics/<topicId>/artifacts/
```

支持：

- Topic 默认目录；
- 复制当前 Agent/DM cwd 快照；
- 自定义目录。

Binding 创建后不可修改。

## 4. Session 命名空间

新增：

```text
dmtopic:{agentId}:{topicId}:{discussionMode}:ws-{bindingId}
```

不得使用普通 `topic:{channelId}:...` 或 `dm:{agentId}:...` 代替。

Host 必须通过显式 `scopeType = dm_topic` 区分：

- 不按 Agent 私有目录自动推导 cwd；
- 必须读取 Topic Workspace Binding；
- 缺失 Binding 时 Fail-Closed。

## 5. 普通私聊 Topic

- 参与 Agent 固定为当前 DM Agent；
- 不加载 DM 主会话全部历史；
- 只使用 Topic Head、最近讨论和显式引用的产物；
- 使用独立 ACP Session。

## 6. 双方博弈 Topic

DM 博弈固定两个角色：

```ts
type DuelRolesConfig =
  | { proposer: 'human'; challenger: 'agent' }
  | { proposer: 'agent'; challenger: 'human' };
```

允许两种角色分配：

```text
人类提案 / Agent 对抗
Agent 提案 / 人类对抗
```

约束：

- 刚好两个角色；
- 提案方与对抗方不能是同一参与方；
- 不设置 Verifier；
- 不设置第四个 Agent 仲裁官；
- 人类接受或驳回结论属于决策控制，不是第三角色。
- 编辑 Topic 时仍只允许上述两种互斥组合，不能改为 4+1 多角色配置。

## 7. 双方博弈阶段

```text
proposal → challenge → defense → human_decision
```

实际执行采用两条分支：

- 人类提案：人类首条消息作为提案，Agent 以对抗方身份质询；
- Agent 提案：Agent 先立论，人类以对抗方身份提出质询，Agent 作为提案方回应。

所有 Agent 回复仍通过当前 DM Agent 的 ACP Session 执行。

## 8. UI

- DM Header 显示“新建议题”；
- DM Composer 显示“新建议题”入口；
- Topic 卡片允许在 DM 时间线中渲染；
- Topic 抽屉显示独立 CWD；
- DM 博弈显示两个角色卡，不显示 4+1 角色配置；
- DM 编辑弹窗只提供双方角色互换，不提供 Verifier 或 Agent 仲裁官；
- 双方博弈显示四阶段条：

```text
提案立论 → 对抗质询 → 提案方回应 → 人类决策
```

## 9. 历史治理

### 9.1 DM 主会话

- 保留滚动摘要；
- 热会话只发送增量；
- 长任务提升为 Topic；
- Topic 完成后只向 DM 返回摘要卡片和 Artifact 引用。

### 9.2 DM Topic

- 独立 ACP Session；
- 独立 cwd；
- 不以 DM 主会话全量历史作为 Prompt；
- 不压缩其他 Topic。

Topic 不等于历史压缩器。DM 主会话仍需由 ACP 或显式恢复策略管理自身上下文。

## 10. 清理与隔离

- 更新 DM Topic 成员/模式时，只清理 `dmtopic:<agentId>:<topicId>` 前缀。
- Topic A 的 Session 清理不影响 Topic B。
- Topic 产物只写入自身 Binding artifactRoot。
- 删除自定义 Binding 不删除用户目录。

## 11. 验收

- DM 可创建普通 Topic。
- DM 可创建双方博弈 Topic。
- 两种角色分配可选且互斥。
- DM Topic 默认路径正确。
- 两个 DM Topic Session Key 不同。
- DM 主 Session 和 DM Topic Session 不混用。
- Topic 卡片与抽屉正确显示两方角色。
- 刷新后 Topic、角色和 cwd 保持稳定。
