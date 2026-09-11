import React, { useState } from 'react';
import { TopicMessageData, Message, Agent } from '../types';
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
  RotateCcw
} from 'lucide-react';

interface TopicThreadDrawerProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  messages: Message[];
  agents: Agent[];
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

  if (!isOpen || !topic) return null;

  const isResolved = topic.status === 'resolved';

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleSend = () => {
    if (!replyContent.trim()) return;
    onSendMessage(topic.id, replyContent);
    setReplyContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
      <div className="h-12 px-4 border-b border-border flex items-center justify-between bg-surface-subtle select-none">
        <div className="flex items-center gap-2 truncate min-w-0">
          <div className="w-6 h-6 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0">
            <GitBranch className="w-3.5 h-3.5" />
          </div>
          <div className="truncate">
            <h2 className="font-bold text-fg truncate text-xs sm:text-sm">
              {topic.title}
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-fg-muted font-mono">
              {isResolved ? (
                <span className="text-emerald-500 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>🟢 已达成共识 (Resolved)</span>
                </span>
              ) : (
                <span className="text-purple-500 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                  <span>🟡 深度推演中 · {participatingAgents.length} 位协作 Agent</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            title="关闭抽屉 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

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
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">暂无论证记录，可在下方输入指令开始协同推演。</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isThinkingOpen = expandedThinking[msg.id] ?? true;

            return (
              <div
                key={msg.id}
                className="p-3 rounded-xl bg-surface-subtle border border-border space-y-2.5 transition-all"
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
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 font-mono border border-purple-500/30">
                          {msg.agentBadge}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-fg-muted font-mono">{msg.timestamp}</span>
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
                <div className="text-xs text-fg leading-relaxed whitespace-pre-wrap">
                  {msg.content}
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
                          className="px-1.5 py-0.2 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-[9px] font-sans flex items-center gap-0.5 ml-1 transition-colors cursor-pointer"
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
      </div>

      {/* 4. Consensus Rollup Banner / Action Button */}
      <div className="p-3 border-t border-border bg-surface-subtle space-y-2.5">
        {!isResolved ? (
          <button
            onClick={() => setShowResolveModal(true)}
            className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>达成共识并沉淀结论 (Resolve & Merge)</span>
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
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在当前议题中回复或 @Agent 继续推演..."
            rows={2}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none leading-relaxed"
          />
          <div className="flex items-center justify-between pt-1 border-t border-border mt-1">
            <span className="text-[10px] text-fg-muted font-mono">Shift+Enter 换行</span>
            <button
              onClick={handleSend}
              disabled={!replyContent.trim()}
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition-all cursor-pointer shadow-xs"
            >
              <Send className="w-3 h-3" />
            </button>
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
    </aside>
  );
};
