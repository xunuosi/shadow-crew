/**
 * CognoNexus 决策系统度量基线与打点服务 (Metric Baseline Tracker)
 * 支撑 R-1 / R-4 要求：
 * 1. 自动裁定率 (Auto-Arbitration Rate)
 * 2. 自动落地率 (Auto-Execution Rate)
 * 3. 人工介入率 (Human Intervention Rate)
 * 4. 接线三件套打点落库 (decisionState_transition, consistency_gate_evaluation, grounded_ratio_injected)
 */

export type GameTheoreticTelemetryEventType =
  | 'decisionState_transition'
  | 'consistency_gate_evaluation'
  | 'grounded_ratio_injected'
  | 'stage_contract_validation'
  | 'topic_arbitration_concluded'
  | 'human_intervention_triggered'
  | 'claim_pruning_anomaly'
  | 'p2_loopback_triggered'
  | 'sycophancy_evaluated'
  | 'model_diversity_evaluated';

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  type: GameTheoreticTelemetryEventType;
  topicId: string;
  payload: Record<string, unknown>;
}

export interface MetricBaselineSummary {
  totalTopics: number;
  autoArbitratedCount: number;
  autoExecutedCount: number;
  humanIntervenedCount: number;
  autoArbitrationRate: number; // 0.0 ~ 1.0
  autoExecutionRate: number;   // 0.0 ~ 1.0
  humanInterventionRate: number; // 0.0 ~ 1.0
  consistencyEvaluations: number;
  consistencyPassRate: number;
  earlyExitCount: number;
  deadlockCount: number;
  p2LoopbackCount: number;
  generatedAt: string;
}

const STORAGE_KEY = 'shinobi_cogno_telemetry_events_v1';
const MAX_EVENTS_IN_MEMORY = 500;

class MetricBaselineTracker {
  private events: TelemetryEvent[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.events = JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn('[MetricBaselineTracker] Failed to load events from localStorage:', e);
      this.events = [];
    }
  }

  private saveToStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // 保留最新的 MAX_EVENTS_IN_MEMORY 条
        const trimmed = this.events.slice(-MAX_EVENTS_IN_MEMORY);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      }
    } catch (e) {
      console.warn('[MetricBaselineTracker] Failed to save events to localStorage:', e);
    }
  }

  public logEvent(
    type: GameTheoreticTelemetryEventType,
    topicId: string,
    payload: Record<string, unknown>
  ): TelemetryEvent {
    const event: TelemetryEvent = {
      id: `tel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type,
      topicId,
      payload,
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS_IN_MEMORY * 2) {
      this.events = this.events.slice(-MAX_EVENTS_IN_MEMORY);
    }
    this.saveToStorage();

    console.info(`[CognoTelemetry] [${type}] topic=${topicId}`, payload);
    return event;
  }

  public getEvents(topicId?: string): TelemetryEvent[] {
    if (topicId) {
      return this.events.filter((e) => e.topicId === topicId);
    }
    return [...this.events];
  }

  public calculateSummary(): MetricBaselineSummary {
    const topicConcludedEvents = this.events.filter(
      (e) => e.type === 'topic_arbitration_concluded'
    );
    const humanInterventionEvents = this.events.filter(
      (e) => e.type === 'human_intervention_triggered'
    );
    const consistencyEvents = this.events.filter(
      (e) => e.type === 'consistency_gate_evaluation'
    );
    const decisionTransitions = this.events.filter(
      (e) => e.type === 'decisionState_transition'
    );

    const totalTopics = Math.max(
      topicConcludedEvents.length,
      new Set(this.events.map((e) => e.topicId)).size,
      1 // 防止除以 0
    );

    const autoArbitratedCount = topicConcludedEvents.filter(
      (e) => e.payload?.autoArbitrated === true
    ).length;

    const autoExecutedCount = topicConcludedEvents.filter(
      (e) => e.payload?.autoExecuted === true
    ).length;

    const humanIntervenedCount = humanInterventionEvents.length;

    const consistencyPassedCount = consistencyEvents.filter(
      (e) => e.payload?.passed === true
    ).length;

    const earlyExitCount = decisionTransitions.filter(
      (e) => e.payload?.decisionState === 'early_exit'
    ).length;

    const deadlockCount = decisionTransitions.filter(
      (e) => e.payload?.decisionState === 'deadlock_escalation'
    ).length;

    const p2LoopbackCount = this.events.filter(
      (e) => e.type === 'p2_loopback_triggered'
    ).length;

    return {
      totalTopics,
      autoArbitratedCount,
      autoExecutedCount,
      humanIntervenedCount,
      autoArbitrationRate: Math.round((autoArbitratedCount / totalTopics) * 1000) / 1000,
      autoExecutionRate: Math.round((autoExecutedCount / Math.max(topicConcludedEvents.length, 1)) * 1000) / 1000,
      humanInterventionRate: Math.round((humanIntervenedCount / totalTopics) * 1000) / 1000,
      consistencyEvaluations: consistencyEvents.length,
      consistencyPassRate: consistencyEvents.length > 0 
        ? Math.round((consistencyPassedCount / consistencyEvents.length) * 1000) / 1000 
        : 1.0,
      earlyExitCount,
      deadlockCount,
      p2LoopbackCount,
      generatedAt: new Date().toISOString(),
    };
  }

  public generateBaselineMarkdownReport(): string {
    const summary = this.calculateSummary();
    return `# CognoNexus 决策系统三率度量基线报告 (R-1/R-4)
- **统计时间**：${summary.generatedAt}
- **覆盖决策议题总量**：${summary.totalTopics}
- **核心三率基线数据**：
  1. ⚡ **自动裁定率 (Auto-Arbitration Rate)**: ${(summary.autoArbitrationRate * 100).toFixed(1)}% (${summary.autoArbitratedCount}/${summary.totalTopics})
  2. 🛠️ **自动落地率 (Auto-Execution Rate)**: ${(summary.autoExecutionRate * 100).toFixed(1)}% (${summary.autoExecutedCount}/${summary.totalTopics})
  3. 👤 **人工介入率 (Human Intervention Rate)**: ${(summary.humanInterventionRate * 100).toFixed(1)}% (${summary.humanIntervenedCount}/${summary.totalTopics})
- **控制流与运筹门禁健康度**：
  - MCDA 一致性门禁通过率：${(summary.consistencyPassRate * 100).toFixed(1)}% (评测次数: ${summary.consistencyEvaluations})
  - SPRT 早停 (Early Exit) 触发频次：${summary.earlyExitCount}
  - SPRT 死锁熔断 (Deadlock Escalation) 频次：${summary.deadlockCount}
  - P2 二次对抗回边触发频次：${summary.p2LoopbackCount}
`;
  }
}

export const metricBaselineTracker = new MetricBaselineTracker();

export function logGameTheoreticTelemetry(
  type: GameTheoreticTelemetryEventType,
  topicId: string,
  payload: Record<string, unknown>
): TelemetryEvent {
  return metricBaselineTracker.logEvent(type, topicId, payload);
}

export function getMetricBaselineSummary(): MetricBaselineSummary {
  return metricBaselineTracker.calculateSummary();
}

export function getMetricBaselineReport(): string {
  return metricBaselineTracker.generateBaselineMarkdownReport();
}
