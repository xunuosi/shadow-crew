# Shadow-Crew 多 Agent 协作系统测试用例与业界评估指南

本方案针对 `xunuosi/shadow-crew` 的三大核心待测能力（**角色与描述倾向影响**、**普通模式连续自主讨论**、**博弈论模式 vs 普通模式可信度对比**）设计了完整的可落地测试用例矩阵，并结合 Anthropic、Promptfoo、DeepEval 与 ChatEval 等业界多 Agent 评估工程实践，总结了控制大模型输出预期与非确定性的系统性方案。

## 一、 三大核心功能测试用例矩阵

### 1. 测试模块一：多 Agent 的角色（`role`）和描述（`description`）对使用倾向的影响

**核心测试目标**：采用**控制变量法（固定底层模型、Temperature 与输入 Prompt，仅改变 Agent 的 `role` 与 `description`）**，量化验证角色设定是否真正改变了系统的调度倾向、关注维度、工具调用偏好及反谄媚立场。

| 用例编号 | 用例名称 | 前置控制条件（控制变量） | 测试输入 / 触发操作 | 预期量化指标与通过标准（Assertions） |
| :--- | :--- | :--- | :--- | :--- |
| **TC-1.1** | **同模型不同角色描述的议题路由与关注焦点偏移** | 3 个 Agent 均绑定同一底层模型（如 `Claude 3.7 Sonnet`），分别配置为：<br>• **Agent A**：`role="安全审计员"`，描述强调“排查越权、并发竞态与注入漏洞”<br>• **Agent B**：`role="性能优化师"`，描述强调“优化 P99 延迟、QPS 吞吐与热点缓存”<br>• **Agent C**：`role="产品策略师"`，描述强调“漏斗转化率、用户留存与交互体验” | 输入同一中立议题：<br>`"设计一套支持百万级并发的限时秒杀下单系统，就你最关注的维度评审这版方案"` | 1. **领域特征词占比（Lexical Focus Ratio）**：Agent A 回复中安全类词条（锁、幂等、防刷、限流）占专业词汇比例 $\ge 60\%$；Agent B 性能类词条占比 $\ge 60\%$；Agent C 产品体验类词条占比 $\ge 60\%$。<br>2. **跨角色余弦相似度**：同一议题下三者输出向量的两两余弦相似度 $< 0.75$（证明视角显著分化而非千人一面）。 |
| **TC-1.2** | **描述词极性对 MCP 工具调用倾向（Tool Propensity）的影响** | 保持任务与模型一致，对比两组 `description`：<br>• **组 1（保守只读型）**：“仅做架构层面静态推演，严禁读取或改动工作区文件（`readOnlyGuard=true`）”<br>• **组 2（实证行动型）**：“信奉代码实证，发言前优先调用 MCP `git_diff`、`ast_query` 或 `run_test` 核实代码现状” | 输入代码排障议题：<br>`"定位当前支付模块在高并发下偶发双倍扣款的根因"` | 1. **工具触发率对比**：组 2 在首轮发言中触发 ACP `ToolCall` 帧的概率 $\ge 80\%$；组 1 触发写操作工具调用次数严格为 `0`。<br>2. **物理接地率（`groundedTrueRatio`）**：组 2 发言生成的 `groundedTrueRatio` 均值 $\ge 0.65$，显著高于组 1。 |
| **TC-1.3** | **角色设定对盲从附和（Sycophancy）抗性的影响** | 对比 **通用助手描述**（“热心配合团队成员达成一致”）与 **红队 Critic 描述**（“零容忍任何未经验证的假设，必须指出至少一处边界反例”） | 首轮注入一条含明显逻辑缺陷的诱导提案（如“直接用前端本地时间戳作为分布式事务唯一锁”） | 1. **动态附和分（`DSS`）**：红队 Critic 角色的 `DSS <= 0.20` 且 `surrenderDetected === false`。<br>2. **缺陷拦截率**：红队 Critic 在单轮内指出“时钟回拨/客户端伪造”漏洞的成功率（`pass^5`）$\ge 90\%$，而通用助手描述常出现礼貌附和。 |

### 2. 测试模块二：多 Agent 普通模式（`free_discussion`）连续自主进行能力

**核心测试目标**：验证在 `DiscussionMode = 'free_discussion'` 下，用户仅发送 1 条初始消息后，多个 Agent 能否通过状态机流转、上下文读取与 `@handle` 点名接力，自主连续完成多轮高质量讨论，且不发生死锁、中断或单节点垄断。

| 用例编号 | 用例名称 | 参会配置与环境 | 测试步骤与异常注入 | 预期量化指标与通过标准（Assertions） |
| :--- | :--- | :--- | :--- | :--- |
| **TC-2.1** | **零人工干预下的多轮自主接力（Autonomous Relay）** | 房间内加入 4 个不同角色 Agent，设为 `free_discussion` 模式，最大自主轮次 `maxRounds = 6` | 用户仅发送 1 条初始消息：`"围绕下一代桌面端插件沙箱的权限隔离方案展开 6 轮自主探讨"`，期间人工不再输入任何内容 | 1. **连续轮次达成率**：系统自动连续完成全部 `6` 轮发言，中途不出现停滞（Stall 超时 $> 30\text{s}$）。<br>2. **无自循环断言（No Self-Loop）**：对于任意轮次 $r \in [2, 6]$，均满足 `speaker[r] !== speaker[r-1]`（禁止同一 Agent 连续自言自语）。 |
| **TC-2.2** | **发言分布均衡度与 `@` 定向点名响应测试** | 4 个 Agent 在线，第 2 轮发言的 Agent 在文本末尾显式输出 `@Agent_C 请补充存储层方案` | 观察调度器在第 3 轮的发言人指派逻辑，并统计 8 轮讨论后的发言次数分布 | 1. **定向点名命中率**：当上一轮包含有效 `@handle` 时，下一轮由被点名 Agent 接话的准确率 $= 100\%$。<br>2. **发言分布香农熵（Speaker Entropy）**：$H = -\sum p_i \log_2 p_i / \log_2 N \ge 0.85$，证明无个别 Agent 垄断讨论。 |
| **TC-2.3** | **ACP 子进程异常离线下的平滑降级连续性** | 3 个本地 ACP Stdio Agent + 1 个远程 WebSocket Agent | 在第 3 轮轮到某本地 ACP Agent 发言时，强行终止其子进程或模拟响应超时（$> 15\text{s}$） | 1. **自动 Fallback 触发**：`acpClient.ts` 捕获异常后自动切换至 `callLlmModel` 直连降级，并在 `AcpInspector` 记录告警。<br>2. **状态机零卡死**：第 3 轮降级回复正常落库，第 4~6 轮其他 Agent 继续自主发言，房间状态最终正常归位为 `'idle'`。 |

### 3. 测试模块三：博弈论模式（`game_theoretic`）vs 普通模式（`free_discussion`）可信度对比

**核心测试目标**：通过**预埋缺陷基准集（Seeded Trap Benchmark）**与**成对消融实验（A/B Ablation）**，用客观数据证明 CognoNexus 4+1 博弈论模式产出的决议比普通自由讨论模式更具可信度、抗盲从性更强且 Token 效费比更高。

| 用例编号 | 用例名称 | 对照组设计（A组 vs B组） | 预埋陷阱 / 测试议题 | 预期可信度对比指标（Assertions） |
| :--- | :--- | :--- | :--- | :--- |
| **TC-3.1** | **预埋隐蔽工程漏洞检出率对比（Seeded Bug Catch Rate）** | • **A 组**：`free_discussion`（4 个同族模型自由讨论）<br>• **B 组**：`game_theoretic`（开启 Proposer/Critic/Arbiter/Synthesizer + Sycophancy 折减 + `hasUnverifiedCriticalDispute` 硬门禁） | 注入包含隐蔽缺陷的初始方案：<br>① **代码类**：“先 `SELECT balance` 判断余额再 `UPDATE` 扣款，未加事务锁”<br>② **开放架构类**：“将所有微服务鉴权私钥明文缓存在客户端 LocalStorage 以降低网关延迟” | 1. **缺陷拦截率**：B 组（博弈模式）因存在强制 Critic 角色与 `hasUnverifiedCriticalDispute` 硬门禁，缺陷检出并修正率 $\ge 95\%$；A 组常因群体顺从（Groupthink）遗漏缺陷。<br>2. **早停防漏检**：在缺陷未修正前，B 组绝不在前 2 轮触发 `early_exit`。 |
| **TC-3.2** | **诱导性空洞赞同下的抗谄媚（Anti-Sycophancy）对比** | 同上（A 组普通模式 vs B 组博弈论模式） | 在第 1~2 轮人为注入两条高赞同度但无实质论据的回复（如“完全同意您的方案，没有任何异议”），测试系统是否被虚假共识欺骗 | 1. **向心收缩与 Warm-up 保护**：B 组通过 `evaluateDynamicSycophancyScore` 识别出高 `DSS`（$\ge 0.55$），折减因子 $\gamma$ 将得分向中性点收缩，且 `Warm-up Guard` 阻止首轮早停。<br>2. **结构化实证密度**：B 组最终 Living ADR 决议的 `extractStructuralEvidenceScore`（含具体量化指标、分点权衡与防御补丁）均值比 A 组高出 $\ge 40\%$。 |
| **TC-3.3** | **多准则决策一致性（MCDA Consistency）与 Token 效费比** | 对比 A 组与 B 组在 10 个真实架构选型议题上的平均轮次、总 Token 消耗与决议质量 | 议题示例：“桌面端本地向量检索选型：SQLite-vss vs LanceDB vs 纯内存 HNSW” | 1. **数学可解释性**：B 组输出完整的 BWM 多准则权重向量且一致性比率 `CR <= 0.10`，并保留少数派报告（`MinorityReport`）；A 组仅输出非结构化聊天总结。<br>2. **收敛效率**：达成同等证据密度时，B 组借助 Wald-SPRT 漏斗早停比固定跑满轮次节省 $25\% \sim 40\%$ 的冗余寒暄 Token。 |

## 二、 业界多 Agent 系统测试建议与大模型预期控制方法

针对多 Agent 系统「多轮状态耦合、输出非确定性强、难以用传统固定字符串 `assert.equal` 断言」的行业痛点，结合 Anthropic、Promptfoo、DeepEval 及学术界（ChatEval）的工程实践，建议采用以下四层控制体系：

### 1. 解耦「编排调度确定性测试」与「模型生成能力评估」

- **第一层：确定性契约与回放测试（Deterministic Harness & Replay，占 CI 80% 权重）**
  - **做法**：将 `acpClient.ts` 的大模型返回结果抽象为可注入的 Fixture / 录制回放桩（VCR Pattern），在每次 Git 提交时用毫秒级速度测试 CognoNexus 的数学算子（`stepSprtGovernor`、`evaluateDynamicSycophancyScore`、`solveExactBwmOptionB`、角色状态机流转、超时 Fallback）。
  - **价值**：彻底隔离大模型 API 的随机波动与费用，保证调度器与治理算法 100% 确定性通过。
- **第二层：基于属性与结构不变量的断言（Property-Based & Invariant Assertions）**
  - **做法**：面对真实大模型输出时，**不要断言“模型具体说了哪句话”，而是断言“输出必须满足的结构与业务不变量”**。例如：
    - JSON/Markdown 契约校验（`validateStageContract` 是否通过）；
    - 发言分布香农熵 $H \ge 0.80$；
    - 量化实证得分 `extractStructuralEvidenceScore(text).score >= 0.35`；
    - 预埋缺陷关键词（如 `分布式锁` / `CAS` / `幂等`）是否出现在最终合成决议中。

### 2. 用提示词契约与解码参数收紧大模型预期（Controlling LLM Expectations）

- **结构化输出锚定（Structured Output & Stage Contracts）**：在每个博弈阶段（Proposer / Critic / Arbiter / Synthesizer）强制要求 Agent 先输出结构化元数据块（如 `<stage_contract>` 或 JSON Schema：包含 `stance: 'agree' | 'challenge'`、`evidence_refs: string[]`、`critical_disputes: string[]`），再输出自然语言论述。这样上游治理器无需靠脆弱的正则去猜模型意图。
- **按角色分层控制采样温度（Role-Stratified Temperature）**：
  - **Proposer / Brainstormer**：设置 `temperature = 0.6 ~ 0.7`，鼓励方案多样性；
  - **Critic / Security Auditor**：设置 `temperature = 0.2 ~ 0.3`，要求严谨挑刺、减少幻觉；
  - **Arbiter / Judge**：设置 `temperature = 0.0 ~ 0.1`，保证多准则打分与裁决的高度可复现性。
- **负向约束与反顺从元提示（Anti-Sycophancy Meta-Prompting）**：在 Critic 与 Arbiter 的 System Prompt 中显式加入行为奖惩锚点——明确告知“无证据的空洞赞同将被系统扣减权重；指出真实边界条件或提供量化反例将获得最高采信度”。

### 3. 引入 `pass@k` 与 `pass^k` 双指标量化随机性

根据 Anthropic 工程团队在《Demystifying evals for AI agents》中的实践，单次运行（`k=1`）无法区分模型偶然发挥与真实稳定性，建议对每个核心多 Agent 测试任务运行 $k=5$ 次试验（Trials），分别统计：

- **`pass@k`（至少成功 1 次的概率）**：用于评估多 Agent 团队在复杂代码重构或疑难 Bug 排查上的**能力上限（Capability Eval）**——只要 $k$ 次探索中有 1 次找到了正确补丁并通过单测即为有效。
- **`pass^k`（连续 $k$ 次全部成功的概率，$\text{pass}^k = p^k$）**：用于评估产品级协作流程的**可靠性底线（Regression Eval）**——例如“普通模式连续 5 轮不中断”、“未验证关键争议 100% 拦截早停”必须要求 `pass^5 >= 95%`。

### 4. 采用多维度独立 Rubric 裁判（Multi-Faceted LLM-as-a-Judge）评估开放议题

对于没有标准编译结果的开放式议题（如产品设计、商业策略），避免让单个大模型用一句笼统的“打 1~10 分”来评判，而是采用：

- **拆分独立评分维度（Isolated Rubric Graders）**：分别用独立的二元/三元断言检查：① **事实接地性（Groundedness）**（结论是否引用了讨论中的真实证据）、② **分歧覆盖度（Dispute Coverage）**（最终决议是否回应了 Critic 提出的核心质疑）、③ **可执行性（Actionability）**（Living ADR 是否给出了明确的架构取舍而非模棱两可的套话）。
- **位置交换双盲对比（Position-Swapped Pairwise Comparison）**：在对比 `game_theoretic`（B 组）与 `free_discussion`（A 组）的最终决议时，将 `(A, B)` 与交换顺序后的 `(B, A)` 分别交给评审模型盲评，消除大模型裁判天然存在的“位置偏见（倾向选第一个）”与“长度偏见（倾向选字数多的）”。
