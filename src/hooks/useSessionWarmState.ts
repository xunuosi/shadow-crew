import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import type {
  ActiveAgentExecution,
  Agent,
  Message,
  TopicMessageData,
} from '../types';
import {
  clearAcpAgentSessions,
  matchesSessionScope,
} from '../services/acpClient';
import {
  bumpGlobalEpoch,
  captureTurnEpochSnapshot,
  createTurnEpochTracker,
  executeAbortAgentOrchestration,
  executeAbortAllOrchestration,
  isTurnEpochStale,
  type CollaborationCascade,
  type TurnEpochSnapshot,
  type TurnEpochTracker,
} from '../services/agentCollaboration';
import { clearLlmSessionHistory } from '../services/llmService';

const DELIVERED_STANDING_CONTEXT_STORAGE_KEY = 'shinobi_delivered_standing_context';
const SESSION_WATERMARKS_STORAGE_KEY = 'shinobi_session_watermarks';

/**
 * 从 localStorage 恢复每个 (roomId:agentId) 会话的立足上下文 (Standing Context) 交付状态。
 * 保证整套平台公约与团队花名册只在 Session 建立时/第 1 轮传递，后续日常交互与应用重启恢复均为纯净指令。
 */
function loadSavedDeliveredStandingContext(): Set<string> {
  try {
    const raw = localStorage.getItem(DELIVERED_STANDING_CONTEXT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch {}
  return new Set();
}

/**
 * 从 localStorage 恢复每个 (roomId:agentId) 会话已投递的最新消息水位线 ID (Watermark)。
 * 热会话后续唤醒与重启 resume 时仅冲刷水位线之后的未读增量事件批次 (<delta-events>)，避免重复复读历史背景。
 */
function loadSavedSessionWatermarks(): Map<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_WATERMARKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Map(parsed);
      }
    }
  } catch {}
  return new Map();
}

export interface UseSessionWarmStateParams {
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  messagesRef: React.MutableRefObject<Record<string, Message[]>>;
  commitMessages: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  getTopicData: (topicId: string) => TopicMessageData | null;
}

export interface UseSessionWarmStateReturn {
  isGenerating: boolean;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  activeExecutions: Record<string, ActiveAgentExecution>;
  setActiveExecutions: (
    updater:
      | Record<string, ActiveAgentExecution>
      | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
  ) => void;
  activeExecutionsRef: React.MutableRefObject<Record<string, ActiveAgentExecution>>;
  activeCascades: Record<string, CollaborationCascade>;
  setActiveCascades: (
    updater:
      | Record<string, CollaborationCascade>
      | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
  ) => void;
  activeCascadesRef: React.MutableRefObject<Record<string, CollaborationCascade>>;
  sessionCleanupNotice: string | null;
  setSessionCleanupNotice: React.Dispatch<React.SetStateAction<string | null>>;
  generationEpochRef: React.MutableRefObject<number>;
  turnEpochTrackerRef: React.MutableRefObject<TurnEpochTracker>;
  captureTurnEpoch: (roomId?: string, channelId?: string, agentId?: string) => TurnEpochSnapshot;
  isTurnStale: (snapshot: TurnEpochSnapshot) => boolean;
  inFlightHandoverRef: React.MutableRefObject<Set<string>>;
  stageRefineRetriesRef: React.MutableRefObject<Record<string, number>>;
  deliveredStandingContextRef: React.MutableRefObject<Set<string>>;
  sessionWatermarksRef: React.MutableRefObject<Map<string, string>>;
  persistSessionWarmState: () => void;
  clearSessionWarmScope: (scope: Parameters<typeof matchesSessionScope>[1]) => void;
  resetAllSessionWarmState: () => void;
  safelyClearAcpSessions: (
    agentId?: string,
    sessionKeyPrefix?: string,
    contextLabel?: string
  ) => Promise<void>;
  handleAbortAgent: (agentId: string, threadId?: string) => void;
  handleAbortAll: (threadId?: string) => void;
  handleClearAllMessages: () => Promise<void>;
}

/**
 * 集中管理会话热态（Standing Context 交付标记与增量消息水位线）、异步推演代际追踪（Turn Epoch）、
 * 在途执行/级联协同映射表，以及单 Agent / 全局中止与清空历史消息的 Fail-Closed 控制闭环。
 */
export function useSessionWarmState({
  setAgents,
  setMessages,
  messagesRef,
  commitMessages,
  getTopicData,
}: UseSessionWarmStateParams): UseSessionWarmStateReturn {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeExecutions, setActiveExecutionsState] = useState<Record<string, ActiveAgentExecution>>({});
  const [activeCascades, setActiveCascadesState] = useState<Record<string, CollaborationCascade>>({});
  const [sessionCleanupNotice, setSessionCleanupNotice] = useState<string | null>(null);

  const activeCascadesRef = useRef<Record<string, CollaborationCascade>>({});
  activeCascadesRef.current = activeCascades;
  const activeExecutionsRef = useRef<Record<string, ActiveAgentExecution>>(activeExecutions);
  activeExecutionsRef.current = activeExecutions;

  const setActiveExecutions = useCallback(
    (
      updater:
        | Record<string, ActiveAgentExecution>
        | ((prev: Record<string, ActiveAgentExecution>) => Record<string, ActiveAgentExecution>)
    ) => {
      const next =
        typeof updater === 'function' ? updater(activeExecutionsRef.current) : updater;
      activeExecutionsRef.current = next;
      setActiveExecutionsState(next);
    },
    []
  );

  const setActiveCascades = useCallback(
    (
      updater:
        | Record<string, CollaborationCascade>
        | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
    ) => {
      const next =
        typeof updater === 'function' ? updater(activeCascadesRef.current) : updater;
      activeCascadesRef.current = next;
      setActiveCascadesState(next);
    },
    []
  );

  const generationEpochRef = useRef<number>(0);
  const turnEpochTrackerRef = useRef<TurnEpochTracker>(createTurnEpochTracker());

  const captureTurnEpoch = useCallback(
    (roomId: string = '', channelId?: string, agentId?: string): TurnEpochSnapshot =>
      captureTurnEpochSnapshot(turnEpochTrackerRef.current, { roomId, channelId, agentId }),
    []
  );

  const isTurnStale = useCallback(
    (snapshot: TurnEpochSnapshot): boolean =>
      isTurnEpochStale(turnEpochTrackerRef.current, snapshot),
    []
  );

  /**
   * 统一封装带异常捕获与用户可见提示的 ACP 会话清理调用，杜绝 fire-and-forget 未捕获 Promise rejection
   */
  const safelyClearAcpSessions = useCallback(
    async (agentId?: string, sessionKeyPrefix?: string, contextLabel: string = '会话清理') => {
      try {
        await clearAcpAgentSessions(agentId, sessionKeyPrefix);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[App] ${contextLabel}时清理底层 ACP 会话失败:`, err);
        setSessionCleanupNotice(`⚠️ ${contextLabel}清理底层 ACP 会话异常：${detail}`);
        setTimeout(() => {
          setSessionCleanupNotice((prev) => (prev && prev.includes(contextLabel) ? null : prev));
        }, 5000);
      }
    },
    []
  );

  const deliveredStandingContextRef = useRef<Set<string>>(loadSavedDeliveredStandingContext());
  const sessionWatermarksRef = useRef<Map<string, string>>(loadSavedSessionWatermarks());

  const persistSessionWarmState = useCallback(() => {
    try {
      localStorage.setItem(
        DELIVERED_STANDING_CONTEXT_STORAGE_KEY,
        JSON.stringify(Array.from(deliveredStandingContextRef.current))
      );
      localStorage.setItem(
        SESSION_WATERMARKS_STORAGE_KEY,
        JSON.stringify(Array.from(sessionWatermarksRef.current.entries()))
      );
    } catch {}
  }, []);

  const clearSessionWarmScope = useCallback(
    (scope: Parameters<typeof matchesSessionScope>[1]) => {
      Array.from(deliveredStandingContextRef.current).forEach((key) => {
        if (matchesSessionScope(key, scope)) {
          deliveredStandingContextRef.current.delete(key);
        }
      });
      Array.from(sessionWatermarksRef.current.keys()).forEach((key) => {
        if (matchesSessionScope(key, scope)) {
          sessionWatermarksRef.current.delete(key);
        }
      });
      persistSessionWarmState();
    },
    [persistSessionWarmState]
  );

  const resetAllSessionWarmState = useCallback(() => {
    deliveredStandingContextRef.current.clear();
    sessionWatermarksRef.current.clear();
    persistSessionWarmState();
  }, [persistSessionWarmState]);

  // 记录正在执行中的三元博弈阶段交接，杜绝并发重入与重复下发 Prompt
  const inFlightHandoverRef = useRef<Set<string>>(new Set());
  // 记录各阶段 Self-Refine 重试次数 (硬门禁: 上限为 STAGE_CONTRACT_MAX_RETRIES)
  const stageRefineRetriesRef = useRef<Record<string, number>>({});

  // Interrupt / Abort Agent Execution (Individual or Global)
  const handleAbortAgent = useCallback(
    (agentId: string, threadId?: string) => {
      const isGameTopic = threadId
        ? getTopicData(threadId)?.discussionMode === 'game_theoretic'
        : false;

      executeAbortAgentOrchestration({
        agentId,
        threadId,
        isGameTopic,
        activeExecutionsRef,
        activeCascadesRef,
        turnEpochTracker: turnEpochTrackerRef.current,
        inFlightHandovers: inFlightHandoverRef.current,
        generationEpochRef,
        setActiveExecutions,
        setActiveCascades,
        setIsGenerating,
        setAgents,
        setMessages: commitMessages,
      });
    },
    [commitMessages, getTopicData, setActiveCascades, setActiveExecutions, setAgents]
  );

  const handleAbortAll = useCallback(
    (threadId?: string) => {
      executeAbortAllOrchestration({
        threadId,
        activeExecutionsRef,
        activeCascadesRef,
        turnEpochTracker: turnEpochTrackerRef.current,
        inFlightHandovers: inFlightHandoverRef.current,
        generationEpochRef,
        setActiveExecutions,
        setActiveCascades,
        setIsGenerating,
        setAgents,
        setMessages: commitMessages,
      });
    },
    [commitMessages, setActiveCascades, setActiveExecutions, setAgents]
  );

  const handleClearAllMessages = useCallback(async () => {
    generationEpochRef.current++;
    bumpGlobalEpoch(turnEpochTrackerRef.current);
    inFlightHandoverRef.current.clear();
    stageRefineRetriesRef.current = {};
    handleAbortAll();
    setMessages({});
    messagesRef.current = {};
    resetAllSessionWarmState();
    clearLlmSessionHistory();
    try {
      await clearAcpAgentSessions();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setSessionCleanupNotice(
        `⚠️ 清空全部历史消息时底层 ACP 会话重置异常 (${reason})，已启用 Fail-Closed 保护，请检查连接后重试`
      );
      throw err;
    }
  }, [handleAbortAll, messagesRef, resetAllSessionWarmState, setMessages]);

  return {
    isGenerating,
    setIsGenerating,
    activeExecutions,
    setActiveExecutions,
    activeExecutionsRef,
    activeCascades,
    setActiveCascades,
    activeCascadesRef,
    sessionCleanupNotice,
    setSessionCleanupNotice,
    generationEpochRef,
    turnEpochTrackerRef,
    captureTurnEpoch,
    isTurnStale,
    inFlightHandoverRef,
    stageRefineRetriesRef,
    deliveredStandingContextRef,
    sessionWatermarksRef,
    persistSessionWarmState,
    clearSessionWarmScope,
    resetAllSessionWarmState,
    safelyClearAcpSessions,
    handleAbortAgent,
    handleAbortAll,
    handleClearAllMessages,
  };
}
