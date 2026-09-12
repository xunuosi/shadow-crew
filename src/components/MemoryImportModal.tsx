import React, { useState, useRef } from 'react';
import { Agent, AcpMemoryBundle, MemoryCartridge } from '../types';
import {
  X,
  Upload,
  Layers,
  UserCheck,
  ShieldCheck,
  Check,
  AlertCircle,
  FileCode,
  Sparkles,
} from 'lucide-react';
import {
  parseAndValidateMemoryBundle,
  createCartridgeFromBundle,
  createGuestAgentFromBundle,
} from '../services/memoryBundle';

interface MemoryImportModalProps {
  isOpen: boolean;
  agents: Agent[];
  defaultAgentId?: string;
  defaultWorkspaceRoot?: string;
  onClose: () => void;
  onMountCartridge: (targetAgentId: string, cartridge: MemoryCartridge) => void;
  onCloneGuestAgent: (newAgent: Partial<Agent>) => void;
}

export const MemoryImportModal: React.FC<MemoryImportModalProps> = ({
  isOpen,
  agents,
  defaultAgentId,
  defaultWorkspaceRoot,
  onClose,
  onMountCartridge,
  onCloneGuestAgent,
}) => {
  if (!isOpen) return null;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [bundle, setBundle] = useState<AcpMemoryBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasRedacted, setHasRedacted] = useState(false);
  const [importMode, setImportMode] = useState<'cartridge' | 'guest_clone'>('cartridge');

  // Track A State
  const [targetAgentId, setTargetAgentId] = useState<string>(
    defaultAgentId || agents[0]?.id || ''
  );

  // Track B State
  const [guestName, setGuestName] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseAndValidateMemoryBundle(content);
      if (result.success && result.bundle) {
        setBundle(result.bundle);
        setParseError(null);
        setHasRedacted(Boolean(result.hasRedactedSecrets));
        setGuestName(`${result.bundle.manifest.source_agent.name} (Guest)`);
      } else {
        setBundle(null);
        setParseError(result.error || '解析记忆卡带失败');
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bundle) return;

    if (importMode === 'cartridge') {
      const cartridge = createCartridgeFromBundle(bundle);
      onMountCartridge(targetAgentId, cartridge);
    } else {
      const newGuestAgent = createGuestAgentFromBundle(
        bundle,
        guestName,
        defaultWorkspaceRoot
      );
      onCloneGuestAgent(newGuestAgent);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-3xl shadow-2xl border border-border bg-surface text-fg overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm tracking-tight">
                导入外部 ACP 记忆能力文件 (.acpmem)
              </h2>
              <p className="text-[11px] text-fg-muted">
                零污染只读外挂卡带 · 独立沙盒访客克隆双轨支持
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleImportSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* File Picker or Preview */}
          {!bundle ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".acpmem,.json"
                onChange={handleFileChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border-dashed hover:border-accent rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-surface-subtle/60 hover:bg-surface transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-surface border border-border group-hover:border-accent flex items-center justify-center text-fg-muted group-hover:text-accent group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-center">
                  <div className="font-bold text-xs text-fg">
                    点击选择或拖拽 <code>.acpmem</code> 记忆卡带文件
                  </div>
                  <div className="text-[11px] text-fg-muted mt-0.5">
                    标准 ACP 格式，支持团队成员导出的架构规约与避坑经验
                  </div>
                </div>
              </div>
              {parseError && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-surface-subtle border border-border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-4 h-4 text-accent shrink-0" />
                  <span className="font-bold text-xs text-fg truncate">
                    {bundle.manifest.source_agent.name} 的记忆卡带
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-accent/15 text-accent border border-accent/30">
                    v{bundle.manifest.format_version}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBundle(null);
                    setParseError(null);
                  }}
                  className="text-[10px] text-fg-muted hover:text-accent cursor-pointer"
                >
                  重新选择
                </button>
              </div>

              <p className="text-[11px] text-fg-secondary leading-relaxed">
                {bundle.metadata.description}
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] font-mono text-fg-muted">
                <span>包含原子记忆: <strong className="text-emerald-500">{bundle.metadata.total_records}</strong> 条</span>
                <span>•</span>
                <span>标签: {bundle.metadata.tags.map((t) => `#${t}`).join(' ')}</span>
              </div>

              {hasRedacted && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-[10px] flex items-center gap-1.5 mt-1">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>已自动屏蔽文件中包含的疑似敏感 API 密钥与私有路径</span>
                </div>
              )}
            </div>
          )}

          {/* Mode Selection */}
          {bundle && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-fg">
                请选择您的使用模式：
              </label>

              {/* Mode A: Memory Cartridge */}
              <div
                onClick={() => setImportMode('cartridge')}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  importMode === 'cartridge'
                    ? 'bg-accent/10 border-accent text-fg shadow-xs ring-1 ring-accent/30'
                    : 'bg-surface-subtle border-border text-fg-secondary hover:border-border-hover'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>【模式 A】外挂到现有 Agent</span>
                        <span className="text-[9px] font-medium px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          推荐·零污染只读挂载
                        </span>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        本地私有 SQLite 数据库 <strong>0 写入</strong>，随时在抽屉中开关与一键弹出卸载。
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-1 ${
                      importMode === 'cartridge'
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border'
                    }`}
                  >
                    {importMode === 'cartridge' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>

                {importMode === 'cartridge' && (
                  <div className="mt-3 pl-9">
                    <label className="block text-[11px] font-medium text-fg-secondary mb-1">
                      挂载目标 Agent:
                    </label>
                    <select
                      value={targetAgentId}
                      onChange={(e) => setTargetAgentId(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
                    >
                      {agents
                        .filter((a) => !a.isGuestClone)
                        .map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.name} ({ag.role || ag.modelBadge || 'Local'})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Mode B: Guest Clone */}
              <div
                onClick={() => setImportMode('guest_clone')}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  importMode === 'guest_clone'
                    ? 'bg-purple-500/10 border-purple-500 text-fg shadow-xs ring-1 ring-purple-500/30'
                    : 'bg-surface-subtle border-border text-fg-secondary hover:border-border-hover'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-500 shrink-0">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>【模式 B】克隆为独立「访客替身 Agent」</span>
                        <span className="text-[9px] font-medium px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                          沙盒隔离·同屏推演
                        </span>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        在 Agents 列表生成带 🪪 访客徽章的独立卡片，支持在研讨室与您本人的 Agent 并列质询。
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-1 ${
                      importMode === 'guest_clone'
                        ? 'border-purple-500 bg-purple-500 text-white'
                        : 'border-border'
                    }`}
                  >
                    {importMode === 'guest_clone' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>

                {importMode === 'guest_clone' && (
                  <div className="mt-3 pl-9">
                    <label className="block text-[11px] font-medium text-fg-secondary mb-1">
                      访客 Agent 显示名称:
                    </label>
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-purple-500"
                      placeholder="e.g. Alice (Rust 架构访客)"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-surface-subtle hover:bg-surface-hover text-fg-secondary transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!bundle || (importMode === 'guest_clone' && !guestName.trim())}
              className={`px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all flex items-center gap-2 shadow-md ${
                bundle && (importMode !== 'guest_clone' || guestName.trim())
                  ? importMode === 'cartridge'
                    ? 'bg-accent hover:opacity-90 cursor-pointer'
                    : 'bg-purple-600 hover:bg-purple-500 cursor-pointer'
                  : 'bg-zinc-600 text-zinc-400 cursor-not-allowed shadow-none'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {importMode === 'cartridge'
                  ? '完成零污染挂载 (Mount Cartridge)'
                  : '生成访客替身 Agent (Spawn Guest)'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
