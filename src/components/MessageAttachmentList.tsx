import React from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { MessageAttachment } from '../types';
import { formatAttachmentSize } from '../services/chatAttachmentService';

interface MessageAttachmentListProps {
  attachments?: MessageAttachment[];
}

export const MessageAttachmentList: React.FC<MessageAttachmentListProps> = ({
  attachments = [],
}) => {
  if (attachments.length === 0) return null;

  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const files = attachments.filter((attachment) => attachment.kind === 'file');

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) =>
            attachment.previewDataUrl ? (
              <a
                key={attachment.id}
                href={attachment.previewDataUrl}
                target="_blank"
                rel="noreferrer"
                className="group/image block overflow-hidden rounded-xl border border-border bg-surface-subtle"
                title={`${attachment.name} · ${attachment.mimeType}`}
              >
                <img
                  src={attachment.previewDataUrl}
                  alt={attachment.name}
                  className="max-h-64 max-w-full object-contain transition-transform group-hover/image:scale-[1.01]"
                />
                <div className="max-w-[280px] truncate border-t border-border px-2.5 py-1.5 text-[10px] text-fg-secondary">
                  {attachment.name}
                </div>
              </a>
            ) : (
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
            )
          )}
        </div>
      )}

      {files.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {files.map((attachment) => (
            <div
              key={attachment.id}
              className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface-subtle px-3 py-2.5"
              title={attachment.path || attachment.uri || attachment.name}
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
          ))}
        </div>
      )}
    </div>
  );
};
