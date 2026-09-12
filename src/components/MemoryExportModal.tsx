import React, { useState } from 'react';
import { Agent } from '../types';
import { X, Download, ShieldCheck, FolderCheck, Check, Sparkles } from 'lucide-react';
import { createMemoryBundle, downloadMemoryBundleFile } from '../services/memoryBundle';

interface MemoryExportModalProps {
  isOpen: boolean;
  agent: Agent;
  onClose: () => void;
}

export const MemoryExportModal: React.FC<MemoryExportModalProps> = ({
  isOpen,
  agent,
  onClose,
}) => {
  if (!isOpen) return null;

  const persistentItems = agent.memory?.persistentItems || [];

  // Form State
  const [description, setDescription] = useState(
    `沉淀自 ${agent.name} (${agent.modelBadge || 'ACP'}) 的核心架构模式与避坑知识卡带`
  );
  const [tagsInput, setTagsInput] = useState('rust, tokio, axum, acp');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    'codebase_pattern',
    'incident_history',
    'user_preference',
    'skill_rule',
  ]);
  const [sanitizeSecrets, setSanitizeSecrets] = useState(true);
  const [normalizePaths, setNormalizePaths] = useState(true);
  const [isExported, setIsExported] = useState(false);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const previewCount = persistentItems.filter((i) =>
    selectedCategories.includes(i.category)
  ).length;

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const bundle = createMemoryBundle(agent, {
      includeCategories: selectedCategories,
      sanitizeSecrets,
      normalizePaths,
      tags,
      description,
    });

    downloadMemoryBundleFile(bundle);
    setIsExported(true);
    setTimeout(() => {
      setIsExported(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-3xl shadow-2xl border border-border bg-surface text-fg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm tracking-tight">
                导出 ACP 记忆卡带 (.acpmem)
              </h2>
              <p className="text-[11px] text-fg-muted">
                源 Agent: <span className="text-accent font-semibold">{agent.name}</span>
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

        {/* Content Form */}
        <form onSubmit={handleExport} className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Card Description */}
          <div>
            <label className="block text-xs font-semibold mb-1 text-fg">
              卡带描述 (Description)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-xs bg-surface border border-border text-fg placeholder-fg-muted focus:outline-none focus:border-accent transition-all resize-none"
              placeholder="说明此记忆卡带包含的领域知识与经验..."
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold mb-1 text-fg">
              知识标签 (Tags，英文逗号分隔)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded-xl px-3 py-1.5 text-xs bg-surface border border-border text-fg font-mono placeholder-fg-muted focus:outline-none focus:border-accent transition-all"
              placeholder="rust, tokio, axum"
            />
          </div>

          {/* Category Filters */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-fg">
                导出记忆范畴
              </label>
              <span className="text-[10px] font-mono text-emerald-500">
                将包含 {previewCount} / {persistentItems.length} 条记忆
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'codebase_pattern', label: '工程架构规约' },
                { id: 'incident_history', label: '踩坑避坑经验' },
                { id: 'user_preference', label: '个人编码偏好' },
                { id: 'skill_rule', label: '技能执行约束' },
              ].map((cat) => {
                const checked = selectedCategories.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`p-2 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                      checked
                        ? 'bg-accent/10 border-accent text-fg font-medium'
                        : 'bg-surface-subtle border-border text-fg-muted hover:border-border-hover'
                    }`}
                  >
                    <span className="text-[11px]">{cat.label}</span>
                    <div
                      className={`w-4 h-4 rounded-md flex items-center justify-center border text-[10px] ${
                        checked
                          ? 'bg-accent border-accent text-accent-fg'
                          : 'border-border bg-surface'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sanitization & Privacy Gateway */}
          <div className="p-3 rounded-2xl bg-surface-subtle border border-border space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>脱敏与隐私保护网关 (Sanitization Gateway)</span>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer text-[11px] text-fg-secondary">
              <input
                type="checkbox"
                checked={sanitizeSecrets}
                onChange={(e) => setSanitizeSecrets(e.target.checked)}
                className="rounded text-accent focus:ring-accent"
              />
              <span className="leading-tight">
                <strong>凭据强制脱敏</strong>：自动过滤屏蔽 <code>sk-ant-*</code>, <code>sk-*</code>, <code>ghp_*</code> 及内部敏感 Token
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-[11px] text-fg-secondary">
              <input
                type="checkbox"
                checked={normalizePaths}
                onChange={(e) => setNormalizePaths(e.target.checked)}
                className="rounded text-accent focus:ring-accent"
              />
              <span className="leading-tight">
                <strong>绝对路径归一化</strong>：将本地私有路径替换为通用的 <code>${'{'}WORKSPACE_ROOT{'}'}</code> 占位符
              </span>
            </label>
          </div>

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
              disabled={previewCount === 0 || isExported}
              className={`px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all flex items-center gap-2 shadow-md ${
                previewCount > 0 && !isExported
                  ? 'bg-emerald-600 hover:bg-emerald-500 cursor-pointer'
                  : 'bg-zinc-600 text-zinc-400 cursor-not-allowed shadow-none'
              }`}
            >
              {isExported ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>已生成并导出!</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>生成 .acpmem 卡带 ({previewCount}条)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
