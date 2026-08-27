import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Markdown from '@/components/shared/Markdown';
import { iconFor } from '@/components/help/icons';
import { categoryLabelOf, findTopic, neighboursOf } from '@/components/help/helpNavigation';

/**
 * One help article, addressed by the file name of its Markdown source:
 * `/help/quick-start` is `components/help/topics/quick-start.md`.
 */
export function HelpArticle() {
  const { topicId } = useParams();
  const topic = findTopic(topicId);

  if (!topic) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-medium">There is no article called “{topicId}”</p>
        <p className="text-muted-foreground mt-1 text-sm">
          It may have been renamed.{' '}
          <Link to="/help" className="text-info underline underline-offset-4">
            Browse every topic
          </Link>
          .
        </p>
      </Card>
    );
  }

  const { previous, next } = neighboursOf(topic.id);
  // createElement rather than `const Icon = …`: the icon is picked per article,
  // and a component built inside a render body is what the lint rule forbids.
  const icon = React.createElement(iconFor(topic.icon), { className: 'size-3.5' });

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          {icon} {categoryLabelOf(topic)}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{topic.title}</h1>
        <p className="text-muted-foreground text-sm">{topic.summary}</p>
      </header>

      <Markdown>{topic.body}</Markdown>

      {/* --------------------------- Prev / next --------------------------- */}
      {(previous || next) && (
        <nav aria-label="More articles" className="flex flex-wrap justify-between gap-2 border-t pt-4">
          {previous ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/help/${previous.id}`}>
                <ArrowLeft /> {previous.title}
              </Link>
            </Button>
          ) : <span />}
          {next && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/help/${next.id}`}>
                {next.title} <ArrowRight />
              </Link>
            </Button>
          )}
        </nav>
      )}
    </article>
  );
}

export default HelpArticle;
