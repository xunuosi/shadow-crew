import React, { useState, useMemo } from 'react';
import { Check, Copy, ChevronDown, ChevronUp, Code2, Terminal, FileCode2 } from 'lucide-react';
import Prism from 'prismjs';

// Import syntax highlighting languages
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-diff';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

const COLLAPSE_LINE_THRESHOLD = 25;

export const CodeBlock: React.FC<CodeBlockProps> = React.memo(({
  code,
  language = '',
  showLineNumbers = true,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Normalize language string (e.g. "language-rust" -> "rust")
  const cleanLang = useMemo(() => {
    const raw = language.replace(/^language-/, '').toLowerCase().trim();
    if (!raw) return 'text';
    if (raw === 'ts') return 'typescript';
    if (raw === 'js') return 'javascript';
    if (raw === 'rs') return 'rust';
    if (raw === 'py') return 'python';
    if (raw === 'sh' || raw === 'shell' || raw === 'zsh') return 'bash';
    if (raw === 'yml') return 'yaml';
    return raw;
  }, [language]);

  const rawCode = useMemo(() => code.replace(/\n$/, ''), [code]);
  const lines = useMemo(() => rawCode.split('\n'), [rawCode]);
  const isLongCode = lines.length > COLLAPSE_LINE_THRESHOLD;

  // Handle Syntax Highlighting
  const highlightedHtml = useMemo(() => {
    try {
      const grammar = Prism.languages[cleanLang];
      if (grammar) {
        return Prism.highlight(rawCode, grammar, cleanLang);
      }
    } catch {
      // Fallback if grammar fails
    }
    // Plain text escaping fallback
    return rawCode
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }, [rawCode, cleanLang]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawCode);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawCode;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code', err);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Header Icon selector
  const HeaderIcon = useMemo(() => {
    if (['bash', 'sh', 'shell', 'zsh'].includes(cleanLang)) return Terminal;
    if (['diff', 'patch'].includes(cleanLang)) return FileCode2;
    return Code2;
  }, [cleanLang]);

  return (
    <div className="my-3 rounded-xl border border-border overflow-hidden bg-[var(--syntax-bg)] shadow-xs transition-colors">
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-border bg-surface-subtle/80 text-[11px] font-mono select-none">
        <div className="flex items-center gap-2">
          <HeaderIcon className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="font-bold text-fg tracking-wide uppercase">
            {cleanLang === 'text' ? 'CODE' : cleanLang}
          </span>
          <span className="text-fg-muted font-sans text-[10px]">
            {lines.length} {lines.length === 1 ? '行' : '行'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-sans">
          {/* Copy Button */}
          <button
            onClick={handleCopy}
            title="复制代码"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer font-medium ${
              copied
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                : 'text-fg-secondary hover:text-fg hover:bg-surface border border-transparent hover:border-border'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>已复制!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>复制</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Code Body with Line Numbers & Optional Folding */}
      <div className="relative">
        <div
          className={`overflow-x-auto p-3 text-[12px] font-mono leading-relaxed transition-all ${
            isLongCode && !isExpanded ? 'max-h-[360px] overflow-y-hidden' : ''
          }`}
        >
          <div className="flex">
            {/* Line Numbers Column */}
            {showLineNumbers && (
              <div className="select-none text-right pr-3 mr-3 border-r border-border/40 text-fg-muted/60 text-[11px] font-mono">
                {lines.map((_, idx) => (
                  <div key={idx} className="leading-relaxed">
                    {idx + 1}
                  </div>
                ))}
              </div>
            )}

            {/* Code Content */}
            <pre className="flex-1 font-mono m-0 p-0 overflow-x-auto bg-transparent select-text">
              <code
                className={`language-${cleanLang} bg-transparent p-0 block select-text`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        </div>

        {/* 3. Fade-out Gradient when Collapsed */}
        {isLongCode && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[var(--syntax-bg)] via-[var(--syntax-bg)]/80 to-transparent pointer-events-none" />
        )}
      </div>

      {/* 4. Expand / Collapse Footer Bar for Long Code */}
      {isLongCode && (
        <div className="border-t border-border/60 bg-surface-subtle/50 px-3 py-1.5 flex items-center justify-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium px-3 py-1 rounded-md hover:bg-surface transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>收起代码 ({lines.length} 行)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>展开全部代码 (共 {lines.length} 行)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
});
