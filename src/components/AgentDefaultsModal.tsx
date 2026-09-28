import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Check,
  Database,
  Shield,
  Sliders,
  Palette,
  HardDrive,
  Cpu,
  Key,
  Globe,
  Wifi,
  Eye,
  EyeOff,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { ThemeSwitcher } from './ThemeSwitcher';
import {
  DEFAULT_MODEL_NAME,
  getAvailableModels,
  getPersistedDefaultModel,
  setPersistedDefaultModel,
} from '../config/models';
import {
  PROVIDER_PRESETS,
  getGlobalModelConfig,
  setGlobalModelConfig,
  testModelConnection,
  ModelProbeResult,
} from '../services/llmService';
import { AgentModelConfig, ModelProviderType } from '../types';

interface AgentDefaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenStorageSettings?: () => void;
}

export const AgentDefaultsModal: React.FC<AgentDefaultsModalProps> = ({
  isOpen,
  onClose,
  onOpenStorageSettings,
}) => {
  const [modelConfig, setModelConfigState] = useState<AgentModelConfig>(() => getGlobalModelConfig());
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [probeResult, setProbeResult] = useState<ModelProbeResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setModelConfigState(getGlobalModelConfig());
      setProbeResult(null);
    }
  }, [isOpen]);

  const [memoryPath, setMemoryPath] = useState('~/.local/share/shinobi/memory.sqlite');
  const [defaultTimeout, setDefaultTimeout] = useState('60');
  const [sandboxMode, setSandboxMode] = useState('diff_only');
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const currentPreset =
    PROVIDER_PRESETS.find((p) => p.id === modelConfig.provider) ||
    PROVIDER_PRESETS.find((p) => p.provider === modelConfig.provider) ||
    PROVIDER_PRESETS[0];

  const handleProviderChange = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const firstModel = preset.models[0];
    setModelConfigState((prev) => ({
      ...prev,
      provider: preset.provider,
      baseUrl: preset.defaultBaseUrl,
      modelId: firstModel?.id || 'deepseek-chat',
      modelName: firstModel?.name || 'DeepSeek V3',
    }));
    setProbeResult(null);
  };

  const handleModelChange = (modelId: string) => {
    const foundModel = currentPreset.models.find((m) => m.id === modelId);
    setModelConfigState((prev) => ({
      ...prev,
      modelId,
      modelName: foundModel?.name || modelId,
    }));
    setProbeResult(null);
  };

  const handleTestConnection = async () => {
    setIsTestingModel(true);
    setProbeResult(null);
    try {
      const res = await testModelConnection(modelConfig);
      setProbeResult(res);
    } catch (e: any) {
      setProbeResult({
        ok: false,
        latencyMs: 0,
        error: e.message || '测试失败',
      });
    } finally {
      setIsTestingModel(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setPersistedDefaultModel(modelConfig.modelName || modelConfig.modelId);
    setGlobalModelConfig(modelConfig);
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-surface border border-border flex items-center justify-center text-accent">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-fg tracking-tight">Agent 全局底座大模型与默认配置</h2>
              <p className="text-[11px] text-fg-secondary">
                统一配置 Shinobi 原生 Agent 与团队智能体的默认底座大模型、API Key 与通信参数
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Section A: Global LLM Model & API Key Configuration (Core Feature) */}
          <div className="p-4 rounded-2xl border border-accent/30 bg-accent/5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
                  <Cpu className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="font-bold text-xs text-fg">全局底座大模型 (Global Default LLM)</span>
                  <div className="text-[10px] text-fg-muted">
                    未独立设置模型的 Agent（包括 Shinobi 自身影替身）将默认使用此配置
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent font-semibold">
                {modelConfig.modelName || 'DeepSeek V3'}
              </span>
            </div>

            {/* Provider Tabs */}
            <div>
              <label className="block text-[11px] font-semibold text-fg mb-1.5">
                模型服务厂商 / 接口规范
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {PROVIDER_PRESETS.map((p) => {
                  const isSelected =
                    (p.id === 'deepseek' && modelConfig.provider === 'deepseek') ||
                    (p.id === 'anthropic' && modelConfig.provider === 'anthropic') ||
                    (p.id === 'ollama' && modelConfig.provider === 'ollama') ||
                    (p.id === 'siliconflow' && modelConfig.baseUrl?.includes('siliconflow')) ||
                    (p.id === 'openai' && modelConfig.provider === 'openai_compatible' && !modelConfig.baseUrl?.includes('siliconflow')) ||
                    (p.id === 'custom' && modelConfig.provider === 'custom');

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id)}
                      className={`px-2.5 py-1.5 rounded-xl border text-left text-[11px] transition-all cursor-pointer truncate ${
                        isSelected
                          ? 'border-accent bg-surface font-semibold text-accent shadow-2xs'
                          : 'border-border bg-surface/50 hover:bg-surface text-fg-secondary hover:text-fg'
                      }`}
                    >
                      <div className="truncate font-medium">{p.name.split(' ')[0]}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model Select */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-fg mb-1">
                  底座推理模型
                </label>
                <select
                  value={modelConfig.modelId}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-surface border border-border focus:border-accent rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none transition-all cursor-pointer"
                >
                  {currentPreset.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {currentPreset.id === 'custom' && (
                    <option value={modelConfig.modelId}>{modelConfig.modelId || '输入自定义模型 ID'}</option>
                  )}
                </select>
              </div>

              {/* Custom Model ID input if custom */}
              {currentPreset.id === 'custom' ? (
                <div>
                  <label className="block text-[11px] font-semibold text-fg mb-1">
                    自定义模型名称 (Model Identifier)
                  </label>
                  <input
                    type="text"
                    value={modelConfig.modelId}
                    onChange={(e) =>
                      setModelConfigState((prev) => ({
                        ...prev,
                        modelId: e.target.value,
                        modelName: e.target.value,
                      }))
                    }
                    placeholder="e.g. qwen-plus, deepseek-ai/DeepSeek-V3"
                    className="w-full bg-surface border border-border focus:border-accent rounded-xl px-3 py-1.5 font-mono text-[11px] text-fg focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold text-fg mb-1">
                    特性说明
                  </label>
                  <div className="text-[11px] text-fg-muted truncate py-1.5 px-2 bg-surface/60 rounded-xl border border-border/60">
                    {currentPreset.models.find((m) => m.id === modelConfig.modelId)?.description ||
                      '高性能推理模型'}
                  </div>
                </div>
              )}
            </div>

            {/* API Key Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-fg flex items-center gap-1">
                  <Key className="w-3 h-3 text-accent" />
                  <span>API Key (模型调用密钥)</span>
                </label>
                {currentPreset.apiKeyHelpUrl && (
                  <a
                    href={currentPreset.apiKeyHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                  >
                    <span>获取密钥</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={modelConfig.apiKey || ''}
                  onChange={(e) =>
                    setModelConfigState((prev) => ({
                      ...prev,
                      apiKey: e.target.value,
                    }))
                  }
                  placeholder={currentPreset.apiKeyPlaceholder}
                  className="w-full bg-surface border border-border focus:border-accent rounded-xl pl-3 pr-9 py-1.5 font-mono text-[11px] text-fg focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg p-0.5 cursor-pointer"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* API Base URL */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-fg flex items-center gap-1">
                  <Globe className="w-3 h-3 text-fg-muted" />
                  <span>API Base URL (接口端点)</span>
                </label>
                {modelConfig.baseUrl !== currentPreset.defaultBaseUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setModelConfigState((prev) => ({
                        ...prev,
                        baseUrl: currentPreset.defaultBaseUrl,
                      }))
                    }
                    className="text-[10px] text-accent hover:underline cursor-pointer"
                  >
                    重置为官方默认
                  </button>
                )}
              </div>
              <input
                type="text"
                value={modelConfig.baseUrl || ''}
                onChange={(e) =>
                  setModelConfigState((prev) => ({
                    ...prev,
                    baseUrl: e.target.value,
                  }))
                }
                placeholder={currentPreset.defaultBaseUrl}
                className="w-full bg-surface border border-border focus:border-accent rounded-xl px-3 py-1.5 font-mono text-[11px] text-fg focus:outline-none"
              />
            </div>

            {/* Test Connection Button & Result */}
            <div className="pt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingModel}
                className="px-3 py-1.5 rounded-xl bg-surface border border-border hover:border-accent hover:text-accent text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Wifi className={`w-3.5 h-3.5 ${isTestingModel ? 'animate-pulse text-accent' : ''}`} />
                <span>{isTestingModel ? '正在握手测试...' : '测试模型连通性'}</span>
              </button>

              {probeResult && (
                <div
                  className={`text-[11px] px-2.5 py-1 rounded-xl border flex items-center gap-1.5 ${
                    probeResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      probeResult.ok ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span>
                    {probeResult.ok
                      ? `连通成功 (${probeResult.latencyMs}ms · ${probeResult.modelName || 'Ready'})`
                      : `失败: ${probeResult.error}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Visual Theme Settings Integration */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg">
              <Palette className="w-3.5 h-3.5 text-accent" />
              <span>全站主题视觉与强调色 (Theme System)</span>
            </div>
            <ThemeSwitcher variant="full" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-fg mb-1.5">
              默认私有 SQLite 记忆库持久化路径
            </label>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500 shrink-0" />
              <input
                type="text"
                value={memoryPath}
                onChange={(e) => setMemoryPath(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 font-mono text-[11px] text-fg focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-fg mb-1.5">ACP 握手与执行超时 (秒)</label>
              <input
                type="number"
                value={defaultTimeout}
                onChange={(e) => setDefaultTimeout(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-fg mb-1.5">默认沙盒安全级别</label>
              <select
                value={sandboxMode}
                onChange={(e) => setSandboxMode(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="diff_only">严格差异补丁 (Diff Only)</option>
                <option value="full_read_write">完全读写 (Full Read/Write)</option>
                <option value="read_only">纯只读沙盒 (Read Only)</option>
              </select>
            </div>
          </div>

          {/* Storage Architecture & Cache Management Entry */}
          {onOpenStorageSettings && (
            <div className="p-3.5 rounded-2xl bg-surface-subtle border border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-surface border border-border flex items-center justify-center text-emerald-400 shrink-0 shadow-xs">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-fg text-xs">存储架构与缓存管理 (Storage & Cache)</div>
                  <div className="text-[10px] text-fg-muted">查看本地 SQLite 占用、管理会话历史并一键清空运行日志</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenStorageSettings();
                }}
                className="px-3 py-1.5 rounded-xl bg-surface border border-border hover:border-accent text-xs text-accent font-semibold transition-colors cursor-pointer shrink-0"
              >
                打开管理中心
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-hover transition-all cursor-pointer font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-semibold bg-accent hover:bg-accent-hover text-accent-text flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              {isSaved ? <Check className="w-4 h-4 stroke-[3]" /> : <Sliders className="w-4 h-4" />}
              <span>{isSaved ? '已保存默认配置' : '保存默认配置'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
