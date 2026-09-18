import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface UseResizableOptions {
  direction: 'left' | 'right'; // 'left': dragging left increases width (for right-side drawers); 'right': dragging right increases width (for left-side sidebars)
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number | (() => number);
  storageKey?: string;
}

export interface UseResizableReturn {
  width: number;
  isDragging: boolean;
  handlePointerDown: (e: React.PointerEvent) => void;
  resetWidth: () => void;
  setWidth: (width: number) => void;
}

export function useResizablePanel({
  direction,
  defaultWidth,
  minWidth = 240,
  maxWidth = 800,
  storageKey,
}: UseResizableOptions): UseResizableReturn {
  // 1. Initialize width with localStorage cache or default
  const [width, setWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = Number(saved);
          if (!isNaN(parsed) && parsed > 50) {
            return parsed;
          }
        }
      } catch {
        // Ignore localStorage error
      }
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const getMaxWidth = useCallback(() => {
    if (typeof maxWidth === 'function') {
      return maxWidth();
    }
    return maxWidth;
  }, [maxWidth]);

  // Synchronize with bounds if window resizes or default changes
  const setWidth = useCallback(
    (newWidth: number) => {
      const max = getMaxWidth();
      const clamped = Math.min(max, Math.max(minWidth, newWidth));
      setWidthState(clamped);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(clamped));
        } catch {
          // Ignore
        }
      }
    },
    [minWidth, getMaxWidth, storageKey]
  );

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth, setWidth]);

  // Pointer event handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only respond to main button
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget as HTMLElement;
      if (target.setPointerCapture) {
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if fails
        }
      }

      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current;
        const max = getMaxWidth();

        let newWidth: number;
        if (direction === 'left') {
          // For right-side drawers, moving left increases width
          newWidth = startWidthRef.current - deltaX;
        } else {
          // For left-side sidebar, moving right increases width
          newWidth = startWidthRef.current + deltaX;
        }

        const clamped = Math.min(max, Math.max(minWidth, Math.round(newWidth)));
        setWidthState(clamped);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        setIsDragging(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        if (target.releasePointerCapture) {
          try {
            target.releasePointerCapture(upEvent.pointerId);
          } catch {
            // Ignore
          }
        }

        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);

        // Save to localStorage on drag completion
        const deltaX = upEvent.clientX - startXRef.current;
        const max = getMaxWidth();
        let finalWidth: number;
        if (direction === 'left') {
          finalWidth = startWidthRef.current - deltaX;
        } else {
          finalWidth = startWidthRef.current + deltaX;
        }
        const clamped = Math.min(max, Math.max(minWidth, Math.round(finalWidth)));
        setWidthState(clamped);
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(clamped));
          } catch {
            // Ignore
          }
        }
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [direction, width, minWidth, getMaxWidth, storageKey]
  );

  // Clean up global cursor if unmounted while dragging
  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  return {
    width,
    isDragging,
    handlePointerDown,
    resetWidth,
    setWidth,
  };
}
