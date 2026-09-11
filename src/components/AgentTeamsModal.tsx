import React, { useState } from 'react';
import { Agent, AgentTeam } from '../types';
import { 
  X, 
  Bot, 
  Users, 
  Plus, 
  Check, 
  ShieldCheck, 
  Cpu, 
  Database, 
  Sparkles,
  Terminal
} from 'lucide-react';

interface AgentTeamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  teams: AgentTeam[];
  onCreateTeam: (team: Omit<AgentTeam, 'id'>) => void;
  onOpenConnectModal: () => void;
}

export const AgentTeamsModal: React.FC<AgentTeamsModalProps> = ({
  isOpen,
  onClose,
  agents,
  teams,
  onCreateTeam,
  onOpenConnectModal,
}) => {
  const [activeTab, setActiveTab] = useState<'teams' | 'agents'>('teams');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [newTeamIcon, setNewTeamIcon] = useState('⚡');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleToggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSaveTeam = () => {
    if (!newTeamName.trim() || selectedAgentIds.length === 0) return;
    onCreateTeam({
      name: newTeamName.trim(),
      description: newTeamDesc.trim() || '自定义协同编队',
      icon: newTeamIcon,
      agentIds: selectedAgentIds,
      color: '#3b82f6',
    });
    setNewTeamName('');
    setNewTeamDesc('');
    setSelectedAgentIds([]);
    setIsCreatingTeam(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-accent" />
            <span className="font-bold text-sm text-fg">
              Agent 资产库与自由编队 (Teams)
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Tabs */}
            <div className="flex bg-surface-subtle p-0.5 rounded-lg border border-border">
              <button
                onClick={() => setActiveTab('teams')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'teams' ? 'bg-accent/15 text-accent font-semibold' : 'text-fg-muted hover:text-fg'
                }`}
              >
                编队列表 ({teams.length})
              </button>
              <button
                onClick={() => setActiveTab('agents')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'agents' ? 'bg-accent/15 text-accent font-semibold' : 'text-fg-muted hover:text-fg'
                }`}
              >
                所有 Agent ({agents.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 max-h-[70vh] overflow-y-auto space-y-4">
          {activeTab === 'teams' ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-fg">自由协同编队 (Agent Teams)</h3>
                  <p className="text-[11px] text-fg-muted">将拥有不同能力的独立 Agent 组合为敏捷战队，在创建话题或讨论时整组调度。</p>
                </div>
                {!isCreatingTeam && (
                  <button
                    onClick={() => setIsCreatingTeam(true)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg hover:opacity-90 font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>组建新编队</span>
                  </button>
                )}
              </div>

              {/* Create Team Inline Form */}
              {isCreatingTeam && (
                <div className="p-4 rounded-xl bg-surface-subtle border border-accent/40 space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-accent">新建 Agent 协同编队</span>
                    <button onClick={() => setIsCreatingTeam(false)} className="text-fg-muted hover:text-fg">
                      取消
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-1">
                      <label className="block text-[10px] text-fg-muted mb-1">图标 Emoji</label>
                      <input
                        type="text"
                        value={newTeamIcon}
                        onChange={(e) => setNewTeamIcon(e.target.value)}
                        className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-center text-sm text-fg"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] text-fg-muted mb-1">编队名称</label>
                      <input
                        type="text"
                        placeholder="例如: 🚀 核心架构与会话攻坚组"
                        value={newTeamName}
                        onChange={(e) => setNewTeamName(e.target.value)}
                        className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-fg placeholder-fg-muted"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-fg-muted mb-1">勾选编队内成员 (多选)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {agents.map((ag) => {
                        const isSelected = selectedAgentIds.includes(ag.id);
                        return (
                          <div
                            key={ag.id}
                            onClick={() => handleToggleAgent(ag.id)}
                            className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-accent/15 border-accent text-fg'
                                : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-base">{ag.avatar}</span>
                              <div className="truncate">
                                <div className="font-semibold text-xs truncate text-fg">{ag.name}</div>
                                <div className="text-[10px] text-fg-muted truncate">{ag.modelBadge}</div>
                              </div>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-accent shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={handleSaveTeam}
                      disabled={!newTeamName.trim() || selectedAgentIds.length === 0}
                      className="px-4 py-1.5 rounded-lg bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40 font-semibold transition-all cursor-pointer shadow-xs"
                    >
                      保存并激活编队
                    </button>
                  </div>
                </div>
              )}

              {/* Teams Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {teams.map((team) => {
                  const teamAgents = agents.filter((a) => team.agentIds.includes(a.id));
                  return (
                    <div
                      key={team.id}
                      className="p-3.5 rounded-xl bg-surface-subtle border border-border hover:border-accent/40 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">{team.icon}</span>
                          <span className="font-bold text-xs text-fg">{team.name}</span>
                        </div>
                        <p className="text-[11px] text-fg-muted mb-3 line-clamp-2">{team.description}</p>
                      </div>

                      <div className="border-t border-border pt-2 flex items-center justify-between">
                        <div className="flex items-center -space-x-1.5">
                          {teamAgents.map((ag) => (
                            <div
                              key={ag.id}
                              className="w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-xs shadow-xs"
                              title={`${ag.name} (${ag.role})`}
                            >
                              {ag.avatar}
                            </div>
                          ))}
                        </div>
                        <span className="text-[10px] text-accent font-mono">
                          {teamAgents.length} 位专家就绪
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-fg">全量独立 Agent 资产库</h3>
                  <p className="text-[11px] text-fg-muted">每个 Agent 拥有独立的私有记忆库、工作区权限与专属技能工具。</p>
                </div>
                <button
                  onClick={onOpenConnectModal}
                  className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg hover:opacity-90 font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>接入新 Agent</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {agents.map((ag) => (
                  <div
                    key={ag.id}
                    className="p-3.5 rounded-xl bg-surface-subtle border border-border flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-lg shrink-0 shadow-xs">
                        {ag.avatar}
                      </div>
                      <div className="truncate flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-fg truncate">{ag.name}</span>
                          <span className="text-[10px] text-accent font-mono bg-accent/15 px-1.5 py-0.5 rounded border border-accent/30 shrink-0">
                            {ag.modelBadge}
                          </span>
                        </div>
                        <div className="text-[11px] text-fg-muted truncate">{ag.role}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-fg-muted pt-1 border-t border-border">
                      <div className="bg-surface p-1 rounded text-center border border-border">
                        <div className="text-fg-muted">记忆</div>
                        <div className="text-emerald-500 font-bold">{ag.memory.persistentItems.length}条</div>
                      </div>
                      <div className="bg-surface p-1 rounded text-center border border-border">
                        <div className="text-fg-muted">技能</div>
                        <div className="text-purple-500 font-bold">{ag.skills.length}项</div>
                      </div>
                      <div className="bg-surface p-1 rounded text-center border border-border">
                        <div className="text-fg-muted">协议</div>
                        <div className="text-accent font-bold">{ag.acpTransport}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
