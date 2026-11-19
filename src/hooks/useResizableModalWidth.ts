import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

export interface UseResizableModalWidthOptions {
  storageKey: string;
  defaultWidth?: number;
  widescreenWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface UseResizableModalWidthResult {
  modalWidth: number;
  isWidescreen: boolean;
  isDragging: boolean;
  handleResizeStart: (edge: 'left' | 'right', e: React.PointerEvent) => void;
  toggleWidescreen: () => void;
  setModalWidth: React.Dispatch<React.SetStateAction<number>>;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  const viewportCap =
    typeof window !== 'undefined' && window.innerWidth > 320
      ? window.innerWidth - 24
      : maxWidth;
  const effectiveMax = Math.max(minWidth, Math.min(maxWidth, viewportCap));
  return Math.max(minWidth, Math.min(effectiveMax, Math.round(width)));
}

function loadInitialWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number
): number {
  if (typeof window === 'undefined') {
    return defaultWidth;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return clampWidth(parsed, minWidth, maxWidth);
      }
    }
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return clampWidth(defaultWidth, minWidth, maxWidth);
}

/**
 * Shared horizontal resize hook for centered `<dialog>` modals (left/right edge drag + widescreen preset).
 */
export function useResizableModalWidth(
  options: UseResizableModalWidthOptions
): UseResizableModalWidthResult {
  const {
    storageKey,
    defaultWidth = 880,
    widescreenWidth = 1120,
    minWidth = 640,
    maxWidth = 1280,
  } = options;

  const [modalWidth, setModalWidth] = useState<number>(() =>
    loadInitialWidth(storageKey, defaultWidth, minWidth, maxWidth)
  );
  const [isDragging, setIsDragging] = useState(false);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(storageKey, String(nextWidth));
      } catch {
        // Ignore storage write errors
      }
    },
    [storageKey]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleWindowResize = () => {
      setModalWidth((prev) => clampWidth(prev, minWidth, maxWidth));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [maxWidth, minWidth]);

  const handleResizeStart = useCallback(
    (edge: 'left' | 'right', e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = modalWidth;
      let latestWidth = startWidth;
      setIsDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        // Modal is horizontally centered, so moving one edge changes total width by 2 * delta
        const signedDelta = edge === 'right' ? deltaX * 2 : -deltaX * 2;
        latestWidth = clampWidth(startWidth + signedDelta, minWidth, maxWidth);
        setModalWidth(latestWidth);
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        persistWidth(latestWidth);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [maxWidth, minWidth, modalWidth, persistWidth]
  );

  const widescreenThreshold = Math.round((defaultWidth + widescreenWidth) / 2);
  const isWidescreen = modalWidth >= widescreenThreshold;

  const toggleWidescreen = useCallback(() => {
    setModalWidth((prev) => {
      const target = prev >= widescreenThreshold ? defaultWidth : widescreenWidth;
      const next = clampWidth(target, minWidth, maxWidth);
      persistWidth(next);
      return next;
    });
  }, [defaultWidth, maxWidth, minWidth, persistWidth, widescreenThreshold, widescreenWidth]);

  return {
    modalWidth,
    isWidescreen,
    isDragging,
    handleResizeStart,
    toggleWidescreen,
    setModalWidth,
  };
}
