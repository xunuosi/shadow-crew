import React, { useState, useEffect } from 'react';
import { Agent, LocalAcpRuntime } from '../types';
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
} from 'lucide-react';
import { AgentAvatarArtwork } from './AgentAvatarArtwork';
import { discoverLocalAcpRuntimes, FALLBACK_PRESET_RUNTIMES } from '../services/acpDiscovery';

interface ConnectAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectAgent: (newAgent: Partial<Agent>) => void;
}

interface EnvVarItem {
  id: string;
  key: string;
  value: string;
}

const PRESET_ICONS = [
  { id: 'shinobi', label: 'Shinobi Ninja', icon: '🥷', artworkType: 'shinobi' },
  { id: 'claudecode', label: 'Claude Code', icon: '🪷', artworkType: 'claudecode' },
  { id: 'palette', label: 'Artistry Palette', icon: '🎨', artworkType: 'palette' },
  { id: 'alien', label: 'DeepSeek Alien', icon: '🐞', artworkType: 'alien' },
  { id: 'astra', label: 'Astra Compass', icon: '🧭', artworkType: 'astra' },
  { id: 'openclaw', label: 'OpenClaw Mantis', icon: '🦗', artworkType: 'openclaw' },
];

export const ConnectAgentModal: React.FC<ConnectAgentModalProps> = ({
  isOpen,
  onClose,
  onConnectAgent,
}) => {
  if (!isOpen) return null;

  // Form Fields
  const [name, setName] = useState('Shinobi Native Agent');
  const [description, setDescription] = useState(
    'Local ultra-fast native agent runtime with private SQLite memory bank.'
  );
  const [selectedIconId, setSelectedIconId] = useState('shinobi');
  const [isPickingIcon, setIsPickingIcon] = useState(false);

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

    // Auto update Name and Description if using default
    const cleanName = option.name.split(' (')[0];
    setName(cleanName);
    setDescription(option.description);

    // Map icon if available
    if (option.id === 'claude_code') setSelectedIconId('claudecode');
    else if (option.id === 'openclaw') setSelectedIconId('openclaw');
    else if (option.id === 'shinobi_core') setSelectedIconId('shinobi');
    else setSelectedIconId('palette');

    // Auto populate recommended ENV vars
    if (option.recommended_env && option.recommended_env.length > 0) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !isReady) return;

    const chosenIcon = PRESET_ICONS.find((i) => i.id === selectedIconId);

    onConnectAgent({
      name: name.trim(),
      handle: `@${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
      avatar: chosenIcon?.icon || '🤖',
      role: selectedAcp.name,
      description: description.trim() || selectedAcp.description,
      localAcpProfile: selectedAcp.name,
      envVars: envVars
        .filter((v) => v.key.trim().length > 0)
        .map((v) => ({ key: v.key.trim(), value: v.value })),
      color: '#3b82f6',
      status: 'idle',
      modelBadge: selectedAcp.id === 'claude_code' 
        ? 'Claude 3.7 Sonnet' 
        : selectedAcp.id === 'kimi_code'
        ? 'Kimi 2.5'
        : 'Local ACP',
      isManagedByYou: true,
      acpTransport: selectedAcp.transport,
      acpCommandOrUrl: selectedAcp.command,
      protocolVersion: '2025-01-01 (ACP v1.0.4)',
      capabilities: {
        canUseInternalMemory: true,
        canAccessWorkspaceFiles: true,
        canExecuteSkills: true,
        canDelegateToSubAgents: true,
        supportsStreaming: true,
      },
      workspace: {
        rootPath: '/home/norris/workspace/shadow-crew',
        repoName: 'shadow-crew',
        gitBranch: 'main',
        permissionMode: 'full_read_write',
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
          <h2 className="font-bold text-lg tracking-tight">Create New Agent</h2>

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

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Top Section: Icon Placeholder (Left) & Name / Description (Right) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
            {/* Left: Icon Placeholder */}
            <div className="sm:col-span-5 flex flex-col items-center">
              <div
                onClick={() => setIsPickingIcon(!isPickingIcon)}
                className={`w-full h-40 rounded-2xl border flex flex-col items-center justify-center p-3 transition-all cursor-pointer group shadow-inner relative ${iconBoxBg}`}
                title="点击切换视觉插画"
              >
                <div className="group-hover:scale-105 transition-transform">
                  <AgentAvatarArtwork name={selectedIconId} className="w-24 h-24" />
                </div>
                <span className={`text-[11px] mt-2 font-medium transition-colors ${
                  isLightMode ? 'text-gray-500 group-hover:text-blue-600' : 'text-gray-400 group-hover:text-cyan-400'
                }`}>
                  Icon placeholder
                </span>
              </div>

              {/* Icon Picker Popover */}
              {isPickingIcon && (
                <div className={`mt-2 p-2 rounded-2xl border shadow-lg w-full grid grid-cols-3 gap-1.5 z-20 ${
                  isLightMode ? 'bg-white border-gray-200' : 'bg-[#151c2a] border-[#26354c]'
                }`}>
                  {PRESET_ICONS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setSelectedIconId(preset.id);
                        setIsPickingIcon(false);
                      }}
                      className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 text-[10px] cursor-pointer transition-all ${
                        selectedIconId === preset.id
                          ? 'border-blue-500 bg-blue-50/50 text-blue-600 font-bold'
                          : 'border-transparent hover:bg-gray-100 text-gray-500'
                      }`}
                    >
                      <span className="text-base">{preset.icon}</span>
                      <span className="truncate w-full text-center">{preset.label.split(' ')[0]}</span>
                    </button>
                  ))}
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

            {/* Dropdown Options Menu (Matching Buzz & Screenshot) */}
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

            {/* Setup Guidance Callout (for Not Adapted or Not Installed) */}
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
          </div>

          {/* Bottom Section: Environment Variables (ENV) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-xs font-semibold ${labelColor}`}>
                Environment Variables (ENV)
              </label>
            </div>

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
                  {/* Key Input */}
                  <div className="col-span-5">
                    <input
                      type="text"
                      placeholder="KEY_NAME"
                      value={item.key}
                      onChange={(e) => handleUpdateVariable(item.id, 'key', e.target.value)}
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                    />
                  </div>

                  {/* Value Input */}
                  <div className="col-span-6">
                    <input
                      type="text"
                      placeholder="value"
                      value={item.value}
                      onChange={(e) => handleUpdateVariable(item.id, 'value', e.target.value)}
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none transition-all ${inputBg}`}
                    />
                  </div>

                  {/* Delete Button */}
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

          {/* Modal Footer Actions */}
          <div
            className={`pt-4 border-t flex items-center justify-between gap-3 ${
              isLightMode ? 'border-gray-100' : 'border-[#1b2536]'
            }`}
          >
            <div>
              {!isReady && (
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
                disabled={!name.trim() || !isReady}
                className={`px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md ${
                  name.trim() && isReady
                    ? isLightMode
                      ? 'bg-[#2563eb] hover:bg-[#1d4ed8] cursor-pointer'
                      : 'bg-cyan-600 hover:bg-cyan-500 cursor-pointer'
                    : 'bg-gray-300 dark:bg-zinc-800 text-gray-500 dark:text-zinc-500 cursor-not-allowed shadow-none'
                }`}
              >
                {selectedAcp.availability === 'not_adapted'
                  ? 'Adapter Required'
                  : selectedAcp.availability === 'not_installed'
                  ? 'Not Installed'
                  : 'Create Agent'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
