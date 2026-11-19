import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, UserX } from 'lucide-react';
import { GameRoleType } from '../../types';
import {
  ExecutorAvailability,
  ExecutorCandidateOption,
} from '../../services/cogno/rulingModalHelpers';

export interface ExecutorAgentSelectorProps {
  labelId: string;
  selectedExecutorId: string;
  candidates: ExecutorCandidateOption[];
  onSelect: (agentId: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const GAME_ROLE_BADGE_MAP: Record<
  GameRoleType,
  { label: string; badgeClass: string }
> = {
  proposer: {
    label: '提案官',
    badgeClass:
      'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  },
  challenger: {
    label: '红队官',
    badgeClass:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  },
  verifier: {
    label: '接地验证官',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  },
  arbiter: {
    label: '流程综合官',
    badgeClass:
      'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
  },
};

function getAvailabilityVisuals(availability: ExecutorAvailability): {
  dotClass: string;
  pillClass: string;
} {
  if (availability === 'online') {
    return {
      dotClass: 'bg-emerald-500',
      pillClass:
        'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    };
  }
  if (availability === 'busy') {
    return {
      dotClass: 'bg-amber-500',
      pillClass:
        'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    };
  }
  return {
    dotClass: 'bg-slate-400 dark:bg-slate-500',
    pillClass:
      'bg-surface text-fg-secondary border-border',
  };
}

export const ExecutorAgentSelector: React.FC<ExecutorAgentSelectorProps> = ({
  labelId,
  selectedExecutorId,
  candidates,
  onSelect,
  isOpen,
  onOpenChange,
}) => {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openUpward, setOpenUpward] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const participantCandidates = useMemo(
    () => candidates.filter((c) => c.isParticipant),
    [candidates]
  );
  const otherCandidates = useMemo(
    () => candidates.filter((c) => !c.isParticipant),
    [candidates]
  );

  // 键盘导航与 aria-activedescendant 使用的线性选项顺序（与渲染顺序严格一致）
  const flatValues = useMemo(
    () => [
      '',
      ...participantCandidates.map((c) => c.agent.id),
      ...otherCandidates.map((c) => c.agent.id),
    ],
    [participantCandidates, otherCandidates]
  );

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.agent.id === selectedExecutorId) || null,
    [candidates, selectedExecutorId]
  );

  const updatePlacement = () => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return;
    const rect = triggerEl.getBoundingClientRect();

    let upperBound = 0;
    let lowerBound = window.innerHeight;
    let parent = triggerEl.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const overflowY = style.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const parentRect = parent.getBoundingClientRect();
        upperBound = Math.max(upperBound, parentRect.top);
        lowerBound = Math.min(lowerBound, parentRect.bottom);
        break;
      }
      parent = parent.parentElement;
    }

    const spaceBelow = lowerBound - rect.bottom;
    const spaceAbove = rect.top - upperBound;
    setOpenUpward(spaceBelow < 240 && spaceAbove > spaceBelow);
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePlacement();
    const currentIdx = flatValues.indexOf(selectedExecutorId);
    setActiveIndex(currentIdx >= 0 ? currentIdx : 0);

    const handleOutsidePointerDown = (event: PointerEvent | MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
    };
  }, [isOpen, flatValues, selectedExecutorId, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const activeEl = optionRefs.current[activeIndex];
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

  const handleChoose = (agentId: string) => {
    onSelect(agentId);
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        onOpenChange(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === 'Tab') {
      onOpenChange(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) =>
        prev + 1 < flatValues.length ? prev + 1 : 0
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) =>
        prev - 1 >= 0 ? prev - 1 : flatValues.length - 1
      );
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, flatValues.length - 1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const targetValue = flatValues[activeIndex];
      if (targetValue !== undefined) {
        handleChoose(targetValue);
      }
    }
  };

  const renderCandidateOption = (
    option: ExecutorCandidateOption,
    flatIdx: number
  ) => {
    const isSelected = option.agent.id === selectedExecutorId;
    const isActive = flatIdx === activeIndex;
    const { dotClass, pillClass } = getAvailabilityVisuals(option.availability);

    return (
      <button
        key={option.agent.id}
        ref={(el) => {
          optionRefs.current[flatIdx] = el;
        }}
        id={`${listboxId}-opt-${flatIdx}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        onMouseEnter={() => setActiveIndex(flatIdx)}
        onClick={() => handleChoose(option.agent.id)}
        className={`w-full px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer flex items-center justify-between gap-2.5 ${
          isSelected
            ? 'bg-blue-50 border-blue-300 text-fg dark:bg-blue-500/15 dark:border-blue-500/40'
            : isActive
            ? 'bg-surface-hover border-border-hover text-fg'
            : 'bg-transparent border-transparent hover:bg-surface-hover text-fg'
        }`}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}
              aria-hidden="true"
            />
            <span
              className={`text-xs truncate ${
                isSelected ? 'font-bold text-fg' : 'font-medium text-fg'
              }`}
            >
              {option.agent.name}
            </span>
            {option.gameRoles.map((roleKey) => {
              const badge = GAME_ROLE_BADGE_MAP[roleKey];
              return (
                <span
                  key={roleKey}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-tight ${badge.badgeClass}`}
                >
                  {badge.label}
                </span>
              );
            })}
          </div>
          {option.agent.role && (
            <div className="text-[11px] text-fg-secondary truncate pl-3.5">
              {option.agent.role}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded-md border text-[10px] font-medium whitespace-nowrap ${pillClass}`}
          >
            {option.availabilityLabel}
          </span>
          {isSelected && (
            <Check
              className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"
              aria-hidden="true"
            />
          )}
        </div>
      </button>
    );
  };

  let runningIndex = 1;

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-labelledby={labelId}
        aria-activedescendant={
          isOpen && activeIndex >= 0
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        onClick={() => onOpenChange(!isOpen)}
        className={`w-full px-3.5 py-2.5 rounded-xl bg-surface border text-left transition-all cursor-pointer flex items-center justify-between gap-2.5 ${
          isOpen
            ? 'border-accent ring-2 ring-accent/15'
            : 'border-border hover:border-border-hover'
        }`}
      >
        {selectedCandidate ? (
          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                getAvailabilityVisuals(selectedCandidate.availability).dotClass
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-[13px] text-fg truncate">
              {selectedCandidate.agent.name}
            </span>
            {selectedCandidate.gameRoles.map((roleKey) => {
              const badge = GAME_ROLE_BADGE_MAP[roleKey];
              return (
                <span
                  key={roleKey}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-tight ${badge.badgeClass}`}
                >
                  {badge.label}
                </span>
              );
            })}
            {selectedCandidate.agent.role && (
              <span className="text-[11px] text-fg-muted truncate">
                {selectedCandidate.agent.role}
              </span>
            )}
          </div>
        ) : (
          <div className="min-w-0 flex-1 flex items-center gap-2 text-[13px] text-fg-secondary">
            <UserX className="w-3.5 h-3.5 text-fg-muted shrink-0" />
            <span className="truncate">
              暂不指派执行 Agent (仅法槌定案归档)
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {selectedCandidate && (
            <span
              className={`px-2 py-0.5 rounded-md border text-[10px] font-medium whitespace-nowrap ${
                getAvailabilityVisuals(selectedCandidate.availability).pillClass
              }`}
            >
              {selectedCandidate.availabilityLabel}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-fg-muted transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-accent' : ''
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className={`absolute left-0 right-0 z-50 rounded-xl bg-surface border border-border shadow-2xl p-1.5 max-h-64 overflow-y-auto space-y-1 ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {/* Option 0: Unassigned */}
          <button
            ref={(el) => {
              optionRefs.current[0] = el;
            }}
            id={`${listboxId}-opt-0`}
            type="button"
            role="option"
            aria-selected={selectedExecutorId === ''}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => handleChoose('')}
            className={`w-full px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
              selectedExecutorId === ''
                ? 'bg-blue-50 border-blue-300 text-fg font-semibold dark:bg-blue-500/15 dark:border-blue-500/40'
                : activeIndex === 0
                ? 'bg-surface-hover border-border-hover text-fg-secondary'
                : 'bg-transparent border-transparent hover:bg-surface-hover text-fg-secondary'
            }`}
          >
            <span className="flex items-center gap-2 text-xs">
              <UserX className="w-3.5 h-3.5 text-fg-muted shrink-0" />
              <span>暂不指派执行 Agent（仅敲响法槌定案归档）</span>
            </span>
            {selectedExecutorId === '' && (
              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            )}
          </button>

          {participantCandidates.length > 0 && (
            <div className="pt-1">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                当前议题参与 Agent
              </div>
              <div className="space-y-0.5">
                {participantCandidates.map((option) => {
                  const idx = runningIndex++;
                  return renderCandidateOption(option, idx);
                })}
              </div>
            </div>
          )}

          {otherCandidates.length > 0 && (
            <div className="pt-1 border-t border-border/60">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                其他可用 Agent
              </div>
              <div className="space-y-0.5">
                {otherCandidates.map((option) => {
                  const idx = runningIndex++;
                  return renderCandidateOption(option, idx);
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
