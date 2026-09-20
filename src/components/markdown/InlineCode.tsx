import React from 'react';

interface InlineCodeProps {
  children?: React.ReactNode;
  className?: string;
}

export const InlineCode: React.FC<InlineCodeProps> = ({ children, className = '' }) => {
  return (
    <code
      className={`font-mono text-[11.5px] px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-accent font-medium inline-block align-baseline mx-0.5 ${className}`}
    >
      {children}
    </code>
  );
};
