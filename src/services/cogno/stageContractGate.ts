/**
 * CognoNexus 阶段契约门禁与 Self-Refine 控制服务 (Stage Contract Gate)
 * 支撑 R-1 / M4 要求：
 * 1. 各阶段输出结构与要素强校验
 * 2. 校验失败原位阻断 FSM 推进，触发 Self-Refine
 * 3. 超过重试上限 (maxRetries=2) 状态机进入 stageFailed，熔断交接人类
 */

import { GameTheoreticStage, SharedInterfaceContract, TaskModuleSlice } from '../../types';
import { detectSycophanticSurrender } from './sycophancyGovernor';

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

export const STAGE_CONTRACT_MAX_RETRIES = 2;

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
  const missingRequirements: string[] = [];

  const hasSubstantialToolCall = Array.isArray(mcpToolCalls) && mcpToolCalls.some(
    (c: any) =>
      c?.tool_name === 'submit_challenge_critique' ||
      c?.tool_name === 'submit_grounding_evidence' ||
      c?.tool_name === 'submit_execution_deliverable' ||
      c?.tool_name === 'submit_arbitration_ruling' ||
      c?.tool === 'submit_challenge_critique' ||
      c?.tool === 'submit_grounding_evidence' ||
      c?.tool === 'submit_execution_deliverable' ||
      c?.tool === 'submit_arbitration_ruling' ||
      c?.name === 'submit_challenge_critique' ||
      c?.name === 'submit_grounding_evidence' ||
      c?.name === 'submit_execution_deliverable' ||
      c?.name === 'submit_arbitration_ruling'
  );

  // 通用底线：绝不允许极短敷衍回复或空回复 (若已调用实质性 MCP 工具契约则豁免纯文本字数底线)
  if (!hasSubstantialToolCall && trimmed.length < 30) {
    missingRequirements.push('回复篇幅过短 (字符数 < 30)，缺少必要的推演论证或事实细节');
  }

  // 检查是否包含无实义敷衍词汇
  const trivialPatterns = [/^(好的|收到|明白|我同意|没问题|赞成|同上)[。！!\s]*$/i];
  if (trivialPatterns.some((p) => p.test(trimmed))) {
    missingRequirements.push('检测到无实义确认性敷衍回复，未提供实质性技术观点');
  }

  // 检测是否具备强事实工程交付物 (Unified Diff, Code Block, Concrete File Path, Structured JSON)
  const hasCodeBlock = /```(?:diff|patch|typescript|ts|javascript|js|json|python|py|go|rust|rs|bash|sh|sql|yaml|yml)?[\s\S]*?```/i.test(trimmed);
  const hasConcreteFilePath = /(?:src\/[\w./-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|rs|go|py|json|md)\b)/i.test(trimmed);
  const hasStrongEngineeringArtifact = hasCodeBlock || (hasConcreteFilePath && trimmed.length >= 60);

  switch (stage) {
    case 'decomposition': {
      const hasModuleKeywords = /(模块|契约|边界|阶段|维度|子任务|interface|contract|module|allowed_files|拆解|划分)/i.test(trimmed);
      const hasDecompArtifact = hasCodeBlock || trimmed.includes('<<<MODULE_DECOMPOSITION>>>') || trimmed.includes('"modules"');
      if (!hasModuleKeywords && !hasDecompArtifact) {
        missingRequirements.push('未包含模块/维度拆解清单或跨模块公共契约定义');
      }
      break;
    }

    case 'proposal': {
      if (trimmed.length < 50) {
        missingRequirements.push('立论提案篇幅不足 (字符数 < 50)');
      }
      const hasCoreDesign = /(架构|方案|设计|组件|选型|时序|流程|实现|机制|通过|采用|构建|策略|路径|规划|模型|定位|规则|举措|体系|标准|步骤|architecture|design|interface|class|function)/i.test(trimmed);
      const hasKeyAdvantageOrGoal = /(优势|目标|保证|性能|可用性|一致性|降低|提升|防止|收益|效率|成本|增长|转化|留存|安全|合规|可控|保障|价值|质量|goal|benefit|perf|security|reliability)/i.test(trimmed);

      // 若具备具体代码块/工程文件产物，视同满足核心方案设计；否则要求明确的设计与目标断言
      if (!hasStrongEngineeringArtifact && !hasCoreDesign) {
        missingRequirements.push('缺少核心方案设计断言（未说明核心机制、执行路径、策略模型或系统架构）');
      }
      if (!hasStrongEngineeringArtifact && !hasKeyAdvantageOrGoal) {
        missingRequirements.push('缺少方案预期的衡量指标、业务价值或核心收益断言');
      }
      break;
    }

    case 'challenge': {
      // 0. 优先检验原生 MCP 工具 submit_challenge_critique
      let hasValidCritiqueTool = false;
      if (Array.isArray(mcpToolCalls) && mcpToolCalls.length > 0) {
        const critiqueCall = mcpToolCalls.find(
          (c: any) =>
            c?.tool_name === 'submit_challenge_critique' ||
            c?.tool === 'submit_challenge_critique' ||
            c?.name === 'submit_challenge_critique'
        );
        if (critiqueCall) {
          let args = critiqueCall.arguments ?? critiqueCall.args;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {}
          }
          if (args && typeof args === 'object') {
            const hasFlaws = Array.isArray(args.fatal_flaws) && args.fatal_flaws.length > 0;
            const hasAssumptions = Array.isArray(args.hidden_assumptions) && args.hidden_assumptions.length > 0;
            const hasScenarios = Array.isArray(args.failure_scenarios) && args.failure_scenarios.length > 0;
            const hasDemands = Array.isArray(args.counter_demands) && args.counter_demands.length > 0;
            if (hasFlaws && hasAssumptions && hasScenarios && hasDemands) {
              hasValidCritiqueTool = true;
            }
          }
        }
      }

      if (hasValidCritiqueTool) {
        break; // 四部曲全量满足，直接通过门禁！
      }

      if (trimmed.length < 50) {
        missingRequirements.push('反例压测篇幅不足 (字符数 < 50)');
      }
      // 红队四部曲检测：矛盾/缺陷、隐含假设、边缘失效、反例实证（中英双语与工程语义兼容）
      const hasRiskOrContradiction = /(矛盾|缺陷|风险|漏洞|瓶颈|竞争|冲突|单点|不可逆|隐患|盲区|短板|失真|亏损|流失|违约|副作用|deadlock|race condition|overflow|leak|failure|bug|vulnerability|flaw|regression|crash)/i.test(trimmed);
      const hasHiddenAssumption = /(假设|前提|依赖|默认|如果|假定|理想化|高估|低估|忽略|条件|assumption|presume|precondition|premise|if|rely|depend)/i.test(trimmed);
      const hasEdgeOrFailureScenario = /(极端|边界|并发|超时|断网|穿透|宕机|崩溃|延迟|抖动|脏数据|失效|异常|峰值|黑天鹅|最坏|挤兑|恶性|断层|滞后|edge case|corner case|boundary|concurrency|timeout|disconnect|corrupt|oom)/i.test(trimmed);
      const hasCounterDemand = /(反例|压测|实证|检验|证明|复现|证据|指标|数据|测算|算例|推演|案例|核查|对标|counter-example|test case|reproduce|verify|benchmark|assertion|poc)/i.test(trimmed);

      let matchedDimensions = 0;
      if (hasRiskOrContradiction) matchedDimensions++;
      if (hasHiddenAssumption) matchedDimensions++;
      if (hasEdgeOrFailureScenario) matchedDimensions++;
      if (hasCounterDemand) matchedDimensions++;

      if (trimmed.includes('submit_challenge_critique') || trimmed.includes('<<<CHALLENGER_CRITIQUE>>>')) {
        matchedDimensions += 2;
      }

      // 若包含具体代码块展示复现反例，且命中至少 1 个风险/边界维度，视为高质量反例质询
      const isCodeGroundedChallenge = hasCodeBlock && (hasRiskOrContradiction || hasEdgeOrFailureScenario);

      if (matchedDimensions < 2 && !isCodeGroundedChallenge) {
        missingRequirements.push(
          '未达到红队四部曲批判契约（须至少覆盖以下 2 项：1.逻辑矛盾/潜在风险 2.隐含假设/前提缺陷 3.极端边界/失效场景 4.反例算例与实证要求）'
        );
      }
      break;
    }

    case 'verification': {
      if (trimmed.length < 40) {
        missingRequirements.push('接地实证报告篇幅不足 (字符数 < 40)');
      }
      const hasEvidenceToolCall = Array.isArray(mcpToolCalls) && mcpToolCalls.some(
        (c: any) =>
          c?.tool_name === 'submit_grounding_evidence' ||
          c?.tool === 'submit_grounding_evidence' ||
          c?.name === 'submit_grounding_evidence'
      );
      const hasVerifiableVerdict = hasEvidenceToolCall || /(验证|检验|实证|测试|通过|未通过|失败|证伪|证实|成立|不成立|属实|PASS|FAIL|TRUE|FALSE|结论|核查|核算|passed|failed)/i.test(trimmed);
      const hasEvidenceArtifact = hasEvidenceToolCall || trimmed.includes('"evidences"') || trimmed.includes('"truthValue"') || trimmed.includes('submit_grounding_evidence');
      if (!hasVerifiableVerdict && !hasEvidenceArtifact) {
        missingRequirements.push('未包含明确的真值判定或实证核查结论（如 PASS/FAIL、已证实/已证伪、成立/不成立）');
      }
      const hasToolOrEvidence = hasEvidenceToolCall || hasCodeBlock || /(工具|沙箱|sandbox|ast|grep|代码|测试|执行|用例|脚本|命令|evidence|evidences|sourceTool|submit_grounding_evidence|query|output|数据|测算|公式|核算|案例|基准|推导|统计|账目|法条|调研|证据|计算|npm test|cargo test|vitest|jest)/i.test(trimmed);
      if (!hasToolOrEvidence && !hasEvidenceArtifact) {
        missingRequirements.push('未包含具体的检验工具、数据测算、客观基准或实证记录');
      }
      break;
    }

    case 'defense': {
      if (trimmed.length < 40) {
        missingRequirements.push('答辩修正篇幅不足 (字符数 < 40)');
      }
      const hasDefenseOrPatch = hasStrongEngineeringArtifact || /(答辩|回应|补丁|修正|防御|优化|缓解|改动|重构|弥补|方案调整|针对|兜底|预案|容错|补偿|完善|规避|限定|patch|fix|resolve|mitigate|defense|refactor|handle|workaround)/i.test(trimmed);
      if (!hasDefenseOrPatch) {
        missingRequirements.push('未针对红队反例提出明确的答辩阐述、风控兜底预案或防御修正方案 (Patch)');
      }
      // P0-4: 谄媚式无原则全盘妥协硬拦截 (Anti-Sycophancy Gate)
      const surrenderCheck = detectSycophanticSurrender(trimmed);
      if (surrenderCheck.isSurrender) {
        missingRequirements.push(surrenderCheck.reason || '检测到纯附和式谄媚妥协，严禁无客观依据地全盘推翻主张，请给出具体的修正补丁、兜底预案或权衡论据');
      }
      break;
    }

    case 'arbitration': {
      if (trimmed.length < 40) {
        missingRequirements.push('仲裁建言篇幅不足 (字符数 < 40)');
      }
      const hasArbitrationToolCall = Array.isArray(mcpToolCalls) && mcpToolCalls.some(
        (c: any) =>
          c?.tool_name === 'submit_arbitration_ruling' ||
          c?.tool === 'submit_arbitration_ruling' ||
          c?.name === 'submit_arbitration_ruling'
      );
      const hasTradeoffOrRuling = hasArbitrationToolCall || /(仲裁|权衡|裁决|采纳|建议|平衡|折中|结论|定案|实施|取舍|优先级|决议|arbitration|ruling|tradeoff|decision|adopt|reject)/i.test(trimmed) || trimmed.includes('<<<RULING_DRAFT_OPTIONS>>>') || trimmed.includes('submit_arbitration_ruling');
      if (!hasTradeoffOrRuling) {
        missingRequirements.push('未输出明确的仲裁权衡考量或终局裁决建议');
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
 * 检测当前模块沙箱内的输出是否越界修改了属于其他模块的专属文件，或存在白名单重叠越界 (EDGE-04)
 */
export function validateModuleScopeContract(
  text: string,
  activeModule: TaskModuleSlice,
  allModules: TaskModuleSlice[],
  _sharedContract?: SharedInterfaceContract
): ModuleScopeValidationResult {
  const violatedFiles: string[] = [];
  const violationDetails: string[] = [];
  const recordedFiles = new Set<string>();

  const activeAllowed = new Set(
    activeModule.allowedFiles.map((f) => f.trim()).filter(Boolean)
  );
  const isPathAuthorizedForActive = (targetPath: string): boolean => {
    if (activeAllowed.has(targetPath)) return true;
    return Array.from(activeAllowed).some(
      (af) => af.endsWith('/') && targetPath.startsWith(af)
    );
  };

  const otherModulesFiles: Array<{
    file: string;
    ownerTitle: string;
    isDirectOverlap: boolean;
    isSubFileOfActiveDir: boolean;
  }> = [];

  for (const mod of allModules) {
    if (mod.moduleId === activeModule.moduleId) continue;
    for (const f of mod.allowedFiles) {
      const cleanFile = f.trim();
      if (!cleanFile) continue;
      const isDirectOverlap = activeAllowed.has(cleanFile);
      const isSubFileOfActiveDir = Array.from(activeAllowed).some(
        (af) => af !== cleanFile && af.endsWith('/') && cleanFile.startsWith(af)
      );

      // 若 otherModule 所声明的具体文件落在当前模块专属的目录前缀内，当前模块作为目录所有者拥有合法修改权 (N7)
      if (isSubFileOfActiveDir && !isDirectOverlap) {
        continue;
      }

      otherModulesFiles.push({
        file: cleanFile,
        ownerTitle: mod.title,
        isDirectOverlap,
        isSubFileOfActiveDir,
      });
    }
  }

  // 仅当输出文本中实际发生修改动作，且触碰了其他模块专属文件（或直接重叠白名单文件）时才判定违规 (EDGE-04, N3, N7)
  // 「零修改」文本绝不误报违规；目录所有者修改自身目录内文件绝不被反判越界 (N7)
  for (const { file, ownerTitle, isDirectOverlap } of otherModulesFiles) {
    if (recordedFiles.has(file)) continue;

    const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (file.endsWith('/') && !isDirectOverlap) {
      const dirModRegex = new RegExp(
        `(?:(?:修改|重写|新增|编辑|替换|写入|变更|重构|write_file|str_replace|patch)[^\\n]{0,40}(${escapedFile}[\\w./-]*)|(${escapedFile}[\\w./-]*)[^\\n]{0,40}(?:修改|重写|新增|编辑|替换|写入|变更|重构|write_file|str_replace|patch))`,
        'gi'
      );
      const matches = Array.from(text.matchAll(dirModRegex));
      const unauthorizedTargets = matches
        .map((m) => (m[1] || m[2] || '').trim())
        .filter(
          (targetPath) =>
            Boolean(targetPath) &&
            !isPathAuthorizedForActive(targetPath)
        );

      if (unauthorizedTargets.length > 0) {
        recordedFiles.add(file);
        violatedFiles.push(file);
        violationDetails.push(
          `检测到跨模块越界修改目录 [${file}] 下的未授权文件 [${unauthorizedTargets[0]}]（该目录归属于「${ownerTitle}」，不在当前模块 [${activeModule.title}] 的白名单 [${activeModule.allowedFiles.join(', ')}] 内）`
        );
      }
      continue;
    }

    const targetPattern = file.endsWith('/')
      ? `${escapedFile}[\\w./-]*`
      : escapedFile;
    const modificationRegex = new RegExp(
      `(?:(?:修改|重写|新增|编辑|替换|写入|变更|重构|write_file|str_replace|patch)[^\\n]{0,40}${targetPattern}|${targetPattern}[^\\n]{0,40}(?:修改|重写|新增|编辑|替换|写入|变更|重构|write_file|str_replace|patch))`,
      'i'
    );

    if (modificationRegex.test(text)) {
      recordedFiles.add(file);
      violatedFiles.push(file);
      violationDetails.push(
        isDirectOverlap
          ? `检测到跨模块白名单重叠与越界修改文件 [${file}]（该文件已被「${ownerTitle}」声明占用，违反 G-Frame 模块物理隔离不相交铁律 F_i ∩ F_j = ∅）`
          : `检测到跨模块越界修改文件 [${file}]（该文件归属于「${ownerTitle}」，不在当前模块 [${activeModule.title}] 的白名单 [${activeModule.allowedFiles.join(', ')}] 内）`
      );
    }
  }

  return {
    isScopeValid: violationDetails.length === 0,
    contractViolations: violationDetails.length,
    violatedFiles,
    violationDetails,
  };
}

