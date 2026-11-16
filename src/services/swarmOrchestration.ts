import type {
  Agent,
  SwarmMissionData,
  SwarmMissionTriggerMode,
  SwarmSubTask,
  TopicPatchDiffItem,
} from '../types';
import {
  dehydrateTargetTextForHandover,
  escapeSemanticText,
  resolveEffectiveAgentHandle,
  wrapSemanticSection,
} from './agentCollaboration';
import { mergeTopicPatchDiffs } from './cogno/bayesianModuleGovernor';

export interface SwarmTriggerIntent {
  isSwarmTrigger: boolean;
  triggerMode: SwarmMissionTriggerMode;
  taskText: string;
  hasSlashPrefix: boolean;
}

export interface SwarmPlanExtractionContext {
  missionId?: string;
  roomId: string;
  channelId?: string;
  originalTask: string;
  triggerMode: SwarmMissionTriggerMode;
  leadAgent: Agent;
  allChannelAgents: Agent[];
}

export interface SwarmPlanExtractionResult {
  plan: SwarmMissionData;
  cleanedText: string;
  isFallback: boolean;
}

interface RawParsedSwarmSubTask {
  taskId?: unknown;
  id?: unknown;
  title?: unknown;
  description?: unknown;
  suggestedAgentHandle?: unknown;
  agentHandle?: unknown;
  assignedAgentHandle?: unknown;
  assignedAgentId?: unknown;
  allowedFiles?: unknown;
}

interface RawParsedSwarmPlan {
  sharedContractSummary?: unknown;
  sharedContract?: unknown;
  summary?: unknown;
  subTasks?: unknown;
  subtasks?: unknown;
}

const SWARM_DELIM_OPEN = '<<<SWARM_PLAN>>>';
const SWARM_DELIM_CLOSE = '<<<SWARM_PLAN_END>>>';
const SWARM_XML_OPEN = '<swarm-plan>';
const SWARM_XML_CLOSE = '</swarm-plan>';

function extractDelimitedBlock(
  rawText: string,
  openTag: string,
  closeTag: string
): { matchedBlock: string; inner: string } | null {
  const lower = rawText.toLowerCase();
  const openIdx = lower.indexOf(openTag.toLowerCase());
  if (openIdx < 0) return null;
  const contentStart = openIdx + openTag.length;
  const closeIdx = lower.indexOf(closeTag.toLowerCase(), contentStart);
  if (closeIdx < 0) return null;
  return {
    matchedBlock: rawText.slice(openIdx, closeIdx + closeTag.length),
    inner: rawText.slice(contentStart, closeIdx),
  };
}

/**
 * 清洗并限制 Swarm missionId / taskId，严格保证仅包含 `[a-zA-Z0-9_-]`，
 * 满足 `acpClient.validateSessionSegment` 的安全边界。
 */
export function sanitizeSwarmIdSegment(raw: string, fallback = 'task'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 40);
  if (cleaned) {
    return cleaned;
  }
  const safeFallback = String(fallback || 'task')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return safeFallback || 'task';
}

export function buildSwarmMissionId(seed?: number): string {
  const ts = typeof seed === 'number' ? seed : Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return sanitizeSwarmIdSegment(`swarm-${ts}-${rand}`, 'swarm');
}

export function buildSwarmWorkerRoomId(parentRoomId: string, taskId: string): string {
  return `${parentRoomId}-swarm-${sanitizeSwarmIdSegment(taskId, 'worker')}`;
}

export function buildSwarmReduceRoomId(parentRoomId: string, missionId: string): string {
  return `${parentRoomId}-swarm-reduce-${sanitizeSwarmIdSegment(missionId, 'reduce')}`;
}

export function buildSwarmSubThreadId(missionId: string, taskId: string): string {
  return `swarm-sub-${sanitizeSwarmIdSegment(missionId, 'mission')}-${sanitizeSwarmIdSegment(taskId, 'worker')}`;
}

export function isSwarmChildRoomId(parentRoomId: string, candidateRoomId?: string): boolean {
  if (!parentRoomId || !candidateRoomId) return false;
  return candidateRoomId.startsWith(`${parentRoomId}-swarm-`);
}

/**
 * 识别用户在消息输入框中的显式 Swarm 触发意图：
 * 1) 开启了 composer 🐝 Swarm 开关
 * 2) 输入以 `/swarm` 开头的前缀命令
 */
export function detectSwarmTriggerIntent(
  rawText: string,
  explicitSwarmMode?: boolean
): SwarmTriggerIntent {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();
  const hasSlashPrefix =
    lower.startsWith('/swarm') &&
    (trimmed.length === 6 || trimmed[6] === ' ' || trimmed[6] === '\t' || trimmed[6] === '\n' || trimmed[6] === '\r');

  if (hasSlashPrefix) {
    const taskText = trimmed.slice(6).trim();
    return {
      isSwarmTrigger: true,
      triggerMode: 'explicit',
      taskText,
      hasSlashPrefix: true,
    };
  }

  return {
    isSwarmTrigger: Boolean(explicitSwarmMode),
    triggerMode: explicitSwarmMode ? 'explicit' : 'autonomous',
    taskText: trimmed,
    hasSlashPrefix: false,
  };
}

/**
 * 解析 Lead Agent 与候选 Worker 列表：
 * - 若用户 @ 了某个/某些 Agent，优先取第一个被 @ 的在线成员担任唯一 Lead Agent
 * - 若未 @ 任何人，则取当前频道首个在线成员作为 Lead Agent
 */
export function resolveSwarmLeadAndWorkers(options: {
  candidateAgents: Agent[];
  mentionedAgents?: Agent[];
}): {
  leadAgent: Agent | null;
  workerCandidates: Agent[];
} {
  const { candidateAgents, mentionedAgents = [] } = options;
  if (candidateAgents.length === 0) {
    return { leadAgent: null, workerCandidates: [] };
  }

  const candidateIds = new Set(candidateAgents.map((a) => a.id));
  const validMentionedLead = mentionedAgents.find((m) => candidateIds.has(m.id));
  const leadAgent = validMentionedLead || candidateAgents[0];

  const nonLeadWorkers = candidateAgents.filter((a) => a.id !== leadAgent.id);
  return {
    leadAgent,
    workerCandidates: nonLeadWorkers.length > 0 ? nonLeadWorkers : [leadAgent],
  };
}

function normalizeHandleToken(value?: string): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/**
 * 将 Lead 输出的 suggestedAgentHandle / id 解析为频道内的真实成员 Agent
 */
export function resolveSwarmSubTaskExecutor(options: {
  requestedHandleOrId?: string;
  workerCandidates: Agent[];
  allChannelAgents: Agent[];
  leadAgent: Agent;
  index: number;
}): Agent {
  const {
    requestedHandleOrId,
    workerCandidates,
    allChannelAgents,
    leadAgent,
    index,
  } = options;

  const pool = allChannelAgents.length > 0 ? allChannelAgents : [leadAgent];
  const normalizedTarget = normalizeHandleToken(requestedHandleOrId);

  if (normalizedTarget) {
    const exactIdMatch = pool.find(
      (a) => a.id.toLowerCase() === normalizedTarget
    );
    if (exactIdMatch) return exactIdMatch;

    const handleMatch = pool.find((a) => {
      const effectiveHandle = normalizeHandleToken(resolveEffectiveAgentHandle(a));
      const rawHandle = normalizeHandleToken(a.handle);
      const normalizedName = normalizeHandleToken(a.name);
      return (
        effectiveHandle === normalizedTarget ||
        rawHandle === normalizedTarget ||
        normalizedName === normalizedTarget
      );
    });
    if (handleMatch) return handleMatch;
  }

  const fallbackPool = workerCandidates.length > 0 ? workerCandidates : pool;
  return fallbackPool[index % fallbackPool.length] || leadAgent;
}

function normalizePathForOverlap(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function doPathsOverlap(rawA: string, rawB: string): boolean {
  const a = normalizePathForOverlap(rawA);
  const b = normalizeHandleFileEdge(normalizePathForOverlap(rawB));
  const normA = normalizeHandleFileEdge(a);
  if (!normA || !b) return false;
  if (normA === b) return true;
  if (normA === '*' || b === '*') return true;
  return b.startsWith(`${normA}/`) || normA.startsWith(`${b}/`);
}

function normalizeHandleFileEdge(pathValue: string): string {
  return pathValue.replace(/\/\*+$/, '');
}

/**
 * 实时计算所有「已启用 (enabled: true)」子任务之间的 allowedFiles 文件范围重叠警告。
 * 已禁用子任务不参与碰撞。
 */
export function computeSwarmFileOverlaps(subTasks: SwarmSubTask[]): SwarmSubTask[] {
  return subTasks.map((task, idx) => {
    if (!task.enabled || !task.allowedFiles || task.allowedFiles.length === 0) {
      return {
        ...task,
        overlappingFiles: undefined,
      };
    }

    const overlaps = new Set<string>();
    for (const fileA of task.allowedFiles) {
      const trimmedA = fileA.trim();
      if (!trimmedA) continue;
      for (let j = 0; j < subTasks.length; j += 1) {
        if (j === idx) continue;
        const peer = subTasks[j];
        if (!peer.enabled || !peer.allowedFiles || peer.allowedFiles.length === 0) {
          continue;
        }
        const matched = peer.allowedFiles.some((fileB) =>
          doPathsOverlap(trimmedA, fileB)
        );
        if (matched) {
          overlaps.add(trimmedA);
        }
      }
    }

    const overlappingFiles = Array.from(overlaps);
    return {
      ...task,
      overlappingFiles: overlappingFiles.length > 0 ? overlappingFiles : undefined,
    };
  });
}

function normalizeAllowedFilesList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const dedup = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) dedup.add(trimmed);
    }
  }
  const list = Array.from(dedup);
  return list.length > 0 ? list : undefined;
}

/**
 * 构建显式 Swarm 触发下发给单一 Lead Agent 的任务拆解 Prompt
 */
export function buildSwarmDecompositionPrompt(options: {
  leadAgent: Agent;
  availableAgents: Agent[];
  taskText: string;
}): string {
  const { leadAgent, availableAgents, taskText } = options;
  const peers = availableAgents.filter((a) => a.id !== leadAgent.id);

  const workerRosterLines = (peers.length > 0 ? peers : [leadAgent])
    .map((member) => {
      const handle = resolveEffectiveAgentHandle(member);
      return `- ${member.name} (${handle}) | 角色: ${member.role} | 状态: ${member.status}`;
    })
    .join('\n');

  const leadInstruction =
    `你当前担任本次协同任务的【🐝 Swarm 总控协调官 (Lead Coordinator)】(${leadAgent.name}, ${resolveEffectiveAgentHandle(leadAgent)})。\n` +
    `重要原则：\n` +
    `1. 【只拆解、不动手】：在当前规划阶段，你**严禁**直接修改工作区代码或执行落地变更！请专注把大任务拆分为 2～5 个可纯并行执行的正交子任务。\n` +
    `2. 【互不重叠的文件边界】：尽量为每个子任务划定互不重叠的 allowedFiles 文件/目录白名单，避免后续 Worker 并行改动发生文件冲突。\n` +
    `3. 【等待人类确认门禁】：本轮回复之后，系统将在任务拆解卡片处暂停，交由人类用户勾选、重指派或修改后手动点击派发。**严禁**在回复末尾使用 @mention 尝试私自唤醒任何成员！\n` +
    `4. 【纯并行上下文约定】：每位 Worker 彼此隔离，仅能看到原始任务、你编写的 sharedContractSummary 以及它自己的子任务描述；因此你必须在 sharedContractSummary 中交代清楚跨模块的公共接口契约、类型定义与技术约束。`;

  const outputContract =
    `请先用 2～3 句简洁中文说明你的总体拆分思路，然后**必须在末尾附带以下结构化 JSON 块**：\n\n` +
    `<<<SWARM_PLAN>>>\n` +
    `{\n` +
    `  "sharedContractSummary": "跨子任务的公共接口契约、数据结构与验收约束（简洁明了）",\n` +
    `  "subTasks": [\n` +
    `    {\n` +
    `      "taskId": "task-slug-1",\n` +
    `      "title": "简短子任务标题（不超过24字）",\n` +
    `      "description": "具体实现目标、输出格式与验收标准",\n` +
    `      "suggestedAgentHandle": "@某个可用Worker的handle",\n` +
    `      "allowedFiles": ["src/path/to/fileA.ts"]\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `<<<SWARM_PLAN_END>>>`;

  return [
    wrapSemanticSection('swarm-coordinator-role', leadInstruction, {
      mode: 'explicit',
    }),
    wrapSemanticSection('available-workers', workerRosterLines),
    wrapSemanticSection('swarm-task', escapeSemanticText(taskText)),
    wrapSemanticSection('output-contract', outputContract),
  ].join('\n\n');
}

function stripMarkdownCodeFence(candidateText: string): string {
  let s = candidateText.trim();
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    s = firstNewline >= 0 ? s.slice(firstNewline + 1) : s.slice(3);
  }
  s = s.trimEnd();
  if (s.endsWith('```')) {
    s = s.slice(0, -3);
  }
  return s.trim();
}

function tryParseJsonObject(candidateText: string): RawParsedSwarmPlan | null {
  const cleanedBlock = stripMarkdownCodeFence(candidateText);

  const tryParse = (str: string): RawParsedSwarmPlan | null => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as RawParsedSwarmPlan;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleanedBlock);
  if (direct) return direct;

  // 尝试剥离外层说明文字，仅抓取最外层 {...} 并消除尾随逗号
  const firstBrace = cleanedBlock.indexOf('{');
  const lastBrace = cleanedBlock.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = cleanedBlock
      .slice(firstBrace, lastBrace + 1)
      .replace(/,\s*([}\]])/g, '$1');
    return tryParse(sliced);
  }
  return null;
}

/**
 * 从 Lead Agent 回复文本中提取结构化 Swarm Plan (`<<<SWARM_PLAN>>>` 或 `<swarm-plan>`)。
 * 注意：日常普通问答若不包含有效结构化区块，本函数严格返回 `null`，绝不误触发。
 */
export function extractSwarmPlanFromText(
  rawText: string,
  ctx: SwarmPlanExtractionContext
): SwarmPlanExtractionResult | null {
  if (!rawText || !rawText.trim()) return null;

  const extracted =
    extractDelimitedBlock(rawText, SWARM_DELIM_OPEN, SWARM_DELIM_CLOSE) ??
    extractDelimitedBlock(rawText, SWARM_XML_OPEN, SWARM_XML_CLOSE);

  if (!extracted || !extracted.inner) {
    return null;
  }

  const matchedBlock = extracted.matchedBlock;
  const jsonCandidate = extracted.inner;

  const parsed = tryParseJsonObject(jsonCandidate);
  if (!parsed) {
    return null;
  }

  const rawTasks = Array.isArray(parsed.subTasks)
    ? parsed.subTasks
    : Array.isArray(parsed.subtasks)
    ? parsed.subtasks
    : null;

  if (!rawTasks || rawTasks.length === 0) {
    return null;
  }

  const missionId = sanitizeSwarmIdSegment(
    ctx.missionId || buildSwarmMissionId(),
    'swarm'
  );
  const { workerCandidates } = resolveSwarmLeadAndWorkers({
    candidateAgents: ctx.allChannelAgents,
    mentionedAgents: [ctx.leadAgent],
  });

  const usedTaskIds = new Set<string>();
  const builtTasks: SwarmSubTask[] = [];

  for (let i = 0; i < rawTasks.length; i += 1) {
    const raw = rawTasks[i] as RawParsedSwarmSubTask | null;
    if (!raw || typeof raw !== 'object') continue;

    const titleRaw = typeof raw.title === 'string' ? raw.title.trim() : '';
    const descRaw = typeof raw.description === 'string' ? raw.description.trim() : '';
    if (!titleRaw && !descRaw) continue;

    const baseId = sanitizeSwarmIdSegment(
      String(raw.taskId || raw.id || `task-${i + 1}`),
      `task-${i + 1}`
    );
    let uniqueTaskId = baseId;
    let suffix = 2;
    while (usedTaskIds.has(uniqueTaskId)) {
      uniqueTaskId = sanitizeSwarmIdSegment(`${baseId}-${suffix}`, `task-${i + 1}-${suffix}`);
      suffix += 1;
    }
    usedTaskIds.add(uniqueTaskId);

    const requestedRef =
      typeof raw.suggestedAgentHandle === 'string'
        ? raw.suggestedAgentHandle
        : typeof raw.assignedAgentHandle === 'string'
        ? raw.assignedAgentHandle
        : typeof raw.agentHandle === 'string'
        ? raw.agentHandle
        : typeof raw.assignedAgentId === 'string'
        ? raw.assignedAgentId
        : undefined;

    const assignedAgent = resolveSwarmSubTaskExecutor({
      requestedHandleOrId: requestedRef,
      workerCandidates,
      allChannelAgents: ctx.allChannelAgents,
      leadAgent: ctx.leadAgent,
      index: builtTasks.length,
    });

    builtTasks.push({
      taskId: uniqueTaskId,
      title: (titleRaw || descRaw.slice(0, 28)).slice(0, 64),
      description: descRaw || titleRaw,
      assignedAgentId: assignedAgent.id,
      originalAgentId: assignedAgent.id,
      enabled: true,
      allowedFiles: normalizeAllowedFilesList(raw.allowedFiles),
      status: 'pending',
      subThreadId: buildSwarmSubThreadId(missionId, uniqueTaskId),
    });
  }

  if (builtTasks.length === 0) {
    return null;
  }

  const sharedContractRaw =
    typeof parsed.sharedContractSummary === 'string'
      ? parsed.sharedContractSummary.trim()
      : typeof parsed.sharedContract === 'string'
      ? parsed.sharedContract.trim()
      : typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : '';

  const strippedText = rawText
    .replace(matchedBlock, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const plan: SwarmMissionData = {
    missionId,
    roomId: ctx.roomId,
    channelId: ctx.channelId,
    originalTask: ctx.originalTask,
    triggerMode: ctx.triggerMode,
    leadAgentId: ctx.leadAgent.id,
    sharedContractSummary:
      sharedContractRaw ||
      dehydrateTargetTextForHandover(strippedText || ctx.originalTask, 320),
    status: 'awaiting_approval',
    subTasks: computeSwarmFileOverlaps(builtTasks),
    createdAt: Date.now(),
  };

  return {
    plan,
    cleanedText:
      strippedText ||
      `🐝 已完成任务拆解（共 ${plan.subTasks.length} 个子任务），请在下方任务卡片中确认后并发派发。`,
    isFallback: false,
  };
}

/**
 * 显式 Swarm 模式下的兜底解析：
 * 当用户明确要求 Swarm 拆解，但 Lead 未按 `<<<SWARM_PLAN>>>` JSON 契约输出时，
 * 尽力从 Markdown 有序/无序列表提取子任务；若无可拆条目，则保底生成单个主执行任务，
 * 保证显式发起必定落为 `awaiting_approval` 确认卡片。
 */
export function buildFallbackSwarmPlan(
  rawText: string,
  ctx: SwarmPlanExtractionContext
): SwarmPlanExtractionResult {
  const missionId = sanitizeSwarmIdSegment(
    ctx.missionId || buildSwarmMissionId(),
    'swarm'
  );
  const { workerCandidates } = resolveSwarmLeadAndWorkers({
    candidateAgents: ctx.allChannelAgents,
    mentionedAgents: [ctx.leadAgent],
  });

  const listItems: Array<{ title: string; description: string }> = [];
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');

  const parseListItemLine = (line: string): { boldTitle: string; restBody: string } | null => {
    const s = line.trimStart();
    if (!s) return null;
    let body = '';
    if ((s[0] === '-' || s[0] === '*' || s[0] === '+') && (s[1] === ' ' || s[1] === '\t')) {
      body = s.slice(2).trimStart();
    } else {
      let i = 0;
      while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
      if (i > 0 && (s[i] === '.' || s[i] === ')') && (s[i + 1] === ' ' || s[i + 1] === '\t')) {
        body = s.slice(i + 2).trimStart();
      } else {
        return null;
      }
    }

    if (body.startsWith('**')) {
      const closeBold = body.indexOf('**', 2);
      if (closeBold > 2) {
        const boldTitle = body.slice(2, closeBold).trim();
        let restBody = body.slice(closeBold + 2).trimStart();
        if (restBody.startsWith(':') || restBody.startsWith('：') || restBody.startsWith('-')) {
          restBody = restBody.slice(1).trimStart();
        }
        return { boldTitle, restBody };
      }
    }
    return { boldTitle: '', restBody: body.trim() };
  };

  for (const line of lines) {
    const parsedLine = parseListItemLine(line);
    if (!parsedLine) continue;
    const { boldTitle, restBody } = parsedLine;
    const combined = [boldTitle, restBody].filter(Boolean).join('：');
    if (combined.length < 6) continue;
    listItems.push({
      title: (boldTitle || restBody).slice(0, 36),
      description: restBody || boldTitle,
    });
    if (listItems.length >= 5) break;
  }

  const seedItems =
    listItems.length > 0
      ? listItems
      : [
          {
            title: '执行拆解后主任务',
            description: ctx.originalTask || dehydrateTargetTextForHandover(rawText, 240),
          },
        ];

  const subTasks: SwarmSubTask[] = seedItems.map((item, idx) => {
    const taskId = sanitizeSwarmIdSegment(`task-${idx + 1}`, `task-${idx + 1}`);
    const assigned = resolveSwarmSubTaskExecutor({
      workerCandidates,
      allChannelAgents: ctx.allChannelAgents,
      leadAgent: ctx.leadAgent,
      index: idx,
    });
    return {
      taskId,
      title: item.title,
      description: item.description,
      assignedAgentId: assigned.id,
      originalAgentId: assigned.id,
      enabled: true,
      status: 'pending',
      subThreadId: buildSwarmSubThreadId(missionId, taskId),
    };
  });

  const cleanedText =
    String(rawText || '').trim() ||
    `🐝 已生成保底 Swarm 拆解方案（共 ${subTasks.length} 项），请在卡片中调整或确认派发。`;

  const plan: SwarmMissionData = {
    missionId,
    roomId: ctx.roomId,
    channelId: ctx.channelId,
    originalTask: ctx.originalTask,
    triggerMode: ctx.triggerMode,
    leadAgentId: ctx.leadAgent.id,
    sharedContractSummary: dehydrateTargetTextForHandover(
      cleanedText || ctx.originalTask,
      360
    ),
    status: 'awaiting_approval',
    subTasks: computeSwarmFileOverlaps(subTasks),
    createdAt: Date.now(),
  };

  return {
    plan,
    cleanedText,
    isFallback: true,
  };
}

/**
 * 构建单个隔离并行 Worker 的执行 Prompt：
 * - 物理隔离：不携带主频道历史、不携带兄弟 Worker 产物
 * - 严禁横向级联：禁止输出中再 @ 唤醒其他成员
 */
export function buildSwarmWorkerPrompt(options: {
  mission: SwarmMissionData;
  subTask: SwarmSubTask;
  workerAgent: Agent;
  leadAgent?: Agent;
}): string {
  const { mission, subTask, workerAgent, leadAgent } = options;

  const contractText =
    `你当前正处于【🐝 Swarm 纯并行隔离执行单元】中。\n` +
    `执行角色：${workerAgent.name} (${resolveEffectiveAgentHandle(workerAgent)})\n` +
    (leadAgent
      ? `总控协调官：${leadAgent.name} (${resolveEffectiveAgentHandle(leadAgent)})\n`
      : '') +
    `严格规则：\n` +
    `1. 【隔离聚焦】：只聚焦于你被指派的子任务，不要推测或臆测兄弟子任务的内部状态。\n` +
    `2. 【禁止横向 @ 级联】：严禁在回复中 @ 其他成员，最终成果由总控协调官统一 Reduce 汇总验收。\n` +
    `3. 【范围约束】：若需修改工作区文件，请严格限制在允许边界（allowedFiles）内，并优先产出清晰的技术方案或标准 Diff 变更摘要。`;

  const allowedFilesSection =
    subTask.allowedFiles && subTask.allowedFiles.length > 0
      ? subTask.allowedFiles.join('\n')
      : '未指定特定文件白名单（仅聚焦当前子任务相关目标，避免修改无关模块）';

  const subTaskBlock = [
    `子任务 ID: ${subTask.taskId}`,
    `标题: ${subTask.title}`,
    `详细要求: ${subTask.description}`,
    `允许变更范围 (allowedFiles):\n${allowedFilesSection}`,
  ].join('\n');

  return [
    wrapSemanticSection('swarm-worker-contract', contractText, {
      taskId: subTask.taskId,
      missionId: mission.missionId,
    }),
    wrapSemanticSection(
      'swarm-original-task',
      escapeSemanticText(dehydrateTargetTextForHandover(mission.originalTask, 600))
    ),
    wrapSemanticSection(
      'swarm-shared-contract',
      escapeSemanticText(
        mission.sharedContractSummary || '请遵循原始任务需求与标准工程规范。'
      )
    ),
    wrapSemanticSection('swarm-subtask', escapeSemanticText(subTaskBlock)),
  ].join('\n\n');
}

/**
 * 构建 Map-Reduce 终局阶段下发给 Lead Agent 的验收汇总 Prompt
 */
export function buildSwarmLeadReducePrompt(options: {
  mission: SwarmMissionData;
  leadAgent: Agent;
  agents: Agent[];
}): string {
  const { mission, leadAgent, agents } = options;
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const enabledTasks = mission.subTasks.filter((t) => t.enabled);
  const reportLines = enabledTasks
    .map((task, idx) => {
      const worker = agentMap.get(task.assignedAgentId);
      const workerLabel = worker
        ? `${worker.name} (${resolveEffectiveAgentHandle(worker)})`
        : task.assignedAgentId;
      const diffNames =
        task.generatedDiffs && task.generatedDiffs.length > 0
          ? task.generatedDiffs
              .map((d) => `${d.filename} (+${d.additions}/-${d.deletions})`)
              .join(', ')
          : '无直接代码 Diff';
      const summaryBody =
        task.status === 'skipped'
          ? `【已跳过】${task.errorMessage || '由用户人工跳过该子任务'}`
          : dehydrateTargetTextForHandover(
              task.resultSummary || task.errorMessage || '无文字摘要',
              900
            );
      return (
        `### [${idx + 1}] ${task.title} (taskId: ${task.taskId})\n` +
        `- 执行者: ${workerLabel} | 终态: ${task.status}` +
        (typeof task.durationMs === 'number' ? ` | 耗时: ${task.durationMs}ms` : '') +
        `\n- 产出 Diff: ${diffNames}\n` +
        `- 执行报告:\n${summaryBody}`
      );
    })
    .join('\n\n');

  const roleDirective =
    `你作为【🐝 Swarm 总控协调官】(${leadAgent.name})，所有并行的 Worker 子任务现已全部收敛结束。\n` +
    `请你执行 Map-Reduce 终局汇总（Reduce Phase）：\n` +
    `1. 逐项核对各 Worker 交付是否满足「原始任务」与「共享接口契约」要求；若存在被跳过的子任务，需明确指出影响范围或补齐建议。\n` +
    `2. 检查跨子任务之间的接口命名、类型契约与边界衔接是否存在冲突。\n` +
    `3. 给出面向人类用户的最终综合性结论、汇总清单与后续建议。\n` +
    `4. 严禁在终局汇总中再次 @ 任何成员触发新的循环。`;

  return [
    wrapSemanticSection('swarm-reduce-role', roleDirective, {
      missionId: mission.missionId,
    }),
    wrapSemanticSection(
      'swarm-original-task',
      escapeSemanticText(dehydrateTargetTextForHandover(mission.originalTask, 500))
    ),
    wrapSemanticSection(
      'swarm-shared-contract',
      escapeSemanticText(mission.sharedContractSummary || '无额外契约说明')
    ),
    wrapSemanticSection(
      'swarm-worker-reports',
      escapeSemanticText(reportLines || '暂无有效子任务报告')
    ),
  ].join('\n\n');
}

/**
 * 聚合全部已完成 Worker 与 Lead Reduce 产出的 Workspace Diffs（按文件名去重覆盖）
 */
export function aggregateSwarmWorkerDiffs(
  subTasks: SwarmSubTask[],
  extraReduceDiffs: TopicPatchDiffItem[] = []
): TopicPatchDiffItem[] {
  let merged: TopicPatchDiffItem[] = [];
  for (const task of subTasks) {
    if (task.enabled && task.status === 'completed' && task.generatedDiffs?.length) {
      merged = mergeTopicPatchDiffs(merged, task.generatedDiffs);
    }
  }
  if (extraReduceDiffs.length > 0) {
    merged = mergeTopicPatchDiffs(merged, extraReduceDiffs);
  }
  return merged;
}

/**
 * 判定所有启用子任务是否均已结束（无 pending / running）
 */
export function areAllEnabledSwarmSubTasksFinished(subTasks: SwarmSubTask[]): boolean {
  const enabled = subTasks.filter((t) => t.enabled);
  if (enabled.length === 0) return false;
  return enabled.every(
    (t) =>
      t.status === 'completed' ||
      t.status === 'skipped' ||
      t.status === 'failed' ||
      t.status === 'aborted'
  );
}

/**
 * 严格判定是否满足自动进入 Lead Reduce 的门禁：
 * - 所有已启用子任务均处于 `completed` 或 `skipped`（不存在 `pending`/`running`/`failed`/`aborted`）
 * - 且至少有 1 个已启用子任务为 `completed`
 */
export function canAutoTriggerSwarmReduce(subTasks: SwarmSubTask[]): boolean {
  const enabled = subTasks.filter((t) => t.enabled);
  if (enabled.length === 0) return false;
  let hasCompleted = false;
  for (const task of enabled) {
    if (task.status === 'completed') {
      hasCompleted = true;
    } else if (task.status !== 'skipped') {
      return false;
    }
  }
  return hasCompleted;
}

/**
 * 应用刷新 / 重启恢复清洗（在 sanitizeMessages 中调用）：
 * 将残留的 `running` 子任务置为 `aborted`，将中断的 `reducing` 状态回退为 `running_workers` 以便用户人工恢复或重试。
 */
export function sanitizeHydratedSwarmMission(
  mission?: SwarmMissionData
): SwarmMissionData | undefined {
  if (!mission) return undefined;

  const cleanedSubTasks = (mission.subTasks || []).map((task) => {
    if (task.status === 'running') {
      return {
        ...task,
        status: 'aborted' as const,
        finishedAt: task.finishedAt || Date.now(),
        errorMessage:
          task.errorMessage || '应用重启或刷新前该 Worker 子任务执行已中断',
      };
    }
    return task;
  });

  const normalizedStatus =
    mission.status === 'reducing' ? 'running_workers' : mission.status;
  const reduceError =
    mission.status === 'reducing'
      ? mission.reduceError || '应用重启前终局验收尚未完成，可点击重新汇总'
      : mission.reduceError;

  return {
    ...mission,
    status: normalizedStatus,
    reduceError,
    subTasks: computeSwarmFileOverlaps(cleanedSubTasks),
  };
}
