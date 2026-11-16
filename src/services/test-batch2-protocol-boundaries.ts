import assert from 'node:assert/strict';
import { extractWorkspaceDiffsFromText } from './acpClient';
import { isValidLlmSuccessPayload, requestJsonUniversal } from './llmService';

async function runTests() {
  // 1. extractWorkspaceDiffsFromText: Unified Diff + filepath comments + preceding context + skip mermaid/ruling json
  const sampleMarkdown = [
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '```json',
    '{"decisionType":"approve","summary":"not a patch"}',
    '```',
    '',
    '修改 `src/utils/helper.ts`：',
    '```diff',
    '--- a/src/utils/helper.ts',
    '+++ b/src/utils/helper.ts',
    '@@ -1,2 +1,2 @@',
    '-const a = 1;',
    '+const a = 2;',
    '```',
    '',
    '```ts',
    '// filepath: src/services/newFile.ts',
    'export const hello = "world";',
    '```',
    '',
    '```python',
    '# path: scripts/run.py',
    'print("ok")',
    '```',
    '',
    '```css',
    '/* file: src/styles/app.css */',
    '.root { color: red; }',
    '```',
  ].join('\n');

  const diffs = extractWorkspaceDiffsFromText(sampleMarkdown);
  assert.equal(diffs.length, 4, `Expected 4 diffs, got ${diffs.length}`);
  assert.equal(diffs[0].filename, 'src/utils/helper.ts');
  assert.equal(diffs[0].additions, 1);
  assert.equal(diffs[0].deletions, 1);

  assert.equal(diffs[1].filename, 'src/services/newFile.ts');
  assert.equal(diffs[1].codeContent, 'export const hello = "world";');

  assert.equal(diffs[2].filename, 'scripts/run.py');
  assert.equal(diffs[2].codeContent, 'print("ok")');

  assert.equal(diffs[3].filename, 'src/styles/app.css');
  assert.equal(diffs[3].codeContent, '.root { color: red; }');

  // 2. isValidLlmSuccessPayload: reject error payloads even with id/content, accept valid structured payloads
  assert.equal(
    isValidLlmSuccessPayload({
      id: 'err_123',
      content: 'rate limit exceeded',
      error: { message: 'Too Many Requests', code: 429 },
    }),
    false
  );
  assert.equal(
    isValidLlmSuccessPayload({
      id: 'req_456',
      message: 'unauthorized',
    }),
    false
  );
  assert.equal(
    isValidLlmSuccessPayload({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'hi' } }],
    }),
    true
  );
  assert.equal(
    isValidLlmSuccessPayload({
      data: [{ id: 'gpt-4o' }],
    }),
    true
  );

  // 3. requestJsonUniversal: never override Tauri HTTP 401/429 to 200 even if raw_text has "id" & "content"
  const origWindow = (globalThis as any).window;
  try {
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string) => {
          assert.equal(cmd, 'native_http_post');
          return {
            ok: false,
            status: 429,
            body: {
              id: 'err-429',
              content: 'quota exceeded',
              error: { message: 'Rate limit reached' },
            },
            raw_text: '{"id":"err-429","content":"quota exceeded","error":{"message":"Rate limit reached"}}',
          };
        },
      },
    };

    const resp = await requestJsonUniversal('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: { model: 'test' },
    });
    assert.equal(resp.ok, false);
    assert.equal(resp.status, 429);
    assert.equal(resp.error, 'Rate limit reached');
  } finally {
    (globalThis as any).window = origWindow;
  }

  console.log('✅ test-batch2-protocol-boundaries passed all assertions');
}

runTests().catch((err) => {
  console.error('❌ test-batch2-protocol-boundaries failed:', err);
  process.exit(1);
});
