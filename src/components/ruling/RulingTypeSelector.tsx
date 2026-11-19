import React from 'react';
import {
  Check,
  CheckCircle2,
  Edit3,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { RulingDecisionType } from '../../types';
import { RulingModeDraftState } from '../../services/cogno';

export const RULING_TYPE_OPTIONS: Array<{
  type: RulingDecisionType;
  title: string;
  subtitle: string;
  activeCardClass: string;
  activeIconClass: string;
  submitBtnClass: string;
}> = [
  {
    type: 'adopt_proposer',
    title: '采纳主导',
    subtitle: '准予合并实施',
    activeCardClass:
      'bg-emerald-50 border-emerald-400 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/50 dark:text-emerald-200 ring-1 ring-emerald-500/25 shadow-xs',
    activeIconClass: 'text-emerald-600 dark:text-emerald-400',
    submitBtnClass:
      'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer',
  },
  {
    type: 'reject_rebuild',
    title: '采纳挑战',
    subtitle: '驳回重构架构',
    activeCardClass:
      'bg-rose-50 border-rose-400 text-rose-900 dark:bg-rose-500/15 dark:border-rose-500/50 dark:text-rose-200 ring-1 ring-rose-500/25 shadow-xs',
    activeIconClass: 'text-rose-600 dark:text-rose-400',
    submitBtnClass: 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer',
  },
  {
    type: 'trade_off_matrix',
    title: '权衡矩阵',
    subtitle: '折中分期推进',
    activeCardClass:
      'bg-purple-50 border-purple-400 text-purple-900 dark:bg-purple-500/15 dark:border-purple-500/50 dark:text-purple-200 ring-1 ring-purple-500/25 shadow-xs',
    activeIconClass: 'text-purple-600 dark:text-purple-400',
    submitBtnClass:
      'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer',
  },
];

export interface RulingTypeSelectorProps {
  rulingType: RulingDecisionType;
  customDraftsByMode: Partial<Record<RulingDecisionType, RulingModeDraftState>>;
  onSwitchType: (type: RulingDecisionType) => void;
  onResetToAiDraft: () => void;
}

/**
 * 仲裁裁决类型三联切换卡片与草案来源/人类定制重置提示条。
 */
export const RulingTypeSelector: React.FC<RulingTypeSelectorProps> = ({
  rulingType,
  customDraftsByMode,
  onSwitchType,
  onResetToAiDraft,
}) => {
  const isCurrentModeCustomized = Boolean(
    customDraftsByMode[rulingType]?.isCustomized
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">
          选择仲裁裁决类型
        </span>
        <span className="text-[11px] text-fg-muted">
          三种模式草案独立保存
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {RULING_TYPE_OPTIONS.map((opt) => {
          const isActive = rulingType === opt.type;
          const hasModeCustomization = Boolean(
            customDraftsByMode[opt.type]?.isCustomized
          );
          return (
            <button
              key={opt.type}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSwitchType(opt.type)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                isActive
                  ? opt.activeCardClass
                  : 'bg-surface-subtle border-border hover:bg-surface-hover hover:border-border-hover text-fg-secondary'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  {opt.type === 'adopt_proposer' && (
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive
                          ? opt.activeIconClass
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    />
                  )}
                  {opt.type === 'reject_rebuild' && (
                    <RotateCcw
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive
                          ? opt.activeIconClass
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    />
                  )}
                  {opt.type === 'trade_off_matrix' && (
                    <SlidersHorizontal
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive
                          ? opt.activeIconClass
                          : 'text-purple-600 dark:text-purple-400'
                      }`}
                    />
                  )}
                  <span>{opt.title}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {hasModeCustomization && (
                    <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
                      已修改
                    </span>
                  )}
                  {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                </div>
              </div>
              <div
                className={`text-[11px] ${
                  isActive ? 'opacity-90' : 'text-fg-muted'
                }`}
              >
                {opt.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl border text-[11px] ${
          isCurrentModeCustomized
            ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300'
            : 'bg-purple-50 border-purple-300 text-purple-800 dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-300'
        }`}
      >
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {isCurrentModeCustomized ? (
            <>
              <Edit3 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-semibold">
                人类首席仲裁官定制方案建议 (已修改)
              </span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              <span className="font-semibold">
                综合仲裁官 Agent 针对本模式动态预生成草案
              </span>
            </>
          )}
          <span className="opacity-80">· 紧扣立论与反例事实</span>
        </div>

        {isCurrentModeCustomized && (
          <button
            type="button"
            onClick={onResetToAiDraft}
            className="px-2 py-0.5 rounded-lg bg-surface border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-surface-hover text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
            title="恢复由综合仲裁官针对该模式生成的原草案"
          >
            <RotateCcw className="w-3 h-3" />
            <span>恢复 AI 原草案</span>
          </button>
        )}
      </div>
    </section>
  );
};
