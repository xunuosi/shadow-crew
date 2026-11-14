# AGENTS.md

Shadow Crew —— 多 Agent 协同桌面应用（Tauri + React 19 + Vite）。

## 构建与校验

- 类型检查：`npm run lint`（即 `tsc --noEmit`）
- 前端开发：`npm run dev`
- 桌面端：`npm run dev:desktop`
- Rust MCP 工具测试：`cargo test -p shadow-crew-dev-mcp`

---

## 核心架构与博弈引擎技术文档索引（跨会话切换与维护必读）

在进行多 Agent 博弈编排（CognoNexus 4+1 引擎）、上下文裁剪、算力调控或仲裁决策相关功能的维护与演进前，**必须优先查阅以下技术架构文档**，确保改动符合既定的数学控制模型与论文理论边界：

- **[`docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md)**
  - **定位**：博弈论多 Agent 系统 **Token 消耗控制（7 大工程机制）** 与 **讨论结果趋真保障（9 大工程机制）** 全景技术报告。
  - **涵盖内容**：
    1. **Token 降本设计**：Wald-SPRT 序贯概率比早停与死锁熔断、LMAD 局部冲突切片（Top-5 限制）与三态上下文脱水、阶段靶点按需挂载与 `4 × 300` 滑动窗口截断、“静默即成功”协同公约与 `LoopGuard`、阶段契约有界 `Self-Refine`（`MAX_RETRIES=2`）、ColMAD 车轱辘话惩罚、BWM 0-Token 数学求解卸载与 `submit_arbitration_ruling` MCP 工具契约直通。
    2. **准确性趋真设计**：DIANOIA 4+1 角色正交解耦与 6 阶段 FSM、Free-MAD 反从众红队四部曲、T1/T2 分级物理接地验证与原子承诺校验链（含未实证早停硬锁）、BSS/DSS 谄媚偏见量化与 $\gamma$ 信任折减、ReConcile 异构模型检测与校准置信度矩阵、LLM+BWM 运筹求解与 $\xi^* \le 0.12$ 一致性硬门禁、ColMAD 非零和协同增量事实奖励、Disagreement-Aware 伴生《少数派异议报告》与黑天鹅重启触发器、法定人数门禁（Quorum Gate）与活体 ADR 决策画布（`LivingAdrCanvas`）。
    3. **学术支撑映射**：完整梳理 Free-MAD、ColMAD、LMAD、Wald-SPRT、DIANOIA、Sycophancy Propagation、Consistency Illusion/GDP、ReConcile、LLM+BWM、Disagreement-Aware 等 **10 篇核心论文** 与 `src/services/cogno/*` 源码函数的双向映射矩阵。
- **[`docs/SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md)**
  - **定位**：Shinobi "4+1" 认知决策与确定性博弈编排协议规范（FSM 状态迁移表、阶段 Prompt 靶点载荷规范、后仲裁落地执行闭环）。
- **[`docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md)**
  - **定位**：CognoNexus × G-Frame 贝叶斯与团队博弈驱动的模块化分治编排规范与落地方案（阶段 0 拓扑拆解与跨模块只读《公共接口契约》、模块级上下文物理隔离沙箱、贝叶斯先验分流与后验动态升降级、模块爆炸半径硬冻结与 Wave 1~3 实施路线图）。
- **[`docs/SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md`](file:///Users/xunuosi/Code/Lx/AI/shadow-crew/docs/SPEC_NORMAL_MODE_BUZZ_CONTEXT_AND_CONCURRENT_ORCHESTRATION.md)**
  - **定位**：普通协同模式（Channel 主消息流 & Topic 标准讨论模式 `discussionMode === 'standard'`）对标 `buzz-acp` 的增量上下文与并发协同编排设计规范（会话水位线 `<delta-events>` 未读增量提取与并发水位线不变量、冷启动 vs 热会话双态 Prompt 编译、首轮并发 Fan-out + `Promise.allSettled` Turn Barrier 轮次同步屏障、`aggregateTurnBarrierMentions` 跨回复 `@mention` 去重聚合与越界守卫）。

---

## 前端架构与 App.tsx 模块化分治体系（App Slimming Architecture）

为避免顶层入口 `src/App.tsx` 代码膨胀与关注点混杂，系统严格推行**「精简调度根 + 领域专用 Hook + 集中式弹窗容器」**的分治架构（Wave 2 全量模块化拆分，共 10 个 Hook + 1 个弹窗总控容器）：

```text
src/
├── App.tsx                              # 精简调度根（目标 <= 800 行）：顶层组装、领域 Hook 串联与主视图骨架
├── components/
│   └── AppModalsContainer.tsx           # 集中式弹窗容器：统一管理与 Suspense 按需加载所有业务弹窗
└── hooks/
    ├── useResizablePanel.ts             # 布局交互：侧边栏、主分栏与右侧抽屉拖拽缩放
    ├── useWorkspacePersistence.ts       # 工作区持久化：状态初始化/清洗、SQLite/LS 同步与原子提交
    ├── useSessionWarmState.ts           # 会话热状态：Standing Context/水位线、轮次代际与中断清理
    ├── useAcpRuntimeLifecycle.ts        # 运行时生命周期：ACP 进程/WS 探活、Tauri 事件、权限与 Agent CRUD
    ├── useChannelAndTopicCrud.ts        # 频道与议题 CRUD：频道/DM/Team、议题定案与子线程讨论
    ├── useNormalModeTurnOrchestrator.ts # 普通协同编排：Channel/标准模式 Turn Barrier 与 @mention 级联
    ├── useTopicTurnOrchestrator.ts      # 议题轮次调度：4+1 博弈首轮派发、G-Frame 校验与标准议题接力
    ├── useTopicExecutionPipeline.ts     # 落地执行管线：G-Frame 模块拓扑流水线与工作区 Diff 物理合入
    ├── useArbitrationConcurrence.ts     # 仲裁合流：运筹一致性求解、全员无异议征询与 Living ADR
    └── useGameTheoreticFsm.ts           # 博弈状态机：DIANOIA 4+1 阶段流转控制器 (Proposal->Arbiter)
```

### 1. 各分治模块职责划分

1. **`src/App.tsx`（精简调度根，目标 `<= 800` 行）**：
   - **职责**：仅负责顶层视图状态挂载、10 个领域 Hook 的依赖注入串联、轻量派生属性拼装，以及三栏主工作区骨架与 `AppModalsContainer` 的渲染。
2. **`src/components/AppModalsContainer.tsx`（集中式弹窗容器）**：
   - **职责**：将 Agent 团队管理（`AgentTeamsModal`、`CreateTeamModal`）、Agent 默认配置（`AgentDefaultsModal`）、ACP 权限仲裁与授权中心（`AcpPermissionModal`、`AcpPermissionCenterModal`）、本地 SQLite 存储缓存清理（`StorageSettingsModal`）、频道创建/成员/删除（`CreateChannelModal`、`ChannelMembersModal`、`DeleteChannelModal`）、ACP Agent 连接与配置（`ConnectAgentModal`）、议题新建与编辑（`NewTopicModal`、`EditTopicModal`）以及 Tauri 架构看板（`RustTauriArchitectureHub`）统一封装，主界面 JSX 彻底瘦身。
3. **`useResizablePanel.ts`（布局拖拽缩放 Hook）**：
   - **职责**：封装侧边栏、主工作区与议题抽屉的拖拽缩放交互、边界约束及宽度缓存持久化。
4. **`useWorkspacePersistence.ts`（工作区持久化与原子提交 Hook）**：
   - **职责**：接管工作区核心状态初始化与清洗（`sanitizeMessages`）、SQLite/LocalStorage 双向同步、`isWorkspaceHydratedRef` 防回退守卫、`migrateWorkspaceGraph` 迁移、TestChannel 修复、工作区/频道/Thread 派生上下文计算，以及同步更新 `messagesRef.current` 的 `commitMessages`、`getTopicData`、`updateTopicDataInState`。
5. **`useSessionWarmState.ts`（会话热状态与中断清理 Hook）**：
   - **职责**：接管 ACP 会话热状态（Standing Context 与水位线 `sessionWatermarksRef`）、轮次代际防串台追踪（`captureTurnEpoch`、`isTurnStale`）、并发执行/级联状态表（`activeExecutions`、`activeCascades`）、`inFlightHandoverRef` / `stageRefineRetriesRef` 状态锁，以及 `safelyClearAcpSessions`、`handleAbortAgent`、`handleAbortAll`、`handleClearAllMessages`。
6. **`useAcpRuntimeLifecycle.ts`（ACP 运行时生命周期与 Agent 管理 Hook）**：
   - **职责**：接管本地子进程拉起与后端运行态对齐（`syncRunningAgentsWithBackend`、`spawnLocalAcpAgent`）、远端 WS 健康探活（`runRemoteAgentProbe`、`cancelRemoteAgentProbe`）、Tauri 运行期事件订阅（权限请求/状态变更/心跳/流式分片/会话重置）、`logRpc` 日志、ACP 权限仲裁响应，以及 Agent CRUD（更新、连接、复制、专家包导入、启停、删除）。
7. **`useTopicExecutionPipeline.ts`（议题落地执行管线 Hook）**：
   - **职责**：封装 G-Frame 模块化分治流水线串行落地（DAG 拓扑偏序、白名单受限提示词编译、多阶段 Diff 增量合并）、标准单轮落地执行以及基于 `applyTopicPatchToWorkspace` 的物理合入逻辑。对外暴露 `dispatchTopicExecution`、`handleExecuteTopicPatch`、`handleApplyTopicPatch`。
8. **`useChannelAndTopicCrud.ts`（频道、DM 与议题 CRUD Hook）**：
   - **职责**：接管频道创建/成员更新/切换/删除、私聊 DM 与团队 Thread 启动、议题创建/编辑/打开/敲定（`handleResolveTopic`）/重开（`handleReopenTopic`）、子线程讨论同步（`handleSendSubMessage`、`handleSyncBackToMainThread`）及消息表情反馈（`handleAddReaction`）。
9. **`useArbitrationConcurrence.ts`（仲裁合流与无异议征询 Hook）**：
   - **职责**：封装综合裁定官发言完毕后的 MCDA 运筹求解、ColMAD 事实贡献报表、裁决草案持久化、全员无异议征询状态机推进、一致性硬门禁校验以及终局活体 ADR（Living ADR Canvas）生成。对外暴露 `processArbitrationConcurrence`。
10. **`useGameTheoreticFsm.ts`（博弈状态机控制器 Hook）**：
    - **职责**：接管 Shinobi DIANOIA 4+1 博弈推演全周期状态流转控制器（Proposal 提案立论 → Challenge Free-MAD 质询 → Verification 原子接地实证 → Defense 答辩修正 → Arbitration 仲裁交接），严格维护 `inFlightHandoverRef` 并发交接锁与 `stageRefineRetriesRef` 有界重试。对外暴露 `triggerGameTheoreticStageHandover`。
11. **`useNormalModeTurnOrchestrator.ts`（普通协同模式轮次编排 Hook）**：
    - **职责**：接管 Channel 主消息流与普通协同级联编排（`dispatchCascadingAgentResponse`、`handleSendMessage`），严格落实 `Promise.allSettled` Turn Barrier、跨回复 `@mention` 去重聚合、Channel Guard、`LoopGuard` 及水位线增量提取与同步提交。
12. **`useTopicTurnOrchestrator.ts`（议题讨论轮次调度 Hook）**：
    - **职责**：接管议题消息发送与博弈/标准双轨入口（`handleSendTopicMessage`），涵盖 DM Topic / DM 辩论、Channel Guard、4+1 博弈首轮派发与续跑、G-Frame 白名单正交审计通知（N5）、`fast_track` 验证官校验与不可变降级处理（N8/N10/N12），以及标准议题 Turn Barrier 级联交接。

### 2. 状态与依赖拓扑设计

- **自下而上的单向 DAG 依赖链**：
  `useWorkspacePersistence`（持久化底座与原子状态提交）
  → `useSessionWarmState`（热态水位线、代际锁与中断能力）
  → `useAcpRuntimeLifecycle`（ACP 运行时进程/探活与权限监听）
  → `useTopicExecutionPipeline`（G-Frame 拓扑执行与物理合入能力）
  → `useChannelAndTopicCrud`（频道/议题 CRUD 与敲定派发）
  → `useArbitrationConcurrence`（仲裁运筹求解与无异议合流，触发 `handleResolveTopic`）
  → `useGameTheoreticFsm`（4+1 阶段状态机接力，阶段 5 触发 `processArbitrationConcurrence`）
  → `useNormalModeTurnOrchestrator`（普通协同 Turn Barrier 与 `@mention` 级联）
  → `useTopicTurnOrchestrator`（议题入口调度，串联级联编排、博弈接力与仲裁合流）
  （`useResizablePanel` 独立负责 UI 布局尺寸状态，`AppModalsContainer` 由 `App.tsx` 统一装配）。
- **严格回归保护**：任何涉及上述编排 Hook 的重构与调整，均受已有 13 套自动化测试套件（`npm run test:cogno`）、边界探测套件（`npm run test:cogno:edge`）与 TypeScript 编译（`npm run lint`）的严格无缝校验。

### 3. 单文件代码体量红线与模块化编码规范（File Size & Modularity Governance）

1. **`src/App.tsx` 顶层调度根硬上限（`<= 800` 行）**：仅允许包含顶层状态挂载、领域 Hook 组装、轻量派生视图与三栏骨架 JSX；严禁在 `App.tsx` 中直接编写超过 30 行的业务事件处理函数、ACP 协议拼装、SQLite/LocalStorage 读写迁移或博弈状态机分支。
2. **UI 组件（`src/components/*.tsx`）体量阈值（预警线 `600` 行，硬上限 `1,000` 行）**：超过阈值必须按「容器组件 + 独立子视图/卡片组件 + 局部交互 Hook」拆解，严禁在单文件内堆叠多个独立业务面板或内联复杂状态计算。
3. **领域 Hook（`src/hooks/*.ts`）与服务层（`src/services/*.ts`）单一职责边界**：每个 Hook 必须聚焦单一业务域；纯算法、Prompt 编译与状态转换函数必须下沉至 `src/services/` 纯函数模块并配备独立可追溯测试，严禁将纯计算逻辑耦合在 React 组件或 Hook 闭包内。
4. **禁止内联巨型 JSX 回调**：向子组件传递 Props 时，超过 15 行的业务逻辑必须提取为 Hook 内部的具名 `useCallback` / handler，禁止在 JSX 属性上直接编写长篇匿名异步函数。

---

## 变更交付准则：必要性回归测试与原子化 Git 提交（强制规则）

为保证代码改动的高可靠性与历史可回溯性，任何功能新增、逻辑重构或 Bug 修复均必须严格遵循**「完成修改 -> 必要性回归测试 -> 即时 Git 提交」**的标准闭环：

### 1. 每次修改后的必要性回归测试（Verification Checklist）

每次完成代码变更后，**严禁未经校验直接宣布完成或交付**，必须执行以下基线验证：

1. **类型与语法基线（静态检查）**：必须执行 `npm run lint`（即 `tsc --noEmit`），确保无任何 TypeScript 类型报错与语法隐患。
2. **生产构建校验（构建检查）**：涉及构建配置、全局状态、依赖变动或核心公共模块修改时，执行 `npm run build`，确保打包无阻断性错误。
3. **功能与交互自证（运行期验证）**：涉及 UI 交互、协议对接、状态存取等改动，必须在运行期环境下进行真实场景自测，验证改动符合预期，且未引入次生 Bug。

### 2. 通用测试设计与有效性门槛（强制规则）

测试用例必须从规范、契约和真实状态迁移反推，不得只围绕当前实现编写“预期会通过的断言”。**断言数量不等于覆盖范围，happy path 通过不等于功能完整。**

1. **规范可追溯（Spec-to-Test Traceability）**
   - 每项强制契约、禁止项、状态枚举、优先级和失败策略，都必须映射到至少一个可执行测试。
   - 测试报告必须明确列出对应规范条目、测试层级、输入、预期结果和证据。
   - 文档声明了协议字段、配置优先级或生命周期行为时，必须有测试证明实现真正消费并执行了该契约。

2. **分层证据不可越级替代（Layered Verification）**
   - **单元/纯函数层**：状态判定、序列化、配置归并、边界算法。
   - **协议/适配器层**：fake ACP、stdout/JSON-RPC、超时、迟到响应、非法字段与取消。
   - **宿主集成层**：React 状态 → Tauri IPC → Rust 状态机 → 持久化与回读。
   - **真实运行期层**：真实 ACP 端点/模型、启停、重启、远程连接和多 Session。
   - 下层测试通过不得替代上层证据。例如 adapter 直连 E2E 不能证明 Tauri 生命周期、远程状态轮询或 UI 状态同步正确。

3. **反例与状态空间矩阵（Negative/State Matrix）**
   - 必须覆盖字段缺失、`null`、非法类型、显式 `false`、`unknown`、`disabled`、`unsupported` 等状态。
   - 必须验证用户配置与宿主策略冲突时的明确优先级，禁止只测试默认配置。
   - 涉及异步初始化时，必须覆盖冷启动超时、迟到响应、重复响应、取消与进程退出。
   - 涉及本地/远程双通道时，必须分别验证启动、停止、状态轮询、断线和能力探测结果合并。

4. **生命周期与持久化验证（Lifecycle/Persistence）**
   - 功能测试至少覆盖创建、编辑、复制、启动、停止、重启和应用重新加载。
   - 必须区分“持久化配置”和“运行期探测结果”：握手能力默认应重新探测，不得复用上次进程的旧状态冒充当前状态。
   - 涉及 Session、缓存或记忆时，必须验证清理、恢复和不清理三类边界及其对前端状态的同步结果。

5. **真实 UI 状态矩阵（UI State Matrix）**
   - UI 改动必须在真实桌面运行期检查，不得只用源码扫描或静态页面代替。
   - 双主题必须覆盖全局 `light/dark` × 组件内部主题模式 × `enabled/disabled/unknown/unsupported/false` 状态组合。
   - 强制设置 `data-theme` 只能作为辅助视觉检查，不能替代真实主题切换、交互联动和状态保存回读。
   - 必须检查窄分栏、弹窗底部、长文案和横向溢出，不得只截图默认首屏。

6. **独立性、故障注入与防确认偏误**
   - 功能实现完成后，必须至少执行一次基于规范和代码路径的反向审查，而不是继续补同类型 happy path。
   - 优先构造能推翻当前结论的测试：非法输入、错误先后顺序、竞态、超时、配置覆盖和重启残留。
   - 对高风险的协议、状态机、并发与持久化改动，应使用独立 Agent、独立测试夹具或独立审查清单复核。

7. **测试结论与报告真实性**
   - 报告必须说明哪些层是真实运行期，哪些是 fake/mock/浏览器同源验证，以及明确未覆盖的层。
   - 未执行真实 Tauri、远程端点、重启恢复或故障注入时，不得写作“全链路通过”或“无缺陷”。
   - 外部模型/服务限制造成的失败必须单独标为环境边界，不得用“主链路通过”掩盖。
   - 发现确定性缺陷时，测试报告结论必须降级为“部分通过/条件通过”，并在修复和回归完成前阻止交付。

### 3. 测试通过后即时 Git 提交（Atomic Git Commit）

测试完成后，必须立即在本地完成 Git 提交，以便后续修改一旦出现偏离或错误能迅速回滚：

1. **原子化提交**：每个功能点或修复闭环对应独立的 commit，禁止将多个无关功能的修改长时间堆积在 Working Tree 中不提交。
2. **语义化信息（Semantic Commit Message）**：提交信息必须清晰准确，说明改动模块与动因（如 `feat(model): ...`、`fix(agent-modal): ...`、`chore(rules): ...`）。
3. **保障安全回滚（Safe Rollback）**：通过保持高频、干净的本地提交历史，确保任何时候出现逻辑错误或调试失败时，均能通过 `git checkout` / `git reset` / `git revert` 精准、快速地一键回滚到稳定状态，避免返工。

---

## 核心编码准则：数据治理与反"伪兼容"原则（强制规则）

为避免因 AI 盲目编写防卫性代码导致系统架构腐化与逻辑泥潭，所有参与本项目的 AI Agent 必须严格遵循以下数据治理准则：

### 1. 明确区分数据属性：直接清理 vs 正规迁移

当底层字段、数据结构或协议接口演进导致旧数据不匹配时，**严禁未经区分就直接在业务代码里堆砌"向前兼容"逻辑**：

- **调试期临时数据 / Bug 脏数据（无真实业务价值）**：
  - **原则**：**直接从数据源清理（Clean at Source），绝不在业务代码层做防御性兜底**。
  - **处理手段**：重置 LocalStorage、清理本地 SQLite/缓存、或手动删除无效项。代码层只面向最新干净的数据结构编写。
  - **严禁**：在组件或服务中编写 `oldField || newField`、字段猜测回退或静默容错逻辑去容忍调试期的历史脏数据。
- **正式用户数据 / 实际业务演进数据（有真实业务价值）**：
  - **原则**：**集中正规迁移（Explicit Versioned Migration），严禁散落隐式兼容**。
  - **处理手段**：在数据加载/反序列化入口处编写显式版本迁移函数（例如 `migrateFromV1ToV2`），在数据进入业务流之前一次性升级为规范结构。
  - **严禁**：将新旧字段的兼容判断散落渗透到 UI 渲染、表单组装或后端调用逻辑中。

### 2. 严禁编写的"屏蔽性与猜测性代码"（反模式清单）

在任何新功能开发、重构或 Bug 修复中，**绝对禁止**以下防御性反模式：

1. **禁止隐式回退读取**：严禁在业务逻辑中保留对已废弃字段的回退读取（例如 `const key = current.key || old.deprecatedKey`）。
2. **禁止模式与后缀猜测**：严禁根据命名模式猜意图（例如通过 `key.endsWith('_API_KEY')`、`key.includes('BASE_URL')` 模糊猜测并提取凭证）。
3. **禁止反向污染注入**：严禁在保存数据或拉起进程时，自作聪明地为数据对象或环境变量补齐/回写已废弃的历史字段。
4. **禁止屏蔽性静默吞错**：严禁编写仅为了"屏蔽旧数据格式报错"而存在的空对象吸收器或静默过滤补丁。

---

## 历史调试字段黑名单（永久封存，无需任何代码兼容）

以下环境变量属于早期调试遗留，已从全局模型配置与 Agent 数据中彻底废弃并清理：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `SHINOBI_MODEL`
- `LLM_MODEL`

**执行要求**：
- 严格遵循上述数据治理原则，**代码层已将其全部拔除，严禁任何形式的死灰复燃**。
- 若本地存储中仍残留这些 key，按废弃的测试脏数据对待（由用户或清理工具直接重置），不要在代码层做任何自动适配或迁移读取。
- **边界说明**：外部独立 ACP 运行时自身强依赖的进程级启动环境变量（例如 Claude Code 官方进程自身运行所必需的 `ANTHROPIC_API_KEY`）属于目标子进程运行配置，非本系统内部模型数据，按正常环境变量对待，不要误删。

---

## UI 视觉与双主题配色准则（白昼 / 暗夜高对比度强制规范）

为彻底杜绝纯白主题（`data-theme="light"`）或暗夜主题（`data-theme="dark"`）下出现「浅色字叠浅色底」「深色字叠深色底」等可读性缺陷，所有 UI 组件开发与样式修改必须严格遵循以下设计系统规范（对标 **GitHub Primer**、**Radix Colors 12 阶色彩体系** 与 **Linear**）：

### 1. Tailwind v4 `dark:` 变体与主题令牌强制绑定规则

1. **严禁跟随系统媒体查询触发 `dark:*`**：
   - `src/index.css` 必须保留 `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`，确保所有 `dark:*` 工具类仅在 `<html data-theme="dark">` 下生效，绝不因用户操作系统处于深色模式而污染应用的纯白主题。
2. **强调色实心按钮必须显式配对前景色**：
   - 凡使用 `bg-accent` 的实心主按钮，必须成对声明 `text-accent-fg`（映射自 `--color-accent-fg` / `--color-accent-text`），严禁遗漏文本颜色类名导致回退为浏览器默认黑字。

### 2. 基础表面与三级文本层级规范（Base & Typography Tokens）

| 语义角色 | CSS 变量 / Tailwind 类 | 纯白主题 (`data-theme="light"`) | 暗夜主题 (`data-theme="dark"`) | 使用规范 |
| :--- | :--- | :--- | :--- | :--- |
| **应用底层画布** | `--bg-canvas` (`bg-canvas`) | `#F4F6FA`（冷灰白） | `#080B11`（深邃曜石黑） | 承载顶层工作区面板，拉开背景层次 |
| **卡片/面板主背景** | `--bg-surface` (`bg-surface`) | `#FFFFFF`（纯白） | `#111724`（深蓝灰面板） | 卡片、抽屉、弹窗主基底，保持纯净阅读面 |
| **次级/内嵌容器** | `--bg-surface-subtle` (`bg-surface-subtle`) | `#F8FAFC`（Slate-50） | `#0D121C`（内凹深底） | 代码块、折叠区、次级信息栏 |
| **悬浮态背景** | `--bg-surface-hover` (`bg-surface-hover`) | `#F1F5F9`（Slate-100） | `#182233`（Slate-850） | 列表项、次级按钮 Hover 态 |
| **一级主文本** | `--text-primary` (`text-fg`) | `#0F172A`（Slate-900） | `#F8FAFC`（Slate-50） | 标题、正文、核心结论（对比度 > 16:1） |
| **二级次要文本** | `--text-secondary` (`text-fg-secondary`) | `#334155`（Slate-700） | `#94A3B8`（Slate-400） | 摘要描述、列表项、元数据说明 |
| **三级辅助文本** | `--text-muted` (`text-fg-muted`) | `#64748B`（Slate-500） | `#64748B`（Slate-500） | 时间戳、占位符、次要图标（严禁在浅底上叠加低于 `0.8` 的透明度导致隐形） |

### 3. 五大业务状态语义色搭配表（Semantic Status Palette）

所有状态胶囊（Badge）、裁决横幅、执行落地舱、告警提示条，**严禁只写单一色阶（如仅写 `text-emerald-400` 或 `text-emerald-500`）**，必须严格按以下双主题组合编写（确保 WCAG AA/AAA 对比度 $\ge 6.5:1$）：

| 状态语义 | 适用场景 | 维度 | 纯白主题 (`light`) 强制类名 | 暗夜主题 (`dark`) 强制类名 |
| :--- | :--- | :--- | :--- | :--- |
| **🟢 成功 / 采纳**<br>(`Success / Adopt`) | 仲裁采纳主导、达成共识、合入完成 | **文字色**<br>**图标色**<br>**背景色**<br>**边框色** | `text-emerald-800` (`#065F46`)<br>`text-emerald-600` (`#059669`)<br>`bg-emerald-50` (`#ECFDF5`)<br>`border-emerald-300` (`#6EE7B7`) | `dark:text-emerald-300` (`#6EE7B7`)<br>`dark:text-emerald-400` (`#34D399`)<br>`dark:bg-emerald-500/15`<br>`dark:border-emerald-500/30` |
| **🟣 权衡 / 议题**<br>(`Purple / Matrix`) | 权衡矩阵裁决、`TOPIC` 标签、进行中、仲裁官 | **文字色**<br>**图标色**<br>**背景色**<br>**边框色** | `text-purple-800` (`#5B21B6`)<br>`text-purple-600` (`#7C3AED`)<br>`bg-purple-50` (`#F5F3FF`)<br>`border-purple-300` (`#D8B4FE`) | `dark:text-purple-300` (`#D8B4FE`)<br>`dark:text-purple-400` (`#C084FC`)<br>`dark:bg-purple-500/15`<br>`dark:border-purple-500/30` |
| **🟡 博弈 / 预警**<br>(`Warning / Game`) | 博弈推演中、排队等待、文件冲突预警 | **文字色**<br>**图标色**<br>**背景色**<br>**边框色** | `text-amber-800` (`#92400E`)<br>`text-amber-600` (`#D97706`)<br>`bg-amber-50` (`#FFFBEB`)<br>`border-amber-300` (`#FCD34D`) | `dark:text-amber-300` (`#FCD34D`)<br>`dark:text-amber-400` (`#FBBF24`)<br>`dark:bg-amber-500/15`<br>`dark:border-amber-500/30` |
| **🔴 挑战 / 驳回**<br>(`Danger / Reject`) | 采纳挑战驳回重构、红队挑战者、执行异常 | **文字色**<br>**图标色**<br>**背景色**<br>**边框色** | `text-rose-800` (`#9F1239`)<br>`text-rose-600` (`#E11D48`)<br>`bg-rose-50` (`#FFF1F2`)<br>`border-rose-300` (`#FDA4AF`) | `dark:text-rose-300` (`#FDA4AF`)<br>`dark:text-rose-400` (`#FB7185`)<br>`dark:bg-rose-500/15`<br>`dark:border-rose-500/30` |
| **🔵 主导 / 执行**<br>(`Info / Proposer`) | 主导提案方、正在执行补丁、信息提示 | **文字色**<br>**图标色**<br>**背景色**<br>**边框色** | `text-blue-800` (`#1E40AF`)<br>`text-blue-600` (`#2563EB`)<br>`bg-blue-50` (`#EFF6FF`)<br>`border-blue-300` (`#93C5FD`) | `dark:text-blue-300` (`#93C5FD`)<br>`dark:text-blue-400` (`#60A5FA`)<br>`dark:bg-blue-500/15`<br>`dark:border-blue-500/30` |

### 4. 容器背景去过度染色与分栏防溢出原则

1. **禁止纯白主题下多层半透明同色背景叠加**：
   - 外层大卡片（如 `TopicMessageCard`）在纯白主题下必须保持干净的 `bg-surface`（`#FFFFFF`），通过**左侧高饱和度状态色条 + 边框色 + 顶部语义胶囊**传递状态，禁止整卡大面积涂绿/涂紫。
   - 有色状态块（如 `bg-emerald-50/70`）内部嵌套的子卡片（如「核心架构权衡点」「落地推进方案」），在纯白主题下必须使用实色 `bg-surface border-border` 隔离底色，确保正文阅读锐利清晰。
2. **多栏布局卡片自适应防溢出**：
   - 处于可缩放分栏（Sidebar + Timeline + Drawer）内的组件，**严禁使用基于视口宽度的 `sm:flex-nowrap` 锁死单行**；必须使用 `flex-wrap`、外层 `overflow-hidden min-w-0 w-full` 以及右侧操作项 `ml-auto shrink-0`，确保任意分栏宽度下零横向出界。

