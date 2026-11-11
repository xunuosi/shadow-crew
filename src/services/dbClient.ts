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

/**
 * 保存单条消息到 SQLite (Tauri 优先，降级到本地缓存)
 */
export async function saveMessageToDb(message: Message): Promise<void> {
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
    const raw = localStorage.getItem('shinobi_messages');
    const list: Message[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      list[idx] = message;
    } else {
      list.push(message);
    }
    localStorage.setItem('shinobi_messages', JSON.stringify(list));
  } catch (err) {
    failClosed('localStorage 消息写入', err);
  }
}

/**
 * 批量写入消息（用于初次启动从 localStorage 平滑迁移至 SQLite）
 */
export async function saveMessagesBatchToDb(messages: Message[]): Promise<number> {
  if (!messages || messages.length === 0) return 0;
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const count = await invoke('db_save_messages_batch', { messages });
      const persisted = Number(count);
      if (!Number.isFinite(persisted) || persisted < 0) {
        throw new Error(`原生返回了非法写入条数：${String(count)}`);
      }
      if (persisted < messages.length) {
        console.warn(
          `[dbClient] db_save_messages_batch 仅写入 ${persisted}/${messages.length} 条（缺失 id 的消息被跳过）`
        );
      }
      return persisted;
    } catch (e) {
      failClosed('db_save_messages_batch', e);
    }
  }

  // Web 降级：真正写入 localStorage，并按批量覆盖语义返回写入条数。
  try {
    localStorage.setItem('shinobi_messages', JSON.stringify(messages));
    return messages.length;
  } catch (err) {
    failClosed('localStorage 批量消息写入', err);
  }
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
    const raw = localStorage.getItem('shinobi_messages');
    if (raw) {
      const list: Message[] = JSON.parse(raw);
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
  localStorage.removeItem('shinobi_messages');
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
    const raw = localStorage.getItem('shinobi_messages');
    if (raw) {
      const parsed = JSON.parse(raw);
      messagesCount = Array.isArray(parsed) ? parsed.length : 0;
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


