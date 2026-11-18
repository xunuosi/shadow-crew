import { useCallback, useRef } from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  Channel,
  Message,
  SubThread,
  SwarmMissionData,
  SwarmSubTask,
  TopicMessageData,
  TopicPatchDiffItem,
  WorkspaceBinding,
} from '../types';
import {
  applyTopicPatchToWorkspace,
  buildThinkingProcessFromAcp,
  ensureAcpAgentSession,
  extractWorkspaceDiffsFromText,
  sendPromptToAcpAgent,
} from '../services/acpClient';
import {
  buildAgentPersonaPrompt,
  bumpAgentExecutionEpoch,
  type TurnEpochSnapshot,
  type TurnEpochTracker,
} from '../services/agentCollaboration';
import { applyPromptNativeMemoryCapability } from '../services/remoteAgentLifecycle';
import {
  aggregateSwarmWorkerDiffs,
  buildFallbackSwarmPlan,
  buildSwarmDecompositionPrompt,
  buildSwarmLeadReducePrompt,
  buildSwarmReduceRoomId,
  buildSwarmSubThreadId,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerRoomId,
  canAutoTriggerSwarmReduce,
  computeSwarmFileOverlaps,
  extractSwarmPlanFromText,
  isSwarmChildRoomId,
  resolveSwarmLeadAndWorkers,
} from '../services/swarmOrchestration';
import { isAgentOffline } from '../utils/agentRuntime';

export interface UseSwarmOrchestratorParams {
  agents: Agent[];
  agentsRef: React.MutableRefObject<Agent[]>;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  channels: Channel[];
  activeChannel: Channel | null;
  messagesRef: React.MutableRefObject<Record<string, Message[]>>;
  commitMessages: (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => void;
  setSubThreads: React.Dispatch<React.SetStateAction<Record<string, SubThread>>>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((
          prev: Record<string, ActiveAgentExecution>
        ) => Record<string, ActiveAgentExecution>)
  ) => void;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  turnEpochTrackerRef: React.MutableRefObject<TurnEpochTracker>;
  captureTurnEpoch: (
    roomId?: string,
    channelId?: string,
    agentId?: string
  ) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  getChannelWorkspaceBinding: (
    channelId?: string
  ) => WorkspaceBinding | undefined;
  getTopicData?: (topicId: string) => TopicMessageData | null | undefined;
  getTopicWorkspaceBinding?: (
    topicId?: string
  ) => WorkspaceBinding | undefined;
  logRpc: (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => void;
}

export interface SwarmMissionActions {
  handleUpdateSwarmSubTask: (
    roomId: string,
    messageId: string,
    taskId: string,
    patch: Partial<
      Pick<SwarmSubTask, 'enabled' | 'assignedAgentId' | 'description' | 'title'>
    >
  ) => void;
  handleConfirmSwarmDispatch: (
    roomId: string,
    messageId: string
  ) => Promise<void>;
  handleAbortSwarmSubTask: (
    roomId: string,
    messageId: string,
    taskId: string
  ) => void;
  handleRetrySwarmSubTask: (
    roomId: string,
    messageId: string,
    taskId: string,
    reassignAgentId?: string
  ) => Promise<void>;
  handleSkipSwarmSubTask: (
    roomId: string,
    messageId: string,
    taskId: string
  ) => Promise<void>;
  handleTriggerSwarmLeadReduce: (
    roomId: string,
    messageId: string
  ) => Promise<void>;
  handleCancelSwarmMission: (roomId: string, messageId: string) => void;
  handleRetrySwarmDecomposition: (
    roomId: string,
    messageId: string
  ) => Promise<void>;
  handleApplySwarmPatch: (
    messageId: string,
    customDiffs?: TopicPatchDiffItem[]
  ) => Promise<void>;
  abortSwarmMissionsInThread: (roomId: string) => void;
  abortSwarmByExecution: (agentId: string, threadId: string) => boolean;
}

function formatNowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function useSwarmOrchestrator({
  agentsRef,
  setAgents,
  channels,
  activeChannel,
  messagesRef,
  commitMessages,
  setSubThreads,
  setActiveExecutions,
  setIsGenerating,
  turnEpochTrackerRef,
  captureTurnEpoch,
  isTurnStale,
  getChannelWorkspaceBinding,
  getTopicData,
  getTopicWorkspaceBinding,
  logRpc,
}: UseSwarmOrchestratorParams): SwarmMissionActions {
  const inFlightReduceRef = useRef<Set<string>>(new Set());
  const inFlightDecomposeRef = useRef<Set<string>>(new Set());

  const resolveRoomScopeType = useCallback(
    (roomId: string): 'topic' | 'channel' => {
      if (getTopicData?.(roomId) || roomId.startsWith('topic-')) {
        return 'topic';
      }
      return 'channel';
    },
    [getTopicData]
  );

  const resolveRoomWorkspaceBinding = useCallback(
    (roomId: string, channelId?: string): WorkspaceBinding | undefined => {
      if (resolveRoomScopeType(roomId) === 'topic') {
        return (
          getTopicWorkspaceBinding?.(roomId) ||
          getChannelWorkspaceBinding(channelId)
        );
      }
      return getChannelWorkspaceBinding(channelId);
    },
    [getChannelWorkspaceBinding, getTopicWorkspaceBinding, resolveRoomScopeType]
  );

  const getSwarmMessage = useCallback(
    (
      roomId: string,
      messageId: string
    ): { message: Message; mission: SwarmMissionData } | null => {
      const roomMsgs = messagesRef.current[roomId] || [];
      const message = roomMsgs.find((m) => m.id === messageId);
      if (!message || !message.swarmMission) return null;
      return { message, mission: message.swarmMission };
    },
    [messagesRef]
  );

  const updateSwarmMission = useCallback(
    (
      roomId: string,
      messageId: string,
      updater: (mission: SwarmMissionData) => SwarmMissionData,
      messageUpdater?: (msg: Message, nextMission: SwarmMissionData) => Partial<Message>
    ) => {
      commitMessages((prev) => {
        const list = prev[roomId];
        if (!list || list.length === 0) return prev;
        let changed = false;
        const nextList = list.map((msg) => {
          if (msg.id !== messageId || !msg.swarmMission) return msg;
          changed = true;
          const nextMission = updater(msg.swarmMission);
          const extraPatch = messageUpdater ? messageUpdater(msg, nextMission) : {};
          return {
            ...msg,
            ...extraPatch,
            swarmMission: nextMission,
          };
        });
        if (!changed) return prev;
        return {
          ...prev,
          [roomId]: nextList,
        };
      });
    },
    [commitMessages]
  );

  const upsertSwarmWorkerSubThread = useCallback(
    (options: {
      roomId: string;
      channelId?: string;
      messageId: string;
      missionId: string;
      subTask: SwarmSubTask;
      workerAgent?: Agent;
      appendMessage?: Message;
      isResolved?: boolean;
      replaceMessages?: Message[];
    }) => {
      const {
        roomId,
        channelId,
        messageId,
        missionId,
        subTask,
        workerAgent,
        appendMessage,
        isResolved,
        replaceMessages,
      } = options;
      const subThreadId =
        subTask.subThreadId || buildSwarmSubThreadId(missionId, subTask.taskId);

      setSubThreads((prev) => {
        const existing = prev[subThreadId];
        const baseMessages: Message[] = replaceMessages
          ? replaceMessages
          : existing?.messages || [
              {
                id: `swarm-sub-seed-${missionId}-${subTask.taskId}`,
                threadId: roomId,
                channelId,
                subThreadId,
                authorId: 'user-me',
                authorName: 'Swarm 任务分片',
                authorHandle: '@swarm',
                authorAvatar: '🐝',
                isAgent: false,
                timestamp: formatNowTime(),
                content:
                  `**子任务**：${subTask.title}\n\n` +
                  `**目标与约束**：\n${subTask.description}` +
                  (subTask.allowedFiles && subTask.allowedFiles.length > 0
                    ? `\n\n**允许改动白名单**：\`${subTask.allowedFiles.join('`, `')}\``
                    : ''),
              },
            ];

        const nextMessages = appendMessage
          ? [...baseMessages, appendMessage]
          : baseMessages;

        return {
          ...prev,
          [subThreadId]: {
            id: subThreadId,
            parentMessageId: messageId,
            threadId: roomId,
            title: `🐝 ${subTask.title}`,
            quoteSnippet: subTask.description,
            messages: nextMessages,
            participatingAgentIds: Array.from(
              new Set([
                ...(existing?.participatingAgentIds || []),
                workerAgent?.id || subTask.assignedAgentId,
              ])
            ),
            isResolved:
              typeof isResolved === 'boolean'
                ? isResolved
                : existing?.isResolved,
          },
        };
      });
    },
    [setSubThreads]
  );

  const handleTriggerSwarmLeadReduce = useCallback(
    async (roomId: string, messageId: string): Promise<void> => {
      if (inFlightReduceRef.current.has(messageId)) return;

      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      if (mission.status === 'cancelled' || mission.status === 'completed') {
        return;
      }

      const enabledCompletedCount = mission.subTasks.filter(
        (t) => t.enabled && t.status === 'completed'
      ).length;
      if (enabledCompletedCount === 0) return;

      inFlightReduceRef.current.add(messageId);
      const reduceRoomId = buildSwarmReduceRoomId(roomId, mission.missionId);
      const leadAgent = agentsRef.current.find(
        (a) => a.id === mission.leadAgentId
      );

      if (!leadAgent || isAgentOffline(leadAgent)) {
        const fallbackDiffs = aggregateSwarmWorkerDiffs(mission.subTasks);
        updateSwarmMission(roomId, messageId, (m) => ({
          ...m,
          status: 'running_workers',
          aggregatedDiffs:
            fallbackDiffs.length > 0 ? fallbackDiffs : m.aggregatedDiffs,
          reduceError: `Lead Agent（${leadAgent?.name || mission.leadAgentId}）当前离线或不可用，无法执行最终 Reduce 汇总验收；请先启动该 Agent 后点击“重试汇总验收”。`,
        }));
        inFlightReduceRef.current.delete(messageId);
        return;
      }

      const execKey = `${reduceRoomId}:${leadAgent.id}`;
      const turnSnapshot = captureTurnEpoch(
        reduceRoomId,
        mission.channelId,
        leadAgent.id
      );

      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        status: 'reducing',
        reduceError: undefined,
      }));

      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: leadAgent.id,
          agentName: leadAgent.name,
          agentAvatar: leadAgent.avatar,
          threadId: reduceRoomId,
          status: 'thinking',
          currentActionDetail: '🐝 正在执行 Swarm Reduce 验收汇总...',
          startedAt: Date.now(),
        },
      }));

      try {
        const roomScopeType = resolveRoomScopeType(roomId);
        const roomBinding = resolveRoomWorkspaceBinding(roomId, mission.channelId);
        const reducePrompt = buildSwarmLeadReducePrompt({
          mission,
          leadAgent,
          agents: agentsRef.current,
        });

        await ensureAcpAgentSession({
          agentId: leadAgent.id,
          roomId: reduceRoomId,
          channelId: mission.channelId,
          systemPrompt: buildAgentPersonaPrompt(leadAgent),
          discussionMode: 'standard',
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          localHistoryIntact: false,
        });

        logRpc(leadAgent.name, 'client_to_agent', 'swarm/reduce:prompt', {
          missionId: mission.missionId,
          reduceRoomId,
          promptLength: reducePrompt.length,
        });

        const acpResp = await sendPromptToAcpAgent({
          agent: leadAgent,
          roomId: reduceRoomId,
          prompt: reducePrompt,
          channelId: mission.channelId,
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          discussionMode: 'standard',
          systemPrompt: buildAgentPersonaPrompt(leadAgent),
        });

        if (acpResp.nativeMemoryCapability) {
          setAgents((prev) =>
            applyPromptNativeMemoryCapability(
              prev,
              leadAgent.id,
              acpResp.nativeMemoryCapability,
              leadAgent
            )
          );
        }

        if (isTurnStale(turnSnapshot)) {
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          const errText =
            acpResp.isError && acpResp.textResponse.trim()
              ? acpResp.textResponse.trim()
              : 'Lead Agent 在 Reduce 汇总阶段返回空内容';
          const fallbackDiffs = aggregateSwarmWorkerDiffs(mission.subTasks);
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            status: 'running_workers',
            aggregatedDiffs:
              fallbackDiffs.length > 0 ? fallbackDiffs : m.aggregatedDiffs,
            reduceError: errText,
          }));
          return;
        }

        logRpc(leadAgent.name, 'agent_to_client', 'swarm/reduce:result', {
          missionId: mission.missionId,
          durationMs: acpResp.durationMs,
          diffCount: acpResp.workspaceDiffs?.length || 0,
        });

        const leadDiffs =
          acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
            ? acpResp.workspaceDiffs
            : extractWorkspaceDiffsFromText(acpResp.textResponse);

        const latestFound = getSwarmMessage(roomId, messageId);
        const latestTasks = latestFound?.mission.subTasks || mission.subTasks;
        const aggregatedDiffs = aggregateSwarmWorkerDiffs(latestTasks, leadDiffs);

        updateSwarmMission(roomId, messageId, (m) => ({
          ...m,
          status: 'completed',
          finalSynthesis: acpResp.textResponse.trim(),
          aggregatedDiffs:
            aggregatedDiffs.length > 0 ? aggregatedDiffs : undefined,
          completedAt: Date.now(),
          reduceError: undefined,
        }));
      } catch (err) {
        if (!isTurnStale(turnSnapshot)) {
          const msgText = err instanceof Error ? err.message : String(err);
          const fallbackDiffs = aggregateSwarmWorkerDiffs(mission.subTasks);
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            status: 'running_workers',
            aggregatedDiffs:
              fallbackDiffs.length > 0 ? fallbackDiffs : m.aggregatedDiffs,
            reduceError: `汇总异常：${msgText}`,
          }));
        }
      } finally {
        inFlightReduceRef.current.delete(messageId);
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
      }
    },
    [
      agentsRef,
      captureTurnEpoch,
      getSwarmMessage,
      isTurnStale,
      logRpc,
      resolveRoomScopeType,
      resolveRoomWorkspaceBinding,
      setActiveExecutions,
      setAgents,
      setIsGenerating,
      updateSwarmMission,
    ]
  );

  const runSingleSwarmWorker = useCallback(
    async (options: {
      roomId: string;
      messageId: string;
      missionSnapshot: SwarmMissionData;
      taskSnapshot: SwarmSubTask;
    }): Promise<void> => {
      const { roomId, messageId, missionSnapshot, taskSnapshot } = options;
      const workerAgent = agentsRef.current.find(
        (a) => a.id === taskSnapshot.assignedAgentId
      );
      const leadAgent = agentsRef.current.find(
        (a) => a.id === missionSnapshot.leadAgentId
      );
      const subThreadId =
        taskSnapshot.subThreadId ||
        buildSwarmSubThreadId(missionSnapshot.missionId, taskSnapshot.taskId);

      if (!workerAgent || isAgentOffline(workerAgent)) {
        const offlineMsg = `分配的执行者 ${workerAgent?.name || taskSnapshot.assignedAgentId} 当前处于离线/不可用状态`;
        updateSwarmMission(roomId, messageId, (m) => ({
          ...m,
          subTasks: m.subTasks.map((t) =>
            t.taskId === taskSnapshot.taskId
              ? {
                  ...t,
                  status: 'failed',
                  finishedAt: Date.now(),
                  errorMessage: offlineMsg,
                }
              : t
          ),
        }));
        upsertSwarmWorkerSubThread({
          roomId,
          channelId: missionSnapshot.channelId,
          messageId,
          missionId: missionSnapshot.missionId,
          subTask: taskSnapshot,
          workerAgent,
          isResolved: false,
          appendMessage: {
            id: `swarm-worker-err-${Date.now()}-${taskSnapshot.taskId}`,
            threadId: roomId,
            channelId: missionSnapshot.channelId,
            subThreadId,
            authorId: workerAgent?.id || taskSnapshot.assignedAgentId,
            authorName: workerAgent?.name || taskSnapshot.assignedAgentId,
            authorHandle: workerAgent?.handle || '@worker',
            authorAvatar: workerAgent?.avatar || '🤖',
            isAgent: true,
            agentBadge: '🐝 Swarm Worker Offline',
            timestamp: formatNowTime(),
            content: `⚠️ **执行失败**：${offlineMsg}`,
          },
        });
        return;
      }

      const workerRoomId = buildSwarmWorkerRoomId(roomId, taskSnapshot.taskId);
      const execKey = `${workerRoomId}:${workerAgent.id}`;
      const turnSnapshot = captureTurnEpoch(
        workerRoomId,
        missionSnapshot.channelId,
        workerAgent.id
      );
      const startedAt = Date.now();

      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        subTasks: m.subTasks.map((t) =>
          t.taskId === taskSnapshot.taskId
            ? {
                ...t,
                subThreadId,
                status: 'running',
                startedAt,
                finishedAt: undefined,
                durationMs: undefined,
                errorMessage: undefined,
              }
            : t
        ),
      }));

      upsertSwarmWorkerSubThread({
        roomId,
        channelId: missionSnapshot.channelId,
        messageId,
        missionId: missionSnapshot.missionId,
        subTask: { ...taskSnapshot, subThreadId },
        workerAgent,
        isResolved: false,
      });

      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: workerAgent.id,
          agentName: workerAgent.name,
          agentAvatar: workerAgent.avatar,
          threadId: workerRoomId,
          status: 'thinking',
          currentActionDetail: `🐝 ${taskSnapshot.title}`,
          startedAt,
        },
      }));

      try {
        const roomScopeType = resolveRoomScopeType(roomId);
        const roomBinding = resolveRoomWorkspaceBinding(
          roomId,
          missionSnapshot.channelId
        );
        const workerPrompt = buildSwarmWorkerPrompt({
          mission: missionSnapshot,
          subTask: taskSnapshot,
          workerAgent,
          leadAgent,
        });

        await ensureAcpAgentSession({
          agentId: workerAgent.id,
          roomId: workerRoomId,
          channelId: missionSnapshot.channelId,
          systemPrompt: buildAgentPersonaPrompt(workerAgent),
          discussionMode: 'standard',
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          localHistoryIntact: false,
        });

        logRpc(workerAgent.name, 'client_to_agent', 'swarm/worker:prompt', {
          missionId: missionSnapshot.missionId,
          taskId: taskSnapshot.taskId,
          workerRoomId,
          promptLength: workerPrompt.length,
        });

        const acpResp = await sendPromptToAcpAgent({
          agent: workerAgent,
          roomId: workerRoomId,
          prompt: workerPrompt,
          channelId: missionSnapshot.channelId,
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          discussionMode: 'standard',
          systemPrompt: buildAgentPersonaPrompt(workerAgent),
        });

        if (acpResp.nativeMemoryCapability) {
          setAgents((prev) =>
            applyPromptNativeMemoryCapability(
              prev,
              workerAgent.id,
              acpResp.nativeMemoryCapability,
              workerAgent
            )
          );
        }

        if (isTurnStale(turnSnapshot)) {
          return;
        }

        const finishedAt = Date.now();
        const durationMs =
          typeof acpResp.durationMs === 'number' && acpResp.durationMs > 0
            ? acpResp.durationMs
            : finishedAt - startedAt;

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          const errMsg =
            acpResp.isError && acpResp.textResponse.trim()
              ? acpResp.textResponse.trim()
              : 'Worker Agent 返回空响应，未交付有效成果';
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            subTasks: m.subTasks.map((t) =>
              t.taskId === taskSnapshot.taskId
                ? {
                    ...t,
                    status: 'failed',
                    finishedAt,
                    durationMs,
                    errorMessage: errMsg,
                  }
                : t
            ),
          }));
          upsertSwarmWorkerSubThread({
            roomId,
            channelId: missionSnapshot.channelId,
            messageId,
            missionId: missionSnapshot.missionId,
            subTask: { ...taskSnapshot, subThreadId },
            workerAgent,
            isResolved: false,
            appendMessage: {
              id: `swarm-worker-fail-${finishedAt}-${taskSnapshot.taskId}`,
              threadId: roomId,
              channelId: missionSnapshot.channelId,
              subThreadId,
              authorId: workerAgent.id,
              authorName: workerAgent.name,
              authorHandle: workerAgent.handle,
              authorAvatar: workerAgent.avatar,
              isAgent: true,
              agentBadge: '🐝 Swarm Failed',
              timestamp: formatNowTime(),
              content: `❌ **子任务执行失败**：${errMsg}`,
            },
          });
          return;
        }

        logRpc(workerAgent.name, 'agent_to_client', 'swarm/worker:result', {
          missionId: missionSnapshot.missionId,
          taskId: taskSnapshot.taskId,
          durationMs,
        });

        const workerDiffs =
          acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
            ? acpResp.workspaceDiffs
            : extractWorkspaceDiffsFromText(
                acpResp.textResponse,
                taskSnapshot.allowedFiles
              );

        const thinkingProcess = buildThinkingProcessFromAcp(
          acpResp,
          'Swarm 并行隔离推演完成'
        );

        // 严禁 Worker 之间横向级联：此处不提取也不触发任何 @mention
        updateSwarmMission(roomId, messageId, (m) => ({
          ...m,
          subTasks: m.subTasks.map((t) =>
            t.taskId === taskSnapshot.taskId
              ? {
                  ...t,
                  status: 'completed',
                  finishedAt,
                  durationMs,
                  resultSummary: acpResp.textResponse.trim(),
                  generatedDiffs:
                    workerDiffs.length > 0 ? workerDiffs : undefined,
                  errorMessage: undefined,
                }
              : t
          ),
        }));

        upsertSwarmWorkerSubThread({
          roomId,
          channelId: missionSnapshot.channelId,
          messageId,
          missionId: missionSnapshot.missionId,
          subTask: { ...taskSnapshot, subThreadId },
          workerAgent,
          isResolved: true,
          appendMessage: {
            id: `swarm-worker-ok-${finishedAt}-${taskSnapshot.taskId}`,
            threadId: roomId,
            channelId: missionSnapshot.channelId,
            subThreadId,
            authorId: workerAgent.id,
            authorName: workerAgent.name,
            authorHandle: workerAgent.handle,
            authorAvatar: workerAgent.avatar,
            isAgent: true,
            agentBadge: '🐝 Swarm Worker',
            timestamp: formatNowTime(),
            content: acpResp.textResponse.trim(),
            thinkingProcess,
          },
        });

        const latest = getSwarmMessage(roomId, messageId);
        if (
          latest &&
          latest.mission.status === 'running_workers' &&
          canAutoTriggerSwarmReduce(latest.mission.subTasks)
        ) {
          void handleTriggerSwarmLeadReduce(roomId, messageId);
        }
      } catch (err) {
        if (!isTurnStale(turnSnapshot)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const finishedAt = Date.now();
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            subTasks: m.subTasks.map((t) =>
              t.taskId === taskSnapshot.taskId
                ? {
                    ...t,
                    status: 'failed',
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    errorMessage: errMsg,
                  }
                : t
            ),
          }));
          upsertSwarmWorkerSubThread({
            roomId,
            channelId: missionSnapshot.channelId,
            messageId,
            missionId: missionSnapshot.missionId,
            subTask: { ...taskSnapshot, subThreadId },
            workerAgent,
            isResolved: false,
            appendMessage: {
              id: `swarm-worker-err-${finishedAt}-${taskSnapshot.taskId}`,
              threadId: roomId,
              channelId: missionSnapshot.channelId,
              subThreadId,
              authorId: workerAgent.id,
              authorName: workerAgent.name,
              authorHandle: workerAgent.handle,
              authorAvatar: workerAgent.avatar,
              isAgent: true,
              agentBadge: '🐝 Swarm Error',
              timestamp: formatNowTime(),
              content: `⚠️ **执行异常**：${errMsg}`,
            },
          });
        }
      } finally {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
      }
    },
    [
      agentsRef,
      captureTurnEpoch,
      getSwarmMessage,
      handleTriggerSwarmLeadReduce,
      isTurnStale,
      logRpc,
      resolveRoomScopeType,
      resolveRoomWorkspaceBinding,
      setActiveExecutions,
      setAgents,
      setIsGenerating,
      updateSwarmMission,
      upsertSwarmWorkerSubThread,
    ]
  );

  const handleUpdateSwarmSubTask = useCallback(
    (
      roomId: string,
      messageId: string,
      taskId: string,
      patch: Partial<
        Pick<SwarmSubTask, 'enabled' | 'assignedAgentId' | 'description' | 'title'>
      >
    ) => {
      updateSwarmMission(roomId, messageId, (mission) => {
        const nextTasks = mission.subTasks.map((task) => {
          if (task.taskId !== taskId) return task;
          return {
            ...task,
            ...patch,
          };
        });
        return {
          ...mission,
          subTasks: computeSwarmFileOverlaps(nextTasks),
        };
      });
    },
    [updateSwarmMission]
  );

  const handleConfirmSwarmDispatch = useCallback(
    async (roomId: string, messageId: string): Promise<void> => {
      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      if (mission.status !== 'awaiting_approval') return;

      const normalizedTasks = computeSwarmFileOverlaps(mission.subTasks);
      const enabledTasks = normalizedTasks.filter((t) => t.enabled);
      if (enabledTasks.length === 0) return;

      const dispatchedAt = Date.now();
      const updatedMission: SwarmMissionData = {
        ...mission,
        status: 'running_workers',
        dispatchedAt,
        reduceError: undefined,
        subTasks: normalizedTasks.map((t) =>
          t.enabled
            ? {
                ...t,
                subThreadId:
                  t.subThreadId || buildSwarmSubThreadId(mission.missionId, t.taskId),
              }
            : t
        ),
      };

      updateSwarmMission(roomId, messageId, () => updatedMission);

      await Promise.allSettled(
        updatedMission.subTasks
          .filter((t) => t.enabled)
          .map((task) =>
            runSingleSwarmWorker({
              roomId,
              messageId,
              missionSnapshot: updatedMission,
              taskSnapshot: task,
            })
          )
      );
    },
    [getSwarmMessage, runSingleSwarmWorker, updateSwarmMission]
  );

  const handleAbortSwarmSubTask = useCallback(
    (roomId: string, messageId: string, taskId: string) => {
      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      const targetTask = mission.subTasks.find((t) => t.taskId === taskId);
      if (!targetTask || targetTask.status !== 'running') return;

      const workerRoomId = buildSwarmWorkerRoomId(roomId, taskId);
      bumpAgentExecutionEpoch(
        turnEpochTrackerRef.current,
        workerRoomId,
        targetTask.assignedAgentId,
        true
      );

      const execKey = `${workerRoomId}:${targetTask.assignedAgentId}`;
      setActiveExecutions((prev) => {
        if (!prev[execKey]) return prev;
        const next = { ...prev };
        delete next[execKey];
        if (Object.keys(next).length === 0) setIsGenerating(false);
        return next;
      });

      const finishedAt = Date.now();
      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        subTasks: m.subTasks.map((t) =>
          t.taskId === taskId
            ? {
                ...t,
                status: 'aborted',
                finishedAt,
                durationMs: t.startedAt ? finishedAt - t.startedAt : undefined,
                errorMessage: '已被用户手动中止',
              }
            : t
        ),
      }));

      const workerAgent = agentsRef.current.find(
        (a) => a.id === targetTask.assignedAgentId
      );
      const subThreadId =
        targetTask.subThreadId ||
        buildSwarmSubThreadId(mission.missionId, targetTask.taskId);
      upsertSwarmWorkerSubThread({
        roomId,
        channelId: mission.channelId,
        messageId,
        missionId: mission.missionId,
        subTask: { ...targetTask, subThreadId },
        workerAgent,
        isResolved: false,
        appendMessage: {
          id: `swarm-worker-abort-${finishedAt}-${targetTask.taskId}`,
          threadId: roomId,
          channelId: mission.channelId,
          subThreadId,
          authorId: workerAgent?.id || targetTask.assignedAgentId,
          authorName: workerAgent?.name || targetTask.assignedAgentId,
          authorHandle: workerAgent?.handle || '@worker',
          authorAvatar: workerAgent?.avatar || '🤖',
          isAgent: true,
          agentBadge: '⏹ Swarm Aborted',
          timestamp: formatNowTime(),
          content: '⏹ 该 Worker 子任务已被用户单独中止，不影响其他并行 Worker。',
        },
      });
    },
    [
      agentsRef,
      getSwarmMessage,
      setActiveExecutions,
      setIsGenerating,
      turnEpochTrackerRef,
      updateSwarmMission,
      upsertSwarmWorkerSubThread,
    ]
  );

  const handleRetrySwarmSubTask = useCallback(
    async (
      roomId: string,
      messageId: string,
      taskId: string,
      reassignAgentId?: string
    ): Promise<void> => {
      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      if (mission.status === 'cancelled') return;

      const target = mission.subTasks.find((t) => t.taskId === taskId);
      if (!target || target.status === 'running') return;

      const nextTask: SwarmSubTask = {
        ...target,
        assignedAgentId: reassignAgentId || target.assignedAgentId,
        enabled: true,
        status: 'pending',
        errorMessage: undefined,
      };

      const nextMission: SwarmMissionData = {
        ...mission,
        status: 'running_workers',
        reduceError: undefined,
        subTasks: computeSwarmFileOverlaps(
          mission.subTasks.map((t) => (t.taskId === taskId ? nextTask : t))
        ),
      };

      updateSwarmMission(roomId, messageId, () => nextMission);

      await runSingleSwarmWorker({
        roomId,
        messageId,
        missionSnapshot: nextMission,
        taskSnapshot: nextTask,
      });
    },
    [getSwarmMessage, runSingleSwarmWorker, updateSwarmMission]
  );

  const handleSkipSwarmSubTask = useCallback(
    async (roomId: string, messageId: string, taskId: string): Promise<void> => {
      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      const target = mission.subTasks.find((t) => t.taskId === taskId);
      if (!target) return;

      if (target.status === 'running') {
        const workerRoomId = buildSwarmWorkerRoomId(roomId, taskId);
        bumpAgentExecutionEpoch(
          turnEpochTrackerRef.current,
          workerRoomId,
          target.assignedAgentId,
          true
        );
      }

      const finishedAt = Date.now();
      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        subTasks: m.subTasks.map((t) =>
          t.taskId === taskId
            ? {
                ...t,
                status: 'skipped',
                finishedAt,
                errorMessage: '已由用户跳过',
              }
            : t
        ),
      }));

      const workerAgent = agentsRef.current.find(
        (a) => a.id === target.assignedAgentId
      );
      const subThreadId =
        target.subThreadId || buildSwarmSubThreadId(mission.missionId, taskId);
      upsertSwarmWorkerSubThread({
        roomId,
        channelId: mission.channelId,
        messageId,
        missionId: mission.missionId,
        subTask: { ...target, subThreadId },
        workerAgent,
        isResolved: true,
        appendMessage: {
          id: `swarm-worker-skip-${finishedAt}-${taskId}`,
          threadId: roomId,
          channelId: mission.channelId,
          subThreadId,
          authorId: 'user-me',
          authorName: 'Swarm 调度控制',
          authorHandle: '@swarm',
          authorAvatar: '⏭️',
          isAgent: false,
          timestamp: formatNowTime(),
          content: '⏭️ 用户选择跳过该子任务；若其余启用子任务已完成，系统将自动推进 Lead 汇总。',
        },
      });

      const latest = getSwarmMessage(roomId, messageId);
      if (
        latest &&
        latest.mission.status === 'running_workers' &&
        canAutoTriggerSwarmReduce(latest.mission.subTasks)
      ) {
        await handleTriggerSwarmLeadReduce(roomId, messageId);
      }
    },
    [
      agentsRef,
      getSwarmMessage,
      handleTriggerSwarmLeadReduce,
      turnEpochTrackerRef,
      updateSwarmMission,
      upsertSwarmWorkerSubThread,
    ]
  );

  const handleCancelSwarmMission = useCallback(
    (roomId: string, messageId: string) => {
      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;

      for (const task of mission.subTasks) {
        const workerRoomId = buildSwarmWorkerRoomId(roomId, task.taskId);
        bumpAgentExecutionEpoch(
          turnEpochTrackerRef.current,
          workerRoomId,
          task.assignedAgentId,
          true
        );
      }
      const reduceRoomId = buildSwarmReduceRoomId(roomId, mission.missionId);
      bumpAgentExecutionEpoch(
        turnEpochTrackerRef.current,
        reduceRoomId,
        mission.leadAgentId,
        true
      );

      setActiveExecutions((prev) => {
        const next: Record<string, ActiveAgentExecution> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (!isSwarmChildRoomId(roomId, v.threadId)) {
            next[k] = v;
          }
        }
        if (Object.keys(next).length === 0) setIsGenerating(false);
        return next;
      });

      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        status: 'cancelled',
        subTasks: m.subTasks.map((t) =>
          t.status === 'running'
            ? {
                ...t,
                status: 'aborted',
                finishedAt: Date.now(),
                errorMessage: 'Swarm 任务已取消',
              }
            : t
        ),
      }));
    },
    [
      getSwarmMessage,
      setActiveExecutions,
      setIsGenerating,
      turnEpochTrackerRef,
      updateSwarmMission,
    ]
  );

  const handleRetrySwarmDecomposition = useCallback(
    async (roomId: string, messageId: string): Promise<void> => {
      if (inFlightDecomposeRef.current.has(messageId)) return;

      const currentFound = getSwarmMessage(roomId, messageId);
      if (!currentFound) return;
      const { mission } = currentFound;
      if (mission.status !== 'awaiting_approval') return;

      const leadAgent = agentsRef.current.find(
        (a) => a.id === mission.leadAgentId
      );
      if (!leadAgent || isAgentOffline(leadAgent)) {
        updateSwarmMission(roomId, messageId, (m) => ({
          ...m,
          reduceError: `Lead Agent（${leadAgent?.name || mission.leadAgentId}）当前离线，无法重新拆解。`,
        }));
        return;
      }

      const topicData = getTopicData?.(roomId);
      const channel = channels.find(
        (c) => c.id === (mission.channelId || topicData?.channelId)
      );
      const mergedMemberIds = [
        ...(topicData?.participatingAgentIds || []),
        ...(channel?.assignedAgentIds || []),
        ...(channel?.memberIds || []),
      ];
      const channelMemberSet = new Set(mergedMemberIds);
      const candidateAgents =
        channelMemberSet.size > 0
          ? agentsRef.current.filter(
              (a) => channelMemberSet.has(a.id) && !isAgentOffline(a)
            )
          : agentsRef.current.filter((a) => !isAgentOffline(a));

      const availableForPlan =
        candidateAgents.length > 0 ? candidateAgents : [leadAgent];
      const { leadAgent: resolvedLead } = resolveSwarmLeadAndWorkers({
        candidateAgents: availableForPlan,
        mentionedAgents: [leadAgent],
      });
      const finalLead = resolvedLead || leadAgent;

      inFlightDecomposeRef.current.add(messageId);
      const execKey = `${roomId}:${finalLead.id}`;
      const turnSnapshot = captureTurnEpoch(
        roomId,
        mission.channelId,
        finalLead.id
      );

      updateSwarmMission(roomId, messageId, (m) => ({
        ...m,
        reduceError: undefined,
      }));

      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: finalLead.id,
          agentName: finalLead.name,
          agentAvatar: finalLead.avatar,
          threadId: roomId,
          status: 'thinking',
          currentActionDetail: '🐝 正在重新拆解 Swarm 并行方案...',
          startedAt: Date.now(),
        },
      }));

      try {
        const roomScopeType = resolveRoomScopeType(roomId);
        const roomBinding = resolveRoomWorkspaceBinding(roomId, mission.channelId);
        const prompt = buildSwarmDecompositionPrompt({
          leadAgent: finalLead,
          availableAgents: availableForPlan,
          taskText: mission.originalTask,
        });

        await ensureAcpAgentSession({
          agentId: finalLead.id,
          roomId,
          channelId: mission.channelId,
          systemPrompt: buildAgentPersonaPrompt(finalLead),
          discussionMode: 'standard',
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          localHistoryIntact: true,
        });

        const acpResp = await sendPromptToAcpAgent({
          agent: finalLead,
          roomId,
          prompt,
          channelId: mission.channelId,
          workspaceBindingId: roomBinding?.id,
          workspaceCwd: roomBinding?.cwd,
          scopeType: roomScopeType,
          discussionMode: 'standard',
          systemPrompt: buildAgentPersonaPrompt(finalLead),
        });

        if (isTurnStale(turnSnapshot)) return;

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            reduceError:
              acpResp.isError && acpResp.textResponse.trim()
                ? acpResp.textResponse.trim()
                : '重新拆解返回空内容',
          }));
          return;
        }

        const ctx = {
          missionId: mission.missionId,
          roomId,
          channelId: mission.channelId,
          originalTask: mission.originalTask,
          triggerMode: mission.triggerMode,
          leadAgent: finalLead,
          allChannelAgents: availableForPlan,
        };
        const extracted =
          extractSwarmPlanFromText(acpResp.textResponse, ctx) ||
          buildFallbackSwarmPlan(acpResp.textResponse, ctx);

        updateSwarmMission(
          roomId,
          messageId,
          () => ({
            ...extracted.plan,
            createdAt: mission.createdAt,
          }),
          () => ({
            content: extracted.cleanedText,
          })
        );
      } catch (err) {
        if (!isTurnStale(turnSnapshot)) {
          const errMsg = err instanceof Error ? err.message : String(err);
          updateSwarmMission(roomId, messageId, (m) => ({
            ...m,
            reduceError: `重新拆解失败：${errMsg}`,
          }));
        }
      } finally {
        inFlightDecomposeRef.current.delete(messageId);
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
      }
    },
    [
      agentsRef,
      captureTurnEpoch,
      channels,
      getSwarmMessage,
      getTopicData,
      isTurnStale,
      resolveRoomScopeType,
      resolveRoomWorkspaceBinding,
      setActiveExecutions,
      setIsGenerating,
      updateSwarmMission,
    ]
  );

  const handleApplySwarmPatch = useCallback(
    async (
      messageId: string,
      customDiffs?: TopicPatchDiffItem[]
    ): Promise<void> => {
      let targetRoomId: string | null = null;
      let targetMessage: Message | null = null;

      for (const [rId, list] of Object.entries(messagesRef.current)) {
        const hit = (list || []).find((m) => m.id === messageId && m.swarmMission);
        if (hit) {
          targetRoomId = rId;
          targetMessage = hit;
          break;
        }
      }

      if (!targetRoomId || !targetMessage?.swarmMission) return;
      const mission = targetMessage.swarmMission;
      const diffsToApply =
        customDiffs && customDiffs.length > 0
          ? customDiffs
          : mission.aggregatedDiffs && mission.aggregatedDiffs.length > 0
          ? mission.aggregatedDiffs
          : aggregateSwarmWorkerDiffs(mission.subTasks);

      if (diffsToApply.length === 0) {
        updateSwarmMission(targetRoomId, messageId, (m) => ({
          ...m,
          patchApplySummary: '暂无可合入的代码 Diff 变更。',
        }));
        return;
      }

      const binding = resolveRoomWorkspaceBinding(
        targetRoomId,
        mission.channelId || activeChannel?.id
      );
      if (!binding?.cwd) {
        updateSwarmMission(targetRoomId, messageId, (m) => ({
          ...m,
          patchApplySummary: '⚠️ 当前频道尚未绑定本地工作目录，无法写入文件。',
        }));
        return;
      }

      try {
        const res = await applyTopicPatchToWorkspace({
          workspaceBindingId: binding.id,
          workspaceRoot: binding.cwd,
          channelId: mission.channelId || activeChannel?.id || 'default',
          topicId: mission.missionId,
          patches: diffsToApply,
        });

        const appliedMap = new Map(
          (res.appliedFiles || []).map((f) => [f.filename, f])
        );
        const updatedDiffs = diffsToApply.map((d) => {
          const hit = appliedMap.get(d.filename);
          return hit
            ? {
                ...d,
                applied: true,
                appliedMode: hit.mode,
                targetPath: hit.targetPath,
              }
            : d;
        });

        const summary =
          res.summary ||
          (res.ok
            ? `已合入 ${res.appliedFiles?.length || diffsToApply.length} 个文件到工作区`
            : '部分变更未能自动合入，请检查工作区路径');

        updateSwarmMission(targetRoomId, messageId, (m) => ({
          ...m,
          patchApplied: res.ok && (res.appliedFiles?.length || 0) > 0,
          patchApplySummary: summary,
          aggregatedDiffs: updatedDiffs,
        }));
      } catch (err) {
        const msgText = err instanceof Error ? err.message : String(err);
        updateSwarmMission(targetRoomId, messageId, (m) => ({
          ...m,
          patchApplySummary: `合入工作区失败：${msgText}`,
        }));
      }
    },
    [
      activeChannel?.id,
      messagesRef,
      resolveRoomWorkspaceBinding,
      updateSwarmMission,
    ]
  );

  const abortSwarmMissionsInThread = useCallback(
    (roomId: string) => {
      const roomMsgs = messagesRef.current[roomId] || [];
      for (const msg of roomMsgs) {
        if (!msg.swarmMission) continue;
        if (
          msg.swarmMission.status === 'running_workers' ||
          msg.swarmMission.status === 'reducing'
        ) {
          handleCancelSwarmMission(roomId, msg.id);
        }
      }
    },
    [handleCancelSwarmMission, messagesRef]
  );

  const abortSwarmByExecution = useCallback(
    (agentId: string, execThreadId: string): boolean => {
      const markerIdx = execThreadId.indexOf('-swarm-');
      if (markerIdx <= 0) return false;
      const parentRoomId = execThreadId.slice(0, markerIdx);
      const tail = execThreadId.slice(markerIdx + '-swarm-'.length);
      const roomMsgs = messagesRef.current[parentRoomId] || [];

      if (tail.startsWith('reduce-')) {
        const missionId = tail.slice('reduce-'.length);
        const msg = roomMsgs.find((m) => m.swarmMission?.missionId === missionId);
        if (!msg?.swarmMission) return false;

        bumpAgentExecutionEpoch(
          turnEpochTrackerRef.current,
          execThreadId,
          agentId,
          true
        );
        const execKey = `${execThreadId}:${agentId}`;
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
        updateSwarmMission(parentRoomId, msg.id, (m) => ({
          ...m,
          status: 'running_workers',
          reduceError: '汇总验收已被用户手动中止，可点击重试。',
        }));
        return true;
      }

      const msg = roomMsgs.find(
        (m) =>
          m.swarmMission &&
          (m.swarmMission.status === 'running_workers' ||
            m.swarmMission.subTasks.some(
              (t) => t.taskId === tail && t.status === 'running'
            ))
      );
      if (!msg?.swarmMission) return false;
      handleAbortSwarmSubTask(parentRoomId, msg.id, tail);
      return true;
    },
    [
      handleAbortSwarmSubTask,
      messagesRef,
      setActiveExecutions,
      setIsGenerating,
      turnEpochTrackerRef,
      updateSwarmMission,
    ]
  );

  return {
    handleUpdateSwarmSubTask,
    handleConfirmSwarmDispatch,
    handleAbortSwarmSubTask,
    handleRetrySwarmSubTask,
    handleSkipSwarmSubTask,
    handleTriggerSwarmLeadReduce,
    handleCancelSwarmMission,
    handleRetrySwarmDecomposition,
    handleApplySwarmPatch,
    abortSwarmMissionsInThread,
    abortSwarmByExecution,
  };
}
