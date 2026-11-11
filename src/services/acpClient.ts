import {
  Agent,
  CartridgeCitation,
  ArbitrationRulingDraft,
  RulingDecisionType,
  TopicPatchDiffItem,
  TopicExecutionUiMeta,
  ModuleDecompositionDraft,
  ModuleComplexityLevel,
  MessageAttachment,
  PreRetrievalResult,
  RoleConcurrenceDecisionStatus,
  RoleConcurrenceSource,
  RoleConcurrenceSubmission,
} from '../types';
import { isAgentOffline } from '../utils/agentRuntime';
import { buildAgentPersonaPrompt } from './agentCollaboration';
import {
  ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV,
  ACP_NATIVE_MEMORY_ENV,
  parseNativeMemoryCapability,
} from './agentMemory';
import { retrieveScpackExpertise } from './scpackService';

export interface AcpSendPromptOptions {
  agent: Agent;
  roomId: string;
  prompt: string;
  workspaceBindingId?: string;
  workspaceCwd?: string;
  channelId?: string;
  systemPrompt?: string;
  isDm?: boolean;
  scopeType?: 'channel' | 'topic' | 'dm' | 'dm_topic';
  discussionMode?: 'standard' | 'game_theoretic';
  attachments?: MessageAttachment[];
}

/**
 * 严格校验 Session Key 单段标识符（agentId / channelId / roomId / discussionMode）：
 * 1. 严禁为空、`.`、`..`、以 `.` 开头/结尾或包含 `..`
 * 2. 严禁包含结构分隔符 `:`、路径分隔符 `/`、`\`、空字节 `\0` 或控制字符
 */
export function validateSessionSegment(raw: string, fieldName = 'session segment'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: segment cannot be empty`);
  }
  if (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    trimmed.includes('..')
  ) {
    throw new Error(`Invalid ${fieldName} '${raw}': relative dot segments are forbidden`);
  }
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const code = trimmed.charCodeAt(i);
    if (ch === ':' || ch === '/' || ch === '\\' || code === 0 || code < 0x20 || code === 0x7f) {
      throw new Error(
        `Invalid ${fieldName} '${raw}': colons, path separators, and control characters are forbidden`
      );
    }
  }
  return trimmed;
}

export function isValidSessionSegment(raw: string | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  try {
    return validateSessionSegment(raw) === raw;
  } catch {
    return false;
  }
}

/**
 * 统一多模式会话 Key 命名空间构造器
 * 严格对齐 Rust 底层 session_key 与 ACP 会话沙箱契约（原始规范字符串）：
 * 1. 1-on-1 私聊: `dm:{agentId}:{threadId}`
 * 2. 议题研讨(区分 standard / game_theoretic): `topic:{channelId}:{topicId}:{discussionMode}`
 * 3. 频道主消息流: `channel:{channelId}:{threadId}`
 */
export function buildUnifiedSessionKey(options: {
  roomId: string;
  channelId?: string;
  agentId?: string;
  isDm?: boolean;
  discussionMode?: string;
  workspaceBindingId?: string;
  scopeType?: 'channel' | 'topic' | 'dm' | 'dm_topic';
}): string {
  const validRoomId = validateSessionSegment(options.roomId, 'roomId');
  const trimmedChannelId = options.channelId?.trim();
  const validChannelId = trimmedChannelId
    ? validateSessionSegment(trimmedChannelId, 'channelId')
    : undefined;

  if (options.scopeType === 'dm_topic') {
    const aid = validateSessionSegment(options.agentId || 'default', 'agentId');
    const topicId = validateSessionSegment(options.roomId, 'topicId');
    const mode = validateSessionSegment(
      options.discussionMode || 'standard',
      'discussionMode'
    );
    const workspaceSegment = options.workspaceBindingId
      ? `:ws-${validateSessionSegment(options.workspaceBindingId, 'workspaceBindingId')}`
      : '';
    return `dmtopic:${aid}:${topicId}:${mode}${workspaceSegment}`;
  }

  const isDm = options.isDm ?? (
    options.scopeType
      ? options.scopeType === 'dm'
      : Boolean(
          !validChannelId ||
          validChannelId === 'direct-messages' ||
          validChannelId.startsWith('dm-') ||
          validRoomId.startsWith('thread-dm-')
        )
  );

  if (isDm) {
    const aid = validateSessionSegment(options.agentId || 'default', 'agentId');
    return `dm:${aid}:${validRoomId}`;
  }

  const effectiveChanId = validChannelId || validRoomId;
  const workspaceSegment = options.workspaceBindingId
    ? `:ws-${validateSessionSegment(options.workspaceBindingId, 'workspaceBindingId')}`
    : '';
  const isTopic = options.scopeType
    ? options.scopeType === 'topic'
    : validRoomId !== effectiveChanId && !validRoomId.startsWith('chan-');

  if (isTopic) {
    const rawMode = validateSessionSegment(
      (options.discussionMode && options.discussionMode.trim()) || 'standard',
      'discussionMode'
    );
    return `topic:${effectiveChanId}:${validRoomId}:${rawMode}${workspaceSegment}`;
  } else {
    return `channel:${effectiveChanId}:${validRoomId}${workspaceSegment}`;
  }
}

/**
 * 针对前端全局状态（水位线与立足上下文交付）或直连单例 LLM 缓存的专属 Agent 会话复合键
 * 确保同一议题下多个不同 Agent 拥有正交独立的水位线与交付状态
 */
export function buildAgentSessionKey(options: {
  agentId: string;
  roomId: string;
  channelId?: string;
  isDm?: boolean;
  discussionMode?: string;
  workspaceBindingId?: string;
  scopeType?: 'channel' | 'topic' | 'dm' | 'dm_topic';
}): string {
  const validAgentId = validateSessionSegment(options.agentId, 'agentId');
  const baseKey = buildUnifiedSessionKey({ ...options, agentId: validAgentId });
  // 私聊 baseKey 已经包含 agentId (dm:{agentId}:{threadId})，无需重复追加
  if (baseKey.startsWith('dm:') || baseKey.startsWith('dmtopic:')) {
    return baseKey;
  }
  return `${baseKey}:${validAgentId}`;
}

export interface ParsedSessionKey {
  type: 'dm' | 'dm_topic' | 'topic' | 'channel' | 'legacy';
  agentId?: string;
  channelId?: string;
  roomId?: string;
  discussionMode?: string;
  workspaceBindingId?: string;
}

export function parseSessionKey(key: string): ParsedSessionKey {
  if (!key) return { type: 'legacy' };
  const parts = key.split(':');
  if (parts[0] === 'dmtopic') {
    const hasWorkspace = Boolean(parts[4]?.startsWith('ws-'));
    if (
      (parts.length !== 4 && parts.length !== 5) ||
      !isValidSessionSegment(parts[1]) ||
      !isValidSessionSegment(parts[2]) ||
      !isValidSessionSegment(parts[3]) ||
      (parts.length === 5 && !hasWorkspace) ||
      (parts.length === 5 && !isValidSessionSegment(parts[4]))
    ) {
      return { type: 'legacy' };
    }
    return {
      type: 'dm_topic',
      agentId: parts[1],
      roomId: parts[2],
      discussionMode: parts[3],
      workspaceBindingId: hasWorkspace ? parts[4].slice(3) : undefined,
    };
  }
  if (parts[0] === 'dm') {
    if (parts.length !== 3 || !isValidSessionSegment(parts[1]) || !isValidSessionSegment(parts[2])) {
      return { type: 'legacy' };
    }
    return {
      type: 'dm',
      agentId: parts[1],
      roomId: parts[2],
    };
  }
  if (parts[0] === 'topic') {
    const hasWorkspace = Boolean(parts[4]?.startsWith('ws-'));
    if (
      (parts.length < 4 || parts.length > 6) ||
      (parts.length === 6 && !hasWorkspace) ||
      !isValidSessionSegment(parts[1]) ||
      !isValidSessionSegment(parts[2]) ||
      !isValidSessionSegment(parts[3]) ||
      (parts.length >= 5 && !isValidSessionSegment(parts[4])) ||
      (parts.length === 6 && !isValidSessionSegment(parts[5]))
    ) {
      return { type: 'legacy' };
    }
    const bindingIndex = hasWorkspace ? 4 : -1;
    return {
      type: 'topic',
      channelId: parts[1],
      roomId: parts[2],
      discussionMode: parts[3],
      workspaceBindingId: bindingIndex >= 0 ? parts[bindingIndex].slice(3) : undefined,
      agentId: bindingIndex >= 0 ? parts[5] : parts[4],
    };
  }
  if (parts[0] === 'channel') {
    const hasWorkspace = Boolean(parts[3]?.startsWith('ws-'));
    if (
      (parts.length < 3 || parts.length > 5) ||
      (parts.length === 5 && !hasWorkspace) ||
      !isValidSessionSegment(parts[1]) ||
      !isValidSessionSegment(parts[2]) ||
      (parts.length >= 4 && !isValidSessionSegment(parts[3])) ||
      (parts.length === 5 && !isValidSessionSegment(parts[4]))
    ) {
      return { type: 'legacy' };
    }
    const bindingIndex = hasWorkspace ? 3 : -1;
    return {
      type: 'channel',
      channelId: parts[1],
      roomId: parts[2],
      workspaceBindingId: bindingIndex >= 0 ? parts[bindingIndex].slice(3) : undefined,
      agentId: bindingIndex >= 0 ? parts[4] : parts[3],
    };
  }
  return { type: 'legacy' };
}

/**
 * 判断某个复合 Session Key 是否匹配给定的过滤范围 (Scope Filter)
 * 集中收拢并取代散落的 startsWith/includes/endsWith 字符串通配
 */
export function matchesSessionScope(
  key: string,
  filter: {
    agentId?: string;
    channelId?: string;
    roomId?: string;
    deletedThreadIds?: string[];
  }
): boolean {
  if (!key) return false;

  // 1. 按 Agent ID 过滤（如 agent 停止时清空相关会话与交付缓存）
  if (filter.agentId) {
    if (
      key.endsWith(`:${filter.agentId}`) ||
      key.startsWith(`dm:${filter.agentId}:`) ||
      key.startsWith(`dmtopic:${filter.agentId}:`)
    ) {
      return true;
    }
  }

  // 2. 按 Channel ID 过滤（如删除频道时批量清理关联议题与频道会话）
  if (filter.channelId) {
    if (
      key.startsWith(`channel:${filter.channelId}:`) ||
      key.startsWith(`topic:${filter.channelId}:`) ||
      key.startsWith(`${filter.channelId}:`) ||
      key.includes(`:${filter.channelId}:`)
    ) {
      return true;
    }
  }

  // 3. 按 Thread/Room ID 过滤
  if (filter.roomId) {
    if (
      key.endsWith(`:${filter.roomId}`) ||
      key.includes(`:${filter.roomId}:`) ||
      key.startsWith(`${filter.roomId}:`)
    ) {
      return true;
    }
  }

  // 4. 批量 Thread IDs 过滤
  if (filter.deletedThreadIds && filter.deletedThreadIds.length > 0) {
    for (const thId of filter.deletedThreadIds) {
      if (
        key.endsWith(`:${thId}`) ||
        key.includes(`:${thId}:`) ||
        key.startsWith(`${thId}:`)
      ) {
        return true;
      }
    }
  }

  return false;
}

export interface AcpAgentResponse {
  textResponse: string;
  memoryActions?: Array<{ action: string; key: string; detail: string }>;
  mcpToolCalls?: Array<{ server_name: string; tool_name: string; status: string; arguments?: any }>;
  rulingDraft?: ArbitrationRulingDraft;
  moduleDecompositionDraft?: ModuleDecompositionDraft;
  cartridgeCitation?: CartridgeCitation;
  workspaceDiffs?: TopicPatchDiffItem[];
  executionMeta?: TopicExecutionUiMeta;
  nativeMemoryCapability?: ReturnType<typeof parseNativeMemoryCapability>;
  scpackRetrieval?: PreRetrievalResult;
  durationMs: number;
  isRealProcess: boolean;
  isEmptyTurn?: boolean;
  isError?: boolean;
  stopReason?: string;
  raw?: any;
}

type AcpNativeMemoryUpdateListener = (
  agentId: string,
  capability: ReturnType<typeof parseNativeMemoryCapability>,
  sourceAgent?: Agent
) => void;

let onNativeMemoryCapabilityUpdated: AcpNativeMemoryUpdateListener | null = null;

export function setOnAcpNativeMemoryCapabilityUpdated(
  listener: AcpNativeMemoryUpdateListener | null
): void {
  onNativeMemoryCapabilityUpdated = listener;
}

/**
 * 从执行 Agent 响应正文中解析结构化 UI 描述契约块 <<<EXECUTION_META>>>...<<<EXECUTION_META_END>>>
 * 并自动剥离原始契约标签，确保展示给用户的 Markdown 正文干净无协议噪音
 */
export function extractExecutionMetaFromAcpResponse(rawText: string): {
  executionMeta?: TopicExecutionUiMeta;
  cleanedText: string;
} {
  if (!rawText || !rawText.trim()) {
    return { cleanedText: rawText };
  }

  const metaRegex = /<<<EXECUTION_META>>>([\s\S]*?)<<<EXECUTION_META_END>>>/i;
  const fallbackJsonRegex = /```(?:json)?\s*(\{\s*"sectionTitle"[\s\S]*?"podTitle"[\s\S]*?\})\s*```/i;

  const match = rawText.match(metaRegex) || rawText.match(fallbackJsonRegex);
  if (!match || !match[1]) {
    return { cleanedText: rawText };
  }

  let executionMeta: TopicExecutionUiMeta | undefined;
  try {
    const jsonRaw = match[1].trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonRaw);
    if (parsed && typeof parsed === 'object') {
      const deliverableKind: 'workspace_files' | 'report_only' =
        parsed.deliverableKind === 'report_only' ? 'report_only' : 'workspace_files';
      executionMeta = {
        sectionTitle: String(parsed.sectionTitle || '决议落地执行与交付产物').trim(),
        podTitle: String(parsed.podTitle || '🛠️ 决议落地交付').trim(),
        statusSummary: String(parsed.statusSummary || '已完成定案决议落地交付').trim(),
        deliverableKind,
        reviewActionLabel: parsed.reviewActionLabel ? String(parsed.reviewActionLabel).trim() : undefined,
        applyActionLabel: parsed.applyActionLabel ? String(parsed.applyActionLabel).trim() : undefined,
      };
    }
  } catch (e) {
    console.warn('[acpClient] Failed to parse <<<EXECUTION_META>>> block:', e);
  }

  const cleanedText = rawText.replace(match[0], '').trim();
  return {
    executionMeta,
    cleanedText: cleanedText || rawText,
  };
}

/**
 * 从 ACP 响应（原生 MCP 工具调用或结构化契约块）中提取仲裁定案裁决书草案
 */
export function extractArbitrationRulingFromAcpResponse(
  acpResp: Partial<AcpAgentResponse>,
  authorName?: string
): ArbitrationRulingDraft | undefined {
  const text = acpResp.textResponse || '';
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // 1. 优先从 MCP Tool 调用记录或 raw 中提取 submit_arbitration_ruling 参数
  if (acpResp.raw && typeof acpResp.raw === 'object') {
    const rawCalls =
      acpResp.raw.mcp_tool_calls ||
      acpResp.raw.result?.mcp_tool_calls ||
      acpResp.mcpToolCalls ||
      [];
    if (Array.isArray(rawCalls)) {
      const rulingCall = rawCalls.find(
        (c: any) =>
          c.tool_name === 'submit_arbitration_ruling' ||
          c.tool === 'submit_arbitration_ruling' ||
          c.name === 'submit_arbitration_ruling'
      );
      if (
        rulingCall &&
        isSuccessfulMcpCallStatus(rulingCall.status) &&
        (rulingCall.arguments || rulingCall.args)
      ) {
        const args = rulingCall.arguments || rulingCall.args;
        const rawDecision = args.decision_type || args.decisionType || 'trade_off_matrix';
        const validDecision: RulingDecisionType =
          rawDecision === 'adopt_proposer' || rawDecision === 'reject_rebuild' || rawDecision === 'trade_off_matrix'
            ? rawDecision
            : 'trade_off_matrix';
        return {
          decisionType: validDecision,
          summary: String(args.summary || '已通过 MCP 工具提交仲裁定案裁决').trim(),
          tradeOffPoints: Array.isArray(args.trade_off_points)
            ? (args.trade_off_points as unknown[]).map((item) => String(item)).filter((s: string) => s.trim().length > 0)
            : [],
          impactedFiles: Array.isArray(args.impacted_files)
            ? (args.impacted_files as unknown[]).map((item) => String(item)).filter((s: string) => s.trim().length > 0)
            : [],
          solution: args.solution ? String(args.solution).trim() : undefined,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    }
  }

  // 2. 尝试从文本正文中的结构化块 <<<RULING_DRAFT>>> { ... } <<<RULING_DRAFT_END>>> 解析
  const blockMatch =
    text.match(/<<<RULING_DRAFT>>>([\s\S]*?)<<<RULING_DRAFT_END>>>/i) ||
    text.match(/```(?:json)?\s*(\{\s*"decision_?type"[\s\S]*?\})\s*```/i);

  if (blockMatch && blockMatch[1]) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      const rawDecision = parsed.decision_type || parsed.decisionType || 'trade_off_matrix';
      const validDecision: RulingDecisionType =
        rawDecision === 'adopt_proposer' || rawDecision === 'reject_rebuild' || rawDecision === 'trade_off_matrix'
          ? rawDecision
          : 'trade_off_matrix';

      const tradeOffs = Array.isArray(parsed.trade_off_points || parsed.tradeOffPoints)
        ? (parsed.trade_off_points || parsed.tradeOffPoints).map(String).filter((s: string) => s.trim().length > 0)
        : [];

      const files = Array.isArray(parsed.impacted_files || parsed.impactedFiles)
        ? (parsed.impacted_files || parsed.impactedFiles).map(String).filter((s: string) => s.trim().length > 0)
        : typeof (parsed.impacted_files || parsed.impactedFiles) === 'string'
        ? (parsed.impacted_files || parsed.impactedFiles).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      return {
        decisionType: validDecision,
        summary: String(parsed.summary || '经综合仲裁审议定案').trim(),
        tradeOffPoints: tradeOffs,
        impactedFiles: files,
        solution: parsed.solution ? String(parsed.solution).trim() : undefined,
        submittedBy: authorName,
        submittedAt: now,
      };
    } catch (e) {
      console.warn('[acpClient] Failed to parse structured ruling draft block:', e);
    }
  }

  return undefined;
}

export interface RoleConcurrenceExtractionResult {
  submission?: RoleConcurrenceSubmission;
  cleanedText: string;
  error?: string;
}

function collectAcpMcpToolCalls(acpResp: Partial<AcpAgentResponse>): any[] {
  const candidates = [
    acpResp.raw?.mcp_tool_calls,
    acpResp.raw?.result?.mcp_tool_calls,
    acpResp.mcpToolCalls,
  ];
  return candidates.flatMap((value) => Array.isArray(value) ? value : []);
}

function isSuccessfulMcpCallStatus(status: unknown): boolean {
  // 字段缺失视为旧记录兼容；但显式空字符串代表状态未知，必须判失败。
  if (status === undefined || status === null) return true;
  if (typeof status !== 'string') return false;
  const normalized = status.trim().toLowerCase();
  if (!normalized) return false;
  return ['completed', 'success', 'succeeded', 'ok'].includes(normalized);
}

function readStrictStringArray(
  raw: Record<string, any>,
  snakeKey: string,
  camelKey: string,
  fieldName: string
): string[] | string {
  const value = raw[snakeKey] ?? raw[camelKey];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return `${fieldName} 必须是字符串数组`;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizeRoleConcurrencePayload(
  payload: unknown,
  source: RoleConcurrenceSource
): { submission?: RoleConcurrenceSubmission; error?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '结构化无异议票必须是 JSON 对象' };
  }

  const raw = payload as Record<string, any>;
  const protocolVersion = raw.protocol_version ?? raw.protocolVersion;
  if (protocolVersion !== 1 && protocolVersion !== '1') {
    return { error: 'protocol_version 必须为 1' };
  }

  const agentId = typeof raw.agent_id === 'string'
    ? raw.agent_id.trim()
    : typeof raw.agentId === 'string'
    ? raw.agentId.trim()
    : '';
  if (!agentId) {
    return { error: 'agent_id 不能为空' };
  }

  const role = raw.role;
  if (role !== 'proposer' && role !== 'challenger' && role !== 'verifier') {
    return { error: 'role 必须为 proposer、challenger 或 verifier' };
  }

  const solutionDigest = typeof raw.solution_digest === 'string'
    ? raw.solution_digest.trim()
    : typeof raw.solutionDigest === 'string'
    ? raw.solutionDigest.trim()
    : '';
  if (!/^sha256:[a-f0-9]{64}$/i.test(solutionDigest)) {
    return { error: 'solution_digest 必须是 sha256: 加 64 位十六进制摘要' };
  }

  const status = raw.status;
  const validStatuses: RoleConcurrenceDecisionStatus[] = [
    'concurred',
    'conditional',
    'objected',
    'unavailable',
  ];
  if (!validStatuses.includes(status)) {
    return { error: `status 必须为 ${validStatuses.join(' | ')}` };
  }

  const blockingIssueIds = readStrictStringArray(
    raw,
    'blocking_issue_ids',
    'blockingIssueIds',
    'blocking_issue_ids'
  );
  if (typeof blockingIssueIds === 'string') {
    return { error: blockingIssueIds };
  }

  const conditions = readStrictStringArray(raw, 'conditions', 'conditions', 'conditions');
  if (typeof conditions === 'string') {
    return { error: conditions };
  }

  const evidenceRefs = readStrictStringArray(
    raw,
    'evidence_refs',
    'evidenceRefs',
    'evidence_refs'
  );
  if (typeof evidenceRefs === 'string') {
    return { error: evidenceRefs };
  }

  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim() : '';
  if (!rationale) {
    return { error: 'rationale 不能为空' };
  }

  if (status === 'concurred' && blockingIssueIds.length > 0) {
    return { error: 'status=concurred 时 blocking_issue_ids 必须为空' };
  }
  if (status === 'concurred' && conditions.length > 0) {
    return { error: 'status=concurred 时 conditions 必须为空；存在条件应提交 status=conditional' };
  }
  if (status === 'conditional' && conditions.length === 0) {
    return { error: 'status=conditional 时必须至少提供一项 conditions' };
  }
  if (status === 'objected' && blockingIssueIds.length === 0) {
    return { error: 'status=objected 时必须至少提供一个 blocking_issue_id' };
  }

  return {
    submission: {
      protocolVersion: 1,
      agentId,
      role,
      solutionDigest,
      status,
      blockingIssueIds,
      conditions,
      rationale,
      evidenceRefs,
      source,
      submittedAt: new Date().toISOString(),
    },
  };
}

function roleConcurrenceSignature(value: RoleConcurrenceSubmission): string {
  return JSON.stringify({
    protocolVersion: value.protocolVersion,
    agentId: value.agentId,
    role: value.role,
    solutionDigest: value.solutionDigest,
    status: value.status,
    blockingIssueIds: value.blockingIssueIds,
    conditions: value.conditions,
    rationale: value.rationale,
    evidenceRefs: value.evidenceRefs,
  });
}

/**
 * 严格提取角色终局无异议票。
 *
 * 授权来源仅有：
 * 1. submit_role_concurrence MCP 工具调用载荷；
 * 2. <<<ROLE_CONCURRENCE>>>...<<<ROLE_CONCURRENCE_END>>> 结构化契约块。
 *
 * 自然语言正文绝不参与 concurred/objected 判定。
 */
export function extractRoleConcurrenceFromAcpResponse(
  acpResp: Partial<AcpAgentResponse>
): RoleConcurrenceExtractionResult {
  const rawText = acpResp.textResponse || '';
  const blockRegex = /<<<ROLE_CONCURRENCE>>>([\s\S]*?)<<<ROLE_CONCURRENCE_END>>>/gi;
  const blockMatches = Array.from(rawText.matchAll(blockRegex));
  const cleanedText = rawText.replace(blockRegex, '').trim();

  if (blockMatches.length > 1) {
    return {
      cleanedText,
      error: '检测到多个 ROLE_CONCURRENCE 契约块；每轮必须且只能提交一张票',
    };
  }

  const toolCalls = collectAcpMcpToolCalls(acpResp);
  const roleCalls = toolCalls.filter((call: any) =>
    call?.tool_name === 'submit_role_concurrence' ||
    call?.tool === 'submit_role_concurrence' ||
    call?.name === 'submit_role_concurrence'
  );

  const toolCandidates: RoleConcurrenceSubmission[] = [];
  const toolErrors: string[] = [];
  for (const roleCall of roleCalls) {
    if (!isSuccessfulMcpCallStatus(roleCall?.status)) {
      toolErrors.push(`submit_role_concurrence 工具调用状态异常: ${roleCall?.status}`);
      continue;
    }
    const rawToolArguments = roleCall?.arguments ?? roleCall?.args;
    if (rawToolArguments === undefined || rawToolArguments === null) {
      continue;
    }
    let parsedArguments: unknown = rawToolArguments;
    if (typeof rawToolArguments === 'string') {
      try {
        parsedArguments = JSON.parse(rawToolArguments);
      } catch {
        toolErrors.push('submit_role_concurrence 工具参数不是合法 JSON');
        continue;
      }
    }
    const normalized = normalizeRoleConcurrencePayload(parsedArguments, 'mcp_tool');
    if (normalized.submission) {
      toolCandidates.push(normalized.submission);
    } else if (normalized.error) {
      toolErrors.push(normalized.error);
    }
  }
  const uniqueToolCandidates = Array.from(
    new Map(toolCandidates.map((candidate) => [roleConcurrenceSignature(candidate), candidate])).values()
  );
  if (uniqueToolCandidates.length > 1) {
    toolErrors.push('检测到多张内容不一致的 submit_role_concurrence 工具票');
  }
  const toolCandidate = uniqueToolCandidates.length === 1 ? uniqueToolCandidates[0] : undefined;
  const toolError = toolErrors[0];

  let blockCandidate: RoleConcurrenceSubmission | undefined;
  let blockError: string | undefined;
  if (blockMatches.length === 1) {
    try {
      const parsed = JSON.parse(blockMatches[0][1].trim());
      const normalized = normalizeRoleConcurrencePayload(parsed, 'contract_block');
      blockCandidate = normalized.submission;
      blockError = normalized.error;
    } catch {
      blockError = 'ROLE_CONCURRENCE 契约块不是合法 JSON';
    }
  }

  if (toolError) {
    return { cleanedText, error: toolError };
  }
  if (blockError) {
    return { cleanedText, error: blockError };
  }
  if (toolCandidate && blockCandidate) {
    if (roleConcurrenceSignature(toolCandidate) !== roleConcurrenceSignature(blockCandidate)) {
      return {
        cleanedText,
        error: 'submit_role_concurrence 工具载荷与 ROLE_CONCURRENCE 契约块不一致',
      };
    }
  }

  const submission = toolCandidate || blockCandidate;
  if (!submission) {
    return {
      cleanedText,
      error: '未提交有效的 submit_role_concurrence 工具载荷或 ROLE_CONCURRENCE 契约块',
    };
  }

  return { submission, cleanedText };
}

/**
 * 从 ACP 响应（原生 MCP 工具 submit_module_decomposition 或结构化块）中提取 G-Frame 模块化拆解载荷
 */
export function extractModuleDecompositionFromAcpResponse(
  acpResp: Partial<AcpAgentResponse>,
  authorName?: string
): ModuleDecompositionDraft | undefined {
  const text = acpResp.textResponse || '';
  const now = new Date().toISOString();

  const normalizeModules = (rawMods: any[]): ModuleDecompositionDraft['modules'] => {
    return rawMods.slice(0, 4).map((m: any, idx: number) => {
      const rawLevel = m.complexity_level || m.complexityLevel || 'medium_standard';
      const complexityLevel: ModuleComplexityLevel =
        rawLevel === 'low_deterministic' || rawLevel === 'medium_standard' || rawLevel === 'high_critical'
          ? rawLevel
          : 'medium_standard';
      return {
        moduleId: String(m.module_id || m.moduleId || `mod-${idx + 1}`).trim(),
        title: String(m.title || `模块 ${idx + 1}`).trim(),
        responsibility: String(m.responsibility || '').trim(),
        allowedFiles: Array.isArray(m.allowed_files || m.allowedFiles)
          ? (m.allowed_files || m.allowedFiles).map(String).filter(Boolean)
          : [],
        dependsOn: Array.isArray(m.depends_on || m.dependsOn)
          ? (m.depends_on || m.dependsOn).map(String).filter(Boolean)
          : [],
        complexityLevel,
      };
    });
  };

  // 1. 优先从原生 MCP Tool 调用记录提取 submit_module_decomposition 参数
  const rawCalls =
    acpResp.raw?.mcp_tool_calls ||
    acpResp.raw?.result?.mcp_tool_calls ||
    acpResp.mcpToolCalls ||
    [];
  if (Array.isArray(rawCalls)) {
    const decompCall = rawCalls.find(
      (c: any) =>
        c.tool_name === 'submit_module_decomposition' ||
        c.tool === 'submit_module_decomposition' ||
        c.name === 'submit_module_decomposition'
    );
    if (decompCall && (decompCall.arguments || decompCall.args)) {
      const args = decompCall.arguments || decompCall.args;
      const sc = args.shared_contract || args.sharedContract || {};
      const mods = Array.isArray(args.modules) ? normalizeModules(args.modules) : [];
      if (mods.length >= 2) {
        return {
          sharedContract: {
            summary: String(sc.summary || '跨模块公共接口契约').trim(),
            typeSignatures: String(sc.type_signatures || sc.typeSignatures || '').trim(),
            invariants: Array.isArray(sc.invariants) ? sc.invariants.map(String) : [],
          },
          modules: mods,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    }
  }

  // 2. 尝试从结构化契约块 <<<MODULE_DECOMPOSITION>>>...<<<MODULE_DECOMPOSITION_END>>> 解析
  const blockMatch =
    text.match(/<<<MODULE_DECOMPOSITION>>>([\s\S]*?)<<<MODULE_DECOMPOSITION_END>>>/i) ||
    text.match(/```(?:json)?\s*(\{\s*"shared_?contract"[\s\S]*?"modules"[\s\S]*?\})\s*```/i);

  if (blockMatch && blockMatch[1]) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      const sc = parsed.shared_contract || parsed.sharedContract || {};
      const mods = Array.isArray(parsed.modules) ? normalizeModules(parsed.modules) : [];
      if (mods.length >= 2) {
        return {
          sharedContract: {
            summary: String(sc.summary || '跨模块公共接口契约').trim(),
            typeSignatures: String(sc.type_signatures || sc.typeSignatures || '').trim(),
            invariants: Array.isArray(sc.invariants) ? sc.invariants.map(String) : [],
          },
          modules: mods,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    } catch (e) {
      console.warn('[acpClient] Failed to parse structured module decomposition block:', e);
    }
  }

  return undefined;
}

/**
 * 根据 ACP 响应 (包含记忆召回与原生 MCP 工具调用) 构建标准化 ThinkingProcess
 */
export function buildThinkingProcessFromAcp(
  acpResp: AcpAgentResponse,
  defaultSummary = '已检索私有记忆库并完成技术边界考量'
) {
  const hasMem = acpResp.memoryActions && acpResp.memoryActions.length > 0;
  const hasMcp = acpResp.mcpToolCalls && acpResp.mcpToolCalls.length > 0;

  if (!hasMem && !hasMcp) {
    return undefined;
  }

  const details: string[] = [];
  if (hasMem) {
    details.push(...acpResp.memoryActions!.map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`));
  }
  if (hasMcp) {
    details.push(...acpResp.mcpToolCalls!.map((t) => `[MCP TOOL] ${t.server_name} -> ${t.tool_name} (${t.status})`));
  }

  const summary = hasMcp
    ? `已执行 ${acpResp.mcpToolCalls!.length} 项原生 MCP 工具调用并完成推演`
    : defaultSummary;

  return {
    duration: `${acpResp.durationMs}ms`,
    tokens: Math.round(acpResp.textResponse.length * 1.3),
    summary,
    detail: details.join('\n'),
  };
}

/**
 * 探测远程 ACP WebSocket 连接状态与端点延迟
 */
export async function probeRemoteAcpConnection(
  remoteUrl: string,
  authToken?: string,
  timeoutMs = 6000,
  nativeMemoryPolicy?: { enabled: boolean; autoGenerate: boolean }
): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  agentInfo?: any;
  loadSession?: boolean;
  resumeSession?: boolean;
  nativeMemory?: ReturnType<typeof parseNativeMemoryCapability>;
  rawRpcResult?: any;
}> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
        resolve({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `连接超时 (${timeoutMs}ms)，请检查目标地址与网络通畅度`,
        });
      }
    }, timeoutMs);

    try {
      // 携带 token 作为 query parameter (若存在)
      const urlObj = new URL(remoteUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }
      ws = new WebSocket(urlObj.toString());

      ws.onopen = () => {
        // 发送 initialize 握手探针
        const initReq = {
          jsonrpc: '2.0',
          id: 101,
          method: 'initialize',
          params: {
            clientInfo: { name: 'shadow-crew-client', version: '1.0.0' },
            protocolVersion: '2025-01-01',
            ...(nativeMemoryPolicy
              ? {
                  _meta: {
                    shadowCrew: {
                      nativeMemory: {
                        enabled: Boolean(nativeMemoryPolicy.enabled),
                        autoGenerate: Boolean(
                          nativeMemoryPolicy.enabled && nativeMemoryPolicy.autoGenerate
                        ),
                      },
                    },
                  },
                }
              : {}),
          },
        };
        ws?.send(JSON.stringify(initReq));
      };

      ws.onmessage = (event) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const latencyMs = Date.now() - startTime;
          try {
            const data = JSON.parse(event.data);
            if (data?.error) {
              ws?.close();
              resolve({
                ok: false,
                latencyMs,
                error: data.error.message || JSON.stringify(data.error),
                rawRpcResult: data,
              });
              return;
            }
            // 必须是合法 JSON-RPC 响应，否则端口上任何会回包的 TCP 服务都会被误判为 ACP 可用。
            if (data?.jsonrpc !== '2.0' || typeof data?.result !== 'object' || data.result === null) {
              ws?.close();
              resolve({
                ok: false,
                latencyMs,
                error: '远程端返回的不是合法的 ACP initialize 响应',
                rawRpcResult: data,
              });
              return;
            }
            const agentInfo = data?.result?.agentInfo || { name: 'Remote ACP Agent' };
            const loadSession =
              data?.result?.capabilities?.loadSession ??
              data?.result?.agentCapabilities?.loadSession ??
              data?.result?.capabilities?.sessions?.load ??
              data?.result?.agentCapabilities?.sessions?.load;
            const resumeRaw =
              data?.result?.agentCapabilities?.sessionCapabilities?.resume ??
              data?.result?.sessionCapabilities?.resume ??
              data?.result?.capabilities?.sessionCapabilities?.resume ??
              data?.result?.capabilities?.resume ??
              data?.result?.agentCapabilities?.resume;
            const resumeSession =
              resumeRaw !== undefined && resumeRaw !== null && resumeRaw !== false;
            const nativeMemory = parseNativeMemoryCapability(data?.result);
            ws?.close();
            resolve({
              ok: true,
              latencyMs,
              agentInfo,
              loadSession: typeof loadSession === 'boolean' ? loadSession : undefined,
              resumeSession,
              nativeMemory,
              rawRpcResult: data,
            });
          } catch {
            // 无法解析的帧不能视为"探测成功"
            ws?.close();
            resolve({
              ok: false,
              latencyMs,
              error: '远程端返回了无法解析的响应（不是合法 JSON-RPC）',
            });
          }
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            latencyMs: Date.now() - startTime,
            error: 'WebSocket 连接握手失败，远程端可能未开启或凭证不匹配',
          });
        }
      };
    } catch (e: any) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `URL 解析或协议错误: ${e?.message || e}`,
        });
      }
    }
  });
}

/**
 * 通过 WebSocket 向远程 ACP Agent 发送 prompt 推演指令
 */
export async function sendPromptToRemoteAcpWebSocket(
  remoteUrl: string,
  prompt: string,
  roomId: string,
  authToken?: string,
  readOnlyGuard = true,
  systemPrompt?: string,
  workspaceBindingId?: string,
  workspaceUri?: string,
  scopeType?: 'channel' | 'topic' | 'dm' | 'dm_topic',
  nativeMemoryEnabled = false,
  nativeMemoryAutoGenerate = false
): Promise<AcpAgentResponse> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;
    // 对标 Buzz 架构: 动态空闲心跳超时 (每次收到流式数据/心跳自动续期 300s，上限 1800s)
    const IDLE_TIMEOUT_MS = 300_000;
    const MAX_DURATION_MS = 1800_000;
    let idleTimer: NodeJS.Timeout | null = null;
    let maxTimer: NodeJS.Timeout | null = null;

    const cleanupTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = null;
      }
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanupTimers();
          if (ws) {
            try {
              ws.close();
            } catch {}
          }
          resolve({
            textResponse: `⚠️【远程 ACP】响应空闲超时 (超过 ${IDLE_TIMEOUT_MS / 1000}s 未收到任何模型输出或心跳)。若使用深度思考或大参数量慢模型，可在端点处增加心跳支持。`,
            durationMs: Date.now() - startTime,
            isError: true,
            isRealProcess: true,
          });
        }
      }, IDLE_TIMEOUT_MS);
    };

    maxTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanupTimers();
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
        resolve({
          textResponse: `⚠️【远程 ACP】执行超过最大硬上限 (${MAX_DURATION_MS / 1000}s)，会话已安全收敛。`,
          durationMs: Date.now() - startTime,
          isError: true,
          isRealProcess: true,
        });
      }
    }, MAX_DURATION_MS);

    resetIdleTimer();

    try {
      const urlObj = new URL(remoteUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }
      ws = new WebSocket(urlObj.toString());

      // 每个连接使用唯一且可区分的 JSON-RPC id，避免与 Date.now() 撞号后错误关联响应。
      const initRequestId = Date.now();
      const promptRequestId = initRequestId + 1;
      let promptSent = false;
      let initTimer: ReturnType<typeof setTimeout> | null = null;

      const sendPrompt = (sessionId?: string) => {
        if (promptSent) return;
        promptSent = true;
        if (initTimer) {
          clearTimeout(initTimer);
          initTimer = null;
        }
        const rpcPayload = {
          jsonrpc: '2.0',
          id: promptRequestId,
          method: 'session/prompt',
          params: {
            ...(sessionId ? { sessionId } : {}),
            roomId,
            prompt: [{ type: 'text', text: prompt }],
            readOnlyGuard,
            ...(workspaceBindingId ? { workspaceBindingId } : {}),
            ...(workspaceUri ? { workspaceUri } : {}),
            ...(scopeType ? { scopeType } : {}),
            ...(systemPrompt ? { systemPrompt } : {}),
            _meta: {
              ...(systemPrompt
                ? {
                    systemPrompt: {
                      append: systemPrompt,
                    },
                  }
                : {}),
              shadowCrew: {
                nativeMemory: {
                  enabled: Boolean(nativeMemoryEnabled),
                  autoGenerate: Boolean(nativeMemoryEnabled && nativeMemoryAutoGenerate),
                },
              },
            },
          },
        };
        ws?.send(JSON.stringify(rpcPayload));
      };

      ws.onopen = () => {
        resetIdleTimer();
        // 标准 ACP 流程：先 initialize 获取 capabilities/sessionId，再发送 prompt。
        ws?.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initRequestId,
            method: 'initialize',
            params: {
              protocolVersion: 1,
              clientInfo: { name: 'shadow-crew', version: '0.1.0' },
              clientCapabilities: {},
            },
          })
        );
        // 兼容不支持 initialize 的自定义网关：8 秒未收到握手响应时降级为直接 prompt。
        initTimer = setTimeout(() => {
          if (!resolved && !promptSent) {
            console.warn('[acpClient] 远程端点未响应 initialize，降级为直接发送 session/prompt');
            sendPrompt(undefined);
          }
        }, 8000);
      };

      let accumulatedText = '';
      const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

      ws.onmessage = (event) => {
        resetIdleTimer();
        try {
          const msg = JSON.parse(event.data);

          // initialize 响应：提取 sessionId 后再发送 prompt
          if (
            msg.id === initRequestId &&
            !promptSent &&
            (msg.result || msg.error)
          ) {
            if (initTimer) {
              clearTimeout(initTimer);
              initTimer = null;
            }
            if (msg.error) {
              if (!resolved) {
                resolved = true;
                cleanupTimers();
                ws?.close();
                resolve({
                  textResponse: `⚠️【远程 ACP】initialize 握手被拒绝: ${msg.error.message || JSON.stringify(msg.error)}`,
                  durationMs: Date.now() - startTime,
                  isError: true,
                  isRealProcess: true,
                  raw: msg,
                });
              }
              return;
            }
            const sessionId =
              msg.result?.sessionId ||
              msg.result?.session_id ||
              msg.result?.agentInfo?.sessionId;
            sendPrompt(sessionId);
            return;
          }

          // 流式 update：ACP 标准字段是 params.update.content，兼容旧网关的 params.content。
          if (msg.method === 'session/update') {
            const content = msg.params?.update?.content ?? msg.params?.content;
            if (typeof content === 'string') {
              accumulatedText += content;
            } else if (Array.isArray(content)) {
              accumulatedText += content
                .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
                .join('');
            }
            return;
          }

          // 最终返回报文：只接受本次 prompt 的 id，或未带 id 的兼容响应。
          const isFinal = msg.result || msg.error;
          const belongsToPrompt =
            promptSent && (msg.id === promptRequestId || msg.id === undefined);
          if (isFinal && belongsToPrompt) {
            if (!resolved) {
              resolved = true;
              cleanupTimers();
              const durationMs = Date.now() - startTime;
              ws?.close();

              if (msg.error) {
                resolve({
                  textResponse: `⚠️【远程 ACP】执行报错: ${msg.error.message || JSON.stringify(msg.error)}`,
                  durationMs,
                  isError: true,
                  isRealProcess: true,
                  raw: msg,
                });
              } else {
                const finalReply =
                  accumulatedText ||
                  msg.result.text_response ||
                  (typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result));
                const hasNativeMemoryDecl =
                  msg.result &&
                  typeof msg.result === 'object' &&
                  msg.result.agentCapabilities &&
                  typeof msg.result.agentCapabilities === 'object' &&
                  msg.result.agentCapabilities.nativeMemory &&
                  typeof msg.result.agentCapabilities.nativeMemory === 'object';

                resolve({
                  textResponse: finalReply,
                  memoryActions: msg.result.memory_actions || memoryActions,
                  workspaceDiffs: readOnlyGuard ? [] : msg.result.workspace_diffs || [],
                  ...(hasNativeMemoryDecl
                    ? { nativeMemoryCapability: parseNativeMemoryCapability(msg.result) }
                    : {}),
                  durationMs,
                  isRealProcess: true,
                  raw: msg,
                });
              }
            }
          }
        } catch {
          // 非 JSON 流回退
          accumulatedText += event.data;
        }
      };

      ws.onclose = () => {
        if (!resolved && promptSent) {
          resolved = true;
          cleanupTimers();
          resolve({
            textResponse: `⚠️【远程 ACP】WebSocket 连接已关闭，未收到最终响应。`,
            durationMs: Date.now() - startTime,
            isError: true,
            isRealProcess: true,
          });
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          cleanupTimers();
          resolve({
            textResponse: `⚠️【远程 ACP】WebSocket 网络断开或鉴权拒绝，请确认端点是否存活。`,
            durationMs: Date.now() - startTime,
            isError: true,
            isRealProcess: true,
          });
        }
      };
    } catch (err: any) {
      if (!resolved) {
        resolved = true;
        cleanupTimers();
        resolve({
          textResponse: `⚠️【远程 ACP】无效端点地址: ${err?.message || err}`,
          durationMs: Date.now() - startTime,
          isError: true,
          isRealProcess: false,
        });
      }
    }
  });
}

/**
 * 构造 ACP 进程启动环境变量。
 * 该变量只表达当前 Agent 是否允许开启端点原生长期记忆，具体实现仍由适配器负责。
 * 若绑定了 Portable Expert Pack (.scpack)，强制关闭端点原生记忆、注入包标识并阻断越权沙箱环境变量。
 */
export function buildAgentLaunchEnv(agent: Agent): Array<{ key: string; value: string }> {
  const isExpertPackBound = Boolean(agent.expertPack?.packageId);
  const vars = (agent.envVars || []).filter((item) => {
    const k = item.key.trim();
    if (k === ACP_NATIVE_MEMORY_ENV || k === ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV) {
      return false;
    }
    if (isExpertPackBound) {
      if (
        k === 'SHADOW_CREW_EXPERT_PACK_ID' ||
        k === 'SHADOW_CREW_PORTABLE_EXPERT_AGENT' ||
        k === 'CODEX_DANGEROUSLY_BYPASS_SANDBOX' ||
        k === 'CODEX_HOME'
      ) {
        return false;
      }
    }
    return true;
  });

  if (isExpertPackBound && agent.expertPack) {
    vars.push({
      key: 'SHADOW_CREW_EXPERT_PACK_ID',
      value: agent.expertPack.packageId,
    });
    vars.push({
      key: 'SHADOW_CREW_PORTABLE_EXPERT_AGENT',
      value: '1',
    });
    vars.push({
      key: ACP_NATIVE_MEMORY_ENV,
      value: '0',
    });
    vars.push({
      key: ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV,
      value: '0',
    });
  } else {
    vars.push({
      key: ACP_NATIVE_MEMORY_ENV,
      value: agent.memory.mode === 'native' ? '1' : '0',
    });
    vars.push({
      key: ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV,
      value:
        agent.memory.mode === 'native' && agent.memory.autoGenerate ? '1' : '0',
    });
  }
  return vars;
}

/**
 * 统一多模态 ACP 通信入口
 * 仅通过远程 WebSocket 或本地 Tauri stdio ACP 端点执行；
 * 缺少可用端点时显式失败，不降级到直连模型或模拟回答。
 */
export async function sendPromptToAcpAgent(
  options: AcpSendPromptOptions
): Promise<AcpAgentResponse> {
  const startTime = Date.now();
  const { agent, roomId, prompt } = options;

  // 0.0 等待任何在途的 ACP Session 清理任务（如频道成员变更、议题成员变更、Agent 重置）彻底完成；
  // 若对应作用域的前序 Session 清理失败或超时，按 Fail-Closed 策略直接拒绝派发，杜绝新消息复用旧 Session 与旧花名册
  const barrierSessionKey = buildAgentSessionKey({
    agentId: agent.id,
    roomId,
    channelId: options.channelId,
    isDm: options.isDm,
    discussionMode: options.discussionMode,
    workspaceBindingId: options.workspaceBindingId,
    scopeType: options.scopeType,
  });
  const unifiedSessionKey = buildUnifiedSessionKey({
    agentId: agent.id,
    roomId,
    channelId: options.channelId,
    isDm: options.isDm,
    discussionMode: options.discussionMode,
    workspaceBindingId: options.workspaceBindingId,
    scopeType: options.scopeType,
  });
  await waitForPendingAcpSessionClears({
    agentId: agent.id,
    sessionKey: barrierSessionKey,
    channelId: options.channelId,
    roomId,
  });
  registerActiveAcpSessionForKey(barrierSessionKey);
  registerActiveAcpSessionForKey(unifiedSessionKey);

  // 0. 统一解析并注入 Agent 自身专属专精人设与行为硬性约束
  const personaPrompt = buildAgentPersonaPrompt(agent);
  const resolvedSystemPrompt = options.systemPrompt
    ? (options.systemPrompt.includes(agent.name) && options.systemPrompt.includes('智能体专属专精人设')
        ? options.systemPrompt
        : `${personaPrompt}\n\n${options.systemPrompt}`)
    : personaPrompt;

  const isExpertPackBound = Boolean(agent.expertPack?.packageId);
  const effectiveNativeMemoryEnabled = isExpertPackBound ? false : agent.memory.mode === 'native';
  const effectiveNativeMemoryAutoGenerate = isExpertPackBound
    ? false
    : Boolean(agent.memory.mode === 'native' && agent.memory.autoGenerate);

  // ACP 上下文、长期记忆和压缩均由 Agent 端点自行管理。
  let enhancedPrompt = prompt;
  let scpackRetrieval: PreRetrievalResult | undefined;

  // 1.1 严格通信准入：若 Agent 未由用户点击 Start 开启通信（idle），或进程/握手异常（error），拒绝发起通信
  if (isAgentOffline(agent)) {
    const reason =
      agent.status === 'error'
        ? `当前状态为连接异常${agent.statusDetail ? `（${agent.statusDetail}）` : ''}`
        : '当前处于离线未连接状态';
    return {
      textResponse: `🔌 **Agent 通信不可用**：【${agent.name}】${reason}，本轮指令未派发给该 Agent。\n\n请先在 **Agents & 编队** 控制面板点击该 Agent 头像下方的【Start】按钮开启 ACP 通信连接；若显示连接异常，请先修复其运行环境后重新 Start。`,
      durationMs: Date.now() - startTime,
      isRealProcess: false,
    };
  }

  // 1.2 若绑定了 .scpack 专家能力包，执行确定性 BM25 预检索与 Fail-Closed 校验
  if (isExpertPackBound && agent.expertPack) {
    try {
      scpackRetrieval = await retrieveScpackExpertise(agent.expertPack.packageId, prompt, 3);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        textResponse: `🛑 **专家能力包 (.scpack) Fail-Closed 熔断**：【${agent.name}】绑定的专家能力包 \`${agent.expertPack.packageId}\` 校验或预检索失败：${message}`,
        durationMs: Date.now() - startTime,
        isRealProcess: false,
        isError: true,
      };
    }
  }

  // 2. 判定是否为远程 Agent (WebSocket / Relay Hub)
  const isRemote =
    agent.isRemote ||
    agent.acpTransport === 'websocket' ||
    agent.acpCommandOrUrl?.startsWith('ws://') ||
    agent.acpCommandOrUrl?.startsWith('wss://') ||
    Boolean(agent.remoteUrl);

  if (isRemote) {
    if (options.attachments && options.attachments.length > 0) {
      return {
        textResponse: `⚠️【${agent.name}】当前远程 ACP 附件同步尚未实现。为避免静默丢弃图片或文件，本轮已阻断。`,
        durationMs: Date.now() - startTime,
        isRealProcess: false,
        isError: true,
      };
    }
    if (scpackRetrieval && !enhancedPrompt.includes('[SHADOW_CREW_EXPERTISE_DATA]')) {
      enhancedPrompt = scpackRetrieval.augmented_prompt;
    }
    const targetUrl = agent.remoteUrl || agent.acpCommandOrUrl;
    console.log(`[ACP Client] Dispatching prompt to Remote ACP: ${targetUrl} (${agent.name})`);
    const remoteRes = await sendPromptToRemoteAcpWebSocket(
      targetUrl,
      enhancedPrompt,
      roomId,
      agent.authToken,
      agent.readOnlyGuard ?? true,
      resolvedSystemPrompt,
      options.workspaceBindingId,
      options.workspaceCwd,
      options.scopeType,
      effectiveNativeMemoryEnabled,
      effectiveNativeMemoryAutoGenerate
    );
    if (
      remoteRes.nativeMemoryCapability &&
      remoteRes.nativeMemoryCapability.status !== 'unknown'
    ) {
      onNativeMemoryCapabilityUpdated?.(
        agent.id,
        remoteRes.nativeMemoryCapability,
        agent
      );
    }
    return {
      ...remoteRes,
      ...(scpackRetrieval ? { scpackRetrieval } : {}),
    };
  }

  // 3. 检查是否处于 Tauri 桌面端环境 (本地 stdio 进程)
  const tauriInvoke =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__?.invoke ||
        (window as any).__TAURI__?.core?.invoke
      : null;

  if (tauriInvoke) {
    try {
      console.log(`[ACP Client] Invoking real ACP agent process: ${agent.id} (${agent.name})`);

      const launchCommand = agent.acpCommandOrUrl;
      if (!launchCommand?.trim()) {
        return {
          textResponse: `⚠️【${agent.name}】未配置本地 ACP 启动命令。请在 Agent 配置中填写可执行的 ACP 命令。`,
          durationMs: Date.now() - startTime,
          isRealProcess: false,
          isError: true,
        };
      }
      const launchEnvVars = buildAgentLaunchEnv(agent);
      const isDm = options.isDm ?? (
        options.scopeType
          ? options.scopeType === 'dm'
          : Boolean(!options.channelId || options.channelId === 'direct-messages' || options.channelId.startsWith('dm-') || roomId.startsWith('thread-dm-'))
      );
      const targetCwd = options.workspaceCwd || (isDm
        ? `~/.shadow-crew/agents/${agent.id}`
        : `~/.shadow-crew/channels/${options.channelId || roomId}`);
      const effectiveChannelId = isDm ? undefined : (options.channelId || roomId);
      const promptAttachments = (options.attachments || []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        path: attachment.path,
        uri: attachment.uri,
      }));
      if (promptAttachments.some((attachment) => !attachment.path || !attachment.uri)) {
        return {
          textResponse: `⚠️【${agent.name}】附件尚未写入本地附件目录，本轮未派发。`,
          durationMs: Date.now() - startTime,
          isRealProcess: false,
          isError: true,
        };
      }

      const response = await tauriInvoke('send_prompt_to_agent', {
        agentId: agent.id,
        roomId,
        channelId: effectiveChannelId,
        workspaceBindingId: options.workspaceBindingId || null,
        workspaceCwd: options.workspaceCwd || targetCwd,
        prompt: enhancedPrompt,
        command: launchCommand,
        cwd: targetCwd,
        envVars: launchEnvVars,
        systemPrompt: resolvedSystemPrompt,
        nativeMemoryEnabled: effectiveNativeMemoryEnabled,
        nativeMemoryAutoGenerate: effectiveNativeMemoryAutoGenerate,
        discussionMode: options.discussionMode,
        scopeType: options.scopeType,
        attachments: promptAttachments,
      });

      const durationMs = Date.now() - startTime;
      console.log('[ACP Client] Real ACP response received:', response);

      // 解析 JSON-RPC 2.0 返回格式
      if (response && response.result) {
        const res = response.result;
        const rawText = res.text_response || '';
        const hasMcpToolCalls = Array.isArray(res.mcp_tool_calls) && res.mcp_tool_calls.length > 0;
        const isEmpty = !rawText.trim() && !hasMcpToolCalls;
        const fullText = rawText || (res.stopReason ? `【${agent.name}】ACP 任务已完成 (stopReason: ${res.stopReason})` : JSON.stringify(res));
        const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(fullText);
        const nativeDiffs: TopicPatchDiffItem[] = Array.isArray(res.workspace_diffs) && res.workspace_diffs.length > 0
          ? res.workspace_diffs
          : extractWorkspaceDiffsFromText(cleanedText);
        return {
          textResponse: cleanedText,
          isEmptyTurn: isEmpty,
          stopReason: res.stopReason,
          memoryActions: res.memory_actions || [],
          mcpToolCalls: res.mcp_tool_calls || [],
          workspaceDiffs: nativeDiffs,
          executionMeta,
          ...(scpackRetrieval ? { scpackRetrieval } : {}),
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (response && response.text_response) {
        const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(response.text_response);
        const nativeDiffs: TopicPatchDiffItem[] = Array.isArray(response.workspace_diffs) && response.workspace_diffs.length > 0
          ? response.workspace_diffs
          : extractWorkspaceDiffsFromText(cleanedText);
        const hasMcpToolCalls = Array.isArray(response.mcp_tool_calls) && response.mcp_tool_calls.length > 0;
        return {
          textResponse: cleanedText,
          isEmptyTurn: !cleanedText.trim() && !hasMcpToolCalls,
          memoryActions: response.memory_actions || [],
          mcpToolCalls: response.mcp_tool_calls || [],
          workspaceDiffs: nativeDiffs,
          executionMeta,
          ...(scpackRetrieval ? { scpackRetrieval } : {}),
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (
        response &&
        (response.status === 'timeout' || response.status === 'closed' || response.error)
      ) {
        const rawErrMsg =
          response.error?.message ||
          (typeof response.error === 'string' ? response.error : JSON.stringify(response.error)) ||
          (response.status === 'timeout' ? 'Agent 响应空闲超时 (等待超时)' : 'Agent 进程异常关闭');

        let formattedHelp = '';
        if (rawErrMsg.toLowerCase().includes('authentication required')) {
          formattedHelp =
            `\n\n💡 **认证排障指南 (Claude Code ACP)**：\n` +
            `• **原因**：Anthropic 官方规范限制，第三方客户端集成（如 Shadow Crew）**不支持**复用本机的 \`claude.ai\` 网页/OAuth 订阅，需要提供 \`ANTHROPIC_API_KEY\`。\n` +
            `• **配置步骤**：\n` +
            `  1. 点击当前 Agent 卡片右上角【编辑】图标 ✏️；\n` +
            `  2. 在「环境变量 (ENV)」中填入您的 \`ANTHROPIC_API_KEY\`（格式如 \`sk-ant-api03-...\`）；\n` +
            `  3. *(可选)* 若使用第三方反代/中转网关，可额外添加 \`ANTHROPIC_BASE_URL\`；\n` +
            `  4. 保存后重新发送消息或点击「Start」重新拉起即可。`;
        } else if (rawErrMsg.toLowerCase().includes('idle timeout') || rawErrMsg.toLowerCase().includes('timeout')) {
          formattedHelp =
            `\n\n💡 **慢模型 / 深度推理排障建议**：\n` +
            `• **原因**：复杂推理模型（如 DeepSeek-R1、o1/o3-mini、Claude 3.7 Thinking）首字思考耗时较长，或模型服务提供商处于排队状态。\n` +
            `• **解决方案**：\n` +
            `  1. 系统已启用对标 Buzz 的动态空闲心跳机制 (默认 300s)；若需要更长思考时间，可通过环境变量 \`SHADOW_CREW_ACP_IDLE_TIMEOUT=600\` 进一步放宽限制；\n` +
            `  2. 建议确认底层 Agent 命令是否启用了流式 (Streaming) 传输，以便首个 chunk 快速回传；\n` +
            `  3. 可点击输入框上方重新尝试或简化当前指令。`;
        }

        return {
          textResponse: `⚠️【${agent.name}】ACP 通信告警：${rawErrMsg}${formattedHelp}\n\n• **本地日志落盘**：底层原始 stdio 报文已持久化落盘至 \`logs/acp.log\`。\n• **实时跟踪**：可在终端运行 \`tail -f logs/acp.log\` 查看实时流。\n• **关联命令**：\`${agent.acpCommandOrUrl || '(未配置)'}\`。`,
          durationMs,
          isRealProcess: true,
          isError: true,
          raw: response,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ACP Client] ACP invocation failed:', err);
      return {
        textResponse: `⚠️【${agent.name}】ACP 调用失败：${message}\n\n本版本不再降级到直连 LLM 或模拟响应，请检查本地/远程 ACP 连接后重试。`,
        durationMs: Date.now() - startTime,
        isRealProcess: false,
        isError: true,
      };
    }
  }

  return {
    textResponse: `⚠️【${agent.name}】当前运行环境未提供 ACP 调用通道。请使用桌面端连接本地 ACP，或在 Agent 配置中连接远程 ACP。`,
    durationMs: Date.now() - startTime,
    isRealProcess: false,
    isError: true,
  };
}

/**
 * 从 Agent 响应 Markdown 文本中确定性提取 Unified Diff 块或带路径标注的工程代码补丁
 */
export function extractWorkspaceDiffsFromText(
  text: string,
  fallbackFiles: string[] = []
): TopicPatchDiffItem[] {
  if (!text || !text.trim()) return [];
  const results: TopicPatchDiffItem[] = [];
  const seenFiles = new Set<string>();

  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase().trim();
    const rawBody = (match[2] || '').trim();
    if (!rawBody) continue;

    // 跳过 JSON 契约块或 Mermaid 图表
    if (lang === 'mermaid' || (lang === 'json' && rawBody.includes('"decisionType"'))) {
      continue;
    }

    const lines = rawBody.split('\n');
    const isUnifiedDiff =
      lang === 'diff' ||
      lang === 'patch' ||
      rawBody.includes('--- a/') ||
      rawBody.includes('+++ b/') ||
      lines.some((l) => l.startsWith('@@ '));

    // 查找代码块前方的上下文是否标注了文件名
    const precedingText = text.slice(Math.max(0, match.index - 220), match.index);
    const precedingFileMatch = precedingText.match(
      /`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`|\*\*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\*\*|(?:文件|路径|File|Path)[:：\s]*`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?/i
    );
    const contextFilename =
      precedingFileMatch?.[1] || precedingFileMatch?.[2] || precedingFileMatch?.[3];

    if (isUnifiedDiff) {
      let filename = '';
      const plusMatch = rawBody.match(/^\+\+\+\s+(?:b\/)?([^\s\n]+)/m);
      const minusMatch = rawBody.match(/^---\s+(?:a\/)?([^\s\n]+)/m);
      const commentFileMatch = lines[0]?.match(/^(?:\/\/|#)\s*(?:filepath|file|path)[:：\s]*([^\s]+)/i);
      filename =
        (plusMatch?.[1] && plusMatch[1] !== '/dev/null' ? plusMatch[1] : '') ||
        (minusMatch?.[1] && minusMatch[1] !== '/dev/null' ? minusMatch[1] : '') ||
        commentFileMatch?.[1] ||
        contextFilename ||
        fallbackFiles[blockIndex] ||
        `patch_${blockIndex + 1}.ts`;

      let additions = 0;
      let deletions = 0;
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
      if (additions === 0 && deletions === 0) {
        additions = lines.length;
      }

      results.push({
        filename: filename.replace(/^[ab]\//, ''),
        additions,
        deletions,
        diff: rawBody,
      });
      seenFiles.add(filename);
      blockIndex++;
    } else if (
      ['ts', 'tsx', 'js', 'jsx', 'rs', 'rust', 'py', 'python', 'go', 'sql', 'toml', 'yaml', 'yml', 'css', 'html', 'sh'].includes(lang) ||
      lines[0]?.match(/^(?:\/\/|#|\/\*)\s*(?:filepath|file|path)[:：\s]*([^\s*]+)/i)
    ) {
      const commentFileMatch = lines[0]?.match(/^(?:\/\/|#|\/\*)\s*(?:filepath|file|path)[:：\s]*([^\s*]+)/i);
      const filename =
        commentFileMatch?.[1] ||
        contextFilename ||
        fallbackFiles.find((f) => !seenFiles.has(f)) ||
        fallbackFiles[blockIndex] ||
        '';

      if (filename || lines.length >= 4) {
        const resolvedName = (filename || `src/patch_${blockIndex + 1}.${lang || 'ts'}`).replace(/^[ab]\//, '');
        const cleanLines = commentFileMatch ? lines.slice(1) : lines;
        const cleanCode = cleanLines.join('\n').trim();
        const codeLines = cleanCode.split('\n');
        const syntheticDiff = [
          `--- a/${resolvedName}`,
          `+++ b/${resolvedName}`,
          `@@ -1,0 +1,${codeLines.length} @@`,
          ...codeLines.map((l) => `+${l}`),
        ].join('\n');

        results.push({
          filename: resolvedName,
          additions: codeLines.length,
          deletions: 0,
          diff: syntheticDiff,
          codeContent: cleanCode,
        });
        seenFiles.add(resolvedName);
        blockIndex++;
      }
    }
  }

  return results;
}

export interface ApplyTopicPatchOptions {
  workspaceBindingId: string;
  workspaceRoot: string;
  artifactRoot?: string;
  channelId: string;
  topicId: string;
  patches: TopicPatchDiffItem[];
}

export interface ApplyTopicPatchFileResult {
  filename: string;
  mode: 'git_apply' | 'block_replace' | 'created_file' | 'artifact_saved' | 'conflict' | 'failed';
  status: 'applied' | 'conflict' | 'archived_only' | 'failed';
  targetPath: string;
  artifactPath: string;
  backupPath?: string;
  error?: string;
}

export interface ApplyTopicPatchResponse {
  /** 仅当全部补丁真实落盘成功时为 true。 */
  ok: boolean;
  appliedCount: number;
  failedCount: number;
  artifactsDir: string;
  appliedFiles: ApplyTopicPatchFileResult[];
  summary: string;
  historyId: string;
  historyPath: string;
}

export function resolveTauriInvoke(): ((command: string, args?: Record<string, unknown>) => Promise<any>) | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).__TAURI_INTERNALS__?.invoke ||
    (window as any).__TAURI__?.core?.invoke ||
    null
  );
}

function buildUntrustedPatchFailure(
  patches: TopicPatchDiffItem[],
  artifactsDir: string,
  summary: string,
  error: string
): ApplyTopicPatchResponse {
  return {
    ok: false,
    appliedCount: 0,
    failedCount: patches.length,
    artifactsDir,
    appliedFiles: patches.map((patch) => ({
      filename: patch.filename,
      mode: 'failed' as const,
      status: 'failed' as const,
      targetPath: '',
      artifactPath: '',
      error,
    })),
    summary,
    historyId: '',
    historyPath: '',
  };
}

/**
 * 将议题落地 Agent 生成的补丁物理应用到本地工作区与频道归档目录。
 *
 * 该函数不再伪造成功：浏览器预览环境或 IPC 失败时返回 ok=false，
 * 并把真实失败原因逐文件返回给调用方，由宿主决定提示、重试或回退。
 */
export async function applyTopicPatchToWorkspace(
  options: ApplyTopicPatchOptions
): Promise<ApplyTopicPatchResponse> {
  const { workspaceBindingId, workspaceRoot, artifactRoot, channelId, topicId, patches } = options;
  const tauriInvoke = resolveTauriInvoke();
  const artifactsDir = artifactRoot || `${workspaceRoot}/artifacts`;

  if (!tauriInvoke) {
    return buildUntrustedPatchFailure(
      patches,
      artifactsDir,
      '未执行：当前为浏览器预览环境，无法写入本地工作区',
      '当前运行环境没有 Tauri IPC，补丁未落盘。请在桌面端执行合入。'
    );
  }

  try {
    const res = await tauriInvoke('apply_workspace_patch', {
      workspaceBindingId,
      channelId: channelId || 'general',
      topicId,
      patches: patches.map((p) => ({
        filename: p.filename,
        diff: p.diff,
        code_content: p.codeContent || null,
      })),
    });
    if (!res || typeof res !== 'object') {
      return buildUntrustedPatchFailure(
        patches,
        artifactsDir,
        '合入失败：宿主返回空结果',
        'apply_workspace_patch 未返回有效结果'
      );
    }
    return {
      ok: Boolean(res.ok),
      appliedCount: Number(res.applied_count) || 0,
      failedCount: Number(res.failed_count) || 0,
      artifactsDir: res.artifacts_dir || artifactsDir,
      appliedFiles: (res.applied_files || []).map((f: any) => ({
        filename: f.filename,
        mode: f.mode,
        status: f.status,
        targetPath: f.target_path,
        artifactPath: f.artifact_path,
        backupPath: f.backup_path || undefined,
        error: f.error || undefined,
      })),
      summary: res.summary || '宿主未返回合入摘要',
      historyId: res.history_id || '',
      historyPath: res.history_path || '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ACP Client] apply_workspace_patch IPC failed:', err);
    return buildUntrustedPatchFailure(
      patches,
      artifactsDir,
      `合入失败：宿主 IPC 异常（${message}）`,
      message
    );
  }
}

export interface RollbackTopicPatchOptions {
  workspaceBindingId: string;
  channelId: string;
  topicId: string;
  historyPath: string;
}

export interface RollbackTopicPatchFileResult {
  filename: string;
  status: 'restored' | 'deleted_created_file' | 'skipped_modified' | 'skipped_missing' | 'failed';
  targetPath: string;
  message?: string;
}

export interface RollbackTopicPatchResponse {
  ok: boolean;
  restoredCount: number;
  failedCount: number;
  files: RollbackTopicPatchFileResult[];
  summary: string;
}

/**
 * 根据补丁历史 manifest 回退本地工作区改动。
 * 用户后续修改过的文件会被宿主标记为 skipped_modified，绝不覆盖。
 */
export async function rollbackTopicPatchFromWorkspace(
  options: RollbackTopicPatchOptions
): Promise<RollbackTopicPatchResponse> {
  const { workspaceBindingId, channelId, topicId, historyPath } = options;
  const tauriInvoke = resolveTauriInvoke();
  if (!tauriInvoke) {
    return {
      ok: false,
      restoredCount: 0,
      failedCount: 0,
      files: [],
      summary: '未执行：当前为浏览器预览环境，无法回退本地工作区',
    };
  }
  try {
    const res = await tauriInvoke('rollback_workspace_patch', {
      workspaceBindingId,
      channelId: channelId || 'general',
      topicId,
      historyPath,
    });
    return {
      ok: Boolean(res?.ok),
      restoredCount: Number(res?.restored_count) || 0,
      failedCount: Number(res?.failed_count) || 0,
      files: (res?.files || []).map((f: any) => ({
        filename: f.filename,
        status: f.status,
        targetPath: f.target_path,
        message: f.message || undefined,
      })),
      summary: res?.summary || '宿主未返回回退摘要',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ACP Client] rollback_workspace_patch IPC failed:', err);
    return {
      ok: false,
      restoredCount: 0,
      failedCount: 0,
      files: [],
      summary: `回退失败：宿主 IPC 异常（${message}）`,
    };
  }
}

/**
 * 追踪当前正在执行中的 ACP Session 清理任务与按作用域划分的清理失败状态 (Fail-Closed 屏障)
 * - 当清理在途时：后续同作用域（或全局）的 sendPromptToAcpAgent 必须等待清理完成；
 * - 当清理超时时：自动移除挂起项并将该作用域标记为清理失败，拒绝放行后续 Prompt；
 * - 当清理失败时：保持该作用域处于阻断状态 (Fail-Closed)，直到下一次针对该作用域或全局的 Session 清理成功。
 */
export const DEFAULT_SESSION_CLEAR_BARRIER_TIMEOUT_MS = 5000;

export interface AcpSessionClearBarrierQuery {
  agentId?: string;
  sessionKey?: string;
  channelId?: string;
  roomId?: string;
  timeoutMs?: number;
}

interface PendingSessionClearEntry {
  id: number;
  generation: number;
  scopeKey: string;
  abortController: AbortController;
  timedOut: boolean;
  cancelled: boolean;
  settled: boolean;
  resolveSettled: () => void;
  settledPromise: Promise<void>;
}

let nextClearEntryId = 1;
let nextClearGeneration = 1;
const pendingSessionClearEntries = new Map<number, PendingSessionClearEntry>();
const failedSessionClearScopes = new Map<string, string>();
const latestScopeClearGeneration = new Map<string, number>();
const cancelledClearGenerations = new Set<number>();
export interface AcpSessionClearInvokeArgs {
  agentId: string | null;
  sessionKeyPrefix: string | null;
  clearGeneration: number;
  signal: AbortSignal;
  isStale: () => boolean;
}

const activeAcpSessionGenerations = new Map<string, number>();
let customClearInvokeForTests:
  | ((cmd: string, args: AcpSessionClearInvokeArgs) => Promise<unknown>)
  | null = null;
let customClearTimeoutMsForTests: number | null = null;

export function setAcpSessionClearInvokeForTests(
  fn: ((cmd: string, args: AcpSessionClearInvokeArgs) => Promise<unknown>) | null
): void {
  customClearInvokeForTests = fn;
}

export function setAcpSessionClearTimeoutMsForTests(timeoutMs: number | null): void {
  customClearTimeoutMsForTests = timeoutMs;
}

export function resetAcpSessionClearBarrierState(): void {
  for (const entry of pendingSessionClearEntries.values()) {
    entry.cancelled = true;
    cancelledClearGenerations.add(entry.generation);
    entry.abortController.abort();
    if (!entry.settled) {
      entry.settled = true;
      entry.resolveSettled();
    }
  }
  pendingSessionClearEntries.clear();
  failedSessionClearScopes.clear();
  latestScopeClearGeneration.clear();
  cancelledClearGenerations.clear();
  activeAcpSessionGenerations.clear();
  customClearInvokeForTests = null;
  customClearTimeoutMsForTests = null;
}

export function buildClearBarrierScopeKey(agentId?: string, sessionKeyPrefix?: string): string {
  const cleanAgent = agentId?.trim();
  const cleanPrefix = sessionKeyPrefix?.trim();
  if (cleanAgent && cleanPrefix) {
    return `agent_prefix:${cleanAgent}:${cleanPrefix}`;
  }
  if (cleanAgent) {
    return `agent:${cleanAgent}`;
  }
  if (cleanPrefix) {
    return `prefix:${cleanPrefix}`;
  }
  return '*';
}

function doesPrefixCoverPrefix(broaderPrefix: string, narrowerPrefix: string): boolean {
  const cleanBroad = broaderPrefix.trim().replace(/:+$/, '');
  const cleanNarrow = narrowerPrefix.trim().replace(/:+$/, '');
  if (!cleanBroad || !cleanNarrow) return false;
  return cleanNarrow === cleanBroad || cleanNarrow.startsWith(`${cleanBroad}:`);
}

function normalizeClearBarrierScopeKey(rawScope: string): string {
  const trimmed = rawScope.trim();
  if (!trimmed || trimmed === '*') {
    return '*';
  }
  if (
    trimmed.startsWith('agent:') ||
    trimmed.startsWith('prefix:') ||
    trimmed.startsWith('agent_prefix:')
  ) {
    return trimmed;
  }
  return `prefix:${trimmed}`;
}

/**
 * 判断 broaderScopeKey 是否在语义上完整覆盖 narrowerScopeKey：
 * - 全局 '*' 覆盖任意作用域；
 * - 任何局部作用域绝不覆盖全局 '*'；
 * - 'prefix:topic:ch-1' 覆盖 'prefix:topic:ch-1:topic-1' 与 'agent_prefix:<any>:topic:ch-1:topic-1'；
 * - 'agent:<id>' 覆盖 'agent:<id>' 与 'agent_prefix:<id>:<any>'；
 * - 'agent_prefix:<id>:<broad>' 覆盖 'agent_prefix:<id>:<narrow>'（当 broad 覆盖 narrow 时）。
 */
export function doesScopeCoverOtherScope(
  rawBroaderScopeKey: string,
  rawNarrowerScopeKey: string
): boolean {
  const broaderScopeKey = normalizeClearBarrierScopeKey(rawBroaderScopeKey);
  const narrowerScopeKey = normalizeClearBarrierScopeKey(rawNarrowerScopeKey);

  if (broaderScopeKey === narrowerScopeKey) {
    return true;
  }
  if (broaderScopeKey === '*') {
    return true;
  }
  if (narrowerScopeKey === '*') {
    return false;
  }

  if (broaderScopeKey.startsWith('agent:')) {
    const bAgent = broaderScopeKey.slice('agent:'.length);
    if (narrowerScopeKey.startsWith('agent:')) {
      return narrowerScopeKey.slice('agent:'.length) === bAgent;
    }
    if (narrowerScopeKey.startsWith('agent_prefix:')) {
      const rest = narrowerScopeKey.slice('agent_prefix:'.length);
      const sepIdx = rest.indexOf(':');
      const nAgent = sepIdx >= 0 ? rest.slice(0, sepIdx) : rest;
      return nAgent === bAgent;
    }
    return false;
  }

  if (broaderScopeKey.startsWith('prefix:')) {
    const bPrefix = broaderScopeKey.slice('prefix:'.length);
    if (narrowerScopeKey.startsWith('prefix:')) {
      const nPrefix = narrowerScopeKey.slice('prefix:'.length);
      return doesPrefixCoverPrefix(bPrefix, nPrefix);
    }
    if (narrowerScopeKey.startsWith('agent_prefix:')) {
      const rest = narrowerScopeKey.slice('agent_prefix:'.length);
      const sepIdx = rest.indexOf(':');
      if (sepIdx < 0) return false;
      const nPrefix = rest.slice(sepIdx + 1);
      return doesPrefixCoverPrefix(bPrefix, nPrefix);
    }
    return false;
  }

  if (broaderScopeKey.startsWith('agent_prefix:')) {
    const bRest = broaderScopeKey.slice('agent_prefix:'.length);
    const bSep = bRest.indexOf(':');
    if (bSep < 0) return false;
    const bAgent = bRest.slice(0, bSep);
    const bPrefix = bRest.slice(bSep + 1);

    if (narrowerScopeKey.startsWith('agent_prefix:')) {
      const nRest = narrowerScopeKey.slice('agent_prefix:'.length);
      const nSep = nRest.indexOf(':');
      if (nSep < 0) return false;
      const nAgent = nRest.slice(0, nSep);
      const nPrefix = nRest.slice(nSep + 1);
      return bAgent === nAgent && doesPrefixCoverPrefix(bPrefix, nPrefix);
    }
    return false;
  }

  return false;
}

function hasNewerCoveringGeneration(scopeKey: string, generation: number): boolean {
  const normScope = normalizeClearBarrierScopeKey(scopeKey);
  for (const [recordedScope, recordedGen] of latestScopeClearGeneration.entries()) {
    if (recordedGen > generation && doesScopeCoverOtherScope(recordedScope, normScope)) {
      return true;
    }
  }
  return false;
}

export function isAcpSessionClearGenerationValid(
  generation: number,
  scopeKey?: string
): boolean {
  if (cancelledClearGenerations.has(generation)) {
    return false;
  }
  if (scopeKey && hasNewerCoveringGeneration(scopeKey, generation)) {
    return false;
  }
  return true;
}

export function registerActiveAcpSessionForKey(sessionKey: string): number {
  const gen = nextClearGeneration++;
  activeAcpSessionGenerations.set(sessionKey, gen);
  return gen;
}

export function hasActiveAcpSessionForKey(sessionKey: string): boolean {
  return activeAcpSessionGenerations.has(sessionKey);
}

export function purgeActiveAcpSessionsByScope(
  rawScopeKey: string,
  maxGeneration: number
): number {
  const scopeKey = normalizeClearBarrierScopeKey(rawScopeKey);
  if (!isAcpSessionClearGenerationValid(maxGeneration, scopeKey)) {
    return 0;
  }
  let removed = 0;
  for (const [sessionKey, createdGen] of Array.from(activeAcpSessionGenerations.entries())) {
    if (
      createdGen <= maxGeneration &&
      doesQueryMatchClearScope(scopeKey, { sessionKey })
    ) {
      activeAcpSessionGenerations.delete(sessionKey);
      removed++;
    }
  }
  return removed;
}

function doesPrefixMatchBarrierQuery(prefix: string, query: AcpSessionClearBarrierQuery): boolean {
  const cleanPrefix = prefix.trim().replace(/:+$/, '');
  const colonPrefix = `${cleanPrefix}:`;
  if (query.sessionKey) {
    const cleanSk = query.sessionKey.trim();
    if (
      cleanSk === cleanPrefix ||
      cleanSk.startsWith(colonPrefix) ||
      cleanPrefix.startsWith(`${cleanSk}:`)
    ) {
      return true;
    }
    if (!query.channelId && !query.roomId) {
      return false;
    }
  }
  if (query.channelId && query.roomId) {
    if (
      cleanPrefix === `channel:${query.channelId}` ||
      cleanPrefix === `topic:${query.channelId}` ||
      cleanPrefix === `channel:${query.channelId}:${query.roomId}` ||
      cleanPrefix === `topic:${query.channelId}:${query.roomId}` ||
      cleanPrefix.startsWith(`channel:${query.channelId}:${query.roomId}:`) ||
      cleanPrefix.startsWith(`topic:${query.channelId}:${query.roomId}:`)
    ) {
      return true;
    }
    return false;
  }
  if (query.channelId) {
    if (
      cleanPrefix === `channel:${query.channelId}` ||
      cleanPrefix === `topic:${query.channelId}` ||
      cleanPrefix.startsWith(`channel:${query.channelId}:`) ||
      cleanPrefix.startsWith(`topic:${query.channelId}:`)
    ) {
      return true;
    }
  }
  if (query.roomId) {
    if (
      cleanPrefix === `topic:${query.roomId}` ||
      cleanPrefix === `channel:${query.roomId}` ||
      cleanPrefix.endsWith(`:${query.roomId}`) ||
      cleanPrefix.includes(`:${query.roomId}:`)
    ) {
      return true;
    }
  }
  if (!query.sessionKey && !query.channelId && !query.roomId) {
    return true;
  }
  return false;
}

export function doesQueryMatchClearScope(
  scopeKey: string,
  query?: AcpSessionClearBarrierQuery
): boolean {
  if (!query || scopeKey === '*') {
    return true;
  }
  if (scopeKey.startsWith('agent:')) {
    const targetAgentId = scopeKey.slice('agent:'.length);
    if (query.agentId) {
      return query.agentId === targetAgentId;
    }
    if (query.sessionKey) {
      return (
        query.sessionKey.startsWith(`dm:${targetAgentId}:`) ||
        query.sessionKey.endsWith(`:${targetAgentId}`)
      );
    }
    return true;
  }
  if (scopeKey.startsWith('prefix:')) {
    const prefix = scopeKey.slice('prefix:'.length);
    return doesPrefixMatchBarrierQuery(prefix, query);
  }
  if (scopeKey.startsWith('agent_prefix:')) {
    const rest = scopeKey.slice('agent_prefix:'.length);
    const sepIdx = rest.indexOf(':');
    const targetAgentId = rest.slice(0, sepIdx);
    const prefix = rest.slice(sepIdx + 1);
    if (query.agentId && query.agentId !== targetAgentId) {
      return false;
    }
    return doesPrefixMatchBarrierQuery(prefix, query);
  }
  return true;
}

export function getFailedAcpSessionClearReason(query?: AcpSessionClearBarrierQuery): string | null {
  for (const [scopeKey, reason] of failedSessionClearScopes.entries()) {
    if (doesQueryMatchClearScope(scopeKey, query)) {
      return reason;
    }
  }
  return null;
}

export async function waitForPendingAcpSessionClears(
  query?: AcpSessionClearBarrierQuery
): Promise<void> {
  const timeoutMs =
    query?.timeoutMs ?? customClearTimeoutMsForTests ?? DEFAULT_SESSION_CLEAR_BARRIER_TIMEOUT_MS;

  while (true) {
    const matchingEntries = Array.from(pendingSessionClearEntries.values()).filter(
      (entry) =>
        !entry.cancelled &&
        !entry.timedOut &&
        !entry.settled &&
        !cancelledClearGenerations.has(entry.generation) &&
        doesQueryMatchClearScope(entry.scopeKey, query)
    );
    if (matchingEntries.length === 0) {
      break;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });

    await Promise.race([
      Promise.all(matchingEntries.map((e) => e.settledPromise)).then(() => undefined),
      timeoutPromise,
    ]);

    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }

    if (timedOut) {
      const stillPending = matchingEntries.filter(
        (e) =>
          pendingSessionClearEntries.has(e.id) &&
          !e.cancelled &&
          !cancelledClearGenerations.has(e.generation)
      );
      for (const hung of stillPending) {
        hung.timedOut = true;
        hung.cancelled = true;
        cancelledClearGenerations.add(hung.generation);
        hung.abortController.abort();
        pendingSessionClearEntries.delete(hung.id);
        if (!hung.settled) {
          hung.settled = true;
          hung.resolveSettled();
        }
        failedSessionClearScopes.set(
          hung.scopeKey,
          `ACP Session 清理请求超时 (${timeoutMs}ms)`
        );
      }
      if (stillPending.length > 0) {
        throw new Error(
          `ACP Session 清理屏障等待超时 (${timeoutMs}ms)，已按 Fail-Closed 策略阻断当前作用域派发以防复用旧上下文`
        );
      }
    }
  }

  const failedReason = getFailedAcpSessionClearReason(query);
  if (failedReason) {
    throw new Error(
      `ACP Session 清理未完成或失败 (${failedReason})，已按 Fail-Closed 策略阻止派发新 Prompt，防止复用旧花名册或脏会话`
    );
  }
}

export function getPendingAcpSessionClearCount(): number {
  return pendingSessionClearEntries.size;
}

/**
 * 清除指定 Agent 或全量 Agent 在底座与直连大模型运行时的会话缓存
 * 保持前后端水位线、历史消息与底层 ACP 进程 session_id 彻底同步重置
 */
export async function clearAcpAgentSessions(
  agentId?: string,
  sessionKeyPrefix?: string,
  options?: { timeoutMs?: number }
): Promise<void> {
  const scopeKey = buildClearBarrierScopeKey(agentId, sessionKeyPrefix);
  const entryId = nextClearEntryId++;
  const clearGeneration = nextClearGeneration++;
  const abortController = new AbortController();
  const timeoutMs =
    options?.timeoutMs ?? customClearTimeoutMsForTests ?? DEFAULT_SESSION_CLEAR_BARRIER_TIMEOUT_MS;

  // 若存在被当前作用域覆盖的旧在途清理请求，立即将其标记为已取消并触发 abort，防止旧请求迟到返回产生逆序副作用
  for (const existing of Array.from(pendingSessionClearEntries.values())) {
    if (doesScopeCoverOtherScope(scopeKey, existing.scopeKey)) {
      existing.cancelled = true;
      cancelledClearGenerations.add(existing.generation);
      existing.abortController.abort();
      pendingSessionClearEntries.delete(existing.id);
      if (!existing.settled) {
        existing.settled = true;
        existing.resolveSettled();
      }
    }
  }
  latestScopeClearGeneration.set(scopeKey, clearGeneration);

  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const entry: PendingSessionClearEntry = {
    id: entryId,
    generation: clearGeneration,
    scopeKey,
    abortController,
    timedOut: false,
    cancelled: false,
    settled: false,
    resolveSettled,
    settledPromise,
  };

  const runClear = async () => {
    purgeActiveAcpSessionsByScope(scopeKey, clearGeneration);

    const tauriInvoke =
      customClearInvokeForTests ||
      (typeof window !== 'undefined'
        ? (window as any).__TAURI_INTERNALS__?.invoke ||
          (window as any).__TAURI__?.core?.invoke
        : null);

    if (tauriInvoke) {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          abortController.signal.addEventListener(
            'abort',
            () => {
              if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
              }
            },
            { once: true }
          );
          timeoutHandle = setTimeout(() => {
            if (entry.cancelled || cancelledClearGenerations.has(clearGeneration)) {
              return;
            }
            entry.timedOut = true;
            cancelledClearGenerations.add(clearGeneration);
            abortController.abort();
            pendingSessionClearEntries.delete(entryId);
            if (!entry.settled) {
              entry.settled = true;
              entry.resolveSettled();
            }
            reject(
              new Error(
                `ACP Session 清理请求超时 (${timeoutMs}ms)，已按 Fail-Closed 策略锁定作用域 (${scopeKey})`
              )
            );
          }, timeoutMs);
        });

        const invokePromise = Promise.resolve().then(() =>
          tauriInvoke('clear_agent_sessions', {
            agentId: agentId || null,
            sessionKeyPrefix: sessionKeyPrefix || null,
            clearGeneration,
            signal: abortController.signal,
            isStale: () =>
              entry.cancelled ||
              entry.timedOut ||
              !isAcpSessionClearGenerationValid(clearGeneration, scopeKey),
          })
        );
        // 防止 timeoutPromise 先拒绝后，迟到的 invokePromise 拒绝触发 Node UnhandledPromiseRejection
        void invokePromise.catch(() => {});

        await Promise.race([invokePromise, timeoutPromise]);

        // 若在等待期间该请求已超时或被更新代际的清理请求取消，则立即丢弃迟到结果，严禁执行任何后续解锁或删会话副作用
        if (
          entry.cancelled ||
          entry.timedOut ||
          !isAcpSessionClearGenerationValid(clearGeneration, scopeKey)
        ) {
          return;
        }
        console.log(
          `[ACP Client] Cleared ACP process session_ids (agentId: ${agentId}, prefix: ${sessionKeyPrefix}, gen: ${clearGeneration})`
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // 仅当该请求未被取消且尚无更新的覆盖作用域清理代际接管时，才写入失败锁（防止被取消的旧请求迟到报错反向污染新成功状态）
        // 注意：若属于本任务自身超时 (entry.timedOut)，必须写入失败锁执行 Fail-Closed 阻断
        if (
          (!entry.cancelled || entry.timedOut) &&
          !hasNewerCoveringGeneration(scopeKey, clearGeneration)
        ) {
          failedSessionClearScopes.set(scopeKey, errMsg);
        }
        console.warn('[ACP Client] Failed to invoke clear_agent_sessions in Tauri:', e);
        throw e;
      } finally {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    if (
      entry.cancelled ||
      entry.timedOut ||
      !isAcpSessionClearGenerationValid(clearGeneration, scopeKey)
    ) {
      return;
    }

    // 清理成功后按作用域包含关系解除失败锁：
    // - 全局清理 (scopeKey === '*') 成功时，清空所有失败记录；
    // - 宽作用域清理成功时，清除其覆盖的所有同级与更窄作用域失败锁（例如 topic:ch-1 成功自动解除 topic:ch-1:topic-1），但绝不解除全局 '*' 锁！
    purgeActiveAcpSessionsByScope(scopeKey, clearGeneration);
    if (scopeKey === '*') {
      failedSessionClearScopes.clear();
    } else {
      for (const failedKey of Array.from(failedSessionClearScopes.keys())) {
        if (doesScopeCoverOtherScope(scopeKey, failedKey)) {
          failedSessionClearScopes.delete(failedKey);
        }
      }
    }
  };

  const rawPromise = runClear();
  rawPromise.then(
    () => {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolveSettled();
      }
      pendingSessionClearEntries.delete(entryId);
    },
    () => {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolveSettled();
      }
      pendingSessionClearEntries.delete(entryId);
    }
  );

  pendingSessionClearEntries.set(entryId, entry);

  try {
    await rawPromise;
  } finally {
    if (!entry.settled) {
      entry.settled = true;
      entry.resolveSettled();
    }
    pendingSessionClearEntries.delete(entryId);
  }
}

export interface EnsureSessionResult {
  sessionId: string;
  isNew: boolean;
  loadFailed: boolean;
  recoveryMode?: 'resume' | 'load' | 'new';
}

/**
 * 在编译 Prompt 前预检并确保底层 Agent 拥有就绪的 ACP Session。
 * 若返回 isNew: true，代表底层刚刚分配了全新 Session（或 Layer 1 session/load 恢复失败已 Fallback），
 * 调用方必须重置该 Agent 在当前会话的水位线与协同公约挂载标记，确保编译出完整的 Cold-Start Prompt！
 */
export async function ensureAcpAgentSession(options: {
  agentId: string;
  roomId: string;
  channelId?: string;
  systemPrompt?: string;
  discussionMode?: string;
  workspaceBindingId?: string;
  workspaceCwd?: string;
  scopeType?: 'channel' | 'topic' | 'dm' | 'dm_topic';
  isDm?: boolean;
  localHistoryIntact?: boolean;
}): Promise<EnsureSessionResult | null> {
  const isDm = options.isDm ?? (
    options.scopeType
      ? options.scopeType === 'dm'
      : Boolean(!options.channelId || options.channelId === 'direct-messages' || options.channelId.startsWith('dm-') || options.roomId.startsWith('thread-dm-'))
  );
  const barrierSessionKey = buildAgentSessionKey({
    agentId: options.agentId,
    roomId: options.roomId,
    channelId: isDm ? undefined : options.channelId,
    isDm,
    discussionMode: options.discussionMode,
    workspaceBindingId: options.workspaceBindingId,
    scopeType: options.scopeType,
  });

  // 1. 严格等待针对该作用域的 Session 清理屏障，消除预检与清理之间的交错与重叠
  await waitForPendingAcpSessionClears({
    agentId: options.agentId,
    sessionKey: barrierSessionKey,
    channelId: options.channelId,
    roomId: options.roomId,
  });

  const tauriInvoke =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__?.invoke ||
        (window as any).__TAURI__?.core?.invoke
      : null;

  if (!tauriInvoke) {
    return null;
  }

  // 2. 预检调用，失败时严格抛出异常（Fail-Closed），严禁静默吞错返回 null
  try {
    const result = await tauriInvoke('ensure_agent_session', {
      agentId: options.agentId,
      roomId: options.roomId,
      channelId: isDm ? null : (options.channelId || null),
      workspaceBindingId: options.workspaceBindingId || null,
      workspaceCwd: options.workspaceCwd || null,
      systemPrompt: options.systemPrompt || null,
      discussionMode: options.discussionMode || null,
      scopeType: options.scopeType || null,
      localHistoryIntact: options.localHistoryIntact ?? null,
    });
    return result as EnsureSessionResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ACP Client] ensure_agent_session preflight failed for agent ${options.agentId}:`, msg);
    throw new Error(`ACP Agent [${options.agentId}] session preflight failed: ${msg}`);
  }
}

