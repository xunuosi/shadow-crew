export type TauriEventPayload<T> = {
  event: string;
  id: number;
  payload: T;
};

/**
 * 订阅 Tauri v2 事件。
 * 优先使用 withGlobalTauri 暴露的 event API；未开启全局注入时，
 * 通过 __TAURI_INTERNALS__ 的 callback + plugin:event 协议注册。
 */
export async function listenTauriEvent<T>(
  eventName: string,
  handler: (event: TauriEventPayload<T>) => void
): Promise<() => void> {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const tauriWindow = window as any;
  const globalListen = tauriWindow.__TAURI__?.event?.listen;
  if (typeof globalListen === 'function') {
    return globalListen(eventName, handler);
  }

  const internals = tauriWindow.__TAURI_INTERNALS__;
  if (
    !internals?.invoke ||
    typeof internals.transformCallback !== 'function'
  ) {
    return () => undefined;
  }

  const handlerId = internals.transformCallback(handler);
  try {
    const eventId = await internals.invoke('plugin:event|listen', {
      event: eventName,
      target: { kind: 'Any' },
      handler: handlerId,
    });
    return () => {
      const eventPluginInternals = tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__;
      if (typeof eventPluginInternals?.unregisterListener === 'function') {
        eventPluginInternals.unregisterListener(eventName, eventId);
      } else if (typeof internals.unregisterCallback === 'function') {
        internals.unregisterCallback(handlerId);
      }
      void internals.invoke('plugin:event|unlisten', {
        event: eventName,
        eventId,
      });
    };
  } catch (err) {
    if (typeof internals.unregisterCallback === 'function') {
      internals.unregisterCallback(handlerId);
    }
    throw err;
  }
}
