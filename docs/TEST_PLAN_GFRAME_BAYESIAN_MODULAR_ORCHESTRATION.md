# 🧪 Shadow Crew G-Frame 模块化分治 × 贝叶斯博弈 验证方案与测试用例集

> **文档编号**：`TEST_PLAN_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION`  
> **版本**：v1.0.0  
> **基线提交**：`a6f2647 fix(cogno): remove R&D hardcoding in G-Frame decomposition and contract gates for general business discussions`  
> **变更范围**：任务分模块（G-Frame Team Game 微观层）+ 贝叶斯动态调控（Bayesian Game 宏观层），落地位于 `549fdb4 / d035a80 / da9686b / a6f2647` 四个提交  
> **关联文档**：
> - [`SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md)
> - [`SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md)
> - [`TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md)

---

## 1. 验证目标与判定口径

### 1.1 本次要回答的三个问题

| # | 待验命题 | 判定依据 |
| :--- | :--- | :--- |
| Q1 | **模块分治是否真的生效**：复杂议题被拆为 2~4 个职责正交、上下文物理隔离的原子模块 | 阶段 0 产出 `modularState.modules`，各模块 `allowedFiles` 不重叠越界，Prompt 中仅注入本模块沙箱历史 |
| Q2 | **贝叶斯调控是否符合数学设定**：先验分流准确、后验随反馈向量升降级、低风险模块走 `fast_track` 省 Token | `P_prior → P_posterior` 与 Log-Odds 公式一致；`routingMode` / `posteriorAction` / `status` 迁移符合规则 A/B/C |
| Q3 | **局部重修不污染全局**：某模块被证伪时，已冻结模块硬锁定不回退 | `frozen` 模块在后续任意阶段状态与 `frozenProposalSnippet` 不变 |

### 1.2 通过标准（三层门禁）

1. **硬门禁（必须 100% 通过）**：`npm run lint` 零报错；`npm run test:cogno` 全绿；`cargo test -p shinobi-dev-mcp` 全绿。
2. **运行期门禁（端到端）**：至少 1 个「研发类」+ 1 个「纯业务类」真实议题在真实 Agent 下跑完 阶段0 → 仲裁，无人工干预即自动流转。
3. **观感门禁（UI）**：白昼/暗夜双主题下模块沙箱矩阵可读性达标，模块胶囊过滤正确，窄分栏无横向出界。

---

## 2. 四层验证策略与一键命令

| 层级 | 名称 | 覆盖对象 | 执行方式 | 建议频率 |
| :--- | :--- | :--- | :--- | :--- |
| **L0** | 静态与构建基线 | 类型、语法、打包、Rust 契约 | `npm run lint` / `npm run build` / `cargo test -p shinobi-dev-mcp` | 每次提交前 |
| **L1** | 算法与协议单测 | `src/services/cogno/*`、ACP 提取器、MCP 工具 | `npm run test:cogno` | 每次提交前 |
| **L2** | 端到端运行期自证 | 真实 ACP Agent 下的完整 FSM 闭环与模块沙箱循环 | `npm run dev` / `npm run dev:desktop` 手工走查 | 每个 Wave 收口、发版前 |
| **L3** | UI 与视觉回归 | `TopicThreadDrawer` 沙箱矩阵、`LivingAdrCanvas`、双主题配色 | 手工走查 + 双主题截图比对 | 每个 Wave 收口 |

### 2.1 标准回归命令（复制即可执行）

```bash
cd /Users/xunuosi/Code/Lx/AI/shadow-crew

# L0 静态基线
npm run lint

# L0 构建基线（涉及全局状态/公共模块/依赖变动时必须执行）
npm run build

# L0 Rust MCP 工具契约
cargo test -p shinobi-dev-mcp

# L1 全部博弈论 + G-Frame 自动化断言（16 项治理 + 4 个 Wave + BWM 金标准 + G-Frame 7 项）
npm run test:cogno
```

**当前基线实测结果（2026-10-13 复跑）**：

| 命令 | 结果 |
| :--- | :--- |
| `npm run lint` | ✅ 通过，零类型报错 |
| `npm run test:cogno` | ✅ 全绿：`verify-all-governance` T1~T8 / A1~A10 + Wave1/2/3 + Rezaei 2015 BWM 金标准 + G-Frame 7/7 |
| `cargo test -p shinobi-dev-mcp` | ✅ `9 passed; 0 failed`（含 `test_dispatch_tool_call_submit_module_decomposition`、`test_tools_list_schema`） |

> ⚠️ **沙箱提示**：`tsx` 需要建立本地 IPC 管道，在受限沙箱下会抛 `EPERM ... .pipe`。若遇此报错属环境限制而非用例失败，需在非沙箱终端重跑。

---

## 3. 观测字典：在哪里看什么

| 观测对象 | 字段 / 位置 | 说明 |
| :--- | :--- | :--- |
| 模块清单 | `topic.gameTheoreticState.modularState.modules[]` | `moduleId / title / responsibility / allowedFiles / dependsOnModuleIds / status` |
| 贝叶斯信念 | `modules[i].belief` | `priorRisk`（先验）、`posteriorRisk`（后验）、`routingMode`（`fast_track` / `deep_debate`）、`feedbackVector`、`latestAction` |
| 公共契约 | `modularState.sharedContract` | `summary` / `typeSignatures` / `invariants` / `lockedAt` |
| 当前聚焦模块 | `modularState.activeModuleId` | 决定 Prompt 注入哪个沙箱 |
| 沙箱消息归集 | `modules[i].scopedMessageIds[]` | 验证「无串台」的核心证据 |
| 冻结定案摘要 | `modules[i].frozenProposalSnippet` | 供 ADR 拼装与下游模块读取 |
| 遥测事件 | `localStorage['shinobi_cogno_telemetry_events_v1']` | 由 `logGameTheoreticTelemetry` 写入，含 `stage_contract_validation` / `grounded_ratio_injected` / `decisionState_transition` |
| UI 沙箱矩阵 | 议题抽屉顶部「🧩 G-Frame 模块沙箱矩阵」 | 胶囊展示 `[modId] 标题 (P_prior→P_posterior) 🔒/⚔️/⚡` |

**贝叶斯计算口径（用于手算核对）**：

```text
P_prior = clamp(B_level + 0.05 × max(0, |allowedFiles| - 2) + 0.15 × I_critical, 0.10, 0.90)
          B_level ∈ { low_deterministic: 0.20, medium_standard: 0.45, high_critical: 0.70 }
          I_critical = 命中 CRITICAL_DOMAIN_REGEX（并发/锁/事务/幂等/鉴权/迁移/资损/合规/隐私/不可逆…）

路由分流：P_prior < 0.45 → fast_track ； P_prior ≥ 0.45 → deep_debate

logit(P_posterior) = logit(P_prior) + 1.20×ContractViolations + 0.95×RefutedClaims
                     + 0.35×EdgeCases − 0.80×VerifiedClaims + penalty(DSS)
        其中 penalty(DSS) = max(0, DSS − 0.45) × 0.40 ； 结果 clamp 到 [0.05, 0.95]

规则 A（FREEZE_MODULE）        : P_posterior ≤ 0.30 或 (fast_track 且 Verified ≥ 1) 或 (Verified ≥ 2 且 无证伪无违规)
规则 B（ESCALATE_TO_RED_TEAM） : fast_track 模块出现 ContractViolations > 0 或 P_posterior ≥ 0.55
规则 C（SCOPED_DEFENSE_REFINE）: ContractViolations > 0 或 RefutedClaims > 0
```

---

## 4. 测试用例集

### 4.1 L0：静态与构建基线

| 用例 ID | 用例名称 | 前置条件 | 操作步骤 | 预期结果 | 证据 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BL-01** | TypeScript 类型基线 | 依赖已安装（`node_modules` 存在） | 执行 `npm run lint` | 退出码 0，无任何 `error TS…` | 终端输出 |
| **BL-02** | 生产构建基线 | 同上；涉及全局状态/公共模块/依赖变动时必跑 | 执行 `npm run build` | `vite build` 成功，生成 `dist/`，无阻断性错误 | 终端输出 + `dist/` 产物 |
| **BL-03** | Rust MCP 契约基线 | `cargo` 可用；`target/` 已就绪 | 执行 `cargo test -p shinobi-dev-mcp` | `9 passed; 0 failed`，其中必须包含 `test_dispatch_tool_call_submit_module_decomposition` 与 `test_tools_list_schema` | 终端输出 |

### 4.2 L1：G-Frame 贝叶斯与模块分治算法断言

> 全部由 `npm run test:cogno` 中的 `src/services/cogno/test-gframe-bayesian-modular.ts`（7 组）与 `verify-all-governance.ts` 的 `T8` / `A10` 自动覆盖。

| 用例 ID | 用例名称 | 输入 / 操作 | 预期结果（断言点） | 自动化 |
| :--- | :--- | :--- | :--- | :--- |
| **GF-01** | 先验风险基础值 | `low_deterministic` / 1 个文件 / 纯类型定义 | `priorRisk === 0.20` 且 `routingMode === 'fast_track'` | ✅ |
| **GF-02** | 先验风险高危加成 | `high_critical` / 4 个文件 / 「高并发互斥锁 + SQLite 事务幂等迁移」 | `priorRisk ≥ 0.85`（0.70 + 0.05×2 + 0.15）且路由 `deep_debate` | ✅ |
| **GF-03** | 先验分流阈值边界 | 构造 `P_prior` 恰好 0.44 / 0.45（如 `medium_standard` + 文件数微调） | `< 0.45` 走 `fast_track`；`≥ 0.45` 走 `deep_debate`（**严格小于**为界） | ⚠️ 建议补强 |
| **GF-04** | 模块 DAG 初始化与根节点激活 | 提交 3 模块草案（M1 无依赖、M2 依赖 M1、M3 依赖 M1+M2） | `modules.length === 3`；`activeModuleId === 'mod-1-schema'`；M1 `status === 'proposing'` | ✅ |
| **GF-05** | 模块数量硬上限 | 提交 5 个模块 | 仅保留前 4 个（`slice(0, 4)`），`enabled === true` | ⚠️ 建议补强 |
| **GF-06** | 后验升级：契约违规拉起红队 | `fast_track` 模块传入 `contractViolations: 2` | `posteriorAction === 'ESCALATE_TO_RED_TEAM'`；`routingMode` 变 `deep_debate`；`posteriorRisk ≥ 0.55` | ✅ |
| **GF-07** | 后验冻结：零冲突 + 实证通过 | 传入 `verifiedClaims: 2, contractViolations: 0, refutedClaims: 0` | `posteriorAction === 'FREEZE_MODULE'`；`status === 'frozen'` | ✅ |
| **GF-08** | 后验局部重修：存在证伪项 | 传入 `refutedClaims: 1, edgeCaseCount: 2` | `posteriorAction === 'SCOPED_DEFENSE_REFINE'`；`status === 'defending'` | ✅ |
| **GF-09** | 谄媚分 DSS 对后验的抑制（γ 折减联动） | 相同反馈下把 `dssScore` 由 0 提升到 0.95 | `posteriorRisk` 单调上升（惩罚项 `max(0, DSS−0.45)×0.40` 生效） | ⚠️ 建议补强 |
| **GF-10** | 拓扑调度门禁 | M1 未冻结时请求调度 | `getNextSchedulableModule` 不返回 M2；M1 冻结后立即返回 M2 | ✅ |
| **GF-11** | 全冻结收敛 | 依次冻结 M1/M2/M3 | `allModulesFrozen === true`；`activeModuleId === undefined`；`getNextSchedulableModule` 返回 `undefined` | ✅ |
| **GF-12** | 冻结模块硬锁定 | M1 冻结后在 M2 沙箱内触发局部重修 | M1 `status` 仍为 `frozen`，`frozenProposalSnippet` 不被改写 | ✅ |
| **GF-13** | 跨模块文件越界拦截 | M1（白名单 `src/types.ts`）输出「修改 `src/services/engine.ts` 并重写 `src/components/Drawer.tsx`」 | `isScopeValid === false`；`contractViolations === 2`；`violatedFiles` 命中两个文件 | ✅ |
| **GF-14** | 白名单内修改不误报 | M1 输出「仅修改 `src/types.ts` 定义 PluginState」 | `isScopeValid === true`；`contractViolations === 0` | ✅ |
| **GF-15** | 沙箱 Prompt 隔离注入 | 为 M3 构造 `buildScopedModulePrompt` | 必含：`sharedContract.typeSignatures`、上游 M2 的 `frozenProposalSnippet`（≤160 字）、本模块 `allowedFiles`、隔离铁律三条 | ✅ |
| **GF-16** | 沙箱 Prompt 不泄露他模块 | 同上，检查 Prompt 全文 | 不包含其他模块的业务实现细节与长篇历史（仅出现模块标题名） | ⚠️ 建议补强（弱断言） |
| **GF-17** | MCP 拆解载荷直通提取 | 构造含 `submit_module_decomposition` 的 `mcpToolCalls` | `extractModuleDecompositionFromAcpResponse` 返回草案，`modules.length` 正确、`complexityLevel` 正确映射 | ✅ |
| **GF-18** | 通用业务议题动态拆解（反研发硬编码） | 输入 Q4 SaaS 会员分级定价议题 + 三节 Markdown 标题 | `modules.length === 3`；`sharedContract.typeSignatures === ''`；`allowedFiles === []`；合规模块判为 `high_critical` | ✅ |
| **GF-19** | 信息熵 / Token 压缩比 | `computeEntropyReductionRatio(3600, 700, 200)` | 返回值 `0.75`；`totalTopicChars ≤ 0` 时返回 0；`activePayload ≥ total` 时返回 0 | ✅ |
| **GF-20** | 文件路径提取不凭空捏造 | 输入无任何 `a/b/c.ts` 形态路径的纯业务文本 | `allowedFiles` 全为空数组，不出现 `src/…` 硬编码 | ✅ |

### 4.3 L1：博弈论 16 项治理基线（回归防退化）

> 由 `src/services/cogno/verify-all-governance.ts` 全自动覆盖，`npm run test:cogno` 首条即执行。任何 G-Frame 改动都必须保证这 16 项不回退。

| 用例 ID | 机制名称 | 对应用户价值 |
| :--- | :--- | :--- |
| **T1** | Wald-SPRT 序贯概率比早停与死锁熔断 | 高置信早停省 Token；价值死锁自动呼救 |
| **T2** | LMAD 局部冲突切片（Top-5）与三态上下文脱水 | 长文不稀释注意力，只保留争议切片 |
| **T3** | 阶段靶点按需挂载 + 历史滑动窗口 300 字截断 | 上下文体积可控 |
| **T4** | “静默即成功”公约与 LoopGuard 深度/频次守卫 | 防 Agent 互相刷屏死循环 |
| **T5** | 阶段契约 0-Token 预检与有界 Self-Refine（`MAX_RETRIES=2`） | 敷衍回复被拦截且重试有上限 |
| **T6** | ColMAD 车轱辘话与冗余套话负向惩罚 | 压制复读机式灌水 |
| **T7** | BWM 0-Token 本地求解 + `submit_arbitration_ruling` MCP 直通 | 裁决不靠大模型主观宣布 |
| **T8** | **G-Frame 模块级上下文物理隔离与贝叶斯快速通道节流** | 本次新增能力（Token 侧） |
| **A1** | DIANOIA 4+1 职能正交解耦与角色隔离路由 | 提案/红队/验证/仲裁各司其职 |
| **A2** | Free-MAD 反从众红队四部曲结构化门禁 | 红队必须给出真反例而非附和 |
| **A3** | T1/T2 分级接地验证、原子承诺链与未实证早停硬锁 | 未实证结论不允许提前收工 |
| **A4** | BSS/DSS 谄媚偏见量化、无补丁投降拦截与 γ 折减 | 防“无脑同意” |
| **A5** | ReConcile 异构模型家族检测与校准置信度矩阵 | 防同源模型同质化共识偏见 |
| **A6** | LLM + BWM 运筹求解、FLAT 退化拒绝与 ξ* 一致性门禁（ξ* ≤ 0.12） | 权重一致性可验证 |
| **A7** | ColMAD 非零和协同增量事实奖励与先锋声誉 | 奖励“贡献增量事实”的 Agent |
| **A8** | Disagreement-Aware 少数派异议报告与黑天鹅重启条件 | 少数派意见不被抹平 |
| **A9** | 活体 ADR 画布 4 大章节与爆炸半径约束 | 决策可归档、可追溯 |
| **A10** | **G-Frame 贝叶斯 Log-Odds 后验升级与跨模块文件越界门禁** | 本次新增能力（准确性侧） |

### 4.4 L2：端到端运行期自证（真实 Agent，人工走查）

> 前置条件：至少 3 个 Agent 已 `Start`（提案官 / 红队 / 仲裁），`npm run dev` 或 `npm run dev:desktop` 已启动，创建议题时 `discussionMode = game_theoretic` 并完成角色指派。

| 用例 ID | 用例名称 | 操作步骤 | 预期结果 | 优先级 |
| :--- | :--- | :--- | :--- | :--- |
| **E2E-01** | 阶段 0 真实调用 MCP 拆解工具 | 发起一个跨模块研发议题（如「新增渠道级数据隔离 + 会话缓存 + UI 状态栏」） | 提案官阶段出现模块沙箱矩阵；`modularState.modules.length ∈ [2,4]`；若 Agent 调用 `submit_module_decomposition` 则 `sharedContract` 来自工具载荷 | P0 |
| **E2E-02** | 未调用工具时的兜底拆解 | 用不支持 MCP 工具的 Agent 跑同一议题 | 系统回落到 `buildDefaultDecompositionFromTopic`，仍产出 ≥ 2 个模块且不出现 `src/` 伪造路径 | P1 |
| **E2E-03** | **多模块循环推演闭环** | 观察 3 模块议题从 阶段0 到 仲裁的完整流转 | 每个模块都经历「提案→（红队→验证）→定案」并被置为 `frozen`；抽屉矩阵显示 `3/3 已冻结` | **P0（高风险）** |
| **E2E-04** | 沙箱消息归集不串台 | 讨论中切换模块胶囊，检查各模块 `scopedMessageIds` | 每条消息只归属 1 个模块；`activeModuleId` 切换后，该模块消息数单调递增 | P0 |
| **E2E-05** | 上下文隔离实证 | 抓取发给下游 Agent 的 Prompt（或临时打印 `buildScopedModulePrompt` 结果） | Prompt 仅含：公共契约 + 本模块职责/白名单 + 本模块近 4 条历史 + 上游已冻结摘要；**不含**其他模块的实现细节 | P0 |
| **E2E-06** | 后验升级真实触发 | 让 fast_track 模块故意触碰其他模块白名单文件（或在提案里写越界修改） | 该模块 `routingMode` 由 `fast_track` 变 `deep_debate`，状态进入 `challenging`，红队被唤醒；`latestAction === 'ESCALATE_TO_RED_TEAM'` | P0 |
| **E2E-07** | 冻结不回退 | M1 冻结后触发 M2 重修 | M1 状态恒为 `frozen`，`frozenProposalSnippet` 不变；M2 `status === 'defending'` | P0 |
| **E2E-08** | 溯源链路完整 | 完成仲裁并打开活体 ADR 画布 | ADR 必含：公共契约章节、模块表（`P_prior → P_posterior` / `routingMode` / `status` / `allowedFiles`）、权衡矩阵、落地文件清单 | P1 |
| **E2E-09** | Token/字符量收益观测 | 对比同一议题在「单轨全量」与「模块分治」下的单次 Prompt 字符数 | 模块沙箱单次载荷下降 ≥ 50%（目标 65%），低风险模块跳过红队轮次 | P2 |

### 4.5 L3：UI 与双主题视觉回归

| 用例 ID | 用例名称 | 操作步骤 | 预期结果 | 优先级 |
| :--- | :--- | :--- | :--- | :--- |
| **UI-01** | 模块沙箱矩阵渲染 | 打开含 `modularState` 的议题抽屉 | 显示「🧩 G-Frame 模块沙箱矩阵」+ 信息熵压降 `xx%` + `x/y 已冻结` + 「📜 公共契约已锁定」；每个胶囊含 `[modId] 标题 (0.20→0.18) 🔒/⚔️/⚡` | P0 |
| **UI-02** | 模块过滤交互 | 点击模块胶囊 → 再点一次 | 首次仅显示该模块沙箱消息且胶囊高亮 `ring-1`；再次点击回到「全部模块 (N)」 | P0 |
| **UI-03** | 双主题对比度 | 在 `data-theme="light"` 与 `data-theme="dark"` 下分别查看矩阵、SPRT 条、谄媚度条、裁决横幅 | 无「浅字叠浅底 / 深字叠深底」；胶囊文字对比度 ≥ 6.5:1（已冻结 Emerald / 博弈中 Amber / 待定 Blue） | P0 |
| **UI-04** | 窄分栏防溢出 | 将抽屉压到最窄（Sidebar + Timeline + Drawer 三栏） | 矩阵标题与胶囊自动 `flex-wrap`，无横向滚动条、无文字出界 | P1 |
| **UI-05** | ADR 导出 | 点击 ADR 画布「复制」/「下载」 | Markdown 含 4 大标准章节 + 模块分治表格，可正常复制/下载为 `adr-xxxxxx.md` | P2 |

### 4.6 边界与异常用例

| 用例 ID | 用例名称 | 输入 | 预期结果 | 现状 |
| :--- | :--- | :--- | :--- | :--- |
| **EDGE-01** | 模块数超上限 | 提交 5 个模块 | 截断为 4 个，不报错 | ✅ 已实现（`slice(0,4)`），待补断言 |
| **EDGE-02** | 模块数不足下限 | 提交 1 个模块 | MCP Schema 层 `minItems: 2` 拦截；若绕过 Schema 直传，前端当前**不报错也不补齐** | ⚠️ **无守卫**，建议补用例并评估 |
| **EDGE-03** | 依赖成环 | M1 依赖 M2、M2 依赖 M1 | 当前无环检测，`getNextSchedulableModule` 可能返回 `undefined`（全 pending 卡死） | ⚠️ **无守卫**，建议补用例 |
| **EDGE-04** | allowedFiles 重叠 | M1 与 M2 白名单含同一文件 | 该文件对两模块均为「白名单内」，越界门禁不报错（当前 `activeAllowed` 优先） | ⚠️ 语义需确认（可能双写冲突） |
| **EDGE-05** | 后验反馈语义 | 连续两次调用 `updateModuleBeliefWithFeedback` 传相同数值 | 当前为**覆盖累计值**而非累加（`?? prev` 语义），后验不叠加 | ⚠️ 语义需确认（`feedbackDelta` 命名易误读） |
| **EDGE-06** | defense 阶段实证计数 | 真实答辩完成后检查传入的 `verifiedClaims` | 集成层当前**硬编码 `verifiedClaims: 2, refutedClaims: 0`**，导致真实运行期几乎不会走 `SCOPED_DEFENSE_REFINE` | 🔴 **重点核查项** |

---

## 5. 五分钟冒烟清单（每次改动后先跑这个）

1. `npm run lint` → 必须 0 报错。
2. `npm run test:cogno` → 末尾必须看到 `🎉 [G-Frame Complete] All 7 test suites passed 100%!` 与 `验证汇总：… 通过 16/16`。
3. `cargo test -p shinobi-dev-mcp` → `9 passed; 0 failed`。
4. 起一个 `game_theoretic` 议题，确认抽屉顶部出现「🧩 G-Frame 模块沙箱矩阵」且模块数 ∈ [2,4]。
5. 点击任一模块胶囊，确认时间线被正确过滤且能回到「全部模块」。

---

## 6. 高风险待验证点（附代码定位，建议优先确认）

> 以下三点是在梳理实现时发现的**规格与实现可能不一致**之处，建议作为本次验证的第一优先项，先确认「是缺陷」还是「有意的阶段性简化」。

1. **多模块循环推演疑似未闭环**
   - 现象：`advanceModularOrchestration` 在冻结当前模块后会返回下一个 `activeModuleId`，但 `src/App.tsx` 中**没有消费 `allModulesFrozen` 的回流逻辑**：答辩结束后无条件 `gameStage: 'arbitration'`（见 `src/App.tsx` 约 3549~3600 行与 2971~3010 行）。
   - 影响：3 模块议题可能只对第一个模块完成了红队/验证/定案，M2/M3 停在 `proposing`，`x/y 已冻结` 停在 `1/3`。
   - 验证方法：见 **E2E-03**。若确认为缺陷，属 P0。

2. **答辩阶段的实证计数被硬编码**
   - 现象：`src/App.tsx` 约 3560 行传入 `{ verifiedClaims: 2, refutedClaims: 0 }`。
   - 影响：规则 C（`SCOPED_DEFENSE_REFINE`）在真实运行期几乎不可达，后验 `P_posterior` 也不反映真实证伪数，与 SPEC 中「实时反馈捕获 Γ_k」的设计存在偏差。
   - 验证方法：见 **EDGE-06**。

3. **「信息熵压降」是启发式展示值**
   - 现象：UI 中 `((1 - 1/modules.length) * 100)`（3 模块固定显示 67%），与真实测得的 `computeEntropyReductionRatio`（基于字符数）不同源。
   - 影响：仅影响观感可信度，不影响调度逻辑；但若用于对外汇报需标注口径。

---

## 7. 缺陷记录模板

```text
[缺陷编号] BUG-GFRAME-YYYYMMDD-NN
[关联用例] E2E-03
[严重级别] P0 / P1 / P2
[复现环境] 提交 <hash> | 主题 light/dark | 浏览器/桌面端
[前置条件]
[复现步骤]
  1.
  2.
[预期结果]（引用本文件对应用例的「预期结果」）
[实际结果]（附 modularState 快照 / 控制台日志 / 截图）
[影响模块]
[是否可回滚] 关联提交：<hash>
```

---

## 8. 回归留档表（每轮验证填写）

| 轮次 | 日期 | 基线提交 | `npm run lint` | `npm run test:cogno` | `cargo test -p shinobi-dev-mcp` | E2E 通过项 | 遗留缺陷 | 验证人 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R1 | 2026-10-13 | `a6f2647` | ✅ | ✅ 16/16 + G-Frame 7/7 | ✅ 9/9 | 未执行 | 见 §6 三项待确认 | — |
| R2 | | | | | | | | |

---

## 9. 建议的后续加固（可选）

若要将上述人工用例尽量自动化为「持续回归」，建议按序补齐：

1. 在 `test-gframe-bayesian-modular.ts` 增补：分流阈值边界（GF-03）、模块数上限截断（GF-05）、DSS 惩罚单调性（GF-09）、沙箱 Prompt 负向断言（GF-16）。
2. 新增 `test-gframe-fsm-loop.ts`：用纯函数模拟 App 层 FSM 接力，断言「N 个模块全部冻结后才会进入 arbitration」（对应 E2E-03，可先行红灯暴露问题）。
3. 为 `getNextSchedulableModule` 增加依赖成环检测与「无可行模块」的显式告警（对应 EDGE-03）。
4. 将 `EDGE-02 / EDGE-04` 的语义在 SPEC 中补明，或在 `initializeModularOrchestrationState` 中加硬校验。
```
