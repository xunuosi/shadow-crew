/**
 * CognoNexus 阶段契约门禁与 Self-Refine 控制服务 (Stage Contract Gate)
 * 支撑 R-1 / M4 要求：
 * 1. 各阶段输出结构与要素强校验
 * 2. 校验失败原位阻断 FSM 推进，触发 Self-Refine
 * 3. 超过重试上限 (maxRetries=2) 状态机进入 stageFailed，熔断交接人类
 */

import { GameTheoreticStage } from '../../types';

export interface StageContractValidationResult {
  isValid: boolean;
  stage: GameTheoreticStage;
  missingRequirements: string[];
  refinePrompt?: string;
}

export const STAGE_CONTRACT_MAX_RETRIES = 2;

/**
 * 校验指定阶段的 Agent 输出是否满足结构化契约规范
 */
export function validateStageContract(
  stage: GameTheoreticStage,
  text: string,
  agentName?: string
): StageContractValidationResult {
  const trimmed = (text || '').trim();
  const missingRequirements: string[] = [];

  // 通用底线：绝不允许极短敷衍回复或空回复
  if (trimmed.length < 30) {
    missingRequirements.push('回复篇幅过短 (字符数 < 30)，缺少必要的推演论证或事实细节');
  }

  // 检查是否包含无实义敷衍词汇
  const trivialPatterns = [/^(好的|收到|明白|我同意|没问题|赞成|同上)[。！!\s]*$/i];
  if (trivialPatterns.some((p) => p.test(trimmed))) {
    missingRequirements.push('检测到无实义确认性敷衍回复，未提供实质性技术观点');
  }

  switch (stage) {
    case 'proposal': {
      if (trimmed.length < 60) {
        missingRequirements.push('立论提案篇幅不足 (字符数 < 60)');
      }
      const hasCoreDesign = /(架构|方案|设计|组件|选型|时序|流程|实现|机制|通过|采用|构建)/i.test(trimmed);
      if (!hasCoreDesign) {
        missingRequirements.push('缺少核心技术设计断言（未说明组件选型、技术路径或系统架构）');
      }
      const hasKeyAdvantageOrGoal = /(优势|目标|保证|性能|可用性|一致性|降低|提升|防止)/i.test(trimmed);
      if (!hasKeyAdvantageOrGoal) {
        missingRequirements.push('缺少方案预期的技术指标或核心收益断言');
      }
      break;
    }

    case 'challenge': {
      if (trimmed.length < 70) {
        missingRequirements.push('反例压测篇幅不足 (字符数 < 70)');
      }
      // 红队四部曲检测：矛盾/缺陷、隐含假设、边缘失效、反例实证
      const hasRiskOrContradiction = /(矛盾|缺陷|风险|漏洞|瓶颈|竞争|冲突|单点|不可逆)/i.test(trimmed);
      const hasHiddenAssumption = /(假设|前提|依赖|默认|如果|假定)/i.test(trimmed);
      const hasEdgeOrFailureScenario = /(极端|边界|并发|超时|断网|穿透|宕机|崩溃|延迟|抖动|脏数据)/i.test(trimmed);
      const hasCounterDemand = /(反例|压测|实证|检验|证明|复现|证据|指标)/i.test(trimmed);

      let matchedDimensions = 0;
      if (hasRiskOrContradiction) matchedDimensions++;
      if (hasHiddenAssumption) matchedDimensions++;
      if (hasEdgeOrFailureScenario) matchedDimensions++;
      if (hasCounterDemand) matchedDimensions++;

      if (matchedDimensions < 2) {
        missingRequirements.push(
          '未达到红队四部曲批判契约（须至少覆盖以下 2 项：1.逻辑矛盾/风险 2.隐含假设 3.极端边缘场景 4.反例与实证要求）'
        );
      }
      break;
    }

    case 'verification': {
      if (trimmed.length < 40) {
        missingRequirements.push('接地实证报告篇幅不足 (字符数 < 40)');
      }
      const hasVerifiableVerdict = /(验证|检验|实证|测试|通过|未通过|失败|证伪|证实|PASS|FAIL|TRUE|FALSE|结论)/i.test(trimmed);
      if (!hasVerifiableVerdict) {
        missingRequirements.push('未包含明确的真值判定或实证结论（如 PASS/FAIL、已证实/已证伪）');
      }
      const hasToolOrEvidence = /(工具|沙箱|sandbox|ast|grep|代码|测试|执行|用例|脚本|命令|evidence|evidences|sourceTool|query|output)/i.test(trimmed);
      if (!hasToolOrEvidence) {
        missingRequirements.push('未包含具体的检验工具、测试用例或代码实证记录');
      }
      break;
    }

    case 'defense': {
      if (trimmed.length < 50) {
        missingRequirements.push('答辩修正篇幅不足 (字符数 < 50)');
      }
      const hasDefenseOrPatch = /(答辩|回应|补丁|修正|防御|优化|缓解|改动|重构|弥补|方案调整|针对)/i.test(trimmed);
      if (!hasDefenseOrPatch) {
        missingRequirements.push('未针对红队反例提出明确的答辩阐述或架构防御补丁 (Patch)');
      }
      break;
    }

    case 'arbitration': {
      if (trimmed.length < 60) {
        missingRequirements.push('仲裁建言篇幅不足 (字符数 < 60)');
      }
      const hasTradeoffOrRuling = /(仲裁|权衡|裁决|采纳|建议|平衡|折中|结论|定案|实施)/i.test(trimmed);
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
