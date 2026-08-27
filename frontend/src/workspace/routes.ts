/**
 * Helpers around the route strings ("/flows/view?path=…") that name what a
 * workspace tab shows. A route is always pathname + search, never a full URL.
 */

/** pathname + search of a route string, parsed once. */
export function parseRoute(route: string | null | undefined) {
  const url = new URL(route || '/', 'http://tab');
  return {
    pathname: url.pathname,
    search: url.search,
    searchParams: url.searchParams,
  };
}

const basename = (path: string) => path.split('/').filter(Boolean).pop() || '';

const stripExtension = (name: string) => name.replace(/\.(md|markdown)$/i, '');

/**
 * What the tab of a route is called before the page inside knows better
 * (pages with richer data — a flow's own title, a run's date — refine it
 * through useTabTitle).
 */
export function titleForRoute(route: string) {
  const { pathname, searchParams } = parseRoute(route);

  if (pathname === '/') { return 'Home'; }

  if (pathname === '/flows/view') {
    const path = searchParams.get('path') || '';
    return stripExtension(basename(path)) || 'Flow';
  }

  if (pathname === '/flows/folder') {
    const path = searchParams.get('path') || '';
    return path ? basename(path) : 'All flows';
  }

  if (pathname === '/test-runs') { return 'Test runs'; }

  const runFlow = pathname.match(/^\/test-runs\/[^/]+\/flow$/);
  if (runFlow) {
    const path = searchParams.get('path') || '';
    return stripExtension(basename(path)) || 'Run flow';
  }

  if (pathname.startsWith('/test-runs/')) { return 'Test run'; }

  if (pathname.startsWith('/applications/')) {
    return decodeURIComponent(basename(pathname)) || 'Application';
  }

  if (pathname.startsWith('/settings')) { return 'Settings'; }

  if (pathname.startsWith('/help')) { return 'Help'; }

  return 'flows';
}

/**
 * Which tab a route belongs to. Opening a route whose key matches an open
 * tab focuses (and, if needed, navigates) that tab instead of adding another:
 * settings and help are one tab each whatever section or article they sit on,
 * a test run is one tab whether it shows the run or one of its stored flows,
 * and everything else is keyed by its exact route.
 */
export function tabKeyForRoute(route: string) {
  const { pathname, search } = parseRoute(route);

  if (pathname.startsWith('/settings')) { return 'settings'; }

  if (pathname.startsWith('/help')) { return 'help'; }

  const run = pathname.match(/^\/test-runs\/([^/]+)/);
  if (run) { return `run:${run[1]}`; }

  return pathname + search;
}
