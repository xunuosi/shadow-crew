---
name: gframe-modular-executor
description: G-Frame 模块化执行与爆炸半径隔离契约规范。引导模块执行 Agent 在白名单受限工作区内串行产出 Diff，调用 validate_workspace_diff 预检防冲突，调用 submit_execution_deliverable 提交交付物。
---

# G-Frame Modular Executor & Blast Radius Isolation (G-Frame 模块化执行与爆炸半径隔离)

本技能定义了 G-Frame 拓扑分治架构下的独立 Agent 串行落地执行规约（理论支撑：G-Frame Bayesian & Team-Theoretic Modularization）。

## 核心实施原则

1. **爆炸半径物理冻结**：每个模块执行轮次均拥有严格的变更文件白名单（`Allowed Files Sandbox`）。严禁越界修改或新建白名单以外的文件！
2. **公共接口契约只读不可变**：涉及跨模块通信、共享数据结构或公共 API 时，必须严格遵守阶段 0 确定的《公共接口契约》，严禁私自变更函数签名或数据格式。
3. **预检自测与提交闭环**：通过 `validate_workspace_diff` 进行 Diff 格式与无冲突预检，通过 `submit_execution_deliverable` 提交结构化交付物。

## MCP 工具契约

### 1. 预检自测工具：`validate_workspace_diff`

在输出正式交付物前，执行 Agent 可调用 `validate_workspace_diff` 检验补丁清洁度：

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `patch` | `string` | 完整的 Unified Diff 文本 |
| `allowed_files` | `string[]?` | (可选) 本模块授权的文件白名单 |

- **校验产出**：检查是否存在越界修改未授权文件、文件路径是否存在、修改行数统计以及补丁是否能干净打上（Clean application vs Conflict）。

### 2. 交付物提交工具：`submit_execution_deliverable`

执行完毕后，执行 Agent 调用 `submit_execution_deliverable` 提交本阶段交付物元数据：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `section_title` | `string` | 本模块交付物标题（如 `阶段 1/3: 核心数据模型落地交付`） |
| `pod_title` | `string` | 界面展示胶囊标签（如 `🛠️ 数据模型`） |
| `status_summary` | `string` | 40 字以内的高密成果摘要 |
| `deliverable_kind` | `string` | 交付物类别：`workspace_files` \| `report` \| `configuration` |
| `review_action_label` | `string` | 审查按钮文案（如 `审查本阶段 Diff`） |
| `apply_action_label` | `string` | 合入按钮文案（如 `合入本阶段代码`） |

### 容灾格式（仅限无工具环境）

```markdown
<<<EXECUTION_META>>>
{
  "sectionTitle": "阶段 1/3: 核心数据模型落地交付",
  "podTitle": "🛠️ 数据模型",
  "statusSummary": "已完成时钟同步逻辑与重试退避单元测试",
  "deliverableKind": "workspace_files",
  "reviewActionLabel": "审查本阶段 Diff",
  "applyActionLabel": "合入本阶段代码"
}
<<<EXECUTION_META_END>>>
```
