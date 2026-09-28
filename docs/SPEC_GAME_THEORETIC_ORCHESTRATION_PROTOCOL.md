# 🥷 Shinobi "4+1" 认知决策与确定性博弈编排协议规范 (SPEC)
## —— 基于有限状态机 (FSM)、客观物理接地验证、BWM 确定性优化与人机协同仲裁的工业级多 Agent 决策系统

> **版本**：v2.0.0 (CognoNexus 4+1 Cognitive Decision Standard)  
> **关联文档**：
> - [`PRD_MULTI_AGENT_DECISION_ACCURACY_GOVERNANCE.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/PRD_MULTI_AGENT_DECISION_ACCURACY_GOVERNANCE.md)  
> - [`DECISION_SHINOBI_EVOLUTION_FINAL.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/DECISION_SHINOBI_EVOLUTION_FINAL.md)  

---

## 1. 架构目标与 4+1 核心角色定义

基于群体动力学与学术调研，工业级高可靠商讨决策系统解耦为 **4 类功能特化智能体角色 + 1 类人类战略决策者**，从“无序聊天”跨越至“确定性计算”：

### 1.1 四类核心智能体 (4 Core Agents)
1. 🏛️ **提案智能体 (Proposer Agent)**：
   - **定位**：探索解空间的发散构想者。
   - **机制**：在独立沙箱中背靠背推演，输出规范化的类型化论点树、因果逻辑链条以及自我置信度评分；在后续阶段根据反例与接地证据产出防御修正补丁 (Defense v2)。
2. ⚔️ **红队对抗智能体 (Red Team / Adversarial Agent)**：
   - **定位**：佩戴“黑帽”的系统级“指定异议者”。
   - **机制**：强制运行反从众批判模式，对提案中的局部争议切片发起逻辑反驳，挖掘逻辑矛盾、隐含假设与边缘极端失效场景，遏制顺从与谄媚级联偏见。
3. 🔍 **接地验证智能体 (Grounding / Tool-Execution Agent)**：
   - **定位**：客观物理逻辑与工程事实的真实性守卫节点。
   - **机制**：**不参与主观辩论**，专职调用检索增强生成 (RAG)、代码沙箱解释器、数学运算基准等确定性工具，测试反事实情景，输出布尔真值与可复现执行证据。
4. ⚖️ **中立综合/流程协调智能体 (Synthesizer / Coordinator Agent)**：
   - **定位**：佩戴“蓝帽”的会议主席与信息流裁判。
   - **机制**：编排有限状态机时间线，提取 LMAD 争议切片与上下文脱水，运行基于运筹学最优最劣法 (BWM) 的确定性多属性决策求解器，编制伴生少数派异议报告与黑天鹅触发条件。

### 1.2 人类战略决策者 (1 Human Strategic Decision-Maker)
- 👤 **战略仲裁官与终审法槌持有者 (Human Arbiter with Gavel)**：
  - **定位**：基于混合主动性 (Mixed-Initiative) 的高阶治理者。
  - **机制**：持有单向终审定案权；介入中断死锁熔断；签署制衡方缺席具名豁免；敲响法槌定案并指派落地工程执行 Agent。

---

## 2. 有限状态机 (FSM) 状态定义与迁移表

### 2.1 阶段状态枚举 (`GameTheoreticStage`)

```typescript
export type GameTheoreticStage = 
  | 'proposal'     // 阶段 1: 提案立论探索解空间 (v1)
  | 'challenge'    // 阶段 2: 红队极端反例压测与反向质询
  | 'verification' // 阶段 3: 接地验证纯工具执行与真值检验 (可选/按需)
  | 'defense'      // 阶段 4: 提案方答辩、修正与防御补丁 (v2)
  | 'arbitration'  // 阶段 5: 综合协调起草权衡矩阵 / 人类法槌终局定案
  | 'concluded';   // 终态: 已裁决归档并支持指派工程落地执行 (Resolved)
```

### 2.2 状态迁移流转

```text
[用户发起 4+1 博弈决策议题 / 发送开题诉求]
              │
              ▼
     [Stage 1: PROPOSAL]
     (调度 Proposer 提案立论起草方案 Proposal v1)
              │
              ├── (Proposer 产出有效立论方案落库)
              │
              ▼
     [Stage 2: CHALLENGE]
     (自动唤醒 Red Team Challenger，挂载 Proposer 方案为【待攻击靶点】)
              │
              ├── (Challenger 产出有效反例压测落库)
              │
              ├───[有指派 Grounding Verifier?]───┐
              │                                 │ (Yes)
              │ (No)                            ▼
              │                     [Stage 3: VERIFICATION]
              │                     (调度 Verifier 纯工具执行，返回物理证据)
              │                                 │
              └──────────────┬──────────────────┘
                             ▼
                    [Stage 4: DEFENSE]
     (自动回传 Proposer，挂载【攻击靶点】、【挑战反例】与【接地证据】，输出 Patch v2)
                             │
                             ├── (Proposer 完成答辩并给出架构防御补丁)
                             │
                             ▼
                    [Stage 5: ARBITRATION]
     (自动汇总提案、反例、接地实测、答辩补丁，挂载至 Arbiters 上下文)
                             │
                             ├── 🤖 Synthesizer 起草《决策权衡矩阵》与 MCDA/BWM 评分
                             └── 👤 人类首席仲裁官点击【仲裁法槌】敲锤定案
                             │
                             ▼
                    [Stage 6: CONCLUDED]
     (生成 RulingRecord，议题状态变为 Resolved)
                             │
                             ├── (可选/即时) 委派执行 Agent 启动工程代码落地实施
                             ▼
                    [Post-Arbitration Execution]
     (ACP 协议调起指定 Agent，按裁决书实施代码变更并回传执行报告)
```

---

## 3. 靶点载荷注入规范 (Payload Mounting)

在 4+1 博弈模式下，各阶段下发的 Prompt 具备结构化靶点载荷：

### 3.1 阶段 1: 提案立论 (`proposal`)
* **Prompt 指令**：
  - 角色定位为 `🏛️ 提案智能体 (Proposer Agent)`；
  - 任务：探索解空间，设计首选架构方案，明确组件选型、契约接口与假设，预备迎接红队的极端压测。

### 3.2 阶段 2: 反例质询 (`challenge`)
* **Prompt 结构化载荷**：
  ```markdown
  [⚔️ 博弈对抗阶段 2：方案反例压测与反向质询]
  【被质询主导方案 (攻击标的)】:
  <<<PROPOSER_SOLUTION_START>>>
  ${targetProposalText}
  <<<PROPOSER_SOLUTION_END>>>

  【红队挑战作战要求】:
  你是本议题的红队对抗智能体 (Adversarial Agent)。佩戴黑帽，坚决执行反从众协议！
  必须遵循四段论输出结构：
  1. 明确指向主导方案中的具体论点、状态流转或代码片段；
  2. 失效场景构造：提供具体输入数据、并发竞争、网络抖动或高负载极限工况；
  3. 推演连锁反应：分析在此极端场景下系统为何崩溃、数据如何失真；
  4. 提出防御检验要求：要求主导者提供补丁防御设计或实证说明。
  ```

### 3.3 阶段 3: 接地验证 (`verification`)
* **Prompt 结构化载荷**：
  ```markdown
  [🔍 博弈验证阶段 3：客观事实与物理逻辑真实性校验 (Grounding Verification)]
  【主导方案要点】:
  <<<PROPOSER_SOLUTION_START>>>
  ${targetProposalText}
  <<<PROPOSER_SOLUTION_END>>>

  【红队挑战质询要点】:
  <<<CHALLENGER_CRITIQUE_START>>>
  ${targetChallengeText}
  <<<CHALLENGER_CRITIQUE_END>>>

  【接地验证核心任务】:
  你是客观物理逻辑与工程事实的接地验证智能体 (Grounding Verifier)。
  严禁参与主观辩论！只负责真实性与边界条件的工具执行验证：
  1. 识别核心争议切片中的可证伪断言；
  2. 调取代码解释器/沙箱测试、基准测试工具或 RAG 知识库检索；
  3. 返回反事实测试结果、布尔真值与可复现的执行日志证据；
  4. 判定红队反例在物理上是否真实成立。
  ```

### 3.4 阶段 4: 答辩修正与架构防御补丁 (`defense`)
* **Prompt 结构化载荷**：
  ```markdown
  [🛡️ 博弈答辩阶段 4：提案方针对红队反例与接地证据的抗辩与补丁 (Defense v2)]
  【你在此前提交的首选方案 (v1)】:
  <<<PROPOSER_SOLUTION_START>>>
  ${targetProposalText}
  <<<PROPOSER_SOLUTION_END>>>

  【挑战方提出的反例压测与致命漏洞】:
  <<<CHALLENGER_CRITIQUE_START>>>
  ${targetChallengeText}
  <<<CHALLENGER_CRITIQUE_END>>>

  【接地验证智能体提交的物理实测证据】 (若有):
  <<<GROUNDING_VERIFICATION_START>>>
  ${targetVerificationText}
  <<<GROUNDING_VERIFICATION_END>>>

  【提案方答辩与修补要求】:
  针对红队极端失效场景与接地验证证据正面回应：
  1. 事实澄清与评估：依据接地实测证据，确认漏洞成立范围；
  2. 架构防御补丁 (Patch v2)：提出具体的容灾降级、幂等锁、异步缓冲或解耦设计；
  3. 性能/复杂度折中说明：补丁方案对系统延迟、吞吐与运维成本的影响；
  4. 交付准备：给出可供综合仲裁官定案评估的最终建议。
  ```

### 3.5 阶段 5: 终局仲裁定案 (`arbitration`)
* **Prompt 结构化载荷**：
  包含 `<<<PROPOSER_SOLUTION_START>>>`、`<<<CHALLENGER_CRITIQUE_START>>>`、`<<<GROUNDING_VERIFICATION_START>>>`、`<<<PROPOSER_DEFENSE_START>>>` 完整链条。
  综合仲裁官运行 BWM 线性优化评估各准则效用，生成《决策权衡矩阵》并等待人类法槌落定。
  ```

---

## 4. 制衡方缺席门禁 (Quorum Gate) 规则

1. **不可跳步原则**：若阶段 1 完成后，挑战者因网络掉线或超时（`idle timeout`）未产出实质反例：
   - 系统将议题标记为 `isChallengerResponded = false`；
   - 界面状态条提示：`⚠️ 制衡方未响应，暂不可直接定案`；
   - 禁用普通的“快速敲锤”按钮；
2. **人类仲裁者具名豁免**：
   - 只有持有终审法槌的人类仲裁官，可以在法槌控制台中勾选 `[✓] 我已知晓制衡方缺席风险，并执行人类首席仲裁官具名特权豁免 (Exemption)`；
   - 豁免理由将作为 `rulingRecord.exemptionReason` 永久落库并展示在频道时间线。

---

## 5. 后仲裁落地执行闭环规范 (Post-Arbitration Execution Protocol)

定案并非协作的终点，而是代码实现的起点。系统构建了从决策层到代码层的落地闭环：

### 5.1 执行者委派方式
1. **法槌敲响时即时委派**：在法槌定案弹窗（Gavel Modal）或共识合流弹窗（Resolve Modal）中，仲裁官可从团队 Agent 列表中下拉选定 `🛠️ 落地执行 Agent`（如全栈工程师、后端专家等）。
2. **归档后按需委派**：议题归档后，状态条展示执行状态。仲裁官可点击 `【🛠️ 指派 Agent 实施补丁】` 按钮随时按需启动或重新指派。

### 5.2 工程执行指令封装 (`buildExecutionPrompt`)
系统自动提取定案决策中的所有工程要素，组装为高确定性的 ACP 执行指令：
- **议题名称与背景**；
- **裁决结论摘要与类型**；
- **落地推进方案与架构指引**；
- **关键权衡要点约束**（执行时必须满足的防御与折中约束）；
- **重点涉及文件列表**（指导 Agent 精确修改代码）；
- **任务目标要求**：使用工具检查代码库、实施具体 diff 修改、完成自测并汇报落地变更。

### 5.3 状态同步与追溯
- `GameTheoreticState.executionStatus` 记录状态：`idle` → `running` → `completed` / `failed`；
- 议题抽屉顶部与主时间线卡片均展示执行 Agent 名称与实时执行徽标（呼吸灯动效与已交付状态）；
- 执行 Agent 完成后产出修改总结并合流至议题讨论流，确保全链路可审计。

---

## 6. CognoNexus 神经符号确定性认知决策引擎规范 (CognoNexus Engine)

### 6.1 LMAD 局部冲突定位器与上下文脱水 (Local Conflict Slicing & Context Dehydration)
1. **因果论点节点抽取 (`ArgumentNode`)**：立论生成后，提取离散的论点主张、前提假设与自评置信度。
2. **局部切片 (`DisputeSpanPacket`)**：比对主导立论与挑战反例，定位时序最早的冲突切片（`claimTopic`, `proposerClaim`, `challengerCritique`, `rootCause`）。
3. **上下文脱水 (`CommittedState`)**：将历史长文本折叠为不可变的已承诺事实看板，避免全长文本累积导致注意力稀释与议题漂移。

### 6.2 确定性多属性决策分析 (Deterministic MCDA - BWM 最优最劣法)
1. **解决痛点**：规避单一 LLM 以自然语言主观宣判带来的尺度偏置与不可预测的概率漂移。
2. **运筹优化求解**：采用 Rezaei 最优最劣法 (BWM)，根据最优/最差准则与偏好度向量，利用纯 TypeScript 线性规划求解各准则最优权重向量 $w^*$。
3. **逻辑一致性检验**：计算全局逻辑一致性标度 $\xi^*$，并校验 Consistency Ratio $CR$。只有当一致性达标（$\xi^* \le 0.12$）时，多属性综合效用排序方可确立为决策基准。

### 6.3 Wald-SPRT 序贯概率比自适应计算调控器 (Sequential Probability Ratio Test)
1. **动态早停与熔断**：在阶段迁移时评估对齐分数 $S_r \in [0, 1]$ 并累加对数似然比 $\Lambda_r$。
2. **双阈值门禁**：
   - $\Lambda_r \ge A \approx 2.944$：判定有效高质共识，触发 **Early Exit（早停收敛）**；
   - $\Lambda_r \le B \approx -2.944$：判定底层价值死锁，触发 **Deadlock Meltdown（熔断预警）** 并呼叫人类介入；
   - $B < \Lambda_r < A$：放行继续局部修补直至安全上限 $R_{\max}$。

### 6.4 伴生少数派异议报告保留器 (Minority Report Preserver)
1. **价值多元性保全**：严禁强行抹平自洽的反向论证支链。
2. **黑天鹅重启条件**：提取异议主张、自洽逻辑与**重启判定条件清单**（如延迟超限、生产异常指标抖动），形成伴生异议报告永久归档。

