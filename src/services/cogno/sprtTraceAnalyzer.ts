/**
 * SPRT trace 离线回放分析器 (Offline Replay & Calibration)
 *
 * 读取 `sprtTraceRecorder` 导出的真实流量 trace，逐条以历史生效阈值重放
 * `stepSprtGovernor`，校验决策可复现性；并可注入一组候选阈值做 what-if 标定。
 *
 * 设计约束：
 * 1. 回放必须显式传入历史生效阈值（ignoreExternalThresholds=true），不得读取当前本地配置。
 * 2. 非法 trace 记账为 error 并给出原因，绝不静默跳过。
 * 3. 决策不一致必须被明确统计，而不是只看"跑通率"。
 */

import type { SprtGovernorState } from '../../types';
import { stepSprtGovernor } from './sprtComputeGovernor';
import type { TopicDomainType } from './sprtComputeGovernor';
import type { SprtDecisionTrace, SprtTraceExportPayload } from './sprtTraceRecorder';
import type { SprtThresholdOverrides } from './sprtThresholdConfig';

const KNOWN_DOMAIN_TYPES: readonly TopicDomainType[] = [
  'deterministic_code',
  'architecture_design',
  'open_ended_general',
];

function toDomainType(raw: string): TopicDomainType | undefined {
  return KNOWN_DOMAIN_TYPES.find((domain) => domain === raw);
}

export interface SprtReplayRow {
  traceId: string;
  topicId: string;
  stage: string;
  recordedDecision: SprtGovernorState['decisionState'];
  replayedDecision: SprtGovernorState['decisionState'];
  decisionMatch: boolean;
  recordedLambda: number;
  replayedLambda: number;
  lambdaDelta: number;
}

export interface SprtReplaySummary {
  totalTraces: number;
  replayed: number;
  errors: number;
  errorMessages: string[];
  decisionMatches: number;
  decisionMismatches: number;
  recordedEarlyExit: number;
  recordedDeadlock: number;
  replayedEarlyExit: number;
  replayedDeadlock: number;
  maxAbsLambdaDelta: number;
  rows: SprtReplayRow[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 提取 trace 列表：接受导出载荷 `{schemaVersion, traces}` 或裸数组。
 * 结构不合法的条目不会被丢弃，而是由 replay 逐条报错。
 */
export function extractTracesFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const traces = (payload as SprtTraceExportPayload).traces;
    if (Array.isArray(traces)) return traces;
  }
  return [];
}

function validateTrace(raw: unknown): { trace: SprtDecisionTrace } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'trace 不是对象' };
  const trace = raw as Partial<SprtDecisionTrace>;
  if (typeof trace.traceId !== 'string' || !trace.traceId) return { error: '缺少 traceId' };
  if (!trace.inputs || typeof trace.inputs !== 'object') return { error: '缺少 inputs' };
  if (!trace.thresholds || typeof trace.thresholds !== 'object') {
    // 阈值快照是自包含回放的前提；缺失时不得以当前配置或猜测值替代。
    return { error: '缺少 thresholds 生效阈值快照，无法忠实回放' };
  }
  if (!trace.output || typeof trace.output !== 'object') return { error: '缺少 output' };
  const { inputs, output } = trace;
  const thresholds = trace.thresholds;
  if (!isFiniteNumber(inputs.currentRound) || inputs.currentRound < 1) {
    return { error: 'inputs.currentRound 非法' };
  }
  if (!isFiniteNumber(inputs.alignmentScore)) return { error: 'inputs.alignmentScore 非法' };
  if (!isFiniteNumber(inputs.priorLogLikelihoodRatio)) {
    return { error: 'inputs.priorLogLikelihoodRatio 非法' };
  }
  for (const key of [
    'alpha',
    'beta',
    'sensitivity',
    'neutralThreshold',
    'minExplorationRounds',
    'funnelDecayRate',
    'groundingWeightWhenPresent',
  ] as const) {
    if (!isFiniteNumber(thresholds[key])) return { error: `thresholds.${key} 非法` };
  }
  if (typeof output.decisionState !== 'string') return { error: 'output.decisionState 非法' };
  return { trace: trace as SprtDecisionTrace };
}

/**
 * 回放全部 trace。
 *
 * @param payload 导出载荷或裸数组
 * @param overrides 可选候选阈值；缺省则使用 trace 记录的生效阈值（用于复现性校验）
 */
export function replaySprtTraces(
  payload: unknown,
  overrides: SprtThresholdOverrides = {}
): SprtReplaySummary {
  const rawTraces = extractTracesFromPayload(payload);
  const summary: SprtReplaySummary = {
    totalTraces: rawTraces.length,
    replayed: 0,
    errors: 0,
    errorMessages: [],
    decisionMatches: 0,
    decisionMismatches: 0,
    recordedEarlyExit: 0,
    recordedDeadlock: 0,
    replayedEarlyExit: 0,
    replayedDeadlock: 0,
    maxAbsLambdaDelta: 0,
    rows: [],
  };

  for (const raw of rawTraces) {
    const validated = validateTrace(raw);
    if ('error' in validated) {
      summary.errors += 1;
      summary.errorMessages.push(validated.error);
      continue;
    }
    const trace = validated.trace;
    const { inputs } = trace;
    const thresholds = trace.thresholds;
    // validateTrace 已保证快照存在；此守卫仅用于类型收窄与防御未来 schema 漂移。
    if (!thresholds) {
      summary.errors += 1;
      summary.errorMessages.push('缺少 thresholds 生效阈值快照，无法忠实回放');
      continue;
    }

    if (trace.output.decisionState === 'early_exit') summary.recordedEarlyExit += 1;
    if (trace.output.decisionState === 'deadlock_escalation') summary.recordedDeadlock += 1;

    const domainType = toDomainType(trace.output.domainType);
    const replayed = stepSprtGovernor({
      currentRound: inputs.currentRound,
      maxRounds: overrides.maxRounds ?? inputs.maxRounds,
      alignmentScore: inputs.alignmentScore,
      groundedTrueRatio: inputs.groundedTrueRatio,
      dssScore: inputs.dssScore,
      hasUnverifiedCriticalDispute: inputs.hasUnverifiedCriticalDispute,
      topicText: inputs.topicText,
      scoreHistory: inputs.scoreHistory,
      previousLogLikelihoodRatio: inputs.priorLogLikelihoodRatio,
      // stepSprtGovernor 仅在无 scoreHistory 时回退读取 priorState.latestAlignmentScore。
      priorState:
        inputs.priorAlignmentScore !== undefined
          ? ({
              latestAlignmentScore: inputs.priorAlignmentScore,
              logLikelihoodRatio: inputs.priorLogLikelihoodRatio,
            } as SprtGovernorState)
          : undefined,
      alpha: overrides.alpha ?? thresholds.alpha,
      beta: overrides.beta ?? thresholds.beta,
      sensitivity: overrides.sensitivity ?? thresholds.sensitivity,
      calibrationStatus: inputs.explicitCalibrationStatus ?? trace.output.calibrationStatus,
      topicProfile: {
        // 未知域类型不猜测映射，交由 topicText / 默认画像决定。
        ...(domainType ? { domainType } : {}),
        neutralThreshold: overrides.neutralThreshold ?? thresholds.neutralThreshold,
        minExplorationRounds:
          overrides.minExplorationRounds ?? thresholds.minExplorationRounds,
        funnelDecayRate: overrides.funnelDecayRate ?? thresholds.funnelDecayRate,
        groundingWeightWhenPresent:
          overrides.groundingWeightWhenPresent ?? thresholds.groundingWeightWhenPresent,
      },
      ignoreExternalThresholds: true,
    });

    const lambdaDelta = Math.abs(replayed.logLikelihoodRatio - trace.output.logLikelihoodRatio);
    const decisionMatch = replayed.decisionState === trace.output.decisionState;
    summary.replayed += 1;
    if (decisionMatch) summary.decisionMatches += 1;
    else summary.decisionMismatches += 1;
    if (replayed.decisionState === 'early_exit') summary.replayedEarlyExit += 1;
    if (replayed.decisionState === 'deadlock_escalation') summary.replayedDeadlock += 1;
    summary.maxAbsLambdaDelta = Math.max(summary.maxAbsLambdaDelta, lambdaDelta);
    summary.rows.push({
      traceId: trace.traceId,
      topicId: trace.topicId,
      stage: trace.stage,
      recordedDecision: trace.output.decisionState,
      replayedDecision: replayed.decisionState,
      decisionMatch,
      recordedLambda: trace.output.logLikelihoodRatio,
      replayedLambda: replayed.logLikelihoodRatio,
      lambdaDelta,
    });
  }

  return summary;
}

/** 人类可读的回放报告（Markdown），用于离线标定留证。 */
export function formatSprtReplayReport(
  summary: SprtReplaySummary,
  overrides: SprtThresholdOverrides = {}
): string {
  const overrideKeys = Object.keys(overrides);
  const mismatchRows = summary.rows.filter((row) => !row.decisionMatch);
  const lines = [
    '# SPRT Trace 离线回放报告',
    `- 导出 trace 总数：${summary.totalTraces}`,
    `- 成功回放：${summary.replayed}`,
    `- 非法 trace（error）：${summary.errors}`,
    `- 决策一致 / 不一致：${summary.decisionMatches} / ${summary.decisionMismatches}`,
    `- 最大 |Λ 偏差|：${summary.maxAbsLambdaDelta}`,
    `- 记录态 early_exit / deadlock：${summary.recordedEarlyExit} / ${summary.recordedDeadlock}`,
    `- 回放态 early_exit / deadlock：${summary.replayedEarlyExit} / ${summary.replayedDeadlock}`,
    `- 候选阈值覆盖：${overrideKeys.length > 0 ? JSON.stringify(overrides) : '无（复现历史生效阈值）'}`,
  ];
  if (summary.errorMessages.length > 0) {
    lines.push('', '## 非法 trace', ...summary.errorMessages.map((msg) => `- ${msg}`));
  }
  if (mismatchRows.length > 0) {
    lines.push('', '## 决策不一致明细');
    for (const row of mismatchRows.slice(0, 50)) {
      lines.push(
        `- ${row.topicId}/${row.stage} (${row.traceId}): 记录 ${row.recordedDecision} → 回放 ${row.replayedDecision}，|ΔΛ|=${row.lambdaDelta}`
      );
    }
  }
  return lines.join('\n');
}
