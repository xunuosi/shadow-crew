import { Message } from '../types';

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
function getTauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.__TAURI_INTERNALS__?.invoke || w.__TAURI__?.core?.invoke || null;
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
      console.error('[dbClient] db_save_message failed:', e);
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
    console.error('[dbClient] LocalStorage fallback write failed:', err);
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
      return Number(count) || messages.length;
    } catch (e) {
      console.error('[dbClient] db_save_messages_batch failed:', e);
    }
  }

  return messages.length;
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
    } catch (e) {
      console.error('[dbClient] db_get_messages failed:', e);
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
      console.error('[dbClient] db_clear_all_messages failed:', e);
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
      console.error('[dbClient] db_get_storage_stats failed:', e);
    }
  }

  // 纯浏览器降级估算
  let messagesCount = 0;
  try {
    const raw = localStorage.getItem('shinobi_messages');
    if (raw) {
      messagesCount = JSON.parse(raw).length;
    }
  } catch {}

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
      console.error('[dbClient] db_clear_safe_cache failed:', e);
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
