import React, { useState, useEffect, useRef } from 'react';
import { Agent, Channel, TopicMessageData, DiscussionMode, GameRolesConfig, GameRoleType } from '../types';
import { X, Save, Bot, Check, GitBranch, Maximize2, Minimize2, Edit3, Swords, Scale, Sparkles } from 'lucide-react';
import { ResizeHandle } from './ResizeHandle';

interface EditTopicModalProps {
  isOpen: boolean;
  topic: TopicMessageData | null;
  channel?: Channel | null;
  agents: Agent[];
  onClose: () => void;
  onUpdateTopic: (
    topicId: string,
    updatedData: {
      title: string;
      description: string;
      assignedAgentIds: string[];
      discussionMode?: DiscussionMode;
      gameRoles?: GameRolesConfig;
    }
  ) => void;
}

export const EditTopicModal: React.FC<EditTopicModalProps> = ({
  isOpen,
  topic,
  channel,
  agents,
  onClose,
  onUpdateTopic,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [discussionMode, setDiscussionMode] = useState<DiscussionMode>('standard');
  const [agentRoles, setAgentRoles] = useState<Record<string, GameRoleType>>({});
  const [humanIsArbiter, setHumanIsArbiter] = useState<boolean>(true);
  const prevTopicIdRef = useRef<string | null>(null);

  // 当弹窗打开或 topic 变更时预填表单
  useEffect(() => {
    if (isOpen && topic) {
      setTitle(topic.title || '');
      setDescription(topic.description || '');
      setSelectedAgentIds(topic.participatingAgentIds || []);
      setDiscussionMode(topic.discussionMode || 'standard');
      setHumanIsArbiter(topic.gameRoles?.humanIsArbiter ?? true);

      const roles: Record<string, GameRoleType> = {};
      if (topic.gameRoles) {
        (topic.gameRoles.proposers || []).forEach((id) => { roles[id] = 'proposer'; });
        (topic.gameRoles.challengers || []).forEach((id) => { roles[id] = 'challenger'; });
        (topic.gameRoles.arbiters || []).forEach((id) => { roles[id] = 'arbiter'; });
      }
      setAgentRoles(roles);
      prevTopicIdRef.current = topic.id;
    }
  }, [isOpen, topic?.id]);

  const [modalWidth, setModalWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 560;
    try {
      const saved = localStorage.getItem('shinobi_edit_topic_modal_width');
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val >= 460 && val <= 1400) return val;
      }
    } catch {}
    return 560;
  });
  const [isDraggingEdge, setIsDraggingEdge] = useState<'left' | 'right' | null>(null);

  const handleStartDrag = (side: 'left' | 'right', e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    setIsDraggingEdge(side);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const windowCenter = window.innerWidth / 2;
      let calculatedWidth: number;
      if (side === 'right') {
        calculatedWidth = (moveEvent.clientX - windowCenter) * 2;
      } else {
        calculatedWidth = (windowCenter - moveEvent.clientX) * 2;
      }
      const maxWidth = Math.min(1200, window.innerWidth * 0.95);
      const clamped = Math.min(maxWidth, Math.max(460, Math.round(calculatedWidth)));
      setModalWidth(clamped);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      setIsDraggingEdge(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      target.releasePointerCapture?.(upEvent.pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      const windowCenter = window.innerWidth / 2;
      let calculatedWidth: number;
      if (side === 'right') {
        calculatedWidth = (upEvent.clientX - windowCenter) * 2;
      } else {
        calculatedWidth = (windowCenter - upEvent.clientX) * 2;
      }
      const maxWidth = Math.min(1200, window.innerWidth * 0.95);
      const clamped = Math.min(maxWidth, Math.max(460, Math.round(calculatedWidth)));
      setModalWidth(clamped);
      try {
        localStorage.setItem('shinobi_edit_topic_modal_width', String(clamped));
      } catch {}
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const toggleWidescreen = () => {
    setModalWidth((prev) => {
      const next = prev > 700 ? 560 : 880;
      try {
        localStorage.setItem('shinobi_edit_topic_modal_width', String(next));
      } catch {}
      return next;
    });
  };

  const resetModalWidth = () => {
    setModalWidth(560);
    try {
      localStorage.setItem('shinobi_edit_topic_modal_width', '560');
    } catch {}
  };

  if (!isOpen || !topic) return null;

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !topic) return;

    const isGame = discussionMode === 'game_theoretic';
    const proposers = selectedAgentIds.filter((id) => (agentRoles[id] || 'proposer') === 'proposer');
    const challengers = selectedAgentIds.filter((id) => agentRoles[id] === 'challenger');
    const arbiters = selectedAgentIds.filter((id) => agentRoles[id] === 'arbiter');

    onUpdateTopic(topic.id, {
      title: title.trim(),
      description: description.trim(),
      assignedAgentIds: selectedAgentIds,
      discussionMode,
      gameRoles: isGame
        ? {
            proposers,
            challengers,
            arbiters,
            humanIsArbiter,
          }
        : undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div 
        style={{ width: `${modalWidth}px`, maxWidth: '95vw' }}
        className={`relative bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary max-h-[90vh] ${
          isDraggingEdge ? '' : 'transition-[width] duration-150'
        }`}
      >
        {/* Left Drag Resize Handle */}
        <ResizeHandle
          direction="left"
          onPointerDown={(e) => handleStartDrag('left', e)}
          onDoubleClick={resetModalWidth}
          isDragging={isDraggingEdge === 'left'}
          title="拖动调整弹窗宽度，双击恢复默认 560px"
        />

        {/* Right Drag Resize Handle */}
        <ResizeHandle
          direction="right"
          onPointerDown={(e) => handleStartDrag('right', e)}
          onDoubleClick={resetModalWidth}
          isDragging={isDraggingEdge === 'right'}
          title="拖动调整弹窗宽度，双击恢复默认 560px"
        />

        {/* Header */}
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle select-none shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
            <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0">
              <Edit3 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-fg text-sm truncate">编辑议题信息 (Edit Topic)</h2>
              <p className="text-[10px] text-fg-muted font-mono truncate">
                {channel ? `#${channel.name} · ` : ''}ID: {topic ? topic.id : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleWidescreen}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-accent transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-mono px-2 border border-border/50 shrink-0"
              title={modalWidth > 700 ? '切换为标准宽度 (560px)' : '切换为宽屏视图 (880px)'}
            >
              {modalWidth > 700 ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-accent" />
                  <span className="hidden sm:inline">标准宽度</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-accent" />
                  <span className="hidden sm:inline">宽屏视图</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Discussion Mode Selector */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5 flex items-center justify-between">
              <span>讨论模式选择</span>
              <span className="text-[10px] text-fg-muted font-normal">
                {discussionMode === 'game_theoretic' ? '♟️ 主导/挑战/仲裁三元攻防' : '💬 轮流自由发言推演'}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDiscussionMode('standard')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  discussionMode === 'standard'
                    ? 'bg-purple-500/10 border-purple-500/50 text-fg shadow-xs ring-1 ring-purple-500/20'
                    : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                  discussionMode === 'standard' ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300' : 'bg-surface text-fg-muted'
                }`}>
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <span>标准协作模式</span>
                    {discussionMode === 'standard' && <Check className="w-3 h-3 text-purple-500 stroke-[2.5]" />}
                  </div>
                  <p className="text-[10px] text-fg-muted mt-0.5 leading-snug">自由轮流发言，适合日常头脑风暴与轻量交流</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDiscussionMode('game_theoretic')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  discussionMode === 'game_theoretic'
                    ? 'bg-amber-500/10 border-amber-500/50 text-fg shadow-xs ring-1 ring-amber-500/20'
                    : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                  discussionMode === 'game_theoretic' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-surface text-fg-muted'
                }`}>
                  <Swords className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <span>博弈讨论模式</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono">推荐</span>
                    {discussionMode === 'game_theoretic' && <Check className="w-3 h-3 text-amber-500 stroke-[2.5]" />}
                  </div>
                  <p className="text-[10px] text-fg-muted mt-0.5 leading-snug">主导-挑战-仲裁三元攻防，高保真架构决策</p>
                </div>
              </button>
            </div>
          </div>

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
              onKeyDown={(e) => {
                // 防止输入法候选词确认 (Enter) 误触表单提交
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || (e as any).isComposing || e.keyCode === 229)) {
                  e.stopPropagation();
                }
              }}
              placeholder="例如：扫码回调统一路由与多租户适配方案"
              className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted"
            />
          </div>

          {/* Description / Spike prompt */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              推演目标 / 需求说明
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述核心痛点、技术约束或需要协同 Agent 解决的问题..."
              className="w-full px-3 py-2 rounded-xl bg-surface-subtle border border-border focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 text-fg text-xs focus:outline-none transition-all placeholder:text-fg-muted resize-none leading-relaxed"
            />
          </div>

          {/* Game-Theoretic: Human Arbiter Privilege Toggle */}
          {discussionMode === 'game_theoretic' && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                  <Scale className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <span>👤 我自己担任中立仲裁者 (持有最终裁决法槌)</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono">
                      终审特权
                    </span>
                  </div>
                  <p className="text-[10px] text-fg-muted mt-0.5 leading-snug">
                    观战攻防推演，专属仲裁法槌，可随时敲锤采纳主导、驳回重构或生成权衡矩阵。
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={humanIsArbiter}
                  onChange={(e) => setHumanIsArbiter(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>
          )}

          {/* Participating Agents Checkbox List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                <span>指派协同推演 Agent</span>
                {discussionMode === 'game_theoretic' && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                    (可为各 Agent 指派三元博弈角色)
                  </span>
                )}
              </label>
              <span className="text-[10px] text-fg-muted font-mono">
                已选中 {selectedAgentIds.length} / {agents.length} 位
              </span>
            </div>

            {agents.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 space-y-1 text-[11px]">
                <div className="font-semibold flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  <span>当前频道暂无可用成员 Agent</span>
                </div>
                <p className="text-[10px] opacity-90 leading-relaxed">
                  请先在频道右上角「成员管理」中邀请专属 Agent 加入本频道。
                </p>
              </div>
            ) : (
              <div className={`grid ${modalWidth >= 520 ? 'grid-cols-2' : 'grid-cols-1'} gap-2 max-h-56 overflow-y-auto overflow-x-hidden pr-1.5 p-0.5`}>
                {agents.map((agent) => {
                  const isSelected = selectedAgentIds.includes(agent.id);
                  const currentRole = agentRoles[agent.id] || 'proposer';
                  return (
                    <div
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`flex flex-col p-2.5 rounded-xl border transition-all cursor-pointer select-none min-w-0 ${
                        isSelected
                          ? discussionMode === 'game_theoretic'
                            ? currentRole === 'proposer'
                              ? 'bg-blue-500/5 border-blue-500/40 text-fg shadow-2xs'
                              : currentRole === 'challenger'
                              ? 'bg-rose-500/5 border-rose-500/40 text-fg shadow-2xs'
                              : 'bg-purple-500/5 border-purple-500/40 text-fg shadow-2xs'
                            : 'bg-purple-500/10 border-purple-500/40 text-fg shadow-2xs'
                          : 'bg-surface-subtle border-border hover:bg-surface-hover text-fg-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                          <span className="text-base shrink-0 select-none">{agent.avatar}</span>
                          <div className="min-w-0 flex-1 flex flex-col justify-center">
                            <div className="font-semibold text-xs text-fg flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{agent.name}</span>
                              {agent.isManagedByYou && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 font-mono shrink-0 select-none leading-none">
                                  影替身
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-fg-muted truncate flex items-center gap-1 mt-0.5">
                              <span className="font-mono text-fg-muted/80 shrink-0">{agent.handle}</span>
                              <span className="text-fg-muted/40 shrink-0 select-none">•</span>
                              <span className="truncate">{agent.role}</span>
                            </div>
                          </div>
                        </div>

                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'border-border bg-surface'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                        </div>
                      </div>

                      {/* Game-Theoretic: Per-Agent Role Switcher */}
                      {discussionMode === 'game_theoretic' && isSelected && (
                        <div
                          className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border/40"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[10px] text-fg-muted shrink-0 mr-1 font-mono">博弈角色:</span>
                          {(['proposer', 'challenger', 'arbiter'] as GameRoleType[]).map((r) => {
                            const isCurrent = currentRole === r;
                            const label = r === 'proposer' ? '🏛️ 主导' : r === 'challenger' ? '⚔️ 挑战' : '⚖️ 仲裁';
                            const activeStyle =
                              r === 'proposer'
                                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-500/50 font-semibold'
                                : r === 'challenger'
                                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/50 font-semibold'
                                : 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/50 font-semibold';
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setAgentRoles((prev) => ({ ...prev, [agent.id]: r }))}
                                className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-all cursor-pointer ${
                                  isCurrent
                                    ? activeStyle
                                    : 'bg-surface-subtle text-fg-muted border-border hover:bg-surface-hover hover:text-fg'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border mt-2 shrink-0">
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
              <Save className="w-3.5 h-3.5" />
              <span>保存修改</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
