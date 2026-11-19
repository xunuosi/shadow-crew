import { getTauriInvoke, isTauriEnvironment } from './dbClient';

export interface FilePreviewResult {
  path: string;
  displayName: string;
  extension: string;
  sizeBytes: number;
  isBinary: boolean;
  content: string;
  totalLines: number;
  isTruncated: boolean;
  startLine: number;
  endLine: number;
  isWindowed: boolean;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  imageDataUrl?: string;
  error?: string;
}

export interface ReadFilePreviewOptions {
  startLine?: number;
  maxLines?: number;
  tail?: boolean;
}

export interface ParsedFileTarget {
  raw: string;
  cleanPath: string;
  displayName: string;
  startLine?: number;
  endLine?: number;
  isLocalFile: boolean;
}

const COMMON_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'json5', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'rs', 'py', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'cc', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'vue', 'svelte',
  'md', 'markdown', 'mdx', 'txt', 'sh', 'zsh', 'bash',
  'sql', 'log', 'env', 'proto', 'diff', 'patch', 'lock',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'pdf',
]);

// Canonical workspace-root files that are unambiguous even without a directory slash
const KNOWN_ROOT_FILES = new Set([
  'Makefile',
  'Dockerfile',
  'Containerfile',
  'Jenkinsfile',
  'Procfile',
  'LICENSE',
  'README',
  'README.md',
  'CHANGELOG',
  'CHANGELOG.md',
  'AGENTS.md',
  'Cargo.toml',
  'Cargo.lock',
  'package.json',
  '.gitignore',
  '.gitattributes',
  '.env',
  '.env.local',
  '.env.example',
]);

const EXTERNAL_URL_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'irc',
  'ircs',
  'xmpp',
  'ws',
  'wss',
  'ftp',
  'sftp',
  'data',
  'blob',
  'javascript',
  'vbscript',
  'about',
  'tel',
]);

const CODE_DISALLOWED_CHARS = new Set([
  '(', ')', '{', '}', '[', ']', '\'', '"', '`',
  '=', ';', '|', '&', '<', '>', '$', '*', '?', ',', '!',
]);

function isAsciiDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiLetterCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAllAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isAsciiDigitCode(value.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function parsePositiveInt(value: string): number | undefined {
  if (!isAllAsciiDigits(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isWindowsDrivePath(value: string): boolean {
  return (
    value.length >= 3 &&
    isAsciiLetterCode(value.charCodeAt(0)) &&
    value[1] === ':' &&
    (value[2] === '/' || value[2] === '\\')
  );
}

function extractSchemePrefix(value: string): string | null {
  const colonIdx = value.indexOf(':');
  // Single character before ':' is Windows drive letter, not URL scheme
  if (colonIdx <= 1) return null;

  const slashIdx = value.indexOf('/');
  const queryIdx = value.indexOf('?');
  const hashIdx = value.indexOf('#');
  if (
    (slashIdx !== -1 && colonIdx > slashIdx) ||
    (queryIdx !== -1 && colonIdx > queryIdx) ||
    (hashIdx !== -1 && colonIdx > hashIdx)
  ) {
    return null;
  }

  for (let i = 0; i < colonIdx; i += 1) {
    const code = value.charCodeAt(i);
    const ch = value[i];
    const ok =
      isAsciiLetterCode(code) ||
      isAsciiDigitCode(code) ||
      ch === '+' ||
      ch === '-' ||
      ch === '.';
    if (!ok) return null;
  }
  return value.slice(0, colonIdx).toLowerCase();
}

function parseHashLineAnchor(fragment: string): { startLine?: number; endLine?: number } {
  let clean = fragment.trim();
  if (clean.toLowerCase().startsWith('line=')) {
    clean = clean.slice(5);
  }
  if (!clean) return {};

  const sepIdx = clean.indexOf('-') >= 0 ? clean.indexOf('-') : clean.indexOf(':');
  const firstRaw = sepIdx >= 0 ? clean.slice(0, sepIdx) : clean;
  const secondRaw = sepIdx >= 0 ? clean.slice(sepIdx + 1) : '';

  const stripLeadingL = (part: string) =>
    part.startsWith('L') || part.startsWith('l') ? part.slice(1) : part;

  const startLine = parsePositiveInt(stripLeadingL(firstRaw));
  if (!startLine) return {};
  const endLine = secondRaw ? parsePositiveInt(stripLeadingL(secondRaw)) : undefined;
  return { startLine, endLine };
}

function getBaseNameLexical(filePath: string): string {
  const slashIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath;
}

function getExtLowerLexical(baseName: string): string {
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === baseName.length - 1) return '';
  return baseName.slice(dotIdx + 1).toLowerCase();
}

/**
 * 解析超链接或文本中的文件目标与行号锚点（零正则纯词法解析）
 */
export function parseFileLink(rawHref: string): ParsedFileTarget {
  if (!rawHref) {
    return { raw: '', cleanPath: '', displayName: '', isLocalFile: false };
  }

  const raw = rawHref.trim();
  let candidate = raw;
  let startLine: number | undefined;
  let endLine: number | undefined;

  // 1. 剥离并解析 URL hash 行号 (#L12-L28, #L12, #line=12)
  const hashIndex = candidate.indexOf('#');
  if (hashIndex !== -1) {
    const hash = candidate.slice(hashIndex + 1);
    candidate = candidate.slice(0, hashIndex);
    const parsedHash = parseHashLineAnchor(hash);
    startLine = parsedHash.startLine;
    endLine = parsedHash.endLine;
  }

  // 2. 排除非本地协议头 (http/https/mailto/javascript/data 等)
  const scheme = extractSchemePrefix(candidate);
  if (scheme && scheme !== 'file') {
    if (EXTERNAL_URL_SCHEMES.has(scheme)) {
      return {
        raw,
        cleanPath: raw,
        displayName: getBaseNameLexical(raw) || raw,
        isLocalFile: false,
      };
    }
  }

  // 3. 解析末尾冒号行号与列号 (:120 或 :120:5)
  const lastColon = candidate.lastIndexOf(':');
  if (lastColon > 1) {
    const afterLast = candidate.slice(lastColon + 1);
    if (isAllAsciiDigits(afterLast)) {
      const beforeLast = candidate.slice(0, lastColon);
      const prevColon = beforeLast.lastIndexOf(':');
      if (prevColon > 1 && isAllAsciiDigits(beforeLast.slice(prevColon + 1))) {
        startLine = startLine ?? parsePositiveInt(beforeLast.slice(prevColon + 1));
        candidate = beforeLast.slice(0, prevColon);
      } else {
        startLine = startLine ?? parsePositiveInt(afterLast);
        candidate = beforeLast;
      }
    }
  }

  // 4. 剥离 file:// 并做安全 URL 解码
  const hasFileProto = candidate.toLowerCase().startsWith('file://');
  let cleanPath = hasFileProto ? candidate.slice(7) : candidate;
  if (hasFileProto) {
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      // Malformed percent encoding fallback
    }
    if (cleanPath.length >= 4 && cleanPath[0] === '/' && isWindowsDrivePath(cleanPath.slice(1))) {
      cleanPath = cleanPath.slice(1);
    }
  }

  const basename = getBaseNameLexical(cleanPath) || cleanPath;
  const ext = getExtLowerLexical(basename);

  const isLocalFile =
    hasFileProto ||
    cleanPath.startsWith('~/') ||
    cleanPath.startsWith('~\\') ||
    cleanPath.startsWith('/') ||
    cleanPath.startsWith('./') ||
    cleanPath.startsWith('../') ||
    isWindowsDrivePath(cleanPath) ||
    COMMON_FILE_EXTENSIONS.has(ext) ||
    KNOWN_ROOT_FILES.has(basename);

  return {
    raw,
    cleanPath,
    displayName: basename,
    startLine,
    endLine,
    isLocalFile,
  };
}

/**
 * Custom urlTransform for ReactMarkdown so local `file://`, Windows `C:/`, and `path:line`
 * links survive remark URL sanitization while unsafe `javascript:`/`data:` URIs remain stripped.
 */
export function transformMarkdownFileUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const scheme = extractSchemePrefix(trimmed);
  if (scheme) {
    if (
      scheme === 'http' ||
      scheme === 'https' ||
      scheme === 'mailto' ||
      scheme === 'irc' ||
      scheme === 'ircs' ||
      scheme === 'xmpp' ||
      scheme === 'file'
    ) {
      return value;
    }
    if (EXTERNAL_URL_SCHEMES.has(scheme)) {
      return '';
    }
  }

  if (isWindowsDrivePath(trimmed) || parseFileLink(trimmed).isLocalFile) {
    return value;
  }

  if (scheme === null) {
    return value;
  }

  return '';
}

/**
 * Identify whether inline code text (e.g. `src/App.tsx:42` or `AGENTS.md`) represents
 * an explicit local file reference without false-triggering on `console.log`, `/swarm`, `light/dark`, etc.
 */
export function parseInlineCodeFileReference(rawText: string): ParsedFileTarget {
  const empty: ParsedFileTarget = { raw: rawText, cleanPath: '', displayName: '', isLocalFile: false };
  if (!rawText) return empty;
  const trimmed = rawText.trim();
  if (trimmed.length < 3 || trimmed.length > 320) return empty;
  if (trimmed.includes('\n') || trimmed.includes('\r')) return empty;

  const hasFileProto = trimmed.toLowerCase().startsWith('file://');
  if (!hasFileProto && (trimmed.includes(' ') || trimmed.includes('\t'))) {
    return empty;
  }

  for (let i = 0; i < trimmed.length; i += 1) {
    if (CODE_DISALLOWED_CHARS.has(trimmed[i])) {
      return empty;
    }
  }

  const parsed = parseFileLink(trimmed);
  if (!parsed.isLocalFile || !parsed.cleanPath) return empty;

  const clean = parsed.cleanPath;
  const hasDirSlash = clean.includes('/') || clean.includes('\\');
  const basename = getBaseNameLexical(clean);
  if (!basename || basename === '.' || basename === '..') return empty;
  const ext = getExtLowerLexical(basename);

  if (
    hasFileProto ||
    clean.startsWith('~/') ||
    clean.startsWith('~\\') ||
    clean.startsWith('./') ||
    clean.startsWith('../') ||
    isWindowsDrivePath(clean)
  ) {
    return parsed;
  }

  if (clean.startsWith('/')) {
    const segments = clean.split('/').filter((seg) => seg.length > 0);
    if (segments.length >= 2) {
      return parsed;
    }
    if (KNOWN_ROOT_FILES.has(basename)) {
      return parsed;
    }
    return empty;
  }

  if (hasDirSlash) {
    const normalized = clean.split('\\').join('/');
    const segments = normalized.split('/');
    if (segments.some((seg) => seg.length === 0)) {
      return empty;
    }
    if (COMMON_FILE_EXTENSIONS.has(ext) || KNOWN_ROOT_FILES.has(basename)) {
      return parsed;
    }
    return empty;
  }

  // Bare filename without directory separator: allow only canonical workspace-root files
  if (KNOWN_ROOT_FILES.has(basename)) {
    return parsed;
  }

  return empty;
}

/**
 * 调用 Tauri 后端读取本地文件用于应用内轻量抽屉预览（支持大文件窗口分页与行号跳转）
 */
export async function readFileForPreview(
  path: string,
  workspaceRoot?: string,
  options?: ReadFilePreviewOptions
): Promise<FilePreviewResult> {
  const invoke = getTauriInvoke();
  if (isTauriEnvironment() && invoke) {
    try {
      const res = await invoke('read_file_for_preview', {
        path,
        workspaceRoot,
        startLine: options?.startLine,
        maxLines: options?.maxLines,
        tail: options?.tail,
      });
      return res as FilePreviewResult;
    } catch (err: any) {
      const cleanName = getBaseNameLexical(path) || path;
      return {
        path,
        displayName: cleanName,
        extension: getExtLowerLexical(cleanName),
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
        error: String(err?.message || err || '无法读取指定文件'),
      };
    }
  }

  // 纯浏览器 Fallback 模拟 (Web Dev 模式)
  const target = parseFileLink(path);
  return {
    path: target.cleanPath,
    displayName: target.displayName,
    extension: getExtLowerLexical(target.displayName) || 'txt',
    sizeBytes: 1024,
    isBinary: false,
    content: `// [Web 调试预览模式]\n// 本地文件: ${target.cleanPath}\n// 提示: 当前处于普通浏览器环境，桌面原生 Tauri 环境将直接读取本机真实物理文件内容（支持任意体积大文件流式分窗翻阅）。\n\nexport const MOCK_FILE_PREVIEW = true;\n`,
    totalLines: 5,
    isTruncated: false,
    startLine: 1,
    endLine: 5,
    isWindowed: false,
    hasMoreBefore: false,
    hasMoreAfter: false,
  };
}

/**
 * 唤起系统默认程序打开文件 (macOS open / Windows start / Linux xdg-open)
 */
export async function openFileInSystem(path: string, workspaceRoot?: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (isTauriEnvironment() && invoke) {
    await invoke('open_file_in_system', { path, workspaceRoot });
    return;
  }
  console.warn('[FileViewer] 当前为 Web 环境，无法唤起原生系统默认程序打开:', path);
  try {
    await navigator.clipboard.writeText(path);
  } catch {}
}

/**
 * 在系统文件管理器中高亮选中文件 (Finder / Explorer)
 */
export async function revealFileInFolder(path: string, workspaceRoot?: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (isTauriEnvironment() && invoke) {
    await invoke('reveal_file_in_folder', { path, workspaceRoot });
    return;
  }
  console.warn('[FileViewer] 当前为 Web 环境，无法在文件管理器中定位:', path);
  try {
    await navigator.clipboard.writeText(path);
  } catch {}
}

/**
 * 在外部代码编辑器打开文件并直达指定代码行
 */
export async function openFileInEditor(
  path: string,
  line?: number,
  column?: number,
  editor: string = 'code',
  workspaceRoot?: string
): Promise<void> {
  const invoke = getTauriInvoke();
  if (isTauriEnvironment() && invoke) {
    await invoke('open_file_in_editor', {
      path,
      line: line ? Number(line) : undefined,
      column: column ? Number(column) : undefined,
      editor,
      workspaceRoot,
    });
    return;
  }
  console.warn('[FileViewer] 当前为 Web 环境，无法唤起外部代码编辑器:', path, line);
  try {
    await navigator.clipboard.writeText(`${path}${line ? `:${line}` : ''}`);
  } catch {}
}
