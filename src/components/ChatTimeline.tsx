import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Thread, Agent, Channel, ActiveAgentExecution, TopicMessageData } from '../types';
import { TopicMessageCard } from './TopicMessageCard';
import { ChannelComposerActivityBar } from './ChannelComposerActivityBar';
import { 
  Terminal, 
  Database, 
  FolderGit2, 
  Wrench, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  ExternalLink,
  Users,
  Headphones,
  MoreVertical,
  GitBranch,
  FileCode2,
  CornerDownRight,
  MessageSquare,
  Bot,
  Copy,
  Check,
  BrainCircuit,
  GitCompare,
  ArrowRight,
  Plus,
  Filter,
  Trash2,
  Lock,
  UserPlus,
  Quote,
  PanelLeft
} from 'lucide-react';
import { renderFormattedContent } from '../utils/formatMentions';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';

interface ChatTimelineProps {
  messages: Message[];
  activeThread?: Thread;
  channel?: Channel;
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  onAbortAgent?: (agentId: string) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onInspectAgent: (agentId: string) => void;
  onOpenTopic?: (topicId: string) => void;
  onOpenNewTopicModal?: () => void;
  onOpenSubThread?: (subThreadId: string) => void;
  onOpenCodexDiff: (diff: any) => void;
  onOpenAcpInspector: () => void;
  onOpenMembersModal?: () => void;
  onOpenDeleteChannelModal?: () => void;
  onQuoteMessage?: (message: Message) => void;
  onEditTopic?: (topic: TopicMessageData) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentWorkspace?: string;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  activeThread,
  channel,
  agents,
  activeExecutions = [],
  onAbortAgent,
  onAddReaction,
  onInspectAgent,
  onOpenTopic,
  onOpenNewTopicModal,
  onOpenSubThread,
  onOpenCodexDiff,
  onOpenAcpInspector,
  onOpenMembersModal,
  onOpenDeleteChannelModal,
  onQuoteMessage,
  onEditTopic,
  isSidebarCollapsed = false,
  onToggleSidebar,
  currentWorkspace,
}) => {
  const [filter, setFilter] = useState<'all' | 'topics' | 'resolved'>('all');
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
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
    const menuWidth = 190;
    const menuHeight = 170;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({ x, y, message });
  };

  const handleCopyMessage = (message: Message) => {
    navigator.clipboard.writeText(message.content);
    setCopiedMsgId(message.id);
    setTimeout(() => setCopiedMsgId(null), 2000);
    setContextMenu(null);
  };

  const handleQuote = (message: Message) => {
    onQuoteMessage?.(message);
    setContextMenu(null);
  };

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const toggleTrace = (msgId: string) => {
    setExpandedTraces((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const copyCode = (codeId: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(codeId);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const [isDmThinkingOpen, setIsDmThinkingOpen] = useState(true);
  const [now, setNow] = useState(Date.now());

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevThreadIdRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);

  const activeAgents = agents.filter((a) => activeThread?.activeAgentIds?.includes(a.id));
  const dmTargetAgent = activeThread?.type === 'dm'
    ? agents.find((a) => a.id === activeThread.authorId || activeThread.activeAgentIds?.includes(a.id))
    : undefined;

  const currentThreadExecutions = activeExecutions.filter(
    (e) => e.threadId === activeThread?.id || (activeThread?.type === 'thread' && (!e.threadId || e.threadId === activeThread?.id))
  );

  const isAtBottomRef = useRef(true);

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

  // 1. 进入会话 / 切换线程时：立即无感知精准定位于最新消息位置（Auto 瞬移），辅以 rAF 及多级微任务防止动态 Markdown/代码块回流跳顶
  useEffect(() => {
    if (!activeThread?.id) return;
    const isNewThread = prevThreadIdRef.current !== activeThread.id;
    prevThreadIdRef.current = activeThread.id;

    if (isNewThread) {
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
  }, [activeThread?.id, scrollToBottom, messages.length]);

  // 2. 切换过滤器（全部 / 议题）时，同样精准定位到当前筛选流的最新消息
  useEffect(() => {
    scrollToBottom('auto');
    const timer = setTimeout(() => scrollToBottom('auto'), 40);
    return () => clearTimeout(timer);
  }, [filter, scrollToBottom]);

  // 3. 当前会话收到新消息或 Agent 执行流推进时：如果用户位于底部附近则平滑跟随滚动
  useEffect(() => {
    const isInitial = prevMsgCountRef.current === 0;
    const hasNewMessage = messages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (isInitial) {
      scrollToBottom('auto');
      const timer = setTimeout(() => scrollToBottom('auto'), 40);
      return () => clearTimeout(timer);
    } else if (hasNewMessage || currentThreadExecutions.length > 0) {
      if (isAtBottomRef.current) {
        scrollToBottom('smooth');
      }
    }
  }, [messages.length, currentThreadExecutions.length, scrollToBottom]);

  useEffect(() => {
    if (currentThreadExecutions.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [currentThreadExecutions.length]);

  const filteredMessages = messages.filter((m) => {
    // 私聊模式防御性过滤：绝对不渲染议题卡片、共识卡片、频道准入拦截提示等频道专属系统消息
    if (activeThread?.type === 'dm') {
      if (m.type === 'topic' || m.agentBadge === 'Consensus Rollup' || m.agentBadge === 'Channel Guard') {
        return false;
      }
    }
    if (filter === 'topics') return m.type === 'topic';
    if (filter === 'resolved') return m.type === 'topic' && m.topicData?.status === 'resolved';
    return true;
  });

  const topicCount = activeThread?.type === 'dm' ? 0 : messages.filter((m) => m.type === 'topic').length;

  if (!activeThread) {
    return (
      <div 
        id="shinobi-chat-timeline-pane"
        className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-canvas text-fg text-xs select-none"
      >
        <p className="text-fg-muted">未选择讨论议题</p>
      </div>
    );
  }

  return (
    <div 
      id="shinobi-chat-timeline-pane"
      className="flex-1 flex flex-col min-w-0 bg-canvas text-fg text-xs overflow-hidden transition-colors duration-150"
    >
      {/* 1. Top Channel / Thread Header */}
      <header className="h-12 px-3 sm:px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0 gap-2">
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          {/* Antigravity Sidebar Expand Button (Shown when sidebar is collapsed) */}
          {isSidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface border border-border/70 hover:border-border transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-2xs group mr-0.5"
              title="展开侧边栏 (⌘B)"
            >
              <PanelLeft className="w-4 h-4 text-fg-secondary group-hover:text-fg group-hover:scale-105 transition-transform" />
            </button>
          )}

          {/* Antigravity Breadcrumbs: Workspace / Channel */}
          {currentWorkspace && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-fg-muted shrink-0 select-none">
              <span className="font-medium hover:text-fg transition-colors">{currentWorkspace}</span>
              <span className="text-fg-muted/40 font-mono">/</span>
            </div>
          )}

          <span className="font-bold text-fg text-sm tracking-wide truncate flex items-center gap-2 shrink-0">
            {activeThread.type === 'dm' ? (
              <span className="flex items-center gap-2 truncate">
                <span>DM with <span className="text-accent font-semibold">{activeThread.authorName}</span></span>
                {dmTargetAgent && dmTargetAgent.status === 'idle' && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/25 text-[10px] font-mono shrink-0" title="通信未开启，请先在 Agents 面板点击 Start 开启连接">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                    <span>未开启通信 (Offline)</span>
                  </span>
                )}
                {dmTargetAgent && (dmTargetAgent.status === 'running' || dmTargetAgent.status === 'thinking') && currentThreadExecutions.length === 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] font-mono shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>通信就绪 (Online)</span>
                  </span>
                )}
                {currentThreadExecutions.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-mono shrink-0 animate-in fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="truncate max-w-[150px] sm:max-w-[220px]">
                      {currentThreadExecutions[0].currentActionDetail ||
                        ((now - currentThreadExecutions[0].startedAt) / 1000 > 60
                          ? '大模型深度推理中'
                          : (now - currentThreadExecutions[0].startedAt) / 1000 > 25
                          ? '正在深入分析上下文'
                          : '深度思考中')}
                    </span>
                    <span>({((now - currentThreadExecutions[0].startedAt) / 1000).toFixed(1)}s)</span>
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-accent font-mono font-bold">#{channel?.name || activeThread.channelName}</span>
                {channel?.kind && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-semibold border shrink-0 ${
                    channel.kind === 'feature'
                      ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30'
                      : channel.kind === 'requirement'
                      ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  }`}>
                    {channel.kind.toUpperCase()}
                  </span>
                )}
              </span>
            )}
          </span>

          {/* Git Branch Badge */}
          {channel?.gitBranch && (
            <span className="hidden xl:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="max-w-[120px] truncate">{channel.gitBranch}</span>
            </span>
          )}

          {/* Filter Pill Tabs */}
          {activeThread.type !== 'dm' && (
            <div className="hidden lg:flex items-center bg-surface rounded-lg p-0.5 border border-border gap-0.5 ml-1 shrink-0">
              <button
                onClick={() => setFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  filter === 'all' ? 'bg-accent/15 text-accent font-semibold' : 'text-fg-muted hover:text-fg'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setFilter('topics')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                  filter === 'topics' ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 font-semibold' : 'text-fg-muted hover:text-fg'
                }`}
              >
                <span>议题</span>
                {topicCount > 0 && (
                  <span className="px-1 py-0.5 rounded-full text-[9px] bg-purple-500/20 text-purple-500 font-mono">
                    {topicCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1.5 text-fg-muted relative shrink-0">
          {/* Members / Invite Agent Admission Button */}
          {onOpenMembersModal && channel && (
            <button
              onClick={onOpenMembersModal}
              className="px-2 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent font-semibold border border-accent/40 flex items-center gap-1 text-[11px] transition-all cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              title="邀请专职 Agent 或管理受邀成员"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden 2xl:inline">邀请/管理 Agent</span>
              <span className="hidden sm:inline 2xl:hidden">成员</span>
              <span>({channel.memberIds?.length || 1})</span>
            </button>
          )}

          {/* + New Topic Button */}
          {onOpenNewTopicModal && activeThread.type !== 'dm' && (
            <button
              onClick={onOpenNewTopicModal}
              className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-[11px] shadow-xs flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap shrink-0"
              title="在当前频道发起独立推演议题"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">新建议题</span>
            </button>
          )}

          {/* Delete Channel Button */}
          {onOpenDeleteChannelModal && channel && (
            <button
              onClick={onOpenDeleteChannelModal}
              className="p-1 sm:px-2 sm:py-1 rounded-lg hover:text-red-500 hover:bg-red-500/10 text-fg-muted border border-border hover:border-red-500/30 transition-colors flex items-center gap-1 text-[11px] cursor-pointer whitespace-nowrap shrink-0"
              title="删除此频道 (级联清理)"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="hidden 2xl:inline text-red-500 font-medium">删除</span>
            </button>
          )}

          {/* Codex Diff Toggle */}
          <button
            onClick={() => onOpenCodexDiff(null)}
            className="px-2 py-1 rounded-lg hover:text-emerald-500 hover:bg-surface-hover border border-transparent hover:border-emerald-500/30 transition-all flex items-center gap-1 text-[11px] cursor-pointer whitespace-nowrap shrink-0"
            title="查看代码变更与 Unified Diff (Codex 视图)"
          >
            <GitCompare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline font-mono">Diff</span>
          </button>

          {/* ACP Inspector Toggle */}
          <button
            onClick={onOpenAcpInspector}
            className="px-2 py-1 rounded-lg hover:text-accent hover:bg-surface-hover border border-transparent hover:border-accent/30 transition-all flex items-center gap-1 text-[11px] cursor-pointer whitespace-nowrap shrink-0"
            title="打开 ACP 协议与私有记忆观测面板 (Antigravity 视图)"
          >
            <Terminal className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="hidden sm:inline font-mono">ACP</span>
          </button>

          {/* Popout button */}
          <button 
            className="p-1.5 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
            title="在新窗口打开此讨论"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Collaborator Count & List */}
          <div className="relative shrink-0">
            <button 
              onClick={() => setShowMembersPopover(!showMembersPopover)}
              className="px-2 py-1 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              title="当前协同成员"
            >
              <Users className="w-3.5 h-3.5 text-fg-muted" />
              <span className="text-xs font-semibold">{activeAgents.length + 1}</span>
            </button>

            {showMembersPopover && (
              <div className="absolute right-0 top-9 w-52 bg-surface border border-border rounded-xl shadow-2xl p-2.5 z-50">
                <div className="text-[10px] text-fg-muted uppercase font-semibold mb-1.5 px-1">
                  当前讨论协同成员
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 p-1.5 rounded bg-surface-subtle">
                    <span className="text-xs">👨‍💻</span>
                    <div>
                      <div className="font-semibold text-fg">Norris_M5Pro (You)</div>
                      <div className="text-[10px] text-emerald-500 font-mono">Local Dev</div>
                    </div>
                  </div>
                  {activeAgents.map((ag) => (
                    <div key={ag.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-hover">
                      <span className="text-sm">{ag.avatar}</span>
                      <div className="truncate">
                        <div className="font-semibold text-fg truncate">{ag.name}</div>
                        <div className="text-[10px] text-fg-muted truncate">{ag.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Voice Room */}
          <button 
            className="p-1.5 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="进入音频流协作"
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>

          {/* More options */}
          <button 
            className="p-1.5 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="更多选项"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. Message Conversation Stream */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Parent Quote Anchor (Identical to Screenshot) */}
        {activeThread.parentQuoteSnippet && (
          <div className="max-w-3xl mx-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-subtle border border-border text-fg-muted text-xs shadow-xs">
            <CornerDownRight className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate italic">
              {activeThread.parentQuoteSnippet}
            </span>
          </div>
        )}

        {/* Creator-only Channel Helper Banner */}
        {channel && onOpenMembersModal && (!channel.memberIds || channel.memberIds.filter((id) => id.startsWith('agent-')).length === 0) && (
          <div className="max-w-3xl mx-auto p-3.5 rounded-2xl bg-accent/10 border border-accent/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-accent" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-xs text-fg flex items-center gap-1.5">
                  <span>当前频道处于创建者专属模式 (Creator-only)</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-mono shrink-0">
                    未拉入 Agent
                  </span>
                </div>
                <div className="text-[11px] text-fg-secondary mt-0.5">
                  默认仅创建者入驻。点击右侧按钮拉入专职 Agent，开启项目需求推演与代码实现协作。
                </div>
              </div>
            </div>
            <button
              onClick={onOpenMembersModal}
              className="px-3 py-1.5 rounded-xl bg-accent hover:opacity-90 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-all cursor-pointer shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>立即邀请 Agent</span>
            </button>
          </div>
        )}

        {filteredMessages.length === 0 && (
          <div className="max-w-md mx-auto text-center py-16 space-y-3 select-none">
            <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center mx-auto text-fg-muted shadow-xs">
              <Bot className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-fg">
              {filter === 'topics' ? '暂无专属议题' : '暂无会话记录'}
            </div>
            <p className="text-xs text-fg-muted leading-relaxed">
              {filter === 'topics' 
                ? '点击右上角“新建议题”或在底部输入框发起独立方案推演。' 
                : '在下方输入框发送消息，或调用已配置的本地 ACP Agent 开始协作。'}
            </p>
          </div>
        )}

        {filteredMessages.map((message) => {
          // Render Topic Message Card
          if (message.type === 'topic' && message.topicData) {
            return (
              <div key={message.id} className="max-w-3xl mx-auto">
                <TopicMessageCard
                  topic={message.topicData}
                  agents={agents}
                  onClick={() => onOpenTopic?.(message.topicData!.id)}
                  onEdit={onEditTopic ? () => onEditTopic(message.topicData!) : undefined}
                />
              </div>
            );
          }

          const isThinkingOpen = expandedThinking[message.id] ?? false;
          const isTraceOpen = expandedTraces[message.id] ?? false;

          return (
            <article
              key={message.id}
              onContextMenu={(e) => handleContextMenu(e, message)}
              className="max-w-3xl mx-auto group relative transition-all rounded-xl p-2 -mx-2 hover:bg-surface-subtle/40"
            >
              {/* Message Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-surface-subtle border border-border flex items-center justify-center text-lg shrink-0 shadow-xs">
                    {message.authorAvatar}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-fg text-xs">
                      {message.authorName}
                    </span>

                    {message.managedBy && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-subtle text-fg-secondary font-mono flex items-center gap-1 border border-border shrink-0">
                        <Bot className="w-2.5 h-2.5 text-accent" />
                        <span>managed by {message.managedBy}</span>
                      </span>
                    )}

                    {message.agentBadge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono border border-emerald-500/30 shrink-0">
                        {message.agentBadge}
                      </span>
                    )}

                    {message.collaborationInfo && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono border shrink-0 flex items-center gap-1 ${
                          message.collaborationInfo.isCircuitBroken
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold'
                            : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
                        }`}
                      >
                        {message.collaborationInfo.isCircuitBroken ? (
                          <>
                            <span>🛡️ 协同熔断</span>
                            <span>(Hop {message.collaborationInfo.hop})</span>
                          </>
                        ) : (
                          <>
                            <span>🔗 响应 {message.collaborationInfo.invokedByAgentName || message.collaborationInfo.invokedByAgentHandle || '协同'}</span>
                            <span>(Hop {message.collaborationInfo.hop}/{message.collaborationInfo.maxHops})</span>
                          </>
                        )}
                      </span>
                    )}

                    <span className="text-[10px] text-fg-muted font-mono">
                      · {message.timestamp}
                    </span>
                  </div>
                </div>

                {/* Floating Quick Action Bar on Hover */}
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-surface border border-border rounded-lg px-1.5 py-0.5 shadow-lg">
                  {message.subThreadId && (
                    <button
                      onClick={() => onOpenSubThread(message.subThreadId!)}
                      className="p-1 hover:text-purple-500 hover:bg-purple-500/10 rounded transition-colors flex items-center gap-1 cursor-pointer"
                      title="打开子话题分支"
                    >
                      <GitBranch className="w-3 h-3 text-purple-500" />
                      <span className="text-[10px]">子话题</span>
                    </button>
                  )}
                  {message.diffView && (
                    <button
                      onClick={() => onOpenCodexDiff(message.diffView)}
                      className="p-1 hover:text-emerald-500 hover:bg-emerald-500/10 rounded transition-colors flex items-center gap-1 cursor-pointer"
                      title="审查完整 Diff"
                    >
                      <GitCompare className="w-3 h-3 text-emerald-500" />
                      <span className="text-[10px]">Diff</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleCopyMessage(message)}
                    className="p-1 hover:text-fg hover:bg-surface-hover rounded transition-colors cursor-pointer"
                    title="复制内容 (右键亦可)"
                  >
                    {copiedMsgId === message.id ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3 text-fg-muted" />
                    )}
                  </button>
                  <button
                    onClick={() => handleQuote(message)}
                    className="p-1 hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer"
                    title="引用回复 (右键亦可)"
                  >
                    <CornerDownRight className="w-3 h-3 text-fg-muted hover:text-accent" />
                  </button>
                  <button
                    onClick={() => onAddReaction(message.id, '🔥')}
                    className="p-1 hover:bg-surface-hover rounded transition-colors cursor-pointer"
                  >
                    🔥
                  </button>
                  <button
                    onClick={() => onAddReaction(message.id, '🥷')}
                    className="p-1 hover:bg-surface-hover rounded transition-colors cursor-pointer"
                  >
                    🥷
                  </button>
                </div>
              </div>

              {/* Message Body */}
              <div className="pl-10.5 space-y-3">
                {/* Antigravity Thinking Chain Accordion */}
                {message.thinkingProcess && (
                  activeThread.type === 'dm' ? (
                    <div className="text-[11px] select-none my-1">
                      <button
                        onClick={() => toggleThinking(message.id)}
                        className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg transition-colors cursor-pointer py-0.5 group"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 text-fg-muted/70 group-hover:text-fg ${isThinkingOpen ? '' : '-rotate-90'}`} />
                        <span className="font-mono text-fg-secondary">Thought for {message.thinkingProcess.duration}</span>
                      </button>
                      {isThinkingOpen && (
                        <div className="pl-5 pt-1.5 pb-2 text-fg-muted font-mono text-[10px] leading-relaxed border-l-2 border-border/80 ml-1.5 space-y-1 animate-in fade-in">
                          <p className="text-fg-secondary font-medium">{message.thinkingProcess.summary}</p>
                          <pre className="whitespace-pre-wrap font-mono text-fg-muted/80">{message.thinkingProcess.detail}</pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-surface-subtle border border-border overflow-hidden text-[11px]">
                      <button
                        onClick={() => toggleThinking(message.id)}
                        className="w-full px-3 py-2 flex items-center justify-between text-fg-muted hover:text-fg bg-surface-subtle transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <BrainCircuit className="w-3.5 h-3.5 text-accent" />
                          <span className="font-semibold text-fg">
                            Thinking Process ({message.thinkingProcess.duration} · {message.thinkingProcess.tokens} tokens)
                          </span>
                        </div>
                        {isThinkingOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isThinkingOpen && (
                        <div className="p-3 border-t border-border font-mono text-[11px] text-fg-secondary bg-surface leading-relaxed whitespace-pre-wrap">
                          <div className="text-accent font-bold mb-1">推理摘要: {message.thinkingProcess.summary}</div>
                          <div className="text-fg-muted">{message.thinkingProcess.detail}</div>
                        </div>
                      )}
                    </div>
                  )
                )}

                {/* Main Markdown Text with Code Formatting */}
                <MarkdownRenderer content={message.content} />

                {/* Codex Style Unified Diff Card */}
                {message.diffView && (
                  <div className="p-3 rounded-xl bg-surface-subtle border border-border font-mono text-[11px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-fg font-semibold">{message.diffView.filename}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-500 font-bold">+{message.diffView.additions}</span>
                        <span className="text-red-500 font-bold">-{message.diffView.deletions}</span>
                        <button
                          onClick={() => onOpenCodexDiff(message.diffView)}
                          className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-[10px] font-sans flex items-center gap-1 ml-2 transition-colors cursor-pointer"
                        >
                          <span>Codex 视图</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-surface border border-border overflow-x-auto text-[10px] text-fg-secondary leading-relaxed">
                      {message.diffView.diff}
                    </pre>
                  </div>
                )}

                {/* Sub-Thread Branch Pill Card (Crucial for Nested Topics) */}
                {message.subThreadId && (
                  <div 
                    onClick={() => onOpenSubThread(message.subThreadId!)}
                    className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 hover:border-purple-500 flex items-center justify-between cursor-pointer transition-all shadow-xs group/sub"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-purple-500 group-hover/sub:scale-110 transition-transform" />
                      <div>
                        <div className="font-semibold text-purple-600 dark:text-purple-300 text-xs">
                          {message.subThreadTitle || '展开专项子话题 (Sub-Thread)'}
                        </div>
                        <div className="text-[10px] text-fg-muted">
                          由 OpenClaw 与 MyDeepSeek 深入推演门控边界 · {message.subThreadRepliesCount || 3} 条精读推演
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] bg-purple-500/20 text-purple-600 dark:text-purple-200 px-2 py-1 rounded-md font-medium border border-purple-500/40 flex items-center gap-1">
                      <span>进入子话题</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                )}

                {/* Cartridge Citation Pill (PRD Section 5.3) */}
                {message.cartridgeCitation && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 overflow-hidden text-[11px] animate-in fade-in">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCitations((prev) => ({
                          ...prev,
                          [message.id]: !prev[message.id],
                        }))
                      }
                      className="w-full px-3 py-1.5 flex items-center justify-between text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>
                          💡 引用了外挂卡带「<strong>{message.cartridgeCitation.cartridgeName}</strong>」中的{' '}
                          {message.cartridgeCitation.recalledCount} 条规约经验（消耗 ~{message.cartridgeCitation.tokenCost} Tokens）
                        </span>
                      </div>
                      {expandedCitations[message.id] ? (
                        <ChevronUp className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                    </button>

                    {expandedCitations[message.id] && (
                      <div className="p-3 border-t border-amber-500/20 bg-surface space-y-1.5 font-mono text-[10px]">
                        <div className="text-fg-muted font-bold mb-1">引用的经验条目明细 (只读注入):</div>
                        {message.cartridgeCitation.items.map((it, idx) => (
                          <div key={idx} className="p-2 rounded bg-surface-subtle border border-border">
                            <span className="font-bold text-amber-600 dark:text-amber-400">[{it.key}] </span>
                            <span className="text-fg-secondary">{it.content}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ACP Protocol Trace Drawer (Antigravity Architecture) */}
                {message.acpTrace && (
                  <div className="rounded-xl bg-surface-subtle border border-border overflow-hidden text-[10px] font-mono">
                    <button
                      onClick={() => toggleTrace(message.id)}
                      className="w-full px-3 py-1.5 flex items-center justify-between text-fg-muted hover:text-fg bg-surface-subtle transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 text-accent">
                        <Terminal className="w-3 h-3" />
                        <span>ACP Stdio Trace · {message.acpTrace.method} ({message.acpTrace.durationMs}ms)</span>
                      </span>
                      {isTraceOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {isTraceOpen && (
                      <div className="p-3 border-t border-border space-y-1.5 text-fg-secondary bg-surface">
                        {message.acpTrace.workspaceAction && (
                          <div className="flex items-center gap-2 text-blue-500">
                            <FolderGit2 className="w-3 h-3" />
                            <span>Workspace: {message.acpTrace.workspaceAction.summary} ({message.acpTrace.workspaceAction.path})</span>
                          </div>
                        )}
                        {message.acpTrace.memoryAction && (
                          <div className="flex items-center gap-2 text-emerald-500">
                            <Database className="w-3 h-3" />
                            <span>Memory: {message.acpTrace.memoryAction.detail} (Key: {message.acpTrace.memoryAction.key})</span>
                          </div>
                        )}
                        {message.acpTrace.skillUsed && (
                          <div className="flex items-center gap-2 text-purple-500">
                            <Wrench className="w-3 h-3" />
                            <span>Skill: {message.acpTrace.skillUsed.name} ➔ {message.acpTrace.skillUsed.output}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Reactions */}
                {message.reactions && message.reactions.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-1">
                    {message.reactions.map((reaction, i) => (
                      <button
                        key={i}
                        onClick={() => onAddReaction(message.id, reaction.emoji)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-subtle hover:bg-surface-hover border border-border text-xs transition-colors cursor-pointer"
                      >
                        <span>{reaction.emoji}</span>
                        <span className="text-[10px] text-fg-muted font-mono">{reaction.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {/* Antigravity / Codex Minimal Inline Live Thinking for 1v1 DM */}
        {activeThread.type === 'dm' && currentThreadExecutions.length > 0 && (
          <div className="max-w-3xl mx-auto pl-2 py-1 select-none animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setIsDmThinkingOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg transition-colors cursor-pointer group"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 text-fg-muted ${isDmThinkingOpen ? '' : '-rotate-90'}`} />
                <span className="font-mono text-accent font-medium">
                  {currentThreadExecutions[0].status === 'thinking' ? 'Thinking' : 'Working'} ({((now - currentThreadExecutions[0].startedAt) / 1000).toFixed(1)}s)...
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-ping ml-0.5" />
              </button>
            </div>
            {isDmThinkingOpen && (
              <div className="pl-5 pt-1.5 pb-2 text-fg-muted font-mono text-[10px] leading-relaxed border-l-2 border-accent/40 ml-1.5 space-y-1 animate-in fade-in">
                <p className="text-fg-secondary font-medium">
                  {currentThreadExecutions[0].currentActionDetail ||
                    ((now - currentThreadExecutions[0].startedAt) / 1000 > 60
                      ? '大模型正在深度推理生成，请耐心稍候...'
                      : (now - currentThreadExecutions[0].startedAt) / 1000 > 25
                      ? '正在深入分析上下文与技术边界...'
                      : '正在深入分析上下文与工程边界...')}
                </p>
              </div>
            )}
            <div className="pl-5 pt-1 text-fg-muted flex items-center gap-1">
              <span className="inline-block w-1.5 h-3 bg-accent animate-pulse" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Buzz-Style Channel Composer Activity Bar (Bottom-Left Stacked for Channel) */}
      {activeThread.type !== 'dm' && currentThreadExecutions.length > 0 && (
        <div className="shrink-0 max-w-3xl mx-auto w-full px-4 mb-2">
          <ChannelComposerActivityBar
            executions={currentThreadExecutions}
            onAbortAgent={onAbortAgent}
            onOpenAgentSession={onInspectAgent}
          />
        </div>
      )}

      {/* Right-Click Context Menu */}
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
            onClick={() => handleQuote(contextMenu.message)}
            className="w-full px-2.5 py-1.5 flex items-center gap-2 rounded-lg hover:bg-surface-hover text-fg transition-colors cursor-pointer text-left"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-accent" />
            <span>引用回复</span>
          </button>

          <div className="border-t border-border/50 my-1"></div>

          {/* Quick Reaction Row in Context Menu */}
          <div className="flex items-center justify-around px-1 py-1">
            {['🔥', '🥷', '💡', '👍'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onAddReaction(contextMenu.message.id, emoji);
                  setContextMenu(null);
                }}
                className="p-1 hover:bg-surface-hover rounded-md text-sm transition-transform hover:scale-125 cursor-pointer"
                title={`添加 ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toast Notification on Copied */}
      {copiedMsgId && (
        <div className="fixed bottom-24 right-8 z-50 px-3 py-1.5 rounded-xl bg-surface border border-border shadow-2xl text-fg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span>消息内容已复制到剪贴板</span>
        </div>
      )}
    </div>
  );
};
