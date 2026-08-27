import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  CloudAlert,
  CloudUpload,
  FileChartColumn,
  History,
  Loader2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusDot from '@/components/shared/StatusDot';
import { socket } from '@/services/socket';
import { testRunsApi } from '@/services/api';
import { dotStatus, formatDuration, runLabel, runScore, testRunFlowUrl, testRunReportUrl, triggerLabel } from '@/lib/testRuns';
import { useTabTitle } from '@/workspace/RoutePanel';

const STATUS_BADGES = {
  running: { label: 'Running…', variant: 'info' },
  passed: { label: 'Passed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

/**
 * Where the report of this run went, when an integration was configured to
 * take it somewhere. A successful upload is a link to the uploaded file; a
 * failed one says why, because the run itself says nothing about it.
 */
function UploadBadge({ upload }) {
  if (!upload) { return null; }

  if (upload.status === 'uploading') {
    return (
      <Badge variant="info" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> Uploading the report…
      </Badge>
    );
  }

  if (upload.status === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1" title={upload.error || ''}>
        <CloudAlert className="size-3" /> Report upload failed
      </Badge>
    );
  }

  const badge = (
    <Badge variant="success" className="gap-1" title={upload.path || ''}>
      <CloudUpload className="size-3" /> Report on SharePoint
    </Badge>
  );

  return upload.url
    ? <a href={upload.url} target="_blank" rel="noreferrer">{badge}</a>
    : badge;
}

/**
 * One test run: which flows it executed and how each of them went. A run in
 * progress updates live — the backend pushes the summary over the socket on
 * every change.
 */
export function TestRunPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  // "Aug 20, 14:30" beats the run id on a tab
  useTabTitle(run ? runLabel(run) : null);

  useEffect(() => {
    let cancelled = false;
    setRun(null);
    setError(null);

    testRunsApi.get(id)
      .then((response) => !cancelled && setRun(response.data))
      .catch((ex) => !cancelled && setError(ex.response?.data?.error || ex.message));

    const onUpdate = (event) => {
      if (!cancelled && event?.id === id && event.run && !event.removed) {
        setRun(event.run);
      }
    };
    socket.on('testrun:update', onUpdate);

    return () => {
      cancelled = true;
      socket.off('testrun:update', onUpdate);
    };
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not open this test run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const badge = STATUS_BADGES[run.status] || { label: run.status, variant: 'secondary' };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="bg-background/95 sticky top-0 z-10 border-b px-6 py-3 backdrop-blur">
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Link to="/test-runs" className="hover:text-foreground inline-flex items-center gap-1">
            <History className="size-3.5" /> Test runs
          </Link>
          <ChevronRight className="size-3" />
          <span className="font-mono">{run.id}</span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">{runLabel(run)}</h1>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Badge variant="secondary">{triggerLabel(run.trigger)}</Badge>
          <Badge variant="outline" className="font-mono">{run.environment}</Badge>
          {run.trigger === 'folder' && (
            <Badge variant="outline">
              {run.folder || 'All flows'}{run.view ? ` · ${run.view}` : ''}
            </Badge>
          )}
          <span className="text-muted-foreground text-sm">
            {runScore(run)} passed{formatDuration(run.times) ? ` · ${formatDuration(run.times)}` : ''}
          </span>
          <UploadBadge upload={run.upload} />
          {/* The report is written when the execution finishes */}
          {run.status !== 'running' && (
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <a href={testRunReportUrl(run.id)} target="_blank" rel="noreferrer">
                <FileChartColumn /> HTML report
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Flows */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flow</TableHead>
              <TableHead>File</TableHead>
              <TableHead className="text-right">Steps</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Problem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.flows.map((flow) => {
              // The stored copy exists once the flow finished (or failed to
              // even start); until then there is nothing to open
              const finished = flow.status === 'passed' || flow.status === 'failed';

              return (
                <TableRow
                  key={flow.file}
                  className={finished ? 'group cursor-pointer' : undefined}
                  onClick={finished ? () => navigate(testRunFlowUrl(run.id, flow.file)) : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusDot status={dotStatus(flow.status)} />
                      <span className={finished ? 'text-info font-medium underline-offset-4 group-hover:underline' : 'font-medium'}>
                        {flow.title}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{flow.file}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {flow.steps ? `${flow.steps.passed}/${flow.steps.total}` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {formatDuration(flow.times) || (flow.status === 'running' ? '…' : '—')}
                  </TableCell>
                  <TableCell className="text-destructive max-w-96 truncate text-xs" title={flow.error || ''}>
                    {flow.error || ''}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default TestRunPage;
