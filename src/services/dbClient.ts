import { Message, Channel, Thread, Agent, AgentTeam, WorkspaceBinding } from '../types';

export interface StorageStats {
  databasePath: string;
  databaseSizeBytes: number;
  logsPath: string;
  logsSizeBytes: number;
  totalMessagesCount: number;
  totalMemoriesCount: number;
  safeCleanableBytes: number;
  archivableBytes: number;
  protectedBytes: number;
  localStorageUsageBytes: number;
  isNativeTauri: boolean;
}

/**
 * 获取 Tauri 内部 invoke 调用器 (兼容 Tauri v2 与浏览器开发环境)
 */
export function getTauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.__TAURI_INTERNALS__?.invoke || w.__TAURI__?.core?.invoke || null;
}

export function isTauriEnvironment(): boolean {
  return getTauriInvoke() !== null;
}

/**
 * 统一包装原生持久化错误：记录上下文后向上抛出。
 * 禁止在原生模式失败后静默回退到 localStorage —— 那会让调用方误以为数据已落库，
 * 并在下次启动时读到互相矛盾的旧快照。
 */
function failClosed(operation: string, cause: unknown): never {
  console.error(`[dbClient] ${operation} failed:`, cause);
  throw new Error(
    `${operation} 失败：${cause instanceof Error ? cause.message : String(cause)}`
  );
}

/**
 * 格式化字节大小展示 (e.g. 1.2 MB, 45 KB)
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * 计算浏览器 localStorage 的实际内存占用字节数
 */
export function getLocalStorageUsageBytes(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key) || '';
        // UTF-16 字符串按 2 字节估算
        totalBytes += (key.length + val.length) * 2;
      }
    }
  } catch (e) {
    console.warn('[dbClient] Failed to read localStorage size', e);
  }
  return totalBytes;
}

const TRANSIENT_PENDING_ID_PREFIXES = ['topic-pending-', 'msg-pending-'] as const;

/**
 * 判断消息是否为流式/推演期间的瞬态占位快照。
 * 关键回归约束：被手动终止/成员更新终止并标记为 `agentBadge === '已终止'` 的记录
 * 属于保留语义的历史消息，绝不能视为瞬态占位。
 */
export function isTransientPendingMessage(msg: Message): boolean {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.agentBadge === '已终止') return false;
  if (msg.isPending === true) return true;
  const id = typeof msg.id === 'string' ? msg.id : '';
  return TRANSIENT_PENDING_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * 过滤出允许落盘持久化的非瞬态消息集合。
 */
export function filterPersistableMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  return messages.filter((msg) => !isTransientPendingMessage(msg));
}

function parseTopicExecModSuffix(
  id: string,
  prefix: 'topic-pending-exec-mod-' | 'topic-reply-exec-mod-'
): string | null {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const dashIdx = rest.indexOf('-');
  if (dashIdx <= 0) return null;
  const digits = rest.slice(0, dashIdx);
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return null;
  }
  const suffix = rest.slice(dashIdx + 1);
  return suffix.length > 0 ? suffix : null;
}

function extractPendingReplySignature(id: string): { kind: string; suffix?: string } | null {
  if (!id) return null;
  const execModSuffix =
    parseTopicExecModSuffix(id, 'topic-pending-exec-mod-') ??
    parseTopicExecModSuffix(id, 'topic-reply-exec-mod-');
  if (execModSuffix) {
    return { kind: 'exec-mod', suffix: execModSuffix };
  }
  if (id.startsWith('topic-pending-concurrence-') || id.startsWith('topic-reply-concurrence-')) {
    return { kind: 'concurrence' };
  }
  if (id.startsWith('topic-pending-exec-') || id.startsWith('topic-reply-exec-')) {
    return { kind: 'exec' };
  }
  return null;
}

function canCarryOverStartedAt(pending: Message, candidate: Message): boolean {
  if (candidate.agentBadge === '已终止') return false;
  if ((candidate.threadId || '') !== (pending.threadId || '')) return false;
  if (candidate.authorId !== pending.authorId) return false;
  if (
    candidate.kind === 'system_control' ||
    candidate.kind === 'guard' ||
    candidate.kind === 'rollup'
  ) {
    return false;
  }
  if (typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt)) {
    return false;
  }
  if (
    pending.gameStage !== undefined &&
    candidate.gameStage !== undefined &&
    candidate.gameStage !== pending.gameStage
  ) {
    return false;
  }
  if (
    pending.gameRole !== undefined &&
    candidate.gameRole !== undefined &&
    candidate.gameRole !== pending.gameRole
  ) {
    return false;
  }
  if (
    pending.moduleId !== undefined &&
    candidate.moduleId !== undefined &&
    candidate.moduleId !== pending.moduleId
  ) {
    return false;
  }
  return true;
}

function scoreReplyMatch(pending: Message, candidate: Message): number {
  let score = 0;
  if (pending.gameStage !== undefined && candidate.gameStage === pending.gameStage) {
    score += 4;
  }
  if (pending.gameRole !== undefined && candidate.gameRole === pending.gameRole) {
    score += 2;
  }
  if (pending.moduleId !== undefined && candidate.moduleId === pending.moduleId) {
    score += 4;
  }
  const pendingSig = extractPendingReplySignature(pending.id || '');
  const candidateSig = extractPendingReplySignature(candidate.id || '');
  if (pendingSig && candidateSig && pendingSig.kind === candidateSig.kind) {
    score += 4;
    if (pendingSig.suffix && candidateSig.suffix && pendingSig.suffix === candidateSig.suffix) {
      score += 8;
    }
  }
  return score;
}

/**
 * 清洗并协调消息列表：
 * - 剔除所有瞬态 Pending 占位快照并收集待清理 ID（`purgedPendingIds`）；
 * - 完整保留 `agentBadge === '已终止'` 的中断记录；
 * - 若终态回复缺少 `startedAt`，从对应的瞬态 Pending 快照继承 `startedAt`。
 */
export function reconcileAndSanitizeMessages(list: Message[]): {
  sanitized: Message[];
  purgedPendingIds: string[];
} {
  if (!Array.isArray(list) || list.length === 0) {
    return { sanitized: [], purgedPendingIds: [] };
  }

  const purgedIdSet = new Set<string>();
  const pendingItems: Array<{ origIdx: number; msg: Message }> = [];
  const keptItems: Array<{ origIdx: number; msg: Message }> = [];

  list.forEach((rawMsg, origIdx) => {
    if (!rawMsg || typeof rawMsg !== 'object') return;
    if (isTransientPendingMessage(rawMsg)) {
      if (typeof rawMsg.id === 'string' && rawMsg.id.trim().length > 0) {
        purgedIdSet.add(rawMsg.id);
      }
      pendingItems.push({ origIdx, msg: rawMsg });
      return;
    }

    const cleaned = { ...rawMsg } as Message & { projectId?: string };
    delete cleaned.projectId;
    if (cleaned.isPending) {
      cleaned.isPending = false;
    }
    keptItems.push({ origIdx, msg: cleaned });
  });

  for (const pendingEntry of pendingItems) {
    const startedAt = pendingEntry.msg.startedAt;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
      continue;
    }

    const forwardCandidates = keptItems.filter(
      (entry) =>
        entry.origIdx > pendingEntry.origIdx &&
        canCarryOverStartedAt(pendingEntry.msg, entry.msg)
    );
    const pool =
      forwardCandidates.length > 0
        ? forwardCandidates
        : keptItems.filter((entry) => canCarryOverStartedAt(pendingEntry.msg, entry.msg));

    if (pool.length === 0) continue;

    let best = pool[0];
    let bestScore = scoreReplyMatch(pendingEntry.msg, best.msg);
    for (let i = 1; i < pool.length; i++) {
      const candidateScore = scoreReplyMatch(pendingEntry.msg, pool[i].msg);
      if (candidateScore > bestScore) {
        best = pool[i];
        bestScore = candidateScore;
      }
    }
    best.msg.startedAt = startedAt;
  }

  return {
    sanitized: keptItems.map((entry) => entry.msg),
    purgedPendingIds: Array.from(purgedIdSet),
  };
}

function readWebMessagesFromLocalStorage(): {
  shape: 'array' | 'map' | 'empty';
  arrayList: Message[];
  threadMap: Record<string, Message[]>;
} {
  if (typeof localStorage === 'undefined') {
    return { shape: 'empty', arrayList: [], threadMap: {} };
  }
  const raw = localStorage.getItem('shinobi_messages');
  if (!raw) {
    return { shape: 'empty', arrayList: [], threadMap: {} };
  }
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { shape: 'array', arrayList: parsed as Message[], threadMap: {} };
  }
  if (parsed && typeof parsed === 'object') {
    return { shape: 'map', arrayList: [], threadMap: parsed as Record<string, Message[]> };
  }
  return { shape: 'empty', arrayList: [], threadMap: {} };
}

function upsertWebMessagesToLocalStorage(persistableMessages: Message[]): void {
  if (typeof localStorage === 'undefined') return;
  const current = readWebMessagesFromLocalStorage();

  if (current.shape === 'map') {
    const nextMap: Record<string, Message[]> = {};
    for (const [threadId, list] of Object.entries(current.threadMap)) {
      nextMap[threadId] = filterPersistableMessages(Array.isArray(list) ? list : []);
    }
    for (const msg of persistableMessages) {
      const key = msg.threadId || msg.channelId || 'general';
      const bucket = nextMap[key] ? [...nextMap[key]] : [];
      const existingIdx = bucket.findIndex((m) => m.id === msg.id);
      if (existingIdx >= 0) {
        bucket[existingIdx] = msg;
      } else {
        bucket.push(msg);
      }
      nextMap[key] = bucket;
    }
    localStorage.setItem('shinobi_messages', JSON.stringify(nextMap));
    return;
  }

  const nextList = filterPersistableMessages(current.arrayList);
  for (const msg of persistableMessages) {
    const existingIdx = nextList.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      nextList[existingIdx] = msg;
    } else {
      nextList.push(msg);
    }
  }
  localStorage.setItem('shinobi_messages', JSON.stringify(nextList));
}

/**
 * 保存单条消息到 SQLite (Tauri 优先，降级到本地缓存)
 */
export async function saveMessageToDb(message: Message): Promise<void> {
  if (isTransientPendingMessage(message)) {
    return;
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_message', { message });
      return;
    } catch (e) {
      failClosed('db_save_message', e);
    }
  }

  // 降级模式 (Web 环境)
  try {
    upsertWebMessagesToLocalStorage([message]);
  } catch (err) {
    failClosed('localStorage 消息写入', err);
  }
}

/**
 * 批量写入消息（用于初次启动从 localStorage 平滑迁移至 SQLite）
 */
export async function saveMessagesBatchToDb(messages: Message[]): Promise<number> {
  if (!messages || messages.length === 0) return 0;
  const persistableMessages = filterPersistableMessages(messages);

  const invoke = getTauriInvoke();
  if (invoke) {
    if (persistableMessages.length === 0) {
      return 0;
    }
    try {
      const count = await invoke('db_save_messages_batch', { messages: persistableMessages });
      if (typeof count === 'number' && Number.isFinite(count)) {
        return count;
      }
      const parsedCount = Number(count);
      return Number.isFinite(parsedCount) && count !== null && count !== undefined
        ? parsedCount
        : persistableMessages.length;
    } catch (e) {
      failClosed('db_save_messages_batch', e);
    }
  }

  try {
    upsertWebMessagesToLocalStorage(persistableMessages);
  } catch (err) {
    console.error('[dbClient] LocalStorage batch fallback write failed:', err);
  }

  return persistableMessages.length;
}

/**
 * 按消息 ID 列表从 SQLite（或 Web localStorage）批量删除指定消息记录
 */
export async function deleteMessagesByIdsFromDb(ids: string[]): Promise<number> {
  const cleanIds = Array.from(
    new Set((ids || []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
  );
  if (cleanIds.length === 0) return 0;

  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const deleted = await invoke('db_delete_messages_by_ids', { ids: cleanIds });
      return Number(deleted) || 0;
    } catch (e) {
      console.error('[dbClient] db_delete_messages_by_ids failed:', e);
    }
  }

  if (typeof localStorage === 'undefined') return 0;
  try {
    const current = readWebMessagesFromLocalStorage();
    const idSet = new Set(cleanIds);
    let removedCount = 0;

    if (current.shape === 'array') {
      const next = current.arrayList.filter((m) => {
        if (m && typeof m.id === 'string' && idSet.has(m.id)) {
          removedCount++;
          return false;
        }
        return true;
      });
      if (removedCount > 0) {
        localStorage.setItem('shinobi_messages', JSON.stringify(next));
      }
      return removedCount;
    }

    if (current.shape === 'map') {
      const nextMap: Record<string, Message[]> = {};
      for (const [threadId, list] of Object.entries(current.threadMap)) {
        const safeList = Array.isArray(list) ? list : [];
        nextMap[threadId] = safeList.filter((m) => {
          if (m && typeof m.id === 'string' && idSet.has(m.id)) {
            removedCount++;
            return false;
          }
          return true;
        });
      }
      if (removedCount > 0) {
        localStorage.setItem('shinobi_messages', JSON.stringify(nextMap));
      }
      return removedCount;
    }
  } catch (err) {
    console.error('[dbClient] LocalStorage deleteMessagesByIdsFromDb failed:', err);
  }

  return 0;
}

/**
 * 从 SQLite 获取消息列表
 */
export async function loadMessagesFromDb(filter?: {
  threadId?: string;
  channelId?: string;
  limit?: number;
  offset?: number;
}): Promise<Message[]> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const res = await invoke('db_get_messages', {
        threadId: filter?.threadId || null,
        channelId: filter?.channelId || null,
        limit: filter?.limit || null,
        offset: filter?.offset || null,
      });
      if (Array.isArray(res)) {
        return res as Message[];
      }
      throw new Error(`db_get_messages 返回了非数组结果：${typeof res}`);
    } catch (e) {
      failClosed('db_get_messages', e);
    }
  }

  // 降级从 localStorage 读取
  try {
    const current = readWebMessagesFromLocalStorage();
    const list: Message[] =
      current.shape === 'array'
        ? current.arrayList
        : current.shape === 'map'
          ? Object.values(current.threadMap).flat()
          : [];
    if (list.length > 0) {
      if (filter?.threadId) {
        return list.filter((m) => m.threadId === filter.threadId);
      }
      if (filter?.channelId) {
        return list.filter((m) => m.channelId === filter.channelId);
      }
      return list;
    }
  } catch (err) {
    console.error('[dbClient] LocalStorage fallback read failed:', err);
  }

  return [];
}

/**
 * 跨议题/频道全文检索历史消息（按时间倒序，仅返回命中项）
 */
export async function searchMessagesInDb(query: string, limit = 30): Promise<Message[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const res = await invoke('db_search_messages', { query: trimmed, limit });
      if (!Array.isArray(res)) {
        throw new Error(`db_search_messages 返回了非数组结果：${typeof res}`);
      }
      return res as Message[];
    } catch (e) {
      failClosed('db_search_messages', e);
    }
  }

  try {
    const raw = localStorage.getItem('shinobi_messages');
    if (!raw) return [];
    const list: Message[] = JSON.parse(raw);
    const needle = trimmed.toLowerCase();
    return list
      .filter((m) => (m.content || '').toLowerCase().includes(needle))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
  } catch (err) {
    failClosed('localStorage 消息检索', err);
  }
}

/**
 * 清空所有历史会话消息 (保留 Agent 长期私有记忆)
 */
export async function clearAllMessagesFromDb(): Promise<number> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const count = await invoke('db_clear_all_messages');
      return Number(count) || 0;
    } catch (e) {
      failClosed('db_clear_all_messages', e);
    }
  }

  // Web 降级清空
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('shinobi_messages');
  }
  return 0;
}

/**
 * 获取完整存储与缓存分级统计数据
 */
export async function getStorageStats(): Promise<StorageStats> {
  const invoke = getTauriInvoke();
  const localUsage = getLocalStorageUsageBytes();

  if (invoke) {
    try {
      const dto = await invoke('db_get_storage_stats');
      return {
        databasePath: dto.database_path || 'shinobi_agent_memory.db',
        databaseSizeBytes: Number(dto.database_size_bytes) || 0,
        logsPath: dto.logs_path || 'logs/acp.log',
        logsSizeBytes: Number(dto.logs_size_bytes) || 0,
        totalMessagesCount: Number(dto.total_messages_count) || 0,
        totalMemoriesCount: Number(dto.total_memories_count) || 0,
        safeCleanableBytes: Number(dto.safe_cleanable_bytes) || 0,
        archivableBytes: Number(dto.archivable_bytes) || 0,
        protectedBytes: Number(dto.protected_bytes) || 0,
        localStorageUsageBytes: localUsage,
        isNativeTauri: true,
      };
    } catch (e) {
      failClosed('db_get_storage_stats', e);
    }
  }

  // 纯浏览器降级估算
  let messagesCount = 0;
  try {
    const current = readWebMessagesFromLocalStorage();
    if (current.shape === 'array') {
      messagesCount = current.arrayList.length;
    } else if (current.shape === 'map') {
      messagesCount = Object.values(current.threadMap).reduce(
        (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
        0
      );
    }
  } catch (err) {
    console.warn('[dbClient] localStorage 消息快照损坏，统计按 0 处理', err);
  }

  return {
    databasePath: 'LocalStorage / In-Memory (Web Fallback)',
    databaseSizeBytes: localUsage,
    logsPath: 'None (Web Mode)',
    logsSizeBytes: 0,
    totalMessagesCount: messagesCount,
    totalMemoriesCount: 8,
    safeCleanableBytes: Math.floor(localUsage * 0.1),
    archivableBytes: Math.floor(localUsage * 0.7),
    protectedBytes: Math.floor(localUsage * 0.2),
    localStorageUsageBytes: localUsage,
    isNativeTauri: false,
  };
}

/**
 * 一键安全清理缓存 (清空 acp.log，压缩 SQLite WAL，不影响任何会话和核心记忆)
 */
export async function clearSafeCache(): Promise<{ freedBytes: number }> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const freed = await invoke('db_clear_safe_cache');
      return { freedBytes: Number(freed) || 0 };
    } catch (e) {
      failClosed('db_clear_safe_cache', e);
    }
  }

  return { freedBytes: 0 };
}

/**
 * 导出全量消息历史为标准 JSON 文件供下载备份
 */
export function exportMessagesAsJsonFile(messages: Message[]): void {
  const exportPayload = {
    app: 'Shinobi Workspace',
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    total_messages: messages.length,
    messages,
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shinobi_messages_backup_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 将消息列表渲染为可读 Markdown（用于人工归档、评审留档与外部审阅）。
 * 空内容消息（纯占位卡）会被跳过，避免导出噪音。
 */
export function buildMessagesMarkdown(messages: Message[], title: string): string {
  const exportedAt = new Date().toLocaleString();
  const usable = messages.filter((m) => (m.content || '').trim().length > 0);
  const lines: string[] = [
    `# ${title}`,
    '',
    `> 导出时间：${exportedAt} · 共 ${usable.length} 条消息`,
    '',
  ];
  for (const message of usable) {
    const badge = message.agentBadge ? ` · ${message.agentBadge}` : '';
    const usage = message.tokenUsage
      ? `\n\n*tokens: ${message.tokenUsage.totalTokens.toLocaleString()}*`
      : '';
    lines.push(`## ${message.authorName}${badge} · ${message.timestamp}`, '', message.content.trim(), usage, '', '---', '');
  }
  return lines.join('\n');
}

/**
 * 导出当前会话为 Markdown 文件。
 */
export function exportMessagesAsMarkdownFile(messages: Message[], title: string): void {
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'conversation';
  const blob = new Blob([buildMessagesMarkdown(messages, title)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ChannelDirInfo {
  channelDir: string;
  artifactsDir: string;
  scratchDir: string;
  memoryDb: string;
  globalDir: string;
}

/**
 * 打开当前频道的落地产物工作区目录 (在系统访达/资源管理器中弹出)
 */
export async function openChannelArtifactsFolder(
  channelId: string,
  workspaceBindingId?: string
): Promise<string> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      if (workspaceBindingId) {
        return await invoke('open_workspace_artifacts_dir', { workspaceBindingId });
      }
      const path = await invoke('open_channel_artifacts_dir', { channelId });
      return path;
    } catch (e) {
      failClosed('open_channel_artifacts_dir', e);
    }
  }
  throw new Error('打开产物目录仅支持桌面端 Tauri 运行环境');
}

/**
 * 打开当前 Agent 的专属落地产物工作区目录 (在系统访达/资源管理器中弹出)
 */
export async function openAgentArtifactsFolder(agentId: string): Promise<string> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const path = await invoke('open_agent_artifacts_dir', { agentId });
      return path;
    } catch (e) {
      failClosed('open_agent_artifacts_dir', e);
    }
  }
  throw new Error('打开产物目录仅支持桌面端 Tauri 运行环境');
}

/**
 * 获取当前频道与全局 Shadow Crew 路径信息
 */
export async function getChannelDirInfo(channelId: string): Promise<ChannelDirInfo | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      return await invoke('get_channel_dir_info', { channelId });
    } catch (e) {
      failClosed('get_channel_dir_info', e);
    }
  }
  return null;
}

/**
 * 获取当前 Agent 与全局 Shadow Crew 路径信息
 */
export async function getAgentDirInfo(agentId: string): Promise<ChannelDirInfo | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      return await invoke('get_agent_dir_info', { agentId });
    } catch (e) {
      failClosed('get_agent_dir_info', e);
    }
  }
  return null;
}

export interface FullWorkspaceData {
  channels: Channel[];
  workspaceBindings: WorkspaceBinding[];
  threads: Thread[];
  agents: Agent[];
  teams: AgentTeam[];
  workspaceState: Record<string, any>;
}

/**
 * 聚合加载 SQLite 中存储的工作区核心资产
 */
export async function loadFullWorkspaceDataFromDb(): Promise<FullWorkspaceData | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const data = await invoke('db_get_full_workspace_data');
      if (data && typeof data === 'object') {
        return data as FullWorkspaceData;
      }
      throw new Error(`db_get_full_workspace_data 返回了非法结构：${typeof data}`);
    } catch (e) {
      failClosed('db_get_full_workspace_data', e);
    }
  }
  return null;
}

/**
 * 保存频道列表至 SQLite
 */
export async function saveChannelsToDb(channels: Channel[]): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_channels', { channels });
    } catch (e) {
      failClosed('db_save_channels', e);
    }
    return;
  }
  try {
    localStorage.setItem('shinobi_channels', JSON.stringify(channels));
  } catch (err) {
    failClosed('localStorage channels 写入', err);
  }
}

/**
 * 保存不可变 Workspace Binding 列表至 SQLite。
 */
export async function saveWorkspaceBindingsToDb(bindings: WorkspaceBinding[]): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_workspace_bindings', { bindings });
    } catch (e) {
      failClosed('db_save_workspace_bindings', e);
    }
    return;
  }
  try {
    localStorage.setItem('shinobi_workspace_bindings', JSON.stringify(bindings));
  } catch (err) {
    failClosed('localStorage workspace bindings 写入', err);
  }
}

/**
 * 删除消息：频道被删除时按 channelId 清理其下所有线程消息。
 * 仅清理内存而不清库，会让已删除频道在下次启动时“复活”。
 */
export async function deleteMessagesFromDb(
  threadId?: string,
  channelId?: string
): Promise<number> {
  if (!threadId && !channelId) return 0;
  const invoke = getTauriInvoke();
  if (invoke) {
    const count = await invoke('db_delete_messages', {
      threadId: threadId || null,
      channelId: channelId || null,
    });
    return Number(count) || 0;
  }
  try {
    const raw = localStorage.getItem('shinobi_messages');
    if (!raw) return 0;
    const messages: Message[] = JSON.parse(raw);
    const kept = messages.filter(
      (m) => m.threadId !== threadId && m.channelId !== channelId
    );
    localStorage.setItem('shinobi_messages', JSON.stringify(kept));
    return messages.length - kept.length;
  } catch (err) {
    failClosed('localStorage 消息删除', err);
  }
}

export async function deleteWorkspaceBindingsFromDb(bindingIds: string[]): Promise<void> {
  if (bindingIds.length === 0) return;
  const invoke = getTauriInvoke();
  if (invoke) {
    await invoke('db_delete_workspace_bindings', { bindingIds });
    return;
  }
  try {
    const raw = localStorage.getItem('shinobi_workspace_bindings');
    const bindings: WorkspaceBinding[] = raw ? JSON.parse(raw) : [];
    localStorage.setItem(
      'shinobi_workspace_bindings',
      JSON.stringify(bindings.filter((binding) => !bindingIds.includes(binding.id)))
    );
  } catch (err) {
    failClosed('localStorage 删除 workspace bindings', err);
  }
}

/**
 * 在桌面端创建并规范化工作目录；Web 环境仅做字符串规范化。
 */
export async function resolveWorkspaceCwd(rawCwd: string, createMissing: boolean): Promise<string> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return await invoke('resolve_workspace_cwd', {
      rawCwd,
      createMissing,
    });
  }
  const trimmed = rawCwd.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('工作目录不能为空');
  return trimmed;
}

/**
 * 保存话题/议题列表至 SQLite
 */
export async function saveThreadsToDb(threads: Thread[]): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_threads', { threads });
    } catch (e) {
      failClosed('db_save_threads', e);
    }
    return;
  }
  try {
    localStorage.setItem('shinobi_threads', JSON.stringify(threads));
  } catch (err) {
    failClosed('localStorage threads 写入', err);
  }
}

/**
 * 保存 Agent 配置列表至 SQLite
 */
export async function saveAgentsToDb(agents: Agent[]): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_agents', { agents });
    } catch (e) {
      failClosed('db_save_agents', e);
    }
    return;
  }
  try {
    localStorage.setItem('shinobi_agents', JSON.stringify(agents));
  } catch (err) {
    failClosed('localStorage agents 写入', err);
  }
}

/**
 * 保存团队编队列表至 SQLite
 */
export async function saveTeamsToDb(teams: AgentTeam[]): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_teams', { teams });
    } catch (e) {
      failClosed('db_save_teams', e);
    }
    return;
  }
  try {
    localStorage.setItem('shinobi_teams', JSON.stringify(teams));
  } catch (err) {
    failClosed('localStorage teams 写入', err);
  }
}

/**
 * 保存单个工作区状态项至 SQLite (如 activeChannelId, activeThreadId, subThreads)
 */
export async function saveWorkspaceStateToDb(key: string, value: any): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('db_save_workspace_state', { key, value });
    } catch (e) {
      failClosed(`db_save_workspace_state (${key})`, e);
    }
    return;
  }
  try {
    localStorage.setItem(`shinobi_${key}`, JSON.stringify(value));
  } catch (err) {
    failClosed(`localStorage workspace state (${key}) 写入`, err);
  }
}

/**
 * 从 SQLite 获取单个工作区状态项
 */
export async function getWorkspaceStateFromDb<T>(key: string): Promise<T | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const res = await invoke('db_get_workspace_state', { key });
      return (res ?? null) as T | null;
    } catch (e) {
      failClosed(`db_get_workspace_state (${key})`, e);
    }
  }
  try {
    const raw = localStorage.getItem(`shinobi_${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    failClosed(`localStorage workspace state (${key}) 读取`, err);
  }
}


