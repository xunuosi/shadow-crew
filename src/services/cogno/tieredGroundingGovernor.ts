/**
 * CognoNexus 分级取证与安全宪章执行器 (Tiered Grounding Governor)
 * 支撑 R-3 要求：
 * 1. T1 级只读工具 (AST/RAG/Grep)：先行落地，权重 <= 0.3，显式标注 advisory 徽标
 * 2. T2 级执行器 (代码沙箱/Shell/写入)：默认永久硬冻结，须人类签署《安全宪章》方可调用
 * 3. T2 全量操作记入审计账本 (Audit Ledger)
 */

import { GroundingEvidence, DisputeSpanPacket, ArgumentNode } from '../../types';
import { extractMcpToolCallArguments, matchesMcpToolName } from '../acpClient';
import { analyzeStructuredMarkdown, computeClaimTokenOverlap } from './structuredTextAnalyzer';

export type ToolTier = 'T1' | 'T2';

export interface AuditLedgerEntry {
  id: string;
  timestamp: string;
  topicId: string;
  toolName: string;
  tier: ToolTier;
  input: string;
  outputSummary: string;
  isAuthorizedByCharter: boolean;
  status: 'executed' | 'blocked_by_charter' | 'failed';
}

const T1_READONLY_TOOLS = new Set([
  'rag_search',
  'static_analyzer',
  'ast_grep',
  'read_file',
  'git_diff_summary',
  'cargo_clippy',
]);

const T2_MUTATING_TOOLS = new Set([
  'code_sandbox',
  'sql_executor',
  'bash_exec',
  'write_file',
]);

const EVIDENCE_RECORD_KEYS = [
  'truthValue',
  'truth_value',
  'sourceTool',
  'source_tool',
  'tool',
  'toolName',
  'tool_name',
  'evidenceId',
  'evidence_id',
  'inputQueryOrCode',
  'input_query_or_code',
  'input',
  'query',
  'code',
  'rawOutput',
  'raw_output',
  'output',
  'result',
  'verifierReport',
  'verifier_report',
  'report',
  'conclusion',
  'claimId',
  'claim_id',
  'status',
  'verdict',
] as const;

function isEvidenceRecord(obj: Record<string, unknown>): boolean {
  return EVIDENCE_RECORD_KEYS.some((key) => key in obj);
}

function pickFirstString(
  item: Record<string, unknown>,
  keys: string[],
  fallback: string
): string {
  for (const key of keys) {
    const val = item[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
  }
  return fallback;
}

function pickOptionalString(
  item: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const val = item[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
  }
  return undefined;
}

function resolveEvidenceConfidence(item: Record<string, unknown>, fallback: number): number {
  const raw = item.confidence;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

const VALID_JSON_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);

function isHexChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function sanitizeInvalidJsonBackslashes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      out += '\\\\';
      continue;
    }
    if (VALID_JSON_ESCAPE_CHARS.has(next)) {
      out += '\\' + next;
      i += 1;
      continue;
    }
    if (
      next === 'u' &&
      i + 5 < raw.length &&
      isHexChar(raw[i + 2]) &&
      isHexChar(raw[i + 3]) &&
      isHexChar(raw[i + 4]) &&
      isHexChar(raw[i + 5])
    ) {
      out += raw.slice(i, i + 6);
      i += 5;
      continue;
    }
    out += '\\\\' + next;
    i += 1;
  }
  return out;
}

function parseJsonWithEscapeRecovery(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // 大模型在 JSON 内书写 grep/ast_grep 模式（如 fetch\(、\s+）时常漏写反斜杠转义，
    // 仅对非法转义序列补齐反斜杠后重试，保留所有合法 JSON 转义（\" \\ \/ \b \f \n \r \t \uXXXX）。
    return JSON.parse(sanitizeInvalidJsonBackslashes(raw));
  }
}

const FAIL_ASCII_TOKENS = new Set(['FAIL', 'FAILED', 'FALSE', 'REFUTED']);
const PASS_ASCII_TOKENS = new Set(['PASS', 'PASSED', 'TRUE', 'VERIFIED']);
const T2_HINT_ASCII_TOKENS = new Set(['SANDBOX', 'RUN', 'TEST', 'BASH', 'SHELL']);

const FAIL_ZH_PHRASES = [
  '未通过',
  '无法通过',
  '不成立',
  '未证实',
  '证伪',
  '失败',
  '驳回',
  '不支持',
  '存在缺陷',
  '严重异常',
] as const;

const PASS_ZH_PHRASES = ['符合预期', '测试通过', '通过', '证实', '成立', '支持', '有效'] as const;
const NEGATION_PREFIXES = ['不', '未', '无', '非', '没', '无法', '未能', '不可', '并未', '并不', '尚未'] as const;

function extractUpperAsciiWords(text: string): Set<string> {
  const words = new Set<string>();
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    const isWord =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      ch === '_';
    if (isWord) {
      buf += ch;
    } else if (buf) {
      words.add(buf.toUpperCase());
      buf = '';
    }
  }
  if (buf) {
    words.add(buf.toUpperCase());
  }
  return words;
}

function hasNonNegatedZhPhrase(text: string, phrase: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(phrase, pos);
    if (idx < 0) return false;
    const prefixSlice = text.slice(Math.max(0, idx - 2), idx);
    const isNegated = NEGATION_PREFIXES.some((neg) => prefixSlice.endsWith(neg));
    if (!isNegated) {
      return true;
    }
    pos = idx + phrase.length;
  }
  return false;
}

function classifyVerdictSignals(
  text: string,
  options?: { includeConflictFail?: boolean }
): { hasPass: boolean; hasFail: boolean } {
  const upperWords = extractUpperAsciiWords(text);
  let hasFail = false;
  for (const tok of FAIL_ASCII_TOKENS) {
    if (upperWords.has(tok)) {
      hasFail = true;
      break;
    }
  }
  if (!hasFail) {
    hasFail = FAIL_ZH_PHRASES.some((phrase) => text.includes(phrase));
  }
  if (!hasFail && options?.includeConflictFail) {
    hasFail = hasNonNegatedZhPhrase(text, '冲突');
  }

  let hasPass = false;
  for (const tok of PASS_ASCII_TOKENS) {
    if (upperWords.has(tok)) {
      hasPass = true;
      break;
    }
  }
  if (!hasPass) {
    hasPass = PASS_ZH_PHRASES.some((phrase) => hasNonNegatedZhPhrase(text, phrase));
  }
  return { hasPass, hasFail };
}

function evaluateTextVerdict(text: string): boolean {
  const { hasPass, hasFail } = classifyVerdictSignals(text);
  return hasPass && !hasFail;
}

function hasT2ExecutionHint(text: string): boolean {
  const upperWords = extractUpperAsciiWords(text);
  for (const tok of T2_HINT_ASCII_TOKENS) {
    if (upperWords.has(tok)) return true;
  }
  return text.includes('沙箱') || text.includes('执行');
}

const DECORATOR_EDGE_CHARS = new Set([' ', '\t', '-', '*', '+', '`', '_', "'", '"', '【', '】']);

function stripEdgeDecorators(raw: string, extraLeadingBracket = false): string {
  let start = 0;
  let end = raw.length;
  while (start < end) {
    const ch = raw[start];
    if (DECORATOR_EDGE_CHARS.has(ch) || (extraLeadingBracket && ch === '•')) {
      start++;
    } else {
      break;
    }
  }
  while (end > start && DECORATOR_EDGE_CHARS.has(raw[end - 1])) {
    end--;
  }
  return raw.slice(start, end).trim();
}

const TOOL_KV_KEYS = new Set(['验证工具', '工具名称', 'sourcetool', 'source_tool']);
const INPUT_KV_KEYS = new Set([
  '检验输入',
  '执行命令',
  '测试用例',
  'inputqueryorcode',
  'input_query_or_code',
  'input',
]);
const OUTPUT_KV_KEYS = new Set(['原始输出', '输出摘要', 'rawoutput', 'raw_output', 'output']);
const VERDICT_KV_KEYS = new Set([
  '真值判定',
  '检验结论',
  '测试结果',
  'verdict',
  'truthvalue',
  'truth_value',
]);
const REPORT_KV_KEYS = new Set([
  '实证报告',
  '推演说明',
  '详细结论',
  'verifierreport',
  'verifier_report',
  'report',
]);
const CLAIM_ID_KV_KEYS = new Set(['claimid', 'claim_id', '论点id', '关联论点']);

function doesEvidenceMatchArgumentNode(
  ev: GroundingEvidence,
  node: ArgumentNode,
  rootDisputeNodeId: string | undefined,
  totalEvidenceCount: number
): boolean {
  if (ev.claimId) {
    return ev.claimId === node.id;
  }
  if (rootDisputeNodeId && rootDisputeNodeId === node.id && totalEvidenceCount === 1) {
    return true;
  }
  if (!node.claim) {
    return false;
  }
  const overlap = computeClaimTokenOverlap(
    node.claim,
    `${ev.verifierReport} ${ev.inputQueryOrCode} ${ev.rawOutput}`
  );
  return overlap >= 0.45;
}

/**
 * 解析单条证据的布尔真值判定，同时兼容 truthValue (camelCase) 与 truth_value (snake_case)。
 * 仅当两者均未显式提供或为 null/undefined 时，才回退到 status === 'PASS' || verdict === 'PASS'；
 * 绝不允许 PASS 状态覆盖显式的 false 或 "false"。
 */
export function resolveEvidenceTruthValue(item: Record<string, unknown>): boolean {
  const hasTruthValue = item.truthValue !== undefined && item.truthValue !== null;
  const hasSnakeTruthValue = item.truth_value !== undefined && item.truth_value !== null;

  if (hasTruthValue || hasSnakeTruthValue) {
    const raw = hasTruthValue ? item.truthValue : item.truth_value;
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      return false;
    }
    return Boolean(raw);
  }

  const status = typeof item.status === 'string' ? item.status.trim().toUpperCase() : '';
  const verdict = typeof item.verdict === 'string' ? item.verdict.trim().toUpperCase() : '';
  return status === 'PASS' || verdict === 'PASS';
}

class TieredGroundingGovernor {
  private auditLedger: AuditLedgerEntry[] = [];

  public getToolTier(toolName: string): ToolTier {
    if (T2_MUTATING_TOOLS.has(toolName)) {
      return 'T2';
    }
    return 'T1';
  }

  /**
   * 调取工具并执行门禁判定
   */
  public executeGroundingTool(options: {
    topicId: string;
    toolName: string;
    inputQueryOrCode: string;
    isSafetyCharterSigned: boolean;
    executorFn: (input: string) => { rawOutput: string; truthValue: boolean; report: string };
  }): GroundingEvidence {
    const { topicId, toolName, inputQueryOrCode, isSafetyCharterSigned, executorFn } = options;
    const tier = this.getToolTier(toolName);
    const evidenceId = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // T2 硬门禁：安全宪章未签署，T2 永久冻结
    if (tier === 'T2' && !isSafetyCharterSigned) {
      const blockedEntry: AuditLedgerEntry = {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        topicId,
        toolName,
        tier: 'T2',
        input: inputQueryOrCode.slice(0, 100),
        outputSummary: 'BLOCKED: T2 级执行器处于硬冻结状态 (须签署安全宪章)',
        isAuthorizedByCharter: false,
        status: 'blocked_by_charter',
      };
      this.auditLedger.push(blockedEntry);

      console.warn(`[TieredGrounding] T2 Tool "${toolName}" is FROZEN because Safety Charter is unsigned.`);
      return {
        evidenceId,
        sourceTool: 'code_sandbox',
        inputQueryOrCode,
        rawOutput: '⚠️ [T2 硬冻结] 外部代码/沙箱执行器被系统策略冻结：人类首席仲裁官尚未签署《高危工具执行安全宪章》',
        truthValue: false,
        verifierReport: 'T2 执行沙箱未授权，系统策略性判定为不可信反事实检验',
        tier: 'T2',
        isAdvisory: false,
      };
    }

    // 允许执行
    try {
      const execResult = executorFn(inputQueryOrCode);
      const isAdvisory = tier === 'T1';

      const entry: AuditLedgerEntry = {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        topicId,
        toolName,
        tier,
        input: inputQueryOrCode.slice(0, 100),
        outputSummary: execResult.rawOutput.slice(0, 120),
        isAuthorizedByCharter: tier === 'T2' ? isSafetyCharterSigned : true,
        status: 'executed',
      };
      this.auditLedger.push(entry);

      return {
        evidenceId,
        sourceTool: toolName as any,
        inputQueryOrCode,
        rawOutput: execResult.rawOutput,
        truthValue: execResult.truthValue,
        verifierReport: execResult.report,
        tier,
        isAdvisory,
      };
    } catch (err) {
      const failedEntry: AuditLedgerEntry = {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        topicId,
        toolName,
        tier,
        input: inputQueryOrCode.slice(0, 100),
        outputSummary: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        isAuthorizedByCharter: tier === 'T2' ? isSafetyCharterSigned : true,
        status: 'failed',
      };
      this.auditLedger.push(failedEntry);
      throw err;
    }
  }

  public getAuditLedger(topicId?: string): AuditLedgerEntry[] {
    if (topicId) {
      return this.auditLedger.filter((e) => e.topicId === topicId);
    }
    return [...this.auditLedger];
  }

  /**
   * 计算证据对最终对齐/裁决权重的修正
   * 严格保障 R-3: T1 建议性证据权重 <= 0.3
   */
  public clampEvidenceWeight(tier: ToolTier, rawWeight: number): number {
    if (tier === 'T1') {
      return Math.min(0.30, Math.max(0.05, rawWeight));
    }
    return Math.min(1.0, Math.max(0.10, rawWeight));
  }

  private normalizeParsedEvidenceItem(
    item: Record<string, unknown>,
    defaults: { defaultInput: string; defaultConfidence: number }
  ): GroundingEvidence {
    const toolName =
      pickFirstString(
        item,
        ['sourceTool', 'source_tool', 'tool', 'toolName', 'tool_name'],
        'static_analyzer'
      ).trim() || 'static_analyzer';
    const detectedTier = this.getToolTier(toolName);
    const explicitTier = pickOptionalString(item, ['tier', 'toolTier', 'tool_tier'])?.toUpperCase();
    const tier: ToolTier = detectedTier === 'T2' || explicitTier === 'T2' ? 'T2' : 'T1';
    return {
      evidenceId: pickFirstString(
        item,
        ['evidenceId', 'evidence_id'],
        `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      ),
      sourceTool: toolName as GroundingEvidence['sourceTool'],
      inputQueryOrCode: pickFirstString(
        item,
        ['inputQueryOrCode', 'input_query_or_code', 'input', 'query', 'code'],
        defaults.defaultInput
      ),
      rawOutput: pickFirstString(
        item,
        ['rawOutput', 'raw_output', 'output', 'result'],
        ''
      ),
      truthValue: resolveEvidenceTruthValue(item),
      verifierReport: pickFirstString(
        item,
        ['verifierReport', 'verifier_report', 'report', 'conclusion'],
        '实证检验已执行'
      ),
      tier,
      isAdvisory: tier === 'T1',
      claimId: pickOptionalString(item, ['claimId', 'claim_id']),
      confidence: resolveEvidenceConfidence(item, defaults.defaultConfidence),
    };
  }

  private extractEvidencesFromParsedJson(
    parsed: unknown,
    defaults: { defaultInput: string; defaultConfidence: number }
  ): GroundingEvidence[] {
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    let list: unknown[] = [];
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (item) =>
          Boolean(item) &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          isEvidenceRecord(item as Record<string, unknown>)
      );
    } else {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.evidences)) {
        list = record.evidences.filter(
          (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        );
      } else if (isEvidenceRecord(record)) {
        list = [record];
      }
    }

    return list.map((item) =>
      this.normalizeParsedEvidenceItem(item as Record<string, unknown>, defaults)
    );
  }

  private computeWeightedTrueRatio(evidences: GroundingEvidence[]): number {
    let totalWeight = 0;
    let weightedTrueSum = 0;
    for (const ev of evidences) {
      const tier = ev.tier || this.getToolTier(ev.sourceTool);
      const weight = this.clampEvidenceWeight(tier, ev.confidence ?? 0.8);
      totalWeight += weight;
      if (ev.truthValue) {
        weightedTrueSum += weight;
      }
    }
    if (totalWeight <= 0) {
      return 0.50;
    }
    return Math.max(0.05, Math.min(0.95, Math.round((weightedTrueSum / totalWeight) * 100) / 100));
  }

  /**
   * 解析 Verifier 智能体输出，提取结构化实证记录 (DIANOIA / Consistency Illusion)
   * 优先从原生 MCP 工具 submit_grounding_evidence 中提取，次选 ```json 块，最后回退至启发式正则
   */
  public parseVerifierOutput(verifierText: string, mcpToolCalls?: any[]): GroundingEvidence[] {
    const evidences: GroundingEvidence[] = [];

    // 0. 优先从原生 MCP 工具调用 submit_grounding_evidence 中直接提取
    if (Array.isArray(mcpToolCalls) && mcpToolCalls.length > 0) {
      const toolCalls = mcpToolCalls.filter((c: any) =>
        matchesMcpToolName(c, 'submit_grounding_evidence')
      );
      for (const toolCall of toolCalls) {
        let args = extractMcpToolCallArguments(toolCall);
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (e) {
            console.warn('[tieredGroundingGovernor] Failed to parse JSON arguments from submit_grounding_evidence:', e);
          }
        }
        if (args && typeof args === 'object') {
          const rawList = Array.isArray(args.evidences)
            ? args.evidences
            : Array.isArray(args)
            ? args
            : [args];
          for (const item of rawList) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              evidences.push(
                this.normalizeParsedEvidenceItem(item as Record<string, unknown>, {
                  defaultInput: '实证代码/命令检测',
                  defaultConfidence: 0.9,
                })
              );
            }
          }
        }
      }
    }

    if (evidences.length > 0) {
      return evidences;
    }

    if (!verifierText || !verifierText.trim()) return [];

    const jsonDefaults = {
      defaultInput: '静态代码/规则检测',
      defaultConfidence: 0.85,
    };

    // 1. 尝试从所有 ```json ... ``` 块中提取（支持多块并跳过非 JSON / 非证据代码块）
    const ast = analyzeStructuredMarkdown(verifierText);
    for (const block of ast.fencedCodeBlocks) {
      const lang = block.lang.trim().toLowerCase();
      if (lang && lang !== 'json' && lang !== 'jsonc') {
        continue;
      }
      const rawBlock = block.content.trim();
      if (!rawBlock) continue;
      try {
        const parsed = parseJsonWithEscapeRecovery(rawBlock);
        evidences.push(...this.extractEvidencesFromParsedJson(parsed, jsonDefaults));
      } catch {
        // 非法或非 JSON 代码块（如 bash/html 片段）跳过，继续处理后续块
      }
    }

    // 若无 fenced 块提取到证据且全文为裸 JSON，尝试直接解析
    const trimmedText = verifierText.trim();
    if (evidences.length === 0 && (trimmedText.startsWith('{') || trimmedText.startsWith('['))) {
      try {
        const parsed = parseJsonWithEscapeRecovery(trimmedText);
        evidences.push(...this.extractEvidencesFromParsedJson(parsed, jsonDefaults));
      } catch {
        // 裸文本非合法 JSON，继续回退至结构化键值对抽取
      }
    }

    if (evidences.length > 0) {
      return evidences;
    }

    // 2. 确定性 AST 键值映射提取（替代散落的标签正则）
    let currentTool: string = 'static_analyzer';
    let currentInput: string = '';
    let currentOutput: string = '';
    let currentVerdict: boolean | undefined;
    let currentReport: string = '';
    let currentClaimId: string | undefined;
    let foundStructured = false;

    for (const kv of ast.keyValuePairs) {
      const normalizedKey = stripEdgeDecorators(kv.key, true).toLowerCase();
      const val = stripEdgeDecorators(kv.value);
      if (!normalizedKey || !val) continue;

      if (TOOL_KV_KEYS.has(normalizedKey)) {
        currentTool = val || 'static_analyzer';
        foundStructured = true;
      } else if (INPUT_KV_KEYS.has(normalizedKey)) {
        currentInput = val;
        foundStructured = true;
      } else if (OUTPUT_KV_KEYS.has(normalizedKey)) {
        currentOutput = val;
        foundStructured = true;
      } else if (VERDICT_KV_KEYS.has(normalizedKey)) {
        currentVerdict = evaluateTextVerdict(val);
        foundStructured = true;
      } else if (REPORT_KV_KEYS.has(normalizedKey)) {
        currentReport = val;
        foundStructured = true;
      } else if (CLAIM_ID_KV_KEYS.has(normalizedKey)) {
        currentClaimId = val;
        foundStructured = true;
      }
    }

    if (foundStructured) {
      const tier = this.getToolTier(currentTool);
      const resolvedVerdict =
        currentVerdict !== undefined
          ? currentVerdict
          : evaluateTextVerdict(currentReport || currentOutput || verifierText);
      evidences.push({
        evidenceId: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sourceTool: currentTool as GroundingEvidence['sourceTool'],
        inputQueryOrCode: currentInput || '验证命令/参数抽取',
        rawOutput: currentOutput || verifierText.slice(0, 150),
        truthValue: resolvedVerdict,
        verifierReport: currentReport || '完成实证检验',
        tier,
        isAdvisory: tier === 'T1',
        claimId: currentClaimId,
        confidence: 0.85,
      });
      return evidences;
    }

    // 3. 兜底解析：基于确定性词元分类判定（排除否定前缀误伤）
    const isPass = evaluateTextVerdict(verifierText);
    const tier: ToolTier = hasT2ExecutionHint(verifierText) ? 'T2' : 'T1';
    const detectedTool = tier === 'T2' ? 'code_sandbox' : 'static_analyzer';

    evidences.push({
      evidenceId: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceTool: detectedTool,
      inputQueryOrCode: '基于反事实压测文本的确定性逻辑检验',
      rawOutput: verifierText.slice(0, 200),
      truthValue: isPass,
      verifierReport: isPass ? '实证检验判定方案在目标约束下成立' : '实证检验复现失效工况或反例缺陷',
      tier,
      isAdvisory: tier === 'T1',
      confidence: 0.75,
    });

    return evidences;
  }

  /**
   * 处理全链条验证证据流并更新离散冲突切片与原子承诺链 (R-3 / P0-1)
   */
  public processVerifierEvidenceChain(
    options: ProcessVerifierEvidenceChainOptions
  ): ProcessVerifierEvidenceChainResult {
    const { topicId, verifierText, mcpToolCalls, isSafetyCharterSigned = false, disputePacket, committedStates } = options;
    const rawEvidences = this.parseVerifierOutput(verifierText, mcpToolCalls);

    const processedEvidences: GroundingEvidence[] = [];

    for (const ev of rawEvidences) {
      const detectedTier = this.getToolTier(ev.sourceTool);
      const tier: ToolTier = detectedTier === 'T2' || ev.tier === 'T2' ? 'T2' : 'T1';
      let finalEv = { ...ev, tier };

      if (tier === 'T2' && !isSafetyCharterSigned) {
        // T2 级执行器未授权，执行硬冻结
        const blockedEntry: AuditLedgerEntry = {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
          topicId,
          toolName: ev.sourceTool,
          tier: 'T2',
          input: ev.inputQueryOrCode.slice(0, 100),
          outputSummary: 'BLOCKED: T2 级执行沙箱处于未签署安全宪章的硬冻结状态',
          isAuthorizedByCharter: false,
          status: 'blocked_by_charter',
        };
        this.auditLedger.push(blockedEntry);

        finalEv = {
          ...finalEv,
          rawOutput: '⚠️ [T2 硬冻结] 执行沙箱未签署《安全宪章》，系统策略性判定为不可信反事实',
          truthValue: false,
          verifierReport: 'T2 沙箱未授权，依据 R-3 规范硬性冻结并判定不成立',
          isAdvisory: false,
        };
      } else {
        // 允许通过并审计
        const entry: AuditLedgerEntry = {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
          topicId,
          toolName: ev.sourceTool,
          tier,
          input: ev.inputQueryOrCode.slice(0, 100),
          outputSummary: ev.rawOutput.slice(0, 120),
          isAuthorizedByCharter: tier === 'T2' ? isSafetyCharterSigned : true,
          status: 'executed',
        };
        this.auditLedger.push(entry);
        finalEv.isAdvisory = tier === 'T1';
      }

      processedEvidences.push(finalEv);
    }

    const weightedTrueRatio = this.computeWeightedTrueRatio(processedEvidences);

    // 绑定更新离散冲突切片 (DisputeSpanPacket)
    let updatedDispute: DisputeSpanPacket | undefined;
    if (disputePacket) {
      updatedDispute = {
        ...disputePacket,
        evidenceChain: processedEvidences,
        groundingStatus: weightedTrueRatio >= 0.5 ? 'verified_true' : 'verified_false',
      };
    }

    // 绑定更新原子承诺链 (Atomic Commitment Chain)
    let updatedCommittedStates: ArgumentNode[] | undefined;
    if (committedStates && committedStates.length > 0) {
      updatedCommittedStates = committedStates.map((node) => {
        // 关联此论点的证据（优先显式 claimId 与根争议绑定，兜底使用技术词元集合重合度而非 .slice(0, 10)）
        const relatedEvidences = processedEvidences.filter((ev) =>
          doesEvidenceMatchArgumentNode(
            ev,
            node,
            disputePacket?.rootDisputeNodeId,
            processedEvidences.length
          )
        );

        if (relatedEvidences.length === 0) {
          return node;
        }

        const evidenceIds = [...(node.evidenceRefs || [])];
        relatedEvidences.forEach((ev) => {
          if (!evidenceIds.includes(ev.evidenceId)) {
            evidenceIds.push(ev.evidenceId);
          }
        });

        // 根据实证真值判定节点状态
        const allPassed = relatedEvidences.every((ev) => ev.truthValue);
        const anyFailed = relatedEvidences.some((ev) => !ev.truthValue);

        let newStatus: 'supported' | 'disputed' | 'refuted' = node.status || 'supported';
        if (anyFailed) {
          newStatus = 'refuted';
        } else if (allPassed) {
          newStatus = 'supported';
        } else {
          newStatus = 'disputed';
        }

        return {
          ...node,
          evidenceRefs: evidenceIds,
          status: newStatus,
        };
      });
    }

    return {
      evidences: processedEvidences,
      weightedTrueRatio,
      updatedDispute,
      updatedCommittedStates,
    };
  }

  /**
   * 从验证官输出文本中提取接地实证真值率 (0.05 ~ 0.95)
   * 采用反事实证据链加权解析，避免朴素关键词包含导致的反义词假阳性（如“不支持”误判为“支持”）
   */
  public extractGroundedTrueRatio(verificationText: string): number {
    if (!verificationText || !verificationText.trim()) return 0.50;

    const evidences = this.parseVerifierOutput(verificationText);
    if (evidences.length > 0) {
      return this.computeWeightedTrueRatio(evidences);
    }

    // 兜底词元排查：基于否定前缀隔离与确定性词集，杜绝反义词包含误伤
    const { hasPass, hasFail } = classifyVerdictSignals(verificationText, {
      includeConflictFail: true,
    });

    if (hasPass && !hasFail) return 0.85;
    if (hasFail && !hasPass) return 0.15;
    if (hasPass && hasFail) return 0.40;
    return 0.50;
  }
}

export interface ProcessVerifierEvidenceChainOptions {
  topicId: string;
  verifierText: string;
  mcpToolCalls?: any[];
  isSafetyCharterSigned?: boolean;
  disputePacket?: DisputeSpanPacket;
  committedStates?: ArgumentNode[];
}

export interface ProcessVerifierEvidenceChainResult {
  evidences: GroundingEvidence[];
  weightedTrueRatio: number;
  updatedDispute?: DisputeSpanPacket;
  updatedCommittedStates?: ArgumentNode[];
}

export const tieredGroundingGovernor = new TieredGroundingGovernor();

export function parseVerifierOutput(verifierText: string, mcpToolCalls?: any[]): GroundingEvidence[] {
  return tieredGroundingGovernor.parseVerifierOutput(verifierText, mcpToolCalls);
}

export function processVerifierEvidenceChain(
  options: ProcessVerifierEvidenceChainOptions
): ProcessVerifierEvidenceChainResult {
  return tieredGroundingGovernor.processVerifierEvidenceChain(options);
}

export function extractGroundedTrueRatio(verifierText: string): number {
  return tieredGroundingGovernor.extractGroundedTrueRatio(verifierText);
}
