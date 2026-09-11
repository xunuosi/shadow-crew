import React, { useState } from 'react';
import { Message, Thread, Agent, Channel } from '../types';
import { TopicMessageCard } from './TopicMessageCard';
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
  Lock
} from 'lucide-react';

interface ChatTimelineProps {
  messages: Message[];
  activeThread: Thread;
  channel?: Channel;
  agents: Agent[];
  onAddReaction: (messageId: string, emoji: string) => void;
  onInspectAgent: (agentId: string) => void;
  onOpenTopic?: (topicId: string) => void;
  onOpenNewTopicModal?: () => void;
  onOpenSubThread?: (subThreadId: string) => void;
  onOpenCodexDiff: (diff: any) => void;
  onOpenAcpInspector: () => void;
  onOpenMembersModal?: () => void;
  onOpenDeleteChannelModal?: () => void;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  activeThread,
  channel,
  agents,
  onAddReaction,
  onInspectAgent,
  onOpenTopic,
  onOpenNewTopicModal,
  onOpenSubThread,
  onOpenCodexDiff,
  onOpenAcpInspector,
  onOpenMembersModal,
  onOpenDeleteChannelModal,
}) => {
  const [filter, setFilter] = useState<'all' | 'topics' | 'resolved'>('all');
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({
    'msg-openclaw-primary': true,
  });
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

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

  const activeAgents = agents.filter((a) => activeThread.activeAgentIds?.includes(a.id));

  const filteredMessages = messages.filter((m) => {
    if (filter === 'topics') return m.type === 'topic';
    if (filter === 'resolved') return m.type === 'topic' && m.topicData?.status === 'resolved';
    return true;
  });

  const topicCount = messages.filter((m) => m.type === 'topic').length;

  return (
    <div 
      id="shinobi-chat-timeline-pane"
      className="flex-1 flex flex-col min-w-0 bg-canvas text-fg text-xs overflow-hidden transition-colors duration-150"
    >
      {/* 1. Top Channel / Thread Header */}
      <header className="h-12 px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0">
        <div className="flex items-center gap-2.5 truncate">
          <span className="font-bold text-fg text-sm tracking-wide truncate flex items-center gap-1.5">
            {activeThread.type === 'dm' ? (
              <span>DM with <span className="text-accent font-semibold">{activeThread.authorName}</span></span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-accent font-mono font-bold">#{channel?.name || activeThread.channelName}</span>
                {channel?.kind && (
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-semibold border ${
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
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{channel.gitBranch}</span>
            </span>
          )}

          {/* Filter Pill Tabs */}
          <div className="hidden md:flex items-center bg-surface rounded-lg p-0.5 border border-border gap-0.5 ml-2">
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
                <span className="px-1 py-0.1 rounded-full text-[9px] bg-purple-500/20 text-purple-500 font-mono">
                  {topicCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1.5 text-fg-muted relative">
          {/* Members / Invite Admission Button */}
          {onOpenMembersModal && channel && (
            <button
              onClick={onOpenMembersModal}
              className="px-2 py-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg border border-border flex items-center gap-1 text-[11px] cursor-pointer"
              title="查看与邀请频道成员"
            >
              <Users className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline">{channel.memberIds?.length || 1} 成员</span>
            </button>
          )}

          {/* + New Topic Button */}
          {onOpenNewTopicModal && (
            <button
              onClick={onOpenNewTopicModal}
              className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-[11px] shadow-xs flex items-center gap-1 transition-all cursor-pointer"
              title="在当前频道发起独立推演议题"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">新建议题</span>
            </button>
          )}

          {/* Delete Channel Button */}
          {onOpenDeleteChannelModal && channel && (
            <button
              onClick={onOpenDeleteChannelModal}
              className="p-1.5 rounded-lg hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="删除此频道 (级联清理)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Codex Diff Toggle */}
          <button
            onClick={() => onOpenCodexDiff(null)}
            className="px-2 py-1 rounded-lg hover:text-emerald-500 hover:bg-surface-hover border border-transparent hover:border-emerald-500/30 transition-all flex items-center gap-1 text-[11px] cursor-pointer"
            title="查看代码变更与 Unified Diff (Codex 视图)"
          >
            <GitCompare className="w-3.5 h-3.5 text-emerald-500" />
            <span className="hidden sm:inline font-mono">Diff</span>
          </button>

          {/* ACP Inspector Toggle */}
          <button
            onClick={onOpenAcpInspector}
            className="px-2 py-1 rounded-lg hover:text-accent hover:bg-surface-hover border border-transparent hover:border-accent/30 transition-all flex items-center gap-1 text-[11px] cursor-pointer"
            title="打开 ACP 协议与私有记忆观测面板 (Antigravity 视图)"
          >
            <Terminal className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline font-mono">ACP</span>
          </button>

          {/* Popout button */}
          <button 
            className="p-1.5 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="在新窗口打开此讨论"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Collaborator Count & List */}
          <div className="relative">
            <button 
              onClick={() => setShowMembersPopover(!showMembersPopover)}
              className="px-2 py-1 rounded-lg hover:text-fg hover:bg-surface-hover transition-colors flex items-center gap-1 cursor-pointer"
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
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Parent Quote Anchor (Identical to Screenshot) */}
        {activeThread.parentQuoteSnippet && (
          <div className="max-w-3xl mx-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-subtle border border-border text-fg-muted text-xs shadow-xs">
            <CornerDownRight className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate italic">
              {activeThread.parentQuoteSnippet}
            </span>
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
                />
              </div>
            );
          }

          const isThinkingOpen = expandedThinking[message.id] ?? false;
          const isTraceOpen = expandedTraces[message.id] ?? false;

          return (
            <article
              key={message.id}
              className="max-w-3xl mx-auto group relative transition-all"
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
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-subtle text-fg-secondary font-mono flex items-center gap-1 border border-border">
                        <Bot className="w-2.5 h-2.5 text-accent" />
                        <span>managed by {message.managedBy}</span>
                      </span>
                    )}

                    {message.agentBadge && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono border border-emerald-500/30">
                        {message.agentBadge}
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
                )}

                {/* Main Markdown Text with Code Formatting */}
                <div className="text-fg leading-relaxed text-xs space-y-2 whitespace-pre-wrap font-sans">
                  {message.content}
                </div>

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
      </div>
    </div>
  );
};
