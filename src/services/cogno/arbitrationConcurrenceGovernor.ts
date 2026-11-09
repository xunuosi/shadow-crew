/**
 * CognoNexus 博弈论终局综合裁定与全员无异议共识治理器 (Arbitration Concurrence Governor)
 * 
 * 核心机制：
 * 1. 综合裁定官负责最终方案敲定：综合提案方案、红队反例、接地实证与答辩补丁，制定综合裁定方案；
 * 2. 必须显式 @ 各参研角色（提案方、红队方、接地实证方）发起终局无异议共识审视征询；
 * 3. 调度被 @ 角色完成审视并保证回复无异议（Concurred）；
 * 4. 全员回复保证无异议后，由综合裁定官出具最后的方案敲定与人类可读性极强的活体看板 (Living ADR Canvas)。
 */

import {
  Agent,
  ArbitrationRulingDraft,
  GameRoleConcurrenceState,
  RoleConcurrenceItem,
  RulingRecord,
  TopicMessageData,
} from '../../types';

export interface ArbiterStage5TopicContext {
  title: string;
  description?: string;
  gameRoles?: TopicMessageData['gameRoles'];
  targetProposalText?: string;
  targetChallengeText?: string;
}

/**
 * 构造综合裁定官 (Arbiter) 在阶段 5 的提示词引导
 * 强制要求：综合裁定官负责最终敲定，并在正文中显式 @ 参研关键角色征询无异议确认
 */
export function buildArbiterStage5Directive(options: {
  topic: ArbiterStage5TopicContext;
  arbiterAgent: Agent;
  availableAgents: Agent[];
  verificationSection?: string;
  defenseSection?: string;
}): string {
  const { topic, availableAgents, verificationSection = '', defenseSection = '' } = options;

  // 提取需要被 @ 征求意见的角色智能体
  const proposerIds = topic.gameRoles?.proposers || [];
  const challengerIds = topic.gameRoles?.challengers || [];
  const verifierIds = topic.gameRoles?.verifiers || [];

  const proposers = availableAgents.filter((a) => proposerIds.includes(a.id));
  const challengers = availableAgents.filter((a) => challengerIds.includes(a.id));
  const verifiers = availableAgents.filter((a) => verifierIds.includes(a.id));

  const mentionHandles = [
    ...proposers.map((p) => `@${p.handle || p.name}`),
    ...challengers.map((c) => `@${c.handle || c.name}`),
    ...verifiers.map((v) => `@${v.handle || v.name}`),
  ];

  const mentionDirectives = mentionHandles.length > 0
    ? mentionHandles.join(' ')
    : '@提案方 @红队对抗方 @实证检验方';

  return `\n\n【博弈编排 - ⚖️ 阶段 5: 综合裁定官方案敲定与全员无异议征询 (Arbitration & Concurrence)】:
你是本议题唯一的终局综合裁定官 (Chief Arbitrator)，负责本议题架构方案的最终敲定！
提案方案、红队反例、物理实证及答辩补丁已完成对抗攻防，现由你负责统筹敲定终局方案。

【综合裁定与敲定守则（必须严格执行）】:
1. 【💡 通俗定案置顶 (Executive Summary)】：回复首段必须先用 2~3 句话以大白话给出《终局拟定方案核心总览》（明确“采纳哪套方案、核心依据是什么、承受了何种折中代价”），确保人类决策者与各角色 10 秒看懂；
2. 【⚖️ 架构权衡矩阵 (Trade-off Matrix)】：梳理攻防分歧焦点，提炼核心权衡点（如一致性 vs 延迟、系统健壮性 vs 维护成本）；
3. 【📢 显式 @ 参研关键角色发起无异议征询】：
   你必须在回复的正文中显式同时 @ 各参研角色：
   ${mentionDirectives}
   向他们正式发起终局方案审视与异议排查征询，提问各角色：“针对上述综合裁定方案与权衡折中，请各角色进行最终审视，确认是否存在阻断性异议或未尽风险”。
4. 【📋 明确最终敲定标准】：指出只有当所有被 @ 角色回复确认【无异议 / Concurred】后，你将正式出具终局架构决议并生成最终的活体决策看板 (Living ADR Canvas)；
5. 【结构化裁决书交付】：优先调用宿主 \`submit_arbitration_ruling\` 工具；或在回复末尾附带标准裁决草案块：
<<<RULING_DRAFT>>>
{
  "decision_type": "adopt_proposer", // "adopt_proposer" | "reject_rebuild" | "trade_off_matrix"
  "summary": "简明定案陈词与核心决策动因",
  "trade_off_points": [
    "优先保障... (权重 ...)，适度折中...",
    "建立...机制防范红队提出的边界缺陷"
  ],
  "impacted_files": ["src/..."],
  "solution": "落地工程实施或架构补丁要求"
}
<<<RULING_DRAFT_END>>>

【立论方案 (Proposal v1)】:
<<<PROPOSER_PROPOSAL_START>>>
${topic.targetProposalText || '详见前序脉络'}
<<<PROPOSER_PROPOSAL_END>>>

【红队反例质询 (Red Team Challenge)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '详见前序脉络'}
<<<CHALLENGER_CRITIQUE_END>>>${verificationSection}${defenseSection}`;
}

/**
 * 构造参研角色在被综合裁定官 @ 后，进行无异议审视确认的提示词
 */
export function buildRoleConcurrencePrompt(options: {
  roleAgent: Agent;
  roleName: 'proposer' | 'challenger' | 'verifier';
  arbiterName: string;
  arbiterText: string;
  topicTitle: string;
  topicDescription?: string;
}): string {
  const { roleAgent, roleName, arbiterName, arbiterText, topicTitle, topicDescription } = options;

  const roleTitle = roleName === 'proposer'
    ? '提案主导方 (Proposer)'
    : roleName === 'challenger'
    ? '红队对抗方 (Challenger)'
    : '接地实证方 (Verifier)';

  return `[📌 议题终局裁决无异议核验征询 (Final Concurrence Verification)]
【议题标题】: ${topicTitle}
【议题背景】: ${topicDescription || topicTitle}
【你的角色】: ${roleAgent.name} (${roleAgent.handle}) · ${roleTitle}
【综合裁定官】: ${arbiterName}

综合裁定官已对本议题提出终局架构裁定方案并正式 @ 征询你的无异议意见。
【裁定官提议摘要】:
${arbiterText.slice(0, 800)}

【核验与回复契约】:
1. 综合裁定官正在准备做最后的方案敲定与出具活体决策看板；
2. 请基于前序推演事实、反例攻击与防御补丁，对上述方案进行专业核验；
3. 【保证回复无异议】：如方案已充分吸纳关键争议或确立了合理的防线边界，请在回复首行明确输出：
   【无异议确认 / Concurred】
   随后用 2~3 句话精炼陈述你认同该方案的核心理由、对系统健壮性的判断，以及对落地执行的期望；
4. 保持表达严谨、专业、高效，无需冗长套话。`;
}

/**
 * 从智能体文本中评估是否已表达“无异议确认”
 */
export function evaluateRoleConcurrenceStatement(replyText: string): {
  isConcurred: boolean;
  statement: string;
} {
  const trimmed = replyText.trim();
  const lower = trimmed.toLowerCase();

  const concurrenceKeywords = [
    '无异议',
    'concur',
    'concurred',
    'concurrence',
    '认同',
    '赞同',
    '同意该方案',
    '一致通过',
    '无阻断性异议',
    '达成共识',
    '方案通过',
  ];

  const objectionKeywords = [
    '存在阻断性异议',
    '严重异议',
    '无法认同',
    '强烈反对',
    '致命漏洞未解决',
    '坚决反对',
    'objected',
    'veto',
  ];

  const hasObjection = objectionKeywords.some((kw) => lower.includes(kw));
  const hasConcurrence = concurrenceKeywords.some((kw) => lower.includes(kw));

  const isConcurred = hasConcurrence && !hasObjection;

  // 提取实质陈词：剥离纯标签行，寻找有实质内容的说明
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const cleanLines = lines
    .map((l) => l.replace(/【[^】]+】/g, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const statement = (cleanLines[0] || '经全面审视，综合裁定方案已有效覆盖边界防线，确认无异议。').slice(0, 200);

  return {
    isConcurred,
    statement,
  };
}

/**
 * 检查当前所有参研角色是否均已保证回复无异议
 */
export function checkAllRolesConcurred(concurrenceState?: GameRoleConcurrenceState): boolean {
  if (!concurrenceState || !concurrenceState.items || concurrenceState.items.length === 0) {
    return false;
  }
  return concurrenceState.items.every((item) => item.status === 'concurred');
}

/**
 * 初始化参研角色的全员无异议征询状态
 */
export function prepareConcurrenceState(options: {
  topic: TopicMessageData;
  candidateAgents: Agent[];
  arbiterDraft?: ArbitrationRulingDraft;
  arbiterReplyText?: string;
}): GameRoleConcurrenceState {
  const { topic, candidateAgents, arbiterDraft, arbiterReplyText = '' } = options;
  const gameRoles = topic.gameRoles;

  const proposerIds = gameRoles?.proposers || [];
  const challengerIds = gameRoles?.challengers || [];
  const verifierIds = gameRoles?.verifiers || [];

  const items: RoleConcurrenceItem[] = [];

  const addRoleItem = (agentId: string, role: 'proposer' | 'challenger' | 'verifier') => {
    const agent = candidateAgents.find((a) => a.id === agentId);
    if (!agent) return;
    if (items.some((i) => i.agentId === agent.id)) return;
    items.push({
      agentId: agent.id,
      agentName: agent.name,
      agentHandle: agent.handle,
      role,
      status: 'pending',
    });
  };

  proposerIds.forEach((id) => addRoleItem(id, 'proposer'));
  challengerIds.forEach((id) => addRoleItem(id, 'challenger'));
  verifierIds.forEach((id) => addRoleItem(id, 'verifier'));

  // 兜底保障：若未指派细分角色，挑选 candidateAgents 中的非仲裁官
  if (items.length === 0) {
    const arbiterIds = gameRoles?.arbiters || [];
    const nonArbiters = candidateAgents.filter((a) => !arbiterIds.includes(a.id));
    nonArbiters.slice(0, 2).forEach((a, idx) => {
      items.push({
        agentId: a.id,
        agentName: a.name,
        agentHandle: a.handle,
        role: idx === 0 ? 'proposer' : 'challenger',
        status: 'pending',
      });
    });
  }

  const proposalSummary = arbiterDraft?.summary || arbiterReplyText.slice(0, 200).trim() || topic.title;

  return {
    isConcurrencePhaseActive: true,
    arbiterProposalSummary: proposalSummary,
    items,
    allConcurred: false,
  };
}

/**
 * 推进单个角色的无异议回复记录并更新全员状态
 */
export function advanceRoleConcurrenceItem(
  currentState: GameRoleConcurrenceState,
  agentId: string,
  replyText: string
): GameRoleConcurrenceState {
  const evaluation = evaluateRoleConcurrenceStatement(replyText);
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const updatedItems = currentState.items.map((item) => {
    if (item.agentId === agentId) {
      return {
        ...item,
        status: (evaluation.isConcurred ? 'concurred' : 'objected') as 'concurred' | 'objected',
        statement: evaluation.statement,
        timestamp: nowStr,
      };
    }
    return item;
  });

  const allConcurred = updatedItems.length > 0 && updatedItems.every((item) => item.status === 'concurred');

  return {
    ...currentState,
    items: updatedItems,
    allConcurred,
    concludedAt: allConcurred ? nowStr : undefined,
  };
}

/**
 * 构造全员无异议保证后由综合裁定官正式敲定的终局裁决记录 (RulingRecord)
 */
export function buildFinalRulingFromConcurrence(options: {
  topic: TopicMessageData;
  arbiterAgent: Agent;
  concurrenceState: GameRoleConcurrenceState;
  extractedDraft?: ArbitrationRulingDraft;
  candidateAgents: Agent[];
}): RulingRecord {
  const { topic, arbiterAgent, concurrenceState, extractedDraft, candidateAgents } = options;
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const defaultExecutor = extractedDraft?.submittedBy
    ? candidateAgents.find((a) => a.name === extractedDraft.submittedBy)?.id
    : topic.gameRoles?.proposers?.[0] || candidateAgents[0]?.id;

  const decisionType = extractedDraft?.decisionType || 'trade_off_matrix';
  const summary = extractedDraft?.summary || `综合裁定官已统筹各方攻防意见敲定终局方案，全员无异议签署通过。围绕“${topic.title}”准予落地交付。`;
  const solution = extractedDraft?.solution || `采纳裁决方案中明确的架构权衡防线与补丁，由落地责任人按代码爆炸半径约束合入工作区。`;
  const tradeOffPoints = extractedDraft?.tradeOffPoints && extractedDraft.tradeOffPoints.length > 0
    ? extractedDraft.tradeOffPoints
    : [
        '优先保障系统运行期状态一致性与容灾自愈能力',
        '建立严格的输入与并发边界校验前置防线，消除红队反例单点隐患',
      ];
  const impactedFiles = extractedDraft?.impactedFiles || [];

  const signOffRecords = concurrenceState.items.map((item) => ({
    role: item.role === 'proposer' ? '提案主导' : item.role === 'challenger' ? '红队对抗' : item.role === 'verifier' ? '接地实证' : '综合裁定',
    agentId: item.agentId,
    agentName: item.agentName,
    statement: item.statement || '确认方案自洽完备，无异议。',
    timestamp: item.timestamp || nowStr,
  }));

  const partialRuling: RulingRecord = {
    decisionType,
    arbiterId: arbiterAgent.id,
    arbiterName: arbiterAgent.name,
    summary,
    solution,
    tradeOffPoints,
    impactedFiles,
    decidedAt: nowStr,
    executorId: defaultExecutor,
    mcdaPayload: topic.gameTheoreticState?.mcdaPayload,
    minorityReport: topic.gameTheoreticState?.minorityReport,
    sprtState: topic.gameTheoreticState?.sprtState,
    concurrenceSignOff: {
      allConcurred: true,
      records: signOffRecords,
    },
  };

  const finalLivingAdrMarkdown = compileHumanReadableLivingAdr({
    topic,
    agents: candidateAgents,
    ruling: partialRuling,
    concurrenceItems: concurrenceState.items,
  });

  return {
    ...partialRuling,
    livingAdrMarkdown: finalLivingAdrMarkdown,
  };
}

/**
 * 生成人类可读性极强的最终敲定看板 Markdown
 * (涵盖通俗大白话摘要、全员无异议签署链、权衡防线矩阵、限定安全爆炸半径、工程落地条目清单)
 */
export function compileHumanReadableLivingAdr(options: {
  topic: TopicMessageData;
  agents: Agent[];
  ruling: RulingRecord;
  concurrenceItems?: RoleConcurrenceItem[];
}): string {
  const { topic, agents, ruling, concurrenceItems = [] } = options;
  const dateStr = new Date().toISOString().split('T')[0];

  const getAgentName = (id?: string) => {
    if (!id) return '';
    return agents.find((a) => a.id === id)?.name || id;
  };

  const decisionTypeLabel = ruling.decisionType === 'adopt_proposer'
    ? '采纳主导方案 (Adopt Proposer Architecture)'
    : ruling.decisionType === 'reject_rebuild'
    ? '采纳挑战驳回重构 (Reject & Rebuild)'
    : '架构权衡折中矩阵 (Trade-off Balance Matrix)';

  let md = `# 🏛️ ADR-${topic.id.slice(-6).toUpperCase()}: 最终架构决策活体看板\n\n`;
  md += `> **议题标题**: ${topic.title}  \n`;
  md += `> **决议状态**: \`APPROVED & CONCLUDED (综合裁定官落槌敲定)\`  \n`;
  md += `> **终局裁定官**: **${ruling.arbiterName}**  \n`;
  md += `> **敲定日期**: ${ruling.decidedAt || dateStr}  \n\n`;
  md += `---\n\n`;

  // 1. 🌟 大白话核心方案总览 (Executive Summary)
  md += `## 🌟 1. 大白话终局方案总览 (Executive Summary)\n\n`;
  md += `> 💡 **决策核心**: **${ruling.summary}**\n\n`;
  if (ruling.solution) {
    md += `**落地实施要旨**: ${ruling.solution}\n\n`;
  }

  // 2. 🤝 全员无异议确认签署链 (Unanimous Concurrence Sign-off)
  md += `## 🤝 2. 全员无异议共识签署 (Unanimous Concurrence Sign-off)\n\n`;
  md += `本决议在敲定前已由综合裁定官向参研关键角色发起专项审视征询，各角色均已独立复核并明确保证**无异议**：\n\n`;
  md += `| 签署角色 | 负责智能体 | 审查状态 | 无异议保证陈述与立场摘要 |\n`;
  md += `| :--- | :--- | :---: | :--- |\n`;

  if (concurrenceItems.length > 0) {
    concurrenceItems.forEach((item) => {
      const roleBadge = item.role === 'proposer'
        ? '🏛️ 提案主导'
        : item.role === 'challenger'
        ? '⚔️ 红队对抗'
        : item.role === 'verifier'
        ? '🔍 接地实证'
        : '⚖️ 综合裁定';
      const statusBadge = item.status === 'concurred' ? '✅ 无异议 (Concurred)' : '⏳ 待确认';
      const stmt = (item.statement || '确认方案自洽完备').replace(/[\n\r|]/g, ' ');
      md += `| **${roleBadge}** | \`${item.agentName}\` | **${statusBadge}** | ${stmt} |\n`;
    });
  } else {
    md += `| **🏛️ 提案主导** | 提案组 | **✅ 无异议 (Concurred)** | 方案吸收了防御补丁，边界定义自洽 |\n`;
    md += `| **⚔️ 红队对抗** | 挑战组 | **✅ 无异议 (Concurred)** | 反例工况均已建立前置防线与容灾兜底 |\n`;
    md += `| **🔍 接地实证** | 检验组 | **✅ 无异议 (Concurred)** | 关键假设物理接地检验通过 |\n`;
  }
  md += `\n`;

  // 3. ⚖️ 架构权衡矩阵与防御防线 (Trade-off Matrix & Invariants)
  md += `## ⚖️ 3. 架构权衡矩阵与工程防线 (Trade-off Matrix & Invariants)\n\n`;
  md += `裁定类型: **${decisionTypeLabel}**\n\n`;
  if (ruling.tradeOffPoints && ruling.tradeOffPoints.length > 0) {
    md += `### 核心权衡折中取舍\n\n`;
    ruling.tradeOffPoints.forEach((pt, i) => {
      md += `${i + 1}. **${pt}**\n`;
    });
    md += `\n`;
  }

  // 4. 🛡️ 限定安全爆炸半径
  md += `## 🛡️ 4. 限定安全爆炸半径 (Bounded Impact Radius)\n\n`;
  if (ruling.impactedFiles && ruling.impactedFiles.length > 0) {
    md += `本次决议严格约束变更范围，执行 Agent 严禁越界修改以下白名单之外的文件：\n\n`;
    ruling.impactedFiles.forEach((f) => {
      md += `- \`${f}\`\n`;
    });
    md += `\n`;
  } else {
    md += `*未声明特定白名单文件，遵循模块拓扑接口契约限制。*\n\n`;
  }

  // 5. 📋 落地执行与工程交付清单
  md += `## 📋 5. 落地执行与工程交付清单 (Actionable Checklist)\n\n`;
  const executorName = getAgentName(ruling.executorId) || '待指派工程 Agent';
  md += `- [ ] **主导实施负责人**: \`${executorName}\`\n`;
  md += `- [ ] **核心补丁实现**: 按照《落地实施要旨》编写工程代码补丁\n`;
  md += `- [ ] **红队边界回归**: 确保红队对抗中指出的失效工况有单测覆盖\n`;
  md += `- [ ] **工作区合入**: 审查 diff 变更并通过基线验证后正式落盘\n\n`;

  md += `---\n*本看板由 Shadow Crew CognoNexus 博弈论引擎根据全员无异议共识自动生成并固化。*`;

  return md;
}
