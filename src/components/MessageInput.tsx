import React, { useState } from 'react';
import { Agent } from '../types';
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
  Plus
} from 'lucide-react';

interface MessageInputProps {
  onSendMessage: (content: string, targetAgentId?: string) => void;
  activeAgents: Agent[];
  isGenerating?: boolean;
  channelName?: string;
  onOpenNewTopicModal?: () => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  activeAgents,
  isGenerating = false,
  channelName = 'TestChannel',
  onOpenNewTopicModal,
}) => {
  const [content, setContent] = useState('');
  const [selectedModel, setSelectedModel] = useState<'claude' | 'deepseek' | 'openai' | 'shinobi'>('claude');

  const handleSend = () => {
    if (!content.trim() || isGenerating) return;
    onSendMessage(content);
    setContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addMention = (handle: string) => {
    setContent((prev) => {
      if (prev.includes(handle)) return prev;
      return `${handle} ${prev}`.trim() + ' ';
    });
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

        {/* 2. Main Textarea Box */}
        <div className="relative bg-surface-subtle border border-border rounded-2xl p-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 transition-all">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`在 #${channelName} 发起讨论或 @Agent 执行任务...`}
            rows={2}
            className="w-full bg-transparent text-fg placeholder-fg-muted text-xs focus:outline-none resize-none leading-relaxed"
          />

          {/* 3. Bottom Toolbar with Models & Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border mt-1 select-none">
            {/* Left Action Icons */}
            <div className="flex items-center gap-1 text-fg-muted">
              <button 
                onClick={() => addMention('@')}
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
                title="提及 Agent"
              >
                <AtSign className="w-3.5 h-3.5" />
              </button>

              {/* Model Badges Pill Switcher (Matching colorful O M M in screenshot) */}
              <div className="flex items-center bg-surface rounded-lg p-0.5 border border-border gap-0.5 mx-1">
                <button
                  onClick={() => setSelectedModel('openai')}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer ${
                    selectedModel === 'openai' ? 'bg-red-500/20 text-red-600 dark:text-red-300 border border-red-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="OpenAI GPT-4o"
                >
                  O
                </button>
                <button
                  onClick={() => setSelectedModel('claude')}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer ${
                    selectedModel === 'claude' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="Anthropic Claude 3.7"
                >
                  M
                </button>
                <button
                  onClick={() => setSelectedModel('deepseek')}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer ${
                    selectedModel === 'deepseek' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="DeepSeek V3 / R1"
                >
                  D
                </button>
                <button
                  onClick={() => setSelectedModel('shinobi')}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer ${
                    selectedModel === 'shinobi' ? 'bg-accent/20 text-accent border border-accent/50' : 'text-fg-muted hover:text-fg'
                  }`}
                  title="Shinobi Engine"
                >
                  🥷
                </button>
              </div>

              {/* Attachment */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
                title="添加工作区文件或 Diff 附件"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              {/* Voice */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
                title="语音输入"
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              {/* Emoji */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
                title="插入表情"
              >
                <Smile className="w-3.5 h-3.5" />
              </button>

              {/* Typography / AA */}
              <button 
                className="p-1.5 rounded-lg hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer"
                title="富文本格式"
              >
                <span className="text-[10px] font-bold">AA</span>
              </button>
            </div>

            {/* Right Circular Send Button (Identical to Screenshot) */}
            <button
              onClick={handleSend}
              disabled={!content.trim() || isGenerating}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md ${
                content.trim() && !isGenerating
                  ? 'bg-accent text-accent-fg hover:opacity-95 hover:scale-105 active:scale-95'
                  : 'bg-surface border border-border text-fg-muted cursor-not-allowed'
              }`}
              title="发送消息 (Enter)"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
