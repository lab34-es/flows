import path from 'path';

import * as paths from './paths';
import * as git from './git';

/**
 * The context directory, described for the UI.
 *
 * Everything the app reads and writes lives under one folder -- the default
 * one in the home directory, or whichever was passed as --context. Which one
 * it is matters enough to be on screen at all times, and when that folder is
 * a git repository the UI wants to say which branch it is on and what changed
 * in it, the way an editor's explorer does.
 */

/** A changed file, with its path relative to the context directory. */
export interface ContextChange extends git.GitChange {
  /**
   * The same file relative to the context directory, so the sidebar can match
   * it against a flow's or an application's own relative path. Null for a
   * change that lives outside the context directory.
   */
  contextPath: string | null;
}

export interface ContextGit extends Omit<git.GitInfo, 'changes'> {
  changes: ContextChange[];
}

export interface ContextInfo {
  /** Absolute path of the context directory */
  path: string;
  /** Its last segment, which is what the UI shows */
  name: string;
  /** true when it came from --context rather than the default location */
  custom: boolean;
  /** null when the context directory is not inside a git repository */
  git: ContextGit | null;
}

/**
 * Re-express a repository-relative path as a context-relative one.
 * @param {string} prefix - Context directory relative to the repository root
 * @param {string} filePath - Path relative to the repository root
 * @returns {string|null} null when the file is outside the context directory
 */
const toContextPath = (prefix: string, filePath: string): string | null => {
  if (!prefix) { return filePath; }
  if (filePath === prefix) { return ''; }
  return filePath.startsWith(`${prefix}/`) ? filePath.slice(prefix.length + 1) : null;
};

/**
 * Where we are working, and what git makes of it.
 * @returns {Promise<ContextInfo>}
 */
export const info = async (): Promise<ContextInfo> => {
  const contextPath = await paths.contextRoot();
  const repository = await git.info(contextPath);

  return {
    path: contextPath,
    name: path.basename(contextPath) || contextPath,
    custom: paths.hasCustomContext(),
    git: repository && {
      ...repository,
      changes: repository.changes.map(change => ({
        ...change,
        contextPath: toContextPath(repository.prefix, change.path)
      }))
    }
  };
};

/**
 * Bring the context directory up to date with its remote.
 * @returns {Promise<{output: string}>}
 */
export const pull = async () => git.pull(await paths.contextRoot());

/**
 * Commit the context directory. Without `paths`, everything that changed in
 * it goes in one commit.
 * @param {Object} body - { message, paths }
 * @returns {Promise<{output: string}>}
 */
export const commit = async (body: { message?: string, paths?: string[] } = {}) => {
  const contextPath = await paths.contextRoot();

  // The UI knows files by their context-relative path, and git resolves a
  // pathspec against the directory it runs in -- which is that same one, so
  // the paths go through untouched.
  return git.commit(contextPath, body.message || '', body.paths || []);
};

/**
 * Publish the context directory's commits.
 * @returns {Promise<{output: string}>}
 */
export const push = async () => git.push(await paths.contextRoot());

/**
 * The branches of the context directory's repository.
 * @returns {Promise<git.GitBranches>}
 */
export const branches = async () => git.branches(await paths.contextRoot());

/**
 * Switch the context directory to another branch, creating it when asked.
 * @param {Object} body - { branch, create, from }
 * @returns {Promise<{output: string, branch: string}>}
 */
export const checkout = async (
  body: { branch?: string, create?: boolean, from?: string } = {}
) => git.checkout(await paths.contextRoot(), body.branch || '', {
  create: Boolean(body.create),
  from: body.from
});

/**
 * Update every remote's branches.
 * @returns {Promise<{output: string}>}
 */
export const fetch = async () => git.fetch(await paths.contextRoot());
