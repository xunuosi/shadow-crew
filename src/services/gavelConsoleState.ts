import type { GameTheoreticStage, GameTheoreticState } from '../types';

/**
 * 人类首席仲裁官法槌控制台的显示语义。
 * - idle：无在途回合，也未进入必须由人类裁决的状态，保留随时截断权；
 * - busy：该议题仍有 Agent 生成中或落地执行中，禁止落槌（避免同会话并发 prompt / 迟到回复写回阶段）；
 * - awaiting_ruling：契约熔断、SPRT 死锁、法定人数告警或仲裁阶段，需要人类裁决。
 */
export type GavelConsoleTone = 'idle' | 'busy' | 'awaiting_ruling';

export interface GavelConsoleInput {
  isResolved: boolean;
  stage?: GameTheoreticStage | null;
  quorumAlert?: string | null;
  sprtDecisionState?: 'continue' | 'early_exit' | 'deadlock_escalation' | null;
  executionStatus?: GameTheoreticState['executionStatus'];
  hasPendingMessage: boolean;
  activeExecutionCount: number;
}

export interface GavelConsoleState {
  tone: GavelConsoleTone;
  /** 是否存在在途回合（Agent 生成 / 落地执行），为 true 时禁止落槌 */
  isBusy: boolean;
  /** 是否处于真正等待人类裁决的状态（用于高亮与自动展开提示） */
  needsHumanRuling: boolean;
  /** 仅当无在途回合时才允许落槌，保留回合边界的紧急截断权 */
  canRule: boolean;
  /** 等待裁决的原因提示；非等待态为 undefined */
  prompt?: string;
}

/**
 * 纯函数推导法槌控制台语义。
 * 设计边界：原设计允许人类仲裁官在任何轮次随时截断，因此不在 idle 态禁用按钮；
 * 只禁止「某一轮 Agent 正在生成的过程中落槌」，避免同会话并发 prompt 与阶段写回冲突。
 */
export function deriveGavelConsoleState(input: GavelConsoleInput): GavelConsoleState {
  const isBusy =
    input.hasPendingMessage ||
    input.activeExecutionCount > 0 ||
    input.executionStatus === 'queued' ||
    input.executionStatus === 'running';

  const isStageFailed = input.stage === 'stageFailed';
  const isSprtDeadlock = input.sprtDecisionState === 'deadlock_escalation';
  const hasQuorumAlert = Boolean(input.quorumAlert?.trim());
  const isArbitrationStage = input.stage === 'arbitration';

  const needsHumanRuling =
    !input.isResolved &&
    (isStageFailed || isSprtDeadlock || hasQuorumAlert || isArbitrationStage);

  let prompt: string | undefined;
  if (needsHumanRuling) {
    if (isStageFailed) {
      prompt = '阶段契约熔断，需人类介入裁决';
    } else if (isSprtDeadlock) {
      prompt = 'SPRT 死锁，系统已阻断自动推演';
    } else if (hasQuorumAlert) {
      prompt = '法定人数未达标，需具名豁免后定案';
    } else {
      prompt = '推演已进入仲裁阶段，等待你落槌';
    }
  }

  return {
    tone: isBusy ? 'busy' : needsHumanRuling ? 'awaiting_ruling' : 'idle',
    isBusy,
    needsHumanRuling,
    canRule: !isBusy,
    prompt,
  };
}
