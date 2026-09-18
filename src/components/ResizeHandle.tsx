import React from 'react';

interface ResizeHandleProps {
  direction: 'left' | 'right';
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  isDragging?: boolean;
  className?: string;
  title?: string;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  direction,
  onPointerDown,
  onDoubleClick,
  isDragging = false,
  className = '',
  title = '拖动调节宽度，双击恢复默认',
}) => {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-col-resize group select-none transition-colors duration-150 touch-none ${
        direction === 'left'
          ? '-left-1.5 w-3 hover:bg-accent/10 active:bg-accent/20'
          : '-right-1.5 w-3 hover:bg-accent/10 active:bg-accent/20'
      } ${isDragging ? 'bg-accent/20' : ''} ${className}`}
    >
      {/* Visual Indicator Line */}
      <div
        className={`w-0.5 h-full transition-all duration-150 ${
          isDragging
            ? 'bg-accent w-1 shadow-sm'
            : 'bg-transparent group-hover:bg-accent/60 group-hover:w-0.5'
        }`}
      />

      {/* Tiny Centered Grip Pills on Hover */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-border group-hover:bg-accent transition-all duration-150 opacity-0 group-hover:opacity-100 ${
          isDragging ? 'opacity-100 bg-accent scale-110' : ''
        }`}
      />
    </div>
  );
};
