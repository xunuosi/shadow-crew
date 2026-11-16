import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AcpSessionUsage } from '../types';
import {
  parseAcpConfigOptions,
  parseSessionKey,
  setAcpConfigOption,
  type AcpConfigOption,
} from '../services/acpClient';
import { listenTauriEvent } from '../services/tauriEventClient';

interface SessionConfigOptionsEntry {
  sessionKey: string;
  options: AcpConfigOption[];
}

/**
 * ACP 会话级遥测：订阅 `acp:usage` 与 `acp:config_options`，
 * 按 `${roomId}::${agentId}` 归集真实上报的上下文用量与会话配置项。
 *
 * 仅呈现运行时真实上报的数据：未上报即不出现，空数组代表运行期显式声明无可配置项。
 */
export function useAcpSessionTelemetry(activeRoomId: string | null | undefined) {
  const [usageByRoomAgent, setUsageByRoomAgent] = useState<Record<string, AcpSessionUsage>>({});
  const [configOptionsByRoomAgent, setConfigOptionsByRoomAgent] = useState<
    Record<string, SessionConfigOptionsEntry>
  >({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tauriListen = listenTauriEvent;
    let disposed = false;
    let unlistenUsage: (() => void) | undefined;
    let unlistenConfigOptions: (() => void) | undefined;

    tauriListen<any>('acp:usage', (event) => {
      const payload = event?.payload;
      if (!payload || !payload.agent_id) return;
      if (typeof payload.session_key !== 'string') return;
      const parsed = parseSessionKey(payload.session_key);
      const roomId = parsed.roomId;
      if (!roomId) return;
      const used = Number(payload.used);
      const size = Number(payload.size);
      if (!Number.isFinite(used) || !Number.isFinite(size) || size <= 0) return;
      const rawCost = payload.cost;
      const cost =
        rawCost && typeof rawCost === 'object' && Number.isFinite(Number(rawCost.amount))
          ? { amount: Number(rawCost.amount), currency: String(rawCost.currency || '') }
          : null;
      const key = `${roomId}::${payload.agent_id}`;
      setUsageByRoomAgent((prev) => ({
        ...prev,
        [key]: { used, size, cost, updatedAt: Date.now() },
      }));
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenUsage = fn;
      })
      .catch(() => {});

    tauriListen<any>('acp:config_options', (event) => {
      const payload = event?.payload;
      if (!payload || !payload.agent_id) return;
      if (typeof payload.session_key !== 'string') return;
      const parsed = parseSessionKey(payload.session_key);
      const roomId = parsed.roomId;
      if (!roomId) return;
      // 运行时上报空数组同样覆盖：代表当前会话没有可配置项，必须撤下旧选择器。
      const options = parseAcpConfigOptions(payload.configOptions);
      const key = `${roomId}::${payload.agent_id}`;
      setConfigOptionsByRoomAgent((prev) => ({
        ...prev,
        [key]: { sessionKey: payload.session_key, options },
      }));
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenConfigOptions = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlistenUsage) unlistenUsage();
      if (unlistenConfigOptions) unlistenConfigOptions();
    };
  }, []);

  const sessionUsageByAgent = useMemo(() => {
    if (!activeRoomId) return {};
    const prefix = `${activeRoomId}::`;
    const result: Record<string, AcpSessionUsage> = {};
    for (const [key, value] of Object.entries(usageByRoomAgent)) {
      if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
    }
    return result;
  }, [usageByRoomAgent, activeRoomId]);

  const configOptionsByAgent = useMemo(() => {
    if (!activeRoomId) return {};
    const prefix = `${activeRoomId}::`;
    const result: Record<string, AcpConfigOption[]> = {};
    for (const [key, value] of Object.entries(configOptionsByRoomAgent)) {
      if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value.options;
    }
    return result;
  }, [configOptionsByRoomAgent, activeRoomId]);

  /**
   * 下发会话级配置项（当前用于模型选择）。
   * 仅当运行时真实上报过该 Agent 的 configOptions 时才允许下发；失败显式抛出，绝不静默吞掉。
   */
  const selectAcpConfigOption = useCallback(
    async (agentId: string, configId: string, value: string): Promise<void> => {
      if (!activeRoomId) throw new Error('当前没有活跃会话，无法切换配置项');
      const key = `${activeRoomId}::${agentId}`;
      const entry = configOptionsByRoomAgent[key];
      if (!entry) throw new Error('运行时尚未上报该 Agent 的会话配置项');
      const updated = await setAcpConfigOption({
        agentId,
        sessionKey: entry.sessionKey,
        configId,
        value,
      });
      setConfigOptionsByRoomAgent((prev) => ({
        ...prev,
        [key]: { ...entry, options: updated },
      }));
    },
    [activeRoomId, configOptionsByRoomAgent]
  );

  return { sessionUsageByAgent, configOptionsByAgent, selectAcpConfigOption };
}
