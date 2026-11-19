import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RulingDecisionType, TopicMessageData } from '../../types';
import {
  mergeImpactedFiles,
  parseImpactedFilesInput,
  resolveAiRulingDraft,
  resolveDefaultExecutorId,
  resolveModalRulingDraft,
  RulingModeDraftState,
} from '../../services/cogno';

export interface UseArbiterRulingDraftStateParams {
  isOpen: boolean;
  topic: TopicMessageData | null;
  initialRulingType: RulingDecisionType;
  openVersion: number;
  onAfterModeChange?: () => void;
}

/**
 * 管理裁决书弹窗三种模式下的草案同步、人类定制缓存、权衡要点行内编辑与受影响文件芯片操作。
 */
export function useArbiterRulingDraftState({
  isOpen,
  topic,
  initialRulingType,
  openVersion,
  onAfterModeChange,
}: UseArbiterRulingDraftStateParams) {
  const [customDraftsByMode, setCustomDraftsByMode] = useState<
    Partial<Record<RulingDecisionType, RulingModeDraftState>>
  >({});
  const customDraftsRef = useRef(customDraftsByMode);
  customDraftsRef.current = customDraftsByMode;

  const [rulingType, setRulingType] =
    useState<RulingDecisionType>(initialRulingType);

  const initialDraft = useMemo(
    () => resolveModalRulingDraft(topic, initialRulingType, {}),
    [topic, initialRulingType]
  );

  const [rulingSummary, setRulingSummary] = useState<string>(
    () => initialDraft.summary
  );
  const [rulingSolution, setRulingSolution] = useState<string>(
    () => initialDraft.solution
  );
  const [impactedFiles, setImpactedFiles] = useState<string[]>(
    () => initialDraft.impactedFiles
  );
  const [tradeOffPoints, setTradeOffPoints] = useState<string[]>(
    () => initialDraft.tradeOffPoints
  );

  const [newPointInput, setNewPointInput] = useState('');
  const [editingPointIndex, setEditingPointIndex] = useState<number | null>(
    null
  );
  const [editingPointValue, setEditingPointValue] = useState('');
  const [newFileInput, setNewFileInput] = useState('');
  const [selectedExecutorId, setSelectedExecutorId] = useState<string>(() =>
    resolveDefaultExecutorId(topic, initialRulingType)
  );
  const [exemptionChecked, setExemptionChecked] = useState(false);
  const [exemptionReason, setExemptionReason] = useState('');

  const prevTopicIdRef = useRef<string | undefined>(topic?.id);
  useEffect(() => {
    if (prevTopicIdRef.current !== topic?.id) {
      prevTopicIdRef.current = topic?.id;
      customDraftsRef.current = {};
      setCustomDraftsByMode({});
    }
  }, [topic?.id]);

  useEffect(() => {
    if (!isOpen || !topic) return;
    setRulingType(initialRulingType);
    setExemptionChecked(false);
    setExemptionReason('');
    setNewPointInput('');
    setEditingPointIndex(null);
    setEditingPointValue('');
    setNewFileInput('');
    setSelectedExecutorId(resolveDefaultExecutorId(topic, initialRulingType));

    const draft = resolveModalRulingDraft(
      topic,
      initialRulingType,
      customDraftsRef.current
    );
    setRulingSummary(draft.summary);
    setRulingSolution(draft.solution);
    setImpactedFiles(draft.impactedFiles);
    setTradeOffPoints(draft.tradeOffPoints);
  }, [isOpen, openVersion, topic?.id, initialRulingType]);

  const persistCurrentModeDraft = (
    overrides?: Partial<RulingModeDraftState>
  ) => {
    setCustomDraftsByMode((prev) => {
      const next = {
        ...prev,
        [rulingType]: {
          summary: overrides?.summary ?? rulingSummary,
          solution: overrides?.solution ?? rulingSolution,
          impactedFiles: overrides?.impactedFiles ?? impactedFiles,
          tradeOffPoints: overrides?.tradeOffPoints ?? tradeOffPoints,
          isCustomized:
            overrides?.isCustomized ?? prev[rulingType]?.isCustomized ?? true,
        },
      };
      customDraftsRef.current = next;
      return next;
    });
  };

  const resolveEffectiveTradeOffPoints = (): string[] => {
    if (editingPointIndex === null) return tradeOffPoints;
    const trimmed = editingPointValue.trim();
    if (!trimmed) return tradeOffPoints;
    return tradeOffPoints.map((pt, idx) =>
      idx === editingPointIndex ? trimmed : pt
    );
  };

  const handleSwitchRulingType = (nextType: RulingDecisionType) => {
    if (nextType === rulingType) return;

    const currentSnapshot: RulingModeDraftState = {
      summary: rulingSummary,
      solution: rulingSolution,
      impactedFiles,
      tradeOffPoints: resolveEffectiveTradeOffPoints(),
      isCustomized:
        customDraftsRef.current[rulingType]?.isCustomized ??
        editingPointIndex !== null,
    };

    const nextCache: Partial<Record<RulingDecisionType, RulingModeDraftState>> =
      {
        ...customDraftsRef.current,
        [rulingType]: currentSnapshot,
      };
    customDraftsRef.current = nextCache;
    setCustomDraftsByMode(nextCache);

    setRulingType(nextType);
    setSelectedExecutorId(resolveDefaultExecutorId(topic, nextType));
    setEditingPointIndex(null);
    setEditingPointValue('');
    setNewPointInput('');
    setNewFileInput('');
    onAfterModeChange?.();

    const targetDraft = resolveModalRulingDraft(topic, nextType, nextCache);
    setRulingSummary(targetDraft.summary);
    setRulingSolution(targetDraft.solution);
    setImpactedFiles(targetDraft.impactedFiles);
    setTradeOffPoints(targetDraft.tradeOffPoints);
  };

  const handleUpdateSummary = (val: string) => {
    setRulingSummary(val);
    persistCurrentModeDraft({ summary: val, isCustomized: true });
  };

  const handleUpdateSolution = (val: string) => {
    setRulingSolution(val);
    persistCurrentModeDraft({ solution: val, isCustomized: true });
  };

  const handleAddTradeOffPoint = () => {
    const trimmed = newPointInput.trim();
    if (!trimmed) return;
    const nextPoints = [...tradeOffPoints, trimmed];
    setTradeOffPoints(nextPoints);
    setNewPointInput('');
    persistCurrentModeDraft({ tradeOffPoints: nextPoints, isCustomized: true });
  };

  const startEditTradeOffPoint = (index: number) => {
    setEditingPointIndex(index);
    setEditingPointValue(tradeOffPoints[index] || '');
  };

  const cancelEditTradeOffPoint = () => {
    setEditingPointIndex(null);
    setEditingPointValue('');
  };

  const commitEditTradeOffPoint = () => {
    if (editingPointIndex === null) return;
    const trimmed = editingPointValue.trim();
    if (!trimmed) {
      cancelEditTradeOffPoint();
      return;
    }
    const nextPoints = tradeOffPoints.map((pt, idx) =>
      idx === editingPointIndex ? trimmed : pt
    );
    setTradeOffPoints(nextPoints);
    setEditingPointIndex(null);
    setEditingPointValue('');
    persistCurrentModeDraft({ tradeOffPoints: nextPoints, isCustomized: true });
  };

  const handleRemoveTradeOffPoint = (index: number) => {
    if (editingPointIndex === index) {
      cancelEditTradeOffPoint();
    } else if (editingPointIndex !== null && editingPointIndex > index) {
      setEditingPointIndex(editingPointIndex - 1);
    }
    const nextPoints = tradeOffPoints.filter((_, i) => i !== index);
    setTradeOffPoints(nextPoints);
    persistCurrentModeDraft({ tradeOffPoints: nextPoints, isCustomized: true });
  };

  const handleAddImpactedFiles = () => {
    const parsed = parseImpactedFilesInput(newFileInput);
    if (parsed.length === 0) return;
    const nextFiles = mergeImpactedFiles(impactedFiles, parsed);
    setImpactedFiles(nextFiles);
    setNewFileInput('');
    persistCurrentModeDraft({ impactedFiles: nextFiles, isCustomized: true });
  };

  const handleRemoveImpactedFile = (fileToRemove: string) => {
    const nextFiles = impactedFiles.filter((file) => file !== fileToRemove);
    setImpactedFiles(nextFiles);
    persistCurrentModeDraft({ impactedFiles: nextFiles, isCustomized: true });
  };

  const handleClearImpactedFiles = () => {
    setImpactedFiles([]);
    persistCurrentModeDraft({ impactedFiles: [], isCustomized: true });
  };

  const handleImpactedFilesPaste = (
    event: React.ClipboardEvent<HTMLInputElement>
  ) => {
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText) return;
    const parsed = parseImpactedFilesInput(pastedText);
    const hasBatchDelimiters =
      parsed.length > 1 ||
      pastedText.includes(',') ||
      pastedText.includes('，') ||
      pastedText.includes('\n') ||
      pastedText.includes(';');

    if (hasBatchDelimiters && parsed.length > 0) {
      event.preventDefault();
      const nextFiles = mergeImpactedFiles(impactedFiles, parsed);
      setImpactedFiles(nextFiles);
      persistCurrentModeDraft({ impactedFiles: nextFiles, isCustomized: true });
    }
  };

  const handleResetToAiDraft = () => {
    setCustomDraftsByMode((prev) => {
      const next = { ...prev };
      delete next[rulingType];
      customDraftsRef.current = next;
      return next;
    });
    setEditingPointIndex(null);
    setEditingPointValue('');

    const aiDraft = resolveAiRulingDraft(topic, rulingType);
    setRulingSummary(aiDraft.summary);
    setRulingSolution(aiDraft.solution);
    setImpactedFiles(aiDraft.impactedFiles);
    setTradeOffPoints(aiDraft.tradeOffPoints);
  };

  return {
    customDraftsByMode,
    rulingType,
    rulingSummary,
    rulingSolution,
    impactedFiles,
    tradeOffPoints,
    newPointInput,
    setNewPointInput,
    editingPointIndex,
    editingPointValue,
    setEditingPointValue,
    newFileInput,
    setNewFileInput,
    selectedExecutorId,
    setSelectedExecutorId,
    exemptionChecked,
    setExemptionChecked,
    exemptionReason,
    setExemptionReason,
    resolveEffectiveTradeOffPoints,
    handleSwitchRulingType,
    handleUpdateSummary,
    handleUpdateSolution,
    handleAddTradeOffPoint,
    startEditTradeOffPoint,
    cancelEditTradeOffPoint,
    commitEditTradeOffPoint,
    handleRemoveTradeOffPoint,
    handleAddImpactedFiles,
    handleRemoveImpactedFile,
    handleClearImpactedFiles,
    handleImpactedFilesPaste,
    handleResetToAiDraft,
  };
}
