/**
 * CognoNexus LMAD 局部冲突定位器与上下文脱水器 (Local Multi-Agent Debate & Context Dehydrator)
 * 支撑 R-5 要求：
 * 1. AST 级 Claim 语义抽取（严禁纯标题/过渡句空壳，达到 top-5 外壳=0）
 * 2. 三态事实脱水模型 (supported | disputed | refuted)
 * 3. 误删告警机制 (Prune Alert)
 */

import {
  ArgumentNode,
  ChallengeCritiquePayload,
  DisputeSpanPacket,
  GroundingEvidence,
  ProposalClaimItem,
  ProposalClaimsPayload,
  RootCauseCategory,
} from '../../types';
import {
  extractChallengeCritiqueFromAcpResponse,
  extractProposalClaimsFromAcpResponse,
} from '../acpClient';
import {
  analyzeStructuredMarkdown,
  computeClaimTokenOverlap,
  extractTechnicalTermSet,
  splitClauses,
} from './structuredTextAnalyzer';

// 无实义外壳标题与过渡词确定性词典（零正则）
const BOILERPLATE_HEADING_SET = new Set([
  '架构总览',
  '方案设计',
  '技术方案',
  '背景介绍',
  '概述',
  '总结',
  '具体方案如下',
  '核心思路',
  '方案如下',
  '步骤如下',
  '如下所示',
  '第一部分',
  '第二部分',
  '核心组件',
  '引言',
  '目录',
]);

const DISCOURSE_PREFIX_TOKENS = [
  '首先',
  '其次',
  '再次',
  '最后',
  '另外',
  '总的来说',
  '综上所述',
  '也就是说',
  '可以看到',
  '如下图所示',
  '我们认为',
  '显然',
  '由上可知',
  '具体而言',
  '众所周知',
] as const;

const SUBJECT_PREFIX_TOKENS = ['我们', '本方案', '系统', '平台', '设计', '本案', '架构'] as const;

// 核心技术断言动词特征（必须包含至少一个实质性架构动词或约束词）
const ASSERTION_VERBS = [
  '采用',
  '选用',
  '引入',
  '基于',
  '设计为',
  '构建',
  '实现',
  '保证',
  '确保',
  '防止',
  '降低',
  '提升',
  '支持',
  '约束',
  '封装',
  '解耦',
  '配置',
  '运行在',
  '部署于',
  '依赖于',
  '拆分为',
  '熔断',
  '持久化',
  '重试',
] as const;

const DEPENDENCY_CUES = [
  '基于',
  '依赖',
  '接着',
  '随后',
  '因此',
  '为了',
  '在此基础',
  '进而',
] as const;

const FAILURE_INDICATORS = ['失效', '崩溃', '漏洞', '隐患', '并发', '延迟', '锁'] as const;

const REFUTATION_TOKENS_LOWER = ['未通过', '证伪', 'fail', 'false', '不成立', '死锁'] as const;

const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  concurrency_race: '高并发数据竞态与事务隔离级别权衡分歧',
  network_partition: '分布式网络分区与异步重试边界假定分歧',
  resource_exhaustion: '系统底层资源边界与生命周期管理分歧',
  cost_complexity: '实现复杂度与工程运维 ROI 权衡分歧',
  architecture_coupling: '架构模块边界与接口契约假定分歧',
  security_boundary: '安全权限边界与输入校验防线分歧',
  general: '极端工况下的防御边界与资源竞争分歧',
};

const ROOT_CAUSE_TAXONOMY: ReadonlyArray<{ keywords: readonly string[]; label: string }> = [
  {
    keywords: ['网络', '超时', '抖动', '重试', '脑裂', '分区'],
    label: ROOT_CAUSE_LABELS.network_partition,
  },
  {
    keywords: ['并发', '锁', '竞态', '竞争'],
    label: ROOT_CAUSE_LABELS.concurrency_race,
  },
  {
    keywords: ['内存', '泄漏', '溢出', '句柄'],
    label: ROOT_CAUSE_LABELS.resource_exhaustion,
  },
  {
    keywords: ['成本', '复杂度', 'roi'],
    label: ROOT_CAUSE_LABELS.cost_complexity,
  },
  {
    keywords: ['权限', '鉴权', '越权', '注入', '漏洞'],
    label: ROOT_CAUSE_LABELS.security_boundary,
  },
];

const GENERIC_ASCII_ENTITY_STOPWORDS = new Set([
  'fail',
  'pass',
  'true',
  'false',
  'error',
  'warn',
  'info',
  'test',
  'json',
  'null',
  'void',
  'todo',
]);

function stripLeadingListOrHeadingPrefix(raw: string): string {
  let s = raw.trim();
  // 1. Strip markdown heading hashes (#, ##, ###)
  let hashIdx = 0;
  while (hashIdx < s.length && s[hashIdx] === '#') {
    hashIdx++;
  }
  if (hashIdx > 0) {
    s = s.slice(hashIdx).trim();
  }
  // 2. Strip unordered bullets (-, *, +)
  while (s.startsWith('- ') || s.startsWith('* ') || s.startsWith('+ ') || s.startsWith('• ')) {
    s = s.slice(2).trim();
  }
  // 3. Strip numbered markers like "1. ", "2) ", "1、" or Chinese outline "一、"
  let numEnd = 0;
  while (numEnd < s.length && numEnd < 4 && s[numEnd] >= '0' && s[numEnd] <= '9') {
    numEnd++;
  }
  if (numEnd > 0 && numEnd < s.length && (s[numEnd] === '.' || s[numEnd] === ')' || s[numEnd] === '、')) {
    if (s[numEnd] === '、' || s[numEnd + 1] === ' ' || s[numEnd + 1] === undefined) {
      s = s.slice(numEnd + 1).trim();
    }
  }
  return s;
}

function stripPairedWrapper(text: string, marker: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(marker, i)) {
      const closeIdx = text.indexOf(marker, i + marker.length);
      if (closeIdx > i + marker.length) {
        out += text.slice(i + marker.length, closeIdx);
        i = closeIdx + marker.length;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

function cleanProposalLine(para: string): string {
  let s = stripLeadingListOrHeadingPrefix(para);
  s = stripPairedWrapper(s, '**');
  s = stripPairedWrapper(s, '`');
  return s.trim();
}

function isBoilerplateHeading(cleanLine: string): boolean {
  let normalized = cleanLine.trim();
  while (normalized.endsWith(':') || normalized.endsWith('：')) {
    normalized = normalized.slice(0, -1).trim();
  }
  return BOILERPLATE_HEADING_SET.has(normalized);
}

function stripLeadingTokens(text: string, tokens: readonly string[]): string {
  let current = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of tokens) {
      if (current.startsWith(token)) {
        const rest = current.slice(token.length);
        const nextCh = rest[0];
        if (nextCh === undefined || nextCh === '，' || nextCh === ',' || nextCh === ' ' || nextCh === '：' || nextCh === ':') {
          current = rest.slice(nextCh === undefined ? 0 : 1).trim();
          while (current.startsWith('，') || current.startsWith(',') || current.startsWith(' ')) {
            current = current.slice(1).trim();
          }
          changed = true;
          break;
        }
      }
    }
  }
  return current;
}

function extractAsciiTechnicalEntities(text: string): Set<string> {
  const entities = new Set<string>();
  let buf = '';
  const flush = () => {
    if (buf.length >= 3 && !(buf[0] >= '0' && buf[0] <= '9')) {
      const lower = buf.toLowerCase();
      if (!GENERIC_ASCII_ENTITY_STOPWORDS.has(lower)) {
        entities.add(lower);
      }
    }
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isAscii =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-';
    if (isAscii) {
      buf += ch;
    } else {
      flush();
    }
  }
  flush();
  return entities;
}

function splitTargetSegments(targetText: string): string[] {
  const segments: string[] = [];
  for (const clause of splitClauses(targetText)) {
    segments.push(clause);
    const subs = clause.split(/[，,]+/).map((s) => s.trim()).filter(Boolean);
    if (subs.length > 1) {
      segments.push(...subs);
    }
  }
  return segments;
}

function scoreClaimMatchInText(claim: string, targetText: string): number {
  if (!claim || !targetText) return 0;
  const claimTerms = extractTechnicalTermSet(claim);
  const claimEntities = extractAsciiTechnicalEntities(claim);
  const segments = splitTargetSegments(targetText);
  if (segments.length === 0) return 0;

  let bestScore = 0;
  for (const seg of segments) {
    const segTerms = extractTechnicalTermSet(seg);
    let sharedTerms = 0;
    for (const term of claimTerms) {
      if (segTerms.has(term)) sharedTerms++;
    }
    const segEntities = extractAsciiTechnicalEntities(seg);
    let sharedEntities = 0;
    for (const ent of claimEntities) {
      if (segEntities.has(ent)) sharedEntities++;
    }
    const overlap = computeClaimTokenOverlap(claim, seg);
    const segmentScore =
      overlap +
      sharedEntities * 0.25 +
      (sharedTerms >= 3 ? 0.25 : 0);
    if (segmentScore > bestScore) {
      bestScore = segmentScore;
    }
  }
  return Number(bestScore.toFixed(4));
}

function isClaimMatchedInText(claim: string, targetText: string): boolean {
  if (!claim || !targetText) return false;
  const claimTerms = extractTechnicalTermSet(claim);
  const claimEntities = extractAsciiTechnicalEntities(claim);
  const segments = splitTargetSegments(targetText);

  for (const seg of segments) {
    const segTerms = extractTechnicalTermSet(seg);
    let sharedTerms = 0;
    for (const term of claimTerms) {
      if (segTerms.has(term)) sharedTerms++;
    }
    const segEntities = extractAsciiTechnicalEntities(seg);
    let sharedEntities = 0;
    for (const ent of claimEntities) {
      if (segEntities.has(ent)) sharedEntities++;
    }
    if (sharedEntities >= 2) return true;
    if (sharedEntities >= 1 && (sharedTerms >= 2 || claimEntities.size === 1)) return true;
    if (sharedTerms >= 3) return true;
    if (sharedTerms >= 2 && computeClaimTokenOverlap(claim, seg) >= 0.30) return true;
  }
  return false;
}

function findBestMatchingArgumentNode(
  nodes: ArgumentNode[],
  targetText: string,
  preferredIds?: string[]
): ArgumentNode | undefined {
  if (nodes.length === 0) return undefined;
  if (preferredIds && preferredIds.length > 0) {
    for (const pid of preferredIds) {
      const exact = nodes.find((n) => n.id === pid);
      if (exact) return exact;
    }
  }
  let bestNode: ArgumentNode | undefined;
  let bestScore = 0;
  for (const node of nodes) {
    const score = scoreClaimMatchInText(node.claim, targetText);
    if (score > bestScore && score >= 0.28) {
      bestScore = score;
      bestNode = node;
    }
  }
  return bestNode;
}

function resolveStructuredProposalClaims(
  proposalText: string,
  structuredClaims?: ProposalClaimItem[] | ProposalClaimsPayload | null
): { claims: ProposalClaimItem[]; cleanedText: string } {
  const extracted = extractProposalClaimsFromAcpResponse({ textResponse: proposalText || '' });
  const cleanedText = extracted.cleanedText || proposalText || '';

  if (Array.isArray(structuredClaims)) {
    return { claims: structuredClaims, cleanedText };
  }
  if (structuredClaims && Array.isArray(structuredClaims.claims)) {
    return { claims: structuredClaims.claims, cleanedText };
  }
  if (extracted.proposalPayload && Array.isArray(extracted.proposalPayload.claims)) {
    return { claims: extracted.proposalPayload.claims, cleanedText };
  }
  return { claims: [], cleanedText };
}

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
 * 将提案文本或结构化 submit_proposal_claims 契约解构为离散的技术论点节点列表 (Argument Nodes)
 * 过滤空壳导语与纯标题，只抽取具备因果断言特征的技术命题 (外壳=0)
 */
export function extractArgumentNodes(
  proposalText: string,
  authorId?: string,
  authorName?: string,
  structuredClaims?: ProposalClaimItem[] | ProposalClaimsPayload | null
): ArgumentNode[] {
  const { claims: explicitClaims, cleanedText } = resolveStructuredProposalClaims(
    proposalText || '',
    structuredClaims
  );
  if (explicitClaims.length > 0) {
    const mappedNodes: ArgumentNode[] = explicitClaims
      .filter((item) => item && typeof item.claim === 'string' && item.claim.trim().length > 0)
      .slice(0, 5)
      .map((item, idx) => ({
        id: item.claimId?.trim() || `arg-node-${idx + 1}`,
        authorId,
        authorName,
        claim: item.claim.trim(),
        assumptions:
          Array.isArray(item.assumptions) && item.assumptions.length > 0
            ? item.assumptions
            : ['默认系统在标准网络与吞吐 SLA 范围内运行'],
        confidence:
          typeof item.confidence === 'number' && Number.isFinite(item.confidence)
            ? Math.max(0.1, Math.min(1.0, item.confidence))
            : 0.90,
        status: 'supported',
        dependencies: Array.isArray(item.dependsOnClaimIds) ? item.dependsOnClaimIds : undefined,
      }));
    if (mappedNodes.length > 0) {
      return buildArgumentDag(mappedNodes, cleanedText);
    }
  }

  if (!proposalText || proposalText.trim().length === 0) {
    return [];
  }

  const ast = analyzeStructuredMarkdown(cleanedText);
  const nodes: ArgumentNode[] = [];
  const rawParagraphs = cleanedText
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  let nodeIndex = 1;
  for (const para of rawParagraphs) {
    const cleanLine = cleanProposalLine(para);
    if (cleanLine.length < 12) continue;

    // 2. 过滤纯框架/过渡外壳标题
    if (isBoilerplateHeading(cleanLine)) continue;

    // 3. 按确定性句末分句切分为候选断言从句
    const clauses = splitClauses(cleanLine);

    for (const clause of clauses) {
      let strippedClause = stripLeadingTokens(clause, DISCOURSE_PREFIX_TOKENS);
      strippedClause = stripLeadingTokens(strippedClause, SUBJECT_PREFIX_TOKENS);

      const hasVerb = ASSERTION_VERBS.some((verb) => strippedClause.includes(verb));
      const hasTechnicalEvidence =
        ast.quantifiedMetricCount > 0 &&
        extractAsciiTechnicalEntities(strippedClause).size >= 1 &&
        strippedClause.includes('，');

      if (strippedClause.length >= 10 && strippedClause.length <= 160 && (hasVerb || hasTechnicalEvidence)) {
        const assumptions: string[] = [];
        if (
          strippedClause.includes('基于') ||
          strippedClause.includes('依赖') ||
          strippedClause.includes('假设') ||
          strippedClause.includes('若')
        ) {
          assumptions.push(strippedClause.slice(0, 90));
        }

        nodes.push({
          id: `arg-node-${nodeIndex++}`,
          authorId,
          authorName,
          claim: strippedClause,
          assumptions:
            assumptions.length > 0 ? assumptions : ['默认系统在标准网络与吞吐 SLA 范围内运行'],
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
      const cleanLine = stripLeadingTokens(cleanProposalLine(para), DISCOURSE_PREFIX_TOKENS);
      if (cleanLine.length >= 15 && !isBoilerplateHeading(cleanLine)) {
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

  return buildArgumentDag(nodes, cleanedText);
}

/**
 * 基于文本语义与因果推导构建论点有向无环图 (Claim DAG, P1-1)
 */
export function buildArgumentDag(nodes: ArgumentNode[], _proposalText: string): ArgumentNode[] {
  if (nodes.length <= 1) {
    return nodes.map((n) => ({ ...n, depth: 0, dependencies: [], impactScore: 1.0 }));
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // 1. 优先保留结构化契约显式声明的依赖边，其次依据因果词元推导前置依赖
  const idToDeps = new Map<string, string[]>();

  nodes.forEach((n, idx) => {
    const explicitDeps = Array.isArray(n.dependencies)
      ? n.dependencies.filter((depId) => depId !== n.id && nodeIdSet.has(depId))
      : [];
    if (explicitDeps.length > 0) {
      idToDeps.set(n.id, Array.from(new Set(explicitDeps)));
      return;
    }

    const deps: string[] = [];
    const claimLower = n.claim.toLowerCase();
    const hasDependencyCue = DEPENDENCY_CUES.some((cue) => claimLower.includes(cue));

    if (hasDependencyCue && idx > 0) {
      let bestParentId: string | undefined;
      let bestOverlap = 0;
      for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
        const prevNode = nodes[prevIdx];
        const overlap = computeClaimTokenOverlap(prevNode.claim, n.claim);
        if (overlap > bestOverlap && overlap >= 0.08) {
          bestOverlap = overlap;
          bestParentId = prevNode.id;
        }
      }

      if (bestParentId) {
        deps.push(bestParentId);
      } else {
        deps.push(nodes[idx - 1].id);
      }
    } else if (idx > 0 && idx % 2 === 1 && !deps.includes(nodes[idx - 1].id)) {
      const prevNode = nodes[idx - 1];
      if (computeClaimTokenOverlap(prevNode.claim, n.claim) >= 0.25) {
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

function classifyRootCauseLabel(
  cleanedCritique: string,
  critiquePayload?: ChallengeCritiquePayload | null
): string {
  if (critiquePayload?.rootCauseCategory) {
    const rawCat = critiquePayload.rootCauseCategory;
    if (rawCat === 'general' && critiquePayload.summary) {
      return critiquePayload.summary.slice(0, 120);
    }
    if (rawCat in ROOT_CAUSE_LABELS) {
      return ROOT_CAUSE_LABELS[rawCat as RootCauseCategory];
    }
    return ROOT_CAUSE_LABELS.general;
  }
  const lower = cleanedCritique.toLowerCase();
  for (const entry of ROOT_CAUSE_TAXONOMY) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.label;
    }
  }
  return ROOT_CAUSE_LABELS.general;
}

function resolveCritiqueInput(
  critiqueText: string,
  explicitPayload?: ChallengeCritiquePayload | null
): { payload?: ChallengeCritiquePayload; cleanedCritique: string } {
  if (explicitPayload) {
    const { cleanedText } = extractChallengeCritiqueFromAcpResponse({
      textResponse: critiqueText || '',
    });
    return { payload: explicitPayload, cleanedCritique: cleanedText || critiqueText || '' };
  }
  if (!critiqueText || !critiqueText.trim()) {
    return { payload: undefined, cleanedCritique: '' };
  }
  const extracted = extractChallengeCritiqueFromAcpResponse({ textResponse: critiqueText });
  return {
    payload: extracted.critiquePayload,
    cleanedCritique: extracted.cleanedText || critiqueText,
  };
}

function hasTextRefutationSignal(vText: string): boolean {
  if (!vText) return false;
  const lower = vText.toLowerCase();
  return REFUTATION_TOKENS_LOWER.some((tok) => lower.includes(tok));
}

/**
 * 局部冲突定位：优先消费结构化 submit_challenge_critique 契约，其次基于技术词元重合定位最早冲突切片
 */
export function localizeEarliestDispute(
  _proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[],
  critiquePayload?: ChallengeCritiquePayload | null
): DisputeSpanPacket {
  const defaultDisputeId = `dsp-${Date.now()}`;
  const { payload, cleanedCritique } = resolveCritiqueInput(critiqueText, critiquePayload);

  if ((!cleanedCritique || cleanedCritique.trim().length === 0) && !payload) {
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

  const ast = analyzeStructuredMarkdown(cleanedCritique);
  const candidateLines = [
    ...(payload?.failureScenarios || []),
    ...(payload?.fatalFlaws || []),
    ...ast.listItems,
    ...cleanedCritique.split('\n').map((l) => l.trim()).filter(Boolean),
  ];
  const failureLine =
    payload?.failureScenarios?.[0] ||
    payload?.fatalFlaws?.[0] ||
    candidateLines.find((l) => FAILURE_INDICATORS.some((ind) => l.includes(ind))) ||
    payload?.summary ||
    candidateLines[0] ||
    '红队指出极端工况下的并发竞争与故障风险';

  const hitNode =
    findBestMatchingArgumentNode(argumentNodes, cleanedCritique, payload?.disputedClaimIds) ||
    argumentNodes[0];

  const proposerClaim = hitNode ? hitNode.claim : '提案官提出的核心组件选型与时序设计';
  const challengerCritique = cleanProposalLine(failureLine).slice(0, 150);
  const rootCause = classifyRootCauseLabel(cleanedCritique, payload);

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
  verificationText?: string,
  options?: {
    critiquePayload?: ChallengeCritiquePayload | null;
    evidences?: GroundingEvidence[];
  }
): ArgumentNode[] {
  const result = dehydrateContextWithAlert(
    proposalText,
    critiqueText,
    argumentNodes,
    verificationText,
    options
  );
  return result.committedStates;
}

/**
 * 完整三态脱水与误删告警计算器 (R-5)
 * 优先依据结构化 disputedClaimIds 与 GroundingEvidence.claimId 精准映射，消除 4-gram 与截断误伤
 */
export function dehydrateContextWithAlert(
  _proposalText: string,
  critiqueText: string,
  argumentNodes: ArgumentNode[],
  verificationText?: string,
  options?: {
    critiquePayload?: ChallengeCritiquePayload | null;
    evidences?: GroundingEvidence[];
  }
): DehydrationResult {
  const vText = verificationText || '';
  const { payload, cleanedCritique } = resolveCritiqueInput(critiqueText || '', options?.critiquePayload);
  const disputedIdSet = new Set(payload?.disputedClaimIds || []);
  const evidences = options?.evidences || [];

  const hasRefutationVerdict = hasTextRefutationSignal(vText);

  const updatedNodes = argumentNodes.map((node) => {
    const isChallenged =
      disputedIdSet.size > 0
        ? disputedIdSet.has(node.id)
        : isClaimMatchedInText(node.claim, cleanedCritique);

    const hasExplicitRefutingEvidence = evidences.some(
      (ev) =>
        !ev.truthValue &&
        (ev.claimId === node.id ||
          (!ev.claimId && isClaimMatchedInText(node.claim, `${ev.verifierReport} ${ev.inputQueryOrCode}`)))
    );

    const isMentionedInVerification =
      hasExplicitRefutingEvidence || isClaimMatchedInText(node.claim, vText);

    const isRefuted =
      hasExplicitRefutingEvidence || (isChallenged && hasRefutationVerdict && isMentionedInVerification);

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
 * 比较立论 DAG 与反例批判点，优先锚定结构化 disputed_claim_ids / targetClaimId，
 * 再通过确定性词元重叠与有向图逆向追溯定位根源节点 (Root Cause Node)。
 */
export function localizeGraphDiffDispute(
  proposalNodes: ArgumentNode[],
  critiqueText: string,
  _defenseText?: string,
  targetClaimId?: string,
  critiquePayload?: ChallengeCritiquePayload | null
): DisputeSpanPacket {
  const { payload, cleanedCritique } = resolveCritiqueInput(critiqueText || '', critiquePayload);
  const baseDispute = localizeEarliestDispute(
    proposalNodes.map((n) => n.claim).join('\n'),
    cleanedCritique,
    proposalNodes,
    payload
  );

  if (proposalNodes.length === 0) {
    return baseDispute;
  }

  const preferredIds: string[] = [];
  if (targetClaimId) preferredIds.push(targetClaimId);
  if (payload?.disputedClaimIds?.length) preferredIds.push(...payload.disputedClaimIds);

  // 0 & 1. 优先显式 ID 锚定，其次基于技术词元重合定位直接被批判命中的论点节点
  let matchedNode = findBestMatchingArgumentNode(proposalNodes, cleanedCritique, preferredIds);
  if (!matchedNode && targetClaimId) {
    matchedNode = proposalNodes.find(
      (n) => n.id === targetClaimId || isClaimMatchedInText(n.claim, targetClaimId)
    );
  }

  const directHitNode = matchedNode || proposalNodes[0];

  // 2. 图差分因果溯源：向上寻找因果根源节点 (Root Cause Node)
  let rootDisputeNode = directHitNode;
  const nodeMap = new Map<string, ArgumentNode>();
  proposalNodes.forEach((n) => nodeMap.set(n.id, n));
  const disputedIdSet = new Set(payload?.disputedClaimIds || []);

  let curr = directHitNode;
  while (curr.dependencies && curr.dependencies.length > 0) {
    const parentId = curr.dependencies[0];
    const parentNode = nodeMap.get(parentId);
    if (!parentNode) break;

    const isParentCritiqued =
      disputedIdSet.has(parentNode.id) ||
      isClaimMatchedInText(parentNode.claim, cleanedCritique) ||
      (parentNode.assumptions || []).some((a) => computeClaimTokenOverlap(a, cleanedCritique) >= 0.30);

    if (isParentCritiqued || cleanedCritique.includes('前提') || cleanedCritique.includes('根本')) {
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

