/**
 * CognoNexus 分级取证与安全宪章执行器 (Tiered Grounding Governor)
 * 支撑 R-3 要求：
 * 1. T1 级只读工具 (AST/RAG/Grep)：先行落地，权重 <= 0.3，显式标注 advisory 徽标
 * 2. T2 级执行器 (代码沙箱/Shell/写入)：默认永久硬冻结，须人类签署《安全宪章》方可调用
 * 3. T2 全量操作记入审计账本 (Audit Ledger)
 */

import { GroundingEvidence } from '../../types';

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
}

export const tieredGroundingGovernor = new TieredGroundingGovernor();
