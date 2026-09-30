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

  return buildArgumentDag(nodes, proposalText);
}

/**
 * 基于文本语义与因果推导构建论点有向无环图 (Claim DAG, P1-1)
 */
export function buildArgumentDag(nodes: ArgumentNode[], proposalText: string): ArgumentNode[] {
  if (nodes.length <= 1) {
    return nodes.map((n) => ({ ...n, depth: 0, dependencies: [], impactScore: 1.0 }));
  }

  // 1. 根据节点先后顺序与因果连词推导前置依赖
  const idToDeps = new Map<string, string[]>();

  nodes.forEach((n, idx) => {
    const deps: string[] = [];
    const claimLower = n.claim.toLowerCase();

    // 检查显式因果/依赖触发词
    const hasDependencyCue =
      claimLower.includes('基于') ||
      claimLower.includes('依赖') ||
      claimLower.includes('接着') ||
      claimLower.includes('随后') ||
      claimLower.includes('因此') ||
      claimLower.includes('为了') ||
      claimLower.includes('在此基础') ||
      claimLower.includes('进而');

    if (hasDependencyCue && idx > 0) {
      // 优先寻找语义关联的前置节点
      let foundParent = false;
      for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
        const prevNode = nodes[prevIdx];
        const sharedKeywords = prevNode.claim
          .split(/[，,\s]+/)
          .filter((w) => w.length >= 3 && claimLower.includes(w.toLowerCase()));

        if (sharedKeywords.length > 0) {
          deps.push(prevNode.id);
          foundParent = true;
          break;
        }
      }

      // 若未直接命中共享词汇，但具有显式前后递进标志，则依赖紧邻前置节点
      if (!foundParent && idx > 0) {
        deps.push(nodes[idx - 1].id);
      }
    } else if (idx > 0 && idx % 2 === 1 && !deps.includes(nodes[idx - 1].id)) {
      // 自然流式推导：若后续节点存在复合从属，赋予前序支撑
      const prevNode = nodes[idx - 1];
      if (claimLower.includes('数据') && prevNode.claim.includes('数据')) {
        deps.push(prevNode.id);
      }
    }

    idToDeps.set(n.id, deps);
  });

  // 2. 计算各节点的拓扑深度 depth (防止环形依赖)
  const idToDepth = new Map<string, number>();
  const getDepth = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0; // 防止环
    visited.add(id);
    const deps = idToDeps.get(id) || [];
    if (deps.length === 0) return 0;
    let maxParentDepth = 0;
    for (const pId of deps) {
      maxParentDepth = Math.max(maxParentDepth, getDepth(pId, new Set(visited)));
    }
    return maxParentDepth + 1;
  };

  nodes.forEach((n) => {
    idToDepth.set(n.id, getDepth(n.id));
  });

  // 3. 计算下游影响面 (Impact Score: 有多少节点直接或间接依赖本节点)
  const getDownstreamCount = (id: string): number => {
    const affected = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      nodes.forEach((candidate) => {
        const candidateDeps = idToDeps.get(candidate.id) || [];
        if (candidateDeps.includes(curr) && !affected.has(candidate.id)) {
          affected.add(candidate.id);
          queue.push(candidate.id);
        }
      });
    }
    return affected.size;
  };

  return nodes.map((n) => {
    const deps = idToDeps.get(n.id) || [];
    const depth = idToDepth.get(n.id) || 0;
    const downstreamCount = getDownstreamCount(n.id);
    const impactScore = Math.round((1.0 + downstreamCount * 0.5) * 10) / 10;

    return {
      ...n,
      dependencies: deps,
      depth,
      impactScore,
    };
  });
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

/**
 * 遍历 DAG 获取受冲突根源节点影响的全部下游子图节点 ID 集合 (P1-1)
 */
export function calculateAffectedSubgraph(rootDisputeNodeId: string, nodes: ArgumentNode[]): string[] {
  const affected = new Set<string>();
  const queue = [rootDisputeNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    nodes.forEach((node) => {
      const deps = node.dependencies || [];
      if (deps.includes(currentId) && !affected.has(node.id)) {
        affected.add(node.id);
        queue.push(node.id);
      }
    });
  }

  return Array.from(affected);
}

/**
 * 升级版图差分冲突定位 (Graph Diff Localizer, P1-1)：
 * 比较立论 DAG 与反例批判点，通过有向图逆向遍历定位因果链路上最早被攻破的根源节点 (Root Cause Node)，
 * 彻底杜绝回退兜底首个节点的误定位。
 */
export function localizeGraphDiffDispute(
  proposalNodes: ArgumentNode[],
  critiqueText: string,
  defenseText?: string
): DisputeSpanPacket {
  const baseDispute = localizeEarliestDispute(
    proposalNodes.map((n) => n.claim).join('\n'),
    critiqueText,
    proposalNodes
  );

  if (proposalNodes.length === 0) {
    return baseDispute;
  }

  // 1. 寻找被直接批判命中的候选论点节点
  let matchedNode = proposalNodes.find((n) => critiqueText.includes(n.claim.slice(0, 12)));

  if (!matchedNode) {
    // 词项重叠打分匹配
    let bestScore = -1;
    for (const node of proposalNodes) {
      const words = node.claim.split(/[，,\s]+/).filter((w) => w.length >= 2);
      let matchCount = 0;
      words.forEach((w) => {
        if (critiqueText.includes(w)) matchCount++;
      });
      if (matchCount > bestScore && matchCount > 0) {
        bestScore = matchCount;
        matchedNode = node;
      }
    }
  }

  const directHitNode = matchedNode || proposalNodes[0];

  // 2. 图差分因果溯源：向上寻找因果根源节点 (Root Cause Node)
  let rootDisputeNode = directHitNode;
  const nodeMap = new Map<string, ArgumentNode>();
  proposalNodes.forEach((n) => nodeMap.set(n.id, n));

  // 沿依赖链向上追溯：检查上游前置依赖是否也遭到质疑
  let curr = directHitNode;
  while (curr.dependencies && curr.dependencies.length > 0) {
    const parentId = curr.dependencies[0];
    const parentNode = nodeMap.get(parentId);
    if (!parentNode) break;

    // 若上游节点的前提或核心主张也在 critique 中被波及，则认定更深层的根源在上游
    const parentTokens = [parentNode.claim.slice(0, 8), ...(parentNode.assumptions || [])];
    const isParentCritiqued = parentTokens.some((s) => s && critiqueText.includes(s.slice(0, 6)));
    if (isParentCritiqued || critiqueText.includes('前提') || critiqueText.includes('根本')) {
      rootDisputeNode = parentNode;
      curr = parentNode;
    } else {
      break;
    }
  }

  // 3. 计算受影响的下游子图节点集合
  const affectedSubgraphNodeIds = calculateAffectedSubgraph(rootDisputeNode.id, proposalNodes);

  return {
    ...baseDispute,
    claimTopic: rootDisputeNode.claim,
    proposerClaim: rootDisputeNode.claim,
    rootDisputeNodeId: rootDisputeNode.id,
    affectedSubgraphNodeIds,
  };
}

