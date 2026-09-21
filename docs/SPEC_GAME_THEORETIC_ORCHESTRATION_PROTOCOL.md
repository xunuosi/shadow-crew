# 🥷 Shinobi 确定性两阶段博弈编排协议规范 (SPEC)
## —— 基于有限状态机 (FSM) 与靶点载荷注入的多 Agent 博弈执行协议

> **版本**：v1.0.0  
> **关联文档**：
> - [`PRD_MULTI_AGENT_DECISION_ACCURACY_GOVERNANCE.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/PRD_MULTI_AGENT_DECISION_ACCURACY_GOVERNANCE.md)  
> - [`DECISION_SHINOBI_EVOLUTION_FINAL.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/DECISION_SHINOBI_EVOLUTION_FINAL.md)  

---

## 1. 架构目标与设计原则

1. **确定性状态推进**：废除依赖自然语言正文中 `@xxx` 正则字符串匹配的脆弱级联方式，升级为平台协调器（Shinobi Orchestrator）基于有限状态机（FSM）显式驱动。
2. **两阶段有序编排**：严禁开题时全员盲目并发；必须等待主导者完成方案输出，才能将方案正文作为明确的攻击靶点（Attack Target）递交挑战者。
3. **真实性契约与守卫**：底层通信的空产出、占位符或超时告警绝不得冒充正式 Agent 发言，缺席与失败必须被状态机准确捕捉。
4. **制衡方缺席门禁 (Quorum Gate)**：挑战者未有效质询前，议题默认不可裁决；支持人类仲裁官具名豁免。

---

## 2. 有限状态机 (FSM) 状态定义与迁移表

### 2.1 阶段状态枚举 (`GameTheoreticStage`)

```typescript
export type GameTheoreticStage = 
  | 'proposal'     // 阶段 1: 主导者立论起草方案
  | 'challenge'    // 阶段 2: 挑战者针对靶点反例质询
  | 'defense'      // 阶段 3: (可选) 主导者针对反例补丁抗辩
  | 'arbitration'  // 阶段 4: 仲裁者综合权衡 / 人类法槌定案
  | 'concluded';   // 终态: 已裁决归档 (Resolved)
```

### 2.2 状态迁移流转

```text
[用户发起博弈议题 / 发送开题诉求]
              │
              ▼
    [Stage: PROPOSAL]
    (仅调度 Proposers 发言)
              │
              ├── (Proposer 产出有效方案落库)
              │
              ▼
    [Stage: CHALLENGE]
    (自动唤醒 Challengers，挂载 Proposer 方案为【待攻击靶点】)
              │
              ├── (Challenger 产出有效反例质询落库)
              │
              ▼
    [Stage: ARBITRATION]
    (自动汇总主导方案与挑战反例，挂载至 Arbiters 上下文)
              │
              ├── 🤖 AI 仲裁员起草《决策权衡矩阵》草案
              └── 👤 人类首席仲裁官点击【仲裁法槌】敲锤定案
              │
              ▼
    [Stage: CONCLUDED]
    (生成 RulingRecord，议题状态变为 Resolved)
```

---

## 3. 靶点载荷注入规范 (Payload Mounting)

在博弈模式下，各阶段下发的上下文必须具备结构化靶点支持：

### 3.1 阶段 1: 主导立论 (`proposal`)
* **Prompt 指令**：
  - 角色定位为 `🏛️ 主导者 (Proposer)`；
  - 任务：针对议题目标设计全局首选架构方案，指明核心组件、关键选型与设计假设，预备迎接挑战者的极限压测。

### 3.2 阶段 2: 反例质询 (`challenge`)
* **Prompt 结构化载荷**：
  ```markdown
  [⚔️ 博弈对抗阶段 2：方案反例压测与反向质询]
  【被质询主导方案 (攻击标的)】:
  <<<PROPOSER_SOLUTION_START>>>
  ${targetProposalText}
  <<<PROPOSER_SOLUTION_END>>>

  【挑战者作战要求】:
  你是本议题的批判性挑战者 (Challenger)。请针对上方主导方案执行严格压测，严禁盲目附和！
  必须遵循四段论输出结构：
  1. 明确指向主导方案中的具体论点、状态流转或代码片段；
  2. 失效场景构造：提供具体输入数据、并发竞争、网络抖动或高负载极限工况；
  3. 推演连锁反应：分析在此极端场景下系统为何崩溃、数据如何失真；
  4. 提出防御检验要求：要求主导者提供补丁防御设计或实证说明。
  ```

### 3.3 阶段 3 / 4: 仲裁定案 (`arbitration`)
* **Prompt 结构化载荷**：
  ```markdown
  [⚖️ 博弈仲裁阶段：方案评估与决策权衡]
  【主导方首选方案】:
  ${targetProposalText}

  【挑战方反例质询】:
  ${targetChallengeText}

  【仲裁任务】:
  你是客观中立的仲裁官 (Arbiter)。
  1. 梳理主导方案与挑战反例之间的实质分歧；
  2. 依据可行性、健壮性与 ROI 进行综合评判；
  3. 输出客观的《架构决策权衡矩阵 (Trade-off Matrix)》并给出建议裁决方案。
  ```

---

## 4. 制衡方缺席门禁 (Quorum Gate) 规则

1. **不可跳步原则**：若阶段 1 完成后，挑战者因网络掉线或超时（`idle timeout`）未产出实质反例：
   - 系统将议题标记为 `isChallengerResponded = false`；
   - 界面状态条提示：`⚠️ 制衡方未响应，暂不可直接定案`；
   - 禁用普通的“快速敲锤”按钮；
2. **人类仲裁者具名豁免**：
   - 只有持有终审法槌的人类仲裁官，可以在法槌控制台中勾选 `[✓] 具名豁免制衡方缺席并强制定案`；
   - 豁免理由将作为 `rulingRecord.exemptionReason` 永久落库并展示在频道时间线。
