import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  TopicMessageData, 
  Message, 
  Agent, 
  ActiveAgentExecution, 
  RulingRecord, 
  RulingDecisionType, 
  GameRoleType,
  McdaDecisionPayload,
  MinorityReport,
  TopicPatchDiffItem
} from '../types';
import { UnifiedAvatar } from './AgentAvatarArtwork';
import { 
  X, 
  GitBranch, 
  CornerDownRight, 
  Send, 
  CheckCircle2, 
  Sparkles,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  FileCode2,
  GitCompare,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  AtSign,
  Copy,
  Check,
  Square,
  Edit3,
  Gavel,
  Scale,
  Swords,
  SlidersHorizontal,
  Plus,
  Trash2,
  AlertTriangle,
  Wrench,
  Play,
  Zap,
  FileText,
  Clock,
  Loader2
} from 'lucide-react';
import { MentionSuggestions } from './MentionSuggestions';
import { renderFormattedContent } from '../utils/formatMentions';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';
import { getDraft, saveDraft, clearDraft } from '../services/draftService';
import { logGameTheoreticTelemetry } from '../services/agentCollaboration';
import { LivingAdrCanvas } from './LivingAdrCanvas';
import { isAgentOffline } from '../utils/agentRuntime';

interface TopicThreadDrawerProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  messages: Message[];
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  allActiveExecutions?: ActiveAgentExecution[];
  onAbortAgent?: (agentId: string) => void;
  onAbortAll?: () => void;
  onClose: () => void;
  onSendMessage: (topicId: string, content: string) => void;
  onResolveTopic: (topicId: string, decision: {
    solution: string;
    impactedFiles: string[];
    approvers: string[];
    rulingRecord?: RulingRecord;
    executorId?: string;
    mcdaPayload?: McdaDecisionPayload;
    minorityReport?: MinorityReport;
  }) => void;
  onReopenTopic?: (topicId: string) => void;
  onExecuteTopicPatch?: (topicId: string, executorId: string) => void;
  onApplyTopicPatch?: (topicId: string) => Promise<void> | void;
  onOpenCodexDiff: (diff: any) => void;
  onEditTopic?: () => void;
  overlappingFiles?: string[];
}

export const TopicThreadDrawer: React.FC<TopicThreadDrawerProps> = ({
  isOpen,
  topic,
  messages,
  agents,
  activeExecutions = [],
  allActiveExecutions = [],
  onAbortAgent,
  onAbortAll,
  onClose,
  onSendMessage,
  onResolveTopic,
  onReopenTopic,
  onExecuteTopicPatch,
  onApplyTopicPatch,
  onOpenCodexDiff,
  onEditTopic,
  overlappingFiles = [],
}) => {
  const [replyContent, setReplyContent] = useState('');
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [solutionDraft, setSolutionDraft] = useState('');
  const [impactedFilesDraft, setImpactedFilesDraft] = useState('src/middleware/auth.ts, src/routes/oauth.ts');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 落地执行 Agent 指派状态
  const [selectedExecutorId, setSelectedExecutorId] = useState('');
  const [showAssignExecutorModal, setShowAssignExecutorModal] = useState(false);
  const [isApplyingPatch, setIsApplyingPatch] = useState(false);

  // 仲裁裁决法槌控制台相关状态 (Arbiter's Gavel Ruling State)
  const [showRulingModal, setShowRulingModal] = useState(false);
  const [rulingType, setRulingType] = useState<RulingDecisionType>('adopt_proposer');
  const [rulingSummary, setRulingSummary] = useState('');
  const [rulingSolution, setRulingSolution] = useState('');
  const [rulingImpactedFiles, setRulingImpactedFiles] = useState('');
  const [tradeOffPoints, setTradeOffPoints] = useState<string[]>([]);
  const [newPointInput, setNewPointInput] = useState('');
  const [exemptionChecked, setExemptionChecked] = useState(false);
  const [exemptionReason, setExemptionReason] = useState('');
  const [activeDrawerView, setActiveDrawerView] = useState<'stream' | 'adr'>('stream');
  const [isRulingDetailExpanded, setIsRulingDetailExpanded] = useState(false);
  const [activeModuleFilterId, setActiveModuleFilterId] = useState<string>('ALL');

  // 顶部议题上下文与推演看板折叠状态 (已仲裁议题默认自动收起为单行摘要，释放纵向历史讨论视口)
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState<boolean>(() => {
    if (topic?.status === 'resolved') return true;
    try {
      return localStorage.getItem('shinobi_topic_context_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  // 切换议题或议题状态变更为已仲裁时：若已仲裁定案则自动收起顶部看板，最大化历史讨论阅读空间
  useEffect(() => {
    if (!isOpen || !topic?.id) return;
    setIsRulingDetailExpanded(false);
    setActiveModuleFilterId('ALL');
    if (topic.status === 'resolved') {
      setIsHeaderCollapsed(true);
    } else {
      try {
        setIsHeaderCollapsed(localStorage.getItem('shinobi_topic_context_collapsed') === 'true');
      } catch {
        setIsHeaderCollapsed(false);
      }
    }
  }, [isOpen, topic?.id, topic?.status]);

  const toggleHeaderCollapsed = useCallback(() => {
    setIsHeaderCollapsed((prev) => {
      const next = !prev;
      if (topic?.status !== 'resolved') {
        try {
          localStorage.setItem('shinobi_topic_context_collapsed', String(next));
        } catch {}
      }
      return next;
    });
  }, [topic?.status]);

  // 底部首席仲裁官法槌控制台折叠状态
  const [isGavelCollapsed, setIsGavelCollapsed] = useState(false);

  const isChallengerQuorumMet =
    topic?.discussionMode !== 'game_theoretic' ||
    topic?.gameTheoreticState?.isChallengerBypassed === true ||
    topic?.gameTheoreticState?.isChallengerResponded !== false;

  const resolveRulingDraftForModal = (
    type: RulingDecisionType
  ): {
    rulingSummary: string;
    rulingSolution: string;
    rulingImpactedFiles: string;
    tradeOffPoints: string[];
  } => {
    const existingDraft = topic?.gameTheoreticState?.rulingDraft;

    // 1. 若综合仲裁官通过 submit_arbitration_ruling 工具已提交草案，优先采用
    if (existingDraft) {
      return {
        rulingSummary: existingDraft.summary || '',
        rulingSolution: existingDraft.solution || '',
        rulingImpactedFiles: (existingDraft.impactedFiles || []).join(', '),
        tradeOffPoints: existingDraft.tradeOffPoints || [],
      };
    }

    // 2. 否则生成清晰干净的默认草案（绝无死板截断与污染前缀）
    const topicTitle = topic?.title || '当前研讨议题';
    const mcda = topic?.gameTheoreticState?.mcdaPayload;
    const tradeOffPoints: string[] = [];

    if (mcda?.computedWeights && mcda?.criteria && mcda.criteria.length >= 2) {
      const sorted = [...mcda.criteria]
        .map((c) => ({ name: c.name, weight: mcda.computedWeights[c.id] ?? 0 }))
        .sort((a, b) => b.weight - a.weight);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      if (top && bottom && top.name !== bottom.name) {
        tradeOffPoints.push(
          `优先保障【${top.name}】(确定性权重 ${(top.weight * 100).toFixed(0)}%)，适度折中【${bottom.name}】开销`
        );
      }
    }

    let rulingSummary = '';
    let rulingSolution = '';

    if (type === 'adopt_proposer') {
      rulingSummary = `经博弈推演与实证检验，围绕“${topicTitle}”的提案方案具备落地可行性与工程优势，准予合并交付。`;
      rulingSolution = `采纳提案官核心架构设计与防御补丁，按标准实施交付并建立运行期监控。`;
      tradeOffPoints.push(`严格执行红队审查确立的边界前置校验，杜绝极端工况下的状态穿透`);
    } else if (type === 'reject_rebuild') {
      rulingSummary = `红队对抗官与接地实证检验揭示“${topicTitle}”方案存在关键架构漏洞或实证证伪，原方案予以驳回重构。`;
      rulingSolution = `驳回当前提案架构。由责任团队全面吸收红队反例要点，重新确立安全假设并提交新版方案。`;
      tradeOffPoints.push(`拒绝以牺牲系统健壮性为代价的局部优化，强制推倒单点失效架构`);
    } else {
      rulingSummary = `围绕“${topicTitle}”，两造各有技术权衡。依据运筹权衡矩阵构建折中方案，分阶段演进推进。`;
      rulingSolution = `采纳折中权衡演进路径：第一阶段快速落地核心主线功能，第二阶段完善防御补偿与容灾审计。`;
      tradeOffPoints.push(`第一阶段优先交付核心基准业务流，沉淀基础能力并收集压测指标`);
    }

    return {
      rulingSummary,
      rulingSolution,
      rulingImpactedFiles: '',
      tradeOffPoints,
    };
  };

  const handleOpenRuling = (type: RulingDecisionType) => {
    setRulingType(type);
    setExemptionChecked(false);
    setExemptionReason('');
    const defaultExecutor = type === 'adopt_proposer'
      ? (topic?.gameRoles?.proposers?.[0] || '')
      : type === 'reject_rebuild'
      ? (topic?.gameRoles?.challengers?.[0] || topic?.gameRoles?.proposers?.[0] || '')
      : (topic?.gameRoles?.proposers?.[0] || topic?.gameRoles?.arbiters?.[0] || '');
    setSelectedExecutorId(defaultExecutor);

    const draft = resolveRulingDraftForModal(type);
    setRulingSummary(draft.rulingSummary);
    setRulingSolution(draft.rulingSolution);
    setRulingImpactedFiles(draft.rulingImpactedFiles);
    setTradeOffPoints(draft.tradeOffPoints);
    setShowRulingModal(true);
  };

  const handleSwitchRulingType = (type: RulingDecisionType) => {
    setRulingType(type);
    const defaultExecutor = type === 'adopt_proposer'
      ? (topic?.gameRoles?.proposers?.[0] || '')
      : type === 'reject_rebuild'
      ? (topic?.gameRoles?.challengers?.[0] || topic?.gameRoles?.proposers?.[0] || '')
      : (topic?.gameRoles?.proposers?.[0] || topic?.gameRoles?.arbiters?.[0] || '');
    setSelectedExecutorId(defaultExecutor);

    const draft = resolveRulingDraftForModal(type);
    setRulingSummary(draft.rulingSummary);
    setRulingSolution(draft.rulingSolution);
    if (draft.tradeOffPoints.length > 0) {
      setTradeOffPoints(draft.tradeOffPoints);
    }
  };

  const handleAddTradeOffPoint = () => {
    if (!newPointInput.trim()) return;
    setTradeOffPoints((prev) => [...prev, newPointInput.trim()]);
    setNewPointInput('');
  };

  const handleRemoveTradeOffPoint = (index: number) => {
    setTradeOffPoints((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConfirmRuling = () => {
    if (!topic?.id) return;
    const resolvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const finalImpactedFiles = rulingImpactedFiles.split(',').map((s) => s.trim()).filter(Boolean);
    const aiArbiterNames = (topic.gameRoles?.arbiters || [])
      .map((id) => agents.find((a) => a.id === id)?.name)
      .filter(Boolean) as string[];

    const arbiterName = topic.gameRoles?.humanIsArbiter 
      ? 'Norris_M5Pro (人类首席仲裁官)' 
      : (aiArbiterNames[0] || 'Shinobi 仲裁官');

    const isConsistencyPassed = topic.gameTheoreticState?.mcdaPayload?.consistencyPassed ?? true;
    const isExempted = (!isChallengerQuorumMet || !isConsistencyPassed) && exemptionChecked;
    const finalExemptionReason = isExempted ? (exemptionReason.trim() || '人类首席仲裁官具名特权豁免') : undefined;

    const rulingRecord: RulingRecord = {
      decisionType: rulingType,
      arbiterId: 'user-norris',
      arbiterName,
      summary: rulingSummary.trim() || '博弈推演裁决已下达',
      solution: rulingSolution.trim() || undefined,
      tradeOffPoints: tradeOffPoints.filter((p) => p.trim().length > 0),
      impactedFiles: finalImpactedFiles,
      decidedAt: resolvedAt,
      exemptionReason: finalExemptionReason,
      executorId: selectedExecutorId || undefined,
      mcdaPayload: topic.gameTheoreticState?.mcdaPayload,
      minorityReport: topic.gameTheoreticState?.minorityReport,
      sprtState: topic.gameTheoreticState?.sprtState,
    };

    // 记录仲裁与三率度量打点 (R-1/R-4)
    logGameTheoreticTelemetry('topic_arbitration_concluded', topic.id, {
      decisionType: rulingType,
      arbiterName,
      executorId: selectedExecutorId,
      autoArbitrated: !topic.gameRoles?.humanIsArbiter && !isExempted,
      autoExecuted: Boolean(selectedExecutorId),
      consistencyPassed: isConsistencyPassed,
      hasExemption: Boolean(isExempted),
    });

    onResolveTopic(topic.id, {
      solution: rulingSolution.trim() || rulingSummary.trim(),
      impactedFiles: finalImpactedFiles,
      approvers: [arbiterName, ...aiArbiterNames],
      rulingRecord,
      executorId: selectedExecutorId || undefined,
    });

    setShowRulingModal(false);
  };

  // 切换议题时，自动载入该议题维度的独立回复草稿
  useEffect(() => {
    if (topic?.id) {
      const saved = getDraft('topic', topic.id);
      setReplyContent(saved);
    } else {
      setReplyContent('');
    }
  }, [topic?.id]);

  const updateReplyContent = (valOrFn: string | ((prev: string) => string)) => {
    const next = typeof valOrFn === 'function' ? valOrFn(replyContent) : valOrFn;
    setReplyContent(next);
    if (topic?.id) {
      saveDraft('topic', topic.id, next);
    }
  };

  const handleClearTopicDraft = () => {
    setReplyContent('');
    if (topic?.id) {
      clearDraft('topic', topic.id);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  };

  // 议题抽屉输入框高度自适应扩展 (最小 44px 约2行，最大 200px 约8行)
  const adjustReplyHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const minHeight = 44;
    const maxHeight = 200;
    const scrollHeight = textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    adjustReplyHeight();
  }, [replyContent, adjustReplyHeight]);

  // @ Mention state for topic reply composer
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: Message;
  } | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const scrollToTopicMessageTop = useCallback((targetMsgId: string) => {
    const el = document.getElementById(`topic-msg-${targetMsgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHighlightedMessageId(targetMsgId);
      setTimeout(() => {
        setHighlightedMessageId((prev) => (prev === targetMsgId ? null : prev));
      }, 2200);
    }
  }, []);

  // Close context menu on global click or Escape
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, message: Message) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 180;
    const menuHeight = 120;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    setContextMenu({ x, y, message });
  };

  const handleCopyMessage = (message: Message) => {
    navigator.clipboard.writeText(message.content);
    setCopiedMsgId(message.id);
    setTimeout(() => setCopiedMsgId(null), 2000);
    setContextMenu(null);
  };

  const handleQuoteInDrawer = (message: Message) => {
    const clean = message.content.trim().split('\n')[0].slice(0, 80);
    updateReplyContent(`> **@${message.authorName}**: ${clean}...\n\n${replyContent}`);
    setTimeout(() => textareaRef.current?.focus(), 50);
    setContextMenu(null);
  };

  // Live execution tracking for topic drawer
  const topicExecutions = activeExecutions.filter(
    (e) => (topic && e.topicId === topic.id) || (topic && e.threadId === topic.id)
  );
  const isExecuting = topicExecutions.length > 0;
  const activeTopicExecution = topicExecutions[0];

  const hasPendingMessage = messages.some((m) => m.isPending);
  const shouldTick = isExecuting || hasPendingMessage;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!shouldTick) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [shouldTick]);

  // Resizable drawer width (persisted in localStorage)
  const { width: drawerWidth, isDragging, handlePointerDown, resetWidth, panelRef } = useResizablePanel({
    direction: 'left',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: () => (typeof window !== 'undefined' ? Math.max(320, Math.min(900, window.innerWidth - 260)) : 800),
    storageKey: 'shinobi_topic_drawer_width',
  });

  // Scroll management: ensure entering a topic always positions to the latest message
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const rulingCardRef = useRef<HTMLDivElement>(null);
  const prevTopicIdRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const c = scrollContainerRef.current;
    isAtBottomRef.current = c.scrollHeight - c.scrollTop - c.clientHeight <= 100;
  }, []);

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: 0, behavior });
      isAtBottomRef.current = false;
    }
  }, []);

  const scrollToRulingCard = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (rulingCardRef.current) {
      rulingCardRef.current.scrollIntoView({ behavior, block: 'start' });
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollContainerRef.current;
    if (container) {
      if (behavior === 'smooth') {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        container.scrollTop = container.scrollHeight;
      }
      isAtBottomRef.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  // 1. 进入议题（打开抽屉或切换议题 ID 时）：立即瞬移至最新消息位置，并用 rAF + 多级微任务防止 Markdown/代码块排版滞后
  useEffect(() => {
    if (!isOpen || !topic?.id) {
      prevTopicIdRef.current = null;
      prevMsgCountRef.current = 0;
      return;
    }

    const isNewTopic = prevTopicIdRef.current !== topic.id;
    prevTopicIdRef.current = topic.id;

    if (isNewTopic) {
      prevMsgCountRef.current = messages.length;
      scrollToBottom('auto');
      const raf = requestAnimationFrame(() => scrollToBottom('auto'));
      const timer1 = setTimeout(() => scrollToBottom('auto'), 40);
      const timer2 = setTimeout(() => scrollToBottom('auto'), 120);
      const timer3 = setTimeout(() => scrollToBottom('auto'), 250);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [isOpen, topic?.id, scrollToBottom, messages.length]);

  const lastMessage = messages[messages.length - 1];
  const lastMessageContentLength = lastMessage?.content?.length || 0;

  // 2. 议题收到新回复、流式 chunk 更新或 Agent 执行状态更新时：若用户位于底部附近则平滑跟随
  useEffect(() => {
    if (!isOpen) return;
    const isFirst = prevMsgCountRef.current === 0;
    const hasNewMessage = messages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (isFirst) {
      scrollToBottom('auto');
      const timer = setTimeout(() => scrollToBottom('auto'), 40);
      return () => clearTimeout(timer);
    } else if (hasNewMessage || topicExecutions.length > 0 || hasPendingMessage) {
      if (isAtBottomRef.current) {
        scrollToBottom('smooth');
      }
    }
  }, [isOpen, messages.length, topicExecutions.length, hasPendingMessage, lastMessageContentLength, scrollToBottom]);

  if (!isOpen || !topic) return null;

  const isResolved = topic.status === 'resolved';

  const participatingIds = new Set(topic.participatingAgentIds || []);
  const topicParticipatingAgents = agents.filter((a) => participatingIds.has(a.id));
  const otherAgents = agents.filter((a) => !participatingIds.has(a.id));
  const candidateAgents = [...topicParticipatingAgents, ...otherAgents];

  // 为博弈模式下的 Agent 候选人附加博弈角色修饰
  const candidateAgentsWithGameRoles = candidateAgents.map((ag) => {
    if (topic.discussionMode === 'game_theoretic' && topic.gameRoles) {
      if (topic.gameRoles.proposers.includes(ag.id)) {
        return { ...ag, role: `[🏛️ 提案官] ${ag.role}` };
      }
      if (topic.gameRoles.challengers.includes(ag.id)) {
        return { ...ag, role: `[⚔️ 红队官] ${ag.role}` };
      }
      if (topic.gameRoles.verifiers && topic.gameRoles.verifiers.includes(ag.id)) {
        return { ...ag, role: `[🔍 接地验证官] ${ag.role}` };
      }
      if (topic.gameRoles.arbiters.includes(ag.id)) {
        return { ...ag, role: `[⚖️ 流程综合官] ${ag.role}` };
      }
    }
    return ag;
  });

  const filteredCandidates = candidateAgentsWithGameRoles.filter(
    (ag) =>
      mentionQuery === '' ||
      ag.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.handle.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.role.toLowerCase().includes(mentionQuery.toLowerCase())
  );
  const showSpecialAll = 'all'.includes(mentionQuery.toLowerCase()) || mentionQuery === '';
  const totalCount = filteredCandidates.length + (showSpecialAll ? 1 : 0);

  const getAgentAvailabilityLabel = (ag: Agent) => {
    const rawAgent = agents.find((a) => a.id === ag.id) || ag;
    if (isAgentOffline(rawAgent)) {
      return '🔌 离线 (需先点击 Start)';
    }
    const busyExec = allActiveExecutions.find((e) => e.agentId === ag.id);
    if (busyExec) {
      return '⏳ 忙碌中 (指派后自动进入队列)';
    }
    return '🟢 在线就绪';
  };

  const topicExecutionDiffs: TopicPatchDiffItem[] = (() => {
    if (topic.gameTheoreticState?.executionDiffs && topic.gameTheoreticState.executionDiffs.length > 0) {
      return topic.gameTheoreticState.executionDiffs;
    }
    const list: TopicPatchDiffItem[] = [];
    messages.forEach((m) => {
      if (m.diffViews && m.diffViews.length > 0) {
        m.diffViews.forEach((d) => {
          if (!list.some((x) => x.filename === d.filename && x.diff === d.diff)) {
            list.push(d);
          }
        });
      } else if (m.diffView) {
        if (!list.some((x) => x.filename === m.diffView!.filename && x.diff === m.diffView!.diff)) {
          list.push(m.diffView);
        }
      }
    });
    return list;
  })();

  const handleApplyPatchClick = async () => {
    if (!onApplyTopicPatch || !topic?.id) return;
    setIsApplyingPatch(true);
    try {
      await onApplyTopicPatch(topic.id);
    } finally {
      setIsApplyingPatch(false);
    }
  };

  const getGameRoleBadge = (msg: Message) => {
    if (topic.discussionMode !== 'game_theoretic' || !topic.gameRoles) return null;
    const { proposers = [], challengers = [], verifiers = [], arbiters = [], humanIsArbiter } = topic.gameRoles;

    if (humanIsArbiter && (msg.authorId === 'user-norris' || msg.authorName === 'Norris_M5Pro' || !msg.isAgent)) {
      return {
        label: '⚖️ 人类首席仲裁官',
        cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 font-semibold',
      };
    }

    const ag = agents.find(
      (a) => a.id === msg.authorId || a.name === msg.authorName || a.handle === msg.authorHandle
    );
    const id = ag ? ag.id : msg.authorId;

    if (proposers.includes(id)) {
      return {
        label: '🏛️ 提案官',
        cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
      };
    }
    if (challengers.includes(id)) {
      return {
        label: '⚔️ 红队对抗',
        cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
      };
    }
    if (verifiers.includes(id)) {
      return {
        label: '🔍 接地验证官',
        cls: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
      };
    }
    if (arbiters.includes(id)) {
      return {
        label: '⚖️ 流程综合官',
        cls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
      };
    }
    return null;
  };

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleSend = () => {
    if (!replyContent.trim() || !topic?.id) return;
    onSendMessage(topic.id, replyContent);
    setReplyContent('');
    if (topic?.id) {
      clearDraft('topic', topic.id);
    }
    setIsMentionOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  };

  const handleSelectMention = (item: { handle: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart || replyContent.length;
    const textBefore = replyContent.slice(0, cursor);
    const textAfter = replyContent.slice(cursor);
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);

    if (match) {
      const atStartPos = match.index! + (match[0].startsWith(' ') ? 1 : 0);
      const newBefore = textBefore.slice(0, atStartPos) + item.handle + ' ';
      const newContent = newBefore + textAfter;
      updateReplyContent(newContent);
      setIsMentionOpen(false);
      setMentionQuery('');
      setMentionIndex(0);

      setTimeout(() => {
        textarea.focus();
        const newCursor = newBefore.length;
        textarea.setSelectionRange(newCursor, newCursor);
      }, 0);
    } else {
      updateReplyContent((prev) => (prev.includes(item.handle) ? prev : `${item.handle} ${prev}`.trim() + ' '));
      setIsMentionOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMentionOpen && totalCount > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % totalCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + totalCount) % totalCount);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected =
          showSpecialAll && mentionIndex === 0
            ? { handle: '@all' }
            : filteredCandidates[showSpecialAll ? mentionIndex - 1 : mentionIndex] || filteredCandidates[0];
        if (selected) {
          handleSelectMention(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsMentionOpen(false);
        return;
      }
    }

    if (isExecuting && e.key === 'Escape') {
      e.preventDefault();
      if (onAbortAll) {
        onAbortAll();
      } else if (onAbortAgent) {
        topicExecutions.forEach((exec) => onAbortAgent(exec.agentId));
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    updateReplyContent(val);

    const cursor = e.target.selectionStart || 0;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);

    if (match) {
      setMentionQuery(match[1]);
      setIsMentionOpen(true);
      setMentionIndex(0);
    } else {
      setIsMentionOpen(false);
    }
  };

  const handleConfirmResolve = () => {
    const solution = solutionDraft.trim() || '采用统一的 OAuth2 回调路由分发器，结合 HMAC-SHA256 签名 state 防篡改机制，实现多租户隔离。';
    const impactedFiles = impactedFilesDraft.split(',').map((s) => s.trim()).filter(Boolean);
    const approverNames = ['Norris_M5Pro', 'Architect-Agent', 'Security-Reviewer'];

    onResolveTopic(topic.id, {
      solution,
      impactedFiles,
      approvers: approverNames,
      executorId: selectedExecutorId || undefined,
      mcdaPayload: topic.gameTheoreticState?.mcdaPayload,
      minorityReport: topic.gameTheoreticState?.minorityReport,
    });
    setShowResolveModal(false);
  };

  const participatingAgents = (topic.participatingAgentIds || [])
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean) as Agent[];

  return (
    <aside
      ref={panelRef as React.RefObject<HTMLElement>}
      id="shinobi-topic-thread-drawer"
      style={{ 
        width: `${drawerWidth}px`, 
        maxWidth: 'calc(100vw - 260px)',
        minWidth: '320px'
      }}
      className="relative bg-surface border-l border-border flex flex-col shrink-0 min-w-[320px] h-full overflow-hidden max-sm:!fixed max-sm:!inset-0 max-sm:!w-full max-sm:!max-w-full max-sm:!z-50 text-xs text-fg-secondary shadow-2xl z-40"
    >
      {/* Draggable Left Resize Handle */}
      <ResizeHandle
        direction="left"
        onPointerDown={handlePointerDown}
        onDoubleClick={resetWidth}
        isDragging={isDragging}
        title="拖动调整议题抽屉宽度，双击恢复默认"
      />
      {/* 1. Drawer Header */}
      <div className="h-12 px-3 sm:px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0 gap-2">
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
            topic.discussionMode === 'game_theoretic'
              ? 'bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400'
              : 'bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300'
          }`}>
            {topic.discussionMode === 'game_theoretic' ? (
              <Swords className="w-3.5 h-3.5" />
            ) : (
              <GitBranch className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="truncate min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate">
              <h2 className="font-bold text-fg truncate text-xs sm:text-sm">
                {topic.title}
              </h2>
              {topic.discussionMode === 'game_theoretic' && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[9px] font-semibold border border-amber-500/30 shrink-0">
                  ♟️ 博弈模式
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-fg-muted font-mono truncate">
              {isResolved ? (
                topic.rulingRecord ? (
                  <span className={`font-semibold flex items-center gap-1 shrink-0 ${
                    topic.rulingRecord.decisionType === 'adopt_proposer'
                      ? 'text-emerald-500'
                      : topic.rulingRecord.decisionType === 'reject_rebuild'
                      ? 'text-rose-500'
                      : 'text-purple-500'
                  }`}>
                    <Scale className="w-3 h-3" />
                    <span>
                      {topic.rulingRecord.decisionType === 'adopt_proposer'
                        ? '⚖️ 仲裁定案 · 采纳主导'
                        : topic.rulingRecord.decisionType === 'reject_rebuild'
                        ? '🔄 仲裁定案 · 驳回重构'
                        : '📊 仲裁定案 · 权衡矩阵'}
                    </span>
                  </span>
                ) : (
                  <span className="text-emerald-500 font-semibold flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>🟢 已达成共识 (Resolved)</span>
                  </span>
                )
              ) : topic.discussionMode === 'game_theoretic' && topic.gameRoles ? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 shrink-0">
                  <Swords className="w-3 h-3" />
                  <span>
                    🏛️ 提案 {topic.gameRoles.proposers?.length || 0} · ⚔️ 红队 {topic.gameRoles.challengers?.length || 0}
                    {topic.gameRoles.verifiers && topic.gameRoles.verifiers.length > 0 ? ` · 🔍 接地 ${topic.gameRoles.verifiers.length}` : ''}
                    {' '}· ⚖️ 综合 {topic.gameRoles.humanIsArbiter ? '👤+' : ''}{topic.gameRoles.arbiters?.length || 0}
                  </span>
                </span>
              ) : isExecuting && topicExecutions.length > 0 ? (
                <span className="text-purple-500 font-semibold flex items-center gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                  {topicExecutions.length === 1 ? (
                    <span>🟡 {topicExecutions[0].agentName} 正在推演 ({((now - topicExecutions[0].startedAt) / 1000).toFixed(1)}s)</span>
                  ) : (
                    <span>🟡 {topicExecutions.length} 位 Agent 正在并发推演 ({topicExecutions.map((e) => e.agentName).join('、')})</span>
                  )}
                </span>
              ) : (
                <span className="text-purple-500 font-semibold flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  <span>🟡 深度推演中 · {participatingAgents.length} 位协作 Agent</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleHeaderCollapsed}
            className={`px-2 py-1 rounded-lg transition-colors cursor-pointer shrink-0 flex items-center gap-1 text-xs border ${
              isHeaderCollapsed
                ? 'text-purple-600 dark:text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 font-medium'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover border-transparent'
            }`}
            title={isHeaderCollapsed ? '展开议题目标与博弈推演看板' : '收起顶部上下文与看板 (扩大消息展示面积)'}
          >
            {isHeaderCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-purple-500" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline text-[11px]">{isHeaderCollapsed ? '展开看板' : '收起看板'}</span>
          </button>
          {onEditTopic && (
            <button
              type="button"
              onClick={onEditTopic}
              className="p-1.5 rounded-lg text-fg-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
              title="编辑议题"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
            title="关闭抽屉 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2px Animated Progress Streamline when Active */}
      {isExecuting && (
        <div className="relative h-[2px] w-full overflow-hidden bg-surface-subtle shrink-0">
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-purple-500 via-accent to-transparent animate-streamline" />
        </div>
      )}

      {/* 2. Topic Anchor Context & Telemetry Dashboard (Collapsible) */}
      {isHeaderCollapsed ? (
        <div
          onClick={toggleHeaderCollapsed}
          className="px-3.5 py-2 bg-surface-subtle/80 hover:bg-surface-subtle border-b border-border flex items-center justify-between text-[11px] cursor-pointer transition-colors group select-none shrink-0"
          title="点击展开议题上下文与博弈推演看板"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono font-medium shrink-0">
              🎯 议题目标
            </span>
            <span className="truncate text-fg-secondary text-[11px]">
              {topic.description || topic.title}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {topic.discussionMode === 'game_theoretic' && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface border border-border text-fg-secondary">
                {topic.gameStage === 'proposal' ? '🏛️ 立论 (1/5)' :
                 topic.gameStage === 'challenge' ? '⚔️ 压测 (2/5)' :
                 topic.gameStage === 'verification' ? '🔍 验证 (3/5)' :
                 topic.gameStage === 'defense' ? '🛡️ 答辩 (4/5)' :
                 topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' ? '⚖️ 仲裁 (5/5)' : '推演中'}
              </span>
            )}
            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-medium group-hover:underline flex items-center gap-0.5">
              <span>展开看板</span>
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
            </span>
          </div>
        </div>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto shrink-0">
          {/* 2. Topic Anchor Context */}
          <div className="p-3.5 bg-surface-subtle border-b border-border text-[11px] space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
                <CornerDownRight className="w-3 h-3" />
                <span>议题发起上下文与目标:</span>
              </span>
              <div className="flex items-center gap-2">
                {onEditTopic && (
                  <button
                    type="button"
                    onClick={onEditTopic}
                    className="text-[10px] text-accent hover:underline flex items-center gap-1 transition-colors cursor-pointer font-medium"
                    title="编辑议题内容与成员"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>编辑</span>
                  </button>
                )}
                <span className="text-[10px] text-fg-muted font-mono">
                  发起人: {topic.authorName} · {topic.timestamp}
                </span>
                <button
                  type="button"
                  onClick={toggleHeaderCollapsed}
                  className="text-[10px] text-fg-muted hover:text-purple-600 dark:hover:text-purple-400 flex items-center gap-0.5 transition-colors cursor-pointer ml-1 font-medium"
                  title="收起顶部上下文与看板"
                >
                  <ChevronUp className="w-3 h-3" />
                  <span>收起</span>
                </button>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-surface border border-border text-fg leading-relaxed select-text">
              {topic.description || topic.title}
            </div>

        {/* 博弈模式 4+1 角色配置概览卡片 */}
        {topic.discussionMode === 'game_theoretic' && topic.gameRoles && (
          <div className={`grid ${topic.gameRoles.verifiers && topic.gameRoles.verifiers.length > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-1.5 pt-1 text-[10px] font-mono`}>
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>🏛️ 提案官</span>
                <span className="text-[9px] opacity-75">({topic.gameRoles.proposers?.length || 0})</span>
              </div>
              <div className="truncate text-fg-secondary">
                {topic.gameRoles.proposers?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}
              </div>
            </div>

            <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>⚔️ 红队对抗</span>
                <span className="text-[9px] opacity-75">({topic.gameRoles.challengers?.length || 0})</span>
              </div>
              <div className="truncate text-fg-secondary">
                {topic.gameRoles.challengers?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}
              </div>
            </div>

            {topic.gameRoles.verifiers && topic.gameRoles.verifiers.length > 0 && (
              <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                <div className="font-semibold flex items-center gap-1 mb-0.5">
                  <span>🔍 接地验证</span>
                  <span className="text-[9px] opacity-75">({topic.gameRoles.verifiers.length})</span>
                </div>
                <div className="truncate text-fg-secondary">
                  {topic.gameRoles.verifiers.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}
                </div>
              </div>
            )}

            <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>⚖️ 综合裁决</span>
                <span className="text-[9px] opacity-75">({topic.gameRoles.humanIsArbiter ? '👤+' : ''}{topic.gameRoles.arbiters?.length || 0})</span>
              </div>
              <div className="truncate text-fg-secondary">
                {topic.gameRoles.humanIsArbiter ? '👤 Norris (持法槌)' : ''}
                {topic.gameRoles.arbiters?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).length > 0
                  ? (topic.gameRoles.humanIsArbiter ? '、' : '') + topic.gameRoles.arbiters?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')
                  : (!topic.gameRoles.humanIsArbiter ? '未指定' : '')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 博弈推演阶段状态机指示器 (Game Theoretic Phase Stepper: 4-Stage or 5-Stage with Grounding Verifier) */}
      {topic.discussionMode === 'game_theoretic' && (
        <div className="px-3.5 py-2 bg-surface-subtle/70 border-b border-border text-[11px]">
          <div className="flex items-center justify-between gap-1 select-none">
            {/* Step 1: 方案立论 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              (topic.gameStage === 'proposal' || !topic.gameStage)
                ? 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300 font-semibold shadow-xs'
                : 'bg-surface border-border text-fg-muted'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                (topic.gameStage === 'proposal' || !topic.gameStage)
                  ? 'bg-blue-500 text-white font-bold'
                  : 'bg-emerald-500/20 text-emerald-600'
              }`}>
                {(topic.gameStage && topic.gameStage !== 'proposal') ? '✓' : '1'}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">🏛️ 方案立论</span>
              </div>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 opacity-40" />

            {/* Step 2: 反例压测 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              topic.gameStage === 'challenge'
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300 font-semibold shadow-xs'
                : topic.gameTheoreticState?.isChallengerBypassed
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium'
                : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold'
                : (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-surface border-border text-fg-muted'
                : 'bg-surface border-border text-fg-muted opacity-60'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                topic.gameStage === 'challenge'
                  ? 'bg-rose-500 text-white font-bold'
                  : topic.gameTheoreticState?.isChallengerBypassed
                  ? 'bg-emerald-500 text-white font-bold'
                  : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-amber-500 text-white font-bold'
                  : (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-emerald-500/20 text-emerald-600'
                  : 'bg-border text-fg-muted'
              }`}>
                {topic.gameStage === 'challenge'
                  ? '2'
                  : topic.gameTheoreticState?.isChallengerBypassed
                  ? '⚡'
                  : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '!'
                  : (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '✓'
                  : '2'}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">
                  {topic.gameTheoreticState?.isChallengerBypassed
                    ? '⚡ 压测旁路'
                    : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'verification' || topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                    ? '⚔️ 压测缺席'
                    : '⚔️ 反例压测'}
                </span>
              </div>
            </div>

            {/* Step 3: 接地验证 (仅当指派了接地验证官时显示) */}
            {topic.gameRoles?.verifiers && topic.gameRoles.verifiers.length > 0 && (
              <>
                <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 opacity-40" />

                <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
                  topic.gameStage === 'verification'
                    ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 font-semibold shadow-xs'
                    : topic.gameTheoreticState?.isVerifierResponded === false && (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold'
                    : (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                    ? 'bg-surface border-border text-fg-muted'
                    : 'bg-surface border-border text-fg-muted opacity-60'
                }`}>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                    topic.gameStage === 'verification'
                      ? 'bg-cyan-500 text-white font-bold'
                      : topic.gameTheoreticState?.isVerifierResponded === false && (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                      ? 'bg-amber-500 text-white font-bold'
                      : (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                      ? 'bg-emerald-500/20 text-emerald-600'
                      : 'bg-border text-fg-muted'
                  }`}>
                    {topic.gameTheoreticState?.isVerifierResponded === false && (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                      ? '!'
                      : (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                      ? '✓'
                      : '3'}
                  </div>
                  <div className="truncate min-w-0">
                    <span className="truncate block font-medium">
                      {topic.gameTheoreticState?.isVerifierResponded === false && (topic.gameStage === 'defense' || topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                        ? '🔍 验证跳过'
                        : '🔍 接地验证'}
                    </span>
                  </div>
                </div>
              </>
            )}

            <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 opacity-40" />

            {/* Step 4: 答辩修正 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              topic.gameStage === 'defense'
                ? 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300 font-semibold shadow-xs'
                : topic.gameTheoreticState?.isDefenseResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold'
                : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-surface border-border text-fg-muted'
                : 'bg-surface border-border text-fg-muted opacity-60'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                topic.gameStage === 'defense'
                  ? 'bg-blue-500 text-white font-bold'
                  : topic.gameTheoreticState?.isDefenseResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-amber-500 text-white font-bold'
                  : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-emerald-500/20 text-emerald-600'
                  : 'bg-border text-fg-muted'
              }`}>
                {topic.gameTheoreticState?.isDefenseResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '!'
                  : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '✓'
                  : (topic.gameRoles?.verifiers && topic.gameRoles.verifiers.length > 0 ? '4' : '3')}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">
                  {topic.gameTheoreticState?.isDefenseResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                    ? '🛡️ 答辩缺席'
                    : '🛡️ 答辩修正'}
                </span>
              </div>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 opacity-40" />

            {/* Step 5: 综合仲裁 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              topic.gameStage === 'concluded' || topic.status === 'resolved'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold'
                : topic.gameStage === 'arbitration'
                ? 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300 font-semibold shadow-xs'
                : 'bg-surface border-border text-fg-muted opacity-60'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                topic.gameStage === 'concluded' || topic.status === 'resolved'
                  ? 'bg-emerald-500 text-white font-bold'
                  : topic.gameStage === 'arbitration'
                  ? 'bg-purple-500 text-white font-bold'
                  : 'bg-border text-fg-muted'
              }`}>
                {topic.gameStage === 'concluded' || topic.status === 'resolved' ? '✓' : (topic.gameRoles?.verifiers && topic.gameRoles.verifiers.length > 0 ? '5' : '4')}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">⚖️ 综合仲裁</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CognoNexus 运行态看板 (G-Frame 模块沙箱矩阵、SPRT 自适应调控、LMAD 局部冲突切片、谄媚度治理与异构模型多样性) */}
      {topic.discussionMode === 'game_theoretic' && (
        topic.gameTheoreticState?.modularState?.enabled ||
        topic.gameTheoreticState?.cognoNexus?.modularState?.enabled ||
        topic.gameTheoreticState?.sprtState ||
        topic.gameTheoreticState?.cognoNexus?.currentDispute ||
        topic.gameTheoreticState?.latestSycophancy ||
        topic.gameTheoreticState?.modelDiversity
      ) && (
        <div className="px-3.5 py-1.5 bg-surface-subtle/40 border-b border-border text-[10px] space-y-1.5">
          {/* G-Frame 模块沙箱矩阵 (Bayesian & Team Game) */}
          {(() => {
            const modularState = topic.gameTheoreticState?.modularState || topic.gameTheoreticState?.cognoNexus?.modularState;
            if (!modularState?.enabled || modularState.modules.length === 0) return null;
            const frozenCount = modularState.modules.filter((m) => m.status === 'frozen').length;
            const entropyReductionPct = ((1 - 1 / modularState.modules.length) * 100).toFixed(0);
            return (
              <div className="p-2 rounded-lg bg-surface border border-border/80 space-y-1.5 shadow-2xs min-w-0 w-full overflow-hidden">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-fg font-semibold">
                    <span>🧩 G-Frame 模块沙箱矩阵 (Bayesian & Team Game)</span>
                    <span className="px-1.5 py-0.2 rounded font-mono text-[9px] text-purple-800 bg-purple-50 border border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30">
                      信息熵压降 {entropyReductionPct}% · {frozenCount}/{modularState.modules.length} 已冻结
                    </span>
                  </div>
                  {modularState.sharedContract && (
                    <span
                      className="text-[9px] font-mono text-fg-muted truncate max-w-[220px]"
                      title={modularState.sharedContract.summary}
                    >
                      📜 公共契约已锁定
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveModuleFilterId('ALL')}
                    className={`px-2 py-0.5 rounded-md font-mono text-[9px] border transition-colors cursor-pointer shrink-0 ${
                      activeModuleFilterId === 'ALL'
                        ? 'text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 font-bold'
                        : 'bg-surface-subtle border-border text-fg-secondary hover:bg-surface-hover'
                    }`}
                  >
                    全部模块 ({messages.length})
                  </button>
                  {modularState.modules.map((mod) => {
                    const isFrozen = mod.status === 'frozen';
                    const isActive = mod.moduleId === modularState.activeModuleId || (mod.status !== 'frozen' && mod.status !== 'pending');
                    const isSelected = activeModuleFilterId === mod.moduleId;
                    const pillClasses = isFrozen
                      ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30'
                      : isActive
                      ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30'
                      : 'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30';

                    return (
                      <button
                        key={mod.moduleId}
                        type="button"
                        onClick={() => setActiveModuleFilterId(isSelected ? 'ALL' : mod.moduleId)}
                        title={`${mod.title}: ${mod.responsibility} | 允许文件: ${mod.allowedFiles.join(', ')}`}
                        className={`px-2 py-0.5 rounded-md font-mono text-[9px] border transition-all cursor-pointer flex items-center gap-1 shrink-0 ${pillClasses} ${
                          isSelected ? 'ring-1 ring-purple-500 font-bold' : 'opacity-90 hover:opacity-100'
                        }`}
                      >
                        <span className="font-bold">[{mod.moduleId}]</span>
                        <span className="truncate max-w-[110px] font-sans">{mod.title}</span>
                        <span>({mod.belief.priorRisk.toFixed(2)}→{mod.belief.posteriorRisk.toFixed(2)})</span>
                        <span>{isFrozen ? '🔒' : mod.belief.routingMode === 'deep_debate' ? '⚔️' : '⚡'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* SPRT 自适应调控条 */}
          {topic.gameTheoreticState?.sprtState && (
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface border border-border/80 shadow-2xs">
              <div className="flex items-center gap-1.5 text-fg">
                <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="font-semibold">Wald-SPRT 序贯调控:</span>
                <span className="font-mono text-[9px] text-fg-muted">
                  轮次 {topic.gameTheoreticState.sprtState.currentRound} · 对齐分 {(topic.gameTheoreticState.sprtState.latestAlignmentScore * 100).toFixed(0)}% · 似然比 Λ={topic.gameTheoreticState.sprtState.logLikelihoodRatio.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {topic.gameTheoreticState.sprtState.calibrationStatus && (
                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${
                    topic.gameTheoreticState.sprtState.calibrationStatus === 'calibrated'
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
                      : topic.gameTheoreticState.sprtState.calibrationStatus === 'fallback'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium'
                      : 'bg-zinc-500/15 text-zinc-500 font-medium'
                  }`}>
                    {topic.gameTheoreticState.sprtState.calibrationStatus === 'calibrated'
                      ? '🎯 动态已校准'
                      : topic.gameTheoreticState.sprtState.calibrationStatus === 'fallback'
                      ? '⚠️ 兜底校准'
                      : '⏳ 初始未校准'}
                  </span>
                )}
                {topic.gameTheoreticState.sprtState.decisionState === 'early_exit' && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium font-sans">
                    ⚡ 高置信早停收敛
                  </span>
                )}
                {topic.gameTheoreticState.sprtState.decisionState === 'deadlock_escalation' && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium font-sans">
                    ⚠️ 底层价值死锁熔断
                  </span>
                )}
                {topic.gameTheoreticState.sprtState.decisionState === 'continue' && (
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 font-medium font-sans">
                    序贯收敛中 [区间: -2.94 ~ +2.94]
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Wave 2 P0-4: 谄媚度治理 (Sycophancy Governance: BSS / DSS / γ) */}
          {topic.gameTheoreticState?.latestSycophancy && (
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface border border-border/80 shadow-2xs">
              <div className="flex items-center gap-1.5 text-fg">
                <ShieldCheck className="w-3 h-3 text-cyan-500 shrink-0" />
                <span className="font-semibold">谄媚度治理 (BSS/DSS):</span>
                <span className="font-mono text-[9px] text-fg-muted">
                  DSS: {(topic.gameTheoreticState.latestSycophancy.dss * 100).toFixed(0)}% · BSS: {(topic.gameTheoreticState.latestSycophancy.bss * 100).toFixed(0)}% · 折减因子 γ={topic.gameTheoreticState.latestSycophancy.discountFactorGamma.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {topic.gameTheoreticState.latestSycophancy.surrenderDetected ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium font-sans">
                    ⚠️ 顺从投降拦截 (Surrender Blocked)
                  </span>
                ) : (
                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${
                    topic.gameTheoreticState.latestSycophancy.sycophancyLevel === 'authentic'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium'
                      : topic.gameTheoreticState.latestSycophancy.sycophancyLevel === 'mild_conformity'
                      ? 'bg-amber-500/15 text-amber-600 font-medium'
                      : 'bg-rose-500/15 text-rose-600 font-medium'
                  }`}>
                    {topic.gameTheoreticState.latestSycophancy.sycophancyLevel === 'authentic' ? '✓ 批判性充分' :
                     topic.gameTheoreticState.latestSycophancy.sycophancyLevel === 'mild_conformity' ? '⚠️ 轻度附和' : '⚠️ 高谄媚偏见'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Wave 2 P0-5: 异构模型多样性指数 (Model Diversity) */}
          {topic.gameTheoreticState?.modelDiversity && (
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface border border-border/80 shadow-2xs">
              <div className="flex items-center gap-1.5 text-fg">
                <BrainCircuit className="w-3 h-3 text-purple-500 shrink-0" />
                <span className="font-semibold">异构模型多样性:</span>
                <span className="font-mono text-[9px] text-fg-muted">
                  指数: {(topic.gameTheoreticState.modelDiversity.score * 100).toFixed(0)}% · 家族: {Object.keys(topic.gameTheoreticState.modelDiversity.familyDistribution).join(', ')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {topic.gameTheoreticState.modelDiversity.isHomogeneous ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium font-sans">
                    ⚠️ 同质化模型偏见警示
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium font-sans">
                    ✓ 异构互补对抗
                  </span>
                )}
              </div>
            </div>
          )}

          {/* LMAD 局部冲突切片焦点 (Wave 3 P1-1: Claim DAG 与图差分定位) */}
          {topic.gameTheoreticState?.cognoNexus?.currentDispute && (
            <div className="p-2 rounded-lg bg-surface border border-border/80 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-fg font-medium">
                <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-semibold">
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>LMAD 局部冲突切片: {topic.gameTheoreticState.cognoNexus.currentDispute.claimTopic}</span>
                </span>
                <div className="flex items-center gap-1">
                  {topic.gameTheoreticState.cognoNexus.currentDispute.rootDisputeNodeId && (
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300">
                      DAG 根源: {topic.gameTheoreticState.cognoNexus.currentDispute.rootDisputeNodeId}
                    </span>
                  )}
                  {topic.gameTheoreticState.cognoNexus.currentDispute.affectedSubgraphNodeIds && topic.gameTheoreticState.cognoNexus.currentDispute.affectedSubgraphNodeIds.length > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300">
                      波及下游: {topic.gameTheoreticState.cognoNexus.currentDispute.affectedSubgraphNodeIds.length} 节点
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-fg-muted">
                    归因: {topic.gameTheoreticState.cognoNexus.currentDispute.rootCause}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] pt-0.5 text-fg-secondary">
                <div className="p-1 rounded bg-surface-subtle border border-border/50 truncate" title={topic.gameTheoreticState.cognoNexus.currentDispute.proposerClaim}>
                  <span className="font-semibold text-emerald-600">立论: </span>
                  {topic.gameTheoreticState.cognoNexus.currentDispute.proposerClaim}
                </div>
                <div className="p-1 rounded bg-surface-subtle border border-border/50 truncate" title={topic.gameTheoreticState.cognoNexus.currentDispute.challengerCritique}>
                  <span className="font-semibold text-rose-600">反例: </span>
                  {topic.gameTheoreticState.cognoNexus.currentDispute.challengerCritique}
                </div>
              </div>
            </div>
          )}

          {/* R-5 三态事实脱水看板 (Tri-State Dehydration & Claim DAG) */}
          {topic.gameTheoreticState?.cognoNexus?.committedStates && topic.gameTheoreticState.cognoNexus.committedStates.length > 0 && (
            <div className="p-2 rounded-lg bg-surface border border-border/80 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-fg font-medium">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                  <ShieldCheck className="w-3 h-3" />
                  <span>三态事实脱水看板 ({topic.gameTheoreticState.cognoNexus.committedStates.length} 项论点收敛 · DAG)</span>
                </span>
                <span className="text-[9px] font-mono text-fg-muted">Tri-State Dehydration</span>
              </div>
              <div className="space-y-1 pt-0.5">
                {topic.gameTheoreticState.cognoNexus.committedStates.slice(0, 3).map((node) => (
                  <div key={node.id} className="flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded bg-surface-subtle text-[9px]">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      {node.depth !== undefined && (
                        <span className="text-[8px] font-mono text-fg-muted/80 shrink-0">L{node.depth}</span>
                      )}
                      <span className="text-fg truncate flex-1" title={node.claim}>{node.claim}</span>
                    </div>
                    <span className={`px-1.5 py-0.2 rounded font-mono shrink-0 text-[8px] ${
                      node.status === 'refuted' 
                        ? 'bg-rose-500/15 text-rose-600 font-bold' 
                        : node.status === 'disputed' 
                        ? 'bg-amber-500/15 text-amber-600 font-bold' 
                        : 'bg-emerald-500/15 text-emerald-600 font-medium'
                    }`}>
                      {node.status === 'refuted' ? '✗ 已证伪' : node.status === 'disputed' ? '⚠️ 争议中' : '✓ 已证实'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Wave 3 P1-3: ColMAD 协同增量事实贡献榜 (Fact Reward & Reputation Leaderboard) */}
          {(topic.gameTheoreticState?.colMadReport || topic.gameTheoreticState?.cognoNexus?.colMadReport) && (() => {
            const report = topic.gameTheoreticState?.colMadReport || topic.gameTheoreticState?.cognoNexus?.colMadReport;
            if (!report || report.leaderboard.length === 0) return null;
            return (
              <div className="p-2 rounded-lg bg-surface border border-border/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-fg font-medium">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>ColMAD 增量事实贡献榜 (Total ΔFact: +{report.totalFactDelta})</span>
                  </span>
                  <span className="text-[9px] font-mono text-fg-muted">Non-zero-sum Fact Rewards</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  {report.leaderboard.map((item, idx) => (
                    <div key={item.agentId} className="flex items-center justify-between p-1.5 rounded bg-surface-subtle border border-border/40 text-[9px]">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-mono text-fg-muted shrink-0">#{idx + 1}</span>
                        <span className="font-medium text-fg truncate" title={item.agentName}>{item.agentName}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 font-mono">
                        <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                          item.reputationLevel === 'pioneer'
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
                            : item.reputationLevel === 'contributor'
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                            : item.reputationLevel === 'redundant'
                            ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                            : 'bg-zinc-500/20 text-zinc-500'
                        }`}>
                          {item.reputationLevel === 'pioneer' ? '🏆 先锋' :
                           item.reputationLevel === 'contributor' ? '✓ 贡献' :
                           item.reputationLevel === 'redundant' ? '⚠️ 冗余' : '常规'}
                        </span>
                        <span className="font-semibold text-fg">+{item.factReward}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  )}

      {/* View Switcher: 攻防辩论流 vs 活体 ADR 决策画布 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0 gap-2">
        <div className="flex items-center gap-1.5 p-0.5 rounded-xl bg-surface-subtle border border-border/60 shrink-0">
          <button
            type="button"
            onClick={() => setActiveDrawerView('stream')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeDrawerView === 'stream'
                ? 'bg-surface text-fg font-semibold shadow-2xs border border-border/80'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover/50'
            }`}
          >
            <span>💬 辩论记录</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-surface-subtle border border-border/40 text-fg-muted">
              {messages.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawerView('adr')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeDrawerView === 'adr'
                ? 'bg-surface text-fg font-semibold shadow-2xs border border-border/80 text-purple-600 dark:text-purple-400'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span>活体 ADR 画布</span>
            {(topic.gameTheoreticState?.rulingDraft || topic.rulingRecord) && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 font-mono font-bold animate-pulse">
                {topic.rulingRecord ? '已定案' : '草案就绪'}
              </span>
            )}
          </button>
        </div>

        {activeDrawerView === 'adr' ? (
          <div className="text-[10px] text-fg-muted font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Architecture Decision Record</span>
          </div>
        ) : isResolved && messages.length > 0 ? (
          <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
            <button
              type="button"
              onClick={() => scrollToTop('smooth')}
              className="px-2 py-0.5 rounded-md bg-surface-subtle hover:bg-surface-hover border border-border text-fg-secondary hover:text-fg transition-colors cursor-pointer flex items-center gap-0.5"
              title="滚动至首条历史讨论记录"
            >
              <span>↑ 首条讨论</span>
            </button>
            <button
              type="button"
              onClick={() => scrollToRulingCard('smooth')}
              className="px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer flex items-center gap-0.5 font-medium"
              title="定位至讨论流底部的终局裁决书归档卡"
            >
              <span>↓ 终局裁决</span>
            </button>
          </div>
        ) : null}
      </div>

      {activeDrawerView === 'adr' ? (
        <LivingAdrCanvas
          topic={topic}
          agents={agents}
          messages={messages}
          activeExecutions={activeExecutions}
          onOpenRuling={(type) => handleOpenRuling(type)}
          onExecutePatch={onExecuteTopicPatch ? () => {
            const initialExec = topic.rulingRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId || candidateAgentsWithGameRoles[0]?.id || '';
            setSelectedExecutorId(initialExec);
            setShowAssignExecutorModal(true);
          } : undefined}
          onOpenCodexDiff={onOpenCodexDiff}
          onApplyTopicPatch={onApplyTopicPatch}
          overlappingFiles={overlappingFiles}
        />
      ) : (
        <>
          {/* 3. Topic Message Stream */}
          <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-4 font-sans select-text min-w-0">
            {activeModuleFilterId !== 'ALL' && (
              <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-500/15 border border-purple-300 dark:border-purple-500/30 flex items-center justify-between gap-2 text-[11px] text-purple-800 dark:text-purple-300">
                <span>🧩 当前已开启物理沙箱隔离视图：仅展示模块 <strong className="font-mono">[{activeModuleFilterId}]</strong> 及全局契约记录</span>
                <button
                  type="button"
                  onClick={() => setActiveModuleFilterId('ALL')}
                  className="px-2 py-0.5 rounded bg-surface border border-border text-fg text-[10px] font-medium hover:bg-surface-hover cursor-pointer shrink-0"
                >
                  显示全部
                </button>
              </div>
            )}
        {messages.length === 0 ? (
          <div className="text-center py-10 text-fg-muted">
            <div className="text-2xl mb-2">💬</div>
            <div className="font-semibold text-fg text-xs">暂无议题深入讨论</div>
            <div className="text-[11px] text-fg-muted mt-1">
              在下方输入框召唤 Agent 开始独立多轮架构论证
            </div>
          </div>
        ) : (
          messages
            .filter((msg) => activeModuleFilterId === 'ALL' || !msg.moduleId || msg.moduleId === activeModuleFilterId)
            .map((msg, msgIdx, visibleMsgs) => {
            const isThinkingOpen = expandedThinking[msg.id] ?? true;
            const isAgent = typeof msg.isAgent === 'boolean'
              ? msg.isAgent
              : Boolean(msg.agentBadge || msg.authorName.includes('Agent') || msg.authorName.includes('Reviewer'));
            const gameRoleBadge = getGameRoleBadge(msg);
            const authorAgent = msg.authorId
              ? agents.find(
                  (a) =>
                    a.id === msg.authorId ||
                    a.name.toLowerCase() === msg.authorName?.toLowerCase() ||
                    (msg.authorHandle && a.handle?.toLowerCase() === msg.authorHandle.toLowerCase())
                )
              : agents.find(
                  (a) =>
                    (msg.authorName && a.name.toLowerCase() === msg.authorName.toLowerCase()) ||
                    (msg.authorHandle && a.handle?.toLowerCase() === msg.authorHandle.toLowerCase())
                );
            const displayAvatar = authorAgent?.avatar || msg.authorAvatar || '🤖';
            const displayName = authorAgent?.name || msg.authorName;
            const isHumanUser =
              msg.authorId === 'user-norris' ||
              msg.authorName === 'Norris_M5Pro' ||
              msg.authorName === 'Norris' ||
              msg.authorAvatar === '👨‍💻' ||
              (!authorAgent && !isAgent && (msg.authorName === 'Norris_M5Pro' || msg.authorName === 'You'));

            const resolveTopicCollaborationTargetId = (preferRoot: boolean): string | null => {
              const collab = msg.collaborationInfo;
              if (!collab) return null;

              let rootId: string | null = null;
              if (collab.rootMessageId && visibleMsgs.some((m) => m.id === collab.rootMessageId)) {
                rootId = collab.rootMessageId;
              } else {
                for (let i = msgIdx - 1; i >= 0; i--) {
                  const candidate = visibleMsgs[i];
                  if (!candidate.isAgent && candidate.authorId !== 'system') {
                    rootId = candidate.id;
                    break;
                  }
                }
              }

              let sourceId: string | null = null;
              if (collab.sourceMessageId && visibleMsgs.some((m) => m.id === collab.sourceMessageId)) {
                sourceId = collab.sourceMessageId;
              } else if (collab.invokedByAgentId || collab.invokedByAgentName) {
                for (let i = msgIdx - 1; i >= 0; i--) {
                  const candidate = visibleMsgs[i];
                  if (
                    (collab.invokedByAgentId && candidate.authorId === collab.invokedByAgentId) ||
                    (collab.invokedByAgentName && candidate.authorName === collab.invokedByAgentName)
                  ) {
                    sourceId = candidate.id;
                    break;
                  }
                }
              }

              if (preferRoot) {
                return rootId || sourceId || (msgIdx > 0 ? visibleMsgs[0].id : null);
              }
              return sourceId || rootId || (msgIdx > 0 ? visibleMsgs[0].id : null);
            };

            return (
              <div
                id={`topic-msg-${msg.id}`}
                key={msg.id}
                onContextMenu={(e) => handleContextMenu(e, msg)}
                className={`space-y-2.5 p-3.5 rounded-2xl border transition-all duration-300 relative scroll-mt-3 ${
                  highlightedMessageId === msg.id
                    ? 'bg-blue-50/90 dark:bg-blue-500/15 border-blue-400 dark:border-blue-400/60 ring-2 ring-blue-400/60 shadow-md'
                    : msg.isPending
                    ? 'bg-purple-500/[0.04] dark:bg-purple-950/20 border-purple-500/40 shadow-xs ring-1 ring-purple-500/20'
                    : 'bg-surface border-border hover:border-purple-500/40 group'
                }`}
              >
                {/* Message Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <div className="shrink-0 mt-0.5 select-none">
                      <UnifiedAvatar
                        isUser={isHumanUser}
                        agent={authorAgent}
                        avatar={displayAvatar}
                        name={displayName}
                        size="sm"
                        className="w-6 h-6"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                      <span className="font-bold text-fg text-xs whitespace-nowrap shrink-0">{displayName}</span>
                      {gameRoleBadge && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 whitespace-nowrap ${gameRoleBadge.cls}`}>
                          {gameRoleBadge.label}
                        </span>
                      )}
                      {msg.moduleId && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 whitespace-nowrap text-purple-800 bg-purple-50 border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 font-semibold">
                          🧩 {msg.moduleId}
                        </span>
                      )}
                      {msg.gameStage && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 whitespace-nowrap ${
                          msg.gameStage === 'proposal'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                            : msg.gameStage === 'challenge'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                            : msg.gameStage === 'verification'
                            ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20'
                            : msg.gameStage === 'defense'
                            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
                            : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                        }`}>
                          {msg.gameStage === 'proposal'
                            ? '🏛️ 方案立论'
                            : msg.gameStage === 'challenge'
                            ? '⚔️ 反例压测'
                            : msg.gameStage === 'verification'
                            ? '🔍 接地验证'
                            : msg.gameStage === 'defense'
                            ? '🛡️ 答辩修正'
                            : '⚖️ 综合仲裁'}
                        </span>
                      )}
                      {msg.isPending ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 font-mono border border-purple-500/30 flex items-center gap-1 shrink-0 animate-pulse">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-purple-500"></span>
                          </span>
                          <span>{msg.agentBadge || '推演中...'}</span>
                        </span>
                      ) : msg.agentBadge ? (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border truncate max-w-[180px] shrink-0 font-medium ${
                            msg.agentBadge === 'Gavel Ready'
                              ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/40 font-semibold'
                              : 'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30'
                          }`}
                          title={msg.agentBadge}
                        >
                          {msg.agentBadge}
                        </span>
                      ) : null}
                      {msg.collaborationInfo && (() => {
                        const collab = msg.collaborationInfo;
                        const hop = collab.hop || 1;
                        const maxHops = collab.maxHops || 12;
                        const progressPct = Math.min(100, Math.max(8, Math.round((hop / maxHops) * 100)));
                        const isNearLimit = !collab.isCircuitBroken && hop >= Math.ceil(maxHops * 0.75);
                        const rawInvoker = collab.invokedByAgentName || collab.invokedByAgentHandle || '提问';
                        const invokerDisplay = rawInvoker.startsWith('@') ? rawInvoker : `@${rawInvoker}`;
                        const rootTargetId = resolveTopicCollaborationTargetId(true);
                        const sourceTargetId = resolveTopicCollaborationTargetId(false);

                        const badgeColorCls = collab.isCircuitBroken
                          ? 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30 font-semibold'
                          : isNearLimit
                          ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30'
                          : 'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30';

                        const barTrackCls = collab.isCircuitBroken
                          ? 'bg-rose-200/80 dark:bg-rose-950/70'
                          : isNearLimit
                          ? 'bg-amber-200/80 dark:bg-amber-950/70'
                          : 'bg-blue-200/80 dark:bg-blue-950/70';

                        const barFillCls = collab.isCircuitBroken
                          ? 'bg-rose-600 dark:bg-rose-400'
                          : isNearLimit
                          ? 'bg-amber-600 dark:bg-amber-400'
                          : 'bg-blue-600 dark:bg-blue-400';

                        return (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 inline-flex items-center gap-1 transition-all ${badgeColorCls}`}
                          >
                            {collab.isCircuitBroken ? (
                              <button
                                type="button"
                                onClick={() => rootTargetId && scrollToTopicMessageTop(rootTargetId)}
                                className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
                                title="已达协同轮次上限自动熔断 · 点击跳转到对应原始提问消息开头"
                              >
                                <span className="whitespace-nowrap">🛡️ 协同熔断</span>
                                <span className={`w-8 h-1.5 rounded-full overflow-hidden inline-flex items-center ${barTrackCls}`}>
                                  <span className={`h-full rounded-full ${barFillCls}`} style={{ width: '100%' }} />
                                </span>
                                <span>{hop}/{maxHops}</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const targetId = rootTargetId || sourceTargetId;
                                    if (targetId) scrollToTopicMessageTop(targetId);
                                  }}
                                  className="inline-flex items-center gap-0.5 cursor-pointer hover:underline underline-offset-2 max-w-[140px]"
                                  title={`响应 ${invokerDisplay} · 点击跳转到对应原始提问消息开头`}
                                >
                                  <CornerDownRight className="w-2.5 h-2.5 shrink-0 opacity-80" />
                                  <span className="truncate">响应 {invokerDisplay}</span>
                                </button>
                                <span className="opacity-30 select-none">|</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const targetId = sourceTargetId || rootTargetId;
                                    if (targetId) scrollToTopicMessageTop(targetId);
                                  }}
                                  className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80 shrink-0"
                                  title={`协同轮次进度 ${hop}/${maxHops} · 点击定位到 ${invokerDisplay} 的触发消息开头`}
                                >
                                  <span className={`w-8 h-1.5 rounded-full overflow-hidden inline-flex items-center ${barTrackCls}`}>
                                    <span
                                      className={`h-full rounded-full transition-all duration-300 ${barFillCls}`}
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </span>
                                  <span className="font-semibold">{hop}/{maxHops}</span>
                                </button>
                              </>
                            )}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto self-start">
                    {msg.isPending ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-purple-500 font-mono font-semibold bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                          ⏱️ {((now - (msg.startedAt || now)) / 1000).toFixed(0)}s
                        </span>
                        {onAbortAgent && (
                          <button
                            type="button"
                            onClick={() => onAbortAgent(msg.authorId)}
                            className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors cursor-pointer border border-red-500/20 font-sans"
                            title={`终止 ${msg.authorName} 的推演`}
                          >
                            终止
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-surface/90 backdrop-blur-xs rounded-md px-1 py-0.5 border border-border/50 shadow-xs">
                          <button
                            onClick={() => handleCopyMessage(msg)}
                            className="p-1 hover:text-fg hover:bg-surface-hover rounded transition-colors cursor-pointer"
                            title="复制内容 (右键亦可)"
                          >
                            {copiedMsgId === msg.id ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3 text-fg-muted" />
                            )}
                          </button>
                          <button
                            onClick={() => handleQuoteInDrawer(msg)}
                            className="p-1 hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer"
                            title="引用回复 (右键亦可)"
                          >
                            <CornerDownRight className="w-3 h-3 text-fg-muted hover:text-accent" />
                          </button>
                        </div>
                        <span className="text-[10px] text-fg-muted font-mono shrink-0 whitespace-nowrap">{msg.timestamp}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Thinking Process Accordion (Finalized messages) */}
                {msg.thinkingProcess && (
                  <div className="rounded-lg bg-surface border border-border overflow-hidden text-[10px]">
                    <button
                      onClick={() => toggleThinking(msg.id)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-fg-muted hover:text-fg transition-colors cursor-pointer bg-surface-subtle"
                    >
                      <div className="flex items-center gap-1.5">
                        <BrainCircuit className="w-3.5 h-3.5 text-accent" />
                        <span className="font-semibold text-fg">
                          Thinking Process ({msg.thinkingProcess.duration} · {msg.thinkingProcess.tokens} tokens)
                        </span>
                      </div>
                      {isThinkingOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {isThinkingOpen && (
                      <div className="p-2.5 border-t border-border font-mono text-[10px] text-fg-secondary leading-relaxed whitespace-pre-wrap bg-surface select-text">
                        <div className="text-accent font-bold mb-1 select-text">推理摘要: {msg.thinkingProcess.summary}</div>
                        <div className="text-fg-muted select-text">{msg.thinkingProcess.detail}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Message Content: Streaming / Pending or Finalized */}
                {msg.isPending ? (
                  <div className="space-y-2">
                    {msg.content && msg.content.trim().length > 0 ? (
                      <div className="relative">
                        <MarkdownRenderer content={msg.content} />
                        <span className="inline-block w-2 h-4 ml-0.5 align-middle bg-purple-500 animate-pulse rounded-xs" />
                        <div className="flex items-center gap-1.5 text-[10px] text-purple-500/80 font-mono mt-2 pt-2 border-t border-purple-500/15">
                          <BrainCircuit className="w-3 h-3 animate-pulse" />
                          <span>实时流式生成中 ({msg.content.length} 字符) · 正在持续输出...</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-3.5 px-4 rounded-xl bg-surface border border-purple-500/20 text-xs text-fg-secondary space-y-2">
                        <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-medium">
                          <BrainCircuit className="w-4 h-4 animate-pulse text-purple-500 shrink-0" />
                          <span>{msg.pendingHint || '正在进行私有检索与技术推演...'}</span>
                        </div>
                        <div className="text-[11px] text-fg-muted leading-relaxed font-sans pl-6">
                          💡 提示：深度思考与反例边界证伪耗时较长（通常需要 1~5 分钟）。ACP 正在分析工作空间上下文，生成内容将实时流式渲染于此处。
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <MarkdownRenderer content={msg.content} />
                    {/* Unified Diff View */}
                    {msg.diffView && (
                      <div className="p-2.5 rounded-lg bg-surface border border-border font-mono text-[10px]">
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileCode2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="text-fg font-semibold truncate">{msg.diffView.filename}</span>
                            {msg.diffViews && msg.diffViews.length > 1 && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-sans text-[9px]">
                                共 {msg.diffViews.length} 个文件
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-emerald-500 font-bold">+{msg.diffView.additions}</span>
                            <span className="text-red-500 font-bold">-{msg.diffView.deletions}</span>
                            <button
                              type="button"
                              onClick={() =>
                                onOpenCodexDiff({
                                  ...msg.diffView!,
                                  topicId: topic.id,
                                  topicTitle: topic.title,
                                  allDiffs: msg.diffViews || topicExecutionDiffs,
                                  executionStatus: topic.gameTheoreticState?.executionStatus,
                                  artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                                })
                              }
                              className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-[9px] font-sans flex items-center gap-0.5 ml-1 transition-colors cursor-pointer shrink-0"
                            >
                              <span>Codex 视图</span>
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                            {onApplyTopicPatch && topic.gameTheoreticState?.executionStatus !== 'applied' && (
                              <button
                                type="button"
                                disabled={isApplyingPatch}
                                onClick={handleApplyPatchClick}
                                className="px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[9px] font-sans font-semibold flex items-center gap-0.5 transition-colors cursor-pointer shrink-0"
                              >
                                {isApplyingPatch ? (
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                ) : (
                                  <Zap className="w-2.5 h-2.5" />
                                )}
                                <span>合入工作区</span>
                              </button>
                            )}
                            {topic.gameTheoreticState?.executionStatus === 'applied' && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[9px] font-sans font-semibold">
                                ✓ 已合入
                              </span>
                            )}
                          </div>
                        </div>
                        <pre className="p-2 rounded bg-surface-subtle border border-border overflow-x-auto text-[10px] text-fg-secondary leading-relaxed select-text max-h-40">
                          {msg.diffView.diff}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}

        {/* Topic In-Thread Live Thinking Stepper (仅显示尚未在消息流中渲染 isPending 卡片的执行中 Agent) */}
        {(() => {
          const pendingAuthorIds = new Set(messages.filter((m) => m.isPending).map((m) => m.authorId));
          const unrenderedExecutions = topicExecutions.filter((exec) => !pendingAuthorIds.has(exec.agentId));
          if (!isExecuting || unrenderedExecutions.length === 0) return null;
          return (
            <div className="space-y-2">
              {unrenderedExecutions.map((exec) => {
                const isQueued = exec.status === 'queued';
                return (
                  <div
                    key={exec.agentId}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 animate-in fade-in duration-150 ${
                      isQueued
                        ? 'bg-surface border-border text-fg-muted'
                        : 'bg-purple-500/10 border-purple-500/30 text-fg'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      {(() => {
                        const execAgent = agents.find((a) => a.id === exec.agentId);
                        return (
                          <span className={`font-semibold flex items-center gap-1.5 ${
                            isQueued ? 'text-fg-muted' : 'text-purple-600 dark:text-purple-400'
                          }`}>
                            <UnifiedAvatar
                              agent={execAgent}
                              avatar={execAgent?.avatar || exec.agentAvatar}
                              name={execAgent?.name || exec.agentName}
                              size="xs"
                              className="w-4 h-4"
                            />
                            <BrainCircuit className={`w-3.5 h-3.5 ${isQueued ? 'opacity-60' : 'animate-pulse text-purple-500'}`} />
                            <span>{execAgent?.name || exec.agentName} {isQueued ? '排队等待接力' : '正在论证推演中'}</span>
                          </span>
                        );
                      })()}
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-semibold ${isQueued ? 'text-fg-muted' : 'text-purple-500'}`}>
                          {((now - exec.startedAt) / 1000).toFixed(1)}s
                        </span>
                        {onAbortAgent && (
                          <button
                            type="button"
                            onClick={() => onAbortAgent(exec.agentId)}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors cursor-pointer"
                            title={`终止 ${exec.agentName} 的推演`}
                          >
                            终止
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-fg-muted font-mono leading-relaxed">
                      {exec.currentActionDetail || (isQueued ? '排队等待协同推演中...' : '正在评估架构方案、校验多分支边界...')}
                    </p>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* In-Stream Final Ruling / Consensus Archive Card (随历史讨论消息流一起上下滚动) */}
        {isResolved && (
          <div ref={rulingCardRef} className="space-y-2.5 pt-2">
            <div className="flex items-center gap-2 py-1 select-none">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-fg-muted px-2.5 py-0.5 rounded-full bg-surface-subtle border border-border flex items-center gap-1.5">
                <Scale className="w-3 h-3 text-amber-500" />
                <span>终局裁决与共识归档卡 · 向上滚动可自由翻阅全部 {messages.length} 条历史讨论</span>
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {topic.rulingRecord ? (
              <div className={`p-3.5 rounded-2xl border text-xs font-sans space-y-2.5 shadow-sm ${
                topic.rulingRecord.decisionType === 'adopt_proposer'
                  ? 'bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                  : topic.rulingRecord.decisionType === 'reject_rebuild'
                  ? 'bg-rose-50/70 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30'
                  : 'bg-purple-50/70 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30'
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className={`flex items-center gap-1.5 font-bold ${
                    topic.rulingRecord.decisionType === 'adopt_proposer'
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : topic.rulingRecord.decisionType === 'reject_rebuild'
                      ? 'text-rose-800 dark:text-rose-300'
                      : 'text-purple-800 dark:text-purple-300'
                  }`}>
                    <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      {topic.rulingRecord.decisionType === 'adopt_proposer'
                        ? '⚖️ 仲裁裁决：采纳主导方案'
                        : topic.rulingRecord.decisionType === 'reject_rebuild'
                        ? '🔄 仲裁裁决：采纳挑战驳回重构'
                        : '📊 仲裁裁决：达成架构权衡矩阵'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono font-medium text-fg-secondary">{topic.rulingRecord.decidedAt}</span>
                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTop('smooth')}
                        className="px-2 py-0.5 rounded-md bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="滚动回到第一条历史讨论记录"
                      >
                        <span>↑ 回到顶部翻阅</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveDrawerView('adr')}
                      className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-500/15 border border-purple-300 dark:border-purple-500/30 hover:bg-purple-100 dark:hover:bg-purple-500/25 text-purple-800 dark:text-purple-300 text-[10px] font-mono font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="切换至活体 ADR 画布查看完整结构化架构决策文档"
                    >
                      <FileText className="w-2.5 h-2.5" />
                      <span>ADR 画布</span>
                    </button>
                    {onReopenTopic && (
                      <button
                        type="button"
                        onClick={() => onReopenTopic(topic.id)}
                        className="px-2 py-0.5 rounded-md bg-surface border border-border hover:bg-surface-hover text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="重开博弈推演"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>重开</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-[11px] leading-relaxed font-medium text-fg select-text">
                  {topic.rulingRecord.summary}
                </div>

                {topic.rulingRecord.solution && (
                  <div className="text-[10px] select-text p-2.5 rounded-xl bg-surface dark:bg-surface/70 border border-border leading-relaxed">
                    <span className="font-semibold text-fg">落地推进方案：</span>
                    <span className="text-fg-secondary">{topic.rulingRecord.solution}</span>
                  </div>
                )}

                {topic.rulingRecord.tradeOffPoints && topic.rulingRecord.tradeOffPoints.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-fg">关键权衡折中要点：</div>
                    <ul className="list-disc list-inside text-[10px] text-fg-secondary space-y-0.5">
                      {topic.rulingRecord.tradeOffPoints.map((pt, i) => (
                        <li key={i}>{pt}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 可折叠的深度运筹矩阵与少数派异议报告（默认折叠以保持流内卡片紧凑，不遮挡上文历史消息） */}
                {Boolean(
                  topic.rulingRecord.mcdaPayload ||
                    topic.gameTheoreticState?.mcdaPayload ||
                    topic.rulingRecord.minorityReport ||
                    topic.gameTheoreticState?.minorityReport
                ) && (
                  <div className="space-y-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setIsRulingDetailExpanded((prev) => !prev)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-hover border border-border flex items-center justify-between text-[10px] text-fg-secondary hover:text-fg transition-colors cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        <Scale className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>
                          {isRulingDetailExpanded ? '收起' : '展开'} MCDA 运筹决策矩阵
                          {(topic.rulingRecord.minorityReport || topic.gameTheoreticState?.minorityReport)
                            ? ' & 伴生少数派异议报告'
                            : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-purple-700 dark:text-purple-400 font-mono font-medium">
                        <span>{isRulingDetailExpanded ? '收起详情' : '查看详情'}</span>
                        {isRulingDetailExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </div>
                    </button>

                    {isRulingDetailExpanded && (
                      <div className="space-y-2 animate-in fade-in duration-150">
                        {/* CognoNexus 神经符号 MCDA 确定性决策分析矩阵 */}
                        {(topic.rulingRecord.mcdaPayload || topic.gameTheoreticState?.mcdaPayload) && (() => {
                          const mcda = topic.rulingRecord.mcdaPayload || topic.gameTheoreticState?.mcdaPayload;
                          if (!mcda) return null;
                          return (
                            <div className="space-y-1.5 p-2 rounded-lg bg-surface border border-border shadow-2xs">
                              <div className="flex items-center justify-between text-[10px]">
                                <div className="flex items-center gap-1.5 font-bold text-fg">
                                  <Scale className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                  <span>MCDA 运筹决策矩阵 (BWM 最优最劣法)</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {mcda.confidenceMatrix && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-50 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25 font-medium">
                                      ReConcile 置信度加权
                                    </span>
                                  )}
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border ${
                                    mcda.consistencyPassed 
                                      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/25' 
                                      : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/25'
                                  }`}>
                                    ξ* = {mcda.consistencyIndex} ({mcda.consistencyPassed ? '✓ 逻辑严密一致' : '⚠️ 需关注'})
                                  </span>
                                </div>
                              </div>

                              {/* Criteria Weights */}
                              <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                                {mcda.criteria.map((c) => (
                                  <div key={c.id} className="p-1 rounded bg-surface-subtle border border-border/60 text-center">
                                    <div className="text-fg-secondary truncate">{c.name.split('与')[0]}</div>
                                    <div className="font-bold text-fg">{((mcda.computedWeights[c.id] || 0) * 100).toFixed(1)}%</div>
                                  </div>
                                ))}
                              </div>

                              {/* Mathematical Ranking */}
                              <div className="space-y-1 pt-1 border-t border-border/60">
                                <div className="text-[9px] font-semibold text-fg-secondary">运筹效用综合评分排名:</div>
                                {mcda.ranking.map((r) => (
                                  <div key={r.rank} className="flex items-center justify-between text-[9px] px-1.5 py-0.5 rounded bg-surface-subtle">
                                    <span className="font-medium text-fg truncate">#{r.rank} {r.alternative.split(' (')[0]}</span>
                                    <span className="font-mono text-fg-secondary">效用: {(r.totalUtility * 10).toFixed(2)} / 10</span>
                                  </div>
                                ))}
                              </div>

                              {/* CognoNexus 实证打分溯源链 (Audit Provenance) */}
                              {mcda.scoreProvenance && Object.keys(mcda.scoreProvenance).length > 0 && (
                                <div className="space-y-1 pt-1.5 border-t border-border/60">
                                  <div className="text-[9px] font-semibold text-fg-secondary flex items-center justify-between">
                                    <span>实证打分溯源链 (Audit Provenance):</span>
                                    <span className="text-[8px] text-accent font-mono">神经符号绑定</span>
                                  </div>
                                  <div className="space-y-1 text-[8px] text-fg-secondary">
                                    {Object.entries(mcda.scoreProvenance).map(([altName, critMap]) => (
                                      <div key={altName} className="p-1 rounded bg-surface-subtle border border-border/50">
                                        <span className="font-semibold text-fg block truncate">{altName.split(' (')[0]}</span>
                                        <div className="space-y-0.5 mt-0.5">
                                          {Object.entries(critMap).map(([critId, reason]) => {
                                            const cName = mcda.criteria.find((c) => c.id === critId)?.name.split('与')[0] || critId;
                                            return (
                                              <div key={critId} className="flex items-start gap-1">
                                                <span className="text-fg-muted shrink-0">[{cName}]:</span>
                                                <span className="truncate">{reason}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* CognoNexus 伴生少数派异议报告 */}
                        {(topic.rulingRecord.minorityReport || topic.gameTheoreticState?.minorityReport) && (() => {
                          const mr = topic.rulingRecord.minorityReport || topic.gameTheoreticState?.minorityReport;
                          if (!mr) return null;
                          return (
                            <div className="space-y-1.5 p-2 rounded-lg bg-surface border border-border shadow-2xs">
                              <div className="flex items-center justify-between text-[10px]">
                                <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>伴生少数派异议报告 (Minority Report)</span>
                                </div>
                                <span className="text-[9px] text-fg-secondary font-mono">{mr.dissentingAgentName}</span>
                              </div>
                              <div className="text-[9px] text-fg-secondary leading-relaxed">
                                <span className="font-semibold text-fg">保留立场：</span>{mr.coreDissentThesis}
                              </div>
                              <div className="text-[9px] text-fg-secondary">
                                <span className="font-semibold text-fg">自洽依据：</span>{mr.rationalityBasis}
                              </div>
                              {mr.reopeningTriggers && mr.reopeningTriggers.length > 0 && (
                                <div className="pt-1 border-t border-border/60">
                                  <span className="text-[9px] font-semibold text-amber-800 dark:text-amber-400">🚨 黑天鹅重启判定条件：</span>
                                  <ul className="list-disc list-inside text-[9px] text-fg-secondary space-y-0.5 mt-0.5">
                                    {mr.reopeningTriggers.map((t, idx) => (
                                      <li key={idx}>{t}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[9px] text-fg-secondary font-mono flex items-center justify-between pt-1 border-t border-border/60">
                  <span>裁决官: {topic.rulingRecord.arbiterName}</span>
                  {topic.rulingRecord.impactedFiles && topic.rulingRecord.impactedFiles.length > 0 && (
                    <span className="truncate max-w-[200px]" title={topic.rulingRecord.impactedFiles.join(', ')}>
                      涉及: {topic.rulingRecord.impactedFiles.join(', ')}
                    </span>
                  )}
                </div>

                {/* Post-Arbitration Execution Status Row */}
                <div className="pt-2 border-t border-border/60 flex flex-col gap-2">
                  {overlappingFiles.length > 0 && (
                    <div className="px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-[10px] text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="truncate">
                        ⚠️ 与其他并行落地议题重叠文件: <code className="font-mono">{overlappingFiles.join(', ')}</code>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-[10px] min-w-0">
                      <Wrench className="w-3 h-3 text-fg-secondary shrink-0" />
                      <span className="text-fg-secondary shrink-0">落地执行:</span>
                      {(() => {
                        const executorId = topic.rulingRecord.executorId || topic.gameTheoreticState?.assignedExecutorId || topic.decisionRecord?.executorId;
                        const executorAgent = agents.find((a) => a.id === executorId);
                        const status = topic.gameTheoreticState?.executionStatus || (executorId ? 'completed' : 'idle');
                        if (!executorId) {
                          return <span className="text-fg-muted font-sans">未指派 (仅架构推演)</span>;
                        }
                        return (
                          <span className="flex items-center gap-1 font-mono font-medium flex-wrap">
                            <span className="text-fg">{executorAgent ? executorAgent.name : executorId}</span>
                            {status === 'queued' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-sans">
                                <Clock className="w-2.5 h-2.5" />
                                排队等待中...
                              </span>
                            )}
                            {status === 'running' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-sans">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 animate-ping" />
                                正在执行决议...
                              </span>
                            )}
                            {status === 'completed' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-sans">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                {topic.gameTheoreticState?.executionUiMeta?.statusSummary ||
                                  (topicExecutionDiffs.length > 0 ? '工作区变更就绪' : '决议已交付')}
                              </span>
                            )}
                            {status === 'applied' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-600 text-white font-sans font-semibold">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                已合入工作区
                              </span>
                            )}
                            {status === 'failed' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 font-sans">
                                执行异常
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {topicExecutionDiffs.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCodexDiff({
                              ...topicExecutionDiffs[0],
                              topicId: topic.id,
                              topicTitle: topic.title,
                              allDiffs: topicExecutionDiffs,
                              executionStatus: topic.gameTheoreticState?.executionStatus,
                              artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                            })
                          }
                          className="px-2 py-1 rounded-lg bg-surface border border-emerald-400 dark:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          title="在 Codex Diff 视图中审查生成的变更"
                        >
                          <GitCompare className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>
                            {topic.gameTheoreticState?.executionUiMeta?.reviewActionLabel || '审查变更'} ({topicExecutionDiffs.length})
                          </span>
                        </button>
                      )}

                      {topicExecutionDiffs.length > 0 && onApplyTopicPatch && topic.gameTheoreticState?.executionStatus !== 'applied' && (
                        <button
                          type="button"
                          disabled={isApplyingPatch}
                          onClick={handleApplyPatchClick}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                          title="将生成的变更物理合入本地工作区并归档产物"
                        >
                          {isApplyingPatch ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>写入中...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-3 h-3" />
                              <span>
                                {topic.gameTheoreticState?.executionUiMeta?.applyActionLabel || '一键合入工作区'}
                              </span>
                            </>
                          )}
                        </button>
                      )}

                      {onExecuteTopicPatch && (
                        <button
                          type="button"
                          onClick={() => {
                            const initialExec = topic.rulingRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId || candidateAgentsWithGameRoles[0]?.id || '';
                            setSelectedExecutorId(initialExec);
                            setShowAssignExecutorModal(true);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-accent/50 hover:bg-surface-hover text-fg text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer shrink-0"
                          title="指派落地 Agent 推进定案决议"
                        >
                          <Wrench className="w-3 h-3 text-accent" />
                          <span>{topic.rulingRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId ? '重新指派' : '指派落地 Agent'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 flex flex-col gap-2.5 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="text-[11px] font-semibold">
                      本议题已达成共识并归档
                      <div className="text-[9px] text-emerald-700 dark:text-emerald-400/90 font-normal">
                        决策结论已合流至主频道时间轴
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTop('smooth')}
                        className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="滚动回到第一条历史讨论记录"
                      >
                        <span>↑ 回到顶部翻阅</span>
                      </button>
                    )}
                    {topicExecutionDiffs.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenCodexDiff({
                            ...topicExecutionDiffs[0],
                            topicId: topic.id,
                            topicTitle: topic.title,
                            allDiffs: topicExecutionDiffs,
                            executionStatus: topic.gameTheoreticState?.executionStatus,
                            artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                          })
                        }
                        className="px-2 py-1 rounded-lg bg-surface border border-emerald-400 dark:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <GitCompare className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          {topic.gameTheoreticState?.executionUiMeta?.reviewActionLabel || '审查变更'} ({topicExecutionDiffs.length})
                        </span>
                      </button>
                    )}
                    {topicExecutionDiffs.length > 0 && onApplyTopicPatch && topic.gameTheoreticState?.executionStatus !== 'applied' && (
                      <button
                        type="button"
                        disabled={isApplyingPatch}
                        onClick={handleApplyPatchClick}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                      >
                        {isApplyingPatch ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        <span>
                          {topic.gameTheoreticState?.executionUiMeta?.applyActionLabel || '一键合入工作区'}
                        </span>
                      </button>
                    )}
                    {onExecuteTopicPatch && (
                      <button
                        type="button"
                        onClick={() => {
                          const initialExec = topic.decisionRecord?.executorId || candidateAgentsWithGameRoles[0]?.id || '';
                          setSelectedExecutorId(initialExec);
                          setShowAssignExecutorModal(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-accent/50 hover:bg-surface-hover text-fg text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer shrink-0"
                        title="指派落地 Agent 推进定案决议"
                      >
                        <Wrench className="w-3 h-3 text-accent" />
                        <span>{topic.decisionRecord?.executorId ? '重新指派' : '指派落地 Agent'}</span>
                      </button>
                    )}
                    {onReopenTopic && (
                      <button
                        type="button"
                        onClick={() => onReopenTopic(topic.id)}
                        className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="重新激活此议题讨论"
                      >
                        <RotateCcw className="w-3 h-3 text-fg-muted" />
                        <span>重开</span>
                      </button>
                    )}
                  </div>
                </div>

                {topic.decisionRecord?.solution && (
                  <div className="text-[11px] select-text p-2.5 rounded-xl bg-surface dark:bg-surface/70 border border-emerald-200 dark:border-emerald-500/20 leading-relaxed text-fg">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300">最终选定方案：</span>
                    <span>{topic.decisionRecord.solution}</span>
                  </div>
                )}

                {(topic.decisionRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId) && (
                  <div className="pt-1.5 border-t border-emerald-200 dark:border-emerald-500/20 flex items-center gap-2 text-[10px] text-emerald-800 dark:text-emerald-300 flex-wrap">
                    <Wrench className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>落地执行 Agent:</span>
                    <span className="font-mono font-semibold">
                      {agents.find((a) => a.id === (topic.decisionRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId))?.name ||
                        topic.decisionRecord?.executorId ||
                        topic.gameTheoreticState?.assignedExecutorId}
                    </span>
                    {topic.gameTheoreticState?.executionStatus === 'queued' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-sans">
                        <Clock className="w-2.5 h-2.5" />
                        排队等待中...
                      </span>
                    )}
                    {topic.gameTheoreticState?.executionStatus === 'running' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 animate-ping" />
                        正在执行决议...
                      </span>
                    )}
                    {topic.gameTheoreticState?.executionStatus === 'completed' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-sans font-medium">
                        {topic.gameTheoreticState?.executionUiMeta?.statusSummary ||
                          (topicExecutionDiffs.length > 0 ? '工作区变更就绪' : '决议已交付')}
                      </span>
                    )}
                    {topic.gameTheoreticState?.executionStatus === 'applied' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-600 text-white font-sans font-semibold">
                        ✓ 已合入本地工作区
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom anchor for scrolling */}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. Consensus Rollup Banner / Arbiter Gavel Console */}
      <div className="p-3 border-t border-border bg-surface-subtle space-y-2 shrink-0">
        {isResolved ? (
          <div className={`px-2.5 py-1.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 flex-wrap ${
            topic.rulingRecord
              ? topic.rulingRecord.decisionType === 'adopt_proposer'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : topic.rulingRecord.decisionType === 'reject_rebuild'
                ? 'bg-rose-500/10 border-rose-500/30'
                : 'bg-purple-500/10 border-purple-500/30'
              : 'bg-emerald-500/10 border-emerald-500/30'
          }`}>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {topic.rulingRecord ? (
                <Scale className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              )}
              <span className="font-semibold text-fg truncate">
                {topic.rulingRecord
                  ? topic.rulingRecord.decisionType === 'adopt_proposer'
                    ? '已仲裁：采纳主导方案'
                    : topic.rulingRecord.decisionType === 'reject_rebuild'
                    ? '已仲裁：采纳挑战驳回重构'
                    : '已仲裁：达成架构权衡矩阵'
                  : '本议题已达成共识归档'}
              </span>
              <button
                type="button"
                onClick={() => scrollToRulingCard('smooth')}
                className="text-[10px] text-accent hover:underline font-mono shrink-0 cursor-pointer ml-1"
                title="定位至讨论流底部的终局裁决书归档卡片"
              >
                [定位裁决卡]
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              {topicExecutionDiffs.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenCodexDiff({
                      ...topicExecutionDiffs[0],
                      topicId: topic.id,
                      topicTitle: topic.title,
                      allDiffs: topicExecutionDiffs,
                      executionStatus: topic.gameTheoreticState?.executionStatus,
                      artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                    })
                  }
                  className="px-2 py-0.5 rounded-md bg-surface border border-emerald-500/40 hover:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="在 Codex Diff 视图中审查生成的变更"
                >
                  <GitCompare className="w-3 h-3 text-emerald-500" />
                  <span>审查变更 ({topicExecutionDiffs.length})</span>
                </button>
              )}
              {topicExecutionDiffs.length > 0 && onApplyTopicPatch && topic.gameTheoreticState?.executionStatus !== 'applied' && (
                <button
                  type="button"
                  disabled={isApplyingPatch}
                  onClick={handleApplyPatchClick}
                  className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                  title="将生成的变更物理合入本地工作区"
                >
                  {isApplyingPatch ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Zap className="w-2.5 h-2.5" />}
                  <span>一键合入</span>
                </button>
              )}
              {onExecuteTopicPatch && (
                <button
                  type="button"
                  onClick={() => {
                    const initialExec = topic.rulingRecord?.executorId || topic.decisionRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId || candidateAgentsWithGameRoles[0]?.id || '';
                    setSelectedExecutorId(initialExec);
                    setShowAssignExecutorModal(true);
                  }}
                  className="px-2 py-0.5 rounded-md bg-surface border border-border hover:border-accent/50 hover:bg-surface-hover text-fg text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="指派落地 Agent 推进定案决议"
                >
                  <Wrench className="w-2.5 h-2.5 text-accent" />
                  <span>{topic.rulingRecord?.executorId || topic.decisionRecord?.executorId || topic.gameTheoreticState?.assignedExecutorId ? '重新指派' : '指派落地'}</span>
                </button>
              )}
              {onReopenTopic && (
                <button
                  type="button"
                  onClick={() => onReopenTopic(topic.id)}
                  className="px-2 py-0.5 rounded-md bg-surface border border-border hover:bg-surface-hover text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                  title="重新开启此议题推演"
                >
                  <RotateCcw className="w-2.5 h-2.5 text-fg-muted" />
                  <span>重开</span>
                </button>
              )}
            </div>
          </div>
        ) : topic.discussionMode === 'game_theoretic' ? (
          (topic.gameRoles?.humanIsArbiter ?? true) ? (
            <div className="space-y-2 p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/25 border border-amber-300/80 dark:border-amber-700/50 shadow-xs">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-bold text-amber-950 dark:text-amber-100">
                  <Gavel className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>人类首席仲裁官法槌控制台 (Chief Arbiter's Gavel)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsGavelCollapsed(!isGavelCollapsed)}
                    className="text-[10px] text-amber-800 dark:text-amber-200 hover:text-amber-950 dark:hover:text-amber-50 flex items-center gap-0.5 transition-colors cursor-pointer font-normal px-1 py-0.5 rounded hover:bg-amber-500/10"
                    title={isGavelCollapsed ? "展开法槌操作按钮" : "收起法槌操作按钮"}
                  >
                    <span>{isGavelCollapsed ? '展开操作' : '收起'}</span>
                    {isGavelCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                  </button>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-600 dark:bg-amber-500 text-white font-bold shadow-2xs flex items-center gap-1 tracking-tight">
                    👑 终局裁决权
                  </span>
                </div>
              </div>
              {!isGavelCollapsed && (
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenRuling('adopt_proposer')}
                    className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                    title="认可提案官方案的可行性与完整度，直接定案"
                  >
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>采纳提案</span>
                    </div>
                    <span className="text-[9px] font-normal opacity-85">通过提案方案</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenRuling('reject_rebuild')}
                    className="py-1.5 px-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                    title="认可红队指出的严重隐患与反例，裁定驳回重构"
                  >
                    <div className="flex items-center gap-1">
                      <RotateCcw className="w-3 h-3 shrink-0" />
                      <span>采纳红队</span>
                    </div>
                    <span className="text-[9px] font-normal opacity-85">驳回重构架构</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenRuling('trade_off_matrix')}
                    className="py-1.5 px-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                    title="提案与红队各具合理性，生成权衡折中矩阵并定案"
                  >
                    <div className="flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3 shrink-0" />
                      <span>权衡矩阵</span>
                    </div>
                    <span className="text-[9px] font-normal opacity-85">沉淀折中矩阵</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-surface-subtle border border-border text-[11px] text-fg-secondary flex items-start gap-2">
              <Scale className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <p className="font-semibold text-fg">当前为博弈讨论模式 (AI 仲裁机制)</p>
                <p className="text-[10px] text-fg-muted leading-relaxed">
                  最终定案法槌由 AI 仲裁专家组 (
                  {(topic.gameRoles?.arbiters || []).map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}
                  ) 主导。你可作为架构观察员发言，或随时在编辑中接管仲裁权。
                </p>
                {onEditTopic && (
                  <button
                    type="button"
                    onClick={onEditTopic}
                    className="text-[10px] text-accent hover:underline font-medium inline-flex items-center gap-1 cursor-pointer mt-0.5"
                  >
                    <Edit3 className="w-2.5 h-2.5" />
                    <span>编辑议题并接管仲裁法槌</span>
                  </button>
                )}
              </div>
            </div>
          )
        ) : (
          <button
            onClick={() => setShowResolveModal(true)}
            className="w-full min-h-[38px] py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer leading-snug text-center"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="text-center">达成共识并沉淀结论 (Resolve & Merge)</span>
          </button>
        )}

        {/* Mini Composer to Reply in this Topic */}
        <div className="relative bg-surface border border-border rounded-xl p-2 focus-within:border-purple-500 transition-all">
          <MentionSuggestions
            isOpen={isMentionOpen}
            query={mentionQuery}
            agents={candidateAgentsWithGameRoles}
            activeMemberIds={topic.participatingAgentIds}
            selectedIndex={mentionIndex}
            onSelect={handleSelectMention}
            onClose={() => setIsMentionOpen(false)}
          />

          <textarea
            ref={textareaRef}
            value={replyContent}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isExecuting ? "议题正在推演中... 可补充信息，按 Esc 终止推演" : "在当前议题中回复或输入 @ 召唤 Agent 继续推演... (⌘ + Enter 发送)"}
            rows={2}
            style={{ minHeight: '44px', maxHeight: '200px' }}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none leading-relaxed"
          />
          <div className="flex items-center justify-between pt-1 border-t border-border mt-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const textarea = textareaRef.current;
                  if (!textarea) return;
                  textarea.focus();
                  const cursor = textarea.selectionStart || replyContent.length;
                  const newContent = replyContent.slice(0, cursor) + '@' + replyContent.slice(cursor);
                  updateReplyContent(newContent);
                  setMentionQuery('');
                  setIsMentionOpen(true);
                  setMentionIndex(0);
                  setTimeout(() => {
                    const nextCursor = cursor + 1;
                    textarea.setSelectionRange(nextCursor, nextCursor);
                  }, 0);
                }}
                className="p-1 rounded hover:text-accent hover:bg-surface-hover text-fg-muted transition-colors cursor-pointer"
                title="输入 @ 提及 Agent"
              >
                <AtSign className="w-3.5 h-3.5 text-accent" />
              </button>
              <span className="text-[10px] text-fg-muted font-mono">
                {isExecuting ? 'Esc 终止' : '⌘ + Enter 发送'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Topic Draft Status Badge */}
              {replyContent.trim().length > 0 && (
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] select-none mr-1 animate-in fade-in"
                  title="当前议题回复草稿已独立暂存，切换议题不丢失"
                >
                  <Edit3 className="w-2.5 h-2.5 shrink-0" />
                  <span className="hidden xs:inline font-mono">草稿已暂存</span>
                  <button
                    type="button"
                    onClick={handleClearTopicDraft}
                    className="p-0.5 rounded hover:text-red-400 transition-colors cursor-pointer"
                    title="清空当前议题草稿"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}

              {isExecuting ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onAbortAll) {
                      onAbortAll();
                    } else if (onAbortAgent) {
                      topicExecutions.forEach((e) => onAbortAgent(e.agentId));
                    }
                  }}
                  className="px-2 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-all cursor-pointer shadow-xs flex items-center gap-1 text-[11px] font-medium animate-in fade-in"
                  title="终止全部推演 (Esc)"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>终止全部 ({topicExecutions.length})</span>
                </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!replyContent.trim()}
                className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition-all cursor-pointer shadow-xs"
                title="发送回复 (⌘ + Enter)"
              >
                <Send className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
        </>
      )}

      {/* 5. Resolve & Merge Confirmation Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary">
            <div className="h-12 px-4 border-b border-border flex items-center justify-between bg-surface-subtle">
              <div className="flex items-center gap-2 font-bold text-fg text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>沉淀架构决策卡片 (Decision Record)</span>
              </div>
              <button
                onClick={() => setShowResolveModal(false)}
                className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-sans">
              <div>
                <label className="block text-xs font-semibold text-fg mb-1">
                  最终方案摘要 (将直接展示在主时间线卡片中)
                </label>
                <textarea
                  rows={3}
                  value={solutionDraft}
                  onChange={(e) => setSolutionDraft(e.target.value)}
                  placeholder="例如：采用统一的 OAuth2 回调路由分发器，结合 HMAC-SHA256 签名 state 防篡改机制，实现微信与飞书扫码多租户隔离。"
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-emerald-500 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted resize-none leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg mb-1">
                  涉及影响文件 (逗号分隔)
                </label>
                <input
                  type="text"
                  value={impactedFilesDraft}
                  onChange={(e) => setImpactedFilesDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-emerald-500 text-fg text-xs focus:outline-none transition-all font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-emerald-500" />
                    <span>指派落地执行 Agent (可选)</span>
                  </span>
                  <span className="text-[10px] text-fg-muted font-normal">合流后将自动委派其推进决议落地</span>
                </label>
                <select
                  value={selectedExecutorId}
                  onChange={(e) => setSelectedExecutorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-emerald-500 text-fg text-xs focus:outline-none transition-all"
                >
                  <option value="">暂不指派执行 Agent (仅归档结论)</option>
                  {candidateAgentsWithGameRoles.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.role || 'Agent'}) {getAgentAvailabilityLabel(agent)}
                    </option>
                  ))}
                </select>
                {overlappingFiles.length > 0 && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>并发文件重叠提示: {overlappingFiles.join(', ')} 正在被其他未合入议题触及，建议排队合入。</span>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-surface-subtle border border-border text-[11px] text-fg-muted">
                <p>确认后，议题将标记为 <span className="text-emerald-500 font-semibold">Resolved</span>，并将提炼的 200 字架构决策卡片合流至主时间线，方便团队全局获知结论。</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-border hover:bg-surface-hover text-fg-secondary text-xs transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResolve}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>确认达成共识并合流</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Arbiter Gavel Ruling Modal */}
      {showRulingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary max-h-[90vh]">
            <div className="h-12 px-4 border-b border-border flex items-center justify-between bg-surface-subtle shrink-0">
              <div className="flex items-center gap-2 font-bold text-fg text-sm">
                <Gavel className="w-4 h-4 text-amber-500" />
                <span>仲裁定案裁决书 (Arbiter Gavel Ruling)</span>
              </div>
              <button
                onClick={() => setShowRulingModal(false)}
                className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-sans overflow-y-auto flex-1">
              {/* Decision Type Switcher Tabs */}
              <div>
                <label className="block text-xs font-semibold text-fg mb-1.5">
                  选择仲裁裁决类型
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSwitchRulingType('adopt_proposer')}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      rulingType === 'adopt_proposer'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs'
                        : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-[11px] mb-0.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      <span>采纳主导</span>
                    </div>
                    <div className="text-[10px] text-fg-muted">准予合并实施</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchRulingType('reject_rebuild')}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      rulingType === 'reject_rebuild'
                        ? 'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300 font-semibold shadow-xs'
                        : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-[11px] mb-0.5">
                      <RotateCcw className="w-3 h-3 text-rose-500" />
                      <span>采纳挑战</span>
                    </div>
                    <div className="text-[10px] text-fg-muted">驳回重构架构</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchRulingType('trade_off_matrix')}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      rulingType === 'trade_off_matrix'
                        ? 'bg-purple-500/15 border-purple-500 text-purple-700 dark:text-purple-300 font-semibold shadow-xs'
                        : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-[11px] mb-0.5">
                      <SlidersHorizontal className="w-3 h-3 text-purple-500" />
                      <span>权衡矩阵</span>
                    </div>
                    <div className="text-[10px] text-fg-muted">折中分期推进</div>
                  </button>
                </div>
              </div>

              {/* Ruling Summary */}
              <div>
                <label className="block text-xs font-semibold text-fg mb-1">
                  裁决结论摘要 (将作为核心结论合流至主时间线)
                </label>
                <textarea
                  rows={2}
                  value={rulingSummary}
                  onChange={(e) => setRulingSummary(e.target.value)}
                  placeholder="请输入仲裁官对本轮博弈的最终定案陈词..."
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted resize-none leading-relaxed"
                />
              </div>

              {/* Ruling Solution / Path */}
              <div>
                <label className="block text-xs font-semibold text-fg mb-1">
                  {rulingType === 'reject_rebuild' ? '重构与推翻指引路线' : '落地方案 / 架构指引'}
                </label>
                <textarea
                  rows={2}
                  value={rulingSolution}
                  onChange={(e) => setRulingSolution(e.target.value)}
                  placeholder={rulingType === 'reject_rebuild' ? '请输入重构的核心要求与改写路径...' : '请输入通过方案的落地细节或防御补齐要求...'}
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted resize-none leading-relaxed"
                />
              </div>

              {/* Trade-off Points (Dynamic list) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                    <span>关键权衡折中要点 (Trade-off Matrix)</span>
                    <span className="text-[10px] font-normal text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded font-mono">
                      动态提炼
                    </span>
                  </label>
                  <span className="text-[10px] text-fg-muted font-sans">
                    可编辑 / 支持自由删减
                  </span>
                </div>
                <div className="space-y-1.5 mb-2">
                  {tradeOffPoints.length === 0 && (
                    <div className="p-2.5 rounded-lg bg-surface-subtle/60 border border-dashed border-border text-[11px] text-fg-muted text-center">
                      暂无提取的权衡要点，可在下方输入框手动输入添加
                    </div>
                  )}
                  {tradeOffPoints.map((pt, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-subtle border border-border text-[11px]">
                      <span className="text-fg flex-1 leading-relaxed">• {pt}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTradeOffPoint(idx)}
                        className="p-1 hover:text-red-500 text-fg-muted transition-colors cursor-pointer shrink-0"
                        title="删除要点"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newPointInput}
                    onChange={(e) => setNewPointInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTradeOffPoint();
                      }
                    }}
                    placeholder="输入一条权衡考量（如：以 5% 网络延迟换取 100% 强幂等），按回车添加..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted"
                  />
                  <button
                    type="button"
                    onClick={handleAddTradeOffPoint}
                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加</span>
                  </button>
                </div>
              </div>

              {/* Impacted Files */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                    <span>涉及受影响文件 (逗号分隔)</span>
                    {rulingImpactedFiles.trim() && (
                      <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
                        正文识别
                      </span>
                    )}
                  </label>
                  <span className="text-[10px] text-fg-muted font-sans">
                    约束落地安全爆炸半径
                  </span>
                </div>
                <input
                  type="text"
                  value={rulingImpactedFiles}
                  onChange={(e) => setRulingImpactedFiles(e.target.value)}
                  placeholder="自动从研讨中识别涉及文件；或手动输入，逗号分隔 (如: src/services/order.ts)"
                  className="w-full px-3 py-1.5 rounded-xl bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all font-mono placeholder:text-fg-muted"
                />
              </div>

              {/* Assign Executor Agent */}
              <div>
                <label className="block text-xs font-semibold text-fg mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-amber-500" />
                    <span>指派落地执行 Agent (可选)</span>
                  </span>
                  <span className="text-[10px] text-fg-muted font-normal">定案后将自动委派其推进决议落地</span>
                </label>
                <select
                  value={selectedExecutorId}
                  onChange={(e) => setSelectedExecutorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all"
                >
                  <option value="">暂不指派执行 Agent (仅法槌定案归档)</option>
                  {candidateAgentsWithGameRoles.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.role || 'Agent'}) {getAgentAvailabilityLabel(agent)}
                    </option>
                  ))}
                </select>
                {overlappingFiles.length > 0 && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>并发文件重叠提示: {overlappingFiles.join(', ')} 正在被其他未合入议题触及，建议排队合入。</span>
                  </div>
                )}
              </div>

              {/* MCDA Decision Matrix Preview in Ruling Modal */}
              {topic.gameTheoreticState?.mcdaPayload && (
                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-purple-700 dark:text-purple-300 text-xs">
                      <Scale className="w-3.5 h-3.5 text-purple-500" />
                      <span>MCDA 运筹最优最劣法 (BWM) 数学求解参考</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-300">
                      一致性标度 ξ* = {topic.gameTheoreticState.mcdaPayload.consistencyIndex}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                    {topic.gameTheoreticState.mcdaPayload.criteria.map((c) => (
                      <div key={c.id} className="p-1 rounded bg-surface/70 border border-border/50 text-center">
                        <div className="text-fg-muted truncate">{c.name.split('与')[0]}</div>
                        <div className="font-semibold text-fg">{((topic.gameTheoreticState?.mcdaPayload?.computedWeights[c.id] || 0) * 100).toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-fg-secondary">
                    <span className="font-semibold text-fg">数学最优方案：</span>
                    <span className="text-purple-600 dark:text-purple-400 font-bold">
                      {topic.gameTheoreticState.mcdaPayload.ranking[0]?.alternative}
                    </span>
                    （综合效用得分: {(topic.gameTheoreticState.mcdaPayload.ranking[0]?.totalUtility * 10).toFixed(2)}/10）
                  </div>
                </div>
              )}

              {/* Consistency Gate Hard Check (R-1) */}
              {topic.gameTheoreticState?.mcdaPayload && !topic.gameTheoreticState.mcdaPayload.consistencyPassed && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-900 dark:text-rose-200 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>MCDA 运筹逻辑一致性未达标硬门禁 (Consistency Check Failed, ξ* &gt; 0.12)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-secondary">
                    当前多准则偏好矩阵存在逻辑传递性矛盾 (当前标度 ξ* = {topic.gameTheoreticState.mcdaPayload.consistencyIndex} &gt; 0.12)。根据工程控制法规，系统已硬锁定直接批准。如确需定案，人类首席仲裁官须勾选下方的特权豁免，承担一致性缺陷责任。
                  </p>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={exemptionChecked}
                      onChange={(e) => setExemptionChecked(e.target.checked)}
                      className="mt-0.5 rounded border-rose-500 text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-[11px] font-semibold text-fg">
                      我已知晓一致性逻辑矛盾风险，并执行人类首席仲裁官具名特权豁免 (Exemption)
                    </span>
                  </label>
                  {exemptionChecked && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={exemptionReason}
                        onChange={(e) => setExemptionReason(e.target.value)}
                        placeholder="请输入一致性豁免理由（如：已人工核对并对冲冲突准则）..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-rose-500/40 text-fg text-xs focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Quorum Gate Alert & Exemption Checkbox */}
              {!isChallengerQuorumMet && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>法定推演人数未达标告警 (Quorum Not Met)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-secondary">
                    红队对抗方 (Challenger) 未能成功生成有效反例压测或发生离线/异常。根据博弈推演治理规约，如需定案，人类首席仲裁官须行使具名特权豁免。
                  </p>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={exemptionChecked}
                      onChange={(e) => setExemptionChecked(e.target.checked)}
                      className="mt-0.5 rounded border-amber-500 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-[11px] font-semibold text-fg">
                      我已知晓红队缺席风险，并执行人类首席仲裁官具名特权豁免 (Exemption)
                    </span>
                  </label>
                  {exemptionChecked && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={exemptionReason}
                        onChange={(e) => setExemptionReason(e.target.value)}
                        placeholder="请输入具名豁免理由（如：红队超时，时间紧迫先行动行采纳）..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-amber-500/40 text-fg text-xs focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Arbiter Signature Info */}
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium">
                  <Scale className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    仲裁署名: {topic.gameRoles?.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌)' : 'AI 综合仲裁组'}
                    {topic.gameRoles?.arbiters && topic.gameRoles.arbiters.length > 0 && (
                      <span className="opacity-75">
                        {' '}协同: {topic.gameRoles.arbiters.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、')}
                      </span>
                    )}
                  </span>
                </div>
                <span className="font-mono text-[10px] opacity-80">即时裁决并合流</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-3 border-t border-border bg-surface-subtle shrink-0">
              <button
                type="button"
                onClick={() => setShowRulingModal(false)}
                className="px-3 py-1.5 rounded-xl border border-border hover:bg-surface-hover text-fg-secondary text-xs transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRuling}
                disabled={(!isChallengerQuorumMet || (topic.gameTheoreticState?.mcdaPayload && !topic.gameTheoreticState.mcdaPayload.consistencyPassed)) && !exemptionChecked}
                className={`px-4 py-1.5 rounded-xl font-semibold text-xs shadow-md transition-all flex items-center gap-1.5 ${
                  (!isChallengerQuorumMet || (topic.gameTheoreticState?.mcdaPayload && !topic.gameTheoreticState.mcdaPayload.consistencyPassed)) && !exemptionChecked
                    ? 'bg-fg-muted/20 text-fg-muted cursor-not-allowed'
                    : rulingType === 'adopt_proposer'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                    : rulingType === 'reject_rebuild'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                    : 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
                }`}
              >
                <Gavel className="w-3.5 h-3.5" />
                <span>敲响法槌并定案归档</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Assign Executor On-demand Modal */}
      {showAssignExecutorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary">
            <div className="h-12 px-4 border-b border-border flex items-center justify-between bg-surface-subtle shrink-0">
              <div className="flex items-center gap-2 font-bold text-fg text-sm">
                <Wrench className="w-4 h-4 text-accent" />
                <span>指派落地执行 Agent 推进定案决议</span>
              </div>
              <button
                onClick={() => setShowAssignExecutorModal(false)}
                className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-sans">
              <div className="p-2.5 rounded-xl bg-surface-subtle border border-border text-[11px] text-fg-muted leading-relaxed">
                议题决策已确定。选定执行 Agent 后，系统将把定案决策（落地推进方案、权衡矩阵与涉及范围）封装为执行指令并唤起该 Agent。
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg mb-1">
                  选择执行 Agent
                </label>
                <select
                  value={selectedExecutorId}
                  onChange={(e) => setSelectedExecutorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-accent text-fg text-xs focus:outline-none transition-all"
                >
                  <option value="" disabled>请选择负责落地执行的 Agent</option>
                  {candidateAgentsWithGameRoles.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.role || 'Agent'}) {getAgentAvailabilityLabel(agent)}
                    </option>
                  ))}
                </select>
                {overlappingFiles.length > 0 && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>并发文件重叠提示: {overlappingFiles.join(', ')} 正在被其他未合入议题触及，建议排队合入。</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAssignExecutorModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-border hover:bg-surface-hover text-fg-secondary text-xs transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!selectedExecutorId}
                  onClick={() => {
                    if (onExecuteTopicPatch && selectedExecutorId) {
                      onExecuteTopicPatch(topic.id, selectedExecutorId);
                      setShowAssignExecutorModal(false);
                    }
                  }}
                  className={`px-4 py-1.5 rounded-xl font-semibold text-xs shadow-md transition-all flex items-center gap-1.5 ${
                    !selectedExecutorId
                      ? 'bg-fg-muted/20 text-fg-muted cursor-not-allowed'
                      : 'bg-accent hover:opacity-90 text-accent-fg cursor-pointer'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>立即启动落地执行</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu in Drawer */}
      {contextMenu && (
        <div
          className="fixed z-50 w-44 bg-surface border border-border rounded-xl shadow-2xl py-1.5 px-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 text-xs select-none"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] text-fg-muted font-medium border-b border-border/50 truncate mb-1">
            {contextMenu.message.authorName} 的发言
          </div>

          <button
            onClick={() => handleCopyMessage(contextMenu.message)}
            className="w-full px-2.5 py-1.5 flex items-center gap-2 rounded-lg hover:bg-surface-hover text-fg transition-colors cursor-pointer text-left"
          >
            {copiedMsgId === contextMenu.message.id ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-medium">已复制到剪贴板</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>复制内容</span>
              </>
            )}
          </button>

          <button
            onClick={() => handleQuoteInDrawer(contextMenu.message)}
            className="w-full px-2.5 py-1.5 flex items-center gap-2 rounded-lg hover:bg-surface-hover text-fg transition-colors cursor-pointer text-left"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-accent" />
            <span>引用到输入框</span>
          </button>
        </div>
      )}

      {/* Toast on Copied */}
      {copiedMsgId && (
        <div className="fixed bottom-16 right-8 z-50 px-3 py-1.5 rounded-xl bg-surface border border-border shadow-2xl text-fg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span>消息内容已复制到剪贴板</span>
        </div>
      )}
    </aside>
  );
};
