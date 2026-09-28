/**
 * CognoNexus LMAD 局部冲突定位器与上下文脱水器 (Local Multi-Agent Debate & Context Dehydrator)
 * 从提案与质询文本中提取离散论点因果节点，定位最早冲突切片，避免全长文本累积震荡
 */

import { ArgumentNode, DisputeSpanPacket } from '../../types';

/**
 * 将长篇提案文本解构为离散的论点节点列表 (Argument Nodes)
 */
export function extractArgumentNodes(proposalText: string, authorId?: string, authorName?: string): ArgumentNode[] {
  if (!proposalText || proposalText.trim().length === 0) {
    return [];
  }

  const nodes: ArgumentNode[] = [];
  const paragraphs = proposalText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  let nodeIndex = 1;
  for (const para of paragraphs) {
    if (para.length < 15) continue;

    // 提取核心论点
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0].replace(/^[#*0-9.\-\s]+/, '');
    const claim = firstLine.slice(0, 100);

    // 提取可能的前提假设
    const assumptions: string[] = [];
    lines.forEach((line) => {
      if (line.includes('假设') || line.includes('依赖') || line.includes('基于') || line.includes('前提')) {
        assumptions.push(line.slice(0, 80));
      }
    });

    nodes.push({
      id: `arg-node-${nodeIndex++}`,
      authorId,
      authorName,
      claim,
      assumptions: assumptions.length > 0 ? assumptions : ['默认系统在常规负载与局域网网络时延范围内运行'],
      confidence: 0.88,
    });

    if (nodes.length >= 5) break; // 限制为前 5 个关键结构节点
  }

  return nodes;
}

/**
 * 局部冲突定位：比对主导立论与挑战反例，定位时序最早的冲突切片 (Dispute Span Packet)
 */
export function localizeEarliestDispute(
  proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[]
): DisputeSpanPacket {
  const defaultDisputeId = `dsp-${Date.now()}`;
  
  if (!critiqueText || critiqueText.trim().length === 0) {
    const mainNode = argumentNodes[0] || { claim: '核心方案架构设计' };
    return {
      disputeId: defaultDisputeId,
      claimTopic: mainNode.claim,
      proposerClaim: mainNode.claim,
      challengerCritique: '暂无有效反例质询',
      rootCause: '尚未形成有效对立',
      groundingStatus: 'unverified',
    };
  }

  // 检索挑战反例中的失效关键词行
  const critiqueLines = critiqueText.split('\n').map((l) => l.trim()).filter(Boolean);
  const failureLine = critiqueLines.find(
    (l) => l.includes('失效') || l.includes('崩溃') || l.includes('漏洞') || l.includes('隐患') || l.includes('并发') || l.includes('延迟')
  ) || critiqueLines[0] || '挑战方指出高并发下的竞态条件风险';

  // 寻找被命中的论点节点
  const hitNode = argumentNodes.find((n) => critiqueText.includes(n.claim.slice(0, 15))) || argumentNodes[0];

  const proposerClaim = hitNode ? hitNode.claim : '采用主导者提出的选型与组件时序';
  const challengerCritique = failureLine.replace(/^[#*0-9.\-\s]+/, '').slice(0, 150);

  // 分析根本冲突诱因 (Root Cause)
  let rootCause = '极端工况下的防御边界与资源竞争分歧';
  if (critiqueText.includes('网络') || critiqueText.includes('超时') || critiqueText.includes('抖动')) {
    rootCause = '分布式网络分区与异步重试边界假定分歧';
  } else if (critiqueText.includes('并发') || critiqueText.includes('锁') || critiqueText.includes('竞态')) {
    rootCause = '多线程并发数据竞争与事务隔离级别权衡分歧';
  } else if (critiqueText.includes('成本') || critiqueText.includes('复杂度')) {
    rootCause = '实现复杂度与运维 ROI 经济学权衡分歧';
  }

  return {
    disputeId: defaultDisputeId,
    claimTopic: hitNode ? hitNode.claim : '架构鲁棒性与极限场景设计',
    proposerClaim,
    challengerCritique,
    rootCause,
    groundingStatus: 'unverified',
  };
}

/**
 * 上下文脱水：将历史对话长文本折叠为“已承诺无争议事实列表”
 */
export function dehydrateContextToCommittedStates(
  proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[]
): ArgumentNode[] {
  // 找出挑战方没有反对的节点作为“已承诺不可变状态”
  return argumentNodes.filter((node) => {
    const isChallenged = critiqueText.includes(node.claim.slice(0, 15));
    return !isChallenged;
  });
}
