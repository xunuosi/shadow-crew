import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageAttachmentList } from '../components/MessageAttachmentList';
import { INITIAL_AGENTS } from '../data/mockData';
import { sendPromptToAcpAgent } from './acpClient';
import {
  MAX_MESSAGE_ATTACHMENTS,
  buildAttachmentManifest,
  formatAttachmentSize,
  getAttachmentTotalBytes,
  persistMessageAttachments,
  prepareMessageAttachments,
} from './chatAttachmentService';

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const image = new File([pngBytes], 'screen.png', { type: 'image/png' });
const textFile = new File(['hello from attachment'], 'notes.md', {
  type: 'text/markdown',
});

const prepared = await prepareMessageAttachments([image, textFile]);
assert.equal(prepared.length, 2);
assert.equal(prepared[0].kind, 'image');
assert.equal(prepared[0].mimeType, 'image/png');
assert(prepared[0].previewDataUrl?.startsWith('data:image/png;base64,'));
assert.equal(prepared[1].kind, 'file');
assert.equal(prepared[1].mimeType, 'text/markdown');
assert.equal(getAttachmentTotalBytes(prepared), image.size + textFile.size);
assert.equal(formatAttachmentSize(1024), '1.0 KB');

const manifest = buildAttachmentManifest(prepared);
assert(manifest.includes('[本轮附件]'));
assert(manifest.includes('图片: screen.png'));
assert(manifest.includes('文件: notes.md'));

const webFallback = await persistMessageAttachments({
  scopeType: 'channel',
  scopeId: 'channel-1',
  messageId: 'msg-1',
  attachments: prepared,
});
assert.equal(webFallback.length, 2);
assert.equal(webFallback[0].previewDataUrl, prepared[0].previewDataUrl);
assert.equal(webFallback[0].path, undefined);

const rendered = renderToStaticMarkup(
  React.createElement(MessageAttachmentList, {
    attachments: [
      {
        id: 'img-render',
        kind: 'image',
        name: 'screen.png',
        mimeType: 'image/png',
        size: 10,
        previewDataUrl: prepared[0].previewDataUrl,
      },
      {
        id: 'file-render',
        kind: 'file',
        name: 'notes.md',
        mimeType: 'text/markdown',
        size: textFile.size,
        path: '/tmp/notes.md',
      },
    ],
  })
);
assert(rendered.includes('screen.png'));
assert(rendered.includes('data:image/png;base64'));
assert(rendered.includes('notes.md'));
assert(rendered.includes('text/markdown'));

const remoteAttachmentResponse = await sendPromptToAcpAgent({
  agent: {
    ...INITIAL_AGENTS[0],
    status: 'running',
    isRemote: true,
    acpTransport: 'websocket',
    remoteUrl: 'ws://127.0.0.1:65535',
  },
  roomId: 'thread-remote',
  prompt: 'remote attachment',
  scopeType: 'dm',
  attachments: [
    {
      id: 'remote-file',
      kind: 'file',
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: textFile.size,
      path: '/tmp/notes.md',
      uri: 'file:///tmp/notes.md',
    },
  ],
});
assert.equal(remoteAttachmentResponse.isError, true);
assert(remoteAttachmentResponse.textResponse.includes('远程 ACP 附件同步尚未实现'));

await assert.rejects(
  () =>
    prepareMessageAttachments([
      new File([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], 'evil.svg', {
        type: 'image/svg+xml',
      }),
    ]),
  /不支持图片格式/
);

await assert.rejects(
  () =>
    prepareMessageAttachments(
      Array.from(
        { length: MAX_MESSAGE_ATTACHMENTS + 1 },
        (_, index) => new File(['x'], `file-${index}.txt`, { type: 'text/plain' })
      )
    ),
  /最多添加/
);

console.log('Chat attachment regression suite passed (23 assertions).');
