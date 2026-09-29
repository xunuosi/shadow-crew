import React, { useState, useEffect, useRef } from 'react';
import { Agent, LocalAcpRuntime, AcpTransport, AgentModelConfig } from '../types';
import {
  X,
  ChevronDown,
  Plus,
  Trash2,
  Check,
  Sparkles,
  Sun,
  Moon,
  AlertTriangle,
  Info,
  ExternalLink,
  RefreshCw,
  Globe,
  Wifi,
  Radio,
  Layers,
  ShieldCheck,
  Cpu,
  Key,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { AgentAvatarArtwork } from './AgentAvatarArtwork';
import { discoverLocalAcpRuntimes, FALLBACK_PRESET_RUNTIMES } from '../services/acpDiscovery';
import { probeRemoteAcpConnection } from '../services/acpClient';
import { DEFAULT_MODEL_NAME } from '../config/models';
import {
  PROVIDER_PRESETS,
  getGlobalModelConfig,
  testModelConnection,
  getActiveProviderPreset,
  ModelProbeResult,
} from '../services/llmService';
import { ModelSelectorCombobox } from './ModelSelectorCombobox';

interface ConnectAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectAgent: (newAgent: Partial<Agent>) => void;
  defaultWorkspaceRoot?: string;
  initialAgent?: Agent | null;
  onUpdateAgent?: (agentId: string, updatedData: Partial<Agent>) => void;
  onOpenImportModal?: () => void;
}

interface EnvVarItem {
  id: string;
  key: string;
  value: string;
}

const PRESET_ICONS = [
  { id: 'shinobi', label: 'Shinobi', subtitle: '隐者核心 (默认)', icon: '🥷', artworkType: 'shinobi' },
  { id: 'codex', label: 'Codex', subtitle: '赛博机体', icon: '🤖', artworkType: 'codex' },
  { id: 'claudecode', label: 'Claude', subtitle: '星火认知', icon: '✨', artworkType: 'claudecode' },
  { id: 'deepseek', label: 'DeepSeek', subtitle: '深海蓝鲸', icon: '🐳', artworkType: 'deepseek' },
  { id: 'openclaw', label: 'OpenClaw', subtitle: '猎手战甲', icon: '🦗', artworkType: 'openclaw' },
  { id: 'bolt', label: 'Bolt', subtitle: '极速先锋', icon: '⚡', artworkType: 'bolt' },
  { id: 'sentinel', label: 'Sentinel', subtitle: '安全守卫', icon: '🛡️', artworkType: 'sentinel' },
  { id: 'astra', label: 'Astra', subtitle: '恒星航标', icon: '🧭', artworkType: 'astra' },
  { id: 'palette', label: 'Artisan', subtitle: '创想棱镜', icon: '🎨', artworkType: 'palette' },
];

export const ConnectAgentModal: React.FC<ConnectAgentModalProps> = ({
  isOpen,
  onClose,
  onConnectAgent,
  defaultWorkspaceRoot,
  initialAgent,
  onUpdateAgent,
  onOpenImportModal,
}) => {
  if (!isOpen) return null;

  // Connection Tab: 'local' | 'remote' | 'clone'
  const [connectTab, setConnectTab] = useState<'local' | 'remote' | 'clone'>('local');

  // Form Fields
  const [name, setName] = useState('Shinobi Native Agent');
  const [description, setDescription] = useState(
    'Local ultra-fast native agent runtime with private SQLite memory bank.'
  );
  const [selectedIconId, setSelectedIconId] = useState('shinobi');
  const [customEmoji, setCustomEmoji] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [isPickingIcon, setIsPickingIcon] = useState(false);

  // Remote ACP Connection State
  const [remoteUrl, setRemoteUrl] = useState('ws://127.0.0.1:9000');
  const [authToken, setAuthToken] = useState('');
  const [readOnlyGuard, setReadOnlyGuard] = useState(true);
  const [isTestingRemote, setIsTestingRemote] = useState(false);
  const [remoteTestResult, setRemoteTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);

  // Local ACP Runtimes & Discovery
  const [runtimes, setRuntimes] = useState<LocalAcpRuntime[]>(FALLBACK_PRESET_RUNTIMES);
  const [isLoadingRuntimes, setIsLoadingRuntimes] = useState(false);
  const [selectedAcpId, setSelectedAcpId] = useState<string>('shinobi_core');
  const [isAcpDropdownOpen, setIsAcpDropdownOpen] = useState(false);

  // Dynamic Environment Variables (ENV)
  const [envVars, setEnvVars] = useState<EnvVarItem[]>([
    { id: '1', key: 'SHINOBI_LOG', value: 'debug' },
    { id: '2', key: 'MEMORY_STORE', value: 'sqlite' },
  ]);

  // Visual Theme support
  const [isLightMode, setIsLightMode] = useState(true);

  // Model & Inference Engine Configuration
  const [useGlobalDefaultModel, setUseGlobalDefaultModel] = useState(true);
  const [modelConfig, setModelConfig] = useState<AgentModelConfig>(() => getGlobalModelConfig());
  const [showModelApiKey, setShowModelApiKey] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [modelProbeResult, setModelProbeResult] = useState<ModelProbeResult | null>(null);

  // Saving & Re-verification State
  const [isSavingAndVerifying, setIsSavingAndVerifying] = useState(false);

  const prevIsOpenRef = useRef(false);
  const prevAgentIdRef = useRef<string | null>(null);

  // Initialize or reset form based on initialAgent (only on modal open or agent switch)
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    const agentChanged = isOpen && (initialAgent?.id || null) !== prevAgentIdRef.current;

    if (justOpened || agentChanged) {
      const globalCfg = getGlobalModelConfig();
      if (initialAgent) {
        setName(initialAgent.name || '');
        setDescription(initialAgent.description || initialAgent.role || '');
        setCustomCommand(initialAgent.acpCommandOrUrl || '');

        if (initialAgent.modelConfig) {
          setUseGlobalDefaultModel(initialAgent.modelConfig.useGlobalDefault ?? false);
          const effectiveCfg = {
            ...globalCfg,
            ...initialAgent.modelConfig,
          };
          setModelConfig(effectiveCfg);
        } else {
          // Check if envVars has a specific API key or Base URL
          const hasCustomKey = initialAgent.envVars?.some(
            (v) => (v.key.endsWith('_API_KEY') || v.key.endsWith('_BASE_URL')) && v.value.trim().length > 0
          );
          if (hasCustomKey) {
            setUseGlobalDefaultModel(false);
            const foundKey = initialAgent.envVars?.find((v) => v.key.endsWith('_API_KEY'))?.value || '';
            const foundBaseUrl = initialAgent.envVars?.find((v) => v.key.endsWith('_BASE_URL'))?.value;
            const foundModel = initialAgent.envVars?.find((v) => v.key.endsWith('_MODEL'))?.value;
            const effectiveCfg = {
              ...globalCfg,
              apiKey: foundKey || globalCfg.apiKey,
              baseUrl: foundBaseUrl || globalCfg.baseUrl,
              modelId: foundModel || globalCfg.modelId,
              modelName: foundModel || initialAgent.modelBadge || globalCfg.modelName,
              useGlobalDefault: false,
            };
            setModelConfig(effectiveCfg);
          } else {
            setUseGlobalDefaultModel(true);
            setModelConfig({ ...globalCfg, useGlobalDefault: true });
          }
        }
        setModelProbeResult(null);

        if (initialAgent.isRemote || initialAgent.acpTransport === 'websocket') {
          setConnectTab('remote');
          setRemoteUrl(initialAgent.remoteUrl || initialAgent.acpCommandOrUrl || 'ws://127.0.0.1:9000');
          setAuthToken(initialAgent.authToken || '');
          setReadOnlyGuard(initialAgent.readOnlyGuard ?? true);
        } else {
          setConnectTab('local');
        }

        // Map icon from avatar FIRST!
        const matchedByAvatar = PRESET_ICONS.find(
          (p) => p.icon === initialAgent.avatar || p.id === initialAgent.avatar
        );
        if (matchedByAvatar) {
          setSelectedIconId(matchedByAvatar.id);
          setCustomEmoji('');
        } else if (initialAgent.avatar && initialAgent.avatar.trim()) {
          setSelectedIconId('custom');
          setCustomEmoji(initialAgent.avatar.trim());
        } else {
          const lowerName = (initialAgent.name || '').toLowerCase();
          if (lowerName.includes('shinobi') || lowerName.includes('ninja')) {
            setSelectedIconId('shinobi');
          } else if (lowerName.includes('claude')) {
            setSelectedIconId('claudecode');
          } else if (lowerName.includes('codex') || lowerName.includes('openai')) {
            setSelectedIconId('codex');
          } else if (lowerName.includes('openclaw') || lowerName.includes('mantis')) {
            setSelectedIconId('openclaw');
          } else if (lowerName.includes('deepseek') || lowerName.includes('whale') || lowerName.includes('alien')) {
            setSelectedIconId('deepseek');
          } else if (lowerName.includes('bolt') || lowerName.includes('turbo')) {
            setSelectedIconId('bolt');
          } else if (lowerName.includes('sentinel') || lowerName.includes('shield')) {
            setSelectedIconId('sentinel');
          } else if (lowerName.includes('astra')) {
            setSelectedIconId('astra');
          } else {
            setSelectedIconId('shinobi');
          }
          setCustomEmoji('');
        }

        // Map envVars
        if (initialAgent.envVars && initialAgent.envVars.length > 0) {
          setEnvVars(
            initialAgent.envVars.map((v, idx) => ({
              id: `env-${idx}-${Date.now()}`,
              key: v.key,
              value: v.value,
            }))
          );
        } else {
          setEnvVars([]);
        }

        // Map ACP runtime
        const matched = runtimes.find(
          (r) =>
            r.name.toLowerCase() === initialAgent.localAcpProfile?.toLowerCase() ||
            r.command === initialAgent.acpCommandOrUrl
        );
        if (matched) {
          setSelectedAcpId(matched.id);
        }
      } else {
        setName('Shinobi Native Agent');
        setDescription('Local ultra-fast native agent runtime with private SQLite memory bank.');
        setSelectedIconId('shinobi');
        setCustomEmoji('');
        setSelectedAcpId('shinobi_core');
        setCustomCommand('./target/debug/shinobi-agent');
        setConnectTab('local');
        setRemoteUrl('ws://127.0.0.1:9000');
        setAuthToken('');
        setReadOnlyGuard(true);
        setRemoteTestResult(null);
        setUseGlobalDefaultModel(true);
        setModelConfig({ ...globalCfg, useGlobalDefault: true });
        setModelProbeResult(null);
        setEnvVars([
          { id: '1', key: 'SHINOBI_LOG', value: 'debug' },
          { id: '2', key: 'MEMORY_STORE', value: 'sqlite' },
        ]);
      }
    }

    prevIsOpenRef.current = isOpen;
    prevAgentIdRef.current = initialAgent?.id || null;
  }, [initialAgent, isOpen]);

  const handleTestRemote = async () => {
    const trimmedUrl = remoteUrl.trim();
    if (!trimmedUrl) return;

    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
      setRemoteTestResult({
        ok: false,
        latencyMs: 0,
        error: '此处为远程 ACP 进程的 WebSocket 连接协议 (需以 ws:// 或 wss:// 开头)。若这是大模型推理网关（如公司 AI 网关），请在下方「大模型推理端点配置」中填入并测试。',
      });
      return;
    }

    setIsTestingRemote(true);
    setRemoteTestResult(null);
    try {
      const res = await probeRemoteAcpConnection(trimmedUrl, authToken.trim() || undefined);
      setRemoteTestResult(res);
    } catch (e: any) {
      setRemoteTestResult({
        ok: false,
        latencyMs: 0,
        error: e?.message || '探测失败',
      });
    } finally {
      setIsTestingRemote(false);
    }
  };

  // Fetch / probe local ACP agents
  const fetchRuntimes = async () => {
    setIsLoadingRuntimes(true);
    try {
      const list = await discoverLocalAcpRuntimes();
      setRuntimes(list);
      // Ensure selectedAcpId is valid
      const current = list.find((r) => r.id === selectedAcpId);
      if (!current) {
        const firstAvailable = list.find((r) => r.availability === 'available') || list[0];
        if (firstAvailable) {
          setSelectedAcpId(firstAvailable.id);
          if (!customCommand) setCustomCommand(firstAvailable.command);
        }
      }
    } catch (e) {
      console.error('Error discovering ACP runtimes:', e);
    } finally {
      setIsLoadingRuntimes(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRuntimes();
    }
  }, [isOpen]);

  const selectedAcp =
    runtimes.find((o) => o.id === selectedAcpId) || runtimes[0] || FALLBACK_PRESET_RUNTIMES[0];

  const handleSelectRuntime = (option: LocalAcpRuntime) => {
    setSelectedAcpId(option.id);
    setIsAcpDropdownOpen(false);

    // Auto update Name and Description if creating new
    if (!initialAgent) {
      const cleanName = option.name.split(' (')[0];
      setName(cleanName);
      setDescription(option.description);

      // Map icon if available
      if (option.id === 'claude_code') setSelectedIconId('claudecode');
      else if (option.id === 'openclaw') setSelectedIconId('openclaw');
      else if (option.id === 'codex') setSelectedIconId('codex');
      else if (option.id === 'shinobi_core') setSelectedIconId('shinobi');
      else setSelectedIconId('palette');
    }

    setCustomCommand(option.command);

    // Auto populate recommended ENV vars if empty or creating
    if (option.recommended_env && option.recommended_env.length > 0 && (!initialAgent || envVars.length === 0)) {
      setEnvVars(
        option.recommended_env.map(([key, value], idx) => ({
          id: `env-${Date.now()}-${idx}`,
          key,
          value,
        }))
      );
    }
  };

  const handleAddVariable = () => {
    const newId = `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setEnvVars((prev) => [...prev, { id: newId, key: '', value: '' }]);
  };

  const handleRemoveVariable = (id: string) => {
    setEnvVars((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateVariable = (id: string, field: 'key' | 'value', val: string) => {
    setEnvVars((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  const isReady = selectedAcp.availability === 'available';
  const isRemoteMode = connectTab === 'remote';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSavingAndVerifying) return;
    if (!initialAgent && !isRemoteMode && !isReady) return;
    if (isRemoteMode && !remoteUrl.trim()) return;

    setIsSavingAndVerifying(true);

    const chosenIcon = PRESET_ICONS.find((i) => i.id === selectedIconId);
    const effectiveAvatar =
      customEmoji.trim() ||
      chosenIcon?.icon ||
      (isRemoteMode ? '🌐' : initialAgent?.avatar || '🥷');

    const resolvedCommand = isRemoteMode
      ? remoteUrl.trim()
      : customCommand.trim() || selectedAcp.command;

    const transport: AcpTransport = isRemoteMode ? 'websocket' : selectedAcp.transport;

    const globalCfg = getGlobalModelConfig();
    const effectiveModelBadge = useGlobalDefaultModel
      ? (globalCfg.modelName || 'DeepSeek V3')
      : (modelConfig.modelName || modelConfig.modelId || 'DeepSeek V3');

    const finalModelConfig: AgentModelConfig = useGlobalDefaultModel
      ? { ...globalCfg, useGlobalDefault: true }
      : { ...modelConfig, useGlobalDefault: false };

    // 保存前重新验证最新的模型状态
    let probeResult: ModelProbeResult | null = null;
    if (finalModelConfig.baseUrl && (finalModelConfig.apiKey || finalModelConfig.provider === 'ollama')) {
      try {
        probeResult = await testModelConnection(finalModelConfig);
      } catch (err: any) {
        probeResult = { ok: false, latencyMs: 0, error: err.message || '模型验证失败' };
      }
    }

    if (probeResult) {
      finalModelConfig.lastTestedAt = Date.now();
      finalModelConfig.isHealthy = probeResult.ok;
      finalModelConfig.lastLatencyMs = probeResult.ok ? probeResult.latencyMs : undefined;
      finalModelConfig.lastError = probeResult.ok ? undefined : probeResult.error;
    }

    // 合并并自动注入模型环境变量，确保 stdio 子进程与平台内部均能拿到对应配置
    const mergedEnvVars = [...envVars.filter((v) => v.key.trim().length > 0)];
    const injectEnv = (key: string, val?: string) => {
      if (!val) return;
      const existing = mergedEnvVars.find((e) => e.key === key);
      if (existing) {
        existing.value = val;
      } else {
        mergedEnvVars.push({ id: `env-auto-${key}-${Date.now()}`, key, value: val });
      }
    };

    if (finalModelConfig.apiKey) {
      if (finalModelConfig.provider === 'deepseek') {
        injectEnv('DEEPSEEK_API_KEY', finalModelConfig.apiKey);
        injectEnv('OPENAI_API_KEY', finalModelConfig.apiKey);
      } else if (finalModelConfig.provider === 'anthropic') {
        injectEnv('ANTHROPIC_API_KEY', finalModelConfig.apiKey);
      } else if (finalModelConfig.provider === 'openai_compatible' || finalModelConfig.provider === 'custom') {
        injectEnv('OPENAI_API_KEY', finalModelConfig.apiKey);
      }
    }
    if (finalModelConfig.baseUrl) {
      injectEnv('OPENAI_BASE_URL', finalModelConfig.baseUrl);
      injectEnv('ANTHROPIC_BASE_URL', finalModelConfig.baseUrl);
    }
    injectEnv('SHINOBI_MODEL', finalModelConfig.modelId);
    injectEnv('LLM_MODEL', finalModelConfig.modelId);

    if (initialAgent && onUpdateAgent) {
      onUpdateAgent(initialAgent.id, {
        name: name.trim(),
        handle: initialAgent.handle || `@${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
        avatar: effectiveAvatar,
        role: isRemoteMode ? 'Remote ACP Agent' : selectedAcp.name,
        description: description.trim() || (isRemoteMode ? 'Remote WebSocket ACP Endpoint' : selectedAcp.description),
        localAcpProfile: isRemoteMode ? 'Remote WebSocket' : selectedAcp.name,
        isRemote: isRemoteMode,
        remoteUrl: isRemoteMode ? remoteUrl.trim() : undefined,
        authToken: isRemoteMode ? authToken.trim() || undefined : undefined,
        readOnlyGuard: isRemoteMode ? readOnlyGuard : undefined,
        envVars: mergedEnvVars.map((v) => ({ key: v.key.trim(), value: v.value })),
        acpTransport: transport,
        acpCommandOrUrl: resolvedCommand,
        modelBadge: (probeResult?.ok && probeResult.modelName) || effectiveModelBadge,
        modelConfig: finalModelConfig,
        modelLatencyMs: probeResult?.ok ? probeResult.latencyMs : undefined,
        isModelHealthy: probeResult ? probeResult.ok : undefined,
        statusDetail: probeResult
          ? probeResult.ok
            ? `底座模型就绪 (${probeResult.latencyMs}ms · ${probeResult.modelName || effectiveModelBadge})`
            : `模型连通异常: ${probeResult.error || '连通失败'}`
          : initialAgent.statusDetail,
      });
    } else {
      onConnectAgent({
        name: name.trim(),
        handle: `@${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
        avatar: effectiveAvatar,
        role: isRemoteMode ? 'Remote ACP Agent' : selectedAcp.name,
        description: description.trim() || (isRemoteMode ? 'Remote WebSocket ACP Endpoint' : selectedAcp.description),
        localAcpProfile: isRemoteMode ? 'Remote WebSocket' : selectedAcp.name,
        isRemote: isRemoteMode,
        remoteUrl: isRemoteMode ? remoteUrl.trim() : undefined,
        authToken: isRemoteMode ? authToken.trim() || undefined : undefined,
        readOnlyGuard: isRemoteMode ? readOnlyGuard : undefined,
        envVars: mergedEnvVars.map((v) => ({ key: v.key.trim(), value: v.value })),
        color: isRemoteMode ? '#06b6d4' : '#3b82f6',
        status: 'idle',
        modelBadge: (probeResult?.ok && probeResult.modelName) || effectiveModelBadge,
        modelConfig: finalModelConfig,
        modelLatencyMs: probeResult?.ok ? probeResult.latencyMs : undefined,
        isModelHealthy: probeResult ? probeResult.ok : undefined,
        statusDetail: probeResult
          ? probeResult.ok
            ? `底座模型就绪 (${probeResult.latencyMs}ms · ${probeResult.modelName || effectiveModelBadge})`
            : `模型连通异常: ${probeResult.error || '连通失败'}`
          : undefined,
        isManagedByYou: true,
        acpTransport: transport,
        acpCommandOrUrl: resolvedCommand,
        protocolVersion: '2025-01-01 (ACP v1.0.4)',
        capabilities: {
          canUseInternalMemory: true,
          canAccessWorkspaceFiles: !isRemoteMode || !readOnlyGuard,
          canExecuteSkills: true,
          canDelegateToSubAgents: true,
          supportsStreaming: true,
        },
        workspace: {
          rootPath: defaultWorkspaceRoot || '.',
          repoName: 'shadow-crew',
          gitBranch: 'main',
          permissionMode: isRemoteMode && readOnlyGuard ? 'read_only' : 'full_read_write',
          activeFiles: ['src/App.tsx'],
        },
        skills: [],
        memory: {
          internalMemoryPath: `~/.local/share/shinobi/${name
            .toLowerCase()
            .replace(/\s+/g, '_')}_memory.sqlite`,
          persistentType: 'sqlite',
          persistentItems: [],
          sessionCacheCount: 0,
        },
        isJoinedCurrentRoom: true,
      });
    }

    setIsSavingAndVerifying(false);
    onClose();
  };

  const renderAvailabilityBadge = (status: LocalAcpRuntime['availability']) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Ready</span>
          </span>
        );
      case 'not_adapted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Not Adapted</span>
          </span>
        );
      case 'not_installed':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
            <span>Not Installed</span>
          </span>
        );
    }
  };

  // Color classes according to isLightMode
  const modalBg = isLightMode ? 'bg-white text-gray-900 border-gray-200' : 'bg-[#0f141f] text-gray-100 border-[#222e42]';
  const labelColor = isLightMode ? 'text-gray-800' : 'text-gray-200';
  const inputBg = isLightMode
    ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200'
    : 'bg-[#151c2b] border-[#27354d] text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30';
  const iconBoxBg = isLightMode ? 'bg-[#f8fafc] border-gray-200/80' : 'bg-[#141b27] border-[#222e42]';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div
        className={`w-full max-w-xl rounded-3xl shadow-2xl border overflow-hidden flex flex-col max-h-[92vh] ${modalBg}`}
      >
        {/* Modal Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${isLightMode ? 'border-gray-100' : 'border-[#1b2536]'}`}>
          <h2 className="font-bold text-lg tracking-tight">
            {initialAgent ? `Edit Agent: ${initialAgent.name}` : 'Create New Agent'}
          </h2>

          <div className="flex items-center gap-2">
            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={() => setIsLightMode(!isLightMode)}
              className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                isLightMode ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-[#1b2536]'
              }`}
              title={isLightMode ? '切换暗黑主题' : '切换亮色设计图主题'}
            >
              {isLightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                isLightMode ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-400 hover:text-white hover:bg-[#1a2333]'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Connection Mode Tabs (Local vs Remote vs Clone) */}
        {!initialAgent && (
          <div className={`px-6 pt-3 flex border-b gap-5 text-xs font-semibold ${isLightMode ? 'border-gray-100 bg-gray-50/70' : 'border-[#1b2536] bg-[#121824]'}`}>
            <button
              type="button"
              onClick={() => {
                setConnectTab('local');
                setName('Shinobi Native Agent');
                setDescription('Local ultra-fast native agent runtime with private SQLite memory bank.');
              }}
              className={`pb-2.5 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
                connectTab === 'local'
                  ? 'border-blue-600 text-blue-600 dark:border-cyan-400 dark:text-cyan-400 font-bold'
                  : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
            >
              <span>💻 本地预设 (Local)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setConnectTab('remote');
                setName('Remote Claude / Shinobi');
                setDescription('Remote ACP process connected via WebSocket / Relay Hub.');
              }}
              className={`pb-2.5 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
                connectTab === 'remote'
                  ? 'border-blue-600 text-blue-600 dark:border-cyan-400 dark:text-cyan-400 font-bold'
                  : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-cyan-500" />
              <span>🌐 远程连接 (Remote WebSocket)</span>
            </button>

            {onOpenImportModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenImportModal();
                }}
                className={`pb-2.5 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer border-transparent text-purple-600 dark:text-purple-400 hover:opacity-80`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>📥 从记忆包克隆 (.acpmem)</span>
              </button>
            )}
          </div>
        )}

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto overflow-x-hidden space-y-5 text-xs">
          {/* Top Section: Icon Placeholder (Left) & Name / Description (Right) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
            {/* Left: Avatar Artwork Preview & Selector */}
            <div className="sm:col-span-5 flex flex-col items-center">
              <div
                onClick={() => setIsPickingIcon(!isPickingIcon)}
                className={`w-full min-h-[160px] rounded-2xl border flex flex-col items-center justify-center p-3.5 transition-all cursor-pointer group shadow-inner relative ${iconBoxBg}`}
                title="点击选择头像预设或自定义表情"
              >
                <div className="group-hover:scale-105 transition-transform relative">
                  <AgentAvatarArtwork
                    type={selectedIconId}
                    avatar={customEmoji.trim() || PRESET_ICONS.find((i) => i.id === selectedIconId)?.icon || '🥷'}
                    className="w-24 h-24"
                  />
                  <div className="absolute -bottom-1 -right-1 p-1 bg-blue-600 dark:bg-cyan-500 text-white rounded-full shadow-md group-hover:scale-110 transition-transform">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5 text-center w-full px-2">
                  <div className={`text-[12px] font-semibold truncate transition-colors ${
                    isLightMode ? 'text-gray-800 group-hover:text-blue-600' : 'text-gray-200 group-hover:text-cyan-400'
                  }`}>
                    {customEmoji.trim()
                      ? `自定义表情: ${customEmoji.trim()}`
                      : (() => {
                          const p = PRESET_ICONS.find((i) => i.id === selectedIconId);
                          return p ? `${p.icon} ${p.label} · ${p.subtitle}` : '🥷 Shinobi · 隐者核心';
                        })()}
                  </div>
                  <span className={`text-[10px] font-normal transition-colors block mt-0.5 ${
                    isLightMode ? 'text-gray-400 group-hover:text-gray-600' : 'text-gray-500 group-hover:text-gray-400'
                  }`}>
                    {isPickingIcon ? '▲ 点击收起头像面板' : '▼ 点击更换头像预设'}
                  </span>
                </div>
              </div>

              {/* Icon Picker Popover */}
              {isPickingIcon && (
                <div className={`mt-2.5 p-3 rounded-2xl border shadow-xl w-full z-20 space-y-2.5 ${
                  isLightMode ? 'bg-white border-gray-200' : 'bg-[#151c2a] border-[#26354c]'
                }`}>
                  <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-gray-800 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                    <span>预设视觉头像</span>
                    <span className="text-[10px] text-gray-400 font-normal">所见即所得</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_ICONS.map((preset) => {
                      const isSelected = selectedIconId === preset.id && !customEmoji.trim();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setSelectedIconId(preset.id);
                            setCustomEmoji('');
                            setIsPickingIcon(false);
                          }}
                          className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 cursor-pointer transition-all group relative ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 shadow-sm ring-1 ring-blue-500'
                              : isLightMode
                              ? 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                              : 'border-[#1e293b] hover:border-[#334155] hover:bg-[#1a2333]'
                          }`}
                        >
                          <div className="relative">
                            <AgentAvatarArtwork
                              type={preset.artworkType}
                              avatar={preset.icon}
                              className="w-10 h-10 shrink-0 transition-transform group-hover:scale-105"
                            />
                            <span className="absolute -bottom-1 -right-1 text-[9px] bg-black/60 rounded-full px-0.5 leading-none select-none">
                              {preset.icon}
                            </span>
                          </div>
                          <div className="w-full text-center">
                            <div className={`text-[11px] truncate font-medium ${
                              isSelected ? 'text-blue-600 dark:text-cyan-400 font-bold' : isLightMode ? 'text-gray-700' : 'text-gray-300'
                            }`}>
                              {preset.label}
                            </div>
                            <div className="text-[9px] text-gray-400 truncate">
                              {preset.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Emoji Input */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-gray-400 shrink-0">自定义:</span>
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="输入任意表情 (如 ⚡, 🦊, 🚀)"
                        value={customEmoji}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setCustomEmoji(val);
                          if (val) {
                            setSelectedIconId('custom');
                          }
                        }}
                        className={`w-full rounded-lg px-2.5 py-1 text-xs focus:outline-none transition-all ${
                          isLightMode ? 'bg-gray-100 border border-gray-200 text-gray-800' : 'bg-[#0f172a] border border-[#1e293b] text-gray-200'
                        }`}
                      />
                      {customEmoji && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomEmoji('');
                            setSelectedIconId('shinobi');
                          }}
                          className="text-[10px] text-gray-400 hover:text-red-400 cursor-pointer shrink-0"
                        >
                          清除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Name & Description */}
            <div className="sm:col-span-7 space-y-3.5">
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${labelColor}`}>
                  Agent Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Shinobi Native Agent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all ${inputBg}`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${labelColor}`}>
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Agent responsibilities and domain focus..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all resize-none ${inputBg}`}
                />
              </div>
            </div>
          </div>

          {/* Section: LLM Model & Inference Engine Configuration (Model Portal) */}
          <div className={`p-4 rounded-2xl border space-y-3.5 ${
            isLightMode ? 'bg-blue-50/40 border-blue-200' : 'bg-blue-950/20 border-blue-900/40'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center ${
                  isLightMode ? 'bg-blue-100 text-blue-600' : 'bg-blue-900/40 text-blue-400'
                }`}>
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-xs text-fg flex items-center gap-2">
                    <span>底座推理大模型 (Inference Model)</span>
                    <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                      {useGlobalDefaultModel ? `${getGlobalModelConfig().modelName || 'DeepSeek V3'} (继承)` : (modelConfig.modelName || modelConfig.modelId)}
                    </span>
                  </div>
                  <div className="text-[10px] text-fg-muted">为该 Agent 指定驱动推理的大语言模型与 API 密钥</div>
                </div>
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-fg-secondary">
                <input
                  type="checkbox"
                  checked={useGlobalDefaultModel}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseGlobalDefaultModel(checked);
                    if (checked) {
                      setModelConfig({ ...getGlobalModelConfig(), useGlobalDefault: true });
                    } else {
                      const globalCfg = getGlobalModelConfig();
                      setModelConfig((prev) => ({
                        ...prev,
                        apiKey: prev.apiKey || globalCfg.apiKey,
                        baseUrl: prev.baseUrl || globalCfg.baseUrl,
                        useGlobalDefault: false,
                      }));
                    }
                  }}
                  className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span>继承全局默认</span>
              </label>
            </div>

            {useGlobalDefaultModel ? (
              <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                isLightMode ? 'bg-white/80 border-blue-100 text-blue-900' : 'bg-[#151c2b] border-[#223048] text-blue-200'
              }`}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <span className="font-semibold text-fg">
                      已启用全局模型：{getGlobalModelConfig().modelName || 'DeepSeek V3'}
                    </span>
                    <div className="text-[10px] text-fg-muted mt-0.5">
                      端点: <code className="font-mono">{getGlobalModelConfig().baseUrl}</code> · 自动复用全局密钥，无需重复配置
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25 shrink-0">
                  Global Default
                </span>
              </div>
            ) : (
              <div className="space-y-3 pt-1 border-t border-border/50 animate-in fade-in duration-150">
                {/* Provider select */}
                <div>
                  <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
                    模型服务厂商 (Provider)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {PROVIDER_PRESETS.map((p) => {
                      const currentPreset = getActiveProviderPreset(modelConfig);
                      const isSelected = p.id === currentPreset.id;

                      const label =
                        p.id === 'deepseek'
                          ? '🐳 DeepSeek'
                          : p.id === 'zhipu'
                          ? '🧠 智谱 GLM'
                          : p.id === 'anthropic'
                          ? '✨ Claude'
                          : p.id === 'openai'
                          ? '🤖 OpenAI'
                          : p.id === 'ollama'
                          ? '🦙 Ollama'
                          : p.id === 'siliconflow'
                          ? '⚡ 硅基流动'
                          : '⚙️ 自定义 (Custom)';

                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            const firstModel = p.models[0];
                            const globalCfg = getGlobalModelConfig();
                            const targetKey = modelConfig.apiKey || globalCfg.apiKey;
                            setModelConfig((prev) => ({
                              ...prev,
                              provider: p.provider,
                              baseUrl: p.defaultBaseUrl,
                              modelId: firstModel?.id || 'deepseek-chat',
                              modelName: firstModel?.name || 'DeepSeek V3',
                              apiKey: targetKey,
                            }));
                            setModelProbeResult(null);
                          }}
                          className={`px-2 py-1.5 rounded-xl border text-left text-[11px] transition-all cursor-pointer truncate ${
                            isSelected
                              ? 'border-blue-500 bg-surface font-semibold text-blue-600 dark:text-blue-400 shadow-2xs ring-1 ring-blue-500/20'
                              : 'border-border bg-surface/50 hover:bg-surface text-fg-secondary hover:text-fg'
                          }`}
                        >
                          <div className="truncate font-medium">{label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Unified Model Selector Combobox (Direct Input + Dropdown Sync + Quick Chips) */}
                <ModelSelectorCombobox
                  modelConfig={modelConfig}
                  onChangeModel={(modelId, modelName) => {
                    setModelConfig((prev) => ({
                      ...prev,
                      modelId,
                      modelName: modelName || modelId,
                    }));
                    setModelProbeResult(null);
                  }}
                  isLightMode={isLightMode}
                  onProbeResultClear={() => setModelProbeResult(null)}
                />

                {/* API Key */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`text-[11px] font-semibold flex items-center gap-1 ${labelColor}`}>
                      <Key className="w-3 h-3 text-blue-500" />
                      <span>API Key (密钥)</span>
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type={showModelApiKey ? 'text' : 'password'}
                      value={modelConfig.apiKey || ''}
                      onChange={(e) =>
                        setModelConfig((prev) => ({
                          ...prev,
                          apiKey: e.target.value,
                        }))
                      }
                      placeholder="sk-..."
                      className={`w-full rounded-xl pl-3 pr-9 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowModelApiKey(!showModelApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg p-0.5 cursor-pointer"
                    >
                      {showModelApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
                    API Base URL
                  </label>
                  <input
                    type="text"
                    value={modelConfig.baseUrl || ''}
                    onChange={(e) =>
                      setModelConfig((prev) => ({
                        ...prev,
                        baseUrl: e.target.value,
                      }))
                    }
                    className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                  />
                </div>

                {/* Test button & result */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={async () => {
                        setIsTestingModel(true);
                        setModelProbeResult(null);
                        try {
                          const res = await testModelConnection(modelConfig);
                          setModelProbeResult(res);
                        } catch (err: any) {
                          setModelProbeResult({ ok: false, latencyMs: 0, error: err.message || '测试失败' });
                        } finally {
                          setIsTestingModel(false);
                        }
                      }}
                      disabled={isTestingModel}
                      className={`shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50 ${
                        isLightMode
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      <Wifi className={`w-3.5 h-3.5 ${isTestingModel ? 'animate-pulse' : ''}`} />
                      <span>{isTestingModel ? '正在握手测试...' : '测试模型连通性'}</span>
                    </button>

                    {modelProbeResult && modelProbeResult.ok && (
                      <div className="text-[11px] px-2.5 py-1 rounded-xl border flex items-center gap-1.5 bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="font-medium">
                          连通成功 ({modelProbeResult.latencyMs}ms · {modelProbeResult.modelName || 'Ready'})
                        </span>
                      </div>
                    )}
                  </div>

                  {modelProbeResult && !modelProbeResult.ok && (
                    <div className="text-[11px] p-2.5 rounded-xl border bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 leading-relaxed break-all">
                      <div className="font-semibold flex items-center gap-1.5 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        <span>连通测试未通过</span>
                      </div>
                      <div className="font-mono text-[10px] opacity-90 break-all">{modelProbeResult.error}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Middle Section: Remote ACP or Local ACP */}
          {connectTab === 'remote' ? (
            <div className={`p-4 rounded-2xl border space-y-3.5 ${
              isLightMode ? 'bg-cyan-50/50 border-cyan-200' : 'bg-cyan-950/20 border-cyan-800/40'
            }`}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300">
                  <Globe className="w-4 h-4 text-cyan-500" />
                  <span>远程 ACP 端点连接与权限护栏</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25">
                  WebSocket Direct / Relay Hub
                </span>
              </div>

              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
                  WebSocket 目标地址 (ws:// 或 wss://)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="ws://192.168.1.55:9000 或 wss://hub.shadowcrew.ai/..."
                    className={`flex-1 rounded-xl px-3.5 py-2 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                  />
                  <button
                    type="button"
                    onClick={handleTestRemote}
                    disabled={isTestingRemote || !remoteUrl.trim()}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                      isLightMode
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    }`}
                  >
                    <Wifi className={`w-3.5 h-3.5 ${isTestingRemote ? 'animate-pulse' : ''}`} />
                    <span>{isTestingRemote ? '探测中...' : '测试连通性'}</span>
                  </button>
                </div>
                {remoteUrl.trim().match(/^https?:\/\//i) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] leading-relaxed flex items-start gap-2">
                    <span className="shrink-0 font-bold">⚠️ 地址协议提示:</span>
                    <span>
                      您当前输入的是 HTTP 网页/接口地址。如果您配置的是公司 AI 大模型接口（如 <code>{remoteUrl.trim()}</code>），应在上方<strong>「大模型推理端点配置」</strong>中配置并测试；此处仅接收 <code>ws://</code> 或 <code>wss://</code> 的远程 ACP WebSocket 服务。
                    </span>
                  </div>
                )}
                {remoteTestResult && (
                  <div className={`mt-2 p-2.5 rounded-xl border text-[11px] flex items-center gap-2 ${
                    remoteTestResult.ok
                      ? 'bg-emerald-50/90 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-300'
                      : 'bg-red-50/90 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-800/40 dark:text-red-300'
                  }`}>
                    {remoteTestResult.ok ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>连通握手成功！往返延迟: <strong>{remoteTestResult.latencyMs}ms</strong></span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span>连接失败: {remoteTestResult.error}</span>
                      </>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-fg-muted mt-1">
                  支持同事内网 Tailscale 直连，或通过团队中心 Relay Hub 邀请码连接。
                </p>
              </div>

              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
                  访问授权令牌 (Auth Token - 可选)
                </label>
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="由对方生成的临时访问密钥 (Bearer token)"
                  className={`w-full rounded-xl px-3.5 py-2 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={readOnlyGuard}
                    onChange={(e) => setReadOnlyGuard(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="leading-tight text-fg-secondary">
                    <strong>只读安全护栏 (Read-Only Guard)</strong>：默认开启，禁止远程 Agent 在本地写盘，仅作为架构推演参谋
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* Middle Section: Local ACP Dropdown with Status Probing */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block text-xs font-semibold ${labelColor}`}>
                    Local ACP Agent
                  </label>
                  <button
                    type="button"
                    onClick={fetchRuntimes}
                    disabled={isLoadingRuntimes}
                    className={`px-2 py-0.5 rounded-lg text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                      isLightMode
                        ? 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'
                        : 'text-gray-400 hover:text-cyan-400 hover:bg-[#1a2333]'
                    }`}
                    title="重新探测本地 PATH 与 ACP 状态"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingRuntimes ? 'animate-spin' : ''}`} />
                    <span className="text-[10px]">{isLoadingRuntimes ? 'Probing...' : 'Rescan'}</span>
                  </button>
                </div>

                {/* Dropdown Trigger Box */}
                <button
                  type="button"
                  onClick={() => setIsAcpDropdownOpen(!isAcpDropdownOpen)}
                  className={`w-full rounded-xl px-3.5 py-2.5 text-xs flex items-center justify-between transition-all cursor-pointer text-left ${
                    isAcpDropdownOpen
                      ? isLightMode
                        ? 'border-2 border-blue-500 ring-2 ring-blue-100 bg-white'
                        : 'border-2 border-cyan-500 ring-2 ring-cyan-500/20 bg-[#151c2b]'
                      : inputBg
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className="font-semibold text-xs text-inherit truncate">{selectedAcp.name}</span>
                    {renderAvailabilityBadge(selectedAcp.availability)}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isAcpDropdownOpen ? 'rotate-180 text-blue-500' : 'text-gray-400'
                    }`}
                  />
                </button>

                {/* Dropdown Options Menu */}
                {isAcpDropdownOpen && (
                  <div
                    className={`absolute left-0 right-0 top-full mt-1.5 rounded-2xl border shadow-xl py-1.5 z-30 max-h-60 overflow-y-auto ${
                      isLightMode ? 'bg-white border-gray-200 divide-y divide-gray-100' : 'bg-[#131b28] border-[#26354c] divide-y divide-[#1e2a3c]'
                    }`}
                  >
                    {runtimes.map((option) => {
                      const isSelected = selectedAcpId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleSelectRuntime(option)}
                          className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? isLightMode
                                ? 'bg-blue-50/80 text-blue-900'
                                : 'bg-cyan-950/60 text-cyan-200'
                              : isLightMode
                              ? 'hover:bg-gray-50 text-gray-800'
                              : 'hover:bg-[#1a2436] text-gray-200'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-xs truncate">{option.name}</div>
                            <div className={`text-[11px] mt-0.5 font-mono truncate ${isLightMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              {option.command}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {renderAvailabilityBadge(option.availability)}
                            {isSelected && (
                              <Check className={`w-4 h-4 shrink-0 ${isLightMode ? 'text-blue-600' : 'text-cyan-400'}`} />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Setup Guidance Callout */}
                {selectedAcp.availability === 'not_adapted' && (
                  <div
                    className={`mt-2.5 p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-150 ${
                      isLightMode
                        ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                        : 'bg-amber-950/30 border-amber-800/40 text-amber-200'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs">缺少 ACP 协议适配器 (Not Adapted)</span>
                        {selectedAcp.install_url && (
                          <a
                            href={selectedAcp.install_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-medium underline flex items-center gap-1 hover:opacity-80 shrink-0"
                          >
                            <span>适配指南</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-90">{selectedAcp.install_hint}</p>
                    </div>
                  </div>
                )}

                {selectedAcp.availability === 'not_installed' && (
                  <div
                    className={`mt-2.5 p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-150 ${
                      isLightMode
                        ? 'bg-zinc-50 border-zinc-200 text-zinc-800'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs">本地未检测到此 Agent (Not Installed)</span>
                        {selectedAcp.install_url && (
                          <a
                            href={selectedAcp.install_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-medium underline flex items-center gap-1 hover:opacity-80 shrink-0"
                          >
                            <span>安装指南</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-80">{selectedAcp.install_hint}</p>
                    </div>
                  </div>
                )}

                {/* Custom Command Input */}
                <div className="mt-3">
                  <label className={`block text-[11px] font-semibold mb-1 ${labelColor}`}>
                    CLI Command / Executable
                  </label>
                  <input
                    type="text"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    placeholder={selectedAcp.command}
                    className={`w-full rounded-xl px-3.5 py-2 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    实际拉起该 Agent 的命令行。支持自定义启动参数。
                  </p>
                </div>
              </div>

              {/* Bottom Section: Environment Variables (ENV) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={`text-xs font-semibold ${labelColor}`}>
                    Environment Variables (ENV)
                  </label>
                </div>

                {/* Claude Auth Notice */}
                {(selectedAcp.id === 'claude_code' || name.toLowerCase().includes('claude')) && (
                  <div className={`p-2.5 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2 ${
                    isLightMode 
                      ? 'bg-amber-50/80 border-amber-200 text-amber-900' 
                      : 'bg-amber-950/20 border-amber-800/40 text-amber-200/90'
                  }`}>
                    <span className="text-amber-500 font-bold shrink-0">⚠️ 认证提示:</span>
                    <span>
                      Anthropic 官方规定，第三方客户端 ACP 模式<strong>无法直接复用</strong>终端的网页版个人订阅 OAuth 凭证。必须在此环境变量中配置 <code>ANTHROPIC_API_KEY</code>（形如 <code>sk-ant-api03-...</code>），或配合 <code>ANTHROPIC_BASE_URL</code> 转发中转。
                    </span>
                  </div>
                )}

                {/* Codex Notice */}
                {(selectedAcp.id === 'codex' || name.toLowerCase().includes('codex')) && (
                  <div className={`p-2.5 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2 ${
                    isLightMode 
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900' 
                      : 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200/90'
                  }`}>
                    <span className="text-emerald-500 font-bold shrink-0">🤖 Codex 适配提示:</span>
                    <span>
                      系统已自动探测到本机 OpenAI Codex CLI 环境，并通过 <code>codex-acp</code> 桥接适配器实现完整 ACP stdio 通信。自动复用您在 <code>~/.codex/config.toml</code> 中的模型配置（如 deepseek-v4-flash / o3-mini）。
                    </span>
                  </div>
                )}

                {/* Key-Value Header */}
                <div className="grid grid-cols-12 gap-3 px-1 text-[11px] font-medium text-gray-400">
                  <div className="col-span-5">Key</div>
                  <div className="col-span-6">Value</div>
                  <div className="col-span-1 text-center"></div>
                </div>

                {/* Key-Value Dynamic Rows */}
                <div className="space-y-2 max-h-40 overflow-y-auto p-0.5">
                  {envVars.map((item) => (
                    <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <input
                          type="text"
                          placeholder="KEY_NAME"
                          value={item.key}
                          onChange={(e) => handleUpdateVariable(item.id, 'key', e.target.value)}
                          className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                        />
                      </div>
                      <div className="col-span-6">
                        <input
                          type="text"
                          placeholder={
                            item.key === 'ANTHROPIC_API_KEY'
                              ? 'sk-ant-api03-... (必填)'
                              : item.key === 'ANTHROPIC_BASE_URL'
                              ? 'https://api.anthropic.com'
                              : 'value'
                          }
                          value={item.value}
                          onChange={(e) => handleUpdateVariable(item.id, 'value', e.target.value)}
                          className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveVariable(item.id)}
                          className={`p-1 rounded-lg transition-colors cursor-pointer ${
                            isLightMode
                              ? 'text-gray-400 hover:text-red-500 hover:bg-gray-100'
                              : 'text-gray-500 hover:text-red-400 hover:bg-[#1a2333]'
                          }`}
                          title="删除此环境变量"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* + Add Variable Button */}
                <div>
                  <button
                    type="button"
                    onClick={handleAddVariable}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                      isLightMode
                        ? 'bg-white hover:bg-gray-50 border-gray-300 text-gray-700'
                        : 'bg-[#151c2b] hover:bg-[#1c263a] border-[#27354d] text-gray-300'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Variable</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Modal Footer Actions */}
          <div
            className={`pt-4 border-t flex items-center justify-between gap-3 ${
              isLightMode ? 'border-gray-100' : 'border-[#1b2536]'
            }`}
          >
            <div>
              {connectTab === 'local' && !isReady && !initialAgent && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  * 需完成本地安装/适配后方可创建
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  isLightMode
                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    : 'bg-[#151c2b] hover:bg-[#1e283c] text-gray-300'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSavingAndVerifying ||
                  !name.trim() ||
                  (connectTab === 'remote' ? !remoteUrl.trim() : !initialAgent && !isReady)
                }
                className={`px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md flex items-center gap-1.5 ${
                  !isSavingAndVerifying && name.trim() && (connectTab === 'remote' ? remoteUrl.trim() : initialAgent || isReady)
                    ? isLightMode
                      ? 'bg-[#2563eb] hover:bg-[#1d4ed8] cursor-pointer'
                      : 'bg-cyan-600 hover:bg-cyan-500 cursor-pointer'
                    : 'bg-gray-300 dark:bg-zinc-800 text-gray-500 dark:text-zinc-500 cursor-not-allowed shadow-none'
                }`}
              >
                {isSavingAndVerifying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在验证模型状态并保存...</span>
                  </>
                ) : initialAgent ? (
                  '保存修改 (Save Changes)'
                ) : connectTab === 'remote' ? (
                  '连接远程 Agent (Connect Remote)'
                ) : selectedAcp.availability === 'not_adapted' ? (
                  'Adapter Required'
                ) : selectedAcp.availability === 'not_installed' ? (
                  'Not Installed'
                ) : (
                  'Create Agent'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
