import { useCallback, useRef } from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  Message,
  TopicMessageData,
  TopicWorkflowMode,
  TopicWorkflowState,
  WorkflowStageKey,
} from '../types';
import type { WorkspaceBinding } from '../types';
import {
  buildThinkingProcessFromAcp,
  ensureAcpAgentSession,
  sendPromptToAcpAgent,
} from '../services/acpClient';
import {
  buildCompositeSystemPrompt,
  type TurnEpochSnapshot,
} from '../services/agentCollaboration';
import { isAgentOffline } from '../utils/agentRuntime';
import {
  applyStageOutcome,
  buildWorkflowPrompt,
  getWorkflowModeMeta,
  getWorkflowStageSpec,
  initializeWorkflowState,
  markWorkflowStageActive,
  parseDesignArtifact,
  resolveStageAgentIds,
  type WorkflowDecision,
  type WorkflowStageOutput,
} from '../services/workflow';

interface UseTopicWorkflowParams {
  agentsRef: React.MutableRefObject<Agent[]>;
  messagesRef: React.MutableRefObject<Record<string, Message[]>>;
  activeExecutionsRef: React.MutableRefObject<Record<string, ActiveAgentExecution>>;
  getTopicData: (topicId: string) => TopicMessageData | null | undefined;
  updateTopicDataInState: (
    topicId: string,
    updater: (old: TopicMessageData) => TopicMessageData
  ) => void;
  commitMessages: (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => void;
  getTopicWorkspaceBinding: (topicId: string) => WorkspaceBinding | undefined;
  setActiveExecutions: React.Dispatch<
    React.SetStateAction<Record<string, ActiveAgentExecution>>
  >;
  setIsGenerating: (value: boolean) => void;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  captureTurnEpoch: (
    roomId: string,
    channelId?: string,
    agentId?: string
  ) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  syncRunningAgentsWithBackend: () => void;
}

interface StageRunContext {
  topic: TopicMessageData;
  state: TopicWorkflowState;
  stageKey: WorkflowStageKey;
  agentIds: string[];
  userContent?: string;
  kickoffUserMessageId: string;
  runToken: string;
}

const ORCHESTRATOR = {
  authorId: 'workflow-orchestrator',
  authorName: 'Shinobi 工作流编排',
  authorHandle: '@workflow-orchestrator',
};

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const USER_ABORT_FAILURE_REASON = '用户已终止该 Agent 的阶段执行';

function isGuardFailureText(text: string): boolean {
  return /^(🔌 \*\*Agent 通信不可用\*\*|🛑 \*\*专家能力包|⚠️【)/.test(text.trim());
}

function formatDiffEvidence(
  diffs: Array<{ filename: string; additions: number; deletions: number }>
): string {
  if (diffs.length === 0) return '';
  return `\n\n[工作区改动]\n${diffs
    .map((diff) => `- ${diff.filename} (+${diff.additions}/-${diff.deletions})`)
    .join('\n')}`;
}

export function useTopicWorkflow(params: UseTopicWorkflowParams) {
  const {
    agentsRef,
    messagesRef,
    activeExecutionsRef,
    getTopicData,
    updateTopicDataInState,
    commitMessages,
    getTopicWorkspaceBinding,
    setActiveExecutions,
    setIsGenerating,
    setAgents,
    captureTurnEpoch,
    isTurnStale,
    syncRunningAgentsWithBackend,
  } = params;

  const runningRef = useRef<Set<string>>(new Set());

  const postSystem = useCallback(
    (topicId: string, content: string, badge: string, avatar: string) => {
      const message: Message = {
        id: `wf-system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        threadId: topicId,
        authorId: ORCHESTRATOR.authorId,
        authorName: ORCHESTRATOR.authorName,
        authorHandle: ORCHESTRATOR.authorHandle,
        authorAvatar: avatar,
        isAgent: true,
        kind: 'system_control',
        agentBadge: badge,
        timestamp: nowLabel(),
        content,
      };
      commitMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), message],
      }));
    },
    [commitMessages]
  );

  const persistState = useCallback(
    (topicId: string, state: TopicWorkflowState) => {
      updateTopicDataInState(topicId, (old) => ({ ...old, workflowState: state }));
    },
    [updateTopicDataInState]
  );

  const isAborted = useCallback(
    (topicId: string, runToken: string): boolean => {
      const latest = getTopicData(topicId);
      if (!latest) return true;
      if (latest.status === 'resolved') return true;
      return latest.workflowState?.runToken !== runToken;
    },
    [getTopicData]
  );

  const hasNewUserMessage = useCallback(
    (topicId: string, kickoffUserMessageId: string): boolean =>
      (messagesRef.current[topicId] || []).some(
        (message) =>
          message.authorId === 'user-norris' && message.id !== kickoffUserMessageId
      ),
    [messagesRef]
  );

  const resolveAcceptanceCriteria = useCallback((state: TopicWorkflowState): string => {
    const designArtifacts = state.artifacts.filter(
      (artifact) => artifact.stageKey === 'build_design'
    );
    const latest = designArtifacts[designArtifacts.length - 1];
    if (!latest) return '';
    return parseDesignArtifact(latest.content).acceptanceCriteria;
  }, []);

  const runStageAgent = useCallback(
    async (ctx: StageRunContext, agentId: string): Promise<WorkflowStageOutput> => {
      const { topic, state, stageKey, userContent } = ctx;
      const spec = getWorkflowStageSpec(stageKey);
      const currentAgents = agentsRef.current;
      const agent = currentAgents.find((item) => item.id === agentId);
      if (!agent) {
        return {
          agentId,
          agentName: agentId,
          messageId: '',
          content: '',
          failed: true,
          failureReason: '该 Agent 已不在团队中',
        };
      }
      if (isAgentOffline(agent)) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          messageId: '',
          content: '',
          failed: true,
          failureReason: 'ACP 通信未开启，阶段未派发',
        };
      }

      const binding = getTopicWorkspaceBinding(topic.id);
      const participants = currentAgents.filter((item) =>
        topic.participatingAgentIds.includes(item.id)
      );
      const execKey = `${topic.id}:${agent.id}`;
      const pendingId = `wf-pending-${Date.now()}-${agent.id}`;
      const startedAt = Date.now();

      setAgents((prev) =>
        prev.map((item) =>
          item.id === agent.id && item.status !== 'running'
            ? { ...item, status: 'running' }
            : item
        )
      );
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: agent.id,
          agentName: agent.name,
          agentAvatar: agent.avatar,
          threadId: topic.id,
          topicId: topic.id,
          status: 'thinking',
          currentActionDetail: spec.pendingHint,
          startedAt,
        },
      }));
      setIsGenerating(true);

      const pendingMessage: Message = {
        id: pendingId,
        threadId: topic.id,
        channelId: topic.channelId,
        authorId: agent.id,
        authorName: agent.name,
        authorHandle: agent.handle,
        authorAvatar: agent.avatar,
        isAgent: true,
        isPending: true,
        startedAt,
        pendingHint: spec.pendingHint,
        agentBadge: `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${spec.icon} ${spec.label}`,
        timestamp: nowLabel(),
        content: '',
        workflowStage: stageKey,
        workflowRole: spec.role,
      };
      commitMessages((prev) => ({
        ...prev,
        [topic.id]: [...(prev[topic.id] || []), pendingMessage],
      }));

      const replacePending = (message: Message) => {
        commitMessages((prev) => {
          const list = prev[topic.id] || [];
          const hasPending = list.some((item) => item.id === pendingId);
          const nextList = hasPending
            ? list.map((item) => (item.id === pendingId ? message : item))
            : [...list, message];
          return { ...prev, [topic.id]: nextList };
        });
      };

      const removeExecution = () => {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
      };

      // 用户单独终止该 Agent 时，activeExecutionsRef 会被同步删除；据此把阶段显式判为失败，
      // 避免阶段门禁拿着残缺输出继续推进后续阶段。
      const isExecutionAborted = () => !activeExecutionsRef.current[execKey];
      const abortedOutput = (): WorkflowStageOutput => {
        replacePending({
          id: `wf-reply-abort-${Date.now()}-${agent.id}`,
          threadId: topic.id,
          channelId: topic.channelId,
          authorId: agent.id,
          authorName: agent.name,
          authorHandle: agent.handle,
          authorAvatar: agent.avatar,
          isAgent: true,
          kind: 'error',
          agentBadge: '已终止',
          timestamp: nowLabel(),
          content: '*(已由用户手动终止该 Agent 的阶段执行)*',
          workflowStage: stageKey,
          workflowRole: spec.role,
        });
        return {
          agentId: agent.id,
          agentName: agent.name,
          messageId: '',
          content: '',
          failed: true,
          failureReason: USER_ABORT_FAILURE_REASON,
        };
      };

      const systemPrompt = buildCompositeSystemPrompt({
        agent,
        availableAgents: participants,
        includeRoster: true,
      });

      try {
        await ensureAcpAgentSession({
          agentId: agent.id,
          roomId: topic.id,
          channelId: topic.channelId,
          systemPrompt,
          discussionMode: 'workflow',
          workspaceBindingId: topic.workspaceBindingId,
          workspaceCwd: binding?.cwd,
          scopeType: 'topic',
          localHistoryIntact: state.artifacts.length > 0,
        });
      } catch (err) {
        const abortedByUser = isExecutionAborted();
        removeExecution();
        if (abortedByUser) {
          return abortedOutput();
        }
        const reason = err instanceof Error ? err.message : String(err);
        replacePending({
          id: `wf-reply-err-${Date.now()}-${agent.id}`,
          threadId: topic.id,
          channelId: topic.channelId,
          authorId: agent.id,
          authorName: agent.name,
          authorHandle: agent.handle,
          authorAvatar: agent.avatar,
          isAgent: true,
          kind: 'error',
          agentBadge: 'ACP Error',
          timestamp: nowLabel(),
          content: `⚠️ **会话初始化异常**：${reason}`,
          workflowStage: stageKey,
          workflowRole: spec.role,
        });
        return {
          agentId: agent.id,
          agentName: agent.name,
          messageId: '',
          content: '',
          failed: true,
          failureReason: `会话初始化异常：${reason}`,
        };
      }

      if (isExecutionAborted()) {
        return abortedOutput();
      }

      const prompt = buildWorkflowPrompt({
        topicTitle: topic.title,
        topicDescription: topic.description,
        state,
        stageKey,
        targetAgent: agent,
        participants,
        userContent,
        attempt: state.stages.find((record) => record.key === stageKey)?.attempt ?? 1,
        acceptanceCriteria:
          stageKey === 'build_verify' ? resolveAcceptanceCriteria(state) : undefined,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent,
          roomId: topic.id,
          channelId: topic.channelId,
          prompt,
          workspaceBindingId: topic.workspaceBindingId,
          workspaceCwd: binding?.cwd,
          scopeType: 'topic',
          systemPrompt,
          discussionMode: 'workflow',
        });
        const abortedByUser = isExecutionAborted();
        removeExecution();
        if (abortedByUser) {
          return abortedOutput();
        }

        const rawText = acpResp.textResponse || '';
        const diffs = acpResp.workspaceDiffs ?? [];
        const failed =
          Boolean(acpResp.isError) ||
          Boolean(acpResp.isEmptyTurn) ||
          !rawText.trim() ||
          isGuardFailureText(rawText);

        const content = failed
          ? rawText
          : `${rawText}${formatDiffEvidence(diffs)}`;
        const messageId = `wf-reply-${Date.now()}-${agent.id}`;

        replacePending({
          id: messageId,
          threadId: topic.id,
          channelId: topic.channelId,
          authorId: agent.id,
          authorName: agent.name,
          authorHandle: agent.handle,
          authorAvatar: agent.avatar,
          isAgent: true,
          kind: failed ? 'error' : 'normal',
          agentBadge: `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${spec.icon} ${spec.label}`,
          timestamp: nowLabel(),
          content,
          thinkingProcess: buildThinkingProcessFromAcp(
            acpResp,
            `已完成工作流阶段：${spec.label}`
          ),
          diffView: diffs.length > 0 ? diffs[0] : undefined,
          workflowStage: stageKey,
          workflowRole: spec.role,
        });

        if (failed) {
          return {
            agentId: agent.id,
            agentName: agent.name,
            messageId: '',
            content: '',
            failed: true,
            failureReason: rawText.trim() || 'ACP 未返回有效内容',
          };
        }

        return {
          agentId: agent.id,
          agentName: agent.name,
          messageId,
          content,
          filesTouched: diffs.map((diff) => diff.filename),
        };
      } catch (err) {
        const abortedByUser = isExecutionAborted();
        removeExecution();
        if (abortedByUser) {
          return abortedOutput();
        }
        const reason = err instanceof Error ? err.message : String(err);
        replacePending({
          id: `wf-reply-err-${Date.now()}-${agent.id}`,
          threadId: topic.id,
          channelId: topic.channelId,
          authorId: agent.id,
          authorName: agent.name,
          authorHandle: agent.handle,
          authorAvatar: agent.avatar,
          isAgent: true,
          kind: 'error',
          agentBadge: 'ACP Error',
          timestamp: nowLabel(),
          content: `⚠️ **阶段执行异常**：${reason}`,
          workflowStage: stageKey,
          workflowRole: spec.role,
        });
        return {
          agentId: agent.id,
          agentName: agent.name,
          messageId: '',
          content: '',
          failed: true,
          failureReason: reason,
        };
      }
    },
    [
      activeExecutionsRef,
      agentsRef,
      commitMessages,
      getTopicWorkspaceBinding,
      resolveAcceptanceCriteria,
      setActiveExecutions,
      setAgents,
      setIsGenerating,
    ]
  );

  const backfillArtifactIds = useCallback(
    (topicId: string, artifacts: TopicWorkflowState['artifacts']) => {
      if (artifacts.length === 0) return;
      const artifactIdByMessage = new Map(
        artifacts.map((artifact) => [artifact.messageId, artifact.id])
      );
      commitMessages((prev) => {
        const list = prev[topicId] || [];
        let changed = false;
        const nextList = list.map((message) => {
          const artifactId = artifactIdByMessage.get(message.id);
          if (!artifactId || message.workflowArtifactId === artifactId) return message;
          changed = true;
          return { ...message, workflowArtifactId: artifactId };
        });
        return changed ? { ...prev, [topicId]: nextList } : prev;
      });
    },
    [commitMessages]
  );

  const postDecisionNotice = useCallback(
    (topicId: string, decision: WorkflowDecision, stageLabel: string) => {
      const notes = decision.notes.length > 0 ? `\n${decision.notes.map((note) => `- ${note}`).join('\n')}` : '';
      if (decision.kind === 'advance' && decision.nextStageKey) {
        const nextSpec = getWorkflowStageSpec(decision.nextStageKey);
        postSystem(
          topicId,
          `▶️ 阶段「${stageLabel}」通过门禁，进入「${nextSpec.label}」。${notes}`,
          '工作流接力',
          '➡️'
        );
        return;
      }
      if (decision.kind === 'retry') {
        postSystem(
          topicId,
          `🔁 阶段「${stageLabel}」未通过门禁：${decision.reason || '需返工'}${notes}`,
          '工作流返工',
          '🔁'
        );
        return;
      }
      if (decision.kind === 'complete') {
        postSystem(
          topicId,
          `✅ 工作流已完成${decision.verdict ? `：${decision.verdict}` : ''}。${notes}`,
          '工作流完成',
          '✅'
        );
        return;
      }
      postSystem(
        topicId,
        `⛔ 工作流在阶段「${stageLabel}」中断：${decision.reason || '未知原因'}${notes}`,
        decision.kind === 'blocked' ? '工作流阻断' : '工作流失败',
        '⛔'
      );
    },
    [postSystem]
  );

  const cancelTopicWorkflow = useCallback(
    (topicId: string, reason: string) => {
      const topic = getTopicData(topicId);
      if (!topic?.workflowState) return;
      const cancelled: TopicWorkflowState = {
        ...topic.workflowState,
        status: 'cancelled',
        runToken: undefined,
        currentStageKey: undefined,
        blockingReason: reason,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistState(topicId, cancelled);
      postSystem(topicId, `⏹️ 工作流已取消：${reason}`, '工作流取消', '⏹️');
    },
    [getTopicData, persistState, postSystem]
  );

  const runTopicWorkflow = useCallback(
    async (
      topicId: string,
      userContent: string,
      kickoffUserMessageId: string,
      modeOverride?: TopicWorkflowMode
    ) => {
      if (runningRef.current.has(topicId)) {
        postSystem(
          topicId,
          '⏳ 当前议题已有工作流在执行，本轮输入会在当前阶段结束后再处理。',
          '工作流排队',
          '⏳'
        );
        return;
      }
      const topic = getTopicData(topicId);
      if (!topic) return;
      const mode = modeOverride || topic.workflowState?.mode;
      if (!mode) {
        postSystem(topicId, '⛔ 议题缺少工作流模式配置，无法启动。', '工作流失败', '⛔');
        return;
      }
      if (topic.workflowState?.status === 'running') {
        postSystem(topicId, '⏳ 工作流仍在执行中，请等待当前阶段结束。', '工作流排队', '⏳');
        return;
      }

      const participants = agentsRef.current.filter((agent) =>
        topic.participatingAgentIds.includes(agent.id)
      );
      const onlineParticipants = participants.filter((agent) => !isAgentOffline(agent));
      const offlineNames = participants
        .filter((agent) => isAgentOffline(agent))
        .map((agent) => agent.name);

      const runToken = `wf-run-${Date.now()}`;
      const initialized = initializeWorkflowState(mode, onlineParticipants, runToken);
      const meta = getWorkflowModeMeta(mode);

      if (initialized.plan.blockingIssues.length > 0) {
        const blockedState: TopicWorkflowState = {
          ...initialized.state,
          status: 'blocked',
          blockingReason: initialized.plan.blockingIssues.join('；'),
        };
        persistState(topicId, blockedState);
        postSystem(
          topicId,
          `⛔ 无法启动【${meta.label}】工作流：${initialized.plan.blockingIssues.join('；')}${
            offlineNames.length > 0 ? `\n离线成员：${offlineNames.join('、')}` : ''
          }`,
          '工作流准入阻断',
          '⛔'
        );
        return;
      }

      runningRef.current.add(topicId);
      persistState(topicId, initialized.state);

      const roleName = (id?: string) =>
        id ? agentsRef.current.find((agent) => agent.id === id)?.name || id : '未指派';
      const kickoffLines = [
        `🧭 已启动【${meta.label}】工作流。`,
        `- 主笔/执行：${roleName(initialized.state.roles.author)}`,
        `- 独立评审：${
          initialized.state.roles.criticIds.length > 0
            ? initialized.state.roles.criticIds.map((id) => roleName(id)).join('、')
            : '无'
        }`,
        `- 独立验收：${roleName(initialized.state.roles.verifierId)}`,
        `- 阶段：${initialized.state.stageOrder
          .map((key) => getWorkflowStageSpec(key).label)
          .join(' → ')}`,
        ...(offlineNames.length > 0 ? [`- ⚠️ 离线未参与：${offlineNames.join('、')}`] : []),
        ...initialized.plan.warnings.map((warning) => `- ⚠️ ${warning}`),
      ];
      postSystem(topicId, kickoffLines.join('\n'), '工作流启动', meta.icon);

      let current = initialized.state;
      let guard = 0;
      try {
        while (guard < 40) {
          guard += 1;
          if (isAborted(topicId, runToken)) {
            return;
          }
          const stageKey = current.currentStageKey;
          if (!stageKey) break;
          const spec = getWorkflowStageSpec(stageKey);
          const agentIds = resolveStageAgentIds(spec, current.roles);

          if (agentIds.length === 0) {
            // 可选阶段无执行者：显式跳过并在进度上标记
            const nextKey = current.stageOrder
              .slice(current.stageOrder.indexOf(stageKey) + 1)
              .find((key) => resolveStageAgentIds(getWorkflowStageSpec(key), current.roles).length > 0);
            current = {
              ...current,
              stages: current.stages.map((record) =>
                record.key === stageKey ? { ...record, state: 'skipped' } : record
              ),
              currentStageKey: nextKey,
              status: nextKey ? 'running' : 'completed',
              verdict: nextKey ? current.verdict : current.verdict || 'DELIVERED',
              updatedAt: Date.now(),
            };
            persistState(topicId, current);
            if (!nextKey) break;
            continue;
          }

          current = markWorkflowStageActive(current, stageKey, agentIds);
          persistState(topicId, current);

          const turnSnapshot = captureTurnEpoch(topicId, topic.channelId);
          const ctx: StageRunContext = {
            topic,
            state: current,
            stageKey,
            agentIds,
            userContent,
            kickoffUserMessageId,
            runToken,
          };
          const outputs = await Promise.all(
            agentIds.map((agentId) => runStageAgent(ctx, agentId))
          );

          if (isAborted(topicId, runToken)) {
            return;
          }
          if (isTurnStale(turnSnapshot) || hasNewUserMessage(topicId, kickoffUserMessageId)) {
            cancelTopicWorkflow(
              topicId,
              '检测到新的用户消息或回合已失效，旧工作流已停止，避免覆盖最新指令。'
            );
            return;
          }

          const userAborted = outputs.find(
            (output) => output.failureReason === USER_ABORT_FAILURE_REASON
          );
          if (userAborted) {
            current = {
              ...current,
              stages: current.stages.map((record) =>
                record.key === stageKey
                  ? {
                      ...record,
                      state: 'failed',
                      failureReason: userAborted.failureReason,
                      finishedAt: Date.now(),
                    }
                  : record
              ),
              updatedAt: Date.now(),
            };
            persistState(topicId, current);
            cancelTopicWorkflow(
              topicId,
              `用户终止了阶段「${spec.label}」的执行者（${userAborted.agentName}），工作流已停止。`
            );
            return;
          }

          const artifactsBefore = current.artifacts.length;
          const result = applyStageOutcome(current, stageKey, outputs);
          current = result.state;
          persistState(topicId, current);
          backfillArtifactIds(topicId, current.artifacts.slice(artifactsBefore));
          postDecisionNotice(topicId, result.decision, spec.label);

          if (result.decision.kind !== 'advance' && result.decision.kind !== 'retry') {
            break;
          }
        }
      } finally {
        runningRef.current.delete(topicId);
        syncRunningAgentsWithBackend();
      }
    },
    [
      agentsRef,
      backfillArtifactIds,
      cancelTopicWorkflow,
      captureTurnEpoch,
      getTopicData,
      hasNewUserMessage,
      isAborted,
      isTurnStale,
      persistState,
      postDecisionNotice,
      postSystem,
      runStageAgent,
      syncRunningAgentsWithBackend,
    ]
  );

  const isTopicWorkflowRunning = useCallback(
    (topicId: string) => runningRef.current.has(topicId),
    []
  );

  return { runTopicWorkflow, cancelTopicWorkflow, isTopicWorkflowRunning };
}
