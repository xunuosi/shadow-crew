import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { CodeBlock } from '../markdown/CodeBlock';
import { formatBytes, isTauriEnvironment } from '../../services/dbClient';
import {
  openFileInEditor,
  openFileInSystem,
  readFileForPreview,
  type FilePreviewResult,
} from '../../services/fileViewerService';
import type { UnifiedArtifactItem } from '../../services/artifactsService';

interface ArtifactPreviewPaneProps {
  item: UnifiedArtifactItem | null;
  primaryDir: string;
  workspaceCwd?: string;
  onOpenPrimaryDir: () => void;
  onRevealFile: (item: UnifiedArtifactItem) => void;
  onCloseAndPreview?: (rawHref: string, workspaceRoot?: string) => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

function renderUnifiedDiffContent(diffText: string) {
  const lines = diffText.split('\n');
  return (
    <div className="font-mono text-[11.5px] leading-relaxed select-text py-2">
      {lines.map((line, index) => {
        let rowClasses = 'text-fg hover:bg-surface-hover/60';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
          rowClasses =
            'bg-blue-50 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold';
        } else if (line.startsWith('+')) {
          rowClasses = 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200';
        } else if (line.startsWith('-')) {
          rowClasses = 'bg-rose-50 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200';
        }
        return (
          <div key={index} className={`flex items-start px-3 py-0.5 ${rowClasses}`}>
            <span className="w-9 shrink-0 select-none text-right pr-3 text-fg-muted text-[10px]">
              {index + 1}
            </span>
            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {line || ' '}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

export const ArtifactPreviewPane: React.FC<ArtifactPreviewPaneProps> = ({
  item,
  primaryDir,
  workspaceCwd,
  onOpenPrimaryDir,
  onRevealFile,
  onCloseAndPreview,
}) => {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [copiedPath, setCopiedPath] = useState(false);
  const [diskData, setDiskData] = useState<FilePreviewResult | null>(null);
  const [loadingDisk, setLoadingDisk] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isDesktopRuntime = isTauriEnvironment();
  const ext = (item?.ext || '').toLowerCase();
  const isInline = Boolean(item?.inlineContent);
  const isDiff = item?.inlineLanguage === 'diff';
  const isMarkdown =
    item?.inlineLanguage === 'markdown' || MARKDOWN_EXTENSIONS.has(ext);
  const isImage = IMAGE_EXTENSIONS.has(ext);

  useEffect(() => {
    setViewMode('preview');
    setCopiedPath(false);
    setActionMessage(null);
    setDiskData(null);

    if (!item || !item.filePath || item.inlineContent || !isDesktopRuntime) {
      setLoadingDisk(false);
      return;
    }

    let cancelled = false;
    setLoadingDisk(true);
    readFileForPreview(item.filePath, workspaceCwd)
      .then((res) => {
        if (!cancelled) {
          setDiskData(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDiskData({
            path: item.filePath || '',
            displayName: item.title,
            extension: ext,
            isBinary: false,
            isTruncated: false,
            startLine: 0,
            endLine: 0,
            isWindowed: false,
            hasMoreBefore: false,
            hasMoreAfter: false,
            sizeBytes: item.sizeBytes ?? 0,
            totalLines: 0,
            content: '',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDisk(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ext, isDesktopRuntime, item, workspaceCwd]);

  const handleCopyPath = async () => {
    const target = item?.filePath || item?.relativePath || primaryDir;
    if (!target || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1800);
    } catch {
      // Ignore clipboard rejection
    }
  };

  const handleOpenExternal = async () => {
    if (!item?.filePath) return;
    try {
      await openFileInSystem(item.filePath, workspaceCwd);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInEditor = async () => {
    if (!item?.filePath) return;
    try {
      await openFileInEditor(item.filePath, undefined, undefined, undefined, workspaceCwd);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (!item) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-8 text-center bg-canvas/40">
        <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center mb-3 text-fg-muted">
          <FolderOpen className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-fg mb-1">选择左侧产物进行预览或定位</h3>
        <p className="text-xs text-fg-muted max-w-sm mb-4">
          可切换「最终产物」与「中间产物」标签核查每阶段交付物，或直接打开磁盘产物目录。
        </p>
        <button
          type="button"
          onClick={onOpenPrimaryDir}
          className="px-3.5 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover text-xs font-medium text-fg flex items-center gap-2 transition-colors cursor-pointer"
        >
          <FolderOpen className="w-4 h-4 text-accent" />
          <span>在文件管理器中打开目录</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface">
      {/* 预览区头部工具栏 */}
      <div className="px-4 py-2.5 border-b border-border bg-surface-subtle flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs font-semibold text-fg truncate" title={item.title}>
              {item.title}
            </h3>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface border border-border text-fg-secondary shrink-0">
              {item.badgeLabel}
            </span>
          </div>
          {(item.filePath || item.relativePath) && (
            <p
              className="text-[11px] font-mono text-fg-muted truncate"
              title={item.filePath || item.relativePath}
            >
              {item.filePath || item.relativePath}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {isMarkdown && (
            <div className="flex items-center bg-surface border border-border rounded-lg p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-accent text-accent-fg font-medium'
                    : 'text-fg-secondary hover:text-fg'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>预览</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('source')}
                className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'source'
                    ? 'bg-accent text-accent-fg font-medium'
                    : 'text-fg-secondary hover:text-fg'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>源码</span>
              </button>
            </div>
          )}

          {(item.filePath || item.relativePath) && (
            <button
              type="button"
              onClick={handleCopyPath}
              className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-[11px] text-fg-secondary hover:text-fg flex items-center gap-1 cursor-pointer transition-colors"
              title="复制路径"
            >
              {copiedPath ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>复制路径</span>
            </button>
          )}

          {item.filePath ? (
            <button
              type="button"
              onClick={() => onRevealFile(item)}
              className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/25 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>在文件管理器中定位</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenPrimaryDir}
              className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-[11px] font-medium text-fg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent" />
              <span>打开产物目录</span>
            </button>
          )}

          {item.filePath && isDesktopRuntime && (
            <>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="p-1.5 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg cursor-pointer transition-colors"
                title="系统默认程序打开"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleOpenInEditor}
                className="p-1.5 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg cursor-pointer transition-colors"
                title="在代码编辑器中打开"
              >
                <Code2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="px-4 py-1.5 bg-amber-50 dark:bg-amber-500/15 border-b border-amber-200 dark:border-amber-500/30 text-[11px] text-amber-900 dark:text-amber-200">
          {actionMessage}
        </div>
      )}

      {/* 预览主体区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-surface">
        {/* 1. 结构化内置文本/Diff/Markdown 渲染 */}
        {isInline && item.inlineContent && (
          <>
            {isDiff ? (
              renderUnifiedDiffContent(item.inlineContent)
            ) : isMarkdown && viewMode === 'preview' ? (
              <div className="p-5">
                <MarkdownRenderer
                  content={item.inlineContent}
                  workspaceRoot={workspaceCwd}
                  onFileLinkClick={onCloseAndPreview}
                />
              </div>
            ) : (
              <div className="p-4">
                <CodeBlock
                  code={item.inlineContent}
                  language={item.inlineLanguage === 'markdown' ? 'markdown' : ext || 'text'}
                />
              </div>
            )}
          </>
        )}

        {/* 2. 物理文件：桌面端异步读取内容 */}
        {!isInline && item.filePath && loadingDisk && (
          <div className="h-56 flex flex-col items-center justify-center gap-2 text-fg-muted">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-xs">正在读取本地文件内容...</span>
          </div>
        )}

        {!isInline && item.filePath && !loadingDisk && !isDesktopRuntime && (
          <div className="p-6">
            <div className="rounded-xl border border-border bg-surface-subtle p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg">文件元信息</span>
                {typeof item.sizeBytes === 'number' && (
                  <span className="text-[11px] text-fg-muted font-mono">
                    {formatBytes(item.sizeBytes)}
                  </span>
                )}
              </div>
              <p className="text-xs text-fg-secondary break-all font-mono">{item.filePath}</p>
              <p className="text-xs text-fg-muted">
                当前运行在 Web 预览模式下，无法直接从浏览器读取任意本地磁盘路径；在 Tauri 桌面客户端中将直接呈现完整文件内容并一键打开 Finder / 资源管理器。
              </p>
            </div>
          </div>
        )}

        {!isInline && item.filePath && !loadingDisk && isDesktopRuntime && diskData?.error && (
          <div className="p-5">
            <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>无法读取该本地文件</span>
              </div>
              <p className="text-xs text-fg-secondary">{diskData.error}</p>
              <button
                type="button"
                onClick={onOpenPrimaryDir}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-hover cursor-pointer inline-flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5 text-accent" />
                <span>在文件管理器中打开目录</span>
              </button>
            </div>
          </div>
        )}

        {!isInline && item.filePath && !loadingDisk && diskData && !diskData.error && (
          <>
            {diskData.isBinary && !isImage && (
              <div className="p-8 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center text-fg-muted">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <p className="text-xs text-fg-muted">
                  二进制文件（{formatBytes(diskData.sizeBytes)}），请使用系统文件管理器或默认程序打开。
                </p>
                <button
                  type="button"
                  onClick={() => onRevealFile(item)}
                  className="px-3.5 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover text-xs font-medium text-fg cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-accent" />
                  <span>在文件管理器中定位</span>
                </button>
              </div>
            )}

            {isImage && (diskData.imageDataUrl || !diskData.isBinary) && (
              <div className="p-5 flex justify-center bg-canvas/40">
                <img
                  src={
                    diskData.imageDataUrl ||
                    (diskData.path.startsWith('/') ? `file://${diskData.path}` : diskData.path)
                  }
                  alt={diskData.displayName}
                  className="max-w-full max-h-[460px] object-contain rounded-lg border border-border"
                />
              </div>
            )}

            {diskData.isWindowed && item.filePath && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-between gap-2 text-[11px] text-amber-900 dark:text-amber-200 flex-wrap">
                <span>
                  大文件当前显示第 {diskData.startLine}–{diskData.endLine} 行（共 {diskData.totalLines} 行）
                </span>
                {onCloseAndPreview && (
                  <button
                    type="button"
                    onClick={() => onCloseAndPreview(item.filePath!, workspaceCwd)}
                    className="px-2 py-0.5 rounded bg-surface border border-amber-300 dark:border-amber-500/40 text-fg font-medium hover:bg-surface-hover cursor-pointer"
                  >
                    在预览抽屉中分窗翻阅大文件
                  </button>
                )}
              </div>
            )}

            {!diskData.isBinary && !isImage && isMarkdown && !diskData.isWindowed && viewMode === 'preview' && (
              <div className="p-5">
                <MarkdownRenderer
                  content={diskData.content}
                  workspaceRoot={workspaceCwd}
                  onFileLinkClick={onCloseAndPreview}
                />
              </div>
            )}

            {!diskData.isBinary && !isImage && (!isMarkdown || diskData.isWindowed || viewMode === 'source') && (
              <div className="p-4">
                <CodeBlock code={diskData.content} language={ext || 'text'} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
