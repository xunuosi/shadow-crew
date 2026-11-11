import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  FileCode2,
  FileText,
  FileImage,
  Copy,
  Check,
  ExternalLink,
  FolderOpen,
  Code2,
  AlertCircle,
  Loader2,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';
import {
  FilePreviewResult,
  readFileForPreview,
  openFileInSystem,
  revealFileInFolder,
  openFileInEditor,
  parseFileLink,
} from '../services/fileViewerService';
import { formatBytes } from '../services/dbClient';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import Prism from 'prismjs';

export interface FilePreviewTarget {
  rawPath: string;
  startLine?: number;
  endLine?: number;
  workspaceRoot?: string;
}

interface FilePreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  target: FilePreviewTarget | null;
}

export const FilePreviewDrawer: React.FC<FilePreviewDrawerProps> = ({
  isOpen,
  onClose,
  target,
}) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FilePreviewResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const targetLineRef = useRef<HTMLDivElement | null>(null);

  const { width: drawerWidth, isDragging, handlePointerDown, resetWidth, panelRef } = useResizablePanel({
    direction: 'left',
    defaultWidth: 560,
    maxWidth: () => (typeof window !== 'undefined' ? Math.max(360, Math.min(1300, window.innerWidth - 240)) : 800),
    storageKey: 'shadow_crew_file_preview_width',
  });

  const parsed = useMemo(() => {
    if (!target?.rawPath) return null;
    const p = parseFileLink(target.rawPath);
    return {
      ...p,
      startLine: target.startLine || p.startLine,
      endLine: target.endLine || p.endLine,
    };
  }, [target]);

  // 加载文件数据
  useEffect(() => {
    if (!isOpen || !parsed) {
      setData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    readFileForPreview(parsed.cleanPath, target?.workspaceRoot)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
        // 如果是 markdown 文件，默认展示富文本预览
        if (['md', 'markdown'].includes(res.extension)) {
          setViewMode('preview');
        } else {
          setViewMode('source');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setData({
          path: parsed.cleanPath,
          displayName: parsed.displayName,
          extension: parsed.cleanPath.split('.').pop() || '',
          sizeBytes: 0,
          isBinary: false,
          content: '',
          totalLines: 0,
          isTruncated: false,
          error: String(err?.message || err || '文件读取异常'),
        });
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, parsed?.cleanPath, target?.workspaceRoot]);

  // 行号自动滚动定位
  useEffect(() => {
    if (!loading && data && parsed?.startLine && targetLineRef.current) {
      const timer = setTimeout(() => {
        targetLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [loading, data, parsed?.startLine]);

  if (!isOpen || !parsed) return null;

  const handleCopyPath = () => {
    const copyVal = data?.path || parsed.cleanPath;
    navigator.clipboard.writeText(copyVal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenSystem = () => {
    openFileInSystem(data?.path || parsed.cleanPath, target?.workspaceRoot);
  };

  const handleReveal = () => {
    revealFileInFolder(data?.path || parsed.cleanPath, target?.workspaceRoot);
  };

  const handleOpenEditor = () => {
    openFileInEditor(
      data?.path || parsed.cleanPath,
      parsed.startLine,
      undefined,
      'code',
      target?.workspaceRoot
    );
  };

  const isMarkdown = ['md', 'markdown'].includes(data?.extension || parsed.cleanPath.split('.').pop() || '');
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(
    data?.extension || parsed.cleanPath.split('.').pop() || ''
  );

  return (
    <aside
      ref={panelRef}
      role="region"
      aria-label="本地文件预览抽屉"
      style={{ width: `${drawerWidth}px` }}
      className={`fixed top-0 right-0 bottom-0 z-40 bg-surface border-l border-border shadow-2xl flex flex-col min-w-0 transition-opacity select-text ${
        isDragging ? 'select-none' : ''
      }`}
    >
      <ResizeHandle
        direction="left"
        isDragging={isDragging}
        onPointerDown={handlePointerDown}
        onDoubleClick={resetWidth}
        title="双击重置抽屉宽度"
      />

      {/* 顶部标题与操作栏 */}
      <div className="h-13 px-4 border-b border-border bg-surface-subtle/50 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-lg bg-surface border border-border flex items-center justify-center shrink-0 text-accent">
            {isMarkdown ? (
              <FileText className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            ) : isImage ? (
              <FileImage className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <FileCode2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-fg truncate" title={data?.displayName || parsed.displayName}>
                {data?.displayName || parsed.displayName}
              </span>
              {parsed.startLine && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shrink-0">
                  L{parsed.startLine}
                  {parsed.endLine ? `-L${parsed.endLine}` : ''}
                </span>
              )}
            </div>
            <div className="text-[10px] text-fg-muted font-mono truncate" title={data?.path || parsed.cleanPath}>
              {data?.path || parsed.cleanPath}
            </div>
          </div>
        </div>

        {/* 顶部右侧工具组 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Markdown 模式切换 */}
          {isMarkdown && !data?.error && (
            <div className="flex items-center bg-surface border border-border rounded-lg p-0.5 mr-1 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
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
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
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

          <button
            type="button"
            onClick={handleCopyPath}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            title="复制文件路径"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleReveal}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            title="在系统文件管理器中显示 (Finder / Explorer)"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleOpenEditor}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            title="在外部 VS Code 中打开代码行"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 状态信息栏 */}
      {data && !data.error && (
        <div className="px-4 py-1.5 bg-surface-subtle/30 border-b border-border text-[11px] text-fg-muted flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <span>大小: {formatBytes(data.sizeBytes)}</span>
            {!data.isBinary && <span>行数: {data.totalLines} 行</span>}
            {data.isTruncated && (
              <span className="text-amber-800 dark:text-amber-400 font-medium">
                (文件较大，已截取前 3MB 渲染)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleOpenSystem}
            className="text-accent hover:underline flex items-center gap-1 text-[11px] font-medium"
          >
            <span>系统默认打开</span>
          </button>
        </div>
      )}

      {/* 内容主体区域 */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-surface">
        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-fg-muted">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <span className="text-xs">正在读取本地文件...</span>
          </div>
        )}

        {!loading && data?.error && (
          <div className="p-6">
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>无法打开本地文件</span>
              </div>
              <p className="text-xs leading-relaxed text-fg-secondary select-text">
                {data.error}
              </p>
              <div className="pt-2 border-t border-rose-200 dark:border-rose-500/20 text-[11px] text-fg-muted font-mono break-all">
                目标路径: {parsed.cleanPath}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleReveal}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-border text-fg text-xs font-medium hover:bg-surface-hover transition-colors flex items-center gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-accent" />
                  <span>定位上级目录</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-border text-fg text-xs font-medium hover:bg-surface-hover transition-colors flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制原始路径</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && data && !data.error && (
          <>
            {/* 二进制文件提示 */}
            {data.isBinary && !isImage && (
              <div className="p-8 text-center flex flex-col items-center justify-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center text-fg-muted">
                  <FileSpreadsheet className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-fg">二进制文件</h4>
                  <p className="text-xs text-fg-muted max-w-sm">
                    此文件包含非文本二进制内容，应用内无法直接进行代码渲染。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenSystem}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium hover:opacity-90 shadow-sm transition-opacity flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>在系统默认程序中打开</span>
                </button>
              </div>
            )}

            {/* 图片预览 */}
            {!data.isBinary && isImage && (
              <div className="p-6 flex flex-col items-center justify-center min-h-[300px] bg-canvas/40">
                <img
                  src={data.path.startsWith('/') ? `file://${data.path}` : data.path}
                  alt={data.displayName}
                  className="max-w-full max-h-[500px] object-contain rounded-lg border border-border shadow-sm"
                  onError={(e) => {
                    // 若本地 file:// 协议被拦截，降级显示
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Markdown 富文本预览模式 */}
            {isMarkdown && viewMode === 'preview' && (
              <div className="p-6">
                <MarkdownRenderer content={data.content} />
              </div>
            )}

            {/* 代码/文本源码渲染模式 */}
            {(!data.isBinary || isImage) && (!isMarkdown || viewMode === 'source') && (
              <div className="text-xs font-mono select-text py-2">
                {data.content.split('\n').map((line, idx) => {
                  const lineNum = idx + 1;
                  const isTarget =
                    parsed.startLine &&
                    lineNum >= parsed.startLine &&
                    lineNum <= (parsed.endLine || parsed.startLine);

                  return (
                    <div
                      key={idx}
                      ref={lineNum === parsed.startLine ? targetLineRef : undefined}
                      className={`flex items-start px-2 py-0.5 transition-colors group ${
                        isTarget
                          ? 'bg-amber-500/15 dark:bg-amber-500/20 border-l-2 border-amber-500 font-semibold'
                          : 'hover:bg-surface-hover/70'
                      }`}
                    >
                      <span className="w-12 shrink-0 select-none text-right pr-4 text-fg-muted text-[11px]">
                        {lineNum}
                      </span>
                      <pre className="flex-1 overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-relaxed text-fg">
                        {line || ' '}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
