import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ChevronRight, History } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import CodeBlock from '@/components/shared/CodeBlock';
import Markdown from '@/components/shared/Markdown';
import ExecutionOutput from '@/components/flow/ExecutionOutput';
import { testRunsApi } from '@/services/api';
import { runLabel, testRunUrl } from '@/lib/testRuns';
import { cn } from '@/lib/utils';

const STATUS_BADGES = {
  passed: { label: 'Passed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

const STATUS_BORDERS = {
  passed: 'border-l-success',
  failed: 'border-l-destructive',
  error: 'border-l-destructive',
  skipped: 'border-l-muted-foreground/40',
};

/**
 * One flow of a test run, read back from the stored copy: the document as it
 * was executed, with each step's recorded result rendered under its block —
 * the same output cell the live run showed, minus the liveness.
 */
export function TestRunFlowPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const file = searchParams.get('path') || '';

  const [flow, setFlow] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    setError(null);

    testRunsApi.getFlow(id, file)
      .then((response) => !cancelled && setFlow(response.data))
      .catch((ex) => !cancelled && setError(ex.response?.data?.error || ex.message));

    return () => { cancelled = true; };
  }, [id, file]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not open this stored flow</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const badge = flow.testRun && STATUS_BADGES[flow.testRun.status];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="bg-background/95 sticky top-0 z-10 border-b px-6 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl">
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <Link to="/test-runs" className="hover:text-foreground inline-flex items-center gap-1">
              <History className="size-3.5" /> Test runs
            </Link>
            <ChevronRight className="size-3" />
            <Link to={testRunUrl(id)} className="hover:text-foreground font-mono">
              {flow.testRun?.startedAt ? runLabel({ times: { start: Date.parse(flow.testRun.startedAt) } }) : id}
            </Link>
            <ChevronRight className="size-3" />
            <span className="font-mono">{flow.file}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-bold tracking-tight">{flow.title}</h1>
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            {flow.testRun?.environment && (
              <Badge variant="outline" className="font-mono">{flow.testRun.environment}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* The document, with the stored output under each step */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-4xl space-y-1 px-6 py-6">
          {flow.testRun?.error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertTitle>This run failed</AlertTitle>
              <AlertDescription>{flow.testRun.error}</AlertDescription>
            </Alert>
          )}

          {flow.segments.map((segment, index) => {
            if (segment.type !== 'step') {
              return <Markdown key={index}>{segment.content}</Markdown>;
            }

            const step = (flow.steps || []).find(
              (candidate) => candidate && candidate.stepIndex === segment.stepIndex
            );
            const result = flow.results?.[segment.stepIndex];
            const status = result?.execution?.status;

            return (
              <div
                key={index}
                data-role="step-cell"
                className={cn(
                  'my-4 overflow-hidden rounded-lg border border-l-4 bg-card shadow-sm',
                  STATUS_BORDERS[status] || 'border-l-border'
                )}
              >
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
                  <span className="text-muted-foreground font-mono text-xs">
                    step {segment.stepIndex + 1}
                  </span>
                  {step?.application && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {step.application}{step.method ? ` · ${step.method}` : ''}
                    </Badge>
                  )}
                  {segment.error && (
                    <span className="text-destructive text-xs">{segment.error}</span>
                  )}
                  {step?.enabled === false && (
                    <span className="text-muted-foreground ml-auto text-[10px] uppercase tracking-wide">
                      disabled
                    </span>
                  )}
                </div>

                <CodeBlock code={segment.content} language="yaml" className="rounded-none border-0" />

                <ExecutionOutput stepData={result} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TestRunFlowPage;
