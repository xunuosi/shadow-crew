import React, { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauriEnvironment } from '../services/dbClient';

interface WorkspaceDirectoryInputProps {
  value: string;
  onChange: (value: string) => void;
  onError?: (message: string | null) => void;
  dialogTitle: string;
  disabled?: boolean;
}

export const WorkspaceDirectoryInput: React.FC<WorkspaceDirectoryInputProps> = ({
  value,
  onChange,
  onError,
  dialogTitle,
  disabled = false,
}) => {
  const [isPicking, setIsPicking] = useState(false);
  const desktopPickerAvailable = isTauriEnvironment();

  const handlePickDirectory = async () => {
    if (!desktopPickerAvailable) {
      onError?.('目录选择器仅支持 Shadow Crew 桌面端，请手动输入路径。');
      return;
    }

    setIsPicking(true);
    onError?.(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        recursive: true,
        title: dialogTitle,
        defaultPath: value.trim() || undefined,
      });
      if (typeof selected === 'string' && selected.trim()) {
        onChange(selected);
      }
    } catch (err) {
      console.error('[WorkspaceDirectoryInput] Failed to open directory picker:', err);
      onError?.(
        err instanceof Error
          ? `无法打开目录选择器：${err.message}`
          : `无法打开目录选择器：${String(err)}`
      );
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onError?.(null);
        }}
        placeholder="/Users/you/projects/example 或 ~/projects/example"
        spellCheck={false}
        disabled={disabled}
        className="min-w-0 flex-1 basis-56 bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg placeholder-fg-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        onClick={handlePickDirectory}
        disabled={disabled || isPicking || !desktopPickerAvailable}
        title={
          desktopPickerAvailable
            ? '通过系统窗口选择已有目录'
            : '系统目录选择仅在桌面端可用，可继续手动输入路径'
        }
        className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-accent/60 hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPicking ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5 text-accent" />
        )}
        <span>{isPicking ? '选择中...' : '选择文件夹'}</span>
      </button>
    </div>
  );
};
