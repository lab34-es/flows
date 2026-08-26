import { execFile } from 'child_process';
import path from 'path';

/**
 * Git for the context directory.
 *
 * The context directory is the user's own folder of flows and applications;
 * more often than not it is a git repository they share with their team. This
 * module is what lets the UI say so: which branch is checked out, which files
 * changed, and how to pull, commit and push them without leaving the app.
 *
 * Everything here shells out to the `git` binary through execFile -- never a
 * shell string -- so a branch or a commit message can never turn into shell
 * syntax.
 */

/** How a file differs from HEAD, normalised out of git's two-letter codes. */
export type GitFileStatus =
  | 'untracked'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'conflicted';

export interface GitChange {
  /** Path relative to the repository root, always with forward slashes */
  path: string;
  status: GitFileStatus;
  /** Whether the change is (at least partly) in the index */
  staged: boolean;
  /** The two raw porcelain letters, for anyone who wants the detail */
  code: string;
  /** Where a renamed file came from */
  from?: string;
}

export interface GitRemote {
  name: string;
  url: string;
  /** The same remote as a browsable https URL, when we can work one out */
  webUrl: string | null;
}

export interface GitInfo {
  /** Absolute path of the repository root */
  root: string;
  /** Path of the context directory relative to the root ('' at the root) */
  prefix: string;
  branch: string | null;
  /** e.g. "origin/main", when the branch tracks one */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** true when HEAD points at a commit rather than a branch */
  detached: boolean;
  remote: GitRemote | null;
  changes: GitChange[];
}

const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Run a git command inside a directory, keeping both streams.
 *
 * Git says most of what a human wants to read on stderr -- "Switched to
 * branch", "* [new branch]" -- and reserves stdout for output meant to be
 * parsed, so a command whose result we want to show has to keep both.
 *
 * @param {string[]} args - Arguments passed to the git binary, unquoted
 * @param {string} cwd - Directory to run in
 * @returns {Promise<{stdout: string, stderr: string}>} both trimmed of their trailing newline
 */
export const capture = (args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const message = String(stderr || (error as any).message || error).trim();
        const failure: any = new Error(message || `git ${args[0]} failed`);
        failure.code = (error as any).code;
        return reject(failure);
      }
      resolve({
        stdout: String(stdout).replace(/\n$/, ''),
        stderr: String(stderr).replace(/\n$/, '')
      });
    });
  });

/**
 * Run a git command inside a directory.
 * @param {string[]} args - Arguments passed to the git binary, unquoted
 * @param {string} cwd - Directory to run in
 * @returns {Promise<string>} stdout, trimmed of its trailing newline
 */
export const run = async (args: string[], cwd: string): Promise<string> =>
  (await capture(args, cwd)).stdout;

/**
 * Run a git command and report whatever it said, from either stream, the way
 * a terminal would have shown it.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
const report = async (args: string[], cwd: string): Promise<string> => {
  const { stdout, stderr } = await capture(args, cwd);
  return [stdout, stderr].map(value => value.trim()).filter(Boolean).join('\n');
};

/**
 * Normalise git's XY porcelain code into a single status the UI can colour.
 * Conflicts win over everything else, then deletions, then the rest.
 * @param {string} code - The two porcelain letters, e.g. " M", "??", "R "
 * @returns {GitFileStatus}
 */
export const statusFromCode = (code: string): GitFileStatus => {
  const x = code[0];
  const y = code[1];

  if (code === '??') { return 'untracked'; }
  if (x === 'U' || y === 'U' || code === 'AA' || code === 'DD') { return 'conflicted'; }
  if (x === 'D' || y === 'D') { return 'deleted'; }
  if (x === 'R' || y === 'R') { return 'renamed'; }
  if (x === 'A' || y === 'A') { return 'added'; }
  return 'modified';
};

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * The NUL-separated form is the only one that survives paths containing
 * spaces, quotes or newlines: entries are "XY <path>", and a rename adds a
 * second NUL-terminated field holding the original path.
 *
 * @param {string} raw - Raw stdout
 * @returns {GitChange[]}
 */
export const parseStatus = (raw: string): GitChange[] => {
  const fields = String(raw || '').split('\0');
  const changes: GitChange[] = [];

  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry || entry.length < 4) { continue; }

    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const status = statusFromCode(code);

    const change: GitChange = {
      path: filePath,
      status,
      // "??" is not staged despite its X column not being a space
      staged: code !== '??' && code[0] !== ' ' && status !== 'conflicted',
      code
    };

    // A rename/copy spends a second field on where the file came from
    if (code[0] === 'R' || code[0] === 'C') {
      change.from = fields[++i];
    }

    changes.push(change);
  }

  return changes;
};

/**
 * Turn a remote URL into something a browser can open.
 * Handles the scp-like SSH form (git@host:owner/repo.git), ssh:// and
 * https:// alike, and gives up on anything else (a local path, say).
 * @param {string} url - The remote URL as git reports it
 * @returns {string|null}
 */
export const webUrlFromRemote = (url: string): string | null => {
  const value = String(url || '').trim();
  if (!value) { return null; }

  const stripSuffix = (input: string) => input.replace(/\.git$/i, '').replace(/\/+$/, '');

  // git@github.com:owner/repo.git
  const scpLike = value.match(/^[^@/\s]+@([^:/\s]+):(.+)$/);
  if (scpLike) {
    return stripSuffix(`https://${scpLike[1]}/${scpLike[2].replace(/^\/+/, '')}`);
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return stripSuffix(`${parsed.origin}${parsed.pathname}`);
    }
    if (parsed.protocol === 'ssh:' || parsed.protocol === 'git:') {
      return stripSuffix(`https://${parsed.hostname}${parsed.pathname}`);
    }
  }
  catch {
    // Not a URL we understand
  }

  return null;
};

/**
 * The remote a branch pushes to -- its upstream's, or "origin", or whichever
 * one exists. Returns null in a repository with no remotes at all.
 * @param {string} cwd
 * @param {string|null} upstream - e.g. "origin/main"
 * @returns {Promise<GitRemote|null>}
 */
const readRemote = async (cwd: string, upstream: string | null): Promise<GitRemote | null> => {
  let names: string[] = [];
  try {
    names = (await run(['remote'], cwd)).split('\n').map(name => name.trim()).filter(Boolean);
  }
  catch {
    return null;
  }

  if (!names.length) { return null; }

  const preferred = (upstream && upstream.includes('/') && upstream.split('/')[0]) || '';
  const name = names.includes(preferred)
    ? preferred
    : (names.includes('origin') ? 'origin' : names[0]);

  try {
    const url = await run(['remote', 'get-url', name], cwd);
    return { name, url, webUrl: webUrlFromRemote(url) };
  }
  catch {
    return null;
  }
};

/**
 * How far the checked out branch is from its upstream.
 * @param {string} cwd
 * @returns {Promise<{upstream: string|null, ahead: number, behind: number}>}
 */
const readTracking = async (cwd: string) => {
  try {
    const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
    const counts = await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], cwd);
    const [behind, ahead] = counts.split(/\s+/).map(value => Number(value) || 0);
    return { upstream, ahead: ahead || 0, behind: behind || 0 };
  }
  catch {
    // No upstream configured, or a branch that has never been pushed
    return { upstream: null, ahead: 0, behind: 0 };
  }
};

/**
 * Everything the UI needs to know about the repository a directory sits in.
 * Returns null when the directory is not inside a git repository (or git is
 * not installed) -- which is a perfectly normal way to use the app.
 *
 * @param {string} dir - Directory to inspect, usually the context directory
 * @returns {Promise<GitInfo|null>}
 */
export const info = async (dir: string): Promise<GitInfo | null> => {
  let root: string;
  try {
    root = await run(['rev-parse', '--show-toplevel'], dir);
  }
  catch {
    return null;
  }

  // --show-current, unlike rev-parse, still names the branch of a repository
  // that has no commits yet -- which is exactly the state a folder is in the
  // moment someone runs `git init` in it
  const current = await run(['branch', '--show-current'], dir).catch(() => '');
  const detached = !current;
  const branch = detached
    // A detached HEAD has no branch name; the short sha is the next best label
    ? await run(['rev-parse', '--short', 'HEAD'], dir).catch(() => null)
    : current;

  const tracking = await readTracking(dir);
  const remote = await readRemote(dir, tracking.upstream);
  // "-- ." scopes the answer to the directory we were asked about: in a
  // repository where the context folder is one directory among many, the
  // other directories are none of this app's business.
  const status = await run(['status', '--porcelain=v1', '-z', '-uall', '--', '.'], dir)
    .catch(() => '');

  const relative = path.relative(root, path.resolve(dir));

  return {
    root,
    prefix: relative ? relative.split(path.sep).join('/') : '',
    branch,
    upstream: tracking.upstream,
    ahead: tracking.ahead,
    behind: tracking.behind,
    detached,
    remote,
    changes: parseStatus(status)
  };
};

/**
 * Pull the upstream branch, rebasing local commits on top so the history the
 * user sees stays the one they wrote, and stashing what is uncommitted so a
 * dirty working copy is not a reason to refuse.
 * @param {string} dir
 * @returns {Promise<{output: string}>}
 */
export const pull = async (dir: string) => {
  const output = await run(['pull', '--rebase', '--autostash'], dir);
  return { output };
};

/**
 * Stage and commit. With no paths, everything that changed goes in; with
 * paths, only those (relative to the repository root).
 * @param {string} dir
 * @param {string} message - Commit message; required
 * @param {string[]} [paths] - Files to stage, relative to the repository root
 * @returns {Promise<{output: string}>}
 */
export const commit = async (dir: string, message: string, paths?: string[]) => {
  const text = String(message || '').trim();
  if (!text) {
    throw new Error('A commit message is required');
  }

  const targets = (paths || []).map(value => String(value)).filter(Boolean);
  // "--" keeps a path that looks like an option from being read as one, and
  // the "." fallback stages this directory only -- see info() above
  await run(['add', '-A', '--', ...(targets.length ? targets : ['.'])], dir);

  const staged = await run(['diff', '--cached', '--name-only'], dir);
  if (!staged.trim()) {
    throw new Error('Nothing staged to commit');
  }

  const output = await run(['commit', '-m', text], dir);
  return { output };
};

/**
 * Push the current branch. A branch with no upstream gets one, so the first
 * push from a freshly created branch works like every later one.
 * @param {string} dir
 * @returns {Promise<{output: string}>}
 */
export const push = async (dir: string) => {
  const current = await info(dir);
  if (!current) {
    throw new Error('Not a git repository');
  }
  if (!current.remote) {
    throw new Error('This repository has no remote to push to');
  }
  if (current.detached) {
    throw new Error('HEAD is detached: check out a branch before pushing');
  }

  const args = current.upstream
    ? ['push']
    : ['push', '--set-upstream', current.remote.name, current.branch as string];

  const output = await run(args, dir);
  return { output };
};

/**
 * A branch as the branch menu draws it: local branches, and the ones that so
 * far exist only on a remote.
 */
export interface GitBranchRef {
  /** As git names it: "main" for a local branch, "origin/main" for a remote one */
  name: string;
  /** true for the branch HEAD points at */
  current: boolean;
  /** e.g. "origin/main", for a local branch that tracks one */
  upstream: string | null;
  /** The remote a remote-tracking branch lives on, null for a local one */
  remote: string | null;
  /** The local branch checking a remote-tracking one out would create */
  local: string | null;
}

export interface GitBranches {
  current: string | null;
  local: GitBranchRef[];
  /** Remote-tracking branches with no local branch of that name yet */
  remote: GitBranchRef[];
}

/** The names of the configured remotes, or [] in a repository with none. */
const remoteNames = async (cwd: string): Promise<string[]> =>
  (await run(['remote'], cwd).catch(() => ''))
    .split('\n')
    .map(name => name.trim())
    .filter(Boolean);

/**
 * Split a remote-tracking branch's short name into its remote and the local
 * branch it stands for. Remote names may themselves contain slashes, so the
 * only way to cut the name in the right place is to know the remotes.
 * @param {string} name - e.g. "origin/feature/login"
 * @param {string[]} remotes - Configured remote names
 * @returns {{remote: string, local: string}|null} null when no remote matches
 */
export const splitRemoteBranch = (name: string, remotes: string[]) => {
  // Longest first, so "origin/backup" wins over "origin" when both exist
  const match = [...remotes]
    .sort((a, b) => b.length - a.length)
    .find(remote => name.startsWith(`${remote}/`));

  if (!match) { return null; }

  const local = name.slice(match.length + 1);
  // "origin/HEAD" is a symbolic ref to the remote's default branch, not a
  // branch anyone checks out by that name
  return local && local !== 'HEAD' ? { remote: match, local } : null;
};

/**
 * Every branch the repository knows about.
 *
 * Sorted by when each branch was last committed to, newest first: the branch
 * someone wants to switch back to is almost always one they were just on,
 * and an alphabetical list buries it under whatever starts with an "a".
 *
 * @param {string} dir - Directory inside the repository
 * @returns {Promise<GitBranches>}
 */
export const branches = async (dir: string): Promise<GitBranches> => {
  const format = ['%(refname:short)', '%(upstream:short)', '%(HEAD)'].join('%00');

  const heads = await run(
    ['for-each-ref', '--sort=-committerdate', `--format=${format}`, 'refs/heads'],
    dir
  ).catch(() => '');

  const local: GitBranchRef[] = heads.split('\n').filter(Boolean).map(line => {
    const [name, upstream, head] = line.split('\0');
    return {
      name,
      current: head === '*',
      upstream: upstream || null,
      remote: null,
      local: null
    };
  });

  const remotes = await remoteNames(dir);
  const known = new Set(local.map(branch => branch.name));

  const tracking = remotes.length
    ? await run(
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes'],
      dir
    ).catch(() => '')
    : '';

  const remote: GitBranchRef[] = [];
  for (const name of tracking.split('\n').filter(Boolean)) {
    const parts = splitRemoteBranch(name, remotes);
    // A remote branch that already has a local counterpart is that local
    // branch as far as the menu is concerned
    if (!parts || known.has(parts.local)) { continue; }

    remote.push({
      name,
      current: false,
      upstream: null,
      remote: parts.remote,
      local: parts.local
    });
  }

  return {
    current: local.find(branch => branch.current)?.name || null,
    local,
    remote
  };
};

/**
 * Whether a ref exists, by its full name.
 * @param {string} dir
 * @param {string} ref - e.g. "refs/heads/main"
 * @returns {Promise<boolean>}
 */
const refExists = (dir: string, ref: string): Promise<boolean> =>
  run(['show-ref', '--verify', '--quiet', ref], dir).then(() => true).catch(() => false);

/**
 * Check a name is one git would accept for a branch, and one that cannot be
 * read as an option. execFile keeps a name out of the shell; this keeps a
 * name starting with "-" out of git's own argument parsing.
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<string>} The trimmed name
 */
const validBranchName = async (dir: string, name: string): Promise<string> => {
  const value = String(name || '').trim();
  if (!value) {
    throw new Error('A branch name is required');
  }
  if (value.startsWith('-')) {
    throw new Error(`"${value}" is not a valid branch name`);
  }

  const ok = await run(['check-ref-format', '--branch', value], dir)
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    throw new Error(`"${value}" is not a valid branch name`);
  }

  return value;
};

/**
 * Switch branches, optionally creating one first.
 *
 * Picking a branch that only exists on a remote checks it out as a local
 * branch tracking it, which is what someone who just fetched expects to
 * happen when they pick it.
 *
 * Git refuses to switch when local changes would be lost; that refusal is
 * passed straight through rather than worked around, because "which of my
 * edits do I keep" is not a question this app should answer for anyone.
 *
 * @param {string} dir
 * @param {string} name - Branch to switch to, or to create with { create }
 * @param {Object} [options] - { create, from }
 * @returns {Promise<{output: string, branch: string}>}
 */
export const checkout = async (
  dir: string,
  name: string,
  options: { create?: boolean, from?: string } = {}
) => {
  const branch = await validBranchName(dir, name);

  if (options.create) {
    if (await refExists(dir, `refs/heads/${branch}`)) {
      throw new Error(`Branch "${branch}" already exists`);
    }

    const from = String(options.from || '').trim();
    if (from.startsWith('-')) {
      throw new Error(`"${from}" is not a valid starting point`);
    }

    const output = await report(['switch', '--create', branch, ...(from ? [from] : [])], dir);
    return { output, branch };
  }

  if (!(await refExists(dir, `refs/heads/${branch}`))) {
    const parts = splitRemoteBranch(branch, await remoteNames(dir));
    if (parts && await refExists(dir, `refs/remotes/${branch}`)) {
      const output = await report(['switch', '--track', branch], dir);
      return { output, branch: parts.local };
    }
  }

  const output = await report(['switch', branch], dir);
  return { output, branch };
};

/**
 * Bring every remote's branches up to date without touching the working
 * copy, so the branch menu can offer what the rest of the team pushed.
 * @param {string} dir
 * @returns {Promise<{output: string}>}
 */
export const fetch = async (dir: string) => {
  const output = await report(['fetch', '--all'], dir);
  return { output };
};
