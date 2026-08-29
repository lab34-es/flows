import React, { useEffect, useState } from 'react';
import { AlertCircle, FilePlus2, Loader2, PencilLine, Upload } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { environmentApi } from '@/services/api';

/** Whether a plan would actually write anything. */
const changes = (report) =>
  (report?.summary?.added || 0) + (report?.summary?.changed || 0) + (report?.summary?.created || 0);

/**
 * One line of the plan: which file, and what the document does to it.
 */
function PlannedFile({ file }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
      {file.created
        ? <FilePlus2 className="text-success size-4 shrink-0" />
        : <PencilLine className="text-muted-foreground size-4 shrink-0" />}
      <span className="font-mono text-xs">{file.file}</span>
      {file.created && <Badge variant="success" className="px-1.5 py-0 text-[10px]">new file</Badge>}
      {file.added.length > 0 && (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          +{file.added.length} added
        </Badge>
      )}
      {file.changed.length > 0 && (
        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
          {file.changed.length} overwritten
        </Badge>
      )}
      {file.unchanged.length > 0 && (
        <span className="text-muted-foreground text-[10px]">
          {file.unchanged.length} already the same
        </span>
      )}
    </div>
  );
}

/**
 * Reading a document somebody sent: paste it, see exactly which files it would
 * create and which variables it would overwrite, then write it.
 *
 * The preview is the import itself, asked not to write (`dryRun`), so what it
 * promises is what happens — and it runs on its own as the text is pasted, so
 * nobody has to press anything to find out that a document is malformed.
 */
export function EnvVariablesImport({ onImported }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<any>(null);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Preview as it is pasted, a beat after the typing stops. The report of the
  // last import is cleared by the next edit rather than here, so emptying the
  // box on a successful import does not take the receipt with it.
  useEffect(() => {
    if (!text.trim()) {
      setPlan(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setPlanning(true);

    const timer = setTimeout(() => {
      environmentApi.importVariables(text, { dryRun: true })
        .then((response) => {
          if (cancelled) { return; }
          setPlan(response.data);
          setError(null);
        })
        .catch((ex) => {
          if (cancelled) { return; }
          setPlan(null);
          setError(ex.response?.data?.error || ex.message);
        })
        .finally(() => { if (!cancelled) { setPlanning(false); } });
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [text]);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const response = await environmentApi.importVariables(text, { dryRun: false });
      setResult(response.data);
      setPlan(null);
      setText('');
      onImported?.();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(event) => { setText(event.target.value); setResult(null); }}
        placeholder={'applications:\n  payments:\n    uat:\n      API_URL: https://uat.payments.example'}
        className="max-h-80 min-h-40 overflow-y-auto font-mono text-xs"
        aria-label="The document to import"
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>That document cannot be read</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {planning && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Working out what it would change…
        </p>
      )}

      {result && (
        <Alert>
          <AlertTitle>
            {result.summary.created} file{result.summary.created === 1 ? '' : 's'} created,{' '}
            {result.summary.updated} updated
          </AlertTitle>
          <AlertDescription>
            {result.summary.added} variable{result.summary.added === 1 ? '' : 's'} added and{' '}
            {result.summary.changed} overwritten.
            {result.summary.unchanged > 0 && ` ${result.summary.unchanged} already held the value.`}
          </AlertDescription>
        </Alert>
      )}

      {plan && (
        <div className="space-y-3">
          {plan.files.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {plan.files.map((file) => <PlannedFile key={file.file} file={file} />)}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              This document changes nothing in this context.
            </p>
          )}

          {plan.skipped.length > 0 && (
            <Alert>
              <AlertCircle />
              <AlertTitle>
                {plan.skipped.length} entr{plan.skipped.length === 1 ? 'y is' : 'ies are'} left out
              </AlertTitle>
              <AlertDescription>
                {plan.skipped.map((item, index) => (
                  <p key={index} className="font-mono text-xs">
                    {[item.application, item.environment, item.key].filter(Boolean).join(' · ')}
                    {` — ${item.reason}`}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {plan.summary.changed > 0 && (
            <p className="text-muted-foreground text-xs">
              {plan.summary.changed} variable{plan.summary.changed === 1 ? '' : 's'} already set to
              something else will be overwritten. Everything the document does not name is left as
              it is — comments and order included.
            </p>
          )}

          <Button size="sm" onClick={handleImport} disabled={importing || changes(plan) === 0}>
            <Upload />
            {importing ? 'Writing the files…' : 'Import into my env files'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default EnvVariablesImport;
