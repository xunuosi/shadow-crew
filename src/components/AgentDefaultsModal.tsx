import React, { useState } from 'react';
import { X, Settings, Check, Database, Shield, Sliders, Palette } from 'lucide-react';
import { ThemeSwitcher } from './ThemeSwitcher';

interface AgentDefaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentDefaultsModal: React.FC<AgentDefaultsModalProps> = ({ isOpen, onClose }) => {
  const [defaultModel, setDefaultModel] = useState('Claude 3.7 Sonnet');
  const [memoryPath, setMemoryPath] = useState('~/.local/share/shinobi/memory.sqlite');
  const [defaultTimeout, setDefaultTimeout] = useState('60');
  const [sandboxMode, setSandboxMode] = useState('diff_only');
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-surface border border-border flex items-center justify-center text-accent">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-fg tracking-tight">Agent 全局默认配置 (Agent Defaults)</h2>
              <p className="text-[11px] text-fg-secondary">配置新接入 Agent 的默认通信参数、记忆存储与主题风格</p>
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
        <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Visual Theme Settings Integration */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg">
              <Palette className="w-3.5 h-3.5 text-accent" />
              <span>全站主题视觉与强调色 (Theme System)</span>
            </div>
            <ThemeSwitcher variant="full" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-fg mb-1.5">默认底座推理模型</label>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full bg-surface border border-border focus:border-accent focus:ring-1 focus:ring-accent/30 rounded-xl px-3 py-2 text-xs text-fg focus:outline-none transition-all cursor-pointer"
            >
              <option value="Claude 3.7 Sonnet">Claude 3.7 Sonnet (推荐代码架构)</option>
              <option value="DeepSeek R1">DeepSeek R1 (数学推演与逻辑论证)</option>
              <option value="DeepSeek V3">DeepSeek V3 (通用全栈推理)</option>
              <option value="GPT-4o">GPT-4o (多模态理解与执行)</option>
              <option value="Shinobi-Engine 2.0">Shinobi-Engine 2.0 (本地私密引擎)</option>
            </select>
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
