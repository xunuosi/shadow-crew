import { parseFileLink } from './fileViewerService';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('[Test] Starting fileViewerService link parsing tests...');

// 1. 测试标准 file:// 协议带行号
{
  const res = parseFileLink('file:///Users/developer/project/src/App.tsx#L12-L28');
  assert(res.isLocalFile, 'Should be local file');
  assert(res.cleanPath === '/Users/developer/project/src/App.tsx', `cleanPath mismatch: ${res.cleanPath}`);
  assert(res.displayName === 'App.tsx', `displayName mismatch: ${res.displayName}`);
  assert(res.startLine === 12, `startLine mismatch: ${res.startLine}`);
  assert(res.endLine === 28, `endLine mismatch: ${res.endLine}`);
}

// 2. 测试带冒号行号
{
  const res = parseFileLink('/Users/developer/project/AGENTS.md:88');
  assert(res.isLocalFile, 'Should be local file');
  assert(res.cleanPath === '/Users/developer/project/AGENTS.md', `cleanPath mismatch: ${res.cleanPath}`);
  assert(res.startLine === 88, `startLine mismatch: ${res.startLine}`);
}

// 3. 测试 URL 编码路径
{
  const res = parseFileLink('file:///Users/developer/My%20Projects/demo.py#L45');
  assert(res.cleanPath === '/Users/developer/My Projects/demo.py', `URL decode failed: ${res.cleanPath}`);
  assert(res.startLine === 45, `startLine mismatch: ${res.startLine}`);
}

// 4. 测试相对路径
{
  const res = parseFileLink('src/components/Sidebar.tsx');
  assert(res.isLocalFile, 'Relative path with code extension should be local file');
  assert(res.displayName === 'Sidebar.tsx', `displayName mismatch: ${res.displayName}`);
}

// 5. 测试非本地外链
{
  const res = parseFileLink('https://github.com/astral-sh/uv');
  assert(!res.isLocalFile, 'HTTP link should not be local file');
}

console.log('✅ All fileViewerService parsing tests passed successfully!');
