import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

/**
 * Contexts: the folders ronsel works in.
 *
 * A context holds a `flows` folder -- the Markdown flows -- and the rest of
 * what runs them: `applications`, `views.yaml`, the `test-runs` it records.
 * `ronsel start` creates one, but any folder shaped like it is one, which is
 * what lets a repository keep its flows next to its code (`e2e/flows`) and a
 * team keep them in a repository of their own.
 */

/** What, next to `flows`, makes a folder a context rather than any folder. */
export const CONTEXT_MARKERS = ['applications', 'views.yaml', '.examples-seeded', 'test-runs'];

/** The flow files the package runs. */
export const FLOW_EXTENSIONS = ['.md', '.markdown'];

const isDirectory = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isDirectory();
  }
  catch {
    return false;
  }
};

/**
 * Whether a folder is a context: a `flows` folder, and one of the markers.
 * @param {string} directory
 * @returns {boolean}
 */
export const isContext = (directory: string): boolean =>
  isDirectory(path.join(directory, 'flows')) &&
  CONTEXT_MARKERS.some(marker => fs.existsSync(path.join(directory, marker)));

/**
 * The context a flow file belongs to: the folder holding the closest `flows`
 * folder it is inside of, when that folder is a context.
 * @param {string} file - Absolute path of the flow
 * @param {Function} [check] - Whether a folder is a context
 * @returns {string|null}
 */
export const contextOf = (file: string, check: (directory: string) => boolean = isContext): string | null => {
  let directory = path.dirname(file);

  for (;;) {
    const parent = path.dirname(directory);

    if (path.basename(directory) === 'flows' && check(parent)) {
      return parent;
    }

    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
};

/** Whether a file name is a flow's. */
export const isFlowFile = (file: string): boolean => FLOW_EXTENSIONS.includes(path.extname(file).toLowerCase());

/**
 * Every flow of a flows folder, relative to it with forward slashes, in the
 * order the web UI lists them. Hidden entries and node_modules are not looked
 * into, the way the UI's tree does not.
 * @param {string} flowsDir
 * @returns {string[]}
 */
export const listFlows = (flowsDir: string): string[] => {
  const found: string[] = [];

  const walk = (directory: string, relative: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    }
    catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') { continue; }

      const absolute = path.join(directory, entry.name);
      const inside = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(absolute))) {
        walk(absolute, inside);
      }
      else if (isFlowFile(entry.name)) {
        found.push(inside);
      }
    }
  };

  walk(flowsDir, '');

  return found.sort((a, b) => a.localeCompare(b));
};

/**
 * The environments a context knows: one per env file, and per committed
 * `.env.example` template, of its applications -- the union, since an
 * environment exists as soon as one application declares it.
 * (allPossibleEnvironments in the package.)
 * @param {string} root - The context
 * @returns {string[]} Sorted
 */
export const listEnvironments = (root: string): string[] => {
  const applications = path.join(root, 'applications');
  const names = new Set<string>();

  let entries: string[];
  try {
    entries = fs.readdirSync(applications);
  }
  catch {
    return [];
  }

  for (const application of entries) {
    const envDir = path.join(applications, application, 'env');
    if (!isDirectory(envDir)) { continue; }

    for (const file of fs.readdirSync(envDir)) {
      let name: string | null = null;
      if (file.endsWith('.env')) { name = file.replace(/\.env$/i, ''); }
      else if (file.endsWith('.env.example')) { name = file.replace(/\.env\.example$/i, ''); }

      if (name && name.trim()) {
        try {
          if (fs.statSync(path.join(envDir, file)).isFile()) { names.add(name); }
        }
        catch {
          // Gone between the listing and the look
        }
      }
    }
  }

  return [...names].sort();
};

/** What the package shows when views.yaml declares nothing. */
export const DEFAULT_VIEW = 'All flows';

/**
 * The names of the saved views of a context, in the order views.yaml has
 * them, named the way the package names them (normalizeDocument in its bases
 * helper): a view without a name is "View <n>", and a file without views has
 * the default one.
 * @param {string} root - The context
 * @returns {string[]}
 * @throws {Error} When views.yaml is there and does not parse
 */
export const listViews = (root: string): string[] => {
  const file = path.join(root, 'views.yaml');

  if (!fs.existsSync(file)) {
    return [DEFAULT_VIEW];
  }

  let document: any;
  try {
    document = YAML.parse(fs.readFileSync(file, 'utf8'));
  }
  catch (ex) {
    throw new Error(`Invalid views.yaml: ${(ex as Error).message}`, { cause: ex });
  }

  const views: any[] = document && Array.isArray(document.views)
    ? document.views.filter((view: unknown) => view && typeof view === 'object')
    : [];

  if (!views.length) {
    return [DEFAULT_VIEW];
  }

  return views.map((view, index) => String(view.name ?? '').trim() || `View ${index + 1}`);
};
