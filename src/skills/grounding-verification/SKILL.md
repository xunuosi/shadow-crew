---
name: grounding-verification
description: 物理接地实证与代码沙箱反事实验证契约规范。引导 Verifier 智能体基于 AST 语法树检索、Cargo/Node 沙箱测试或静态推导执行无口水验证，调用 submit_grounding_evidence 提交真值证据链。
---

# Grounding Verification & Sandboxed Proof (物理接地验证与代码沙箱实证)

本技能定义了 CognoNexus 阶段 3 (Grounding Verifier) 的客观物理接地验证与反事实实证规约（学术支撑：Consistency Illusion & GDP Mitigation）。

## 核心作战原则

1. **零口水、纯实证**：不参与任何自然语言辩论，一切以代码执行、单元测试、AST 语法树检索和日志输出为准。
2. **T1/T2 分级实证梯队**：
   - **T1 物理接地**：执行实际命令（如 `execute_cargo_test`, `execute_node_test`）或源码结构检索（`ast_grep`），提取客观真实输出。
   - **T2 逻辑接地**：当环境不支持动态执行时，提供严格的类型推导证明、数学算例或形式化伪代码检验。
3. **未实证硬拦截**：若反例争议未获得有效实证判定，系统将阻止提前收敛 (SPRT Early Exit)，确保决策结果趋真。

## MCP 工具契约：`submit_grounding_evidence`

验证官必须调用 `submit_grounding_evidence` 工具提交证据载荷：

### 参数规范

| 字段 | 类型 | 说明 | 门禁约束 |
| :--- | :--- | :--- | :--- |
| `evidences` | `EvidenceItem[]` | 实证测试项集合 | 必须 $\ge 1$ 条 |
| └ `source_tool` | `string` | 使用的验证工具（如 `ast_grep`, `cargo_test`, `static_proof`） | 必填 |
| └ `input_query_or_code` | `string` | 执行的具体命令、用例代码或检索模式 | 必填 |
| └ `raw_output` | `string` | 工具实际执行的标准输出、错误日志或检索匹配项 | 必填 |
| └ `truth_value` | `boolean` | 真值判定：`true`（命题成立/反例被证伪）或 `false`（反例属实/存在致命 Bug） | 必填 |
| └ `confidence` | `number` | 置信度（`0.0 ~ 1.0`） | 必填 |
| └ `verifier_report` | `string` | 客观实证结论摘要 | 必填 |
| `overall_verdict` | `string` | 总体判定：`PASS` \| `FAIL` \| `INCONCLUSIVE` | 必填 |

### 容灾格式（仅限无工具环境）

```json
{
  "evidences": [
    {
      "sourceTool": "ast_grep",
      "inputQueryOrCode": "pattern: 'fn handle_clock_skew'",
      "rawOutput": "0 matches found in src/lib.rs",
      "truthValue": false,
      "confidence": 0.95,
      "verifierReport": "代码库中确实未实现时钟回拨异常处理分支，红队质疑属实"
    }
  ],
  "overallVerdict": "FAIL"
}
```
