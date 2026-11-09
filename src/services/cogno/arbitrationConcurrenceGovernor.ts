/**
 * CognoNexus 博弈论终局综合裁定与全员无异议共识治理器 (Arbitration Concurrence Governor)
 * 
 * 核心机制：
 * 1. 综合裁定官负责最终方案敲定：综合提案方案、红队反例、接地实证与答辩补丁，制定综合裁定方案；
 * 2. 必须显式 @ 各参研角色（提案方、红队方、接地实证方）发起终局无异议共识审视征询（杜绝双 @）；
 * 3. 调度被 @ 角色完成审视并保证回复无异议（Concurred），严禁离线/异常伪造无异议，否定句式严格拦截；
 * 4. 仅在全员真实回复保证无异议后，由综合裁定官出具最后的方案敲定与人类可读性极强、资产完整的活体看板 (Living ADR Canvas)。
 */

import {
  Agent,
  ArbitrationRulingDraft,
  GameRoleConcurrenceState,
  McdaDecisionPayload,
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
 * 安全格式化 @ 句柄，杜绝 @@ 语法缺陷
 */
export function normalizeMentionHandle(agent: Agent): string {
  const raw = (agent.handle || agent.name || '').trim();
  if (!raw) return '@agent';
  return raw.startsWith('@') ? raw : `@${raw}`;
}

/**
 * 转义 Markdown 表格单元格中的竖线与换行，杜绝列错位
 */
export function escapeTableCell(val?: string): string {
  if (!val) return '';
  return val.replace(/[\n\r]/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * 格式化包含年月日的完整日期时间 (YYYY-MM-DD HH:mm)
 */
export function formatFullDateTime(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
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
    ...proposers.map(normalizeMentionHandle),
    ...challengers.map(normalizeMentionHandle),
    ...verifiers.map(normalizeMentionHandle),
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
【你的角色】: ${roleAgent.name} (${normalizeMentionHandle(roleAgent)}) · ${roleTitle}
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
4. 【存在异议时如实陈述】：若方案仍存在不可接受的重大架构隐患、致命并发死锁或未经实证的假设，请明确输出【存在阻断性异议】并陈述异议焦点；
5. 保持表达严谨、专业、高效，无需冗长套话。`;
}

/**
 * 从智能体文本中严格评估是否已表达“无异议确认”
 * 严格防范否定词击穿（如“我不认同”、“我不同意该方案”、“并非无异议”、“I cannot concur”、“认同整体，但反对直接上线”）
 */
export function evaluateRoleConcurrenceStatement(replyText: string): {
  isConcurred: boolean;
  statement: string;
} {
  const trimmed = replyText.trim();
  if (!trimmed) {
    return {
      isConcurred: false,
      statement: '未收到角色有效回复，无法确认无异议。',
    };
  }

  // 1. 识别并提取良性/免责/吸收反转句式（Benign Affirmative Mitigations）
  // 覆盖场景：
  // G1: “未发现致命漏洞，确认无异议。” -> 未发现/不存在/无致命漏洞
  // G2: “不存在阻断性异议，确认无异议。” -> 不存在/没有/不持阻断性异议
  // G3: “方案已消除重大风险，确认无异议。” -> 已消除/已化解重大风险
  // G4: “反对意见已被充分吸收，确认无异议。” -> 反对意见已被吸收/解决
  // G5: “方案可行，我不持异议。” -> 我不持异议 / 不持异议
  // G6: “该方案没有重大风险，确认无异议。” -> 没有重大风险
  // G11: “我不反对该方案，确认无异议。” -> 我不反对该方案
  const benignMitigationPatterns = [
    // 异议消除或不持异议 (双重否定为肯定)
    /(?:我不?|并?不|没有)(?:持|存在?)(?:任何|阻断性?|严重|重大)?异议/g,
    // 不反对方案 (双重否定为肯定，注意避开“但反对直接上线”)
    /(?:我不?|并?不)反对(?:该方案|此方案|当前方案|此提议|该裁定|方案)?(?=[，,。\s]|$)/g,
    // 反对意见已吸收/已采纳
    /反对(?:意见|声音|点)?已(?:经)?被?(?:充分)?(?:吸收|采纳|解决|化解|消除)/g,
    // 风险/漏洞已消除/已化解
    /(?:已(?:经)?(?:充分)?(?:消除|化解|解决|修复)|消除)(?:了)?(?:所有|各项|潜在|相关|指出的一致性|致命|重大)?(?:风险|隐患|漏洞|缺陷|并发问题)/g,
    /(?:风险|隐患|漏洞|缺陷)(?:已经?|均已|已被?)(?:充分)?(?:消除|化解|解决|修复)/g,
    // 未发现/没有/无风险或漏洞
    /(?:未发现|没有发现|没有|不存在|未见)(?:任何)?(?:明显|严重|致命|重大)?(?:风险|隐患|漏洞|缺陷|阻塞)/g,
  ];

  let hasBenignConcurrence = false;
  let sanitizedText = trimmed;
  for (const pattern of benignMitigationPatterns) {
    if (pattern.test(sanitizedText)) {
      hasBenignConcurrence = true;
      sanitizedText = sanitizedText.replace(pattern, ' __BENIGN_CONCURRENCE__ ');
    }
  }

  // 2. 否定模式与异议表达库（在脱敏良性表达后的文本上进行全面防御）
  const negationPatterns = [
    // 否定认同/同意/支持
    /不(?:认同|赞同|同意|接受|支持)/,
    /无法(?:认同|赞同|同意|接受)/,
    /不能(?:认同|赞同|同意)/,
    /不予(?:认同|通过|支持)/,
    // 否定无异议
    /(?:并非|并不是|绝非|不代表|不能算|不可视作|并不算)无异议/,
    // 异议表达
    /(?:存在|持有|保留|提出)(?:阻断性?|严重|重大)?(?:异议|分歧|质疑)/,
    /阻断性异议/,
    /严重异议/,
    /重大风险/,
    /致命(?:隐患|漏洞|缺陷)/,
    // 反对表达 (注意：但反对、坚决反对等)
    /(?:坚决|强烈|明确)?反对/,
    /但反对/,
    /必须重构/,
    /拒绝通过/,
    /驳回原案/,
    /推倒重来/,
    // 英文否定
    /(?:can\s*not|cannot|can't|do\s*not|don't|does\s*not|doesn't)\s*concur/i,
    /(?:can\s*not|cannot|can't|do\s*not|don't|does\s*not|doesn't)\s*agree/i,
    /\b(?:object|objected|objection|veto|reject|dissent|disagree)\b/i,
    /not\s*(?:concur|agree|acceptable)/i,
    /not\s*without\s*objection/i,
  ];

  // 3. 检查脱敏后文本的否定模式
  const hasNegation = negationPatterns.some((regex) => regex.test(sanitizedText));

  // 4. 肯定模式库（必须包含积极且明确的确认意向）
  const explicitTags = [
    /【\s*(?:无异议(?:确认)?|concur(?:red)?)\s*(?:\/|\s*)?(?:concur(?:red)?)?\s*】/i,
    /\[\s*(?:无异议(?:确认)?|concur(?:red)?)\s*\]/i,
  ];
  const hasExplicitTag = explicitTags.some((re) => re.test(trimmed));

  const affirmativePhrases = [
    /(?:经全面审视|经审视|核验确认|对此方案|架构方案|本人)?(?:明确)?(?:无异议|零异议)/,
    /(?:完全|表示|予以)?(?:认同该方案|认同此方案|赞同该方案|同意该方案|一致通过|达成共识|方案通过)/,
    /(?:不持|不存在?)(?:任何|阻断性)?异议/,
    /不反对(?:该方案|此方案|方案)?/,
    /\b(?:i\s+)?concur\s+(?:with|in)\b/i,
    /\b(?:i\s+)?concurred\b/i,
  ];
  const hasAffirmativePhrase = affirmativePhrases.some((re) => re.test(trimmed));

  // 5. 判定：必须有肯定模式或良性无异议短语，且脱敏后绝对无残留真实否定倾向
  const isConcurred = (hasExplicitTag || hasAffirmativePhrase || hasBenignConcurrence) && !hasNegation;

  // 6. 提取实质陈词：剥离纯标签行，寻找有实质内容的说明
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const cleanLines = lines
    .map((l) => l.replace(/【[^】]+】/g, '').replace(/\[[^\]]+\]/g, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const rawStatement = cleanLines[0] || lines[0] || (isConcurred ? '确认方案完备自洽，无异议。' : '对方案存在保留意见或异议。');
  const statement = rawStatement.replace(/【[^】]+】/g, '').replace(/\[[^\]]+\]/g, '').trim().slice(0, 200);

  return {
    isConcurred,
    statement: statement || (isConcurred ? '经全面审视，综合裁定方案已有效覆盖边界防线，确认无异议。' : '对方案提出异议或修改要求。'),
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
      agentHandle: normalizeMentionHandle(agent),
      role,
      status: 'pending',
    });
  };

  proposerIds.forEach((id) => addRoleItem(id, 'proposer'));
  challengerIds.forEach((id) => addRoleItem(id, 'challenger'));
  verifierIds.forEach((id) => addRoleItem(id, 'verifier'));

  const proposalSummary = arbiterDraft?.summary || arbiterReplyText.slice(0, 200).trim() || topic.title;

  return {
    isConcurrencePhaseActive: items.length > 0,
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
  replyText: string,
  isUnavailable: boolean = false
): GameRoleConcurrenceState {
  const nowStr = formatFullDateTime();

  let status: RoleConcurrenceItem['status'];
  let statement: string;

  if (isUnavailable) {
    status = 'unavailable';
    statement = replyText || '智能体处于离线或异常状态，无法完成独立审视与无异议核验。';
  } else {
    const evaluation = evaluateRoleConcurrenceStatement(replyText);
    status = evaluation.isConcurred ? 'concurred' : 'objected';
    statement = evaluation.statement;
  }

  const updatedItems = currentState.items.map((item) => {
    if (item.agentId === agentId) {
      return {
        ...item,
        status,
        statement,
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
 * 严格门禁：未满足全员真实无异议时抛出异常，绝不输出伪全票裁决！
 */
export function buildFinalRulingFromConcurrence(options: {
  topic: TopicMessageData;
  arbiterAgent: Agent;
  concurrenceState: GameRoleConcurrenceState;
  extractedDraft?: ArbitrationRulingDraft;
  candidateAgents: Agent[];
}): RulingRecord {
  const { topic, arbiterAgent, concurrenceState, extractedDraft, candidateAgents } = options;

  if (!checkAllRolesConcurred(concurrenceState)) {
    throw new Error('[buildFinalRulingFromConcurrence] 存在未达成真实无异议确认的角色，严格禁止出具终局全员签署裁决！');
  }

  const nowStr = formatFullDateTime();

  const decisionType = extractedDraft?.decisionType || 'trade_off_matrix';
  const summary = extractedDraft?.summary || `综合裁定官已统筹各方攻防意见敲定终局方案，全员无异议签署通过。围绕“${topic.title}”准予落地交付。`;
  const solution = extractedDraft?.solution || `采纳裁决方案中明确的架构权衡防线与补丁，由落地责任人按代码爆炸半径约束合入工作区。`;
  const tradeOffPoints = extractedDraft?.tradeOffPoints && extractedDraft.tradeOffPoints.length > 0
    ? extractedDraft.tradeOffPoints
    : [];
  const impactedFiles = extractedDraft?.impactedFiles || [];

  const signOffRecords = concurrenceState.items.map((item) => {
    const roleTitle = item.role === 'proposer' ? '提案主导' : item.role === 'challenger' ? '红队对抗' : item.role === 'verifier' ? '接地实证' : '综合裁定';
    return {
      role: roleTitle,
      agentId: item.agentId,
      agentName: item.agentName,
      statement: item.statement || '确认方案完备自洽，无异议。',
      timestamp: item.timestamp || nowStr,
    };
  });

  const partialRuling: RulingRecord = {
    decisionType,
    arbiterId: arbiterAgent.id,
    arbiterName: arbiterAgent.name,
    summary,
    solution,
    tradeOffPoints,
    impactedFiles,
    decidedAt: nowStr,
    executorId: undefined, // 自动全员无异议定案不预设自动执行者，严禁自动派发，交由人类在活体看板审阅后显式点击批准指派
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
 * 集中评估仲裁裁决门禁（一致性硬门禁与挑战方法定人数）
 * 供 UI (TopicThreadDrawer) 与自动流程 (App) 共同调用，杜绝逻辑分化
 */
export function evaluateRulingGates(
  topic: TopicMessageData,
  mcdaPayload?: McdaDecisionPayload
): {
  isConsistencyPassed: boolean;
  isChallengerQuorumMet: boolean;
  allGatesPassed: boolean;
  reason?: string;
} {
  const isConsistencyPassed = mcdaPayload?.consistencyPassed ?? (topic.gameTheoreticState?.mcdaPayload?.consistencyPassed ?? true);
  const isChallengerQuorumMet =
    topic.discussionMode !== 'game_theoretic' ||
    !topic.gameRoles?.challengers?.length ||
    topic.gameTheoreticState?.isChallengerBypassed === true ||
    topic.gameTheoreticState?.isChallengerResponded !== false;

  const allGatesPassed = isConsistencyPassed && isChallengerQuorumMet;
  let reason: string | undefined;
  if (!isConsistencyPassed) {
    reason = `MCDA 运筹一致性指标未达标 (ξ* > 0.12)`;
  } else if (!isChallengerQuorumMet) {
    reason = `挑战方法定人数门禁未达成 (红队未响应且未被旁路)`;
  }

  return {
    isConsistencyPassed,
    isChallengerQuorumMet,
    allGatesPassed,
    reason,
  };
}

/**
 * 生成人类可读性极强、且完整保留推演证据资产的最终 ADR Markdown 文档
 * (包含完整年月日、大白话摘要、全员无异议签署链、立论因果图、红队反例证伪、接地物理实证、BWM 运筹一致性、少数派异议、爆炸半径与行动清单)
 */
export function compileHumanReadableLivingAdr(options: {
  topic: TopicMessageData;
  agents: Agent[];
  ruling: RulingRecord;
  concurrenceItems?: RoleConcurrenceItem[];
}): string {
  const { topic, agents, ruling, concurrenceItems = [] } = options;
  const fullDateStr = ruling.decidedAt || formatFullDateTime();

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
  md += `> **议题标题**: ${escapeTableCell(topic.title)}  \n`;
  md += `> **决议状态**: \`APPROVED & CONCLUDED (综合裁定官落槌敲定)\`  \n`;
  md += `> **终局裁定官**: **${escapeTableCell(ruling.arbiterName)}**  \n`;
  md += `> **敲定日期**: ${fullDateStr}  \n\n`;
  md += `---\n\n`;

  // 1. 🌟 大白话核心方案总览 (Executive Summary)
  md += `## 🌟 1. 大白话终局方案总览 (Executive Summary)\n\n`;
  md += `> 💡 **决策核心**: **${ruling.summary}**\n\n`;
  if (ruling.solution) {
    md += `**落地实施要旨**: ${ruling.solution}\n\n`;
  }

  // 2. 🤝 全员无异议确认签署链 (Unanimous Concurrence Sign-off)
  md += `## 🤝 2. 全员无异议共识签署 (Unanimous Concurrence Sign-off)\n\n`;
  if (concurrenceItems.length > 0) {
    md += `本决议在敲定前已由综合裁定官向参研关键角色发起专项审视征询，各角色独立复核签署记录如下：\n\n`;
    md += `| 签署角色 | 负责智能体 | 审查状态 | 无异议保证陈述与立场摘要 |\n`;
    md += `| :--- | :--- | :---: | :--- |\n`;

    concurrenceItems.forEach((item) => {
      const roleBadge = item.role === 'proposer'
        ? '🏛️ 提案主导'
        : item.role === 'challenger'
        ? '⚔️ 红队对抗'
        : item.role === 'verifier'
        ? '🔍 接地实证'
        : '⚖️ 综合裁定';
      const statusBadge = item.status === 'concurred'
        ? '✅ 无异议 (Concurred)'
        : item.status === 'objected'
        ? '❌ 存在异议 (Objected)'
        : item.status === 'unavailable'
        ? '⚠️ 角色不可用 (Unavailable)'
        : '⏳ 待复核 (Pending)';
      md += `| **${roleBadge}** | \`${escapeTableCell(item.agentName)}\` | **${statusBadge}** | ${escapeTableCell(item.statement)} |\n`;
    });
    md += `\n`;
  } else {
    md += `*本决议由仲裁裁决人法定定案，未附带前置全员无异议征询链。*\n\n`;
  }

  // 3. 业务背景与架构假定 (Context & Assumptions)
  md += `## 3. 业务背景与架构假定 (Context & Assumptions)\n\n`;
  md += `${topic.description || topic.title}\n\n`;
  if (topic.gameTheoreticState?.targetProposalContent) {
    md += `### 拟选方案立论 (Proposal v1)\n\n`;
    md += `${topic.gameTheoreticState.targetProposalContent.trim()}\n\n`;
  }

  const modularState = topic.gameTheoreticState?.modularState || topic.gameTheoreticState?.cognoNexus?.modularState;
  if (modularState?.enabled && modularState.modules.length > 0) {
    md += `### G-Frame 跨模块公共接口契约与原子模块分治\n\n`;
    if (modularState.sharedContract) {
      md += `- **公共接口契约**: ${modularState.sharedContract.summary}\n`;
      if (modularState.sharedContract.typeSignatures) {
        md += `\n\`\`\`typescript\n${modularState.sharedContract.typeSignatures}\n\`\`\`\n\n`;
      }
    }
    md += `| 模块 ID | 模块职责 | 路由通道 | 状态 | 允许文件白名单 |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    modularState.modules.forEach((m) => {
      md += `| \`${escapeTableCell(m.moduleId)}\` | ${escapeTableCell(m.title)} | \`${m.belief.routingMode}\` | **${m.status.toUpperCase()}** | ${m.allowedFiles.map((f) => `\`${escapeTableCell(f)}\``).join(', ')} |\n`;
    });
    md += `\n`;
  }

  const committedStates = topic.gameTheoreticState?.cognoNexus?.committedStates || [];
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

  // 4. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)
  md += `## 4. 证伪失效清单与红队边界压测 (Falsification & Edge Cases)\n\n`;
  if (topic.gameTheoreticState?.targetChallengeContent) {
    md += `${topic.gameTheoreticState.targetChallengeContent.trim()}\n\n`;
  } else if (topic.gameTheoreticState?.isChallengerBypassed) {
    md += `*⚡ 贝叶斯快速通道：低风险确定性模块依规约旁路红队对抗，直通契约与物理接地验证。*\n\n`;
  } else {
    md += `*未记录到独立红队质询内容。*\n\n`;
  }

  const dispute = topic.gameTheoreticState?.cognoNexus?.currentDispute;
  if (dispute) {
    md += `### 局部争议焦点定位 (LMAD Dispute)\n\n`;
    md += `- **焦点论题**: ${dispute.claimTopic}\n`;
    md += `- **根因归结**: ${dispute.rootCause}\n\n`;
  }

  // 5. 接地实证与验证结论 (Empirical Verification)
  md += `## 5. 接地实证与验证结论 (Empirical Verification)\n\n`;
  if (topic.gameTheoreticState?.targetVerificationContent) {
    md += `${topic.gameTheoreticState.targetVerificationContent.trim()}\n\n`;
  }
  const evidences = topic.gameTheoreticState?.cognoNexus?.currentDispute?.evidenceChain || [];
  if (evidences.length > 0) {
    md += `| 证据编号 | 工具/沙箱 | 真值判定 | 实证审查报告 |\n`;
    md += `| :--- | :--- | :---: | :--- |\n`;
    evidences.forEach((ev) => {
      const statusIcon = ev.truthValue ? '✓ PASS' : '✗ FAIL';
      md += `| ${escapeTableCell(ev.evidenceId)} | \`${escapeTableCell(ev.sourceTool)}\` | **${statusIcon}** | ${escapeTableCell(ev.verifierReport)} |\n`;
    });
    md += `\n`;
  } else if (!topic.gameTheoreticState?.targetVerificationContent) {
    md += `*未记录独立接地实证链。*\n\n`;
  }

  // 6. 架构权衡矩阵与工程防线 (Trade-off Matrix & Invariants)
  md += `## 6. 架构权衡矩阵与工程防线 (Trade-off Matrix & Invariants)\n\n`;
  md += `裁定类型: **${decisionTypeLabel}**\n\n`;
  if (ruling.tradeOffPoints && ruling.tradeOffPoints.length > 0) {
    md += `### 核心权衡折中取舍\n\n`;
    ruling.tradeOffPoints.forEach((pt, i) => {
      md += `${i + 1}. **${pt}**\n`;
    });
    md += `\n`;
  }

  const mcda = ruling.mcdaPayload || topic.gameTheoreticState?.mcdaPayload;
  if (mcda?.computedWeights && mcda?.criteria) {
    md += `### MCDA 运筹最优最劣法 (BWM) 数学权衡参考\n\n`;
    md += `一致性指标 $\\xi^* = ${mcda.consistencyIndex}$ (${mcda.consistencyPassed ? '通过 (<= 0.12)' : '未通过 (> 0.12)'})\n\n`;
    mcda.criteria.forEach((c) => {
      const w = ((mcda.computedWeights[c.id] || 0) * 100).toFixed(1);
      md += `- **${c.name}**: ${w}%\n`;
    });
    md += `\n`;
  }

  // 7. 少数派异议备案 (Minority Dissent & Black Swan Triggers)
  const minority = ruling.minorityReport || topic.gameTheoreticState?.minorityReport;
  if (minority) {
    md += `## 7. 伴生少数派异议备案 (Minority Dissent & Black Swan Triggers)\n\n`;
    md += `- **异议代表**: ${minority.dissentingAgentName}\n`;
    md += `- **核心异议**: ${minority.coreDissentThesis}\n`;
    md += `- **自洽推演逻辑**: ${minority.rationalityBasis}\n`;
    if (minority.reopeningTriggers && minority.reopeningTriggers.length > 0) {
      md += `- **黑天鹅重启触发器**:\n`;
      minority.reopeningTriggers.forEach((t) => {
        md += `  • ${t}\n`;
      });
    }
    md += `\n`;
  }

  // 8. 限定安全爆炸半径 (Bounded Impact Radius)
  md += `## 8. 限定安全爆炸半径 (Bounded Impact Radius)\n\n`;
  if (ruling.impactedFiles && ruling.impactedFiles.length > 0) {
    md += `本次决议严格约束变更范围，执行 Agent 严禁越界修改以下白名单之外的文件：\n\n`;
    ruling.impactedFiles.forEach((f) => {
      md += `- \`${escapeTableCell(f)}\`\n`;
    });
    md += `\n`;
  } else {
    md += `*未声明特定白名单文件，遵循模块拓扑接口契约限制。*\n\n`;
  }

  // 9. 落地执行与工程交付清单 (Actionable Checklist)
  md += `## 9. 落地执行与工程交付清单 (Actionable Checklist)\n\n`;
  const executorName = getAgentName(ruling.executorId) || '待人工批准指派';
  md += `- [ ] **主导实施负责人**: \`${escapeTableCell(executorName)}\`\n`;
  md += `- [ ] **核心补丁实现**: 按照《落地实施要旨》编写工程代码补丁\n`;
  md += `- [ ] **红队边界回归**: 确保红队对抗中指出的失效工况有单测覆盖\n`;
  md += `- [ ] **工作区审查与合入**: 通过基线校验与人工确认后正式落盘\n\n`;

  md += `---\n*本看板由 Shadow Crew CognoNexus 博弈论引擎根据全员无异议共识自动生成并固化。*`;

  return md;
}
