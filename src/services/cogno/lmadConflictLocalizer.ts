/**
 * CognoNexus LMAD 局部冲突定位器与上下文脱水器 (Local Multi-Agent Debate & Context Dehydrator)
 * 支撑 R-5 要求：
 * 1. AST 级 Claim 语义抽取（严禁纯标题/过渡句空壳，达到 top-5 外壳=0）
 * 2. 三态事实脱水模型 (supported | disputed | refuted)
 * 3. 误删告警机制 (Prune Alert)
 */

import { ArgumentNode, DisputeSpanPacket } from '../../types';

// 无实义外壳标题与过渡词黑名单
const SHELL_PREFIX_REGEX = /^(首先|其次|再次|最后|另外|总的来说|综上所述|也就是说|可以看到|如下图所示|我们认为|显然|由上可知|具体而言|众所周知)[，,\s]*/i;
const BOILERPLATE_HEADING_REGEX = /^(架构总览|方案设计|技术方案|背景介绍|概述|总结|具体方案如下|核心思路|方案如下|步骤如下|如下所示|第一部分|第二部分|核心组件|引言|目录)[：:\s]*$/i;

// 核心技术断言动词特征（必须包含至少一个实质性架构动词或约束词）
const ASSERTION_VERB_REGEX = /(采用|选用|引入|基于|设计为|构建|实现|保证|确保|防止|降低|提升|支持|约束|封装|解耦|配置|运行在|部署于|依赖于|拆分为|熔断|持久化|重试)/;

export interface DehydrationResult {
  committedStates: ArgumentNode[];
  allNodes: ArgumentNode[];
  pruneAlert?: {
    prunedClaimCount: number;
    prunedClaims: string[];
    reason: string;
  };
}

/**
 * 将长篇提案文本解构为离散的技术论点节点列表 (Argument Nodes)
 * 过滤空壳导语与纯标题，只抽取具备因果断言特征的技术命题 (外壳=0)
 */
export function extractArgumentNodes(
  proposalText: string,
  authorId?: string,
  authorName?: string
): ArgumentNode[] {
  if (!proposalText || proposalText.trim().length === 0) {
    return [];
  }

  const nodes: ArgumentNode[] = [];
  const rawParagraphs = proposalText.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  let nodeIndex = 1;
  for (const para of rawParagraphs) {
    // 1. 去除 Markdown 格式标记
    const cleanLine = para
      .replace(/^[#*0-9.\-\s]+/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();

    if (cleanLine.length < 12) continue;

    // 2. 过滤纯框架/过渡外壳标题
    if (BOILERPLATE_HEADING_REGEX.test(cleanLine)) continue;

    // 3. 将复合段落按标点拆分为候选断言从句
    const clauses = cleanLine.split(/[。；;!?！？]+/).map((c) => c.trim()).filter(Boolean);

    for (const clause of clauses) {
      let strippedClause = clause.replace(SHELL_PREFIX_REGEX, '').trim();
      strippedClause = strippedClause.replace(/^(我们|本方案|系统|平台|设计|本案|架构)[，,\s]*/i, '').trim();
      
      // 必须满足长度下限且包含实质技术动词
      if (strippedClause.length >= 10 && strippedClause.length <= 160 && ASSERTION_VERB_REGEX.test(strippedClause)) {
        // 提取前提假设
        const assumptions: string[] = [];
        if (strippedClause.includes('基于') || strippedClause.includes('依赖') || strippedClause.includes('假设') || strippedClause.includes('若')) {
          assumptions.push(strippedClause.slice(0, 90));
        }

        nodes.push({
          id: `arg-node-${nodeIndex++}`,
          authorId,
          authorName,
          claim: strippedClause,
          assumptions: assumptions.length > 0 ? assumptions : ['默认系统在标准网络与吞吐 SLA 范围内运行'],
          confidence: 0.90,
          status: 'supported', // 初始默认自洽
        });

        if (nodes.length >= 5) break; // 严格限制前 5 个最核心的技术主张
      }
    }

    if (nodes.length >= 5) break;
  }

  // 兜底保障：若长文本中未能命中典型动词，提取有效非外壳长句
  if (nodes.length === 0) {
    for (const para of rawParagraphs) {
      const cleanLine = para.replace(/^[#*0-9.\-\s]+/, '').replace(SHELL_PREFIX_REGEX, '').trim();
      if (cleanLine.length >= 15 && !BOILERPLATE_HEADING_REGEX.test(cleanLine)) {
        nodes.push({
          id: `arg-node-1`,
          authorId,
          authorName,
          claim: cleanLine.slice(0, 100),
          assumptions: ['系统基础运行环境'],
          confidence: 0.80,
          status: 'supported',
        });
        break;
      }
    }
  }

  return nodes;
}

/**
 * 局部冲突定位：比对立论与反例，定位时序最早的冲突切片
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
    (l) => l.includes('失效') || l.includes('崩溃') || l.includes('漏洞') || l.includes('隐患') || l.includes('并发') || l.includes('延迟') || l.includes('锁')
  ) || critiqueLines[0] || '红队指出极端工况下的并发竞争与故障风险';

  // 寻找被命中的论点节点
  const hitNode = argumentNodes.find((n) => critiqueText.includes(n.claim.slice(0, 12))) || argumentNodes[0];

  const proposerClaim = hitNode ? hitNode.claim : '提案官提出的核心组件选型与时序设计';
  const challengerCritique = failureLine.replace(/^[#*0-9.\-\s]+/, '').slice(0, 150);

  // 分析根本冲突诱因 (Root Cause)
  let rootCause = '极端工况下的防御边界与资源竞争分歧';
  if (critiqueText.includes('网络') || critiqueText.includes('超时') || critiqueText.includes('抖动') || critiqueText.includes('重试')) {
    rootCause = '分布式网络分区与异步重试边界假定分歧';
  } else if (critiqueText.includes('并发') || critiqueText.includes('锁') || critiqueText.includes('竞态') || critiqueText.includes('竞争')) {
    rootCause = '高并发数据竞态与事务隔离级别权衡分歧';
  } else if (critiqueText.includes('内存') || critiqueText.includes('泄漏') || critiqueText.includes('溢出')) {
    rootCause = '系统底层资源边界与生命周期管理分歧';
  } else if (critiqueText.includes('成本') || critiqueText.includes('复杂度')) {
    rootCause = '实现复杂度与工程运维 ROI 权衡分歧';
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
 * 上下文脱水：将论点状态升级为三态模型 (supported | disputed | refuted)，并检测误删告警
 */
export function dehydrateContextToCommittedStates(
  proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[],
  verificationText?: string
): ArgumentNode[] {
  const result = dehydrateContextWithAlert(proposalText, critiqueText, argumentNodes, verificationText);
  return result.committedStates;
}

/**
 * 完整三态脱水与误删告警计算器 (R-5)
 */
export function dehydrateContextWithAlert(
  proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[],
  verificationText?: string
): DehydrationResult {
  const vText = verificationText || '';
  const cText = critiqueText || '';

  // 为每个论点赋予三态判定 (supported | disputed | refuted)
  const updatedNodes = argumentNodes.map((node) => {
    // 提取断言中的关键技术实体 (英文/数字标识符与中文 4-gram 语义切片)
    const englishTokens = node.claim.match(/[a-zA-Z0-9_-]{3,}/g) || [];
    const shingles: string[] = [];
    for (let i = 0; i <= node.claim.length - 4; i += 2) {
      shingles.push(node.claim.slice(i, i + 4));
    }

    const isChallenged = cText.includes(node.claim.slice(0, 10)) ||
      englishTokens.some((token) => cText.toLowerCase().includes(token.toLowerCase())) ||
      shingles.some((shingle) => cText.includes(shingle));
    
    // 检查验证官是否针对该断言给出了负向证伪信号
    const hasRefutationVerdict = 
      vText.includes('未通过') || 
      vText.includes('证伪') || 
      vText.includes('FAIL') || 
      vText.includes('FALSE') || 
      vText.includes('不成立') ||
      vText.includes('死锁');

    const isMentionedInVerification = 
      vText.includes(node.claim.slice(0, 8)) ||
      englishTokens.some((t) => vText.toLowerCase().includes(t.toLowerCase())) ||
      shingles.some((s) => vText.includes(s));

    const isRefuted = isChallenged && hasRefutationVerdict && isMentionedInVerification;

    let status: 'supported' | 'disputed' | 'refuted' = 'supported';
    if (isRefuted) {
      status = 'refuted';
    } else if (isChallenged) {
      status = 'disputed';
    } else {
      status = 'supported';
    }

    return {
      ...node,
      status,
    };
  });

  // 已承诺事实看板保留 supported 节点
  const committedStates = updatedNodes.filter((n) => n.status === 'supported');

  // 误删告警检测：如果处于 disputed 或 refuted 状态的关键论点在折叠后被直接遗漏，记录告警
  const disputedOrRefutedNodes = updatedNodes.filter((n) => n.status !== 'supported');
  let pruneAlert: DehydrationResult['pruneAlert'] = undefined;

  // 如果原本存在争议断言但未纳入 committed 看板，确保上层感知
  if (disputedOrRefutedNodes.length > 0 && committedStates.length === 0) {
    pruneAlert = {
      prunedClaimCount: disputedOrRefutedNodes.length,
      prunedClaims: disputedOrRefutedNodes.map((n) => n.claim),
      reason: '所有立论断言均处于争议或证伪状态，无争议事实看板暂时为空',
    };
  }

  return {
    committedStates,
    allNodes: updatedNodes,
    pruneAlert,
  };
}
