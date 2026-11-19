import React, { useEffect, useLayoutEffect, useRef } from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface AutoGrowTextareaProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeightPx?: number;
  maxHeightPx?: number;
  resetKey?: string;
  containerWidth?: number;
  className?: string;
  ariaDescribedBy?: string;
}

function supportsNativeFieldSizing(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content')
  );
}

/**
 * 自适应内容高度的多行文本框：
 * 优先使用现代 CSS `field-sizing: content`，在不支持的运行时自动回退至同步测量高度，
 * 同时保留右下角纵向拖拽调整 (`resize-y`) 能力。
 */
export const AutoGrowTextarea: React.FC<AutoGrowTextareaProps> = ({
  id,
  value,
  onChange,
  placeholder,
  minHeightPx = 96,
  maxHeightPx = 320,
  resetKey,
  containerWidth,
  className = '',
  ariaDescribedBy,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const manualResizedRef = useRef(false);
  const lastAutoHeightRef = useRef<number | null>(null);
  const prevResetKeyRef = useRef<string | undefined>(resetKey);

  useIsomorphicLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      manualResizedRef.current = false;
      lastAutoHeightRef.current = null;
      el.style.height = '';
    }

    if (supportsNativeFieldSizing()) {
      return;
    }

    if (manualResizedRef.current) {
      return;
    }

    el.style.height = 'auto';
    const measured = Math.min(maxHeightPx, Math.max(minHeightPx, el.scrollHeight));
    el.style.height = `${measured}px`;
    lastAutoHeightRef.current = measured;
  }, [value, containerWidth, resetKey, minHeightPx, maxHeightPx]);

  const handlePointerUp = () => {
    const el = textareaRef.current;
    if (!el) return;
    if (
      lastAutoHeightRef.current !== null &&
      Math.abs(el.offsetHeight - lastAutoHeightRef.current) > 4
    ) {
      manualResizedRef.current = true;
    }
  };

  return (
    <textarea
      ref={textareaRef}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerUp={handlePointerUp}
      placeholder={placeholder}
      aria-describedby={ariaDescribedBy}
      style={{
        minHeight: `${minHeightPx}px`,
        maxHeight: `${maxHeightPx}px`,
      }}
      className={`auto-grow-textarea w-full px-3.5 py-2.5 rounded-xl bg-surface border border-border hover:border-border-hover focus:border-accent focus:ring-2 focus:ring-accent/15 text-fg text-[13px] leading-relaxed focus:outline-none transition-colors placeholder:text-fg-muted resize-y overflow-y-auto ${className}`}
    />
  );
};
