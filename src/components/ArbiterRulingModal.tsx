import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Gavel,
  Maximize2,
  Minimize2,
  Scale,
  Wrench,
  X,
} from 'lucide-react';
import {
  ActiveAgentExecution,
  Agent,
  McdaDecisionPayload,
  MinorityReport,
  RulingDecisionType,
  RulingRecord,
  TopicMessageData,
} from '../types';
import { logGameTheoreticTelemetry } from '../services/agentCollaboration';
import {
  buildExecutorCandidates,
  evaluateRulingGates,
  evaluateRulingSubmitState,
  mergeImpactedFiles,
  parseImpactedFilesInput,
} from '../services/cogno';
import { ResizeHandle } from './ResizeHandle';
import { AutoGrowTextarea } from './ruling/AutoGrowTextarea';
import { ExecutorAgentSelector } from './ruling/ExecutorAgentSelector';
import { ImpactedFilesChipsEditor } from './ruling/ImpactedFilesChipsEditor';
import { RulingGovernanceGates } from './ruling/RulingGovernanceGates';
import {
  RULING_TYPE_OPTIONS,
  RulingTypeSelector,
} from './ruling/RulingTypeSelector';
import { TradeOffMatrixEditor } from './ruling/TradeOffMatrixEditor';
import { useArbiterRulingDraftState } from './ruling/useArbiterRulingDraftState';
import { useResizableModalWidth } from './ruling/useResizableModalWidth';

export interface ArbiterRulingModalProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  agents: Agent[];
  allActiveExecutions?: ActiveAgentExecution[];
  overlappingFiles?: string[];
  initialRulingType: RulingDecisionType;
  openVersion: number;
  onClose: () => void;
  onResolveTopic: (
    topicId: string,
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
      executorId?: string;
      mcdaPayload?: McdaDecisionPayload;
      minorityReport?: MinorityReport;
    }
  ) => void;
}

/**
 * 仲裁定案裁决书弹窗：原生顶层 <dialog>，支持宽窄拉伸、自动撑高正文、
 * 行内编辑权衡矩阵、标签化受影响文件与结构化执行 Agent 指派。
 */
export const ArbiterRulingModal: React.FC<ArbiterRulingModalProps> = ({
  isOpen,
  topic,
  agents,
  allActiveExecutions = [],
  overlappingFiles = [],
  initialRulingType,
  openVersion,
  onClose,
  onResolveTopic,
}) => {
  const titleId = useId();
  const summaryFieldId = useId();
  const summaryHintId = useId();
  const solutionFieldId = useId();
  const solutionHintId = useId();
  const executorLabelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isExecutorDropdownOpen, setIsExecutorDropdownOpen] = useState(false);

  const {
    modalWidth,
    isDraggingEdge,
    handleStartDrag,
    toggleWidescreen,
    resetModalWidth,
  } = useResizableModalWidth();

  const draft = useArbiterRulingDraftState({
    isOpen,
    topic,
    initialRulingType,
    openVersion,
    onAfterModeChange: () => setIsExecutorDropdownOpen(false),
  });

  useEffect(() => {
    if (isOpen && topic) {
      setIsExecutorDropdownOpen(false);
    }
  }, [isOpen, openVersion, topic?.id, initialRulingType]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && topic) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen, topic]);

  const executorCandidates = useMemo(
    () => buildExecutorCandidates(topic, agents, allActiveExecutions),
    [topic, agents, allActiveExecutions]
  );

  const gates = topic ? evaluateRulingGates(topic) : null;
  const isChallengerQuorumMet = gates?.isChallengerQuorumMet ?? true;
  const mcdaPayload = topic?.gameTheoreticState?.mcdaPayload;
  const consistencyPassed = mcdaPayload?.consistencyPassed ?? true;

  const submitGate = evaluateRulingSubmitState({
    isChallengerQuorumMet,
    consistencyPassed,
    exemptionChecked: draft.exemptionChecked,
  });

  const activeModeOption =
    RULING_TYPE_OPTIONS.find((opt) => opt.type === draft.rulingType) ||
    RULING_TYPE_OPTIONS[0];

  const handleConfirmRuling = () => {
    if (!topic?.id || !submitGate.canSubmit) return;

    const resolvedAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const committedPoints = draft.resolveEffectiveTradeOffPoints();
    const pendingPoint = draft.newPointInput.trim();
    const finalTradeOffPoints = (
      pendingPoint ? [...committedPoints, pendingPoint] : committedPoints
    )
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const finalImpactedFiles = mergeImpactedFiles(
      draft.impactedFiles,
      parseImpactedFilesInput(draft.newFileInput)
    );

    const aiArbiterNames = (topic.gameRoles?.arbiters || [])
      .map((id) => agents.find((a) => a.id === id)?.name)
      .filter(Boolean) as string[];

    const arbiterName = topic.gameRoles?.humanIsArbiter
      ? 'Norris_M5Pro (人类首席仲裁官)'
      : aiArbiterNames[0] || 'Shinobi 仲裁官';

    const isExempted = submitGate.requiresExemption && draft.exemptionChecked;
    const finalExemptionReason = isExempted
      ? draft.exemptionReason.trim() || '人类首席仲裁官具名特权豁免'
      : undefined;

    const rulingRecord: RulingRecord = {
      decisionType: draft.rulingType,
      arbiterId: 'user-norris',
      arbiterName,
      summary: draft.rulingSummary.trim() || '博弈推演裁决已下达',
      solution: draft.rulingSolution.trim() || undefined,
      tradeOffPoints: finalTradeOffPoints,
      impactedFiles: finalImpactedFiles,
      decidedAt: resolvedAt,
      exemptionReason: finalExemptionReason,
      executorId: draft.selectedExecutorId || undefined,
      mcdaPayload,
      minorityReport: topic.gameTheoreticState?.minorityReport,
      sprtState: topic.gameTheoreticState?.sprtState,
    };

    logGameTheoreticTelemetry('topic_arbitration_concluded', topic.id, {
      decisionType: draft.rulingType,
      arbiterName,
      executorId: draft.selectedExecutorId,
      autoArbitrated: !topic.gameRoles?.humanIsArbiter && !isExempted,
      autoExecuted: Boolean(draft.selectedExecutorId),
      consistencyPassed,
      hasExemption: Boolean(isExempted),
    });

    onResolveTopic(topic.id, {
      solution: draft.rulingSolution.trim() || draft.rulingSummary.trim(),
      impactedFiles: finalImpactedFiles,
      approvers: [arbiterName, ...aiArbiterNames],
      rulingRecord,
      executorId: draft.selectedExecutorId || undefined,
    });

    onClose();
  };

  const handleDialogCancel = (
    event: React.SyntheticEvent<HTMLDialogElement>
  ) => {
    if (isExecutorDropdownOpen) {
      event.preventDefault();
      setIsExecutorDropdownOpen(false);
      return;
    }
    if (draft.editingPointIndex !== null) {
      event.preventDefault();
      draft.cancelEditTradeOffPoint();
    }
  };

  const handleDialogClose = () => {
    if (dialogRef.current) {
      dialogRef.current.returnValue = '';
    }
    if (isOpen) {
      onClose();
    }
  };

  const aiArbiterNames = (topic?.gameRoles?.arbiters || [])
    .map((id) => agents.find((a) => a.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'closerequest' } as Record<string, string>)}
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
      className="arbiter-ruling-dialog"
    >
      {isOpen && topic && (
        <div
          style={{ width: `${modalWidth}px`, maxWidth: '94vw' }}
          className={`relative flex flex-col max-h-[92vh] ${
            isDraggingEdge ? '' : 'transition-[width] duration-150'
          }`}
        >
          <ResizeHandle
            direction="left"
            onPointerDown={(e) => handleStartDrag('left', e)}
            onDoubleClick={resetModalWidth}
            isDragging={isDraggingEdge === 'left'}
            title="拖动调整裁决书宽度，双击恢复默认 680px"
          />
          <ResizeHandle
            direction="right"
            onPointerDown={(e) => handleStartDrag('right', e)}
            onDoubleClick={resetModalWidth}
            isDragging={isDraggingEdge === 'right'}
            title="拖动调整裁决书宽度，双击恢复默认 680px"
          />

          <div className="w-full bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary max-h-[92vh]">
            {/* Fixed Header */}
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 bg-surface-subtle select-none shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                  <Gavel className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id={titleId}
                    className="font-bold text-fg text-sm leading-snug truncate"
                  >
                    仲裁定案裁决书 (Arbiter Gavel Ruling)
                  </h2>
                  <p
                    className="text-[11px] text-fg-muted truncate"
                    title={topic.title}
                  >
                    议题：{topic.title}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={toggleWidescreen}
                  className="px-2.5 py-1.5 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg transition-colors cursor-pointer flex items-center gap-1.5 text-[11px] font-medium"
                  title={
                    modalWidth > 760
                      ? '切换为标准宽度 (680px)'
                      : '切换为宽屏视图 (900px)'
                  }
                >
                  {modalWidth > 760 ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5 text-accent" />
                      <span className="hidden sm:inline">标准宽度</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5 text-accent" />
                      <span className="hidden sm:inline">宽屏视图</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭裁决书"
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div
              data-ruling-scroll-body="true"
              className="px-5 py-4 space-y-5 font-sans overflow-y-auto flex-1 min-h-0"
            >
              <RulingTypeSelector
                rulingType={draft.rulingType}
                customDraftsByMode={draft.customDraftsByMode}
                onSwitchType={draft.handleSwitchRulingType}
                onResetToAiDraft={draft.handleResetToAiDraft}
              />

              {/* Ruling Summary */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={summaryFieldId}
                    className="text-xs font-semibold text-fg flex items-center gap-2"
                  >
                    <span>裁决结论摘要</span>
                    <span
                      id={summaryHintId}
                      className="text-[11px] font-normal text-fg-muted"
                    >
                      将作为核心结论合流至主时间线
                    </span>
                  </label>
                  <span className="text-[11px] font-mono text-fg-muted shrink-0">
                    {draft.rulingSummary.length} 字
                  </span>
                </div>
                <AutoGrowTextarea
                  id={summaryFieldId}
                  value={draft.rulingSummary}
                  onChange={draft.handleUpdateSummary}
                  ariaDescribedBy={summaryHintId}
                  minHeightPx={96}
                  maxHeightPx={300}
                  resetKey={`${topic.id}:${draft.rulingType}:summary`}
                  containerWidth={modalWidth}
                  placeholder="请输入仲裁官对本轮博弈的最终定案陈词..."
                />
              </section>

              {/* Ruling Solution / Path */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={solutionFieldId}
                    className="text-xs font-semibold text-fg flex items-center gap-2"
                  >
                    <span>
                      {draft.rulingType === 'reject_rebuild'
                        ? '重构与推翻指引路线'
                        : '落地方案 / 架构指引'}
                    </span>
                    <span
                      id={solutionHintId}
                      className="text-[11px] font-normal text-fg-muted"
                    >
                      支持自由拉伸高度
                    </span>
                  </label>
                  <span className="text-[11px] font-mono text-fg-muted shrink-0">
                    {draft.rulingSolution.length} 字
                  </span>
                </div>
                <AutoGrowTextarea
                  id={solutionFieldId}
                  value={draft.rulingSolution}
                  onChange={draft.handleUpdateSolution}
                  ariaDescribedBy={solutionHintId}
                  minHeightPx={96}
                  maxHeightPx={320}
                  resetKey={`${topic.id}:${draft.rulingType}:solution`}
                  containerWidth={modalWidth}
                  placeholder={
                    draft.rulingType === 'reject_rebuild'
                      ? '请输入重构的核心要求与改写路径...'
                      : '请输入通过方案的落地细节或防御补齐要求...'
                  }
                />
              </section>

              <TradeOffMatrixEditor
                points={draft.tradeOffPoints}
                editingIndex={draft.editingPointIndex}
                editingValue={draft.editingPointValue}
                newPointInput={draft.newPointInput}
                onNewPointInputChange={draft.setNewPointInput}
                onAddPoint={draft.handleAddTradeOffPoint}
                onStartEdit={draft.startEditTradeOffPoint}
                onEditingValueChange={draft.setEditingPointValue}
                onCommitEdit={draft.commitEditTradeOffPoint}
                onCancelEdit={draft.cancelEditTradeOffPoint}
                onRemovePoint={draft.handleRemoveTradeOffPoint}
              />

              <ImpactedFilesChipsEditor
                files={draft.impactedFiles}
                newFileInput={draft.newFileInput}
                overlappingFiles={overlappingFiles}
                onNewFileInputChange={draft.setNewFileInput}
                onAddFiles={draft.handleAddImpactedFiles}
                onPasteFiles={draft.handleImpactedFilesPaste}
                onRemoveFile={draft.handleRemoveImpactedFile}
                onClearAllFiles={draft.handleClearImpactedFiles}
              />

              {/* Assign Executor Agent */}
              <section className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    id={executorLabelId}
                    className="text-xs font-semibold text-fg flex items-center gap-1.5"
                  >
                    <Wrench className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>指派落地执行 Agent (可选)</span>
                  </span>
                  <span className="text-[11px] text-fg-muted">
                    定案后将自动委派其推进决议落地
                  </span>
                </div>

                <ExecutorAgentSelector
                  labelId={executorLabelId}
                  selectedExecutorId={draft.selectedExecutorId}
                  candidates={executorCandidates}
                  onSelect={draft.setSelectedExecutorId}
                  isOpen={isExecutorDropdownOpen}
                  onOpenChange={setIsExecutorDropdownOpen}
                />
              </section>

              <RulingGovernanceGates
                mcdaPayload={mcdaPayload}
                consistencyPassed={consistencyPassed}
                isChallengerQuorumMet={isChallengerQuorumMet}
                exemptionChecked={draft.exemptionChecked}
                exemptionReason={draft.exemptionReason}
                onExemptionCheckedChange={draft.setExemptionChecked}
                onExemptionReasonChange={draft.setExemptionReason}
              />
            </div>

            {/* Fixed Footer */}
            <div className="px-5 py-3 border-t border-border bg-surface-subtle shrink-0 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                  <Scale className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-fg">
                      署名：
                      {topic.gameRoles?.humanIsArbiter
                        ? 'Norris_M5Pro (人类首席仲裁官)'
                        : 'AI 综合仲裁组'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded border text-[10px] font-mono bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
                      即时裁决并合流
                    </span>
                  </div>
                  {aiArbiterNames.length > 0 && (
                    <div className="text-[10px] text-fg-muted truncate">
                      协同仲裁：{aiArbiterNames.join('、')}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg text-xs font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRuling}
                  disabled={!submitGate.canSubmit}
                  className={`px-4 py-2 rounded-xl font-semibold text-xs shadow-md transition-all flex items-center gap-1.5 ${
                    !submitGate.canSubmit
                      ? 'bg-fg-muted/20 text-fg-muted cursor-not-allowed shadow-none'
                      : activeModeOption.submitBtnClass
                  }`}
                >
                  <Gavel className="w-3.5 h-3.5" />
                  <span>敲响法槌并定案归档</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
};
