import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Trash2,
  Download,
  ShieldCheck,
  RefreshCw,
  FileText,
  Database,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import {
  StorageStats,
  getStorageStats,
  clearSafeCache,
  clearAllMessagesFromDb,
  exportMessagesAsJsonFile,
  formatBytes,
} from '../services/dbClient';
import { Message } from '../types';

interface StorageSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  onMessagesCleared?: () => void;
  onOpenMemoryExport?: () => void;
}

export const StorageSettingsModal: React.FC<StorageSettingsModalProps> = ({
  isOpen,
  onClose,
  messages,
  onMessagesCleared,
  onOpenMemoryExport,
}) => {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmClearMessages, setConfirmClearMessages] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await getStorageStats();
      setStats(data);
    } catch (e) {
      console.error('Failed to load storage stats:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStats();
      setConfirmClearMessages(false);
    }
  }, [isOpen]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  const handleClearSafeCache = async () => {
    setCleaning(true);
    try {
      const { freedBytes } = await clearSafeCache();
      showToast(`已成功释放 ${formatBytes(freedBytes || 1024 * 1024)} 安全缓存！`);
      await loadStats();
    } catch (err) {
      showToast('清理缓存失败，请检查控制台');
    } finally {
      setCleaning(false);
    }
  };

  const handleExportMessages = () => {
    exportMessagesAsJsonFile(messages);
    showToast(`已导出 ${messages.length} 条会话历史至 JSON 备份`);
  };

  const handleClearHistory = async () => {
    if (!confirmClearMessages) {
      setConfirmClearMessages(true);
      return;
    }
    setCleaning(true);
    try {
      await clearAllMessagesFromDb();
      if (onMessagesCleared) {
        onMessagesCleared();
      }
      showToast('已清空所有历史对话记录，核心记忆已完好保留');
      setConfirmClearMessages(false);
      await loadStats();
    } catch (err) {
      showToast('清空消息失败');
    } finally {
      setCleaning(false);
    }
  };

  const handleResetUiLayout = () => {
    try {
      const keysToClear = [
        'shinobi_sidebar_width',
        'shinobi_drawer_width',
        'shinobi_new_topic_modal_width',
      ];
      keysToClear.forEach((k) => localStorage.removeItem(k));
      showToast('已重置界面面板布局，下次打开各抽屉将恢复默认宽度');
      loadStats();
    } catch {}
  };

  if (!isOpen) return null;

  const totalBytes =
    (stats?.safeCleanableBytes || 0) +
    (stats?.archivableBytes || 0) +
    (stats?.protectedBytes || 0);

  const safePercent = totalBytes > 0 ? ((stats?.safeCleanableBytes || 0) / totalBytes) * 100 : 0;
  const archivablePercent =
    totalBytes > 0 ? ((stats?.archivableBytes || 0) / totalBytes) * 100 : 0;
  const protectedPercent =
    totalBytes > 0 ? ((stats?.protectedBytes || 0) / totalBytes) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col text-xs text-fg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-surface border border-border flex items-center justify-center text-accent shadow-xs">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-fg tracking-tight">
                  存储架构与缓存管理 (Storage & Cache)
                </h2>
                {stats?.isNativeTauri && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-500 font-mono border border-emerald-500/20">
                    SQLite 原生引擎
                  </span>
                )}
              </div>
              <p className="text-[11px] text-fg-secondary">
                基于 Rust 宿主 SQLite + 日志安全轮转，彻底消除 5MB 配额限制
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadStats}
              disabled={loading}
              className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
              title="刷新存储指标"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-accent' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast Feedback */}
        {toastMsg && (
          <div className="bg-accent/15 border-b border-accent/20 px-6 py-2 flex items-center gap-2 text-accent text-[11px] animate-in fade-in duration-150">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Main Body */}
        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* 1. 全局用量可视化看板 (Storage Health Bar) */}
          <div className="bg-surface-subtle p-4 rounded-2xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-fg-muted text-[11px]">总已用存储容量</span>
                <div className="text-lg font-bold text-fg flex items-baseline gap-1.5 font-mono">
                  <span>{formatBytes(totalBytes)}</span>
                  <span className="text-[10px] font-normal text-fg-muted">
                    (含 SQLite 库、日志与本地缓存)
                  </span>
                </div>
              </div>
              <button
                onClick={handleClearSafeCache}
                disabled={cleaning || (stats?.safeCleanableBytes || 0) === 0}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>一键清理安全缓存 ({formatBytes(stats?.safeCleanableBytes || 0)})</span>
              </button>
            </div>

            {/* 3-Color Progress Bar */}
            <div className="w-full h-3 bg-surface rounded-full overflow-hidden flex border border-border">
              <div
                style={{ width: `${Math.max(safePercent, 3)}%` }}
                className="bg-emerald-500 h-full transition-all duration-300"
                title={`可安全清理缓存: ${formatBytes(stats?.safeCleanableBytes || 0)} (${safePercent.toFixed(1)}%)`}
              />
              <div
                style={{ width: `${Math.max(archivablePercent, 3)}%` }}
                className="bg-amber-500 h-full transition-all duration-300"
                title={`会话与协作历史: ${formatBytes(stats?.archivableBytes || 0)} (${archivablePercent.toFixed(1)}%)`}
              />
              <div
                style={{ width: `${Math.max(protectedPercent, 3)}%` }}
                className="bg-accent h-full transition-all duration-300"
                title={`受保护核心记忆: ${formatBytes(stats?.protectedBytes || 0)} (${protectedPercent.toFixed(1)}%)`}
              />
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between text-[11px] pt-1 text-fg-muted">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span>可安全清理缓存 ({formatBytes(stats?.safeCleanableBytes || 0)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <span>会话与讨论历史 ({formatBytes(stats?.archivableBytes || 0)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent shrink-0" />
                <span>受保护核心记忆 ({formatBytes(stats?.protectedBytes || 0)})</span>
              </div>
            </div>
          </div>

          {/* 2. 细粒度分类卡片 */}
          <div className="space-y-3">
            {/* 卡片 A: 可安全清理项 (Safe Clean) 🟢 */}
            <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-bold text-xs text-fg">
                    ACP 进程运行日志与临时 Scratch 缓存
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-mono">
                    🟢 完全安全 · 随时可清
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-400">
                  {formatBytes(stats?.logsSizeBytes || 0)}
                </span>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">
                包含子进程 Stdio 管道交互日志、工具临时输出转储与 SQLite WAL 压缩空间。清空后不影响任何业务逻辑，日志文件将自动滚动。
              </p>
              <div className="flex items-center justify-between pt-1 text-[10px] text-fg-secondary">
                <span className="font-mono truncate max-w-sm" title={stats?.logsPath}>
                  日志路径: {stats?.logsPath}
                </span>
                <button
                  onClick={handleClearSafeCache}
                  disabled={cleaning || (stats?.logsSizeBytes || 0) === 0}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-emerald-500/50 text-fg hover:text-emerald-400 text-xs transition-colors cursor-pointer disabled:opacity-40"
                >
                  清空日志与 WAL
                </button>
              </div>
            </div>

            {/* 卡片 B: 会话与协作历史 (Archivable History) 🟡 */}
            <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-bold text-xs text-fg">
                    频道、话题会话与 Diff 审查历史
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-400 font-mono">
                    🟡 半持久化 · 建议先导出备份
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-amber-400">
                  {stats?.totalMessagesCount || messages.length} 条消息 (
                  {formatBytes(stats?.archivableBytes || 0)})
                </span>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">
                记录多 Agent 协同思考链、决策记录、MCP 工具执行输出与代码提案。现已完全持久化在 SQLite 中，不再受浏览器 5MB 限制。
              </p>
              <div className="flex items-center justify-between pt-1 gap-2">
                <span className="text-[10px] text-fg-secondary">
                  建议定期导出 JSON 归档后按需清理
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportMessages}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-amber-500/50 text-fg hover:text-amber-400 text-xs transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>导出全量 JSON 备份</span>
                  </button>
                  <button
                    onClick={handleClearHistory}
                    disabled={cleaning || (stats?.totalMessagesCount || 0) === 0}
                    className={`px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${
                      confirmClearMessages
                        ? 'bg-rose-500 text-white border-rose-600 font-bold animate-pulse'
                        : 'bg-surface border-border hover:border-rose-500/50 text-fg-muted hover:text-rose-400'
                    }`}
                  >
                    {confirmClearMessages ? '确认彻底清空历史?' : '清空历史'}
                  </button>
                </div>
              </div>
            </div>

            {/* 卡片 C: Agent 私有长期记忆 (Protected Core) 🛡️ */}
            <div className="p-4 rounded-2xl border border-accent/20 bg-accent/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-accent" />
                  <span className="font-bold text-xs text-fg">
                    Agent 替身专属长期记忆库 (Memory Bank)
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-accent/20 text-accent font-mono">
                    🛡️ 受保护核心资产 · 严禁盲删
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-accent">
                  {stats?.totalMemoriesCount || 0} 条沉淀记忆 (
                  {formatBytes(stats?.protectedBytes || 0)})
                </span>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">
                保存在 SQLite 的 <code>acp_memories</code> 表中，记录了主人的代码命名习惯、工程规约与踩坑备忘。即便切换频道或重置历史，该层资产永久存在。
              </p>
              <div className="flex items-center justify-between pt-1 text-[10px] text-fg-secondary">
                <span className="font-mono truncate max-w-sm" title={stats?.databasePath}>
                  数据库: {stats?.databasePath}
                </span>
                {onOpenMemoryExport && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenMemoryExport();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-accent text-accent text-xs transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Sliders className="w-3 h-3" />
                    <span>记忆卡带导出/导入 (.acpmem)</span>
                  </button>
                )}
              </div>
            </div>

            {/* 卡片 D: 浏览器 LocalStorage 偏好配置 (UI Preferences) */}
            <div className="p-4 rounded-2xl border border-border bg-surface-subtle space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-fg flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-fg-muted" />
                  <span>UI 布局与偏好缓存 (LocalStorage)</span>
                </span>
                <span className="font-mono text-xs text-fg-muted">
                  {formatBytes(stats?.localStorageUsageBytes || 0)} / ~5 MB (
                  {(
                    ((stats?.localStorageUsageBytes || 0) / (5 * 1024 * 1024)) *
                    100
                  ).toFixed(1)}
                  %)
                </span>
              </div>
              <p className="text-[11px] text-fg-secondary">
                目前仅存放主题设置、面板拖拽宽度与当前选中的项目 ID。聊天消息已脱离此区，彻底远离 Quota 熔断上限。
              </p>
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleResetUiLayout}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-fg-muted text-fg text-xs transition-colors cursor-pointer"
                >
                  重置面板尺寸偏好
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-border bg-surface-subtle flex items-center justify-between">
          <span className="text-[11px] text-fg-muted flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>SQLite 数据库引擎已开启 WAL 机制，支持多 Agent 高并发无锁读写</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover text-fg text-xs font-semibold transition-colors cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
