import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseFileLink,
  parseInlineCodeFileReference,
  transformMarkdownFileUrl,
  type FilePreviewResult,
} from './fileViewerService';
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer';
import { MessageAttachmentList } from '../components/MessageAttachmentList';
import { FilePreviewDrawer } from '../components/FilePreviewDrawer';
import { buildAgentPersonaPrompt } from './agentCollaboration';
import { extractFilePathsFromTextSegment } from './cogno/structuredTextAnalyzer';
import { INITIAL_AGENTS } from '../data/mockData';
import type { MessageAttachment } from '../types';

function testFileLinkParsing() {
  // 1. 标准 file:// 协议带行号范围
  const f1 = parseFileLink('file:///Users/developer/project/src/App.tsx#L12-L28');
  assert.equal(f1.isLocalFile, true);
  assert.equal(f1.cleanPath, '/Users/developer/project/src/App.tsx');
  assert.equal(f1.displayName, 'App.tsx');
  assert.equal(f1.startLine, 12);
  assert.equal(f1.endLine, 28);

  // 2. 带冒号行号与列号
  const f2 = parseFileLink('/Users/developer/project/AGENTS.md:88');
  assert.equal(f2.isLocalFile, true);
  assert.equal(f2.cleanPath, '/Users/developer/project/AGENTS.md');
  assert.equal(f2.startLine, 88);

  const f2b = parseFileLink('src/App.tsx:120:5');
  assert.equal(f2b.isLocalFile, true);
  assert.equal(f2b.cleanPath, 'src/App.tsx');
  assert.equal(f2b.startLine, 120);

  // 3. URL 编码路径
  const f3 = parseFileLink('file:///Users/developer/My%20Projects/demo.py#L45');
  assert.equal(f3.cleanPath, '/Users/developer/My Projects/demo.py');
  assert.equal(f3.startLine, 45);

  // 4. Windows 盘符与反斜杠路径
  const f4 = parseFileLink('C:\\repo\\src\\main.rs:42');
  assert.equal(f4.isLocalFile, true);
  assert.equal(f4.cleanPath, 'C:\\repo\\src\\main.rs');
  assert.equal(f4.startLine, 42);

  const f4b = parseFileLink('file:///C:/repo/src/lib.rs#L9');
  assert.equal(f4b.isLocalFile, true);
  assert.equal(f4b.cleanPath, 'C:/repo/src/lib.rs');
  assert.equal(f4b.startLine, 9);

  // 5. ~ 路径与相对路径
  const f5 = parseFileLink('~/.shadow-crew/channels/chan-1/artifacts/adr.md');
  assert.equal(f5.isLocalFile, true);
  assert.equal(f5.displayName, 'adr.md');

  // 6. 非本地外链与危险伪协议拦截
  assert.equal(parseFileLink('https://github.com/astral-sh/uv').isLocalFile, false);
  assert.equal(parseFileLink('mailto:dev@example.com').isLocalFile, false);
  assert.equal(parseFileLink('javascript:alert(1)').isLocalFile, false);
}

function testTransformMarkdownFileUrl() {
  assert.equal(
    transformMarkdownFileUrl('file:///Users/a/adr.md#L10'),
    'file:///Users/a/adr.md#L10',
    'file:// URLs must survive markdown sanitization'
  );
  assert.equal(
    transformMarkdownFileUrl('C:/Users/dev/project/main.rs#L12'),
    'C:/Users/dev/project/main.rs#L12'
  );
  assert.equal(
    transformMarkdownFileUrl('src/App.tsx:42'),
    'src/App.tsx:42'
  );
  assert.equal(
    transformMarkdownFileUrl('https://example.com/docs'),
    'https://example.com/docs'
  );
  assert.equal(
    transformMarkdownFileUrl('javascript:alert(1)'),
    '',
    'javascript: URI must be stripped'
  );
  assert.equal(
    transformMarkdownFileUrl('data:text/html,<script>alert(1)</script>'),
    '',
    'data: URI must be stripped'
  );
}

function testInlineCodeFileDetection() {
  // 正例：完整绝对路径、file:// URI、~ 路径、带目录前缀相对路径与工作区根配置契约文件
  const pos1 = parseInlineCodeFileReference('src/App.tsx:42');
  assert.equal(pos1.isLocalFile, true);
  assert.equal(pos1.cleanPath, 'src/App.tsx');
  assert.equal(pos1.startLine, 42);

  assert.equal(parseInlineCodeFileReference('AGENTS.md').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('~/.shadow-crew/a.md').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('/Users/dev/big.log:55000').isLocalFile, true);
  assert.equal(
    parseInlineCodeFileReference('file:///Users/dev/repo/internal/store/cacheStore.go#L42').isLocalFile,
    true
  );
  assert.equal(parseInlineCodeFileReference('./internal/store/cacheStore.go').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('logs/server.log').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('internal/store/cacheStore.go:18').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('Cargo.toml').isLocalFile, true);
  assert.equal(parseInlineCodeFileReference('package.json').isLocalFile, true);

  // 反例：无目录前缀的非根裸文件名与代码标识符绝不能误识别为可点击预览路径
  assert.equal(parseInlineCodeFileReference('cacheStore.go').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('cacheStore.go:42').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('App.tsx').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('config.json').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('console.log').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('process.env').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('light/dark').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('/swarm').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('npm run lint').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('openFilePreview(file)').isLocalFile, false);
  assert.equal(parseInlineCodeFileReference('a/b').isLocalFile, false);
}

function testSsrMessageFileReferencesAndWindowedPreview() {
  const capturedErrors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map((a) => String(a)).join(' '));
  };

  try {
    // 1. MarkdownRenderer：file:// 链接、行内路径引用与普通代码共存
    const mdHtml = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '详见 [ADR 文档](file:///Users/a/adr.md#L10) 以及 `src/App.tsx:42`，避免使用 `console.log`。',
        workspaceRoot: '/Users/a',
      })
    );
    assert.ok(mdHtml.includes('<button'), 'Local file references must render clickable <button>');
    assert.ok(mdHtml.includes('ADR 文档'), 'Markdown link label must render');
    assert.ok(mdHtml.includes('src/App.tsx:42'), 'Inline file ref must render');
    assert.ok(!mdHtml.includes('href=""'), 'file:// href must never be stripped to empty href');
    // `console.log` must stay an inline <code> element rather than a file preview button
    assert.ok(
      mdHtml.includes('>console.log</code>'),
      'console.log must remain plain inline <code>, not a file button'
    );

    // 2. MessageAttachmentList：文件附件与图片附件均渲染为可点击预览按钮
    const attachments: MessageAttachment[] = [
      {
        id: 'att-file-1',
        kind: 'file',
        name: 'big-server.log',
        mimeType: 'text/plain',
        size: 8_400_000,
        path: '/Users/a/logs/big-server.log',
      },
      {
        id: 'att-img-1',
        kind: 'image',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 120_000,
        path: '/Users/a/attachments/diagram.png',
        previewDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
    ];
    const attHtml = renderToStaticMarkup(
      React.createElement(MessageAttachmentList, {
        attachments,
        workspaceRoot: '/Users/a',
      })
    );
    assert.ok(attHtml.includes('点击预览文件: /Users/a/logs/big-server.log'));
    assert.ok(attHtml.includes('点击预览图片: diagram.png'));
    assert.ok(attHtml.includes('data:image/png;base64,iVBORw0KGgo='));

    // 3. FilePreviewDrawer：超大文件分段窗口控件与真实起始行号渲染
    const windowedData: FilePreviewResult = {
      path: '/Users/a/logs/big-server.log',
      displayName: 'big-server.log',
      extension: 'log',
      sizeBytes: 64 * 1024 * 1024,
      isBinary: false,
      content: 'line 55000 ok\nline 55001 ok',
      totalLines: 800000,
      isTruncated: true,
      startLine: 55000,
      endLine: 55001,
      isWindowed: true,
      hasMoreBefore: true,
      hasMoreAfter: true,
    };
    const drawerHtml = renderToStaticMarkup(
      React.createElement(FilePreviewDrawer, {
        isOpen: true,
        onClose: () => {},
        target: { rawPath: '/Users/a/logs/big-server.log#L55000' },
        initialPreviewData: windowedData,
      })
    );
    assert.ok(drawerHtml.includes('大文件流式分窗'));
    assert.ok(drawerHtml.includes('首页'));
    assert.ok(drawerHtml.includes('上一窗'));
    assert.ok(drawerHtml.includes('下一窗'));
    assert.ok(drawerHtml.includes('末尾'));
    assert.ok(drawerHtml.includes('跳转'));
    assert.ok(drawerHtml.includes('>55000<'), 'Must display real line number 55000');

    // 4. Markdown 绝对 file:// 链接与行内裸文件名严格区分 + FilePreviewDrawer 裸路径缺失提示
    const absLinkMd = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content:
          '请核查 [cacheStore.go](file:///Users/xunuosi/Code/Lx/Golang/renbao-lxcore/internal/store/cacheStore.go#L42)，而非裸引用 `cacheStore.go:42`。',
        workspaceRoot: '/Users/xunuosi/Code/Lx/Golang/renbao-lxcore',
      })
    );
    assert.ok(absLinkMd.includes('<button'), 'Absolute file:// link must render clickable <button>');
    assert.ok(absLinkMd.includes('cacheStore.go'), 'Display label cacheStore.go must render');
    assert.ok(absLinkMd.includes(':42'), 'Line anchor :42 badge must render');
    assert.ok(
      absLinkMd.includes('>cacheStore.go:42</code>'),
      'Bare filename without directory must remain plain inline <code>, not a broken preview button'
    );

    const missingBareData: FilePreviewResult = {
      path: '/Users/xunuosi/Code/Lx/Golang/renbao-lxcore/cacheStore.go',
      displayName: 'cacheStore.go',
      extension: 'go',
      sizeBytes: 0,
      isBinary: false,
      content: '',
      totalLines: 0,
      isTruncated: false,
      startLine: 0,
      endLine: 0,
      isWindowed: false,
      hasMoreBefore: false,
      hasMoreAfter: false,
      error: '文件不存在: /Users/xunuosi/Code/Lx/Golang/renbao-lxcore/cacheStore.go',
    };
    const bareErrHtml = renderToStaticMarkup(
      React.createElement(FilePreviewDrawer, {
        isOpen: true,
        onClose: () => {},
        target: {
          rawPath: 'cacheStore.go',
          workspaceRoot: '/Users/xunuosi/Code/Lx/Golang/renbao-lxcore',
        },
        initialPreviewData: missingBareData,
      })
    );
    assert.ok(bareErrHtml.includes('无法打开本地文件'));
    assert.ok(bareErrHtml.includes('原始引用缺少完整路径'));
    assert.ok(bareErrHtml.includes('打开工作目录'));
    assert.ok(!bareErrHtml.includes('个同名文件'), 'Must not render fuzzy candidate switcher');
  } finally {
    console.error = origError;
  }

  assert.equal(
    capturedErrors.length,
    0,
    `SSR emitted unexpected console errors: ${capturedErrors.join(' | ')}`
  );
}

function testSourcePromptAndPathExtractionPreservation() {
  const personaPrompt = buildAgentPersonaPrompt(INITIAL_AGENTS[0]);
  assert.ok(personaPrompt.includes('file:///'), 'Persona prompt must require full file:// absolute links');
  assert.ok(personaPrompt.includes('严禁'), 'Persona prompt must forbid bare filenames');

  const fromMarkdown = extractFilePathsFromTextSegment(
    '参考 [cacheStore.go](file:///Users/dev/repo/internal/store/cacheStore.go#L42) 与 `src/App.tsx`'
  );
  assert.ok(
    fromMarkdown.includes('/Users/dev/repo/internal/store/cacheStore.go'),
    `Expected full POSIX path preserved from file:// link, got: ${JSON.stringify(fromMarkdown)}`
  );
  assert.ok(
    fromMarkdown.includes('src/App.tsx'),
    `Expected relative path preserved, got: ${JSON.stringify(fromMarkdown)}`
  );

  const fromRawAbs = extractFilePathsFromTextSegment(
    '检查 /Users/dev/repo/internal/store/cacheStore.go:42 或在/Users/dev/repo/main.go中以及 /swarm 命令'
  );
  assert.ok(
    fromRawAbs.includes('/Users/dev/repo/internal/store/cacheStore.go'),
    `Expected raw POSIX path with :line preserved, got: ${JSON.stringify(fromRawAbs)}`
  );
  assert.ok(
    fromRawAbs.includes('/Users/dev/repo/main.go'),
    `Expected POSIX path inside CJK boundary preserved, got: ${JSON.stringify(fromRawAbs)}`
  );
  assert.ok(
    !fromRawAbs.includes('/swarm'),
    `Slash command /swarm must remain rejected, got: ${JSON.stringify(fromRawAbs)}`
  );
}

console.log('[Test] Starting fileViewerService & clickable reference tests...');
testFileLinkParsing();
testTransformMarkdownFileUrl();
testInlineCodeFileDetection();
testSsrMessageFileReferencesAndWindowedPreview();
testSourcePromptAndPathExtractionPreservation();
console.log('✅ All fileViewerService, clickable reference, and large-file preview tests passed!');
