import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, FolderTree, Plus, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { viewsApi } from '@/services/api';
import { displayName } from '@/lib/properties';
import {
  appendAt,
  conditionFor,
  countConditions,
  emptyGroup,
  findOperator,
  inputFor,
  isGroup,
  operatorsForType,
  prune,
  replaceAt,
  typeOf,
} from '@/lib/filters';

// The whole-file pseudo-property: "the file is in folder x", "the file has
// tag y". Obsidian spells it the same way
const FILE_PROPERTY = 'file';

// Properties are picked under the namespace they come from: two of them can
// end in the same word — a flow's `title` and the frontmatter's — and only the
// heading says which is which
const NAMESPACE_LABELS = {
  note: 'Properties',
  file: 'File',
  flow: 'Flow',
  formula: 'Formulas',
};

const NAMESPACE_ORDER = ['note', 'file', 'flow', 'formula'];

/**
 * The property list, split into the namespaces it comes from.
 * @param {Array<string>} properties - Every property id the folder offers
 * @returns {Array<Object>} [{ namespace, label, ids }]
 */
function byNamespace(properties) {
  return NAMESPACE_ORDER
    .map((namespace) => ({
      namespace,
      label: NAMESPACE_LABELS[namespace],
      ids: properties.filter((id) => id.split('.')[0] === namespace),
    }))
    .filter((group) => group.ids.length > 0);
}

// The catalog does not change while the app runs, so it is fetched once
let catalogPromise: Promise<any> | null = null;

/**
 * The conjunctions and operators the editor draws itself from, fetched once
 * and shared. Serving them means the editor can never offer an operator the
 * backend does not implement.
 * @returns {Promise<Object>}
 */
function loadCatalog(): Promise<any> {
  if (!catalogPromise) {
    catalogPromise = viewsApi.operators()
      .then((response) => response.data)
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

/**
 * The value side of a condition: whatever control the operator asks for, and
 * never a place where a typo can break the view — a value is only ever
 * compared, never parsed.
 *
 * @param {Object} props
 * @param {string} props.input - none | text | number | checkbox | date | list | folder | tag | property
 * @param {*} props.value
 * @param {Array<string>} props.suggestions - Values this property is seen with
 * @param {Function} props.onChange
 */
function ValueControl({ input, value, suggestions, onChange }) {
  const listId = useMemo(
    () => `filter-values-${Math.random().toString(36).slice(2, 9)}`,
    []
  );
  const [draft, setDraft] = useState('');

  if (input === 'none') {
    return <div className="text-muted-foreground flex-1 text-xs italic">No value needed</div>;
  }

  const datalist = suggestions.length > 0 && (
    <datalist id={listId}>
      {suggestions.map((option) => <option key={option} value={option} />)}
    </datalist>
  );

  if (input === 'list' || input === 'tag') {
    const items = Array.isArray(value) ? value : (value ? [value] : []);

    const add = () => {
      const next = draft.trim();
      if (!next || items.includes(next)) { setDraft(''); return; }
      onChange([...items, next]);
      setDraft('');
    };

    return (
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {items.map((item) => (
          <Badge key={item} variant="secondary" className="gap-1">
            {item}
            <button
              type="button"
              onClick={() => onChange(items.filter((entry) => entry !== item))}
              aria-label={`Remove ${item}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          list={suggestions.length ? listId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); add(); }
          }}
          placeholder={items.length ? 'Add another…' : 'Type or pick a value'}
          className="h-8 min-w-32 flex-1"
        />
        {datalist}
      </div>
    );
  }

  if (input === 'checkbox') {
    // Only reached by an operator that compares a checkbox to a value; the
    // usual "is checked" / "is not checked" take none
    return (
      <Select value={String(value ?? 'true')} onValueChange={(next) => onChange(next === 'true')}>
        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Checked</SelectItem>
          <SelectItem value="false">Not checked</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (input === 'date') {
    const mode = value === 'today' || value === 'now' ? value : 'on';

    return (
      <div className="flex flex-1 items-center gap-1">
        <Select
          value={mode}
          onValueChange={(next) => onChange(next === 'on' ? '' : next)}
        >
          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="on">A date</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="now">Now</SelectItem>
          </SelectContent>
        </Select>
        {mode === 'on' && (
          <Input
            type="date"
            value={typeof value === 'string' ? value.slice(0, 10) : ''}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 flex-1"
          />
        )}
      </div>
    );
  }

  if (input === 'number') {
    return (
      <Input
        type="number"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        className="h-8 flex-1"
      />
    );
  }

  // text, folder and property all take one value, picked from what the folder
  // actually holds or typed when it is something new
  return (
    <>
      <Input
        value={value ?? ''}
        list={suggestions.length ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={input === 'folder' ? 'payments' : 'Type or pick a value'}
        className="h-8 flex-1"
      />
      {datalist}
    </>
  );
}

/**
 * One condition: a property, an operator that property's type offers, and a
 * value.
 *
 * @param {Object} props
 * @param {Object} props.condition
 * @param {Object} props.catalog
 * @param {Object} props.meta - { properties, types, values, folders, names }
 * @param {Function} props.onChange
 * @param {Function} props.onRemove
 */
function ConditionRow({ condition, catalog, meta, onChange, onRemove }) {
  const type = typeOf(meta.types, condition.property);
  const operators = operatorsForType(catalog, type);
  const operator = findOperator(catalog, condition.operator);
  const input = inputFor(operator, type);

  const suggestions = input === 'folder'
    ? meta.folders
    : (input === 'tag' ? (meta.values['file.tags'] || []) : (meta.values[condition.property] || []));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={condition.property}
        onValueChange={(property) => onChange(
          conditionFor(catalog, meta.types, property, condition.operator)
        )}
      >
        <SelectTrigger className="h-8 w-52">
          <SelectValue placeholder="Property" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILE_PROPERTY}>
            <FolderTree className="size-3.5" /> The file
          </SelectItem>
          {byNamespace(meta.properties).map((group) => (
            <SelectGroup key={group.namespace}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.ids.map((id) => (
                <SelectItem key={id} value={id}>{displayName(id, meta.names)}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={(next) => {
          const nextInput = inputFor(findOperator(catalog, next), type);
          const kept = nextInput === input ? condition.value : undefined;
          const value = kept ?? (nextInput === 'list' || nextInput === 'tag' ? [] : '');
          onChange(
            nextInput === 'none'
              ? { property: condition.property, operator: next }
              : { property: condition.property, operator: next, value }
          );
        }}
      >
        <SelectTrigger className="h-8 w-56">
          <SelectValue placeholder="Operator" />
        </SelectTrigger>
        <SelectContent>
          {operators.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ValueControl
        input={input}
        value={condition.value}
        suggestions={suggestions}
        onChange={(value) => onChange({ ...condition, value })}
      />

      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove this condition">
        <X />
      </Button>
    </div>
  );
}

/**
 * A conjunction and everything under it. Draws itself again for a nested
 * group, so "any of these, and all of those" is built rather than written.
 *
 * @param {Object} props
 * @param {Object} props.group - { conjunction, conditions }
 * @param {Array<number>} props.path - Where this group sits in the tree
 * @param {Object} props.catalog
 * @param {Object} props.meta
 * @param {Function} props.onEdit - (path, node) — null removes
 * @param {Function} props.onAppend - (path, node)
 */
function GroupEditor({ group, path, catalog, meta, onEdit, onAppend }) {
  const nested = path.length > 0;

  return (
    <div className={nested ? 'border-muted space-y-2 border-l-2 pl-3' : 'space-y-2'}>
      <div className="flex items-center gap-2">
        <Select
          value={group.conjunction}
          onValueChange={(conjunction) => onEdit(path, { ...group, conjunction })}
        >
          <SelectTrigger className="h-8 w-64" aria-label="How these conditions combine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalog.conjunctions || []).map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {nested && (
          <Button variant="ghost" size="icon" onClick={() => onEdit(path, null)} aria-label="Remove this group">
            <X />
          </Button>
        )}
      </div>

      {group.conditions.length === 0 && (
        <p className="text-muted-foreground pl-1 text-xs">
          Nothing yet — every flow is listed.
        </p>
      )}

      {group.conditions.map((child, index) => (
        isGroup(child) ? (
          <GroupEditor
            key={index}
            group={child}
            path={[...path, index]}
            catalog={catalog}
            meta={meta}
            onEdit={onEdit}
            onAppend={onAppend}
          />
        ) : (
          <ConditionRow
            key={index}
            condition={child}
            catalog={catalog}
            meta={meta}
            onChange={(next) => onEdit([...path, index], next)}
            onRemove={() => onEdit([...path, index], null)}
          />
        )
      ))}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAppend(path, conditionFor(catalog, meta.types, meta.properties[0] || FILE_PROPERTY))}
        >
          <Plus /> Add filter
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAppend(path, emptyGroup())}>
          <Plus /> Add filter group
        </Button>
      </div>
    </div>
  );
}

/**
 * Which flows a view lists.
 *
 * A filter is picked, never typed: a property, an operator that property's
 * type offers, and a value. Nothing here reaches an expression parser, so no
 * filter can be a syntax error — which is what free-text filters kept being.
 *
 * @param {Object} props
 * @param {*} props.filters - The view's filter group
 * @param {*} props.documentFilters - The filters every view carries
 * @param {Object} props.meta - { properties, types, values, folders, names }
 * @param {number} props.matched - How many flows the saved filters keep
 * @param {number} props.total - How many flows the folder holds
 * @param {Array<string>} props.errors - Problems the backend reported
 * @param {string} props.folder - Folder the view is open on, for the preview
 * @param {Object} props.document - The whole views.yaml document
 * @param {string} props.viewName - Which view is being edited
 * @param {Function} props.onChange - Called with { filters, documentFilters }
 */
export function FilterEditor({
  filters, documentFilters, meta, matched, total, errors, folder, document, viewName, onChange,
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [view, setView] = useState(emptyGroup());
  const [shared, setShared] = useState(emptyGroup());
  const [preview, setPreview] = useState(null);

  const count = countConditions(filters) + countConditions(documentFilters);

  useEffect(() => {
    if (!open) { return; }
    setView(filters ? { ...filters } : emptyGroup());
    setShared(documentFilters ? { ...documentFilters } : emptyGroup());
    setPreview(null);
    loadCatalog().then(setCatalog).catch((error) => setCatalogError(
      error?.response?.data?.error || error.message
    ));
  }, [open, filters, documentFilters]);

  const candidate = useMemo(() => ({
    ...document,
    filters: prune(shared),
    views: (document?.views || []).map((entry) => (
      entry.name === viewName ? { ...entry, filters: prune(view) } : entry
    )),
  }), [document, viewName, view, shared]);

  // What the draft would list, without saving it. Debounced, because a
  // dropdown is changed far faster than a folder of flows is read
  useEffect(() => {
    if (!open) { return undefined; }

    const timer = setTimeout(() => {
      viewsApi.preview(folder, viewName, candidate)
        .then((response) => setPreview(response.data))
        .catch(() => setPreview(null));
    }, 300);

    return () => clearTimeout(timer);
  }, [open, folder, viewName, candidate]);

  const editIn = useCallback((setter) => (path, node) => setter(
    (current) => replaceAt(current, path, node)
  ), []);
  const appendIn = useCallback((setter) => (path, node) => setter(
    (current) => appendAt(current, path, node)
  ), []);

  const apply = () => {
    onChange({ filters: prune(view), documentFilters: prune(shared) });
    setOpen(false);
  };

  const shown = preview || { matched, total, errors };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Filter /> Filter
        {count > 0 && <span className="text-muted-foreground">{count}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Filter this view</DialogTitle>
            <DialogDescription>
              Every flow below the folder is listed unless a filter says otherwise.
              {' '}{shown.matched} of {shown.total} match.
            </DialogDescription>
          </DialogHeader>

          {catalogError && (
            <p className="text-destructive text-sm">Could not read the operators: {catalogError}</p>
          )}

          {catalog && (
            <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  All views
                  {countConditions(shared) > 0 && (
                    <Badge variant="secondary">{countConditions(shared)}</Badge>
                  )}
                </h3>
                <p className="text-muted-foreground text-xs">
                  Applied on top of every view in this context.
                </p>
                <GroupEditor
                  group={shared}
                  path={[]}
                  catalog={catalog}
                  meta={meta}
                  onEdit={editIn(setShared)}
                  onAppend={appendIn(setShared)}
                />
              </section>

              <section className="space-y-2 border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  This view
                  {countConditions(view) > 0 && (
                    <Badge variant="secondary">{countConditions(view)}</Badge>
                  )}
                </h3>
                <GroupEditor
                  group={view}
                  path={[]}
                  catalog={catalog}
                  meta={meta}
                  onEdit={editIn(setView)}
                  onAppend={appendIn(setView)}
                />
              </section>

              {(shown.errors || []).length > 0 && (
                <div className="text-destructive space-y-0.5 border-t pt-3 text-xs">
                  {(shown.errors || []).map((error, index) => (
                    <p key={index} className="font-mono">{error}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={apply} disabled={!catalog}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default FilterEditor;
