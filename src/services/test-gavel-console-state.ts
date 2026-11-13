import assert from 'node:assert/strict';
import { deriveGavelConsoleState, type GavelConsoleInput } from './gavelConsoleState';

console.log('=== Gavel Console State Test Suite ===');

function input(overrides: Partial<GavelConsoleInput> = {}): GavelConsoleInput {
  return {
    isResolved: false,
    stage: 'proposal',
    quorumAlert: undefined,
    sprtDecisionState: 'continue',
    executionStatus: 'idle',
    hasPendingMessage: false,
    activeExecutionCount: 0,
    ...overrides,
  };
}

// 1. 普通推演中：保留随时截断权，不置灰、不高亮
{
  const state = deriveGavelConsoleState(input());
  assert.equal(state.tone, 'idle');
  assert.equal(state.isBusy, false);
  assert.equal(state.needsHumanRuling, false);
  assert.equal(state.canRule, true);
  assert.equal(state.prompt, undefined);
}

// 2. 有 pending 回复：生成中禁止落槌
{
  const state = deriveGavelConsoleState(input({ hasPendingMessage: true }));
  assert.equal(state.tone, 'busy');
  assert.equal(state.isBusy, true);
  assert.equal(state.canRule, false);
}

// 3. 有活跃 execution：生成中禁止落槌
{
  const state = deriveGavelConsoleState(input({ activeExecutionCount: 1 }));
  assert.equal(state.isBusy, true);
  assert.equal(state.canRule, false);
}

// 4. 落地执行排队/进行中同样视为在途
{
  assert.equal(deriveGavelConsoleState(input({ executionStatus: 'queued' })).isBusy, true);
  assert.equal(deriveGavelConsoleState(input({ executionStatus: 'running' })).isBusy, true);
  assert.equal(deriveGavelConsoleState(input({ executionStatus: 'completed' })).isBusy, false);
  assert.equal(deriveGavelConsoleState(input({ executionStatus: 'applied' })).isBusy, false);
  assert.equal(deriveGavelConsoleState(input({ executionStatus: undefined })).isBusy, false);
}

// 5. 仲裁阶段：需要人类裁决并高亮提示
{
  const state = deriveGavelConsoleState(input({ stage: 'arbitration' }));
  assert.equal(state.tone, 'awaiting_ruling');
  assert.equal(state.needsHumanRuling, true);
  assert.equal(state.canRule, true);
  assert.equal(state.prompt, '推演已进入仲裁阶段，等待你落槌');
}

// 6. 阶段契约熔断：需要人类介入
{
  const state = deriveGavelConsoleState(input({ stage: 'stageFailed' }));
  assert.equal(state.needsHumanRuling, true);
  assert.equal(state.prompt, '阶段契约熔断，需人类介入裁决');
}

// 7. SPRT 死锁（阶段仍停在 challenge）：需要人类介入
{
  const state = deriveGavelConsoleState(
    input({ stage: 'challenge', sprtDecisionState: 'deadlock_escalation' })
  );
  assert.equal(state.needsHumanRuling, true);
  assert.equal(state.prompt, 'SPRT 死锁，系统已阻断自动推演');
}

// 8. 法定人数告警：需要具名豁免
{
  const state = deriveGavelConsoleState(
    input({ stage: 'challenge', quorumAlert: '挑战者离线' })
  );
  assert.equal(state.needsHumanRuling, true);
  assert.equal(state.prompt, '法定人数未达标，需具名豁免后定案');
}

// 9. 空白告警不算需要裁决
{
  const state = deriveGavelConsoleState(input({ quorumAlert: '   ' }));
  assert.equal(state.needsHumanRuling, false);
  assert.equal(state.tone, 'idle');
}

// 10. 已定案：不再需要人类裁决（控制台由归档横幅替代）
{
  const state = deriveGavelConsoleState(input({ isResolved: true, stage: 'arbitration' }));
  assert.equal(state.needsHumanRuling, false);
  assert.equal(state.tone, 'idle');
}

// 11. 仲裁中同时有在途回合：高亮保留，但落槌被禁用
{
  const state = deriveGavelConsoleState(
    input({ stage: 'arbitration', hasPendingMessage: true })
  );
  assert.equal(state.tone, 'busy');
  assert.equal(state.needsHumanRuling, true);
  assert.equal(state.canRule, false);
  assert.equal(state.prompt, '推演已进入仲裁阶段，等待你落槌');
}

// 12. 提示优先级：阶段熔断 > SPRT 死锁 > 法定人数 > 仲裁
{
  assert.equal(
    deriveGavelConsoleState(
      input({ stage: 'stageFailed', sprtDecisionState: 'deadlock_escalation', quorumAlert: 'x' })
    ).prompt,
    '阶段契约熔断，需人类介入裁决'
  );
  assert.equal(
    deriveGavelConsoleState(
      input({ stage: 'challenge', sprtDecisionState: 'deadlock_escalation', quorumAlert: 'x' })
    ).prompt,
    'SPRT 死锁，系统已阻断自动推演'
  );
  assert.equal(
    deriveGavelConsoleState(input({ stage: 'arbitration', quorumAlert: 'x' })).prompt,
    '法定人数未达标，需具名豁免后定案'
  );
}

// 13. canRule 恒等于 !isBusy，避免用例遗漏组合
{
  const cases: GavelConsoleInput[] = [
    input(),
    input({ hasPendingMessage: true }),
    input({ activeExecutionCount: 2 }),
    input({ stage: 'arbitration' }),
    input({ stage: 'stageFailed', isResolved: true }),
    input({ executionStatus: 'running', stage: 'arbitration' }),
  ];
  for (const item of cases) {
    const state = deriveGavelConsoleState(item);
    assert.equal(state.canRule, !state.isBusy);
  }
}

console.log('✅ 13 gavel console state cases passed');
