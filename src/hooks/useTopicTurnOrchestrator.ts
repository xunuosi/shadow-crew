import { useCallback } from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  Channel,
  GameRoleType,
  GameTheoreticStage,
  Message,
  MessageAttachment,
  MessageAttachmentInput,
  ModularOrchestrationState,
  TopicMessageData,
  WorkspaceBinding,
} from '../types';
import {
  buildAgentSessionKey,
  buildThinkingProcessFromAcp,
  ensureAcpAgentSession,
  extractModuleDecompositionFromAcpResponse,
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
  type CollaborationCascade,
  type TopicPromptContext,
  type TurnAgentOutput,
  type TurnEpochSnapshot,
  buildCompositeSystemPrompt,
  buildDefaultDecompositionFromTopic,
  buildNormalModeTurnPrompt,
  buildTopicPrompt,
  extractUnreadDeltaMessages,
  initializeModularOrchestrationState,
  isAllMention,
  parseAgentMentions,
  stepModularStageTransition,
} from '../services/agentCollaboration';
import { isAgentOffline, isAgentOnline } from '../utils/agentRuntime';
import type { ProcessArbitrationConcurrenceOptions } from './useArbitrationConcurrence';
import type { GameTheoreticStageHandoverOptions } from './useGameTheoreticFsm';
import type { DispatchCascadingAgentResponseOptions } from './useNormalModeTurnOrchestrator';

/**
 * Dependencies required by {@link useTopicTurnOrchestrator}.
 */
export interface UseTopicTurnOrchestratorParams {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  channels: Channel[];
  activeChannel: Channel | null | undefined;
  activeTopicData: TopicMessageData | null;
  getTopicData: (topicId: string) => TopicMessageData | null;
  updateTopicDataInState: (
    topicId: string,
    updater: (oldTopic: TopicMessageData) => TopicMessageData
  ) => void;
  getTopicWorkspaceBinding: (topicId?: string) => WorkspaceBinding | undefined;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  messagesRef: React.MutableRefObject<Record<string, Message[]>>;
  commitMessages: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  setActiveCascades: (
    updater:
      | Record<string, CollaborationCascade>
      | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
  ) => void;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  captureTurnEpoch: (roomId: string, channelId?: string, agentId?: string) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  deliveredStandingContextRef: React.MutableRefObject<Set<string>>;
  sessionWatermarksRef: React.MutableRefObject<Map<string, string>>;
  persistSessionWarmState: () => void;
  syncRunningAgentsWithBackend: (settleUnmatchedStarting?: boolean) => Promise<void>;
  logRpc: (
    agentName: string,
    direction: 'client_to_agent' | 'agent_to_client',
    method: string,
    payload: Record<string, any>
  ) => void;
  dispatchCascadingAgentResponse: (
    options: DispatchCascadingAgentResponseOptions
  ) => Promise<void>;
  triggerGameTheoreticStageHandover: (options: GameTheoreticStageHandoverOptions) => Promise<void>;
  processArbitrationConcurrence: (options: ProcessArbitrationConcurrenceOptions) => Promise<void>;
}

/**
 * Handlers returned by {@link useTopicTurnOrchestrator}.
 */
export interface UseTopicTurnOrchestratorReturn {
  handleSendTopicMessage: (
    topicId: string,
    content: string,
    pendingAttachments?: MessageAttachmentInput[]
  ) => Promise<void>;
}

/**
 * Orchestrates user turns inside Topic threads, covering DM topics/duels,
 * channel admission guard, 4+1 game-theoretic dispatch/resume with G-Frame
 * fast-track routing, and standard topic Turn Barrier cascades.
 */
export function useTopicTurnOrchestrator({
  agents,
  setAgents,
  channels,
  activeChannel,
  activeTopicData,
  getTopicData,
  updateTopicDataInState,
  getTopicWorkspaceBinding,
  setMessages,
  messagesRef,
  commitMessages,
  setActiveExecutions,
  setActiveCascades,
  setIsGenerating,
  captureTurnEpoch,
  isTurnStale,
  deliveredStandingContextRef,
  sessionWatermarksRef,
  persistSessionWarmState,
  syncRunningAgentsWithBackend,
  logRpc,
  dispatchCascadingAgentResponse,
  triggerGameTheoreticStageHandover,
  processArbitrationConcurrence,
}: UseTopicTurnOrchestratorParams): UseTopicTurnOrchestratorReturn {
  const handleSendTopicMessage = useCallback(
    async (
      topicId: string,
      content: string,
      pendingAttachments: MessageAttachmentInput[] = []
    ): Promise<void> => {
      const userMessageId = `topic-msg-${Date.now()}`;
      const topicScopeType = activeTopicData?.scopeType === 'dm' ? 'dm_topic' : 'topic';
      const savedAttachments: MessageAttachment[] = await persistMessageAttachments({
        scopeType: topicScopeType,
        scopeId: topicId,
        messageId: userMessageId,
        attachments: pendingAttachments,
      });
      const attachmentManifest = buildAttachmentManifest(savedAttachments);
      const agentTurnContent = `${content}${attachmentManifest}`.trim();
      const userMsg: Message = {
        id: userMessageId,
        threadId: topicId,
        authorId: 'user-norris',
        authorName: 'Norris_M5Pro',
        authorHandle: '@Norris_M5Pro',
        authorAvatar: '👨‍💻',
        isAgent: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content,
        attachments: savedAttachments,
      };

      commitMessages((prev) => {
        const topicMsgs = prev[topicId] || [];
        const nextTopicMsgs = topicMsgs.some((m) => m.id === userMsg.id)
          ? topicMsgs
          : [...topicMsgs, userMsg];

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
                    status: m.topicData.status === 'open' ? 'investigating' : m.topicData.status,
                    repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                    latestReplyPreview: content.slice(0, 60),
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

      const dmTopicAgentId =
        activeTopicData?.scopeType === 'dm' ? activeTopicData.dmAgentId : undefined;
      if (dmTopicAgentId) {
        const dmAgent = agents.find((agent) => agent.id === dmTopicAgentId);
        const topicBinding = getTopicWorkspaceBinding(topicId);
        if (!dmAgent || !topicBinding) {
          setMessages((prev) => ({
            ...prev,
            [topicId]: [
              ...(prev[topicId] || []),
              {
                id: `dm-topic-error-${Date.now()}`,
                threadId: topicId,
                authorId: 'system',
                authorName: 'Shadow Crew DM Topic',
                authorHandle: '@dm-topic-guard',
                authorAvatar: '⚠️',
                isAgent: true,
                kind: 'error',
                timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                content: '私聊议题缺少可用的 ACP Agent 或 Workspace Binding，本轮未派发。',
              },
            ],
          }));
          return;
        }
        if (isAgentOffline(dmAgent)) {
          setMessages((prev) => ({
            ...prev,
            [topicId]: [
              ...(prev[topicId] || []),
              {
                id: `dm-topic-offline-${Date.now()}`,
                threadId: topicId,
                authorId: 'system',
                authorName: 'Shadow Crew ACP Guard',
                authorHandle: '@connection-guard',
                authorAvatar: '🔌',
                isAgent: true,
                kind: 'guard',
                timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                content: `ACP Agent ${dmAgent.name} 当前未连接。请先启动该本地或远程 ACP 端点。`,
              },
            ],
          }));
          return;
        }

        const isGame = activeTopicData?.discussionMode === 'game_theoretic';
        const isHumanProposer = activeTopicData?.duelRoles?.proposer === 'human';
        const agentRole: GameRoleType = isGame
          ? isHumanProposer
            ? 'challenger'
            : 'proposer'
          : 'proposer';
        const stage: GameTheoreticStage = isGame
          ? agentRole === 'proposer'
            ? 'proposal'
            : 'challenge'
          : 'proposal';
        // Validate DM topic session key segments before session dispatch.
        buildAgentSessionKey({
          agentId: dmAgent.id,
          roomId: topicId,
          workspaceBindingId: topicBinding.id,
          discussionMode: activeTopicData?.discussionMode || 'standard',
          scopeType: 'dm_topic',
        });
        const priorTopicMessages = (messagesRef.current[topicId] || []).filter(
          (message) => !message.isPending && message.id !== userMsg.id && message.content?.trim()
        );
        const roomTranscript = priorTopicMessages
          .slice(-8)
          .map(
            (message) =>
              `${message.authorName}${message.isAgent ? ' (Agent)' : ' (Human)'}: ${message.content}`
          )
          .join('\n\n');
        const systemPrompt = buildCompositeSystemPrompt({
          agent: dmAgent,
          availableAgents: [dmAgent],
          includeRoster: false,
        });
        const prompt = isGame
          ? `[私聊双方博弈议题]\n标题：${activeTopicData?.title}\n背景：${activeTopicData?.description || activeTopicData?.title}\n\n[角色约束]\n你固定担任：${agentRole === 'proposer' ? '提案方' : '对抗方'}\n人类固定担任：${isHumanProposer ? '提案方' : '对抗方'}\n只允许两个角色，不得引入验证官、仲裁官或其他 Agent 角色。\n\n[最近讨论]\n${roomTranscript || '（暂无）'}\n\n[人类本轮发言]\n${agentTurnContent}\n\n请基于你的固定角色回复。提案方给出方案与约束，对抗方给出具体反例、风险和可证伪条件。`
          : `[私聊议题]\n标题：${activeTopicData?.title}\n背景：${activeTopicData?.description || activeTopicData?.title}\n\n[最近讨论]\n${roomTranscript || '（暂无）'}\n\n[人类本轮发言]\n${agentTurnContent}\n\n请直接回应并推进当前议题。`;
        const execKey = `${topicId}:${dmAgent.id}`;
        setActiveExecutions((prev) => ({
          ...prev,
          [execKey]: {
            agentId: dmAgent.id,
            agentName: dmAgent.name,
            agentAvatar: dmAgent.avatar,
            threadId: topicId,
            topicId,
            status: 'thinking',
            currentActionDetail: isGame
              ? agentRole === 'proposer'
                ? '正在以提案方身份立论...'
                : '正在以对抗方身份质询...'
              : '正在处理私聊议题...',
            startedAt: Date.now(),
          },
        }));

        void (async () => {
          try {
            await ensureAcpAgentSession({
              agentId: dmAgent.id,
              roomId: topicId,
              systemPrompt,
              discussionMode: activeTopicData?.discussionMode,
              workspaceBindingId: topicBinding.id,
              workspaceCwd: topicBinding.cwd,
              scopeType: 'dm_topic',
              localHistoryIntact: priorTopicMessages.length > 0,
            });
            const response = await sendPromptToAcpAgent({
              agent: dmAgent,
              roomId: topicId,
              prompt,
              workspaceBindingId: topicBinding.id,
              workspaceCwd: topicBinding.cwd,
              scopeType: 'dm_topic',
              systemPrompt,
              discussionMode: activeTopicData?.discussionMode,
              attachments: savedAttachments,
            });
            const agentReply: Message = {
              id: `dm-topic-reply-${Date.now()}-${dmAgent.id}`,
              threadId: topicId,
              authorId: dmAgent.id,
              authorName: dmAgent.name,
              authorHandle: dmAgent.handle,
              authorAvatar: dmAgent.avatar,
              isAgent: true,
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: response.textResponse,
              thinkingProcess: buildThinkingProcessFromAcp(response, '已处理私聊议题上下文'),
              gameRole: isGame ? agentRole : undefined,
              gameStage: isGame ? stage : undefined,
              agentBadge: isGame
                ? agentRole === 'proposer'
                  ? '🏛️ 私聊提案方'
                  : '⚔️ 私聊对抗方'
                : 'ACP · DM Topic',
              diffView: response.workspaceDiffs?.[0],
              diffViews: response.workspaceDiffs,
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), agentReply],
            }));
          } catch (error) {
            setMessages((prev) => ({
              ...prev,
              [topicId]: [
                ...(prev[topicId] || []),
                {
                  id: `dm-topic-reply-error-${Date.now()}`,
                  threadId: topicId,
                  authorId: 'system',
                  authorName: 'ACP DM Topic Error',
                  authorHandle: '@acp-error',
                  authorAvatar: '⚠️',
                  isAgent: true,
                  kind: 'error',
                  timestamp: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  content: error instanceof Error ? error.message : String(error),
                },
              ],
            }));
          } finally {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              return next;
            });
          }
        })();
        return;
      }

      const topicChannel = channels.find((c) => c.id === activeTopicData?.channelId) || activeChannel;
      const currentChannelAgentIds = Array.from(
        new Set([
          ...(topicChannel?.assignedAgentIds || []),
          ...(topicChannel?.memberIds || []),
        ])
      );
      const channelAssigned = currentChannelAgentIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a));
      const topicAssigned = (activeTopicData?.participatingAgentIds || [])
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is Agent => Boolean(a))
        .filter((a) => channelAssigned.some((ca) => ca.id === a.id));

      const isTopicAll = isAllMention(content);

      let userMentionedAgents: Agent[] = [];

      if (isTopicAll) {
        // 议题中 @all 严格限制在当前议题已参与的 Agent (或当前频道已准入的 Agent)，绝对不能越界拉取全工作区外部成员
        userMentionedAgents = topicAssigned.length > 0 ? topicAssigned : channelAssigned;
      } else {
        // 提取输入中的 @ 成员
        const allMentioned = parseAgentMentions(content, agents);
        const uninvitedMentions = allMentioned.filter(
          (a) => !channelAssigned.some((ca) => ca.id === a.id)
        );

        // 若在议题中点名了未加入当前频道的外部 Agent，进行硬拦截并出示频道准入守护提示
        if (uninvitedMentions.length > 0) {
          const guardNotice: Message = {
            id: `topic-guard-${Date.now()}`,
            threadId: topicId,
            channelId: activeTopicData?.channelId || activeChannel?.id,
            authorId: 'system',
            authorName: 'Shadow Crew 频道隔离守护',
            authorHandle: '@channel-guard',
            authorAvatar: '🔒',
            isAgent: true,
            agentBadge: 'Channel Guard',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔒 **频道准入拦截**：你尝试在议题中点名了 ${uninvitedMentions.map((a) => `@${a.name} (${a.handle})`).join('、')}，但该 Agent **未加入当前频道**。\n\n根据受邀准入原则，议题只能拉取属于频道内的 Agent 成员。如需其参与推演，请先在频道右上角「成员管理」邀请入驻。`,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), guardNotice],
          }));
        }

        // 仅保留属于当前频道内的合法 @ 目标
        const validMentioned = allMentioned.filter((a) =>
          channelAssigned.some((ca) => ca.id === a.id)
        );

        if (validMentioned.length > 0 && activeTopicData) {
          const newlyInvitedToTopic = validMentioned.filter(
            (a) => !topicAssigned.some((ta) => ta.id === a.id)
          );
          if (newlyInvitedToTopic.length > 0) {
            const newIds = newlyInvitedToTopic.map((a) => a.id);
            const updatedParticipating = Array.from(
              new Set([...(activeTopicData.participatingAgentIds || []), ...newIds])
            );
            topicAssigned.push(...newlyInvitedToTopic);

            setMessages((prev) => {
              let parentThreadId: string | null = null;
              for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
                if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                  parentThreadId = tId;
                  break;
                }
              }
              if (!parentThreadId) return prev;
              const roomMsgs = prev[parentThreadId] || [];
              return {
                ...prev,
                [parentThreadId]: roomMsgs.map((m) =>
                  m.topicData && m.topicData.id === topicId
                    ? {
                        ...m,
                        topicData: { ...m.topicData, participatingAgentIds: updatedParticipating },
                      }
                    : m
                ),
              };
            });
          }
          userMentionedAgents = validMentioned;
        } else if (uninvitedMentions.length > 0) {
          // 用户仅点名了未准入外部成员且无其他合法目标，直接阻断，避免非预期误触发
          return;
        }
      }

      const existingTopicMsgs = messagesRef.current[topicId] || [];
      const currentTopicObj = getTopicData(topicId) || activeTopicData;
      const isGameTheoretic = currentTopicObj?.discussionMode === 'game_theoretic';
      const currentTopicStage: GameTheoreticStage =
        currentTopicObj?.gameStage ||
        currentTopicObj?.gameTheoreticState?.currentStage ||
        'proposal';
      let executionStage: GameTheoreticStage = currentTopicStage;
      let targetRoleType: GameRoleType = 'proposer';

      const fallbackProposalText =
        currentTopicObj?.gameTheoreticState?.targetProposalContent ||
        existingTopicMsgs
          .slice()
          .reverse()
          .find(
            (m) =>
              !m.isPending &&
              (m.gameStage === 'proposal' || m.gameRole === 'proposer') &&
              m.content?.trim()
          )?.content;
      const fallbackChallengeText =
        currentTopicObj?.gameTheoreticState?.targetChallengeContent ||
        existingTopicMsgs
          .slice()
          .reverse()
          .find(
            (m) =>
              !m.isPending &&
              (m.gameStage === 'challenge' || m.gameRole === 'challenger') &&
              m.content?.trim()
          )?.content;
      const fallbackVerificationText =
        currentTopicObj?.gameTheoreticState?.targetVerificationContent ||
        existingTopicMsgs
          .slice()
          .reverse()
          .find(
            (m) =>
              !m.isPending &&
              (m.gameStage === 'verification' || m.gameRole === 'verifier') &&
              m.content?.trim()
          )?.content;
      const fallbackDefenseText =
        currentTopicObj?.gameTheoreticState?.targetDefenseContent ||
        existingTopicMsgs
          .slice()
          .reverse()
          .find((m) => !m.isPending && m.gameStage === 'defense' && m.content?.trim())?.content;

      const candidateAgents = topicAssigned.length > 0 ? topicAssigned : channelAssigned;
      let respondingAgents: Agent[] = [];

      if (isGameTheoretic) {
        if (userMentionedAgents.length > 0 && !isTopicAll) {
          respondingAgents = userMentionedAgents;
          const targetAgent = userMentionedAgents[0];
          const id = targetAgent.id;
          const gameRoles = currentTopicObj?.gameRoles;
          const isProposer = Boolean(gameRoles?.proposers?.includes(id));
          const isChallenger = Boolean(gameRoles?.challengers?.includes(id));
          const isVerifier = Boolean(gameRoles?.verifiers?.includes(id));
          const isArbiter = Boolean(gameRoles?.arbiters?.includes(id));
          const gState = currentTopicObj?.gameTheoreticState;
          const hasProposal = Boolean(fallbackProposalText?.trim());
          const isChallengerDone = Boolean(gState?.isChallengerResponded);
          const isVerifierDone = Boolean(gState?.isVerifierResponded);
          const isDefenseDone = Boolean(gState?.isDefenseResponded);

          // 1. 优先匹配当前所处阶段（若被点名角色正好能承接当前阶段）
          if (currentTopicStage === 'arbitration' && isArbiter) {
            targetRoleType = 'arbiter';
            executionStage = 'arbitration';
          } else if (currentTopicStage === 'defense' && isProposer) {
            targetRoleType = 'proposer';
            executionStage = 'defense';
          } else if (currentTopicStage === 'verification' && isVerifier) {
            targetRoleType = 'verifier';
            executionStage = 'verification';
          } else if (currentTopicStage === 'challenge' && isChallenger) {
            targetRoleType = 'challenger';
            executionStage = 'challenge';
          } else if (currentTopicStage === 'proposal' && isProposer && !hasProposal) {
            targetRoleType = 'proposer';
            executionStage = 'proposal';
            // 2. 否则按协同状态机未竟进度断点续推（如因通信中断挂起跳过，用户重新点名恢复该角色继续接力）
          } else if (isChallenger && (!isChallengerDone || currentTopicStage === 'proposal')) {
            targetRoleType = 'challenger';
            executionStage = 'challenge';
          } else if (isVerifier && (!isVerifierDone || currentTopicStage === 'challenge')) {
            targetRoleType = 'verifier';
            executionStage = 'verification';
          } else if (
            isProposer &&
            hasProposal &&
            (!isDefenseDone ||
              currentTopicStage === 'challenge' ||
              currentTopicStage === 'verification')
          ) {
            targetRoleType = 'proposer';
            executionStage = 'defense';
          } else if (
            isArbiter &&
            (isDefenseDone ||
              currentTopicStage === 'defense' ||
              currentTopicStage === 'arbitration')
          ) {
            targetRoleType = 'arbiter';
            executionStage = 'arbitration';
            // 3. 兜底角色映射
          } else if (isChallenger) {
            targetRoleType = 'challenger';
            executionStage = 'challenge';
          } else if (isVerifier) {
            targetRoleType = 'verifier';
            executionStage = 'verification';
          } else if (isArbiter) {
            targetRoleType = 'arbiter';
            executionStage = 'arbitration';
          } else if (isProposer) {
            targetRoleType = 'proposer';
            executionStage = hasProposal ? 'defense' : 'proposal';
          }

          // 同步更新议题阶段至最新执行阶段，并清理此前因 Agent 离线产生的法定人数警告
          if (executionStage !== currentTopicStage || gState?.quorumAlert) {
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: executionStage,
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: executionStage,
                quorumAlert: undefined,
              },
            }));
          }
        } else {
          // 根据三元/4+1博弈当前所处阶段分配角色，绝不并发广播给全员
          if (currentTopicStage === 'proposal') {
            const proposerIds = currentTopicObj?.gameRoles?.proposers || [];
            respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
            targetRoleType = 'proposer';
            executionStage = 'proposal';
          } else if (currentTopicStage === 'challenge') {
            const challengerIds = currentTopicObj?.gameRoles?.challengers || [];
            respondingAgents = candidateAgents.filter((a) => challengerIds.includes(a.id));
            targetRoleType = 'challenger';
            executionStage = 'challenge';
          } else if (currentTopicStage === 'verification') {
            const verifierIds = currentTopicObj?.gameRoles?.verifiers || [];
            respondingAgents = candidateAgents.filter((a) => verifierIds.includes(a.id));
            targetRoleType = 'verifier';
            executionStage = 'verification';
          } else if (currentTopicStage === 'defense') {
            const proposerIds = currentTopicObj?.gameRoles?.proposers || [];
            respondingAgents = candidateAgents.filter((a) => proposerIds.includes(a.id));
            targetRoleType = 'proposer';
            executionStage = 'defense';
          } else if (currentTopicStage === 'arbitration') {
            const arbiterIds = currentTopicObj?.gameRoles?.arbiters || [];
            respondingAgents = candidateAgents.filter((a) => arbiterIds.includes(a.id));
            targetRoleType = 'arbiter';
            executionStage = 'arbitration';
          }
          if (respondingAgents.length === 0 && candidateAgents.length > 0) {
            respondingAgents = [candidateAgents[0]];
          }
        }
      } else {
        if (userMentionedAgents.length > 0) {
          respondingAgents = userMentionedAgents;
        } else if (candidateAgents.length > 0) {
          // 标准讨论模式（对标 Buzz）：当用户未显式点名特定 Agent 时，唤醒当前议题内所有已指派的在线 Agent 在 Hop 1 并发发言
          respondingAgents = candidateAgents;
        }
      }

      if (respondingAgents.length === 0) {
        return;
      }

      // 检查通信状态：分离离线与已连接的 Agent
      const offlineAgents = respondingAgents.filter((a) => isAgentOffline(a));
      const onlineAgents = respondingAgents.filter((a) => isAgentOnline(a));

      // 仅当用户显式点名了离线 Agent、处于博弈模式角色缺失，或全部候选 Agent 均离线时才弹出离线拦截提示
      const shouldWarnOfflineInTopic =
        isGameTheoretic || userMentionedAgents.length > 0 || onlineAgents.length === 0;

      if (offlineAgents.length > 0 && shouldWarnOfflineInTopic) {
        const offlineDetails = offlineAgents
          .map((a) =>
            a.status === 'error'
              ? `• **${a.name}**：连接异常${a.statusDetail ? ` — ${a.statusDetail}` : ''}`
              : `• **${a.name}**：通信尚未开启`
          )
          .join('\n');
        setTimeout(() => {
          const offlineNotice: Message = {
            id: `msg-offline-topic-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: isGameTheoretic ? 'Shinobi 博弈协同管控' : 'Shadow Crew 通信管控',
            authorHandle: '@connection-guard',
            authorAvatar: '🔌',
            isAgent: true,
            agentBadge: 'Communication Required',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔌 **Agent 通信不可用，本轮不派发推演**：\n${offlineDetails}\n\n根据产品规范，在与其协作推演前，需先在左侧「Agents & 编队」控制面板点击对应 Agent 头像下方的【Start】按钮开启 ACP 通信连接；若显示连接异常，请先修复其运行环境后重新 Start。`,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), offlineNotice],
          }));
        }, 300);
      }

      if (onlineAgents.length === 0) {
        return;
      }

      const now = Date.now();
      setIsGenerating(true);

      // 1. 在 UI activeExecutions 中注册推演任务
      const newExecs: Record<string, ActiveAgentExecution> = {};
      onlineAgents.forEach((agent, idx) => {
        const execKey = `${topicId}:${agent.id}`;
        newExecs[execKey] = {
          agentId: agent.id,
          agentName: agent.name,
          agentAvatar: agent.avatar,
          threadId: topicId,
          topicId: topicId,
          status: 'thinking',
          currentActionDetail: isGameTheoretic
            ? executionStage === 'proposal'
              ? '正在推演并起草主导立论方案 (Stage: 🏛️ 方案立论)...'
              : executionStage === 'challenge'
              ? '正在对立论方案进行反例压测与证伪 (Stage: ⚔️ 反例压测)...'
              : executionStage === 'verification'
              ? '正在调用工具与沙箱进行物理事实与真实性校验 (Stage: 🔍 接地验证)...'
              : executionStage === 'defense'
              ? '正在针对反例质询构建防御答辩与架构补丁 (Stage: 🛡️ 答辩修正)...'
              : '正在进行立论、反例与接地证据审查并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...'
            : onlineAgents.length > 1
            ? '正在并发独立推演方案与系统共识 (并行 Hop 1)...'
            : '正在深度推演议题方案与系统共识 (Hop 1)...',
          startedAt: now + idx * 50,
          cascadeHop: isGameTheoretic
            ? executionStage === 'proposal'
              ? 1
              : executionStage === 'challenge'
              ? 2
              : executionStage === 'verification'
              ? 3
              : executionStage === 'defense'
              ? 4
              : 5
            : 1,
        };
      });

      setActiveExecutions((prev) => ({
        ...prev,
        ...newExecs,
      }));

      // 维持 Agent 在线基线状态 ('running')
      setAgents((prev) =>
        prev.map((a) =>
          onlineAgents.some((oa) => oa.id === a.id) && a.status !== 'running'
            ? { ...a, status: 'running' }
            : a
        )
      );

      // 提取议题前序研讨记录（若启用 G-Frame 模块化隔离且当前模块已有专属消息，则仅注入本模块沙箱内的历史）
      const activeModState = currentTopicObj?.gameTheoreticState?.modularState;
      const activeModSlice =
        activeModState?.enabled && activeModState.activeModuleId
          ? activeModState.modules.find((m) => m.moduleId === activeModState.activeModuleId)
          : undefined;
      const scopedMsgIdSet =
        activeModSlice && activeModSlice.scopedMessageIds.length > 0
          ? new Set(activeModSlice.scopedMessageIds)
          : undefined;

      const recentHistory = existingTopicMsgs
        .filter(
          (m) =>
            m.authorId !== 'system' &&
            m.kind !== 'system_control' &&
            m.kind !== 'guard' &&
            m.kind !== 'rollup' &&
            !m.agentBadge?.includes('Guard') &&
            (!scopedMsgIdSet || scopedMsgIdSet.has(m.id))
        )
        .slice(-4)
        .map((m) => ({
          author: m.authorName || m.authorHandle,
          content: m.content,
          isAgent: m.isAgent,
        }));

      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopicObj?.title || '议题方案推演',
        description: currentTopicObj?.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopicObj?.status || 'open',
        discussionMode: currentTopicObj?.discussionMode,
        gameRoles: currentTopicObj?.gameRoles,
        gameStage: isGameTheoretic ? executionStage : undefined,
        targetProposalText:
          isGameTheoretic &&
          (executionStage === 'challenge' ||
            executionStage === 'verification' ||
            executionStage === 'defense' ||
            executionStage === 'arbitration')
            ? fallbackProposalText
            : undefined,
        targetChallengeText:
          isGameTheoretic &&
          (executionStage === 'verification' ||
            executionStage === 'defense' ||
            executionStage === 'arbitration')
            ? fallbackChallengeText
            : undefined,
        targetVerificationText:
          isGameTheoretic && (executionStage === 'defense' || executionStage === 'arbitration')
            ? fallbackVerificationText
            : undefined,
        targetDefenseText:
          isGameTheoretic && executionStage === 'arbitration' ? fallbackDefenseText : undefined,
        modularState: activeModState,
        participatingAgents: candidateAgents,
        recentHistory,
      };

      // 2. 向 onlineAgents 下发 prompt (标准模式采用共享级联 + 水位线增量 + Turn Barrier 同步汇合)
      const sharedStandardCascadeId = `cascade-topic-${Date.now()}`;
      if (!isGameTheoretic) {
        const initialCallCounts: Record<string, number> = {};
        onlineAgents.forEach((ag) => {
          initialCallCounts[ag.id] = 1;
        });
        const sharedCascade: CollaborationCascade = {
          cascadeId: sharedStandardCascadeId,
          rootMessageId: userMsg.id,
          roomId: topicId,
          originalPrompt: agentTurnContent,
          depth: 1,
          maxDepth: 12,
          visitedAgentIds: onlineAgents.map((a) => a.id),
          agentCallCounts: initialCallCounts,
          isAborted: false,
        };
        setActiveCascades((prev) => ({ ...prev, [sharedStandardCascadeId]: sharedCascade }));
      }

      const standardTurnOutputs: TurnAgentOutput[] = [];
      const topicTurnSnapshot = captureTurnEpoch(
        topicId,
        topicChannel?.id || activeTopicData?.channelId
      );

      const agentTurnPromises = onlineAgents.map(async (agent) => {
        const execKey = `${topicId}:${agent.id}`;
        const sessionKey = buildAgentSessionKey({
          agentId: agent.id,
          roomId: topicId,
          channelId: topicChannel?.id || activeTopicData?.channelId,
          isDm: false,
          discussionMode: isGameTheoretic ? 'game_theoretic' : 'standard',
          workspaceBindingId: activeTopicData?.workspaceBindingId,
          scopeType: 'topic',
        });

        const preflightSystemPrompt = buildCompositeSystemPrompt({
          agent,
          availableAgents: candidateAgents,
          includeRoster: true,
        });

        const priorTopicMessages = (messagesRef.current[topicId] || []).filter(
          (m) =>
            !m.isPending && (m.content?.trim() || m.thinkingProcess) && m.id !== userMsg.id
        );
        const localHistoryIntact = priorTopicMessages.length > 0;

        let sessionPreflight: {
          isNew: boolean;
          recoveryMode?: 'resume' | 'load' | 'new';
        } | null = null;
        try {
          sessionPreflight = await ensureAcpAgentSession({
            agentId: agent.id,
            roomId: topicId,
            channelId: topicChannel?.id || activeTopicData?.channelId,
            systemPrompt: preflightSystemPrompt,
            discussionMode: isGameTheoretic ? 'game_theoretic' : 'standard',
            workspaceBindingId: activeTopicData?.workspaceBindingId,
            workspaceCwd: getTopicWorkspaceBinding(activeTopicData?.id)?.cwd,
            scopeType: 'topic',
            localHistoryIntact,
          });
        } catch (err) {
          console.error(
            `[TopicTurn] Preflight ensureAcpAgentSession failed for ${agent.name}:`,
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
              a.id === agent.id ? resetAgentHandshakeCapabilities(a, 'idle', undefined) : a
            )
          );
          syncRunningAgentsWithBackend();

          const errorReply: Message = {
            id: `topic-reply-err-${Date.now()}-${agent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: agent.id,
            authorName: agent.name,
            authorHandle: agent.handle,
            authorAvatar: agent.avatar,
            isAgent: true,
            isPending: false,
            gameStage: isGameTheoretic ? executionStage : undefined,
            gameRole: isGameTheoretic ? targetRoleType : undefined,
            agentBadge: 'ACP Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **会话初始化异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
          };

          if (isGameTheoretic && executionStage === 'challenge') {
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'arbitration',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'arbitration',
                isChallengerResponded: false,
                quorumAlert: `制衡方 (${agent.name}) 发生会话初始化异常：${err instanceof Error ? err.message : String(err)}`,
              },
            }));
          }

          commitMessages((prev) => {
            const existing = prev[topicId] || [];
            return {
              ...prev,
              [topicId]: [...existing, errorReply],
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
            const currentTopicTranscript = messagesRef.current[topicId] || [];
            const lastPriorMsg = currentTopicTranscript
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
        const systemPrompt = buildCompositeSystemPrompt({
          agent,
          availableAgents: candidateAgents,
          includeRoster: !isStandingContextDelivered,
        });

        let finalPrompt: string;
        if (isGameTheoretic) {
          finalPrompt = buildTopicPrompt({
            topic: topicContext,
            userContent: agentTurnContent,
            targetAgent: agent,
            availableAgents: candidateAgents,
          });
        } else {
          // 对标 Buzz: 标准模式按 (topicId:agentId) 水位线提取未读增量批次 (<delta-events>)
          const lastWatermark = sessionWatermarksRef.current.get(sessionKey);
          const currentTopicTranscript = messagesRef.current[topicId] || [];
          const deltaBatch = extractUnreadDeltaMessages({
            messages: currentTopicTranscript,
            triggerMessages: [userMsg],
            lastWatermarkMessageId: lastWatermark,
            excludeAuthorId: agent.id,
          });
          if (deltaBatch.latestWatermarkMessageId) {
            sessionWatermarksRef.current.set(sessionKey, deltaBatch.latestWatermarkMessageId);
            persistSessionWarmState();
          }
          finalPrompt = buildNormalModeTurnPrompt({
            targetAgent: agent,
            availableAgents: candidateAgents,
            roomId: topicId,
            isWarmSession: deltaBatch.isWarmSession,
            deltaMessages: deltaBatch.deltaMessages,
            triggerContent: agentTurnContent,
            hop: 1,
            maxHops: 12,
            topic: topicContext,
            isDm: false,
            isParallelFirstTurn: onlineAgents.length > 1,
          });
        }

        deliveredStandingContextRef.current.add(sessionKey);
        persistSessionWarmState();

        const cascadeId = isGameTheoretic
          ? `cascade-topic-${Date.now()}-${agent.id}`
          : sharedStandardCascadeId;

        if (isGameTheoretic) {
          const newCascade: CollaborationCascade = {
            cascadeId,
            rootMessageId: userMsg.id,
            roomId: topicId,
            originalPrompt: agentTurnContent,
            depth: 1,
            maxDepth: 12,
            visitedAgentIds: [agent.id],
            agentCallCounts: { [agent.id]: 1 },
            isAborted: false,
          };
          setActiveCascades((prev) => ({ ...prev, [cascadeId]: newCascade }));
        }

        logRpc(agent.name, 'client_to_agent', 'session/prompt', {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'session/prompt',
          params: { roomId: topicId, prompt: finalPrompt, channelId: topicChannel?.id },
        });

        const pendingId = `topic-pending-${Date.now()}-${agent.id}`;
        const pendingMsg: Message = {
          id: pendingId,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: agent.id,
          authorName: agent.name,
          authorHandle: agent.handle,
          authorAvatar: agent.avatar,
          isAgent: true,
          isPending: true,
          startedAt: Date.now(),
          pendingHint: isGameTheoretic
            ? targetRoleType === 'proposer'
              ? executionStage === 'defense'
                ? '正在审视反例质询与实测数据，构建架构防御与补丁方案 (Stage: 🛡️ 答辩修正)...'
                : '正在构思核心立论方案与架构设计推演 (Stage: 🏛️ 方案立论)...'
              : targetRoleType === 'challenger'
              ? '正在对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...'
              : targetRoleType === 'verifier'
              ? '正在调取外部工具、代码解释器沙箱与事实基准进行真实性接地校验 (Stage: 🔍 接地验证)...'
              : '正在权衡方案、反例与接地证据并起草仲裁建议 (Stage: ⚖️ 仲裁定案)...'
            : '正在思考并组织回复...',
          agentBadge: isGameTheoretic
            ? `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${
                targetRoleType === 'proposer'
                  ? executionStage === 'defense'
                    ? '🛡️ 答辩修正 (思考中...)'
                    : '🏛️ 方案立论 (思考中...)'
                  : targetRoleType === 'challenger'
                  ? '⚔️ 反例压测 (思考中...)'
                  : targetRoleType === 'verifier'
                  ? '🔍 接地验证 (执行中...)'
                  : '⚖️ 仲裁建言 (思考中...)'
              }`
            : `${agent.modelBadge?.split(' ')[0] || 'Local'} · 思考中...`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: '',
          gameStage: isGameTheoretic ? executionStage : undefined,
          gameRole: isGameTheoretic ? targetRoleType : undefined,
        };

        commitMessages((prev) => {
          const existing = prev[topicId] || [];
          const nextTopicMsgs = existing.some((m) => m.id === pendingId)
            ? existing
            : [...existing, pendingMsg];
          return {
            ...prev,
            [topicId]: nextTopicMsgs,
          };
        });

        const turnSnapshot = captureTurnEpoch(
          topicId,
          topicChannel?.id || activeTopicData?.channelId,
          agent.id
        );
        return sendPromptToAcpAgent({
          agent,
          roomId: topicId,
          prompt: finalPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: activeTopicData?.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(activeTopicData?.id)?.cwd,
          scopeType: 'topic',
          systemPrompt,
          discussionMode: activeTopicData?.discussionMode,
          attachments: savedAttachments,
        })
          .then(async (acpResp) => {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });
            if (isTurnStale(turnSnapshot)) {
              console.log(
                '[App] Dropping topic prompt reply because turn was aborted or invalidated'
              );
              return null;
            }

            setAgents((prev) =>
              applyPromptNativeMemoryCapability(
                prev.map((a) =>
                  a.id === agent.id &&
                  a.status !== 'starting' &&
                  isAgentActivelyRunning(a)
                    ? { ...a, status: 'running' }
                    : a
                ),
                agent.id,
                acpResp.nativeMemoryCapability,
                agent
              )
            );
            syncRunningAgentsWithBackend();

            const agentReply: Message = {
              id: `topic-reply-${Date.now()}-${agent.id}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: agent.id,
              authorName: agent.name,
              authorHandle: agent.handle,
              authorAvatar: agent.avatar,
              isAgent: true,
              isPending: false,
              gameStage: isGameTheoretic ? executionStage : undefined,
              gameRole: isGameTheoretic ? targetRoleType : undefined,
              agentBadge: isGameTheoretic
                ? `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${
                    targetRoleType === 'proposer'
                      ? executionStage === 'defense'
                        ? '🛡️ 答辩修正'
                        : '🏛️ 方案立论'
                      : targetRoleType === 'challenger'
                      ? '⚔️ 反例压测'
                      : targetRoleType === 'verifier'
                      ? '🔍 接地验证'
                      : '⚖️ 仲裁建言'
                  }`
                : `${agent.modelBadge?.split(' ')[0] || 'Local'} · ${acpResp.isRealProcess ? 'ACP Stdio (Real)' : agent.isRemote ? 'ACP Remote' : '协作'}`,
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: acpResp.textResponse,
              thinkingProcess: buildThinkingProcessFromAcp(
                acpResp,
                isGameTheoretic
                  ? '已完成博弈推演与技术边界审定'
                  : '已检索私有记忆库并完成技术边界考量'
              ),
              diffView:
                acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
                  ? acpResp.workspaceDiffs[0]
                  : undefined,
              cartridgeCitation: acpResp.cartridgeCitation,
              collaborationInfo: {
                cascadeId,
                hop: 1,
                maxHops: 12,
                rootMessageId: userMsg.id,
                sourceMessageId: userMsg.id,
                invokedByAgentId: userMsg.authorId,
                invokedByAgentName: userMsg.authorName,
                invokedByAgentHandle: userMsg.authorHandle,
              },
            };

            commitMessages((prev) => {
              const existing = prev[topicId] || [];
              const hasPending = existing.some((m) => m.id === pendingId);
              const nextTopicMsgs = hasPending
                ? existing.map((m) => (m.id === pendingId ? agentReply : m))
                : existing.some((m) => m.id === agentReply.id)
                ? existing
                : [...existing, agentReply];
              let parentThreadId: string | null = null;
              for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
                if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
                  parentThreadId = tId;
                  break;
                }
              }

              const updatedChannelMsgs = parentThreadId
                ? (prev[parentThreadId] || []).map((m) => {
                    if (m.type === 'topic' && m.topicData?.id === topicId) {
                      return {
                        ...m,
                        topicData: {
                          ...m.topicData,
                          repliesCount: nextTopicMsgs.filter((msg) => !msg.isPending).length,
                          latestReplyPreview: agentReply.content.slice(0, 60),
                        },
                      };
                    }
                    return m;
                  })
                : [];

              return {
                ...prev,
                [topicId]: nextTopicMsgs,
                ...(parentThreadId ? { [parentThreadId]: updatedChannelMsgs } : {}),
              };
            });

            logRpc(agent.name, 'agent_to_client', 'session/prompt:result', {
              jsonrpc: '2.0',
              method: 'session/prompt:result',
              result: acpResp,
            });

            if (isGameTheoretic) {
              // 三元博弈协议驱动状态机接力 (Protocol FSM Handover)
              if (executionStage === 'proposal') {
                if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                  console.warn('Proposer returned empty/error turn, pausing handover.');
                } else {
                  const extractedDecomp = extractModuleDecompositionFromAcpResponse(
                    acpResp,
                    agent.name
                  );
                  const currentTopicData = getTopicData(topicId) || activeTopicData;
                  const baseModular = extractedDecomp
                    ? initializeModularOrchestrationState(extractedDecomp)
                    : currentTopicData?.gameTheoreticState?.modularState ||
                      initializeModularOrchestrationState(
                        buildDefaultDecompositionFromTopic(
                          currentTopicData?.title || '',
                          currentTopicData?.description,
                          acpResp.textResponse
                        )
                      );

                  const hasVerifiers = (currentTopicData?.gameRoles?.verifiers || []).length > 0;

                  // 统一调用 stepModularStageTransition 计算首模块提案流转与快速通道判定 (N8, N10, N12)
                  const propStep = stepModularStageTransition({
                    state: baseModular,
                    currentStage: 'proposal',
                    feedbackDelta: {},
                    proposalOrDefenseSnippet: acpResp.textResponse,
                    hasVerifiers,
                  });

                  const nextStageForM1 = propStep.nextGameStage as 'verification' | 'challenge';
                  const nextModular: ModularOrchestrationState = {
                    ...propStep.nextState,
                    modules: propStep.nextState.modules.map((m) =>
                      m.moduleId === baseModular.activeModuleId
                        ? { ...m, scopedMessageIds: [...m.scopedMessageIds, agentReply.id] }
                        : m
                    ),
                  };

                  const activeMod = nextModular.modules.find(
                    (m) => m.moduleId === nextModular.activeModuleId
                  );
                  const isFastTrack = nextStageForM1 === 'verification';
                  const wasDowngraded = propStep.posteriorAction === 'ESCALATE_TO_RED_TEAM';

                  // 白名单正交收敛非静默审计通知 (N5)
                  const dedupRecords = baseModular.whitelistDeduplications || [];
                  if (dedupRecords.length > 0) {
                    const dedupNoticeMsg: Message = {
                      id: `msg-whitelist-dedup-${Date.now()}`,
                      threadId: topicId,
                      channelId: topicChannel?.id,
                      authorId: 'system',
                      authorName: 'G-Frame 白名单正交裁决器',
                      authorHandle: '@gframe-whitelist-governor',
                      authorAvatar: '🛡️',
                      isAgent: true,
                      agentBadge: `白名单拓扑归属收敛 (${dedupRecords.length} 项)`,
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      content:
                        `🛡️ **G-Frame 白名单正交归属收敛 (Whitelist Disjoint Enforcement)**：\n` +
                        dedupRecords
                          .map(
                            (d) =>
                              `- **${d.file}**：由上游模块「${d.allocatedToModuleTitle}」独占持有，已从下游「${d.strippedFromModuleTitle}」白名单中显式收敛剥离。下游模块须经由《公共接口契约》以只读方式引入。`
                          )
                          .join('\n'),
                    };
                    setMessages((prev) => ({
                      ...prev,
                      [topicId]: [...(prev[topicId] || []), dedupNoticeMsg],
                    }));
                  }

                  // fast_track 快速通道校验验证官与通知 (N8 & N10 & N12)
                  if (wasDowngraded && activeMod) {
                    const downgradeNotice: Message = {
                      id: `msg-fast-track-downgrade-${Date.now()}`,
                      threadId: topicId,
                      channelId: topicChannel?.id,
                      authorId: 'system',
                      authorName: '贝叶斯快速通道调控器',
                      authorHandle: '@bayesian-fast-track',
                      authorAvatar: '⚠️',
                      isAgent: true,
                      agentBadge: 'Fast Track Downgraded',
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      content: `⚠️ **快速通道降级告警 (Fast-Track Downgraded)**：模块「${activeMod.title}」先验虽符合快速通道标准，但当前议题未指派接地验证官 (Verifier)，无法执行物理接地与静态契约校验。自动降级为标准深度博弈 (deep_debate)，流转至【阶段 2: ⚔️ 反例压测】！`,
                      gameStage: 'challenge',
                    };
                    setMessages((prev) => ({
                      ...prev,
                      [topicId]: [...(prev[topicId] || []), downgradeNotice],
                    }));
                  } else if (isFastTrack && activeMod) {
                    const fastTrackNotice: Message = {
                      id: `msg-fast-track-${Date.now()}`,
                      threadId: topicId,
                      channelId: topicChannel?.id,
                      authorId: 'system',
                      authorName: '贝叶斯快速通道调控器',
                      authorHandle: '@bayesian-fast-track',
                      authorAvatar: '⚡',
                      isAgent: true,
                      agentBadge: 'Fast Track',
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      content: `⚡ **贝叶斯快速通道 (fast_track)**：模块「${activeMod.title}」先验风险为 ${(activeMod.belief.priorRisk * 100).toFixed(0)}% (< 45%)，符合低熵确定性模块标准。跳过红队对抗，直接流转至接地验证与契约对齐！`,
                      gameStage: 'verification',
                    };
                    setMessages((prev) => ({
                      ...prev,
                      [topicId]: [...(prev[topicId] || []), fastTrackNotice],
                    }));
                  }

                  updateTopicDataInState(topicId, (old) => ({
                    ...old,
                    gameStage: nextStageForM1,
                    gameTheoreticState: {
                      ...old.gameTheoreticState,
                      currentStage: nextStageForM1,
                      targetProposalContent: acpResp.textResponse,
                      isChallengerResponded: false,
                      isChallengerBypassed: isFastTrack,
                      challengerBypassedReason: isFastTrack
                        ? 'Bayesian Fast-Track: 模块先验风险低于阈值，依博弈规约旁路红队对抗直接进入接地验证。'
                        : undefined,
                      modularState: nextModular,
                      cognoNexus: {
                        ...(old.gameTheoreticState?.cognoNexus || { committedStates: [] }),
                        modularState: nextModular,
                      },
                    },
                  }));

                  triggerGameTheoreticStageHandover({
                    topicId,
                    nextStage: nextStageForM1,
                    targetProposalText: acpResp.textResponse,
                  });
                }
              } else if (executionStage === 'challenge') {
                if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                  console.warn('Challenger returned empty/error turn, pausing handover.');
                } else {
                  const freshTopic = getTopicData(topicId) || activeTopicData;
                  const hasVerifiers = (freshTopic?.gameRoles?.verifiers || []).length > 0;
                  const nextStageTarget = hasVerifiers ? 'verification' : 'defense';
                  updateTopicDataInState(topicId, (old) => ({
                    ...old,
                    gameStage: nextStageTarget,
                    gameTheoreticState: {
                      ...old.gameTheoreticState,
                      currentStage: nextStageTarget,
                      targetChallengeContent: acpResp.textResponse,
                      isChallengerResponded: true,
                      quorumAlert: undefined,
                    },
                  }));
                  triggerGameTheoreticStageHandover({
                    topicId,
                    nextStage: nextStageTarget,
                    targetProposalText:
                      fallbackProposalText ||
                      freshTopic?.gameTheoreticState?.targetProposalContent,
                    targetChallengeText: acpResp.textResponse,
                  });
                }
              } else if (executionStage === 'verification') {
                if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                  console.warn('Verifier returned empty/error turn, pausing handover.');
                } else {
                  const freshTopic = getTopicData(topicId) || activeTopicData;
                  updateTopicDataInState(topicId, (old) => ({
                    ...old,
                    gameStage: 'defense',
                    gameTheoreticState: {
                      ...old.gameTheoreticState,
                      currentStage: 'defense',
                      targetVerificationContent: acpResp.textResponse,
                      isVerifierResponded: true,
                      quorumAlert: undefined,
                    },
                  }));
                  triggerGameTheoreticStageHandover({
                    topicId,
                    nextStage: 'defense',
                    targetProposalText:
                      fallbackProposalText ||
                      freshTopic?.gameTheoreticState?.targetProposalContent,
                    targetChallengeText:
                      fallbackChallengeText ||
                      freshTopic?.gameTheoreticState?.targetChallengeContent,
                    targetVerificationText: acpResp.textResponse,
                  });
                }
              } else if (executionStage === 'defense') {
                if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                  console.warn('Proposer defense returned empty/error turn, pausing handover.');
                } else {
                  const freshTopic = getTopicData(topicId) || activeTopicData;
                  updateTopicDataInState(topicId, (old) => ({
                    ...old,
                    gameStage: 'arbitration',
                    gameTheoreticState: {
                      ...old.gameTheoreticState,
                      currentStage: 'arbitration',
                      targetDefenseContent: acpResp.textResponse,
                      isDefenseResponded: true,
                      quorumAlert: undefined,
                    },
                  }));
                  triggerGameTheoreticStageHandover({
                    topicId,
                    nextStage: 'arbitration',
                    targetProposalText:
                      fallbackProposalText ||
                      freshTopic?.gameTheoreticState?.targetProposalContent,
                    targetChallengeText:
                      fallbackChallengeText ||
                      freshTopic?.gameTheoreticState?.targetChallengeContent,
                    targetVerificationText:
                      fallbackVerificationText ||
                      freshTopic?.gameTheoreticState?.targetVerificationContent,
                    targetDefenseText: acpResp.textResponse,
                  });
                }
              } else if (executionStage === 'arbitration') {
                if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
                  console.warn('Arbiter returned empty/error turn, pausing concurrence handover.');
                } else {
                  const currentTopicObj = getTopicData(topicId) || activeTopicData;
                  await processArbitrationConcurrence({
                    topicId,
                    arbiterAgent: agent,
                    acpResp,
                    turnSnapshot,
                    targetProposalText:
                      fallbackProposalText ||
                      currentTopicObj?.gameTheoreticState?.targetProposalContent,
                    targetChallengeText:
                      fallbackChallengeText ||
                      currentTopicObj?.gameTheoreticState?.targetChallengeContent,
                    targetVerificationText:
                      fallbackVerificationText ||
                      currentTopicObj?.gameTheoreticState?.targetVerificationContent,
                    targetDefenseText:
                      fallbackDefenseText ||
                      currentTopicObj?.gameTheoreticState?.targetDefenseContent,
                    candidateAgents,
                    topicChannel,
                    arbiterPendingId: pendingId,
                    arbiterReply: agentReply,
                  });
                }
              }
            } else {
              // 标准讨论模式：收集本轮并发输出，待 Turn Barrier 全部汇合后统一去重触发下一跳
              standardTurnOutputs.push({
                agent,
                messageId: agentReply.id,
                replyContent: acpResp.textResponse,
              });
            }
          })
          .catch((err) => {
            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[execKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });
            syncRunningAgentsWithBackend();
            if (isTurnStale(turnSnapshot)) {
              console.log(
                '[App] Dropping topic prompt error because turn was aborted or invalidated'
              );
              return null;
            }
            console.error('Failed to send topic prompt to agent:', err);
            const errorReply: Message = {
              id: `topic-reply-err-${Date.now()}-${agent.id}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: agent.id,
              authorName: agent.name,
              authorHandle: agent.handle,
              authorAvatar: agent.avatar,
              isAgent: true,
              isPending: false,
              gameStage: isGameTheoretic ? executionStage : undefined,
              gameRole: isGameTheoretic ? targetRoleType : undefined,
              agentBadge: 'ACP Error',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              content: `⚠️ **ACP 通信异常**：${err instanceof Error ? err.message : String(err)}\n\n请检查 Agent 命令配置或相关依赖环境。`,
            };

            if (isGameTheoretic && executionStage === 'challenge') {
              updateTopicDataInState(topicId, (old) => ({
                ...old,
                gameStage: 'arbitration',
                gameTheoreticState: {
                  ...old.gameTheoreticState,
                  currentStage: 'arbitration',
                  isChallengerResponded: false,
                  quorumAlert: `制衡方 (${agent.name}) 发生通信异常：${err instanceof Error ? err.message : String(err)}`,
                },
              }));
            }

            commitMessages((prev) => {
              const existing = prev[topicId] || [];
              const hasPending = existing.some((m) => m.id === pendingId);
              const nextTopicMsgs = hasPending
                ? existing.map((m) => (m.id === pendingId ? errorReply : m))
                : existing.some((m) => m.id === errorReply.id)
                ? existing
                : [...existing, errorReply];
              return {
                ...prev,
                [topicId]: nextTopicMsgs,
              };
            });
          });
      });

      // 标准讨论模式：Turn Barrier 同步屏障 —— 等待首轮所有并发 Agent 全部执行完毕后，统一聚合去重 @mention 唤醒下一跳
      if (!isGameTheoretic && agentTurnPromises.length > 0) {
        Promise.allSettled(agentTurnPromises).then(() => {
          if (isTurnStale(topicTurnSnapshot)) return;
          if (standardTurnOutputs.length > 0) {
            dispatchCascadingAgentResponse({
              cascadeId: sharedStandardCascadeId,
              turnOutputs: standardTurnOutputs,
              roomId: topicId,
              isTopic: true,
              topicId,
            });
          }
        });
      }
    },
    [
      activeTopicData,
      commitMessages,
      agents,
      getTopicWorkspaceBinding,
      setMessages,
      messagesRef,
      setActiveExecutions,
      channels,
      activeChannel,
      getTopicData,
      updateTopicDataInState,
      setIsGenerating,
      setAgents,
      setActiveCascades,
      captureTurnEpoch,
      syncRunningAgentsWithBackend,
      deliveredStandingContextRef,
      sessionWatermarksRef,
      persistSessionWarmState,
      logRpc,
      isTurnStale,
      triggerGameTheoreticStageHandover,
      processArbitrationConcurrence,
      dispatchCascadingAgentResponse,
    ]
  );

  return {
    handleSendTopicMessage,
  };
}
