/**
 * CognoNexus 确定性结构化文本与词元分析器 (Deterministic Structured Text Analyzer)
 * 为阶段契约门禁、作用域校验、LMAD 冲突定位与谄媚度治理提供零正则的 AST/词元解析基础：
 * 1. Markdown 结构化块解析（标题、列表、代码块、Diff 头、键值行、量化指标、文件路径）
 * 2. 确定性中英文技术词元切分与语义集合重合度计算（取代 .slice(0, 10) / 4-gram 碰撞）
 * 3. MCP 工具调用 + Diff + 非否定修改语义子句的确定性触达路径提取
 */

import { extractMcpToolCallArguments, matchesMcpToolName } from '../acpClient';

export interface StructuredCodeBlock {
  lang: string;
  content: string;
  lineCount: number;
}

export interface StructuredHeading {
  level: number;
  text: string;
}

export interface StructuredKeyValue {
  key: string;
  value: string;
}

export interface StructuredDocumentAst {
  fencedCodeBlocks: StructuredCodeBlock[];
  inlineCodeSpans: string[];
  headings: StructuredHeading[];
  listItems: string[];
  keyValuePairs: StructuredKeyValue[];
  sentences: string[];
  quantifiedMetricCount: number;
  filePaths: string[];
  diffFiles: string[];
  hasJsonObject: boolean;
}

const KNOWN_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'py', 'json', 'md',
  'toml', 'yaml', 'yml', 'sql', 'css', 'scss', 'html', 'sh', 'zsh', 'txt',
  'proto', 'graphql', 'lock', 'vue', 'svelte',
]);

const METRIC_UNIT_TOKENS = new Set([
  '%', 'ms', 's', 'kb', 'mb', 'gb', 'qps', 'tps', '倍', 'x', 'bp', 'bps',
  '天', '小时', '分钟', '秒', '个月',
]);

const BARE_ACK_WORDS = new Set([
  '好的', '收到', '明白', '我同意', '同意', '没问题', '赞成', '同上',
  'ok', 'okay', 'yes', 'agreed', 'lgtm', 'ack', 'confirmed',
]);

const STOPWORDS_EN = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'are', 'was',
  'were', 'will', 'can', 'not', 'but', 'all', 'any', 'use', 'using', 'used',
  'based', 'via', 'when', 'then', 'than', 'has', 'have', 'had', 'may', 'should',
]);

const STOP_CJK_CHARS = new Set([
  '的', '了', '在', '是', '和', '与', '对', '将', '把', '被', '为', '中',
  '下', '上', '等', '及', '并', '或', '而', '但', '若', '可', '能', '会',
  '个', '种', '项', '条', '处', '该', '此', '其', '我', '们', '你', '您',
]);

const PATH_STOP_CHARS = new Set([
  ' ', '\t', '\r', '\n', '`', '\'', '"', '(', ')', '[', ']', '{', '}',
  '<', '>', ',', '，', '、', '。', '；', ';', '*', '!', '！', '?', '？',
]);

const NEGATION_MODIFICATION_PHRASES = [
  '不涉及文件修改',
  '不涉及任何文件修改',
  '不修改任何文件',
  '不触碰任何文件',
  '不触碰其他模块',
  '无任何文件修改',
  '零修改',
  '仅做逻辑推演',
  '仅对系统架构',
  'no file changes',
  'without modifying',
  'read-only analysis',
];

const CLAUSE_NEGATION_PREFIXES = [
  '不修改',
  '未修改',
  '不重写',
  '不改动',
  '不编辑',
  '禁改',
  '严禁修改',
  '禁止修改',
  'do not modify',
  'must not modify',
];

const MODIFICATION_ACTION_TOKENS = [
  '修改', '重写', '新增', '编辑', '替换', '写入', '变更', '重构',
  'write_file', 'str_replace', 'patch', 'modify', 'update', 'edit',
];

const READ_ONLY_CONTEXT_TOKENS = [
  '参考', '读取', '查看', '阅读', '依据', 'read_file', 'reference', 'inspect',
];

function isAsciiAlphaNum(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isDigitChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isNumericLiteral(token: string): boolean {
  if (!token) return false;
  let seenDigit = false;
  let seenDot = false;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (isDigitChar(ch)) {
      seenDigit = true;
    } else if (ch === '.' && !seenDot && seenDigit && i + 1 < token.length) {
      seenDot = true;
    } else {
      return false;
    }
  }
  return seenDigit;
}

function isAsciiLetter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isCjkChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

export function normalizeRepoPath(rawPath: string): string {
  let clean = (rawPath || '').trim().split('\\').join('/');
  if (clean.toLowerCase().startsWith('file://')) {
    clean = clean.slice(7);
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // Malformed percent encoding fallback
    }
    clean = clean.split('\\').join('/');
    if (
      clean.length >= 4 &&
      clean[0] === '/' &&
      isAsciiLetter(clean[1]) &&
      clean[2] === ':' &&
      clean[3] === '/'
    ) {
      clean = clean.slice(1);
    }
  }
  const hashIdx = clean.indexOf('#');
  if (hashIdx >= 0) {
    clean = clean.slice(0, hashIdx);
  }
  if (clean.startsWith('./')) clean = clean.slice(2);
  if (clean.startsWith('a/') || clean.startsWith('b/')) clean = clean.slice(2);
  while (clean.endsWith(':') || clean.endsWith('：')) {
    clean = clean.slice(0, -1);
  }
  // Strip optional line/column suffixes like foo.ts:42 or foo.ts:42:5 (preserving Windows C: at index 1)
  for (let pass = 0; pass < 2; pass++) {
    const lastColon = clean.lastIndexOf(':');
    if (lastColon <= 1) break;
    const tail = clean.slice(lastColon + 1);
    if (!isNumericLiteral(tail)) break;
    clean = clean.slice(0, lastColon);
  }
  return clean.trim();
}

export function isPathOwnedByAllowedList(targetPath: string, allowedFiles: string[]): boolean {
  const normalizedTarget = normalizeRepoPath(targetPath);
  if (!normalizedTarget) return false;
  return allowedFiles.some((rawAllowed) => {
    const allowed = normalizeRepoPath(rawAllowed);
    if (!allowed) return false;
    if (allowed === normalizedTarget) return true;
    return allowed.endsWith('/') && normalizedTarget.startsWith(allowed);
  });
}

function isLikelyFilePathToken(rawToken: string): string | null {
  const trimmed = (rawToken || '').trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('ws://') ||
    lower.startsWith('wss://')
  ) {
    return null;
  }

  const token = normalizeRepoPath(trimmed);
  if (token.length < 3) return null;
  if (token.includes('//')) return null;

  const first = token[0];
  if (!isAsciiAlphaNum(first) && first !== '.' && first !== '_' && first !== '/') {
    return null;
  }

  // Only allow ASCII path characters (plus Windows drive colon at index 1 in "C:/...")
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    const isDriveColon =
      i === 1 &&
      ch === ':' &&
      token.length >= 3 &&
      isAsciiLetter(token[0]) &&
      token[2] === '/';
    if (
      !isAsciiAlphaNum(ch) &&
      ch !== '/' &&
      ch !== '.' &&
      ch !== '_' &&
      ch !== '-' &&
      !isDriveColon
    ) {
      return null;
    }
  }

  if (token.endsWith('/')) {
    return token.includes('/') && token.length >= 4 ? token : null;
  }

  const lastSlash = token.lastIndexOf('/');
  const baseName = lastSlash >= 0 ? token.slice(lastSlash + 1) : token;
  const lastDot = baseName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === baseName.length - 1) {
    return null;
  }
  const ext = baseName.slice(lastDot + 1).toLowerCase();
  if (!KNOWN_FILE_EXTENSIONS.has(ext)) {
    return null;
  }
  return token;
}

export function extractFilePathsFromTextSegment(segment: string): string[] {
  if (!segment) return [];
  const results: string[] = [];
  const seen = new Set<string>();
  let buf = '';

  const flush = () => {
    if (!buf) return;
    // Also handle mixed Chinese-ASCII boundaries such as "在src/a.ts中", "在/Users/a.go中", or "file.ts的逻辑"
    let start = 0;
    while (
      start < buf.length &&
      !isAsciiAlphaNum(buf[start]) &&
      buf[start] !== '.' &&
      buf[start] !== '_' &&
      buf[start] !== '/'
    ) {
      start++;
    }
    let end = buf.length;
    while (
      end > start &&
      !isAsciiAlphaNum(buf[end - 1]) &&
      buf[end - 1] !== '/'
    ) {
      end--;
    }
    if (end > start) {
      const candidate = buf.slice(start, end);
      const valid = isLikelyFilePathToken(candidate);
      if (valid && !seen.has(valid)) {
        seen.add(valid);
        results.push(valid);
      }
    }
    buf = '';
  };

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (PATH_STOP_CHARS.has(ch) || isCjkChar(ch)) {
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return results;
}

function parseListItemText(trimmedLine: string): string | null {
  if (
    trimmedLine.startsWith('- ') ||
    trimmedLine.startsWith('* ') ||
    trimmedLine.startsWith('+ ') ||
    trimmedLine.startsWith('• ')
  ) {
    return trimmedLine.slice(2).trim();
  }
  // Check numeric list markers like "1. ", "1) ", "1、"
  let idx = 0;
  while (idx < trimmedLine.length && idx < 4 && isDigitChar(trimmedLine[idx])) {
    idx++;
  }
  if (idx > 0 && idx < trimmedLine.length) {
    const sep = trimmedLine[idx];
    if ((sep === '.' || sep === ')' || sep === '、') && idx + 1 < trimmedLine.length) {
      const next = trimmedLine[idx + 1];
      if (sep === '、' || next === ' ') {
        return trimmedLine.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

function countQuantifiedMetricsInLine(line: string): number {
  let count = 0;
  const upper = line.toUpperCase();
  if (upper.includes('P99') || upper.includes('P95') || upper.includes('P90')) count++;
  if (upper.includes('ROI')) count++;
  const oStart = line.indexOf('O(');
  if (oStart >= 0 && line.indexOf(')', oStart + 2) > oStart + 2) {
    count++;
  }

  const parts = line
    .split(/[\s,，;；()（）[\]【】'"]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const token = parts[i].toLowerCase();
    // Combined numeric + unit token like "50ms", "99.9%", "3倍"
    let digitEnd = 0;
    while (digitEnd < token.length && (isDigitChar(token[digitEnd]) || token[digitEnd] === '.')) {
      digitEnd++;
    }
    if (digitEnd > 0 && digitEnd < token.length) {
      const numPart = token.slice(0, digitEnd);
      const unitPart = token.slice(digitEnd);
      if (isNumericLiteral(numPart) && METRIC_UNIT_TOKENS.has(unitPart)) {
        count++;
        continue;
      }
    }
    // Adjacent tokens like "5000 TPS"
    if (isNumericLiteral(token) && i + 1 < parts.length) {
      const nextToken = parts[i + 1].toLowerCase();
      if (METRIC_UNIT_TOKENS.has(nextToken)) {
        count++;
      }
    }
  }
  return count;
}

export function isTrivialAcknowledgementText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  let stripped = '';
  for (const ch of trimmed.toLowerCase()) {
    if (ch !== '。' && ch !== '！' && ch !== '!' && ch !== '.' && ch !== '，' && ch !== ',' && ch !== ' ') {
      stripped += ch;
    }
  }
  return BARE_ACK_WORDS.has(stripped);
}

export function analyzeStructuredMarkdown(text: string): StructuredDocumentAst {
  const ast: StructuredDocumentAst = {
    fencedCodeBlocks: [],
    inlineCodeSpans: [],
    headings: [],
    listItems: [],
    keyValuePairs: [],
    sentences: [],
    quantifiedMetricCount: 0,
    filePaths: [],
    diffFiles: [],
    hasJsonObject: false,
  };

  if (!text || !text.trim()) {
    return ast;
  }

  const lines = text.split('\n');
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];
  const seenFiles = new Set<string>();
  const seenDiffFiles = new Set<string>();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLang = trimmed.slice(3).trim().toLowerCase();
        fenceLines = [];
      } else {
        const content = fenceLines.join('\n').trim();
        ast.fencedCodeBlocks.push({
          lang: fenceLang,
          content,
          lineCount: fenceLines.length,
        });
        if (fenceLang === 'json' && (content.startsWith('{') || content.startsWith('['))) {
          ast.hasJsonObject = true;
        }
        inFence = false;
        fenceLang = '';
        fenceLines = [];
      }
      continue;
    }

    // Collect file paths across both normal prose and fenced diff/code blocks
    if (trimmed.startsWith('+++ ') || trimmed.startsWith('--- ')) {
      const candidate = normalizeRepoPath(trimmed.slice(4));
      if (candidate && candidate !== '/dev/null') {
        const valid = isLikelyFilePathToken(candidate);
        if (valid && !seenDiffFiles.has(valid)) {
          seenDiffFiles.add(valid);
          ast.diffFiles.push(valid);
        }
      }
    }

    for (const p of extractFilePathsFromTextSegment(trimmed)) {
      if (!seenFiles.has(p)) {
        seenFiles.add(p);
        ast.filePaths.push(p);
      }
    }

    if (inFence) {
      fenceLines.push(rawLine);
      continue;
    }

    if (!trimmed) continue;

    // Inline backtick code spans
    let scanPos = 0;
    while (scanPos < trimmed.length) {
      const openIdx = trimmed.indexOf('`', scanPos);
      if (openIdx < 0) break;
      const closeIdx = trimmed.indexOf('`', openIdx + 1);
      if (closeIdx < 0) break;
      const span = trimmed.slice(openIdx + 1, closeIdx).trim();
      if (span.length >= 3) {
        ast.inlineCodeSpans.push(span);
      }
      scanPos = closeIdx + 1;
    }

    // Headings
    let hashCount = 0;
    while (hashCount < trimmed.length && trimmed[hashCount] === '#') {
      hashCount++;
    }
    if (hashCount > 0 && hashCount <= 6 && trimmed[hashCount] === ' ') {
      const headingText = trimmed.slice(hashCount + 1).trim();
      if (headingText) {
        ast.headings.push({ level: hashCount, text: headingText });
      }
    }

    // List items
    const listText = parseListItemText(trimmed);
    if (listText) {
      ast.listItems.push(listText);
    }

    // Key-value assertions (supports both English `:` and Chinese `：`)
    const zhColon = trimmed.indexOf('：');
    const enColon = trimmed.indexOf(':');
    const colonIdx =
      zhColon > 0 && enColon > 0
        ? Math.min(zhColon, enColon)
        : Math.max(zhColon, enColon);
    if (colonIdx > 0 && colonIdx <= 48) {
      const keyPart = trimmed.slice(0, colonIdx).trim();
      const valPart = trimmed.slice(colonIdx + 1).trim();
      const lowerKey = keyPart.toLowerCase();
      if (keyPart && valPart && lowerKey !== 'http' && lowerKey !== 'https' && lowerKey !== 'ws' && lowerKey !== 'wss') {
        ast.keyValuePairs.push({ key: keyPart, value: valPart });
      }
    }

    ast.quantifiedMetricCount += countQuantifiedMetricsInLine(trimmed);
  }

  // Flush unclosed code fence gracefully
  if (inFence && fenceLines.length > 0) {
    ast.fencedCodeBlocks.push({
      lang: fenceLang,
      content: fenceLines.join('\n').trim(),
      lineCount: fenceLines.length,
    });
  }

  // Top-level JSON envelope check
  const trimmedAll = text.trim();
  if ((trimmedAll.startsWith('{') && trimmedAll.endsWith('}')) || (trimmedAll.startsWith('[') && trimmedAll.endsWith(']'))) {
    ast.hasJsonObject = true;
  }

  // Split substantive clauses / sentences
  ast.sentences = splitClauses(text).filter((s) => s.length >= 6);

  return ast;
}

export function splitClauses(text: string): string[] {
  if (!text) return [];
  const clauses: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '。' || ch === '；' || ch === ';' || ch === '!' || ch === '！') {
      const clean = buf.trim();
      if (clean) clauses.push(clean);
      buf = '';
    } else if (ch === '.' && (i + 1 >= text.length || text[i + 1] === ' ')) {
      // Only break English sentence at ". " when previous char isn't a path or number prefix
      const trimmedBuf = buf.trim();
      const lastWord = trimmedBuf.split(/\s+/).pop() || '';
      const isShortPathOrNum = lastWord.includes('/') || isNumericLiteral(lastWord) || lastWord.length <= 2;
      if (!isShortPathOrNum) {
        if (trimmedBuf) clauses.push(trimmedBuf);
        buf = '';
      } else {
        buf += ch;
      }
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) clauses.push(tail);
  return clauses;
}

/**
 * 提取跨中英文的技术实体与概念词元集合，彻底取代固定长度 `.slice(0, 10)` 与 4-gram 子串截断。
 */
export function extractTechnicalTermSet(text: string): Set<string> {
  const terms = new Set<string>();
  if (!text) return terms;

  let asciiBuf = '';
  let cjkRun = '';

  const flushAscii = () => {
    if (!asciiBuf) return;
    const rawParts = asciiBuf.split(/[_/.\-:]+/).filter(Boolean);
    for (const part of rawParts) {
      // Split camelCase parts
      let segment = '';
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        const isUpper = ch >= 'A' && ch <= 'Z';
        if (isUpper && segment.length > 0) {
          const lowerSeg = segment.toLowerCase();
          if (lowerSeg.length >= 2 && !STOPWORDS_EN.has(lowerSeg)) {
            terms.add(lowerSeg);
          }
          segment = ch;
        } else {
          segment += ch;
        }
      }
      if (segment) {
        const lowerSeg = segment.toLowerCase();
        if (lowerSeg.length >= 2 && !STOPWORDS_EN.has(lowerSeg)) {
          terms.add(lowerSeg);
        }
      }
    }
    asciiBuf = '';
  };

  const flushCjk = () => {
    if (!cjkRun) return;
    const filteredChars: string[] = [];
    for (const ch of cjkRun) {
      if (!STOP_CJK_CHARS.has(ch)) {
        filteredChars.push(ch);
      }
    }
    if (filteredChars.length >= 2) {
      for (let i = 0; i < filteredChars.length - 1; i++) {
        terms.add(filteredChars[i] + filteredChars[i + 1]);
      }
    } else if (filteredChars.length === 1) {
      terms.add(filteredChars[0]);
    }
    cjkRun = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isCjkChar(ch)) {
      flushAscii();
      cjkRun += ch;
    } else if (isAsciiAlphaNum(ch) || ch === '_' || ch === '-' || ch === '/' || ch === '.') {
      flushCjk();
      asciiBuf += ch;
    } else {
      flushAscii();
      flushCjk();
    }
  }
  flushAscii();
  flushCjk();

  return terms;
}

/**
 * 计算两段主张/报告的技术词元重合比例 (Szymkiewicz-Simpson 重合系数 + 最小共享门槛)
 */
export function computeClaimTokenOverlap(textA: string, textB: string): number {
  const termsA = extractTechnicalTermSet(textA);
  const termsB = extractTechnicalTermSet(textB);
  if (termsA.size === 0 || termsB.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const t of termsA) {
    if (termsB.has(t)) shared++;
  }
  if (shared === 0) return 0;
  const minSize = Math.min(termsA.size, termsB.size);
  return Number((shared / minSize).toFixed(4));
}

function splitModificationSubClauses(clause: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of clause) {
    if (ch === '，' || ch === ',') {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * 从 MCP 工具载荷、Diff 头与非否定修改语义子句中确定性提取真实修改的文件路径列表
 */
export function extractExplicitTouchedPaths(
  text: string,
  options?: { touchedFiles?: string[]; mcpToolCalls?: any[] }
): string[] {
  const touched = new Set<string>();

  if (Array.isArray(options?.touchedFiles)) {
    for (const f of options.touchedFiles) {
      const clean = normalizeRepoPath(String(f));
      if (clean) touched.add(clean);
    }
  }

  if (Array.isArray(options?.mcpToolCalls)) {
    for (const call of options.mcpToolCalls) {
      const args = extractMcpToolCallArguments(call);
      if (!args || typeof args !== 'object') continue;
      if (matchesMcpToolName(call, 'write_file') || matchesMcpToolName(call, 'str_replace')) {
        const clean = normalizeRepoPath(String(args.path || ''));
        if (clean) touched.add(clean);
      } else if (matchesMcpToolName(call, 'validate_workspace_diff')) {
        const patches = Array.isArray(args.patches) ? args.patches : [];
        for (const p of patches) {
          const clean = normalizeRepoPath(String(p?.filename || ''));
          if (clean) touched.add(clean);
        }
      } else if (
        matchesMcpToolName(call, 'submit_proposal_claims') ||
        matchesMcpToolName(call, 'submit_defense_patch') ||
        matchesMcpToolName(call, 'submit_arbitration_ruling') ||
        matchesMcpToolName(call, 'submit_execution_deliverable')
      ) {
        const files = args.impacted_files || args.impactedFiles;
        if (Array.isArray(files)) {
          for (const f of files) {
            const clean = normalizeRepoPath(String(f));
            if (clean) touched.add(clean);
          }
        }
      }
    }
  }

  if (!text || !text.trim()) {
    return Array.from(touched);
  }

  const ast = analyzeStructuredMarkdown(text);
  for (const df of ast.diffFiles) {
    touched.add(df);
  }

  for (const clause of splitClauses(text)) {
    const lowerClause = clause.toLowerCase();
    if (NEGATION_MODIFICATION_PHRASES.some((neg) => lowerClause.includes(neg))) {
      continue;
    }

    const subClauses = splitModificationSubClauses(clause);
    for (const sub of subClauses) {
      const lowerSub = sub.toLowerCase();
      if (CLAUSE_NEGATION_PREFIXES.some((neg) => lowerSub.includes(neg))) {
        continue;
      }
      const hasAction = MODIFICATION_ACTION_TOKENS.some((verb) => lowerSub.includes(verb));
      if (!hasAction) continue;

      const paths = extractFilePathsFromTextSegment(sub);
      for (const pathToken of paths) {
        const idx = lowerSub.indexOf(pathToken.toLowerCase());
        const precedingWindow = idx > 0 ? lowerSub.slice(Math.max(0, idx - 12), idx) : '';
        const isReadOnlyRef = READ_ONLY_CONTEXT_TOKENS.some((ro) => precedingWindow.includes(ro)) &&
          !MODIFICATION_ACTION_TOKENS.some((act) => precedingWindow.includes(act));
        if (!isReadOnlyRef) {
          touched.add(pathToken);
        }
      }
    }
  }

  return Array.from(touched);
}
