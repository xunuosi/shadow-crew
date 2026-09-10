import React, { useState } from 'react';
import { Agent } from '../types';
import { Send, AtSign, Sparkles, Terminal, Database, FolderGit2, Wrench, Command } from 'lucide-react';

interface MessageInputProps {
  onSendMessage: (content: string, targetAgentId?: string) => void;
  activeAgents: Agent[];
  isGenerating: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  activeAgents,
  isGenerating,
}) => {
  const [content, setContent] = useState('');
  const [selectedMention, setSelectedMention] = useState<string | null>(null);

  const handleSend = () => {
    if (!content.trim() || isGenerating) return;
    onSendMessage(content, selectedMention || undefined);
    setContent('');
    setSelectedMention(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const applyPresetPrompt = (preset: string, targetAgentHandle?: string) => {
    setContent(preset);
    if (targetAgentHandle) {
      setSelectedMention(targetAgentHandle);
    }
  };

  return (
    <div 
      id="buzz-message-input-area"
      className="p-3 bg-[#0d1017] border-t border-[#1a212f] select-none text-xs"
    >
      {/* Quick Mention Chips & Test Scenarios Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
        {/* Mentions */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
          <span className="text-gray-500 font-mono text-[10px] flex items-center gap-0.5">
            <AtSign className="w-3 h-3" /> @召唤:
          </span>
          {activeAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                setContent((prev) => `${agent.handle} ${prev.replace(agent.handle, '')}`.trim() + ' ');
                setSelectedMention(agent.id);
              }}
              className="px-2 py-0.5 rounded-full bg-[#151c2a] hover:bg-[#1f2a3f] text-gray-300 border border-[#232f45] transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>{agent.avatar}</span>
              <span className="font-mono text-[10px] text-emerald-400">{agent.handle}</span>
            </button>
          ))}
          <button
            onClick={() => {
              setContent((prev) => `@all ${prev.replace('@all', '')}`.trim() + ' ');
            }}
            className="px-2 py-0.5 rounded-full bg-[#1c2333] hover:bg-[#253047] text-gray-300 border border-[#2a374f] font-mono text-[10px] cursor-pointer"
          >
            @all (全员讨论)
          </button>
        </div>

        {/* Quick Question Verification Presets */}
        <div className="flex items-center gap-1 overflow-x-auto text-[10px] text-gray-400">
          <span className="text-gray-500">验证三要素:</span>
          <button
            onClick={() => applyPresetPrompt('@buzz-agent 请检索你的本地私有数据库记忆，关于 ACP 协议的历史处理规则是什么？', 'agent-buzz')}
            className="px-1.5 py-0.5 rounded bg-[#131b28] hover:bg-[#1a2538] border border-emerald-800/40 text-emerald-300 transition-colors flex items-center gap-1 cursor-pointer"
            title="测试 Agent 是否能使用自身私有 Memory"
          >
            <Database className="w-2.5 h-2.5 text-emerald-400" />
            <span>测试私有Memory</span>
          </button>

          <button
            onClick={() => applyPresetPrompt('@buzz-agent 请读取工作空间文件 crates/buzz-acp/src/client.rs 并分析其 Session 结构体', 'agent-buzz')}
            className="px-1.5 py-0.5 rounded bg-[#131b28] hover:bg-[#1a2538] border border-blue-800/40 text-blue-300 transition-colors flex items-center gap-1 cursor-pointer"
            title="测试 Agent 是否能操作挂载的工作区 Workspace"
          >
            <FolderGit2 className="w-2.5 h-2.5 text-blue-400" />
            <span>测试工作区Workspace</span>
          </button>

          <button
            onClick={() => applyPresetPrompt('@buzz-agent 请通过 buzz-dev-mcp 技能运行 cargo test 并在讨论中汇报测试覆盖情况', 'agent-buzz')}
            className="px-1.5 py-0.5 rounded bg-[#131b28] hover:bg-[#1a2538] border border-purple-800/40 text-purple-300 transition-colors flex items-center gap-1 cursor-pointer"
            title="测试 Agent 是否能执行内置与 MCP Skills"
          >
            <Wrench className="w-2.5 h-2.5 text-purple-400" />
            <span>测试Skill与MCP</span>
          </button>

          <button
            onClick={() => applyPresetPrompt('@all 请 @buzz-agent 和 @claude-code 就如何在 ACP 协议中规范多 Agent 协作工作区锁机制展开讨论', 'agent-buzz')}
            className="px-1.5 py-0.5 rounded bg-[#241a33] hover:bg-[#322347] border border-indigo-700/40 text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer"
            title="模拟 Buzz 多 Agent 协同讨论场景"
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-400" />
            <span>协同讨论辩论</span>
          </button>
        </div>
      </div>

      {/* Input Box */}
      <div className="relative rounded-lg bg-[#111622] border border-[#222c3d] focus-within:border-emerald-500/70 transition-colors p-2">
        <textarea
          id="message-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在 Buzz 团队中发起讨论或通过 @ 调度 ACP Agent (Enter 发送，Shift+Enter 换行)..."
          rows={3}
          className="w-full bg-transparent text-gray-200 placeholder-gray-500 focus:outline-none resize-none text-xs font-sans"
        />

        <div className="flex items-center justify-between pt-1 border-t border-[#1a2333] mt-1 text-[11px] text-gray-500 font-mono">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-gray-400">
              <Command className="w-3 h-3 text-gray-500" />
              <span>支持 Nostr 签名广播</span>
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-emerald-400/80">ACP JSON-RPC 2.0 桥接</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-send-message"
              onClick={handleSend}
              disabled={!content.trim() || isGenerating}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-sans font-medium transition-all cursor-pointer ${
                content.trim() && !isGenerating
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                  : 'bg-[#182130] text-gray-500 cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>ACP 调度中...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>发送广播</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
