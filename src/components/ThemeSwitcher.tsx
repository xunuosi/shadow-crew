import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Laptop, Palette, Check } from 'lucide-react';
import { useTheme, ThemeMode, AccentColor } from '../context/ThemeContext';

interface ThemeSwitcherProps {
  variant?: 'compact' | 'full';
  className?: string;
}

const ACCENT_PRESETS: Array<{ id: AccentColor; label: string; colorHex: string }> = [
  { id: 'blue', label: 'Buzz Blue', colorHex: '#2563eb' },
  { id: 'cyan', label: 'Shinobi Cyan', colorHex: '#06b6d4' },
  { id: 'emerald', label: 'Emerald', colorHex: '#10b981' },
  { id: 'purple', label: 'Amethyst', colorHex: '#8b5cf6' },
];

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  variant = 'compact',
  className = '',
}) => {
  const { mode, resolvedMode, accent, setMode, setAccent, toggleMode } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (variant === 'compact') {
    return (
      <div className={`relative inline-block ${className}`} ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="px-2.5 py-1.5 rounded-xl border border-border hover:border-border-hover bg-surface hover:bg-surface-hover text-fg-secondary hover:text-fg text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
          title={`主题模式: ${mode} (${resolvedMode}) | 强调色: ${accent}`}
        >
          {resolvedMode === 'light' ? (
            <Sun className="w-3.5 h-3.5 text-amber-500" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-cyan-400" />
          )}
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ACCENT_PRESETS.find(a => a.id === accent)?.colorHex }} />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl border border-border bg-surface shadow-2xl p-3 z-50 text-xs text-fg animate-in fade-in zoom-in-95 duration-100">
            {/* Mode Switcher */}
            <div className="mb-3">
              <div className="text-[11px] font-semibold text-fg-muted mb-1.5">明暗底色模式</div>
              <div className="grid grid-cols-3 gap-1 bg-surface-subtle p-1 rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setMode('light')}
                  className={`py-1 rounded-lg flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                    mode === 'light'
                      ? 'bg-surface text-fg font-semibold shadow-xs border border-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  title="设计图纯白风格"
                >
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[10px]">纯白</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMode('dark')}
                  className={`py-1 rounded-lg flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                    mode === 'dark'
                      ? 'bg-surface text-fg font-semibold shadow-xs border border-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  title="影忍极客暗黑风格"
                >
                  <Moon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px]">暗黑</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMode('system')}
                  className={`py-1 rounded-lg flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                    mode === 'system'
                      ? 'bg-surface text-fg font-semibold shadow-xs border border-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  title="跟随系统调度"
                >
                  <Laptop className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[10px]">自动</span>
                </button>
              </div>
            </div>

            {/* Accent Colors */}
            <div>
              <div className="text-[11px] font-semibold text-fg-muted mb-1.5">强调品牌色</div>
              <div className="grid grid-cols-4 gap-1.5">
                {ACCENT_PRESETS.map((preset) => {
                  const isSelected = accent === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setAccent(preset.id)}
                      className={`h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer relative ${
                        isSelected
                          ? 'border-border-hover ring-2 ring-accent/30 shadow-xs'
                          : 'border-border hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.colorHex }}
                      title={preset.label}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full Variant
  return (
    <div className={`p-4 rounded-2xl border border-border bg-surface space-y-4 ${className}`}>
      <div>
        <label className="block text-xs font-semibold text-fg mb-2">明暗视觉模式</label>
        <div className="grid grid-cols-3 gap-2 bg-surface-subtle p-1.5 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setMode('light')}
            className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mode === 'light' ? 'bg-surface text-fg font-bold shadow-xs border border-border' : 'text-fg-secondary hover:text-fg'
            }`}
          >
            <Sun className="w-4 h-4 text-amber-500" />
            <span className="text-xs">设计图纯白</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('dark')}
            className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mode === 'dark' ? 'bg-surface text-fg font-bold shadow-xs border border-border' : 'text-fg-secondary hover:text-fg'
            }`}
          >
            <Moon className="w-4 h-4 text-cyan-400" />
            <span className="text-xs">极客暗黑</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('system')}
            className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mode === 'system' ? 'bg-surface text-fg font-bold shadow-xs border border-border' : 'text-fg-secondary hover:text-fg'
            }`}
          >
            <Laptop className="w-4 h-4 text-purple-400" />
            <span className="text-xs">跟随系统</span>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-fg mb-2">核心强调色 (Accent Color)</label>
        <div className="grid grid-cols-4 gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const isSelected = accent === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setAccent(preset.id)}
                className={`py-2 px-2.5 rounded-xl border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  isSelected ? 'border-border-hover ring-2 ring-accent/30 font-bold' : 'border-border hover:bg-surface-hover'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: preset.colorHex }} />
                <span className="text-xs truncate">{preset.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
