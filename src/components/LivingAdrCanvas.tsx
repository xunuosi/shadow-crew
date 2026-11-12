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
  Code2,
  Swords,
  Layers,
  Sparkles,
  FileCode2,
  GitCompare,
  Zap,
  Loader2,
  Clock,
  Handshake,
  RotateCcw,
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
  onRollbackTopicPatch?: (topicId: string) => Promise<void> | void;
  overlappingFiles?: string[];
}

/**
 * 将博弈推演数据格式化为符合业界规范的 Architecture Decision Record (ADR) Markdown
 */
export function generateAdrMarkdown(topic: TopicMessageData, agents: Agent[]): string {
  const ruling = topic.rulingRecord;
  if (ruling?.livingAdrMarkdown) {
    return ruling.livingAdrMarkdown;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const draft = topic.gameTheoreticState?.rulingDraft;
  const mcda = topic.gameTheoreticState?.mcdaPayload;
  const committedStates = topic.gameTheoreticState?.cognoNexus?.committedStates || [];
  const dispute = topic.gameTheoreticState?.cognoNexus?.currentDispute;
  const evidences = topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];
  const concurrenceSignOff = ruling?.concurrenceSignOff;
  const concurrenceState = topic.gameTheoreticState?.concurrenceState;

  const isAllConcurred = Boolean(ruling?.concurrenceSignOff?.allConcurred);
  const statusStr = ruling
    ? ruling.decisionType === 'adopt_proposer'
      ? (isAllConcurred ? 'Approved (采纳主导 · 全员无异议签署)' : 'Approved (采纳主导 · 仲裁法定定案)')
      : ruling.decisionType === 'reject_rebuild'
      ? (isAllConcurred ? 'Rejected (驳回重构 · 全员无异议签署)' : 'Rejected (驳回重构 · 仲裁法定定案)')
      : (isAllConcurred ? 'Approved (权衡折中 · 全员无异议签署)' : 'Approved (权衡折中 · 仲裁法定定案)')
    : topic.gameStage === 'arbitration'
    ? (concurrenceState?.isConcurrencePhaseActive ? 'Under Arbitration (综合裁定官终局方案核验中)' : 'Under Arbitration (仲裁定案审议中)')
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
  md += `> **决议状态**: \`${statusStr}\`  \n`;
  md += `> **终局裁定官**: **${ruling?.arbiterName || arbiters}**  \n`;
  md += `> **参与角色**: 提案 [${proposers}] | 红队 [${challengers}] | 接地实证 [${verifiers}] | 终局仲裁 [${arbiters}]  \n\n`;
  md += `---\n\n`;

  // 🌟 通俗大白话定案总览 (Executive Summary)
  const activeSummary = ruling?.summary || draft?.summary;
  const activeSolution = ruling?.solution || draft?.solution;
  if (activeSummary) {
    md += `## 🌟 大白话终局方案总览 (Executive Summary)\n\n`;
    md += `> 💡 **核心决议**: **${activeSummary}**\n\n`;
    if (activeSolution) {
      md += `**落地实施要旨**: ${activeSolution}\n\n`;
    }
    md += `---\n\n`;
  }

  // 🤝 全员无异议共识签署链 (Unanimous Concurrence Sign-off)
  if (isAllConcurred && concurrenceSignOff?.records && concurrenceSignOff.records.length > 0) {
    md += `## 🤝 全员无异议共识签署 (Unanimous Concurrence Sign-off)\n\n`;
    md += `本决议在终局敲定前，已由综合裁定官向各参研关键角色发起专项审视征询，各角色均已独立复核并明确保证**无异议**：\n\n`;
    md += `| 签署角色 | 负责智能体 | 审查结论 | 无异议陈述立场与依据摘要 |\n`;
    md += `| :--- | :--- | :---: | :--- |\n`;
    concurrenceSignOff.records.forEach((rec) => {
      md += `| **${rec.role}** | \`${rec.agentName}\` | **✅ 无异议 (Concurred)** | ${rec.statement.replace(/[\n\r|]/g, ' ')} |\n`;
    });
    md += `\n---\n\n`;
  } else if (!ruling && concurrenceState?.items && concurrenceState.items.length > 0) {
    md += `## 🤝 全员无异议共识审视进度 (Concurrence Verification Progress)\n\n`;
    md += `| 签署角色 | 负责智能体 | 审查状态 | 保证陈述 |\n`;
    md += `| :--- | :--- | :---: | :--- |\n`;
    concurrenceState.items.forEach((item) => {
      const statusText = item.status === 'concurred'
        ? '✅ 无异议 (Concurred)'
        : item.status === 'conditional'
        ? '⏸️ 条件保留 (Conditional)'
        : item.status === 'objected'
        ? '❌ 存在异议 (Objected)'
        : item.status === 'unavailable'
        ? '⚠️ 角色不可用 (Unavailable)'
        : item.status === 'invalid'
        ? '⛔ 结构化票无效 (Invalid)'
        : '⏳ 待复核 (Pending)';
      const roleText = item.role === 'proposer' ? '提案主导' : item.role === 'challenger' ? '红队对抗' : item.role === 'verifier' ? '接地实证' : '综合裁定';
      md += `| **${roleText}** | \`${item.agentName}\` | **${statusText}** | ${(item.statement || '方案审视中').replace(/[\n\r|]/g, ' ')} |\n`;
    });
    md += `\n---\n\n`;
  } else if (ruling && !isAllConcurred) {
    md += `## ⚖️ 仲裁定案记录 (Arbitration Ruling Record)\n\n`;
    md += `> 本决议由首席仲裁官行使法定裁决权敲定定案，未附带参研角色前置无异议征询链。\n\n---\n\n`;
  }

  // 1. Context & Problem Statement
  md += `## 1. 业务背景与架构假定 (Context & Assumptions)\n\n`;
  md += `${topic.description || topic.title}\n\n`;
  if (topic.gameTheoreticState?.targetProposalContent) {
    md += `### 拟选方案立论 (Proposal v1)\n\n`;
    md += `${topic.gameTheoreticState.targetProposalContent.trim()}\n\n`;
  }
  const modularState = topic.gameTheoreticState?.modularState || topic.gameTheoreticState?.cognoNexus?.modularState;
  if (modularState?.enabled && modularState.modules.length > 0) {
    md += `### G-Frame 跨模块公共接口契约与原子模块分治 (Bayesian & Team Game)\n\n`;
    if (modularState.sharedContract) {
      md += `- **公共接口契约**: ${modularState.sharedContract.summary}\n`;
      if (modularState.sharedContract.typeSignatures) {
        md += `\n\`\`\`typescript\n${modularState.sharedContract.typeSignatures}\n\`\`\`\n\n`;
      }
    }
    md += `| 模块 ID | 模块职责 | 贝叶斯风险 ($P_{\\text{prior}} \\to P_{\\text{posterior}}$) | 路由通道 | 状态 | 允许文件白名单 |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    modularState.modules.forEach((m) => {
      md += `| \`${m.moduleId}\` | ${m.title}: ${m.responsibility.replace(/[\n\r|]/g, ' ')} | \`${m.belief.priorRisk} -> ${m.belief.posteriorRisk}\` | \`${m.belief.routingMode}\` | **${m.status.toUpperCase()}** | ${m.allowedFiles.map((f) => `\`${f}\``).join(', ')} |\n`;
    });
    md += `\n`;
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
  } else if (topic.gameTheoreticState?.isChallengerBypassed) {
    md += `*⚡ 贝叶斯快速通道：低风险确定性模块依规约旁路红队对抗，直通契约与物理接地验证。*\n\n`;
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
  const fastTrackConv = topic.gameTheoreticState?.fastTrackConvergence;
  if (fastTrackConv) {
    md += `> ⚡ **贝叶斯快速通道实证直通收敛 (Fast-Track Empirical Convergence)**: ${fastTrackConv.summary}\n>\n`;
    md += `> - **已冻结模块**: ${fastTrackConv.frozenModulesCount} / ${fastTrackConv.totalModulesCount}\n`;
    md += `> - **验证真值**: ${fastTrackConv.verifiedClaimsCount} 项通过 / ${fastTrackConv.refutedClaimsCount} 项证伪\n`;
    md += `> - **契约违规**: ${fastTrackConv.contractViolationsCount} 项 (严格为 0)\n\n`;
  }
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
  } else if (!topic.gameTheoreticState?.targetVerificationContent && !fastTrackConv) {
    md += `*接地实证待运行或无独立实证链。*\n\n`;
  }

  // 4. Decision & Trade-offs
  md += `## 4. 架构权衡矩阵与终局决议 (Decision & Trade-offs)\n\n`;
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
  onRollbackTopicPatch,
  overlappingFiles = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [isApplyingPatch, setIsApplyingPatch] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [now, setNow] = useState(Date.now());

  const ruling = topic.rulingRecord;
  const draft = topic.gameTheoreticState?.rulingDraft;
  const mcda = topic.gameTheoreticState?.mcdaPayload;
  const committedStates = topic.gameTheoreticState?.cognoNexus?.committedStates || [];
  const dispute = topic.gameTheoreticState?.cognoNexus?.currentDispute;
  const evidences = topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];
  const modularState = topic.gameTheoreticState?.modularState || topic.gameTheoreticState?.cognoNexus?.modularState;
  const minority = ruling?.minorityReport || topic.gameTheoreticState?.minorityReport;
  const impactedFiles = ruling?.impactedFiles || draft?.impactedFiles || [];
  const concurrenceState = topic.gameTheoreticState?.concurrenceState;
  const concurrenceSignOff = ruling?.concurrenceSignOff;
  const isAllConcurred = Boolean(concurrenceSignOff?.allConcurred);

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

  const handleRollbackPatchClick = async () => {
    if (!onRollbackTopicPatch) return;
    setIsRollingBack(true);
    try {
      await onRollbackTopicPatch(topic.id);
    } finally {
      setIsRollingBack(false);
    }
  };

  const hasDraft = Boolean(draft);
  const isResolved = topic.status === 'resolved' || Boolean(ruling);

  return (
    <div className="flex flex-col h-full bg-surface text-xs text-fg-secondary overflow-hidden font-sans">
      {/* 1. Top Action Toolbar */}
      <div className="px-3 py-2.5 bg-surface-subtle/80 border-b border-border flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-1 basis-52 items-center gap-2 min-w-0">
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

        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 ml-auto">
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
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3.5 space-y-4">
        {/* Banner: Tool-as-Contract notice */}
        {hasDraft && !isResolved && (
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-start gap-2 text-[11px] text-purple-700 dark:text-purple-300">
            <Sparkles className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5 flex-1">
              <span className="font-bold">MCP 宿主工具直通：综合仲裁官已提交结构化裁决书</span>
              <p className="text-[10px] text-purple-600/90 dark:text-purple-300/80 leading-relaxed">
                无需任何正则提取，仲裁官通过 <code className="px-1 py-0.5 rounded bg-purple-500/20 font-mono">submit_arbitration_ruling</code> 原生工具回传了高保真权衡矩阵，已直接装载至第 6 节及法槌控制台。
              </p>
            </div>
          </div>
        )}

        {/* Top Highlight: 🌟 终局架构方案总览与全员无异议签署 (Final Concluded Architecture & Sign-off) */}
        {(ruling || draft || concurrenceState || concurrenceSignOff) && (
          <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 space-y-3">
            <div className="flex items-center justify-between border-b border-purple-200 dark:border-purple-500/25 pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 font-bold text-fg text-xs">
                <span className="w-1.5 h-3.5 rounded-full bg-purple-600 dark:bg-purple-400 shrink-0" />
                <span className="text-purple-900 dark:text-purple-200">🌟 1. 终局架构方案总览 (Executive Summary)</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isResolved ? (
                  isAllConcurred ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>全员无异议签署 · 终局敲定</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-500/30 flex items-center gap-1">
                      <Gavel className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      <span>人类首席仲裁官法槌定案</span>
                    </span>
                  )
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                    <span>综合裁定官方案审视征询中</span>
                  </span>
                )}
              </div>
            </div>

            {/* 大白话核心决策 */}
            <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5">
              <div className="text-[10px] font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1">
                <Scale className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                <span>核心决策结论与依据</span>
              </div>
              <p className="text-[11px] text-fg font-medium leading-relaxed">
                {ruling?.summary || draft?.summary || concurrenceState?.arbiterProposalSummary || '综合裁定官正在拟定终局架构权衡方案...'}
              </p>
              {(ruling?.solution || draft?.solution) && (
                <div className="pt-1.5 border-t border-border/60 text-[10px] text-fg-secondary">
                  <span className="font-semibold text-fg">落地实施要旨: </span>
                  {ruling?.solution || draft?.solution}
                </div>
              )}
            </div>

            {/* 全员无异议签署链展板 */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-purple-800 dark:text-purple-300">
                <div className="flex min-w-0 items-center gap-1">
                  <Handshake className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>🤝 2. 全员无异议共识签署 (Unanimous Concurrence Sign-off)</span>
                </div>
                <span className="text-left text-[9px] text-fg-muted font-normal">
                  {isAllConcurred
                    ? '全员均已独立复核并明确保证无异议'
                    : isResolved
                    ? '由人类首席仲裁官法定定案（未附角色征询链）'
                    : '正在收集关键参研角色复核答复'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                {(concurrenceSignOff?.records && concurrenceSignOff.records.length > 0) ? (
                  concurrenceSignOff.records.map((rec, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-surface border border-emerald-300 dark:border-emerald-500/30 flex items-start justify-between gap-2 text-[10px] min-w-0 overflow-hidden">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <span className="px-1.5 py-0.5 rounded font-mono font-medium text-[9px] bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 shrink-0">
                          {rec.role}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <span className="font-semibold text-fg block truncate">{rec.agentName}</span>
                          <p className="text-[10px] text-fg-secondary leading-snug break-words whitespace-normal">{rec.statement}</p>
                        </div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 shrink-0">
                        ✓ 无异议
                      </span>
                    </div>
                  ))
                ) : (concurrenceState?.items && concurrenceState.items.length > 0) ? (
                  concurrenceState.items.map((item, idx) => {
                    const isConcurred = item.status === 'concurred';
                    const isBlocked = item.status === 'objected' || item.status === 'invalid';
                    const roleLabel = item.role === 'proposer'
                      ? '提案主导'
                      : item.role === 'challenger'
                      ? '红队对抗'
                      : item.role === 'verifier'
                      ? '接地实证'
                      : '综合裁定';
                    return (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg bg-surface border ${
                          isConcurred
                            ? 'border-emerald-300 dark:border-emerald-500/30'
                            : isBlocked
                            ? 'border-rose-300 dark:border-rose-500/30'
                            : 'border-amber-300 dark:border-amber-500/30'
                        } flex items-start justify-between gap-2 text-[10px] min-w-0 overflow-hidden`}
                      >
                        <div className="flex items-start gap-1.5 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono font-medium text-[9px] shrink-0 border ${
                              isConcurred
                                ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
                                : isBlocked
                                ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-500/30'
                                : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/30'
                            }`}
                          >
                            {roleLabel}
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <span className="font-semibold text-fg block truncate">{item.agentName}</span>
                            <p className="text-[10px] text-fg-secondary leading-snug break-words whitespace-normal">
                              {item.statement || (isConcurred ? '确认无异议' : '正在审视方案中...')}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 border ${
                            isConcurred
                              ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/30'
                                : isBlocked
                                ? 'text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-300 dark:border-rose-500/30'
                                : 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30'
                          }`}
                        >
                          {isConcurred
                            ? '✓ 无异议'
                            : item.status === 'conditional'
                            ? '⏸️ 条件保留'
                            : item.status === 'unavailable'
                            ? '⚠️ 不可用'
                            : item.status === 'invalid'
                            ? '⛔ 票据无效'
                            : item.status === 'objected'
                            ? '❌ 存在异议'
                            : '⏳ 待确认'}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-2 rounded-lg bg-surface border border-border text-[10px] text-fg-muted italic text-center">
                    裁定官发布拟定方案后，将自动调度参研角色进行无异议审视签署
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Context & Proposed Architecture */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-blue-500 shrink-0" />
              <span>3. 拟选方案与架构假定 (Context & Assumptions)</span>
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

          {modularState?.enabled && modularState.modules.length > 0 && (
            <div className="p-2.5 rounded-lg bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-purple-800 dark:text-purple-300">
                  <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span>🧩 G-Frame 跨模块公共接口契约与原子模块分治</span>
                </div>
                <span className="px-1.5 py-0.5 rounded font-mono text-[9px] text-purple-800 bg-purple-50 border border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30">
                  {modularState.modules.filter((m) => m.status === 'frozen').length}/{modularState.modules.length} 已冻结
                </span>
              </div>

              {modularState.sharedContract && (
                <div className="p-2 rounded-md bg-surface-subtle border border-border text-[10px] space-y-1">
                  <div className="font-semibold text-fg">📜 只读公共契约: {modularState.sharedContract.summary}</div>
                  {modularState.sharedContract.typeSignatures && (
                    <pre className="p-1.5 rounded bg-surface border border-border font-mono text-[9px] text-fg-secondary overflow-x-auto">
                      {modularState.sharedContract.typeSignatures}
                    </pre>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {modularState.modules.map((mod) => {
                  const isFrozen = mod.status === 'frozen';
                  const isDebating = mod.moduleId === modularState.activeModuleId || (mod.status !== 'frozen' && mod.status !== 'pending');
                  const isExecRunning = mod.executionStatus === 'running' || mod.moduleId === modularState.activeExecutionModuleId;
                  const isExecCompleted = mod.executionStatus === 'completed';
                  const isExecFailed = mod.executionStatus === 'failed';

                  const statusClasses = isExecCompleted
                    ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30'
                    : isExecRunning
                    ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30 animate-pulse'
                    : isExecFailed
                    ? 'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30'
                    : isFrozen
                    ? 'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30'
                    : isDebating
                    ? 'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30'
                    : 'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30';

                  const badgeText = isExecCompleted
                    ? `✅ 落地交付完成 ${mod.executionDiffs && mod.executionDiffs.length > 0 ? `(${mod.executionDiffs.length} 文件)` : ''}`
                    : isExecRunning
                    ? '🛠️ 落地执行中...'
                    : isExecFailed
                    ? '❌ 落地执行异常'
                    : isFrozen
                    ? '🔒 已冻结定案'
                    : mod.belief.routingMode === 'deep_debate'
                    ? '⚔️ 对抗流'
                    : '⚡ 快速流';

                  return (
                    <div key={mod.moduleId} className="p-2 rounded-md bg-surface border border-border space-y-1 min-w-0 w-full overflow-hidden">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono font-bold text-[10px] text-fg">{mod.moduleId}</span>
                          <span className="text-[11px] font-semibold text-fg truncate">{mod.title}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-auto shrink-0 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded font-mono text-[9px] text-purple-800 bg-purple-50 border border-purple-300 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30">
                            P: {mod.belief.priorRisk.toFixed(2)} → {mod.belief.posteriorRisk.toFixed(2)}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] border font-semibold ${statusClasses}`}>
                            {badgeText}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-fg-secondary leading-snug">{mod.responsibility}</div>
                      {mod.executionSummary && (
                        <div className="text-[9.5px] font-mono text-emerald-800 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/20">
                          📦 交付成果: {mod.executionSummary}
                        </div>
                      )}
                      {mod.allowedFiles.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          <span className="text-[9px] text-fg-muted font-mono">作用域白名单:</span>
                          {mod.allowedFiles.map((f) => (
                            <code key={f} className="px-1 py-0.2 rounded bg-surface-subtle border border-border font-mono text-[9px] text-fg-secondary">
                              {f}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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

        {/* Section 4: Falsification & Edge Cases */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-rose-500 shrink-0" />
              <span>4. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)</span>
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
          ) : topic.gameTheoreticState?.isChallengerBypassed ? (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">⚡ 快速通道旁路</span>
              <span className="text-fg-secondary">低风险确定性模块依博弈规约旁路红队对抗，直通契约与物理接地验证。</span>
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

        {/* Section 5: Grounding Verification */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-emerald-500 shrink-0" />
              <span>5. 接地实证与反事实验证 (Empirical Verification)</span>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">🔬 Verifier</span>
          </div>

          {topic.gameTheoreticState?.fastTrackConvergence && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-800 dark:text-emerald-300">⚡ 快速通道静态实证直通收敛</span>
                <span className="text-[9px] font-mono font-medium text-emerald-600 dark:text-emerald-400">Fast-Track Grounded</span>
              </div>
              <div className="text-fg leading-relaxed text-[11px]">
                {topic.gameTheoreticState.fastTrackConvergence.summary}
              </div>
            </div>
          )}

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

        {/* Section 6: Decision & Trade-offs */}
        <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-200 dark:border-purple-500/25 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-purple-600 dark:bg-purple-400 shrink-0" />
              <span className="text-purple-900 dark:text-purple-200">6. 架构权衡矩阵与终局决议 (Decision & Trade-offs)</span>
            </div>
            <span className="text-[10px] text-purple-700 dark:text-purple-300 font-mono font-medium">⚖️ Arbiter</span>
          </div>

          {(ruling || draft) ? (
            <div className="space-y-2">
              <div className="text-[11px] text-fg font-medium leading-relaxed bg-surface p-2.5 rounded-lg border border-border">
                <span className="text-purple-700 dark:text-purple-300 font-bold">【裁决总览】: </span>
                {ruling?.summary || draft?.summary}
              </div>

              {(ruling?.tradeOffPoints || draft?.tradeOffPoints || []).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-purple-800 dark:text-purple-300">关键权衡折中要点 (Trade-off Matrix):</div>
                  <div className="space-y-1">
                    {(ruling?.tradeOffPoints || draft?.tradeOffPoints || []).map((pt, idx) => (
                      <div key={idx} className="p-2 rounded-md bg-surface border border-border text-[11px] text-fg flex items-start gap-1.5">
                        <Scale className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                        <span className="leading-snug">{pt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(ruling?.solution || draft?.solution) && (
                <div className="text-[11px] text-fg-secondary leading-relaxed bg-surface p-2.5 rounded-lg border border-border">
                  <span className="font-semibold text-fg">落地实施要求: </span>
                  {ruling?.solution || draft?.solution}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-fg-muted italic p-2 rounded-lg bg-surface border border-border">
              等待阶段 5 综合裁定官起草方案、@各角色保证回复无异议后正式敲定...
            </div>
          )}

          {mcda?.computedWeights && mcda?.criteria && (
            <div className="pt-2 border-t border-purple-500/20 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
                <span className="font-semibold text-purple-700 dark:text-purple-300">BWM 确定性多属性权重求解</span>
                <span className="font-mono text-fg-muted">ξ* = {mcda.consistencyIndex}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
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

        {/* Section 7: Minority Dissent & Black Swan Triggers */}
        <div className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-500/[0.08] border border-rose-200 dark:border-rose-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 dark:border-rose-500/25 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-rose-500 shrink-0" />
              <span className="text-rose-900 dark:text-rose-200">7. 伴生少数派异议备案 (Minority Dissent & Black Swan Triggers)</span>
            </div>
            <span className="text-[10px] text-rose-800 dark:text-rose-300 font-mono font-semibold">⚔️ Preserved Dissent</span>
          </div>

          {minority ? (
            <div className="space-y-2">
              <div className="p-2.5 rounded-lg bg-surface border border-rose-300 dark:border-rose-500/30 space-y-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 font-semibold text-[10px]">
                    异议代表
                  </span>
                  <span className="font-semibold text-fg">{minority.dissentingAgentName}</span>
                </div>
                <p className="text-fg leading-relaxed break-words">
                  <span className="font-semibold">核心异议：</span>{minority.coreDissentThesis}
                </p>
                <p className="text-fg-secondary leading-relaxed break-words">
                  <span className="font-semibold text-fg">自洽推演逻辑：</span>{minority.rationalityBasis}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-surface border border-amber-300 dark:border-amber-500/30 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>黑天鹅重启触发器</span>
                </div>
                {(minority.reopeningTriggers || []).length > 0 ? (
                  <ul className="space-y-1 text-[10px] text-fg-secondary">
                    {minority.reopeningTriggers.map((trigger, idx) => (
                      <li key={`${trigger}-${idx}`} className="flex items-start gap-1.5 break-words">
                        <span className="text-amber-600 dark:text-amber-400 shrink-0">•</span>
                        <span>{trigger}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-fg-muted italic">未记录重启触发条件。</p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] text-fg-muted italic">
              本决议未记录独立少数派异议，黑天鹅重启条件为空。
            </div>
          )}
        </div>

        {/* Section 8: Bounded Impact Radius */}
        <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-500/[0.08] border border-blue-200 dark:border-blue-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 dark:border-blue-500/25 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
              <span className="text-blue-900 dark:text-blue-200">8. 限定安全爆炸半径 (Bounded Impact Radius)</span>
            </div>
            <span className="text-[10px] text-blue-800 dark:text-blue-300 font-mono font-semibold">🛡️ File Boundary</span>
          </div>

          {impactedFiles.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] text-fg-secondary leading-relaxed">
                本次决议严格约束变更范围，执行 Agent 严禁修改以下白名单之外的文件。
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {impactedFiles.map((file, idx) => (
                  <div
                    key={`${file}-${idx}`}
                    className="p-2 rounded-lg bg-surface border border-border flex items-start gap-1.5 text-[10px] font-mono text-fg min-w-0"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <code className="break-all whitespace-normal min-w-0">{file}</code>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] text-fg-muted italic">
              未声明特定白名单文件，遵循模块拓扑接口契约限制。
            </div>
          )}
        </div>

        {/* Section 9: Resolution Execution & Deliverables (Agent-Driven UI Meta) */}
        <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-500/[0.08] border border-emerald-200 dark:border-emerald-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 dark:border-emerald-500/25 pb-1.5">
            <div className="flex min-w-0 items-center gap-1.5 font-bold text-fg text-xs">
              <span className="w-1.5 h-3.5 rounded-full bg-emerald-600 dark:bg-emerald-500 shrink-0" />
              <span>
                9. 落地执行与工程交付清单 (Actionable Checklist)
              </span>
            </div>
            <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-mono font-semibold">
              {topic.gameTheoreticState?.executionUiMeta?.podTitle || '🛠️ Executor'}
            </span>
          </div>

          {topic.gameTheoreticState?.executionUiMeta?.sectionTitle && (
            <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[10px] text-fg-secondary break-words">
              {topic.gameTheoreticState.executionUiMeta.sectionTitle}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5">
            {[
              `主导实施负责人：${executorAgent?.name || '待人工批准指派'}`,
              '核心补丁实现：按照落地实施要旨编写工程代码补丁',
              '红队边界回归：确保红队指出的失效工况有测试覆盖',
              '工作区审查与合入：通过基线校验与人工确认后正式落盘',
            ].map((item, idx) => (
              <div
                key={`${item}-${idx}`}
                className="p-2 rounded-lg bg-surface border border-border flex items-start gap-2 text-[10px] text-fg-secondary min-w-0"
              >
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-emerald-400 dark:border-emerald-500/50" />
                <span className="break-words leading-relaxed">{item}</span>
              </div>
            ))}
          </div>

          {/* Multi-Topic Blast-Radius Overlap Alert */}
          {overlappingFiles.length > 0 && (
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/35 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">⚠️ 多议题爆炸半径重叠预警：</span>
                <span>
                  当前频道内存在其他并行落地议题同时涉及{' '}
                  <code className="font-mono px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-500/20">{overlappingFiles.join(', ')}</code>
                  ，合入变更前请通过审查视图核对顺序。
                </span>
              </div>
            </div>
          )}

          {/* Executor Status Header */}
          <div className="p-2.5 rounded-lg bg-surface dark:bg-surface/85 border border-border flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-[11px] text-fg-secondary">执行 Agent:</span>
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-medium">
                  <Clock className="w-3 h-3" />
                  <span>队列等待中 (Agent 正在执行前序任务)</span>
                </span>
              )}
              {isRunning && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 animate-ping" />
                  <span>
                    正在执行定案决议 ({activeExec ? ((now - activeExec.startedAt) / 1000).toFixed(1) : ((now - (topic.gameTheoreticState?.executionStartedAt || now)) / 1000).toFixed(1)}s)
                  </span>
                </span>
              )}
              {!isRunning && executionStatus === 'completed' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-semibold">
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>执行中断 / 需重新指派</span>
                </span>
              )}
            </div>
          </div>

          {/* Live Streaming Progress when Running */}
          {isRunning && (
            <div className="p-2.5 rounded-lg bg-surface border border-amber-300 dark:border-amber-500/30 space-y-1.5 animate-in fade-in">
              <div className="flex items-center justify-between text-[10px] text-amber-800 dark:text-amber-300 font-mono">
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
                <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
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
                  {onRollbackTopicPatch && topic.gameTheoreticState?.executionPatchHistoryPath && (
                    <button
                      type="button"
                      disabled={isRollingBack}
                      onClick={handleRollbackPatchClick}
                      className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover border border-rose-300 dark:border-rose-500/35 text-rose-800 dark:text-rose-300 disabled:opacity-50 text-[10px] font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      {isRollingBack ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      <span>{isRollingBack ? '回退中...' : '回退本次合入'}</span>
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
                  : '待第 6 节终局决议敲定后，可手动委派执行 Agent 推进落地。'}
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
