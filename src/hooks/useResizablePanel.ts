import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface UseResizableOptions {
  direction: 'left' | 'right'; // 'left': dragging left increases width (for right-side drawers); 'right': dragging right increases width (for left-side sidebars)
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number | (() => number);
  storageKey?: string;
  panelRef?: React.RefObject<HTMLElement | null>;
}

export interface UseResizableReturn {
  width: number;
  isDragging: boolean;
  handlePointerDown: (e: React.PointerEvent) => void;
  resetWidth: () => void;
  setWidth: (width: number) => void;
  panelRef: React.RefObject<HTMLElement | null>;
}

export function useResizablePanel({
  direction,
  defaultWidth,
  minWidth = 240,
  maxWidth = 800,
  storageKey,
  panelRef: externalPanelRef,
}: UseResizableOptions): UseResizableReturn {
  const getMaxWidth = useCallback(() => {
    if (typeof maxWidth === 'function') {
      return maxWidth();
    }
    return maxWidth;
  }, [maxWidth]);

  // 1. Initialize width with localStorage cache or default, clamped to valid range
  const [width, setWidthState] = useState<number>(() => {
    const max = typeof maxWidth === 'function' ? maxWidth() : maxWidth;
    if (typeof window === 'undefined') return Math.min(max, Math.max(minWidth, defaultWidth));
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = Number(saved);
          if (!isNaN(parsed) && parsed > 50) {
            return Math.min(max, Math.max(minWidth, parsed));
          }
        }
      } catch {
        // Ignore localStorage error
      }
    }
    return Math.min(max, Math.max(minWidth, defaultWidth));
  });

  const internalPanelRef = useRef<HTMLElement | null>(null);
  const panelRef = externalPanelRef || internalPanelRef;

  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const currentWidthRef = useRef(width);
  const rafIdRef = useRef<number | null>(null);

  // Keep currentWidthRef in sync
  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  // Synchronize with bounds when window resizes
  useEffect(() => {
    const handleWindowResize = () => {
      if (isDragging) return;
      const max = getMaxWidth();
      if (currentWidthRef.current > max) {
        currentWidthRef.current = max;
        setWidthState(max);
        if (panelRef.current) {
          panelRef.current.style.width = `${max}px`;
        }
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [getMaxWidth, isDragging, panelRef]);

  // Synchronize with bounds if window resizes or default changes
  const setWidth = useCallback(
    (newWidth: number) => {
      const max = getMaxWidth();
      const clamped = Math.min(max, Math.max(minWidth, newWidth));
      currentWidthRef.current = clamped;
      setWidthState(clamped);

      if (panelRef.current) {
        panelRef.current.style.width = `${clamped}px`;
      }

      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(clamped));
        } catch {
          // Ignore
        }
      }
    },
    [minWidth, getMaxWidth, storageKey, panelRef]
  );

  // Smooth reset with dedicated temporary transition (150ms)
  const resetWidth = useCallback(() => {
    const el = panelRef.current;
    if (el) {
      el.style.transition = 'width 150ms cubic-bezier(0.4, 0, 0.2, 1)';
      el.style.width = `${defaultWidth}px`;
      setTimeout(() => {
        if (el) {
          el.style.transition = '';
        }
      }, 160);
    }
    setWidth(defaultWidth);
  }, [defaultWidth, setWidth, panelRef]);

  // Pointer event handlers with hardware-accelerated direct DOM tracking & rAF
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only respond to main mouse button
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

      // 1. Instantly suppress any transitions on the panel element
      const el = panelRef.current;
      if (el) {
        el.style.transition = 'none';
        el.setAttribute('data-resizing', 'true');
      }

      startXRef.current = e.clientX;
      const initialWidth = el ? el.getBoundingClientRect().width : currentWidthRef.current;
      startWidthRef.current = initialWidth;
      currentWidthRef.current = initialWidth;
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
        currentWidthRef.current = clamped;

        // 2. Direct DOM manipulation and React state sync in animation frame
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            const targetEl = panelRef.current;
            if (targetEl) {
              targetEl.style.width = `${currentWidthRef.current}px`;
            }
            setWidthState(currentWidthRef.current);
          });
        }
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

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

        target.removeEventListener('pointermove', handlePointerMove);
        target.removeEventListener('pointerup', handlePointerUp);
        target.removeEventListener('pointercancel', handlePointerUp);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);

        // 3. Finalize width calculation
        const deltaX = upEvent.clientX - startXRef.current;
        const max = getMaxWidth();
        let finalWidth: number;
        if (direction === 'left') {
          finalWidth = startWidthRef.current - deltaX;
        } else {
          finalWidth = startWidthRef.current + deltaX;
        }
        const clamped = Math.min(max, Math.max(minWidth, Math.round(finalWidth)));

        const finalEl = panelRef.current;
        if (finalEl) {
          finalEl.style.width = `${clamped}px`;
          finalEl.style.transition = '';
          finalEl.removeAttribute('data-resizing');
        }

        // Commit final state to React and localStorage
        setWidthState(clamped);
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(clamped));
          } catch {
            // Ignore
          }
        }
      };

      target.addEventListener('pointermove', handlePointerMove);
      target.addEventListener('pointerup', handlePointerUp);
      target.addEventListener('pointercancel', handlePointerUp);
      window.addEventListener('pointermove', handlePointerMove, { passive: true });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [direction, minWidth, getMaxWidth, storageKey, panelRef]
  );

  // Clean up global cursor and pending rAF if unmounted while dragging
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
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
    panelRef,
  };
}
