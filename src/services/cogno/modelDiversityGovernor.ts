/**
 * CognoNexus 角色模型异构性调控器 (Model Diversity Governor)
 * 支撑 P0-5 (ReConcile) 要求：
 * 1. 识别并量化议题参与角色的模型家族重合度与异构多样性评分 (Diversity Score)
 * 2. 识别单模型伪多样性与同质化共识偏见 (Homogeneous Model Bias)
 * 3. 支撑基于置信度校准的决策加权运算 (Calibrated Confidence Matrix)
 * 参考文献：
 * - Chen, J., et al. (2023). ReConcile: Round-Table Conference Improves Reasoning via Consensus among Diverse LLMs.
 */

import { Agent, GameRolesConfig, ModelDiversityEvaluation, GroundingEvidence, ArgumentNode, SycophancyEvaluation, ModelFamily } from '../../types';

export type { ModelFamily };

const FAMILY_DISPLAY_NAMES: Record<ModelFamily, string> = {
  anthropic: 'Claude 家族',
  openai: 'OpenAI 家族',
  deepseek: 'DeepSeek 家族',
  google: 'Gemini 家族',
  meta: 'Llama 家族',
  qwen: 'Qwen 家族',
  local_other: 'Local/Custom',
};

/**
 * 识别/解析模型家族（优先读取配置显式 family，缺失时由元数据推断并归一化）
 */
export function inferModelFamilyFromMetadata(meta: {
  modelId?: string;
  modelName?: string;
  provider?: string;
  modelBadge?: string;
}): ModelFamily {
  const identifier = `${meta.modelBadge || ''} ${meta.modelId || ''} ${meta.modelName || ''} ${meta.provider || ''}`.toLowerCase();
  if (identifier.includes('claude') || identifier.includes('anthropic')) return 'anthropic';
  if (identifier.includes('gpt') || identifier.includes('openai') || identifier.includes('o1') || identifier.includes('o3') || identifier.includes('o4')) return 'openai';
  if (identifier.includes('deepseek')) return 'deepseek';
  if (identifier.includes('gemini') || identifier.includes('google')) return 'google';
  if (identifier.includes('llama') || identifier.includes('meta')) return 'meta';
  if (identifier.includes('qwen') || identifier.includes('通义')) return 'qwen';
  return 'local_other';
}

/**
 * 识别 Agent 所绑定的模型所属大模型家族（优先显式字段，杜绝运行期反复模糊猜测）
 */
export function detectModelFamily(agent: Agent): { family: ModelFamily; displayName: string } {
  if (agent.modelConfig?.family) {
    const f = agent.modelConfig.family;
    return { family: f, displayName: FAMILY_DISPLAY_NAMES[f] || agent.modelBadge || f };
  }

  const family = inferModelFamilyFromMetadata({
    modelId: agent.modelConfig?.modelId,
    modelName: agent.modelConfig?.modelName,
    provider: agent.modelConfig?.provider,
    modelBadge: agent.modelBadge,
  });

  return { family, displayName: FAMILY_DISPLAY_NAMES[family] || agent.modelBadge || 'Local/Custom' };
}

/**
 * 计算议题博弈参与角色的模型异构多样性评分 (P0-5)
 */
export function calculateModelDiversity(
  agents: Agent[],
  gameRoles?: GameRolesConfig
): ModelDiversityEvaluation {
  const activeAgentIds = new Set<string>();

  if (gameRoles) {
    (gameRoles.proposers || []).forEach((id) => activeAgentIds.add(id));
    (gameRoles.challengers || []).forEach((id) => activeAgentIds.add(id));
    (gameRoles.verifiers || []).forEach((id) => activeAgentIds.add(id));
    (gameRoles.arbiters || []).forEach((id) => activeAgentIds.add(id));
  }

  // 若未指定具体角色分配，则考量当前传入的全部 Agent
  const targetAgents = activeAgentIds.size > 0
    ? agents.filter((a) => activeAgentIds.has(a.id))
    : agents;

  if (targetAgents.length <= 1) {
    return {
      score: 0.20,
      isHomogeneous: true,
      familyDistribution: {},
      warnings: ['单 Agent 独立推演，缺乏多视角对抗与交叉检验'],
    };
  }

  const familyDistribution: Record<string, string[]> = {};
  targetAgents.forEach((agent) => {
    const { displayName } = detectModelFamily(agent);
    if (!familyDistribution[displayName]) {
      familyDistribution[displayName] = [];
    }
    familyDistribution[displayName].push(agent.name);
  });

  const distinctFamilyCount = Object.keys(familyDistribution).length;
  const warnings: string[] = [];

  let score = 1.0;
  let isHomogeneous = false;

  if (distinctFamilyCount === 1) {
    // 极端同质化偏见：4 角色实质为同一模型脑子
    score = 0.25;
    isHomogeneous = true;
    const soleFamily = Object.keys(familyDistribution)[0];
    warnings.push(
      `⚠️ 同质化模型共识偏见警示 (Homogeneous Model Bias)：当前全部角色均指向单一模型家族【${soleFamily}】。各角色共享同源认知偏好，极易发生“自我肯定”与共识幻觉，建议配置异构模型组合（如 Anthropic + DeepSeek + OpenAI）以激发真实对抗。`
    );
  } else if (distinctFamilyCount === 2) {
    score = 0.70;
    isHomogeneous = false;
  } else {
    score = 1.00;
    isHomogeneous = false;
  }

  return {
    score,
    isHomogeneous,
    familyDistribution,
    warnings,
  };
}

/**
 * 依据实证支持、论点状态与谄媚折减计算方案-准则置信度矩阵 (ReConcile 置信度动态加权)
 */
export function calculateConfidenceMatrix(options: {
  alternatives: string[];
  criteriaIds: string[];
  evidences?: GroundingEvidence[];
  argumentNodes?: ArgumentNode[];
  sycophancy?: SycophancyEvaluation;
}): Record<string, Record<string, number>> {
  const { alternatives, criteriaIds, evidences = [], argumentNodes = [], sycophancy } = options;
  const matrix: Record<string, Record<string, number>> = {};

  const gamma = sycophancy ? sycophancy.discountFactorGamma : 1.0;
  const verifiedCount = evidences.filter((e) => e.truthValue).length;
  const refutedCount = evidences.filter((e) => !e.truthValue).length;

  alternatives.forEach((alt, altIdx) => {
    matrix[alt] = {};
    criteriaIds.forEach((critId) => {
      let baseConf = 0.85;

      if (altIdx === 0) {
        // 方案A (提案原案)
        if (refutedCount > 0) {
          baseConf = Math.max(0.40, baseConf - 0.25);
        } else if (verifiedCount > 0) {
          baseConf = Math.min(0.98, baseConf + 0.10);
        }
      } else if (altIdx === 1) {
        // 方案B (红队重构)
        if (refutedCount > 0) {
          baseConf = Math.min(0.95, baseConf + 0.10);
        }
      } else {
        // 方案C (架构补丁)
        baseConf = 0.88;
      }

      // 施加谄媚折减因子 γ
      const finalConf = Math.max(0.35, Math.min(1.0, Math.round(baseConf * gamma * 100) / 100));
      matrix[alt][critId] = finalConf;
    });
  });

  return matrix;
}
