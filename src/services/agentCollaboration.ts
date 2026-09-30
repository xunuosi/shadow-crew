import { 
  Agent, 
  DiscussionMode, 
  GameRolesConfig, 
  GameRoleType, 
  GameTheoreticStage,
  McdaCriterion,
  McdaDecisionPayload,
  MinorityReport,
  SprtGovernorState,
  DisputeSpanPacket,
  ArgumentNode,
  GroundingEvidence,
  SycophancyEvaluation,
  ModelDiversityEvaluation,
} from '../types';
import {
  solveDeterministicBwm,
  solveExactBwmOptionB,
  stepSprtGovernor,
  fitSprtCalibrationParams,
  estimateRoundAlignmentScore,
  compileMinorityReport,
  extractArgumentNodes,
  localizeEarliestDispute,
  dehydrateContextToCommittedStates,
  dehydrateContextWithAlert,
  logGameTheoreticTelemetry,
  getMetricBaselineSummary,
  getMetricBaselineReport,
  validateStageContract,
  STAGE_CONTRACT_MAX_RETRIES,
  tieredGroundingGovernor,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  generateDynamicRulingDraft,
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
  detectModelFamily,
  calculateModelDiversity,
  calculateConfidenceMatrix,
} from './cogno';

export interface CollaborationCascade {
  cascadeId: string;
  rootMessageId: string;
  roomId: string;
  originalPrompt: string;
  depth: number; // 1 表示首位响应者，2 表示第二跳响应者，依此类推
  maxDepth: number; // 安全兜底跳数限制 (默认为 12)
  visitedAgentIds: string[];
  agentCallCounts: Record<string, number>;
  isAborted: boolean;
  terminationReason?: 'max_depth_reached' | 'loop_detected' | 'user_abort' | 'none';
}

/**
 * 从文本中提取所有被 @ 提到的有效 Agent
 * 自动排除发言者自己，且仅识别当前频道/工作区已准入的 Agent
 */
export function parseAgentMentions(
  content: string,
  availableAgents: Agent[],
  currentAgentId?: string
): Agent[] {
  if (!content || !availableAgents || availableAgents.length === 0) {
    return [];
  }

  const mentions: Agent[] = [];
  const lowerContent = content.toLowerCase();

  // 若存在 @all，将当前工作区除自己外的全部 Agent 纳入
  if (lowerContent.includes('@all') || lowerContent.includes('@所有人') || lowerContent.includes('@team')) {
    return availableAgents.filter((a) => a.id !== currentAgentId);
  }

  // 规范化纯字母数字内容，用于模糊/忽略连字符与大小写匹配 (例如 @MyClaudeCode vs @claude-code)
  const alphaContent = lowerContent.replace(/[^a-z0-9@]/g, '');

  for (const agent of availableAgents) {
    if (currentAgentId && agent.id === currentAgentId) {
      continue;
    }

    const handle = agent.handle.toLowerCase();
    const name = agent.name.toLowerCase();
    const cleanHandle = handle.replace(/^@/, '');
    const alphaHandle = cleanHandle.replace(/[^a-z0-9]/g, '');
    const alphaName = name.replace(/[^a-z0-9]/g, '');

    // 匹配模式：
    // 1. 显式 @handle (如 @shinobi-core, @openclaw-mantis)
    // 2. 显式 @name (如 @Shinobi Core, @MyClaudeCode)
    // 3. 规范化模糊匹配 (如 @myclaudecode 匹配 MyClaudeCode 或 claude-code)
    const hasHandle = handle && lowerContent.includes(handle);
    const hasAtName = name && lowerContent.includes(`@${name}`);
    const hasAlphaHandle = alphaHandle && alphaContent.includes(`@${alphaHandle}`);
    const hasAlphaName = alphaName && alphaContent.includes(`@${alphaName}`);

    if (hasHandle || hasAtName || hasAlphaHandle || hasAlphaName) {
      if (!mentions.some((m) => m.id === agent.id)) {
        mentions.push(agent);
      }
    }
  }

  return mentions;
}

export interface LoopGuardResult {
  allowed: boolean;
  reason?: string;
  isSilentEnd?: boolean;
}

/**
 * 协同防护检查 (对标 Buzz 静默收敛哲学)：
 * 1. 废除生硬的低轮次回环熔断 (原 currentCount >= 2 导致多 Agent 正常辩论在第 3-4 步被强行掐断并弹刺眼卡片)；
 * 2. 达到深度或频次安全兜底上限时，采用静默收敛 (isSilentEnd: true)，静悄悄终止级联，不向用户投递刺眼的熔断警报卡片；
 * 3. 唯有人工显式中止时才显式标记并通知。
 */
export function checkLoopGuard(
  cascade: CollaborationCascade,
  targetAgentId: string
): LoopGuardResult {
  if (cascade.isAborted) {
    return { allowed: false, reason: '用户已手动终止多智能体协同', isSilentEnd: false };
  }

  // 1. 深度安全兜底 (Max Depth Invisible Backstop - 对标 Buzz 设计，静默兜底)
  if (cascade.depth >= cascade.maxDepth) {
    return {
      allowed: false,
      reason: `多智能体协同已达安全轮次兜底上限 (${cascade.maxDepth} 轮)，静默收敛`,
      isSilentEnd: true,
    };
  }

  // 2. 异常失控循环兜底 (单链内单 Agent 调用达到 8 次以上的极端异常兜底)
  const currentCount = cascade.agentCallCounts[targetAgentId] || 0;
  if (currentCount >= 8) {
    return {
      allowed: false,
      reason: `目标 Agent 在本轮链条中已响应 ${currentCount} 次，触发极端异常兜底`,
      isSilentEnd: true,
    };
  }

  return { allowed: true };
}

/**
 * 为任意提示词注入当前频道团队花名册与协同召唤指南
 * 注入【Shadow Crew 平台协同公约 (对标 Buzz 增量价值与静默收敛哲学)】：
 * 1. 明确告知 Agent 由宿主调度器负责消息路由与级联分发
 * 2. 严禁且无需在本地运行工具搜索其它 Agent
 * 3. 增量信息价值准则：唯有产生技术实质增量才发言接力
 * 4. 静默即成功：共识达成时直接输出方案，严禁 @ 任何成员，自然结题
 * 5. 严禁裸确认：禁止「收到/已对齐」等无意义社交客套
 */
export function buildCrewRosterGuidance(
  availableAgents: Agent[],
  currentAgentId?: string
): string {
  const peers = availableAgents.filter((a) => a.id !== currentAgentId);
  const hasPeers = peers.length > 0;

  const peerList = hasPeers
    ? peers
        .map((p) => `• ${p.handle} (${p.name}): ${p.role}${p.description ? ` - ${p.description}` : ''}`)
        .join('\n')
    : '• (当前频道/会话中暂无其他协作 Agent。本轮推演由你独立完成，无需且严禁 @ 任何未列出的外部成员)';

  const exampleHandle = hasPeers ? peers[0].handle : '@agent';

  const collaborationDirective = hasPeers
    ? `3. 【频道内 @ 协同接力】：若你需要向当前频道内的其他成员协作推演、请求代码审查或分工，**只需在你的回复文本中自然写出对方的 @handle**（例如「${exampleHandle} 请对此方案进行底层安全性与并发审查...」）。注意：**你只能 @ 上方【可用协同团队成员列表】中明确列出的当前频道成员，严禁 @ 任何未列出的外部 Agent**。平台的级联调度器会在你回复后自动提取有效 @ 并接力投递给目标成员！\n` +
      `4. 【增量信息价值准则 (Information Delta)】：唯有当你能提供实质性、非显而易见的技术增量、架构评测、代码实现或风险质疑时，才发言接力；严禁为了回复而回复。\n` +
      `5. 【静默即成功与达成共识自然收敛 (Silence as Success)】：当推演方案已完备、各方达成技术共识或已无新的增量信息需要补充时，**直接给出你的最终技术总结与落地实施方案，切勿在正文中 @ 任何成员**。回复中不含任何成员的 @handle 即代表协同推演圆满收敛交付！\n` +
      `6. 【严禁裸确认与客套回复 (No Bare Acks)】：严禁发送纯粹的礼貌性确认、赞同或声明自己不再回复的内容（如「收到」、「已对齐」、「完全赞同，我不再回复」、「${exampleHandle} 已知悉」等）。任何不含实质内容的回复都会再次唤醒其他 Agent 造成无效震荡。\n` +
      `7. 【叙述性提及请勿加 @】：仅在真正需要对方介入推演时才使用 @handle。在叙述方案背景或引用他人观点时（例如「正如 ${peers[0]?.name || '专家'} 刚才所分析的架构」），请直接写成员姓名而**不要添加 @ 符号**，避免系统误触级联唤醒。\n\n`
    : `3. 【独立推演原则】：当前频道仅有你一名 Agent 在线。你应当独立完成本次任务推演与技术方案产出，**无需且严禁在回复中 @ 任何未加入当前频道的外部 Agent**。\n\n`;

  return (
    `\n\n[🛡️ Shadow Crew 平台智能体协同公约 (Agent Collaboration Directive)]:\n` +
    `1. 【多智能体中枢调度】：本工作区具备多智能体级联调度能力。团队成员属于独立的 Agent 进程或远程端点，由平台（Shadow Crew）统一接管消息分发与级联路由。\n` +
    `2. 【严禁本地工具搜查】：你**无需且绝对不要**在自身本地环境中使用 tools（如 sessions_list, conversations_list, openclaw agents list, bash grep/find 等）去排查、寻找或建立与其他 Agent 的私有连接。这会导致严重超时与资源浪费。\n` +
    collaborationDirective +
    `[👥 可用协同团队成员列表]:\n` +
    peerList
  );
}

// 对标 Buzz: 别名导出为立足上下文 (Standing Context)
export const buildStandingContext = buildCrewRosterGuidance;

/**
 * 构造跨智能体协同接力的结构化提示词
 * 对标 Buzz 最佳实践：
 * 1. 专注纯净业务接力信息（发起人、原议题、前序结论、具体审查诉求）
 * 2. 坚决不复读 30 行系统级平台公约，避免上下文膨胀与指令稀释
 * 3. 仅附带单行轻量协同提示
 */
export interface TopicPromptContext {
  topicId: string;
  title: string;
  description?: string;
  channelName?: string;
  status?: string;
  discussionMode?: DiscussionMode;
  gameRoles?: GameRolesConfig;
  gameStage?: GameTheoreticStage;
  targetProposalText?: string;
  targetChallengeText?: string;
  targetVerificationText?: string;
  targetDefenseText?: string;
  participatingAgents?: Agent[];
  recentHistory?: Array<{ author: string; content: string; isAgent?: boolean }>;
}

/**
 * 获取 Agent 在 CognoNexus 博弈模式中的角色定位 (4类核心智能体角色)
 */
export function getAgentGameRole(agentId: string, gameRoles?: GameRolesConfig): GameRoleType | null {
  if (!gameRoles) return null;
  if ((gameRoles.proposers || []).includes(agentId)) return 'proposer';
  if ((gameRoles.challengers || []).includes(agentId)) return 'challenger';
  if ((gameRoles.verifiers || []).includes(agentId)) return 'verifier';
  if ((gameRoles.arbiters || []).includes(agentId)) return 'arbiter';
  return null;
}

/**
 * 构造议题（Topic Thread）开题与讨论推演的统一结构化提示词
 * 确保即使在各自独立的 Session 中，Agent 也能完整获取议题标题、目标背景与前序讨论脉络
 */
export function buildTopicPrompt(options: {
  topic: TopicPromptContext;
  userContent: string;
  targetAgent: Agent;
  availableAgents: Agent[];
}): string {
  const { topic, userContent, targetAgent, availableAgents } = options;

  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerList = peers.length > 0
    ? peers.map((p) => `${p.handle} (${p.name} · ${p.role})`).join('、')
    : '(当前仅你独立在线)';

  let historySection = '';
  if (topic.recentHistory && topic.recentHistory.length > 0) {
    const formattedHistory = topic.recentHistory
      .map((h) => {
        const preview = h.content.length > 300 ? `${h.content.slice(0, 300)}...` : h.content;
        return `• [${h.author}]: ${preview}`;
      })
      .join('\n');
    historySection = `\n【议题前序研讨脉络】:\n${formattedHistory}\n`;
  }

  const topicDesc = topic.description?.trim()
    ? topic.description.trim()
    : '（创建者未填写额外背景说明，请紧密围绕议题标题进行专业技术方案推演）';

  let gameModeDirective = '';
  if (topic.discussionMode === 'game_theoretic' && topic.gameRoles) {
    const role = getAgentGameRole(targetAgent.id, topic.gameRoles);
    const stage = topic.gameStage || (role === 'proposer' ? 'proposal' : role === 'challenger' ? 'challenge' : role === 'verifier' ? 'verification' : 'arbitration');

    const verificationSection = topic.targetVerificationText
      ? `\n\n【🔍 接地验证实证检验结论 (Grounding Truth)】:\n<<<GROUNDING_VERIFICATION_START>>>\n${topic.targetVerificationText}\n<<<GROUNDING_VERIFICATION_END>>>`
      : '';

    if (role === 'proposer') {
      if (stage === 'defense') {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 4: 提案者答辩与防御修正 (Defense v2)】:
红队挑战者已对你的初始提案提出针对性反例与边界质询，且接地验证智能体已提供物理实证检验（见下方靶点数据）。
请针对挑战者指出的失效场景与接地检验结论做出正面答辩：
1. 事实澄清与评估：认可还是反驳挑战方的失效推演？指出其推演中的合理之处或边界误判；
2. 架构补丁与修正方案 (Patch v2)：若漏洞属实，提出具体的容灾、降级、锁机制或重构设计；
3. 性能/复杂度折中说明：补丁方案对原架构的延迟、吞吐与维护成本有何影响；
4. 交付准备：给出可供仲裁官定案评估的最终建议。
【防谄媚守则 (Anti-Sycophancy)】: 严禁无原则全盘顺从或空洞认错！你必须以客观工程事实、防御补丁（Patch）或架构权衡进行自洽答辩，杜绝“您说得对、全盘放弃原案”式的敷衍认输。
无需在正文 @ 任何人，平台状态机将自动汇总攻防论据并提交仲裁。

【红队反例质询 (攻击靶点)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '（详见前序讨论脉络中的挑战者发言）'}
<<<CHALLENGER_CRITIQUE_END>>>${verificationSection}`;
      } else {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 1: 提案智能体独立立论起草 (Proposer)】:
你是本议题的提案构想者 (Proposer)。请基于议题目标与需求，在独立沙箱中设计全局架构首选技术方案，明确关键选型、核心接口、组件拆分与设计假设。
注意：你的方案落库后将被平台直接递交至红队对抗智能体进行极限反例压测与反从众审查，请尽可能清晰完备地陈述方案逻辑与潜在风险边界。无需在正文 @ 任何人，平台状态机将自动递交方案。`;
      }
    } else if (role === 'challenger') {
      gameModeDirective = `\n\n【博弈编排 - ⚔️ 阶段 2: 红队对抗反例压测与反向质询 (Red Team)】:
你是本议题佩戴黑帽的红队对抗智能体 (Red Team / Challenger)。提案官已提交初始立论方案（见下方【攻击标的方案】）。
【作战守则】:
强制运行反从众批判模式，寻找隐藏假设漏洞、极端并发死锁、网络抖动失效场景或过度设计问题。严禁盲目附和与套话认同！
请必须遵循以下四部曲批判契约：
1. [质疑靶点]: 明确指出提案方案中的具体选型、代码设计或逻辑假设；
2. [失效反例]: 构造具体的极端工况、恶意并发、故障注入或边界数据场景；
3. [连锁反应]: 推演在此场景下系统为何崩溃、数据如何失真；
4. [防御检验]: 要求提案官提供补丁防御设计或实证说明。
无需在正文 @ 任何人，平台将自动流转至接地验证/抗辩阶段。

【被质询提案方案 (攻击标的)】:
<<<PROPOSER_SOLUTION_START>>>
${topic.targetProposalText || '（暂未提取到前序提案方案，请围绕前序讨论脉络展开边界质询）'}
<<<PROPOSER_SOLUTION_END>>>`;
    } else if (role === 'verifier') {
      gameModeDirective = `\n\n【博弈编排 - 🔍 阶段 3: 接地实证与反事实检验 (Grounding Verifier)】:
你是本议题客观物理世界与事实逻辑的接地验证智能体 (Grounding Verifier)。
【守则与职责】:
1. 坚决不参与任何主观文本辩论与空洞口水战！
2. 你的唯一任务是对红队提出的极端失效反例与提案方案的前提假设，执行确定性的反事实与实证逻辑检验；
3. 给出具体的工具调用执行记录（如：ast_grep, static_analyzer, rag_search 或 code_sandbox）；
4. 输出确定性结论：该反例工况在真实代码/系统环境下究竟是否成立 (PASS / FAIL / 证实 / 证伪)；
5. 【必须输出结构化实证结果】：在陈词结尾附带标准 JSON 证据块：
\`\`\`json
{
  "evidences": [
    {
      "sourceTool": "ast_grep",
      "inputQueryOrCode": "具体的检验代码、查询命令或测试用例",
      "rawOutput": "执行输出摘要或观测结果",
      "truthValue": true,
      "confidence": 0.9,
      "verifierReport": "精炼客观的实证推演结论"
    }
  ]
}
\`\`\`
无需在正文 @ 任何人。

【待验证提案方案】:
<<<PROPOSER_SOLUTION_START>>>
${topic.targetProposalText || '详见前序脉络'}
<<<PROPOSER_SOLUTION_END>>>

【红队指出的失效反例争议切片】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '详见前序脉络'}
<<<CHALLENGER_CRITIQUE_END>>>`;
    } else if (role === 'arbiter') {
      const defenseSection = topic.targetDefenseText
        ? `\n\n【提案方防御答辩与架构补丁 (Defense v2)】:\n<<<PROPOSER_DEFENSE_START>>>\n${topic.targetDefenseText}\n<<<PROPOSER_DEFENSE_END>>>`
        : '';

      gameModeDirective = `\n\n【博弈编排 - ⚖️ 阶段 5: 中立综合协调与权衡决策 (Synthesizer / Arbiter)】:
你是本议题的中立流程综合官与决策协调者 (Synthesizer / Arbiter)。提案方案、红队反例、接地实证及答辩补丁已进入终局仲裁。
【仲裁守则】:
保持客观中立，依据可行性、健壮性与 ROI：
1. 梳理双方分歧焦点与核心论据；
2. 全面审视红队的反例质疑、接地验证智能体的物理实证报告以及提案官的防御修正/补丁方案；
3. 输出客观的《架构决策权衡矩阵 (Trade-off Matrix)》；
4. 调度确定性多属性决策分析 (MCDA) 算法求解，给出终局裁定方案与落地行动建议（若人类首席仲裁官持有最终裁决法槌，你的分析将作为定案的核心依据）。
无需在正文 @ 任何人。

【立论方案 (Proposal v1)】:
<<<PROPOSER_PROPOSAL_START>>>
${topic.targetProposalText || '详见前序脉络'}
<<<PROPOSER_PROPOSAL_END>>>

【红队反例质询 (Red Team Challenge)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '详见前序脉络'}
<<<CHALLENGER_CRITIQUE_END>>>${verificationSection}${defenseSection}`;
    }
  }

  return `[📌 议题研讨推演任务 (Topic Discussion Context)]
【所属频道】: #${topic.channelName || '频道'}
【议题编号】: ${topic.topicId}
【议题模式】: ${topic.discussionMode === 'game_theoretic' ? '♟️ 博弈讨论模式 (三元制衡：主导/挑战/仲裁)' : '标准研讨模式'}
【议题标题】: ${topic.title}
【议题背景与需求目标】:
${topicDesc}
【参与研讨成员】: ${peerList}
${historySection}
【用户开题 / 本轮诉求指令】:
"${userContent}"
${gameModeDirective}

请以你的专业角色定位【${targetAgent.name} (${targetAgent.handle}) · ${targetAgent.role}】针对上述议题目标与用户诉求展开技术推演与方案陈述。`;
}

export interface BuildCascadePromptOptions {
  targetAgent: Agent;
  invokingAgent: Agent;
  originalUserPrompt: string;
  invokingAgentReply: string;
  cascade: CollaborationCascade;
  availableAgents: Agent[];
  topic?: TopicPromptContext;
  isQueuedByUserInput?: boolean;
}

/**
 * 构造跨智能体协同接力的结构化提示词
 * 对标 Buzz 最佳实践：
 * 1. 专注纯净业务接力信息（发起人、原议题、前序结论、具体审查诉求）
 * 2. 坚决不复读 30 行系统级平台公约，避免上下文膨胀与指令稀释
 * 3. 支持议题元数据带入与用户排队 @all / 串行接力语义区分
 */
export function buildCascadePrompt(options: BuildCascadePromptOptions): string {
  const {
    targetAgent,
    invokingAgent,
    originalUserPrompt,
    invokingAgentReply,
    cascade,
    availableAgents,
    topic,
    isQueuedByUserInput = false,
  } = options;

  const currentHop = cascade.depth + 1;
  const isGameTheoretic = topic?.discussionMode === 'game_theoretic';
  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerList =
    peers.length > 0
      ? (isGameTheoretic
          ? `\n\n[💡 博弈编排协议：当前议题处于主导-挑战-仲裁三元制衡流转中，方案提交后平台协调器将自动按协议推动下一阶段，无需在正文手动 @ 任何人]`
          : `\n\n[💡 协同收敛指引：若完成本轮推演/审查后方案已成熟收敛或各方达成共识，请直接给出最终落地结论，**切勿 @ 任何人**（没有 @ 即代表协同圆满收敛完成）；若确实需要其他特定专家继续提供不可或缺的实质性增量，可精准 @ 对应成员：${peers.map((p) => p.handle).join(', ')}]`)
      : '';

  const topicHeader = topic
    ? `【所属议题】: 【${topic.title}】 (ID: ${topic.topicId})\n【议题模式】: ${topic.discussionMode === 'game_theoretic' ? '♟️ 博弈讨论模式' : '标准研讨模式'}\n【议题背景与目标】:\n${topic.description?.trim() || topic.title}\n\n`
    : '';

  let gameRoleAddon = '';
  if (topic?.discussionMode === 'game_theoretic' && topic.gameRoles) {
    const role = getAgentGameRole(targetAgent.id, topic.gameRoles);
    if (role === 'proposer') {
      gameRoleAddon = `\n【你的博弈定位】: 🏛️ 提案官 (Proposer)。请主导技术方案的架构设计与关键路径，并就挑战者提出的质疑进行技术抗辩与落地修正。无需手动 @，平台将自动流转。`;
    } else if (role === 'challenger') {
      gameRoleAddon = `\n【你的博弈定位】: ⚔️ 红队对抗 / 挑战官 (Challenger)。请执行反从众对抗性挑错，寻找极端边界缺陷与隐藏风险，拒绝盲目认同。无需手动 @，平台将自动流转。`;
    } else if (role === 'arbiter') {
      gameRoleAddon = `\n【你的博弈定位】: ⚖️ 流程综合官 (Synthesizer / Arbiter)。请综合提案、红队与答辩三方论据，提炼权衡矩阵，提供公正客观的仲裁裁决建议。无需手动 @。`;
    }
  }

  // 区分：是由前序 Agent 显式点名请求代码审查，还是由用户 @all / 批量点名排队顺延陈述
  const conclusionTip = isGameTheoretic
    ? '若当前阶段方案或反例已输出完毕，直接输出专业分析（平台协调器将按协议自动推动下一阶段，无需手动 @）'
    : '若方案已完备或形成最终共识，直接输出收敛结论（切勿 @ 任何人，以使协同自然交付结题）；仅在确实需要特定成员接力时才 @ 对应成员';

  const requestSection = isQueuedByUserInput
    ? `【多智能体协同陈述 (用户排队协作)】:
用户在上述讨论中同时指派了多位成员共同陈述观点。
前序成员 (${invokingAgent.name}) 已完成其视角阐述（见上方结论）。现请基于你的专属角色定位（${targetAgent.role}${targetAgent.description ? ` - ${targetAgent.description}` : ''}）：${gameRoleAddon}
1. 独立给出你针对该议题的技术方案或观点，提供具有非显而易见增量价值的专业视角；
2. 结合前序成员的结论进行必要的差异对比或补充；严禁纯客套的裸确认（如「收到/已对齐」）；
3. ${conclusionTip}。`
    : `【对你的协作诉求】:
${invokingAgent.name} 在上述方案中点名了你 (${targetAgent.handle}) 请求技术审查与协作。
请基于你的专属角色定位（${targetAgent.role}${targetAgent.description ? ` - ${targetAgent.description}` : ''}）：${gameRoleAddon}
1. 对上述方案进行针对性技术审查与可行性评估，指出潜在风险与优化点；
2. 提供实质性技术增量或落地实现步骤，严禁仅做「收到/已对齐」的裸确认；
3. ${conclusionTip}。`;

  return `[🤝 团队协同协作请求 (第 ${currentHop}/${cascade.maxDepth} 轮接力)]

${topicHeader}【发起协同者】: ${invokingAgent.handle} (${invokingAgent.name} · ${invokingAgent.role})
【原始用户议题/需求】:
"${originalUserPrompt}"

【前序推演方案与结论】(由 ${invokingAgent.name} 产出):
"""
${invokingAgentReply}
"""

${requestSection}${peerList}`;
}

export interface BuildExecutionPromptOptions {
  topic: TopicPromptContext;
  executorAgent: Agent;
  decision: {
    summary: string;
    solution?: string;
    tradeOffPoints?: string[];
    impactedFiles?: string[];
  };
}

/**
 * 构造仲裁定案/共识合流后落地实施阶段的工程代码实施提示词
 * 将大脑（治理决策层）的裁决转化为双手（代码工程落地）的执行补丁
 */
export function buildExecutionPrompt(options: BuildExecutionPromptOptions): string {
  const { topic, executorAgent, decision } = options;

  const filesList = decision.impactedFiles && decision.impactedFiles.length > 0
    ? decision.impactedFiles.map((f) => `• \`${f}\``).join('\n')
    : '• (根据方案内容自行确定需要新建或修改的文件范围)';

  const tradeOffs = decision.tradeOffPoints && decision.tradeOffPoints.length > 0
    ? `\n【关键权衡折中约束 (Trade-off Constraints)】:\n${decision.tradeOffPoints.map((p) => `• ${p}`).join('\n')}\n`
    : '';

  return `[🛠️ 议题仲裁定案代码落地实施任务 (Post-Arbitration Code Implementation)]
【执行负责人】: ${executorAgent.name} (${executorAgent.handle} · ${executorAgent.role})
【所属议题】: 【${topic.title}】 (ID: ${topic.topicId})
【议题背景与需求】:
${topic.description?.trim() || topic.title}

【终局裁定方案 (Arbitration Ruling Summary)】:
${decision.summary}
${decision.solution ? `\n【落地方案与架构补丁要求】:\n${decision.solution}` : ''}${tradeOffs}
【涉及受影响文件列表】:
${filesList}

【落地实施硬性指令要求】:
1. 你已被选定为本议题仲裁定案的**具体代码落地执行智能体**。请将上述博弈推演与仲裁定案结论转化为**真实的工程代码实现与补丁方案**；
2. 明确给出具体的代码变更（包含代码块、修改文件路径、新增/调整函数及完整逻辑）；
3. 若涉及配置或依赖变更，请输出具体的命令与配置项；
4. 严格遵守上述权衡约束，确保补丁具备边界校验、并发安全与向后兼容性；
5. 无需在正文中 @ 任何人，直接交付高质量落地方案与代码补丁！`;
}

interface CriterionCandidate {
  id: string;
  name: string;
  direction: 'maximize' | 'minimize';
  keywords: string[];
}

const CRITERIA_CATALOGUE: CriterionCandidate[] = [
  {
    id: 'rel',
    name: '系统健壮性与容灾抗风险',
    direction: 'maximize',
    keywords: ['健壮', '容灾', '高可用', '崩溃', '单点', '故障', '死锁', '可靠性', '稳定性', '异常'],
  },
  {
    id: 'perf',
    name: '吞吐性能与低延迟表现',
    direction: 'maximize',
    keywords: ['性能', '延迟', '高并发', '吞吐', 'tps', 'qps', '响应时间', '压测', '瓶颈', '毫秒'],
  },
  {
    id: 'comp',
    name: '代码实现与维护复杂度',
    direction: 'minimize',
    keywords: ['复杂度', '开发周期', '维护', '可读性', '技术债', '耦合', '重构成本', '工程量', '难度'],
  },
  {
    id: 'cons',
    name: '数据一致性与状态正确性',
    direction: 'maximize',
    keywords: ['一致性', '幂等', '原子性', '状态机', '事务', '数据丢失', '脏读', '竞争', '锁'],
  },
  {
    id: 'sec',
    name: '安全性与隔离防护机制',
    direction: 'maximize',
    keywords: ['安全', '权限', '攻击', '越权', '隔离', '审计', '防重放', '注入', '凭证'],
  },
  {
    id: 'cost',
    name: '资源开销与基础设施成本',
    direction: 'minimize',
    keywords: ['成本', '资源', '内存', 'cpu', '带宽', '开销', '服务器', '云成本', '配额'],
  },
];

function extractCoreThemeFromText(text?: string, fallback = ''): string {
  if (!text || !text.trim()) return fallback;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const keyLine = lines.find((l) =>
    l.includes('选型') || l.includes('方案') || l.includes('建议') || l.includes('结论') ||
    l.includes('架构') || l.includes('重构') || l.includes('补丁') || l.startsWith('1.')
  );
  if (keyLine) {
    const cleaned = keyLine.replace(/^[0-9.#\-*：:\s【】]+/, '').replace(/[*`_]/g, '').trim();
    if (cleaned.length >= 3) {
      return cleaned.slice(0, 20);
    }
  }
  const boldMatch = text.match(/\*\*([^*]{3,25})\*\*/);
  if (boldMatch) {
    return boldMatch[1].trim().slice(0, 20);
  }
  return lines[0]?.slice(0, 20) || fallback;
}

export interface GenerateMcdaOptions {
  arbiterText?: string;
  proposalText?: string;
  critiqueText?: string;
  defenseText?: string;
  topicTitle?: string;
  topicDescription?: string;
  argumentNodes?: ArgumentNode[];
  evidences?: GroundingEvidence[];
  sycophancy?: SycophancyEvaluation;
  modelDiversity?: ModelDiversityEvaluation;
}

/**
 * 神经符号确定性运筹裁决：结合 Arbiter 意图与真实研讨脉络，输出确定性多属性决策载荷 (LLM + BWM)
 */
export function generateDeterministicMcdaPayload(options: GenerateMcdaOptions): McdaDecisionPayload {
  const {
    arbiterText = '',
    proposalText = '',
    critiqueText = '',
    defenseText = '',
    topicTitle = '',
    topicDescription = '',
    argumentNodes = [],
    evidences = [],
    sycophancy,
    modelDiversity,
  } = options;

  const fullCorpus = [topicTitle, topicDescription, arbiterText, proposalText, critiqueText, defenseText].join('\n').toLowerCase();

  // 1. 动态评分筛选当前议题最关切的准则 (前 4 项)
  const scoredCriteria = CRITERIA_CATALOGUE.map((c) => {
    let count = 0;
    c.keywords.forEach((kw) => {
      const regex = new RegExp(kw.toLowerCase(), 'g');
      const matches = fullCorpus.match(regex);
      if (matches) count += matches.length;
    });
    return { candidate: c, count };
  });

  scoredCriteria.sort((a, b) => b.count - a.count);
  const selectedCandidates = scoredCriteria.slice(0, 4).map((s) => s.candidate);

  // 确保至少有 3 个准则，若不足则使用标准默认准则
  const criteria: McdaCriterion[] = (selectedCandidates.length >= 3 ? selectedCandidates : CRITERIA_CATALOGUE.slice(0, 4)).map((c) => ({
    id: c.id,
    name: c.name,
    direction: c.direction,
  }));

  // 2. 动态抽取候选方案名称
  const propTheme = extractCoreThemeFromText(proposalText, '提案主推方案');
  const critTheme = extractCoreThemeFromText(critiqueText, '红队对抗重构方案');
  const defTheme = extractCoreThemeFromText(defenseText || arbiterText, '架构权衡补丁');

  const altA = `方案A: 提案主导方案 (${propTheme})`;
  const altB = `方案B: 红队对抗方案 (${critTheme})`;
  const altC = `方案C: 架构权衡补丁 (${defTheme})`;
  const alternatives = [altA, altB, altC];

  // 3. 构建方案评分矩阵与证据溯源链 (Audit Provenance)
  const scoreMatrix: Record<string, Record<string, number>> = {
    [altA]: {},
    [altB]: {},
    [altC]: {},
  };
  const scoreProvenance: Record<string, Record<string, string>> = {
    [altA]: {},
    [altB]: {},
    [altC]: {},
  };

  // 计算实证与论点状态对准则的修正因子
  const verifiedT1T2Count = evidences.filter((e) => e.truthValue).length;
  const refutedT1T2Count = evidences.filter((e) => !e.truthValue).length;

  for (const crit of criteria) {
    let scoreA = 7.5;
    let scoreB = 7.0;
    let scoreC = 8.0;

    let provA = '立论基线设计';
    let provB = '红队对抗主张';
    let provC = '中立综合折中';

    // 准则方向与类型适配
    if (crit.id === 'rel' || crit.id === 'cons') {
      scoreA = 7.8;
      scoreB = 8.8;
      scoreC = 8.5;
      if (refutedT1T2Count > 0) {
        scoreA = Math.max(3.5, scoreA - 2.5);
        provA = `实证检验存在 ${refutedT1T2Count} 项未通过/复现反例缺陷`;
        provB = '红队反例获接地实证验证支持';
      } else if (verifiedT1T2Count > 0) {
        scoreA = Math.min(9.5, scoreA + 1.2);
        provA = `接地实证通过 ${verifiedT1T2Count} 项物理检验`;
      }
      if (defenseText.includes('补丁') || defenseText.includes('容灾') || defenseText.includes('降级')) {
        scoreC = Math.min(9.4, scoreC + 0.8);
        provC = '答辩已融入容灾/降级防御补丁';
      }
    } else if (crit.id === 'perf') {
      scoreA = 8.5;
      scoreB = 7.2;
      scoreC = 8.2;
      if (critiqueText.includes('性能') || critiqueText.includes('延迟') || critiqueText.includes('瓶颈')) {
        scoreA = Math.max(4.0, scoreA - 1.5);
        provA = '红队指出极端并发/网络抖动下的延迟抖动隐患';
      }
      if (defenseText.includes('优化') || defenseText.includes('异步') || defenseText.includes('缓存')) {
        scoreC = Math.min(9.2, scoreC + 0.8);
        provC = '答辩补丁引入异步/缓冲优化性能';
      }
    } else if (crit.id === 'comp') {
      // 复杂度越小越好 (minimize)
      scoreA = 4.5; // 相对较小改动
      scoreB = 8.8; // 推倒重构复杂度极高
      scoreC = 5.5; // 补丁折中
      provA = '原方案架构改动最小';
      provB = '推倒重构涉及深层技术栈与历史代码重写';
      provC = '局部补丁修补，工程周期适中';
    } else if (crit.id === 'cost') {
      scoreA = 4.0;
      scoreB = 7.5;
      scoreC = 4.8;
      provA = '复用现有基础设施';
      provB = '引入新架构组件需额外计算/运维资源';
      provC = '局部配置微调，资源增量低';
    } else if (crit.id === 'sec') {
      scoreA = 7.6;
      scoreB = 8.6;
      scoreC = 8.4;
      provA = '常规安全边界设计';
      provB = '隔离性更强但架构开销更大';
      provC = '补充安全鉴权与审计切面';
    }

    // Arbiter 仲裁文本倾向修正
    if (arbiterText.includes('驳回') || arbiterText.includes('推倒重构') || arbiterText.includes('推翻')) {
      scoreB = Math.min(9.6, scoreB + 1.0);
      scoreA = Math.max(3.0, scoreA - 1.5);
      provB += ' (仲裁官重点支持重构路线)';
    } else if (arbiterText.includes('采纳提案') || arbiterText.includes('坚持原案')) {
      scoreA = Math.min(9.5, scoreA + 1.0);
      provA += ' (仲裁官认可原案主体设计)';
    }

    scoreMatrix[altA][crit.id] = Math.round(scoreA * 10) / 10;
    scoreMatrix[altB][crit.id] = Math.round(scoreB * 10) / 10;
    scoreMatrix[altC][crit.id] = Math.round(scoreC * 10) / 10;

    scoreProvenance[altA][crit.id] = provA;
    scoreProvenance[altB][crit.id] = provB;
    scoreProvenance[altC][crit.id] = provC;
  }

  // 4. 依据仲裁陈词动态判定最优准则 (Best) 与最差准则 (Worst)
  let bestCriterionId = criteria[0].id;
  let worstCriterionId = criteria[criteria.length - 1].id;

  let maxBestMentions = -1;
  criteria.forEach((c) => {
    const cand = CRITERIA_CATALOGUE.find((cat) => cat.id === c.id);
    let mentions = 0;
    (cand?.keywords || [c.name]).forEach((kw) => {
      if (arbiterText.includes(kw)) mentions++;
    });
    if (mentions > maxBestMentions && mentions > 0) {
      maxBestMentions = mentions;
      bestCriterionId = c.id;
    }
  });

  const nonBestCriteria = criteria.filter((c) => c.id !== bestCriterionId);
  const costOrComp = nonBestCriteria.find((c) => c.id === 'cost' || c.id === 'comp');
  worstCriterionId = costOrComp ? costOrComp.id : nonBestCriteria[nonBestCriteria.length - 1].id;

  // 5. 构建符合一致性的 BWM 偏好向量
  const bestIdx = criteria.findIndex((c) => c.id === bestCriterionId);
  const worstIdx = criteria.findIndex((c) => c.id === worstCriterionId);

  const bestToOthers: number[] = new Array(criteria.length).fill(2);
  const othersToWorst: number[] = new Array(criteria.length).fill(2);

  bestToOthers[bestIdx] = 1;
  bestToOthers[worstIdx] = Math.min(5, Math.max(3, criteria.length));

  othersToWorst[worstIdx] = 1;
  othersToWorst[bestIdx] = bestToOthers[worstIdx];

  criteria.forEach((c, idx) => {
    if (idx !== bestIdx && idx !== worstIdx) {
      bestToOthers[idx] = 2;
      othersToWorst[idx] = Math.max(1, bestToOthers[worstIdx] - 1);
    }
  });

  // 6. 计算方案-准则置信度矩阵 (ReConcile 置信度动态加权)
  const confidenceMatrix = calculateConfidenceMatrix({
    alternatives,
    criteriaIds: criteria.map((c) => c.id),
    evidences,
    argumentNodes,
    sycophancy,
  });

  return solveDeterministicBwm({
    solverType: 'BWM',
    criteria,
    alternatives,
    scoreMatrix,
    bestCriterionId,
    worstCriterionId,
    bestToOthers,
    othersToWorst,
    scoreProvenance,
    confidenceMatrix,
  });
}

/**
 * 伴生少数派报告提炼
 */
export function extractOrCompileMinorityReport(options: {
  critiqueText: string;
  proposalText?: string;
  dissentingAgentId: string;
  dissentingAgentName: string;
  dissentingAgentModel?: string;
}): MinorityReport {
  return compileMinorityReport({
    dissentingAgentId: options.dissentingAgentId,
    dissentingAgentName: options.dissentingAgentName,
    dissentingAgentModel: options.dissentingAgentModel,
    critiqueText: options.critiqueText,
    proposalText: options.proposalText,
  });
}

// 统一重导出 CognoNexus 服务
export {
  solveDeterministicBwm,
  solveExactBwmOptionB,
  stepSprtGovernor,
  fitSprtCalibrationParams,
  estimateRoundAlignmentScore,
  compileMinorityReport,
  extractArgumentNodes,
  localizeEarliestDispute,
  dehydrateContextToCommittedStates,
  dehydrateContextWithAlert,
  logGameTheoreticTelemetry,
  getMetricBaselineSummary,
  getMetricBaselineReport,
  validateStageContract,
  STAGE_CONTRACT_MAX_RETRIES,
  tieredGroundingGovernor,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  generateDynamicRulingDraft,
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
  detectModelFamily,
  calculateModelDiversity,
  calculateConfidenceMatrix,
};


