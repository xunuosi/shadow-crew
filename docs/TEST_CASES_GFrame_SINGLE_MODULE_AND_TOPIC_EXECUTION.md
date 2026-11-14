# 🧪 G-Frame 单模块/LLM 红队路由与议题落地执行管线测试用例

> **文档版本**：v1.0.0
>
> **测试日期**：2026-11-14
>
> **代码基线**：`90ccdee` 之后的 2026-11-14 修复工作区
>
> **测试范围**：
> - `6092e8e`：G-Frame 1~4 模块、LLM 自主红队路由、答辩收敛
> - `47edaed`：落地执行重入守卫、中断清理、模块断点续跑、Rollup 清理与消息排序
>
> **关联规范**：
> - [`SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md`](./SPEC_GFRAME_BAYESIAN_MODULAR_ORCHESTRATION.md)
> - [`SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md`](./SPEC_GAME_THEORETIC_ORCHESTRATION_PROTOCOL.md)
> - [`TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md`](./TECH_REPORT_GAME_THEORETIC_TOKEN_AND_ACCURACY_GOVERNANCE.md)

---

## 1. 结论摘要

本轮完成了 TypeScript/Rust 自动回归、LLM 路由与答辩收敛纯函数探针、MCP JSON-RPC 单模块实测、ACP 载荷提取探针、执行状态收敛专项测试与关键源码路径审查。

**修复后结论：自动化层通过；真实 ACP 与 Tauri 运行期仍需按第 7 节复验，因此可判“自动化验收通过、运行期待确认”。**

本轮已修复并验证：

1. MCP `submit_module_decomposition` 的 Schema 与执行层统一为 1~4 个模块；单模块、空数组、超过 4 个模块均有断言。
2. 原生 MCP 与结构化 JSON 两条 ACP 提取路径均接受单模块，不再静默丢弃。
3. `routing_rationale` 已贯通 MCP Schema、TypeScript 类型、ACP 提取、模块初始化和 MCP 文本输出。
4. stale/中断统一通过纯状态收敛器处理：释放执行锁、结束 pending 气泡、`running/queued -> failed`、清空活动模块，并保留 completed 模块和 Diff。
5. 新增 `test:execution` 并纳入 `test:cogno`，覆盖同议题重入、跨议题忙碌、断点续跑种子、Diff 保留和中断收敛。
6. G-Frame SPEC、旧 TEST PLAN 与边界探测标题已同步到 1~4 模块和 LLM 自主路由契约。

---

## 2. 本轮实际执行结果

| 层级 | 命令/探针 | 实际结果 | 判定 |
| :--- | :--- | :--- | :--- |
| L0 | `npm run lint` | 退出码 0，无 TypeScript 报错 | ✅ 通过 |
| L0 | `npm run build` | Vite 构建成功；仅保留既有 chunk 体积警告 | ✅ 通过 |
| L0 | `cargo test -p shadow-crew-dev-mcp` | `18 passed; 0 failed` | ✅ 通过 |
| L0 | `cargo test --manifest-path src-tauri/Cargo.toml db_manager` | `8 passed; 0 failed` | ✅ 通过 |
| L1 | `npm run test:cogno` | 全部套件通过，包含 `[Test 15]` 与新增执行治理套件 | ✅ 通过 |
| L1 | `npm run test:cogno:edge` | `DEFECT 0 / WARN 0` | ✅ 基线通过 |
| L1 | MCP 单模块调用（Rust 工具层） | `18/18`，含单模块成功与空/超限拒绝 | ✅ 通过 |
| L1 | ACP 单模块载荷提取 | 原生 MCP 与结构化 JSON 均返回 `modules.length=1` | ✅ 通过 |
| L1 | 任意关键词 + `requiresRedTeam=false` | `fast_track`，未命中硬编码词表 | ✅ 通过 |
| L1 | `requiresRedTeam=true` + `low_deterministic` | 强制 `deep_debate` | ✅ 通过 |
| L1 | 单模块初始化 | 保留 1 个模块 | ✅ 通过 |
| L1 | 空模块初始化 | 兜底生成 2 个模块 | ✅ 通过 |
| L1 | `npm run test:execution` | 重入、忙碌、断点续跑、失败收敛全部通过 | ✅ 通过 |
| L1 | Test 15 干净答辩 | `FREEZE_MODULE`，历史证伪清零，进入 `arbitration` | ✅ 通过 |
| L1 | Test 15 新证伪 | `SCOPED_DEFENSE_REFINE`，回环 `challenge` | ✅ 通过 |
| L1 | Test 15 新契约越界 | `SCOPED_DEFENSE_REFINE`，回环 `challenge` | ✅ 通过 |
| L2 | 真实 ACP 单模块全链路 | 本轮未执行 | ⏸️ 待执行 |
| L3 | Tauri 桌面启动与议题界面 smoke | 应用启动成功，既有频道/议题/输入区正常渲染，无运行时异常 | ✅ 烟雾通过 |
| L3 | 双击、执行中停止、强退重启、双主题与窄分栏 | 本轮未执行 | ⏸️ 待执行 |

> 真实 ACP、应用重启、双击竞态和 Tauri UI 未执行时，不得写作“全链路通过”或“无缺陷”。

---

## 3. 缺陷与证据

| 缺陷 ID | 优先级 | 现象 | 期望 | 证据 |
| :--- | :--- | :--- | :--- | :--- |
| **GF-DEF-01** | P0 | MCP Schema 与执行层模块数范围不一致 | Schema 与执行层统一为 1~4 | ✅ 已修复，Rust 18 项测试通过 |
| **GF-DEF-02** | P0 | 单模块 ACP 载荷被提取器丢弃 | 1 个合法模块必须原样返回 | ✅ 已修复，原生 MCP + JSON 块双路径断言通过 |
| **GF-DEF-03** | P1 | `routing_rationale` 未贯通类型/提取/状态 | 应映射为 `routingRationale?: string` 并可追溯 | ✅ 已修复并断言 |
| **EX-DEF-01** | P0 | stale 后直接返回，`running` 可能永久残留 | 立即收敛为 `failed`、清理运行态和活动模块 | ✅ 已修复，统一收敛器测试通过 |
| **TEST-DEF-01** | P1 | 新执行逻辑缺少专项自动化 | 覆盖重入、stale、断点续跑、启动恢复状态迁移 | ✅ 已新增 `test:execution` 并纳入 `test:cogno` |
| **DOC-DEF-01** | P2 | 规范仍写 2~4 模块和关键词正则 | 与当前 1~4、LLM 自主路由契约一致 | ✅ SPEC、TEST PLAN、EDGE 标题已更新 |

---

## 4. G-Frame 1~4 模块与 LLM 红队路由用例

### 4.1 单模块与模块数量边界

| 用例 ID | 优先级 | 层级 | 输入 / 操作 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GF-SM-01** | P0 | MCP Schema | `tools/list` 检查 `submit_module_decomposition.inputSchema.properties.modules` | `minItems=1`、`maxItems=4` | ✅ 通过 |
| **GF-SM-02** | P0 | MCP 执行 | 提交 1 个合法模块 | `isError=false`，返回 1 个模块 | ✅ 通过 |
| **GF-SM-03** | P0 | ACP 提取 | `mcpToolCalls` 或 JSON 块仅含 1 个模块 | 返回草案且 `modules.length=1` | ✅ 通过 |
| **GF-SM-04** | P0 | 纯函数初始化 | 直接传入 1 个模块调用 `initializeModularOrchestrationState` | 不补齐第 2 个模块；`activeModuleId=该模块` | ✅ 通过 |
| **GF-SM-05** | P1 | 纯函数初始化 | 传入空数组 | 兜底生成 2 个模块 | ✅ 通过 |
| **GF-SM-06** | P1 | 边界 | 传入 2、3、4 个模块 | 全部保留，模块顺序符合拓扑依赖 | ✅ 通过 |
| **GF-SM-07** | P1 | 边界 | 绕过 Schema 向 MCP 执行层传 5 个模块 | 明确拒绝，返回范围错误 | ✅ 预期拒绝，当前 `<2 || >4` 覆盖 |
| **GF-SM-08** | P2 | 初始化 | 直接向初始化器传 5 个模块 | 明确策略：拒绝或截断至 4，并记录/提示 | ⚠️ 当前静默 `slice(0,4)`；需确认是否符合契约 |

### 4.2 LLM 自主红队路由

| 用例 ID | 优先级 | 输入 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- |
| **GF-RT-01** | P0 | `low_deterministic`、1 文件、职责文本故意包含“并发/锁/事务/鉴权/迁移”、`requiresRedTeam=false` | 不因关键词升级；`priorRisk=0.20`、`fast_track` | ✅ 通过 |
| **GF-RT-02** | P0 | `low_deterministic`、`requiresRedTeam=true` | 即使先验风险低也强制 `deep_debate` | ✅ 通过 |
| **GF-RT-03** | P0 | `low_deterministic`、`requiresRedTeam=false` | `fast_track` | ✅ 通过 |
| **GF-RT-04** | P0 | `high_critical`、未声明 `requiresRedTeam` | 按先验阈值走 `deep_debate` | ✅ 通过 |
| **GF-RT-05** | P0 | 提案官未调用 MCP、系统走保守兜底 | 所有兜底模块 `requiresRedTeam=true`，禁止按关键词放行 fast-track | ✅ 通过 |
| **GF-RT-06** | P1 | MCP 载荷含 `routing_rationale` | 提取结果保留为 `routingRationale`，可在状态审查中追溯 | ✅ 通过 |
| **GF-RT-07** | P1 | `requires_red_team` 缺失、`null`、字符串 `"true"` | 缺失/null 不强制；字符串不按布尔 true 解释 | ⚠️ 源码审查仅接受真实 boolean；待补断言 |
| **GF-RT-08** | P1 | 同一份文本分别声明 `true` 与 `false` | 路由结果只由显式声明和复杂度决定，与文本关键词无关 | ✅ 通过 |

### 4.3 答辩收敛（Test 15 扩展）

前置状态：模块在 verification 阶段已有 `verifiedClaims=1、refutedClaims=1`，当前进入 defense，且重修次数为 0。

| 用例 ID | 优先级 | defense 反馈 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- |
| **GF-DF-01** | P0 | `verifiedClaims=1、refutedClaims=0、contractViolations=0` | 消解历史证伪；`FREEZE_MODULE`；不回弹；最终进入 `arbitration` | ✅ 通过 |
| **GF-DF-02** | P0 | `verifiedClaims=1、refutedClaims=1、contractViolations=0` | 保留新证伪；`SCOPED_DEFENSE_REFINE`；回到 `challenge` | ✅ 通过 |
| **GF-DF-03** | P0 | `verifiedClaims=1、refutedClaims=0、contractViolations=1` | 契约越界优先级高于正向实证；不得冻结 | ✅ 通过 |
| **GF-DF-04** | P1 | `verifiedClaims=0、refutedClaims=0、contractViolations=0`，但历史证伪仍为 1 | 不得擅自清零；继续局部重修 | ✅ 通过 |
| **GF-DF-05** | P1 | 多模块场景中 M1 干净答辩 | M1 冻结，M2 保持原状态，下一阶段为 M2 `proposal` | ⏸️ 建议补专项断言 |
| **GF-DF-06** | P1 | 达到局部重修上限后仍有证伪/越界 | 按有界熔断策略收敛并记录原因，不得死循环 | ⏸️ 建议补专项断言 |

---

## 5. 议题落地执行管线用例

### 5.1 并发重入与断点续跑

| 用例 ID | 优先级 | 前置条件 | 操作 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EX-RE-01** | P0 | 同议题、同执行官已在 `activeExecutionsRef` | 连续调用两次 `dispatchTopicExecution` | 只发送 1 次 ACP Prompt；第二次立即跳过 | ✅ 守卫逻辑已有专项测试；真实双击待 UI 验证 |
| **EX-RE-02** | P1 | 同议题但两个不同执行官 | 并发派发 | 行为需明确；若产品只允许一个执行者，应只允许 1 次 | ⏸️ 需产品契约确认 |
| **EX-RE-03** | P0 | 3 模块，M1 已完成且有 `executionDiffs` | 应用重启后重新派发 | 跳过 M1，保留并合并 M1 Diff，只执行 M2/M3 | ✅ 续跑种子测试通过；真实重启待验证 |
| **EX-RE-04** | P0 | 3 模块，M1 完成、M2 failed、M3 pending | 重试执行 | M1 不重跑；M2 重跑；M3 继续等待依赖 | ⏸️ 需专项测试 |
| **EX-RE-05** | P1 | 同执行官正在其他议题执行 | 派发当前议题 | 当前议题进入 `queued`；前序完成后转为 `running` | ⏸️ 需真实运行期验证 |
| **EX-RE-06** | P1 | 队列等待期间用户中断 | 触发 abort | `queued -> failed`，不启动 ACP | ✅ 源代码分支存在，建议补测试 |
| **EX-RE-07** | P1 | 双击“执行”按钮 | 10ms 内两次点击 | 不产生两个 pending 气泡、不重复调用 ACP、不重复累计 Diff | ⏸️ 必须真实 UI 验证 |

### 5.2 中断、stale 与重启恢复

| 用例 ID | 优先级 | 场景 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- |
| **EX-IN-01** | P0 | 标准执行请求在 ACP 返回前被 abort | `executionStatus=failed`，pending 消息结束，活动执行锁释放 | ⏸️ 待真实 ACP |
| **EX-IN-02** | P0 | ACP 已成功返回，但消费响应前轮次被 abort/stale | `executionStatus=failed`；不得保留 `running`；不得写入成功完成消息 | ✅ 统一收敛器测试通过；真实 ACP 待验证 |
| **EX-IN-03** | P0 | G-Frame M1 成功后、M2 请求前 abort | M1 保持 completed 且保留 Diff；当前 running 模块置 failed；topic 置 failed | ⏸️ 待专项测试 |
| **EX-IN-04** | P0 | G-Frame 某模块 ACP 成功返回后 stale | 当前模块置 failed；topic 不得停在 running | ✅ 统一收敛为 failed，保留 completed 模块 |
| **EX-IN-05** | P0 | 应用崩溃/重启时持久化状态为 `running` | 加载后自动变为 `failed`，running 模块变为 failed，活动模块清空 | ⚠️ 源码恢复逻辑存在，缺重启实测 |
| **EX-IN-06** | P0 | 应用崩溃/重启时持久化状态为 `queued` | 加载后自动变为 `failed` | ⚠️ 同上 |
| **EX-IN-07** | P1 | `executionStatus=running` 但 `activeExecutions` 为空 | 抽屉顶部显示“执行已中断”，并提供重试入口 | ⚠️ 状态文案存在；重试入口需 UI 实测 |
| **EX-IN-08** | P1 | `executionStatus=failed` | 显示“执行中断/异常”；允许再次委派并成功后转 completed | ⏸️ 待 UI 实测 |

### 5.3 Diff 兜底与合入

| 用例 ID | 优先级 | 场景 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- |
| **EX-AP-01** | P0 | 顶层 `executionDiffs` 为空，但模块已有 `executionDiffs` | 汇总模块 Diff 后仍可“一键合入” | ⚠️ 兜底逻辑存在，缺专项测试 |
| **EX-AP-02** | P0 | 模块中断，仅有部分已生成 Diff | 保留已完成模块 Diff；失败模块空 Diff 不得覆盖已有内容 | ⏸️ 待故障注入 |
| **EX-AP-03** | P1 | Diff 合入失败（绑定缺失、文件冲突） | 不标记 applied；弹窗显示可诊断原因 | ⚠️ alert 路径存在，需 UI 实测 |
| **EX-AP-04** | P1 | 合入成功 | 状态转 `applied`，写入 artifacts 路径和 applied 时间 | ⏸️ 需真实工作区验证 |

---

## 6. Rollup 清理与消息时序用例

| 用例 ID | 优先级 | 层级 | 输入 / 操作 | 预期结果 | 本轮结果 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DB-RO-01** | P0 | 静态 | 搜索前端 `msg-rollup-` 创建/更新逻辑 | 不再向主频道追加或更新独立 Rollup 气泡 | ✅ 通过；仅剩兼容过滤与迁移 |
| **DB-RO-02** | P0 | SQLite | 存量消息 `id='msg-rollup-t1'` | 迁移后删除，议题消息保留 | ✅ 通过 |
| **DB-RO-03** | P0 | SQLite | 存量消息 JSON `kind='rollup'` 但 ID 不以 `msg-rollup-` 开头 | 迁移后同样删除 | ⚠️ SQL 条件存在；待补独立断言 |
| **DB-RO-04** | P1 | SQLite | 同一迁移执行两次 | 第二次幂等，不报错、不误删其他消息 | ⚠️ 源码有 migration 标记；现有测试未连续执行两次 |
| **DB-RO-05** | P0 | SQLite | 两条消息 `timestamp` 跨天逆序，但 `created_at/rowid` 递增 | `get_messages` 按真实插入时间返回，不受展示字符串影响 | ✅ 通过 |
| **DB-RO-06** | P1 | SQLite | 同一 `created_at` 的多条消息 | 使用 `rowid ASC` 稳定排序 | ⚠️ SQL 已实现；待补同时间戳断言 |
| **DB-RO-07** | P1 | UI | 议题结案、执行、应用后返回主频道 | 主频道只出现 1 张议题卡片；状态在卡片内部更新，无额外 Rollup 气泡 | ⏸️ 待真实 UI 验证 |

---

## 7. 真实 ACP / Tauri 手工验收步骤

### 7.1 单模块真实链路

1. 启动桌面端，配置一个支持 MCP 工具的提案 Agent 并点击 Start。
2. 新建博弈议题，输入单一聚焦任务：`创建一个单文件静态产品介绍页，只修改 demo/index.html`。
3. 确认提案官调用 `submit_module_decomposition`，载荷中仅含 1 个模块。
4. 检查 `topic.gameTheoreticState.modularState.modules.length === 1`。
5. 检查不存在强行补出的 `*-guard` 模块。
6. 若 `requires_red_team=true`，观察提案后必须进入 challenge；若为 `false` 且复杂度低，应进入 verification。
7. 检查 ACP 日志返回成功，不能出现工具层 `2~4` 错误。

**当前预期失败点**：第 3 步工具调用会返回单模块范围错误；即使工具成功，前端提取器也可能返回 `undefined`。

### 7.2 双击与中断

1. 选择已完成仲裁的多模块议题并指派在线执行 Agent。
2. 在 100ms 内连续点击两次“执行”。
3. 确认只有一条 pending 气泡、一个活动执行和一次 Prompt。
4. 在 M2 执行时点击“停止”。
5. 立即检查 topic 状态必须为 `failed`，不能保持 `running`。
6. 恢复 Agent 后再次执行，确认 M1 不重跑且已产出的 Diff 不丢失。

### 7.3 重启恢复

1. 开始多模块执行，等待 M1 completed、M2 running。
2. 强制退出并重启应用。
3. 打开同一议题检查：
   - `executionStatus === 'failed'`
   - `activeExecutionModuleId === undefined`
   - M1 仍为 `completed`
   - M2 为 `failed`
   - M1 的 `executionDiffs` 仍存在
4. 点击重试，确认从 M2 继续。

### 7.4 UI 与双主题

1. 分别在 light/dark 主题下打开状态为 `running + 无活动执行` 的议题。
2. 检查显示“执行已中断”，文案和背景对比度可读。
3. 打开 `failed`、`completed`、`applied` 三种状态，检查语义色配对。
4. 将三栏收窄到最小宽度，确认提示、按钮和 Agent 名称自动换行且无横向溢出。

---

## 8. 最小复现载荷

### 8.1 单模块 MCP 调用

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "submit_module_decomposition",
    "arguments": {
      "shared_contract": {
        "summary": "single focused change",
        "type_signatures": "",
        "invariants": []
      },
      "modules": [
        {
          "module_id": "only",
          "title": "Only module",
          "responsibility": "Create one static page",
          "allowed_files": ["demo/index.html"],
          "depends_on": [],
          "complexity_level": "low_deterministic",
          "requires_red_team": false,
          "routing_rationale": "Single deterministic file with no runtime state"
        }
      ]
    }
  }
}
```

当前实测响应：

```text
执行工具 [submit_module_decomposition] 出错:
G-Frame 模块化拆解要求模块数在 2~4 个之间，当前为 1
```

### 8.2 答辩收敛状态

```ts
const defenseInput = {
  currentStage: 'defense',
  feedbackDelta: {
    verifiedClaims: 1,
    refutedClaims: 0,
    contractViolations: 0,
  },
  proposalOrDefenseSnippet: 'Patch with reproducible passing evidence',
  currentModuleRefineCount: 0,
};
```

期望：`FREEZE_MODULE`、历史 `refutedClaims` 清零、下一阶段进入 `arbitration`。

---

## 9. 交付门禁

自动化门禁已满足：

1. `submit_module_decomposition` Schema 与执行层统一接受 1~4 个模块，拒绝 0 个和大于 4 个。
2. 原生 MCP 与结构化 JSON 两条提取路径均接受单模块。
3. `routing_rationale` 已贯通类型、提取、初始化和工具输出。
4. ACP 成功返回后遇到 stale 时，两条执行路径均通过统一收敛器转为 `failed`。
5. `test:execution` 已覆盖重入、跨议题忙碌、断点续跑、completed 模块跳过、Diff 保留和中断状态迁移。
6. G-Frame SPEC、TEST PLAN 与 EDGE 标题已更新。

仍需人工运行期确认：

1. 真实 ACP Agent 调用单模块 MCP 工具并完成 discussion -> arbitration。
2. 真实 Tauri UI 双击执行、执行中停止、应用强退重启和重试。
3. light/dark 主题与窄分栏下的中断提示、重试入口和横向溢出。
