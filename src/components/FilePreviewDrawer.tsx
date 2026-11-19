import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { FilePreviewWindowBar } from './FilePreviewWindowBar';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ResizeHandle } from './ResizeHandle';
import {
  FilePreviewResult,
  ReadFilePreviewOptions,
  readFileForPreview,
  openFileInSystem,
  revealFileInFolder,
  openFileInEditor,
  parseFileLink,
  formatCandidateDisplayPath,
} from '../services/fileViewerService';
import { openDirectoryInFileManager } from '../services/artifactsService';
import { formatBytes } from '../services/dbClient';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';

const PREVIEW_WINDOW_LINES = 500;
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

export interface FilePreviewTarget {
  rawPath: string;
  startLine?: number;
  endLine?: number;
  workspaceRoot?: string;
  previewDataUrl?: string;
  displayName?: string;
  mimeType?: string;
}

interface FilePreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  target: FilePreviewTarget | null;
  initialPreviewData?: FilePreviewResult | null;
}

export const FilePreviewDrawer: React.FC<FilePreviewDrawerProps> = ({
  isOpen,
  onClose,
  target,
  initialPreviewData = null,
}) => {
  const [loading, setLoading] = useState(false);
  const [windowLoading, setWindowLoading] = useState(false);
  const [data, setData] = useState<FilePreviewResult | null>(initialPreviewData);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [jumpLineInput, setJumpLineInput] = useState('');
  const [highlightLine, setHighlightLine] = useState<number | undefined>(undefined);
  const [selectedPathOverride, setSelectedPathOverride] = useState<string | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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
      displayName: target.displayName || p.displayName,
      startLine: target.startLine || p.startLine,
      endLine: target.endLine || p.endLine,
    };
  }, [target]);

  const targetPathKey = parsed?.cleanPath || '';
  const initialStartLine = parsed?.startLine;

  // 新目标路径到达时重置候选路径覆盖
  useEffect(() => {
    setSelectedPathOverride(null);
  }, [targetPathKey, target?.workspaceRoot]);

  const effectiveRequestPath = selectedPathOverride || targetPathKey;

  // 加载文件首窗或指定锚点窗口
  useEffect(() => {
    if (initialPreviewData) {
      setData(initialPreviewData);
      setLoading(false);
      setHighlightLine(initialStartLine);
      setViewMode(
        !initialPreviewData.isWindowed && MARKDOWN_EXTENSIONS.has(initialPreviewData.extension)
          ? 'preview'
          : 'source'
      );
      return;
    }

    if (!isOpen || !parsed) {
      setData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setHighlightLine(initialStartLine);
    setJumpLineInput(initialStartLine ? String(initialStartLine) : '');

    // 若附件已附带 inline data URL 且无本地真实路径，直接展示内存图片预览
    if (target?.previewDataUrl && !parsed.cleanPath.includes('/') && !parsed.cleanPath.includes('\\')) {
      const ext = parsed.displayName.split('.').pop()?.toLowerCase() || 'png';
      setData({
        path: parsed.cleanPath,
        displayName: parsed.displayName,
        extension: ext,
        sizeBytes: 0,
        isBinary: true,
        content: '',
        totalLines: 0,
        isTruncated: false,
        startLine: 0,
        endLine: 0,
        isWindowed: false,
        hasMoreBefore: false,
        hasMoreAfter: false,
        imageDataUrl: target.previewDataUrl,
      });
      setViewMode('source');
      setLoading(false);
      return;
    }

    const requestOpts: ReadFilePreviewOptions | undefined = initialStartLine
      ? { startLine: Math.max(1, initialStartLine - 40), maxLines: PREVIEW_WINDOW_LINES }
      : undefined;

    readFileForPreview(effectiveRequestPath, target?.workspaceRoot, requestOpts)
      .then((res) => {
        if (!isMounted) return;
        setData((prev) => ({
          ...res,
          candidatePaths: res.candidatePaths || (selectedPathOverride ? prev?.candidatePaths : undefined),
        }));
        if (!res.isWindowed && MARKDOWN_EXTENSIONS.has(res.extension)) {
          setViewMode('preview');
        } else {
          setViewMode('source');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setData({
          path: effectiveRequestPath,
          displayName: parsed.displayName,
          extension: parsed.cleanPath.split('.').pop()?.toLowerCase() || '',
          sizeBytes: 0,
          isBinary: false,
          content: '',
          totalLines: 0,
          isTruncated: false,
          startLine: 0,
          endLine: 0,
          isWindowed: false,
          hasMoreBefore: false,
          hasMoreAfter: false,
          error: String(err?.message || err || '文件读取异常'),
        });
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [initialPreviewData, isOpen, targetPathKey, effectiveRequestPath, selectedPathOverride, initialStartLine, target?.workspaceRoot, target?.previewDataUrl]);

  // 行号自动滚动定位
  useEffect(() => {
    if (!loading && !windowLoading && data && highlightLine && targetLineRef.current) {
      const timer = setTimeout(() => {
        targetLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [loading, windowLoading, data, highlightLine]);

  const loadWindow = useCallback(
    async (options: ReadFilePreviewOptions, nextHighlightLine?: number) => {
      if (!parsed) return;
      setWindowLoading(true);
      try {
        const res = await readFileForPreview(
          data?.path || effectiveRequestPath,
          target?.workspaceRoot,
          options
        );
        setData((prev) => ({
          ...res,
          candidatePaths: res.candidatePaths || prev?.candidatePaths,
        }));
        setViewMode('source');
        setHighlightLine(nextHighlightLine);
        if (!nextHighlightLine && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      } finally {
        setWindowLoading(false);
      }
    },
    [data?.path, effectiveRequestPath, parsed, target?.workspaceRoot]
  );

  const handleJumpLineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !jumpLineInput.trim()) return;
    const rawLine = Number.parseInt(jumpLineInput.trim(), 10);
    if (!Number.isFinite(rawLine)) return;
    const targetLine = Math.max(1, Math.min(data.totalLines || rawLine, rawLine));
    const windowStart = Math.max(1, targetLine - 25);
    loadWindow({ startLine: windowStart, maxLines: PREVIEW_WINDOW_LINES }, targetLine);
  };

  if (!isOpen || !parsed) return null;

  const handleCopyPath = () => {
    const copyVal = data?.path || parsed.cleanPath;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(copyVal);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenSystem = () => {
    openFileInSystem(data?.path || parsed.cleanPath, target?.workspaceRoot);
  };

  const handleReveal = () => {
    revealFileInFolder(data?.path || effectiveRequestPath, target?.workspaceRoot);
  };

  const handleRevealParentDir = () => {
    const raw = data?.path || effectiveRequestPath;
    const slashIdx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
    const parentCandidate = slashIdx > 0 ? raw.slice(0, slashIdx) : '';
    const dirToOpen = parentCandidate || target?.workspaceRoot || '';
    if (dirToOpen) {
      openDirectoryInFileManager(dirToOpen, { workspaceRoot: target?.workspaceRoot, createIfMissing: false });
    }
  };

  const handleOpenEditor = () => {
    openFileInEditor(
      data?.path || parsed.cleanPath,
      highlightLine || parsed.startLine,
      undefined,
      'code',
      target?.workspaceRoot
    );
  };

  const effectiveExt = (data?.extension || parsed.cleanPath.split('.').pop() || '').toLowerCase();
  const isMarkdown = MARKDOWN_EXTENSIONS.has(effectiveExt) && !data?.isWindowed;
  const isImage =
    IMAGE_EXTENSIONS.has(effectiveExt) || Boolean(target?.mimeType?.startsWith('image/'));
  const resolvedImageSrc = target?.previewDataUrl || data?.imageDataUrl;
  const canRenderImage = isImage && Boolean(resolvedImageSrc);
  const activeStartLine = data?.startLine && data.startLine > 0 ? data.startLine : 1;

  return (
    <aside
      ref={panelRef}
      role="region"
      aria-label="本地文件预览抽屉"
      style={{ width: `${drawerWidth}px` }}
      className={`fixed top-0 right-0 bottom-0 z-[60] bg-surface border-l border-border shadow-2xl flex flex-col min-w-0 transition-opacity select-text ${
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
          {isMarkdown && !data?.error && (
            <div className="flex items-center bg-surface border border-border rounded-lg p-0.5 mr-1 text-[11px]">
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

          <button
            type="button"
            onClick={handleCopyPath}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
            title="复制文件路径"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleReveal}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
            title="在系统文件管理器中显示 (Finder / Explorer)"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleOpenEditor}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
            title="在外部 VS Code 中打开代码行"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 状态信息栏 */}
      {data && !data.error && (
        <div className="px-4 py-1.5 bg-surface-subtle/30 border-b border-border text-[11px] text-fg-muted flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {data.sizeBytes > 0 && <span>大小: {formatBytes(data.sizeBytes)}</span>}
            {!data.isBinary && <span>总行数: {data.totalLines.toLocaleString()} 行</span>}
            {data.isWindowed && (
              <span className="text-amber-800 dark:text-amber-300 font-medium">
                大文件流式分窗 · 第 {data.startLine.toLocaleString()}–{data.endLine.toLocaleString()} 行
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleOpenSystem}
            className="text-accent hover:underline flex items-center gap-1 text-[11px] font-medium cursor-pointer"
          >
            <span>系统默认打开</span>
          </button>
        </div>
      )}

      {/* 多同名匹配文件切换条 */}
      {data && !data.error && data.candidatePaths && data.candidatePaths.length > 1 && (
        <div className="px-4 py-2 bg-surface-subtle/60 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0 text-[11px]">
          <span className="text-fg-muted shrink-0">发现 {data.candidatePaths.length} 个同名文件:</span>
          {data.candidatePaths.map((candPath) => {
            const relDisplay = formatCandidateDisplayPath(candPath, target?.workspaceRoot);
            const isActive = data.path === candPath || selectedPathOverride === candPath;
            return (
              <button
                key={candPath}
                type="button"
                onClick={() => setSelectedPathOverride(candPath)}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] border cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40 font-semibold'
                    : 'bg-surface text-fg-secondary border-border hover:bg-surface-hover'
                }`}
                title={candPath}
              >
                {relDisplay}
              </button>
            );
          })}
        </div>
      )}

      {/* 大文件分窗翻阅与行号跳转栏 */}
      {data && !data.error && !data.isBinary && data.isWindowed && (
        <FilePreviewWindowBar
          data={data}
          windowSize={PREVIEW_WINDOW_LINES}
          windowLoading={windowLoading}
          jumpLineInput={jumpLineInput}
          onJumpLineInputChange={setJumpLineInput}
          onLoadWindow={loadWindow}
          onJumpSubmit={handleJumpLineSubmit}
        />
      )}

      {/* 内容主体区域 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 bg-surface">
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
                  onClick={handleRevealParentDir}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-border text-fg text-xs font-medium hover:bg-surface-hover cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-accent" />
                  <span>打开工作目录</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-border text-fg text-xs font-medium hover:bg-surface-hover cursor-pointer transition-colors flex items-center gap-1.5"
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
            {/* 图片内嵌预览（支持本地读取 Data URL 与内存预览 Data URL） */}
            {canRenderImage && resolvedImageSrc && (
              <div className="p-6 flex flex-col items-center justify-center min-h-[300px] bg-canvas/40">
                <img
                  src={resolvedImageSrc}
                  alt={data.displayName || parsed.displayName}
                  className="max-w-full max-h-[540px] object-contain rounded-lg border border-border shadow-sm"
                />
              </div>
            )}

            {/* 非可预览二进制文件提示 */}
            {data.isBinary && !canRenderImage && (
              <div className="p-8 text-center flex flex-col items-center justify-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center text-fg-muted">
                  <FileSpreadsheet className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-fg">
                    {isImage ? '图片体积过大，建议使用系统查看器打开' : '二进制文件'}
                  </h4>
                  <p className="text-xs text-fg-muted max-w-sm">
                    {isImage
                      ? '图片超过 10MB 内嵌解码上限，请使用系统默认图片查看器直接打开。'
                      : '此文件包含非文本二进制内容，应用内无法直接进行代码渲染。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenSystem}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium hover:opacity-90 shadow-sm cursor-pointer transition-opacity flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>在系统默认程序中打开</span>
                </button>
              </div>
            )}

            {/* Markdown 富文本预览模式 */}
            {!data.isBinary && !canRenderImage && isMarkdown && viewMode === 'preview' && (
              <div className="p-6">
                <MarkdownRenderer
                  content={data.content}
                  workspaceRoot={target?.workspaceRoot}
                />
              </div>
            )}

            {/* 代码/文本源码渲染模式（支持真实大文件窗口行号） */}
            {!data.isBinary && !canRenderImage && (!isMarkdown || viewMode === 'source') && (
              <div className="text-xs font-mono select-text py-2">
                {data.content.split('\n').map((line, idx) => {
                  const lineNum = activeStartLine + idx;
                  const activeEndTarget = highlightLine ? (parsed.endLine || highlightLine) : undefined;
                  const isTarget =
                    Boolean(highlightLine) &&
                    lineNum >= highlightLine! &&
                    lineNum <= (activeEndTarget || highlightLine!);

                  return (
                    <div
                      key={`${activeStartLine}-${idx}`}
                      ref={lineNum === highlightLine ? targetLineRef : undefined}
                      className={`flex items-start px-2 py-0.5 transition-colors group ${
                        isTarget
                          ? 'bg-amber-500/15 dark:bg-amber-500/20 border-l-2 border-amber-500 font-semibold'
                          : 'hover:bg-surface-hover/70'
                      }`}
                    >
                      <span className="w-14 shrink-0 select-none text-right pr-4 text-fg-muted text-[11px]">
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
