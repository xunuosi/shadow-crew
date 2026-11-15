/**
 * CognoNexus 阶段契约门禁与 Self-Refine 控制服务 (Stage Contract Gate)
 * 支撑 R-1 / M4 要求（纯结构化 MCP 契约 + AST 结构解析 + 确定性路径比对，零正则启发式）：
 * 1. 优先校验各阶段原生 MCP 工具契约与 `<<<...>>>` 结构化 JSON 信封
 * 2. 文本态回退严格基于 Markdown AST 结构特征（代码块、列表、键值行、量化指标、路径）与确定性词集
 * 3. 模块边界校验完全采用规范化文件路径与非否定修改子句解析，彻底废除动态拼接 RegExp
 */

import { GameTheoreticStage, SharedInterfaceContract, TaskModuleSlice } from '../../types';
import {
  extractArbitrationRulingFromAcpResponse,
  extractChallengeCritiqueFromAcpResponse,
  extractDefensePatchFromAcpResponse,
  extractMcpToolCallArguments,
  extractModuleDecompositionFromAcpResponse,
  extractProposalClaimsFromAcpResponse,
  matchesMcpToolName,
} from '../acpClient';
import { detectSycophanticSurrender } from './sycophancyGovernor';
import {
  analyzeStructuredMarkdown,
  extractExplicitTouchedPaths,
  isTrivialAcknowledgementText,
  normalizeRepoPath,
} from './structuredTextAnalyzer';

export interface StageContractValidationResult {
  isValid: boolean;
  stage: GameTheoreticStage;
  missingRequirements: string[];
  refinePrompt?: string;
}

export interface ModuleScopeValidationResult {
  isScopeValid: boolean;
  contractViolations: number;
  violatedFiles: string[];
  violationDetails: string[];
}

export interface ModuleScopeValidationOptions {
  touchedFiles?: string[];
  mcpToolCalls?: any[];
}

export const STAGE_CONTRACT_MAX_RETRIES = 2;

const SUBSTANTIAL_STAGE_TOOLS = [
  'submit_module_decomposition',
  'submit_proposal_claims',
  'submit_challenge_critique',
  'submit_grounding_evidence',
  'verify_code_assertion',
  'check_architecture_invariant',
  'submit_defense_patch',
  'submit_execution_deliverable',
  'submit_arbitration_ruling',
];

const PROPOSAL_DESIGN_TOKENS = [
  '架构', '方案', '设计', '组件', '选型', '时序', '流程', '实现', '机制',
  '采用', '构建', '策略', '路径', '规划', '模型', '规则', '体系', '步骤',
  'architecture', 'design', 'interface', 'protocol', 'component',
];

const PROPOSAL_OUTCOME_TOKENS = [
  '目标', '保证', '性能', '可用性', '一致性', '降低', '提升', '防止', '收益',
  '效率', '成本', '增长', '安全', '合规', '可控', '保障', '质量', '延迟',
  'goal', 'benefit', 'reliability', 'consistency', 'security', 'latency',
];

const CHALLENGE_RISK_TOKENS = [
  '矛盾', '缺陷', '风险', '漏洞', '瓶颈', '竞争', '冲突', '单点', '不可逆',
  '隐患', '盲区', '失真', '亏损', '违约', 'deadlock', 'race', 'overflow',
  'leak', 'failure', 'bug', 'vulnerability', 'flaw', 'crash',
];

const CHALLENGE_ASSUMPTION_TOKENS = [
  '假设', '前提', '依赖', '默认', '如果', '假定', '理想化', '高估', '低估',
  '忽略', 'assumption', 'presume', 'precondition', 'premise',
];

const CHALLENGE_EDGE_TOKENS = [
  '极端', '边界', '并发', '超时', '断网', '穿透', '宕机', '崩溃', '延迟',
  '抖动', '脏数据', '失效', '异常', '峰值', '黑天鹅', 'edge', 'corner',
  'boundary', 'concurrency', 'timeout', 'disconnect', 'corrupt',
];

const CHALLENGE_DEMAND_TOKENS = [
  '反例', '压测', '实证', '检验', '证明', '复现', '证据', '指标', '测算',
  '算例', '用例', '核查', 'reproduce', 'verify', 'benchmark', 'assertion',
];

const VERIFICATION_VERDICT_TOKENS = [
  'pass', 'fail', 'true', 'false', 'verified', 'refuted', 'passed', 'failed',
  '通过', '未通过', '失败', '证伪', '证实', '成立', '不成立', '属实', '结论',
];

const VERIFICATION_TOOL_TOKENS = [
  'sandbox', 'ast_grep', 'ast', 'grep', 'read_file', 'cargo test', 'npm test',
  'vitest', 'jest', 'submit_grounding_evidence', 'source_tool', 'sourcetool',
  'evidences', 'truthvalue', 'truth_value', '沙箱', '工具', '测试', '命令', '测算', '实证',
];

const DEFENSE_RESPONSE_TOKENS = [
  '答辩', '回应', '补丁', '修正', '防御', '优化', '缓解', '改动', '重构',
  '兜底', '预案', '容错', '补偿', '完善', '规避', 'patch', 'fix', 'resolve',
  'mitigate', 'defense', 'refactor', 'workaround',
];

const ARBITRATION_RULING_TOKENS = [
  '仲裁', '权衡', '裁决', '采纳', '建议', '折中', '结论', '定案', '取舍',
  '优先级', '决议', 'arbitration', 'ruling', 'tradeoff', 'decision', 'adopt', 'reject',
];

function containsAnyToken(lowerText: string, tokens: string[]): boolean {
  return tokens.some((tok) => lowerText.includes(tok));
}

function hasJsonContractPayload(text: string, marker: string): boolean {
  return text.includes(marker);
}

/**
 * 校验指定阶段的 Agent 输出是否满足结构化契约规范
 */
export function validateStageContract(
  stage: GameTheoreticStage,
  text: string,
  agentName?: string,
  mcpToolCalls?: any[]
): StageContractValidationResult {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  const missingRequirements: string[] = [];

  const ast = analyzeStructuredMarkdown(trimmed);
  const hasSubstantialToolCall =
    Array.isArray(mcpToolCalls) &&
    mcpToolCalls.some((c: any) =>
      SUBSTANTIAL_STAGE_TOOLS.some((toolName) => matchesMcpToolName(c, toolName))
    );

  // 通用底线：绝不允许极短敷衍回复或空回复（原生结构化 MCP 工具已上报有效载荷时豁免正文字数）
  if (!hasSubstantialToolCall && trimmed.length < 30) {
    missingRequirements.push('回复篇幅过短 (字符数 < 30)，缺少必要的推演论证或事实细节');
  }

  if (!hasSubstantialToolCall && isTrivialAcknowledgementText(trimmed)) {
    missingRequirements.push('检测到无实义确认性敷衍回复，未提供实质性技术观点');
  }

  const hasStrongEngineeringArtifact =
    ast.fencedCodeBlocks.length > 0 ||
    (ast.filePaths.length > 0 && trimmed.length >= 60);

  switch (stage) {
    case 'decomposition': {
      const decompDraft = extractModuleDecompositionFromAcpResponse({
        textResponse: trimmed,
        mcpToolCalls,
      });
      if (decompDraft && decompDraft.modules.length >= 1) {
        break;
      }

      const hasStructuredModules =
        ast.fencedCodeBlocks.length > 0 ||
        ast.hasJsonObject ||
        hasJsonContractPayload(trimmed, '<<<MODULE_DECOMPOSITION>>>') ||
        hasJsonContractPayload(trimmed, '"modules"') ||
        ast.headings.length >= 2 ||
        ast.listItems.length >= 2;
      if (!hasStructuredModules) {
        missingRequirements.push(
          '未包含结构化模块拆解清单（请调用 submit_module_decomposition 工具或输出包含标题/列表的模块切分）'
        );
      }
      break;
    }

    case 'proposal': {
      const { proposalPayload } = extractProposalClaimsFromAcpResponse({
        textResponse: trimmed,
        mcpToolCalls,
      });
      if (proposalPayload && proposalPayload.claims.length >= 1) {
        if (!proposalPayload.summary || proposalPayload.summary.length < 10) {
          missingRequirements.push('submit_proposal_claims 缺少有效 summary 描述');
        }
        break;
      }

      if (trimmed.length < 50) {
        missingRequirements.push('立论提案篇幅不足 (字符数 < 50)');
      }

      const hasStructuredBody =
        hasStrongEngineeringArtifact ||
        ast.listItems.length >= 2 ||
        ast.headings.length >= 2 ||
        ast.keyValuePairs.length >= 2;
      const hasCoreDesign = hasStructuredBody || containsAnyToken(lower, PROPOSAL_DESIGN_TOKENS);
      const hasOutcomeOrMetrics =
        hasStrongEngineeringArtifact ||
        ast.quantifiedMetricCount > 0 ||
        containsAnyToken(lower, PROPOSAL_OUTCOME_TOKENS);

      if (!hasCoreDesign) {
        missingRequirements.push(
          '缺少结构化方案设计与核心论点（请调用 submit_proposal_claims 或提供包含方案架构机制的列表/代码块）'
        );
      }
      if (!hasOutcomeOrMetrics) {
        missingRequirements.push('缺少方案预期的量化衡量指标、收益边界或系统质量目标断言');
      }
      break;
    }

    case 'challenge': {
      const { critiquePayload } = extractChallengeCritiqueFromAcpResponse({
        textResponse: trimmed,
        mcpToolCalls,
      });
      if (critiquePayload) {
        const hasFourPillars =
          critiquePayload.fatalFlaws.length > 0 &&
          critiquePayload.hiddenAssumptions.length > 0 &&
          critiquePayload.failureScenarios.length > 0 &&
          critiquePayload.counterDemands.length > 0;
        if (hasFourPillars) {
          break;
        }
        missingRequirements.push(
          '结构化红队四部曲字段不完整（fatal_flaws, hidden_assumptions, failure_scenarios, counter_demands 均不能为空）'
        );
        break;
      }

      if (trimmed.length < 50) {
        missingRequirements.push('反例压测篇幅不足 (字符数 < 50)');
      }

      let matchedDimensions = 0;
      if (containsAnyToken(lower, CHALLENGE_RISK_TOKENS)) matchedDimensions++;
      if (containsAnyToken(lower, CHALLENGE_ASSUMPTION_TOKENS)) matchedDimensions++;
      if (containsAnyToken(lower, CHALLENGE_EDGE_TOKENS)) matchedDimensions++;
      if (containsAnyToken(lower, CHALLENGE_DEMAND_TOKENS)) matchedDimensions++;

      const structuredPointCount = Math.max(
        ast.listItems.length,
        ast.keyValuePairs.length,
        ast.sentences.filter((s) => s.includes('：') || s.includes(':')).length
      );
      const isCodeGroundedChallenge =
        ast.fencedCodeBlocks.length > 0 &&
        (containsAnyToken(lower, CHALLENGE_RISK_TOKENS) || containsAnyToken(lower, CHALLENGE_EDGE_TOKENS));

      if ((matchedDimensions < 2 && structuredPointCount < 2) && !isCodeGroundedChallenge) {
        missingRequirements.push(
          '未达到红队四部曲批判契约（请调用 submit_challenge_critique，或至少结构化覆盖 2 项：1.逻辑矛盾/潜在风险 2.隐含假设 3.极端失效场景 4.反例压测与实证要求）'
        );
      }
      break;
    }

    case 'verification': {
      const hasEvidenceToolCall =
        Array.isArray(mcpToolCalls) &&
        mcpToolCalls.some(
          (c: any) =>
            matchesMcpToolName(c, 'submit_grounding_evidence') ||
            matchesMcpToolName(c, 'verify_code_assertion') ||
            matchesMcpToolName(c, 'check_architecture_invariant')
        );
      if (hasEvidenceToolCall) {
        break;
      }

      if (trimmed.length < 40) {
        missingRequirements.push('接地实证报告篇幅不足 (字符数 < 40)');
      }

      const hasJsonEvidence =
        ast.hasJsonObject &&
        (trimmed.includes('"evidences"') ||
          trimmed.includes('"truthValue"') ||
          trimmed.includes('"truth_value"'));
      const hasStructuredVerdict =
        hasJsonEvidence || containsAnyToken(lower, VERIFICATION_VERDICT_TOKENS);
      const hasToolOrEvidence =
        hasJsonEvidence ||
        ast.fencedCodeBlocks.length > 0 ||
        ast.quantifiedMetricCount > 0 ||
        containsAnyToken(lower, VERIFICATION_TOOL_TOKENS);

      if (!hasStructuredVerdict) {
        missingRequirements.push(
          '未包含明确的真值判定或实证核查结论（建议调用 submit_grounding_evidence 或标注 PASS/FAIL/已证实/已证伪）'
        );
      }
      if (!hasToolOrEvidence) {
        missingRequirements.push('未包含具体的检验工具、数据测算、客观基准或实证记录');
      }
      break;
    }

    case 'defense': {
      const { defensePayload } = extractDefensePatchFromAcpResponse({
        textResponse: trimmed,
        mcpToolCalls,
      });

      if (defensePayload) {
        const surrenderCheck = detectSycophanticSurrender(trimmed, defensePayload);
        if (surrenderCheck.isSurrender) {
          missingRequirements.push(
            surrenderCheck.reason || '检测到纯附和式谄媚妥协，严禁无补丁全盘投降'
          );
        }
        if (
          defensePayload.defensePatches.length === 0 &&
          defensePayload.stance !== 'reject_critique_with_proof'
        ) {
          missingRequirements.push('submit_defense_patch 未提供实质性 defense_patches 修正方案');
        }
        break;
      }

      if (trimmed.length < 40) {
        missingRequirements.push('答辩修正篇幅不足 (字符数 < 40)');
      }

      const surrenderCheck = detectSycophanticSurrender(trimmed);
      if (surrenderCheck.isSurrender) {
        missingRequirements.push(
          surrenderCheck.reason ||
            '检测到纯附和式谄媚妥协，严禁无客观依据地全盘推翻主张，请给出具体的修正补丁、兜底预案或权衡论据'
        );
      }

      const hasDefenseOrPatch =
        hasStrongEngineeringArtifact ||
        ast.listItems.length >= 2 ||
        containsAnyToken(lower, DEFENSE_RESPONSE_TOKENS);
      if (!hasDefenseOrPatch && !surrenderCheck.isSurrender) {
        missingRequirements.push(
          '未针对红队反例提出明确的答辩阐述、风控兜底预案或防御修正方案 (建议调用 submit_defense_patch)'
        );
      }
      break;
    }

    case 'arbitration': {
      const rulingDraft = extractArbitrationRulingFromAcpResponse({
        textResponse: trimmed,
        mcpToolCalls,
      });
      if (rulingDraft && rulingDraft.summary.length > 0) {
        break;
      }

      if (trimmed.length < 40) {
        missingRequirements.push('仲裁建言篇幅不足 (字符数 < 40)');
      }
      const hasArbitrationArtifact =
        hasJsonContractPayload(trimmed, '<<<RULING_DRAFT_OPTIONS>>>') ||
        ast.headings.length >= 1 ||
        ast.listItems.length >= 2 ||
        containsAnyToken(lower, ARBITRATION_RULING_TOKENS);
      if (!hasArbitrationArtifact) {
        missingRequirements.push('未输出明确的仲裁权衡考量或终局裁决建议（建议调用 submit_arbitration_ruling）');
      }
      break;
    }

    default:
      break;
  }

  const isValid = missingRequirements.length === 0;
  let refinePrompt: string | undefined;
  if (!isValid) {
    const roleTitle = agentName ? `【${agentName}】` : '';
    refinePrompt = `⚠️ ${roleTitle} 你的上一轮输出未通过【阶段契约门禁 (Stage Contract Gate)】硬性校验。\n\n缺失要素如下：\n${missingRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n请立即针对上述缺失要素执行【Self-Refine 重新输出】，严格遵循当前【${stage}】阶段的专业规约，补充完整后重新提交。`;
  }

  return {
    isValid,
    stage,
    missingRequirements,
    refinePrompt,
  };
}

/**
 * G-Frame 模块边界与公共接口契约守卫 (Module Scope & Contract Gate)
 * 完全基于结构化触达路径提取 + 规范化路径前缀比对，彻底消除动态拼接正则造成的误报与逃逸。
 */
export function validateModuleScopeContract(
  text: string,
  activeModule: TaskModuleSlice,
  allModules: TaskModuleSlice[],
  _sharedContract?: SharedInterfaceContract,
  options?: ModuleScopeValidationOptions
): ModuleScopeValidationResult {
  const violatedFiles: string[] = [];
  const violationDetails: string[] = [];
  const recordedOtherEntries = new Set<string>();

  const touchedPaths = extractExplicitTouchedPaths(text, options);
  if (touchedPaths.length === 0) {
    return {
      isScopeValid: true,
      contractViolations: 0,
      violatedFiles: [],
      violationDetails: [],
    };
  }

  const normalizedActiveAllowed = activeModule.allowedFiles
    .map((f) => normalizeRepoPath(f))
    .filter(Boolean);
  const activeExactFiles = new Set(
    normalizedActiveAllowed.filter((f) => !f.endsWith('/'))
  );
  const activeDirPrefixes = normalizedActiveAllowed.filter((f) => f.endsWith('/'));

  for (const rawTouched of touchedPaths) {
    const touched = normalizeRepoPath(rawTouched);
    if (!touched) continue;

    const activeOwnsExact = activeExactFiles.has(touched);
    const activeOwnsByDir = activeDirPrefixes.some((dir) => touched.startsWith(dir));

    for (const otherMod of allModules) {
      if (otherMod.moduleId === activeModule.moduleId) continue;

      for (const rawOther of otherMod.allowedFiles) {
        const otherEntry = normalizeRepoPath(rawOther);
        if (!otherEntry) continue;
        if (recordedOtherEntries.has(otherEntry)) continue;

        const otherIsDir = otherEntry.endsWith('/');
        const otherCoversTouched = otherIsDir
          ? touched.startsWith(otherEntry)
          : touched === otherEntry;
        if (!otherCoversTouched) continue;

        // N3: 当前模块显式声明了具体文件所有权时，豁免其他模块的目录级宽泛覆盖
        if (otherIsDir && activeOwnsExact) {
          continue;
        }

        // N7: 当前模块是目录所有者且修改自身目录内文件，其他模块仅声明了嵌套子文件且当前模块未显式重复声明该子文件时，不反判目录所有者违规
        if (!otherIsDir && activeOwnsByDir && !activeExactFiles.has(otherEntry)) {
          continue;
        }

        const isDirectOverlap =
          activeExactFiles.has(otherEntry) ||
          (otherIsDir && activeDirPrefixes.includes(otherEntry));

        recordedOtherEntries.add(otherEntry);
        violatedFiles.push(otherEntry);

        if (otherIsDir) {
          violationDetails.push(
            `检测到跨模块越界修改目录 [${otherEntry}] 下的未授权文件 [${touched}]（该目录归属于「${otherMod.title}」，不在当前模块 [${activeModule.title}] 的白名单 [${activeModule.allowedFiles.join(', ')}] 内）`
          );
        } else if (isDirectOverlap) {
          violationDetails.push(
            `检测到跨模块白名单重叠与越界修改文件 [${otherEntry}]（该文件已被「${otherMod.title}」声明占用，违反 G-Frame 模块物理隔离不相交铁律 F_i ∩ F_j = ∅）`
          );
        } else {
          violationDetails.push(
            `检测到跨模块越界修改文件 [${otherEntry}]（该文件归属于「${otherMod.title}」，不在当前模块 [${activeModule.title}] 的白名单 [${activeModule.allowedFiles.join(', ')}] 内）`
          );
        }
      }
    }
  }

  return {
    isScopeValid: violationDetails.length === 0,
    contractViolations: violationDetails.length,
    violatedFiles,
    violationDetails,
  };
}
