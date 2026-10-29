import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileCode2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import {
  AcpPermissionCapability,
  AcpPermissionDecision,
  AcpPermissionRequest,
  Agent,
} from '../types';

interface AcpPermissionModalProps {
  request: AcpPermissionRequest;
  agent?: Agent;
  queuedCount?: number;
  onDecision: (decision: AcpPermissionDecision) => Promise<void>;
}

const CAPABILITY_META: Record<
  AcpPermissionCapability,
  { label: string; detail: string; danger: boolean }
> = {
  'fs.read': {
    label: '读取文件',
    detail: 'Agent 将读取目标文件内容并将其纳入当前上下文。',
    danger: false,
  },
  'fs.write': {
    label: '写入文件',
    detail: 'Agent 将修改或创建工作区文件。',
    danger: true,
  },
  'fs.delete': {
    label: '删除文件',
    detail: 'Agent 将删除或移动工作区文件。',
    danger: true,
  },
  'shell.execute': {
    label: '执行 Shell',
    detail: '命令可以读写文件、访问网络或启动子进程，风险高于普通文件写入。',
    danger: true,
  },
  'network.access': {
    label: '访问网络',
    detail: 'Agent 将向外部端点发起网络请求。',
    danger: true,
  },
  other: {
    label: '其他工具操作',
    detail: 'Shadow Crew 未能识别该工具的精确风险，请核对原始参数。',
    danger: true,
  },
};

function getScopeLabel(request: AcpPermissionRequest): string {
  switch (request.scopeType) {
    case 'channel':
      return '当前 Channel';
    case 'topic':
      return '当前 Channel Topic';
    case 'dm':
      return '当前 DM';
    case 'dm_topic':
      return '当前 DM Topic';
    default:
      return '当前会话';
  }
}

export const AcpPermissionModal: React.FC<AcpPermissionModalProps> = ({
  request,
  agent,
  queuedCount = 0,
  onDecision,
}) => {
  const [submitting, setSubmitting] = useState<AcpPermissionDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capability = CAPABILITY_META[request.capability] || CAPABILITY_META.other;
  const scopeLabel = getScopeLabel(request);
  const reusableAllowed =
    request.supportsAllowOnce &&
    request.outsideWorkspacePaths.length === 0 &&
    request.capability !== 'other';

  const decide = async (decision: AcpPermissionDecision) => {
    if (submitting) return;
    setSubmitting(decision);
    setError(null);
    try {
      await onDecision(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl text-fg">
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                capability.danger
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300'
              }`}
            >
              {capability.danger ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold">ACP 工具执行授权</h2>
              <p className="mt-1 text-[11px] text-fg-secondary">
                {agent?.name || request.agentId} 请求在{scopeLabel}执行操作
              </p>
            </div>
          </div>
          {queuedCount > 0 && (
            <span className="shrink-0 rounded-full border border-purple-300 bg-purple-50 px-2 py-1 text-[10px] font-semibold text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300">
              后续 {queuedCount} 项
            </span>
          )}
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-1 text-[10px] font-mono text-fg-secondary">
              {capability.label}
            </span>
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-1 text-[10px] font-mono text-fg-muted">
              {request.toolName} · {request.toolKind}
            </span>
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-1 text-[10px] font-mono text-fg-muted">
              {scopeLabel} · {request.scopeId}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-2.5">
            <div className="text-[10px] font-semibold text-fg-muted">Workspace Binding</div>
            <div className="mt-1 break-all font-mono text-[10px] text-fg-secondary">
              {request.workspaceBindingId || '(DM Agent Root)'} · {request.cwd}
            </div>
          </div>

          <div
            className={`rounded-xl border px-3.5 py-3 text-[11px] leading-relaxed ${
              capability.danger
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
            }`}
          >
            {request.description || capability.detail}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-fg">请求操作</div>
            <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
              <div className="text-xs font-semibold text-fg">
                {request.toolTitle || request.toolName}
              </div>
              {request.command && (
                <div className="mt-2 rounded-lg border border-border bg-canvas p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-fg-muted">
                    <Terminal className="h-3.5 w-3.5" />
                    命令
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-fg-secondary">
                    {request.command}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {request.paths.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-fg">
                <FileCode2 className="h-3.5 w-3.5 text-fg-muted" />
                目标路径
              </div>
              <div className="space-y-1 rounded-xl border border-border bg-surface-subtle p-2.5">
                {request.paths.map((path) => (
                  <div
                    key={path}
                    className="break-all rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[10px] text-fg-secondary"
                  >
                    {path}
                  </div>
                ))}
              </div>
            </div>
          )}

          {request.outsideWorkspacePaths.length > 0 && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                目标超出当前 Workspace Binding
              </div>
              <div className="mt-1.5 space-y-1 font-mono text-[10px]">
                {request.outsideWorkspacePaths.map((path) => (
                  <div key={path} className="break-all">
                    {path}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed">
                此操作仅允许单次放行或拒绝，不能保存为 Scope Grant。
              </p>
            </div>
          )}

          <details className="rounded-xl border border-border bg-surface-subtle px-3 py-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-fg-secondary">
              ACP 原始选项（{request.options.length}）
            </summary>
            <div className="mt-2 space-y-1">
              {request.options.map((option) => (
                <div
                  key={option.optionId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-[10px]"
                >
                  <span className="font-semibold text-fg-secondary">{option.name || option.optionId}</span>
                  <span className="font-mono text-fg-muted">
                    {option.optionId} · {option.kind || 'unknown'}
                  </span>
                </div>
              ))}
            </div>
          </details>

          {!request.supportsAllowOnce && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-[10px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              ACP 端点未提供安全的 `allow_once` 选项。Shadow Crew 不会猜测其他允许选项，只能拒绝。
            </div>
          )}

          {request.capability === 'other' && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[10px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              未识别工具的权限边界不明确，只能单次允许或拒绝，不能保存为 Session / Scope Grant。
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-[10px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4">
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => void decide('deny')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {submitting === 'deny' ? '拒绝中...' : '拒绝'}
          </button>
          <button
            type="button"
            disabled={Boolean(submitting) || !request.supportsAllowOnce}
            onClick={() => void decide('allow_once')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300"
          >
            <Check className="h-3.5 w-3.5" />
            {submitting === 'allow_once' ? '放行中...' : '允许一次'}
          </button>
          <button
            type="button"
            disabled={Boolean(submitting) || !reusableAllowed}
            onClick={() => void decide('allow_session')}
            className="rounded-xl border border-purple-300 bg-purple-50 px-3.5 py-2 text-xs font-semibold text-purple-800 transition-colors hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300"
          >
            本次 Session 始终允许
          </button>
          <button
            type="button"
            disabled={Boolean(submitting) || !reusableAllowed}
            onClick={() => void decide('allow_scope')}
            className="rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            在{scopeLabel}始终允许此能力
          </button>
        </div>
      </div>
    </div>
  );
};
