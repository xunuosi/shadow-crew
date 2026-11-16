/**
 * SPRT 决策 trace 采集器 (Real-traffic Trace Recorder)
 *
 * 目标：把每一次真实流量下的 Wald-SPRT 决策完整落盘（输入观测向量 + 生效阈值 + 输出决策），
 * 供 `scripts/replay-sprt-traces.ts` 离线回放与阈值标定使用。
 *
 * 契约：
 * 1. trace 必须自包含——回放只需 trace 本身，不依赖当时的全局度量基线。
 * 2. 采集是旁路观测：任何存储异常都不得打断博弈主流程。
 * 3. 容量有界（环形裁剪），避免长时间运行撑爆 localStorage。
 */

import type { SprtGovernorState } from '../../types';
import type { EvaluateSprtOptions } from './sprtComputeGovernor';
import type { SprtThresholdOverrides } from './sprtThresholdConfig';
import {
  getSprtThresholdOverrides,
  saveSprtThresholdOverrides,
  clearSprtThresholdOverrides,
} from './sprtThresholdConfig';

export const SPRT_TRACE_STORAGE_KEY = 'shadow_crew_sprt_traces_v1';
export const SPRT_TRACE_SCHEMA_VERSION = 1;
export const SPRT_TRACE_MAX_ENTRIES = 500;

/** 回放所需的全部观测输入（与 stepSprtGovernor 的解释口径一致）。 */
export interface SprtTraceInputs {
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
  /** 调用方显式传入的阈值（若有），回放时优先于 trace 中的生效阈值。 */
  explicitAlpha?: number;
  explicitBeta?: number;
  explicitSensitivity?: number;
  explicitCalibrationStatus?: 'uncalibrated' | 'calibrated' | 'fallback';
}

/** 回放所需的生效阈值快照。 */
export interface SprtTraceThresholds {
  alpha: number;
  beta: number;
  sensitivity: number;
  neutralThreshold: number;
  minExplorationRounds: number;
  funnelDecayRate: number;
  groundingWeightWhenPresent: number;
  thresholdSource: 'default' | 'fitted' | 'external';
}

export interface SprtTraceOutput {
  decisionState: SprtGovernorState['decisionState'];
  logLikelihoodRatio: number;
  upperThresholdA: number;
  lowerThresholdB: number;
  latestAlignmentScore: number;
  calibrationStatus?: SprtGovernorState['calibrationStatus'];
  domainType: string;
}

export interface SprtDecisionTrace {
  traceId: string;
  timestamp: number;
  topicId: string;
  stage: string;
  inputs: SprtTraceInputs;
  /** 生效阈值快照；缺失时回放必须报错，绝不以猜测值补位。 */
  thresholds?: SprtTraceThresholds;
  output: SprtTraceOutput;
}

export interface SprtTraceExportPayload {
  schemaVersion: number;
  exportedAt: string;
  traces: SprtDecisionTrace[];
}

let cachedTraces: SprtDecisionTrace[] | undefined;

function readFromStorage(): SprtDecisionTrace[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(SPRT_TRACE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SprtDecisionTrace[]) : [];
    }
  } catch (err) {
    console.warn('[SprtTraceRecorder] Failed to load traces from localStorage:', err);
  }
  return [];
}

function persist(traces: SprtDecisionTrace[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SPRT_TRACE_STORAGE_KEY, JSON.stringify(traces));
    }
  } catch (err) {
    // 旁路观测：存储失败只告警，绝不影响博弈决策链路。
    console.warn('[SprtTraceRecorder] Failed to persist traces:', err);
  }
}

function nextTraceId(): string {
  return `sprt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type CompleteThresholdMeta = NonNullable<SprtGovernorState['adaptiveMeta']> & {
  alpha: number;
  beta: number;
  sensitivity: number;
  neutralThreshold: number;
  minExplorationRounds: number;
  funnelDecayRate: number;
  groundingWeightWhenPresent: number;
  thresholdSource: 'default' | 'fitted' | 'external';
};

function hasCompleteThresholdSnapshot(
  meta: SprtGovernorState['adaptiveMeta']
): meta is CompleteThresholdMeta {
  if (!meta) return false;
  for (const key of [
    'alpha',
    'beta',
    'sensitivity',
    'neutralThreshold',
    'minExplorationRounds',
    'funnelDecayRate',
    'groundingWeightWhenPresent',
  ] as const) {
    if (typeof meta[key] !== 'number' || !Number.isFinite(meta[key])) return false;
  }
  return (
    meta.thresholdSource === 'default' ||
    meta.thresholdSource === 'fitted' ||
    meta.thresholdSource === 'external'
  );
}

/**
 * 采集一次真实 SPRT 决策。`options` 与 `state` 必须是同一轮 stepSprtGovernor 的入参与返回，
 * 否则 trace 无法忠实回放（调用方不得拼装伪造状态）。
 */
export function recordSprtDecisionFromStep(params: {
  topicId: string;
  stage: string;
  options: EvaluateSprtOptions;
  state: SprtGovernorState;
}): SprtDecisionTrace {
  const { topicId, stage, options, state } = params;
  const adaptiveMeta = state.adaptiveMeta;
  const trace: SprtDecisionTrace = {
    traceId: nextTraceId(),
    timestamp: Date.now(),
    topicId,
    stage,
    inputs: {
      priorLogLikelihoodRatio:
        options.previousLogLikelihoodRatio ?? options.priorState?.logLikelihoodRatio ?? 0,
      priorAlignmentScore: options.priorState?.latestAlignmentScore,
      currentRound: state.currentRound,
      maxRounds: state.maxRounds,
      alignmentScore: options.roundAlignmentScore ?? options.alignmentScore ?? 0.5,
      groundedTrueRatio: options.groundedTrueRatio,
      dssScore: options.dssScore,
      hasUnverifiedCriticalDispute: options.hasUnverifiedCriticalDispute,
      topicText: options.topicText,
      scoreHistory: options.scoreHistory ? [...options.scoreHistory] : undefined,
      explicitAlpha: options.alpha,
      explicitBeta: options.beta,
      explicitSensitivity: options.sensitivity,
      explicitCalibrationStatus: options.calibrationStatus,
    },
    // 阈值快照缺失时保持 undefined：宁可回放时显式报错，也不以猜测值冒充历史配置。
    ...(hasCompleteThresholdSnapshot(adaptiveMeta)
      ? {
          thresholds: {
            alpha: adaptiveMeta.alpha,
            beta: adaptiveMeta.beta,
            sensitivity: adaptiveMeta.sensitivity,
            neutralThreshold: adaptiveMeta.neutralThreshold,
            minExplorationRounds: adaptiveMeta.minExplorationRounds,
            funnelDecayRate: adaptiveMeta.funnelDecayRate,
            groundingWeightWhenPresent: adaptiveMeta.groundingWeightWhenPresent,
            thresholdSource: adaptiveMeta.thresholdSource,
          },
        }
      : {}),
    output: {
      decisionState: state.decisionState,
      logLikelihoodRatio: state.logLikelihoodRatio,
      upperThresholdA: state.upperThresholdA,
      lowerThresholdB: state.lowerThresholdB,
      latestAlignmentScore: state.latestAlignmentScore,
      calibrationStatus: state.calibrationStatus,
      domainType: adaptiveMeta?.domainType ?? 'unknown',
    },
  };

  if (cachedTraces === undefined) {
    cachedTraces = readFromStorage();
  }
  cachedTraces.push(trace);
  if (cachedTraces.length > SPRT_TRACE_MAX_ENTRIES) {
    cachedTraces = cachedTraces.slice(-SPRT_TRACE_MAX_ENTRIES);
  }
  persist(cachedTraces);
  return trace;
}

export function getSprtDecisionTraces(): SprtDecisionTrace[] {
  if (cachedTraces === undefined) {
    cachedTraces = readFromStorage();
  }
  return [...cachedTraces];
}

export function exportSprtDecisionTraces(): string {
  const payload: SprtTraceExportPayload = {
    schemaVersion: SPRT_TRACE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    traces: getSprtDecisionTraces(),
  };
  return JSON.stringify(payload, null, 2);
}

export function clearSprtDecisionTraces(): void {
  cachedTraces = [];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(SPRT_TRACE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[SprtTraceRecorder] Failed to clear traces:', err);
  }
}

/**
 * Dev 运行期调试入口：在 WebView DevTools 中导出真实 trace / 调整阈值。
 * 仅在 Vite dev 模式挂载，生产构建不污染全局。
 */
export function installSprtDevBridge(): void {
  if (typeof window === 'undefined') return;
  const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!isDev) return;
  (window as unknown as Record<string, unknown>).__SHADOW_CREW_SPRT__ = {
    exportTraces: () => exportSprtDecisionTraces(),
    downloadTraces: () => {
      const json = exportSprtDecisionTraces();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sprt-traces-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    listTraces: () => getSprtDecisionTraces(),
    clearTraces: () => clearSprtDecisionTraces(),
    getThresholds: () => getSprtThresholdOverrides(),
    setThresholds: (overrides: SprtThresholdOverrides) => saveSprtThresholdOverrides(overrides),
    clearThresholds: () => clearSprtThresholdOverrides(),
  };
}
