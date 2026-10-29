import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AcpPermissionModal } from '../components/AcpPermissionModal';
import { AcpPermissionRequest } from '../types';
import {
  removePendingAcpPermission,
  upsertPendingAcpPermission,
} from './acpPermissionClient';

const request: AcpPermissionRequest = {
  requestId: '42',
  agentId: 'agent-claude',
  sessionId: 'session-1',
  sessionKey: 'topic:channel-1:topic-1:standard:ws-ws-topic-1',
  scopeType: 'topic',
  scopeId: 'topic-1',
  workspaceBindingId: 'ws-topic-1',
  cwd: '/tmp/project',
  capability: 'fs.write',
  toolName: 'Write',
  toolTitle: '修改 src/app.ts',
  toolKind: 'edit',
  command: 'write src/app.ts',
  paths: ['/tmp/project/src/app.ts'],
  outsideWorkspacePaths: ['/tmp/outside.ts'],
  description: '测试文件写入授权',
  supportsAllowOnce: true,
  supportsReject: true,
  options: [
    { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
    { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
  ],
  createdAt: 1,
};

const html = renderToStaticMarkup(
  React.createElement(AcpPermissionModal, {
    request,
    agent: {
      id: request.agentId,
      name: 'Claude ACP',
    } as any,
    queuedCount: 2,
    onDecision: async () => undefined,
  })
);

assert(html.includes('ACP 工具执行授权'));
assert(html.includes('Claude ACP'));
assert(html.includes('当前 Channel Topic'));
assert(html.includes('topic-1'));
assert(html.includes('write src/app.ts'));
assert(html.includes('/tmp/outside.ts'));
assert(html.includes('目标超出当前 Workspace Binding'));
assert(html.includes('允许一次'));
assert(html.includes('本次 Session 始终允许'));
assert(html.includes('后续 2 项'));

const blockedHtml = renderToStaticMarkup(
  React.createElement(AcpPermissionModal, {
    request: {
      ...request,
      supportsAllowOnce: false,
      options: [
        { optionId: 'allow-always', name: '始终允许', kind: 'allow_always' },
      ],
    },
    onDecision: async () => undefined,
  })
);
assert(blockedHtml.includes('不会猜测其他允许选项'));

const requestFromAnotherAgent: AcpPermissionRequest = {
  ...request,
  agentId: 'agent-codex',
  createdAt: 2,
};
const queued = upsertPendingAcpPermission([request], requestFromAnotherAgent);
assert.equal(queued.length, 2);
assert.equal(removePendingAcpPermission(queued, 'agent-codex', '42').length, 1);
assert.equal(removePendingAcpPermission(queued, 'agent-codex', '42')[0].agentId, 'agent-claude');

console.log('ACP permission UI rendering suite passed (14 assertions).');
