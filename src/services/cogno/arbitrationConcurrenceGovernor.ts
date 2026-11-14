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
  RoleConcurrenceSubmission,
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

function buildConcurrenceSolutionCanonicalPayload(options: {
  topic: TopicMessageData;
  arbiterDraft?: ArbitrationRulingDraft;
  arbiterReplyText: string;
}): string {
  const { topic, arbiterDraft, arbiterReplyText } = options;
  return JSON.stringify({
    protocolVersion: 1,
    topicId: topic.id,
    title: topic.title,
    description: topic.description || '',
    decisionType: arbiterDraft?.decisionType || 'trade_off_matrix',
    summary: arbiterDraft?.summary || arbiterReplyText.slice(0, 200).trim(),
    solution: arbiterDraft?.solution || '采纳裁决方案中明确的架构权衡防线与补丁，由落地责任人按代码爆炸半径约束合入工作区。',
    tradeOffPoints: arbiterDraft?.tradeOffPoints || [],
    impactedFiles: arbiterDraft?.impactedFiles || [],
    proposal: topic.gameTheoreticState?.targetProposalContent || '',
    challenge: topic.gameTheoreticState?.targetChallengeContent || '',
    verification: topic.gameTheoreticState?.targetVerificationContent || '',
    defense: topic.gameTheoreticState?.targetDefenseContent || '',
  });
}

/**
 * 对终局方案生成不可变内容摘要。所有角色票必须绑定同一摘要，避免旧方案同意票被复用于新方案。
 */
export async function computeRoleConcurrenceSolutionDigest(options: {
  topic: TopicMessageData;
  arbiterDraft?: ArbitrationRulingDraft;
  arbiterReplyText: string;
}): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('当前运行环境不支持 WebCrypto SHA-256，无法建立角色票与终局方案的绑定');
  }
  const canonical = buildConcurrenceSolutionCanonicalPayload(options);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textContainsExactMention(text: string, handle: string): boolean {
  const escaped = escapeRegExp(handle);
  return new RegExp(
    `(^|[^a-zA-Z0-9_@-])${escaped}(?=$|[^a-zA-Z0-9_-])`,
    'i'
  ).test(text);
}

function textContainsAgentMention(text: string, agent: Agent, handle: string): boolean {
  if (textContainsExactMention(text, handle)) return true;
  // 兼容量产场景中，模型可能使用 @AgentName 进行点名
  if (agent.name && agent.name.trim()) {
    const nameHandle = normalizeMentionHandle({ ...agent, handle: agent.name.trim() });
    if (textContainsExactMention(text, nameHandle)) return true;
  }
  return false;
}

/**
 * 宿主校验综合裁定官实际正文是否逐一 @ 了全部应参研角色。
 * Prompt 要求并不足以形成输出契约：缺失任一真实 mention 必须阻断征询。
 */
export function validateArbiterConcurrenceMentions(options: {
  arbiterReplyText: string;
  expectedAgents: Agent[];
  arbiterAgentId?: string;
}): { isValid: boolean; missingHandles: string[] } {
  const { arbiterReplyText, expectedAgents, arbiterAgentId } = options;
  const targetAgents = arbiterAgentId
    ? expectedAgents.filter((agent) => agent.id !== arbiterAgentId)
    : expectedAgents;

  const uniqueAgents = Array.from(
    new Map(targetAgents.map((agent) => [agent.id, agent])).values()
  );
  const missingHandles = uniqueAgents
    .map((agent) => ({ agent, handle: normalizeMentionHandle(agent) }))
    .filter(({ agent, handle }) => !textContainsAgentMention(arbiterReplyText, agent, handle))
    .map(({ handle }) => handle);

  return {
    isValid: uniqueAgents.length === 0 || missingHandles.length === 0,
    missingHandles,
  };
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
  const { topic, availableAgents, arbiterAgent, verificationSection = '', defenseSection = '' } = options;

  // 提取需要被 @ 征求意见的角色智能体（排除裁定官自身，裁定官起草终局方案无需在正文中 @ 自身）
  const proposerIds = topic.gameRoles?.proposers || [];
  const challengerIds = topic.gameRoles?.challengers || [];
  const verifierIds = topic.gameRoles?.verifiers || [];

  const proposers = availableAgents.filter((a) => proposerIds.includes(a.id) && a.id !== arbiterAgent.id);
  const challengers = availableAgents.filter((a) => challengerIds.includes(a.id) && a.id !== arbiterAgent.id);
  const verifiers = availableAgents.filter((a) => verifierIds.includes(a.id) && a.id !== arbiterAgent.id);

  const mentionHandles = [
    ...proposers.map(normalizeMentionHandle),
    ...challengers.map(normalizeMentionHandle),
    ...verifiers.map(normalizeMentionHandle),
  ];

  const mentionDirectives = mentionHandles.length > 0
    ? mentionHandles.join(' ')
    : '@红队对抗方 @实证检验方';

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
5. 【结构化裁决书交付 (强制工具契约优先)】：
   - 【首选执行（强制优先）】：直接调用宿主 MCP 工具 \`submit_arbitration_ruling\`。
     传入参数：\`decision_type\`、\`summary\`、\`trade_off_points\`、\`impacted_files\`、\`solution\`。
     同时强烈建议在 arguments 中传入可选的 \`ruling_options\` 对象（包含 \`adopt_proposer\`、\`reject_rebuild\`、\`trade_off_matrix\` 3 种模式预案），以便人类在法槌控制台中实时无缝审阅与切换模式。
   - 【容灾备选（仅限无工具环境）】：若当前环境未挂载或无法调用工具，请在回复末尾附带紧凑裁决块：
<<<RULING_DRAFT_OPTIONS>>>
{
  "adopt_proposer": { "decision_type": "adopt_proposer", "summary": "采纳依据与总览", "trade_off_points": ["核心权衡"], "impacted_files": ["src/..."], "solution": "实施防线" },
  "reject_rebuild": { "decision_type": "reject_rebuild", "summary": "驳回重构依据", "trade_off_points": ["安全红线"], "impacted_files": ["src/..."], "solution": "重构指引" },
  "trade_off_matrix": { "decision_type": "trade_off_matrix", "summary": "折中定案依据", "trade_off_points": ["分期权衡"], "impacted_files": ["src/..."], "solution": "分阶段演进路径" },
  "recommended_type": "trade_off_matrix"
}
<<<RULING_DRAFT_OPTIONS_END>>>
（亦兼容仅输出单项 <<<RULING_DRAFT>>> { ... } <<<RULING_DRAFT_END>>>）

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
  solutionDigest: string;
  topicTitle: string;
  topicDescription?: string;
  validationError?: string;
}): string {
  const {
    roleAgent,
    roleName,
    arbiterName,
    arbiterText,
    solutionDigest,
    topicTitle,
    topicDescription,
    validationError,
  } = options;

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
【终局方案摘要 solution_digest】: ${solutionDigest}

综合裁定官已对本议题提出终局架构裁定方案并正式 @ 征询你的无异议意见。
【裁定官提议摘要】:
${arbiterText.slice(0, 800)}

【强制结构化投票契约】:
1. 你必须基于前序推演事实、反例攻击与防御补丁独立判断，不得仅复述裁定官结论；
2. 【契约直通优先】你必须优先调用 MCP 工具 \`submit_role_concurrence\`；
3. 【容灾文本双保】无论是否成功调用工具，都必须在回复末尾追加且只追加一个如下 ROLE_CONCURRENCE 契约块；
4. 自然语言正文只解释判断，绝不能替代结构化票；
5. status 语义：
   - \`concurred\`：当前方案无任何阻塞项与前置条件，允许立即敲定；
   - \`conditional\`：方向可接受，但仍需补测、暂缓上线、补充边界条件或等待验证；
   - \`objected\`：存在必须修改的阻断性异议；
   - \`unavailable\`：你因能力、信息或运行环境限制无法完成判断；
6. status=concurred 时，blocking_issue_ids 与 conditions 必须都为空数组；
7. solution_digest 必须逐字使用上方摘要，禁止自行修改或重新生成；
8. agent_id、role 必须使用当前角色的真实值，禁止代投其他角色；
9. 下方示例中的 status 占位符必须替换为你的真实判断，直接复制占位符会被宿主判为无效票。

<<<ROLE_CONCURRENCE>>>
{
  "protocol_version": 1,
  "agent_id": "${roleAgent.id}",
  "role": "${roleName}",
  "solution_digest": "${solutionDigest}",
  "status": "__REPLACE_WITH_YOUR_JUDGMENT__",
  "blocking_issue_ids": [],
  "conditions": [],
  "rationale": "说明你的核验依据与最终判断",
  "evidence_refs": []
}
<<<ROLE_CONCURRENCE_END>>>
${validationError ? `\n【上一次结构化票无效，必须修正】:\n${validationError}\n只允许通过合法工具载荷与 ROLE_CONCURRENCE 契约块重新提交，禁止仅用自然语言回答。` : ''}`;
}

/**
 * 格式化当前全员无异议征询投票状态与活跃阻断条件汇总。
 */
export function formatConcurrenceBlockingSummary(
  concurrenceState: GameRoleConcurrenceState
): string {
  const items = concurrenceState.items || [];
  const concurredCount = items.filter((item) => item.status === 'concurred').length;
  const totalCount = items.length;

  const roleLabels: Record<RoleConcurrenceItem['role'], string> = {
    proposer: '提案主导方 (proposer)',
    challenger: '红队对抗方 (challenger)',
    verifier: '接地实证方 (verifier)',
    arbiter: '综合裁定官 (arbiter)',
  };

  const statusLabels: Record<RoleConcurrenceItem['status'], string> = {
    concurred: '✅ concurred（无异议）',
    conditional: '⏸️ conditional（条件保留）',
    objected: '❌ objected（阻断性异议）',
    pending: '⏳ pending（待审视回复）',
    invalid: '⛔ invalid（结构化票无效）',
    unavailable: '⚠️ unavailable（角色离线/不可用）',
  };

  const activeBlockingConditions: string[] = [];
  const activeObjections: string[] = [];

  const roleLines = items.map((item) => {
    const roleLabel = roleLabels[item.role] || item.role;
    const statusLabel = statusLabels[item.status] || item.status;
    const handlePart = item.agentHandle ? ` (${item.agentHandle})` : '';
    const detailParts: string[] = [];

    if (item.conditions && item.conditions.length > 0) {
      detailParts.push(`前置条件 (conditions): ${item.conditions.join('；')}`);
      item.conditions.forEach((cond) => {
        activeBlockingConditions.push(`[${item.agentName} · ${item.role}] ${cond}`);
      });
    }
    if (item.blockingIssueIds && item.blockingIssueIds.length > 0) {
      detailParts.push(`阻断项 ID (blocking_issue_ids): ${item.blockingIssueIds.join(', ')}`);
      item.blockingIssueIds.forEach((issueId) => {
        activeObjections.push(`[${item.agentName} · ${item.role}] ${issueId}`);
      });
    }
    if (item.validationError) {
      detailParts.push(`票据校验错误: ${item.validationError}`);
      activeObjections.push(`[${item.agentName} · ${item.role}] 校验失败: ${item.validationError}`);
    }
    if (item.statement && item.statement.trim()) {
      detailParts.push(`陈词依据: ${item.statement.trim()}`);
      if (item.status === 'objected' && (!item.blockingIssueIds || item.blockingIssueIds.length === 0)) {
        activeObjections.push(`[${item.agentName} · ${item.role}] ${item.statement.trim()}`);
      }
    }
    if (item.status === 'pending') {
      activeBlockingConditions.push(`[${item.agentName} · ${item.role}] 尚未提交结构化无异议票 (pending)`);
    } else if (item.status === 'unavailable') {
      activeObjections.push(`[${item.agentName} · ${item.role}] 角色离线或不可用 (${item.statement || 'unavailable'})`);
    }

    const detailSuffix = detailParts.length > 0 ? `\n    - ${detailParts.join('\n    - ')}` : '';
    return `- **${roleLabel}** · ${item.agentName}${handlePart}：\`${item.status}\` (${statusLabel})${detailSuffix}`;
  });

  const lines: string[] = [
    `• **当前无异议进展**：${concurredCount}/${totalCount} 角色已确认无异议（allConcurred=${concurrenceState.allConcurred}）`,
    `• **锁定方案摘要 (solution_digest)**：\`${concurrenceState.solutionDigest}\``,
  ];
  if (concurrenceState.arbiterProposalSummary) {
    lines.push(`• **当前待签裁决摘要**：${concurrenceState.arbiterProposalSummary}`);
  }
  if (roleLines.length > 0) {
    lines.push('• **各参研角色投票明细**：');
    lines.push(...roleLines);
  } else {
    lines.push('• **各参研角色投票明细**：（暂无参研角色记录）');
  }

  if (activeBlockingConditions.length > 0) {
    lines.push('• **当前活跃前置条件 / 阻塞项 (Active Blocking Conditions)**：');
    activeBlockingConditions.forEach((entry, idx) => {
      lines.push(`  ${idx + 1}. ${entry}`);
    });
  }
  if (activeObjections.length > 0) {
    lines.push('• **当前阻断性异议 / 异常 (Active Objections & Blockers)**：');
    activeObjections.forEach((entry, idx) => {
      lines.push(`  ${idx + 1}. ${entry}`);
    });
  }
  if (activeBlockingConditions.length === 0 && activeObjections.length === 0) {
    lines.push('• **阻塞状态**：当前无活跃阻塞条件，全部参研角色均已确认无异议。');
  }

  return lines.join('\n');
}

/**
 * 在终局无异议征询处于活跃阻塞状态时，为综合裁定官构造状态答疑守则，
 * 防止其在人类询问进展（如 `@all 到哪步了？`）时盲目重跑阶段 5 仲裁与重复重询。
 */
export function buildArbiterBlockedConcurrenceInquiryDirective(
  concurrenceState: GameRoleConcurrenceState
): string {
  const blockingSummary = formatConcurrenceBlockingSummary(concurrenceState);

  return `\n\n【博弈编排 - ⚖️ 阶段 5 阻塞答疑与状态说明守则 (Active Blocked Concurrence Inquiry)】:
当前议题已进入终局全员无异议征询阶段（\`isConcurrencePhaseActive=true\` 且 \`allConcurred=false\`），终局定案目前被未满足的条件/异议阻塞挂起。

【当前全员无异议阻塞实况（系统实时状态）】：
${blockingSummary}

【综合裁定官响应铁律（必须严格执行）】：
1. **【默认模式 · 仅解释当前进展与阻塞条件】**：若本轮人类/上下文只是在询问进度、卡点原因（如“到哪步了？”“为什么还没定案？”），或并不存在**实质性修改后的新裁决/解决方案**：
   - 你**只能**基于上方实时状态，清晰、简洁地向用户解释当前卡在哪个环节、各参研角色当前的投票结果（\`conditional\` / \`objected\` / \`pending\` / \`invalid\` / \`unavailable\`）、具体前置阻塞条件或异议细节，以及解除阻塞需要满足的条件；
   - **严禁**重跑完整的阶段 5 综合仲裁流程；
   - **严禁**调用 \`submit_arbitration_ruling\` 工具，也**严禁**输出 \`<<<RULING_DRAFT>>>\` 或 \`<<<RULING_DRAFT_OPTIONS>>>\` 结构化裁决块；
   - **严禁**在正文中用 \`@handle\` 点名各参研角色要求重新投票（如需提及成员，请直接写纯姓名，勿加 \`@\` 符号）。
2. **【例外条件 · 仅当存在实质性新方案时才重开征询】**：只有在人类明确要求修订原裁决、或已有新的代码补丁/实证结论实质性推翻或更新了裁决方案本身时，才可提交修改后的新裁决并重新发起全员无异议征询。`;
}

/**
 * 判断是否应跳过冗余的仲裁无异议重询，避免在原方案摘要未变且无显式新裁决契约时清空现有投票记录。
 */
export function shouldSkipRedundantArbitrationConcurrence(options: {
  existingConcurrenceState?: GameRoleConcurrenceState;
  nextSolutionDigest: string;
  hasExplicitNewRulingContract: boolean;
}): { skip: boolean; reason?: string } {
  const { existingConcurrenceState, nextSolutionDigest, hasExplicitNewRulingContract } = options;

  if (
    existingConcurrenceState?.isConcurrencePhaseActive &&
    !existingConcurrenceState.allConcurred &&
    !hasExplicitNewRulingContract &&
    existingConcurrenceState.solutionDigest === nextSolutionDigest
  ) {
    return {
      skip: true,
      reason: '当前终局裁决方案摘要未发生变化且未提交新的结构化裁决契约，保留既有投票状态与阻塞条件，跳过冗余无异议重询。',
    };
  }

  return { skip: false };
}

function normalizeArbitrationToolName(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  const trimmed = rawName.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('mcp__')) {
    const rest = trimmed.slice('mcp__'.length);
    const sepIdx = rest.indexOf('__');
    return sepIdx > 0 ? rest.slice(sepIdx + 2).trim() : trimmed;
  }
  if (trimmed.startsWith('mcp.')) {
    const rest = trimmed.slice('mcp.'.length);
    const sepIdx = rest.indexOf('.');
    return sepIdx > 0 ? rest.slice(sepIdx + 1).trim() : trimmed;
  }
  if (trimmed.startsWith('Tool:')) {
    const afterPrefix = trimmed.slice('Tool:'.length).trim();
    const slashIdx = afterPrefix.indexOf('/');
    return slashIdx > 0 ? afterPrefix.slice(slashIdx + 1).trim() : afterPrefix;
  }
  return trimmed;
}

function isSubmitArbitrationRulingToolCall(call: any): boolean {
  if (!call || typeof call !== 'object') return false;
  const status = typeof call.status === 'string' ? call.status.trim().toLowerCase() : '';
  if (status === 'failed' || status === 'error') {
    return false;
  }
  const candidates = [
    call.tool_name,
    call.tool,
    call.name,
    call.title,
    call._meta?.claudeCode?.toolName,
    call.rawInput?.tool,
    call.rawInput?.tool_name,
    call.rawInput?.name,
  ];
  return candidates.some(
    (candidate) => normalizeArbitrationToolName(candidate) === 'submit_arbitration_ruling'
  );
}

/**
 * 判断裁定官本轮 ACP 响应是否显式提交了新的结构化裁决契约
 * （来源包括 `acpResp.rulingDraft`、`<<<RULING_DRAFT` 文本标记或 `submit_arbitration_ruling` 工具调用）。
 */
export function hasExplicitArbitrationRulingContract(acpResp: {
  rulingDraft?: ArbitrationRulingDraft;
  textResponse?: string;
  mcpToolCalls?: any[];
  raw?: any;
}): boolean {
  if (!acpResp || typeof acpResp !== 'object') {
    return false;
  }
  if (acpResp.rulingDraft) {
    return true;
  }

  const rawCalls = [
    ...(Array.isArray(acpResp.raw?.mcp_tool_calls) ? acpResp.raw.mcp_tool_calls : []),
    ...(Array.isArray(acpResp.raw?.result?.mcp_tool_calls) ? acpResp.raw.result.mcp_tool_calls : []),
    ...(Array.isArray(acpResp.mcpToolCalls) ? acpResp.mcpToolCalls : []),
  ];
  if (rawCalls.some(isSubmitArbitrationRulingToolCall)) {
    return true;
  }

  const text = acpResp.textResponse || '';
  if (
    /<<<RULING_DRAFT/i.test(text) ||
    /```(?:json)?\s*\{\s*"decision_?type"[\s\S]*?\}\s*```/i.test(text)
  ) {
    return true;
  }

  return false;
}

/**
 * 统一评估是否命中冗余无异议征询跳过门禁：
 * 当本轮无显式新裁决契约时，复用议题既有 `rulingDraft` 计算 `nextSolutionDigest`，
 * 确保答疑回复不会破坏摘要一致性，同时方案内容实质变更时能够正常重开征询。
 */
export async function evaluateArbitrationConcurrenceSkip(options: {
  topic: TopicMessageData;
  acpResp: {
    rulingDraft?: ArbitrationRulingDraft;
    textResponse?: string;
    mcpToolCalls?: any[];
    raw?: any;
  };
  fallbackDraft?: ArbitrationRulingDraft;
}): Promise<{
  hasExplicitNewRulingContract: boolean;
  nextSolutionDigest: string;
  skip: boolean;
  reason?: string;
}> {
  const { topic, acpResp, fallbackDraft } = options;
  const hasExplicitNewRulingContract = hasExplicitArbitrationRulingContract(acpResp);
  const existingConcurrenceState = topic.gameTheoreticState?.concurrenceState;
  const existingRulingDraft = topic.gameTheoreticState?.rulingDraft;

  const draftForDigest = !hasExplicitNewRulingContract
    ? existingRulingDraft ?? fallbackDraft
    : acpResp.rulingDraft ?? fallbackDraft;

  const nextSolutionDigest = await computeRoleConcurrenceSolutionDigest({
    topic,
    arbiterDraft: draftForDigest,
    arbiterReplyText: acpResp.textResponse || '',
  });

  const skipResult = shouldSkipRedundantArbitrationConcurrence({
    existingConcurrenceState,
    nextSolutionDigest,
    hasExplicitNewRulingContract,
  });

  return {
    hasExplicitNewRulingContract,
    nextSolutionDigest,
    skip: skipResult.skip,
    reason: skipResult.reason,
  };
}

/**
 * 检查当前所有参研角色是否均已保证回复无异议
 */
export function checkAllRolesConcurred(concurrenceState?: GameRoleConcurrenceState): boolean {
  if (
    !concurrenceState ||
    concurrenceState.protocolVersion !== 1 ||
    !concurrenceState.solutionDigest ||
    !concurrenceState.items ||
    concurrenceState.items.length === 0
  ) {
    return false;
  }

  const uniqueAgentIds = new Set(concurrenceState.items.map((item) => item.agentId));
  if (uniqueAgentIds.size !== concurrenceState.items.length) {
    return false;
  }

  return concurrenceState.items.every((item) =>
    item.status === 'concurred' &&
    item.solutionDigest === concurrenceState.solutionDigest &&
    item.decisionSource !== undefined &&
    (item.blockingIssueIds || []).length === 0 &&
    (item.conditions || []).length === 0
  );
}

/**
 * 初始化参研角色的全员无异议征询状态
 */
export function prepareConcurrenceState(options: {
  topic: TopicMessageData;
  candidateAgents: Agent[];
  arbiterDraft?: ArbitrationRulingDraft;
  arbiterReplyText?: string;
  solutionDigest: string;
  arbiterAgentId?: string;
}): GameRoleConcurrenceState {
  const {
    topic,
    candidateAgents,
    arbiterDraft,
    arbiterReplyText = '',
    solutionDigest,
    arbiterAgentId,
  } = options;
  const gameRoles = topic.gameRoles;
  if (!/^sha256:[a-f0-9]{64}$/i.test(solutionDigest)) {
    throw new Error('[prepareConcurrenceState] 缺少合法的终局方案摘要 solutionDigest');
  }

  const effectiveArbiterId = arbiterAgentId || gameRoles?.arbiters?.[0];

  const proposerIds = gameRoles?.proposers || [];
  const challengerIds = gameRoles?.challengers || [];
  const verifierIds = gameRoles?.verifiers || [];

  const items: RoleConcurrenceItem[] = [];

  const addRoleItem = (agentId: string, role: 'proposer' | 'challenger' | 'verifier') => {
    const agent = candidateAgents.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`[prepareConcurrenceState] 找不到已配置参研角色 Agent: ${agentId}`);
    }
    if (items.some((i) => i.agentId === agent.id)) return;

    // 如果该参研角色恰好是综合裁定官自身（兼任），裁决书即为其立场的法定表达，内在默认达成无异议
    const isArbiterSelf = Boolean(effectiveArbiterId && agent.id === effectiveArbiterId);
    items.push({
      agentId: agent.id,
      agentName: agent.name,
      agentHandle: normalizeMentionHandle(agent),
      role,
      status: isArbiterSelf ? 'concurred' : 'pending',
      solutionDigest: isArbiterSelf ? solutionDigest : undefined,
      decisionSource: isArbiterSelf ? 'arbiter_intrinsic' : undefined,
      statement: isArbiterSelf
        ? '综合裁定官兼任本角色并已起草发布终局裁决书，内在默认达成无异议'
        : undefined,
      blockingIssueIds: isArbiterSelf ? [] : undefined,
      conditions: isArbiterSelf ? [] : undefined,
    });
  };

  proposerIds.forEach((id) => addRoleItem(id, 'proposer'));
  challengerIds.forEach((id) => addRoleItem(id, 'challenger'));
  verifierIds.forEach((id) => addRoleItem(id, 'verifier'));

  // 待校验的 @mention 角色仅包含除裁定官自身外的其他参研角色
  const peerAgents = items
    .filter((item) => !effectiveArbiterId || item.agentId !== effectiveArbiterId)
    .map((item) => candidateAgents.find((agent) => agent.id === item.agentId))
    .filter((agent): agent is Agent => Boolean(agent));

  if (peerAgents.length > 0) {
    const mentionValidation = validateArbiterConcurrenceMentions({
      arbiterReplyText,
      expectedAgents: peerAgents,
      arbiterAgentId: effectiveArbiterId,
    });
    if (!mentionValidation.isValid) {
      throw new Error(
        `[prepareConcurrenceState] 综合裁定官正文未逐一 @ 全部参研角色；缺失: ${mentionValidation.missingHandles.join(', ')}`
      );
    }
  }

  const proposalSummary = arbiterDraft?.summary || arbiterReplyText.slice(0, 200).trim() || topic.title;

  return {
    protocolVersion: 1,
    solutionDigest,
    isConcurrencePhaseActive: items.length > 0,
    arbiterProposalSummary: proposalSummary,
    items,
    allConcurred: checkAllRolesConcurred({
      protocolVersion: 1,
      solutionDigest,
      isConcurrencePhaseActive: items.length > 0,
      arbiterProposalSummary: proposalSummary,
      items,
      allConcurred: false,
    }),
  };
}

/**
 * 推进单个角色的无异议回复记录并更新全员状态
 */
export function advanceRoleConcurrenceItem(
  currentState: GameRoleConcurrenceState,
  agentId: string,
  result: {
    submission?: RoleConcurrenceSubmission;
    validationError?: string;
    unavailableReason?: string;
  }
): GameRoleConcurrenceState {
  const nowStr = formatFullDateTime();
  const targetItem = currentState.items.find((item) => item.agentId === agentId);
  if (!targetItem) {
    throw new Error(`[advanceRoleConcurrenceItem] 未找到参研角色: ${agentId}`);
  }

  let status: RoleConcurrenceItem['status'];
  let statement: string;
  let validationError: string | undefined;
  const submission = result.submission;

  if (result.unavailableReason) {
    status = 'unavailable';
    statement = result.unavailableReason;
  } else if (!submission) {
    status = 'invalid';
    validationError = result.validationError || '未提交合法的结构化无异议票';
    statement = validationError;
  } else if (
    submission.protocolVersion !== currentState.protocolVersion ||
    submission.agentId !== targetItem.agentId ||
    submission.role !== targetItem.role
  ) {
    status = 'invalid';
    validationError = '选票 protocolVersion、agentId 或 role 与当前参研角色不匹配';
    statement = validationError;
  } else if (submission.solutionDigest !== currentState.solutionDigest) {
    status = 'invalid';
    validationError = '选票 solution_digest 与当前终局方案摘要不匹配';
    statement = validationError;
  } else if (
    submission.status === 'concurred' &&
    (submission.blockingIssueIds.length > 0 || submission.conditions.length > 0)
  ) {
    status = 'invalid';
    validationError = 'status=concurred 不允许携带阻塞项或前置条件';
    statement = validationError;
  } else if (submission.status === 'conditional' && submission.conditions.length === 0) {
    status = 'invalid';
    validationError = 'status=conditional 必须至少提供一项前置条件';
    statement = validationError;
  } else if (submission.status === 'objected' && submission.blockingIssueIds.length === 0) {
    status = 'invalid';
    validationError = 'status=objected 必须至少提供一个阻塞项 ID';
    statement = validationError;
  } else {
    status = submission.status;
    statement = submission.rationale;
  }

  const updatedItems = currentState.items.map((item) => {
    if (item.agentId === agentId) {
      if (status === 'invalid' || status === 'unavailable') {
        return {
          ...item,
          status,
          statement,
          timestamp: nowStr,
          solutionDigest: undefined,
          blockingIssueIds: [],
          conditions: [],
          evidenceRefs: [],
          decisionSource: undefined,
          validationError,
        };
      }
      return {
        ...item,
        status,
        statement,
        timestamp: nowStr,
        solutionDigest: submission!.solutionDigest,
        blockingIssueIds: [...submission!.blockingIssueIds],
        conditions: [...submission!.conditions],
        evidenceRefs: [...submission!.evidenceRefs],
        decisionSource: submission!.source,
        validationError: undefined,
      };
    }
    return item;
  });

  const updatedState: GameRoleConcurrenceState = {
    ...currentState,
    items: updatedItems,
  };
  const allConcurred = checkAllRolesConcurred(updatedState);

  return {
    ...updatedState,
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
  const summary = extractedDraft?.summary || concurrenceState.arbiterProposalSummary || `综合裁定官已统筹各方攻防意见敲定终局方案，全员无异议签署通过。围绕“${topic.title}”准予落地交付。`;
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
      status: 'concurred' as const,
      conditions: [],
      blockingIssueIds: [],
      decisionSource: item.decisionSource,
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
      solutionDigest: concurrenceState.solutionDigest,
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
        : item.status === 'conditional'
        ? '⏸️ 条件保留 (Conditional)'
        : item.status === 'objected'
        ? '❌ 存在异议 (Objected)'
        : item.status === 'unavailable'
        ? '⚠️ 角色不可用 (Unavailable)'
        : item.status === 'invalid'
        ? '⛔ 结构化票无效 (Invalid)'
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
