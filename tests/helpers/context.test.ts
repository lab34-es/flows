// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

jest.mock('../../src/helpers/paths');
jest.mock('../../src/helpers/git');

import * as paths from '../../src/helpers/paths';
import * as git from '../../src/helpers/git';
import * as context from '../../src/helpers/context';

const CONTEXT = '/home/someone/lab34-flows';

const change = (filePath, status = 'modified') =>
  ({ path: filePath, status, staged: false, code: ' M' });

beforeEach(() => {
  jest.clearAllMocks();
  (paths.contextRoot as jest.Mock).mockResolvedValue(CONTEXT);
  (paths.hasCustomContext as jest.Mock).mockReturnValue(false);
});

describe('info', () => {
  test('describes the directory even when it is not a repository', async () => {
    (git.info as jest.Mock).mockResolvedValue(null);

    await expect(context.info()).resolves.toEqual({
      path: CONTEXT,
      name: 'lab34-flows',
      custom: false,
      git: null
    });
  });

  test('says when the directory came from --context', async () => {
    (paths.hasCustomContext as jest.Mock).mockReturnValue(true);
    (git.info as jest.Mock).mockResolvedValue(null);

    expect((await context.info()).custom).toBe(true);
  });

  test('at the repository root every change keeps its path', async () => {
    (git.info as jest.Mock).mockResolvedValue({
      root: CONTEXT,
      prefix: '',
      branch: 'main',
      changes: [change('flows/a.md'), change('applications/acme/index.ts')]
    });

    const info = await context.info();

    expect(info.git!.changes.map(entry => entry.contextPath))
      .toEqual(['flows/a.md', 'applications/acme/index.ts']);
  });

  test('below the root the prefix is stripped, and anything outside is null', async () => {
    (git.info as jest.Mock).mockResolvedValue({
      root: '/home/someone',
      prefix: 'lab34-flows',
      branch: 'main',
      changes: [
        change('lab34-flows/flows/a.md'),
        change('notes/todo.md'),
        // A path that merely starts with the same letters is not inside it
        change('lab34-flows-old/flows/b.md')
      ]
    });

    const info = await context.info();

    expect(info.git!.changes.map(entry => entry.contextPath))
      .toEqual(['flows/a.md', null, null]);
  });

  test('the whole git state is passed through untouched', async () => {
    (git.info as jest.Mock).mockResolvedValue({
      root: CONTEXT,
      prefix: '',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      detached: false,
      remote: { name: 'origin', url: 'x', webUrl: 'https://example.com/x' },
      changes: []
    });

    const info = await context.info();

    expect(info.git).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      remote: { webUrl: 'https://example.com/x' }
    });
  });
});

describe('pull, commit and push', () => {
  test('all act on the context directory', async () => {
    (git.pull as jest.Mock).mockResolvedValue({ output: 'pulled' });
    (git.push as jest.Mock).mockResolvedValue({ output: 'pushed' });
    (git.commit as jest.Mock).mockResolvedValue({ output: 'committed' });

    await expect(context.pull()).resolves.toEqual({ output: 'pulled' });
    expect(git.pull).toHaveBeenCalledWith(CONTEXT);

    await expect(context.push()).resolves.toEqual({ output: 'pushed' });
    expect(git.push).toHaveBeenCalledWith(CONTEXT);

    await context.commit({ message: 'why', paths: ['flows/a.md'] });
    expect(git.commit).toHaveBeenCalledWith(CONTEXT, 'why', ['flows/a.md']);
  });

  test('a commit with no arguments still reaches git, which validates it', async () => {
    (git.commit as jest.Mock).mockResolvedValue({ output: '' });

    await context.commit();

    expect(git.commit).toHaveBeenCalledWith(CONTEXT, '', []);
  });
});

describe('branches, checkout and fetch', () => {
  test('all act on the context directory', async () => {
    (git.branches as jest.Mock).mockResolvedValue({ current: 'main', local: [], remote: [] });
    (git.fetch as jest.Mock).mockResolvedValue({ output: 'fetched' });
    (git.checkout as jest.Mock).mockResolvedValue({ output: 'switched', branch: 'feature' });

    await expect(context.branches()).resolves.toEqual({ current: 'main', local: [], remote: [] });
    expect(git.branches).toHaveBeenCalledWith(CONTEXT);

    await expect(context.fetch()).resolves.toEqual({ output: 'fetched' });
    expect(git.fetch).toHaveBeenCalledWith(CONTEXT);

    await context.checkout({ branch: 'feature', create: true, from: 'main' });
    expect(git.checkout).toHaveBeenCalledWith(CONTEXT, 'feature', { create: true, from: 'main' });
  });

  test('a checkout with nothing to switch to still reaches git, which validates it', async () => {
    (git.checkout as jest.Mock).mockResolvedValue({ output: '', branch: '' });

    await context.checkout();

    expect(git.checkout).toHaveBeenCalledWith(CONTEXT, '', { create: false, from: undefined });
  });
});
