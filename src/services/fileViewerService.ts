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
  error?: string;
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
  'json', 'json5', 'yaml', 'yml', 'toml',
  'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'md', 'markdown', 'txt', 'sh', 'zsh', 'bash',
  'sql', 'log', 'env', 'proto', 'diff', 'patch',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
]);

/**
 * 解析超链接或文本中的文件目标与行号锚点
 * 例如:
 *  - file:///Users/developer/project/src/App.tsx#L12-L28
 *  - file:///C:/project/test.py#L45
 *  - /Users/developer/project/AGENTS.md:88
 *  - src/components/Sidebar.tsx
 */
export function parseFileLink(rawHref: string): ParsedFileTarget {
  if (!rawHref) {
    return { raw: '', cleanPath: '', displayName: '', isLocalFile: false };
  }

  const raw = rawHref.trim();
  let candidate = raw;
  let startLine: number | undefined;
  let endLine: number | undefined;

  // 1. 剥离并解析 URL hash 行号, 如 #L12-L25, #L12, #line=12
  const hashIndex = candidate.indexOf('#');
  if (hashIndex !== -1) {
    const hash = candidate.slice(hashIndex + 1);
    candidate = candidate.slice(0, hashIndex);

    const rangeMatch = hash.match(/^L?(\d+)(?:[-:]L?(\d+))?$/i);
    if (rangeMatch) {
      startLine = parseInt(rangeMatch[1], 10);
      if (rangeMatch[2]) {
        endLine = parseInt(rangeMatch[2], 10);
      }
    }
  }

  // 2. 剥离并解析末尾冒号行号, 如 :120 或 :120:5
  const colonMatch = candidate.match(/:(\d+)(?::(\d+))?$/);
  if (colonMatch) {
    if (!startLine) {
      startLine = parseInt(colonMatch[1], 10);
    }
    candidate = candidate.slice(0, colonMatch.index);
  }

  // 3. 判断是否为本地文件协议或本地文件特征
  const hasFileProto = candidate.startsWith('file://');
  let cleanPath = candidate;

  if (hasFileProto) {
    cleanPath = candidate.slice(7); // 去掉 file://
    // 处理 URL 编码与 Windows 驱动器斜杠
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      // 容错保持原状
    }
    if (/^\/[a-zA-Z]:[\\/]/.test(cleanPath)) {
      cleanPath = cleanPath.slice(1);
    }
  }

  // 提取扩展名与文件名
  const basename = cleanPath.split(/[/\\]/).pop() || cleanPath;
  const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() || '' : '';

  const isLocalFile =
    hasFileProto ||
    cleanPath.startsWith('/') ||
    cleanPath.startsWith('./') ||
    cleanPath.startsWith('../') ||
    /^[a-zA-Z]:[\\/]/.test(cleanPath) ||
    COMMON_FILE_EXTENSIONS.has(ext);

  return {
    raw,
    cleanPath,
    displayName: basename || cleanPath,
    startLine,
    endLine,
    isLocalFile,
  };
}

/**
 * 调用 Tauri 后端读取本地文件用于应用内轻量抽屉预览
 */
export async function readFileForPreview(
  path: string,
  workspaceRoot?: string
): Promise<FilePreviewResult> {
  const invoke = getTauriInvoke();
  if (isTauriEnvironment() && invoke) {
    try {
      const res = await invoke('read_file_for_preview', { path, workspaceRoot });
      return res as FilePreviewResult;
    } catch (err: any) {
      return {
        path,
        displayName: path.split(/[/\\]/).pop() || path,
        extension: path.split('.').pop()?.toLowerCase() || '',
        sizeBytes: 0,
        isBinary: false,
        content: '',
        totalLines: 0,
        isTruncated: false,
        error: String(err?.message || err || '无法读取指定文件'),
      };
    }
  }

  // 纯浏览器 Fallback 模拟 (Web Dev 模式)
  const target = parseFileLink(path);
  return {
    path: target.cleanPath,
    displayName: target.displayName,
    extension: target.cleanPath.split('.').pop()?.toLowerCase() || 'txt',
    sizeBytes: 1024,
    isBinary: false,
    content: `// [Web 调试预览模式]\n// 本地文件: ${target.cleanPath}\n// 提示: 当前处于普通浏览器环境，桌面原生 Tauri 环境将直接读取本机真实物理文件内容。\n\nexport const MOCK_FILE_PREVIEW = true;\n`,
    totalLines: 5,
    isTruncated: false,
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
  // Web 降级提示
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
