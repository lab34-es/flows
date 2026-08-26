import React, { useEffect, useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CodeBlock from '@/components/shared/CodeBlock';
import { useAppState } from '@/context/AppStateContext';
import { viewCommand } from '@/lib/cli';

/**
 * "Copy CLI command": the same view, run from a terminal or a pipeline.
 *
 * What is copied names the view rather than the flows it happens to match
 * right now — the command re-evaluates the view every time it runs, so a flow
 * added tomorrow is picked up without touching the pipeline.
 *
 * @param {Object} props
 * @param {Object} props.view - The active view ({ name, slug })
 * @param {string} props.folder - Folder the view is being read on ('' = all flows)
 * @param {number} props.matched - How many flows it matches right now
 */
export function CliCommandDialog({ view, folder, matched }) {
  const { contextInfo, environment } = useAppState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const command = viewCommand({
    contextPath: contextInfo?.path,
    environment,
    view: view?.slug || view?.name,
    folder,
  });

  // The tick is a receipt, not a state: it goes back to the copy icon on its own
  useEffect(() => {
    if (!copied) { return undefined; }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open) { setCopied(false); setCopyFailed(false); }
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // A browser that refuses the clipboard still lets the command be
      // selected: say so rather than failing silently
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Copy the CLI command that runs this view"
      >
        <Terminal /> CLI
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run “{view?.name}” from the CLI</DialogTitle>
            <DialogDescription>
              This command runs the flows this view matches <strong>when it runs</strong>, not the{' '}
              {matched} it matches now — a flow added later that the view’s filters keep is picked
              up on its own.
            </DialogDescription>
          </DialogHeader>

          <CodeBlock code={command} language="bash" />

          {copyFailed && (
            <p className="text-destructive text-xs">
              The clipboard is not available here — select the command above and copy it yourself.
            </p>
          )}

          {!environment && (
            <p className="text-muted-foreground text-xs">
              No environment is selected, so the command carries a placeholder. Pick one in the
              sidebar, or replace <code>&lt;environment&gt;</code> yourself.
            </p>
          )}

          <p className="text-muted-foreground text-xs">
            Every run is recorded under the context’s <code>test-runs</code> folder, and the
            command exits with a non-zero code as soon as one flow fails — which is what a
            pipeline reads.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy command'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CliCommandDialog;
