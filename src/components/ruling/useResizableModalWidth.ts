import React, { useEffect, useState } from 'react';
import {
  clampRulingModalWidth,
  RULING_MODAL_DEFAULT_WIDTH,
  RULING_MODAL_WIDTH_STORAGE_KEY,
  RULING_MODAL_WIDESCREEN_WIDTH,
} from '../../services/cogno';

function readInitialModalWidth(): number {
  if (typeof window === 'undefined') return RULING_MODAL_DEFAULT_WIDTH;
  try {
    const saved = localStorage.getItem(RULING_MODAL_WIDTH_STORAGE_KEY);
    if (saved) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed)) {
        return clampRulingModalWidth(parsed, window.innerWidth);
      }
    }
  } catch {
    // 忽略存储读取异常并回退默认宽度
  }
  return clampRulingModalWidth(RULING_MODAL_DEFAULT_WIDTH, window.innerWidth);
}

function persistModalWidth(width: number): void {
  try {
    localStorage.setItem(RULING_MODAL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // 忽略隐私模式或配额导致的写入失败
  }
}

/**
 * 裁决书弹窗的水平拖拽缩放、宽屏切换及本地持久化宽度控制器。
 */
export function useResizableModalWidth() {
  const [modalWidth, setModalWidth] = useState<number>(readInitialModalWidth);
  const [isDraggingEdge, setIsDraggingEdge] = useState<'left' | 'right' | null>(
    null
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setModalWidth((prev) => clampRulingModalWidth(prev, window.innerWidth));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleStartDrag = (side: 'left' | 'right', e: React.PointerEvent) => {
    if (e.button !== 0 || typeof window === 'undefined') return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    setIsDraggingEdge(side);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const computeWidthFromClientX = (clientX: number) => {
      const windowCenter = window.innerWidth / 2;
      const calculated =
        side === 'right'
          ? (clientX - windowCenter) * 2
          : (windowCenter - clientX) * 2;
      return clampRulingModalWidth(calculated, window.innerWidth);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setModalWidth(computeWidthFromClientX(moveEvent.clientX));
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      setIsDraggingEdge(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      target.releasePointerCapture?.(upEvent.pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      const finalWidth = computeWidthFromClientX(upEvent.clientX);
      setModalWidth(finalWidth);
      persistModalWidth(finalWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const toggleWidescreen = () => {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
    setModalWidth((prev) => {
      const target =
        prev > 760 ? RULING_MODAL_DEFAULT_WIDTH : RULING_MODAL_WIDESCREEN_WIDTH;
      const next = clampRulingModalWidth(target, viewport);
      persistModalWidth(next);
      return next;
    });
  };

  const resetModalWidth = () => {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const next = clampRulingModalWidth(RULING_MODAL_DEFAULT_WIDTH, viewport);
    setModalWidth(next);
    persistModalWidth(next);
  };

  return {
    modalWidth,
    isDraggingEdge,
    handleStartDrag,
    toggleWidescreen,
    resetModalWidth,
  };
}
