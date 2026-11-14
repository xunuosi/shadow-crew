import { useCallback } from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  Channel,
  Message,
  MessageAttachment,
  MessageAttachmentInput,
  Thread,
  TopicMessageData,
  WorkspaceBinding,
} from '../types';
import {
  buildAgentSessionKey,
  buildThinkingProcessFromAcp,
  ensureAcpAgentSession,
  matchesSessionScope,
  sendPromptToAcpAgent,
} from '../services/acpClient';
import {
  buildAttachmentManifest,
  persistMessageAttachments,
} from '../services/chatAttachmentService';
import {
  applyPromptNativeMemoryCapability,
  isAgentActivelyRunning,
  resetAgentHandshakeCapabilities,
} from '../services/remoteAgentLifecycle';
import {
  type AggregatedMentionTarget,
  type CollaborationCascade,
  type TopicPromptContext,
  type TurnAgentOutput,
  type TurnEpochSnapshot,
  type TurnEpochTracker,
  aggregateTurnBarrierMentions,
  buildCompositeSystemPrompt,
  buildNormalModeTurnPrompt,
  bumpChannelEpoch,
  checkLoopGuard,
  extractUnreadDeltaMessages,
  isAllMention,
  parseAgentMentions,
} from '../services/agentCollaboration';
import { isAgentOffline } from '../utils/agentRuntime';

/**
 * Payload for triggering a cascading multi-agent turn barrier hop in normal channel or standard topic mode.
 */
export interface DispatchCascadingAgentResponseOptions {
  cascadeId: string;
  invokingAgent?: Agent;
  invokingMessageId?: string;
  replyContent?: string;
  turnOutputs?: TurnAgentOutput[];
  roomId: string;
  isTopic: boolean;
  topicId?: string;
  queuedCollaborators?: Agent[];
}

/**
 * Dependencies required by {@link useNormalModeTurnOrchestrator}.
 */
export interface UseNormalModeTurnOrchestratorParams {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  agentsRef: React.MutableRefObject<Agent[]>;
  channels: Channel[];
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  activeChannel: Channel | null | undefined;
  activeThread: Thread | null;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  messagesRef: React.MutableRefObject<Record<string, Message[]>>;
  commitMessages: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  activeTopicData: TopicMessageData | null;
  getTopicData: (topicId: string) => TopicMessageData | null;
  getTopicWorkspaceBinding: (topicId?: string) => WorkspaceBinding | undefined;
  getChannelWorkspaceBinding: (channelId?: string) => WorkspaceBinding | undefined;
  activeCascadesRef: React.MutableRefObject<Record<string, CollaborationCascade>>;
  setActiveCascades: (
    updater:
      | Record<string, CollaborationCascade>
      | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
  ) => void;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  turnEpochTrackerRef: React.MutableRefObject<TurnEpochTracker>;
  captureTurnEpoch: (roomId: string, channelId?: string, agentId?: string) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  deliveredStandingContextRef: React.MutableRefObject<Set<string>>;
  sessionWatermarksRef: React.MutableRefObject<Map<string, string>>;
  persistSessionWarmState: () => void;
  clearSessionWarmScope: (scope: Parameters<typeof matchesSessionScope>[1]) => void;
  safelyClearAcpSessions: (
    agentId?: string,
    sessionKeyPrefix?: string,
    contextLabel?: string
  ) => Promise<void>;
  syncRunningAgentsWithBackend: (settleUnmatchedStarting?: boolean) => Promise<void>;
  logRpc: (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => void;
}

/**
 * Handlers returned by {@link useNormalModeTurnOrchestrator}.
 */
export interface UseNormalModeTurnOrchestratorReturn {
  dispatchCascadingAgentResponse: (
    options: DispatchCascadingAgentResponseOptions
  ) => Promise<void>;
  handleSendMessage: (
    content: string,
    pendingAttachments?: MessageAttachmentInput[]
  ) => Promise<void>;
}

/**
 * Orchestrates standard channel/DM turns and Turn Barrier multi-agent cascades
 * with @mention deduplication, Channel Guard, LoopGuard, and watermark delta extraction.
 */
export function useNormalModeTurnOrchestrator({
  agents,
  setAgents,
  agentsRef,
  channels,
  setChannels,
  activeChannel,
  activeThread,
  setThreads,
  setMessages,
  messagesRef,
  commitMessages,
  activeTopicData,
  getTopicData,
  getTopicWorkspaceBinding,
  getChannelWorkspaceBinding,
  activeCascadesRef,
  setActiveCascades,
  setActiveExecutions,
  setIsGenerating,
  turnEpochTrackerRef,
  captureTurnEpoch,
  isTurnStale,
  deliveredStandingContextRef,
  sessionWatermarksRef,
  persistSessionWarmState,
  clearSessionWarmScope,
  safelyClearAcpSessions,
  syncRunningAgentsWithBackend,
  logRpc,
}: UseNormalModeTurnOrchestratorParams): UseNormalModeTurnOrchestratorReturn {
  // 多智能体跨 Agent 互相 @ 与自主级联调度器 (Turn Barrier + Mention Deduplication + Watermark Delta Dispatcher)
  const dispatchCascadingAgentResponse = useCallback(
    async (options: DispatchCascadingAgentResponseOptions): Promise<void> => {
      const {
        cascadeId,
        invokingAgent,
        invokingMessageId,
        replyContent,
        turnOutputs,
        roomId,
        isTopic,
        topicId,
        queuedCollaborators = [],
      } = options;
      const cascade = activeCascadesRef.current[cascadeId];
      if (!cascade || cascade.isAborted) return;

      const effectiveTurnOutputs: TurnAgentOutput[] =
        turnOutputs && turnOutputs.length > 0
          ? turnOutputs
          : invokingAgent
          ? [
              {
                agent: invokingAgent,
                messageId: invokingMessageId || cascade.rootMessageId,
                replyContent: replyContent || '',
              },
            ]
          : [];

      if (effectiveTurnOutputs.length === 0) return;

      // 获取当前频道/议题准入的候选 Agent 列表 (严格限制在当前频道或议题范围内)
      const currentChannelAgentIds = Array.from(
        new Set([
          ...(activeChannel?.assignedAgentIds || []),
          ...(activeChannel?.memberIds || []),
          ...(activeThread?.activeAgentIds || []),
        ])
      );
      const channelAgents = currentChannelAgentIds
        .map((id) => agentsRef.current.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a));

      const currentTopicObj =
        isTopic && topicId ? getTopicData(topicId) || activeTopicData : activeTopicData;
      const sessionWorkspaceBinding = isTopic
        ? getTopicWorkspaceBinding(currentTopicObj?.id)
        : getChannelWorkspaceBinding(activeChannel?.id);
      const topicAgents =
        isTopic && topicId
          ? (currentTopicObj?.participatingAgentIds || [])
              .map((id) => agentsRef.current.find((a) => a.id === id))
              .filter((a): a is Agent => Boolean(a))
              .filter((a) => channelAgents.some((ca) => ca.id === a.id))
          : [];

      const candidateAgents =
        topicAgents.length > 0
          ? topicAgents
          : activeThread?.type === 'dm'
          ? agentsRef.current.filter(
              (a) =>
                a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id)
            )
          : channelAgents;

      const topicTargetChannel = isTopic
        ? channels.find((c) => c.id === currentTopicObj?.channelId) || activeChannel
        : activeChannel;
      const targetChannelId = isTopic
        ? topicTargetChannel?.id || activeChannel?.id
        : activeThread?.type === 'dm'
        ? undefined
        : activeChannel?.id;

      // 1. 轮次同步屏障 (Turn Barrier) 汇总解析本轮所有并发发言中的 @mention 并去重合并
      const barrierResolution = aggregateTurnBarrierMentions({
        turnOutputs: effectiveTurnOutputs,
        candidateAgents,
        allWorkspaceAgents: agentsRef.current,
        isDm: activeThread?.type === 'dm',
        queuedCollaborators,
      });

      // 渲染未受邀外部 Agent 的越界点名拦截提示
      if (barrierResolution.uninvitedMentions.length > 0) {
        const guardMessages: Message[] = barrierResolution.uninvitedMentions.map((u, idx) => ({
          id: `channel-guard-${Date.now()}-${idx}`,
          threadId: roomId,
          channelId: targetChannelId,
          authorId: 'system',
          authorName: 'Shadow Crew 频道隔离守护',
          authorHandle: '@channel-guard',
          authorAvatar: '🔒',
          isAgent: true,
          kind: 'guard',
          agentBadge: 'Channel Guard',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔒 **频道准入拦截**：${u.invokingAgent.name} 尝试点名了 ${u.uninvitedAgents.map((a) => `@${a.name} (${a.handle})`).join('、')}，但该 Agent **未加入当前频道**。\n\n根据受邀准入原则，未受邀成员无法跨频道接收协同调度。如需其参与推演，请点击右上角「成员管理」邀请入驻。`,
        }));
        setMessages((prev) => {
          const nextList = [...(prev[roomId] || []), ...guardMessages];
          const next = { ...prev, [roomId]: nextList };
          messagesRef.current = next;
          return next;
        });
      }

      const hadExplicitMentions = effectiveTurnOutputs.some(
        (o) => parseAgentMentions(o.replyContent, candidateAgents, o.agent.id).length > 0
      );
      const remainingQueued =
        !hadExplicitMentions && queuedCollaborators.length > 0
          ? queuedCollaborators.slice(1)
          : queuedCollaborators;

      if (barrierResolution.nextTargets.length === 0) {
        // 协同链自然收敛结束 (Silence as Success)
        setActiveCascades((prev) => {
          const next = { ...prev };
          delete next[cascadeId];
          return next;
        });
        return;
      }

      // 2. 筛选在线且通过 LoopGuard 检查的目标 Agent
      const allowedTargets: AggregatedMentionTarget[] = [];

      for (const item of barrierResolution.nextTargets) {
        const targetAgent = item.targetAgent;

        if (isAgentOffline(targetAgent)) {
          const offlineNotice: Message = {
            id: `msg-offline-collab-${Date.now()}-${targetAgent.id}`,
            threadId: roomId,
            channelId: targetChannelId,
            authorId: 'system',
            authorName: 'Shadow Crew 通信管控',
            authorHandle: '@connection-guard',
            authorAvatar: '🔌',
            isAgent: true,
            kind: 'system_control',
            agentBadge: 'Communication Required',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔌 **Agent 通信尚未开启**：协同目标 **${targetAgent.name}** 当前处于离线/未连接状态，无法接力推演。需先在左侧控制面板点击【Start】开启通信。`,
          };
          setMessages((prev) => {
            const next = { ...prev, [roomId]: [...(prev[roomId] || []), offlineNotice] };
            messagesRef.current = next;
            return next;
          });
          continue;
        }

        const loopCheck = checkLoopGuard(cascade, targetAgent.id);
        if (!loopCheck.allowed) {
          console.log(
            `[CollaborationCascade] Cascade ${cascadeId} target ${targetAgent.name} terminated:`,
            loopCheck.reason
          );
          if (!loopCheck.isSilentEnd) {
            const breakMsg: Message = {
              id: `circuit-break-${Date.now()}-${targetAgent.id}`,
              threadId: roomId,
              channelId: targetChannelId,
              authorId: 'system',
              authorName: 'Shadow Crew 协同管控',
              authorHandle: '@loop-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              kind: 'guard',
              agentBadge: 'Circuit Breaker',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: `⚡ **多智能体协同已停止**：${loopCheck.reason}`,
              collaborationInfo: {
                cascadeId,
                hop: cascade.depth,
                maxHops: cascade.maxDepth,
                rootMessageId: cascade.rootMessageId,
                sourceMessageId: item.sourceMessageIds[0] || cascade.rootMessageId,
                isCircuitBroken: true,
                circuitBreakReason: loopCheck.reason,
              },
            };
            setMessages((prev) => {
              const next = { ...prev, [roomId]: [...(prev[roomId] || []), breakMsg] };
              messagesRef.current = next;
              return next;
            });
          }
          continue;
        }

        allowedTargets.push(item);
      }

      if (allowedTargets.length === 0) {
        if (remainingQueued.length > 0 && remainingQueued.length < queuedCollaborators.length) {
          const fallbackOutput = effectiveTurnOutputs[effectiveTurnOutputs.length - 1];
          dispatchCascadingAgentResponse({
            cascadeId,
            turnOutputs: [fallbackOutput],
            roomId,
            isTopic,
            topicId,
            queuedCollaborators: remainingQueued,
          });
        } else {
          setActiveCascades((prev) => {
            const next = { ...prev };
            delete next[cascadeId];
            return next;
          });
        }
        return;
      }

      // 3. 更新 Cascade 状态 (推进 Hop 深度并记录本轮所有去重后的被唤醒 Agent)
      const nextDepth = cascade.depth + 1;
      const nextCallCounts = { ...cascade.agentCallCounts };
      for (const item of allowedTargets) {
        nextCallCounts[item.targetAgent.id] = (nextCallCounts[item.targetAgent.id] || 0) + 1;
      }

      const updatedCascade: CollaborationCascade = {
        ...cascade,
        depth: nextDepth,
        visitedAgentIds: [
          ...cascade.visitedAgentIds,
          ...allowedTargets.map((t) => t.targetAgent.id),
        ],
        agentCallCounts: nextCallCounts,
      };

      activeCascadesRef.current = {
        ...activeCascadesRef.current,
        [cascadeId]: updatedCascade,
      };
      setActiveCascades((prev) => ({
        ...prev,
        [cascadeId]: updatedCascade,
      }));

      const topicContext: TopicPromptContext | undefined =
        isTopic && currentTopicObj
          ? {
              topicId: currentTopicObj.id,
              title: currentTopicObj.title,
              description: currentTopicObj.description,
              channelName: topicTargetChannel?.name || 'chat',
              status: currentTopicObj.status,
              discussionMode: currentTopicObj.discussionMode,
              gameRoles: currentTopicObj.gameRoles,
              participatingAgents: candidateAgents,
            }
          : undefined;

      setIsGenerating(true);
      const newExecs: Record<string, ActiveAgentExecution> = {};
      allowedTargets.forEach((item, idx) => {
        const targetAgent = item.targetAgent;
        const execKey =
          isTopic && topicId ? `${topicId}:${targetAgent.id}` : `${roomId}:${targetAgent.id}`;
        const invokerNames = item.invokingAgents.map((a) => `@${a.name}`).join('、');
        newExecs[execKey] = {
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          agentAvatar: targetAgent.avatar,
          threadId: roomId,
          topicId: isTopic ? topicId : undefined,
          status: 'thinking',
          currentActionDetail: `正在响应 ${invokerNames} 的协同研讨 (Hop ${nextDepth}/${cascade.maxDepth})...`,
          startedAt: Date.now() + idx * 50,
          cascadeHop: nextDepth,
          invokingAgentName: item.invokingAgents.map((a) => a.name).join(' & '),
        };
      });

      setActiveExecutions((prev) => ({
        ...prev,
        ...newExecs,
      }));

      setAgents((prev) =>
        prev.map((a) =>
          allowedTargets.some((t) => t.targetAgent.id === a.id) && a.status !== 'running'
            ? { ...a, status: 'running' }
            : a
        )
      );

      // 4. 并行派发本跳所有去重后的目标 Agent，并在全部完成后进入下一道 Turn Barrier
      const hopOutputs: TurnAgentOutput[] = [];
      const cascadeTurnSnapshot = captureTurnEpoch(roomId, targetChannelId);

      await Promise.allSettled(
        allowedTargets.map(async (item) => {
          const { targetAgent, invokingAgents, sourceMessageIds, combinedReplies } = item;
          const agentSnapshot = captureTurnEpoch(roomId, targetChannelId, targetAgent.id);
          const primaryInvoker = invokingAgents[0] || effectiveTurnOutputs[0].agent;
          const execKey =
            isTopic && topicId ? `${topicId}:${targetAgent.id}` : `${roomId}:${targetAgent.id}`;
          const isDm = activeThread?.type === 'dm';
          const sessionKey = buildAgentSessionKey({
            agentId: targetAgent.id,
            roomId,
            channelId: targetChannelId,
            isDm,
            discussionMode: currentTopicObj?.discussionMode,
            workspaceBindingId: sessionWorkspaceBinding?.id,
            scopeType: activeThread?.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
          });

          const preflightSystemPrompt = buildCompositeSystemPrompt({
            agent: targetAgent,
            availableAgents: candidateAgents,
            includeRoster: !isDm,
          });

          const triggerMsgIds = new Set(sourceMessageIds || []);
          const priorRoomMessages = (messagesRef.current[roomId] || []).filter(
            (m) =>
              !m.isPending && (m.content?.trim() || m.thinkingProcess) && !triggerMsgIds.has(m.id)
          );
          const localHistoryIntact = priorRoomMessages.length > 0;

          let sessionPreflight: {
            isNew: boolean;
            recoveryMode?: 'resume' | 'load' | 'new';
          } | null = null;
          try {
            sessionPreflight = await ensureAcpAgentSession({
              agentId: targetAgent.id,
              roomId,
              channelId: targetChannelId,
              systemPrompt: preflightSystemPrompt,
              discussionMode: currentTopicObj?.discussionMode,
              workspaceBindingId: sessionWorkspaceBinding?.id,
              workspaceCwd: sessionWorkspaceBinding?.cwd,
              scopeType: activeThread?.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
              localHistoryIntact,
            });
          } catch (err) {
            console.error(
              `[NormalTurn] Preflight ensureAcpAgentSession failed for ${targetAgent.name}:`,
              err
            );
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });
            setAgents((prev) =>
              prev.map((a) =>
                a.id === targetAgent.id
                  ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
                  : a
              )
            );
            syncRunningAgentsWithBackend();
            const errorReply: Message = {
              id: `msg-collab-err-${Date.now()}-${targetAgent.id}`,
              threadId: roomId,
              channelId: targetChannelId,
              authorId: targetAgent.id,
              authorName: targetAgent.name,
              authorHandle: targetAgent.handle,
              authorAvatar: targetAgent.avatar,
              isAgent: true,
              agentBadge: 'ACP Error',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}`,
            };
            commitMessages((prev) => {
              const existing = prev[roomId] || [];
              const nextRoomMsgs = existing.some((m) => m.id === errorReply.id)
                ? existing
                : [...existing, errorReply];
              return {
                ...prev,
                [roomId]: nextRoomMsgs,
              };
            });
            return;
          }

          if (sessionPreflight?.isNew || sessionPreflight?.recoveryMode === 'new') {
            deliveredStandingContextRef.current.delete(sessionKey);
            sessionWatermarksRef.current.delete(sessionKey);
            persistSessionWarmState();
          } else if (
            sessionPreflight?.recoveryMode === 'resume' ||
            sessionPreflight?.recoveryMode === 'load'
          ) {
            deliveredStandingContextRef.current.add(sessionKey);
            if (!sessionWatermarksRef.current.has(sessionKey)) {
              const transcript = messagesRef.current[roomId] || [];
              const lastPriorMsg = transcript
                .slice()
                .reverse()
                .find((m) => !m.isPending && !triggerMsgIds.has(m.id));
              if (lastPriorMsg) {
                sessionWatermarksRef.current.set(sessionKey, lastPriorMsg.id);
              }
            }
            persistSessionWarmState();
          }

          const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);
          const systemPrompt = buildCompositeSystemPrompt({
            agent: targetAgent,
            availableAgents: candidateAgents,
            includeRoster: !isStandingContextDelivered,
          });
          deliveredStandingContextRef.current.add(sessionKey);
          persistSessionWarmState();

          // 对标 Buzz queue.rs: 基于该 Agent 在当前会话的水位线提取未读增量事件批次 (<delta-events>)
          // 同时将本轮触发输出 effectiveTurnOutputs 显式合并入快照（按消息 ID 幂等去重），彻底消除异步批处理导致的漏读竞态
          const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
          const roomTranscript = messagesRef.current[roomId] || [];
          const deltaBatch = extractUnreadDeltaMessages({
            messages: roomTranscript,
            turnOutputs: effectiveTurnOutputs,
            lastWatermarkMessageId: lastWatermark,
            coldStartSinceMessageId: !isTopic ? cascade.rootMessageId : undefined,
            excludeAuthorId: targetAgent.id,
          });
          if (deltaBatch.latestWatermarkMessageId) {
            sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
            persistSessionWarmState();
          }

          const latestTriggerReplyContent =
            combinedReplies.length > 0
              ? combinedReplies[combinedReplies.length - 1].content
              : effectiveTurnOutputs[effectiveTurnOutputs.length - 1]?.replyContent || '';

          const cascadePrompt = buildNormalModeTurnPrompt({
            targetAgent,
            availableAgents: candidateAgents,
            roomId,
            isWarmSession: deltaBatch.isWarmSession,
            deltaMessages: deltaBatch.deltaMessages,
            triggerContent: latestTriggerReplyContent,
            hop: nextDepth,
            maxHops: cascade.maxDepth,
            invokingAgents,
            topic: topicContext,
            isDm: false,
          });

          try {
            const acpResp = await sendPromptToAcpAgent({
              agent: targetAgent,
              roomId,
              prompt: cascadePrompt,
              channelId: targetChannelId,
              workspaceBindingId: sessionWorkspaceBinding?.id,
              workspaceCwd: sessionWorkspaceBinding?.cwd,
              scopeType: activeThread?.type === 'dm' ? 'dm' : isTopic ? 'topic' : 'channel',
              systemPrompt,
              discussionMode: currentTopicObj?.discussionMode,
            });

            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });

            if (isTurnStale(agentSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
              console.log(
                '[App] Dropping cascading agent reply because history was cleared or cascade aborted'
              );
              return;
            }

            const nextReply: Message = {
              id: `msg-collab-${Date.now()}-${targetAgent.id}`,
              threadId: roomId,
              channelId: targetChannelId,
              authorId: targetAgent.id,
              authorName: targetAgent.name,
              authorHandle: targetAgent.handle,
              authorAvatar: targetAgent.avatar,
              isAgent: true,
              agentBadge: `${targetAgent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : targetAgent.isRemote ? 'ACP Remote' : 'ACP'}`,
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: acpResp.textResponse,
              thinkingProcess: buildThinkingProcessFromAcp(
                acpResp,
                '已基于增量上下文批次完成审查与规约对齐'
              ),
              diffView:
                acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
                  ? acpResp.workspaceDiffs[0]
                  : undefined,
              cartridgeCitation: acpResp.cartridgeCitation,
              collaborationInfo: {
                cascadeId,
                hop: nextDepth,
                maxHops: cascade.maxDepth,
                rootMessageId: cascade.rootMessageId,
                sourceMessageId: sourceMessageIds[0] || cascade.rootMessageId,
                invokedByAgentId: primaryInvoker.id,
                invokedByAgentName: invokingAgents.map((a) => a.name).join(' & '),
                invokedByAgentHandle: primaryInvoker.handle,
              },
            };

            if (isTopic && topicId) {
              commitMessages((prev) => {
                const existing = prev[topicId] || [];
                const nextTopicMsgs = existing.some((m) => m.id === nextReply.id)
                  ? existing
                  : [...existing, nextReply];

                let parentThreadId: string | null = null;
                for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
                  if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                    parentThreadId = tId;
                    break;
                  }
                }

                const updatedParentMsgs = parentThreadId
                  ? (prev[parentThreadId] || []).map((m) => {
                      if (m.type === 'topic' && m.topicData?.id === topicId) {
                        return {
                          ...m,
                          topicData: {
                            ...m.topicData,
                            repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                            latestReplyPreview: nextReply.content.slice(0, 60),
                          },
                        };
                      }
                      return m;
                    })
                  : [];

                return {
                  ...prev,
                  [topicId]: nextTopicMsgs,
                  ...(parentThreadId ? { [parentThreadId]: updatedParentMsgs } : {}),
                };
              });
            } else {
              commitMessages((prev) => {
                const existing = prev[roomId] || [];
                const nextRoomMsgs = existing.some((m) => m.id === nextReply.id)
                  ? existing
                  : [...existing, nextReply];
                return {
                  ...prev,
                  [roomId]: nextRoomMsgs,
                };
              });
            }

            setAgents((prev) =>
              applyPromptNativeMemoryCapability(
                prev.map((a) =>
                  a.id === targetAgent.id &&
                  a.status !== 'starting' &&
                  isAgentActivelyRunning(a)
                    ? { ...a, status: 'running' }
                    : a
                ),
                targetAgent.id,
                acpResp.nativeMemoryCapability,
                targetAgent
              )
            );
            syncRunningAgentsWithBackend();

            hopOutputs.push({
              agent: targetAgent,
              messageId: nextReply.id,
              replyContent: acpResp.textResponse,
            });
          } catch (err) {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });

            if (isTurnStale(agentSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
              console.log(
                '[App] Dropping cascading agent error because history was cleared or cascade aborted'
              );
              return;
            }

            console.error('Cascading agent dispatch failed:', err);
            const errorReply: Message = {
              id: `msg-collab-err-${Date.now()}-${targetAgent.id}`,
              threadId: roomId,
              channelId: targetChannelId,
              authorId: targetAgent.id,
              authorName: targetAgent.name,
              authorHandle: targetAgent.handle,
              authorAvatar: targetAgent.avatar,
              isAgent: true,
              agentBadge: 'ACP Error',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: `⚠️ **协同接力异常**：${err instanceof Error ? err.message : String(err)}`,
            };
            commitMessages((prev) => {
              const existing = prev[roomId] || [];
              const nextRoomMsgs = existing.some((m) => m.id === errorReply.id)
                ? existing
                : [...existing, errorReply];
              return {
                ...prev,
                [roomId]: nextRoomMsgs,
              };
            });
          }
        })
      );

      // 5. 本跳同步屏障 (Turn Barrier) 汇合完成后，进入下一跳评估
      if (isTurnStale(cascadeTurnSnapshot) || activeCascadesRef.current[cascadeId]?.isAborted) {
        setActiveCascades((prev) => {
          const next = { ...prev };
          delete next[cascadeId];
          return next;
        });
        return;
      }

      if (hopOutputs.length > 0) {
        await dispatchCascadingAgentResponse({
          cascadeId,
          turnOutputs: hopOutputs,
          roomId,
          isTopic,
          topicId,
          queuedCollaborators: remainingQueued,
        });
      } else {
        setActiveCascades((prev) => {
          const next = { ...prev };
          delete next[cascadeId];
          return next;
        });
      }
    },
    [
      activeCascadesRef,
      activeChannel,
      activeThread,
      agentsRef,
      getTopicData,
      activeTopicData,
      getTopicWorkspaceBinding,
      getChannelWorkspaceBinding,
      channels,
      setMessages,
      messagesRef,
      setActiveCascades,
      setIsGenerating,
      setActiveExecutions,
      setAgents,
      captureTurnEpoch,
      deliveredStandingContextRef,
      sessionWatermarksRef,
      persistSessionWarmState,
      syncRunningAgentsWithBackend,
      isTurnStale,
      commitMessages,
    ]
  );

  // Send Message in active thread
  const handleSendMessage = useCallback(
    async (content: string, pendingAttachments: MessageAttachmentInput[] = []): Promise<void> => {
      if ((!content.trim() && pendingAttachments.length === 0) || !activeThread) return;

      const currentThreadId = activeThread.id;
      const isDmThread = activeThread.type === 'dm';

      const targetChannelId = isDmThread ? undefined : activeChannel?.id;
      const userMessageId = `msg-${Date.now()}`;
      const scopeType = isDmThread ? 'dm' : 'channel';
      const scopeId = isDmThread ? currentThreadId : targetChannelId || currentThreadId;
      const savedAttachments: MessageAttachment[] = await persistMessageAttachments({
        scopeType,
        scopeId,
        messageId: userMessageId,
        attachments: pendingAttachments,
      });
      const attachmentManifest = buildAttachmentManifest(savedAttachments);
      const agentTurnContent = `${content}${attachmentManifest}`.trim();

      const userMsg: Message = {
        id: userMessageId,
        threadId: currentThreadId,
        channelId: targetChannelId,
        authorId: 'user-norris',
        authorName: 'Norris_M5Pro',
        authorHandle: '@Norris_M5Pro',
        authorAvatar: '👨‍💻',
        isAgent: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content,
        attachments: savedAttachments,
        reactions: [],
      };

      commitMessages((prev) => {
        const existing = prev[currentThreadId] || [];
        const nextThreadMsgs = existing.some((m) => m.id === userMsg.id)
          ? existing
          : [...existing, userMsg];
        return {
          ...prev,
          [currentThreadId]: nextThreadMsgs,
        };
      });

      // Detect responding agents:
      // 1. Resolve channel assigned agents (merge assignedAgentIds, memberIds, activeAgentIds)
      const currentChannelAgentIds = Array.from(
        new Set([
          ...(activeChannel?.assignedAgentIds || []),
          ...(activeChannel?.memberIds || []),
          ...(activeThread.activeAgentIds || []),
        ])
      );
      const channelAssigned = currentChannelAgentIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a));

      // 2. Parse mentioned agents
      const isChannelAll = isAllMention(content);

      let userMentionedAgents: Agent[] = [];

      if (isChannelAll) {
        // 频道内 @all 严格限定在当前频道已准入的成员范围，绝不能越界拉取全工作区外部成员进频道
        userMentionedAgents = channelAssigned;
      } else {
        // 显式点名时，从工作区已登记 Agent 中解析，并允许自动邀请入驻当前频道
        userMentionedAgents = parseAgentMentions(content, agents);

        // 3. If human user mentions an agent not yet in the channel, automatically invite & add them!
        if (activeThread.type !== 'dm' && activeChannel && userMentionedAgents.length > 0) {
          const newlyInvited = userMentionedAgents.filter(
            (a) => !channelAssigned.some((ca) => ca.id === a.id)
          );

          if (newlyInvited.length > 0) {
            const newlyInvitedIds = newlyInvited.map((a) => a.id);
            const updatedAssignedIds = Array.from(
              new Set([...(activeChannel.assignedAgentIds || []), ...newlyInvitedIds])
            );
            const updatedMemberIds = Array.from(
              new Set([...(activeChannel.memberIds || []), ...newlyInvitedIds])
            );

            setChannels((prev) =>
              prev.map((c) =>
                c.id === activeChannel.id
                  ? { ...c, assignedAgentIds: updatedAssignedIds, memberIds: updatedMemberIds }
                  : c
              )
            );
            setThreads((prev) =>
              prev.map((t) =>
                t.channelId === activeChannel.id
                  ? { ...t, activeAgentIds: updatedAssignedIds }
                  : t
              )
            );

            // 频道自动邀请新成员入驻时，同步失效已有会话花名册缓存与底层 Session，使已有成员立即获知新成员
            bumpChannelEpoch(turnEpochTrackerRef.current, activeChannel.id, [currentThreadId]);
            clearSessionWarmScope({
              channelId: activeChannel.id,
              deletedThreadIds: [currentThreadId],
            });
            void Promise.all([
              safelyClearAcpSessions(
                undefined,
                `channel:${activeChannel.id}`,
                '频道自动邀请新成员'
              ),
              safelyClearAcpSessions(
                undefined,
                `topic:${activeChannel.id}`,
                '频道自动邀请新成员'
              ),
            ]);

            channelAssigned.push(...newlyInvited);
          }
        }
      }

      const candidateAgents =
        activeThread.type === 'dm'
          ? agents.filter(
              (a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id)
            )
          : channelAssigned;

      let respondingAgents: Agent[] = [];

      if (activeThread.type === 'dm') {
        const dmTarget = candidateAgents[0];
        if (dmTarget) {
          respondingAgents = [dmTarget];
        }
      } else if (userMentionedAgents.length > 0) {
        respondingAgents = userMentionedAgents;
      } else if (candidateAgents.length > 0) {
        // 普通频道模式（对标 Buzz）：当用户首次发言未显式点名特定单人时，唤醒当前频道内所有已准入的在线 Agent 在 Hop 1 并发发言
        respondingAgents = candidateAgents;
      }

      if (respondingAgents.length === 0) {
        setTimeout(() => {
          const hintMsg: Message = {
            id: `msg-hint-${Date.now()}`,
            threadId: currentThreadId,
            channelId: targetChannelId,
            authorId: 'system',
            authorName: 'Shinobi 系统提示',
            authorHandle: '@shinobi',
            authorAvatar: '🥷',
            isAgent: true,
            agentBadge: 'System',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: isDmThread
              ? '当前工作台尚未连接该 Agent。'
              : '当前频道尚未指派任何 Agent。\n\n请在下方输入框中输入 `@` 选择并点名 Agent（如 Claude Code、OpenClaw 等）加入此频道，或点击右上角「成员管理」进行邀请！',
          };
          setMessages((prev) => ({
            ...prev,
            [currentThreadId]: [...(prev[currentThreadId] || []), hintMsg],
          }));
        }, 500);
        return;
      }

      // 严格检查通信状态：分离离线与在线 Agent
      const offlineAgents = respondingAgents.filter((a) => isAgentOffline(a));
      const onlineAgents = respondingAgents.filter((a) => !isAgentOffline(a));

      // 仅当用户显式 @ 了离线 Agent（或 @all），或者频道内没有任何在线 Agent 时，才弹出离线提示
      const shouldWarnOffline =
        isDmThread || isChannelAll || userMentionedAgents.length > 0 || onlineAgents.length === 0;

      if (offlineAgents.length > 0 && shouldWarnOffline) {
        const offlineNames = offlineAgents.map((a) => `**${a.name}**`).join('、');
        setTimeout(() => {
          const offlineNotice: Message = {
            id: `msg-offline-${Date.now()}`,
            threadId: currentThreadId,
            channelId: targetChannelId,
            authorId: 'system',
            authorName: 'Shadow Crew 通信管控',
            authorHandle: '@connection-guard',
            authorAvatar: '🔌',
            isAgent: true,
            agentBadge: 'Communication Required',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔌 **Agent 通信尚未开启**：${offlineNames} 当前处于离线/未连接状态。\n\n根据产品规范，需先在左侧「Agents & 编队」面板点击该 Agent 头像下方的【Start】按钮开启通信连接后方可协作推演。\n\n*(开启通信后，重新发送消息或在此 @ 召唤即可正常推演)*`,
          };
          setMessages((prev) => ({
            ...prev,
            [currentThreadId]: [...(prev[currentThreadId] || []), offlineNotice],
          }));
        }, 300);
      }

      if (onlineAgents.length === 0) return;

      setIsGenerating(true);
      const now = Date.now();

      // 初始化协同链状态（首轮所有并发在线 Agent 共享同一协同链实例）
      const cascadeId = `cascade-thread-${Date.now()}`;
      const initialCallCounts: Record<string, number> = {};
      onlineAgents.forEach((ag) => {
        initialCallCounts[ag.id] = 1;
      });
      const newCascade: CollaborationCascade = {
        cascadeId,
        rootMessageId: userMsg.id,
        roomId: currentThreadId,
        originalPrompt: agentTurnContent,
        depth: 1,
        maxDepth: 12, // 对标 Buzz: 提升至 12 轮作为不可见安全兜底
        visitedAgentIds: onlineAgents.map((ag) => ag.id),
        agentCallCounts: initialCallCounts,
        isAborted: false,
      };
      activeCascadesRef.current = {
        ...activeCascadesRef.current,
        [cascadeId]: newCascade,
      };
      setActiveCascades((prev) => ({ ...prev, [cascadeId]: newCascade }));

      const newExecs: Record<string, ActiveAgentExecution> = {};
      onlineAgents.forEach((ag, idx) => {
        // 维持 Agent 在线基线状态 ('running')，具体推演任务由 activeExecutions 独立追踪
        setAgents((prev) =>
          prev.map((a) => (a.id === ag.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
        );
        newExecs[`${currentThreadId}:${ag.id}`] = {
          agentId: ag.id,
          agentName: ag.name,
          agentAvatar: ag.avatar,
          threadId: currentThreadId,
          status: 'thinking',
          currentActionDetail:
            onlineAgents.length > 1
              ? '正在并发独立推演方案并对齐增量上下文 (并行 Hop 1)...'
              : '正在深度推演方案并对齐增量上下文 (Hop 1)...',
          startedAt: now + idx * 50,
          cascadeHop: 1,
        };
      });

      setActiveExecutions((prev) => ({
        ...prev,
        ...newExecs,
      }));

      const turnOutputs: TurnAgentOutput[] = [];
      const threadTurnSnapshot = captureTurnEpoch(currentThreadId, targetChannelId);

      // Hop 1 并发 Fan-out：所有在线 Agent 同时推演，并在 Turn Barrier 汇合
      const hop1Promises = onlineAgents.map(async (targetAgent, idx) => {
        const sessionKey = buildAgentSessionKey({
          agentId: targetAgent.id,
          roomId: currentThreadId,
          channelId: isDmThread ? undefined : activeChannel?.id,
          isDm: isDmThread,
          workspaceBindingId: isDmThread
            ? undefined
            : getChannelWorkspaceBinding(activeChannel?.id)?.id,
          scopeType: isDmThread ? 'dm' : 'channel',
        });

        const preflightSystemPrompt = buildCompositeSystemPrompt({
          agent: targetAgent,
          availableAgents: candidateAgents,
          includeRoster: !isDmThread,
        });

        const priorThreadMessages = (messagesRef.current[currentThreadId] || []).filter(
          (m) =>
            !m.isPending && (m.content?.trim() || m.thinkingProcess) && m.id !== userMsg.id
        );
        const localHistoryIntact = priorThreadMessages.length > 0;

        let sessionPreflight: {
          isNew: boolean;
          recoveryMode?: 'resume' | 'load' | 'new';
        } | null = null;
        try {
          sessionPreflight = await ensureAcpAgentSession({
            agentId: targetAgent.id,
            roomId: currentThreadId,
            channelId: isDmThread ? undefined : activeChannel?.id,
            workspaceBindingId: isDmThread
              ? undefined
              : getChannelWorkspaceBinding(activeChannel?.id)?.id,
            workspaceCwd: isDmThread
              ? undefined
              : getChannelWorkspaceBinding(activeChannel?.id)?.cwd,
            scopeType: isDmThread ? 'dm' : 'channel',
            systemPrompt: preflightSystemPrompt,
            localHistoryIntact,
          });
        } catch (err) {
          console.error(
            `[ThreadTurn] Preflight ensureAcpAgentSession failed for ${targetAgent.name}:`,
            err
          );
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[`${currentThreadId}:${targetAgent.id}`];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          setAgents((prev) =>
            prev.map((a) =>
              a.id === targetAgent.id
                ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
                : a
            )
          );
          syncRunningAgentsWithBackend();

          const errorReply: Message = {
            id: `msg-err-${Date.now()}-${targetAgent.id}`,
            threadId: currentThreadId,
            channelId: targetChannelId,
            authorId: targetAgent.id,
            authorName: targetAgent.name,
            authorHandle: targetAgent.handle,
            authorAvatar: targetAgent.avatar,
            isAgent: true,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
          };
          commitMessages((prev) => {
            const existing = prev[currentThreadId] || [];
            return {
              ...prev,
              [currentThreadId]: [...existing, errorReply],
            };
          });
          return null;
        }

        if (sessionPreflight?.isNew || sessionPreflight?.recoveryMode === 'new') {
          deliveredStandingContextRef.current.delete(sessionKey);
          sessionWatermarksRef.current.delete(sessionKey);
          persistSessionWarmState();
        } else if (
          sessionPreflight?.recoveryMode === 'resume' ||
          sessionPreflight?.recoveryMode === 'load'
        ) {
          deliveredStandingContextRef.current.add(sessionKey);
          if (!sessionWatermarksRef.current.has(sessionKey)) {
            const roomTranscript = messagesRef.current[currentThreadId] || [];
            const lastPriorMsg = roomTranscript
              .slice()
              .reverse()
              .find((m) => !m.isPending && m.id !== userMsg.id);
            if (lastPriorMsg) {
              sessionWatermarksRef.current.set(sessionKey, lastPriorMsg.id);
            }
          }
          persistSessionWarmState();
        }

        const isStandingContextDelivered = deliveredStandingContextRef.current.has(sessionKey);

        // 对标 Buzz: 组合 Agent 自身专精人设与频道级花名册公约
        const compositeSystemPrompt = buildCompositeSystemPrompt({
          agent: targetAgent,
          availableAgents: candidateAgents,
          includeRoster: !isDmThread && !isStandingContextDelivered,
        });

        const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
        const roomTranscript = messagesRef.current[currentThreadId] || [];

        const deltaBatch = extractUnreadDeltaMessages({
          messages: roomTranscript,
          triggerMessages: [userMsg],
          lastWatermarkMessageId: lastWatermark,
          coldStartSinceMessageId: userMsg.id,
          excludeAuthorId: targetAgent.id,
        });

        const finalPrompt = buildNormalModeTurnPrompt({
          targetAgent,
          availableAgents: candidateAgents,
          roomId: currentThreadId,
          isWarmSession: deltaBatch.isWarmSession,
          deltaMessages: deltaBatch.deltaMessages,
          triggerContent: agentTurnContent,
          hop: 1,
          maxHops: 12,
          isDm: isDmThread,
          isParallelFirstTurn: onlineAgents.length > 1,
        });

        deliveredStandingContextRef.current.add(sessionKey);
        if (deltaBatch.latestWatermarkMessageId) {
          sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
        }
        persistSessionWarmState();

        logRpc(targetAgent.name, 'client_to_agent', 'session/prompt', {
          jsonrpc: '2.0',
          id: Date.now() + idx,
          method: 'session/prompt',
          params: {
            threadId: currentThreadId,
            prompt: finalPrompt,
            channelId: targetChannelId,
            concurrentFanOut: onlineAgents.length > 1,
            deltaCount: deltaBatch.deltaMessages.length,
          },
        });

        const turnSnapshot = captureTurnEpoch(currentThreadId, targetChannelId, targetAgent.id);
        return sendPromptToAcpAgent({
          agent: targetAgent,
          roomId: currentThreadId,
          prompt: finalPrompt,
          channelId: targetChannelId,
          workspaceBindingId: isDmThread
            ? undefined
            : getChannelWorkspaceBinding(activeChannel?.id)?.id,
          workspaceCwd: isDmThread
            ? undefined
            : getChannelWorkspaceBinding(activeChannel?.id)?.cwd,
          scopeType: isDmThread ? 'dm' : 'channel',
          systemPrompt: compositeSystemPrompt,
          isDm: isDmThread,
          attachments: savedAttachments,
        })
          .then((acpResp) => {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[`${currentThreadId}:${targetAgent.id}`];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });
            if (isTurnStale(turnSnapshot)) {
              console.log(
                '[App] Dropping thread prompt reply because turn was aborted or invalidated'
              );
              return null;
            }

            const agentReply: Message = {
              id: `msg-reply-${Date.now()}-${targetAgent.id}`,
              threadId: currentThreadId,
              channelId: targetChannelId,
              authorId: targetAgent.id,
              authorName: targetAgent.name,
              authorHandle: targetAgent.handle,
              authorAvatar: targetAgent.avatar,
              isAgent: true,
              managedBy: targetAgent.isManagedByYou ? 'you' : undefined,
              agentBadge: `${targetAgent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : targetAgent.isRemote ? 'ACP Remote' : 'ACP'}`,
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: acpResp.textResponse,
              thinkingProcess: buildThinkingProcessFromAcp(
                acpResp,
                '已消化增量事件流并完成技术边界考量'
              ),
              diffView:
                acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
                  ? acpResp.workspaceDiffs[0]
                  : undefined,
              cartridgeCitation: acpResp.cartridgeCitation,
              collaborationInfo: isDmThread
                ? undefined
                : {
                    cascadeId,
                    hop: 1,
                    maxHops: 12,
                    rootMessageId: userMsg.id,
                    sourceMessageId: userMsg.id,
                    invokedByAgentId: userMsg.authorId,
                    invokedByAgentName: userMsg.authorName,
                    invokedByAgentHandle: userMsg.authorHandle,
                  },
              acpTrace: {
                requestId: `acp-${Date.now()}-${targetAgent.id}`,
                method: 'session/prompt',
                durationMs: acpResp.durationMs,
                workspaceAction: {
                  action: 'read',
                  path: targetAgent.workspace?.activeFiles?.[0] || 'src/App.tsx',
                  summary: `Target workspace: ${targetAgent.workspace?.rootPath || '.'}${acpResp.isRealProcess ? ' (Real stdio process)' : targetAgent.isRemote ? ' (Remote WebSocket)' : ''}`,
                },
              },
            };

            commitMessages((prev) => {
              const existing = prev[currentThreadId] || [];
              const nextThreadMsgs = existing.some((m) => m.id === agentReply.id)
                ? existing
                : [...existing, agentReply];
              return {
                ...prev,
                [currentThreadId]: nextThreadMsgs,
              };
            });

            setAgents((prev) =>
              applyPromptNativeMemoryCapability(
                prev.map((a) =>
                  a.id === targetAgent.id &&
                  a.status !== 'starting' &&
                  isAgentActivelyRunning(a)
                    ? { ...a, status: 'running' }
                    : a
                ),
                targetAgent.id,
                acpResp.nativeMemoryCapability,
                targetAgent
              )
            );
            syncRunningAgentsWithBackend();

            logRpc(targetAgent.name, 'agent_to_client', 'session/prompt:result', {
              jsonrpc: '2.0',
              method: 'session/prompt:result',
              result: { status: 'completed', isRealProcess: acpResp.isRealProcess },
            });

            turnOutputs.push({
              agent: targetAgent,
              messageId: agentReply.id,
              replyContent: acpResp.textResponse,
            });
          })
          .catch((err) => {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[`${currentThreadId}:${targetAgent.id}`];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });

            if (isTurnStale(turnSnapshot)) {
              console.log(
                '[App] Dropping thread prompt error because turn was aborted or invalidated'
              );
              return null;
            }

            console.error('Failed to send prompt to agent:', err);
            const errorReply: Message = {
              id: `msg-err-${Date.now()}-${targetAgent.id}`,
              threadId: currentThreadId,
              channelId: targetChannelId,
              authorId: targetAgent.id,
              authorName: targetAgent.name,
              authorHandle: targetAgent.handle,
              authorAvatar: targetAgent.avatar,
              isAgent: true,
              agentBadge: 'ACP Error',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
            };
            commitMessages((prev) => {
              const existing = prev[currentThreadId] || [];
              const nextThreadMsgs = existing.some((m) => m.id === errorReply.id)
                ? existing
                : [...existing, errorReply];
              return {
                ...prev,
                [currentThreadId]: nextThreadMsgs,
              };
            });
            setAgents((prev) =>
              prev.map((a) =>
                a.id === targetAgent.id
                  ? resetAgentHandshakeCapabilities(a, 'idle', undefined)
                  : a
              )
            );
            syncRunningAgentsWithBackend();
          });
      });

      // Turn Barrier 同步屏障：仅在非 DM (即频道多 Agent 协同) 场景下，等待首轮所有并发 Agent 全部执行完毕后统一去重触发下一跳
      if (!isDmThread && hop1Promises.length > 0) {
        Promise.allSettled(hop1Promises).then(() => {
          if (isTurnStale(threadTurnSnapshot)) return;
          if (turnOutputs.length > 0) {
            dispatchCascadingAgentResponse({
              cascadeId,
              turnOutputs,
              roomId: currentThreadId,
              isTopic: false,
            });
          }
        });
      }
    },
    [
      activeThread,
      activeChannel,
      commitMessages,
      agents,
      setChannels,
      setThreads,
      turnEpochTrackerRef,
      clearSessionWarmScope,
      safelyClearAcpSessions,
      setMessages,
      setIsGenerating,
      activeCascadesRef,
      setActiveCascades,
      setAgents,
      setActiveExecutions,
      captureTurnEpoch,
      getChannelWorkspaceBinding,
      messagesRef,
      syncRunningAgentsWithBackend,
      deliveredStandingContextRef,
      sessionWatermarksRef,
      persistSessionWarmState,
      logRpc,
      isTurnStale,
      dispatchCascadingAgentResponse,
    ]
  );

  return {
    dispatchCascadingAgentResponse,
    handleSendMessage,
  };
}
