import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FolderArchive,
  FolderOpen,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { ResizeHandle } from '../ResizeHandle';
import { useResizableModalWidth } from '../../hooks/useResizableModalWidth';
import {
  buildScopeArtifactEntries,
  extractScopeModuleOptions,
  filterArtifactEntries,
  openDirectoryInFileManager,
  resolveFallbackPrimaryDir,
  revealArtifactInFileManager,
  scanScopeArtifacts,
  type ArtifactsScopeDescriptor,
  type ArtifactScopeType,
  type ArtifactTabFilter,
  type FileManagerActionResult,
  type ScopeArtifactsScanResult,
  type UnifiedArtifactItem,
} from '../../services/artifactsService';
import { ArtifactListItem } from './ArtifactListItem';
import { ArtifactPreviewPane } from './ArtifactPreviewPane';

interface ArtifactsWindowModalProps {
  isOpen: boolean;
  scope: ArtifactsScopeDescriptor | null;
  initialDiskScan?: ScopeArtifactsScanResult | null;
  onClose: () => void;
}

const SCOPE_TYPE_LABELS: Record<ArtifactScopeType, string> = {
  channel: '频道 (Channel)',
  dm: '私聊 (DM)',
  topic: '议题 (Topic)',
  swarm: '群智协作 (Swarm)',
  subthread: '子线程 (SubThread)',
  agent: 'Agent 工作区',
};

const TAB_ITEMS: Array<{ id: ArtifactTabFilter; label: string }> = [
  { id: 'final', label: '最终产物' },
  { id: 'intermediate', label: '中间产物' },
  { id: 'all', label: '全部产物' },
];

export const ArtifactsWindowModal: React.FC<ArtifactsWindowModalProps> = ({
  isOpen,
  scope,
  initialDiskScan = null,
  onClose,
}) => {
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const {
    modalWidth,
    isWidescreen,
    isDragging,
    handleResizeStart,
    toggleWidescreen,
  } = useResizableModalWidth({
    storageKey: 'shadow-crew-artifacts-modal-width',
    defaultWidth: 920,
    widescreenWidth: 1160,
    minWidth: 680,
    maxWidth: 1320,
  });

  const [diskScan, setDiskScan] = useState<ScopeArtifactsScanResult | null>(initialDiskScan);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<ArtifactTabFilter>('all');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<FileManagerActionResult | null>(null);
  const [copiedDir, setCopiedDir] = useState(false);

  // Synchronize native top-layer <dialog> open/close state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof window === 'undefined') return;
    if (isOpen && scope) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen, scope]);

  const runScan = useCallback(async (targetScope: ArtifactsScopeDescriptor) => {
    setScanning(true);
    try {
      const result = await scanScopeArtifacts(targetScope);
      setDiskScan(result);
    } finally {
      setScanning(false);
    }
  }, []);

  // Reset filters & kick off fresh scan whenever scope opens/changes
  useEffect(() => {
    if (!isOpen || !scope) return;
    setNotice(null);
    setSearchQuery('');
    setSelectedModuleId(scope.focusedModuleId || 'all');
    setSelectedItemId(null);

    if (initialDiskScan) {
      setDiskScan(initialDiskScan);
      return;
    }

    let cancelled = false;
    setScanning(true);
    scanScopeArtifacts(scope)
      .then((res) => {
        if (!cancelled) setDiskScan(res);
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialDiskScan, isOpen, scope]);

  const fallbackDirs = useMemo(
    () => (scope ? resolveFallbackPrimaryDir(scope) : { primaryDir: '' }),
    [scope]
  );

  const primaryDir = diskScan?.primaryDir || fallbackDirs.primaryDir;
  const effectiveWorkspaceCwd = diskScan?.workspaceCwd || fallbackDirs.workspaceCwd;

  const allItems = useMemo(() => {
    if (!scope) return [];
    return buildScopeArtifactEntries(scope, diskScan);
  }, [diskScan, scope]);

  // Default to 'final' tab when final deliverables exist; else show 'all'
  useEffect(() => {
    if (!isOpen) return;
    const hasFinal = allItems.some((item) => item.tier === 'final');
    const hasIntermediate = allItems.some((item) => item.tier === 'intermediate');
    if (hasFinal) {
      setActiveTab('final');
    } else if (hasIntermediate) {
      setActiveTab('intermediate');
    } else {
      setActiveTab('all');
    }
  }, [allItems, isOpen, scope?.scopeId, scope?.scopeType]);

  const moduleOptions = useMemo(() => extractScopeModuleOptions(allItems), [allItems]);

  const finalCount = useMemo(
    () =>
      filterArtifactEntries(allItems, {
        tab: 'final',
        moduleId: selectedModuleId,
        query: searchQuery,
      }).length,
    [allItems, searchQuery, selectedModuleId]
  );

  const intermediateCount = useMemo(
    () =>
      filterArtifactEntries(allItems, {
        tab: 'intermediate',
        moduleId: selectedModuleId,
        query: searchQuery,
      }).length,
    [allItems, searchQuery, selectedModuleId]
  );

  const visibleItems = useMemo(
    () =>
      filterArtifactEntries(allItems, {
        tab: activeTab,
        moduleId: selectedModuleId,
        query: searchQuery,
      }),
    [activeTab, allItems, searchQuery, selectedModuleId]
  );

  const selectedItem = useMemo(() => {
    if (visibleItems.length === 0) return null;
    const match = visibleItems.find((i) => i.id === selectedItemId);
    return match || visibleItems[0];
  }, [selectedItemId, visibleItems]);

  const handleOpenPrimaryDir = async () => {
    const res = await openDirectoryInFileManager(primaryDir, {
      workspaceRoot: effectiveWorkspaceCwd,
      createIfMissing: true,
    });
    setNotice(res);
  };

  const handleRevealItem = async (item: UnifiedArtifactItem) => {
    if (!item.filePath) {
      await handleOpenPrimaryDir();
      return;
    }
    const res = await revealArtifactInFileManager(item.filePath, effectiveWorkspaceCwd);
    setNotice(res);
  };

  const handleCopyDir = async () => {
    if (!primaryDir || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(primaryDir);
      setCopiedDir(true);
      window.setTimeout(() => setCopiedDir(false), 1800);
    } catch {
      // Ignore clipboard write rejection
    }
  };

  const handleTabKeyDown = (currentIndex: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TAB_ITEMS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TAB_ITEMS.length) % TAB_ITEMS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TAB_ITEMS.length - 1;
    }
    if (nextIndex >= 0) {
      e.preventDefault();
      setActiveTab(TAB_ITEMS[nextIndex].id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  if (!isOpen || !scope) {
    return (
      <dialog
        ref={dialogRef}
        className="artifacts-window-dialog rounded-2xl shadow-2xl"
        aria-hidden="true"
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      open={typeof window === 'undefined' ? true : undefined}
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      style={{ width: `${modalWidth}px`, height: 'min(82dvh, 760px)' }}
      className={`artifacts-window-dialog rounded-2xl shadow-2xl ${
        isDragging ? 'select-none' : ''
      }`}
    >
      <div className="relative w-full h-full rounded-2xl">
        <ResizeHandle
          direction="left"
          isDragging={isDragging}
          onPointerDown={(e) => handleResizeStart('left', e)}
          onDoubleClick={toggleWidescreen}
          title="拖拽调整宽度，双击切换宽屏"
        />
        <ResizeHandle
          direction="right"
          isDragging={isDragging}
          onPointerDown={(e) => handleResizeStart('right', e)}
          onDoubleClick={toggleWidescreen}
          title="拖拽调整宽度，双击切换宽屏"
        />

        <div className="w-full h-full flex flex-col rounded-2xl border border-border bg-surface text-fg overflow-hidden">
          {/* 顶部标题栏与文件管理器主 CTA */}
        <header className="px-4 py-3 border-b border-border bg-surface flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30 flex items-center justify-center shrink-0">
              <FolderArchive className="w-4 h-4 text-amber-700 dark:text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-surface-subtle border border-border text-fg-secondary shrink-0">
                  {SCOPE_TYPE_LABELS[scope.scopeType]}
                </span>
                <h2 id={headingId} className="text-sm font-semibold text-fg truncate">
                  产物中心 · {scope.title}
                </h2>
              </div>
              {scope.subtitle && (
                <p className="text-[11px] text-fg-muted truncate mt-0.5">{scope.subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => runScan(scope)}
              disabled={scanning}
              className="px-2.5 py-1.5 rounded-lg bg-surface-subtle border border-border hover:bg-surface-hover text-xs font-medium text-fg-secondary hover:text-fg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
              title="重新扫描目录与会话产物"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">刷新扫描</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPrimaryDir}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span>在文件管理器中打开目录</span>
            </button>

            <button
              type="button"
              onClick={toggleWidescreen}
              className="p-1.5 rounded-lg bg-surface-subtle border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg cursor-pointer transition-colors"
              title={isWidescreen ? '恢复标准窗口宽度' : '切换宽屏布局'}
              aria-label={isWidescreen ? '恢复标准窗口宽度' : '切换宽屏布局'}
            >
              {isWidescreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
              title="关闭产物窗口"
              aria-label="关闭产物窗口"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 物理目录路径条 */}
        <div className="px-4 py-1.5 border-b border-border bg-canvas/60 flex items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-fg-muted shrink-0">产物目录:</span>
            <code
              className="font-mono text-fg-secondary truncate select-text"
              title={primaryDir}
            >
              {primaryDir}
            </code>
          </div>
          <button
            type="button"
            onClick={handleCopyDir}
            className="px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-hover text-fg-secondary hover:text-fg flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
          >
            {copiedDir ? (
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span>{copiedDir ? '已复制' : '复制路径'}</span>
          </button>
        </div>

        {/* 操作反馈 / Web 模式引导提示 */}
        {notice && (
          <div
            className={`px-4 py-2 border-b text-xs flex items-center justify-between gap-2 shrink-0 ${
              notice.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-200'
                : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-200'
            }`}
          >
            <span className="break-all">{notice.message}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
              aria-label="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 标签切换与搜索栏 */}
        <div className="border-b border-border bg-surface-subtle shrink-0">
          <div className="px-4 flex items-center justify-between gap-3 flex-wrap">
            <div
              role="tablist"
              aria-label="产物分类"
              className="flex items-center flex-nowrap gap-1 overflow-x-auto"
            >
              {TAB_ITEMS.map((tab, idx) => {
                const isSelected = activeTab === tab.id;
                const badgeCount =
                  tab.id === 'final'
                    ? finalCount
                    : tab.id === 'intermediate'
                      ? intermediateCount
                      : finalCount + intermediateCount;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabRefs.current[idx] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(idx, e)}
                    className={`artifacts-tab px-3 py-2.5 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'text-fg font-semibold'
                        : 'text-fg-muted hover:text-fg-secondary'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono border ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                          : 'bg-surface text-fg-muted border-border'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="py-1.5 flex-1 min-w-[200px] max-w-xs">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2.5 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索产物文件名、模块或摘要..."
                  aria-label="搜索产物"
                  className="w-full pl-8 pr-3 py-1 rounded-lg bg-surface border border-border text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {moduleOptions.length > 0 && (
            <div className="px-4 py-2 border-t border-border/70 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-fg-muted shrink-0">模块筛选:</span>
              <button
                type="button"
                onClick={() => setSelectedModuleId('all')}
                className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition-colors ${
                  selectedModuleId === 'all'
                    ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40 font-medium'
                    : 'bg-surface text-fg-secondary border-border hover:bg-surface-hover'
                }`}
              >
                全部 ({allItems.length})
              </button>
              {moduleOptions.map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setSelectedModuleId(mod.id)}
                  className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition-colors ${
                    selectedModuleId === mod.id
                      ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40 font-medium'
                      : 'bg-surface text-fg-secondary border-border hover:bg-surface-hover'
                  }`}
                >
                  {mod.label} ({mod.count})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 主体双栏区：左侧产物清单 + 右侧内嵌预览面板 */}
        <div
          role="tabpanel"
          aria-label="产物内容区"
          className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden"
        >
          <div className="w-full sm:w-[320px] md:w-[360px] shrink-0 border-b sm:border-b-0 sm:border-r border-border bg-canvas/50 overflow-y-auto p-3 space-y-2 max-h-[42%] sm:max-h-none">
            {visibleItems.length === 0 ? (
              <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center p-4 space-y-2">
                <FolderArchive className="w-7 h-7 text-fg-muted opacity-70" />
                <p className="text-xs font-medium text-fg-secondary">
                  当前分类下暂无产物
                </p>
                <p className="text-[11px] text-fg-muted">
                  可切换「全部产物」或点击右上角打开本地产物目录查看磁盘文件。
                </p>
              </div>
            ) : (
              visibleItems.map((item) => (
                <ArtifactListItem
                  key={item.id}
                  item={item}
                  isSelected={selectedItem?.id === item.id}
                  onSelect={(selected) => setSelectedItemId(selected.id)}
                  onRevealFile={handleRevealItem}
                />
              ))
            )}
          </div>

          <ArtifactPreviewPane
            item={selectedItem}
            primaryDir={primaryDir}
            workspaceCwd={effectiveWorkspaceCwd}
            onOpenPrimaryDir={handleOpenPrimaryDir}
            onRevealFile={handleRevealItem}
          />
          </div>
        </div>
      </div>
    </dialog>
  );
};
