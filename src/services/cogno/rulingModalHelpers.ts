import {
  ActiveAgentExecution,
  Agent,
  GameRoleType,
  RulingDecisionType,
  TopicMessageData,
} from '../../types';
import { isAgentOffline } from '../../utils/agentRuntime';
import { synthesizeContextGroundedRulingDrafts } from './rulingDraftSynthesizer';

export const RULING_MODAL_DEFAULT_WIDTH = 680;
export const RULING_MODAL_WIDESCREEN_WIDTH = 900;
export const RULING_MODAL_MIN_WIDTH = 560;
export const RULING_MODAL_MAX_WIDTH = 1120;
export const RULING_MODAL_WIDTH_STORAGE_KEY = 'shinobi_arbiter_ruling_modal_width';

export interface RulingModeDraftState {
  summary: string;
  solution: string;
  impactedFiles: string[];
  tradeOffPoints: string[];
  isCustomized: boolean;
}

export type ExecutorAvailability = 'online' | 'busy' | 'offline';

export interface ExecutorCandidateOption {
  agent: Agent;
  isParticipant: boolean;
  gameRoles: GameRoleType[];
  availability: ExecutorAvailability;
  availabilityLabel: string;
}

export interface RulingSubmitGateState {
  isChallengerQuorumMet: boolean;
  consistencyPassed: boolean;
  requiresExemption: boolean;
  canSubmit: boolean;
  blockingReasons: Array<'quorum' | 'consistency'>;
}

const FILE_INPUT_DELIMITERS = [',', '，', '\n', '\r', ';', '；'] as const;

/**
 * 将裁决书弹窗宽度钳制在安全区间内，兼容异常数值与窄视口。
 */
export function clampRulingModalWidth(width: number, viewportWidth: number): number {
  const safeViewport =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280;
  const viewportCap = Math.max(320, Math.floor(safeViewport * 0.94));
  const effectiveMax = Math.min(RULING_MODAL_MAX_WIDTH, viewportCap);
  const effectiveMin = Math.min(RULING_MODAL_MIN_WIDTH, effectiveMax);
  const baseWidth = Number.isFinite(width) ? width : RULING_MODAL_DEFAULT_WIDTH;

  return Math.min(effectiveMax, Math.max(effectiveMin, Math.round(baseWidth)));
}

function deduplicateTrimmedStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = String(item ?? '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

/**
 * 确定性拆分受影响文件路径输入（支持英文/中文逗号、分号及换行），保持首次出现顺序并去重。
 */
export function parseImpactedFilesInput(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  let segments: string[] = [raw];
  for (const delimiter of FILE_INPUT_DELIMITERS) {
    segments = segments.flatMap((segment) => segment.split(delimiter));
  }
  return deduplicateTrimmedStrings(segments);
}

/**
 * 合并新增受影响文件路径到既有集合，保持顺序且不重复。
 */
export function mergeImpactedFiles(
  existing: readonly string[],
  additions: readonly string[]
): string[] {
  return deduplicateTrimmedStrings([...existing, ...additions]);
}

/**
 * 按裁决模式确定默认推荐的落地执行 Agent。
 */
export function resolveDefaultExecutorId(
  topic: TopicMessageData | null,
  type: RulingDecisionType
): string {
  const roles = topic?.gameRoles;
  if (!roles) return '';
  if (type === 'adopt_proposer') {
    return roles.proposers?.[0] || '';
  }
  if (type === 'reject_rebuild') {
    return roles.challengers?.[0] || roles.proposers?.[0] || '';
  }
  return roles.proposers?.[0] || roles.arbiters?.[0] || '';
}

/**
 * 按三层回退策略解析综合仲裁官预生成草案（或基于议题上下文实时合成草案）。
 */
export function resolveAiRulingDraft(
  topic: TopicMessageData | null,
  type: RulingDecisionType
): RulingModeDraftState {
  const options = topic?.gameTheoreticState?.rulingDraftOptions;
  const optionDraft = options?.[type];
  if (optionDraft) {
    return {
      summary: optionDraft.summary || '',
      solution: optionDraft.solution || '',
      impactedFiles: deduplicateTrimmedStrings(optionDraft.impactedFiles || []),
      tradeOffPoints: (optionDraft.tradeOffPoints || [])
        .map((p) => String(p ?? '').trim())
        .filter((p) => p.length > 0),
      isCustomized: false,
    };
  }

  const existingDraft = topic?.gameTheoreticState?.rulingDraft;
  if (existingDraft && existingDraft.decisionType === type) {
    return {
      summary: existingDraft.summary || '',
      solution: existingDraft.solution || '',
      impactedFiles: deduplicateTrimmedStrings(existingDraft.impactedFiles || []),
      tradeOffPoints: (existingDraft.tradeOffPoints || [])
        .map((p) => String(p ?? '').trim())
        .filter((p) => p.length > 0),
      isCustomized: false,
    };
  }

  const synthesized = synthesizeContextGroundedRulingDrafts({
    topicTitle: topic?.title || '当前研讨议题',
    topicDescription: topic?.description,
    proposalText: topic?.gameTheoreticState?.targetProposalContent,
    critiqueText: topic?.gameTheoreticState?.targetChallengeContent,
    defenseText: topic?.gameTheoreticState?.targetDefenseContent,
    verificationText: topic?.gameTheoreticState?.targetVerificationContent,
    mcdaPayload: topic?.gameTheoreticState?.mcdaPayload,
    existingDraft,
    existingOptions: options,
  });

  const targetDraft = synthesized[type];
  return {
    summary: targetDraft?.summary || '',
    solution: targetDraft?.solution || '',
    impactedFiles: deduplicateTrimmedStrings(targetDraft?.impactedFiles || []),
    tradeOffPoints: (targetDraft?.tradeOffPoints || [])
      .map((p) => String(p ?? '').trim())
      .filter((p) => p.length > 0),
    isCustomized: false,
  };
}

/**
 * 解析法槌弹窗当前裁决模式应展示的草案内容：优先返回人类已定制编辑的版本。
 */
export function resolveModalRulingDraft(
  topic: TopicMessageData | null,
  type: RulingDecisionType,
  customDrafts: Partial<Record<RulingDecisionType, RulingModeDraftState>>
): RulingModeDraftState {
  const custom = customDrafts[type];
  if (custom && custom.isCustomized) {
    return {
      summary: custom.summary,
      solution: custom.solution,
      impactedFiles: [...custom.impactedFiles],
      tradeOffPoints: [...custom.tradeOffPoints],
      isCustomized: true,
    };
  }
  return resolveAiRulingDraft(topic, type);
}

/**
 * 构造结构化落地执行 Agent 候选列表：优先列出议题参与者，附带博弈角色与实时状态。
 */
export function buildExecutorCandidates(
  topic: TopicMessageData | null,
  agents: Agent[],
  allActiveExecutions: ActiveAgentExecution[] = []
): ExecutorCandidateOption[] {
  const participatingIds = new Set(topic?.participatingAgentIds || []);
  const participants = agents.filter((agent) => participatingIds.has(agent.id));
  const others = agents.filter((agent) => !participatingIds.has(agent.id));
  const ordered = [...participants, ...others];

  const isGameMode = topic?.discussionMode === 'game_theoretic';
  const gameRoles = topic?.gameRoles;

  return ordered.map((agent) => {
    const roles: GameRoleType[] = [];
    if (isGameMode && gameRoles) {
      if (gameRoles.proposers?.includes(agent.id)) roles.push('proposer');
      if (gameRoles.challengers?.includes(agent.id)) roles.push('challenger');
      if (gameRoles.verifiers?.includes(agent.id)) roles.push('verifier');
      if (gameRoles.arbiters?.includes(agent.id)) roles.push('arbiter');
    }

    let availability: ExecutorAvailability = 'online';
    let availabilityLabel = '在线就绪';
    if (isAgentOffline(agent)) {
      availability = 'offline';
      availabilityLabel = '离线 · 需先启动';
    } else if (allActiveExecutions.some((exec) => exec.agentId === agent.id)) {
      availability = 'busy';
      availabilityLabel = '忙碌 · 自动排队';
    }

    return {
      agent,
      isParticipant: participatingIds.has(agent.id),
      gameRoles: roles,
      availability,
      availabilityLabel,
    };
  });
}

/**
 * 评估定案提交按钮的门禁准入状态与阻断原因。
 */
export function evaluateRulingSubmitState(params: {
  isChallengerQuorumMet: boolean;
  consistencyPassed: boolean;
  exemptionChecked: boolean;
}): RulingSubmitGateState {
  const { isChallengerQuorumMet, consistencyPassed, exemptionChecked } = params;
  const blockingReasons: Array<'quorum' | 'consistency'> = [];
  if (!consistencyPassed) blockingReasons.push('consistency');
  if (!isChallengerQuorumMet) blockingReasons.push('quorum');

  const requiresExemption = blockingReasons.length > 0;
  const canSubmit = !requiresExemption || exemptionChecked;

  return {
    isChallengerQuorumMet,
    consistencyPassed,
    requiresExemption,
    canSubmit,
    blockingReasons,
  };
}
