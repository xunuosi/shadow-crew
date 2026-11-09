import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Shield,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {
  GameConfigurationEvaluation,
  GameIndependenceProfile,
  GameTheoreticPolicy,
} from '../types';
import { getGameRoleLabel } from '../services/cogno/gameConfigurationEvaluator';

interface GameConfigurationEvaluationCardProps {
  evaluation: GameConfigurationEvaluation;
  onPolicyChange?: (policy: GameTheoreticPolicy) => void;
  onGroundingRequiredChange?: (required: boolean) => void;
}

const STATUS_COPY = {
  pass: {
    label: '配置合格',
    wrapper:
      'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300',
    badge:
      'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  warning: {
    label: '有警告，可启动',
    wrapper:
      'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300',
    badge:
      'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-300',
    icon: AlertTriangle,
  },
  blocked: {
    label: '禁止启动',
    wrapper:
      'bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300',
    badge:
      'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300',
    icon: ShieldAlert,
  },
} as const;

export const GameConfigurationEvaluationCard: React.FC<
  GameConfigurationEvaluationCardProps
> = ({
  evaluation,
  onPolicyChange,
  onGroundingRequiredChange,
}) => {
  const tone = STATUS_COPY[evaluation.status];
  const StatusIcon = tone.icon;
  const familyEntries = Object.entries(
    evaluation.modelDiversity.familyDistribution
  );

  const updateProfile = (independenceProfile: GameIndependenceProfile) => {
    onPolicyChange?.({
      ...evaluation.policy,
      independenceProfile,
    });
  };

  return (
    <section
      data-testid="game-config-evaluation"
      data-status={evaluation.status}
      className={`rounded-2xl border p-3 text-xs space-y-2.5 ${tone.wrapper}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-4 h-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-bold">博弈配置评估</div>
            <div className="text-[10px] opacity-80">
              角色覆盖、独立性与模型多样性统一评估
            </div>
          </div>
        </div>
        <span
          className={`text-[10px] font-semibold px-2 py-1 rounded-full border inline-flex items-center gap-1 ${tone.badge}`}
        >
          <StatusIcon className="w-3 h-3" />
          {tone.label}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-current/15 bg-surface/60 px-2.5 py-2">
        <div className="min-w-0">
          <div className="font-semibold">角色独立性策略</div>
          <div className="text-[10px] opacity-80">
            严格模式禁止关键角色跨职能复用，不静默补位
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {(['strict', 'flexible'] as GameIndependenceProfile[]).map(
            (profile) => {
              const active =
                evaluation.policy.independenceProfile === profile;
              return (
                <button
                  key={profile}
                  type="button"
                  disabled={!onPolicyChange}
                  onClick={() => updateProfile(profile)}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors ${
                    active
                      ? 'bg-surface text-fg border-current'
                      : 'bg-surface/50 text-fg-secondary border-border hover:bg-surface'
                  } ${onPolicyChange ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  {profile === 'strict' ? '严格模式' : '灵活模式'}
                </button>
              );
            }
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {[
          ['提案', evaluation.roleCoverage.proposer],
          ['挑战', evaluation.roleCoverage.challenger],
          ['接地验证', evaluation.roleCoverage.verifier],
          [
            '仲裁',
            evaluation.roleCoverage.arbiter +
              (evaluation.roleCoverage.humanArbiter ? 1 : 0),
          ],
        ].map(([label, count]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-current/15 bg-surface/60 px-2 py-1.5 min-w-0"
          >
            <div className="text-[10px] opacity-75">{label}</div>
            <div className="font-mono font-bold">{count} 位</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        <div className="rounded-lg border border-current/15 bg-surface/60 px-2 py-1.5">
          <div className="text-[10px] opacity-75">独立 Agent</div>
          <div className="font-mono font-bold flex items-center gap-1">
            <Users className="w-3 h-3" />
            {evaluation.uniqueAgentCount} 个
          </div>
        </div>
        <div className="rounded-lg border border-current/15 bg-surface/60 px-2 py-1.5">
          <div className="text-[10px] opacity-75">独立性评分</div>
          <div className="font-mono font-bold">
            {evaluation.independenceScore}%
          </div>
        </div>
        <div className="rounded-lg border border-current/15 bg-surface/60 px-2 py-1.5">
          <div className="text-[10px] opacity-75">模型多样性</div>
          <div className="font-mono font-bold">
            {(evaluation.modelDiversity.score * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-current/15 bg-surface/60 p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold">接地与裁决</span>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[10px]">
            <input
              type="checkbox"
              checked={evaluation.policy.groundingRequired}
              disabled={!onGroundingRequiredChange}
              onChange={(event) =>
                onGroundingRequiredChange?.(event.target.checked)
              }
              className="accent-current"
            />
            需要工具接地实证
          </label>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          <span className="px-1.5 py-0.5 rounded border border-current/20 bg-surface">
            接地：
            {evaluation.groundingRequired
              ? evaluation.groundingSatisfied
                ? '已满足'
                : '未满足'
              : '不需要'}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-current/20 bg-surface">
            裁决：
            {evaluation.roleCoverage.humanArbiter
              ? evaluation.roleCoverage.arbiter > 0
                ? '人类 + AI'
                : '人类终审'
              : evaluation.roleCoverage.arbiter > 0
                ? 'AI 仲裁'
                : '缺失'}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-current/20 bg-surface">
            Defender：
            {evaluation.roleCoverage.defenderUsesProposer
              ? '复用 Proposer'
              : '缺失'}
          </span>
        </div>
      </div>

      {evaluation.reusedRoleBindings.length > 0 && (
        <div className="text-[10px] leading-relaxed">
          <span className="font-semibold">多角色 Agent：</span>
          {evaluation.reusedRoleBindings
            .map(
              (binding) =>
                `${binding.agentName} = ${binding.roles
                  .map(getGameRoleLabel)
                  .join(' + ')}`
            )
            .join('；')}
        </div>
      )}

      {evaluation.criticalCollisions.length > 0 && (
        <div className="text-[10px] leading-relaxed">
          <span className="font-semibold">关键角色冲突：</span>
          {evaluation.criticalCollisions.join('；')}
        </div>
      )}

      {familyEntries.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          <span className="font-semibold">模型家族：</span>
          {familyEntries.map(([family, members]) => (
            <span
              key={family}
              className="px-1.5 py-0.5 rounded border border-current/20 bg-surface/70"
            >
              {family} · {members.length} 位
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-current/20 bg-surface/70 px-2.5 py-2">
        <div className="font-semibold leading-relaxed">{evaluation.summary}</div>
        {evaluation.blockingIssues.length > 0 && (
          <ul className="mt-1.5 space-y-1 list-disc list-inside">
            {evaluation.blockingIssues.map((issue) => (
              <li key={issue} className="leading-relaxed">
                {issue}
              </li>
            ))}
          </ul>
        )}
        {evaluation.warnings.length > 0 && (
          <ul className="mt-1.5 space-y-1 list-disc list-inside opacity-90">
            {evaluation.warnings.map((warning) => (
              <li key={warning} className="leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-xl border border-current/15 bg-surface/50 px-2.5 py-2">
        <summary className="cursor-pointer font-semibold text-[10px]">
          查看计算口径
        </summary>
        <div className="mt-1.5 text-[10px] leading-relaxed opacity-85 space-y-1">
          <p>模型多样性：单一模型家族 25%，两个家族 70%，三个及以上 100%。</p>
          <p>
            独立性：Proposer、Challenger、Verifier、AI Arbiter
            的关键角色冲突会逐项扣分。
          </p>
          <p>
            严格模式：缺少关键角色或出现关键角色复用时阻断启动；灵活模式允许启动但明确告警。
          </p>
          <p>人类仲裁者不占用 Agent 角色；Defender 默认复用 Proposer。</p>
        </div>
      </details>
    </section>
  );
};
