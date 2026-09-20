import React, { useState } from 'react';
import { Agent, AgentTeam } from '../types';
import { X, Users, Check, Sparkles, Plus } from 'lucide-react';
import { AgentAvatarArtwork, TeamArtwork } from './AgentAvatarArtwork';

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  onCreateTeam: (newTeam: Omit<AgentTeam, 'id'>) => void;
}

const PRESET_ICONS = [
  { id: 'first_contact', label: 'First Contact', icon: '👽' },
  { id: 'coding_squad', label: 'Coding Squad', icon: '⚙️' },
  { id: 'rocket', label: '突击先锋', icon: '🚀' },
  { id: 'shinobi', label: '暗影特工', icon: '🥷' },
  { id: 'lightning', label: '深度逻辑', icon: '⚡' },
];

export const CreateTeamModal: React.FC<CreateTeamModalProps> = ({
  isOpen,
  onClose,
  agents,
  onCreateTeam,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('first_contact');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleToggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSelectAll = () => {
    if (selectedAgentIds.length === agents.length) {
      setSelectedAgentIds([]);
    } else {
      setSelectedAgentIds(agents.map((a) => a.id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedAgentIds.length === 0) return;

    const chosenPreset = PRESET_ICONS.find((p) => p.id === selectedIcon);

    onCreateTeam({
      name: name.trim(),
      description: description.trim() || 'Custom collaborative agent team',
      icon: chosenPreset?.icon || '⚡',
      agentIds: selectedAgentIds,
      color: '#06b6d4',
    });

    setName('');
    setDescription('');
    setSelectedAgentIds([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-fg tracking-tight">组建协同编队 (Create Agent Team)</h2>
              <p className="text-[11px] text-fg-muted">
                Group agents that you can add to a channel together
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[75vh] space-y-5">
          {/* Team Artwork Preview & Icon Selection */}
          <div>
            <label className="block text-[11px] font-semibold text-fg mb-2">
              编队视觉形象与标识
            </label>
            <div className="flex items-center gap-4 p-3 bg-surface-subtle border border-border rounded-2xl">
              <TeamArtwork name={selectedIcon} className="w-16 h-16 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="text-[11px] text-fg-muted">选择预设 3D 编队插画与徽章：</div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_ICONS.map((preset) => {
                    const isSelected = selectedIcon === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedIcon(preset.id)}
                        className={`px-2.5 py-1 rounded-xl border text-[11px] flex items-center gap-1.5 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-accent/15 border-accent text-accent font-semibold shadow-xs'
                            : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                        }`}
                      >
                        <span>{preset.icon}</span>
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Team Name */}
          <div>
            <label className="block text-[11px] font-semibold text-fg mb-1.5">
              编队名称 (Team Name) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="例如: Coding Squad 或 First Contact"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface border border-border focus:border-accent focus:ring-1 focus:ring-accent/30 rounded-xl px-3 py-2 text-xs text-fg placeholder-fg-muted focus:outline-none transition-all"
            />
          </div>

          {/* Team Description */}
          <div>
            <label className="block text-[11px] font-semibold text-fg mb-1.5">
              职责说明 (Description)
            </label>
            <input
              type="text"
              placeholder="例如: Technical and architectural tasks"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-surface border border-border focus:border-accent focus:ring-1 focus:ring-accent/30 rounded-xl px-3 py-2 text-xs text-fg placeholder-fg-muted focus:outline-none transition-all"
            />
          </div>

          {/* Member Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-fg">
                挑选参战 Agent 成员 <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[11px] text-accent hover:underline transition-colors cursor-pointer"
              >
                {selectedAgentIds.length === agents.length ? '取消全选' : '全选'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto overflow-x-hidden p-1 bg-surface-subtle rounded-2xl border border-border">
              {agents.map((agent) => {
                const isSelected = selectedAgentIds.includes(agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => handleToggleAgent(agent.id)}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all min-w-0 ${
                      isSelected
                        ? 'bg-accent/15 border-accent text-fg shadow-xs'
                        : 'bg-surface border-border text-fg-secondary hover:border-fg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                      <div className="w-8 h-8 shrink-0 flex items-center justify-center">
                        <AgentAvatarArtwork name={agent.name} className="w-8 h-8" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs truncate text-fg">{agent.name}</div>
                        <div className="text-[10px] text-fg-muted truncate">{agent.role}</div>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ml-1 transition-all ${
                      isSelected ? 'bg-accent border-accent text-accent-fg' : 'border-border bg-surface'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-fg-muted mt-1.5 flex items-center justify-between">
              <span>已选择 {selectedAgentIds.length} 位专家</span>
              {selectedAgentIds.length === 0 && (
                <span className="text-amber-500">请至少选择 1 位 Agent 组成编队</span>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-fg-secondary hover:text-fg hover:bg-surface-hover transition-all cursor-pointer font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || selectedAgentIds.length === 0}
              className={`px-5 py-2 rounded-xl font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer ${
                name.trim() && selectedAgentIds.length > 0
                  ? 'bg-accent text-accent-fg hover:opacity-90'
                  : 'bg-surface-subtle text-fg-muted cursor-not-allowed border border-border'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>组建编队</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
