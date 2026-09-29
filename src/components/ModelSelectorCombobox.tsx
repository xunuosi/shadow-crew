import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, ChevronDown, Check, Sparkles, Globe, Layers, AlertCircle, X } from 'lucide-react';
import { AgentModelConfig } from '../types';
import {
  ProviderPreset,
  GatewayModelItem,
  fetchGatewayModels,
  getActiveProviderPreset,
} from '../services/llmService';

export interface ModelSelectorComboboxProps {
  modelConfig: AgentModelConfig;
  onChangeModel: (modelId: string, modelName?: string) => void;
  isLightMode?: boolean;
  onProbeResultClear?: () => void;
}

export const ModelSelectorCombobox: React.FC<ModelSelectorComboboxProps> = ({
  modelConfig,
  onChangeModel,
  isLightMode = true,
  onProbeResultClear,
}) => {
  const currentPreset = getActiveProviderPreset(modelConfig);

  const [isOpen, setIsOpen] = useState(false);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccessCount, setFetchSuccessCount] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch online models from endpoint
  const handleFetchModels = async () => {
    if (!modelConfig.baseUrl) {
      setFetchError('请先填写接口 Base URL');
      return;
    }
    setIsFetching(true);
    setFetchError(null);
    try {
      const res = await fetchGatewayModels({
        baseUrl: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
        provider: modelConfig.provider,
      });

      if (res.ok && res.models.length > 0) {
        setGatewayModels(res.models);
        setFetchSuccessCount(res.models.length);
        setIsOpen(true);

        // If current model is empty, default to the first fetched model
        if (!modelConfig.modelId.trim() && res.models[0]) {
          onChangeModel(res.models[0].id, res.models[0].name);
        }
      } else {
        setFetchError(res.error || '未拉取到可用模型');
      }
    } catch (err: any) {
      setFetchError(err.message || '网络连接失败');
    } finally {
      setIsFetching(false);
    }
  };

  const handleSelectModel = (id: string, name?: string) => {
    onChangeModel(id, name || id);
    onProbeResultClear?.();
    setIsOpen(false);
  };

  // Filter models based on user input
  const query = (modelConfig.modelId || '').trim().toLowerCase();

  const filteredGateway = gatewayModels.filter(
    (m) => m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query))
  );

  const filteredPresets = currentPreset.models.filter(
    (m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
  );

  // Quick chips display: use fetched models first (up to 6), or preset models
  const quickChips =
    gatewayModels.length > 0
      ? gatewayModels.slice(0, 6).map((m) => ({ id: m.id, name: m.name || m.id, desc: m.description }))
      : currentPreset.models.map((m) => ({ id: m.id, name: m.name || m.id, desc: m.description }));

  const inputBg = isLightMode
    ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200'
    : 'bg-[#151c2b] border-[#27354d] text-gray-100 placeholder-gray-500 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/30';

  const popoverBg = isLightMode
    ? 'bg-white border-gray-200 text-gray-900 shadow-xl'
    : 'bg-[#151c2a] border-[#26354c] text-gray-100 shadow-2xl';

  return (
    <div className="space-y-2 relative" ref={containerRef}>
      {/* Header with Title and Fetch Action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <label className="text-[11px] font-semibold text-fg flex items-center gap-1">
            <span>底座推理模型 (Model Identifier)</span>
          </label>
          {fetchSuccessCount !== null && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>已同步 {fetchSuccessCount} 个模型</span>
            </span>
          )}
        </div>

        {/* Sync/Fetch online models button */}
        <div className="flex items-center gap-2 shrink-0">
          {fetchError && (
            <span
              className="text-[10px] text-red-500 font-mono truncate max-w-[150px] flex items-center gap-1"
              title={fetchError}
            >
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{fetchError}</span>
            </span>
          )}

          <button
            type="button"
            onClick={handleFetchModels}
            disabled={isFetching || !modelConfig.baseUrl}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
              isLightMode
                ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 shadow-2xs'
                : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30 shadow-2xs'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title="调用服务端 GET /v1/models 接口，动态同步当前端点支持的全部模型"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
            <span>{isFetching ? '正在同步...' : '同步在线模型'}</span>
          </button>
        </div>
      </div>

      {/* Unified Input + Dropdown Toggle */}
      <div className="relative">
        <div
          className={`flex items-center rounded-xl border transition-all ${inputBg}`}
        >
          <input
            ref={inputRef}
            type="text"
            value={modelConfig.modelId}
            onChange={(e) => {
              onChangeModel(e.target.value, e.target.value);
              onProbeResultClear?.();
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="自由输入或点击右侧下拉选择 (如: deepseek-chat, gpt-4o, glm-4-flash)"
            className="flex-1 px-3 py-1.5 text-xs font-mono bg-transparent focus:outline-none min-w-0"
          />

          {modelConfig.modelId && (
            <button
              type="button"
              onClick={() => {
                onChangeModel('', '');
                onProbeResultClear?.();
                inputRef.current?.focus();
              }}
              className="p-1 text-fg-muted hover:text-fg transition-colors cursor-pointer mr-0.5"
              title="清空当前输入"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="px-2 py-1.5 text-fg-muted hover:text-fg transition-colors cursor-pointer border-l border-border/50"
            title={isOpen ? '收起模型建议' : '展开在线与推荐模型列表'}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Dropdown Popover */}
        {isOpen && (
          <div
            className={`absolute left-0 right-0 top-full mt-1.5 rounded-2xl border p-2 z-40 max-h-64 overflow-y-auto animate-in fade-in duration-100 ${popoverBg}`}
          >
            {/* 1. Live Models from Server (if fetched) */}
            {gatewayModels.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center justify-between border-b border-border/40 pb-1 mb-1">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    <span>服务端在线模型 ({filteredGateway.length})</span>
                  </span>
                  <span className="text-[9px] opacity-75">点击直接填入输入框</span>
                </div>
                {filteredGateway.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-fg-muted italic">无匹配的在线模型</div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredGateway.map((m) => {
                      const isSelected = m.id === modelConfig.modelId;
                      return (
                        <div
                          key={m.id}
                          onClick={() => handleSelectModel(m.id, m.name)}
                          className={`px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
                              : 'hover:bg-surface-hover text-fg'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-mono text-[11px] truncate flex items-center gap-1.5">
                              <span>{m.id}</span>
                              {isSelected && <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500 text-white font-sans">当前选中</span>}
                            </div>
                            {m.description && (
                              <div className="text-[10px] text-fg-muted truncate">{m.description}</div>
                            )}
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. Preset Recommendations */}
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold text-fg-muted flex items-center justify-between border-b border-border/40 pb-1 mb-1">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>厂商官方常用预设 ({filteredPresets.length})</span>
                </span>
                <span className="text-[9px] opacity-75">开箱推荐</span>
              </div>
              <div className="space-y-0.5">
                {filteredPresets.map((m) => {
                  const isSelected = m.id === modelConfig.modelId;
                  return (
                    <div
                      key={m.id}
                      onClick={() => handleSelectModel(m.id, m.name)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
                          : 'hover:bg-surface-hover text-fg'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-mono text-[11px] truncate flex items-center gap-1.5">
                          <span>{m.name || m.id}</span>
                          <span className="text-[9px] text-fg-muted opacity-80">({m.id})</span>
                          {isSelected && <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500 text-white font-sans">当前选中</span>}
                        </div>
                        {m.description && (
                          <div className="text-[10px] text-fg-muted truncate">{m.description}</div>
                        )}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Custom Input Item notice */}
            {modelConfig.modelId &&
              !gatewayModels.some((m) => m.id === modelConfig.modelId) &&
              !currentPreset.models.some((m) => m.id === modelConfig.modelId) && (
                <div className="mt-2 pt-2 border-t border-border/40 px-2 py-1 text-[11px] flex items-center justify-between text-blue-600 dark:text-blue-400">
                  <span className="truncate">
                    ✨ 自定义输入模型: <strong className="font-mono">{modelConfig.modelId}</strong>
                  </span>
                  <span className="text-[10px] text-fg-muted font-normal">已直接应用</span>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Quick Select Chips directly below the input */}
      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        <span className="text-[10px] font-medium text-fg-muted shrink-0">快捷切换:</span>
        {quickChips.map((chip) => {
          const isCurrent = modelConfig.modelId === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => handleSelectModel(chip.id, chip.name)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer border flex items-center gap-1 ${
                isCurrent
                  ? 'bg-blue-500/15 border-blue-500 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs ring-1 ring-blue-500/20'
                  : 'bg-surface/50 border-border/70 text-fg-secondary hover:text-fg hover:border-border'
              }`}
              title={chip.desc || chip.id}
            >
              <span>{chip.name || chip.id}</span>
              {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
