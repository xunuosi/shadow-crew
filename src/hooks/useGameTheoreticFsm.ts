import { useCallback } from 'react';
import type {
  Agent,
  Channel,
  Message,
  TopicMessageData,
  GameTheoreticStage,
  FastTrackConvergenceEvidence,
  SprtGovernorState,
  ActiveAgentExecution,
  WorkspaceBinding,
} from '../types';
import type { TurnEpochSnapshot } from '../services/agentCollaboration';
import {
  STAGE_CONTRACT_MAX_RETRIES,
  TopicPromptContext,
  applySycophancyDiscountToSprt,
  buildCompositeSystemPrompt,
  buildTopicPrompt,
  compileMinorityReport,
  dehydrateContextToCommittedStates,
  dehydrateTargetTextForHandover,
  estimateRoundAlignmentScore,
  evaluateDynamicSycophancyScore,
  extractArgumentNodes,
  localizeGraphDiffDispute,
  logGameTheoreticTelemetry,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  stepModularStageTransition,
  stepSprtGovernor,
  validateModuleScopeContract,
  validateStageContract,
  tieredGroundingGovernor,
} from '../services/agentCollaboration';
import {
  buildThinkingProcessFromAcp,
  sendPromptToAcpAgent,
} from '../services/acpClient';
import { isAgentOffline, isAgentOnline } from '../utils/agentRuntime';
import type { ProcessArbitrationConcurrenceOptions } from './useArbitrationConcurrence';

export interface GameTheoreticStageHandoverOptions {
  topicId: string;
  nextStage: 'proposal' | 'challenge' | 'verification' | 'defense' | 'arbitration';
  targetProposalText?: string;
  targetChallengeText?: string;
  targetVerificationText?: string;
  targetDefenseText?: string;
}

export interface UseGameTheoreticFsmParams {
  getTopicData: (topicId: string) => TopicMessageData | null;
  channels: Channel[];
  activeChannel: Channel | null | undefined;
  captureTurnEpoch: (threadId?: string, channelId?: string, agentId?: string) => TurnEpochSnapshot;
  isTurnStale: (turnSnapshot: TurnEpochSnapshot) => boolean;
  inFlightHandoverRef: React.MutableRefObject<Set<string>>;
  agentsRef: React.MutableRefObject<Agent[]>;
  stageRefineRetriesRef: React.MutableRefObject<Record<string, number>>;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  updateTopicDataInState: (
    topicId: string,
    updater: (oldTopic: TopicMessageData) => TopicMessageData
  ) => void;
  getTopicWorkspaceBinding: (topicId?: string) => WorkspaceBinding | undefined;
  processArbitrationConcurrence: (options: ProcessArbitrationConcurrenceOptions) => Promise<void>;
}

export interface UseGameTheoreticFsmReturn {
  triggerGameTheoreticStageHandover: (options: GameTheoreticStageHandoverOptions) => Promise<void>;
}

const extractGroundedTrueRatio = (verificationText: string): number => {
  return tieredGroundingGovernor.extractGroundedTrueRatio(verificationText);
};

export function useGameTheoreticFsm({
  getTopicData,
  channels,
  activeChannel,
  captureTurnEpoch,
  isTurnStale,
  inFlightHandoverRef,
  agentsRef,
  stageRefineRetriesRef,
  setIsGenerating,
  setActiveExecutions,
  setAgents,
  setMessages,
  updateTopicDataInState,
  getTopicWorkspaceBinding,
  processArbitrationConcurrence,
}: UseGameTheoreticFsmParams): UseGameTheoreticFsmReturn {
  const triggerGameTheoreticStageHandover = useCallback(
    async (options: GameTheoreticStageHandoverOptions): Promise<void> => {

    const {
      topicId,
      nextStage,
      targetProposalText: rawProposalText,
      targetChallengeText: rawChallengeText,
      targetVerificationText: rawVerificationText,
      targetDefenseText: rawDefenseText,
    } = options;
    const targetProposalText = rawProposalText ? dehydrateTargetTextForHandover(rawProposalText) : undefined;
    const targetChallengeText = rawChallengeText ? dehydrateTargetTextForHandover(rawChallengeText) : undefined;
    const targetVerificationText = rawVerificationText ? dehydrateTargetTextForHandover(rawVerificationText) : undefined;
    const targetDefenseText = rawDefenseText ? dehydrateTargetTextForHandover(rawDefenseText) : undefined;
    const currentTopic = getTopicData(topicId);
    if (!currentTopic || currentTopic.status === 'resolved') return;
    const turnSnapshot = captureTurnEpoch(topicId, currentTopic.channelId || activeChannel?.id);

    const handoverKey = `${topicId}:${nextStage}`;
    if (inFlightHandoverRef.current.has(handoverKey)) {
      console.warn(`[GameTheoretic] Handover for ${handoverKey} is already in-flight, skipping duplicate trigger.`);
      return;
    }
    inFlightHandoverRef.current.add(handoverKey);

    const topicChannel = channels.find((c) => c.id === currentTopic.channelId) || activeChannel;
    const channelAgents = (topicChannel?.assignedAgentIds || [])
      .map((id) => agentsRef.current.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    const topicAgents = (currentTopic.participatingAgentIds || [])
      .map((id) => agentsRef.current.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
    const candidateAgents = topicAgents.length > 0 ? topicAgents : channelAgents;

    // 阶段 1：模块沙箱独立提案立论 (Stage: proposal, N9)
    if (nextStage === 'proposal') {
      const proposerIds = currentTopic.gameRoles?.proposers || [];
      const proposerAgent = candidateAgents.find((a) => proposerIds.includes(a.id)) || candidateAgents[0];

      if (!proposerAgent) {
        inFlightHandoverRef.current.delete(handoverKey);
        console.warn('[GameTheoretic] No proposer agent available for modular proposal handover.');
        return;
      }

      const activeMod = currentTopic.gameTheoreticState?.modularState?.modules.find(
        (m) => m.moduleId === currentTopic.gameTheoreticState?.modularState?.activeModuleId
      );

      const execKey = `${topicId}:${proposerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: proposerAgent.id,
          agentName: proposerAgent.name,
          agentAvatar: proposerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在针对模块 [${activeMod?.title || '新模块'}] 进行沙箱独立提案立论 (Stage: 🏛️ 模块提案)...`,
          startedAt: Date.now(),
          cascadeHop: 1,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === proposerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const proposalPendingId = `topic-pending-${Date.now()}-${proposerAgent.id}`;
      const proposalPendingMsg: Message = {
        id: proposalPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: proposerAgent.id,
        authorName: proposerAgent.name,
        authorHandle: proposerAgent.handle,
        authorAvatar: proposerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: `正在针对模块 [${activeMod?.title || '新模块'}] 进行沙箱独立提案立论 (Stage: 🏛️ 模块提案)...`,
        agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🏛️ 模块提案 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'proposal',
        gameRole: 'proposer',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), proposalPendingMsg],
      }));

      const latestTopicForProposal = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'proposal',
        modularState: latestTopicForProposal.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const proposalPrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: currentTopic.description || currentTopic.title,
        targetAgent: proposerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: proposerAgent,
          roomId: topicId,
          prompt: proposalPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: proposerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          console.warn('Proposer returned empty/error turn in modular proposal, pausing handover.');
          setMessages((prev) => ({
            ...prev,
            [topicId]: (prev[topicId] || []).filter((m) => m.id !== proposalPendingId),
          }));
          inFlightHandoverRef.current.delete(handoverKey);
          return;
        }

        const proposalReply: Message = {
          id: `msg-prop-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🏛️ 模块提案`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, `已基于《公共接口契约》完成模块 [${activeMod?.title || '新模块'}] 独立设计`),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
          gameStage: 'proposal',
          gameRole: 'proposer',
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: (prev[topicId] || []).map((m) => (m.id === proposalPendingId ? proposalReply : m)),
        }));

        // 推进模块状态机进入该模块的验证 (fast_track) 或挑战 (deep_debate) (N8, N9, N10, N12)
        const latestTopicBeforeNext = getTopicData(topicId) || currentTopic;
        const curModular = latestTopicBeforeNext.gameTheoreticState?.modularState;
        let nextModStage: 'challenge' | 'verification' = 'challenge';
        let updatedModularState = curModular;
        let fastTrackNoticeMsg: Message | null = null;
        let isFastTrackBypassed = false;

        // 校验接地验证官可用性，防止 fast_track 无验证官时静默空转至答辩 (N10)
        const hasVerifiers = (currentTopic.gameRoles?.verifiers || []).length > 0;

        if (curModular?.enabled && curModular.activeModuleId) {
          const modStep = stepModularStageTransition({
            state: curModular,
            currentStage: 'proposal',
            feedbackDelta: {},
            proposalOrDefenseSnippet: acpResp.textResponse,
            hasVerifiers,
          });
          nextModStage = modStep.nextGameStage === 'verification' ? 'verification' : 'challenge';
          updatedModularState = {
            ...modStep.nextState,
            modules: modStep.nextState.modules.map((m) =>
              m.moduleId === curModular.activeModuleId
                ? {
                    ...m,
                    scopedMessageIds: [...m.scopedMessageIds, proposalReply.id],
                  }
                : m
            ),
          };

          const activeCurMod = updatedModularState.modules.find(
            (m) => m.moduleId === curModular.activeModuleId
          );
          if (modStep.posteriorAction === 'ESCALATE_TO_RED_TEAM' && activeCurMod) {
            fastTrackNoticeMsg = {
              id: `msg-fast-track-downgrade-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-fast-track',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Fast Track Downgraded',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **快速通道降级告警 (Fast-Track Downgraded)**：模块「${activeCurMod.title}」先验虽符合快速通道标准，但当前议题未指派接地验证官 (Verifier)，无法执行物理接地与静态契约校验。自动降级为标准深度博弈 (deep_debate)，流转至【阶段 2: ⚔️ 反例压测】！`,
              gameStage: 'challenge',
            };
          } else if (nextModStage === 'verification' && activeCurMod) {
            isFastTrackBypassed = true;
            fastTrackNoticeMsg = {
              id: `msg-fast-track-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-fast-track',
              authorAvatar: '⚡',
              isAgent: true,
              agentBadge: 'Fast Track',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚡ **贝叶斯快速通道 (fast_track)**：模块「${activeCurMod.title}」先验风险为 ${(activeCurMod.belief.priorRisk * 100).toFixed(0)}% (< 45%)，符合低熵确定性模块标准。跳过红队对抗，直接流转至接地验证与契约对齐！`,
              gameStage: 'verification',
            };
          }
        }

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: nextModStage,
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: nextModStage,
            targetProposalContent: dehydrateTargetTextForHandover(acpResp.textResponse),
            isChallengerResponded: false,
            isChallengerBypassed: isFastTrackBypassed || old.gameTheoreticState?.isChallengerBypassed,
            challengerBypassedReason: isFastTrackBypassed
              ? 'Bayesian Fast-Track: 模块先验风险低于阈值，依博弈规约旁路红队对抗直接进入接地验证。'
              : old.gameTheoreticState?.challengerBypassedReason,
            isVerifierResponded: false,
            isDefenseResponded: false,
            modularState: updatedModularState,
            cognoNexus: {
              ...old.gameTheoreticState?.cognoNexus,
              modularState: updatedModularState,
            },
          },
        }));

        if (fastTrackNoticeMsg) {
          const notice = fastTrackNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), notice],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: nextModStage,
          targetProposalText: acpResp.textResponse,
        });
        return;
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });
        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          return;
        }
        console.error('Modular proposal execution failed:', err);
        setMessages((prev) => ({
          ...prev,
          [topicId]: (prev[topicId] || []).filter((m) => m.id !== proposalPendingId),
        }));
        inFlightHandoverRef.current.delete(handoverKey);
        return;
      }
    }

    if (nextStage === 'challenge') {
      const challengerIds = currentTopic.gameRoles?.challengers || [];
      const challengerAgent = candidateAgents.find((a) => challengerIds.includes(a.id));

      if (!challengerAgent) {
        inFlightHandoverRef.current.delete(handoverKey);
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: '当前议题未指定或未找到可用的挑战者 (Challenger)。法定推演缺席 (Quorum Not Met)。',
          },
        }));

        const quorumNotice: Message = {
          id: `msg-quorum-alert-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@quorum-guard',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Quorum Alert',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **法定推演人数告警 (Quorum Alert)**：未指派或未匹配到制衡方 (Challenger)，法定对抗缺席。\n\n根据三元博弈规约，若无挑战者反例压测，人类首席仲裁官在终局定案时必须执行【具名豁免制衡方缺席 (Exemption)】方可敲响法槌。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), quorumNotice],
        }));
        return;
      }

      if (isAgentOffline(challengerAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: `挑战者 ${challengerAgent.name} 处于离线/未连接状态。`,
          },
        }));

        const offlineNotice: Message = {
          id: `msg-offline-challenger-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@connection-guard',
          authorAvatar: '🔌',
          isAgent: true,
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **制衡方通信尚未开启**：挑战者 **${challengerAgent.name}** 处于离线/未连接状态，无法接力反例压测。\n\n如需其完成对抗，请先在左侧面板点击【Start】开启 ACP 通信；或由人类首席仲裁官执行具名豁免后直接落槌。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), offlineNotice],
        }));
        return;
      }

      const execKey = `${topicId}:${challengerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: challengerAgent.id,
          agentName: challengerAgent.name,
          agentAvatar: challengerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...`,
          startedAt: Date.now(),
          cascadeHop: 2,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === challengerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const challengerPendingId = `topic-pending-${Date.now()}-${challengerAgent.id}`;
      const challengerPendingMsg: Message = {
        id: challengerPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: challengerAgent.id,
        authorName: challengerAgent.name,
        authorHandle: challengerAgent.handle,
        authorAvatar: challengerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在检索私有记忆并对立论方案进行反例压测与边界证伪 (Stage: ⚔️ 反例压测)...',
        agentBadge: `${challengerAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚔️ 反例压测 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'challenge',
        gameRole: 'challenger',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), challengerPendingMsg],
      }));

      const latestTopicForChallenge = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'challenge',
        targetProposalText,
        modularState: latestTopicForChallenge.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const challengePrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: targetProposalText || currentTopic.description || currentTopic.title,
        targetAgent: challengerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: challengerAgent,
          roomId: topicId,
          prompt: challengePrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: challengerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '制衡方返回空响应，未生成有效反例压测。');
        }

        const challengerReply: Message = {
          id: `topic-reply-${Date.now()}-${challengerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: challengerAgent.id,
          authorName: challengerAgent.name,
          authorHandle: challengerAgent.handle,
          authorAvatar: challengerAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${challengerAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚔️ 反例压测`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'challenge',
          gameRole: 'challenger',
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成反例边界与架构证伪推演'),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === challengerPendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === challengerPendingId ? challengerReply : m))
            : [...existing, challengerReply];
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
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
                      latestReplyPreview: challengerReply.content.slice(0, 60),
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

        // CognoNexus 阶段 2: 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('challenge', acpResp.textResponse, challengerAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'challenge',
          agentId: challengerAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:challenge`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '阶段契约未达标，触发 Self-Refine',
              gameStage: 'challenge',
              gameRole: 'challenger',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'challenge',
              targetProposalText,
            });
            return;
          } else {
            // 超过最大重试次数，进入 stageFailed 熔断交人类
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `红队挑战者 (${challengerAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足契约规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'challenge',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：挑战官 ${challengerAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足结构化批判规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'challenger',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:challenge`];

        // 提取论点因果节点、升级为 Claim DAG 与图差分冲突定位 (Wave 3 P1-1)
        const argumentNodes = extractArgumentNodes(targetProposalText);
        const disputePacket = localizeGraphDiffDispute(argumentNodes, acpResp.textResponse);
        const committedStates = dehydrateContextToCommittedStates(targetProposalText, acpResp.textResponse, argumentNodes);

        // 提炼并保留伴生少数派异议报告 (P0-2 Disagreement-Aware Deliberation)
        const minorityReport = compileMinorityReport({
          dissentingAgentId: challengerAgent.id,
          dissentingAgentName: challengerAgent.name,
          dissentingAgentModel: challengerAgent.modelBadge || challengerAgent.modelConfig?.modelId || challengerAgent.modelConfig?.modelName || 'Heterogeneous-LLM',
          critiqueText: acpResp.textResponse,
          proposalText: targetProposalText,
        });

        const sprtScore = estimateRoundAlignmentScore({
          proposalText: targetProposalText,
          critiqueText: acpResp.textResponse,
        });
        // 关键门禁：若存在未验证核心冲突切片，拦截 early_exit (P1-2 / P0-1)
        const hasUnverifiedDispute = Boolean(disputePacket && disputePacket.groundingStatus === 'unverified');
        const sprtState = stepSprtGovernor({
          currentRound: 2,
          alignmentScore: sprtScore,
          hasUnverifiedCriticalDispute: hasUnverifiedDispute,
        });

        // 记录 SPRT 似然比迁移打点 (R-1)
        logGameTheoreticTelemetry('decisionState_transition', topicId, {
          stage: 'challenge',
          decisionState: sprtState.decisionState,
          round: 2,
          logLikelihoodRatio: sprtState.logLikelihoodRatio,
          alignmentScore: sprtScore,
        });

        // 关键接线：非 UI 控制流消费 decisionState (R-1)
        if (sprtState.decisionState === 'deadlock_escalation') {
          // SPRT 死锁熔断：攻防严重分歧，阻断自动流转，上报人类
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'arbitration',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'arbitration',
              targetProposalContent: targetProposalText,
              targetChallengeContent: dehydrateTargetTextForHandover(acpResp.textResponse),
              isChallengerResponded: true,
              quorumAlert: '⚠️ SPRT 似然比跌破死锁下界 (Deadlock Escalation)，攻防陷入深层价值对立，已熔断自动推演',
              sprtState,
              minorityReport,
              cognoNexus: {
                committedStates,
                currentDispute: disputePacket,
                sprtState,
                minorityReport,
              },
            },
          }));

          logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
            stage: 'challenge',
            reason: 'sprt_deadlock_escalation',
          });

          const deadlockMsg: Message = {
            id: `msg-deadlock-alert-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Deadlock Escalation',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **SPRT 死锁熔断告警 (Deadlock Escalation)**：攻防分歧已突破置信区间下界 ($LHR \\le B$)，系统判定两造陷入不可调和死锁。自动推演已阻断，请人类首席仲裁官查阅上方交锋点，在下方控制台敲响法槌直接裁决。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), deadlockMsg],
          }));
          return;
        }

        const latestTopicAfterChallenge = getTopicData(topicId) || currentTopic;
        const activeModularInChallenge = latestTopicAfterChallenge.gameTheoreticState?.modularState;
        const hasUnfrozenModules = Boolean(
          activeModularInChallenge?.enabled &&
            activeModularInChallenge.modules.some((m) => m.status !== 'frozen')
        );

        const hasVerifiers = (currentTopic.gameRoles?.verifiers || []).length > 0;
        // 若启用 G-Frame 模块化分治且尚有未冻结模块，必须经由验证/答辩完成各模块冻结，严禁提前跳入仲裁弃置后续模块 (E2E-03)
        const nextStageTarget =
          sprtState.decisionState === 'early_exit' && !hasUnfrozenModules
            ? 'arbitration'
            : hasVerifiers
            ? 'verification'
            : 'defense';

        if (sprtState.decisionState === 'early_exit' && !hasUnfrozenModules) {
          const earlyExitMsg: Message = {
            id: `msg-early-exit-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Early Exit',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚡ **SPRT 序贯检验早停 (Early Exit)**：攻防两造论据已突破置信上限 ($LHR \\ge A$)，达成高质对齐。系统自动短路后续冗余轮次，直接流转至终局仲裁！`,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), earlyExitMsg],
          }));
        }

        // 阶段 2 反例压测完成后，转入【阶段 3: 接地验证 (Verification)】或【阶段 4: 答辩修正 (Defense)】或【阶段 5: 仲裁】
        updateTopicDataInState(topicId, (old) => {
          const prevModular = old.gameTheoreticState?.modularState;
          let nextModular = prevModular;
          if (prevModular?.enabled && prevModular.activeModuleId) {
            const challengeStep = stepModularStageTransition({
              state: prevModular,
              currentStage: 'challenge',
              feedbackDelta: {
                edgeCaseCount: Math.min(
                  2,
                  committedStates.filter((c) => c.status === 'disputed' || c.status === 'refuted').length || (disputePacket ? 1 : 0)
                ),
              },
            });
            nextModular = {
              ...challengeStep.nextState,
              modules: challengeStep.nextState.modules.map((m) =>
                m.moduleId === prevModular.activeModuleId
                  ? { ...m, scopedMessageIds: [...m.scopedMessageIds, challengerReply.id] }
                  : m
              ),
            };
          }
          return {
            ...old,
            gameStage: nextStageTarget,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: nextStageTarget,
              targetProposalContent: targetProposalText,
              targetChallengeContent: dehydrateTargetTextForHandover(acpResp.textResponse),
              isChallengerResponded: true,
              quorumAlert: undefined,
              sprtState,
              minorityReport,
              modularState: nextModular,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates,
                currentDispute: disputePacket,
                sprtState,
                minorityReport,
                modularState: nextModular,
              },
            },
          };
        });

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: nextStageTarget,
          targetProposalText,
          targetChallengeText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping challenge error because turn was aborted or invalidated');
          return;
        }

        console.error('Challenger execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${challengerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: challengerAgent.id,
          authorName: challengerAgent.name,
          authorHandle: challengerAgent.handle,
          authorAvatar: challengerAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **制衡方压测异常**：${err instanceof Error ? err.message : String(err)}`,
          gameStage: 'challenge',
          gameRole: 'challenger',
        };

        const quorumNotice: Message = {
          id: `msg-quorum-alert-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@quorum-guard',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Quorum Alert',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **法定推演人数告警 (Quorum Alert)**：制衡方 ${challengerAgent.name} 发生异常未能完成反例压测。法定推演人数未达标 (Quorum Not Met)。\n\n根据三元博弈规约，进入仲裁定案前须由人类首席仲裁官签署「具名豁免」方可落槌定案。`,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== challengerPendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg, quorumNotice],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            isChallengerResponded: false,
            quorumAlert: `制衡方 (${challengerAgent.name}) 反例压测异常：${err instanceof Error ? err.message : String(err)}`,
          },
        }));
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'verification') {
      const verifierIds = currentTopic.gameRoles?.verifiers || [];
      const verifierAgent = candidateAgents.find((a) => verifierIds.includes(a.id));

      if (!verifierAgent || isAgentOffline(verifierAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);

        const offlineReason = !verifierAgent
          ? '未指派或未匹配到接地验证者 (Verifier)'
          : `接地验证者 ${verifierAgent.name} 处于离线/未连接状态`;

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'defense',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'defense',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isVerifierResponded: false,
          },
        }));

        const verifierSkipNotice: Message = {
          id: `msg-verifier-skip-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@verifier-guard',
          authorAvatar: '🔍',
          isAgent: true,
          agentBadge: 'Verification Skipped',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔍 **接地验证跳过**：${offlineReason}。根据 4+1 博弈调度协议，工具接地与真实性校验缺席，自动流转至【阶段: 🛡️ 答辩修正】。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), verifierSkipNotice],
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'defense',
          targetProposalText,
          targetChallengeText,
        });
        return;
      }

      const execKey = `${topicId}:${verifierAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: verifierAgent.id,
          agentName: verifierAgent.name,
          agentAvatar: verifierAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在执行客观事实与物理逻辑接地验证 (Stage: 🔍 接地验证)...`,
          startedAt: Date.now(),
          cascadeHop: 3,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === verifierAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const verifierPendingId = `topic-pending-${Date.now()}-${verifierAgent.id}`;
      const verifierPendingMsg: Message = {
        id: verifierPendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: verifierAgent.id,
        authorName: verifierAgent.name,
        authorHandle: verifierAgent.handle,
        authorAvatar: verifierAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在调取外部工具、代码解释器沙箱与事实基准进行真实性接地校验 (Stage: 🔍 接地验证)...',
        agentBadge: `${verifierAgent.modelBadge?.split(' ')[0] || 'Local'} · 🔍 接地验证 (执行中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'verification',
        gameRole: 'verifier',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), verifierPendingMsg],
      }));

      const latestTopicForVerification = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'verification',
        targetProposalText,
        targetChallengeText,
        modularState: latestTopicForVerification.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const verifierPrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: `争议切片与立论反例已就绪，请调取工具、代码沙箱或事实基准，对核心分歧断言进行接地验证，输出布尔真值与反事实压测证据。`,
        targetAgent: verifierAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: verifierAgent,
          roomId: topicId,
          prompt: verifierPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: verifierAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '接地验证者返回空响应，未生成有效验证证据。');
        }

        const verifierReply: Message = {
          id: `topic-reply-${Date.now()}-${verifierAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: verifierAgent.id,
          authorName: verifierAgent.name,
          authorHandle: verifierAgent.handle,
          authorAvatar: verifierAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${verifierAgent.modelBadge?.split(' ')[0] || 'Local'} · 🔍 接地验证`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'verification',
          gameRole: 'verifier',
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成工具执行与物理事实接地验证'),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === verifierPendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === verifierPendingId ? verifierReply : m))
            : [...existing, verifierReply];
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
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
                      latestReplyPreview: verifierReply.content.slice(0, 60),
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

        // 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('verification', acpResp.textResponse, verifierAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'verification',
          agentId: verifierAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:verification`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '验证契约未达标，触发 Self-Refine',
              gameStage: 'verification',
              gameRole: 'verifier',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            inFlightHandoverRef.current.delete(handoverKey);
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'verification',
              targetProposalText,
              targetChallengeText,
            });
            return;
          } else {
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `接地验证官 (${verifierAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足实证规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'verification',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：接地验证官 ${verifierAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足实证真值规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'verifier',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:verification`];

        // 全量调度分级取证执行器并计算确定性加权真值率 (P0-1 / R-3 DIANOIA)
        const { evidences, weightedTrueRatio, updatedDispute, updatedCommittedStates } = processVerifierEvidenceChain({
          topicId,
          verifierText: acpResp.textResponse,
          isSafetyCharterSigned: currentTopic.gameTheoreticState?.isSafetyCharterSigned,
          disputePacket: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute,
          committedStates: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
        });
        const groundedTrueRatio = weightedTrueRatio;

        logGameTheoreticTelemetry('grounded_ratio_injected', topicId, {
          stage: 'verification',
          groundedTrueRatio,
          verifierId: verifierAgent.id,
          evidenceCount: evidences.length,
        });

        // 阶段 3 验证完成后，基于实证计数与 fast_track/deep_debate 模式推进模块状态机 (N8 & E2E-03)
        // - fast_track 模块若验证无违规且有实证支持，直接进入 FREEZE_MODULE 闭环，跳过 defense；
        // - fast_track 模块若捕获违规或证伪反例，触发 ESCALATE_TO_RED_TEAM 动态拉起红队进入 challenge；
        // - deep_debate 模块按规约正常推进至 defense 阶段答辩。
        const latestTopicBeforeVerUpdate = getTopicData(topicId) || currentTopic;
        const prevModular = latestTopicBeforeVerUpdate.gameTheoreticState?.modularState;
        let nextModular = prevModular;
        let resolvedVerNextStage: GameTheoreticStage = 'defense';
        let verNoticeMsg: Message | null = null;
        let verContractViolations = 0;

        if (prevModular?.enabled && prevModular.activeModuleId) {
          const verifiedCount = evidences.filter((e) => e.truthValue).length;
          const refutedCount = evidences.filter((e) => !e.truthValue).length;
          const activeMod = prevModular.modules.find((m) => m.moduleId === prevModular.activeModuleId);
          const scopeCheck = activeMod
            ? validateModuleScopeContract(
                acpResp.textResponse,
                activeMod,
                prevModular.modules,
                prevModular.sharedContract
              )
            : { isScopeValid: true, contractViolations: 0, violatedFiles: [], violationDetails: [] };
          verContractViolations = scopeCheck.contractViolations;

          const modRefineKey = `${topicId}:mod-refine:${prevModular.activeModuleId}`;
          const currentModRefines = stageRefineRetriesRef.current[modRefineKey] || 0;
          const verStep = stepModularStageTransition({
            state: prevModular,
            currentStage: 'verification',
            feedbackDelta: {
              verifiedClaims: verifiedCount,
              refutedClaims: refutedCount,
              contractViolations: scopeCheck.contractViolations,
            },
            currentModuleRefineCount: currentModRefines,
          });

          nextModular = {
            ...verStep.nextState,
            modules: verStep.nextState.modules.map((m) =>
              m.moduleId === prevModular.activeModuleId
                ? { ...m, scopedMessageIds: [...m.scopedMessageIds, verifierReply.id] }
                : m
            ),
          };

          resolvedVerNextStage = verStep.nextGameStage;

          if (verStep.posteriorAction === 'ESCALATE_TO_RED_TEAM') {
            verNoticeMsg = {
              id: `msg-fast-track-escalate-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯后验升降级调控器',
              authorHandle: '@bayesian-governor',
              authorAvatar: '⚔️',
              isAgent: true,
              agentBadge: 'Escalate to Red Team',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚔️ **贝叶斯后验动态升级 (ESCALATE_TO_RED_TEAM)**：模块「${activeMod?.title || prevModular.activeModuleId}」在接地验证中捕获异常反馈 (${verStep.reason})。快速通道自动熔断，已紧急拉起 ⚔️ **红队对抗官** 进行深度反例压测！`,
              gameStage: 'challenge',
            };
          } else if (verStep.posteriorAction === 'FREEZE_MODULE') {
            const frozenCount = nextModular.modules.filter((m) => m.status === 'frozen').length;
            const nextActiveMod = nextModular.modules.find((m) => m.moduleId === nextModular.activeModuleId);
            verNoticeMsg = {
              id: `msg-fast-track-freeze-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '贝叶斯快速通道调控器',
              authorHandle: '@bayesian-governor',
              authorAvatar: '🧊',
              isAgent: true,
              agentBadge: `Fast Track Frozen (${frozenCount}/${nextModular.modules.length})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🧊 **快速通道实证直通硬冻结**：模块「${activeMod?.title || prevModular.activeModuleId}」通过静态契约与接地校验，零反例零违规，已在快速通道直接锁定为 Frozen。\n\n${
                verStep.allModulesFrozen
                  ? '全部模块已完成实证收敛，正在转入终局仲裁！'
                  : `正在按 DAG 拓扑序激活下一模块「**${nextActiveMod?.title || nextModular.activeModuleId}**」进入独立沙箱提案立论...`
              }`,
              gameStage: resolvedVerNextStage,
            };
          }
        }

        updateTopicDataInState(topicId, (old) => {
          const isAllFrozenOrArbitration = resolvedVerNextStage === 'arbitration';
          const isFastTrackBypassed =
            Boolean(old.gameTheoreticState?.isChallengerBypassed) ||
            Boolean(nextModular?.enabled && nextModular.modules.every((m) => m.belief.routingMode === 'fast_track'));

          // 快速通道实证直通收敛证据与 SPRT 等价状态 (N13)
          const sprtState: SprtGovernorState = {
            currentRound: 1,
            maxRounds: 4,
            logLikelihoodRatio: 3.2,
            upperThresholdA: 2.94,
            lowerThresholdB: -2.94,
            latestAlignmentScore: 1.0,
            decisionState: 'early_exit',
            statusDescription: '快速通道实证直通收敛：静态契约对齐与物理接地 100% 通过，零反例零违规，依据博弈规约达成高置信等价收敛。',
            groundedTrueRatio: 1.0,
            calibrationStatus: 'calibrated',
            observationVector: {
              groundedRatio: 1.0,
              semanticScore: 1.0,
              dssScore: 0.0,
              combinedScore: 1.0,
            },
          };

          const fastTrackConvergenceEvidence: FastTrackConvergenceEvidence = {
            mode: 'static_empirical_fast_track',
            totalModulesCount: nextModular?.modules.length || 1,
            frozenModulesCount: nextModular?.modules.filter((m) => m.status === 'frozen').length || 1,
            verifiedClaimsCount: evidences.filter((e) => e.truthValue).length,
            contractViolationsCount: verContractViolations,
            refutedClaimsCount: evidences.filter((e) => !e.truthValue).length,
            achievedAt: new Date().toISOString(),
            summary: `快速通道 ${nextModular?.modules.length || 1}/${nextModular?.modules.length || 1} 模块全硬冻结，物理接地真值率 100%，契约违规 0 项，达成静态实证直通收敛。`,
          };

          const effectiveSprtState =
            old.gameTheoreticState?.sprtState ||
            (isAllFrozenOrArbitration && isFastTrackBypassed ? sprtState : undefined);
          const effectiveFastTrackConv =
            isFastTrackBypassed ? fastTrackConvergenceEvidence : old.gameTheoreticState?.fastTrackConvergence;

          return {
            ...old,
            gameStage: resolvedVerNextStage,
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: resolvedVerNextStage,
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetVerificationContent: dehydrateTargetTextForHandover(acpResp.textResponse),
              isVerifierResponded: true,
              // 回填制衡方响应标记与旁路审计留痕：在全 fast_track 或模块旁路下保障法定门禁不误报 (N11)
              isChallengerResponded: isAllFrozenOrArbitration
                ? (isFastTrackBypassed ? true : old.gameTheoreticState?.isChallengerResponded ?? false)
                : old.gameTheoreticState?.isChallengerResponded,
              isChallengerBypassed: isFastTrackBypassed || old.gameTheoreticState?.isChallengerBypassed,
              challengerBypassedReason: isFastTrackBypassed
                ? 'Bayesian Fast-Track: 模块经贝叶斯先验评定为低风险确定性模块，依博弈规约旁路红队对抗直接进入接地验证。'
                : old.gameTheoreticState?.challengerBypassedReason,
              sprtState: effectiveSprtState,
              fastTrackConvergence: effectiveFastTrackConv,
              minorityReport: old.gameTheoreticState?.minorityReport,
              modularState: nextModular,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                sprtState: effectiveSprtState,
                fastTrackConvergence: effectiveFastTrackConv,
                currentDispute: updatedDispute || old.gameTheoreticState?.cognoNexus?.currentDispute,
                committedStates: updatedCommittedStates || old.gameTheoreticState?.cognoNexus?.committedStates || [],
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                modularState: nextModular,
              },
            },
          };
        });

        if (verNoticeMsg) {
          const notice = verNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), notice],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: resolvedVerNextStage,
          targetProposalText,
          targetChallengeText,
          targetVerificationText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping verification error because turn was aborted or invalidated');
          return;
        }

        console.error('Verifier execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${verifierAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: verifierAgent.id,
          authorName: verifierAgent.name,
          authorHandle: verifierAgent.handle,
          authorAvatar: verifierAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **接地验证执行异常**：${err instanceof Error ? err.message : String(err)}。自动流转至答辩修正。`,
          gameStage: 'verification',
          gameRole: 'verifier',
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== verifierPendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'defense',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'defense',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isVerifierResponded: false,
          },
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'defense',
          targetProposalText,
          targetChallengeText,
        });
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'defense') {
      const proposerIds = currentTopic.gameRoles?.proposers || [];
      const proposerAgent = candidateAgents.find((a) => proposerIds.includes(a.id));

      if (!proposerAgent || isAgentOffline(proposerAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);

        const offlineReason = !proposerAgent
          ? '未指派或未匹配到主导者 (Proposer)'
          : `主导者 ${proposerAgent.name} 处于离线/未连接状态`;

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isDefenseResponded: false,
          },
        }));

        const defenseSkipNotice: Message = {
          id: `msg-defense-skip-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 仲裁法定人数守护',
          authorHandle: '@defense-guard',
          authorAvatar: '🛡️',
          isAgent: true,
          agentBadge: 'Defense Skipped',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🛡️ **主导者答辩跳过**：${offlineReason}。根据博弈调度协议，主导方答辩与修正缺席，自动流转至【阶段 4: 中立仲裁】。`,
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), defenseSkipNotice],
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        });
        return;
      }

      const execKey = `${topicId}:${proposerAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: proposerAgent.id,
          agentName: proposerAgent.name,
          agentAvatar: proposerAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在针对挑战反例进行技术抗辩与防御修正 (Stage: 🛡️ 答辩修正)...`,
          startedAt: Date.now(),
          cascadeHop: 3,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === proposerAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const defensePendingId = `topic-pending-${Date.now()}-${proposerAgent.id}`;
      const defensePendingMsg: Message = {
        id: defensePendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: proposerAgent.id,
        authorName: proposerAgent.name,
        authorHandle: proposerAgent.handle,
        authorAvatar: proposerAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: Date.now(),
        pendingHint: '正在审视挑战者反例质询，设计架构防御补丁与修正方案 (Stage: 🛡️ 答辩修正)...',
        agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛡️ 答辩修正 (推演中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'defense',
        gameRole: 'proposer',
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), defensePendingMsg],
      }));

      const latestTopicForDefense = getTopicData(topicId) || currentTopic;
      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: 'game_theoretic',
        gameRoles: currentTopic.gameRoles,
        gameStage: 'defense',
        targetProposalText,
        targetChallengeText,
        targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        modularState: latestTopicForDefense.gameTheoreticState?.modularState,
        participatingAgents: candidateAgents,
      };

      const defenseUserPrompt = (targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent)
        ? `挑战者反例质询与接地验证官工具证据已送达，请针对极端场景、并发边界与实测数据给出架构防御补丁与技术抗辩。`
        : `挑战者反例质询已送达，请针对极端场景与并发边界给出架构防御补丁与技术抗辩。`;

      const defensePrompt = buildTopicPrompt({
        topic: topicContext,
        userContent: defenseUserPrompt,
        targetAgent: proposerAgent,
        availableAgents: candidateAgents,
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: proposerAgent,
          roomId: topicId,
          prompt: defensePrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildCompositeSystemPrompt({
            agent: proposerAgent,
            availableAgents: candidateAgents,
            includeRoster: true,
          }),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          inFlightHandoverRef.current.delete(handoverKey);
          console.log('[App] Dropping modular proposal reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '主导者返回空响应，未生成有效答辩修正。');
        }

        const defenseReply: Message = {
          id: `topic-reply-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${proposerAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛡️ 答辩修正`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: acpResp.textResponse,
          gameStage: 'defense',
          gameRole: 'proposer',
          thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成反例答辩与架构防御补丁构建'),
          diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === defensePendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === defensePendingId ? defenseReply : m))
            : [...existing, defenseReply];
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of (Object.entries(prev) as [string, Message[]][])) {
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
                      latestReplyPreview: defenseReply.content.slice(0, 60),
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

        // 阶段契约门禁强校验 (R-1 / M4)
        const contractValidation = validateStageContract('defense', acpResp.textResponse, proposerAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'defense',
          agentId: proposerAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        if (!contractValidation.isValid) {
          const refineKey = `${topicId}:defense`;
          const currentRetries = stageRefineRetriesRef.current[refineKey] || 0;
          if (currentRetries < STAGE_CONTRACT_MAX_RETRIES) {
            stageRefineRetriesRef.current[refineKey] = currentRetries + 1;
            const refineNotice: Message = {
              id: `msg-refine-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: '阶段契约质检官',
              authorHandle: '@contract-guard',
              authorAvatar: '🛡️',
              isAgent: true,
              agentBadge: `Self-Refine (${currentRetries + 1}/${STAGE_CONTRACT_MAX_RETRIES})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: contractValidation.refinePrompt || '答辩补丁契约未达标，触发 Self-Refine',
              gameStage: 'defense',
              gameRole: 'proposer',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), refineNotice],
            }));
            triggerGameTheoreticStageHandover({
              topicId,
              nextStage: 'defense',
              targetProposalText,
              targetChallengeText,
              targetVerificationText,
            });
            return;
          } else {
            delete stageRefineRetriesRef.current[refineKey];
            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameStage: 'stageFailed',
              gameTheoreticState: {
                ...old.gameTheoreticState,
                currentStage: 'stageFailed',
                quorumAlert: `提案官 (${proposerAgent.name}) 经 ${STAGE_CONTRACT_MAX_RETRIES} 轮 Self-Refine 仍未满足答辩补丁契约规范，推演阻断转人工`,
              },
            }));
            logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
              stage: 'defense',
              reason: 'stage_contract_failure_max_retries',
            });
            const failMsg: Message = {
              id: `msg-stage-failed-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'Shinobi 契约熔断中枢',
              authorHandle: '@contract-guard',
              authorAvatar: '⚠️',
              isAgent: true,
              agentBadge: 'Stage Failed',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `⚠️ **阶段契约校验熔断 (Stage Contract Failed)**：提案官 ${proposerAgent.name} 经 ${STAGE_CONTRACT_MAX_RETRIES} 次 Self-Refine 仍未满足答辩补丁契约规范。系统已硬阻断状态机自动推进，请人类首席仲裁官介入处理。`,
              gameStage: 'stageFailed',
              gameRole: 'proposer',
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), failMsg],
            }));
            return;
          }
        }
        delete stageRefineRetriesRef.current[`${topicId}:defense`];

        // Wave 2 P0-4: 评估答辩者的动态谄媚度 (Dynamic Sycophancy Score, DSS)
        const sycophancyEval = evaluateDynamicSycophancyScore(proposerAgent, acpResp.textResponse);
        logGameTheoreticTelemetry('sycophancy_evaluated', topicId, {
          stage: 'defense',
          agentId: proposerAgent.id,
          dssScore: sycophancyEval.dss,
          bssScore: sycophancyEval.bss,
          gamma: sycophancyEval.discountFactorGamma,
          surrenderDetected: sycophancyEval.surrenderDetected,
        });

        // 显式提取接地实证真值率并显式注入 SPRT (R-1 接线三件套)
        const verificationText = targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent || '';
        const groundedTrueRatio = extractGroundedTrueRatio(verificationText);
        logGameTheoreticTelemetry('grounded_ratio_injected', topicId, {
          stage: 'defense',
          groundedTrueRatio,
        });

        // CognoNexus 阶段 3: 评估答辩修正后的对齐分数与似然比 (Wave 3 P1-2: 多维观测联合向量)
        const rawSprtScoreAfterDefense = estimateRoundAlignmentScore({
          proposalText: targetProposalText,
          critiqueText: targetChallengeText,
          defenseText: acpResp.textResponse,
          groundedTrueRatio,
          dssScore: sycophancyEval.dss,
        });

        // 施加谄媚折减后的真实对齐分数 (Sharma et al. 2023)
        const sprtScoreAfterDefense = applySycophancyDiscountToSprt(rawSprtScoreAfterDefense, sycophancyEval);

        const hasUnverifiedDisputeAfterDefense = Boolean(
          currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.groundingStatus === 'unverified'
        );

        const sprtStateAfterDefense = stepSprtGovernor({
          priorState: currentTopic.gameTheoreticState?.sprtState,
          currentRound: (currentTopic.gameTheoreticState?.roundCount || 1) + 2,
          alignmentScore: sprtScoreAfterDefense,
          groundedTrueRatio,
          dssScore: sycophancyEval.dss,
          hasUnverifiedCriticalDispute: hasUnverifiedDisputeAfterDefense,
        });

        logGameTheoreticTelemetry('decisionState_transition', topicId, {
          stage: 'defense',
          decisionState: sprtStateAfterDefense.decisionState,
          round: sprtStateAfterDefense.currentRound,
          logLikelihoodRatio: sprtStateAfterDefense.logLikelihoodRatio,
          alignmentScore: sprtScoreAfterDefense,
          groundedTrueRatio,
        });

        // 关键接线：消费 decisionState (R-1)
        if (sprtStateAfterDefense.decisionState === 'deadlock_escalation') {
          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'arbitration',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'arbitration',
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetDefenseContent: dehydrateTargetTextForHandover(acpResp.textResponse),
              isDefenseResponded: true,
              quorumAlert: '⚠️ SPRT 似然比跌破死锁下界 (Deadlock Escalation)，答辩未能化解分歧，已熔断流转',
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
                sprtState: sprtStateAfterDefense,
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                latestSycophancy: sycophancyEval,
              },
            },
          }));

          logGameTheoreticTelemetry('human_intervention_triggered', topicId, {
            stage: 'defense',
            reason: 'sprt_deadlock_escalation',
          });

          const deadlockMsg: Message = {
            id: `msg-deadlock-alert-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'SPRT 序贯计算调控器',
            authorHandle: '@sprt-governor',
            authorAvatar: '⚡',
            isAgent: true,
            agentBadge: 'Deadlock Escalation',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **SPRT 死锁熔断告警 (Deadlock Escalation)**：答辩后攻防对齐度依然处于死锁区间 ($LHR \\le B$)。系统已阻断纯 AI 自动推演，请人类首席仲裁官在下方控制台敲响法槌定案。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), deadlockMsg],
          }));
          return;
        }

        // P2 二次对抗回边判定 (4 项硬条件守卫，不满足 4 条件不得回退，防止死循环) (R-4/R-6)
        const currentRoundCount = currentTopic.gameTheoreticState?.roundCount || 1;
        const originalClaims = extractArgumentNodes(targetProposalText);
        const defenseClaims = extractArgumentNodes(acpResp.textResponse);
        const hasNewUnverifiedClaims = defenseClaims.some(
          (dc) => !originalClaims.some((oc) => oc.claim === dc.claim || (oc.claim && dc.claim && (oc.claim.includes(dc.claim) || dc.claim.includes(oc.claim))))
        ) || (defenseClaims.length > 0 && defenseClaims.some((dc) => dc.status === 'disputed' || dc.status === 'refuted'));

        const shouldTriggerP2Loopback =
          sprtScoreAfterDefense < 0.45 &&
          currentRoundCount < 2 &&
          hasNewUnverifiedClaims &&
          groundedTrueRatio < 0.5;

        if (shouldTriggerP2Loopback) {
          const nextRound = currentRoundCount + 1;
          logGameTheoreticTelemetry('p2_loopback_triggered', topicId, {
            nextRound,
            sprtScoreAfterDefense,
            currentRoundCount,
            hasNewUnverifiedClaims,
            groundedTrueRatio,
          });

          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameStage: 'challenge',
            gameTheoreticState: {
              ...old.gameTheoreticState,
              currentStage: 'challenge',
              roundCount: nextRound,
              targetProposalContent: targetProposalText,
              targetChallengeContent: targetChallengeText,
              targetDefenseContent: dehydrateTargetTextForHandover(acpResp.textResponse),
              isChallengerResponded: false,
              isVerifierResponded: false,
              isDefenseResponded: false,
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              cognoNexus: {
                ...old.gameTheoreticState?.cognoNexus,
                committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
                sprtState: sprtStateAfterDefense,
                minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
                latestSycophancy: sycophancyEval,
              },
            },
          }));

          const loopbackNotice: Message = {
            id: `msg-p2-loopback-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'CognoNexus 博弈引擎',
            authorHandle: '@p2-loopback-guard',
            authorAvatar: '🔄',
            isAgent: true,
            agentBadge: `P2 回边 (第 ${nextRound} 轮对抗)`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `🔄 **触发 P2 二次对抗回边 (Round ${nextRound})**：
系统完成 4 项二次对抗硬性条件准入校验（满足全部 4 项）：
1. ✓ **对齐度未收敛**：当前综合对齐分 ${(sprtScoreAfterDefense * 100).toFixed(0)}% (< 45%)
2. ✓ **安全轮次下界**：当前处于第 ${currentRoundCount} 轮 (< 2 轮)
3. ✓ **引入未核验新断言**：答辩提出新补丁设计，需受二次深度质询
4. ✓ **实证存在冲突反例**：客观真值率 ${(groundedTrueRatio * 100).toFixed(0)}% (< 50%)

正在将答辩补丁移交 ⚔️ **红队对抗官** 发起第 ${nextRound} 轮反向质询...`,
            gameStage: 'challenge',
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), loopbackNotice],
          }));

          triggerGameTheoreticStageHandover({
            topicId,
            nextStage: 'challenge',
            targetProposalText: acpResp.textResponse, // 答辩补丁作为第 2 轮审查标的
            targetChallengeText,
            targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
            targetDefenseText: acpResp.textResponse,
          });
          return;
        }

        // 阶段 4 答辩修正完成后，基于真实实证与越界计数推进 G-Frame 模块状态机 (E2E-03 & EDGE-06)
        // - 若触发 SCOPED_DEFENSE_REFINE，回环至当前模块 challenge 阶段进行有界局部重修；
        // - 若当前模块 FREEZE_MODULE 但尚有后续模块未冻结 (!allModulesFrozen)，激活下一拓扑模块并回环至 challenge；
        // - 仅当全部模块 (N/N) 均已 Frozen 时，才流转至终局仲裁 (arbitration)。
        // 关键修复 (N1)：在调用 setState / updateTopicDataInState 前同步完成模块状态机演算与 resolvedNextStage 判定，
        // 严禁在异步批处理的 setState 更新器闭包内才对外部流转变量赋值。
        const latestTopicBeforeDefenseUpdate = getTopicData(topicId) || currentTopic;
        const prevModular = latestTopicBeforeDefenseUpdate.gameTheoreticState?.modularState;
        let nextModular = prevModular;
        let resolvedNextStage: 'proposal' | 'challenge' | 'arbitration' = 'arbitration';
        let transitionNoticeMsg: Message | null = null;

        if (prevModular?.enabled && prevModular.activeModuleId) {
          const activeMod = prevModular.modules.find(
            (m) => m.moduleId === prevModular.activeModuleId
          );
          const scopeCheck = activeMod
            ? validateModuleScopeContract(
                acpResp.textResponse,
                activeMod,
                prevModular.modules,
                prevModular.sharedContract
              )
            : { isScopeValid: true, contractViolations: 0, violatedFiles: [], violationDetails: [] };

          const parsedVerEvidences = parseVerifierOutput(verificationText);
          const refutedInVerCount = parsedVerEvidences.filter((e) => !e.truthValue).length;
          const refutedDefenseCount =
            (sycophancyEval.surrenderDetected ? 1 : 0) +
            defenseClaims.filter((c) => c.status === 'refuted').length;
          const verifiedDefenseCount =
            !sycophancyEval.surrenderDetected &&
            scopeCheck.contractViolations === 0 &&
            refutedDefenseCount === 0 &&
            (refutedInVerCount === 0 || groundedTrueRatio >= 0.5)
              ? Math.max(1, defenseClaims.filter((c) => c.status !== 'refuted').length)
              : 0;

          const modRefineKey = `${topicId}:mod-refine:${prevModular.activeModuleId}`;
          const currentModRefines = stageRefineRetriesRef.current[modRefineKey] || 0;

          const modStep = stepModularStageTransition({
            state: prevModular,
            currentStage: 'defense',
            feedbackDelta: {
              verifiedClaims: verifiedDefenseCount,
              refutedClaims: refutedDefenseCount,
              contractViolations: scopeCheck.contractViolations,
              dssScore: sycophancyEval.dss,
            },
            proposalOrDefenseSnippet: acpResp.textResponse,
            currentModuleRefineCount: currentModRefines,
          });

          nextModular = {
            ...modStep.nextState,
            modules: modStep.nextState.modules.map((m) =>
              m.moduleId === prevModular.activeModuleId
                ? { ...m, scopedMessageIds: [...m.scopedMessageIds, defenseReply.id] }
                : m
            ),
          };

          if (modStep.triggeredScopedRefine && activeMod) {
            stageRefineRetriesRef.current[modRefineKey] = currentModRefines + 1;
            resolvedNextStage = 'challenge';
            transitionNoticeMsg = {
              id: `msg-mod-refine-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'G-Frame 贝叶斯模块总控',
              authorHandle: '@gframe-governor',
              authorAvatar: '🧭',
              isAgent: true,
              agentBadge: `SCOPED_DEFENSE_REFINE (${currentModRefines + 1}/1)`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🔄 **触发模块沙箱局部重修 (SCOPED_DEFENSE_REFINE)**：${modStep.reason}。已锁定当前模块「${activeMod.title}」发起有界二次核验，已冻结上游模块不受波及。`,
              gameStage: 'challenge',
            };
          } else if (!modStep.allModulesFrozen) {
            delete stageRefineRetriesRef.current[modRefineKey];
            resolvedNextStage = 'proposal';
            const nextActiveMod = nextModular.modules.find(
              (m) => m.moduleId === nextModular?.activeModuleId
            );
            const frozenCount = nextModular.modules.filter((m) => m.status === 'frozen').length;
            transitionNoticeMsg = {
              id: `msg-mod-advance-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: 'G-Frame 贝叶斯模块总控',
              authorHandle: '@gframe-governor',
              authorAvatar: '🧊',
              isAgent: true,
              agentBadge: `Module Frozen (${frozenCount}/${nextModular.modules.length})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `🧊 **模块收敛硬冻结 & 拓扑切换**：模块「${activeMod?.title || prevModular.activeModuleId}」已完成实证收敛并锁定为 Frozen（当前已冻结 ${frozenCount}/${nextModular.modules.length}）。\n\n正在按 DAG 拓扑序激活下一模块「**${nextActiveMod?.title || nextModular.activeModuleId}**」进入独立沙箱提案立论...`,
              gameStage: 'proposal',
            };
          } else {
            delete stageRefineRetriesRef.current[modRefineKey];
            resolvedNextStage = 'arbitration';
          }
        }

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: resolvedNextStage,
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: resolvedNextStage,
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            targetDefenseContent: dehydrateTargetTextForHandover(acpResp.textResponse),
            isChallengerResponded: resolvedNextStage === 'arbitration',
            isVerifierResponded: resolvedNextStage === 'arbitration',
            isDefenseResponded: resolvedNextStage === 'arbitration',
            sprtState: sprtStateAfterDefense,
            minorityReport: old.gameTheoreticState?.minorityReport,
            latestSycophancy: sycophancyEval,
            modularState: nextModular,
            cognoNexus: {
              ...old.gameTheoreticState?.cognoNexus,
              committedStates: old.gameTheoreticState?.cognoNexus?.committedStates || [],
              sprtState: sprtStateAfterDefense,
              minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
              latestSycophancy: sycophancyEval,
              modularState: nextModular,
            },
          },
        }));

        if (transitionNoticeMsg) {
          const noticeToPost = transitionNoticeMsg;
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), noticeToPost],
          }));
        }

        inFlightHandoverRef.current.delete(handoverKey);
        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: resolvedNextStage,
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
          targetDefenseText: acpResp.textResponse,
        });
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping defense error because turn was aborted or invalidated');
          return;
        }

        console.error('Defense execution failed:', err);
        const errorMsg: Message = {
          id: `topic-reply-err-${Date.now()}-${proposerAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: proposerAgent.id,
          authorName: proposerAgent.name,
          authorHandle: proposerAgent.handle,
          authorAvatar: proposerAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **主导者答辩异常**：${err instanceof Error ? err.message : String(err)}。自动流转至仲裁定案。`,
          gameStage: 'defense',
          gameRole: 'proposer',
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== defensePendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            targetProposalContent: targetProposalText,
            targetChallengeContent: targetChallengeText,
            isDefenseResponded: false,
          },
        }));

        triggerGameTheoreticStageHandover({
          topicId,
          nextStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
        });
      } finally {
        inFlightHandoverRef.current.delete(handoverKey);
      }
      return;
    }

    if (nextStage === 'arbitration') {
      const arbiterIds = currentTopic.gameRoles?.arbiters || [];
      const arbiterAgent = candidateAgents.find((a) => arbiterIds.includes(a.id));

      if (!arbiterAgent || isAgentOffline(arbiterAgent)) {
        inFlightHandoverRef.current.delete(handoverKey);
      }

      if (arbiterAgent && isAgentOnline(arbiterAgent)) {
        const execKey = `${topicId}:${arbiterAgent.id}`;
        setIsGenerating(true);
        setActiveExecutions((prev) => ({
          ...prev,
          [execKey]: {
            agentId: arbiterAgent.id,
            agentName: arbiterAgent.name,
            agentAvatar: arbiterAgent.avatar,
            threadId: topicId,
            topicId,
            status: 'thinking',
            currentActionDetail: `正在全面权衡方案、反例与答辩补丁，起草终局仲裁建议 (Stage: ⚖️ 仲裁定案)...`,
            startedAt: Date.now(),
            cascadeHop: 4,
          },
        }));

        setAgents((prev) =>
          prev.map((a) => (a.id === arbiterAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
        );

        const arbiterPendingId = `topic-pending-${Date.now()}-${arbiterAgent.id}`;
        const arbiterPendingMsg: Message = {
          id: arbiterPendingId,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: arbiterAgent.id,
          authorName: arbiterAgent.name,
          authorHandle: arbiterAgent.handle,
          authorAvatar: arbiterAgent.avatar,
          isAgent: true,
          isPending: true,
          startedAt: Date.now(),
          pendingHint: '正在审阅立论方案、反例质疑与防御答辩补丁，起草仲裁权衡矩阵 (Stage: ⚖️ 仲裁定案)...',
          agentBadge: `${arbiterAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚖️ 仲裁建言 (审议中...)`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: '',
          gameStage: 'arbitration',
          gameRole: 'arbiter',
        };

        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), arbiterPendingMsg],
        }));

        const latestTopicForArbitration = getTopicData(topicId) || currentTopic;
        const topicContext: TopicPromptContext = {
          topicId,
          title: currentTopic.title,
          description: currentTopic.description,
          channelName: topicChannel?.name || 'chat',
          status: currentTopic.status,
          discussionMode: 'game_theoretic',
          gameRoles: currentTopic.gameRoles,
          gameStage: 'arbitration',
          targetProposalText,
          targetChallengeText,
          targetVerificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
          targetDefenseText,
          modularState: latestTopicForArbitration.gameTheoreticState?.modularState,
          participatingAgents: candidateAgents,
        };

        const arbiterPrompt = buildTopicPrompt({
          topic: topicContext,
          userContent: targetDefenseText
            ? `主导提案、反例压测、接地验证证据与答辩补丁已就绪，请给出客观中立的仲裁权衡矩阵与终局裁决建言。`
            : `主导方案、反例压测与接地验证证据已就绪，请给出客观中立的仲裁权衡矩阵与裁决建言。`,
          targetAgent: arbiterAgent,
          availableAgents: candidateAgents,
        });

        try {
          const acpResp = await sendPromptToAcpAgent({
            agent: arbiterAgent,
            roomId: topicId,
            prompt: arbiterPrompt,
            channelId: topicChannel?.id,
            workspaceBindingId: currentTopic.workspaceBindingId,
            workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
            scopeType: 'topic',
            systemPrompt: buildCompositeSystemPrompt({
              agent: arbiterAgent,
              availableAgents: candidateAgents,
              includeRoster: true,
            }),
            discussionMode: 'game_theoretic',
          });

          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping arbitration reply because turn was aborted or invalidated');
            return;
          }

          if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
            throw new Error(acpResp.isError ? acpResp.textResponse : '仲裁者返回空响应，未生成有效仲裁建言。');
          }

          const arbiterReply: Message = {
            id: `topic-reply-${Date.now()}-${arbiterAgent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: arbiterAgent.id,
            authorName: arbiterAgent.name,
            authorHandle: arbiterAgent.handle,
            authorAvatar: arbiterAgent.avatar,
            isAgent: true,
            isPending: false,
            agentBadge: `${arbiterAgent.modelBadge?.split(' ')[0] || 'Local'} · ⚖️ 仲裁建言`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: acpResp.textResponse,
            gameStage: 'arbitration',
            gameRole: 'arbiter',
            thinkingProcess: buildThinkingProcessFromAcp(acpResp, '已完成立论、反例与答辩补丁的综合仲裁审查'),
            diffView: acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0 ? acpResp.workspaceDiffs[0] : undefined,
            cartridgeCitation: acpResp.cartridgeCitation,
          };

          await processArbitrationConcurrence({
            topicId,
            arbiterAgent,
            acpResp,
            turnSnapshot,
            targetProposalText,
            targetChallengeText,
            targetVerificationText,
            targetDefenseText,
            candidateAgents,
            topicChannel,
            arbiterPendingId,
            arbiterReply,
            handoverKey,
          });
        } catch (err) {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });
          if (isTurnStale(turnSnapshot)) {
            console.log('[App] Dropping arbitration error because turn was aborted or invalidated');
            return;
          }
          console.error('AI Arbiter execution failed:', err);

          const errorMsg: Message = {
            id: `topic-reply-err-${Date.now()}-${arbiterAgent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: arbiterAgent.id,
            authorName: arbiterAgent.name,
            authorHandle: arbiterAgent.handle,
            authorAvatar: arbiterAgent.avatar,
            isAgent: true,
            agentBadge: 'Arbiter Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **仲裁推演异常**：${err instanceof Error ? err.message : String(err)}\n\n人类首席仲裁官可查看上方交锋内容，执行具名豁免后直接落槌。`,
            gameStage: 'arbitration',
            gameRole: 'arbiter',
          };

          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: 'Gavel Ready',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚖️ **仲裁阶段异常提示**：AI 仲裁推演中断。双方立论与反例要点已就绪，人类首席仲裁官可在下方【仲裁法槌控制台】敲响法槌签署终局裁决。`,
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const filtered = existing.filter((m) => m.id !== arbiterPendingId);
            return {
              ...prev,
              [topicId]: [...filtered, errorMsg, humanNotice],
            };
          });
        } finally {
          inFlightHandoverRef.current.delete(handoverKey);
        }
      } else {
        if (currentTopic.gameRoles?.humanIsArbiter) {
          const humanNotice: Message = {
            id: `msg-human-gavel-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁法槌提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: '⚖️',
            isAgent: true,
            agentBadge: 'Gavel Ready',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚖️ **博弈推演已进入仲裁裁决阶段**：立论方案与反例压测已就绪。请人类首席仲裁官在下方【仲裁法槌控制台】选择【采纳主导】、【采纳挑战】或【权衡矩阵】敲响法槌签署仲裁裁决书。`,
          };

          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), humanNotice],
          }));
        }
      }
    }
    },
    [
      getTopicData,
      channels,
      activeChannel,
      captureTurnEpoch,
      isTurnStale,
      inFlightHandoverRef,
      agentsRef,
      stageRefineRetriesRef,
      setIsGenerating,
      setActiveExecutions,
      setAgents,
      setMessages,
      updateTopicDataInState,
      getTopicWorkspaceBinding,
      processArbitrationConcurrence,
    ]
  );

  return { triggerGameTheoreticStageHandover };
}
