import React, { useState, useEffect, useRef } from 'react';
import { Agent, Channel } from '../types';
import { X, Sparkles, Plus, Bot, Shield, Check, GitBranch, Maximize2, Minimize2 } from 'lucide-react';
import { ResizeHandle } from './ResizeHandle';

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
  const prevIsOpenRef = useRef(false);
  const prevChannelIdRef = useRef<string | undefined>(undefined);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // 仅在弹窗新打开、或所在频道切换时，重置表单并默认勾选成员，避免后台每3秒轮询刷新时误清空用户已输入内容
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    const channelChanged = isOpen && channel?.id !== prevChannelIdRef.current;

    if (justOpened || channelChanged) {
      setTitle('');
      setDescription('');
      setSelectedAgentIds(agentsRef.current.map((a) => a.id));
    }

    prevIsOpenRef.current = isOpen;
    prevChannelIdRef.current = channel?.id;
  }, [isOpen, channel?.id]);

  const [modalWidth, setModalWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 560;
    try {
      const saved = localStorage.getItem('shinobi_new_topic_modal_width');
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
        localStorage.setItem('shinobi_new_topic_modal_width', String(clamped));
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
        localStorage.setItem('shinobi_new_topic_modal_width', String(next));
      } catch {}
      return next;
    });
  };

  const resetModalWidth = () => {
    setModalWidth(560);
    try {
      localStorage.setItem('shinobi_new_topic_modal_width', '560');
    } catch {}
  };

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
      <div 
        style={{ width: `${modalWidth}px`, maxWidth: '95vw' }}
        className={`relative bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg-secondary ${
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
        <div className="h-12 px-5 border-b border-border flex items-center justify-between bg-surface-subtle select-none">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-300">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-fg text-sm">发起新议题 (New Topic)</h2>
              <p className="text-[10px] text-fg-muted font-mono">在 #{channel.name} 频道内开启单层推演空间</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleWidescreen}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-accent transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-mono px-2 border border-border/50"
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
              className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
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
