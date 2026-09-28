/**
 * CognoNexus 动态裁决草案提炼生成器 (Dynamic Ruling Draft Generator)
 * 根据博弈议题的实际研讨脉络、MCDA 运筹权重分布、LMAD 冲突切片与辩论正文，
 * 动态提取并生成专属的关键权衡折中要点 (Trade-off Matrix)、受影响文件与定案陈词。
 */

import { McdaDecisionPayload, DisputeSpanPacket } from '../../types';

export interface DynamicRulingDraftInput {
  topicTitle: string;
  topicDescription?: string;
  rulingType: 'adopt_proposer' | 'reject_rebuild' | 'trade_off_matrix';
  targetProposalContent?: string;
  targetChallengeContent?: string;
  targetVerificationContent?: string;
  targetDefenseContent?: string;
  mcdaPayload?: McdaDecisionPayload;
  currentDispute?: DisputeSpanPacket;
  messages?: Array<{ content: string; authorName?: string }>;
}

export interface DynamicRulingDraft {
  rulingSummary: string;
  rulingSolution: string;
  rulingImpactedFiles: string;
  tradeOffPoints: string[];
}

/**
 * 从多轮研讨脉络与正文中智能抽取真正涉及的代码与配置文件路径
 */
export function extractImpactedFilesFromContext(input: {
  topicDescription?: string;
  proposalText?: string;
  defenseText?: string;
  critiqueText?: string;
  messages?: Array<{ content: string }>;
}): string {
  const allTexts: string[] = [
    input.topicDescription || '',
    input.proposalText || '',
    input.defenseText || '',
    input.critiqueText || '',
    ...(input.messages || []).map((m) => m.content || ''),
  ];

  const fullCorpus = allTexts.join('\n');
  const matchedFiles = new Set<string>();

  // 匹配形式如 src/xxx/yyy.ts, internal/handler.go, crates/core/lib.rs, config.json 等
  const pathRegex = /(?:[a-zA-Z0-9_@\-]+(?:\/[a-zA-Z0-9_@\-]+)+|\b[a-zA-Z0-9_@\-]+)\.(?:ts|tsx|js|jsx|rs|go|py|json|yaml|yml|sql|sh|toml|proto)\b/g;

  // 排除虚假噪音词
  const noisyBlacklist = new Set([
    'v1.0.0', 'v2.0.0', 'omega.53', 'node.js', 'react.js', 'vue.js',
    'package.json', 'tsconfig.json', 'cargo.toml', 'dockerfile'
  ]);

  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(fullCorpus)) !== null) {
    const raw = match[0].trim();
    const lower = raw.toLowerCase();
    if (!noisyBlacklist.has(lower) && !raw.startsWith('http') && raw.length >= 4) {
      matchedFiles.add(raw);
    }
  }

  const filesArray = Array.from(matchedFiles).slice(0, 4);
  return filesArray.join(', ');
}

/**
 * 依据 MCDA 运筹排序、冲突焦点与文本语义提取关键权衡折中要点
 */
export function extractTradeOffPointsFromContext(input: {
  topicTitle: string;
  rulingType: 'adopt_proposer' | 'reject_rebuild' | 'trade_off_matrix';
  mcdaPayload?: McdaDecisionPayload;
  currentDispute?: DisputeSpanPacket;
  defenseText?: string;
  critiqueText?: string;
}): string[] {
  const points: string[] = [];
  const { topicTitle, rulingType, mcdaPayload, currentDispute, defenseText = '', critiqueText = '' } = input;

  // 1. 基于确定性 MCDA 权重分布生成权衡对 (Trade-off Criterion Pair)
  if (mcdaPayload && mcdaPayload.computedWeights && mcdaPayload.criteria && mcdaPayload.criteria.length >= 2) {
    const sortedCrit = [...mcdaPayload.criteria]
      .map((c) => ({
        id: c.id,
        name: c.name,
        weight: mcdaPayload.computedWeights[c.id] ?? 0,
      }))
      .sort((a, b) => b.weight - a.weight);

    const top = sortedCrit[0];
    const bottom = sortedCrit[sortedCrit.length - 1];

    if (top && bottom && top.id !== bottom.id) {
      const topPct = (top.weight * 100).toFixed(0);
      points.push(`优先保障【${top.name}】(确定性权重 ${topPct}%)，适度折中【${bottom.name}】开销`);
    }
  }

  // 2. 基于 LMAD 离散冲突切片与归因生成针对性约束
  if (currentDispute && currentDispute.claimTopic) {
    const topicName = currentDispute.claimTopic.slice(0, 20);
    const cause = currentDispute.rootCause ? `，归因：${currentDispute.rootCause}` : '';
    points.push(`针对【${topicName}】：平衡立论收益与反例边界${cause}`);
  }

  // 3. 从答辩或挑战文本中提取具有实操折中含义的关键策略句
  const combinedText = `${defenseText}\n${critiqueText}`;
  const semanticPatterns = [
    /以[^，。\n]{2,15}换取[^，。\n]{2,20}/g,
    /通过[^，。\n]{2,15}(?:降低|避免|保障)[^，。\n]{2,20}/g,
    /限制[^，。\n]{2,15}为[^，。\n]{1,15}/g,
    /(?:引入|补充)[^，。\n]{2,15}(?:容灾|降级|重试|幂等|补偿|死信|熔断)[^，。\n]{0,15}/g,
  ];

  for (const pat of semanticPatterns) {
    const found = combinedText.match(pat);
    if (found && found.length > 0) {
      const clean = found[0].trim();
      if (clean.length >= 6 && clean.length <= 40 && !points.includes(clean)) {
        points.push(clean);
        if (points.length >= 3) break;
      }
    }
  }

  // 4. 上下文与裁决类型自适应兜底 (保证条目丰富且贴合业务议题)
  if (points.length < 2) {
    if (rulingType === 'adopt_proposer') {
      points.push(`严格执行红队审查确立的边界前置校验，杜绝极端并发下的状态穿透`);
      points.push(`以受控的异步/降级开销，换取“${topicTitle}”主链路 99.99% 的高可用可用性`);
    } else if (rulingType === 'reject_rebuild') {
      points.push(`拒绝以牺牲系统健壮性为代价的局部优化，强制推倒单点失效架构`);
      points.push(`重新设计时必须以无状态、强隔离与全幂等为第一设计原则`);
    } else {
      points.push(`第一阶段优先交付核心基准业务流，沉淀基础能力并收集线上压测指标`);
      points.push(`第二阶段按需演进高阶容灾、旁路异步对账与自动化补偿闭环`);
    }
  }

  return Array.from(new Set(points)).slice(0, 4);
}

/**
 * 动态组装完整的裁决书草案
 */
export function generateDynamicRulingDraft(input: DynamicRulingDraftInput): DynamicRulingDraft {
  const {
    topicTitle,
    topicDescription = '',
    rulingType,
    targetProposalContent = '',
    targetChallengeContent = '',
    targetVerificationContent = '',
    targetDefenseContent = '',
    mcdaPayload,
    currentDispute,
    messages = [],
  } = input;

  const impactedFiles = extractImpactedFilesFromContext({
    topicDescription,
    proposalText: targetProposalContent,
    defenseText: targetDefenseContent,
    critiqueText: targetChallengeContent,
    messages,
  });

  const tradeOffPoints = extractTradeOffPointsFromContext({
    topicTitle,
    rulingType,
    mcdaPayload,
    currentDispute,
    defenseText: targetDefenseContent,
    critiqueText: targetChallengeContent,
  });

  let rulingSummary = '';
  let rulingSolution = '';

  if (rulingType === 'adopt_proposer') {
    rulingSummary = `经博弈推演与实证检验，围绕“${topicTitle}”的提案官方案具备落地可行性与工程优势，补充边界防护补丁后准予合并实施。`;
    rulingSolution = targetDefenseContent
      ? `采纳提案官防御补丁设计，吸收红队抗辩与实证结论，实施交付并同步建立监控告警。`
      : `采纳提案官核心架构方案，按审查标准实施交付并记录变更。`;
  } else if (rulingType === 'reject_rebuild') {
    const disputeTopic = currentDispute?.claimTopic ? `（争议焦点: ${currentDispute.claimTopic}）` : '';
    rulingSummary = `红队对抗官与接地验证官揭示“${topicTitle}”方案存在关键架构漏洞或实证证伪${disputeTopic}，原方案予以驳回重构。`;
    rulingSolution = `驳回当前提案架构。由责任团队全面吸收红队反例要点，重新确立安全假设并重新提交新版方案。`;
  } else {
    const bestCrit = mcdaPayload?.criteria?.find((c) => c.id === mcdaPayload?.bestCriterionId)?.name;
    const bestHint = bestCrit ? `以【${bestCrit}】为主导准则，` : '';
    rulingSummary = `围绕“${topicTitle}”，两造各有技术权衡。${bestHint}依据多属性权衡矩阵构建折中方案，分阶段推进演进。`;
    rulingSolution = `采纳折中权衡演进路径：第一阶段快速落地核心主线功能，第二阶段完善防御补偿与容灾审计。`;
  }

  return {
    rulingSummary,
    rulingSolution,
    rulingImpactedFiles: impactedFiles,
    tradeOffPoints,
  };
}
