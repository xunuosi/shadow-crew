import { useState, useEffect, useCallback } from 'react';

export type DraftType = 'channel' | 'dm' | 'topic' | 'subthread';

export const STORAGE_KEY_DRAFTS = 'shinobi_input_drafts';

export function formatDraftKey(type: DraftType, id: string): string {
  return `${type}:${id}`;
}

// 内存单例缓存，保障毫秒级同步访问
let draftsCache: Record<string, string> | null = null;

type DraftListener = (drafts: Record<string, string>) => void;
const listeners = new Set<DraftListener>();

/**
 * 获取全量草稿映射字典
 */
export function getDraftsMap(): Record<string, string> {
  if (draftsCache !== null) return draftsCache;
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRAFTS);
    draftsCache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[draftService] Failed to read drafts from localStorage', e);
    draftsCache = {};
  }
  return draftsCache || {};
}

/**
 * 读取特定维度的草稿内容
 */
export function getDraft(type: DraftType, id: string | undefined | null): string {
  if (!id) return '';
  const key = formatDraftKey(type, id);
  const map = getDraftsMap();
  return map[key] || '';
}

/**
 * 暂存草稿内容（空字符自动清除键，避免垃圾积累）
 */
export function saveDraft(type: DraftType, id: string | undefined | null, content: string): void {
  if (!id) return;
  const key = formatDraftKey(type, id);
  const map = { ...getDraftsMap() };

  if (content && content.trim().length > 0) {
    map[key] = content;
  } else {
    delete map[key];
  }

  draftsCache = map;
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(STORAGE_KEY_DRAFTS);
    } else {
      localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(map));
    }
  } catch (e) {
    console.warn('[draftService] Failed to write drafts to localStorage', e);
  }
  notifyListeners(map);
}

/**
 * 清理指定维度的草稿（通常在发送消息后调用）
 */
export function clearDraft(type: DraftType, id: string | undefined | null): void {
  if (!id) return;
  const key = formatDraftKey(type, id);
  const map = { ...getDraftsMap() };

  if (map[key] !== undefined) {
    delete map[key];
    draftsCache = map;
    try {
      if (Object.keys(map).length === 0) {
        localStorage.removeItem(STORAGE_KEY_DRAFTS);
      } else {
        localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(map));
      }
    } catch (e) {
      console.warn('[draftService] Failed to update drafts in localStorage', e);
    }
    notifyListeners(map);
  }
}

/**
 * 清空所有维度的未发送草稿
 */
export function clearAllDrafts(): void {
  draftsCache = {};
  try {
    localStorage.removeItem(STORAGE_KEY_DRAFTS);
  } catch {}
  notifyListeners({});
}

/**
 * 计算草稿统计信息（条目数与字符体积）
 */
export function getDraftStats(): { count: number; sizeBytes: number } {
  const map = getDraftsMap();
  const count = Object.keys(map).length;
  if (count === 0) {
    return { count: 0, sizeBytes: 0 };
  }
  const jsonStr = JSON.stringify(map);
  return {
    count,
    sizeBytes: jsonStr.length * 2, // UTF-16 approximate
  };
}

/**
 * 订阅草稿字典变化（用于侧边栏与列表实时更新草稿徽标）
 */
export function subscribeDrafts(listener: DraftListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(map: Record<string, string>) {
  listeners.forEach((fn) => {
    try {
      fn(map);
    } catch (err) {
      console.error('[draftService] listener error:', err);
    }
  });
}

/**
 * React Hook: 管理单条特定上下文草稿的读写与自动同步
 */
export function useDraft(type: DraftType, id: string | undefined | null) {
  const [content, setContentState] = useState<string>(() => (id ? getDraft(type, id) : ''));

  useEffect(() => {
    if (!id) {
      setContentState('');
      return;
    }
    setContentState(getDraft(type, id));
  }, [type, id]);

  const updateDraft = useCallback(
    (newContent: string) => {
      if (!id) return;
      setContentState(newContent);
      saveDraft(type, id, newContent);
    },
    [type, id]
  );

  const resetDraft = useCallback(() => {
    if (!id) return;
    setContentState('');
    clearDraft(type, id);
  }, [type, id]);

  return {
    content,
    setContent: updateDraft,
    clearDraft: resetDraft,
    hasDraft: Boolean(content && content.trim().length > 0),
  };
}

/**
 * React Hook: 响应式获取全量草稿映射（供侧边栏等组件渲染未发送徽标）
 */
export function useAllDrafts(): Record<string, string> {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => getDraftsMap());

  useEffect(() => {
    return subscribeDrafts((newMap) => {
      setDrafts(newMap);
    });
  }, []);

  return drafts;
}
