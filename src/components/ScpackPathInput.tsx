import React, { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { isTauriEnvironment } from '../services/dbClient';

interface ScpackPathInputProps {
  mode: 'save' | 'open';
  value: string;
  onChange: (value: string) => void;
  onError?: (message: string | null) => void;
  dialogTitle: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function getDialogDefaultPath(rawPath: string): string | undefined {
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('~')) {
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    const last = parts[parts.length - 1];
    return last && last.includes('.') ? last : undefined;
  }
  return trimmed;
}

function ensureScpackExtension(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.toLowerCase().endsWith('.scpack')) {
    return trimmed;
  }
  return `${trimmed}.scpack`;
}

export const ScpackPathInput: React.FC<ScpackPathInputProps> = ({
  mode,
  value,
  onChange,
  onError,
  dialogTitle,
  placeholder,
  disabled = false,
  className = '',
}) => {
  const [isPicking, setIsPicking] = useState(false);
  const desktopPickerAvailable = isTauriEnvironment();

  const handlePickPath = async () => {
    if (!desktopPickerAvailable) {
      onError?.('路径选择器仅支持 Shadow Crew 桌面端，请手动输入路径。');
      return;
    }

    setIsPicking(true);
    onError?.(null);
    try {
      const filters = [{ name: 'Shadow Crew Expert Pack', extensions: ['scpack'] }];
      const defaultPath = getDialogDefaultPath(value);
      const selected =
        mode === 'save'
          ? await save({
              title: dialogTitle,
              defaultPath,
              filters,
            })
          : await open({
              directory: false,
              multiple: false,
              title: dialogTitle,
              defaultPath,
              filters,
            });

      if (typeof selected === 'string' && selected.trim()) {
        onChange(mode === 'save' ? ensureScpackExtension(selected) : selected);
      }
    } catch (err) {
      console.error('[ScpackPathInput] Failed to open file picker:', err);
      onError?.(
        err instanceof Error
          ? `无法打开路径选择器：${err.message}`
          : `无法打开路径选择器：${String(err)}`
      );
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onError?.(null);
        }}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        className="min-w-0 flex-1 px-3 py-1.5 rounded-xl bg-surface border border-border text-fg text-xs font-mono placeholder-fg-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        onClick={handlePickPath}
        disabled={disabled || isPicking || !desktopPickerAvailable}
        title={
          desktopPickerAvailable
            ? mode === 'save'
              ? '通过系统窗口选择导出路径'
              : '通过系统窗口选择 .scpack 文件'
            : '系统路径选择仅在桌面端可用，可继续手动输入路径'
        }
        className="shrink-0 inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-accent/60 hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {isPicking ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5 text-accent" />
        )}
        <span>{isPicking ? '选择中' : '浏览'}</span>
      </button>
    </div>
  );
};
