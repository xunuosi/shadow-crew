import React from 'react';
import { AlertTriangle, Scale } from 'lucide-react';
import { McdaDecisionPayload } from '../../types';

export interface RulingGovernanceGatesProps {
  mcdaPayload?: McdaDecisionPayload;
  consistencyPassed: boolean;
  isChallengerQuorumMet: boolean;
  exemptionChecked: boolean;
  exemptionReason: string;
  onExemptionCheckedChange: (checked: boolean) => void;
  onExemptionReasonChange: (reason: string) => void;
}

/**
 * 仲裁决策运筹求解参考（MCDA BWM）及一致性 / 法定人数硬门禁提示面板。
 */
export const RulingGovernanceGates: React.FC<RulingGovernanceGatesProps> = ({
  mcdaPayload,
  consistencyPassed,
  isChallengerQuorumMet,
  exemptionChecked,
  exemptionReason,
  onExemptionCheckedChange,
  onExemptionReasonChange,
}) => {
  return (
    <>
      {mcdaPayload && (
        <section className="p-3.5 rounded-xl bg-purple-50 border border-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-purple-800 dark:text-purple-300 text-xs">
              <Scale className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>MCDA 运筹最优最劣法 (BWM) 数学求解参考</span>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface border border-purple-300 dark:border-purple-500/30 text-purple-800 dark:text-purple-300">
              一致性标度 ξ* = {mcdaPayload.consistencyIndex}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            {mcdaPayload.criteria.map((c) => (
              <div
                key={c.id}
                className="p-2 rounded-lg bg-surface border border-border text-center"
              >
                <div
                  className="text-fg-muted truncate text-[10px]"
                  title={c.name}
                >
                  {c.name.split('与')[0]}
                </div>
                <div className="font-semibold text-fg mt-0.5">
                  {((mcdaPayload.computedWeights[c.id] || 0) * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
          {mcdaPayload.ranking[0] && (
            <div className="text-xs text-fg-secondary">
              <span className="font-semibold text-fg">数学最优方案：</span>
              <span className="text-purple-800 dark:text-purple-300 font-bold">
                {mcdaPayload.ranking[0].alternative}
              </span>
              <span className="text-fg-muted ml-1">
                （综合效用得分:{' '}
                {(mcdaPayload.ranking[0].totalUtility * 10).toFixed(2)}/10）
              </span>
            </div>
          )}
        </section>
      )}

      {mcdaPayload && !consistencyPassed && (
        <section className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300 text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              MCDA 运筹逻辑一致性未达标硬门禁 (Consistency Check Failed, ξ*
              &gt; 0.12)
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-secondary">
            当前多准则偏好矩阵存在逻辑传递性矛盾 (当前标度 ξ* ={' '}
            {mcdaPayload.consistencyIndex} &gt;
            0.12)。根据工程控制法规，系统已硬锁定直接批准。如确需定案，人类首席仲裁官须勾选下方的特权豁免，承担一致性缺陷责任。
          </p>
          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={exemptionChecked}
              onChange={(e) => onExemptionCheckedChange(e.target.checked)}
              className="mt-0.5 rounded border-rose-400 text-rose-600 focus:ring-rose-500"
            />
            <span className="text-[11px] font-semibold text-fg">
              我已知晓一致性逻辑矛盾风险，并执行人类首席仲裁官具名特权豁免
              (Exemption)
            </span>
          </label>
          {exemptionChecked && (
            <div className="pt-1">
              <input
                type="text"
                value={exemptionReason}
                onChange={(e) => onExemptionReasonChange(e.target.value)}
                placeholder="请输入一致性豁免理由（如：已人工核对并对冲冲突准则）..."
                className="w-full px-3 py-1.5 rounded-lg bg-surface border border-rose-300 dark:border-rose-500/40 text-fg text-xs focus:outline-none focus:border-rose-500 placeholder:text-fg-muted"
              />
            </div>
          )}
        </section>
      )}

      {!isChallengerQuorumMet && (
        <section className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300 text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>法定推演人数未达标告警 (Quorum Not Met)</span>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-secondary">
            红队对抗方 (Challenger)
            未能成功生成有效反例压测或发生离线/异常。根据博弈推演治理规约，如需定案，人类首席仲裁官须行使具名特权豁免。
          </p>
          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={exemptionChecked}
              onChange={(e) => onExemptionCheckedChange(e.target.checked)}
              className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-[11px] font-semibold text-fg">
              我已知晓红队缺席风险，并执行人类首席仲裁官具名特权豁免
              (Exemption)
            </span>
          </label>
          {exemptionChecked && (
            <div className="pt-1">
              <input
                type="text"
                value={exemptionReason}
                onChange={(e) => onExemptionReasonChange(e.target.value)}
                placeholder="请输入具名豁免理由（如：红队超时，时间紧迫先行采纳）..."
                className="w-full px-3 py-1.5 rounded-lg bg-surface border border-amber-300 dark:border-amber-500/40 text-fg text-xs focus:outline-none focus:border-amber-500 placeholder:text-fg-muted"
              />
            </div>
          )}
        </section>
      )}
    </>
  );
};
