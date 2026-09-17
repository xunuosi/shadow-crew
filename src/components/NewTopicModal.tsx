import React, { useState, useEffect } from 'react';
import { Agent, Channel } from '../types';
import { X, Sparkles, Plus, Bot, Shield, Check, GitBranch } from 'lucide-react';

interface NewTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel?: Channel;
  agents: Agent[];
  onCreateTopic: (topicData: {
    title: string;
    description: string;
    assignedAgentIds: string[];
  }) => void;
}

export const NewTopicModal: React.FC<NewTopicModalProps> = ({
  isOpen,
  onClose,
  channel,
  agents,
  onCreateTopic,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  // 当弹窗打开或频道切换时，重置表单并默认选中当前频道的成员 Agent
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setSelectedAgentIds(agents.map((a) => a.id));
    }
  }, [isOpen, channel?.id, agents]);

  if (!isOpen || !channel) return null;

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onCreateTopic({
      title: title.trim(),
      description: description.trim(),
      assignedAgentIds: selectedAgentIds,
    });

    setTitle('');
    setDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary">
        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-300">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-fg text-sm">发起新议题 (New Topic)</h2>
              <p className="text-[10px] text-fg-muted font-mono">在 #{channel.name} 频道内开启单层推演空间</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Topic Title */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              议题名称 / 方案标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：扫码回调统一路由与多租户适配方案"
              className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted"
            />
          </div>

          {/* Description / Spike prompt */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              推演目标 / 初始研讨问题
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述核心痛点、技术约束或需要协同 Agent 解决的问题..."
              className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted resize-none leading-relaxed"
            />
          </div>

          {/* Participating Agents Checkbox List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-fg">
                指派协同推演 Agent <span className="text-[10px] text-fg-muted font-normal">(仅限当前频道成员)</span>
              </label>
              <span className="text-[10px] text-fg-muted font-mono">
                已选中 {selectedAgentIds.length} / {agents.length} 位
              </span>
            </div>

            {agents.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 space-y-1 text-[11px]">
                <div className="font-semibold flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  <span>当前频道 #{channel.name} 暂无成员 Agent</span>
                </div>
                <p className="text-[10px] opacity-90 leading-relaxed">
                  本频道目前尚未邀请任何智能体。可先创建议题，并在频道右上角「成员管理」中邀请专属 Agent 加入本频道。
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {agents.map((agent) => {
                  const isSelected = selectedAgentIds.includes(agent.id);
                  return (
                    <div
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-purple-500/10 border-purple-500/40 text-fg'
                          : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{agent.avatar}</span>
                        <div>
                          <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                            <span>{agent.name}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-fg-muted border border-border font-mono shrink-0">
                              {agent.handle}
                            </span>
                            {agent.isManagedByYou && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-fg-muted border border-border font-mono shrink-0">
                                影替身
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-fg-muted truncate max-w-xs">{agent.role}</div>
                        </div>
                      </div>

                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-purple-600 border-purple-600 text-white'
                          : 'border-border bg-surface'
                      }`}>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-border hover:bg-surface-hover text-fg-secondary text-xs transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>创建议题并开启推演</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
