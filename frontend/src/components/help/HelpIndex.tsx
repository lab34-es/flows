import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, LifeBuoy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { iconFor } from '@/components/help/icons';
import { HELP_GROUPS } from '@/components/help/helpNavigation';

const REPOSITORY = 'https://github.com/lab34-es/flows';
const DOCS = 'https://flows.lab34.es/docs/';

/**
 * The landing page of the Help section: every article the tool ships with,
 * grouped by category. The same list the sidebar carries, given room to show
 * what each article is about.
 */
export function HelpIndex() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <LifeBuoy className="size-5" /> Help
        </h1>
        <p className="text-muted-foreground text-sm">
          How flows are written, run and integrated — everything in one place. Search it from
          the sidebar, or pick a topic below.
        </p>
      </div>

      {HELP_GROUPS.map((group) => (
        <section key={group.id} className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {group.label}
          </h2>

          <div className="grid gap-2 sm:grid-cols-2">
            {group.topics.map((topic) => {
              const Icon = iconFor(topic.icon);
              return (
                <Card key={topic.id} className="gap-0 overflow-hidden py-0">
                  <Link
                    to={`/help/${topic.id}`}
                    className="hover:bg-accent/50 flex h-full items-start gap-3 p-4 transition"
                  >
                    <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{topic.title}</span>
                      <span className="text-muted-foreground block text-sm">{topic.summary}</span>
                    </span>
                  </Link>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      {/* ------------------------------- Footer ----------------------------- */}
      <Card className="flex-row flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium">Still stuck?</p>
          <p className="text-muted-foreground text-sm">
            These articles are also online, and issues are read.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={DOCS} target="_blank" rel="noreferrer">
              <ExternalLink /> Documentation
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">
              <ExternalLink /> Report an issue
            </a>
          </Button>
          <Badge variant="secondary">lab34-flows</Badge>
        </div>
      </Card>
    </div>
  );
}

export default HelpIndex;
