---
name: red-team-falsification
description: Free-MAD 红队反从众证伪与缺陷压测契约规范。引导 Challenger 智能体针对提案主张执行四部曲批判，调用 submit_challenge_critique 原生工具，输出逻辑破绽、隐含假设、极端边缘反例与防守要求。
---

# Red Team Falsification & Attack Matrix (红队反从众证伪与缺陷压测)

本技能定义了 CognoNexus 阶段 2 (Challenger) 的规范化红队反从众四部曲批判与反例压测协议（学术支撑：Free-MAD, arXiv:2509.11035）。

## 核心作战原则

1. **反从众铁律**：严禁无原则认同或客套附和。学术实证表明，单纯追求表面共识会诱发谄媚效应与一致性幻觉（GDP）。
2. **靶向锚定**：针对提案中的因果断言（Claim）或论点节点（`target_claim_id`）展开定向爆破，拒绝空泛的架构哲学争论。
3. **四部曲结构化批判契约**：必须且仅能通过原生 MCP 工具 `submit_challenge_critique` 或容灾 JSON 块提交。

## MCP 工具契约：`submit_challenge_critique`

在识别提案漏洞后，红队工程师必须调用 `submit_challenge_critique` 工具：

### 参数规范

| 字段 | 类型 | 说明 | 门禁约束 |
| :--- | :--- | :--- | :--- |
| `fatal_flaws` | `string[]` | 逻辑矛盾、竞争死锁、单点故障等致命隐患 | 必须 $\ge 1$ 条 |
| `hidden_assumptions` | `string[]` | 方案依赖的理想化网络、无并发冲突等隐性前提 | 必须 $\ge 1$ 条 |
| `failure_scenarios` | `string[]` | 构造具体的超时、断网、脏数据、崩溃等恶意工况 | 必须 $\ge 1$ 条 |
| `counter_demands` | `string[]` | 向提案方/验证方提出的具体防守补丁与实证用例要求 | 必须 $\ge 1$ 条 |
| `summary` | `string` | 质询核心结论摘要 | $\le 80$ 字 |
| `target_claim_id` | `string?` | (可选) 靶向锁定的提案断言节点 ID | 辅助精准图差分 |

### 容灾格式（仅限无工具环境）

```json
<<<CHALLENGER_CRITIQUE>>>
{
  "fatal_flaws": ["主键分布式生成未考虑时钟回拨，易造成写冲突"],
  "hidden_assumptions": ["默认各节点间时钟同步漂移 < 1ms"],
  "failure_scenarios": ["NTP 同步突变 500ms 时，并发事务写入触发主键重复导致崩溃"],
  "counter_demands": ["要求引入逻辑时钟或重试退避，并补充 NTP 漂移单测"],
  "summary": "时钟回拨隐患可能引发并发写崩溃",
  "target_claim_id": "arg-node-2"
}
<<<CHALLENGER_CRITIQUE_END>>>
```
