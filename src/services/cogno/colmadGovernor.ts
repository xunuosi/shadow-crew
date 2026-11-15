/**
 * CognoNexus ColMAD 非零和协同事实贡献与声誉引擎 (Collaborative Fact Reward & Reputation Governor)
 * 支撑 P1-3 要求：
 * 1. 非零和协同增量事实评分器 (Fact Reward: VerifiedClaims + DiscoveredEdgeCases - RedundantPenalty)
 * 2. 动态协同声誉体系 (Pioneer, Contributor, Neutral, Redundant)
 * 3. 遏制空洞辩论话术竞争，引导多 Agent 朝向挖掘真实边界收敛
 */

import {
  Agent,
  ArgumentNode,
  ChallengeCritiquePayload,
  ColMadAgentScore,
  ColMadSessionReport,
  DefensePatchPayload,
  GameRolesConfig,
  GroundingEvidence,
  ProposalClaimsPayload,
} from '../../types';
import { computeClaimTokenOverlap } from './structuredTextAnalyzer';

// 边界极端场景触发词 (Edge Cases，确定性小写词表)
const EDGE_CASE_INDICATORS = [
  '极端工况',
  '并发击穿',
  '并发竞争',
  '高并发',
  '脑裂',
  '分区容错',
  '死锁',
  '雪崩',
  '内存泄漏',
  '空指针',
  '超时',
  '网络抖动',
  '单点故障',
  '脏读',
  '脏写',
  '重放攻击',
  '未捕获异常',
  '边界溢出',
  '降级熔断',
  'race condition',
  'deadlock',
  'split-brain',
  'edge case',
];

// 车轱辘话与低价值填充短语 (Redundant Boilerplate)
const REDUNDANT_BOILERPLATE = [
  '总的来说',
  '综上所述',
  '正如前面所说',
  '如前所述',
  '我再次重申',
  '众所周知',
  '毫无疑问',
  '显而易见',
  '毋庸置疑',
  '非常同意',
  '赞同上述所有观点',
];

function countPhraseOccurrencesCap2(lowerText: string, phraseLower: string): number {
  if (!lowerText || !phraseLower) return 0;
  let count = 0;
  let pos = 0;
  while (count < 2) {
    const idx = lowerText.indexOf(phraseLower, pos);
    if (idx < 0) break;
    count++;
    pos = idx + phraseLower.length;
  }
  return count;
}

type BoundGameRole = 'proposer' | 'challenger' | 'verifier' | 'arbiter' | 'unknown';

function resolveAgentGameRole(agent: Agent, gameRoles?: GameRolesConfig): BoundGameRole {
  if (gameRoles) {
    if (gameRoles.proposers?.includes(agent.id)) return 'proposer';
    if (gameRoles.challengers?.includes(agent.id)) return 'challenger';
    if (gameRoles.verifiers?.includes(agent.id)) return 'verifier';
    if (gameRoles.arbiters?.includes(agent.id)) return 'arbiter';
  }
  const roleStr = agent.role || '';
  const nameStr = agent.name || '';
  if (roleStr.includes('提案') || roleStr.includes('Architect') || nameStr.includes('Proposer')) {
    return 'proposer';
  }
  if (
    roleStr.includes('红队') ||
    roleStr.includes('Security') ||
    nameStr.includes('Challenger') ||
    nameStr.includes('RedTeam')
  ) {
    return 'challenger';
  }
  if (roleStr.includes('接地') || roleStr.includes('QA') || nameStr.includes('Verifier')) {
    return 'verifier';
  }
  if (roleStr.includes('仲裁') || roleStr.includes('Arbiter') || nameStr.includes('Arbiter')) {
    return 'arbiter';
  }
  return 'unknown';
}

export interface ColMadCalculationOptions {
  topicId: string;
  agents: Agent[];
  gameRoles?: GameRolesConfig;
  proposalText?: string;
  critiqueText?: string;
  verificationText?: string;
  defenseText?: string;
  argumentNodes?: ArgumentNode[];
  evidences?: GroundingEvidence[];
  proposalPayload?: ProposalClaimsPayload | null;
  critiquePayload?: ChallengeCritiquePayload | null;
  defensePayload?: DefensePatchPayload | null;
}

/**
 * 计算当期会话中所有参与 Agent 的增量事实贡献分与声誉等级
 * 优先依据 GameRolesConfig 显式身份绑定与结构化 MCP 契约载荷评分，消除正则与 handle 文本扫描猜测
 */
export function calculateColMadContributions(options: ColMadCalculationOptions): ColMadSessionReport {
  const {
    topicId,
    agents,
    gameRoles,
    proposalText = '',
    critiqueText = '',
    verificationText = '',
    defenseText = '',
    argumentNodes = [],
    evidences = [],
    proposalPayload,
    critiquePayload,
    defensePayload,
  } = options;

  const scores: Record<string, ColMadAgentScore> = {};
  const verifiedEvidences = evidences.filter((e) => e.truthValue);
  const proposalClaimIds = new Set((proposalPayload?.claims || []).map((c) => c.claimId));

  agents.forEach((agent) => {
    const roleKind = resolveAgentGameRole(agent, gameRoles);

    // 1. 确定性角色文本归属（仅按显式游戏角色绑定，不再用 @handle 子串猜测文本）
    let text = '';
    if (roleKind === 'proposer') {
      text = `${proposalText}\n${defenseText}`;
    } else if (roleKind === 'challenger') {
      text = critiqueText;
    } else if (roleKind === 'verifier') {
      text = verificationText;
    } else if (roleKind === 'arbiter') {
      text = '';
    } else {
      text = proposalText || critiqueText || '';
    }

    const lowerText = text.toLowerCase();

    // 2. 统计发现的极端边界/反例数 (Discovered Edge Cases)
    let discoveredEdgeCasesCount = 0;
    if (roleKind === 'challenger' && critiquePayload) {
      const structuredCount =
        critiquePayload.failureScenarios.length + critiquePayload.fatalFlaws.length;
      discoveredEdgeCasesCount += Math.min(4, structuredCount);
    }
    EDGE_CASE_INDICATORS.forEach((kw) => {
      discoveredEdgeCasesCount += countPhraseOccurrencesCap2(lowerText, kw.toLowerCase());
    });

    // 3. 统计贡献的已实证断言数 (Verified Claims)
    let verifiedClaimsCount = 0;
    const supportedNodes = argumentNodes.filter((n) => n.status === 'supported');

    if (roleKind === 'proposer') {
      supportedNodes.forEach((node) => {
        if (
          proposalClaimIds.has(node.id) ||
          node.authorId === agent.id ||
          (text && computeClaimTokenOverlap(node.claim, text) >= 0.45)
        ) {
          verifiedClaimsCount++;
        }
      });
      if (defensePayload && defensePayload.defensePatches.length > 0 && verifiedClaimsCount === 0) {
        const resolvedCount = defensePayload.patchedClaims.filter((c) => c.status === 'resolved').length;
        verifiedClaimsCount += Math.min(2, resolvedCount);
      }
    } else if (roleKind === 'verifier') {
      if (verifiedEvidences.length > 0) {
        verifiedClaimsCount += Math.min(3, verifiedEvidences.length);
      }
    } else {
      supportedNodes.forEach((node) => {
        if (text && computeClaimTokenOverlap(node.claim, text) >= 0.45) {
          verifiedClaimsCount++;
        }
      });
      if (verifiedEvidences.length > 0 && text.includes('实证')) {
        verifiedClaimsCount += Math.min(3, verifiedEvidences.length);
      }
    }

    // 4. 统计冗余扣分 (Redundant Penalty)
    let redundantPenalty = 0;
    REDUNDANT_BOILERPLATE.forEach((phrase) => {
      if (text.includes(phrase)) {
        redundantPenalty += 1;
      }
    });
    if (text.includes('您说得对') || text.includes('完全认同')) {
      redundantPenalty += 2;
    }
    if (roleKind === 'proposer' && defensePayload?.stance === 'full_surrender_without_patch') {
      redundantPenalty += 2;
    }

    // 非零和协同事实贡献公式：
    // FactReward = VerifiedClaims * 2.0 + DiscoveredEdgeCases * 2.5 - RedundantPenalty * 1.5
    const rawFactReward =
      verifiedClaimsCount * 2.0 + discoveredEdgeCasesCount * 2.5 - redundantPenalty * 1.5;
    const factReward = Math.round(Math.max(-5.0, Math.min(25.0, rawFactReward)) * 10) / 10;

    let reputationLevel: ColMadAgentScore['reputationLevel'] = 'neutral';
    if (factReward >= 6.0) {
      reputationLevel = 'pioneer';
    } else if (factReward >= 2.5) {
      reputationLevel = 'contributor';
    } else if (factReward < 0) {
      reputationLevel = 'redundant';
    }

    scores[agent.id] = {
      agentId: agent.id,
      agentName: agent.name,
      factReward,
      verifiedClaimsCount,
      discoveredEdgeCasesCount,
      redundantPenalty,
      reputationLevel,
    };
  });

  const leaderboard = Object.values(scores).sort((a, b) => b.factReward - a.factReward);
  const totalFactDelta = leaderboard.reduce((acc, curr) => acc + Math.max(0, curr.factReward), 0);

  return {
    topicId,
    scores,
    totalFactDelta: Math.round(totalFactDelta * 10) / 10,
    leaderboard,
    generatedAt: new Date().toISOString(),
  };
}
