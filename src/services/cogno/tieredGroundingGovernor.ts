/**
 * CognoNexus 分级取证与安全宪章执行器 (Tiered Grounding Governor)
 * 支撑 R-3 要求：
 * 1. T1 级只读工具 (AST/RAG/Grep)：先行落地，权重 <= 0.3，显式标注 advisory 徽标
 * 2. T2 级执行器 (代码沙箱/Shell/写入)：默认永久硬冻结，须人类签署《安全宪章》方可调用
 * 3. T2 全量操作记入审计账本 (Audit Ledger)
 */

import { GroundingEvidence, DisputeSpanPacket, ArgumentNode } from '../../types';

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

  /**
   * 解析 Verifier 智能体输出，提取结构化实证记录 (DIANOIA / Consistency Illusion)
   */
  public parseVerifierOutput(verifierText: string): GroundingEvidence[] {
    if (!verifierText || !verifierText.trim()) return [];

    const evidences: GroundingEvidence[] = [];

    // 1. 尝试从 ```json ... ``` 块中提取
    const jsonMatch = verifierText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.evidences)
          ? parsed.evidences
          : [parsed];

        for (const item of list) {
          if (item && typeof item === 'object') {
            const toolName = item.sourceTool || item.tool || item.toolName || 'static_analyzer';
            const tier = this.getToolTier(toolName);
            evidences.push({
              evidenceId: item.evidenceId || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sourceTool: toolName,
              inputQueryOrCode: item.inputQueryOrCode || item.input || item.query || item.code || '静态代码/规则检测',
              rawOutput: item.rawOutput || item.output || item.result || '',
              truthValue: Boolean(item.truthValue ?? (item.status === 'PASS' || item.verdict === 'PASS' || item.truthValue === 'true')),
              verifierReport: item.verifierReport || item.report || item.conclusion || '实证检验已执行',
              tier,
              isAdvisory: tier === 'T1',
              claimId: item.claimId,
              confidence: typeof item.confidence === 'number' ? item.confidence : 0.85,
            });
          }
        }
      } catch (e) {
        // JSON 解析失败则回退到正则抽取
      }
    }

    if (evidences.length > 0) {
      return evidences;
    }

    // 2. 启发式正则/标签提取 (处理非严格 JSON 的结构化文本)
    // 寻找常见结构: 【验证工具】/【检验输入】/【真值判定】/【实证结论】
    const lines = verifierText.split('\n').map((l) => l.trim()).filter(Boolean);
    let currentTool: string = 'static_analyzer';
    let currentInput: string = '';
    let currentOutput: string = '';
    let currentVerdict: boolean = true;
    let currentReport: string = '';
    let foundStructured = false;

    for (const line of lines) {
      if (/【?(?:验证工具|工具名称|sourceTool)】?[:：]\s*(.+)/i.test(line)) {
        const matched = line.match(/【?(?:验证工具|工具名称|sourceTool)】?[:：]\s*(.+)/i);
        if (matched) currentTool = matched[1].trim();
        foundStructured = true;
      } else if (/【?(?:检验输入|执行命令|测试用例|input)】?[:：]\s*(.+)/i.test(line)) {
        const matched = line.match(/【?(?:检验输入|执行命令|测试用例|input)】?[:：]\s*(.+)/i);
        if (matched) currentInput = matched[1].trim();
        foundStructured = true;
      } else if (/【?(?:真值判定|检验结论|测试结果|verdict|truthValue)】?[:：]\s*(.+)/i.test(line)) {
        const matched = line.match(/【?(?:真值判定|检验结论|测试结果|verdict|truthValue)】?[:：]\s*(.+)/i);
        if (matched) {
          const val = matched[1].toUpperCase();
          currentVerdict = val.includes('PASS') || val.includes('TRUE') || val.includes('通过') || val.includes('证实') || val.includes('成立');
        }
        foundStructured = true;
      } else if (/【?(?:实证报告|推演说明|详细结论|verifierReport)】?[:：]\s*(.+)/i.test(line)) {
        const matched = line.match(/【?(?:实证报告|推演说明|详细结论|verifierReport)】?[:：]\s*(.+)/i);
        if (matched) currentReport = matched[1].trim();
        foundStructured = true;
      }
    }

    if (foundStructured) {
      const tier = this.getToolTier(currentTool);
      evidences.push({
        evidenceId: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sourceTool: currentTool,
        inputQueryOrCode: currentInput || '验证命令/参数抽取',
        rawOutput: currentOutput || verifierText.slice(0, 150),
        truthValue: currentVerdict,
        verifierReport: currentReport || '完成实证检验',
        tier,
        isAdvisory: tier === 'T1',
        confidence: 0.85,
      });
      return evidences;
    }

    // 3. 兜底解析：提炼文本核心反事实测试判定
    const isPass = /(PASS|TRUE|通过|证实|符合预期|测试通过|成立)/i.test(verifierText) &&
      !/(FAIL|未通过|证伪|失败|存在缺陷|严重异常)/i.test(verifierText);
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
    const { topicId, verifierText, isSafetyCharterSigned = false, disputePacket, committedStates } = options;
    const rawEvidences = this.parseVerifierOutput(verifierText);

    const processedEvidences: GroundingEvidence[] = [];
    let totalWeight = 0;
    let weightedTrueSum = 0;

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

      // 计算权重：T1 <= 0.3, T2 <= 1.0
      const weight = this.clampEvidenceWeight(tier, finalEv.confidence ?? 0.8);
      totalWeight += weight;
      if (finalEv.truthValue) {
        weightedTrueSum += weight;
      }
      processedEvidences.push(finalEv);
    }

    const weightedTrueRatio = totalWeight > 0
      ? Math.max(0.05, Math.min(0.95, Math.round((weightedTrueSum / totalWeight) * 100) / 100))
      : 0.50;

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
}

export interface ProcessVerifierEvidenceChainOptions {
  topicId: string;
  verifierText: string;
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

export function parseVerifierOutput(verifierText: string): GroundingEvidence[] {
  return tieredGroundingGovernor.parseVerifierOutput(verifierText);
}

export function processVerifierEvidenceChain(
  options: ProcessVerifierEvidenceChainOptions
): ProcessVerifierEvidenceChainResult {
  return tieredGroundingGovernor.processVerifierEvidenceChain(options);
}
