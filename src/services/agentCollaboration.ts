import { Agent, DiscussionMode, GameRolesConfig, GameRoleType } from '../types';

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
  participatingAgents?: Agent[];
  recentHistory?: Array<{ author: string; content: string; isAgent?: boolean }>;
}

/**
 * 获取 Agent 在三元博弈中的角色定位
 */
export function getAgentGameRole(agentId: string, gameRoles?: GameRolesConfig): GameRoleType | null {
  if (!gameRoles) return null;
  if ((gameRoles.proposers || []).includes(agentId)) return 'proposer';
  if ((gameRoles.challengers || []).includes(agentId)) return 'challenger';
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
    const stage = topic.gameStage || (role === 'proposer' ? 'proposal' : role === 'challenger' ? 'challenge' : 'arbitration');

    if (role === 'proposer') {
      if (stage === 'defense') {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 3: 主导者答辩与防御修正 (Defense)】:
挑战者已对你的主导方案提出针对性反例与边界质询（见下方【挑战者反例质询】）。
请针对挑战者指出的并发/极端场景进行针对性答辩：
1. 若挑战有效，提供架构补丁防御设计、降级方案或代码修正；
2. 若挑战存在前提误解，基于代码事实与确定性逻辑给出技术抗辩。
无需在正文 @ 任何人，平台状态机将自动汇总攻防论据并提交仲裁。

【挑战者反例质询 (攻击靶点)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '（详见前序讨论脉络中的挑战者发言）'}
<<<CHALLENGER_CRITIQUE_END>>>`;
      } else {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 1: 主导方案立论起草 (Proposer)】:
你是本议题的主导方案提出者。请基于议题目标与需求，设计全局架构首选技术方案，明确关键选型、核心接口、组件拆分与设计假设。
注意：你的方案落库后将被平台直接递交至批判性挑战者进行极限反例压测，请尽可能清晰完备地陈述方案逻辑与潜在风险边界。无需在正文 @ 任何人，平台状态机将自动递交方案。`;
      }
    } else if (role === 'challenger') {
      gameModeDirective = `\n\n【博弈编排 - ⚔️ 阶段 2: 方案反例压测与反向质询 (Challenger)】:
你是本议题的批判性挑战者。主导者已提交初始方案（见下方【攻击标的方案】）。
【作战守则】:
坚决执行对抗性挑错，寻找隐藏假设漏洞、极端并发死锁、网络抖动失效场景或过度设计问题。严禁盲目附和与套话认同！
请必须遵循以下四段论输出结构：
1. [质疑靶点]: 明确指出主导方案中的具体选型、代码设计或逻辑假设；
2. [失效反例]: 构造具体的极端工况、恶意并发、故障注入或边界数据场景；
3. [连锁反应]: 推演在此场景下系统为何崩溃、数据如何失真；
4. [防御检验]: 要求主导者提供补丁防御设计或实证说明。
无需在正文 @ 任何人，平台将自动流转至抗辩/仲裁阶段。

【被质询主导方案 (攻击标的)】:
<<<PROPOSER_SOLUTION_START>>>
${topic.targetProposalText || '（暂未提取到前序主导方案，请围绕前序讨论脉络展开边界质询）'}
<<<PROPOSER_SOLUTION_END>>>`;
    } else if (role === 'arbiter') {
      gameModeDirective = `\n\n【博弈编排 - ⚖️ 阶段 3: 中立仲裁与权衡矩阵起草 (Arbiter)】:
你是本议题的中立仲裁者。主导方案与挑战反例已就绪。
【仲裁守则】:
保持客观公正，依据可行性、健壮性与 ROI：
1. 梳理双方分歧焦点与核心论据；
2. 输出客观的《架构决策权衡矩阵 (Trade-off Matrix)》；
3. 给出建议采纳方案或重构要求（若人类开发者持有最终裁决法槌，你的分析将作为定案的核心依据）。
无需在正文 @ 任何人。

【主导方案】:
${topic.targetProposalText || '详见前序脉络'}

【挑战反例】:
${topic.targetChallengeText || '详见前序脉络'}`;
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
      gameRoleAddon = `\n【你的博弈定位】: 🏛️ 主导者 (Proposer)。请主导技术方案的架构设计与关键路径，并就挑战者提出的质疑进行技术抗辩与落地修正。无需手动 @，平台将自动流转。`;
    } else if (role === 'challenger') {
      gameRoleAddon = `\n【你的博弈定位】: ⚔️ 挑战者 (Challenger)。请执行对抗性挑错，寻找极端边界缺陷与隐藏风险，拒绝盲目认同。无需手动 @，平台将自动流转。`;
    } else if (role === 'arbiter') {
      gameRoleAddon = `\n【你的博弈定位】: ⚖️ 中立仲裁者 (Arbiter)。请评估主导与挑战双方论据，提炼权衡矩阵，提供公正客观的仲裁裁决建议。无需手动 @。`;
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

