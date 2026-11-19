import React from 'react';
import { Eye, FileText, Image as ImageIcon } from 'lucide-react';
import { MessageAttachment } from '../types';
import { formatAttachmentSize } from '../services/chatAttachmentService';
import { useFilePreview } from '../context/FilePreviewContext';

interface MessageAttachmentListProps {
  attachments?: MessageAttachment[];
  workspaceRoot?: string;
}

export const MessageAttachmentList: React.FC<MessageAttachmentListProps> = ({
  attachments = [],
  workspaceRoot,
}) => {
  const { openFilePreview } = useFilePreview();

  if (attachments.length === 0) return null;

  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const files = attachments.filter((attachment) => attachment.kind === 'file');

  const handleOpenAttachment = (attachment: MessageAttachment) => {
    const rawPath = attachment.path || attachment.uri || attachment.name;
    if (!rawPath) return;
    openFilePreview({
      rawPath,
      workspaceRoot,
      previewDataUrl: attachment.previewDataUrl,
      displayName: attachment.name,
      mimeType: attachment.mimeType,
    });
  };

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => {
            const hasTarget = Boolean(attachment.path || attachment.uri || attachment.previewDataUrl);
            if (attachment.previewDataUrl) {
              return (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => handleOpenAttachment(attachment)}
                  className="group/image block text-left overflow-hidden rounded-xl border border-border bg-surface-subtle hover:border-accent/50 transition-colors cursor-pointer"
                  title={`点击预览图片: ${attachment.name} · ${attachment.mimeType}`}
                >
                  <img
                    src={attachment.previewDataUrl}
                    alt={attachment.name}
                    className="max-h-64 max-w-full object-contain transition-transform group-hover/image:scale-[1.01]"
                  />
                  <div className="max-w-[280px] flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5 text-[10px] text-fg-secondary">
                    <span className="truncate">{attachment.name}</span>
                    <Eye className="w-3 h-3 text-fg-muted group-hover/image:text-accent shrink-0 transition-colors" />
                  </div>
                </button>
              );
            }

            if (hasTarget) {
              return (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => handleOpenAttachment(attachment)}
                  className="group/image flex min-w-[180px] items-center gap-2 rounded-xl border border-border bg-surface-subtle hover:bg-surface-hover hover:border-accent/40 px-3 py-2 text-left transition-colors cursor-pointer"
                  title={`点击预览图片: ${attachment.path || attachment.uri || attachment.name}`}
                >
                  <ImageIcon className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-fg group-hover/image:text-accent transition-colors">
                      {attachment.name}
                    </div>
                    <div className="text-[9px] font-mono text-fg-muted">{attachment.mimeType}</div>
                  </div>
                  <Eye className="h-3.5 w-3.5 text-fg-muted group-hover/image:text-accent shrink-0 transition-colors" />
                </button>
              );
            }

            return (
              <div
                key={attachment.id}
                className="flex min-w-[180px] items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3 py-2"
              >
                <ImageIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold text-fg">{attachment.name}</div>
                  <div className="text-[9px] font-mono text-fg-muted">{attachment.mimeType}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {files.map((attachment) => {
            const rawPath = attachment.path || attachment.uri;
            if (rawPath) {
              return (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => handleOpenAttachment(attachment)}
                  className="group/file flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface-subtle hover:bg-surface-hover hover:border-accent/40 px-3 py-2.5 text-left transition-colors cursor-pointer"
                  title={`点击预览文件: ${rawPath}`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted group-hover/file:text-accent group-hover/file:border-accent/30 transition-colors">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-fg group-hover/file:text-accent transition-colors">
                      {attachment.name}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] font-mono text-fg-muted">
                      {attachment.mimeType} · {formatAttachmentSize(attachment.size)}
                    </div>
                  </div>
                  <Eye className="h-3.5 w-3.5 text-fg-muted group-hover/file:text-accent shrink-0 transition-colors" />
                </button>
              );
            }

            return (
              <div
                key={attachment.id}
                className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface-subtle px-3 py-2.5"
                title={attachment.name}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold text-fg">{attachment.name}</div>
                  <div className="mt-0.5 truncate text-[9px] font-mono text-fg-muted">
                    {attachment.mimeType} · {formatAttachmentSize(attachment.size)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
