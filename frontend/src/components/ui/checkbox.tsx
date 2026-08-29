import * as React from 'react';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A checkbox built on a native button, the way Switch is: `role="checkbox"`
 * plus `aria-checked` give screen readers the same semantics as the Radix
 * primitive, keyboard activation comes for free, and no dependency is added.
 *
 * `checked` takes the third state a tree of checkboxes needs:
 * `'indeterminate'` for a parent only some of whose children are ticked.
 * Clicking one then ticks the rest, which is what a parent with a dash on it
 * is understood to offer.
 */
type CheckedState = boolean | 'indeterminate';

function Checkbox({ className, checked = false, onCheckedChange, disabled, ...props }: Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked?: CheckedState,
  onCheckedChange?: (checked: boolean) => void
} & Record<string, any>) {
  const indeterminate = checked === 'indeterminate';
  const on = checked === true;

  return (
    <button
      type="button"
      role="checkbox"
      data-slot="checkbox"
      aria-checked={indeterminate ? 'mixed' : on}
      data-state={indeterminate ? 'indeterminate' : on ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!on)}
      className={cn(
        'peer flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border shadow-xs transition-shadow outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        on || indeterminate
          ? 'bg-primary border-primary text-primary-foreground'
          : 'border-input dark:bg-input/30',
        className
      )}
      {...props}
    >
      {indeterminate ? <Minus className="size-3" /> : on ? <Check className="size-3" /> : null}
    </button>
  );
}

export { Checkbox };
export type { CheckedState };
