import React from 'react';
import { Sliders, Cpu, ShieldCheck, Sparkles, Check, Info } from 'lucide-react';
import { AgentModelConfig } from '../types';
import { getModelSafeContextBudget } from '../services/llmService';

export interface ModelContextConfigPanelProps {
  modelConfig: AgentModelConfig;
  onChange: (updated: Partial<AgentModelConfig>) => void;
  isLightMode?: boolean;
}

const PRESET_CONTEXT_WINDOWS = [
  { label: '自动推算', value: undefined, desc: '根据模型ID自动匹配原生规格' },
  { label: '128K', value: 131_072, desc: '经典长文本标准窗口' },
  { label: '200K', value: 204_800, desc: 'Claude 3.5/3.7 标准' },
  { label: '1M (100万)', value: 1_000_000, desc: '2026 前沿旗舰原生窗口' },
  { label: '2M (200万)', value: 2_000_000, desc: 'Kimi K3 / Gemini 4 超长窗口' },
  { label: '32K', value: 32_768, desc: '适合本地中等模型' },
  { label: '8K', value: 8_192, desc: '轻量级离线/小型模型' },
];

const PRESET_OUTPUT_LIMITS = [
  { label: '默认自适应', value: undefined },
  { label: '4K', value: 4_096 },
  { label: '16K', value: 16_384 },
  { label: '32K', value: 32_768 },
  { label: '64K', value: 65_536 },
  { label: '128K', value: 131_072 },
];

export const ModelContextConfigPanel: React.FC<ModelContextConfigPanelProps> = ({
  modelConfig,
  onChange,
  isLightMode = true,
}) => {
  const budget = getModelSafeContextBudget(modelConfig);
  const isCustomContext = Boolean(modelConfig.contextWindowTokens && modelConfig.contextWindowTokens > 0);
  const isCustomOutput = Boolean(modelConfig.maxTokens && modelConfig.maxTokens > 0);

  const containerBg = isLightMode
    ? 'bg-slate-50/80 border-slate-200'
    : 'bg-[#0f172a]/40 border-slate-800/80';

  const inputBg = isLightMode
    ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200'
    : 'bg-[#151c2b] border-[#27354d] text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30';

  const labelColor = isLightMode ? 'text-gray-700' : 'text-gray-300';

  return (
    <div className={`p-3.5 rounded-xl border space-y-3 ${containerBg}`}>
      {/* 头部标题与优先级说明 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sliders className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className={`text-[11px] font-bold ${labelColor}`}>上下文窗口与 Token 预算配置</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
          优先用户配置 · 缺省推导
        </span>
      </div>

      {/* 实时生效规格指示条 */}
      <div
        className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 transition-all ${
          isCustomContext
            ? isLightMode
              ? 'bg-emerald-50/70 border-emerald-300/80 text-emerald-900'
              : 'bg-emerald-950/20 border-emerald-800/60 text-emerald-200'
            : isLightMode
            ? 'bg-blue-50/60 border-blue-200 text-blue-950'
            : 'bg-blue-950/20 border-blue-900/40 text-blue-200'
        }`}
      >
        {isCustomContext ? (
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="font-semibold text-[11px] flex items-center gap-1.5 flex-wrap">
            <span>
              {isCustomContext ? '🟢 当前生效：用户显式自定义上下文' : `🔵 当前生效：根据模型 [${budget.modelFamily}] 智能推导规格`}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10">
              上限: {budget.maxContextTokens.toLocaleString()} Tokens
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10">
              预留输出: {budget.reservedForOutput.toLocaleString()} Tokens
            </span>
          </div>
          <div className="text-[10px] opacity-80">
            多 Agent 协同历史安全工作水位线已设为{' '}
            <strong className="font-semibold">{budget.historyTokenBudget.toLocaleString()} Tokens</strong>
            （超过将自动折叠为摘要，杜绝超限阻断）。
          </div>
        </div>
      </div>

      {/* 模型别名/显示名称 (Optional Display Name) */}
      <div>
        <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
          模型展示别名 (Display Name / Badge · 可选)
        </label>
        <input
          type="text"
          value={modelConfig.modelName || ''}
          onChange={(e) => onChange({ modelName: e.target.value })}
          placeholder="例如：GLM-5.3 旗舰代码、DeepSeek V4.1、Claude 3.7"
          className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
        />
      </div>

      {/* 维度 1: 上下文窗口限制 (Context Window Tokens) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
            <Cpu className="w-3 h-3 text-cyan-500" />
            <span>物理上下文窗口上限 (Context Window Tokens)</span>
          </label>
          <span className="text-[10px] text-fg-muted font-mono">
            {modelConfig.contextWindowTokens ? `${modelConfig.contextWindowTokens.toLocaleString()} Tokens` : '自动匹配'}
          </span>
        </div>

        {/* 快捷选择芯片 */}
        <div className="flex flex-wrap gap-1">
          {PRESET_CONTEXT_WINDOWS.map((preset, idx) => {
            const isSelected =
              preset.value === undefined
                ? !modelConfig.contextWindowTokens
                : modelConfig.contextWindowTokens === preset.value;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onChange({ contextWindowTokens: preset.value })}
                title={preset.desc}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono border transition-all flex items-center gap-1 ${
                  isSelected
                    ? isLightMode
                      ? 'bg-blue-600 border-blue-600 text-white font-bold shadow-sm'
                      : 'bg-cyan-600 border-cyan-500 text-white font-bold shadow-sm'
                    : isLightMode
                    ? 'bg-white border-gray-200 text-gray-700 hover:border-blue-400 hover:bg-blue-50/50'
                    : 'bg-[#151c2a] border-[#27354d] text-gray-300 hover:border-cyan-500 hover:bg-cyan-950/30'
                }`}
              >
                {isSelected && <Check className="w-2.5 h-2.5 shrink-0" />}
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* 自定义精确 Token 数字输入 */}
        <div className="pt-0.5">
          <input
            type="number"
            min={1024}
            step={1024}
            value={modelConfig.contextWindowTokens || ''}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
              onChange({ contextWindowTokens: val && !isNaN(val) && val > 0 ? val : undefined });
            }}
            placeholder="自定义上下文上限 (留空则根据模型ID自动匹配，如 1000000)"
            className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
          />
        </div>
      </div>

      {/* 维度 2: 单轮最大生成输出限制 (Max Output Tokens) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
            <span>单轮最大输出配额 (Max Output Tokens)</span>
          </label>
          <span className="text-[10px] text-fg-muted font-mono">
            {modelConfig.maxTokens ? `${modelConfig.maxTokens.toLocaleString()} Tokens` : '模型默认'}
          </span>
        </div>

        {/* 快捷选择芯片 */}
        <div className="flex flex-wrap gap-1">
          {PRESET_OUTPUT_LIMITS.map((preset, idx) => {
            const isSelected =
              preset.value === undefined
                ? !modelConfig.maxTokens
                : modelConfig.maxTokens === preset.value;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onChange({ maxTokens: preset.value })}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-all flex items-center gap-1 ${
                  isSelected
                    ? isLightMode
                      ? 'bg-blue-600 border-blue-600 text-white font-bold'
                      : 'bg-cyan-600 border-cyan-500 text-white font-bold'
                    : isLightMode
                    ? 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'
                    : 'bg-[#151c2a] border-[#27354d] text-gray-300 hover:border-cyan-500'
                }`}
              >
                {isSelected && <Check className="w-2.5 h-2.5 shrink-0" />}
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* 自定义精确输出输入 */}
        <div className="pt-0.5">
          <input
            type="number"
            min={512}
            step={512}
            value={modelConfig.maxTokens || ''}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
              onChange({ maxTokens: val && !isNaN(val) && val > 0 ? val : undefined });
            }}
            placeholder="自定义最大单轮生成输出 (留空则使用模型推荐值，如 65536)"
            className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
          />
        </div>
      </div>
    </div>
  );
};
