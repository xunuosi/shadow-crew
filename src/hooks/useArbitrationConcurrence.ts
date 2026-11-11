import { useCallback } from 'react';
import type {
  Agent,
  Channel,
  Message,
  TopicMessageData,
  RulingRecord,
  RoleConcurrenceSubmission,
  ActiveAgentExecution,
  WorkspaceBinding,
} from '../types';
import {
  sendPromptToAcpAgent,
  type AcpAgentResponse,
  extractArbitrationRulingOptionsFromAcpResponse,
  extractRoleConcurrenceFromAcpResponse,
} from '../services/acpClient';
import {
  validateStageContract,
  logGameTheoreticTelemetry,
  generateDeterministicMcdaPayload,
  calculateColMadContributions,
  buildCompositeSystemPrompt,
  buildTopicPrompt,
  type TopicPromptContext,
  type TurnEpochSnapshot,
} from '../services/agentCollaboration';
import {
  computeRoleConcurrenceSolutionDigest,
  prepareConcurrenceState,
  advanceRoleConcurrenceItem,
  checkAllRolesConcurred,
  buildFinalRulingFromConcurrence,
  evaluateRulingGates,
  formatFullDateTime,
} from '../services/cogno';
import { isAgentOnline } from '../utils/agentRuntime';

export interface UseArbitrationConcurrenceParams {
  getTopicData: (topicId: string) => TopicMessageData | null;
  activeTopicData: TopicMessageData | null;
  updateTopicDataInState: (
    topicId: string,
    updater: (oldTopic: TopicMessageData) => TopicMessageData
  ) => void;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  agentsRef: React.MutableRefObject<Agent[]>;
  inFlightHandoverRef: React.MutableRefObject<Set<string>>;
  isTurnStale: (turnSnapshot: TurnEpochSnapshot) => boolean;
  getTopicWorkspaceBinding: (topicId?: string) => WorkspaceBinding | undefined;
  handleResolveTopic: (
    topicId: string,
    decision: {
      solution: string;
      impactedFiles: string[];
      approvers: string[];
      rulingRecord?: RulingRecord;
      executorId?: string;
      autoDispatch?: boolean;
    }
  ) => void;
}

export interface ProcessArbitrationConcurrenceOptions {
  topicId: string;
  arbiterAgent: Agent;
  acpResp: AcpAgentResponse;
  turnSnapshot: TurnEpochSnapshot;
  targetProposalText?: string;
  targetChallengeText?: string;
  targetVerificationText?: string;
  targetDefenseText?: string;
  candidateAgents: Agent[];
  topicChannel?: Channel;
  arbiterPendingId?: string;
  arbiterReply: Message;
  handoverKey?: string;
}

export function useArbitrationConcurrence({
  getTopicData,
  activeTopicData,
  updateTopicDataInState,
  setMessages,
  setIsGenerating,
  setActiveExecutions,
  setAgents,
  agentsRef,
  inFlightHandoverRef,
  isTurnStale,
  getTopicWorkspaceBinding,
  handleResolveTopic,
}: UseArbitrationConcurrenceParams) {
  /**
   * 统一处理综合裁定官发言完毕后的全员无异议核验征询与终局方案敲定闭环
   * 无论是系统 FSM 自动流转 (triggerGameTheoreticStageHandover) 还是用户手动 @点名唤醒仲裁官 (handleSendTopicMessage)，
   * 均严格执行统一的运筹一致性求解、ColMAD、prepareConcurrenceState 及各参研角色异步投票状态机，严禁遗漏任何环节。
   */
  const processArbitrationConcurrence = useCallback(
    async (options: ProcessArbitrationConcurrenceOptions) => {
      const {
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
      } = options;

      const currentTopic = getTopicData(topicId) || activeTopicData;
      if (!currentTopic) return;
      const latestTopicForArbitration = currentTopic;

      try {
        // 契约门禁校验
        const contractValidation = validateStageContract('arbitration', acpResp.textResponse, arbiterAgent.name);
        logGameTheoreticTelemetry('stage_contract_validation', topicId, {
          stage: 'arbitration',
          agentId: arbiterAgent.id,
          isValid: contractValidation.isValid,
          missingRequirements: contractValidation.missingRequirements,
        });

        // 求解确定性运筹决策矩阵并进行一致性硬门禁检验 (R-1 / P0-3 / P0-5 ReConcile 置信度加权)
        const mcdaPayload = generateDeterministicMcdaPayload({
          arbiterText: acpResp.textResponse,
          proposalText: targetProposalText,
          critiqueText: targetChallengeText,
          defenseText: targetDefenseText,
          topicTitle: currentTopic.title,
          topicDescription: currentTopic.description,
          argumentNodes: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
          evidences: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain,
          sycophancy: currentTopic.gameTheoreticState?.latestSycophancy,
          modelDiversity: currentTopic.gameTheoreticState?.modelDiversity,
        });

        logGameTheoreticTelemetry('consistency_gate_evaluation', topicId, {
          passed: mcdaPayload.consistencyPassed,
          consistencyIndex: mcdaPayload.consistencyIndex,
          solverType: mcdaPayload.solverType,
        });

        // 计算 ColMAD 非零和协同事实贡献报表 (Wave 3 P1-3)
        const colMadReport = calculateColMadContributions({
          topicId,
          agents: agentsRef.current.length > 0 ? agentsRef.current : candidateAgents,
          proposalText: targetProposalText,
          critiqueText: targetChallengeText,
          verificationText: targetVerificationText || currentTopic.gameTheoreticState?.targetVerificationContent,
          defenseText: targetDefenseText,
          argumentNodes: currentTopic.gameTheoreticState?.cognoNexus?.committedStates,
          evidences: currentTopic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain,
        });

        // 提取由 Arbiter Agent 通过 submit_arbitration_ruling 工具或结构化契约提交的裁决书草案与 3 种模式预案
        const extractedRulingOptions = extractArbitrationRulingOptionsFromAcpResponse(acpResp, {
          topicTitle: latestTopicForArbitration.title,
          topicDescription: latestTopicForArbitration.description,
          proposalText: targetProposalText || latestTopicForArbitration.gameTheoreticState?.targetProposalContent,
          critiqueText: targetChallengeText || latestTopicForArbitration.gameTheoreticState?.targetChallengeContent,
          defenseText: targetDefenseText || latestTopicForArbitration.gameTheoreticState?.targetDefenseContent,
          verificationText: targetVerificationText || latestTopicForArbitration.gameTheoreticState?.targetVerificationContent,
          mcdaPayload,
          authorName: arbiterAgent.name,
        });
        const extractedRulingDraft = acpResp.rulingDraft || extractedRulingOptions.primaryDraft;
        const concurrenceSolutionDigest = await computeRoleConcurrenceSolutionDigest({
          topic: latestTopicForArbitration,
          arbiterDraft: extractedRulingDraft,
          arbiterReplyText: acpResp.textResponse,
        });

        // 初始化参研角色的全员无异议审视征询状态
        const initialConcurrence = prepareConcurrenceState({
          topic: latestTopicForArbitration,
          candidateAgents,
          arbiterDraft: extractedRulingDraft,
          arbiterReplyText: acpResp.textResponse,
          solutionDigest: concurrenceSolutionDigest,
          arbiterAgentId: arbiterAgent.id,
        });

        // 将求解出的 MCDA 矩阵、ColMAD 报表、裁决草案、3 种模式预案与全员无异议征询状态持久化至议题博弈状态中
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameStage: 'arbitration',
          gameTheoreticState: {
            ...old.gameTheoreticState,
            currentStage: 'arbitration',
            minorityReport: old.gameTheoreticState?.minorityReport,
            mcdaPayload,
            colMadReport,
            rulingDraft: extractedRulingDraft || old.gameTheoreticState?.rulingDraft,
            rulingDraftOptions: extractedRulingOptions.options,
            concurrenceState: initialConcurrence,
            cognoNexus: {
              ...old.gameTheoreticState?.cognoNexus,
              minorityReport: old.gameTheoreticState?.cognoNexus?.minorityReport || old.gameTheoreticState?.minorityReport,
              mcdaPayload,
              colMadReport,
            },
          },
        }));

        const humanNotice: Message = {
          id: `msg-concurrence-notice-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shinobi 综合裁定引擎',
          authorHandle: '@arbiter-gavel',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Concurrence Verification',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🤝 **[全员无异议审视征询已启动]** 综合裁定官已就终局架构方案完成综合权衡并 @ 参研关键角色（提案方、红队对抗方、接地实证方）。平台正在自动调度各角色进行独立专业审视，保证回复无异议后，由综合裁定官正式敲定方案并出具最后的活体决策看板 (Living ADR Canvas)。`,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = arbiterPendingId ? existing.some((m) => m.id === arbiterPendingId) : false;
          const hasReply = existing.some((m) => m.id === arbiterReply.id);
          const baseMsgs = hasPending
            ? existing.map((m) => (m.id === arbiterPendingId ? arbiterReply : m))
            : hasReply
            ? existing
            : [...existing, arbiterReply];
          const nextTopicMsgs = [...baseMsgs, humanNotice];
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
                      latestReplyPreview: arbiterReply.content.slice(0, 60),
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

        // 启动各参研角色的无异议复核确认与终局敲定出具活体看板流程 (同步 await 保持交接锁互斥完整覆盖)
        if (initialConcurrence.items.length > 0) {
          await new Promise((r) => setTimeout(r, 600));
          if (isTurnStale(turnSnapshot)) {
            return;
          }
          let currentConcurrence = initialConcurrence;

          for (const item of initialConcurrence.items) {
            if (isTurnStale(turnSnapshot)) break;
            // 裁定官兼任的角色在裁决书中已内在达成无异议，无需发起自审循环
            if (item.status === 'concurred' || item.agentId === arbiterAgent.id) {
              continue;
            }
            const roleAgent = candidateAgents.find((a) => a.id === item.agentId);
            if (!roleAgent) continue;

            const rolePendingId = `topic-pending-concurrence-${Date.now()}-${roleAgent.id}`;
            const roleRoleLabel = item.role === 'proposer' ? '提案方' : item.role === 'challenger' ? '红队对抗方' : '接地实证方';
            const roleExecKey = `${topicId}:${roleAgent.id}`;

            setIsGenerating(true);
            setActiveExecutions((prev) => ({
              ...prev,
              [roleExecKey]: {
                agentId: roleAgent.id,
                agentName: roleAgent.name,
                agentAvatar: roleAgent.avatar,
                threadId: topicId,
                topicId,
                status: 'thinking',
                currentActionDetail: `正在审视综合裁定官终局方案并核验是否无异议 (Role: ${roleRoleLabel})...`,
                startedAt: Date.now(),
                cascadeHop: 5,
              },
            }));

            setAgents((prev) =>
              prev.map((a) => (a.id === roleAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
            );

            setMessages((prev) => ({
              ...prev,
              [topicId]: [
                ...(prev[topicId] || []),
                {
                  id: rolePendingId,
                  threadId: topicId,
                  channelId: topicChannel?.id,
                  authorId: roleAgent.id,
                  authorName: roleAgent.name,
                  authorHandle: roleAgent.handle,
                  authorAvatar: roleAgent.avatar,
                  isAgent: true,
                  isPending: true,
                  startedAt: Date.now(),
                  pendingHint: `正在审视综合裁定官终局方案，核验是否无异议 (Role: ${roleRoleLabel})...`,
                  agentBadge: `${roleAgent.modelBadge?.split(' ')[0] || 'Local'} · 🤝 无异议核验中...`,
                  timestamp: formatFullDateTime(),
                  content: '',
                  gameStage: 'arbitration',
                  gameRole: item.role,
                },
              ],
            }));

            let roleReplyText = '';
            let roleSubmission: RoleConcurrenceSubmission | undefined;
            let roleValidationError = '';
            let roleUnavailableReason = '';
            const roleNameForVote = (item.role === 'arbiter' ? 'verifier' : item.role) as
              'proposer' | 'challenger' | 'verifier';

            if (!isAgentOnline(roleAgent)) {
              roleUnavailableReason = `智能体 ${roleAgent.name} 当前处于离线状态，无法完成独立结构化投票。`;
              roleReplyText = `⚠️ 【角色不可用 / Agent 离线】${roleUnavailableReason}`;
            } else {
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const topicContextForVote: TopicPromptContext = {
                    topicId,
                    title: currentTopic.title,
                    description: currentTopic.description,
                    channelName: topicChannel?.name || 'chat',
                    status: currentTopic.status,
                    discussionMode: 'game_theoretic',
                    gameRoles: currentTopic.gameRoles,
                    gameStage: 'arbitration',
                    concurrenceVerificationContext: {
                      arbiterName: arbiterAgent.name,
                      arbiterText: acpResp.textResponse,
                      solutionDigest: concurrenceSolutionDigest,
                      validationError: roleValidationError || undefined,
                      roleName: roleNameForVote,
                    },
                  };
                  const rolePrompt = buildTopicPrompt({
                    topic: topicContextForVote,
                    userContent: '请严格按本轮 ROLE_CONCURRENCE 契约提交结构化票据；自然语言不能替代结构化结果。',
                    targetAgent: roleAgent,
                    availableAgents: candidateAgents,
                  });

                  const roleResp = await sendPromptToAcpAgent({
                    agent: roleAgent,
                    roomId: topicId,
                    prompt: rolePrompt,
                    channelId: topicChannel?.id,
                    workspaceBindingId: currentTopic.workspaceBindingId,
                    workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
                    scopeType: 'topic',
                    systemPrompt: buildCompositeSystemPrompt({
                      agent: roleAgent,
                      availableAgents: candidateAgents,
                      includeRoster: true,
                    }),
                    discussionMode: 'game_theoretic',
                  });

                  const extraction = extractRoleConcurrenceFromAcpResponse(roleResp);
                  roleReplyText = extraction.cleanedText;

                  if (roleResp.isError) {
                    roleUnavailableReason = `ACP 返回错误：${roleResp.textResponse || '未知错误'}`;
                    break;
                  }
                  if (roleResp.isEmptyTurn) {
                    roleUnavailableReason = 'ACP 返回空回合，未提供结构化无异议票。';
                    break;
                  }
                  if (extraction.submission) {
                    roleSubmission = extraction.submission;
                    roleValidationError = '';
                    break;
                  }

                  roleValidationError = extraction.error || '未提交合法结构化无异议票';
                  if (attempt === 0) {
                    await new Promise((r) => setTimeout(r, 300));
                  }
                } catch (e) {
                  roleUnavailableReason = `智能体调用异常：${e instanceof Error ? e.message : String(e)}`;
                  break;
                }
              }
            }

            setActiveExecutions((prev) => {
              const next = { ...prev };
              delete next[roleExecKey];
              if (Object.keys(next).length === 0) setIsGenerating(false);
              return next;
            });

            setAgents((prev) =>
              prev.map((a) => (a.id === roleAgent.id ? { ...a, status: 'idle' } : a))
            );

            currentConcurrence = advanceRoleConcurrenceItem(currentConcurrence, roleAgent.id, {
              submission: roleSubmission,
              validationError: roleValidationError || undefined,
              unavailableReason: roleUnavailableReason || undefined,
            });

            const roleStatus = currentConcurrence.items.find((i) => i.agentId === roleAgent.id)?.status;
            const roleStatusBadge = roleStatus === 'concurred'
              ? '🤝 无异议确认'
              : roleStatus === 'conditional'
              ? '⏸️ 条件保留'
              : roleStatus === 'objected'
              ? '❌ 提出异议'
              : roleStatus === 'unavailable'
              ? '⚠️ 角色不可用'
              : '⛔ 结构化票无效';
            const roleMsgBadge = `${roleAgent.modelBadge?.split(' ')[0] || 'Local'} · ${roleStatusBadge}`;
            const roleDisplayContent = [
              roleReplyText || roleSubmission?.rationale || '未收到角色有效回复。',
              roleValidationError ? `\n\n> ⛔ **结构化票无效**：${roleValidationError}` : '',
              roleUnavailableReason ? `\n\n> ⚠️ **角色不可用**：${roleUnavailableReason}` : '',
            ].join('');

            const roleMsg: Message = {
              id: `topic-reply-concurrence-${Date.now()}-${roleAgent.id}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: roleAgent.id,
              authorName: roleAgent.name,
              authorHandle: roleAgent.handle,
              authorAvatar: roleAgent.avatar,
              isAgent: true,
              isPending: false,
              agentBadge: roleMsgBadge,
              timestamp: formatFullDateTime(),
              content: roleDisplayContent,
              gameStage: 'arbitration',
              gameRole: item.role,
            };

            updateTopicDataInState(topicId, (old) => ({
              ...old,
              gameTheoreticState: {
                ...old.gameTheoreticState,
                concurrenceState: currentConcurrence,
              },
            }));

            setMessages((prev) => {
              const existing = prev[topicId] || [];
              return {
                ...prev,
                [topicId]: existing.map((m) => (m.id === rolePendingId ? roleMsg : m)),
              };
            });

            // 轻量延时保障讨论流真实呈现节奏
            await new Promise((r) => setTimeout(r, 400));
          }

          if (isTurnStale(turnSnapshot)) return;
          const freshTopic = getTopicData(topicId) || latestTopicForArbitration;
          if (freshTopic.status === 'resolved') {
            console.log('[GameTheoretic] Topic is already resolved, skipping auto conclusion.');
            return;
          }

          // 当所有角色回复保证无异议后，复核运筹一致性硬门禁与法定人数
          if (checkAllRolesConcurred(currentConcurrence)) {
            const gateEvaluation = evaluateRulingGates(freshTopic, mcdaPayload);

            if (!gateEvaluation.allGatesPassed) {
              const gateNotice: Message = {
                id: `msg-gate-blocked-${Date.now()}`,
                threadId: topicId,
                channelId: topicChannel?.id,
                authorId: 'system',
                authorName: 'Shinobi 裁决一致性硬门禁',
                authorHandle: '@arbiter-gavel',
                authorAvatar: '⚖️',
                isAgent: true,
                agentBadge: 'Gate Blocked',
                timestamp: formatFullDateTime(),
                content: `⚖️ **[全员虽达成无异议，但门禁拦截 (${gateEvaluation.reason || `ξ* = ${mcdaPayload?.consistencyIndex}`})]**\n\n各参研角色已完成无异议审视，但未能通过硬门禁规则（${gateEvaluation.reason}）。根据安全宪章，系统已硬锁定自动定案，请人类首席仲裁官在下方控制台审阅后具名豁免定案。`,
              };
              setMessages((prev) => ({
                ...prev,
                [topicId]: [...(prev[topicId] || []), gateNotice],
              }));
              return;
            }

            const finalRuling = buildFinalRulingFromConcurrence({
              topic: freshTopic,
              arbiterAgent,
              concurrenceState: currentConcurrence,
              extractedDraft: extractedRulingDraft,
              candidateAgents,
            });

            const finalConcludeMsg: Message = {
              id: `msg-concluded-${Date.now()}-${arbiterAgent.id}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: arbiterAgent.id,
              authorName: arbiterAgent.name,
              authorHandle: arbiterAgent.handle,
              authorAvatar: arbiterAgent.avatar,
              isAgent: true,
              agentBadge: '⚖️ 终局敲定 · 活体看板已生成',
              timestamp: formatFullDateTime(),
              content: `🏛️ **【综合裁定官终局方案敲定与活体看板生成 (Living ADR Canvas Concluded)】**\n\n参研关键角色（${currentConcurrence.items.map((i) => `**${i.agentName}**`).join('、')}）已全部完成独立专业审视，并一致明确保证**无异议签署通过**！\n\n综合裁定官正式敲定本议题终局架构方案：\n\n> 💡 **核心决议**: ${finalRuling.summary}\n\n${finalRuling.solution ? `**落地实施要旨**: ${finalRuling.solution}\n\n` : ''}📄 **活体决策看板 (Living ADR Canvas) 已正式出具并固化生成**，包含完整的全员签署链、权衡防线清单与工程落地清单。请查阅抽屉右侧活体看板，系统已就绪，可在看板中人工批准派发落地实施。`,
              gameStage: 'concluded',
              gameRole: 'arbiter',
            };

            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), finalConcludeMsg],
            }));

            // 自动闭环敲定定案（显式指定 autoDispatch: false，严禁未经人类授权自动派发执行代码，责任人由人类在看板显式点击批准指派）
            handleResolveTopic(topicId, {
              solution: finalRuling.solution || finalRuling.summary,
              impactedFiles: finalRuling.impactedFiles || [],
              approvers: [arbiterAgent.name, ...currentConcurrence.items.map((i) => i.agentName)],
              rulingRecord: finalRuling,
              autoDispatch: false,
            });
          } else {
            // 若存在角色阻断异议或角色不可用，挂起定案并发出警示通知
            const pendingOrObjected = currentConcurrence.items.find((i) => i.status !== 'concurred');
            const blockedStatus = pendingOrObjected?.status;
            const isUnavail = blockedStatus === 'unavailable';
            const isConditional = blockedStatus === 'conditional';
            const isInvalid = blockedStatus === 'invalid';
            const blockedBadge = isUnavail
              ? 'Agent Unavailable'
              : isConditional
              ? 'Concurrence Conditional'
              : isInvalid
              ? 'Concurrence Invalid'
              : 'Objection Suspended';
            const blockedContent = isUnavail
              ? `⚠️ **[终局方案敲定已挂起：存在参研角色离线或不可用]**\n\n参研角色 **${pendingOrObjected?.agentName || '参研角色'}** 未能完成实质审视。根据治理契约，严格禁止伪造无异议签署，终局敲定已安全挂起。请恢复 Agent 在线状态后重新复核，或由人类首席仲裁官介入接管。`
              : isConditional
              ? `⏸️ **[终局方案敲定已挂起：存在条件保留票]**\n\n参研角色 **${pendingOrObjected?.agentName || '参研角色'}** 已提交 \`conditional\` 票，前置条件：\n${(pendingOrObjected?.conditions || []).map((condition) => `> • ${condition}`).join('\n') || '> • 未列明条件'}\n\n条件票不计入无异议，系统暂不出具终局活体看板。`
              : isInvalid
              ? `⛔ **[终局方案敲定已挂起：结构化票无效]**\n\n参研角色 **${pendingOrObjected?.agentName || '参研角色'}** 未提交合法结构化票据：\n> ${pendingOrObjected?.validationError || '未提供有效工具载荷或 ROLE_CONCURRENCE 契约块'}\n\n自然语言正文不能替代结构化授权，终局敲定已失败关闭。`
              : `❌ **[终局方案敲定已挂起：未达成全员无异议]**\n\n参研角色 **${pendingOrObjected?.agentName || '参研角色'}** 提出阻断性异议：\n> “${pendingOrObjected?.statement || '存在未解决的关键架构缺陷'}”\n\n综合裁定官已暂停敲定并暂不出具终局活体看板。请围绕异议焦点进一步推演，或由人类首席仲裁官在下方控制台行使特权裁决。`;
            const objectionNotice: Message = {
              id: `msg-objection-notice-${Date.now()}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: 'system',
              authorName: isUnavail ? 'Shinobi 角色可用性告警' : 'Shinobi 裁决异议挂起提示',
              authorHandle: '@arbiter-gavel',
              authorAvatar: isUnavail ? '⚠️' : '❌',
              isAgent: true,
              agentBadge: blockedBadge,
              timestamp: formatFullDateTime(),
              content: blockedContent,
            };

            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), objectionNotice],
            }));
          }
        } else {
          // 零参研角色时给出系统提示并释放锁
          const noPeerNotice: Message = {
            id: `msg-no-peer-notice-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shinobi 仲裁征询提示',
            authorHandle: '@arbiter-gavel',
            authorAvatar: 'ℹ️',
            isAgent: true,
            agentBadge: 'No Peers Configured',
            timestamp: formatFullDateTime(),
            content: `ℹ️ **[未检测到需征询的参研角色]**：当前议题未指派提案方、红队对抗方或实证方智能体。请人类首席仲裁官在下方控制台行使法定裁决权定案。`,
          };
          setMessages((prev) => ({
            ...prev,
            [topicId]: [...(prev[topicId] || []), noPeerNotice],
          }));
        }
      } catch (err) {
        const execKey = `${topicId}:${arbiterAgent.id}`;
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
          const filtered = arbiterPendingId ? existing.filter((m) => m.id !== arbiterPendingId) : existing;
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg, humanNotice],
          };
        });
      } finally {
        if (handoverKey) {
          inFlightHandoverRef.current.delete(handoverKey);
        }
      }
    },
    [
      getTopicData,
      activeTopicData,
      agentsRef,
      updateTopicDataInState,
      setMessages,
      isTurnStale,
      setIsGenerating,
      setActiveExecutions,
      setAgents,
      getTopicWorkspaceBinding,
      handleResolveTopic,
      inFlightHandoverRef,
    ]
  );

  return { processArbitrationConcurrence };
}
