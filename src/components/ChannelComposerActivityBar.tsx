import React, { useState, useEffect, useRef } from 'react';
import { ActiveAgentExecution } from '../types';
import { Loader2, Square, ChevronUp, BrainCircuit } from 'lucide-react';

interface ChannelComposerActivityBarProps {
  executions: ActiveAgentExecution[];
  onAbortAgent?: (agentId: string) => void;
  onOpenAgentSession?: (agentId: string) => void;
}

export const ChannelComposerActivityBar: React.FC<ChannelComposerActivityBarProps> = ({
  executions,
  onAbortAgent,
  onOpenAgentSession,
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const popoverRef = useRef<HTMLDivElement>(null);

  // Live timer tick
  useEffect(() => {
    if (executions.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [executions.length]);

  // Close popover on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsPopoverOpen(false);
      }
    };
    if (isPopoverOpen) {
      window.addEventListener('mousedown', handleOutsideClick);
    }
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [isPopoverOpen]);

  if (executions.length === 0) return null;

  const isMulti = executions.length > 1;
  const primary = executions[0];

  return (
    <div className="relative z-30 px-3 sm:px-4 py-1.5 transition-all duration-150 animate-in fade-in slide-in-from-bottom-1">
      {/* 1. Main Floating Trigger Bar (Buzz-style Composer Accessory) */}
      <div className="inline-flex items-center gap-2 bg-surface/95 dark:bg-surface-subtle/95 backdrop-blur-md border border-border/80 shadow-md rounded-xl px-2.5 py-1 text-xs select-none">
        {isMulti ? (
          /* Multi-Agent Case: Stacked Avatars + Popover Trigger */
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPopoverOpen((prev) => !prev)}
              className="flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer text-left"
              title="查看所有运行中的 Agent"
            >
              {/* Overlapping Avatars */}
              <div className="flex items-center -space-x-1.5 shrink-0">
                {executions.slice(0, 2).map((ex) => (
                  <div
                    key={ex.agentId}
                    className="w-5 h-5 rounded-[6px] bg-surface-subtle border border-border flex items-center justify-center text-xs shadow-2xs shrink-0"
                  >
                    {ex.agentAvatar}
                  </div>
                ))}
              </div>

              {executions.length > 2 && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-surface border border-border text-fg-muted font-mono leading-none">
                  +{executions.length - 2}
                </span>
              )}

              {/* Stack Headline with Shimmer */}
              <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
                <span className="truncate max-w-[120px]">{primary.agentName}</span>
                <span className="text-[11px] text-accent font-mono font-medium">
                  +{executions.length - 1} 协作中
                </span>
              </span>

              <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0 ml-0.5" />
              <ChevronUp className={`w-3.5 h-3.5 text-fg-muted transition-transform duration-150 ${isPopoverOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
        ) : (
          /* Single Agent Case: Squircle Avatar + Shimmer Headline + Elapsed Time + Stop */
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-[6px] bg-surface-subtle border border-border flex items-center justify-center text-xs shadow-2xs shrink-0">
              {primary.agentAvatar}
            </div>

            <div className="flex items-center gap-1.5 min-w-0 truncate">
              {primary.cascadeHop && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent font-mono border border-accent/30 shrink-0">
                  Hop {primary.cascadeHop}
                </span>
              )}
              <span className="font-semibold text-fg text-xs shrink-0">
                {primary.agentName}:
              </span>
              <span className="animate-shimmer text-xs truncate max-w-[200px] sm:max-w-[340px]">
                {primary.currentActionDetail ||
                  ((now - primary.startedAt) / 1000 > 60
                    ? '大模型正在深度推理，请稍候...'
                    : (now - primary.startedAt) / 1000 > 25
                    ? '正在深入分析上下文与工程边界...'
                    : '正在分析推演中...')}
              </span>
              <span className="text-[10px] font-mono text-fg-muted shrink-0">
                ({((now - primary.startedAt) / 1000).toFixed(1)}s)
              </span>
            </div>

            {onAbortAgent && (
              <button
                onClick={() => onAbortAgent(primary.agentId)}
                className="ml-1 px-1.5 py-0.5 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-500 text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 border border-red-500/30 shrink-0"
                title="终止此 Agent 响应 (Esc)"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>停止</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2. Popover: Vertical Stack of Active Agents (Buzz Scheme 1) */}
      {isPopoverOpen && isMulti && (
        <div
          ref={popoverRef}
          className="absolute bottom-full mb-2 left-3 sm:left-4 z-50 w-72 sm:w-80 bg-surface/98 dark:bg-surface-subtle/98 backdrop-blur-md border border-border rounded-2xl shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-150 text-xs select-none"
        >
          <div className="flex items-center justify-between px-2 py-1 border-b border-border/60 text-[11px] font-bold text-fg-muted mb-1">
            <span className="flex items-center gap-1.5 text-fg">
              <BrainCircuit className="w-3.5 h-3.5 text-accent" />
              <span>运行中的 Agents ({executions.length})</span>
            </span>
            <span className="text-[10px] font-mono text-fg-muted">Buzz Stack</span>
          </div>

          <div className="space-y-1 max-h-60 overflow-y-auto p-0.5">
            {executions.map((ex) => {
              const elapsed = ((now - ex.startedAt) / 1000).toFixed(1);
              return (
                <div
                  key={ex.agentId}
                  className="flex items-center justify-between p-2 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-border/50 transition-colors group"
                >
                  <div
                    onClick={() => onOpenAgentSession?.(ex.agentId)}
                    className="flex items-center gap-2 min-w-0 flex-1 mr-2 cursor-pointer"
                  >
                    <div className="w-6 h-6 rounded-[7px] bg-surface border border-border flex items-center justify-center text-xs shrink-0 shadow-2xs">
                      {ex.agentAvatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-fg truncate flex items-center gap-1.5">
                        <span className="truncate">{ex.agentName}</span>
                        <span className="text-[10px] text-fg-muted font-mono">({elapsed}s)</span>
                      </div>
                      <p className="text-[11px] text-fg-muted truncate">
                        {ex.currentActionDetail ||
                          (Number(elapsed) > 60
                            ? '大模型正在深度推理，请稍候...'
                            : Number(elapsed) > 25
                            ? '正在深入分析上下文...'
                            : '正在协同思考中...')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                    {onAbortAgent && (
                      <button
                        onClick={() => onAbortAgent(ex.agentId)}
                        className="p-1 rounded-md hover:bg-red-500/20 text-fg-muted hover:text-red-500 transition-colors cursor-pointer"
                        title={`停止 ${ex.agentName}`}
                      >
                        <Square className="w-3 h-3 fill-current text-red-500" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
