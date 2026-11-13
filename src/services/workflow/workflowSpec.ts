import type {
  Agent,
  TopicWorkflowMode,
  WorkflowArtifactKind,
  WorkflowRoleAssignment,
  WorkflowRoleKind,
  WorkflowStageKey,
} from '../../types';

/**
 * 声明式工作流规格（WorkflowSpec）
 *
 * 设计目标：把「角色、阶段、交接物、验证级别」从硬编码 FSM 中解耦出来。
 * 新增一种日常场景只需要新增一份 stage 列表，不需要再写新的状态机分支。
 */
export interface WorkflowStageSpec {
  key: WorkflowStageKey;
  /** 展示名称 */
  label: string;
  /** 阶段图标（单 emoji，进度条直接复用） */
  icon: string;
  /** 该阶段由哪类角色执行 */
  role: WorkflowRoleKind;
  /** 产出的交接物类型 */
  artifactKind: WorkflowArtifactKind;
  /** 是否由多名评审者并行执行（彼此不可见对方结论） */
  parallel: boolean;
  /** 该阶段在角色缺失时允许被跳过 */
  optional: boolean;
  /** 该阶段需要注入的上游交接物（完整原文，不压缩） */
  inputStageKeys: WorkflowStageKey[];
  /** 卡片上的等待提示 */
  pendingHint: string;
}

export interface WorkflowModeMeta {
  mode: TopicWorkflowMode;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  /** 适合的场景说明（用于新建议题弹窗） */
  scenarios: string;
  minAgents: number;
  recommendedAgents: number;
  stages: WorkflowStageSpec[];
}

export interface WorkflowPlan {
  mode: TopicWorkflowMode;
  stageOrder: WorkflowStageKey[];
  roles: WorkflowRoleAssignment;
  warnings: string[];
  /** 非空表示该配置不允许启动 */
  blockingIssues: string[];
}

const CONSULT_STAGES: WorkflowStageSpec[] = [
  {
    key: 'consult_draft',
    label: '主笔产出',
    icon: '📝',
    role: 'author',
    artifactKind: 'document',
    parallel: false,
    optional: false,
    inputStageKeys: [],
    pendingHint: '正在检索工作区并撰写完整产出...',
  },
  {
    key: 'consult_crosscheck',
    label: '独立核验',
    icon: '🔍',
    role: 'critic',
    artifactKind: 'findings',
    parallel: true,
    optional: true,
    inputStageKeys: ['consult_draft'],
    pendingHint: '正在独立核验事实、遗漏与无依据断言...',
  },
  {
    key: 'consult_finalize',
    label: '合并定稿',
    icon: '📦',
    role: 'author',
    artifactKind: 'document',
    parallel: false,
    optional: false,
    inputStageKeys: ['consult_draft', 'consult_crosscheck'],
    pendingHint: '正在逐条回应核验意见并合并定稿...',
  },
];

const REVIEW_STAGES: WorkflowStageSpec[] = [
  {
    key: 'review_scan',
    label: '并行评审',
    icon: '🧭',
    role: 'critic',
    artifactKind: 'findings',
    parallel: true,
    optional: false,
    inputStageKeys: [],
    pendingHint: '正在独立评审，互不可见彼此结论...',
  },
  {
    key: 'review_synthesize',
    label: '汇总裁定',
    icon: '⚖️',
    role: 'synthesizer',
    artifactKind: 'summary',
    parallel: false,
    optional: false,
    inputStageKeys: ['review_scan'],
    pendingHint: '正在去重、分级并汇总评审结论...',
  },
];

const BUILD_STAGES: WorkflowStageSpec[] = [
  {
    key: 'build_design',
    label: '方案设计',
    icon: '🏗️',
    role: 'author',
    artifactKind: 'plan',
    parallel: false,
    optional: false,
    inputStageKeys: [],
    pendingHint: '正在产出实现方案与验收标准...',
  },
  {
    key: 'build_design_review',
    label: '方案评审',
    icon: '🔎',
    role: 'critic',
    artifactKind: 'findings',
    parallel: false,
    optional: false,
    inputStageKeys: ['build_design'],
    pendingHint: '正在独立审查方案可实现性与边界覆盖...',
  },
  {
    key: 'build_implement',
    label: '实施落地',
    icon: '🛠️',
    role: 'author',
    artifactKind: 'diff',
    parallel: false,
    optional: false,
    inputStageKeys: ['build_design', 'build_design_review'],
    pendingHint: '正在按已通过评审的方案修改工作区...',
  },
  {
    key: 'build_verify',
    label: '独立验收',
    icon: '🧪',
    role: 'verifier',
    artifactKind: 'verification',
    parallel: false,
    optional: false,
    inputStageKeys: ['build_design', 'build_implement'],
    pendingHint: '正在按验收标准独立执行测试与构建校验...',
  },
  {
    key: 'build_fix',
    label: '失败返修',
    icon: '🔧',
    role: 'author',
    artifactKind: 'diff',
    parallel: false,
    optional: false,
    inputStageKeys: ['build_verify', 'build_design'],
    pendingHint: '正在针对验收失败项返修...',
  },
  {
    key: 'build_accept',
    label: '交付摘要',
    icon: '📦',
    role: 'author',
    artifactKind: 'summary',
    parallel: false,
    optional: false,
    inputStageKeys: ['build_design', 'build_implement', 'build_verify'],
    pendingHint: '正在整理交付摘要与证据...',
  },
];

export const WORKFLOW_MODES: Record<TopicWorkflowMode, WorkflowModeMeta> = {
  consult: {
    mode: 'consult',
    label: '咨询产出',
    shortLabel: '咨询',
    icon: '📚',
    description: '只读检索 + 主笔产出 + 独立核验，产出可直接使用的文档/分析。',
    scenarios: '代码梳理与讲解、技术文档、变更影响半径、选型对比、源码导读、POC 预研',
    minAgents: 1,
    recommendedAgents: 2,
    stages: CONSULT_STAGES,
  },
  review: {
    mode: 'review',
    label: '评审审查',
    shortLabel: '评审',
    icon: '🧭',
    description: '多名评审者并行独立评审，再统一去重分级，避免单一视角漏判。',
    scenarios: '方案评审、Code Review、安全自查、规范检查、SQL/配置/CI 审查、需求歧义校验',
    minAgents: 2,
    recommendedAgents: 3,
    stages: REVIEW_STAGES,
  },
  build: {
    mode: 'build',
    label: '交付实施',
    shortLabel: '交付',
    icon: '🛠️',
    description: '设计 → 方案评审 → 实现 → 独立验收 → 返修 → 交付，实现者与验收者分离。',
    scenarios: '功能开发、脚本与单测生成、迁移方案、容器编排、故障修复',
    minAgents: 2,
    recommendedAgents: 3,
    stages: BUILD_STAGES,
  },
};

const AUTHOR_HINTS = [
  'dev', 'developer', 'engineer', 'backend', 'frontend', 'fullstack', 'architect',
  '开发', '架构', '后端', '前端', '实现', '工程',
];
const CRITIC_HINTS = [
  'review', 'reviewer', 'audit', 'qa', 'quality', 'security', 'secure', 'architect',
  '审查', '评审', '质量', '安全', '红队', '架构', '规范',
];
const VERIFIER_HINTS = [
  'test', 'tester', 'qa', 'verify', 'verification', 'sandbox', 'automation',
  '测试', '验证', '验收', '自动化', '沙箱', '接地',
];

function agentSearchText(agent: Agent): string {
  return `${agent.name} ${agent.handle} ${agent.role} ${agent.description}`.toLowerCase();
}

function scoreAgent(agent: Agent, hints: string[]): number {
  const text = agentSearchText(agent);
  return hints.reduce((score, hint) => (text.includes(hint) ? score + 1 : score), 0);
}

/**
 * 按角色语义打分挑选 Agent；找不到明显匹配时按顺序兜底，保证不出现空角色。
 */
function pickAgent(
  pool: Agent[],
  hints: string[],
  used: Set<string>
): Agent | undefined {
  const candidates = pool.filter((agent) => !used.has(agent.id));
  if (candidates.length === 0) {
    return undefined;
  }
  let best: Agent | undefined;
  let bestScore = 0;
  for (const agent of candidates) {
    const score = scoreAgent(agent, hints);
    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }
  const picked = bestScore > 0 ? best! : candidates[0];
  used.add(picked.id);
  return picked;
}

export function resolveWorkflowRoles(
  mode: TopicWorkflowMode,
  participants: Agent[]
): { roles: WorkflowRoleAssignment; warnings: string[] } {
  const warnings: string[] = [];
  const pool = participants.filter((agent) => Boolean(agent?.id));
  const used = new Set<string>();
  const author = pickAgent(pool, AUTHOR_HINTS, used);
  if (!author) {
    // 空池由 plan 校验拦截，这里返回占位避免类型断言
    return { roles: { author: '', criticIds: [] }, warnings };
  }

  if (mode === 'consult') {
    const critic = pool.length > 1 ? pickAgent(pool, CRITIC_HINTS, used) : undefined;
    return {
      roles: {
        author: author.id,
        criticIds: critic ? [critic.id] : [],
      },
      warnings,
    };
  }

  if (mode === 'review') {
    const criticIds = pool.filter((agent) => agent.id !== author.id).map((agent) => agent.id);
    if (criticIds.length === 0) {
      return { roles: { author: author.id, criticIds: [] }, warnings };
    }
    // 优先把明显具备评审能力的 Agent 排到前面，合成者使用 author
    const sorted = [...pool]
      .filter((agent) => agent.id !== author.id)
      .sort((a, b) => scoreAgent(b, CRITIC_HINTS) - scoreAgent(a, CRITIC_HINTS))
      .slice(0, 3)
      .map((agent) => agent.id);
    return { roles: { author: author.id, criticIds: sorted }, warnings };
  }

  // build：作者、评审、验收尽量由三个不同 Agent 承担
  const critic = pickAgent(pool, CRITIC_HINTS, used) || author;
  const verifier = pickAgent(pool, VERIFIER_HINTS, used) || critic;
  if (critic.id === author.id) {
    warnings.push('未找到独立的方案评审者，方案评审由主笔自行完成，独立性下降。');
  }
  if (verifier.id === critic.id) {
    warnings.push('评审与独立验收由同一 Agent 承担，验收独立性下降，建议至少指派 3 名 Agent。');
  }
  if (verifier.id === author.id) {
    warnings.push('当前没有独立验收者，验收由实现者自行执行，结论可信度显著下降。');
  }
  return {
    roles: {
      author: author.id,
      criticIds: critic.id === author.id ? [] : [critic.id],
      verifierId: verifier.id,
    },
    warnings,
  };
}

export function createWorkflowPlan(
  mode: TopicWorkflowMode,
  participants: Agent[]
): WorkflowPlan {
  const meta = WORKFLOW_MODES[mode];
  const { roles, warnings } = resolveWorkflowRoles(mode, participants);
  const blockingIssues: string[] = [];

  if (participants.length < meta.minAgents) {
    blockingIssues.push(
      `${meta.label}模式至少需要 ${meta.minAgents} 名在线 Agent，当前仅 ${participants.length} 名。`
    );
  }
  if (!roles.author) {
    blockingIssues.push('未找到可担任主笔的执行 Agent。');
  }
  if (mode === 'review' && roles.criticIds.length === 0) {
    blockingIssues.push('评审模式至少需要一名与汇总者不同的独立评审 Agent。');
  }
  if (mode === 'build' && !roles.verifierId) {
    blockingIssues.push('交付模式缺少独立验收 Agent，无法形成实现与验收分离。');
  }

  return {
    mode,
    stageOrder: meta.stages.map((stage) => stage.key),
    roles,
    warnings,
    blockingIssues,
  };
}

export function getWorkflowStageSpec(key: WorkflowStageKey): WorkflowStageSpec {
  for (const meta of Object.values(WORKFLOW_MODES)) {
    const found = meta.stages.find((stage) => stage.key === key);
    if (found) return found;
  }
  throw new Error(`未知的工作流阶段: ${key}`);
}

export function getWorkflowModeMeta(mode: TopicWorkflowMode): WorkflowModeMeta {
  return WORKFLOW_MODES[mode];
}

/** 返回某阶段应执行的 Agent ID 列表（并行阶段可能多人） */
export function resolveStageAgentIds(
  stage: WorkflowStageSpec,
  roles: WorkflowRoleAssignment
): string[] {
  switch (stage.role) {
    case 'critic':
      return stage.parallel ? roles.criticIds : roles.criticIds.slice(0, 1);
    case 'verifier':
      return roles.verifierId ? [roles.verifierId] : [];
    case 'synthesizer':
    case 'author':
    default:
      return roles.author ? [roles.author] : [];
  }
}
