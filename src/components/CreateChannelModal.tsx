import React, { useState } from 'react';
import { Channel, Agent, AgentTeam } from '../types';
import { 
  X, 
  Hash, 
  Users, 
  Check,
  HardDrive
} from 'lucide-react';

export interface ChannelWorkspaceSelection {
  mode: 'default' | 'custom';
  cwd?: string;
}

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: AgentTeam[];
  agents: Agent[];
  currentUserId?: string;
  onCreateChannel: (
    channel: Omit<Channel, 'id' | 'unreadCount' | 'workspaceBindingId'>,
    workspace: ChannelWorkspaceSelection
  ) => Promise<void> | void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  onClose,
  teams,
  agents,
  currentUserId = 'user-developer',
  onCreateChannel,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'default' | 'custom'>('default');
  const [customCwd, setCustomCwd] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialInvitedAgentIds, setInitialInvitedAgentIds] = useState<string[]>(() =>
    agents.map((a) => a.id)
  );

  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const prevIsOpenRef = React.useRef(false);
  const agentsRef = React.useRef(agents);
  agentsRef.current = agents;

  React.useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setName('');
      setDescription('');
      setSelectedTeamId(null);
      setWorkspaceMode('default');
      setCustomCwd('');
      setError(null);
      setInitialInvitedAgentIds(agentsRef.current.map((a) => a.id));
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 40);
      prevIsOpenRef.current = isOpen;
      return () => clearTimeout(timer);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleAgentInvite = (agentId: string) => {
    setSelectedTeamId(null);
    setInitialInvitedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSelectTeamPreset = (team: AgentTeam) => {
    const validIds = team.agentIds.filter((id) => agents.some((a) => a.id === id));
    setSelectedTeamId(team.id);
    setInitialInvitedAgentIds(validIds);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (workspaceMode === 'custom' && !customCwd.trim()) {
      setError('请输入已存在的自定义工作目录');
      return;
    }

    const cleanName = name.trim().replace(/^#/, '');
    const cleanDesc = description.trim();
    const memberIds = Array.from(new Set([currentUserId, ...initialInvitedAgentIds]));

    setIsSubmitting(true);
    setError(null);
    try {
      await onCreateChannel({
        creatorId: currentUserId,
        name: cleanName,
        kind: 'general',
        status: 'active',
        description: cleanDesc,
        topic: cleanDesc || undefined,
        isPrivate: false,
        iconName: 'Hash',
        assignedTeamId: selectedTeamId || undefined,
        assignedAgentIds: initialInvitedAgentIds,
        memberIds,
        createdAt: Date.now(),
      }, {
        mode: workspaceMode,
        cwd: workspaceMode === 'custom' ? customCwd.trim() : undefined,
      });

      setName('');
      setDescription('');
      setInitialInvitedAgentIds([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAllSelected = agents.length > 0 && initialInvitedAgentIds.length === agents.length && !selectedTeamId;
  const isNoneSelected = initialInvitedAgentIds.length === 0 && !selectedTeamId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-accent shrink-0" />
              <span className="font-bold text-sm text-fg">
                创建协同频道 (Create Channel)
              </span>
            </div>
            <p className="text-[11px] text-fg-muted">
              创建用于日常讨论、方案推演或多人机协作的实时消息流
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 1. Channel Name (Only required field) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="create-channel-name" className="text-fg font-semibold text-xs">
                频道名称 (Name) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-fg-muted">支持直接回车创建</span>
            </div>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-fg-muted font-bold font-mono text-sm">
                #
              </span>
              <input
                ref={nameInputRef}
                id="create-channel-name"
                type="text"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="例如：general、产品方案脑暴、架构评审、日常沟通..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl pl-7 pr-3 py-2.5 text-xs text-fg placeholder-fg-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
              />
            </div>
          </div>

          {/* 2. Channel Description (Optional) */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label htmlFor="create-channel-desc" className="text-fg font-semibold text-xs">
                频道简介 (Description)
              </label>
              <span className="text-[10px] text-fg-muted font-normal px-1.5 py-0.5 rounded bg-surface-subtle border border-border">
                选填 Optional
              </span>
            </div>
            <textarea
              id="create-channel-desc"
              rows={2}
              placeholder="简述这个频道用来讨论什么（具体议题可在进入频道后随时发起）..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-fg placeholder-fg-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 resize-none leading-relaxed transition-all"
            />
          </div>

          {/* 3. Immutable Workspace Binding */}
          <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2.5">
            <div className="flex items-center gap-1.5 text-fg font-semibold text-xs">
              <HardDrive className="w-3.5 h-3.5 text-accent" />
              <span>工作目录 (CWD)</span>
              <span className="text-[10px] font-normal text-fg-muted">创建后不可修改</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode('default');
                  setError(null);
                }}
                className={`px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                  workspaceMode === 'default'
                    ? 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                <span className="block text-[11px] font-semibold">使用频道默认目录</span>
                <span className="block mt-0.5 text-[10px] font-mono text-fg-muted truncate">
                  ~/.shadow-crew/channels/&lt;channelId&gt;/
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode('custom');
                  setError(null);
                }}
                className={`px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                  workspaceMode === 'custom'
                    ? 'bg-purple-50 border-purple-300 text-purple-800 dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-300'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                <span className="block text-[11px] font-semibold">指定已有目录</span>
                <span className="block mt-0.5 text-[10px] text-fg-muted">用于真实代码仓库或外部工作区</span>
              </button>
            </div>
            {workspaceMode === 'custom' && (
              <input
                type="text"
                value={customCwd}
                onChange={(e) => setCustomCwd(e.target.value)}
                placeholder="/Users/you/projects/example 或 ~/projects/example"
                spellCheck={false}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg placeholder-fg-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              />
            )}
            <p className="text-[10px] text-fg-muted leading-relaxed">
              工作目录在频道创建时固化。后续 Session、Patch 和产物都使用该目录。
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300 text-[11px]">
              {error}
            </div>
          )}

          {/* 3. Initial Agent Members & Team Presets */}
          <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-fg font-semibold text-xs">
                <Users className="w-3.5 h-3.5 text-accent" />
                <span>初始参与的 Agent 成员 ({initialInvitedAgentIds.length}/{agents.length})</span>
              </div>
              <span className="text-[10px] text-fg-muted">创建后仍可随时增删成员</span>
            </div>

            {/* Quick Preset / Team Filter Chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setSelectedTeamId(null);
                  setInitialInvitedAgentIds(agents.map((a) => a.id));
                }}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer ${
                  isAllSelected
                    ? 'bg-accent/15 border-accent text-accent font-semibold'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                全选 ({agents.length})
              </button>

              {teams.map((team) => {
                const isTeamSelected = selectedTeamId === team.id;
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => handleSelectTeamPreset(team)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-medium border flex items-center gap-1 transition-all cursor-pointer ${
                      isTeamSelected
                        ? 'bg-accent/15 border-accent text-accent font-semibold'
                        : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                    }`}
                  >
                    <span>{team.icon}</span>
                    <span>{team.name}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setSelectedTeamId(null);
                  setInitialInvitedAgentIds([]);
                }}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer ${
                  isNoneSelected
                    ? 'bg-accent/15 border-accent text-accent font-semibold'
                    : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                }`}
              >
                仅自己 (暂不拉入 Agent)
              </button>
            </div>

            {/* Agent Grid */}
            <div className="grid grid-cols-2 gap-1.5 pt-0.5 max-h-44 overflow-y-auto">
              {agents.map((agent) => {
                const isChecked = initialInvitedAgentIds.includes(agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => toggleAgentInvite(agent.id)}
                    className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                      isChecked
                        ? 'bg-accent/15 border-accent text-fg shadow-2xs'
                        : 'bg-surface border-border text-fg-muted hover:border-fg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0">
                      <span className="shrink-0">{agent.avatar}</span>
                      <span className="truncate text-[11px] font-medium text-fg">{agent.name}</span>
                      {agent.isManagedByYou && (
                        <span className="text-[9px] text-accent shrink-0">(影替身)</span>
                      )}
                    </div>
                    {isChecked && <Check className="w-3.5 h-3.5 text-accent shrink-0 ml-1" />}
                  </div>
                );
              })}
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
              disabled={!name.trim() || isSubmitting}
              className="px-5 py-1.5 rounded-lg bg-accent hover:opacity-90 disabled:opacity-40 text-accent-fg font-semibold shadow-xs transition-all cursor-pointer"
            >
              {isSubmitting ? '创建中...' : '创建频道'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

