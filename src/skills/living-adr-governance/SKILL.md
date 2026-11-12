---
name: living-adr-governance
description: 活体 ADR 治理与多智能体运筹仲裁契约规范。引导 Arbiter 智能体针对各方论据与物理实证进行 MCDA BWM 权衡求解，调用 submit_arbitration_ruling 提交终局裁决选项，生成活体决策画布。
---

# Living ADR Governance & Multi-Agent Consensus (活体 ADR 决策治理与运筹仲裁)

本技能定义了 CognoNexus 阶段 5 (Arbiter) 的多准则运筹决策求解与活体 ADR（Living ADR Canvas）演进治理规约（理论支撑：LLM+BWM 运筹优化与 Disagreement-Aware Deliberation）。

## 核心作战原则

1. **客观运筹替代主观仲裁**：通过最劣最佳法（BWM）建立权重指标体系，将大模型的权衡语言翻译为确定性运筹数学规划，一致性指标满足 $\xi^* \le 0.12$ 硬门禁。
2. **异议即财富 (Minority Report)**：对有实质证据支撑的少数派反例予以显式保留，写入伴生《少数派异议报告》，设置黑天鹅重启触发器，避免多数派暴政与群体从众。
3. **闭环裁决工具直通**：直接通过 `submit_arbitration_ruling` 提交标准化裁决草案集合（采纳提案、采纳挑战、折中方案），支持用户或系统一键采纳定案。

## MCP 工具契约：`submit_arbitration_ruling`

仲裁官应优先调用 `submit_arbitration_ruling` 提交裁决方案：

### 参数规范

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `selected_decision_type` | `string` | 推荐采纳路径：`adopt_proposer` \| `adopt_challenger` \| `compromise` |
| `summary` | `string` | 裁决核心摘要（$\le 100$ 字） |
| `options` | `RulingOption[]` | 三态裁决候选草案明细 |
| └ `decision_type` | `string` | `adopt_proposer` \| `adopt_challenger` \| `compromise` |
| └ `title` | `string` | 裁决草案名称 |
| └ `tradeoff_rationale` | `string` | 核心架构权衡与技术考量 |
| └ `concrete_action_plan` | `string[]` | 落地推进实施步骤 |
| └ `impact_scope` | `string[]` | 影响模块与文件范围 |
| └ `patch_recommendation` | `string?` | 推荐补丁或代码改动 |

### 容灾格式（仅限无工具环境）

```markdown
<<<RULING_DRAFT_OPTIONS>>>
{
  "selectedDecisionType": "compromise",
  "summary": "采纳提案主架构，同时合并红队建议的逻辑时钟回退防御补丁",
  "options": {
    "compromise": {
      "decisionType": "compromise",
      "title": "方案折中：引入逻辑时钟防回拨",
      "tradeoffRationale": "在保留提案分布式吞吐优势的前提下消除单点时钟漂移风险",
      "concreteActionPlan": ["为事件注入 Lamport 递增序号", "增加 NTP 漂移告警熔断"],
      "impactScope": ["src/services/clock.ts", "src/models/event.ts"]
    }
  }
}
<<<RULING_DRAFT_OPTIONS_END>>>
```
