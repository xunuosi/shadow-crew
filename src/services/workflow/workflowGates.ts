import type { WorkflowStageKey } from '../../types';

/**
 * 工作流结构化门禁解析器
 *
 * 原则：门禁只认真实证。缺少结构化块 / 缺少证据的结论一律降级，
 * 不允许用自然语言里的「看起来没问题」冒充通过。
 */

export const REVIEW_REPORT_OPEN = '<<<WORKFLOW_REVIEW_REPORT>>>';
export const REVIEW_REPORT_CLOSE = '<<<WORKFLOW_REVIEW_REPORT_END>>>';
export const VERIFY_REPORT_OPEN = '<<<WORKFLOW_VERIFY_REPORT>>>';
export const VERIFY_REPORT_CLOSE = '<<<WORKFLOW_VERIFY_REPORT_END>>>';

export type FindingSeverity = 'blocker' | 'major' | 'minor';

export interface WorkflowFinding {
  severity: FindingSeverity;
  title: string;
  evidence: string;
  suggestion?: string;
}

export interface ReviewReport {
  valid: boolean;
  verdict: 'approve' | 'conditional' | 'block';
  findings: WorkflowFinding[];
  /** 原文中没有证据、已被降级为 minor 的条目数 */
  unverifiedFindings: number;
  error?: string;
}

export interface VerificationCheck {
  command: string;
  output: string;
  passed: boolean;
}

export interface VerificationReport {
  valid: boolean;
  verdict: 'pass' | 'fail';
  checks: VerificationCheck[];
  failures: WorkflowFinding[];
  error?: string;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

function extractBlock(raw: string, open: string, close: string): string | null {
  const start = raw.indexOf(open);
  if (start < 0) return null;
  const end = raw.indexOf(close, start + open.length);
  if (end < 0) return null;
  return raw.slice(start + open.length, end).trim();
}

function normalizeSeverity(value: unknown): FindingSeverity {
  const text = String(value ?? '').toLowerCase();
  if (/blocker|critical|fatal|p0|阻断|致命/.test(text)) return 'blocker';
  if (/major|high|p1|严重|重要/.test(text)) return 'major';
  return 'minor';
}

function normalizeFindings(value: unknown): {
  findings: WorkflowFinding[];
  unverifiedFindings: number;
} {
  if (!Array.isArray(value)) return { findings: [], unverifiedFindings: 0 };
  let unverifiedFindings = 0;
  const findings: WorkflowFinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? record.finding ?? record.summary ?? '').trim();
    if (!title) continue;
    const evidence = String(record.evidence ?? record.proof ?? record.reference ?? '').trim();
    let severity = normalizeSeverity(record.severity);
    if (!evidence) {
      // 无证据的结论不得作为阻断项
      if (severity !== 'minor') unverifiedFindings += 1;
      severity = 'minor';
    }
    findings.push({
      severity,
      title,
      evidence,
      suggestion: String(record.suggestion ?? record.fix ?? '').trim() || undefined,
    });
  }
  return { findings, unverifiedFindings };
}

export function parseReviewReport(raw: string): ReviewReport {
  const block = extractBlock(raw, REVIEW_REPORT_OPEN, REVIEW_REPORT_CLOSE);
  if (!block) {
    return {
      valid: false,
      verdict: 'block',
      findings: [],
      unverifiedFindings: 0,
      error: `缺少结构化评审块 ${REVIEW_REPORT_OPEN} ... ${REVIEW_REPORT_CLOSE}`,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(block)) as Record<string, unknown>;
  } catch (err) {
    return {
      valid: false,
      verdict: 'block',
      findings: [],
      unverifiedFindings: 0,
      error: `评审块不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const rawVerdict = String(parsed.verdict ?? '').toLowerCase();
  const verdict =
    rawVerdict === 'approve' || rawVerdict === 'conditional' || rawVerdict === 'block'
      ? rawVerdict
      : /approve|通过/.test(rawVerdict)
        ? 'approve'
        : /conditional|有条件|部分/.test(rawVerdict)
          ? 'conditional'
          : 'block';
  const { findings, unverifiedFindings } = normalizeFindings(parsed.findings);
  return { valid: true, verdict, findings, unverifiedFindings };
}

export function parseVerificationReport(raw: string): VerificationReport {
  const block = extractBlock(raw, VERIFY_REPORT_OPEN, VERIFY_REPORT_CLOSE);
  if (!block) {
    return {
      valid: false,
      verdict: 'fail',
      checks: [],
      failures: [],
      error: `缺少结构化验收块 ${VERIFY_REPORT_OPEN} ... ${VERIFY_REPORT_CLOSE}`,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(block)) as Record<string, unknown>;
  } catch (err) {
    return {
      valid: false,
      verdict: 'fail',
      checks: [],
      failures: [],
      error: `验收块不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const checks: VerificationCheck[] = Array.isArray(parsed.checks)
    ? parsed.checks
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          command: String(item.command ?? item.name ?? '').trim(),
          output: String(item.output ?? item.result ?? '').trim(),
          passed: item.passed === true || item.status === 'pass' || item.status === 'passed',
        }))
    : [];
  const { findings: failures } = normalizeFindings(parsed.failures ?? parsed.findings);
  const rawVerdict = String(parsed.verdict ?? '').toLowerCase();
  const verdict: 'pass' | 'fail' = rawVerdict === 'pass' ? 'pass' : 'fail';
  return { valid: true, verdict, checks, failures };
}

/**
 * 验收通过必须同时满足：结构化块合法、结论 pass、至少一条检查、所有检查 passed。
 * 任何一项不满足都按失败处理（fail-closed）。
 */
export function isVerificationPassed(report: VerificationReport): boolean {
  return (
    report.valid &&
    report.verdict === 'pass' &&
    report.checks.length > 0 &&
    report.checks.every((check) => check.passed) &&
    report.failures.length === 0
  );
}

export function hasBlockingFinding(report: ReviewReport): boolean {
  return report.findings.some((finding) => finding.severity === 'blocker');
}

export function aggregateReviewVerdict(
  reports: ReviewReport[]
): 'approve' | 'conditional' | 'block' {
  if (reports.some((report) => hasBlockingFinding(report))) return 'block';
  if (
    reports.some(
      (report) =>
        report.verdict === 'block' ||
        report.verdict === 'conditional' ||
        report.findings.some((finding) => finding.severity === 'major')
    )
  ) {
    return 'conditional';
  }
  return 'approve';
}

export interface DesignArtifactCheck {
  hasAcceptanceCriteria: boolean;
  acceptanceCriteria: string;
  hasFilePlan: boolean;
}

const ACCEPTANCE_HEADING =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:验收标准|验收条件|测试点|验证方式|acceptance criteria|test plan)\s*[:：]?\s*/i;

export function parseDesignArtifact(content: string): DesignArtifactCheck {
  const text = content || '';
  const match = ACCEPTANCE_HEADING.exec(text);
  let acceptanceCriteria = '';
  if (match) {
    const from = match.index + match[0].length;
    const rest = text.slice(from);
    const nextHeading = /\n\s*(?:#{1,6}\s+|\d+[.、]\s*\S)/.exec(rest);
    acceptanceCriteria = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim().slice(0, 4000);
  }
  const hasFilePlan =
    /(?:改动文件|修改文件|文件清单|涉及文件|files? (?:to )?(?:change|modify))/i.test(text) ||
    /(?:^|\s)[\w./-]+\.(?:ts|tsx|js|jsx|go|rs|java|py|sql|yml|yaml|json|md)(?::\d+)?/m.test(text);
  return {
    hasAcceptanceCriteria: Boolean(match) && acceptanceCriteria.length > 0,
    acceptanceCriteria,
    hasFilePlan,
  };
}

/**
 * 交付物最小有效性：正文有任何实质内容即可，避免空回合被当成成功。
 * 构建阶段还要求至少一处真实文件/命令线索，否则提示可能只是「口头实现」。
 */
export function hasSubstantiveContent(content: string, minChars = 80): boolean {
  return (content || '').replace(/\s+/g, ' ').trim().length >= minChars;
}

export function looksLikeRealImplementation(content: string): boolean {
  const text = content || '';
  const fileRef = /(?:^|\s)[\w./-]+\.(?:ts|tsx|js|jsx|go|rs|java|py|sql|yml|yaml|json|md)(?::\d+)?/m;
  const commandRef = /(?:^|\n)\s*(?:\$|>|npm |pnpm |yarn |go |cargo |pytest|git |docker |kubectl )/im;
  return fileRef.test(text) || commandRef.test(text);
}

/** 门禁失败时给用户的明确原因，避免静默停摆 */
export function describeStageFailure(
  stageKey: WorkflowStageKey,
  reason: string
): string {
  return `工作流在阶段「${stageKey}」中断：${reason}`;
}
