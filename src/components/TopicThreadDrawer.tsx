import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  TopicMessageData, 
  Message, 
  Agent, 
  ActiveAgentExecution, 
  RulingRecord, 
  RulingDecisionType, 
  GameRoleType 
} from '../types';
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
  AlertTriangle
} from 'lucide-react';
import { MentionSuggestions } from './MentionSuggestions';
import { renderFormattedContent } from '../utils/formatMentions';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';
import { getDraft, saveDraft, clearDraft } from '../services/draftService';

interface TopicThreadDrawerProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  messages: Message[];
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  onAbortAgent?: (agentId: string) => void;
  onAbortAll?: () => void;
  onClose: () => void;
  onSendMessage: (topicId: string, content: string) => void;
  onResolveTopic: (topicId: string, decision: {
    solution: string;
    impactedFiles: string[];
    approvers: string[];
    rulingRecord?: RulingRecord;
  }) => void;
  onReopenTopic?: (topicId: string) => void;
  onOpenCodexDiff: (diff: any) => void;
  onEditTopic?: () => void;
}

export const TopicThreadDrawer: React.FC<TopicThreadDrawerProps> = ({
  isOpen,
  topic,
  messages,
  agents,
  activeExecutions = [],
  onAbortAgent,
  onAbortAll,
  onClose,
  onSendMessage,
  onResolveTopic,
  onReopenTopic,
  onOpenCodexDiff,
  onEditTopic,
}) => {
  const [replyContent, setReplyContent] = useState('');
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [solutionDraft, setSolutionDraft] = useState('');
  const [impactedFilesDraft, setImpactedFilesDraft] = useState('src/middleware/auth.ts, src/routes/oauth.ts');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 仲裁裁决法槌控制台相关状态 (Arbiter's Gavel Ruling State)
  const [showRulingModal, setShowRulingModal] = useState(false);
  const [rulingType, setRulingType] = useState<RulingDecisionType>('adopt_proposer');
  const [rulingSummary, setRulingSummary] = useState('');
  const [rulingSolution, setRulingSolution] = useState('');
  const [rulingImpactedFiles, setRulingImpactedFiles] = useState('src/middleware/auth.ts, src/routes/oauth.ts');
  const [tradeOffPoints, setTradeOffPoints] = useState<string[]>([
    '以轻量延迟换取 100% 幂等与重试防穿透',
    '限制最大重试次数为 3 次，超时自动转死信队列'
  ]);
  const [newPointInput, setNewPointInput] = useState('');
  const [exemptionChecked, setExemptionChecked] = useState(false);
  const [exemptionReason, setExemptionReason] = useState('');

  const isChallengerQuorumMet =
    topic?.discussionMode !== 'game_theoretic' ||
    topic?.gameTheoreticState?.isChallengerResponded !== false;

  const handleOpenRuling = (type: RulingDecisionType) => {
    setRulingType(type);
    setExemptionChecked(false);
    setExemptionReason('');
    if (type === 'adopt_proposer') {
      setRulingSummary('经博弈讨论验证，主导方案具备完整落地可行性与性能优势，补充边界校验后准予合并实施。');
      setRulingSolution('采纳主导者架构设计方案，补齐分布式锁与熔断兜底。');
    } else if (type === 'reject_rebuild') {
      setRulingSummary('挑战者提出的极端并发竞争与数据不一致隐患属实，原主导方案在关键路径存在不可逆风险，予以驳回重构。');
      setRulingSolution('驳回直连设计，重构为基于消息队列与补偿事务的最终一致性架构。');
    } else {
      setRulingSummary('主导方案与挑战意见各有权衡取舍，通过妥协折中构建架构权衡矩阵，实施分阶段演进。');
      setRulingSolution('阶段一推进极简核心流；阶段二落地挑战者要求的审计流水与异常补偿。');
    }
    setShowRulingModal(true);
  };

  const handleSwitchRulingType = (type: RulingDecisionType) => {
    setRulingType(type);
    if (type === 'adopt_proposer') {
      setRulingSummary('经博弈讨论验证，主导方案具备完整落地可行性与性能优势，补充边界校验后准予合并实施。');
      setRulingSolution('采纳主导者架构设计方案，补齐分布式锁与熔断兜底。');
    } else if (type === 'reject_rebuild') {
      setRulingSummary('挑战者提出的极端并发竞争与数据不一致隐患属实，原主导方案在关键路径存在不可逆风险，予以驳回重构。');
      setRulingSolution('驳回直连设计，重构为基于消息队列与补偿事务的最终一致性架构。');
    } else {
      setRulingSummary('主导方案与挑战意见各有权衡取舍，通过妥协折中构建架构权衡矩阵，实施分阶段演进。');
      setRulingSolution('阶段一推进极简核心流；阶段二落地挑战者要求的审计流水与异常补偿。');
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

    const rulingRecord: RulingRecord = {
      decisionType: rulingType,
      arbiterId: 'user-norris',
      arbiterName,
      summary: rulingSummary.trim() || '博弈推演裁决已下达',
      solution: rulingSolution.trim() || undefined,
      tradeOffPoints: tradeOffPoints.filter((p) => p.trim().length > 0),
      impactedFiles: finalImpactedFiles,
      decidedAt: resolvedAt,
      exemptionReason: !isChallengerQuorumMet ? (exemptionReason.trim() || '人类首席仲裁官具名特权豁免') : undefined,
    };

    onResolveTopic(topic.id, {
      solution: rulingSolution.trim() || rulingSummary.trim(),
      impactedFiles: finalImpactedFiles,
      approvers: [arbiterName, ...aiArbiterNames],
      rulingRecord,
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
  };

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
  const prevTopicIdRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const c = scrollContainerRef.current;
    isAtBottomRef.current = c.scrollHeight - c.scrollTop - c.clientHeight <= 100;
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
        return { ...ag, role: `[🏛️ 主导者] ${ag.role}` };
      }
      if (topic.gameRoles.challengers.includes(ag.id)) {
        return { ...ag, role: `[⚔️ 挑战者] ${ag.role}` };
      }
      if (topic.gameRoles.arbiters.includes(ag.id)) {
        return { ...ag, role: `[⚖️ 仲裁者] ${ag.role}` };
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

  const getGameRoleBadge = (msg: Message) => {
    if (topic.discussionMode !== 'game_theoretic' || !topic.gameRoles) return null;
    const { proposers = [], challengers = [], arbiters = [], humanIsArbiter } = topic.gameRoles;

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
        label: '🏛️ 主导者',
        cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      };
    }
    if (challengers.includes(id)) {
      return {
        label: '⚔️ 挑战者',
        cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
      };
    }
    if (arbiters.includes(id)) {
      return {
        label: '⚖️ 仲裁者',
        cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
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
      className="relative bg-surface border-l border-border flex flex-col shrink min-w-[320px] max-sm:!fixed max-sm:!inset-0 max-sm:!w-full max-sm:!max-w-full max-sm:!z-50 text-xs text-fg-secondary shadow-2xl z-40"
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
      <div className="min-h-[52px] py-2 px-3 sm:px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0 gap-2">
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
                    🏛️ 主导 {topic.gameRoles.proposers?.length || 0} · ⚔️ 挑战 {topic.gameRoles.challengers?.length || 0} · ⚖️ 仲裁 {topic.gameRoles.humanIsArbiter ? '👤+' : ''}{topic.gameRoles.arbiters?.length || 0}
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

      {/* 2. Topic Anchor Context */}
      <div className="p-3.5 bg-surface-subtle border-b border-border text-[11px] space-y-2">
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
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-surface border border-border text-fg leading-relaxed select-text">
          {topic.description || topic.title}
        </div>

        {/* 博弈模式角色配置概览卡片 */}
        {topic.discussionMode === 'game_theoretic' && topic.gameRoles && (
          <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>🏛️ 主导者</span>
                <span className="text-[9px] opacity-75">({topic.gameRoles.proposers?.length || 0})</span>
              </div>
              <div className="truncate text-fg-secondary">
                {topic.gameRoles.proposers?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}
              </div>
            </div>

            <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>⚔️ 挑战者</span>
                <span className="text-[9px] opacity-75">({topic.gameRoles.challengers?.length || 0})</span>
              </div>
              <div className="truncate text-fg-secondary">
                {topic.gameRoles.challengers?.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join('、') || '未指定'}
              </div>
            </div>

            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <span>⚖️ 仲裁者</span>
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

      {/* 博弈推演阶段状态机指示器 (Game Theoretic Phase Stepper) */}
      {topic.discussionMode === 'game_theoretic' && (
        <div className="px-3.5 py-2 bg-surface-subtle/70 border-b border-border text-[11px]">
          <div className="flex items-center justify-between gap-1 select-none">
            {/* Step 1: 方案立论 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              (topic.gameStage === 'proposal' || !topic.gameStage)
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs'
                : 'bg-surface border-border text-fg-muted'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                (topic.gameStage === 'proposal' || !topic.gameStage)
                  ? 'bg-emerald-500 text-white font-bold'
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
                : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold'
                : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                ? 'bg-surface border-border text-fg-muted'
                : 'bg-surface border-border text-fg-muted opacity-60'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                topic.gameStage === 'challenge'
                  ? 'bg-rose-500 text-white font-bold'
                  : topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-amber-500 text-white font-bold'
                  : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? 'bg-emerald-500/20 text-emerald-600'
                  : 'bg-border text-fg-muted'
              }`}>
                {topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '!'
                  : (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                  ? '✓'
                  : '2'}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">
                  {topic.gameTheoreticState?.isChallengerResponded === false && (topic.gameStage === 'arbitration' || topic.gameStage === 'concluded' || topic.status === 'resolved')
                    ? '⚔️ 压测缺席'
                    : '⚔️ 反例压测'}
                </span>
              </div>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 opacity-40" />

            {/* Step 3: 仲裁定案 */}
            <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
              topic.gameStage === 'concluded' || topic.status === 'resolved'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold'
                : topic.gameStage === 'arbitration'
                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-semibold shadow-xs'
                : 'bg-surface border-border text-fg-muted opacity-60'
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                topic.gameStage === 'concluded' || topic.status === 'resolved'
                  ? 'bg-emerald-500 text-white font-bold'
                  : topic.gameStage === 'arbitration'
                  ? 'bg-indigo-500 text-white font-bold'
                  : 'bg-border text-fg-muted'
              }`}>
                {topic.gameStage === 'concluded' || topic.status === 'resolved' ? '✓' : '3'}
              </div>
              <div className="truncate min-w-0">
                <span className="truncate block font-medium">⚖️ 仲裁定案</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Topic Message Stream */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4 font-sans select-text">
        {messages.length === 0 ? (
          <div className="text-center py-10 text-fg-muted">
            <div className="text-2xl mb-2">💬</div>
            <div className="font-semibold text-fg text-xs">暂无议题深入讨论</div>
            <div className="text-[11px] text-fg-muted mt-1">
              在下方输入框召唤 Agent 开始独立多轮架构论证
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isThinkingOpen = expandedThinking[msg.id] ?? true;
            const isAgent = msg.agentBadge || msg.authorName.includes('Agent') || msg.authorName.includes('Reviewer');
            const gameRoleBadge = getGameRoleBadge(msg);

            return (
              <div
                key={msg.id}
                onContextMenu={(e) => handleContextMenu(e, msg)}
                className={`space-y-2.5 p-3.5 rounded-2xl border transition-all relative ${
                  msg.isPending
                    ? 'bg-purple-500/[0.04] dark:bg-purple-950/20 border-purple-500/40 shadow-xs ring-1 ring-purple-500/20'
                    : 'bg-surface border-border hover:border-purple-500/40 group'
                }`}
              >
                {/* Message Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <div className={`w-6 h-6 rounded-lg bg-surface border flex items-center justify-center text-xs shadow-xs shrink-0 mt-0.5 ${
                      msg.isPending ? 'border-purple-500/40 animate-pulse' : 'border-border'
                    }`}>
                      {msg.authorAvatar || '🤖'}
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                      <span className="font-bold text-fg text-xs whitespace-nowrap shrink-0">{msg.authorName}</span>
                      {gameRoleBadge && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 whitespace-nowrap ${gameRoleBadge.cls}`}>
                          {gameRoleBadge.label}
                        </span>
                      )}
                      {msg.gameStage && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 whitespace-nowrap ${
                          msg.gameStage === 'proposal'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : msg.gameStage === 'challenge'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                            : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
                        }`}>
                          {msg.gameStage === 'proposal' ? '🏛️ 方案立论' : msg.gameStage === 'challenge' ? '⚔️ 反例压测' : '⚖️ 仲裁建言'}
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
                          className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 font-mono border border-purple-500/30 truncate max-w-[180px] shrink-0"
                          title={msg.agentBadge}
                        >
                          {msg.agentBadge}
                        </span>
                      ) : null}
                      {msg.collaborationInfo && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 flex items-center gap-1 max-w-[220px] ${
                            msg.collaborationInfo.isCircuitBroken
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold'
                              : 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30'
                          }`}
                          title={msg.collaborationInfo.isCircuitBroken ? '协同熔断' : `响应 ${msg.collaborationInfo.invokedByAgentName || msg.collaborationInfo.invokedByAgentHandle || '协同'} (Hop ${msg.collaborationInfo.hop})`}
                        >
                          {msg.collaborationInfo.isCircuitBroken ? (
                            <span className="whitespace-nowrap">🛡️ 协同熔断</span>
                          ) : (
                            <>
                              <span className="truncate">🔗 响应 {msg.collaborationInfo.invokedByAgentName || msg.collaborationInfo.invokedByAgentHandle || '协同'}</span>
                              <span className="shrink-0">(Hop {msg.collaborationInfo.hop})</span>
                            </>
                          )}
                        </span>
                      )}
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
                          💡 提示：深度思考与反例边界证伪耗时较长（通常需要 1~5 分钟）。ACP 正在分析项目上下文，生成内容将实时流式渲染于此处。
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
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <FileCode2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-fg font-semibold">{msg.diffView.filename}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-emerald-500 font-bold">+{msg.diffView.additions}</span>
                            <span className="text-red-500 font-bold">-{msg.diffView.deletions}</span>
                            <button
                              onClick={() => onOpenCodexDiff(msg.diffView)}
                              className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-[9px] font-sans flex items-center gap-0.5 ml-1 transition-colors cursor-pointer shrink-0"
                            >
                              <span>Codex 视图</span>
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                        <pre className="p-2 rounded bg-surface-subtle border border-border overflow-x-auto text-[10px] text-fg-secondary leading-relaxed select-text">
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
                      <span className={`font-semibold flex items-center gap-1.5 ${
                        isQueued ? 'text-fg-muted' : 'text-purple-600 dark:text-purple-400'
                      }`}>
                        <span className="text-sm">{exec.agentAvatar || '🤖'}</span>
                        <BrainCircuit className={`w-3.5 h-3.5 ${isQueued ? 'opacity-60' : 'animate-pulse text-purple-500'}`} />
                        <span>{exec.agentName} {isQueued ? '排队等待接力' : '正在论证推演中'}</span>
                      </span>
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

        {/* Bottom anchor for scrolling */}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. Consensus Rollup Banner / Arbiter Gavel Console */}
      <div className="p-3 border-t border-border bg-surface-subtle space-y-2.5">
        {isResolved ? (
          topic.rulingRecord ? (
            <div className={`p-3 rounded-xl border text-xs font-sans space-y-2.5 ${
              topic.rulingRecord.decisionType === 'adopt_proposer'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : topic.rulingRecord.decisionType === 'reject_rebuild'
                ? 'bg-rose-500/10 border-rose-500/30'
                : 'bg-purple-500/10 border-purple-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold">
                  <Scale className="w-4 h-4 text-amber-500" />
                  <span>
                    {topic.rulingRecord.decisionType === 'adopt_proposer'
                      ? '⚖️ 仲裁裁决：采纳主导方案'
                      : topic.rulingRecord.decisionType === 'reject_rebuild'
                      ? '🔄 仲裁裁决：采纳挑战驳回重构'
                      : '📊 仲裁裁决：达成架构权衡矩阵'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono opacity-80">{topic.rulingRecord.decidedAt}</span>
                  {onReopenTopic && (
                    <button
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
                <div className="text-[10px] select-text p-2 rounded-lg bg-surface/60 border border-border/60">
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

              <div className="text-[9px] text-fg-muted font-mono flex items-center justify-between pt-1 border-t border-border/50">
                <span>裁决官: {topic.rulingRecord.arbiterName}</span>
                {topic.rulingRecord.impactedFiles && topic.rulingRecord.impactedFiles.length > 0 && (
                  <span className="truncate max-w-[200px]" title={topic.rulingRecord.impactedFiles.join(', ')}>
                    涉及: {topic.rulingRecord.impactedFiles.join(', ')}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="text-[11px] font-semibold">
                  本议题已达成共识并归档
                  <div className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 font-normal">
                    决策结论已合流至主频道时间轴
                  </div>
                </div>
              </div>

              {onReopenTopic && (
                <button
                  onClick={() => onReopenTopic(topic.id)}
                  className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                  title="重新激活此议题讨论"
                >
                  <RotateCcw className="w-3 h-3 text-fg-muted" />
                  <span>重开</span>
                </button>
              )}
            </div>
          )
        ) : topic.discussionMode === 'game_theoretic' ? (
          (topic.gameRoles?.humanIsArbiter ?? true) ? (
            <div className="space-y-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                  <Gavel className="w-3.5 h-3.5 text-amber-500" />
                  <span>仲裁者专属法槌控制台 (Arbiter's Gavel)</span>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  👑 单向定案权
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenRuling('adopt_proposer')}
                  className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                  title="认可主导者方案的可行性与完整度，直接定案"
                >
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>采纳主导</span>
                  </div>
                  <span className="text-[9px] font-normal opacity-85">通过主导方案</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenRuling('reject_rebuild')}
                  className="py-1.5 px-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                  title="认可挑战者指出的严重隐患，裁定推倒重构"
                >
                  <div className="flex items-center gap-1">
                    <RotateCcw className="w-3 h-3 shrink-0" />
                    <span>采纳挑战</span>
                  </div>
                  <span className="text-[9px] font-normal opacity-85">驳回重构架构</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenRuling('trade_off_matrix')}
                  className="py-1.5 px-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer text-center"
                  title="主导与挑战各具合理性，生成权衡折中矩阵并定案"
                >
                  <div className="flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3 shrink-0" />
                    <span>权衡矩阵</span>
                  </div>
                  <span className="text-[9px] font-normal opacity-85">沉淀折中矩阵</span>
                </button>
              </div>
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
                <label className="block text-xs font-semibold text-fg mb-1">
                  关键权衡折中要点 (Trade-off Matrix)
                </label>
                <div className="space-y-1.5 mb-2">
                  {tradeOffPoints.map((pt, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-subtle border border-border text-[11px]">
                      <span className="text-fg flex-1">• {pt}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTradeOffPoint(idx)}
                        className="p-1 hover:text-red-500 text-fg-muted transition-colors cursor-pointer"
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
                    className="flex-1 px-3 py-1.5 rounded-lg bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all"
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
                <label className="block text-xs font-semibold text-fg mb-1">
                  涉及受影响文件 (逗号分隔)
                </label>
                <input
                  type="text"
                  value={rulingImpactedFiles}
                  onChange={(e) => setRulingImpactedFiles(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-surface-subtle border border-border focus:border-amber-500 text-fg text-xs focus:outline-none transition-all font-mono"
                />
              </div>

              {/* Quorum Gate Alert & Exemption Checkbox */}
              {!isChallengerQuorumMet && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>法定推演人数未达标告警 (Quorum Not Met)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-secondary">
                    制衡方 (Challenger) 未能成功生成有效反例压测或发生离线/异常。根据博弈推演治理规约，如需定案，人类首席仲裁官须行使具名特权豁免。
                  </p>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={exemptionChecked}
                      onChange={(e) => setExemptionChecked(e.target.checked)}
                      className="mt-0.5 rounded border-amber-500 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-[11px] font-semibold text-fg">
                      我已知晓制衡方缺席风险，并执行人类首席仲裁官具名特权豁免 (Exemption)
                    </span>
                  </label>
                  {exemptionChecked && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={exemptionReason}
                        onChange={(e) => setExemptionReason(e.target.value)}
                        placeholder="请输入具名豁免理由（如：制衡方超时，时间紧迫先行动行采纳）..."
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
                    仲裁署名: {topic.gameRoles?.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官, 持法槌)' : 'AI 仲裁组'}
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
                disabled={!isChallengerQuorumMet && !exemptionChecked}
                className={`px-4 py-1.5 rounded-xl font-semibold text-xs shadow-md transition-all flex items-center gap-1.5 ${
                  !isChallengerQuorumMet && !exemptionChecked
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
