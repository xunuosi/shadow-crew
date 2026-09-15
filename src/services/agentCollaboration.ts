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

  for (const agent of availableAgents) {
    if (currentAgentId && agent.id === currentAgentId) {
      continue;
    }

    const handle = agent.handle.toLowerCase();
    const name = agent.name.toLowerCase();
    
    // 匹配 @handle 或 @name 模式
    const hasHandle = handle && lowerContent.includes(handle);
    const hasAtName = name && lowerContent.includes(`@${name}`);

    if (hasHandle || hasAtName) {
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
 */
export function buildCrewRosterGuidance(
  availableAgents: Agent[],
  currentAgentId?: string
): string {
  const peers = availableAgents.filter((a) => a.id !== currentAgentId);
  if (peers.length === 0) return '';

  const list = peers
    .map((p) => `• ${p.handle} (${p.name}): ${p.role}${p.description ? ` - ${p.description}` : ''}`)
    .join('\n');

  return (
    `\n\n[👥 当前频道可用团队成员 (若需要其他专家协同，可在回复中通过 @handle 点名并说明协助诉求)]:\n` +
    list +
    `\n※ 协同规范：在你的技术分析或代码评审中，若需要特定领域专家进一步确认，可直接在正文中写明例如「请 ${peers[0].handle} 进一步验证...」`
  );
}

/**
 * 构造跨智能体协同接力的结构化提示词
 */
export function buildCascadePrompt(options: {
  targetAgent: Agent;
  invokingAgent: Agent;
  originalUserPrompt: string;
  invokingAgentReply: string;
  cascade: CollaborationCascade;
  availableAgents: Agent[];
}): string {
  const {
    targetAgent,
    invokingAgent,
    originalUserPrompt,
    invokingAgentReply,
    cascade,
    availableAgents,
  } = options;

  const currentHop = cascade.depth + 1;
  const roster = buildCrewRosterGuidance(availableAgents, targetAgent.id);

  return `[🤝 团队协同协作请求 (第 ${currentHop}/${cascade.maxDepth} 轮接力)]

【发起协同者】: ${invokingAgent.handle} (${invokingAgent.name} · ${invokingAgent.role})
【原始用户议题/需求】:
"${originalUserPrompt}"

【前序推演方案与结论】(由 ${invokingAgent.name} 产出):
"""
${invokingAgentReply}
"""

【对你的协作诉求】:
${invokingAgent.name} 在上述方案中明确点名了你 (${targetAgent.handle})。
请基于你的专属角色定位（${targetAgent.role}${targetAgent.description ? ` - ${targetAgent.description}` : ''}）：
1. 对上述方案进行针对性技术审查与评估；
2. 提出你的专业补充、风险质疑或具体的落地步骤；
3. 如果结论已经成熟收敛，请给出最终共识确认；如果依然需要其他领域专家，可继续 @ 对应成员。
${roster}`;
}
