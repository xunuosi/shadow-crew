import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Cpu,
  ShieldCheck,
  Sparkles,
  Check,
  Calculator,
  ImageIcon,
  Brain,
  HelpCircle,
  Plus,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { AgentModelConfig, ReasoningLevelItem } from '../types';
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
    const m = (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2).replace(/\.00$/, '');
    const wan = (tokens / 10_000).toFixed(0);
    return `${m}M (${wan}万 Tokens)`;
  }
  if (tokens >= 1_000) {
    const k = (tokens / 1024).toFixed(tokens % 1024 === 0 ? 0 : 1).replace(/\.0$/, '');
    const wan = (tokens / 10_000).toFixed(1).replace(/\.0$/, '');
    return `${k}K (${wan}万 Tokens)`;
  }
  return `${tokens} Tokens`;
}

/**
 * 将 Token 数量格式化为标准紧凑单位字符串（如 1M, 2M, 128K, 384K 等），
 * 用于在输入框中简洁回显，直观对标前沿大模型控制面板。
 */
export function formatTokenUnitOnly(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const m = (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2).replace(/\.00$/, '');
    return `${m}M`;
  }
  if (tokens >= 1024) {
    const k = (tokens / 1024).toFixed(tokens % 1024 === 0 ? 0 : 1).replace(/\.0$/, '');
    return `${k}K`;
  }
  return `${tokens}`;
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

export const DEFAULT_REASONING_LEVELS: ReasoningLevelItem[] = [
  { level: 'off', apiValue: '' },
  { level: 'low', apiValue: 'low' },
  { level: 'medium', apiValue: 'medium' },
  { level: 'high', apiValue: 'high' },
];

export const REASONING_EFFORT_OPTIONS = [
  { value: 'off', label: '关闭 (Off)', desc: '不启用思维链思考' },
  { value: 'low', label: '轻度 (Low)', desc: '极速浅思考，适合简单任务' },
  { value: 'medium', label: '标准 (Medium · 默认)', desc: '平衡思考深度与响应速度' },
  { value: 'high', label: '深度 (High)', desc: '全维度深度思考，适合复杂工程推演' },
];

export const ModelContextConfigPanel: React.FC<ModelContextConfigPanelProps> = ({
  modelConfig,
  onChange,
  isLightMode = true,
}) => {
  const budget = getModelSafeContextBudget(modelConfig);
  const isCustomContext = Boolean(modelConfig.contextWindowTokens && modelConfig.contextWindowTokens > 0);
  const isCustomOutput = Boolean(modelConfig.maxTokens && modelConfig.maxTokens > 0);

  // 输入框内部缓存（聚焦时允许用户自由敲击 1m, 128k；失焦后格式化为紧凑单位回显）
  const [contextInputText, setContextInputText] = useState<string>(() =>
    modelConfig.contextWindowTokens ? formatTokenUnitOnly(modelConfig.contextWindowTokens) : ''
  );
  const [isContextFocused, setIsContextFocused] = useState(false);

  const [outputInputText, setOutputInputText] = useState<string>(() =>
    modelConfig.maxTokens ? formatTokenUnitOnly(modelConfig.maxTokens) : ''
  );
  const [isOutputFocused, setIsOutputFocused] = useState(false);

  // 同步外部变化
  useEffect(() => {
    if (!isContextFocused) {
      setContextInputText(
        modelConfig.contextWindowTokens ? formatTokenUnitOnly(modelConfig.contextWindowTokens) : ''
      );
    }
  }, [modelConfig.contextWindowTokens, isContextFocused]);

  useEffect(() => {
    if (!isOutputFocused) {
      setOutputInputText(modelConfig.maxTokens ? formatTokenUnitOnly(modelConfig.maxTokens) : '');
    }
  }, [modelConfig.maxTokens, isOutputFocused]);

  // 图片输入支持 (默认 text 必选，image 可选配置)
  const isImageSupported =
    modelConfig.supportsImage ??
    (Array.isArray(modelConfig.inputTypes)
      ? modelConfig.inputTypes.includes('image')
      : true); // 默认允许图片或根据配置判断

  const handleToggleImage = (checked: boolean) => {
    const nextTypes: Array<'text' | 'image'> = checked ? ['text', 'image'] : ['text'];
    onChange({
      supportsImage: checked,
      inputTypes: nextTypes,
    });
  };

  // 思考强度设置与映射表
  const isReasoningEnabled = Boolean(modelConfig.enableReasoning);
  const activeEffort = modelConfig.reasoningEffort || 'medium';
  const reasoningLevels = modelConfig.reasoningLevels && modelConfig.reasoningLevels.length > 0
    ? modelConfig.reasoningLevels
    : DEFAULT_REASONING_LEVELS;

  const handleToggleReasoning = (enabled: boolean) => {
    onChange({
      enableReasoning: enabled,
      reasoningEffort: enabled ? (modelConfig.reasoningEffort || 'medium') : 'off',
      reasoningLevels: modelConfig.reasoningLevels || DEFAULT_REASONING_LEVELS,
    });
  };

  const handleUpdateLevelApiValue = (index: number, newApiValue: string) => {
    const nextLevels = [...reasoningLevels];
    nextLevels[index] = { ...nextLevels[index], apiValue: newApiValue };
    onChange({ reasoningLevels: nextLevels });
  };

  const handleUpdateLevelName = (index: number, newLevel: string) => {
    const nextLevels = [...reasoningLevels];
    nextLevels[index] = { ...nextLevels[index], level: newLevel };
    onChange({ reasoningLevels: nextLevels });
  };

  // 微型总结 Agent 智能归纳配置 (默认开启双模架构，异常/离线自动无缝回退规则提取)
  const isMicroAgentEnabled = modelConfig.enableMicroAgentSummary !== false;
  const handleToggleMicroAgent = (enabled: boolean) => {
    onChange({ enableMicroAgentSummary: enabled });
  };

  const handleDeleteLevel = (index: number) => {
    const nextLevels = reasoningLevels.filter((_, i) => i !== index);
    onChange({ reasoningLevels: nextLevels });
  };

  const handleAddLevel = () => {
    const nextLevels = [
      ...reasoningLevels,
      { level: `custom-${reasoningLevels.length + 1}`, apiValue: 'custom' },
    ];
    onChange({ reasoningLevels: nextLevels });
  };

  const containerBg = isLightMode
    ? 'bg-slate-50/80 border-slate-200'
    : 'bg-[#0f172a]/40 border-slate-800/80';

  const inputBg = isLightMode
    ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200'
    : 'bg-[#151c2b] border-[#27354d] text-gray-100 placeholder-gray-500 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/30';

  const labelColor = isLightMode ? 'text-gray-700' : 'text-gray-300';

  return (
    <div className={`p-3.5 rounded-xl border space-y-3.5 ${containerBg}`}>
      {/* 头部标题与优先级说明 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sliders className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className={`text-[11px] font-bold ${labelColor}`}>模型规格与推理能力配置</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
          智能单位换算 · 优先用户配置
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
              {isCustomContext ? '🟢 当前生效：用户显式自定义' : `🔵 当前生效：[${budget.modelFamily}] 原生规格智能推导`}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10 font-bold">
              上限: {formatTokensHumanReadable(budget.maxContextTokens)}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10">
              预留输出: {formatTokensHumanReadable(budget.reservedForOutput)}
            </span>
          </div>
          <div className="text-[10px] opacity-80">
            多 Agent 协同历史安全工作水位线已设为{' '}
            <strong className="font-semibold">{formatTokensHumanReadable(budget.historyTokenBudget)}</strong>
            （超限将自适应浓缩为结构化 Memory 要点，杜绝会话超限阻断）。
          </div>
        </div>
      </div>

      {/* 模型展示别名 */}
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

      {/* 并排双列：Context Window 与 Max Output Tokens (完全对标图片 1 布局) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 左列: Context window */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
              <Cpu className="w-3 h-3 text-cyan-500 shrink-0" />
              <span>Context window (上下文窗口)</span>
            </label>
            <span className="text-[10px] text-fg-muted font-mono">
              {modelConfig.contextWindowTokens ? formatTokensHumanReadable(modelConfig.contextWindowTokens) : '自动'}
            </span>
          </div>

          {/* 带单位直接输入框 (用户输入 1M、128K，系统自动换算) */}
          <div className="relative flex items-center">
            <input
              type="text"
              value={contextInputText}
              onFocus={() => setIsContextFocused(true)}
              onBlur={() => {
                setIsContextFocused(false);
                const parsed = parseTokenInputWithUnits(contextInputText);
                onChange({ contextWindowTokens: parsed });
                if (parsed) {
                  setContextInputText(formatTokenUnitOnly(parsed));
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                setContextInputText(val);
                const parsed = parseTokenInputWithUnits(val);
                onChange({ contextWindowTokens: parsed });
              }}
              placeholder="如 1M, 2M, 128K, 64K"
              className={`w-full rounded-xl pl-3 pr-14 py-2 text-xs font-mono font-medium focus:outline-none transition-all ${inputBg}`}
            />
            <div className="absolute right-2.5 flex items-center pointer-events-none">
              <span className="text-[10px] font-mono font-bold text-fg-muted">Tokens</span>
            </div>
          </div>

          {/* 快捷选择预设 */}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {PRESET_CONTEXT_WINDOWS.slice(0, 6).map((preset, idx) => {
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
                    setContextInputText(preset.value ? formatTokenUnitOnly(preset.value) : '');
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                    isSelected
                      ? isLightMode
                        ? 'bg-blue-600 border-blue-600 text-white font-bold'
                        : 'bg-cyan-600 border-cyan-500 text-white font-bold'
                      : isLightMode
                      ? 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'
                      : 'bg-[#151c2a] border-[#27354d] text-gray-300 hover:border-cyan-500'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右列: Max output tokens */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
              <span>Max output tokens (输出配额)</span>
            </label>
            <span className="text-[10px] text-fg-muted font-mono">
              {modelConfig.maxTokens ? formatTokensHumanReadable(modelConfig.maxTokens) : '自适应'}
            </span>
          </div>

          {/* 带单位直接输入框 (用户输入 128K、384K，系统自动换算) */}
          <div className="relative flex items-center">
            <input
              type="text"
              value={outputInputText}
              onFocus={() => setIsOutputFocused(true)}
              onBlur={() => {
                setIsOutputFocused(false);
                const parsed = parseTokenInputWithUnits(outputInputText);
                onChange({ maxTokens: parsed });
                if (parsed) {
                  setOutputInputText(formatTokenUnitOnly(parsed));
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                setOutputInputText(val);
                const parsed = parseTokenInputWithUnits(val);
                onChange({ maxTokens: parsed });
              }}
              placeholder="如 128K, 384K, 64K"
              className={`w-full rounded-xl pl-3 pr-14 py-2 text-xs font-mono font-medium focus:outline-none transition-all ${inputBg}`}
            />
            <div className="absolute right-2.5 flex items-center pointer-events-none">
              <span className="text-[10px] font-mono font-bold text-fg-muted">Tokens</span>
            </div>
          </div>

          {/* 快捷选择预设 */}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {PRESET_OUTPUT_LIMITS.slice(0, 6).map((preset, idx) => {
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
                    setOutputInputText(preset.value ? formatTokenUnitOnly(preset.value) : '');
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                    isSelected
                      ? isLightMode
                        ? 'bg-blue-600 border-blue-600 text-white font-bold'
                        : 'bg-cyan-600 border-cyan-500 text-white font-bold'
                      : isLightMode
                      ? 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'
                      : 'bg-[#151c2a] border-[#27354d] text-gray-300 hover:border-cyan-500'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 维度 2: Input types (对标图片 1: Text / Image 输入支持配置) */}
      <div className="pt-1 border-t border-border/60">
        <label className={`block text-[11px] font-semibold mb-2 ${labelColor}`}>
          Input types (模型输入模态支持)
        </label>
        <div className="flex items-center gap-6">
          {/* Text 文本输入 (基座基础能力，恒定勾选) */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={true}
              disabled={true}
              className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-not-allowed opacity-90"
            />
            <span className="text-xs font-medium text-fg flex items-center gap-1.5">
              <span>Text</span>
              <span className="text-[10px] text-fg-muted font-normal">(文本必选)</span>
            </span>
          </label>

          {/* Image 视觉图片输入 (按需求配置是否可以传入图片) */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isImageSupported}
              onChange={(e) => handleToggleImage(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-xs font-medium text-fg flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span>Image</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium ${
                isImageSupported
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-slate-500/10 text-fg-muted'
              }`}>
                {isImageSupported ? '支持传入图片' : '禁用图片'}
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* 维度 3: Reasoning levels (对标图片 1 & 图片 2: 思考强度配置，有默认选项) */}
      <div className="pt-2 border-t border-border/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className={`text-[11px] font-semibold ${labelColor}`}>Reasoning levels (思考强度配置)</span>
            <div className="relative group cursor-help">
              <HelpCircle className="w-3 h-3 text-fg-muted" />
              <div className="absolute left-0 bottom-full mb-1.5 hidden group-hover:block w-64 p-2 bg-popover text-popover-fg text-[10px] rounded-lg shadow-lg border border-border z-20">
                配置并控制大模型的思维链（Chain-of-Thought / Reasoning Effort）强度。开启后可配置各层级对应的 API 参数，并支持选择默认选项。
              </div>
            </div>
          </div>

          {/* iOS 风格平滑切换 Toggle 开关 (对标图片 1) */}
          <button
            type="button"
            role="switch"
            aria-checked={isReasoningEnabled}
            onClick={() => handleToggleReasoning(!isReasoningEnabled)}
            className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
              isReasoningEnabled ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-300 dark:bg-gray-700'
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                isReasoningEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 当开启时：展开思考强度默认选项与 API 映射配置表格 (对标图片 2) */}
        {isReasoningEnabled && (
          <div className="p-3 rounded-xl border border-border bg-surface space-y-3 animate-in fade-in duration-200">
            {/* 3.1 当前默认思考强度选择 (提供默认选项) */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-fg">
                当前生效思考强度 (Default Effort Level)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {REASONING_EFFORT_OPTIONS.map((opt) => {
                  const isSelected = activeEffort === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChange({ reasoningEffort: opt.value })}
                      title={opt.desc}
                      className={`px-2.5 py-1.5 rounded-xl border text-left text-[11px] transition-all cursor-pointer ${
                        isSelected
                          ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 font-bold ring-1 ring-purple-500/30'
                          : 'border-border bg-surface-subtle text-fg-secondary hover:text-fg hover:border-gray-400'
                      }`}
                    >
                      <div className="truncate">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3.2 思考等级与 API Value 映射表 (完全还原图片 2 的界面形态) */}
            <div className="space-y-1.5 pt-1">
              <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-fg-muted px-1">
                <div className="col-span-5">Level (等级标识)</div>
                <div className="col-span-6">API value (传给大模型的值)</div>
                <div className="col-span-1 text-center">操作</div>
              </div>

              <div className="space-y-1.5">
                {reasoningLevels.map((item, idx) => {
                  const isOffLevel = item.level === 'off';

                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      {/* Level 下拉选择/自定义输入 */}
                      <div className="col-span-5">
                        <input
                          type="text"
                          value={item.level}
                          disabled={isOffLevel}
                          onChange={(e) => handleUpdateLevelName(idx, e.target.value)}
                          placeholder="等级标识"
                          className={`w-full rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none transition-all ${
                            isOffLevel
                              ? 'bg-surface-subtle text-fg-muted cursor-not-allowed border border-border/50'
                              : inputBg
                          }`}
                        />
                      </div>

                      {/* API Value 输入 */}
                      <div className="col-span-6">
                        <input
                          type="text"
                          value={isOffLevel ? '' : item.apiValue}
                          disabled={isOffLevel}
                          onChange={(e) => handleUpdateLevelApiValue(idx, e.target.value)}
                          placeholder={isOffLevel ? 'Turns reasoning off' : '如 low, medium, high'}
                          className={`w-full rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none transition-all ${
                            isOffLevel
                              ? 'bg-surface-subtle text-fg-muted/60 italic cursor-not-allowed border border-border/50'
                              : inputBg
                          }`}
                        />
                      </div>

                      {/* 删除操作图标 */}
                      <div className="col-span-1 flex justify-center">
                        <button
                          type="button"
                          disabled={isOffLevel}
                          onClick={() => handleDeleteLevel(idx)}
                          className={`p-1 rounded text-fg-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors ${
                            isOffLevel ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                          title={isOffLevel ? '基础关闭等级不可删除' : '删除此等级'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* + Add level 按钮 (对标图片 2) */}
              <button
                type="button"
                onClick={handleAddLevel}
                className="mt-2 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-purple-400 hover:text-purple-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer bg-surface-subtle"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add level (新增等级)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 维度 4: Micro Summarizer Agent (微型智能总结 Agent 双模架构) */}
      <div className="pt-2 border-t border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className={`text-[11px] font-semibold ${labelColor}`}>
              Micro Summarizer Agent (微型总结 Agent)
            </span>
            <div className="relative group cursor-help">
              <HelpCircle className="w-3 h-3 text-fg-muted" />
              <div className="absolute left-0 bottom-full mb-1.5 hidden group-hover:block w-72 p-2 bg-popover text-popover-fg text-[10px] rounded-lg shadow-lg border border-border z-20">
                历史超限时，由微型 Agent 自动提炼高质量因果架构记忆；若离线或异常自动无缝降级为规则提取保底。
              </div>
            </div>
          </div>

          {/* iOS 风格平滑切换 Toggle 开关 */}
          <button
            type="button"
            role="switch"
            aria-checked={isMicroAgentEnabled}
            onClick={() => handleToggleMicroAgent(!isMicroAgentEnabled)}
            className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
              isMicroAgentEnabled ? 'bg-amber-500 dark:bg-amber-400' : 'bg-gray-300 dark:bg-gray-700'
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                isMicroAgentEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="text-[10px] text-fg-muted flex items-start gap-1.5 bg-surface-subtle p-2 rounded-lg border border-border/50">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
          <span>
            {isMicroAgentEnabled ? (
              <>
                <strong className="text-fg font-medium">智能语义归纳已开启：</strong>
                历史超限时，由微型 Agent 自动提炼高质量因果架构记忆；若离线或异常自动无缝降级为规则提取保底。
              </>
            ) : (
              <>
                <strong className="text-fg font-medium">仅本地规则提取：</strong>
                跳过微型 Agent 调用，纯本地 0ms 提取 Memory 关键词与决策要点，提供零开销硬数学兜底。
              </>
            )}
          </span>
        </div>
      </div>

      {/* 换算指南提示 */}
      <div className="text-[10px] text-fg-muted flex items-center gap-1 pt-0.5">
        <Calculator className="w-3 h-3 text-fg-muted shrink-0" />
        <span>
          智能换算：支持在输入框内直接输入 <strong>"1M"</strong>、<strong>"128K"</strong>、<strong>"384K"</strong>，系统将自动换算为 Tokens。
        </span>
      </div>
    </div>
  );
};

