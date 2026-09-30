/**
 * CognoNexus ColMAD 非零和协同事实贡献与声誉引擎 (Collaborative Fact Reward & Reputation Governor)
 * 支撑 P1-3 要求：
 * 1. 非零和协同增量事实评分器 (Fact Reward: VerifiedClaims + DiscoveredEdgeCases - RedundantPenalty)
 * 2. 动态协同声誉体系 (Pioneer, Contributor, Neutral, Redundant)
 * 3. 遏制空洞辩论话术竞争，引导多 Agent 朝向挖掘真实边界收敛
 */

import { Agent, ArgumentNode, ColMadAgentScore, ColMadSessionReport, GroundingEvidence } from '../../types';

// 边界极端场景触发词 (Edge Cases)
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

export interface ColMadCalculationOptions {
  topicId: string;
  agents: Agent[];
  proposalText?: string;
  critiqueText?: string;
  verificationText?: string;
  defenseText?: string;
  argumentNodes?: ArgumentNode[];
  evidences?: GroundingEvidence[];
}

/**
 * 计算当期会话中所有参与 Agent 的增量事实贡献分与声誉等级
 */
export function calculateColMadContributions(options: ColMadCalculationOptions): ColMadSessionReport {
  const {
    topicId,
    agents,
    proposalText = '',
    critiqueText = '',
    verificationText = '',
    defenseText = '',
    argumentNodes = [],
    evidences = [],
  } = options;

  const scores: Record<string, ColMadAgentScore> = {};

  // 1. 建立角色与文本的映射
  const agentTexts: Record<string, string> = {};
  agents.forEach((agent) => {
    const handle = agent.handle.toLowerCase();
    const name = agent.name.toLowerCase();

    // 根据文本中提及或角色的常规职责分配文本
    let combinedText = '';
    if (proposalText.toLowerCase().includes(handle) || proposalText.toLowerCase().includes(name)) {
      combinedText += '\n' + proposalText;
    }
    if (critiqueText.toLowerCase().includes(handle) || critiqueText.toLowerCase().includes(name)) {
      combinedText += '\n' + critiqueText;
    }
    if (verificationText.toLowerCase().includes(handle) || verificationText.toLowerCase().includes(name)) {
      combinedText += '\n' + verificationText;
    }
    if (defenseText.toLowerCase().includes(handle) || defenseText.toLowerCase().includes(name)) {
      combinedText += '\n' + defenseText;
    }

    // 若未通过 handle 显式分配，基于角色默认分配
    if (!combinedText) {
      if (agent.role?.includes('提案') || agent.role?.includes('Architect') || agent.name.includes('Proposer')) {
        combinedText = proposalText + '\n' + defenseText;
      } else if (agent.role?.includes('红队') || agent.role?.includes('Security') || agent.name.includes('Challenger') || agent.name.includes('RedTeam')) {
        combinedText = critiqueText;
      } else if (agent.role?.includes('接地') || agent.role?.includes('QA') || agent.name.includes('Verifier')) {
        combinedText = verificationText;
      } else {
        combinedText = proposalText || critiqueText || '';
      }
    }

    agentTexts[agent.id] = combinedText;
  });

  // 2. 统计已验证实证断言与各 Agent 关联
  const verifiedEvidences = evidences.filter((e) => e.truthValue);
  const totalVerifiedClaims = argumentNodes.filter((n) => n.status === 'supported' && n.evidenceRefs && n.evidenceRefs.length > 0).length;

  agents.forEach((agent) => {
    const text = agentTexts[agent.id] || '';

    // 统计发现的极端边界/反例数 (Discovered Edge Cases)
    let discoveredEdgeCasesCount = 0;
    EDGE_CASE_INDICATORS.forEach((kw) => {
      const regex = new RegExp(kw, 'gi');
      const matches = text.match(regex);
      if (matches) {
        discoveredEdgeCasesCount += Math.min(2, matches.length); // 单个关键词封顶 2 次，防刷词
      }
    });

    // 统计贡献的已实证断言数 (Verified Claims)
    let verifiedClaimsCount = 0;
    argumentNodes.forEach((node) => {
      if (node.status === 'supported' && text.includes(node.claim.slice(0, 10))) {
        verifiedClaimsCount++;
      }
    });

    // 检验实证证据中是否包含该 Agent 的成果
    if (verifiedEvidences.length > 0 && (agent.role?.includes('接地') || agent.role?.includes('QA') || text.includes('实证'))) {
      verifiedClaimsCount += Math.min(3, verifiedEvidences.length);
    }

    // 统计冗余扣分 (Redundant Penalty)
    let redundantPenalty = 0;
    REDUNDANT_BOILERPLATE.forEach((phrase) => {
      if (text.includes(phrase)) {
        redundantPenalty += 1;
      }
    });
    // 重复道歉或空洞顺从额外扣分
    if (text.includes('您说得对') || text.includes('完全认同')) {
      redundantPenalty += 2;
    }

    // 非零和协同事实贡献公式：
    // FactReward = VerifiedClaims * 2.0 + DiscoveredEdgeCases * 2.5 - RedundantPenalty * 1.5
    const rawFactReward = verifiedClaimsCount * 2.0 + discoveredEdgeCasesCount * 2.5 - redundantPenalty * 1.5;
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
