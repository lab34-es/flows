/**
 * The command line that runs what the UI is showing.
 *
 * A view is named rather than expanded into the flows it happens to match:
 * the CLI re-evaluates it on every run, which is what makes a command written
 * into a pipeline today pick up a flow added tomorrow.
 */

/**
 * One argument of a shell command, quoted only when it has to be.
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9._@:/=-]+$/.test(text)) { return text; }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * The command that runs a view from a terminal.
 *
 * @param {Object} options
 * @param {string} [options.contextPath] - The context directory
 * @param {string} [options.environment] - Left as a placeholder when there is none
 * @param {string} options.view - The view's slug (or its name)
 * @param {string} [options.folder] - Folder of the flows tree to scope it to
 * @returns {string}
 */
export function viewCommand({ contextPath, environment, view, folder }) {
  const parts = ['lab34-flows'];

  if (contextPath) { parts.push('--context', quote(contextPath)); }
  parts.push('--env', environment ? quote(environment) : '<environment>');
  parts.push('--view', quote(view));
  if (folder) { parts.push('--folder', quote(folder)); }

  return parts.join(' ');
}
