import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Folder,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Play,
  Search,
  Sigma,
  Table2,
  Trash2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import BaseList from '@/components/base/BaseList';
import BaseTable from '@/components/base/BaseTable';
import CliCommandDialog from '@/components/base/CliCommandDialog';
import FilterEditor from '@/components/base/FilterEditor';
import FormulasDialog from '@/components/base/FormulasDialog';
import PropertiesMenu from '@/components/base/PropertiesMenu';
import SortMenu from '@/components/base/SortMenu';
import ViewTabs from '@/components/base/ViewTabs';
import { viewsApi, testRunsApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';
import { useExecutions } from '@/context/ExecutionContext';
import { compareValues, displayName, matchesSearch } from '@/lib/properties';
import { testRunUrl } from '@/lib/testRuns';

// Which view was last used on a given folder. Views themselves are not tied
// to a folder — only this preference is, and it stays in the browser so
// views.yaml keeps no folder references.
const VIEW_STORAGE_PREFIX = 'lab34-flows:view:';

const rememberedView = (folder) => localStorage.getItem(`${VIEW_STORAGE_PREFIX}${folder}`) || '';
const rememberView = (folder, name) => localStorage.setItem(`${VIEW_STORAGE_PREFIX}${folder}`, name);

/**
 * A folder of flows, rendered as a base: the flows below it in a table (or a
 * list), through whichever saved view is selected.
 *
 * Filters and formulas are evaluated by the backend, which owns the
 * expression language; ordering and searching happen here, on values every
 * row already carries.
 */
export function FolderPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const folder = searchParams.get('path') || '';

  const { environment, agent } = useAppState();
  const { anyRunning } = useExecutions();

  const [doc, setDoc] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [saveError, setSaveError] = useState<any>(null);
  const [runAllError, setRunAllError] = useState<any>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [search, setSearch] = useState('');
  const [activeName, setActiveName] = useState('');
  const [formulasOpen, setFormulasOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // ------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    viewsApi.get()
      .then((response) => !cancelled && setDoc(response.data))
      .catch((ex) => !cancelled && setError(ex.response?.data?.error || ex.message));
    return () => { cancelled = true; };
  }, []);

  // The active view: whatever this folder was last opened with, when it is
  // still around, and the first one otherwise
  useEffect(() => {
    if (!doc) { return; }
    const names = doc.views.map((view) => view.name);
    const remembered = rememberedView(folder);
    setActiveName(names.includes(remembered) ? remembered : (names[0] || ''));
  }, [doc, folder]);

  const activeView = useMemo(
    () => doc?.views.find((view) => view.name === activeName) || doc?.views[0] || null,
    [doc, activeName]
  );

  // Only what the backend computes belongs in this key: columns, sort and
  // search are worked out here and never need another request
  const queryKey = activeView
    ? JSON.stringify([folder, activeView.name, doc.filters, activeView.filters, doc.formulas])
    : null;

  const runQuery = useCallback(async () => {
    if (!activeView) { return; }
    setLoading(true);
    setError(null);
    try {
      const response = await viewsApi.query(folder, activeView.name);
      setResult(response.data);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
    // runQuery is deliberately keyed on what the backend actually uses
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => { runQuery(); }, [runQuery]);

  useEffect(() => { setSearch(''); }, [folder]);

  // ------------------------------------------------------------- saving

  /**
   * Persist a new views doc and keep the UI on it.
   * @param {Object} next
   */
  const persist = useCallback(async (next) => {
    setDoc(next);
    setSaveError(null);
    try {
      const response = await viewsApi.save(next);
      // The backend normalizes (bare names get qualified, and so on): take
      // its answer as the truth
      setDoc(response.data);
    } catch (ex) {
      setSaveError(ex.response?.data?.error || ex.message);
    }
  }, []);

  /**
   * Change the active view.
   * @param {Object} patch
   */
  const patchView = useCallback((patch) => {
    if (!doc || !activeView) { return; }
    persist({
      ...doc,
      views: doc.views.map((view) => (view.name === activeView.name ? { ...view, ...patch } : view)),
    });
  }, [doc, activeView, persist]);

  const selectView = (name) => {
    setActiveName(name);
    rememberView(folder, name);
  };

  const createView = ({ name, type }) => {
    const next = {
      ...doc,
      views: [...doc.views, { type, name, filters: null, order: [], sort: [], columnSize: {} }],
    };
    persist(next);
    selectView(name);
  };

  const renameView = () => {
    const name = renameDraft.trim();
    setRenaming(false);
    if (!name || name === activeView.name) { return; }
    if (doc.views.some((view) => view.name === name)) { return; }
    persist({
      ...doc,
      views: doc.views.map((view) => (view.name === activeView.name ? { ...view, name } : view)),
    });
    selectView(name);
  };

  const duplicateView = () => {
    let name = `${activeView.name} copy`;
    let suffix = 2;
    while (doc.views.some((view) => view.name === name)) {
      name = `${activeView.name} copy ${suffix}`;
      suffix += 1;
    }
    persist({ ...doc, views: [...doc.views, { ...activeView, name }] });
    selectView(name);
  };

  const deleteView = () => {
    if (doc.views.length === 1) { return; }
    const remaining = doc.views.filter((view) => view.name !== activeView.name);
    persist({ ...doc, views: remaining });
    selectView(remaining[0].name);
  };

  /**
   * Clicking a column header: ascending, then descending, then unsorted —
   * and always as the only sort, which is what a header click means.
   * @param {string} columnId
   */
  const toggleSort = (columnId) => {
    const current = (activeView.sort || []).find((entry) => entry.property === columnId);
    if (!current) {
      patchView({ sort: [{ property: columnId, direction: 'ASC' }] });
      return;
    }
    patchView({
      sort: current.direction === 'ASC' ? [{ property: columnId, direction: 'DESC' }] : [],
    });
  };

  /**
   * Rename a column for every view of the context.
   * @param {string} columnId
   * @param {string} name - Empty to fall back to the humanized default
   */
  const renameProperty = (columnId, name) => {
    const properties = { ...doc.properties };
    if (name) {
      properties[columnId] = { ...properties[columnId], displayName: name };
    } else {
      delete properties[columnId];
    }
    persist({ ...doc, properties });
  };

  // ----------------------------------------------------------- the rows

  const columns = useMemo(() => {
    if (!activeView || !result) { return []; }
    const order = activeView.order?.length
      ? activeView.order
      : result.columns.map((column) => column.id);

    return order.map((id) => ({
      id,
      displayName: displayName(id, doc?.properties),
      width: activeView.columnSize?.[id] || null,
    }));
  }, [activeView, result, doc]);

  const rows = useMemo(() => {
    if (!result) { return []; }

    const filtered = result.rows.filter((row) => matchesSearch(row, columns, search));
    const sort = activeView?.sort || [];
    if (!sort.length) { return filtered; }

    // The first entry that separates two flows decides, so stacked sorts
    // read as "by priority, then by owner"
    return [...filtered].sort((left, right) => {
      for (const entry of sort) {
        const comparison = compareValues(left.values?.[entry.property], right.values?.[entry.property]);
        if (comparison !== 0) { return entry.direction === 'DESC' ? -comparison : comparison; }
      }
      return 0;
    });
  }, [result, columns, search, activeView]);

  // ----------------------------------------------------------- run all

  /**
   * Execute every flow this view is showing — filters and search applied, in
   * the order on screen — as one test run, and follow it on its page.
   */
  const runAll = async () => {
    if (!environment || !rows.length || startingRun) { return; }
    setRunAllError(null);
    setStartingRun(true);
    try {
      const response = await testRunsApi.start({
        environment,
        folder,
        view: activeView?.name,
        files: rows.map((row) => row.relativePath),
        ...(agent ? { agent } : {}),
      });
      navigate(testRunUrl(response.data.run.id));
    } catch (ex) {
      setRunAllError(ex.response?.data?.error || ex.message);
    } finally {
      setStartingRun(false);
    }
  };

  // ---------------------------------------------------------- rendering

  const folderName = folder ? folder.split('/').pop() : 'All flows';

  if (error && !result) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not open this folder</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!doc || !activeView) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const LayoutIcon = activeView.type === 'list' ? LayoutList : Table2;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <FormulasDialog
        open={formulasOpen}
        onOpenChange={setFormulasOpen}
        formulas={doc.formulas}
        onSave={(formulas) => persist({ ...doc, formulas })}
      />

      {/* Header */}
      <div className="bg-background/95 sticky top-0 z-20 border-b px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Folder className="text-muted-foreground size-4 shrink-0" />
              <h1 className="truncate text-lg font-bold tracking-tight">{folderName}</h1>
              <span className="text-muted-foreground text-sm">
                {rows.length}{rows.length !== result?.rows.length ? ` of ${result?.rows.length}` : ''} flow
                {rows.length === 1 ? '' : 's'}
              </span>
            </div>
            {folder && <p className="text-muted-foreground truncate font-mono text-xs">{folder}</p>}
          </div>

          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search…"
              className="h-8 w-48 pl-8"
              aria-label="Search these flows"
            />
          </div>

          <PropertiesMenu
            order={columns.map((column) => column.id)}
            available={result?.availableProperties || []}
            properties={doc.properties}
            onOrderChange={(order) => patchView({ order })}
            onRename={renameProperty}
          />

          <SortMenu
            sort={activeView.sort || []}
            available={result?.availableProperties || []}
            properties={doc.properties}
            onChange={(sort) => patchView({ sort })}
          />

          <FilterEditor
            filters={activeView.filters}
            documentFilters={doc.filters}
            meta={{
              properties: result?.filterProperties || [],
              types: result?.propertyTypes || {},
              values: result?.propertyValues || {},
              folders: result?.folders || [],
              names: doc.properties,
            }}
            matched={result?.rows.length || 0}
            total={result?.total || 0}
            errors={result?.errors || []}
            folder={folder}
            document={doc}
            viewName={activeView.name}
            onChange={({ filters, documentFilters }) => persist({
              ...doc,
              filters: documentFilters,
              views: doc.views.map((view) => (
                view.name === activeView.name ? { ...view, filters } : view
              )),
            })}
          />

          <Button
            onClick={runAll}
            disabled={anyRunning || startingRun || !environment || rows.length === 0}
            title={!environment
              ? 'Select an environment in the sidebar first'
              : `Run the ${rows.length} flow${rows.length === 1 ? '' : 's'} this view shows on “${environment}”`}
          >
            <Play /> Run all{environment ? ` · ${environment}` : ''}{agent ? ` · ${agent}` : ''}
          </Button>

          <CliCommandDialog
            view={activeView}
            folder={folder}
            matched={rows.length}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="View actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{activeView.name}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { setRenameDraft(activeView.name); setRenaming(true); }}>
                <Pencil /> Rename view
              </DropdownMenuItem>
              <DropdownMenuItem onClick={duplicateView}>
                <LayoutIcon /> Duplicate view
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => patchView({ type: activeView.type === 'list' ? 'table' : 'list' })}
              >
                {activeView.type === 'list' ? <Table2 /> : <LayoutList />}
                Show as {activeView.type === 'list' ? 'table' : 'list'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFormulasOpen(true)}>
                <Sigma /> Formulas…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={doc.views.length === 1}
                onClick={deleteView}
              >
                <Trash2 /> Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="pt-2">
          {renaming ? (
            <Input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={renameView}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { renameView(); }
                if (event.key === 'Escape') { setRenaming(false); }
              }}
              className="h-7 w-56 text-sm"
              aria-label="View name"
            />
          ) : (
            <ViewTabs
              views={doc.views}
              activeName={activeView.name}
              onSelect={selectView}
              onCreate={createView}
            />
          )}
        </div>
      </div>

      {/* Problems */}
      {(saveError || runAllError || (result?.errors?.length > 0)) && (
        <div className="space-y-2 px-6 pt-4">
          {saveError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>The view could not be saved</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          {runAllError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>The test run could not start</AlertTitle>
              <AlertDescription>{runAllError}</AlertDescription>
            </Alert>
          )}
          {result?.errors?.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>
                {result.errors.length} filter or formula {result.errors.length > 1 ? 'problems' : 'problem'}
              </AlertTitle>
              <AlertDescription>
                {result.errors.map((message, index) => (
                  <p key={index} className="font-mono text-xs">{message}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !result ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">
            {result?.rows.length
              ? 'No flow matches this search.'
              : (activeView.filters
                ? 'No flow here matches this view’s filters.'
                : 'This folder has no flows yet.')}
          </p>
        ) : activeView.type === 'list' ? (
          <BaseList columns={columns} rows={rows} />
        ) : (
          <BaseTable
            columns={columns}
            rows={rows}
            sort={activeView.sort || []}
            onToggleSort={toggleSort}
          />
        )}
      </div>
    </div>
  );
}

export default FolderPage;
