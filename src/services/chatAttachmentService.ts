import {
  MessageAttachment,
  MessageAttachmentInput,
  MessageAttachmentKind,
} from '../types';
import { getTauriInvoke } from './dbClient';

export const MAX_MESSAGE_ATTACHMENTS = 6;
export const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

function resolveImageMime(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime in { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true }) {
    return mime;
  }
  return IMAGE_MIME_BY_EXTENSION[extensionOf(file.name)] || '';
}

function hasExpectedImageMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    return bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8');
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function prepareMessageAttachments(
  files: File[],
  existing: { count?: number; bytes?: number } = {}
): Promise<MessageAttachmentInput[]> {
  const existingCount = existing.count || 0;
  if (files.length + existingCount > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`单条消息最多添加 ${MAX_MESSAGE_ATTACHMENTS} 个附件`);
  }

  let totalBytes = existing.bytes || 0;
  const prepared: MessageAttachmentInput[] = [];
  for (const file of files) {
    const imageMime = resolveImageMime(file);
    if (file.type.startsWith('image/') && !imageMime) {
      throw new Error(
        `不支持图片格式: ${file.name}。仅支持 PNG / JPEG / WebP / GIF`
      );
    }
    const kind: MessageAttachmentKind = imageMime ? 'image' : 'file';
    const limit = kind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_FILE_ATTACHMENT_BYTES;
    if (file.size <= 0) {
      throw new Error(`附件 ${file.name} 为空文件`);
    }
    if (file.size > limit) {
      throw new Error(
        `${kind === 'image' ? '图片' : '文件'} ${file.name} 超过 ${formatAttachmentSize(limit)} 上限`
      );
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(`单条消息附件总大小不能超过 ${formatAttachmentSize(MAX_TOTAL_ATTACHMENT_BYTES)}`);
    }

    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = kind === 'image' ? imageMime : file.type || 'application/octet-stream';
    if (kind === 'image' && !hasExpectedImageMagic(new Uint8Array(buffer), mimeType)) {
      throw new Error(`图片 ${file.name} 的文件头与 MIME 类型不一致`);
    }

    prepared.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      kind,
      name: file.name || (kind === 'image' ? 'pasted-image' : 'attachment'),
      mimeType,
      size: file.size,
      dataBase64: base64,
      ...(kind === 'image'
        ? { previewDataUrl: `data:${mimeType};base64,${base64}` }
        : {}),
    });
  }
  return prepared;
}

export async function persistMessageAttachments(options: {
  scopeType: 'channel' | 'topic' | 'dm' | 'dm_topic';
  scopeId: string;
  messageId: string;
  attachments: MessageAttachmentInput[];
}): Promise<MessageAttachment[]> {
  if (options.attachments.length === 0) return [];
  const invoke = getTauriInvoke();
  if (!invoke) {
    return options.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      previewDataUrl: attachment.previewDataUrl,
    }));
  }

  const stored = (await invoke('save_chat_attachments', {
    scopeType: options.scopeType,
    scopeId: options.scopeId,
    messageId: options.messageId,
    attachments: options.attachments.map(
      ({ previewDataUrl: _previewDataUrl, ...attachment }) => attachment
    ),
  })) as Array<Omit<MessageAttachment, 'previewDataUrl'>>;

  return stored.map((attachment) => {
    const source = options.attachments.find((item) => item.id === attachment.id);
    return {
      ...attachment,
      previewDataUrl: source?.previewDataUrl,
    };
  });
}

export function getAttachmentTotalBytes(
  attachments: Array<{ size?: number; file?: { size: number } }>
): number {
  return attachments.reduce(
    (total, attachment) => total + (attachment.size ?? attachment.file?.size ?? 0),
    0
  );
}

export function buildAttachmentManifest(
  attachments: Array<Pick<MessageAttachment, 'kind' | 'name' | 'mimeType' | 'size'>>
): string {
  if (attachments.length === 0) return '';
  return [
    '',
    '',
    '[本轮附件]',
    ...attachments.map(
      (attachment, index) =>
        `${index + 1}. ${attachment.kind === 'image' ? '图片' : '文件'}: ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`
    ),
    '请直接分析这些附件；文件内容由 ACP content blocks 同步提供。',
  ].join('\n');
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
