import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const fixture = join(process.cwd(), 'src-tauri/tests/fixtures/fake_permission_acp.py');
const workspace = mkdtempSync(join(tmpdir(), 'shadow-crew-acp-permission-'));
const child = spawn('python3', ['-u', fixture], {
  cwd: workspace,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout });
const iterator = lines[Symbol.asyncIterator]();
let passed = 0;

async function readMessage(): Promise<any> {
  const next = await Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for fake ACP response')), 5000)
    ),
  ]);
  assert.equal(next.done, false, 'Fake ACP stdout closed unexpectedly');
  return JSON.parse(next.value);
}

function send(message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientInfo: { name: 'shadow-crew-test', version: '1.0.0' },
    },
  });
  const init = await readMessage();
  assert.equal(init.id, 1);
  passed += 1;

  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: { cwd: workspace },
  });
  const newSession = await readMessage();
  assert.equal(typeof newSession.result?.sessionId, 'string');
  passed += 1;

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'session/prompt',
    params: {
      sessionId: newSession.result.sessionId,
      prompt: [{ type: 'text', text: 'write test file' }],
    },
  });
  const permission = await readMessage();
  assert.equal(permission.method, 'session/request_permission');
  assert.equal(permission.params.toolCall.kind, 'edit');
  assert.equal(permission.params.options[0].kind, 'allow_once');
  assert.equal(existsSync(join(workspace, 'permission-e2e.txt')), false);
  passed += 1;

  send({
    jsonrpc: '2.0',
    id: permission.id,
    result: {
      outcome: {
        outcome: 'selected',
        optionId: 'allow-once',
      },
    },
  });

  let promptResult: any = null;
  while (!promptResult) {
    const message = await readMessage();
    if (message.id === 3) promptResult = message;
  }
  assert.match(promptResult.result?.text_response || '', /FAKE_ACP_ALLOWED/);
  assert.equal(
    readFileSync(join(workspace, 'permission-e2e.txt'), 'utf8'),
    'allowed\n'
  );
  passed += 1;

  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'session/prompt',
    params: {
      sessionId: newSession.result.sessionId,
      prompt: [{ type: 'text', text: 'deny test file' }],
    },
  });
  const secondPermission = await readMessage();
  assert.equal(secondPermission.method, 'session/request_permission');
  send({
    jsonrpc: '2.0',
    id: secondPermission.id,
    result: {
      outcome: {
        outcome: 'selected',
        optionId: 'reject',
      },
    },
  });

  let deniedResult: any = null;
  while (!deniedResult) {
    const message = await readMessage();
    if (message.id === 4) deniedResult = message;
  }
  assert.equal(deniedResult.result?.text_response, 'FAKE_ACP_DENIED');
  passed += 1;

  console.log(`ACP permission protocol fixture passed (${passed} assertions).`);
} finally {
  lines.close();
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
}
