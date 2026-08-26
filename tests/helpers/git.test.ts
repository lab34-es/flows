// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as git from '../../src/helpers/git';

/**
 * The unit under test is the git binary's own behaviour as much as it is our
 * parsing of it, so these run against real repositories in a temp directory.
 */
let repo: string;

const init = async (dir: string) => {
  await git.run(['init', '--initial-branch=main', dir], os.tmpdir());
  // A repository with no identity refuses to commit, and CI has none
  await git.run(['config', 'user.email', 'test@example.com'], dir);
  await git.run(['config', 'user.name', 'Test'], dir);
  await git.run(['config', 'commit.gpgsign', 'false'], dir);
};

const write = (dir: string, relative: string, content: string) => {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-git-'));
  // macOS hands out /var, which is a symlink to /private/var: resolve it now
  // or every path comparison against git's own answer fails
  repo = fs.realpathSync(repo);
  await init(repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('statusFromCode', () => {
  test.each([
    ['??', 'untracked'],
    [' M', 'modified'],
    ['M ', 'modified'],
    ['A ', 'added'],
    [' D', 'deleted'],
    ['D ', 'deleted'],
    ['R ', 'renamed'],
    ['UU', 'conflicted'],
    ['AA', 'conflicted'],
    ['DD', 'conflicted'],
    ['AU', 'conflicted']
  ])('%s is %s', (code, expected) => {
    expect(git.statusFromCode(code)).toBe(expected);
  });
});

describe('parseStatus', () => {
  test('reads NUL separated entries', () => {
    const raw = ' M flows/a.md\0?? flows/b.md\0';
    expect(git.parseStatus(raw)).toEqual([
      { path: 'flows/a.md', status: 'modified', staged: false, code: ' M' },
      { path: 'flows/b.md', status: 'untracked', staged: false, code: '??' }
    ]);
  });

  test('a rename carries the path it came from', () => {
    const raw = 'R  flows/new.md\0flows/old.md\0 M flows/c.md\0';
    const changes = git.parseStatus(raw);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ path: 'flows/new.md', from: 'flows/old.md', staged: true });
    expect(changes[1].path).toBe('flows/c.md');
  });

  test('a staged change is marked as such, an untracked one never is', () => {
    const changes = git.parseStatus('M  a.md\0?? b.md\0');
    expect(changes[0].staged).toBe(true);
    expect(changes[1].staged).toBe(false);
  });

  test('empty output means no changes', () => {
    expect(git.parseStatus('')).toEqual([]);
    expect(git.parseStatus(null as any)).toEqual([]);
  });
});

describe('webUrlFromRemote', () => {
  test.each([
    ['git@github.com:lab34-es/lab34-flows.git', 'https://github.com/lab34-es/lab34-flows'],
    ['git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo'],
    ['https://github.com/lab34-es/lab34-flows.git', 'https://github.com/lab34-es/lab34-flows'],
    ['https://gitlab.com/group/sub/repo', 'https://gitlab.com/group/sub/repo'],
    ['ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo']
  ])('%s becomes %s', (url, expected) => {
    expect(git.webUrlFromRemote(url)).toBe(expected);
  });

  test('a local path has no web address', () => {
    expect(git.webUrlFromRemote('/srv/repos/flows.git')).toBeNull();
    expect(git.webUrlFromRemote('')).toBeNull();
  });
});

describe('info', () => {
  test('a directory outside any repository has no git state', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-plain-'));
    // A temp dir can still sit inside a repository on a developer's machine;
    // GIT_CEILING_DIRECTORIES is what makes the answer deterministic
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir());

    try {
      await expect(git.info(plain)).resolves.toBeNull();
    }
    finally {
      process.env.GIT_CEILING_DIRECTORIES = previous;
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  test('reports the branch, the root and what changed', async () => {
    write(repo, 'flows/one.md', '# one');
    write(repo, 'README.md', 'hello');

    const state = await git.info(repo);

    expect(state).not.toBeNull();
    expect(state!.root).toBe(repo);
    expect(state!.prefix).toBe('');
    expect(state!.branch).toBe('main');
    expect(state!.upstream).toBeNull();
    expect(state!.ahead).toBe(0);
    expect(state!.behind).toBe(0);
    expect(state!.remote).toBeNull();
    expect(state!.changes.map(change => change.path).sort())
      .toEqual(['README.md', 'flows/one.md']);
    expect(state!.changes.every(change => change.status === 'untracked')).toBe(true);
  });

  test('a subdirectory reports its prefix and only its own changes', async () => {
    write(repo, 'flows/one.md', '# one');
    write(repo, 'elsewhere/two.md', '# two');

    const state = await git.info(path.join(repo, 'flows'));

    expect(state!.root).toBe(repo);
    expect(state!.prefix).toBe('flows');
    expect(state!.changes.map(change => change.path)).toEqual(['flows/one.md']);
  });

  test('the remote is reported with a browsable address', async () => {
    await git.run(['remote', 'add', 'origin', 'git@github.com:lab34-es/demo.git'], repo);

    const state = await git.info(repo);

    expect(state!.remote).toEqual({
      name: 'origin',
      url: 'git@github.com:lab34-es/demo.git',
      webUrl: 'https://github.com/lab34-es/demo'
    });
  });

  test('a detached HEAD is labelled with its sha', async () => {
    write(repo, 'a.md', 'a');
    await git.commit(repo, 'first');
    const sha = await git.run(['rev-parse', '--short', 'HEAD'], repo);
    await git.run(['checkout', '--detach', sha], repo);

    const state = await git.info(repo);

    expect(state!.detached).toBe(true);
    expect(state!.branch).toBe(sha);
  });
});

describe('commit', () => {
  test('stages and commits everything by default', async () => {
    write(repo, 'flows/one.md', '# one');
    write(repo, 'flows/two.md', '# two');

    await git.commit(repo, 'add the flows');

    expect(await git.run(['log', '--oneline'], repo)).toContain('add the flows');
    expect((await git.info(repo))!.changes).toEqual([]);
  });

  test('given paths, only those are committed', async () => {
    write(repo, 'one.md', '# one');
    write(repo, 'two.md', '# two');

    await git.commit(repo, 'only one', ['one.md']);

    const left = (await git.info(repo))!.changes;
    expect(left.map(change => change.path)).toEqual(['two.md']);
  });

  test('an empty message is refused before anything is staged', async () => {
    write(repo, 'one.md', '# one');
    await expect(git.commit(repo, '   ')).rejects.toThrow('commit message is required');
    expect((await git.info(repo))!.changes).toHaveLength(1);
  });

  test('a clean working copy has nothing to commit', async () => {
    await expect(git.commit(repo, 'nothing')).rejects.toThrow('Nothing staged');
  });
});

describe('push', () => {
  test('is refused without a remote', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await expect(git.push(repo)).rejects.toThrow('no remote');
  });

  test('a first push sets the upstream, and the next one is plain', async () => {
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-')));
    // The bare repo's HEAD has to name the same branch we push, or the clone
    // below lands on an unrelated one
    await git.run(['init', '--bare', '--initial-branch=main', remote], os.tmpdir());
    await git.run(['remote', 'add', 'origin', remote], repo);

    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.push(repo);

    let state = await git.info(repo);
    expect(state!.upstream).toBe('origin/main');
    expect(state!.ahead).toBe(0);

    write(repo, 'two.md', '# two');
    await git.commit(repo, 'second');
    expect((await git.info(repo))!.ahead).toBe(1);

    await git.push(repo);
    state = await git.info(repo);
    expect(state!.ahead).toBe(0);

    fs.rmSync(remote, { recursive: true, force: true });
  });

  test('is refused on a detached HEAD', async () => {
    await git.run(['remote', 'add', 'origin', 'git@example.com:owner/repo.git'], repo);
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    const sha = await git.run(['rev-parse', '--short', 'HEAD'], repo);
    await git.run(['checkout', '--detach', sha], repo);

    await expect(git.push(repo)).rejects.toThrow('detached');
  });

  test('outside a repository there is nothing to push', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-plain-'));
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir());

    try {
      await expect(git.push(plain)).rejects.toThrow('Not a git repository');
    }
    finally {
      process.env.GIT_CEILING_DIRECTORIES = previous;
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('pull', () => {
  test('brings the remote commits in, and reports being behind before that', async () => {
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-')));
    // The bare repo's HEAD has to name the same branch we push, or the clone
    // below lands on an unrelated one
    await git.run(['init', '--bare', '--initial-branch=main', remote], os.tmpdir());
    await git.run(['remote', 'add', 'origin', remote], repo);

    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.push(repo);

    // A second clone commits behind our back, the way a colleague would
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-other-')));
    await git.run(['clone', remote, other], os.tmpdir());
    await git.run(['config', 'user.email', 'other@example.com'], other);
    await git.run(['config', 'user.name', 'Other'], other);
    write(other, 'theirs.md', '# theirs');
    await git.commit(other, 'from the other side');
    await git.push(other);

    await git.run(['fetch'], repo);
    expect((await git.info(repo))!.behind).toBe(1);

    await git.pull(repo);

    expect(fs.existsSync(path.join(repo, 'theirs.md'))).toBe(true);
    expect((await git.info(repo))!.behind).toBe(0);

    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });
});

describe('run', () => {
  test('a failing command rejects with what git said', async () => {
    await expect(git.run(['rev-parse', '--verify', 'nope'], repo)).rejects.toThrow();
  });
});

describe('splitRemoteBranch', () => {
  test('cuts the name at the remote it belongs to', () => {
    expect(git.splitRemoteBranch('origin/main', ['origin']))
      .toEqual({ remote: 'origin', local: 'main' });
    // A branch name may itself contain slashes
    expect(git.splitRemoteBranch('origin/feature/login', ['origin']))
      .toEqual({ remote: 'origin', local: 'feature/login' });
  });

  test('prefers the longest remote that matches', () => {
    expect(git.splitRemoteBranch('origin/backup/main', ['origin', 'origin/backup']))
      .toEqual({ remote: 'origin/backup', local: 'main' });
  });

  test('ignores a remote HEAD and anything from an unknown remote', () => {
    expect(git.splitRemoteBranch('origin/HEAD', ['origin'])).toBeNull();
    expect(git.splitRemoteBranch('upstream/main', ['origin'])).toBeNull();
  });
});

describe('branches', () => {
  test('lists the local branches, newest work first, and marks the current one', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.checkout(repo, 'feature', { create: true });
    write(repo, 'two.md', '# two');
    await git.commit(repo, 'second');

    const list = await git.branches(repo);

    expect(list.current).toBe('feature');
    expect(list.local.map(branch => branch.name)).toEqual(['feature', 'main']);
    expect(list.local[0].current).toBe(true);
    expect(list.local[1].current).toBe(false);
    expect(list.remote).toEqual([]);
  });

  test('a branch that only a remote has is listed apart, under its local name', async () => {
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-')));
    await git.run(['init', '--bare', '--initial-branch=main', remote], os.tmpdir());
    await git.run(['remote', 'add', 'origin', remote], repo);

    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.push(repo);

    // Someone else's branch: pushed, then gone from this working copy
    await git.checkout(repo, 'theirs', { create: true });
    write(repo, 'two.md', '# two');
    await git.commit(repo, 'second');
    await git.push(repo);
    await git.checkout(repo, 'main');
    await git.run(['branch', '-D', 'theirs'], repo);

    const list = await git.branches(repo);

    expect(list.local.map(branch => branch.name)).toEqual(['main']);
    expect(list.local[0].upstream).toBe('origin/main');
    expect(list.remote.map(branch => branch.name)).toEqual(['origin/theirs']);
    expect(list.remote[0].local).toBe('theirs');
    expect(list.remote[0].remote).toBe('origin');

    fs.rmSync(remote, { recursive: true, force: true });
  });

  test('a repository with no commits has no branches to offer', async () => {
    await expect(git.branches(repo)).resolves.toEqual({ current: null, local: [], remote: [] });
  });
});

describe('checkout', () => {
  test('creates a branch and switches to it', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');

    const result = await git.checkout(repo, 'feature/login', { create: true });

    expect(result.branch).toBe('feature/login');
    expect((await git.info(repo))!.branch).toBe('feature/login');
  });

  test('switches back to a branch that already exists', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.checkout(repo, 'feature', { create: true });

    await git.checkout(repo, 'main');

    expect((await git.info(repo))!.branch).toBe('main');
  });

  test('refuses to create a branch that is already there', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.checkout(repo, 'feature', { create: true });
    await git.checkout(repo, 'main');

    await expect(git.checkout(repo, 'feature', { create: true }))
      .rejects.toThrow('already exists');
  });

  test('refuses a name git would not accept, or one that reads as an option', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');

    await expect(git.checkout(repo, '')).rejects.toThrow('required');
    await expect(git.checkout(repo, 'has space')).rejects.toThrow('not a valid branch name');
    await expect(git.checkout(repo, '--orphan')).rejects.toThrow('not a valid branch name');
    await expect(git.checkout(repo, 'bad..name')).rejects.toThrow('not a valid branch name');
  });

  test('picking a remote-only branch checks it out as a local one that tracks it', async () => {
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-')));
    await git.run(['init', '--bare', '--initial-branch=main', remote], os.tmpdir());
    await git.run(['remote', 'add', 'origin', remote], repo);

    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.push(repo);
    await git.checkout(repo, 'theirs', { create: true });
    await git.push(repo);
    await git.checkout(repo, 'main');
    await git.run(['branch', '-D', 'theirs'], repo);

    const result = await git.checkout(repo, 'origin/theirs');

    expect(result.branch).toBe('theirs');
    const state = await git.info(repo);
    expect(state!.branch).toBe('theirs');
    expect(state!.upstream).toBe('origin/theirs');

    fs.rmSync(remote, { recursive: true, force: true });
  });
});

describe('fetch', () => {
  test('brings in a branch pushed to the remote by someone else', async () => {
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-')));
    await git.run(['init', '--bare', '--initial-branch=main', remote], os.tmpdir());
    await git.run(['remote', 'add', 'origin', remote], repo);

    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');
    await git.push(repo);

    // A second clone stands in for the rest of the team
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flows-other-')));
    await git.run(['clone', remote, other], os.tmpdir());
    await git.run(['config', 'user.email', 'test@example.com'], other);
    await git.run(['config', 'user.name', 'Test'], other);
    await git.run(['config', 'commit.gpgsign', 'false'], other);
    await git.checkout(other, 'theirs', { create: true });
    write(other, 'two.md', '# two');
    await git.commit(other, 'second');
    await git.push(other);

    expect((await git.branches(repo)).remote).toEqual([]);

    await git.fetch(repo);

    expect((await git.branches(repo)).remote.map(branch => branch.local)).toEqual(['theirs']);

    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });

  test('a repository with no remote has nothing to fetch, and says so quietly', async () => {
    write(repo, 'one.md', '# one');
    await git.commit(repo, 'first');

    await expect(git.fetch(repo)).resolves.toEqual({ output: '' });
  });
});
