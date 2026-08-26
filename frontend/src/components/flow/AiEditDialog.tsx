import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { flowsApi, settingsApi } from '@/services/api';
import { useWorkspace } from '@/workspace/WorkspaceContext';

const EXAMPLES = [
  'Add a step that checks the response time is under 500ms',
  'Explain each section with a short paragraph',
  'Also cover the unhappy path: a request for an id that does not exist',
];

/**
 * Ask the model to rewrite the open flow. The result is handed back through
 * `onApply` as an unsaved change, so nothing is written to disk until the
 * user reviews it and hits Save.
 */
export function AiEditDialog({ open, onOpenChange, content, onApply }) {
  const { openTab } = useWorkspace();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (!open) { return; }
    setPrompt('');
    setError(null);
    setBusy(false);

    let cancelled = false;
    settingsApi.getAI()
      .then((response) => !cancelled && setSettings(response.data))
      .catch(() => !cancelled && setSettings({ ready: false }));
    return () => { cancelled = true; };
  }, [open]);

  const handleGenerate = async () => {
    const instruction = prompt.trim();
    if (!instruction) { return; }

    setBusy(true);
    setError(null);
    try {
      const response = await flowsApi.editAI(instruction, content);
      await onApply(response.data.flow);
      onOpenChange(false);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Edit with AI
          </DialogTitle>
          <DialogDescription>
            Describe the change. The whole document is rewritten and left unsaved,
            so you can review it before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="flow-ai-edit">Instruction</Label>
          <Textarea
            id="flow-ai-edit"
            rows={5}
            autoFocus
            placeholder={EXAMPLES[0]}
            value={prompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
          />

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={busy}
                onClick={() => setPrompt(example)}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-full border px-2 py-0.5 text-xs disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>

          {settings && settings.ready === false && (
            <p className="text-destructive text-sm">
              No AI provider is configured yet.{' '}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => { onOpenChange(false); openTab('/settings'); }}
              >
                Open settings
              </button>
            </p>
          )}
          {busy && (
            <p className="text-muted-foreground text-xs">
              Rewriting the flow… this can take up to a couple of minutes.
            </p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? 'Rewriting…' : 'Rewrite flow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AiEditDialog;
