import assert from 'node:assert/strict';
import {
  parseSprtThresholdOverrides,
  saveSprtThresholdOverrides,
  getSprtThresholdOverrides,
  clearSprtThresholdOverrides,
} from './sprtThresholdConfig';
import { stepSprtGovernor } from './sprtComputeGovernor';
import {
  recordSprtDecisionFromStep,
  getSprtDecisionTraces,
  exportSprtDecisionTraces,
  clearSprtDecisionTraces,
} from './sprtTraceRecorder';
import { replaySprtTraces } from './sprtTraceAnalyzer';

// =========================================================================
// 1. 外置阈值严格校验：白名单 + 区间 + 整数约束，非法值丢弃而非强转
// =========================================================================
assert.deepEqual(parseSprtThresholdOverrides(undefined), {}, 'undefined 不得产生覆盖');
assert.deepEqual(parseSprtThresholdOverrides(null), {}, 'null 不得产生覆盖');
assert.deepEqual(parseSprtThresholdOverrides([1, 2]), {}, '数组不得产生覆盖');
assert.deepEqual(parseSprtThresholdOverrides('x'), {}, '字符串不得产生覆盖');

const filtered = parseSprtThresholdOverrides({
  alpha: 0.02,
  beta: 9, // 超上界
  sensitivity: '3.5', // 字符串不得强转
  neutralThreshold: 0.5,
  minExplorationRounds: 2.5, // 必须为整数
  funnelDecayRate: Number.NaN,
  groundingWeightWhenPresent: 1.2,
  unknownKey: 123,
});
assert.deepEqual(
  filtered,
  { alpha: 0.02, neutralThreshold: 0.5 },
  '非法类型/越界/未知字段必须被剔除，合法字段保留'
);
assert.deepEqual(
  parseSprtThresholdOverrides({ alpha: 0 }),
  {},
  'alpha=0 低于合法下界（对数比无定义）必须拒绝'
);
assert.deepEqual(
  parseSprtThresholdOverrides({ maxRounds: 4 }),
  { maxRounds: 4 },
  'maxRounds 合法整数应被接受'
);

// =========================================================================
// 2. 保存 / 读取 / 清空：缓存与校验一致性
// =========================================================================
clearSprtThresholdOverrides();
assert.deepEqual(getSprtThresholdOverrides(), {}, '清空后不得残留覆盖');

const saved = saveSprtThresholdOverrides({ sensitivity: 4.2, alpha: -1 });
assert.deepEqual(saved, { sensitivity: 4.2 }, '保存时同样剔除非法字段');
assert.deepEqual(getSprtThresholdOverrides(), { sensitivity: 4.2 }, '保存后应立即可读');
clearSprtThresholdOverrides();
assert.deepEqual(getSprtThresholdOverrides(), {}, '清空后恢复默认');

// =========================================================================
// 3. 阈值外置真实作用于决策：alpha/beta=0.5 使上界 A=0，Λ=2 直接早停
// =========================================================================
const baselineInput = {
  currentRound: 1,
  maxRounds: 4,
  previousLogLikelihoodRatio: 0,
  alignmentScore: 0.7,
};
const baseline = stepSprtGovernor(baselineInput);
assert.equal(baseline.decisionState, 'continue', '默认阈值下 Λ=0.72 未达上界，应继续');
assert.equal(baseline.adaptiveMeta?.thresholdSource, 'default', '无外置配置时来源应为 default');

saveSprtThresholdOverrides({
  alpha: 0.5,
  beta: 0.5,
  sensitivity: 10,
  neutralThreshold: 0.5,
});
const withExternal = stepSprtGovernor(baselineInput);
assert.equal(
  withExternal.decisionState,
  'early_exit',
  '外置 alpha/beta=0.5 使漏斗上界归零，Λ=2 必须触发早停'
);
assert.equal(withExternal.adaptiveMeta?.thresholdSource, 'external', '外置阈值来源应标记 external');
assert.equal(withExternal.adaptiveMeta?.alpha, 0.5, '生效 alpha 应来自外置配置');
assert.equal(withExternal.adaptiveMeta?.sensitivity, 10, '生效 sensitivity 应来自外置配置');

// 回放专用开关必须完全忽略外置阈值，保证历史决策可复现。
const ignored = stepSprtGovernor({ ...baselineInput, ignoreExternalThresholds: true });
assert.equal(ignored.decisionState, 'continue', 'ignoreExternalThresholds 必须忽略外置阈值');
assert.equal(ignored.adaptiveMeta?.thresholdSource, 'default', '忽略外置后来源回落 default');
clearSprtThresholdOverrides();

// =========================================================================
// 4. trace 采集：自包含输入 + 生效阈值快照 + 决策输出
// =========================================================================
clearSprtDecisionTraces();
const trace = recordSprtDecisionFromStep({
  topicId: 'topic-trace-1',
  stage: 'challenge',
  options: baselineInput,
  state: baseline,
});
assert.equal(trace.inputs.currentRound, 1);
assert.equal(trace.inputs.alignmentScore, 0.7);
assert.equal(trace.inputs.maxRounds, 4);
assert.equal(trace.output.decisionState, 'continue');
assert.ok(trace.thresholds, '真实 step 产出的 trace 必须自带阈值快照');
assert.equal(typeof trace.thresholds.alpha, 'number', 'trace 必须自带生效 alpha');
assert.equal(typeof trace.thresholds.neutralThreshold, 'number', 'trace 必须自带生效中性基线');
assert.equal(getSprtDecisionTraces().length, 1, '采集后应可读取');
const exported = exportSprtDecisionTraces();
const payload = JSON.parse(exported);
assert.equal(payload.schemaVersion, 1, '导出载荷必须携带 schemaVersion');
assert.equal(payload.traces.length, 1, '导出载荷必须包含 trace');

// 阈值快照缺失时不得猜测补位：trace 保持无快照，回放必须显式报错。
const missingThresholdTrace = recordSprtDecisionFromStep({
  topicId: 'topic-trace-missing',
  stage: 'defense',
  options: baselineInput,
  state: { ...baseline, adaptiveMeta: undefined },
});
assert.equal(
  missingThresholdTrace.thresholds,
  undefined,
  '缺少 adaptiveMeta 阈值快照时不得以默认值冒充'
);
const missingReplay = replaySprtTraces({ traces: [missingThresholdTrace] });
assert.equal(missingReplay.errors, 1, '缺少阈值快照的 trace 回放必须报错');
assert.equal(missingReplay.replayed, 0);
clearSprtDecisionTraces();
// 重新采集一条完整 trace，供后续回放断言使用。
recordSprtDecisionFromStep({
  topicId: 'topic-trace-1',
  stage: 'challenge',
  options: baselineInput,
  state: baseline,
});

// =========================================================================
// 5. 离线回放：历史生效阈值必须使决策逐字复现（零偏差）
// =========================================================================
const replay = replaySprtTraces(payload);
assert.equal(replay.totalTraces, 1);
assert.equal(replay.errors, 0, '合法 trace 不得报错');
assert.equal(replay.replayed, 1);
assert.equal(replay.decisionMatches, 1, '回放必须复现记录决策');
assert.equal(replay.decisionMismatches, 0, '回放不得出现决策漂移');
assert.equal(replay.maxAbsLambdaDelta, 0, '同一输入/阈值下 Λ 必须逐位一致');

// =========================================================================
// 6. 回放诊断：篡改决策必须被识别为 mismatch；非法条目必须记账为 error
// =========================================================================
const tampered = JSON.parse(exported);
tampered.traces[0].output.decisionState = 'early_exit';
const tamperedReplay = replaySprtTraces(tampered);
assert.equal(tamperedReplay.decisionMismatches, 1, '篡改记录决策必须被识别');
assert.equal(tamperedReplay.decisionMatches, 0);

const invalidReplay = replaySprtTraces({ traces: [null, { traceId: 'x' }, 42] });
assert.equal(invalidReplay.totalTraces, 3);
assert.equal(invalidReplay.errors, 3, '非法 trace 必须逐条报错');
assert.equal(invalidReplay.replayed, 0);
assert.ok(invalidReplay.errorMessages.length === 3, '每个非法 trace 必须给出原因');

const nonPayload = replaySprtTraces({ foo: 'bar' });
assert.equal(nonPayload.totalTraces, 0, '未知载荷不得被猜测解析');

// =========================================================================
// 7. what-if 标定：注入候选阈值只影响本次回放，不写回应用配置
// =========================================================================
const whatIf = replaySprtTraces(JSON.parse(exported), {
  alpha: 0.5,
  beta: 0.5,
  sensitivity: 10,
  neutralThreshold: 0.5,
});
assert.equal(whatIf.replayed, 1);
assert.equal(whatIf.replayedEarlyExit, 1, '候选阈值下同一观测应触发早停');
assert.equal(whatIf.decisionMismatches, 1, '与记录决策不同必须计入 mismatch');
assert.deepEqual(getSprtThresholdOverrides(), {}, 'what-if 回放不得写回全局阈值配置');

// 清理，避免影响同进程内后续断言。
clearSprtDecisionTraces();

console.log('✅ sprt-calibration: 阈值外置 / trace 采集 / 离线回放 全部断言通过');
