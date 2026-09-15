import React, { useState, useRef, useEffect } from 'react';
import { TopicMessageData, Message, Agent, ActiveAgentExecution } from '../types';
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
  Square
} from 'lucide-react';
import { MentionSuggestions } from './MentionSuggestions';
import { renderFormattedContent } from '../utils/formatMentions';

interface TopicThreadDrawerProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  messages: Message[];
  agents: Agent[];
  activeExecutions?: ActiveAgentExecution[];
  onAbortAgent?: (agentId: string) => void;
  onClose: () => void;
  onSendMessage: (topicId: string, content: string) => void;
  onResolveTopic: (topicId: string, decision: {
    solution: string;
    impactedFiles: string[];
    approvers: string[];
  }) => void;
  onReopenTopic?: (topicId: string) => void;
  onOpenCodexDiff: (diff: any) => void;
}

export const TopicThreadDrawer: React.FC<TopicThreadDrawerProps> = ({
  isOpen,
  topic,
  messages,
  agents,
  activeExecutions = [],
  onAbortAgent,
  onClose,
  onSendMessage,
  onResolveTopic,
  onReopenTopic,
  onOpenCodexDiff,
}) => {
  const [replyContent, setReplyContent] = useState('');
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [solutionDraft, setSolutionDraft] = useState('');
  const [impactedFilesDraft, setImpactedFilesDraft] = useState('src/middleware/auth.ts, src/routes/oauth.ts');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    setReplyContent((prev) => `> **@${message.authorName}**: ${clean}...\n\n${prev}`);
    setTimeout(() => textareaRef.current?.focus(), 50);
    setContextMenu(null);
  };

  // Live execution tracking for topic drawer
  const topicExecutions = activeExecutions.filter(
    (e) => (topic && e.topicId === topic.id) || (topic && e.threadId === topic.id)
  );
  const isExecuting = topicExecutions.length > 0;
  const activeTopicExecution = topicExecutions[0];

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isExecuting) return;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [isExecuting]);

  if (!isOpen || !topic) return null;

  const isResolved = topic.status === 'resolved';

  const candidateAgents = agents;
  const filteredCandidates = candidateAgents.filter(
    (ag) =>
      mentionQuery === '' ||
      ag.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.handle.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.role.toLowerCase().includes(mentionQuery.toLowerCase())
  );
  const showSpecialAll = 'all'.includes(mentionQuery.toLowerCase()) || mentionQuery === '';
  const totalCount = filteredCandidates.length + (showSpecialAll ? 1 : 0);

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleSend = () => {
    if (!replyContent.trim()) return;
    onSendMessage(topic.id, replyContent);
    setReplyContent('');
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
      setReplyContent(newContent);
      setIsMentionOpen(false);
      setMentionQuery('');
      setMentionIndex(0);

      setTimeout(() => {
        textarea.focus();
        const newCursor = newBefore.length;
        textarea.setSelectionRange(newCursor, newCursor);
      }, 0);
    } else {
      setReplyContent((prev) => (prev.includes(item.handle) ? prev : `${item.handle} ${prev}`.trim() + ' '));
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
      if (activeTopicExecution) onAbortAgent?.(activeTopicExecution.agentId);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setReplyContent(val);

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
      id="shinobi-topic-thread-drawer"
      className="w-full sm:w-[420px] md:w-[460px] lg:w-[480px] bg-surface border-l border-border flex flex-col shrink-0 text-xs text-fg-secondary shadow-2xl z-40 transition-all duration-200"
    >
      {/* 1. Drawer Header */}
      <div className="min-h-[52px] py-2 px-3 sm:px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0 gap-2">
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          <div className="w-6 h-6 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0">
            <GitBranch className="w-3.5 h-3.5" />
          </div>
          <div className="truncate min-w-0 flex-1">
            <h2 className="font-bold text-fg truncate text-xs sm:text-sm">
              {topic.title}
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-fg-muted font-mono truncate">
              {isResolved ? (
                <span className="text-emerald-500 font-semibold flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>🟢 已达成共识 (Resolved)</span>
                </span>
              ) : isExecuting && activeTopicExecution ? (
                <span className="text-purple-500 font-semibold flex items-center gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                  <span>🟡 {activeTopicExecution.agentName} 正在推演 ({((now - activeTopicExecution.startedAt) / 1000).toFixed(1)}s)</span>
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
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-purple-500 via-accent to-purple-500 animate-streamline" />
        </div>
      )}

      {/* 2. Topic Anchor Context */}
      <div className="p-3.5 bg-surface-subtle border-b border-border text-[11px] space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
            <CornerDownRight className="w-3 h-3" />
            <span>议题发起上下文与目标:</span>
          </span>
          <span className="text-[10px] text-fg-muted font-mono">
            发起人: {topic.authorName} · {topic.timestamp}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-surface border border-border text-fg leading-relaxed">
          {topic.description || topic.title}
        </div>
      </div>

      {/* 3. Topic Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans">
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

            return (
              <div
                key={msg.id}
                onContextMenu={(e) => handleContextMenu(e, msg)}
                className="space-y-2 p-3 rounded-2xl bg-surface border border-border transition-all hover:border-purple-500/40 group relative"
              >
                {/* Message Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-surface border border-border flex items-center justify-center text-xs shadow-xs">
                      {msg.authorAvatar}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-fg text-xs">{msg.authorName}</span>
                      {msg.agentBadge && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 font-mono border border-purple-500/30 shrink-0">
                          {msg.agentBadge}
                        </span>
                      )}
                      {msg.collaborationInfo && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 flex items-center gap-1 ${
                            msg.collaborationInfo.isCircuitBroken
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold'
                              : 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30'
                          }`}
                        >
                          {msg.collaborationInfo.isCircuitBroken ? (
                            <span>🛡️ 协同熔断</span>
                          ) : (
                            <span>🔗 响应 {msg.collaborationInfo.invokedByAgentName || msg.collaborationInfo.invokedByAgentHandle || '协同'} (Hop {msg.collaborationInfo.hop})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mr-1">
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
                    <span className="text-[10px] text-fg-muted font-mono shrink-0">{msg.timestamp}</span>
                  </div>
                </div>

                {/* Thinking Process Accordion */}
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
                      <div className="p-2.5 border-t border-border font-mono text-[10px] text-fg-secondary leading-relaxed whitespace-pre-wrap bg-surface">
                        <div className="text-accent font-bold mb-1">推理摘要: {msg.thinkingProcess.summary}</div>
                        <div className="text-fg-muted">{msg.thinkingProcess.detail}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Message Content */}
                <div className="text-xs text-fg leading-relaxed whitespace-pre-wrap font-sans">
                  {renderFormattedContent(msg.content)}
                </div>

                {/* Unified Diff View */}
                {msg.diffView && (
                  <div className="p-2.5 rounded-lg bg-surface border border-border font-mono text-[10px]">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <FileCode2 className="w-3 h-3 text-emerald-500" />
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
                    <pre className="p-2 rounded bg-surface-subtle border border-border overflow-x-auto text-[10px] text-fg-secondary leading-relaxed">
                      {msg.diffView.diff}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Topic In-Thread Live Thinking Stepper */}
        {isExecuting && activeTopicExecution && (
          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs space-y-1.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <BrainCircuit className="w-3.5 h-3.5 animate-pulse text-purple-500" />
                <span>{activeTopicExecution.agentName} 正在论证推演中</span>
              </span>
              <span className="text-[10px] font-mono text-purple-500 font-semibold">
                {((now - activeTopicExecution.startedAt) / 1000).toFixed(1)}s
              </span>
            </div>
            <p className="text-[11px] text-fg-muted font-mono leading-relaxed">
              {activeTopicExecution.currentActionDetail || '正在评估架构方案、校验多分支边界...'}
            </p>
          </div>
        )}
      </div>

      {/* 4. Consensus Rollup Banner / Action Button */}
      <div className="p-3 border-t border-border bg-surface-subtle space-y-2.5">
        {!isResolved ? (
          <button
            onClick={() => setShowResolveModal(true)}
            className="w-full min-h-[38px] py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer leading-snug text-center"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="text-center">达成共识并沉淀结论 (Resolve & Merge)</span>
          </button>
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
        )}

        {/* Mini Composer to Reply in this Topic */}
        <div className="relative bg-surface border border-border rounded-xl p-2 focus-within:border-purple-500 transition-all">
          <MentionSuggestions
            isOpen={isMentionOpen}
            query={mentionQuery}
            agents={candidateAgents}
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
                  setReplyContent(newContent);
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

            {isExecuting ? (
              <button
                type="button"
                onClick={() => activeTopicExecution && onAbortAgent?.(activeTopicExecution.agentId)}
                className="px-2 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-all cursor-pointer shadow-xs flex items-center gap-1 text-[11px] font-medium animate-in fade-in"
                title="终止推演 (Esc)"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>终止</span>
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
