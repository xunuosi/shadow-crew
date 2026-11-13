# SPEC: 工作流协同模式（咨询 / 评审 / 交付）

## 1. 背景与问题

现有两种模式无法覆盖日常研发场景：

- **标准协作模式**：多 Agent 自由发言，无角色约束与汇总结论，适合头脑风暴，不适合需要确定产出的任务。
- **博弈决策模式（4+1）**：为高保真架构决策设计，5 阶段严格串行 + G-Frame 模块冻结 + 无异议征询，链路长、成本高，用于代码梳理/文档/评审属于过度编排。

因此新增第三种顶层模式 `discussionMode === 'workflow'`，内部提供三条固定流水线，覆盖绝大多数日常研发场景。

## 2. 三种工作流

| 子模式 | 适用场景 | 阶段 |
| :--- | :--- | :--- |
| `consult` 咨询产出 | 代码梳理与讲解、技术文档、变更影响半径、选型对比、POC 预研、源码导读 | 主笔产出 → 独立核验（可选） → 合并定稿 |
| `review` 评审审查 | 方案评审、Code Review、安全/规范自查、SQL/配置/CI 审查、需求歧义校验 | 并行独立评审 → 汇总裁定 |
| `build` 交付实施 | 功能开发、单测/脚本生成、迁移方案、容器编排、故障修复 | 方案设计 → 方案评审 → 实施落地 → 独立验收 → 失败返修 → 交付摘要 |

角色分离不变量：

1. **实现者 ≠ 验收者**：`build` 要求至少 2 名 Agent；2 人时评审与验收同人必须显式警告。
2. **并行评审互不可见**：`review_scan` 阶段所有评审者拿到相同的输入，彼此结论不互相注入。
3. **验收不依赖实现者自述**：`build_verify` 的 Prompt 只注入方案、验收标准与改动文件清单，不注入实现者的叙述性结论。
4. **结论必须有证据**：无证据的评审发现强制降级为 `minor`；验收必须提供至少一条真实检查项，否则 fail-closed。

## 3. 数据模型

代码位置：

- 类型：`src/types.ts`（`TopicWorkflowMode` / `WorkflowStageKey` / `TopicWorkflowState` / `WorkflowArtifact` / `WorkflowStageRecord`）
- 规格与角色分配：`src/services/workflow/workflowSpec.ts`
- 状态迁移：`src/services/workflow/workflowEngine.ts`
- 结构化门禁：`src/services/workflow/workflowGates.ts`
- Prompt 编译：`src/services/workflow/workflowPrompts.ts`
- 只读进度视图：`src/services/workflow/workflowProgress.ts`
- 运行期编排：`src/hooks/useTopicWorkflow.ts`

`TopicWorkflowState` 挂在 `TopicMessageData.workflowState` 上，包含：

- `mode` / `stageOrder` / `currentStageKey`
- `roles: { author, criticIds, verifierId }`
- `stages: WorkflowStageRecord[]`（`pending | active | done | failed | skipped`，含 `attempt` 与 `failureReason`）
- `artifacts`：**完整原文交接物**（`document | findings | plan | diff | verification | summary`）
- `counters`：`designRevisions`（方案返工）/ `fixRounds`（验收返修）
- `status` / `verdict` / `blockingReason` / `runToken`

## 4. 交接物与上下文

- 下游阶段通过 `StageSpec.inputStageKeys` 声明依赖，注入的是**完整原文**（单条 16k 字符、总计 48k 字符上限，超出时头 70% + 尾 30% 截断并标注）。
- 与博弈模式 `dehydrateTargetTextForHandover`（1500 字脱水）不同：工作流不允许把主笔产出压成摘要后再让下游重建上下文。
- 同一阶段重复执行（返工）时，下游只取每个 Agent 最近一次的交接物。

## 5. 门禁规则

### 5.1 评审报告

结构化块：

```text
<<<WORKFLOW_REVIEW_REPORT>>>
{"verdict":"approve|conditional|block","findings":[{"severity":"blocker|major|minor","title":"","evidence":"","suggestion":""}]}
<<<WORKFLOW_REVIEW_REPORT_END>>>
```

- 缺少块 / JSON 非法：该份报告无效。
- `review_scan`：全部无效 → `blocked`；部分无效 → 排除并记录说明。
- `build_design_review`：存在 `blocker` → 退回方案设计（最多 2 次），仍阻断则 `blocked`。

### 5.2 验收报告

```text
<<<WORKFLOW_VERIFY_REPORT>>>
{"verdict":"pass|fail","checks":[{"command":"","output":"","passed":true}],"failures":[{"severity":"blocker|major|minor","title":"","evidence":""}]}
<<<WORKFLOW_VERIFY_REPORT_END>>>
```

通过条件（全部满足）：块合法、`verdict === 'pass'`、`checks.length > 0`、所有 `checks.passed`、无 `failures`。
未通过 → 进入 `build_fix`；2 轮返修后仍失败 → `blocked`。

### 5.3 方案产物

方案必须包含【验收标准】（可执行命令/预期结果）。缺失时：

1. 首次缺失 → 退回主笔补充（`designRevisions + 1`，最多 1 次）。
2. 仍缺失 → 显式记录说明，验收阶段以议题目标为兜底标准继续，不允许静默跳过。

### 5.4 实施产物

`build_implement` 必须检测到真实文件改动或命令证据（文件路径 / 命令输出 / `workspaceDiffs`），否则显式失败，禁止把「口头实现」当成交付。

## 6. 运行期行为

- 阶段串行推进；`parallel` 阶段通过 `Promise.all` 并行派发，任一 Agent 失败以显式输出返回，不中断其他评审。
- 每次阶段迁移都会写入 `workflowState` 并向时间线追加系统通知（接力 / 返工 / 完成 / 阻断 / 失败），不存在静默停摆。
- 用户发送新消息或议题被编辑导致回合失效时，旧运行令牌失效，工作流标记为 `cancelled`。
- 用户单独终止某个执行者（`activeExecutionsRef` 中该执行项被移除）时：该阶段失败原因记为「用户已终止该 Agent 的阶段执行」，阶段置为 `failed`，整个工作流立即 `cancelled`，不会用残缺输出继续推进后续阶段。
- 阶段执行者离线、会话初始化失败、ACP 报错均产出显式失败原因。

## 7. 扩展方式

新增场景不写新状态机：

1. 在 `workflowSpec.ts` 增加阶段列表（`key` / `role` / `artifactKind` / `inputStageKeys` / `optional`）。
2. 在 `workflowEngine.ts` 增加对应阶段迁移规则（必须返回显式 `decision`）。
3. 在 `workflowPrompts.ts` 增加阶段指令与结构化输出契约。
4. 在 `test-workflow-engine.ts` 增加规范可追溯用例。

## 8. 验证基线

- `npm run lint`
- `npm run test:workflow`（已并入 `npm run test:cogno`）
- `npm run build`
