# 综合裁定官无异议与活体看板 — 输出侧验收报告

> **测试日期**：2026-11-10
> **测试对象**：`submit_role_concurrence` 结构化投票协议、角色票解析、宿主状态机、九章活体 ADR 看板、320px 最小抽屉布局
> **测试环境**：macOS / Node.js（`tsx`）/ Vite 6 / React 19 / Rust MCP
> **最终结论**：**P0 / P1 / P2 输出侧问题均已修复并通过复测；真实外部 ACP 与完整 Tauri 桌面链路仍标记为未覆盖层。**

---

## 1. P0 根因与修复

### 1.1 原缺陷

旧实现通过提示词要求角色输出“无异议确认”，随后在 [`arbitrationConcurrenceGovernor.ts`](../src/services/cogno/arbitrationConcurrenceGovernor.ts) 中用语料片段和正则表达式推断自然语言语义。

该方案会被以下表达错误击穿：

```text
未发现明显漏洞，但仍保留意见。      -> 被误判为 concurred
不存在阻断性异议，但暂缓上线。      -> 被误判为 concurred
没有重大风险，但需要进一步验证。    -> 被误判为 concurred
无异议？不可能。                    -> 被误判为 concurred
```

根因不是词库缺少短语，而是**自然语言被错误地当作机器授权来源**。

### 1.2 修复方案

1. 删除授权链路中的自然语言正向/负向语料判定函数；
2. 新增 MCP 工具 `submit_role_concurrence`；
3. 角色同时提交绑定当前方案的 `ROLE_CONCURRENCE` JSON 契约块；
4. 宿主只接受严格字段、枚举和方案摘要；
5. 引入 `solution_digest`，所有角色票必须绑定同一终局方案版本；
6. `conditional`、`objected`、`unavailable`、`invalid` 一律不计入无异议；
7. 综合裁定官正文必须实际逐一 `@` 全部参研角色，否则阻断征询；
8. 结构化票缺失或非法时最多 Self-Refine 一次，仍失败则失败关闭。

核心契约：

```json
{
  "protocol_version": 1,
  "agent_id": "agent-challenger",
  "role": "challenger",
  "solution_digest": "sha256:...",
  "status": "conditional",
  "blocking_issue_ids": [],
  "conditions": ["完成跨机房混沌压测"],
  "rationale": "方向可接受，但需补测后上线。",
  "evidence_refs": ["EV-01"]
}
```

---

## 2. P0 专项复测

### 2.1 原始击穿矩阵

以下自然语言正文均不附带结构化契约。复测结果全部为：

```text
submission = undefined
error = 未提交有效的 submit_role_concurrence 工具载荷或 ROLE_CONCURRENCE 契约块
```

| 输入 | 预期 | 实际 |
| --- | --- | --- |
| 未发现明显漏洞，但仍保留意见。 | 阻断 | PASS |
| 不存在阻断性异议，但暂缓上线。 | 阻断 | PASS |
| 没有重大风险，但需要进一步验证。 | 阻断 | PASS |
| 我不反对该方案，但先不要敲定。 | 阻断 | PASS |
| 没有发现致命漏洞，待补测后再定。 | 阻断 | PASS |
| 无异议？不可能。 | 阻断 | PASS |
| 确认无异议。 | 阻断 | PASS |
| 【无异议确认 / Concurred】方案可行。 | 阻断 | PASS |

结论：**自然语言零授权，P0 原运行路径已被切断。**

### 2.2 结构化票边界

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 合法 MCP 工具载荷 | 接受 | PASS |
| 合法 `ROLE_CONCURRENCE` 契约块 | 接受 | PASS |
| 工具载荷与契约块内容不一致 | 阻断 | PASS |
| 多个契约块 | 阻断 | PASS |
| `concurred` 携带 conditions 或 blocking issues | 阻断 | PASS |
| `conditional` 无前置条件 | 阻断 | PASS |
| `objected` 无 blocking issue ID | 阻断 | PASS |
| 工具调用状态为 failed | 阻断 | PASS |
| solution digest 格式错误或与当前方案不匹配 | 阻断 | PASS |
| 角色 ID / role 与当前参研角色不一致 | 阻断 | PASS |
| 综合裁定官正文未实际 @ 任一角色 | 阻断 | PASS |
| `@@double-at` 伪句柄 | 不视为有效 mention | PASS |

---

## 3. 自动化验证

### 3.1 静态与构建

```text
npm run lint    -> PASS (0 TypeScript 错误)
npm run build   -> PASS (Vite production build 成功)
npm run test:layout -> PASS
```

构建仅保留既有主包体积提示，无阻断错误。

### 3.2 CognoNexus 回归

```text
npm run test:cogno       -> PASS
npm run test:cogno:edge  -> PASS (DEFECT 0 / WARN 0)
```

原有 SPRT、LMAD、Free-MAD、ColMAD、BWM、G-Frame、一致性门禁与法定人数门禁均未回归。

专项套件 `test-arbitration-concurrence-adr.ts` 覆盖：

- 综合裁定官真实 mention 校验；
- 自然语言 P0 击穿矩阵；
- MCP 工具与 JSON 契约双通道解析；
- 条件票、异议票、离线票与非法票；
- 方案摘要错绑；
- 终局裁决强门禁；
- 9 章活体 ADR Markdown；
- 零参研角色与门禁边界。

### 3.3 Rust MCP 工具

```text
cargo test -p shadow-crew-dev-mcp
```

结果：`10 passed; 0 failed`。

`submit_role_concurrence` 已覆盖：

- Schema 注册；
- 合法 `concurred` 提交；
- `concurred + conditions` 拒绝；
- `conditional` 无前置条件拒绝；
- protocol、digest、status 与数组字段校验。

---

## 4. 运行期 UI 复测

浏览器同源运行期注入以下票型：

```text
提案主导：concurred
红队对抗：conditional
接地实证：invalid
```

活体 ADR 看板实际展示：

- `⏸️ 条件保留`
- `⛔ 票据无效`
- `综合裁定官方案审视征询中`
- `1 / 3 保证无异议`

运行期 DOM 检查结果：

```text
hasConditional: true
hasInvalid: true
falselyClaimsAllConcurred: false
hasPendingBanner: true
```

结论：条件票和无效票不会被 UI 误报为全员无异议，也不会显示终局签署状态。

### 4.2 九章活体看板

活体 ADR 页面现在与 Markdown 导出一致展示完整 9 章：

1. 终局架构方案总览；
2. 全员无异议共识签署；
3. 拟选方案与架构假定；
4. 证伪失效清单与红队边界压测；
5. 接地实证与反事实验证；
6. 架构权衡矩阵与终局决议；
7. 伴生少数派异议备案与黑天鹅重启触发器；
8. 限定安全爆炸半径；
9. 落地执行与工程交付清单。

静态渲染与浏览器运行期均检查到少数派异议、黑天鹅触发器、文件白名单和交互式工程清单。

```text
hasBlackSwan: true
hasChecklistItem: true
hasAllNineSections: true
```

纯白与暗黑主题均完成视觉走查，新增章节保持双主题语义色、正文对比度和长文本换行。

### 4.3 320px 最小抽屉布局

修复前：

```text
drawer.clientWidth = 319
drawer.scrollWidth = 399
visible horizontal overflow exists
```

修复后实测：

```text
drawer.clientWidth = 319
drawer.scrollWidth = 319
visibleOverflow = []
hasHorizontalDrawerOverflow = false
```

阶段状态条改为容器宽度感知换行，ADR 顶部工具栏、页签切换、签署链、少数派异议和长文件路径均增加 `min-w-0`、`flex-wrap`、`break-words` 或 `break-all` 防护。抽屉不再出现横向滚动条。

---

## 5. 分层证据边界

| 层级 | 本轮状态 | 说明 |
| --- | --- | --- |
| 纯函数/契约层 | 已覆盖 | 结构化解析、摘要绑定、状态迁移、终局门禁 |
| Rust MCP 工具层 | 已覆盖 | Schema 与参数断言 |
| 浏览器同源 UI 层 | 已覆盖 | conditional / invalid / pending 状态展示 |
| 真实外部 ACP 模型 | 未覆盖 | 未验证具体模型是否稳定遵守工具协议 |
| 真实 Tauri 桌面宿主 | 未覆盖 | 本轮为浏览器同源运行期，不宣称桌面全链路通过 |

当前 ACP 工具调用轨迹不保证回传完整 `arguments`，因此角色 Prompt 同时强制输出 `ROLE_CONCURRENCE` 契约块。若两者同时出现，宿主会校验内容完全一致；不一致直接阻断。

---

## 6. 输出侧验收结论

**输出侧验收通过。**

- P0：自然语言不再参与无异议授权；
- P1：综合裁定官必须实际逐一 `@` 全部参研角色；
- P2：活体看板补齐完整 9 章，320px 最小抽屉横向溢出清零。

只有与当前终局方案摘要精确绑定、角色身份匹配、条件与阻塞项为空的合法结构化 `concurred` 票，才允许构成全员无异议并进入终局活体看板出具阶段。
