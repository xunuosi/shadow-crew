/**
 * CognoNexus 少数派异议报告保留器 (Minority Report Preserver)
 * 提取并持久化未被完全证伪的自洽对立主张，并附带黑天鹅重开判定条件
 */

import { ChallengeCritiquePayload, MinorityReport } from '../../types';
import { extractChallengeCritiqueFromAcpResponse } from '../acpClient';
import { analyzeStructuredMarkdown } from './structuredTextAnalyzer';

export interface CompileMinorityReportOptions {
  dissentingAgentId: string;
  dissentingAgentName: string;
  dissentingAgentModel?: string;
  critiqueText: string;
  proposalText?: string;
  customTriggers?: string[];
  critiquePayload?: ChallengeCritiquePayload | null;
}

const THESIS_CUE_TOKENS = ['失效场景', '致命隐患', '风险', '脆弱', '漏洞'] as const;
const RATIONALE_CUE_TOKENS = ['连锁反应', '推演', '崩溃原因', '根因', '前提'] as const;

function stripMarkdownItemDecorators(raw: string): string {
  let s = raw.trim();
  while (s.startsWith('#') || s.startsWith('-') || s.startsWith('*') || s.startsWith('•')) {
    s = s.slice(1).trim();
  }
  let idx = 0;
  while (idx < s.length && idx < 4 && s[idx] >= '0' && s[idx] <= '9') {
    idx++;
  }
  if (idx > 0 && (s[idx] === '.' || s[idx] === ')' || s[idx] === '、')) {
    s = s.slice(idx + 1).trim();
  }
  while (s.startsWith(':') || s.startsWith('：')) {
    s = s.slice(1).trim();
  }
  return s.trim();
}

/**
 * 从挑战者结构化契约 (submit_challenge_critique) 与反例文本中提炼少数派异议报告
 */
export function compileMinorityReport(options: CompileMinorityReportOptions): MinorityReport {
  const {
    dissentingAgentId,
    dissentingAgentName,
    dissentingAgentModel,
    critiqueText,
    customTriggers,
    critiquePayload,
  } = options;

  const extracted = critiquePayload
    ? { critiquePayload, cleanedText: critiqueText || '' }
    : extractChallengeCritiqueFromAcpResponse({ textResponse: critiqueText || '' });
  const payload = extracted.critiquePayload;
  const cleanedCritique = extracted.cleanedText || critiqueText || '';
  const ast = analyzeStructuredMarkdown(cleanedCritique);

  // 1. 抽取核心反对论点：优先消费结构化 payload，其次使用 AST 列表/标题结构
  let coreThesis = '对主选架构方案在极端并发与容灾场景下的鲁棒性持有保留异议。';
  if (payload?.failureScenarios?.length) {
    coreThesis = payload.failureScenarios[0].slice(0, 150);
  } else if (payload?.fatalFlaws?.length) {
    coreThesis = payload.fatalFlaws[0].slice(0, 150);
  } else if (payload?.summary) {
    coreThesis = payload.summary.slice(0, 150);
  } else {
    const candidates = [...ast.listItems, ...ast.sentences];
    const thesisCandidate =
      candidates.find((l) => THESIS_CUE_TOKENS.some((tok) => l.includes(tok))) || candidates[0];
    if (thesisCandidate) {
      coreThesis = stripMarkdownItemDecorators(thesisCandidate).slice(0, 150);
    }
  }

  // 2. 抽取自洽逻辑依据 (Rationality Basis)
  let rationality =
    '该异议构建了具体的失效输入或并发竞争工况，在假定依赖组件发生网络分区或资源耗尽时具有因果自洽性。';
  if (payload?.hiddenAssumptions?.length) {
    rationality = payload.hiddenAssumptions.join('；').slice(0, 200);
  } else if (payload?.counterDemands?.length) {
    rationality = payload.counterDemands.join('；').slice(0, 200);
  } else {
    const candidates = [...ast.listItems, ...ast.sentences];
    const rationaleCandidate =
      candidates.find((l) => RATIONALE_CUE_TOKENS.some((tok) => l.includes(tok))) || candidates[1];
    if (rationaleCandidate) {
      rationality = stripMarkdownItemDecorators(rationaleCandidate).slice(0, 200);
    }
  }

  // 3. 构建黑天鹅重启判定条件 (Reopening Triggers)
  const defaultTriggers = [
    '若生产环境高并发压测中 P99 延迟超过 250ms，须立即重启本议题；',
    '若出现跨机房网络抖动导致数据不一致或重放攻击，强制解冻本少数派方案；',
    '若执行 Agent 实施代码补丁复杂度超出预期并阻塞主干分支超过 2 个迭代，重新激活备选方案。',
  ];

  const triggers =
    customTriggers && customTriggers.length > 0
      ? customTriggers
      : payload?.reopeningTriggers && payload.reopeningTriggers.length > 0
      ? payload.reopeningTriggers
      : defaultTriggers;

  return {
    id: `mr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dissentingAgentId,
    dissentingAgentName,
    dissentingAgentModel: dissentingAgentModel || 'Heterogeneous-LLM',
    coreDissentThesis: coreThesis,
    rationalityBasis: rationality,
    reopeningTriggers: triggers,
    recordedAt: new Date().toISOString(),
  };
}
