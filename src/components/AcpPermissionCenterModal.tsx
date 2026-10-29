import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { AcpPermissionGrant, Agent } from '../types';
import {
  listAcpPermissionGrants,
  revokeAcpPermissionGrant,
  revokeAllAcpPermissionGrants,
} from '../services/acpPermissionClient';

interface AcpPermissionCenterModalProps {
  isOpen: boolean;
  agents: Agent[];
  onClose: () => void;
}

const SCOPE_LABELS: Record<AcpPermissionGrant['scopeType'], string> = {
  channel: 'Channel',
  topic: 'Topic',
  dm: 'DM',
  dm_topic: 'DM Topic',
};

const CAPABILITY_LABELS: Record<AcpPermissionGrant['capability'], string> = {
  'fs.read': '读取文件',
  'fs.write': '写入文件',
  'fs.delete': '删除文件',
  'shell.execute': '执行 Shell',
  'network.access': '访问网络',
  other: '其他工具操作',
};

export const AcpPermissionCenterModal: React.FC<AcpPermissionCenterModalProps> = ({
  isOpen,
  agents,
  onClose,
}) => {
  const [grants, setGrants] = useState<AcpPermissionGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  );

  const load = async () => {
    if (!isOpen || loading) return;
    setLoading(true);
    setError(null);
    try {
      setGrants(await listAcpPermissionGrants());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setConfirmRevokeAll(false);
      return;
    }
    void load();
  }, [isOpen]);

  if (!isOpen) return null;

  const revokeOne = async (grantId: string) => {
    setError(null);
    try {
      const removed = await revokeAcpPermissionGrant(grantId);
      if (removed) {
        setGrants((prev) => prev.filter((grant) => grant.id !== grantId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const revokeAll = async () => {
    if (!confirmRevokeAll) {
      setConfirmRevokeAll(true);
      return;
    }
    setError(null);
    try {
      await revokeAllAcpPermissionGrants();
      setGrants([]);
      setConfirmRevokeAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold">执行权限中心</h2>
              <p className="mt-0.5 text-[11px] text-fg-secondary">
                管理本地 ACP Agent 的持久 Channel / Topic / DM 授权
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-border bg-surface p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              title="刷新授权列表"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-[11px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          {grants.length === 0 && !loading ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface-subtle px-5 py-12 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-fg-muted" />
              <div className="mt-3 text-sm font-semibold text-fg">暂无持久授权</div>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-fg-muted">
                ACP 请求权限时选择“当前 Session / Channel / Topic / DM 始终允许”后，会在此处出现。临时 Session Grant 不会持久化。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {grants.map((grant) => {
                const agent = agentMap.get(grant.agentId);
                return (
                  <div
                    key={grant.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-subtle px-3.5 py-3"
                  >
                    <span className="text-lg">{agent?.avatar || '🤖'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-fg">
                        {agent?.name || grant.agentId}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300">
                          {CAPABILITY_LABELS[grant.capability] || grant.capability}
                        </span>
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-fg-secondary">
                          {SCOPE_LABELS[grant.scopeType] || grant.scopeType}: {grant.scopeId}
                        </span>
                        <span className="font-mono text-fg-muted">
                          Binding: {grant.workspaceBindingId || '(DM Agent Root)'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeOne(grant.id)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-semibold text-rose-800 transition-colors hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      撤销
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-4">
          <p className="text-[10px] text-fg-muted">
            Grant 只匹配同一 Agent、作用域、Binding 与 Capability。
          </p>
          <button
            type="button"
            disabled={grants.length === 0}
            onClick={() => void revokeAll()}
            className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
          >
            {confirmRevokeAll ? '确认撤销全部授权' : '撤销全部授权'}
          </button>
        </div>
      </div>
    </div>
  );
};
