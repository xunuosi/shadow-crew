/**
 * CognoNexus 少数派异议报告保留器 (Minority Report Preserver)
 * 提取并持久化未被完全证伪的自洽对立主张，并附带黑天鹅重开判定条件
 */

import { MinorityReport } from '../../types';

export interface CompileMinorityReportOptions {
  dissentingAgentId: string;
  dissentingAgentName: string;
  dissentingAgentModel?: string;
  critiqueText: string;
  proposalText?: string;
  customTriggers?: string[];
}

/**
 * 从挑战者反例文本与立论方案中提炼结构化少数派异议报告
 */
export function compileMinorityReport(options: CompileMinorityReportOptions): MinorityReport {
  const {
    dissentingAgentId,
    dissentingAgentName,
    dissentingAgentModel,
    critiqueText,
    customTriggers,
  } = options;

  // 1. 抽取核心反对论点
  let coreThesis = '对主选架构方案在极端并发与容灾场景下的鲁棒性持有保留异议。';
  const lines = critiqueText.split('\n').map((l) => l.trim()).filter(Boolean);
  const thesisCandidate = lines.find(
    (l) => l.includes('失效场景') || l.includes('致命隐患') || l.includes('风险') || l.startsWith('1.')
  );
  if (thesisCandidate) {
    coreThesis = thesisCandidate.replace(/^[0-9.#\-*：:\s]+/, '').slice(0, 150);
  }

  // 2. 抽取自洽逻辑依据 (Rationality Basis)
  let rationality = '该异议构建了具体的失效输入或并发竞争工况，在假定依赖组件发生网络分区或资源耗尽时具有因果自洽性。';
  const rationaleCandidate = lines.find(
    (l) => l.includes('连锁反应') || l.includes('推演') || l.includes('崩溃原因') || l.startsWith('2.') || l.startsWith('3.')
  );
  if (rationaleCandidate) {
    rationality = rationaleCandidate.replace(/^[0-9.#\-*：:\s]+/, '').slice(0, 200);
  }

  // 3. 构建黑天鹅重启判定条件 (Reopening Triggers)
  const defaultTriggers = [
    '若生产环境高并发压测中 P99 延迟超过 250ms，须立即重启本议题；',
    '若出现跨机房网络抖动导致数据不一致或重放攻击，强制解冻本少数派方案；',
    '若执行 Agent 实施代码补丁复杂度超出预期并阻塞主干分支超过 2 个迭代，重新激活备选方案。',
  ];

  const triggers = (customTriggers && customTriggers.length > 0)
    ? customTriggers
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
