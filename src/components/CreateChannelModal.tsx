import React, { useState } from 'react';
import { Channel, Agent, AgentTeam, ChannelKind } from '../types';
import { 
  X, 
  Hash, 
  Lock, 
  FolderGit2, 
  Users, 
  Sparkles, 
  Check,
  Globe,
  FileCode,
  ListTodo,
  ShieldCheck,
  Plus
} from 'lucide-react';

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProjectId: string;
  teams: AgentTeam[];
  agents: Agent[];
  currentUserId?: string;
  onCreateChannel: (channel: Omit<Channel, 'id' | 'unreadCount'>) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  onClose,
  activeProjectId,
  teams,
  agents,
  currentUserId = 'user-developer',
  onCreateChannel,
}) => {
  const [kind, setKind] = useState<ChannelKind>('feature');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [initialInvitedAgentIds, setInitialInvitedAgentIds] = useState<string[]>(() =>
    agents.map((a) => a.id)
  );
  const [mountCode, setMountCode] = useState(true);
  const [repoName, setRepoName] = useState('shadow-crew');

  // Reset or pre-fill all agents whenever the modal opens
  React.useEffect(() => {
    if (isOpen) {
      setInitialInvitedAgentIds(agents.map((a) => a.id));
    }
  }, [isOpen, agents]);

  if (!isOpen) return null;

  const toggleAgentInvite = (agentId: string) => {
    setInitialInvitedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Default: Creator only, plus any explicitly selected initial invitees
    const memberIds = Array.from(new Set([currentUserId, ...initialInvitedAgentIds]));

    onCreateChannel({
      projectId: activeProjectId,
      creatorId: currentUserId,
      name: name.trim().replace(/^#/, ''),
      kind,
      status: 'active',
      description: topic.trim() || `${kind === 'feature' ? '功能特性' : kind === 'requirement' ? '需求分析' : '开发任务'}协同空间`,
      topic: topic.trim(),
      isPrivate: true, // 默认受邀准入
      iconName: 'Hash',
      assignedAgentIds: initialInvitedAgentIds,
      memberIds,
      gitBranch: gitBranch.trim() || 'main',
      createdAt: Date.now(),
      mountedWorkspace: mountCode
        ? {
            repoName,
            gitBranch: gitBranch.trim() || 'main',
          }
        : undefined,
    });

    setName('');
    setTopic('');
    setInitialInvitedAgentIds([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-accent" />
            <span className="font-bold text-sm text-fg">
              创建协同频道 (Channel)
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 1. Channel Kind Selection */}
          <div>
            <label className="block text-fg font-semibold mb-1.5">频道分类 (Category)</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setKind('feature')}
                className={`p-2.5 rounded-xl border flex flex-col items-start gap-1 transition-all cursor-pointer ${
                  kind === 'feature'
                    ? 'bg-accent/15 border-accent text-fg shadow-xs'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-accent">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Feature 特性</span>
                </div>
                <span className="text-[10px] text-fg-muted line-clamp-1">新功能/模块实现</span>
              </button>

              <button
                type="button"
                onClick={() => setKind('requirement')}
                className={`p-2.5 rounded-xl border flex flex-col items-start gap-1 transition-all cursor-pointer ${
                  kind === 'requirement'
                    ? 'bg-purple-500/15 border-purple-500 text-fg shadow-xs'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-purple-500">
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Requirement 需求</span>
                </div>
                <span className="text-[10px] text-fg-muted line-clamp-1">PRD/技术方案论证</span>
              </button>

              <button
                type="button"
                onClick={() => setKind('task')}
                className={`p-2.5 rounded-xl border flex flex-col items-start gap-1 transition-all cursor-pointer ${
                  kind === 'task'
                    ? 'bg-amber-500/15 border-amber-500 text-fg shadow-xs'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-500">
                  <ListTodo className="w-3.5 h-3.5" />
                  <span>Task 任务/缺陷</span>
                </div>
                <span className="text-[10px] text-fg-muted line-clamp-1">Bug排查与具体交付</span>
              </button>
            </div>
          </div>

          {/* 2. Channel Name & Topic */}
          <div>
            <label className="block text-fg font-semibold mb-1">频道标识名 (Name)</label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-fg-muted font-bold font-mono">#</span>
              <input
                type="text"
                required
                placeholder={kind === 'feature' ? 'feat-auth-oauth2' : kind === 'requirement' ? 'req-payment-flow' : 'task-fix-memory-leak'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl pl-7 pr-3 py-2 text-xs text-fg placeholder-fg-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-fg font-semibold mb-1">研讨主题 / 目标 (Topic / Description)</label>
            <input
              type="text"
              placeholder="例如: 统一微信与飞书扫码回调路由，支持多租户隔离"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-fg placeholder-fg-muted focus:outline-none focus:border-accent"
            />
          </div>

          {/* 3. Creator-Only by Default Guarantee */}
          <div className="p-3 rounded-xl bg-accent/10 border border-accent/25 space-y-2">
            <div className="flex items-center gap-1.5 text-accent font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>受邀准入保护 (默认仅创建者在内)</span>
            </div>
            <p className="text-[10px] text-fg-muted leading-relaxed">
              频道创建后初始为**私密工作区**，只有您本人在内。外部成员与公共 Agent 无法窥探。您可以勾选下方初始邀请的专职 Agent，或在创建后随时拉入同事：
            </p>

            {/* Optional initial invitees */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[10px] text-fg font-medium">
                <span>初始加入频道的 Agent 角色</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInitialInvitedAgentIds(agents.map((a) => a.id))}
                    className="text-[10px] text-accent hover:underline cursor-pointer"
                  >
                    全选
                  </button>
                  <span className="text-border">|</span>
                  <button
                    type="button"
                    onClick={() => setInitialInvitedAgentIds([])}
                    className="text-[10px] text-fg-muted hover:underline cursor-pointer"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {agents.map((agent) => {
                  const isChecked = initialInvitedAgentIds.includes(agent.id);
                  return (
                    <div
                      key={agent.id}
                      onClick={() => toggleAgentInvite(agent.id)}
                      className={`p-1.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-accent/15 border-accent text-fg'
                          : 'bg-surface border-border text-fg-muted hover:border-fg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span>{agent.avatar}</span>
                        <span className="truncate text-[11px] font-medium">{agent.name}</span>
                        {agent.isManagedByYou && (
                          <span className="text-[9px] text-accent shrink-0">(影替身)</span>
                        )}
                      </div>
                      {isChecked && <Check className="w-3 h-3 text-accent shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Git Branch & Workspace Mount */}
          <div className="p-3 rounded-xl bg-surface-subtle border border-border space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FolderGit2 className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-fg text-xs">绑定 Git 特性分支</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-fg-muted mb-0.5">代码库 (Repository)</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs text-fg"
                />
              </div>
              <div>
                <label className="block text-[10px] text-fg-muted mb-0.5">Git 分支 (Branch)</label>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs text-fg font-mono"
                />
              </div>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-fg-secondary font-medium transition-colors cursor-pointer border border-border"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-1.5 rounded-lg bg-accent hover:opacity-90 disabled:opacity-40 text-accent-fg font-semibold shadow-xs transition-all cursor-pointer"
            >
              立即创建频道
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
