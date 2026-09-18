import { Agent } from '../types';

export interface CollaborationCascade {
  cascadeId: string;
  rootMessageId: string;
  roomId: string;
  originalPrompt: string;
  depth: number; // 1 表示首位响应者，2 表示第二跳响应者，依此类推
  maxDepth: number; // 默认最大跳数限制 (如 4)
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

/**
 * 熔断检查：防止死循环、单 Agent 连续回环、超限与人工终止
 */
export function checkLoopGuard(
  cascade: CollaborationCascade,
  targetAgentId: string
): { allowed: boolean; reason?: string } {
  if (cascade.isAborted) {
    return { allowed: false, reason: '用户已手动终止多智能体协同' };
  }

  // 1. 深度限制 (Max Depth Limit)
  if (cascade.depth >= cascade.maxDepth) {
    return {
      allowed: false,
      reason: `多智能体协同已达安全轮次上限 (${cascade.maxDepth} 轮)，已触发熔断保护`,
    };
  }

  // 2. 回环频次限制 (Ping-Pong Loop Guard): 单链内同一 Agent 最多调用 2 次
  const currentCount = cascade.agentCallCounts[targetAgentId] || 0;
  if (currentCount >= 2) {
    return {
      allowed: false,
      reason: `目标 Agent 在本轮链条中已响应 ${currentCount} 次，触发回环熔断保护以避免无限循环`,
    };
  }

  return { allowed: true };
}

/**
 * 为任意提示词注入当前频道团队花名册与协同召唤指南
 * 注入【Shadow Crew 平台协同公约】：
 * 1. 明确告知 Agent 由宿主调度器负责消息路由
 * 2. 严禁且无需在本地运行工具搜索其它 Agent
 * 3. 文本中包含 @handle 即可触发级联
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
    ? `3. 【频道内 @ 协同接力】：若你需要向当前频道内的其他成员协作推演、请求代码审查或分工，**只需在你的回复文本中自然写出对方的 @handle**（例如「${exampleHandle} 请对此方案进行技术审查...」）。注意：**你只能 @ 上方【可用协同团队成员列表】中明确列出的当前频道成员，严禁 @ 任何未列出的外部 Agent**。平台的级联调度器会在你回复后自动提取有效 @ 并接力投递给目标成员！\n\n`
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
  participatingAgents?: Agent[];
  recentHistory?: Array<{ author: string; content: string; isAgent?: boolean }>;
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

  return `[📌 议题研讨推演任务 (Topic Discussion Context)]
【所属频道】: #${topic.channelName || '频道'}
【议题编号】: ${topic.topicId}
【议题标题】: ${topic.title}
【议题背景与需求目标】:
${topicDesc}
【参与研讨成员】: ${peerList}
${historySection}
【用户开题 / 本轮诉求指令】:
"${userContent}"

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
  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerList =
    peers.length > 0
      ? `\n\n[💡 协同指引：若完成本轮审查后仍需其他专家进一步研讨，可直接在正文中自然 @对方（当前频道可用：${peers.map((p) => p.handle).join(', ')}）；若方案已完备收敛，直接输出最终共识结论即可]`
      : '';

  const topicHeader = topic
    ? `【所属议题】: 【${topic.title}】 (ID: ${topic.topicId})\n【议题背景与目标】:\n${topic.description?.trim() || topic.title}\n\n`
    : '';

  // 区分：是由前序 Agent 显式点名请求代码审查，还是由用户 @all / 批量点名排队顺延陈述
  const requestSection = isQueuedByUserInput
    ? `【多智能体协同陈述 (用户排队协作)】:
用户在上述讨论中同时指派了多位成员共同陈述观点。
前序成员 (${invokingAgent.name}) 已完成其视角阐述（见上方结论）。现请基于你的专属角色定位（${targetAgent.role}${targetAgent.description ? ` - ${targetAgent.description}` : ''}）：
1. 独立给出你针对该议题的技术方案或观点，避免重复前序已明确的常识；
2. 结合前序成员的结论进行必要的补充、差异对比或共识确认；
3. 如果方案已完备收敛，可直接给出最终共识确认；若仍需特定成员深入，可继续 @ 对应成员。`
    : `【对你的协作诉求】:
${invokingAgent.name} 在上述方案中明确点名了你 (${targetAgent.handle})。
请基于你的专属角色定位（${targetAgent.role}${targetAgent.description ? ` - ${targetAgent.description}` : ''}）：
1. 对上述方案进行针对性技术审查与评估；
2. 提出你的专业补充、风险质疑或具体的落地步骤；
3. 如果结论已经成熟收敛，请给出最终共识确认；如果依然需要其他领域专家，可继续 @ 对应成员。`;

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

