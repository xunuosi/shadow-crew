import React, { useState, useEffect } from 'react';
import { Sliders, Cpu, ShieldCheck, Sparkles, Check, Calculator, ArrowRight } from 'lucide-react';
import { AgentModelConfig } from '../types';
import { getModelSafeContextBudget } from '../services/llmService';

export interface ModelContextConfigPanelProps {
  modelConfig: AgentModelConfig;
  onChange: (updated: Partial<AgentModelConfig>) => void;
  isLightMode?: boolean;
}

/**
 * 将 Token 数量人性化换算为直观文本（如 384K / 39.3万 Tokens，1M / 100万 Tokens）
 */
export function formatTokensHumanReadable(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const m = (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2);
    const wan = (tokens / 10_000).toFixed(0);
    return `${m}M (${wan}万 Tokens)`;
  }
  if (tokens >= 1_000) {
    const k = (tokens / 1024).toFixed(tokens % 1024 === 0 ? 0 : 1);
    const wan = (tokens / 10_000).toFixed(1).replace(/\.0$/, '');
    return `${k}K (${wan}万 Tokens)`;
  }
  return `${tokens} Tokens`;
}

/**
 * 智能解析带单位的输入字符串（支持 384k, 384K, 1m, 1M, 1.5m, 100w, 384000 等任意形式）
 */
export function parseTokenInputWithUnits(raw: string): number | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().toLowerCase().replace(/,/g, '').replace(/tokens?/g, '').trim();
  if (!clean) return undefined;

  // 匹配形如 384k, 128k, 64k
  const kMatch = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*k$/);
  if (kMatch && kMatch[1]) {
    const num = parseFloat(kMatch[1]);
    return Math.round(num * 1024);
  }

  // 匹配形如 1m, 2m, 1.5m
  const mMatch = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*m$/);
  if (mMatch && mMatch[1]) {
    const num = parseFloat(mMatch[1]);
    return Math.round(num * 1_000_000);
  }

  // 匹配形如 100w, 10w (万)
  const wMatch = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:w|万)$/);
  if (wMatch && wMatch[1]) {
    const num = parseFloat(wMatch[1]);
    return Math.round(num * 10_000);
  }

  // 纯数字匹配
  const val = parseFloat(clean);
  if (!isNaN(val) && val > 0) {
    return Math.round(val);
  }

  return undefined;
}

// 严格按容量从小到大（升序）排列，保证视觉与认知逻辑递进
const PRESET_CONTEXT_WINDOWS = [
  { label: '自动推算', value: undefined, desc: '根据模型ID自动匹配原生规格' },
  { label: '8K', value: 8_192, desc: '轻量级离线/小型模型' },
  { label: '16K', value: 16_384, desc: '小型本地模型' },
  { label: '32K', value: 32_768, desc: '中等本地模型 / 嵌入式' },
  { label: '64K', value: 65_536, desc: '标准中长文本窗口' },
  { label: '128K', value: 131_072, desc: '经典长文本标准窗口' },
  { label: '200K', value: 204_800, desc: 'Claude 3.5/3.7 标准' },
  { label: '1M (100万)', value: 1_000_000, desc: '2026 前沿旗舰原生窗口' },
  { label: '2M (200万)', value: 2_000_000, desc: 'Kimi K3 / Gemini 4 超长窗口' },
];

// 严格按输出配额从小到大升序排列，并纳入 2026 前沿 384K 级输出
const PRESET_OUTPUT_LIMITS = [
  { label: '默认自适应', value: undefined },
  { label: '4K', value: 4_096 },
  { label: '8K', value: 8_192 },
  { label: '16K', value: 16_384 },
  { label: '32K', value: 32_768 },
  { label: '64K', value: 65_536 },
  { label: '128K', value: 131_072 },
  { label: '384K (DeepSeek V4)', value: 393_216 },
];

export const ModelContextConfigPanel: React.FC<ModelContextConfigPanelProps> = ({
  modelConfig,
  onChange,
  isLightMode = true,
}) => {
  const budget = getModelSafeContextBudget(modelConfig);
  const isCustomContext = Boolean(modelConfig.contextWindowTokens && modelConfig.contextWindowTokens > 0);
  const isCustomOutput = Boolean(modelConfig.maxTokens && modelConfig.maxTokens > 0);

  // 本地文本输入缓存，允许用户临时敲入 "384k"、"1m"
  const [rawContextInput, setRawContextInput] = useState<string>(
    modelConfig.contextWindowTokens ? String(modelConfig.contextWindowTokens) : ''
  );
  const [rawOutputInput, setRawOutputInput] = useState<string>(
    modelConfig.maxTokens ? String(modelConfig.maxTokens) : ''
  );

  useEffect(() => {
    setRawContextInput(modelConfig.contextWindowTokens ? String(modelConfig.contextWindowTokens) : '');
  }, [modelConfig.contextWindowTokens]);

  useEffect(() => {
    setRawOutputInput(modelConfig.maxTokens ? String(modelConfig.maxTokens) : '');
  }, [modelConfig.maxTokens]);

  const containerBg = isLightMode
    ? 'bg-slate-50/80 border-slate-200'
    : 'bg-[#0f172a]/40 border-slate-800/80';

  const inputBg = isLightMode
    ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200'
    : 'bg-[#151c2b] border-[#27354d] text-gray-100 placeholder-gray-500 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/30';

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
              上限: {formatTokensHumanReadable(budget.maxContextTokens)}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10">
              预留输出: {formatTokensHumanReadable(budget.reservedForOutput)}
            </span>
          </div>
          <div className="text-[10px] opacity-80">
            多 Agent 协同历史安全工作水位线已设为{' '}
            <strong className="font-semibold">{formatTokensHumanReadable(budget.historyTokenBudget)}</strong>
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

      {/* 维度 1: 上下文窗口限制 (从小到大升序排序) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
            <Cpu className="w-3 h-3 text-cyan-500" />
            <span>物理上下文窗口上限 (Context Window Tokens)</span>
          </label>
          <span className="text-[10px] text-fg-muted font-mono font-medium">
            {modelConfig.contextWindowTokens ? formatTokensHumanReadable(modelConfig.contextWindowTokens) : '自动智能匹配'}
          </span>
        </div>

        {/* 快捷选择芯片：从小到大严格升序 */}
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
                onClick={() => {
                  onChange({ contextWindowTokens: preset.value });
                  setRawContextInput(preset.value ? String(preset.value) : '');
                }}
                title={preset.desc}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono border transition-all flex items-center gap-1 cursor-pointer ${
                  isSelected
                    ? isLightMode
                      ? 'bg-blue-600 border-blue-600 text-white font-bold shadow-xs'
                      : 'bg-cyan-600 border-cyan-500 text-white font-bold shadow-xs'
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

        {/* 带单位智能换算输入框 */}
        <div className="relative flex items-center">
          <input
            type="text"
            value={rawContextInput}
            onChange={(e) => {
              const text = e.target.value;
              setRawContextInput(text);
              const parsed = parseTokenInputWithUnits(text);
              onChange({ contextWindowTokens: parsed });
            }}
            placeholder="支持直接输入单位，如 1M、2M、128K、64K 或具体数值"
            className={`w-full rounded-xl pl-3 pr-28 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
          />
          <div className="absolute right-2 flex items-center gap-1.5 pointer-events-none">
            {modelConfig.contextWindowTokens ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 dark:bg-cyan-500/15 text-blue-600 dark:text-cyan-300 font-bold border border-blue-500/20">
                ≈ {formatTokensHumanReadable(modelConfig.contextWindowTokens)}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-fg-muted">Tokens</span>
            )}
          </div>
        </div>
      </div>

      {/* 维度 2: 单轮最大生成输出限制 (从小到大升序排序 + 384K 预设) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
            <span>单轮最大输出配额 (Max Output Tokens)</span>
          </label>
          <span className="text-[10px] text-fg-muted font-mono font-medium">
            {modelConfig.maxTokens ? formatTokensHumanReadable(modelConfig.maxTokens) : '模型默认推荐'}
          </span>
        </div>

        {/* 快捷选择芯片：从小到大升序，包含 384K */}
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
                onClick={() => {
                  onChange({ maxTokens: preset.value });
                  setRawOutputInput(preset.value ? String(preset.value) : '');
                }}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-all flex items-center gap-1 cursor-pointer ${
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

        {/* 带单位智能换算输入框 */}
        <div className="relative flex items-center">
          <input
            type="text"
            value={rawOutputInput}
            onChange={(e) => {
              const text = e.target.value;
              setRawOutputInput(text);
              const parsed = parseTokenInputWithUnits(text);
              onChange({ maxTokens: parsed });
            }}
            placeholder="支持输入 384K、128K、64K、32K 或数值 (留空为模型默认)"
            className={`w-full rounded-xl pl-3 pr-28 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
          />
          <div className="absolute right-2 flex items-center gap-1.5 pointer-events-none">
            {modelConfig.maxTokens ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 dark:bg-cyan-500/15 text-blue-600 dark:text-cyan-300 font-bold border border-blue-500/20">
                ≈ {formatTokensHumanReadable(modelConfig.maxTokens)}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-fg-muted">Tokens</span>
            )}
          </div>
        </div>

        {/* 贴心辅助提示 */}
        <div className="text-[10px] text-fg-muted flex items-center gap-1 pt-0.5">
          <Calculator className="w-3 h-3 text-fg-muted shrink-0" />
          <span>
            换算指南：1K = 1,024 Tokens，1M = 1,000,000 Tokens。您可以直接输入 <strong>"384k"</strong>、<strong>"1m"</strong> 或具体数值，系统自动换算。
          </span>
        </div>
      </div>
    </div>
  );
};
