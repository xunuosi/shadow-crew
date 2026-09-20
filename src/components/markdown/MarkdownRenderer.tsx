import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { InlineCode } from './InlineCode';
import { GitHubAlert, AlertType } from './GitHubAlert';
import { renderFormattedContent } from '../../utils/formatMentions';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * 递归处理文本中的 @mentions，将纯文本中的 @handle 转为高亮徽章，同时保留已有 React 节点
 */
function renderWithMentions(children: React.ReactNode): React.ReactNode {
  if (!children) return children;

  if (typeof children === 'string') {
    return renderFormattedContent(children);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <React.Fragment key={index}>{renderWithMentions(child)}</React.Fragment>
    ));
  }

  return children;
}

/**
 * 提取 Blockquote 文本内容以检测 GitHub Alert 标签 (如 [!NOTE], [!WARNING])
 */
function extractAlert(children: React.ReactNode): { isAlert: boolean; type?: AlertType; content?: React.ReactNode } {
  if (!children) return { isAlert: false };

  // 深度提取首个非空白字符串节点
  let firstString = '';
  const findFirstStr = (node: React.ReactNode): boolean => {
    if (typeof node === 'string') {
      if (node.trim().length > 0) {
        firstString = node.trim();
        return true;
      }
      return false;
    }
    if (React.isValidElement(node) && node.props && (node.props as { children?: React.ReactNode }).children) {
      return findFirstStr((node.props as { children?: React.ReactNode }).children);
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        if (findFirstStr(item)) return true;
      }
    }
    return false;
  };

  findFirstStr(children);

  const alertMatch = firstString.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  if (!alertMatch) {
    return { isAlert: false };
  }

  const alertType = alertMatch[1].toUpperCase() as AlertType;

  // 剥离首个非空字符串中的 [!TYPE]
  let hasStripped = false;
  const stripAlertHeader = (node: React.ReactNode): React.ReactNode => {
    if (hasStripped) return node;

    if (typeof node === 'string') {
      if (node.trim().length > 0) {
        hasStripped = true;
        return node.replace(/^(\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '$1');
      }
      return node;
    }
    if (React.isValidElement(node) && node.props && (node.props as { children?: React.ReactNode }).children) {
      return React.cloneElement(node as React.ReactElement<{ children?: React.ReactNode }>, {
        children: stripAlertHeader((node.props as { children?: React.ReactNode }).children),
      });
    }
    if (Array.isArray(node)) {
      return node.map((child) => stripAlertHeader(child));
    }
    return node;
  };

  return {
    isAlert: true,
    type: alertType,
    content: stripAlertHeader(children),
  };
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // 流式自愈保护：如果输出流中存在未闭合的 ``` 代码栅栏，自动在渲染时补齐
  const healedContent = useMemo(() => {
    if (!content) return '';
    const fences = content.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      return content + '\n```';
    }
    return content;
  }, [content]);

  return (
    <div className={`markdown-body text-xs text-fg leading-relaxed break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 1. 代码块与单行代码
          pre: ({ children }) => <>{children}</>,
          code: (props) => {
            const { children, className = '' } = props;
            const strContent = String(children || '');
            const hasLang = /language-(\w+)/.test(className);
            const isMultiLine = strContent.includes('\n');

            if (hasLang || isMultiLine) {
              return (
                <CodeBlock
                  code={strContent}
                  language={className}
                  showLineNumbers={true}
                />
              );
            }

            return <InlineCode className={className}>{children}</InlineCode>;
          },

          // 2. 段落与提及 Badge 注入
          p: ({ children }) => (
            <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed text-xs">
              {renderWithMentions(children)}
            </p>
          ),

          // 3. 引用块与 GitHub Alerts (例如 > [!NOTE])
          blockquote: ({ children }) => {
            const alertInfo = extractAlert(children);
            if (alertInfo.isAlert && alertInfo.type) {
              return <GitHubAlert type={alertInfo.type}>{alertInfo.content}</GitHubAlert>;
            }
            return (
              <blockquote className="border-l-2 border-accent/60 pl-3 py-1 my-2 bg-surface-subtle/50 text-fg-secondary italic text-xs rounded-r-md">
                {renderWithMentions(children)}
              </blockquote>
            );
          },

          // 4. 标题规范化
          h1: ({ children }) => (
            <h1 className="text-sm md:text-base font-bold text-fg mt-3.5 mb-2 first:mt-0 pb-1 border-b border-border/50">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xs md:text-sm font-bold text-fg mt-3 mb-1.5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold text-fg mt-2.5 mb-1 first:mt-0">
              {children}
            </h3>
          ),

          // 5. 列表与清单
          ul: ({ children }) => (
            <ul className="list-disc pl-4 space-y-1 my-2 text-xs text-fg marker:text-accent">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 space-y-1 my-2 text-xs text-fg marker:text-accent font-medium">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {renderWithMentions(children)}
            </li>
          ),

          // 6. 表格 (支持横向滑动与卡片化样式)
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-xl border border-border bg-surface shadow-xs">
              <table className="min-w-full divide-y divide-border text-xs text-left">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-subtle text-fg font-semibold select-none">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/40 bg-surface">
              {children}
            </tbody>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2 text-fg font-semibold text-xs border-b border-border">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 text-fg-secondary text-xs">
              {children}
            </td>
          ),

          // 7. 外链优化
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-medium inline-flex items-center gap-0.5"
            >
              {children}
            </a>
          ),

          // 8. 分割线
          hr: () => <hr className="my-3 border-border/70" />,
        }}
      >
        {healedContent}
      </ReactMarkdown>
    </div>
  );
};
