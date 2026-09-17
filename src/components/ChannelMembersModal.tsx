import React, { useState } from 'react';
import { Channel, Agent } from '../types';
import { 
  X, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  Bot, 
  User, 
  Check, 
  UserMinus,
  Sparkles,
  Lock
} from 'lucide-react';

interface ChannelMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel;
  agents: Agent[];
  currentUserId?: string;
  onUpdateMembers: (channelId: string, updatedMemberIds: string[]) => void;
}

export const ChannelMembersModal: React.FC<ChannelMembersModalProps> = ({
  isOpen,
  onClose,
  channel,
  agents,
  currentUserId = 'user-norris',
  onUpdateMembers,
}) => {
  const [selectedAgentToAdd, setSelectedAgentToAdd] = useState<string>('');

  if (!isOpen) return null;

  const isAgent = (id: string) => agents.some((a) => a.id === id);
  const isCreator = true; // 本机桌面用户拥有本频道的全权成员管理权限
  const currentMemberIds = channel.memberIds || [channel.creatorId || currentUserId];

  // Candidates for invitation: agents not yet in channel
  const availableAgents = agents.filter((a) => !currentMemberIds.includes(a.id));

  const handleAddMember = (memberId: string) => {
    if (!memberId || currentMemberIds.includes(memberId)) return;
    const updated = [...currentMemberIds, memberId];
    onUpdateMembers(channel.id, updated);
  };

  const handleRemoveMember = (memberId: string) => {
    // 保护人类创建者，Agent 成员则均可被随时移出
    if (memberId === channel.creatorId && !isAgent(memberId)) return;
    const updated = currentMemberIds.filter((id) => id !== memberId);
    onUpdateMembers(channel.id, updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" />
            <span className="font-bold text-sm text-fg">
              频道受邀成员管理 · #{channel.name}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Permission Notice */}
          <div className="p-2.5 rounded-xl bg-accent/10 border border-accent/20 text-fg-secondary flex items-start gap-2">
            <Lock className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-[11px]">
              <span className="font-semibold text-fg block">受邀准入原则 (Invite-Only Gate)</span>
              <span>本频道仅被拉入的成员与 Agent 可见；未被邀请的 Agent 不会建立监听管道，杜绝跨频道刷屏。</span>
            </div>
          </div>

          {/* Current Members List */}
          <div>
            <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>当前在群成员 ({currentMemberIds.length})</span>
              {isCreator && <span className="text-emerald-500 font-normal">您是频道拥有者</span>}
            </div>

            <div className="space-y-1.5">
              {currentMemberIds.map((memberId) => {
                const isAgentMember = isAgent(memberId);
                const isOwner = memberId === channel.creatorId && !isAgentMember;
                const agent = agents.find((a) => a.id === memberId);
                const isSelf = memberId === currentUserId;

                return (
                  <div
                    key={memberId}
                    className="flex items-center justify-between p-2 rounded-xl bg-surface-subtle border border-border"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-sm border border-border shrink-0">
                        {agent ? agent.avatar : '👨‍💻'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-fg truncate flex items-center gap-1.5">
                          <span>{agent ? agent.name : (isSelf ? 'Developer (You)' : memberId)}</span>
                          {isOwner && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono border border-amber-500/30 shrink-0">
                              Owner
                            </span>
                          )}
                          {agent?.isManagedByYou && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono border border-accent/30 shrink-0">
                              影替身
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-fg-muted truncate">
                          {agent ? agent.role : (isOwner ? '创建者 / 管理权限' : '团队协作者')}
                        </div>
                      </div>
                    </div>

                    {/* Remove Action */}
                    {!isOwner && (
                      <button
                        onClick={() => handleRemoveMember(memberId)}
                        className="p-1 rounded-md text-fg-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="移出此频道"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Invite Agents Section */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-fg flex items-center gap-1">
                <UserPlus className="w-3.5 h-3.5 text-accent" />
                <span>邀请专职 Agent 进入频道推演</span>
              </label>
              {availableAgents.length > 1 && (
                <button
                  onClick={() => {
                    const allNewIds = availableAgents.map((a) => a.id);
                    onUpdateMembers(channel.id, [...currentMemberIds, ...allNewIds]);
                  }}
                  className="text-[10px] text-accent hover:underline font-medium cursor-pointer"
                >
                  一键全部拉入 ({availableAgents.length})
                </button>
              )}
            </div>

            {availableAgents.length > 0 ? (
              <div className="space-y-1.5">
                {availableAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-2 rounded-xl border border-border/80 hover:border-accent/40 bg-surface transition-all"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base">{agent.avatar}</span>
                      <div className="min-w-0">
                        <div className="font-semibold text-fg truncate text-xs">{agent.name}</div>
                        <div className="text-[10px] text-fg-muted truncate">
                          {agent.role} · {agent.modelBadge?.split(' ')[0] || 'Local ACP'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleAddMember(agent.id)}
                      className="px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent text-accent hover:text-white transition-all text-xs font-semibold cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>拉入频道</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-surface-subtle border border-border text-center text-fg-muted text-[11px]">
                所有可用 Agent 已全部加入此频道。如需引入新 Agent，可前往「Agents & 编队」连接新 ACP Agent。
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-12 px-5 border-t border-border flex items-center justify-end bg-surface-subtle">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-accent text-white font-semibold text-xs hover:opacity-90 transition-all cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
