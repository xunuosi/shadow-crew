import type {
  TopicWorkflowMode,
  TopicWorkflowState,
  WorkflowArtifact,
  WorkflowRoleAssignment,
  WorkflowStageKey,
  WorkflowStageRecord,
} from '../../types';
import {
  createWorkflowPlan,
  getWorkflowStageSpec,
  resolveStageAgentIds,
  type WorkflowPlan,
  type WorkflowStageSpec,
} from './workflowSpec';
import {
  aggregateReviewVerdict,
  hasBlockingFinding,
  hasSubstantiveContent,
  isVerificationPassed,
  looksLikeRealImplementation,
  parseDesignArtifact,
  parseReviewReport,
  parseVerificationReport,
  type ReviewReport,
  type VerificationReport,
} from './workflowGates';
import type { Agent } from '../../types';

/** 单个 Agent 在某个阶段的产出 */
export interface WorkflowStageOutput {
  agentId: string;
  agentName: string;
  messageId: string;
  content: string;
  filesTouched?: string[];
  /** ACP 调用失败或空回合 */
  failed?: boolean;
  failureReason?: string;
}

export type WorkflowDecisionKind =
  | 'retry'
  | 'advance'
  | 'complete'
  | 'blocked'
  | 'failed';

export interface WorkflowDecision {
  kind: WorkflowDecisionKind;
  stageKey: WorkflowStageKey;
  nextStageKey?: WorkflowStageKey;
  reason?: string;
  verdict?: string;
  /** 非阻断性说明（例如某位评审报告格式不合法被排除） */
  notes: string[];
}

export interface WorkflowStepResult {
  state: TopicWorkflowState;
  decision: WorkflowDecision;
}

function createStageRecords(stageOrder: WorkflowStageKey[]): WorkflowStageRecord[] {
  return stageOrder.map((key) => ({
    key,
    state: 'pending',
    agentIds: [],
    artifactIds: [],
    attempt: 0,
  }));
}

export interface WorkflowInitResult {
  state: TopicWorkflowState;
  plan: WorkflowPlan;
}

export function initializeWorkflowState(
  mode: TopicWorkflowMode,
  participants: Agent[],
  runToken: string,
  now: number = Date.now()
): WorkflowInitResult {
  const plan = createWorkflowPlan(mode, participants);
  const state: TopicWorkflowState = {
    mode,
    stageOrder: plan.stageOrder,
    currentStageKey: plan.stageOrder[0],
    stages: createStageRecords(plan.stageOrder),
    roles: plan.roles,
    status: plan.blockingIssues.length > 0 ? 'blocked' : 'idle',
    artifacts: [],
    counters: {},
    blockingReason: plan.blockingIssues.length > 0 ? plan.blockingIssues.join('；') : undefined,
    runToken,
    updatedAt: now,
  };
  return { state, plan };
}

export function markWorkflowStageActive(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey,
  agentIds: string[],
  now: number = Date.now()
): TopicWorkflowState {
  return {
    ...state,
    status: 'running',
    currentStageKey: stageKey,
    startedAt: state.startedAt ?? now,
    updatedAt: now,
    stages: state.stages.map((record) => {
      if (record.key === stageKey) {
        return {
          ...record,
          state: 'active',
          agentIds,
          attempt: record.attempt + 1,
          startedAt: now,
          failureReason: undefined,
        };
      }
      // 返工回退时，目标阶段之后的记录回到 pending
      const targetIndex = state.stageOrder.indexOf(stageKey);
      const recordIndex = state.stageOrder.indexOf(record.key);
      if (recordIndex > targetIndex && record.state === 'done') {
        return { ...record, state: 'pending' };
      }
      return record;
    }),
  };
}

export function getNextRunnableStageKey(
  state: TopicWorkflowState,
  currentStageKey: WorkflowStageKey
): WorkflowStageKey | undefined {
  const currentIndex = state.stageOrder.indexOf(currentStageKey);
  for (let index = currentIndex + 1; index < state.stageOrder.length; index += 1) {
    const key = state.stageOrder[index];
    const spec = getWorkflowStageSpec(key);
    const agentIds = resolveStageAgentIds(spec, state.roles);
    if (spec.optional && agentIds.length === 0) continue;
    return key;
  }
  return undefined;
}

function latestArtifacts(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey
): WorkflowArtifact[] {
  return state.artifacts.filter((artifact) => artifact.stageKey === stageKey);
}

function buildArtifact(
  stageKey: WorkflowStageKey,
  spec: WorkflowStageSpec,
  output: WorkflowStageOutput,
  now: number
): WorkflowArtifact {
  let summary: string | undefined;
  if (spec.artifactKind === 'findings') {
    const report = parseReviewReport(output.content);
    summary = report.valid
      ? `${report.verdict} · ${report.findings.length} 条发现`
      : report.error;
  } else if (spec.artifactKind === 'verification') {
    const report = parseVerificationReport(output.content);
    summary = report.valid
      ? `${report.verdict} · ${report.checks.length} 项检查`
      : report.error;
  } else if (spec.artifactKind === 'plan') {
    const design = parseDesignArtifact(output.content);
    summary = design.hasAcceptanceCriteria
      ? `含验收标准（${design.acceptanceCriteria.length} 字）`
      : '缺少验收标准章节';
  } else {
    summary = output.content.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return {
    id: `wf-art-${stageKey}-${output.agentId}-${now}`,
    stageKey,
    kind: spec.artifactKind,
    agentId: output.agentId,
    agentName: output.agentName,
    messageId: output.messageId,
    content: output.content,
    summary,
    filesTouched: output.filesTouched,
    createdAt: now,
  };
}

function collectValidReviewReports(
  outputs: WorkflowStageOutput[]
): { reports: ReviewReport[]; notes: string[] } {
  const reports: ReviewReport[] = [];
  const notes: string[] = [];
  for (const output of outputs) {
    if (output.failed || !output.content?.trim()) continue;
    const report = parseReviewReport(output.content);
    if (report.valid) {
      reports.push(report);
    } else {
      notes.push(`${output.agentName} 的评审报告格式无效，已被排除：${report.error}`);
    }
  }
  return { reports, notes };
}

function collectValidVerificationReports(
  outputs: WorkflowStageOutput[]
): { reports: VerificationReport[]; notes: string[] } {
  const reports: VerificationReport[] = [];
  const notes: string[] = [];
  for (const output of outputs) {
    if (output.failed || !output.content?.trim()) continue;
    const report = parseVerificationReport(output.content);
    reports.push(report);
    if (!report.valid) {
      notes.push(`${output.agentName} 的验收报告格式无效：${report.error}`);
    }
  }
  return { reports, notes };
}

function summarizeFailures(report: VerificationReport): string {
  if (report.failures.length > 0) {
    return report.failures
      .slice(0, 3)
      .map((failure) => `${failure.title}${failure.evidence ? `（${failure.evidence}）` : ''}`)
      .join('；');
  }
  const failedChecks = report.checks.filter((check) => !check.passed);
  if (failedChecks.length > 0) {
    return failedChecks
      .slice(0, 3)
      .map((check) => `${check.command || '检查项'} 未通过：${check.output.slice(0, 160)}`)
      .join('；');
  }
  return report.verdict === 'pass'
    ? '验收报告缺少可执行检查项，按未通过处理'
    : '验收结论为 fail 但未提供失败明细';
}

/**
 * 纯函数状态迁移：输入当前状态与某阶段产出，输出新状态与决策。
 * 所有「失败」都必须变成显式 decision，禁止静默 return。
 */
export function applyStageOutcome(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey,
  outputs: WorkflowStageOutput[],
  now: number = Date.now()
): WorkflowStepResult {
  const spec = getWorkflowStageSpec(stageKey);
  const successfulOutputs = outputs.filter(
    (output) => !output.failed && output.content?.trim()
  );
  const artifacts = successfulOutputs.map((output) =>
    buildArtifact(stageKey, spec, output, now)
  );
  const failureNotes = outputs
    .filter((output) => output.failed)
    .map((output) => `${output.agentName} 执行失败：${output.failureReason || '未返回结果'}`);

  const baseState: TopicWorkflowState = {
    ...state,
    artifacts: [...state.artifacts, ...artifacts],
    updatedAt: now,
  };

  const nextStageKey = getNextRunnableStageKey(baseState, stageKey);
  const setStageState = (
    target: WorkflowStageKey,
    stageState: WorkflowStageRecord['state'],
    failureReason?: string
  ): WorkflowStageRecord[] =>
    baseState.stages.map((record) =>
      record.key === target
        ? {
            ...record,
            state: stageState,
            artifactIds: [
              ...record.artifactIds,
              ...artifacts
                .filter((artifact) => artifact.stageKey === target)
                .map((artifact) => artifact.id),
            ],
            finishedAt: now,
            failureReason,
          }
        : record
    );

  const finish = (
    status: TopicWorkflowState['status'],
    decision: WorkflowDecision,
    failureReason?: string
  ): WorkflowStepResult => ({
    state: {
      ...baseState,
      stages: setStageState(stageKey, status === 'completed' ? 'done' : 'failed', failureReason),
      status,
      verdict: decision.verdict,
      blockingReason: decision.reason,
      finishedAt: now,
      updatedAt: now,
    },
    decision,
  });

  const advance = (
    target: WorkflowStageKey | undefined,
    verdict?: string,
    notes: string[] = []
  ): WorkflowStepResult => {
    if (!target) {
      return finish('completed', {
        kind: 'complete',
        stageKey,
        verdict: verdict || state.verdict,
        notes,
      });
    }
    return {
      state: {
        ...baseState,
        stages: setStageState(stageKey, 'done'),
        currentStageKey: target,
        status: 'running',
        verdict,
        updatedAt: now,
      },
      decision: { kind: 'advance', stageKey, nextStageKey: target, verdict, notes },
    };
  };

  const retry = (target: WorkflowStageKey, reason: string): WorkflowStepResult => ({
    state: {
      ...baseState,
      stages: setStageState(stageKey, 'failed', reason),
      currentStageKey: target,
      status: 'running',
      counters: { ...baseState.counters },
      updatedAt: now,
    },
    decision: { kind: 'retry', stageKey, nextStageKey: target, reason, notes: [] },
  });

  if (outputs.every((output) => output.failed) || (outputs.length > 0 && successfulOutputs.length === 0)) {
    return finish(
      'failed',
      {
        kind: 'failed',
        stageKey,
        reason: failureNotes.join('；') || '该阶段所有 Agent 均未返回有效结果',
        notes: [],
      },
      failureNotes.join('；')
    );
  }

  if (stageKey === 'consult_draft') {
    const draft = successfulOutputs[0];
    if (!draft || !hasSubstantiveContent(draft.content)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '主笔产出内容过短或为空，无法作为后续核验与定稿的输入',
        notes: [],
      });
    }
    const hasCritic = resolveStageAgentIds(
      getWorkflowStageSpec('consult_crosscheck'),
      baseState.roles
    ).length > 0;
    return advance(
      hasCritic ? 'consult_crosscheck' : 'consult_finalize',
      undefined,
      failureNotes
    );
  }

  if (stageKey === 'consult_crosscheck') {
    // 核验是可选增强：无核验者或被跳过时直接定稿
    const { reports, notes } = collectValidReviewReports(successfulOutputs);
    return advance('consult_finalize', undefined, [...failureNotes, ...notes, ...(reports.length === 0 ? ['未获得有效核验报告，定稿将不包含独立核验意见'] : [])]);
  }

  if (stageKey === 'consult_finalize') {
    const finalDoc = successfulOutputs[0];
    if (!finalDoc || !hasSubstantiveContent(finalDoc.content)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '定稿内容为空，未形成可交付产出',
        notes: [],
      });
    }
    return finish('completed', {
      kind: 'complete',
      stageKey,
      verdict: 'DELIVERED',
      notes: failureNotes,
    });
  }

  if (stageKey === 'review_scan') {
    const { reports, notes } = collectValidReviewReports(successfulOutputs);
    if (reports.length === 0) {
      return finish('blocked', {
        kind: 'blocked',
        stageKey,
        reason: `没有任何评审者提交合法的结构化评审报告。${notes.join('；')}`,
        notes,
      });
    }
    return advance('review_synthesize', undefined, [...failureNotes, ...notes]);
  }

  if (stageKey === 'review_synthesize') {
    const summary = successfulOutputs[0];
    if (!summary || !hasSubstantiveContent(summary.content, 40)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '汇总裁定内容为空',
        notes: [],
      });
    }
    const scanArtifacts = latestArtifacts(baseState, 'review_scan');
    const reports = scanArtifacts
      .map((artifact) => parseReviewReport(artifact.content))
      .filter((report) => report.valid);
    const verdict = aggregateReviewVerdict(reports);
    return finish('completed', {
      kind: 'complete',
      stageKey,
      verdict: verdict === 'block' ? 'BLOCK' : verdict === 'conditional' ? 'CONDITIONAL' : 'APPROVE',
      notes: failureNotes,
    });
  }

  if (stageKey === 'build_design') {
    const design = successfulOutputs[0];
    if (!design || !hasSubstantiveContent(design.content, 120)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '实现方案内容过短或为空',
        notes: [],
      });
    }
    const check = parseDesignArtifact(design.content);
    if (!check.hasAcceptanceCriteria && (baseState.counters.designRevisions ?? 0) < 1) {
      const next = retry(
        'build_design',
        '方案缺少可执行的验收标准章节，退回主笔补充（最多返工 1 次）'
      );
      return {
        ...next,
        state: {
          ...next.state,
          counters: {
            ...baseState.counters,
            designRevisions: (baseState.counters.designRevisions ?? 0) + 1,
          },
        },
      };
    }
    const notes = [...failureNotes];
    if (!check.hasAcceptanceCriteria) {
      notes.push('方案仍未给出验收标准，验收阶段将以议题描述与构建/测试命令作为兜底标准。');
    }
    if (!check.hasFilePlan) {
      notes.push('方案未列出具体改动文件，实施阶段可能出现范围漂移。');
    }
    return advance('build_design_review', undefined, notes);
  }

  if (stageKey === 'build_design_review') {
    const reviewArtifacts = latestArtifacts(baseState, stageKey);
    const reports = reviewArtifacts
      .map((artifact) => parseReviewReport(artifact.content))
      .filter((report) => report.valid);
    if (reports.length === 0) {
      return finish('blocked', {
        kind: 'blocked',
        stageKey,
        reason: '方案评审未产出合法的结构化报告，无法判定是否允许进入实施',
        notes: failureNotes,
      });
    }
    const blocking = reports.filter((report) => hasBlockingFinding(report));
    if (blocking.length > 0) {
      const revisions = baseState.counters.designRevisions ?? 0;
      if (revisions < 2) {
        const reason = `方案存在阻断项：${blocking
          .flatMap((report) => report.findings.filter((finding) => finding.severity === 'blocker'))
          .slice(0, 3)
          .map((finding) => finding.title)
          .join('；')}`;
        const next = retry('build_design', reason);
        return {
          ...next,
          state: {
            ...next.state,
            counters: { ...baseState.counters, designRevisions: revisions + 1 },
          },
        };
      }
      return finish('blocked', {
        kind: 'blocked',
        stageKey,
        reason: '方案在 2 次返工后仍存在阻断性问题，停止进入实施',
        notes: failureNotes,
      });
    }
    const conditional = reports.filter((report) => report.verdict === 'conditional');
    return advance(
      'build_implement',
      undefined,
      [
        ...failureNotes,
        ...(conditional.length > 0
          ? ['方案评审存在有条件通过意见，实施阶段必须逐条落实。']
          : []),
      ]
    );
  }

  if (stageKey === 'build_implement') {
    const impl = successfulOutputs[0];
    if (!impl || !hasSubstantiveContent(impl.content, 40)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '实施阶段未返回有效结果',
        notes: [],
      });
    }
    if (!looksLikeRealImplementation(impl.content)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '未检测到任何真实文件改动或命令执行证据，疑似仅输出口头方案而非落盘实现',
        notes: [],
      });
    }
    return advance('build_verify', undefined, failureNotes);
  }

  if (stageKey === 'build_verify') {
    const { reports: allReports, notes } = collectValidVerificationReports(successfulOutputs);
    const validReports = allReports.filter((report) => report.valid);
    const firstFail = allReports.find((report) => !isVerificationPassed(report));
    if (validReports.length === 0) {
      const fixRounds = baseState.counters.fixRounds ?? 0;
      if (fixRounds < 2) {
        const next = retry(
          'build_fix',
          '验收报告缺少结构化证据块，按未通过处理并进入返修'
        );
        return {
          ...next,
          state: {
            ...next.state,
            counters: { ...baseState.counters, fixRounds: fixRounds + 1 },
          },
        };
      }
      return finish('blocked', {
        kind: 'blocked',
        stageKey,
        reason: '验收始终未提供结构化报告，无法确认实现可用',
        notes: [...failureNotes, ...notes],
      });
    }
    if (firstFail) {
      const fixRounds = baseState.counters.fixRounds ?? 0;
      if (fixRounds < 2) {
        const next = retry(
          'build_fix',
          `验收未通过：${summarizeFailures(firstFail)}`
        );
        return {
          ...next,
          state: {
            ...next.state,
            counters: { ...baseState.counters, fixRounds: fixRounds + 1 },
          },
        };
      }
      return finish('blocked', {
        kind: 'blocked',
        stageKey,
        reason: `返修 2 轮后验收仍未通过：${summarizeFailures(firstFail)}`,
        notes: [...failureNotes, ...notes],
      });
    }
    return advance('build_accept', undefined, [...failureNotes, ...notes]);
  }

  if (stageKey === 'build_fix') {
    const fix = successfulOutputs[0];
    if (!fix || !hasSubstantiveContent(fix.content, 20)) {
      return finish('failed', {
        kind: 'failed',
        stageKey,
        reason: '返修阶段未返回有效结果',
        notes: [],
      });
    }
    return advance('build_verify', undefined, failureNotes);
  }

  if (stageKey === 'build_accept') {
    return finish('completed', {
      kind: 'complete',
      stageKey,
      verdict: 'ACCEPTED',
      notes: failureNotes,
    });
  }

  return finish('failed', {
    kind: 'failed',
    stageKey,
    reason: `未实现该阶段的迁移规则：${stageKey}`,
    notes: [],
  });
}

/** 供 UI / 测试使用的角色展示名 */
export function describeWorkflowRoles(roles: WorkflowRoleAssignment): string {
  const parts: string[] = [];
  if (roles.author) parts.push(`主笔=${roles.author}`);
  if (roles.criticIds.length > 0) parts.push(`评审=${roles.criticIds.join(',')}`);
  if (roles.verifierId) parts.push(`验收=${roles.verifierId}`);
  return parts.join(' / ');
}
