import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameConfigurationEvaluationCard } from '../../components/GameConfigurationEvaluationCard';
import { Agent, GameRolesConfig } from '../../types';
import {
  evaluateGameConfiguration,
  LEGACY_GAME_THEORETIC_POLICY,
  RECOMMENDED_GAME_THEORETIC_POLICY,
} from './gameConfigurationEvaluator';

const agent = (id: string, name: string, model: string) =>
  ({
    id,
    name,
    handle: `@${id}`,
    role: name,
    modelBadge: model,
    modelConfig: { modelId: model, provider: 'openai_compatible' },
  }) as unknown as Agent;

const proposer = agent('proposer', '提案 Agent', 'GPT-4o');
const challenger = agent('challenger', '挑战 Agent', 'DeepSeek-R1');
const verifier = agent('verifier', '验证 Agent', 'Claude 3.7');
const agents = [proposer, challenger, verifier];

const passingRoles: GameRolesConfig = {
  proposers: [proposer.id],
  challengers: [challenger.id],
  verifiers: [verifier.id],
  arbiters: [],
  humanIsArbiter: true,
};

const passHtml = renderToStaticMarkup(
  React.createElement(GameConfigurationEvaluationCard, {
    evaluation: evaluateGameConfiguration({
      agents,
      gameRoles: passingRoles,
      policy: RECOMMENDED_GAME_THEORETIC_POLICY,
    }),
    onPolicyChange: () => undefined,
    onGroundingRequiredChange: () => undefined,
  })
);

assert.ok(passHtml.includes('博弈配置评估'));
assert.ok(passHtml.includes('配置合格'));
assert.ok(passHtml.includes('严格模式'));
assert.ok(passHtml.includes('灵活模式'));
assert.ok(passHtml.includes('独立 Agent'));
assert.ok(passHtml.includes('3 个'));
assert.ok(passHtml.includes('模型多样性'));
assert.ok(passHtml.includes('人类终审'));
assert.ok(passHtml.includes('查看计算口径'));

const blockedHtml = renderToStaticMarkup(
  React.createElement(GameConfigurationEvaluationCard, {
    evaluation: evaluateGameConfiguration({
      agents,
      gameRoles: {
        ...passingRoles,
        challengers: [proposer.id],
      },
      policy: RECOMMENDED_GAME_THEORETIC_POLICY,
    }),
  })
);

assert.ok(blockedHtml.includes('禁止启动'));
assert.ok(blockedHtml.includes('Proposer = Challenger'));
assert.ok(blockedHtml.includes('提案与挑战'));
assert.ok(blockedHtml.includes('多角色 Agent'));
assert.ok(blockedHtml.includes('提案 Agent = 提案 + 挑战'));

const flexibleHtml = renderToStaticMarkup(
  React.createElement(GameConfigurationEvaluationCard, {
    evaluation: evaluateGameConfiguration({
      agents,
      gameRoles: {
        ...passingRoles,
        challengers: [proposer.id],
      },
      policy: LEGACY_GAME_THEORETIC_POLICY,
    }),
  })
);

assert.ok(flexibleHtml.includes('有警告，可启动'));
assert.ok(flexibleHtml.includes('自我挑战'));
assert.ok(flexibleHtml.includes('不需要'));

console.log('Game configuration evaluation UI suite passed.');
