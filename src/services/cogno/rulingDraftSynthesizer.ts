/**
 * CognoNexus 仲裁定案裁决草案多模式动态合成与解析器 (Ruling Draft Synthesizer)
 *
 * 核心机制：
 * 1. 动态趋真生成：裁决书草案必须且只能基于前序真实立论 (Proposal)、反例压测 (Challenge)、
 *    接地实证 (Verification)、防御答辩 (Defense) 及 MCDA 权衡运筹事实生成，严禁使用刻板写死模板；
 * 2. 覆盖 3 种模式全集：为采纳主导 (adopt_proposer)、驳回重构 (reject_rebuild)、权衡矩阵 (trade_off_matrix)
 *    均提供基于当前议题真实交锋脉络的高保真草案选项；
 * 3. 人类决策开放性：在法槌控制台中不仅按模式展示 AI 生成的针对性草案，更支持人类首席仲裁官自由定制修改，
 *    各模式独立保留定制状态并支持一键恢复 AI 草案。
 */

import {
  ArbitrationRulingDraft,
  ArgumentNode,
  ChallengeCritiquePayload,
  DefensePatchPayload,
  McdaDecisionPayload,
  ModularOrchestrationState,
  ProposalClaimsPayload,
  RulingDecisionType,
} from '../../types';
import {
  extractMcpToolCallArguments,
  extractStructuredContractEnvelope,
  matchesMcpToolName,
  normalizeMcdaMatrixInput,
} from '../acpClient';
import {
  analyzeStructuredMarkdown,
  extractFilePathsFromTextSegment,
} from './structuredTextAnalyzer';

const CORE_CLAIM_KEYWORDS = [
  '架构',
  '方案',
  '设计',
  '重构',
  '单点',
  '并发',
  '延迟',
  '一致性',
  '缓存',
  '数据库',
  '安全',
  '异常',
  '幂等',
  '分区',
  '内存',
  '接口',
  '死锁',
  '解耦',
  '补偿',
] as const;

const MARKDOWN_INLINE_DECORATORS = new Set(['#', '*', '`', '_']);

function stripMarkdownChars(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!MARKDOWN_INLINE_DECORATORS.has(ch)) {
      out += ch;
    }
  }
  return out.trim();
}

/**
 * 从长文本中基于确定性 AST 与关键词表提取核心技术主张与论据切片，剔除 Markdown 标题、多余空行及礼貌套话
 */
export function extractCoreClaims(text?: string, maxLen = 140): string {
  if (!text || !text.trim()) return '';
  const ast = analyzeStructuredMarkdown(text);
  const rawLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('>'));

  const candidates = Array.from(
    new Set([...ast.listItems, ...ast.sentences, ...rawLines].filter(Boolean))
  );

  const keywordLine = candidates.find((l) =>
    CORE_CLAIM_KEYWORDS.some((kw) => l.includes(kw))
  );

  const candidate = stripMarkdownChars(keywordLine || candidates[0] || '');
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, maxLen).trim() + '...';
}

/**
 * 从显式受影响路径列表与研讨文本 AST 中确定性提取涉案文件路径
 */
export function extractImpactedFilesFromDebate(
  texts: (string | undefined)[],
  explicitFiles?: string[]
): string[] {
  const fileSet = new Set<string>();
  if (Array.isArray(explicitFiles)) {
    for (const f of explicitFiles) {
      const clean = String(f || '').trim();
      if (clean && !clean.includes('node_modules') && !clean.includes('dist/')) {
        fileSet.add(clean);
      }
    }
  }
  for (const text of texts) {
    if (!text) continue;
    for (const p of extractFilePathsFromTextSegment(text)) {
      if (p.includes('/') && !p.includes('node_modules') && !p.includes('dist/')) {
        fileSet.add(p);
      }
    }
  }
  return Array.from(fileSet).slice(0, 8);
}

/**
 * 基于议题的真实立论、反例、答辩、实证与 MCDA 运筹事实（优先结构化 MCP 契约载荷），
 * 动态合成涵盖 3 种模式 (adopt_proposer, reject_rebuild, trade_off_matrix) 的裁决草案字典。
 */
export function synthesizeContextGroundedRulingDrafts(options: {
  topicTitle: string;
  topicDescription?: string;
  proposalText?: string;
  critiqueText?: string;
  defenseText?: string;
  verificationText?: string;
  mcdaPayload?: McdaDecisionPayload;
  authorName?: string;
  existingDraft?: ArbitrationRulingDraft;
  existingOptions?: Partial<Record<RulingDecisionType, ArbitrationRulingDraft>>;
  proposalPayload?: ProposalClaimsPayload | null;
  critiquePayload?: ChallengeCritiquePayload | null;
  defensePayload?: DefensePatchPayload | null;
  argumentNodes?: ArgumentNode[];
  modularState?: ModularOrchestrationState;
}): Record<RulingDecisionType, ArbitrationRulingDraft> {
  const {
    topicTitle,
    topicDescription = '',
    proposalText = '',
    critiqueText = '',
    defenseText = '',
    verificationText = '',
    mcdaPayload,
    authorName,
    existingDraft,
    existingOptions = {},
    proposalPayload,
    critiquePayload,
    defensePayload,
    argumentNodes,
    modularState,
  } = options;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const proposalClaim =
    proposalPayload?.summary ||
    proposalPayload?.claims?.[0]?.claim ||
    argumentNodes?.[0]?.claim ||
    extractCoreClaims(proposalText) ||
    topicTitle;

  const critiqueClaim =
    critiquePayload?.failureScenarios?.[0] ||
    critiquePayload?.fatalFlaws?.[0] ||
    critiquePayload?.summary ||
    extractCoreClaims(critiqueText) ||
    '边界极端工况下的容灾与状态一致性隐患';

  const defenseClaim =
    defensePayload?.defensePatches?.[0] ||
    defensePayload?.summary ||
    extractCoreClaims(defenseText) ||
    '针对反例质询补齐前置防御与补偿约束';

  const verificationClaim = extractCoreClaims(verificationText);

  const explicitFiles: string[] = [
    ...(proposalPayload?.impactedFiles || []),
    ...(defensePayload?.impactedFiles || []),
    ...(modularState?.modules?.flatMap((m) => m.allowedFiles || []) || []),
  ];

  const debateImpactedFiles = extractImpactedFilesFromDebate(
    [proposalText, critiqueText, defenseText, verificationText, topicDescription],
    explicitFiles
  );

  // 从 MCDA 运筹求解中提取最高权重与最低权重的折中准则
  const mcdaTradeOffs: string[] = [];
  if (mcdaPayload?.criteria && mcdaPayload.criteria.length >= 2 && mcdaPayload.computedWeights) {
    const sorted = [...mcdaPayload.criteria]
      .map((c) => ({ name: c.name, weight: mcdaPayload.computedWeights[c.id] ?? 0 }))
      .sort((a, b) => b.weight - a.weight);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top && bottom && top.name !== bottom.name) {
      mcdaTradeOffs.push(
        `运筹 BWM 求解权重：优先保障【${top.name}】(${(top.weight * 100).toFixed(0)}%)，适度平衡【${bottom.name}】(${(bottom.weight * 100).toFixed(0)}%)`
      );
    }
  }

  // 1. 采纳主导方案 (adopt_proposer)
  const adoptDraft: ArbitrationRulingDraft = existingOptions.adopt_proposer ||
    (existingDraft?.decisionType === 'adopt_proposer' ? existingDraft : {
      decisionType: 'adopt_proposer',
      summary: `经博弈攻防审议与工程评估，准予采纳围绕“${topicTitle}”的主导架构方案；提案方在答辩修正中已针对红队反例有效补齐了防御防线（${defenseClaim}），整体具备落地交付可行性。`,
      solution: `准予合并落地：全面执行提案方确立的核心设计路径（${proposalClaim}）；落地责任人须严格遵循答辩补丁中确认的防御性校验规则，并在工作区配置运行期健康监控探针。`,
      tradeOffPoints: [
        `优先保障核心主线功能投产与研发吞吐效率，以防御补丁吸收边缘性能开销`,
        `严格落地防御答辩中承诺的异常拦截机制，防范红队提出的【${critiqueClaim}】工况`,
        ...(mcdaTradeOffs.length > 0 ? [mcdaTradeOffs[0]] : []),
      ],
      impactedFiles: debateImpactedFiles.length > 0 ? debateImpactedFiles : ['src/index.ts'],
      submittedBy: authorName,
      submittedAt: now,
    });

  // 2. 采纳挑战 / 驳回重构 (reject_rebuild)
  const rejectDraft: ArbitrationRulingDraft = existingOptions.reject_rebuild ||
    (existingDraft?.decisionType === 'reject_rebuild' ? existingDraft : {
      decisionType: 'reject_rebuild',
      summary: `红队反例质询与实证检验揭示原方案在【${critiqueClaim}】存在关键安全隐患或单点失效脆弱性${verificationClaim ? `（实证：${verificationClaim}）` : ''}；答辩补丁不足以彻底消除系统性风险，决定驳回原提案架构并责令推翻重构。`,
      solution: `驳回原案架构指引：推倒当前脆弱的单点架构；责任团队须以红队反例揭示的【${critiqueClaim}】为基础安全假设，重新构建高容灾与防御性架构，重新确立系统不变量并提交全新立论方案。`,
      tradeOffPoints: [
        `坚决拒绝以牺牲系统健壮性与数据正确性为代价的局部优化，强制推倒单点失效架构`,
        `推倒重构期间冻结相关生产变更，优先重塑高可靠基线与容灾重试假设`,
        ...(mcdaTradeOffs.length > 0 ? [mcdaTradeOffs[0]] : []),
      ],
      impactedFiles: debateImpactedFiles.length > 0 ? debateImpactedFiles : ['src/index.ts'],
      submittedBy: authorName,
      submittedAt: now,
    });

  // 3. 权衡矩阵 / 折中演进 (trade_off_matrix)
  const tradeOffDraft: ArbitrationRulingDraft = existingOptions.trade_off_matrix ||
    (existingDraft?.decisionType === 'trade_off_matrix' ? existingDraft : {
      decisionType: 'trade_off_matrix',
      summary: `两造各有核心技术权衡：立论方案具备交付价值（${proposalClaim}），红队反例揭示了重要边界缺陷（${critiqueClaim}）。依据运筹权衡矩阵实施折中演进方案，分阶段平稳推进。`,
      solution: `分阶段折中演进实施路径：第一阶段按提案基线交付核心功能通路（${proposalClaim}）并布设监控探针；第二阶段强制合入红队要求的全量防御补偿与容灾审计机制（${defenseClaim}），兼顾业务迭代与系统稳定性。`,
      tradeOffPoints: [
        `第一阶段优先交付核心基准业务流，沉淀基础能力并收集压测监控指标`,
        `第二阶段强化边界防护与补偿容灾，限期闭环红队指出的隐患`,
        ...(mcdaTradeOffs.length > 0 ? mcdaTradeOffs : [`兼顾核心功能投产时效与生产环境高可用韧性需求`]),
      ],
      impactedFiles: debateImpactedFiles.length > 0 ? debateImpactedFiles : ['src/index.ts'],
      submittedBy: authorName,
      submittedAt: now,
    });

  return {
    adopt_proposer: adoptDraft,
    reject_rebuild: rejectDraft,
    trade_off_matrix: tradeOffDraft,
  };
}

/**
 * 校验并规范化单一 ArbitrationRulingDraft 对象
 */
export function normalizeSingleRulingDraft(
  raw: any,
  fallbackType: RulingDecisionType = 'trade_off_matrix',
  authorName?: string
): ArbitrationRulingDraft | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const rawDecision = raw.decision_type || raw.decisionType || fallbackType;
  const validDecision: RulingDecisionType =
    rawDecision === 'adopt_proposer' || rawDecision === 'reject_rebuild' || rawDecision === 'trade_off_matrix'
      ? rawDecision
      : fallbackType;

  const summary = String(raw.summary || '').trim();
  if (!summary) return undefined;

  const tradeOffs = Array.isArray(raw.trade_off_points || raw.tradeOffPoints)
    ? (raw.trade_off_points || raw.tradeOffPoints).map(String).filter((s: string) => s.trim().length > 0)
    : [];

  const files = Array.isArray(raw.impacted_files || raw.impactedFiles)
    ? (raw.impacted_files || raw.impactedFiles).map(String).filter((s: string) => s.trim().length > 0)
    : typeof (raw.impacted_files || raw.impactedFiles) === 'string'
    ? (raw.impacted_files || raw.impactedFiles).split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const solution = raw.solution ? String(raw.solution).trim() : undefined;
  const mcdaMatrix = normalizeMcdaMatrixInput(raw.mcda_matrix || raw.mcdaMatrix);
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return {
    decisionType: validDecision,
    summary,
    tradeOffPoints: tradeOffs,
    impactedFiles: files,
    solution,
    mcdaMatrix,
    submittedBy: authorName || raw.submittedBy,
    submittedAt: raw.submittedAt || now,
  };
}

/**
 * 从 ACP 响应中解析综合仲裁官针对 3 种模式提供的裁决选项字典与主导推荐裁决
 */
export function extractArbitrationRulingOptionsFromAcpResponse(
  acpResp: any,
  context: {
    topicTitle: string;
    topicDescription?: string;
    proposalText?: string;
    critiqueText?: string;
    defenseText?: string;
    verificationText?: string;
    mcdaPayload?: McdaDecisionPayload;
    authorName?: string;
    proposalPayload?: ProposalClaimsPayload | null;
    critiquePayload?: ChallengeCritiquePayload | null;
    defensePayload?: DefensePatchPayload | null;
    argumentNodes?: ArgumentNode[];
    modularState?: ModularOrchestrationState;
  }
): {
  primaryDraft: ArbitrationRulingDraft;
  options: Record<RulingDecisionType, ArbitrationRulingDraft>;
} {
  const parsedOptions: Partial<Record<RulingDecisionType, ArbitrationRulingDraft>> = {};
  let recommendedType: RulingDecisionType = 'trade_off_matrix';
  let primaryDraftFromAcp: ArbitrationRulingDraft | undefined;

  // 1. 尝试从 MCP 工具调用 `submit_arbitration_ruling` 中提取
  if (acpResp && typeof acpResp === 'object') {
    const rawCalls = [
      ...(Array.isArray(acpResp.raw?.mcp_tool_calls) ? acpResp.raw.mcp_tool_calls : []),
      ...(Array.isArray(acpResp.raw?.result?.mcp_tool_calls) ? acpResp.raw.result.mcp_tool_calls : []),
      ...(Array.isArray(acpResp.mcpToolCalls) ? acpResp.mcpToolCalls : []),
    ];
    if (Array.isArray(rawCalls)) {
      const rulingCall = rawCalls.find((c: any) =>
        matchesMcpToolName(c, 'submit_arbitration_ruling')
      );
      const extractedArgs = rulingCall ? extractMcpToolCallArguments(rulingCall) : undefined;
      if (rulingCall && extractedArgs !== undefined) {
        let args = extractedArgs;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (e) {
            console.warn('[rulingDraftSynthesizer] Failed to parse JSON arguments from tool call:', e);
          }
        }
        if (args && typeof args === 'object') {
          const mainDraft = normalizeSingleRulingDraft(args, 'trade_off_matrix', context.authorName);
          if (mainDraft) {
            primaryDraftFromAcp = mainDraft;
            parsedOptions[mainDraft.decisionType] = mainDraft;
            recommendedType = mainDraft.decisionType;
          }

          const rawOpts = args.ruling_options || args.rulingOptions;
          if (rawOpts && typeof rawOpts === 'object') {
            for (const key of ['adopt_proposer', 'reject_rebuild', 'trade_off_matrix'] as RulingDecisionType[]) {
              if (rawOpts[key]) {
                const opt = normalizeSingleRulingDraft(rawOpts[key], key, context.authorName);
                if (opt) parsedOptions[key] = opt;
              }
            }
          }
        }
      }
    }
  }

  // 2. 确定性边界提取文本中的多选块 <<<RULING_DRAFT_OPTIONS>>>
  const text = acpResp?.textResponse || '';
  const multiEnvelope = extractStructuredContractEnvelope<Record<string, any>>(
    text,
    '<<<RULING_DRAFT_OPTIONS>>>',
    ['<<<RULING_DRAFT_OPTIONS_END>>>', '<<<END_RULING_DRAFT_OPTIONS>>>']
  );
  if (multiEnvelope.parsed && typeof multiEnvelope.parsed === 'object') {
    const parsed = multiEnvelope.parsed;
    if (
      parsed.recommended_type &&
      ['adopt_proposer', 'reject_rebuild', 'trade_off_matrix'].includes(parsed.recommended_type)
    ) {
      recommendedType = parsed.recommended_type;
    }
    for (const key of ['adopt_proposer', 'reject_rebuild', 'trade_off_matrix'] as RulingDecisionType[]) {
      if (parsed[key]) {
        const opt = normalizeSingleRulingDraft(parsed[key], key, context.authorName);
        if (opt) parsedOptions[key] = opt;
      }
    }
  } else if (multiEnvelope.parseError) {
    console.warn('[rulingDraftSynthesizer] Failed to parse <<<RULING_DRAFT_OPTIONS>>> block:', multiEnvelope.parseError);
  }

  // 3. 确定性边界提取单选块 <<<RULING_DRAFT>>> 或 Markdown ```json 块
  if (!primaryDraftFromAcp) {
    const singleEnvelope = extractStructuredContractEnvelope<Record<string, any>>(
      text,
      '<<<RULING_DRAFT>>>',
      ['<<<RULING_DRAFT_END>>>', '<<<END_RULING_DRAFT>>>']
    );
    let parsedSingle: Record<string, any> | undefined =
      singleEnvelope.parsed && typeof singleEnvelope.parsed === 'object'
        ? singleEnvelope.parsed
        : undefined;

    if (!parsedSingle && singleEnvelope.parseError) {
      console.warn('[rulingDraftSynthesizer] Failed to parse <<<RULING_DRAFT>>> block:', singleEnvelope.parseError);
    }

    if (!parsedSingle) {
      const ast = analyzeStructuredMarkdown(text);
      for (const block of ast.fencedCodeBlocks) {
        const lang = block.lang.trim().toLowerCase();
        if (lang && lang !== 'json' && lang !== 'jsonc') continue;
        try {
          const obj = JSON.parse(block.content.trim());
          if (obj && typeof obj === 'object' && ('decision_type' in obj || 'decisionType' in obj)) {
            parsedSingle = obj;
            break;
          }
        } catch {
          // 跳过非 JSON 代码块
        }
      }
    }

    if (parsedSingle) {
      const singleDraft = normalizeSingleRulingDraft(parsedSingle, 'trade_off_matrix', context.authorName);
      if (singleDraft) {
        primaryDraftFromAcp = singleDraft;
        parsedOptions[singleDraft.decisionType] = singleDraft;
        recommendedType = singleDraft.decisionType;
      }
    }
  }

  // 4. 将提取到的各模式草案与动态事实合成器融合，保证 3 种模式 100% 完整具备且绝无死模板
  const synthesizedOptions = synthesizeContextGroundedRulingDrafts({
    ...context,
    existingDraft: primaryDraftFromAcp,
    existingOptions: parsedOptions,
  });

  const finalPrimary = parsedOptions[recommendedType] || synthesizedOptions[recommendedType] || primaryDraftFromAcp || synthesizedOptions.trade_off_matrix;

  return {
    primaryDraft: finalPrimary,
    options: synthesizedOptions,
  };
}
