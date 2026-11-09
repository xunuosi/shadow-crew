import {
  Agent,
  GameConfigurationEvaluation,
  GameRoleReuseBinding,
  GameRolesConfig,
  GameRoleType,
  GameTheoreticPolicy,
} from '../../types';
import { calculateModelDiversity } from './modelDiversityGovernor';

export const RECOMMENDED_GAME_THEORETIC_POLICY: GameTheoreticPolicy = {
  independenceProfile: 'strict',
  groundingRequired: true,
};

/**
 * 历史 Topic 没有策略字段时显式按“灵活博弈”读取。
 * 新建 Topic 默认使用 RECOMMENDED_GAME_THEORETIC_POLICY。
 */
export const LEGACY_GAME_THEORETIC_POLICY: GameTheoreticPolicy = {
  independenceProfile: 'flexible',
  groundingRequired: false,
};

const GAME_ROLE_ORDER: GameRoleType[] = [
  'proposer',
  'challenger',
  'verifier',
  'arbiter',
];

export const GAME_ROLE_LABELS: Record<GameRoleType, string> = {
  proposer: '提案',
  challenger: '挑战',
  verifier: '接地验证',
  arbiter: '综合仲裁',
};

export function normalizeGameTheoreticPolicy(
  input?: Partial<GameTheoreticPolicy> | null
): GameTheoreticPolicy {
  if (!input) return { ...LEGACY_GAME_THEORETIC_POLICY };
  return {
    independenceProfile:
      input.independenceProfile === 'strict' ? 'strict' : 'flexible',
    groundingRequired: input.groundingRequired === true,
  };
}

export function getGameRoleLabel(role: GameRoleType): string {
  return GAME_ROLE_LABELS[role] ?? role;
}

function uniqueIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  return Array.from(left).filter((id) => right.has(id));
}

function formatAgentNames(ids: string[], agents: Agent[]): string {
  const byId = new Map(agents.map((agent) => [agent.id, agent.name]));
  return ids.map((id) => byId.get(id) || id).join('、');
}

export function evaluateGameConfiguration(options: {
  agents: Agent[];
  gameRoles: GameRolesConfig;
  policy?: Partial<GameTheoreticPolicy> | null;
}): GameConfigurationEvaluation {
  const { agents, gameRoles } = options;
  const policy = normalizeGameTheoreticPolicy(options.policy);
  const strict = policy.independenceProfile === 'strict';

  const proposers = uniqueIds(gameRoles.proposers);
  const challengers = uniqueIds(gameRoles.challengers);
  const verifiers = uniqueIds(gameRoles.verifiers);
  const arbiters = uniqueIds(gameRoles.arbiters);

  const proposerSet = new Set(proposers);
  const challengerSet = new Set(challengers);
  const verifierSet = new Set(verifiers);
  const arbiterSet = new Set(arbiters);
  const debateSet = new Set([...proposers, ...challengers]);
  const allRoleAgentIds = uniqueIds([
    ...proposers,
    ...challengers,
    ...verifiers,
    ...arbiters,
  ]);
  const knownAgentIds = new Set(agents.map((agent) => agent.id));
  const unknownRoleAgentIds = allRoleAgentIds.filter(
    (id) => !knownAgentIds.has(id)
  );

  const proposerChallengerCollision = intersect(proposerSet, challengerSet);
  const debateArbiterCollision = intersect(debateSet, arbiterSet);
  const proposerVerifierCollision = intersect(proposerSet, verifierSet);
  const challengerVerifierCollision = intersect(challengerSet, verifierSet);
  const verifierCollision = uniqueIds([
    ...proposerVerifierCollision,
    ...challengerVerifierCollision,
  ]);

  const criticalCollisions: string[] = [];
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  const addCollision = (
    ids: string[],
    label: string,
    strictBlockingMessage: string,
    flexibleWarningMessage: string
  ) => {
    if (ids.length === 0) return;
    const detail = `${label}：${formatAgentNames(ids, agents)}`;
    criticalCollisions.push(detail);
    if (strict) {
      blockingIssues.push(strictBlockingMessage);
    } else {
      warnings.push(flexibleWarningMessage);
    }
  };

  addCollision(
    proposerChallengerCollision,
    'Proposer = Challenger',
    '严格模式禁止同一 Agent 同时承担提案与挑战角色。',
    '同一 Agent 同时承担提案与挑战，属于自我挑战，不能视为独立对抗。'
  );
  addCollision(
    debateArbiterCollision,
    '辩手 = AI Arbiter',
    '严格模式禁止辩论参与者同时担任 AI 仲裁官。',
    '辩论参与者同时担任 AI 仲裁官，存在自我裁决风险。'
  );
  if (policy.groundingRequired) {
    addCollision(
      verifierCollision,
      '辩手 = Verifier',
      '严格接地模式要求验证者独立于提案方和挑战方。',
      '提案方或挑战方同时承担接地验证，存在选择有利证据的风险。'
    );
  }

  if (proposers.length === 0) {
    blockingIssues.push('博弈议题必须配置至少一个提案 Agent，否则不存在可辩论的初始方案。');
  }
  if (challengers.length === 0) {
    if (strict) {
      blockingIssues.push('严格模式必须配置至少一个独立挑战 Agent。');
    } else {
      warnings.push('当前没有挑战 Agent，系统将退化为缺少反例压测的轻量讨论。');
    }
  }

  const arbitrationConfigured = gameRoles.humanIsArbiter || arbiters.length > 0;
  if (!arbitrationConfigured) {
    blockingIssues.push('必须配置 AI Arbiter 或启用人类最终仲裁者。');
  }

  const groundingSatisfied = !policy.groundingRequired || verifiers.length > 0;
  if (!groundingSatisfied) {
    if (strict) {
      blockingIssues.push('当前策略要求接地实证，但未配置 Verifier。');
    } else {
      warnings.push('当前议题要求接地实证，但未配置 Verifier，事实断言将保持未验证状态。');
    }
  }

  if (unknownRoleAgentIds.length > 0) {
    blockingIssues.push(
      `角色配置包含当前 Topic 不可用的 Agent：${unknownRoleAgentIds.join('、')}。`
    );
  }

  const roleBindings = new Map<string, Set<GameRoleType>>();
  const bind = (ids: string[], role: GameRoleType) => {
    ids.forEach((id) => {
      const roles = roleBindings.get(id) ?? new Set<GameRoleType>();
      roles.add(role);
      roleBindings.set(id, roles);
    });
  };
  bind(proposers, 'proposer');
  bind(challengers, 'challenger');
  bind(verifiers, 'verifier');
  bind(arbiters, 'arbiter');

  const reusedRoleBindings: GameRoleReuseBinding[] = Array.from(
    roleBindings.entries()
  )
    .filter(([, roles]) => roles.size > 1)
    .map(([agentId, roles]) => ({
      agentId,
      agentName: agents.find((agent) => agent.id === agentId)?.name || agentId,
      roles: GAME_ROLE_ORDER.filter((role) => roles.has(role)),
    }))
    .sort((left, right) => left.agentName.localeCompare(right.agentName));

  if (reusedRoleBindings.length > 0) {
    const reuseText = reusedRoleBindings
      .map(
        (binding) =>
          `${binding.agentName}=${binding.roles.map(getGameRoleLabel).join('+')}`
      )
      .join('；');
    warnings.push(`检测到角色复用：${reuseText}。`);
  }

  const diversityAgents = agents.filter((agent) =>
    allRoleAgentIds.includes(agent.id)
  );
  const diversityRoles: GameRolesConfig = {
    proposers: proposers.filter((id) => knownAgentIds.has(id)),
    challengers: challengers.filter((id) => knownAgentIds.has(id)),
    verifiers: verifiers.filter((id) => knownAgentIds.has(id)),
    arbiters: arbiters.filter((id) => knownAgentIds.has(id)),
    humanIsArbiter: gameRoles.humanIsArbiter,
  };
  const modelDiversity = calculateModelDiversity(
    diversityAgents,
    diversityRoles
  );
  warnings.push(...modelDiversity.warnings);

  const uniqueWarnings = Array.from(new Set(warnings));
  const uniqueBlockingIssues = Array.from(new Set(blockingIssues));
  const status = uniqueBlockingIssues.length > 0
    ? 'blocked'
    : uniqueWarnings.length > 0
      ? 'warning'
      : 'pass';

  let independenceScore = 100;
  independenceScore -= criticalCollisions.length * 25;
  if (proposers.length === 0) independenceScore -= 25;
  if (challengers.length === 0) independenceScore -= 25;
  if (!arbitrationConfigured) independenceScore -= 25;
  if (!groundingSatisfied) independenceScore -= 20;
  if (allRoleAgentIds.length === 1) independenceScore -= 25;
  independenceScore = Math.max(0, Math.min(100, independenceScore));

  const summary = status === 'blocked'
    ? `配置不满足${strict ? '严格' : '灵活'}博弈策略，存在 ${uniqueBlockingIssues.length} 项启动阻断。`
    : status === 'warning'
      ? `配置可启动，但存在 ${uniqueWarnings.length} 项独立性、接地或模型多样性风险。`
      : `配置完整，可进入${strict ? '严格' : '灵活'}博弈讨论。`;

  return {
    status,
    policy,
    roleCoverage: {
      proposer: proposers.length,
      challenger: challengers.length,
      verifier: verifiers.length,
      arbiter: arbiters.length,
      humanArbiter: gameRoles.humanIsArbiter,
      defenderUsesProposer: proposers.length > 0,
    },
    uniqueAgentCount: allRoleAgentIds.length,
    reusedRoleBindings,
    criticalCollisions,
    independenceScore,
    modelDiversity,
    groundingRequired: policy.groundingRequired,
    groundingSatisfied,
    arbitrationConfigured,
    blockingIssues: uniqueBlockingIssues,
    warnings: uniqueWarnings,
    summary,
  };
}
