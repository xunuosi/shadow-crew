import React from 'react';

/**
 * 将文本中的 @handle (如 @shinobi-core, @openclaw-mantis, @all) 渲染为高亮徽章
 */
export function renderFormattedContent(content: string): React.ReactNode {
  if (!content) return null;

  // 按 @mention 模式拆分
  const parts = content.split(/(@[a-zA-Z0-9_-]+)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('@') && part.length > 1) {
          const isAll = part.toLowerCase() === '@all';
          return (
            <span
              key={index}
              className={`font-semibold px-1.5 py-0.5 rounded font-mono text-[11px] inline-flex items-center gap-0.5 mx-0.5 border transition-all ${
                isAll
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  : 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
              }`}
            >
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
