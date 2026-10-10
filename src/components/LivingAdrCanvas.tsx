import React, { useState, useEffect } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Gavel,
  Wrench,
  Download,
  Copy,
  Check,
  Scale,
  ShieldCheck,
  Code2,
  Swords,
  Layers,
  Sparkles,
  FileCode2,
  GitCompare,
  Zap,
  Loader2,
  Clock,
} from 'lucide-react';
import {
  TopicMessageData,
  Agent,
  Message,
  RulingDecisionType,
  ActiveAgentExecution,
  TopicPatchDiffItem,
} from '../types';

interface LivingAdrCanvasProps {
  topic: TopicMessageData;
  agents: Agent[];
  messages?: Message[];
  activeExecutions?: ActiveAgentExecution[];
  onOpenRuling?: (type?: RulingDecisionType) => void;
  onExecutePatch?: () => void;
  onOpenCodexDiff?: (diff: any) => void;
  onApplyTopicPatch?: (topicId: string) => Promise<void> | void;
  overlappingFiles?: string[];
}

/**
 * 将博弈推演数据格式化为符合业界规范的 Architecture Decision Record (ADR) Markdown
 */
export function generateAdrMarkdown(topic: TopicMessageData, agents: Agent[]): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const ruling = topic.rulingRecord;
  const draft = topic.gameTheoreticState?.rulingDraft;
  const mcda = topic.gameTheoreticState?.mcdaPayload;
  const committedStates = topic.gameTheoreticState?.cognoNexus?.committedStates || [];
  const dispute = topic.gameTheoreticState?.cognoNexus?.currentDispute;
  const evidences = topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];

  const statusStr = ruling
    ? ruling.decisionType === 'adopt_proposer'
      ? 'Approved (采纳主导)'
      : ruling.decisionType === 'reject_rebuild'
      ? 'Rejected (驳回重构)'
      : 'Approved (权衡折中)'
    : topic.gameStage === 'arbitration'
    ? 'Under Arbitration (仲裁定案审议中)'
    : 'Draft (博弈推演研讨中)';

  const getAgentName = (id?: string) => {
    if (!id) return '';
    return agents.find((a) => a.id === id)?.name || id;
  };

  const proposers = (topic.gameRoles?.proposers || []).map(getAgentName).join(', ') || '未指定';
  const challengers = (topic.gameRoles?.challengers || []).map(getAgentName).join(', ') || '未指定';
  const verifiers = (topic.gameRoles?.verifiers || []).map(getAgentName).join(', ') || '未指定';
  const arbiters = [
    topic.gameRoles?.humanIsArbiter ? 'Norris_M5Pro (人类首席仲裁官)' : '',
    ...(topic.gameRoles?.arbiters || []).map(getAgentName),
  ].filter(Boolean).join(', ') || 'AI 综合仲裁组';

  let md = `# ADR-${topic.id.slice(-6).toUpperCase()}: ${topic.title}\n\n`;
  md += `> **创建日期**: ${dateStr}  \n`;
  md += `> **状态**: \`${statusStr}\`  \n`;
  md += `> **参与角色**: 提案 [${proposers}] | 红队 [${challengers}] | 接地实证 [${verifiers}] | 终局仲裁 [${arbiters}]  \n\n`;
  md += `---\n\n`;

  // 1. Context & Problem Statement
  md += `## 1. 业务背景与架构假定 (Context & Assumptions)\n\n`;
  md += `${topic.description || topic.title}\n\n`;
  if (topic.gameTheoreticState?.targetProposalContent) {
    md += `### 拟选方案立论 (Proposal v1)\n\n`;
    md += `${topic.gameTheoreticState.targetProposalContent.trim()}\n\n`;
  }
  if (committedStates.length > 0) {
    md += `### 核心论点因果拓扑 (Claim DAG)\n\n`;
    committedStates.forEach((node, i) => {
      const depthBadge = typeof node.depth === 'number' ? `[L${node.depth}] ` : '';
      md += `${i + 1}. ${depthBadge}**${node.claim}**\n`;
      if (node.assumptions && node.assumptions.length > 0) {
        md += `   - 前提假设: ${node.assumptions.join('; ')}\n`;
      }
    });
    md += `\n`;
  }

  // 2. Falsification & Edge Cases
  md += `## 2. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)\n\n`;
  if (topic.gameTheoreticState?.targetChallengeContent) {
    md += `${topic.gameTheoreticState.targetChallengeContent.trim()}\n\n`;
  } else {
    md += `*暂无红队质询内容记录。*\n\n`;
  }
  if (dispute) {
    md += `### 局部争议焦点定位 (LMAD Dispute)\n\n`;
    md += `- **焦点论题**: ${dispute.claimTopic}\n`;
    md += `- **根因归结**: ${dispute.rootCause}\n`;
    if (dispute.affectedSubgraphNodeIds && dispute.affectedSubgraphNodeIds.length > 0) {
      md += `- **受波及下游节点**: ${dispute.affectedSubgraphNodeIds.join(', ')}\n`;
    }
    md += `\n`;
  }

  // 3. Grounding Verification
  md += `## 3. 接地实证与验证结论 (Empirical Verification)\n\n`;
  if (topic.gameTheoreticState?.targetVerificationContent) {
    md += `${topic.gameTheoreticState.targetVerificationContent.trim()}\n\n`;
  }
  if (evidences.length > 0) {
    md += `| 证据编号 | 工具/沙箱 | 真值判定 | 实证审查报告 |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    evidences.forEach((ev) => {
      const statusIcon = ev.truthValue ? '✓ PASS' : '✗ FAIL';
      md += `| ${ev.evidenceId} | \`${ev.sourceTool}\` | **${statusIcon}** | ${ev.verifierReport.replace(/[\n\r|]/g, ' ')} |\n`;
    });
    md += `\n`;
  } else if (!topic.gameTheoreticState?.targetVerificationContent) {
    md += `*接地实证待运行或无独立实证链。*\n\n`;
  }

  // 4. Decision & Trade-offs
  md += `## 4. 架构权衡矩阵与终局决议 (Decision & Trade-offs)\n\n`;
  const activeSummary = ruling?.summary || draft?.summary;
  const activeSolution = ruling?.solution || draft?.solution;
  const activeTradeOffs = ruling?.tradeOffPoints || draft?.tradeOffPoints || [];
  const activeFiles = ruling?.impactedFiles || draft?.impactedFiles || [];

  if (activeSummary) {
    md += `### 裁决陈词\n\n`;
    md += `${activeSummary}\n\n`;
  }
  if (activeTradeOffs.length > 0) {
    md += `### 关键权衡折中要点 (Trade-off Matrix)\n\n`;
    activeTradeOffs.forEach((pt) => {
      md += `- ${pt}\n`;
    });
    md += `\n`;
  }
  if (activeSolution) {
    md += `### 实施与补丁指引\n\n`;
    md += `${activeSolution}\n\n`;
  }
  if (activeFiles.length > 0) {
    md += `### 圈定受影响文件 (安全爆炸半径约束)\n\n`;
    activeFiles.forEach((f) => {
      md += `- \`${f}\`\n`;
    });
    md += `\n`;
  }

  if (mcda?.computedWeights && mcda?.criteria) {
    md += `### MCDA 运筹最优最劣法 (BWM) 数学权衡参考\n\n`;
    md += `一致性指标 $\\xi^* = ${mcda.consistencyIndex}$ (${mcda.consistencyPassed ? '通过' : '未通过'})\n\n`;
    mcda.criteria.forEach((c) => {
      const w = ((mcda.computedWeights[c.id] || 0) * 100).toFixed(1);
      md += `- **${c.name}**: ${w}%\n`;
    });
    md += `\n`;
  }

  // 5. Resolution Execution & Deliverables
  const executorId = ruling?.executorId || topic.gameTheoreticState?.assignedExecutorId || topic.decisionRecord?.executorId;
  const execStatus = topic.gameTheoreticState?.executionStatus;
  const execDiffs = topic.gameTheoreticState?.executionDiffs || [];
  const execMeta = topic.gameTheoreticState?.executionUiMeta;
  if (executorId || execDiffs.length > 0 || execMeta) {
    md += `## ${execMeta?.sectionTitle || '5. 决议落地与执行交付 (Resolution Execution & Deliverables)'}\n\n`;
    md += `- **负责落地 Agent**: ${getAgentName(executorId) || '未指派'}\n`;
    md += `- **执行状态**: \`${execStatus || 'completed'}\`\n`;
    if (execMeta?.statusSummary) {
      md += `- **交付摘要**: ${execMeta.statusSummary}\n`;
    }
    md += `\n`;
    if (execDiffs.length > 0) {
      execDiffs.forEach((d) => {
        md += `### \`${d.filename}\` (+${d.additions} / -${d.deletions})\n\n`;
        md += `\`\`\`diff\n${d.diff}\n\`\`\`\n\n`;
      });
    } else if (topic.gameTheoreticState?.executionSummary) {
      md += `### 执行交付纪要\n\n${topic.gameTheoreticState.executionSummary}\n\n`;
    }
  }

  return md;
}

export const LivingAdrCanvas: React.FC<LivingAdrCanvasProps> = ({
  topic,
  agents,
  messages = [],
  activeExecutions = [],
  onOpenRuling,
  onExecutePatch,
  onOpenCodexDiff,
  onApplyTopicPatch,
  overlappingFiles = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [isApplyingPatch, setIsApplyingPatch] = useState(false);
  const [now, setNow] = useState(Date.now());

  const ruling = topic.rulingRecord;
  const draft = topic.gameTheoreticState?.rulingDraft;
  const mcda = topic.gameTheoreticState?.mcdaPayload;
  const committedStates = topic.gameTheoreticState?.cognoNexus?.committedStates || [];
  const dispute = topic.gameTheoreticState?.cognoNexus?.currentDispute;
  const evidences = topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];

  const executorId =
    ruling?.executorId ||
    topic.gameTheoreticState?.assignedExecutorId ||
    topic.decisionRecord?.executorId;
  const executorAgent = executorId ? agents.find((a) => a.id === executorId) : undefined;
  const executionStatus = topic.gameTheoreticState?.executionStatus || (executorId ? 'completed' : 'idle');

  const activeExec = activeExecutions.find(
    (e) => e.topicId === topic.id || e.threadId === topic.id
  );
  const isRunning = executionStatus === 'running' || Boolean(activeExec);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Collect diffs from topic state or fallback to topic messages with diffView/diffViews
  const executionDiffs: TopicPatchDiffItem[] = (() => {
    if (topic.gameTheoreticState?.executionDiffs && topic.gameTheoreticState.executionDiffs.length > 0) {
      return topic.gameTheoreticState.executionDiffs;
    }
    const collected: TopicPatchDiffItem[] = [];
    messages.forEach((m) => {
      if (m.diffViews && m.diffViews.length > 0) {
        m.diffViews.forEach((d) => {
          if (!collected.some((c) => c.filename === d.filename && c.diff === d.diff)) {
            collected.push(d);
          }
        });
      } else if (m.diffView) {
        if (!collected.some((c) => c.filename === m.diffView!.filename && c.diff === m.diffView!.diff)) {
          collected.push(m.diffView);
        }
      }
    });
    return collected;
  })();

  const pendingExecMessage = messages.find((m) => m.isPending && m.gameStage === 'concluded');

  const handleCopy = () => {
    const md = generateAdrMarkdown(topic, agents);
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const md = generateAdrMarkdown(topic, agents);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adr-${topic.id.slice(-6)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyPatchClick = async () => {
    if (!onApplyTopicPatch) return;
    setIsApplyingPatch(true);
    try {
      await onApplyTopicPatch(topic.id);
    } finally {
      setIsApplyingPatch(false);
    }
  };

  const hasDraft = Boolean(draft);
  const isResolved = topic.status === 'resolved' || Boolean(ruling);

  return (
    <div className="flex flex-col h-full bg-surface text-xs text-fg-secondary overflow-hidden font-sans">
      {/* 1. Top Action Toolbar */}
      <div className="px-4 py-2.5 bg-surface-subtle/80 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-400 shrink-0">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <div className="truncate">
            <span className="font-bold text-fg text-xs truncate block">
              ADR-{topic.id.slice(-6).toUpperCase()}: 架构决策活体文档
            </span>
            <span className="text-[10px] text-fg-muted font-mono">
              {executionStatus === 'applied'
                ? '⚡ 已落盘合入工作区 (Applied to Workspace)'
                : isRunning
                ? '🛠️ 落地 Agent 正在编写工程补丁 (Implementing...)'
                : isResolved
                ? '🟢 已敲槌定案 (Approved)'
                : hasDraft
                ? '⚖️ 仲裁定案草案已就绪 (Draft Ready)'
                : '🟡 攻防推演实时合成中 (Living)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            title="复制 ADR Markdown 到剪贴板"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-fg-muted" />}
            <span>{copied ? '已复制' : '复制 MD'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="px-2 py-1 rounded-lg bg-surface border border-border hover:bg-surface-hover text-fg text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            title="下载为 docs/adr/ 规范文件"
          >
            <Download className="w-3 h-3 text-fg-muted" />
            <span className="hidden sm:inline">导出文件</span>
          </button>

          {onOpenRuling && !isResolved && (
            <button
              type="button"
              onClick={() => onOpenRuling('trade_off_matrix')}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
              title="打开仲裁法槌控制台定案"
            >
              <Gavel className="w-3 h-3" />
              <span>敲响法槌</span>
            </button>
          )}

          {onExecutePatch && isResolved && (
            <button
              type="button"
              onClick={onExecutePatch}
              className="px-2.5 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg text-[11px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
              title="指派或重新指派落地 Agent 执行代码补丁"
            >
              <Wrench className="w-3 h-3" />
              <span>{executorId ? '重新指派' : '实施落地'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Scrollable Living Canvas Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Banner: Tool-as-Contract notice */}
        {hasDraft && !isResolved && (
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-start gap-2 text-[11px] text-purple-700 dark:text-purple-300">
            <Sparkles className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5 flex-1">
              <span className="font-bold">MCP 宿主工具直通：综合仲裁官已提交结构化裁决书</span>
              <p className="text-[10px] text-purple-600/90 dark:text-purple-300/80 leading-relaxed">
                无需任何正则提取，仲裁官通过 <code className="px-1 py-0.5 rounded bg-purple-500/20 font-mono">submit_arbitration_ruling</code> 原生工具回传了高保真权衡矩阵，已直接装载至第四节及法槌控制台。
              </p>
            </div>
          </div>
        )}

        {/* Section 1: Context & Proposed Architecture */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-blue-500 shrink-0" />
              <span>1. 拟选方案与架构假定 (Context & Assumptions)</span>
            </div>
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono font-medium">🏛️ Proposer</span>
          </div>

          <p className="text-[11px] text-fg leading-relaxed">
            {topic.description || topic.title}
          </p>

          {topic.gameTheoreticState?.targetProposalContent && (
            <div className="p-2.5 rounded-lg bg-surface border border-border/80 text-[11px] text-fg-secondary space-y-1">
              <div className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">立论方案核心摘要</div>
              <p className="leading-relaxed whitespace-pre-wrap line-clamp-6">
                {topic.gameTheoreticState.targetProposalContent.slice(0, 300)}
                {topic.gameTheoreticState.targetProposalContent.length > 300 ? '...' : ''}
              </p>
            </div>
          )}

          {committedStates.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] font-semibold text-fg-muted">已承诺架构断言链 (Claim DAG):</div>
              <div className="space-y-1">
                {committedStates.map((node, i) => (
                  <div key={node.id || i} className="p-1.5 rounded-md bg-surface/80 border border-border/60 flex items-start gap-1.5 text-[11px]">
                    <span className="px-1 py-0.2 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 font-mono text-[9px] shrink-0 font-bold">
                      L{node.depth ?? 0}
                    </span>
                    <span className="text-fg flex-1 leading-snug">{node.claim}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Falsification & Edge Cases */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-rose-500 shrink-0" />
              <span>2. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)</span>
            </div>
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono font-medium">⚔️ Challenger</span>
          </div>

          {topic.gameTheoreticState?.targetChallengeContent ? (
            <div className="p-2.5 rounded-lg bg-surface border border-rose-500/20 text-[11px] text-fg-secondary space-y-1">
              <div className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">红队反例质询核心断言</div>
              <p className="leading-relaxed whitespace-pre-wrap line-clamp-6">
                {topic.gameTheoreticState.targetChallengeContent.slice(0, 320)}
                {topic.gameTheoreticState.targetChallengeContent.length > 320 ? '...' : ''}
              </p>
            </div>
          ) : (
            <div className="text-[11px] text-fg-muted italic">等待红队输入极端故障反例...</div>
          )}

          {dispute && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-700 dark:text-rose-300">分歧焦点根因定位</span>
                <span className="text-[9px] font-mono text-rose-600 dark:text-rose-400">LMAD Graph Diff</span>
              </div>
              <div className="text-fg leading-relaxed">
                <span className="text-fg-muted">焦点: </span>{dispute.claimTopic}
              </div>
              <div className="text-fg-muted">
                <span>根因: </span><span className="text-fg font-medium">{dispute.rootCause}</span>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Grounding Verification */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-emerald-500 shrink-0" />
              <span>3. 接地实证与反事实验证 (Empirical Verification)</span>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">🔬 Verifier</span>
          </div>

          {topic.gameTheoreticState?.targetVerificationContent && (
            <div className="p-2.5 rounded-lg bg-surface border border-border/80 text-[11px] text-fg-secondary leading-relaxed">
              {topic.gameTheoreticState.targetVerificationContent.slice(0, 260)}
              {topic.gameTheoreticState.targetVerificationContent.length > 260 ? '...' : ''}
            </div>
          )}

          {evidences.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-fg-muted">分级证据真伪清单 (T1/T2 Grounding):</div>
              <div className="space-y-1">
                {evidences.map((ev) => (
                  <div key={ev.evidenceId} className="p-2 rounded-lg bg-surface border border-border flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {ev.truthValue ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      )}
                      <span className="font-mono text-[10px] text-fg-muted shrink-0">[{ev.sourceTool}]</span>
                      <span className="text-fg truncate">{ev.verifierReport}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono shrink-0 ${
                      ev.truthValue ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    }`}>
                      {ev.truthValue ? 'TRUE' : 'FALSE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-fg-muted italic">暂无物理实证或沙箱运行记录。</div>
          )}
        </div>

        {/* Section 4: Decision & Trade-offs */}
        <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2.5">
          <div className="flex items-center justify-between border-b border-purple-500/25 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-purple-500 shrink-0" />
              <span>4. 架构权衡矩阵与终局决议 (Decision & Trade-offs)</span>
            </div>
            <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono font-medium">⚖️ Arbiter</span>
          </div>

          {(ruling || draft) ? (
            <div className="space-y-2">
              <div className="text-[11px] text-fg font-medium leading-relaxed bg-surface/70 p-2.5 rounded-lg border border-purple-500/20">
                <span className="text-purple-600 dark:text-purple-400 font-bold">【裁决总览】: </span>
                {ruling?.summary || draft?.summary}
              </div>

              {(ruling?.tradeOffPoints || draft?.tradeOffPoints || []).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-purple-700 dark:text-purple-300">关键权衡折中要点 (Trade-off Matrix):</div>
                  <div className="space-y-1">
                    {(ruling?.tradeOffPoints || draft?.tradeOffPoints || []).map((pt, idx) => (
                      <div key={idx} className="p-1.5 rounded-md bg-surface/80 border border-purple-500/20 text-[11px] text-fg flex items-start gap-1.5">
                        <Scale className="w-3 h-3 text-purple-500 shrink-0 mt-0.5" />
                        <span className="leading-snug">{pt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(ruling?.impactedFiles || draft?.impactedFiles || []).length > 0 && (
                <div className="p-2 rounded-lg bg-surface/80 border border-border flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="font-semibold text-fg">限定安全爆炸半径文件:</span>
                  </div>
                  <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                    {(ruling?.impactedFiles || draft?.impactedFiles || []).join(', ')}
                  </span>
                </div>
              )}

              {(ruling?.solution || draft?.solution) && (
                <div className="text-[11px] text-fg-secondary leading-relaxed bg-surface/50 p-2 rounded-lg border border-border/60">
                  <span className="font-semibold text-fg">落地实施要求: </span>
                  {ruling?.solution || draft?.solution}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-fg-muted italic p-2 rounded-lg bg-surface/50">
              等待阶段 5 综合官调用 <code className="font-mono text-purple-500">submit_arbitration_ruling</code> 或人类首席仲裁官法槌定案...
            </div>
          )}

          {mcda?.computedWeights && mcda?.criteria && (
            <div className="pt-2 border-t border-purple-500/20 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-purple-700 dark:text-purple-300">BWM 确定性多属性权重求解</span>
                <span className="font-mono text-fg-muted">ξ* = {mcda.consistencyIndex}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                {mcda.criteria.map((c) => (
                  <div key={c.id} className="p-1 rounded bg-surface/80 border border-purple-500/20 text-center">
                    <div className="text-fg-muted truncate">{c.name.split('与')[0]}</div>
                    <div className="font-bold text-fg">{((mcda.computedWeights[c.id] || 0) * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 5: Resolution Execution & Deliverables (Agent-Driven UI Meta) */}
        <div className="p-3.5 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/30 space-y-2.5">
          <div className="flex items-center justify-between border-b border-emerald-500/25 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-emerald-500 shrink-0" />
              <span>
                {topic.gameTheoreticState?.executionUiMeta?.sectionTitle ||
                  '5. 决议落地与执行交付 (Resolution Execution & Deliverables)'}
              </span>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">
              {topic.gameTheoreticState?.executionUiMeta?.podTitle || '🛠️ Executor'}
            </span>
          </div>

          {/* Multi-Topic Blast-Radius Overlap Alert */}
          {overlappingFiles.length > 0 && (
            <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/35 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">⚠️ 多议题爆炸半径重叠预警：</span>
                <span>
                  当前频道内存在其他并行落地议题同时涉及{' '}
                  <code className="font-mono px-1 py-0.2 rounded bg-amber-500/20">{overlappingFiles.join(', ')}</code>
                  ，合入变更前请通过审查视图核对顺序。
                </span>
              </div>
            </div>
          )}

          {/* Executor Status Header */}
          <div className="p-2.5 rounded-lg bg-surface/85 border border-border flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-[11px] text-fg-muted">执行 Agent:</span>
              {executorId ? (
                <span className="font-mono font-semibold text-fg text-[11px] flex items-center gap-1.5">
                  <span>{executorAgent?.avatar || '🤖'}</span>
                  <span>{executorAgent?.name || executorId}</span>
                </span>
              ) : (
                <span className="text-[11px] text-fg-muted italic">尚未指派落地 Agent</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {executionStatus === 'queued' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
                  <Clock className="w-3 h-3" />
                  <span>队列等待中 (Agent 正在执行前序任务)</span>
                </span>
              )}
              {isRunning && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                  <span>
                    正在执行定案决议 ({activeExec ? ((now - activeExec.startedAt) / 1000).toFixed(1) : ((now - (topic.gameTheoreticState?.executionStartedAt || now)) / 1000).toFixed(1)}s)
                  </span>
                </span>
              )}
              {!isRunning && executionStatus === 'completed' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>
                    {topic.gameTheoreticState?.executionUiMeta?.statusSummary ||
                      (executionDiffs.length > 0 ? '工作区变更已就绪 · 待合入' : '决议已执行交付')}
                  </span>
                </span>
              )}
              {executionStatus === 'applied' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-600 text-white font-semibold shadow-2xs">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>✓ 已物理合入本地工作区</span>
                </span>
              )}
              {executionStatus === 'failed' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>执行中断 / 需重新指派</span>
                </span>
              )}
            </div>
          </div>

          {/* Live Streaming Progress when Running */}
          {isRunning && (
            <div className="p-2.5 rounded-lg bg-surface border border-amber-500/30 space-y-1.5 animate-in fade-in">
              <div className="flex items-center justify-between text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                <span>{activeExec?.currentActionDetail || '正在根据定案决议推进落地交付与结果输出...'}</span>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              </div>
              {pendingExecMessage?.content && (
                <pre className="p-2 rounded bg-surface-subtle border border-border text-[10px] font-mono text-fg-secondary max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {pendingExecMessage.content.slice(-500)}
                </pre>
              )}
            </div>
          )}

          {/* Generated Deliverables & One-Click Apply */}
          {executionDiffs.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  {topic.gameTheoreticState?.executionUiMeta?.statusSummary ||
                    `已产出工作区交付文件 (${executionDiffs.length} 个文件)`}:
                </span>
                <div className="flex items-center gap-1.5">
                  {onOpenCodexDiff && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCodexDiff({
                          ...executionDiffs[0],
                          topicId: topic.id,
                          topicTitle: topic.title,
                          allDiffs: executionDiffs,
                          executionStatus,
                          artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-surface border border-border hover:border-emerald-500/40 text-fg text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <GitCompare className="w-3 h-3 text-emerald-500" />
                      <span>
                        {topic.gameTheoreticState?.executionUiMeta?.reviewActionLabel || 'Codex 视图审查'}
                      </span>
                    </button>
                  )}
                  {onApplyTopicPatch && executionStatus !== 'applied' && (
                    <button
                      type="button"
                      disabled={isApplyingPatch}
                      onClick={handleApplyPatchClick}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                    >
                      {isApplyingPatch ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>写入中...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3" />
                          <span>
                            {topic.gameTheoreticState?.executionUiMeta?.applyActionLabel || '一键合入本地工作区'}
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                {executionDiffs.map((diffItem, idx) => (
                  <div
                    key={`${diffItem.filename}-${idx}`}
                    className="p-2 rounded-lg bg-surface border border-border space-y-1.5 font-mono text-[10px]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        <FileCode2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="font-semibold text-fg truncate">{diffItem.filename}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-emerald-500 font-bold">+{diffItem.additions}</span>
                        <span className="text-red-500 font-bold">-{diffItem.deletions}</span>
                        {onOpenCodexDiff && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenCodexDiff({
                                ...diffItem,
                                topicId: topic.id,
                                topicTitle: topic.title,
                                allDiffs: executionDiffs,
                                executionStatus,
                                artifactsDir: topic.gameTheoreticState?.executionArtifactsDir,
                              })
                            }
                            className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 font-sans text-[9px] cursor-pointer"
                          >
                            审查
                          </button>
                        )}
                      </div>
                    </div>
                    <pre className="p-2 rounded bg-surface-subtle border border-border/60 overflow-x-auto text-[9px] text-fg-secondary max-h-28 leading-relaxed">
                      {diffItem.diff.split('\n').slice(0, 10).join('\n')}
                      {diffItem.diff.split('\n').length > 10 ? '\n...' : ''}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : !isRunning && executionStatus === 'completed' ? (
            <div className="p-2.5 rounded-lg bg-surface/85 border border-emerald-500/30 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  {topic.gameTheoreticState?.executionUiMeta?.statusSummary ||
                    '已完成决议执行交付（纯报告与结论输出，无工作区文件变更）'}
                </span>
                {onExecutePatch && (
                  <button
                    type="button"
                    onClick={onExecutePatch}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-border hover:border-accent/50 hover:bg-surface-hover text-fg text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer shrink-0"
                  >
                    <Wrench className="w-3 h-3 text-accent" />
                    <span>重新指派</span>
                  </button>
                )}
              </div>
              {topic.gameTheoreticState?.executionSummary && (
                <p className="text-[11px] text-fg-secondary leading-relaxed line-clamp-3">
                  {topic.gameTheoreticState.executionSummary}
                </p>
              )}
            </div>
          ) : !isRunning ? (
            <div className="flex items-center justify-between p-2 rounded-lg bg-surface/60 border border-border/60 text-[11px]">
              <span className="text-fg-muted">
                {isResolved
                  ? '定案后可随时委派或重新委派专职 Agent 推进决议落地交付。'
                  : '待第四节法槌定案后，自动或手动委派执行 Agent 推进决议落地。'}
              </span>
              {onExecutePatch && isResolved && (
                <button
                  type="button"
                  onClick={onExecutePatch}
                  className="px-2.5 py-1 rounded-lg bg-accent hover:opacity-90 text-accent-fg font-semibold text-[10px] flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Wrench className="w-3 h-3" />
                  <span>指派 Agent 推进落地</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
