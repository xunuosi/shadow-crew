import React, { useState } from 'react';
import { Message, Agent, Room } from '../types';
import { 
  Terminal, 
  Database, 
  FolderGit2, 
  Wrench, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  CheckCircle, 
  ExternalLink,
  ShieldAlert,
  Fingerprint
} from 'lucide-react';

interface ChatTimelineProps {
  messages: Message[];
  currentRoom: Room;
  agents: Agent[];
  onAddReaction: (messageId: string, emoji: string) => void;
  onInspectAgent: (agentId: string) => void;
  onInspectTrace: (trace: any) => void;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  currentRoom,
  agents,
  onAddReaction,
  onInspectAgent,
  onInspectTrace,
}) => {
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({
    'msg-2': true, // default expand the primary demonstration message
  });

  const toggleTrace = (messageId: string) => {
    setExpandedTraces((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const getAgentById = (agentId?: string) => {
    return agents.find((a) => a.id === agentId);
  };

  return (
    <div 
      id="chat-timeline-container"
      className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0d111a] text-gray-200"
    >
      {/* Room Header Banner */}
      <div className="p-3 rounded-lg bg-[#121824] border border-[#20293a] flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-100 text-sm">#{currentRoom.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/50 text-emerald-400 font-mono">
              Buzz Nostr Channel
            </span>
          </div>
          <div className="text-gray-400 mt-0.5">{currentRoom.topic}</div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono">活跃 ACP Agents:</span>
          <div className="flex items-center -space-x-1.5">
            {currentRoom.activeAgentIds.map((agentId) => {
              const ag = getAgentById(agentId);
              if (!ag) return null;
              return (
                <button
                  key={agentId}
                  onClick={() => onInspectAgent(agentId)}
                  className="w-6 h-6 rounded-full bg-[#182130] border border-[#2d3a52] flex items-center justify-center text-xs hover:scale-110 transition-transform cursor-pointer"
                  title={`${ag.name} (${ag.role}) - 点击查看能力`}
                >
                  {ag.avatar}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Messages Stream */}
      {messages.map((message) => {
        const isAgent = message.isAgent;
        const agent = isAgent ? getAgentById(message.authorId) : null;
        const isTraceOpen = expandedTraces[message.id] ?? false;

        return (
          <article
            key={message.id}
            id={`message-bubble-${message.id}`}
            className={`p-3.5 rounded-lg border transition-all text-xs ${
              isAgent
                ? 'bg-[#111622] border-[#222c3d] shadow-sm'
                : 'bg-[#141b29] border-[#263347]'
            }`}
          >
            {/* Author Header */}
            <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#1c2436]">
              <div className="flex items-center gap-2">
                <span className="text-lg">{message.authorAvatar}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-200">
                      {message.authorName}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {message.authorHandle}
                    </span>

                    {/* Agent ACP Pill */}
                    {isAgent && (
                      <span className="text-[10px] px-1.5 py-0.2 bg-emerald-950/80 text-emerald-300 font-mono rounded border border-emerald-800/60">
                        {message.agentBadge || 'ACP Agent'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Timestamp & Signed Nostr Event Hash */}
              <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                <span title="Nostr Event Kind 42 Event ID" className="flex items-center gap-1 text-gray-400">
                  <Fingerprint className="w-3 h-3 text-gray-500" />
                  {message.signedNostrHash}
                </span>
                <span>{message.timestamp}</span>
              </div>
            </div>

            {/* ACP Trace Drawer if present (Answering user's question directly!) */}
            {message.acpTrace && (
              <div className="mb-3 rounded bg-[#0b0e14] border border-[#1f2738] overflow-hidden">
                <button
                  onClick={() => toggleTrace(message.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 bg-[#121721] hover:bg-[#161d2b] transition-colors text-left cursor-pointer border-b border-[#1f2738]"
                >
                  <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>ACP 执行轨迹 (ACP RPC & Capabilities Trace)</span>
                    <span className="text-gray-500 text-[10px]">
                      {message.acpTrace.durationMs}ms
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
                    <span>{isTraceOpen ? '收起详情' : '展开三要素验证 (工作区/Skill/记忆)'}</span>
                    {isTraceOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>

                {isTraceOpen && (
                  <div className="p-3 space-y-2 text-[11px] font-mono">
                    {/* 1. Workspace Action */}
                    {message.acpTrace.workspaceAction && (
                      <div className="p-2 rounded bg-[#131924] border border-[#222d40]">
                        <div className="flex items-center gap-1.5 text-blue-400 font-semibold mb-1">
                          <FolderGit2 className="w-3.5 h-3.5" />
                          <span>1. 工作空间接入 (Workspace CWD & File Access)</span>
                          <span className="text-[10px] bg-blue-950 px-1 rounded text-blue-300">
                            {message.acpTrace.workspaceAction.action.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-gray-300 text-[10px] mb-1">
                          路径: <span className="text-amber-300">{message.acpTrace.workspaceAction.path}</span>
                        </div>
                        <div className="text-gray-400 text-[10px]">
                          {message.acpTrace.workspaceAction.summary}
                        </div>
                        {message.acpTrace.workspaceAction.diffSnippet && (
                          <pre className="mt-1.5 p-1.5 rounded bg-[#090c12] text-[10px] text-emerald-300 overflow-x-auto border border-[#1b2333]">
                            {message.acpTrace.workspaceAction.diffSnippet}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* 2. Skill / MCP Tool Action */}
                    {message.acpTrace.skillUsed && (
                      <div className="p-2 rounded bg-[#131924] border border-[#222d40]">
                        <div className="flex items-center gap-1.5 text-purple-400 font-semibold mb-1">
                          <Wrench className="w-3.5 h-3.5" />
                          <span>2. Skill 与工具执行 (MCP Server: {message.acpTrace.skillUsed.source})</span>
                        </div>
                        <div className="text-gray-300 text-[10px] mb-0.5">
                          工具: <span className="text-purple-300">{message.acpTrace.skillUsed.name}</span>
                        </div>
                        <div className="text-gray-400 text-[10px] font-mono">
                          入参: <code className="text-gray-300">{message.acpTrace.skillUsed.input}</code>
                        </div>
                        <div className="text-emerald-400 text-[10px] font-mono mt-0.5">
                          输出: {message.acpTrace.skillUsed.output}
                        </div>
                      </div>
                    )}

                    {/* 3. Internal Memory Action */}
                    {message.acpTrace.memoryAction && (
                      <div className="p-2 rounded bg-[#131924] border border-[#222d40]">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
                          <Database className="w-3.5 h-3.5" />
                          <span>3. 私有持久化记忆检索 (Agent Internal Memory)</span>
                          <span className="text-[10px] bg-emerald-950 px-1 rounded text-emerald-300">
                            {message.acpTrace.memoryAction.targetBank}
                          </span>
                        </div>
                        <div className="text-gray-300 text-[10px] mb-0.5">
                          检索 Key: <span className="text-emerald-300">{message.acpTrace.memoryAction.key}</span>
                        </div>
                        <div className="text-gray-400 text-[10px]">
                          记忆内容: {message.acpTrace.memoryAction.detail}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Message Content */}
            <div className="text-gray-200 leading-relaxed whitespace-pre-line font-sans text-xs">
              {message.content}
            </div>

            {/* Reactions Bar */}
            <div className="mt-3 flex items-center gap-1.5">
              {message.reactions?.map((reaction, idx) => (
                <button
                  key={idx}
                  onClick={() => onAddReaction(message.id, reaction.emoji)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#17202e] hover:bg-[#1f2c40] border border-[#26354d] text-gray-300 text-[11px] transition-colors cursor-pointer"
                >
                  <span>{reaction.emoji}</span>
                  <span className="font-mono text-gray-400 text-[10px]">{reaction.count}</span>
                </button>
              ))}

              {/* Quick Add Reaction button */}
              <button
                onClick={() => onAddReaction(message.id, '👍')}
                className="px-1.5 py-0.5 rounded bg-[#121824] hover:bg-[#192233] border border-[#20293b] text-gray-400 hover:text-gray-200 text-[10px] transition-colors cursor-pointer"
                title="添加表态"
              >
                +
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
};
