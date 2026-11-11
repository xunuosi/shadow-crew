import { useCallback } from 'react';
import type {
  Agent,
  Channel,
  Message,
  TopicMessageData,
  RulingRecord,
  TopicPatchDiffItem,
  GameTheoreticStage,
  ActiveAgentExecution,
  WorkspaceBinding,
} from '../types';
import { isAgentOffline } from '../utils/agentRuntime';
import {
  computeTopologicalExecutionOrder,
  mergeTopicPatchDiffs,
} from '../services/cogno';
import {
  buildModularExecutionPrompt,
  buildExecutionPrompt,
  buildAgentPersonaPrompt,
  type TopicPromptContext,
  type TurnEpochSnapshot,
} from '../services/agentCollaboration';
import {
  sendPromptToAcpAgent,
  extractWorkspaceDiffsFromText,
  applyTopicPatchToWorkspace,
  buildThinkingProcessFromAcp,
} from '../services/acpClient';

export interface UseTopicExecutionPipelineParams {
  getTopicData: (topicId: string) => TopicMessageData | null;
  updateTopicDataInState: (
    topicId: string,
    updater: (oldTopic: TopicMessageData) => TopicMessageData
  ) => void;
  captureTurnEpoch: (threadId?: string, channelId?: string, agentId?: string) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  channels: Channel[];
  activeChannel: Channel | null | undefined;
  agentsRef: React.MutableRefObject<Agent[]>;
  activeExecutionsRef: React.MutableRefObject<Record<string, ActiveAgentExecution>>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  getTopicWorkspaceBinding: (topicId?: string) => WorkspaceBinding | undefined;
  activeTopicId: string | null;
  activeDiff: any;
  setActiveDiff: React.Dispatch<React.SetStateAction<any>>;
}

export function useTopicExecutionPipeline({
  getTopicData,
  updateTopicDataInState,
  captureTurnEpoch,
  isTurnStale,
  channels,
  activeChannel,
  agentsRef,
  activeExecutionsRef,
  setActiveExecutions,
  setIsGenerating,
  setAgents,
  setMessages,
  getTopicWorkspaceBinding,
  activeTopicId,
  activeDiff,
  setActiveDiff,
}: UseTopicExecutionPipelineParams) {
  const dispatchTopicExecution = useCallback(
    async (options: {
      topicId: string;
      executorId: string;
      decision: {
        solution: string;
        impactedFiles: string[];
        approvers: string[];
        rulingRecord?: RulingRecord;
      };
    }) => {
      const { topicId, executorId, decision } = options;
      const currentTopic = getTopicData(topicId);
      if (!currentTopic) return;
      const turnSnapshot = captureTurnEpoch(topicId, currentTopic.channelId || activeChannel?.id, executorId);

      const executorAgent = agentsRef.current.find((a) => a.id === executorId);
      if (!executorAgent) {
        console.warn(`[Execution] Executor agent ${executorId} not found.`);
        return;
      }

      const topicChannel = channels.find((c) => c.id === currentTopic.channelId) || activeChannel;

      if (isAgentOffline(executorAgent)) {
        const offlineNotice: Message = {
          id: `msg-offline-exec-${Date.now()}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shadow Crew 落地执行守护',
          authorHandle: '@exec-guard',
          authorAvatar: '🔌',
          isAgent: true,
          agentBadge: 'Communication Required',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `🔌 **执行 Agent 通信尚未开启**：已指派 **${executorAgent.name}** 推进定案决议落地，但该 Agent 当前处于离线状态。\n\n请在左侧面板点击【Start】开启 ACP 通信后重新指派落地。`,
        };
        setMessages((prev) => ({
          ...prev,
          [topicId]: [...(prev[topicId] || []), offlineNotice],
        }));
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameTheoreticState: {
            ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
            assignedExecutorId: executorAgent.id,
            executionStatus: 'failed',
            executionSummary: '执行 Agent 处于离线状态，需开启通信后重试',
          },
        }));
        return;
      }

      // Multi-Topic Concurrency Guard: If this executor agent is currently busy on another topic, queue first
      const isBusyElsewhere = () =>
        Object.values(activeExecutionsRef.current).some(
          (e) => e.agentId === executorAgent.id && e.topicId !== topicId && e.threadId !== topicId
        );

      if (isBusyElsewhere()) {
        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameTheoreticState: {
            ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
            assignedExecutorId: executorAgent.id,
            executionStatus: 'queued',
            executionSummary: `等待 ${executorAgent.name} 完成前序并行任务...`,
          },
          decisionRecord: old.decisionRecord
            ? {
                ...old.decisionRecord,
                executorId: executorAgent.id,
                executorName: executorAgent.name,
              }
            : old.decisionRecord,
          rulingRecord: old.rulingRecord
            ? {
                ...old.rulingRecord,
                executorId: executorAgent.id,
              }
            : old.rulingRecord,
        }));

        let waitLoops = 0;
        while (isBusyElsewhere() && waitLoops < 150) {
          if (isTurnStale(turnSnapshot)) return;
          await new Promise((r) => setTimeout(r, 800));
          waitLoops++;
        }
        if (isTurnStale(turnSnapshot)) return;
      }

      const startTimeMs = Date.now();

      // Update topic execution state to running
      updateTopicDataInState(topicId, (old) => ({
        ...old,
        gameTheoreticState: {
          ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
          assignedExecutorId: executorAgent.id,
          executionStatus: 'running',
          executionStartedAt: startTimeMs,
          executionSummary: `正在由 ${executorAgent.name} 执行定案决议并生成交付成果...`,
        },
        decisionRecord: old.decisionRecord
          ? {
              ...old.decisionRecord,
              executorId: executorAgent.id,
              executorName: executorAgent.name,
            }
          : old.decisionRecord,
        rulingRecord: old.rulingRecord
          ? {
              ...old.rulingRecord,
              executorId: executorAgent.id,
            }
          : old.rulingRecord,
      }));

      // Update the channel rollup notice in-place to reflect live execution start
      setMessages((prev) => {
        let parentThreadId: string | null = null;
        for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
          if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
            parentThreadId = tId;
            break;
          }
        }
        if (!parentThreadId) return prev;
        return {
          ...prev,
          [parentThreadId]: (prev[parentThreadId] || []).map((m) => {
            if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
              const baseContent = m.content.split('\n\n---\n')[0];
              return {
                ...m,
                content: `${baseContent}\n\n---\n⏳ **决议落地进度**：已委派 **${executorAgent.name}** (${executorAgent.handle}) 正在推进定案决议落地...`,
              };
            }
            return m;
          }),
        };
      });

      const execKey = `${topicId}:${executorAgent.id}`;
      setIsGenerating(true);
      setActiveExecutions((prev) => ({
        ...prev,
        [execKey]: {
          agentId: executorAgent.id,
          agentName: executorAgent.name,
          agentAvatar: executorAgent.avatar,
          threadId: topicId,
          topicId,
          status: 'thinking',
          currentActionDetail: `正在基于定案决议执行落地任务与交付输出 (Stage: 🛠️ 决议落地)...`,
          startedAt: startTimeMs,
          cascadeHop: 5,
        },
      }));

      setAgents((prev) =>
        prev.map((a) => (a.id === executorAgent.id && a.status !== 'running' ? { ...a, status: 'running' } : a))
      );

      const topicContext: TopicPromptContext = {
        topicId,
        title: currentTopic.title,
        description: currentTopic.description,
        channelName: topicChannel?.name || 'chat',
        status: currentTopic.status,
        discussionMode: currentTopic.discussionMode,
        gameRoles: currentTopic.gameRoles,
        gameStage: 'concluded',
        targetProposalText: currentTopic.gameTheoreticState?.targetProposalContent,
        targetChallengeText: currentTopic.gameTheoreticState?.targetChallengeContent,
        targetDefenseText: currentTopic.gameTheoreticState?.targetDefenseContent,
      };

      const modularState = currentTopic.gameTheoreticState?.modularState;
      const isModularExecution = Boolean(modularState?.enabled && modularState.modules && modularState.modules.length > 1);

      // =========================================================================
      // G-Frame 模块化分治流水线执行 (单一独立 Agent 串行多阶段任务沙箱)
      // =========================================================================
      if (isModularExecution && modularState) {
        const executionPlan = computeTopologicalExecutionOrder(modularState.modules);
        const totalSteps = executionPlan.length;

        // 更新主频道 Rollup 提示：进入模块化分治流水线
        setMessages((prev) => {
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
            if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === topicId)) {
              parentThreadId = tId;
              break;
            }
          }
          if (!parentThreadId) return prev;
          return {
            ...prev,
            [parentThreadId]: (prev[parentThreadId] || []).map((m) => {
              if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
                const baseContent = m.content.split('\n\n---\n')[0];
                return {
                  ...m,
                  content: `${baseContent}\n\n---\n⏳ **G-Frame 模块分治落地中**：已委派 **${executorAgent.name}** (${executorAgent.handle}) 按 DAG 拓扑流水线串行落地 ${totalSteps} 个原子模块...`,
                };
              }
              return m;
            }),
          };
        });

        let accumulatedDiffs: TopicPatchDiffItem[] = [];
        const priorMilestones: Array<{
          moduleId: string;
          title: string;
          summary: string;
          touchedFiles: string[];
        }> = [];

        try {
          for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
            const currentSlice = executionPlan[stepIdx];
            if (isTurnStale(turnSnapshot)) {
              console.log('[App] Aborting modular execution pipeline because turn was invalidated');
              return;
            }

            // 1. 设置执行中 Action 状态与 Topic 进度
            setActiveExecutions((prev) => ({
              ...prev,
              [execKey]: {
                agentId: executorAgent.id,
                agentName: executorAgent.name,
                agentAvatar: executorAgent.avatar,
                threadId: topicId,
                topicId,
                status: 'thinking',
                currentActionDetail: `正在由 ${executorAgent.name} 执行 G-Frame 模块 [${stepIdx + 1}/${totalSteps}: ${currentSlice.title}] (白名单: ${currentSlice.allowedFiles.join(', ') || '未受限'})...`,
                startedAt: startTimeMs,
                cascadeHop: 5,
              },
            }));

            updateTopicDataInState(topicId, (old) => {
              const mState = old.gameTheoreticState?.modularState;
              if (!mState) return old;
              return {
                ...old,
                gameTheoreticState: {
                  ...old.gameTheoreticState!,
                  executionSummary: `正在执行模块 [${stepIdx + 1}/${totalSteps}: ${currentSlice.title}]...`,
                  modularState: {
                    ...mState,
                    activeExecutionModuleId: currentSlice.moduleId,
                    modules: mState.modules.map((m) =>
                      m.moduleId === currentSlice.moduleId
                        ? {
                            ...m,
                            executionStatus: 'running' as const,
                            assignedExecutorId: executorAgent.id,
                          }
                        : m
                    ),
                  },
                },
              };
            });

            // 2. 发送本模块阶段 Pending 消息
            const stepPendingId = `topic-pending-exec-mod-${Date.now()}-${currentSlice.moduleId}`;
            const stepPendingMsg: Message = {
              id: stepPendingId,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: executorAgent.id,
              authorName: executorAgent.name,
              authorHandle: executorAgent.handle,
              authorAvatar: executorAgent.avatar,
              isAgent: true,
              isPending: true,
              startedAt: Date.now(),
              pendingHint: `正在推进模块 [${stepIdx + 1}/${totalSteps}: ${currentSlice.title}] 落地代码变更与交付物...`,
              agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · 模块 [${stepIdx + 1}/${totalSteps}] (执行中...)`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: '',
              gameStage: 'concluded',
              relatedTopicId: topicId,
            };
            setMessages((prev) => ({
              ...prev,
              [topicId]: [...(prev[topicId] || []), stepPendingMsg],
            }));

            // 3. 构建专属模块 Prompt 并向 ACP 发送
            const modPrompt = buildModularExecutionPrompt({
              topic: topicContext,
              executorAgent,
              moduleSlice: currentSlice,
              moduleIndex: stepIdx + 1,
              totalModules: totalSteps,
              sharedContract: modularState.sharedContract,
              priorMilestones,
              decision: {
                summary: decision.rulingRecord?.summary || decision.solution,
                solution: decision.solution,
                tradeOffPoints: decision.rulingRecord?.tradeOffPoints,
              },
            });

            const acpResp = await sendPromptToAcpAgent({
              agent: executorAgent,
              roomId: topicId,
              prompt: modPrompt,
              channelId: topicChannel?.id,
              workspaceBindingId: currentTopic.workspaceBindingId,
              workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
              scopeType: 'topic',
              systemPrompt: buildAgentPersonaPrompt(executorAgent),
              discussionMode: 'game_theoretic',
            });

            if (isTurnStale(turnSnapshot)) {
              console.log('[App] Dropping modular stage reply because turn was aborted or invalidated');
              return;
            }

            if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
              throw new Error(
                acpResp.isError
                  ? `模块 [${currentSlice.title}] 执行失败: ${acpResp.textResponse}`
                  : `模块 [${currentSlice.title}] 执行 Agent 返回空响应，未生成有效交付内容。`
              );
            }

            // 4. 解析本模块产出的 Diff
            const stepDiffs =
              acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
                ? acpResp.workspaceDiffs
                : extractWorkspaceDiffsFromText(acpResp.textResponse, currentSlice.allowedFiles);

            accumulatedDiffs = mergeTopicPatchDiffs(accumulatedDiffs, stepDiffs);

            const stepSummary =
              acpResp.executionMeta?.statusSummary ||
              (stepDiffs.length > 0
                ? `产出 ${stepDiffs.length} 个文件变更 (+${stepDiffs.reduce((s, d) => s + d.additions, 0)}/-${stepDiffs.reduce((s, d) => s + d.deletions, 0)})`
                : '完成本模块设计交付报告');

            priorMilestones.push({
              moduleId: currentSlice.moduleId,
              title: currentSlice.title,
              summary: stepSummary,
              touchedFiles: stepDiffs.map((d) => d.filename),
            });

            const stepCompletedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // 5. 将 Pending 消息替换为完成消息
            const stepReply: Message = {
              id: `topic-reply-exec-mod-${Date.now()}-${currentSlice.moduleId}`,
              threadId: topicId,
              channelId: topicChannel?.id,
              authorId: executorAgent.id,
              authorName: executorAgent.name,
              authorHandle: executorAgent.handle,
              authorAvatar: executorAgent.avatar,
              isAgent: true,
              isPending: false,
              agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · 模块 [${stepIdx + 1}/${totalSteps}] ✅`,
              timestamp: stepCompletedAt,
              content: acpResp.textResponse,
              gameStage: 'concluded',
              thinkingProcess: buildThinkingProcessFromAcp(
                acpResp,
                `已完成模块 [${stepIdx + 1}/${totalSteps}: ${currentSlice.title}] 交付`
              ),
              diffView: stepDiffs.length > 0 ? stepDiffs[0] : undefined,
              diffViews: stepDiffs.length > 0 ? stepDiffs : undefined,
              relatedTopicId: topicId,
              cartridgeCitation: acpResp.cartridgeCitation,
            };

            setMessages((prev) => {
              const existing = prev[topicId] || [];
              return {
                ...prev,
                [topicId]: existing.map((m) => (m.id === stepPendingId ? stepReply : m)),
              };
            });

            // 6. 更新 topic 状态中该模块的 completed 属性
            updateTopicDataInState(topicId, (old) => {
              const mState = old.gameTheoreticState?.modularState;
              if (!mState) return old;
              return {
                ...old,
                gameTheoreticState: {
                  ...old.gameTheoreticState!,
                  executionSummary: `已完成 [${stepIdx + 1}/${totalSteps}: ${currentSlice.title}]，${stepIdx + 1 < totalSteps ? `准备推进下一个模块...` : '所有模块已就绪！'}`,
                  modularState: {
                    ...mState,
                    executionCompletedCount: stepIdx + 1,
                    modules: mState.modules.map((m) =>
                      m.moduleId === currentSlice.moduleId
                        ? {
                            ...m,
                            executionStatus: 'completed' as const,
                            executionVerificationPassed: true,
                            executionDiffs: stepDiffs,
                            executionSummary: stepSummary,
                            assignedExecutorId: executorAgent.id,
                          }
                        : m
                    ),
                  },
                },
              };
            });
          } // end of for loop

          // 7. 全部模块执行成功，清理执行锁，发布终态消息与 Rollup 汇总
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          const totalAdd = accumulatedDiffs.reduce((s, d) => s + d.additions, 0);
          const totalDel = accumulatedDiffs.reduce((s, d) => s + d.deletions, 0);
          const finalCompletedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const finalSummaryNotice: Message = {
            id: `topic-reply-exec-final-${Date.now()}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: 'system',
            authorName: 'Shadow Crew 落地执行中枢',
            authorHandle: '@exec-hub',
            authorAvatar: '🎉',
            isAgent: true,
            agentBadge: 'G-Frame Pipeline ✅',
            timestamp: finalCompletedAt,
            content: `🎉 **G-Frame 模块化分治落地全流程顺利完成！**\n\n已由 **${executorAgent.name}** (${executorAgent.handle}) 按 DAG 拓扑顺序串行完成以下 **${totalSteps}** 个原子模块切片：\n${priorMilestones
              .map(
                (m, i) =>
                  `${i + 1}. **${m.title}** (\`${m.moduleId}\`)：${m.summary} ${
                    m.touchedFiles.length > 0 ? `(\`${m.touchedFiles.join('`, `')}\`)` : ''
                  }`
              )
              .join('\n')}\n\n累计生成 **${accumulatedDiffs.length}** 个工作区文件变更 (+${totalAdd} / -${totalDel})，可在议题卡片或审查视图中一键核对并物理合入本地仓库。`,
            gameStage: 'concluded',
            diffViews: accumulatedDiffs.length > 0 ? accumulatedDiffs : undefined,
            diffView: accumulatedDiffs.length > 0 ? accumulatedDiffs[0] : undefined,
            relatedTopicId: topicId,
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            const nextTopicMsgs = [...existing, finalSummaryNotice];
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
                        latestReplyPreview: finalSummaryNotice.content.slice(0, 60),
                        gameTheoreticState: {
                          ...(m.topicData.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
                          assignedExecutorId: executorAgent.id,
                          executionStatus: 'completed' as const,
                          executionCompletedAt: finalCompletedAt,
                          executionDiffs: accumulatedDiffs,
                          executionSummary: `G-Frame 模块分治完成：${totalSteps} 个子模块交付，${accumulatedDiffs.length} 个文件 (+${totalAdd}/-${totalDel})`,
                        },
                      },
                    };
                  }
                  if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
                    const baseContent = m.content.split('\n\n---\n')[0];
                    return {
                      ...m,
                      diffView: accumulatedDiffs.length > 0 ? accumulatedDiffs[0] : m.diffView,
                      diffViews: accumulatedDiffs.length > 0 ? accumulatedDiffs : m.diffViews,
                      content: `${baseContent}\n\n---\n✅ **G-Frame 模块化分治落地已完成 (${finalCompletedAt})**：由 **${executorAgent.name}** 串行完成了全部 ${totalSteps} 个原子模块，累计交付 **${accumulatedDiffs.length} 个文件变更 (+${totalAdd} / -${totalDel})**，可在议题卡片或审查视图中一键核对并合入本地工作区。`,
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

          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameTheoreticState: {
              ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
              assignedExecutorId: executorAgent.id,
              executionStatus: 'completed',
              executionCompletedAt: finalCompletedAt,
              executionDiffs: accumulatedDiffs,
              executionSummary: `G-Frame 模块分治完成：${totalSteps} 个子模块交付，${accumulatedDiffs.length} 个文件 (+${totalAdd}/-${totalDel})`,
              modularState: old.gameTheoreticState?.modularState
                ? {
                    ...old.gameTheoreticState.modularState,
                    activeExecutionModuleId: undefined,
                  }
                : old.gameTheoreticState?.modularState,
            },
          }));

          return; // Finished modular execution successfully!
        } catch (err) {
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[execKey];
            if (Object.keys(next).length === 0) setIsGenerating(false);
            return next;
          });

          if (isTurnStale(turnSnapshot)) return;

          console.error('Modular executor execution failed:', err);
          const errText = err instanceof Error ? err.message : String(err);
          const errorMsg: Message = {
            id: `topic-exec-err-mod-${Date.now()}-${executorAgent.id}`,
            threadId: topicId,
            channelId: topicChannel?.id,
            authorId: executorAgent.id,
            authorName: executorAgent.name,
            authorHandle: executorAgent.handle,
            authorAvatar: executorAgent.avatar,
            isAgent: true,
            agentBadge: 'G-Frame Error',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `⚠️ **G-Frame 模块化分治落地异常**：${errText}`,
            gameStage: 'concluded',
            relatedTopicId: topicId,
          };

          setMessages((prev) => {
            const existing = prev[topicId] || [];
            return {
              ...prev,
              [topicId]: [...existing.filter((m) => !m.isPending), errorMsg],
            };
          });

          updateTopicDataInState(topicId, (old) => ({
            ...old,
            gameTheoreticState: {
              ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
              assignedExecutorId: executorAgent.id,
              executionStatus: 'failed',
              executionSummary: `G-Frame 落地中断: ${errText}`,
              executionDiffs: accumulatedDiffs.length > 0 ? accumulatedDiffs : old.gameTheoreticState?.executionDiffs,
              modularState: old.gameTheoreticState?.modularState
                ? {
                    ...old.gameTheoreticState.modularState,
                    modules: old.gameTheoreticState.modularState.modules.map((m) =>
                      m.moduleId === old.gameTheoreticState?.modularState?.activeExecutionModuleId
                        ? { ...m, executionStatus: 'failed' as const }
                        : m
                    ),
                  }
                : old.gameTheoreticState?.modularState,
            },
          }));
          return;
        }
      }

      // =========================================================================
      // 标准单轮落地执行 (非模块化或单模块议题)
      // =========================================================================
      const pendingId = `topic-pending-exec-${Date.now()}-${executorAgent.id}`;
      const pendingMsg: Message = {
        id: pendingId,
        threadId: topicId,
        channelId: topicChannel?.id,
        authorId: executorAgent.id,
        authorName: executorAgent.name,
        authorHandle: executorAgent.handle,
        authorAvatar: executorAgent.avatar,
        isAgent: true,
        isPending: true,
        startedAt: startTimeMs,
        pendingHint: '正在基于定案决议与权衡约束，推进落地执行并整理交付成果 (Stage: 🛠️ 决议落地)...',
        agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · 🛠️ 决议落地 (执行中...)`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        gameStage: 'concluded',
        relatedTopicId: topicId,
      };

      setMessages((prev) => ({
        ...prev,
        [topicId]: [...(prev[topicId] || []), pendingMsg],
      }));

      const execPrompt = buildExecutionPrompt({
        topic: topicContext,
        executorAgent,
        decision: {
          summary: decision.rulingRecord?.summary || decision.solution,
          solution: decision.solution,
          tradeOffPoints: decision.rulingRecord?.tradeOffPoints,
          impactedFiles: decision.impactedFiles,
        },
      });

      try {
        const acpResp = await sendPromptToAcpAgent({
          agent: executorAgent,
          roomId: topicId,
          prompt: execPrompt,
          channelId: topicChannel?.id,
          workspaceBindingId: currentTopic.workspaceBindingId,
          workspaceCwd: getTopicWorkspaceBinding(currentTopic.id)?.cwd,
          scopeType: 'topic',
          systemPrompt: buildAgentPersonaPrompt(executorAgent),
          discussionMode: 'game_theoretic',
        });

        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping topic execution reply because turn was aborted or invalidated');
          return;
        }

        if (acpResp.isEmptyTurn || acpResp.isError || !acpResp.textResponse.trim()) {
          throw new Error(acpResp.isError ? acpResp.textResponse : '执行 Agent 返回空响应，未生成有效交付内容。');
        }

        const extractedDiffs =
          acpResp.workspaceDiffs && acpResp.workspaceDiffs.length > 0
            ? acpResp.workspaceDiffs
            : extractWorkspaceDiffsFromText(acpResp.textResponse, decision.impactedFiles);

        const execMeta = acpResp.executionMeta;
        const completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const execReply: Message = {
          id: `topic-reply-exec-${Date.now()}-${executorAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: executorAgent.id,
          authorName: executorAgent.name,
          authorHandle: executorAgent.handle,
          authorAvatar: executorAgent.avatar,
          isAgent: true,
          isPending: false,
          agentBadge: `${executorAgent.modelBadge?.split(' ')[0] || 'Local'} · ${execMeta?.podTitle || '🛠️ 决议落地交付'}`,
          timestamp: completedAt,
          content: acpResp.textResponse,
          gameStage: 'concluded',
          thinkingProcess: buildThinkingProcessFromAcp(
            acpResp,
            execMeta?.statusSummary || '已完成定案决议落地执行交付'
          ),
          diffView: extractedDiffs.length > 0 ? extractedDiffs[0] : undefined,
          diffViews: extractedDiffs.length > 0 ? extractedDiffs : undefined,
          relatedTopicId: topicId,
          cartridgeCitation: acpResp.cartridgeCitation,
        };

        const totalAdd = extractedDiffs.reduce((s, d) => s + d.additions, 0);
        const totalDel = extractedDiffs.reduce((s, d) => s + d.deletions, 0);

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const hasPending = existing.some((m) => m.id === pendingId);
          const nextTopicMsgs = hasPending
            ? existing.map((m) => (m.id === pendingId ? execReply : m))
            : [...existing, execReply];
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
                      latestReplyPreview: execReply.content.slice(0, 60),
                      gameTheoreticState: {
                        ...(m.topicData.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
                        assignedExecutorId: executorAgent.id,
                        executionStatus: 'completed' as const,
                        executionCompletedAt: completedAt,
                        executionDiffs: extractedDiffs,
                        executionUiMeta: execMeta,
                        executionSummary:
                          execMeta?.statusSummary ||
                          (extractedDiffs.length > 0
                            ? `已生成 ${extractedDiffs.length} 个工作区交付文件 (+${totalAdd}/-${totalDel})`
                            : '已完成定案决议落地执行报告'),
                      },
                    },
                  };
                }
                if (m.relatedTopicId === topicId && m.id.startsWith('msg-rollup-')) {
                  const baseContent = m.content.split('\n\n---\n')[0];
                  return {
                    ...m,
                    diffView: extractedDiffs.length > 0 ? extractedDiffs[0] : m.diffView,
                    diffViews: extractedDiffs.length > 0 ? extractedDiffs : m.diffViews,
                    content:
                      extractedDiffs.length > 0
                        ? `${baseContent}\n\n---\n✅ **${execMeta?.podTitle || '决议落地变更已就绪'} (${completedAt})**：由 **${executorAgent.name}** 完成了 **${execMeta?.statusSummary || `${extractedDiffs.length} 个文件变更 (+${totalAdd} / -${totalDel})`}**，可在议题卡片或审查视图中一键核对并合入本地工作区。`
                        : `${baseContent}\n\n---\n✅ **${execMeta?.podTitle || '决议落地已完成'} (${completedAt})**：**${executorAgent.name}** 已在议题抽屉内完成交付（${execMeta?.statusSummary || '详见抽屉内执行报告'}）。`,
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
      } catch (err) {
        setActiveExecutions((prev) => {
          const next = { ...prev };
          delete next[execKey];
          if (Object.keys(next).length === 0) setIsGenerating(false);
          return next;
        });

        if (isTurnStale(turnSnapshot)) {
          console.log('[App] Dropping topic execution error because turn was aborted or invalidated');
          return;
        }

        console.error('Executor execution failed:', err);
        const errText = err instanceof Error ? err.message : String(err);
        const errorMsg: Message = {
          id: `topic-exec-err-${Date.now()}-${executorAgent.id}`,
          threadId: topicId,
          channelId: topicChannel?.id,
          authorId: executorAgent.id,
          authorName: executorAgent.name,
          authorHandle: executorAgent.handle,
          authorAvatar: executorAgent.avatar,
          isAgent: true,
          agentBadge: 'ACP Error',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **决议落地执行异常**：${errText}`,
          gameStage: 'concluded',
          relatedTopicId: topicId,
        };

        setMessages((prev) => {
          const existing = prev[topicId] || [];
          const filtered = existing.filter((m) => m.id !== pendingId);
          return {
            ...prev,
            [topicId]: [...filtered, errorMsg],
          };
        });

        updateTopicDataInState(topicId, (old) => ({
          ...old,
          gameTheoreticState: {
            ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
            executionStatus: 'failed',
            executionSummary: errText.slice(0, 80),
          },
        }));
      }
    },
    [
      getTopicData,
      captureTurnEpoch,
      activeChannel,
      agentsRef,
      channels,
      setMessages,
      updateTopicDataInState,
      activeExecutionsRef,
      isTurnStale,
      setIsGenerating,
      setActiveExecutions,
      setAgents,
      getTopicWorkspaceBinding,
    ]
  );

  const handleExecuteTopicPatch = useCallback(
    (topicId: string, executorId: string) => {
      const currentTopic = getTopicData(topicId);
      if (!currentTopic) return;
      dispatchTopicExecution({
        topicId,
        executorId,
        decision: {
          solution:
            currentTopic.decisionRecord?.solution ||
            currentTopic.rulingRecord?.solution ||
            currentTopic.description ||
            currentTopic.title,
          impactedFiles:
            currentTopic.decisionRecord?.impactedFiles ||
            currentTopic.rulingRecord?.impactedFiles ||
            [],
          approvers: currentTopic.decisionRecord?.approvers || [],
          rulingRecord: currentTopic.rulingRecord,
        },
      });
    },
    [getTopicData, dispatchTopicExecution]
  );

  const handleApplyTopicPatch = useCallback(
    async (topicId?: string, customDiffs?: TopicPatchDiffItem[]) => {
      const targetTopicId = topicId || activeDiff?.topicId || activeTopicId;
      const currentTopic = targetTopicId ? getTopicData(targetTopicId) : null;
      const diffsToApply: TopicPatchDiffItem[] =
        customDiffs && customDiffs.length > 0
          ? customDiffs
          : currentTopic?.gameTheoreticState?.executionDiffs ||
            (activeDiff?.allDiffs && activeDiff.allDiffs.length > 0 ? activeDiff.allDiffs : activeDiff ? [activeDiff] : []);

      if (!diffsToApply || diffsToApply.length === 0) return;

      const topicChannel =
        (currentTopic?.channelId ? channels.find((c) => c.id === currentTopic.channelId) : null) ||
        activeChannel;
      const effectiveChanId = topicChannel?.id || 'general';
      const topicBinding = getTopicWorkspaceBinding(targetTopicId || currentTopic?.id);
      if (!topicBinding) {
        throw new Error(`议题 ${targetTopicId || currentTopic?.id || 'unknown'} 缺少 Workspace Binding`);
      }

      const res = await applyTopicPatchToWorkspace({
        workspaceBindingId: topicBinding.id,
        workspaceRoot: topicBinding.cwd,
        artifactRoot: topicBinding.artifactRoot,
        channelId: effectiveChanId,
        topicId: targetTopicId || 'adhoc-patch',
        patches: diffsToApply,
      });

      const appliedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const updatedDiffs: TopicPatchDiffItem[] = diffsToApply.map((d) => {
        const match = res.appliedFiles.find((af) => af.filename === d.filename);
        return {
          ...d,
          applied: true,
          appliedMode: match?.mode || 'artifact_saved',
          targetPath: match?.targetPath,
        };
      });

      if (targetTopicId) {
        updateTopicDataInState(targetTopicId, (old) => ({
          ...old,
          gameTheoreticState: {
            ...(old.gameTheoreticState || { currentStage: 'concluded' as GameTheoreticStage }),
            executionStatus: 'applied',
            executionAppliedAt: appliedAt,
            executionArtifactsDir: res.artifactsDir,
            executionSummary: res.summary,
            executionDiffs: updatedDiffs,
          },
        }));

        const execMeta = currentTopic?.gameTheoreticState?.executionUiMeta;
        const applyConfirmMsg: Message = {
          id: `topic-patch-applied-${Date.now()}`,
          threadId: targetTopicId,
          channelId: topicChannel?.id,
          authorId: 'system',
          authorName: 'Shadow Crew 工作区合入引擎',
          authorHandle: '@workspace-patcher',
          authorAvatar: '⚖️',
          isAgent: true,
          agentBadge: 'Workspace Applied',
          timestamp: appliedAt,
          relatedTopicId: targetTopicId,
          content: `✅ **${execMeta?.podTitle || '决议交付文件'}已物理合入本地工作区**\n\n- **合入摘要**：${res.summary}\n- **归档目录**：\`${res.artifactsDir}\`\n- **变更文件明细**：\n${res.appliedFiles.map((f) => `  • \`${f.filename}\` → \`${f.targetPath}\` (${f.mode})`).join('\n')}`,
        };

        setMessages((prev) => {
          const existingTopicMsgs = prev[targetTopicId] || [];
          let parentThreadId: string | null = null;
          for (const [tId, msgList] of Object.entries(prev) as [string, Message[]][]) {
            if (msgList.some((m) => m.type === 'topic' && m.topicData?.id === targetTopicId)) {
              parentThreadId = tId;
              break;
            }
          }
          const updatedParentMsgs = parentThreadId
            ? (prev[parentThreadId] || []).map((m) => {
                if (m.relatedTopicId === targetTopicId && m.id.startsWith('msg-rollup-')) {
                  const baseContent = m.content.split('\n\n---\n')[0];
                  return {
                    ...m,
                    content: `${baseContent}\n\n---\n🎉 **${execMeta?.podTitle || '决议交付'}已合入工作区 (${appliedAt})**：${res.summary}（归档于 \`${res.artifactsDir}\`）`,
                  };
                }
                return m;
              })
            : [];

          return {
            ...prev,
            [targetTopicId]: [...existingTopicMsgs, applyConfirmMsg],
            ...(parentThreadId ? { [parentThreadId]: updatedParentMsgs } : {}),
          };
        });
      }

      setActiveDiff((prev: any) =>
        prev
          ? {
              ...prev,
              executionStatus: 'applied',
              artifactsDir: res.artifactsDir,
              allDiffs: updatedDiffs,
            }
          : prev
      );
    },
    [
      activeDiff,
      activeTopicId,
      getTopicData,
      channels,
      activeChannel,
      getTopicWorkspaceBinding,
      updateTopicDataInState,
      setMessages,
      setActiveDiff,
    ]
  );

  return {
    dispatchTopicExecution,
    handleExecuteTopicPatch,
    handleApplyTopicPatch,
  };
}
