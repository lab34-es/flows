import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import CodeBlock from '@/components/shared/CodeBlock';
import ExecutionOutput from '@/components/flow/ExecutionOutput';
import XrayChip from '@/components/flow/XrayChip';
import { cn } from '@/lib/utils';

const STATUS_BORDERS = {
  running: 'border-l-info',
  passed: 'border-l-success',
  failed: 'border-l-destructive',
  error: 'border-l-destructive',
  skipped: 'border-l-muted-foreground/40',
};

/**
 * A notebook cell for a ```step block: the step definition (YAML) with its
 * live execution output right below, like In[]/Out[] in a Python notebook.
 *
 * In the Document view the YAML is editable: `sourceEditor` replaces the
 * highlighted block with the textarea holding the step's own source, and
 * `onSourceClick` is what asks for it.
 *
 * The switch in the corner of the header is the step's `enabled` key: off
 * writes `enabled: false` into the YAML, and the run walks past the step.
 */
export function StepCell({
  segment,
  step,
  stepData,
  xrayTest,
  jiraBaseUrl,
  inputRequest = null,
  onAnswerInput = null,
  sourceEditor = null,
  onSourceClick = null,
  enabled = true,
  onToggleEnabled = null,
}: any) {
  const application = step?.application;
  const method = step?.method;
  const executionStatus = stepData?.execution?.status;

  return (
    <div
      data-role="step-cell"
      data-enabled={enabled ? 'true' : 'false'}
      className={cn(
        'my-4 overflow-hidden rounded-lg border border-l-4 bg-card shadow-sm',
        STATUS_BORDERS[executionStatus] || 'border-l-border',
        !enabled && 'border-dashed border-l-muted-foreground/40'
      )}
    >
      {/* Cell header */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          step {segment.stepIndex + 1}
        </Badge>
        {application ? (
          <span className="font-mono text-xs">
            <Link className="text-info hover:underline" to={`/applications/${encodeURIComponent(application)}`}>
              {application}
            </Link>
            {method && (
              <>
                <span className="text-muted-foreground"> · </span>
                <Link
                  className="text-info hover:underline"
                  to={`/applications/${encodeURIComponent(application)}?method=${encodeURIComponent(method)}`}
                >
                  {method}
                </Link>
              </>
            )}
          </span>
        ) : (
          !segment.error && <span className="text-muted-foreground text-xs">step</span>
        )}
        {step?.description && (
          <span className="text-muted-foreground truncate text-xs">— {step.description}</span>
        )}
        {step?.testKey && (
          <XrayChip
            testKey={step.testKey}
            test={xrayTest}
            jiraBaseUrl={jiraBaseUrl}
            compact
          />
        )}

        {/* The step's own switch, in the corner of its header */}
        <div className="ml-auto flex items-center gap-2">
          {!enabled && (
            <span className="text-muted-foreground text-[10px] uppercase tracking-wide">disabled</span>
          )}
          {onToggleEnabled && (
            <Switch
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              aria-label={enabled ? 'Disable this step' : 'Enable this step'}
              title={enabled ? 'Disable this step' : 'Enable this step'}
            />
          )}
        </div>
      </div>

      {/* Step definition (YAML) — highlighted, or its own source while edited.
          A step that is off is dimmed, the way a disabled control is */}
      {sourceEditor ? (
        <div className="bg-muted/30 px-4 py-3">{sourceEditor}</div>
      ) : (
        <div
          onClick={onSourceClick || undefined}
          className={cn(onSourceClick && 'cursor-text', !enabled && 'opacity-50')}
        >
          <CodeBlock code={segment.content} language="yaml" className="rounded-none border-0" />
        </div>
      )}

      {/* Invalid step YAML */}
      {segment.error && (
        <div className="border-t border-destructive/40 bg-destructive/5 flex items-start gap-2 px-4 py-2 text-xs">
          <AlertTriangle className="text-destructive mt-0.5 size-3.5 shrink-0" />
          <span className="text-destructive font-mono">{segment.error}</span>
        </div>
      )}

      {/* Notebook-style execution output */}
      <ExecutionOutput
        stepData={stepData}
        inputRequest={inputRequest}
        onAnswerInput={onAnswerInput}
      />
    </div>
  );
}

export default StepCell;
