import React, { useState, useRef, useEffect } from 'react';
import { Agent, Message } from '../types';
import { 
  Send, 
  AtSign, 
  Paperclip, 
  Mic, 
  Smile, 
  Type, 
  Bot, 
  Sparkles,
  ArrowUp,
  GitBranch,
  Plus,
  CornerDownRight,
  X,
  Square
} from 'lucide-react';
import { MentionSuggestions, MentionItem } from './MentionSuggestions';

interface MessageInputProps {
  onSendMessage: (content: string, targetAgentId?: string) => void;
  activeAgents: Agent[];
  allAgents?: Agent[];
  isGenerating?: boolean;
  onAbort?: () => void;
  channelName?: string;
  onOpenNewTopicModal?: () => void;
  quotingMessage?: Message | null;
  onCancelQuote?: () => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  activeAgents,
  allAgents = [],
  isGenerating = false,
  onAbort,
  channelName = 'TestChannel',
  onOpenNewTopicModal,
  quotingMessage,
  onCancelQuote,
}) => {
  const [content, setContent] = useState('');
  const [selectedModel, setSelectedModel] = useState<'claude' | 'deepseek' | 'openai' | 'shinobi'>('claude');
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (quotingMessage && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [quotingMessage]);

  const candidateAgents = allAgents.length > 0 ? allAgents : activeAgents;
  const filteredCandidates = candidateAgents.filter(
    (ag) =>
      mentionQuery === '' ||
      ag.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.handle.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      ag.role.toLowerCase().includes(mentionQuery.toLowerCase())
  );
  const showSpecialAll = 'all'.includes(mentionQuery.toLowerCase()) || mentionQuery === '';
  const totalCount = filteredCandidates.length + (showSpecialAll ? 1 : 0);

  const handleSend = () => {
    if (!content.trim() || isGenerating) return;
    let finalContent = content;
    if (quotingMessage) {
      const quoteSnippet = quotingMessage.content.trim().split('\n')[0].slice(0, 100);
      const quoteHeader = `> **@${quotingMessage.authorName}**: ${quoteSnippet}${quotingMessage.content.length > 100 ? '...' : ''}\n\n`;
      finalContent = quoteHeader + content;
      onCancelQuote?.();
    }
    onSendMessage(finalContent);
    setContent('');
    setIsMentionOpen(false);
  };

  const handleSelectMention = (item: { handle: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart || content.length;
    const textBefore = content.slice(0, cursor);
    const textAfter = content.slice(cursor);
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);

    if (match) {
      const atStartPos = match.index! + (match[0].startsWith(' ') ? 1 : 0);
      const newBefore = textBefore.slice(0, atStartPos) + item.handle + ' ';
      const newContent = newBefore + textAfter;
      setContent(newContent);
      setIsMentionOpen(false);
      setMentionQuery('');
      setMentionIndex(0);

      setTimeout(() => {
        textarea.focus();
        const newCursor = newBefore.length;
        textarea.setSelectionRange(newCursor, newCursor);
      }, 0);
    } else {
      addMention(item.handle);
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

    if (isGenerating && e.key === 'Escape') {
      e.preventDefault();
      onAbort?.();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

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

  const addMention = (handle: string) => {
    setContent((prev) => {
      if (prev.includes(handle)) return prev;
      return `${handle} ${prev}`.trim() + ' ';
    });
    textareaRef.current?.focus();
  };

  const handleToolbarAtClick = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const cursor = textarea.selectionStart || content.length;
    const newContent = content.slice(0, cursor) + '@' + content.slice(cursor);
    setContent(newContent);
    setMentionQuery('');
    setIsMentionOpen(true);
    setMentionIndex(0);
    setTimeout(() => {
      const nextCursor = cursor + 1;
      textarea.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  return (
    <div 
      id="shinobi-composer-pane"
      className="p-3.5 bg-surface border-t border-border select-none text-xs transition-colors duration-150"
    >
      <div className="max-w-3xl mx-auto space-y-2">
        {/* 1. Top Quick-Mention Agent Pills + New Topic Trigger */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
          {onOpenNewTopicModal && (
            <button
              onClick={onOpenNewTopicModal}
              className="px-2.5 py-1 rounded-full bg-purple-500/15 hover:bg-purple-500/25 text-purple-600 dark:text-purple-300 border border-purple-500/40 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
              title="新建议题 (开启独立单层推演)"
            >
              <GitBranch className="w-3.5 h-3.5 text-purple-500" />
              <span>+ 新建议题</span>
            </button>
          )}

          {activeAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => addMention(agent.handle)}
              className="px-2.5 py-1 rounded-full bg-surface-subtle hover:bg-surface-hover text-fg-secondary hover:text-fg border border-border hover:border-accent/40 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              title={`点击召唤 ${agent.name}`}
            >
              <span className="text-xs">{agent.avatar}</span>
              <span className="font-semibold text-xs text-fg">{agent.name}</span>
            </button>
          ))}
          <button
            onClick={() => addMention('@all')}
            className="px-2.5 py-1 rounded-full bg-surface-subtle hover:bg-surface-hover text-fg-muted hover:text-fg border border-border font-mono text-[10px] cursor-pointer shrink-0"
          >
            @all 全员
          </button>
        </div>

        {/* 2. Main Textarea Box with Floating Mention Suggestions */}
        <div className="relative bg-surface-subtle border border-border rounded-2xl p-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 transition-all">
          <MentionSuggestions
            isOpen={isMentionOpen}
            query={mentionQuery}
            agents={candidateAgents}
            selectedIndex={mentionIndex}
            onSelect={handleSelectMention}
            onClose={() => setIsMentionOpen(false)}
          />

          {/* Quoting Preview Banner */}
          {quotingMessage && (
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-surface border border-accent/40 rounded-xl mb-2 text-xs shadow-xs animate-in fade-in slide-in-from-top-1 select-none">
              <div className="flex items-center gap-2 min-w-0">
                <CornerDownRight className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="font-bold text-fg text-xs shrink-0">引用 @{quotingMessage.authorName}:</span>
                <span className="text-fg-muted truncate text-[11px] italic">{quotingMessage.content.slice(0, 70)}</span>
              </div>
              <button
                onClick={onCancelQuote}
                className="p-1 hover:text-fg text-fg-muted rounded-md transition-colors cursor-pointer shrink-0"
                title="取消引用"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`在 #${channelName} 发起讨论或输入 @ 召唤 Agent 执行推演... (⌘ + Enter 发送)`}
            rows={2}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none leading-relaxed"
          />

          {/* 3. Bottom Toolbar with Models & Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border mt-1 select-none">
            {/* Left Action Icons */}
            <div className="flex items-center gap-1 text-fg-muted flex-wrap">
              <button 
                onClick={handleToolbarAtClick}
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title="输入 @ 提及 Agent"
              >
                <AtSign className="w-3.5 h-3.5 text-accent" />
              </button>

              {/* Model Badges Pill Switcher (Matching colorful O M M in screenshot) */}
              <div className="flex items-center bg-surface rounded-lg p-0.5 border border-border gap-0.5 mx-1 shrink-0">
                <button
                  onClick={() => setSelectedModel('openai')}
                  className={`min-w-[22px] h-[22px] px-1 rounded flex items-center justify-center text-[10px] font-bold leading-none transition-all cursor-pointer shrink-0 ${
                    selectedModel === 'openai' ? 'bg-red-500/20 text-red-600 dark:text-red-300 border border-red-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="OpenAI GPT-4o"
                >
                  O
                </button>
                <button
                  onClick={() => setSelectedModel('claude')}
                  className={`min-w-[22px] h-[22px] px-1 rounded flex items-center justify-center text-[10px] font-bold leading-none transition-all cursor-pointer shrink-0 ${
                    selectedModel === 'claude' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="Anthropic Claude 3.7"
                >
                  M
                </button>
                <button
                  onClick={() => setSelectedModel('deepseek')}
                  className={`min-w-[22px] h-[22px] px-1 rounded flex items-center justify-center text-[10px] font-bold leading-none transition-all cursor-pointer shrink-0 ${
                    selectedModel === 'deepseek' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="DeepSeek V3 / R1"
                >
                  D
                </button>
                <button
                  onClick={() => setSelectedModel('shinobi')}
                  className={`min-w-[22px] h-[22px] px-1 rounded flex items-center justify-center text-[10px] font-bold leading-none transition-all cursor-pointer shrink-0 ${
                    selectedModel === 'shinobi' ? 'bg-accent/20 text-accent border border-accent/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="Shinobi Engine"
                >
                  🥷
                </button>
              </div>

              {/* Attachment */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title="添加工作区文件或 Diff 附件"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              {/* Voice */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title="语音输入"
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              {/* Emoji */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title="插入表情"
              >
                <Smile className="w-3.5 h-3.5" />
              </button>

              {/* Typography / AA */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title="富文本格式"
              >
                <span className="text-[10px] font-bold">AA</span>
              </button>
            </div>

            {/* Right Action Button: Send or Stop */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden sm:inline text-[10px] font-mono text-fg-muted select-none">
                {isGenerating ? 'Esc 停止' : '⌘ + Enter'}
              </span>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onAbort}
                  className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all cursor-pointer shadow-md shrink-0 hover:scale-105 active:scale-95 animate-in fade-in zoom-in-90"
                  title="停止生成 (Esc)"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!content.trim()}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md shrink-0 ${
                    content.trim()
                      ? 'bg-accent text-accent-fg hover:opacity-95 hover:scale-105 active:scale-95'
                      : 'bg-surface border border-border text-fg-muted cursor-not-allowed'
                  }`}
                  title="发送消息 (⌘ + Enter)"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
