import React from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import CodeBlock from '@/components/shared/CodeBlock';
import remarkCallouts, { type CalloutType } from '@/lib/remark-callouts';

const CALLOUT_ICONS: Record<CalloutType, React.ComponentType<{ className?: string }>> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

/**
 * Markdown renderer for flow prose and application READMEs.
 * Fenced code blocks are highlighted with Prism, and GitHub-style
 * `> [!NOTE]` blockquotes are rendered as callouts.
 */
export function Markdown({ children, className }: { children?: any; className?: string }) {
  return (
    <div className={cn('markdown-body', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        components={{
          // Fenced code blocks arrive as <pre><code class="language-x">…</code></pre>.
          // Replace the whole <pre> with the highlighted CodeBlock; inline
          // code keeps the default <code> rendering.
          pre({ children: preChildren }) {
            const codeElement = React.Children.toArray(preChildren)[0];
            if (codeElement && (codeElement as any).props) {
              const match = /language-(\w+)/.exec((codeElement as any).props.className || '');
              const content = String((codeElement as any).props.children ?? '').replace(/\n$/, '');
              return (
                <CodeBlock code={content} language={match ? match[1] : undefined} className="my-2" />
              );
            }
            return <pre>{preChildren}</pre>;
          },
          // A link to another help article (`/help/<id>`) stays inside the app,
          // through the router; every other link opens in a new tab.
          a({ children: linkChildren, node: _node, href, ...props }) {
            if (href && href.startsWith('/help/')) {
              return (
                <Link to={href} {...props}>
                  {linkChildren}
                </Link>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {linkChildren}
              </a>
            );
          },
          // A screenshot of the tool (`/help-images/<name>.webp`) follows the
          // theme: the light capture in light mode, the dark one in dark mode.
          // The files live in public/help-images, one pair per name.
          img({ node: _node, src, alt, ...props }) {
            const shot = /^\/help-images\/([\w-]+)\.webp$/.exec(String(src || ''));
            if (!shot) return <img src={src} alt={alt} {...props} />;
            const base = `/help-images/${shot[1]}`;
            return (
              <span className="help-shot">
                <img src={`${base}-light.webp`} alt={alt} loading="lazy" className="dark:hidden" />
                <img src={`${base}-dark.webp`} alt={alt} loading="lazy" className="hidden dark:block" />
              </span>
            );
          },
          // remark-callouts turns `> [!NOTE]` blockquotes into divs carrying
          // the callout type; every other div renders as-is.
          div({ children: divChildren, node: _node, ...props }) {
            const type = (props as any)['data-callout'] as CalloutType | undefined;
            if (!type || !CALLOUT_ICONS[type]) return <div {...props}>{divChildren}</div>;

            const Icon = CALLOUT_ICONS[type];
            const title = (props as any)['data-callout-title'] as string;
            return (
              <div {...props} className={cn('markdown-callout', (props as any).className)}>
                <p className="markdown-callout-title">
                  <Icon className="markdown-callout-icon" />
                  {title}
                </p>
                {divChildren}
              </div>
            );
          },
        }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
