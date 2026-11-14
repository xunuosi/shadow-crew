/**
 * CognoNexus 分级取证与安全宪章执行器 (Tiered Grounding Governor)
 * 支撑 R-3 要求：
 * 1. T1 级只读工具 (AST/RAG/Grep)：先行落地，权重 <= 0.3，显式标注 advisory 徽标
 * 2. T2 级执行器 (代码沙箱/Shell/写入)：默认永久硬冻结，须人类签署《安全宪章》方可调用
 * 3. T2 全量操作记入审计账本 (Audit Ledger)
 */

import { GroundingEvidence, DisputeSpanPacket, ArgumentNode } from '../../types';
import { extractMcpToolCallArguments, matchesMcpToolName } from '../acpClient';

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

function parseJsonWithEscapeRecovery(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // 大模型在 JSON 内书写 grep/ast_grep 正则（如 fetch\(、\s+）时常漏写反斜杠转义，
    // 仅对非法转义序列补齐反斜杠后重试，保留所有合法 JSON 转义（\" \\ \/ \b \f \n \r \t \uXXXX）。
    const sanitized = raw.replace(
      /\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\(.)/g,
      (match, valid, invalid) => (valid !== undefined ? match : `\\\\${invalid}`)
    );
    return JSON.parse(sanitized);
  }
}

function evaluateTextVerdict(text: string): boolean {
  const hasFailToken =
    /\b(?:FAIL|FAILED|FALSE|REFUTED)\b|(?:未通过|不成立|未证实|证伪|失败|驳回|不支持)/i.test(text);
  const hasPassToken =
    /\b(?:PASS|PASSED|TRUE|VERIFIED)\b|(?:(?<![不未无])通过|(?<![不未无])证实|(?<![不未无])成立|(?<![不未无])支持)/i.test(text);
  return hasPassToken && !hasFailToken;
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
    const tier = this.getToolTier(toolName);
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
    const jsonBlocks = verifierText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
    for (const jsonMatch of jsonBlocks) {
      const rawBlock = jsonMatch[1]?.trim();
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
        // 裸文本非合法 JSON，继续回退至结构化正则抽取
      }
    }

    if (evidences.length > 0) {
      return evidences;
    }

    // 2. 启发式正则/标签提取 (处理非严格 JSON 的结构化文本)
    // 寻找常见结构: 【验证工具】/【检验输入】/【真值判定】/【实证结论】及 camelCase / snake_case 标签
    const lines = verifierText.split('\n').map((l) => l.trim()).filter(Boolean);
    let currentTool: string = 'static_analyzer';
    let currentInput: string = '';
    let currentOutput: string = '';
    let currentVerdict: boolean | undefined;
    let currentReport: string = '';
    let foundStructured = false;

    const stripDecorators = (val: string): string =>
      val.trim().replace(/^['"`]+|['"`]+$/g, '').trim();

    for (const line of lines) {
      const toolMatch = line.match(
        /^[-*\s]*[*_`]*【?(?:验证工具|工具名称|sourceTool|source_tool)】?[*_`]*\s*[:：]\s*(.+)/i
      );
      if (toolMatch) {
        currentTool = stripDecorators(toolMatch[1]) || 'static_analyzer';
        foundStructured = true;
        continue;
      }

      const inputMatch = line.match(
        /^[-*\s]*[*_`]*【?(?:检验输入|执行命令|测试用例|inputQueryOrCode|input_query_or_code|input)】?[*_`]*\s*[:：]\s*(.+)/i
      );
      if (inputMatch) {
        currentInput = stripDecorators(inputMatch[1]);
        foundStructured = true;
        continue;
      }

      const outputMatch = line.match(
        /^[-*\s]*[*_`]*【?(?:原始输出|输出摘要|rawOutput|raw_output|output)】?[*_`]*\s*[:：]\s*(.+)/i
      );
      if (outputMatch) {
        currentOutput = stripDecorators(outputMatch[1]);
        foundStructured = true;
        continue;
      }

      const verdictMatch = line.match(
        /^[-*\s]*[*_`]*【?(?:真值判定|检验结论|测试结果|verdict|truthValue|truth_value)】?[*_`]*\s*[:：]\s*(.+)/i
      );
      if (verdictMatch) {
        currentVerdict = evaluateTextVerdict(verdictMatch[1]);
        foundStructured = true;
        continue;
      }

      const reportMatch = line.match(
        /^[-*\s]*[*_`]*【?(?:实证报告|推演说明|详细结论|verifierReport|verifier_report|report)】?[*_`]*\s*[:：]\s*(.+)/i
      );
      if (reportMatch) {
        currentReport = stripDecorators(reportMatch[1]);
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
        sourceTool: currentTool,
        inputQueryOrCode: currentInput || '验证命令/参数抽取',
        rawOutput: currentOutput || verifierText.slice(0, 150),
        truthValue: resolvedVerdict,
        verifierReport: currentReport || '完成实证检验',
        tier,
        isAdvisory: tier === 'T1',
        confidence: 0.85,
      });
      return evidences;
    }

    // 3. 兜底解析：提炼文本核心反事实测试判定（防反义词包含误伤，如“不支持”/“不成立”排除）
    const isPass =
      /(PASS|\bTRUE\b|(?<![不未无])通过|(?<![不未无])证实|符合预期|测试通过|(?<![不未无])成立|(?<![不未无])支持)/i.test(verifierText) &&
      !/(FAIL|\bFALSE\b|未通过|不成立|证伪|失败|存在缺陷|严重异常|不支持)/i.test(verifierText);
    const tier = /sandbox|沙箱|执行|run|test|bash/i.test(verifierText) ? 'T2' : 'T1';
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
      const tier = this.getToolTier(ev.sourceTool);
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
        // 关联此论点的证据
        const relatedEvidences = processedEvidences.filter((ev) =>
          ev.claimId === node.id ||
          (node.claim && ev.verifierReport.includes(node.claim.slice(0, 10))) ||
          (node.claim && ev.inputQueryOrCode.includes(node.claim.slice(0, 10)))
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

    // 兜底正则排查：增加否定词前瞻与显式排除，杜绝词内包含误伤
    const hasFail = /(FAIL|REFUTED|\bFALSE\b|未通过|证伪|不成立|失败|冲突|严重异常|存在缺陷|驳回|不支持)/i.test(verificationText);
    const hasPass = /(PASS|VERIFIED|\bTRUE\b|符合预期|测试通过|(?<![不未无])成立|(?<![不未无])证实|有效|(?<![不未无])支持)/i.test(verificationText);

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
