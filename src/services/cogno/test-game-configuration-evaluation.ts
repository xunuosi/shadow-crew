import assert from 'node:assert/strict';
import { Agent, GameRolesConfig, GameTheoreticPolicy } from '../../types';
import {
  evaluateGameConfiguration,
  LEGACY_GAME_THEORETIC_POLICY,
  normalizeGameTheoreticPolicy,
  RECOMMENDED_GAME_THEORETIC_POLICY,
} from './gameConfigurationEvaluator';

const proposer = {
  id: 'agent-proposer',
  name: 'Claude Proposer',
  handle: '@claude',
  role: 'Architect',
  modelBadge: 'Claude 3.7 Sonnet',
  modelConfig: { modelId: 'claude-3-7-sonnet', provider: 'anthropic' },
} as unknown as Agent;

const challenger = {
  id: 'agent-challenger',
  name: 'DeepSeek Challenger',
  handle: '@deepseek',
  role: 'Security reviewer',
  modelBadge: 'DeepSeek R1',
  modelConfig: { modelId: 'deepseek-reasoner', provider: 'deepseek' },
} as unknown as Agent;

const verifier = {
  id: 'agent-verifier',
  name: 'GPT Verifier',
  handle: '@gpt',
  role: 'Tool verifier',
  modelBadge: 'GPT-4o',
  modelConfig: { modelId: 'gpt-4o', provider: 'openai' },
} as unknown as Agent;

const agents = [proposer, challenger, verifier];

const strictPolicy: GameTheoreticPolicy = {
  independenceProfile: 'strict',
  groundingRequired: true,
};

const flexiblePolicy: GameTheoreticPolicy = {
  independenceProfile: 'flexible',
  groundingRequired: true,
};

const distinctRoles: GameRolesConfig = {
  proposers: [proposer.id],
  challengers: [challenger.id],
  verifiers: [verifier.id],
  arbiters: [],
  humanIsArbiter: true,
};

console.log('=== Game Configuration Evaluation Test Suite ===');

const strictPass = evaluateGameConfiguration({
  agents,
  gameRoles: distinctRoles,
  policy: strictPolicy,
});
assert.equal(strictPass.status, 'pass');
assert.equal(strictPass.uniqueAgentCount, 3);
assert.equal(strictPass.roleCoverage.proposer, 1);
assert.equal(strictPass.roleCoverage.challenger, 1);
assert.equal(strictPass.roleCoverage.verifier, 1);
assert.equal(strictPass.roleCoverage.humanArbiter, true);
assert.equal(strictPass.independenceScore, 100);
assert.equal(strictPass.groundingSatisfied, true);
assert.equal(strictPass.modelDiversity.score, 1);
console.log('✓ strict distinct roles pass');

const proposerChallengerReuse: GameRolesConfig = {
  ...distinctRoles,
  challengers: [proposer.id],
};
const strictCollision = evaluateGameConfiguration({
  agents,
  gameRoles: proposerChallengerReuse,
  policy: strictPolicy,
});
assert.equal(strictCollision.status, 'blocked');
assert.ok(strictCollision.blockingIssues.some((issue) => issue.includes('提案与挑战')));
assert.ok(strictCollision.criticalCollisions.some((item) => item.includes('Proposer = Challenger')));
assert.ok(strictCollision.independenceScore < 100);
console.log('✓ strict proposer/challenger collision blocked');

const flexibleCollision = evaluateGameConfiguration({
  agents,
  gameRoles: proposerChallengerReuse,
  policy: flexiblePolicy,
});
assert.equal(flexibleCollision.status, 'warning');
assert.equal(flexibleCollision.blockingIssues.length, 0);
assert.ok(flexibleCollision.warnings.some((warning) => warning.includes('自我挑战')));
assert.deepEqual(flexibleCollision.reusedRoleBindings[0]?.roles, [
  'proposer',
  'challenger',
]);
console.log('✓ flexible role reuse allowed with visible warning');

const proposerVerifierReuse: GameRolesConfig = {
  ...distinctRoles,
  verifiers: [proposer.id],
};
const strictVerifierCollision = evaluateGameConfiguration({
  agents,
  gameRoles: proposerVerifierReuse,
  policy: strictPolicy,
});
assert.equal(strictVerifierCollision.status, 'blocked');
assert.ok(
  strictVerifierCollision.blockingIssues.some((issue) => issue.includes('验证者独立'))
);
console.log('✓ strict grounding verifier independence enforced');

const missingVerifier: GameRolesConfig = {
  ...distinctRoles,
  verifiers: [],
};
const strictMissingVerifier = evaluateGameConfiguration({
  agents,
  gameRoles: missingVerifier,
  policy: strictPolicy,
});
assert.equal(strictMissingVerifier.status, 'blocked');
assert.equal(strictMissingVerifier.groundingSatisfied, false);
const flexibleMissingVerifier = evaluateGameConfiguration({
  agents,
  gameRoles: missingVerifier,
  policy: flexiblePolicy,
});
assert.equal(flexibleMissingVerifier.status, 'warning');
assert.ok(
  flexibleMissingVerifier.warnings.some((warning) => warning.includes('未配置 Verifier'))
);
console.log('✓ grounding requirement is strict-blocking and flexible-warning');

const missingProposer: GameRolesConfig = {
  ...distinctRoles,
  proposers: [],
};
assert.equal(
  evaluateGameConfiguration({
    agents,
    gameRoles: missingProposer,
    policy: flexiblePolicy,
  }).status,
  'blocked'
);
console.log('✓ proposer is mandatory in both profiles');

const missingChallenger: GameRolesConfig = {
  ...distinctRoles,
  challengers: [],
};
assert.equal(
  evaluateGameConfiguration({
    agents,
    gameRoles: missingChallenger,
    policy: strictPolicy,
  }).status,
  'blocked'
);
const flexibleMissingChallenger = evaluateGameConfiguration({
  agents,
  gameRoles: missingChallenger,
  policy: flexiblePolicy,
});
assert.equal(flexibleMissingChallenger.status, 'warning');
assert.ok(
  flexibleMissingChallenger.warnings.some((warning) => warning.includes('没有挑战 Agent'))
);
console.log('✓ challenger strict-blocking/flexible-warning semantics verified');

const noArbitration = evaluateGameConfiguration({
  agents,
  gameRoles: {
    ...distinctRoles,
    humanIsArbiter: false,
    arbiters: [],
  },
  policy: flexiblePolicy,
});
assert.equal(noArbitration.status, 'blocked');
assert.equal(noArbitration.arbitrationConfigured, false);
console.log('✓ final arbitration is mandatory');

const debateArbiterConflict = evaluateGameConfiguration({
  agents,
  gameRoles: {
    ...distinctRoles,
    arbiters: [challenger.id],
    humanIsArbiter: false,
  },
  policy: strictPolicy,
});
assert.equal(debateArbiterConflict.status, 'blocked');
assert.ok(
  debateArbiterConflict.blockingIssues.some((issue) => issue.includes('AI 仲裁官'))
);
console.log('✓ debate participant cannot self-arbitrate in strict mode');

const unknownAgent = evaluateGameConfiguration({
  agents,
  gameRoles: {
    ...distinctRoles,
    challengers: ['agent-missing'],
  },
  policy: flexiblePolicy,
});
assert.equal(unknownAgent.status, 'blocked');
assert.ok(unknownAgent.blockingIssues.some((issue) => issue.includes('不可用')));
console.log('✓ unavailable Agent IDs fail closed');

const homogeneous = evaluateGameConfiguration({
  agents: [
    proposer,
    { ...proposer, id: 'agent-proposer-2', name: 'Claude Challenger' },
    { ...proposer, id: 'agent-proposer-3', name: 'Claude Verifier' },
  ],
  gameRoles: {
    proposers: [proposer.id],
    challengers: ['agent-proposer-2'],
    verifiers: ['agent-proposer-3'],
    arbiters: [],
    humanIsArbiter: true,
  },
  policy: flexiblePolicy,
});
assert.equal(homogeneous.modelDiversity.isHomogeneous, true);
assert.ok(homogeneous.warnings.some((warning) => warning.includes('同质化')));
console.log('✓ model diversity result is integrated into the same evaluation');

assert.deepEqual(
  normalizeGameTheoreticPolicy(undefined),
  LEGACY_GAME_THEORETIC_POLICY
);
assert.deepEqual(
  normalizeGameTheoreticPolicy(RECOMMENDED_GAME_THEORETIC_POLICY),
  RECOMMENDED_GAME_THEORETIC_POLICY
);
console.log('✓ legacy and recommended policy defaults are explicit');

console.log('Game configuration evaluation suite passed.');
