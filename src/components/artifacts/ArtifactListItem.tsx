import React from 'react';
import {
  CheckCircle2,
  Clock,
  FileCode2,
  FileDiff,
  FileImage,
  FileText,
  FolderOpen,
  Layers,
  Scale,
  Sparkles,
} from 'lucide-react';
import { formatBytes } from '../../services/dbClient';
import type { UnifiedArtifactItem } from '../../services/artifactsService';

interface ArtifactListItemProps {
  item: UnifiedArtifactItem;
  isSelected: boolean;
  onSelect: (item: UnifiedArtifactItem) => void;
  onRevealFile?: (item: UnifiedArtifactItem) => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'rs',
  'py',
  'go',
  'json',
  'yaml',
  'yml',
  'toml',
  'sql',
  'sh',
  'css',
  'html',
]);

function renderSourceIcon(item: UnifiedArtifactItem) {
  switch (item.sourceKind) {
    case 'topic_ruling':
      return <Scale className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />;
    case 'topic_diff_applied':
    case 'topic_diff_pending':
      return <FileDiff className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />;
    case 'swarm_synthesis':
      return <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />;
    case 'gframe_contract':
    case 'gframe_module_output':
      return <Layers className="w-4 h-4 text-indigo-700 dark:text-indigo-300 shrink-0" />;
    default: {
      const ext = (item.ext || '').toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        return <FileImage className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />;
      }
      if (CODE_EXTENSIONS.has(ext)) {
        return <FileCode2 className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />;
      }
      return <FileText className="w-4 h-4 text-fg-secondary shrink-0" />;
    }
  }
}

export const ArtifactListItem: React.FC<ArtifactListItemProps> = ({
  item,
  isSelected,
  onSelect,
  onRevealFile,
}) => {
  const isFinal = item.tier === 'final';

  return (
    <div
      className={`group rounded-xl border transition-all flex items-stretch overflow-hidden ${
        isSelected
          ? 'bg-blue-50 border-blue-300 dark:bg-blue-500/15 dark:border-blue-500/40 text-fg shadow-xs'
          : 'bg-surface border-border hover:bg-surface-hover text-fg'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-current={isSelected ? 'true' : undefined}
        className="flex-1 min-w-0 px-3 py-2.5 text-left cursor-pointer flex items-start gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <div className="w-7 h-7 rounded-lg bg-surface-subtle border border-border flex items-center justify-center mt-0.5 shrink-0">
          {renderSourceIcon(item)}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-fg truncate flex-1" title={item.title}>
              {item.title}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border shrink-0 ${
                isFinal
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
              }`}
            >
              {isFinal ? (
                <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
              ) : (
                <Clock className="w-2.5 h-2.5 shrink-0" />
              )}
              <span>{isFinal ? '最终产物' : '中间产物'}</span>
            </span>

            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-surface-subtle text-fg-secondary border border-border shrink-0">
              {item.badgeLabel}
            </span>

            {item.moduleTitle && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-surface-subtle text-fg-muted border border-border truncate max-w-[140px]">
                {item.moduleTitle}
              </span>
            )}
          </div>

          {item.subtitle && (
            <p className="text-[11px] text-fg-muted truncate font-mono" title={item.subtitle}>
              {item.subtitle}
            </p>
          )}

          <div className="flex items-center gap-2 text-[10px] text-fg-muted">
            {typeof item.sizeBytes === 'number' && item.sizeBytes > 0 && (
              <span>{formatBytes(item.sizeBytes)}</span>
            )}
            {item.timestampLabel && <span className="truncate">{item.timestampLabel}</span>}
            {item.authorName && <span className="truncate">· {item.authorName}</span>}
          </div>
        </div>
      </button>

      {item.filePath && onRevealFile && (
        <div className="flex items-center pr-2 shrink-0">
          <button
            type="button"
            onClick={() => onRevealFile(item)}
            title="在文件管理器中定位此文件"
            aria-label={`在文件管理器中定位 ${item.title}`}
            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface border border-transparent hover:border-border transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
