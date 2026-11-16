# SPRT Trace 采集与离线阈值标定规范

> 定位：解决「Wald-SPRT 早停参数无法用真实流量标定」的问题。
> 通过 **自包含决策 trace + 离线回放 + 阈值外置** 三件套，将博弈早停从「经验常数」推进到「可观测、可复现、可回放标定」的闭环。

---

## 1. 设计不变量

1. **旁路观测**：trace 采集不得改变决策结果，任何存储异常只告警、不中断博弈主流程。
2. **自包含**：每条 trace 必须完整记录（a）观测输入、（b）本次实际生效的阈值快照、（c）决策输出。回放只依赖 trace 本身，**不得**读取当前全局度量基线或当前本地配置。
3. **可复现**：在相同输入与相同生效阈值下，回放必须逐位复现 `logLikelihoodRatio` 与 `decisionState`。
4. **禁止猜测**：阈值配置采用白名单 + 数值区间 + 整数约束校验，非法字段剔除并显式告警；不做字符串强转、不做旧字段回退。
5. **有界存储**：trace 环形裁剪至 500 条，避免长期运行撑爆 localStorage。

---

## 2. 数据契约

### 2.1 `SprtDecisionTrace`

实现：`src/services/cogno/sprtTraceRecorder.ts`

```ts
interface SprtDecisionTrace {
  traceId: string;
  timestamp: number;
  topicId: string;
  stage: string;                      // 'challenge' | 'defense' | ...
  inputs: {
    priorLogLikelihoodRatio: number;
    priorAlignmentScore?: number;
    currentRound: number;
    maxRounds: number;
    alignmentScore: number;
    groundedTrueRatio?: number;
    dssScore?: number;
    hasUnverifiedCriticalDispute?: boolean;
    topicText?: string;
    scoreHistory?: number[];
    explicitAlpha?: number;
    explicitBeta?: number;
    explicitSensitivity?: number;
    explicitCalibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback';
  };
  thresholds: {                       // 本次实际生效的阈值快照
    alpha: number;
    beta: number;
    sensitivity: number;
    neutralThreshold: number;
    minExplorationRounds: number;
    funnelDecayRate: number;
    groundingWeightWhenPresent: number;
    thresholdSource: 'default' | 'fitted' | 'external';
  };
  output: {
    decisionState: 'continue' | 'early_exit' | 'deadlock_escalation';
    logLikelihoodRatio: number;
    upperThresholdA: number;
    lowerThresholdB: number;
    latestAlignmentScore: number;
    calibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback';
    domainType: string;
  };
}
```

导出的 `thresholds` 字段直接来自 `SprtGovernorState.adaptiveMeta`（`types.ts`），因此 step 输出与 trace 快照天然同源。

### 2.2 采集入口

- 真实流量调用点：`src/hooks/useGameTheoreticFsm.ts`
  - 阶段 2 `challenge`：所有质疑回合
  - 阶段 4 `defense`：所有答辩回合
- 统一调用 `recordSprtDecisionFromStep({ topicId, stage, options, state })`，`options/state` 必须是同一轮 `stepSprtGovernor` 的入参与返回。

### 2.3 存储

| 内容 | localStorage Key |
| :--- | :--- |
| 决策 trace | `shadow_crew_sprt_traces_v1` |
| 外置阈值 | `shadow_crew_sprt_thresholds_v1` |

Dev 运行期桥（仅 `import.meta.env.DEV`，生产构建不挂载）：

```js
__SHADOW_CREW_SPRT__.downloadTraces()   // 下载 traces JSON
__SHADOW_CREW_SPRT__.listTraces()
__SHADOW_CREW_SPRT__.clearTraces()
__SHADOW_CREW_SPRT__.getThresholds()
__SHADOW_CREW_SPRT__.setThresholds({ alpha: 0.03, sensitivity: 4 })
__SHADOW_CREW_SPRT__.clearThresholds()
```

---

## 3. 阈值外置

实现：`src/services/cogno/sprtThresholdConfig.ts`

| 字段 | 含义 | 合法区间 | 整数 |
| :--- | :--- | :--- | :--- |
| `alpha` | 第一类错误率（虚假早停） | `[0.001, 0.5]` | |
| `beta` | 第二类错误率（漏报/死锁误判） | `[0.001, 0.5]` | |
| `sensitivity` | 似然比增量放大系数 | `[0.5, 10]` | |
| `neutralThreshold` | 中性基线 θ₀ | `[0.05, 0.95]` | |
| `minExplorationRounds` | 最小探索轮次 | `[0, 6]` | ✓ |
| `funnelDecayRate` | 漏斗上界收缩率 | `[0, 0.9]` | |
| `groundingWeightWhenPresent` | 有接地证据时的接地权重 | `[0, 1]` | |
| `maxRounds` | 安全轮次上限 | `[1, 12]` | ✓ |

**优先级**（`stepSprtGovernor`）：

```text
每轮显式入参 (options.alpha/beta/sensitivity)
  > 外置配置（sprtThresholdConfig）
  > 历史度量拟合 (fitSprtCalibrationParams)
  > 领域默认画像 (inferTopicDomainProfile)
```

- `topicProfile`（调用方领域画像）优先于拟合默认值；拟合只负责 `alpha/beta/sensitivity` 的自适应。
- `adaptiveMeta.thresholdSource` 标记本次阈值来源（`default` / `fitted` / `external`），随 trace 一起落盘。
- 离线回放使用 `ignoreExternalThresholds: true`，完全以 trace 快照显式复现，避免「当前配置污染历史」。

---

## 4. 离线回放 CLI

实现：`scripts/replay-sprt-traces.ts` + `src/services/cogno/sprtTraceAnalyzer.ts`

```bash
# 复现性校验（使用 trace 记录的历史生效阈值）
npm run sprt:replay -- sprt-traces.json

# what-if 标定（候选阈值只作用于本次回放，不写回应用）
npm run sprt:replay -- sprt-traces.json --thresholds candidate.json --out report.md
```

输出指标：

- `totalTraces / replayed / errors`：非法 trace 逐条给出原因，不只报总数。
- `decisionMatches / decisionMismatches`：决策漂移必须显式统计。
- `maxAbsLambdaDelta`：Λ 逐位一致性证据（复现应为 0）。
- 记录态 vs 回放态的 `early_exit / deadlock` 频次，用于候选阈值对早停率的影响评估。

退出码：存在非法 trace 或决策不一致时返回 `1`，便于 CI/脚本断点。

---

## 5. 已知边界

1. trace 存储于 WebView localStorage，不跨设备/跨应用重装保留；需要长期样本时应先用 `downloadTraces()` 落盘归档。
2. 回放复现依赖 trace 自包含阈值；若未来 `stepSprtGovernor` 新增影响决策的观测维度而未写入 trace，回放会以 mismatch 显式暴露，不得静默通过。
3. 尚未内置自动阈值搜索（网格/贝叶斯优化）；当前提供确定性回放与 what-if 注入，搜索策略由离线脚本消费报告后自行决定。
