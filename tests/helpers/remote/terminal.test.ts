import * as terminal from '../../../src/helpers/remote/terminal';

/** Strip the colours: the words are what is asserted. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g');
const plain = (value: string | null) => (value || '').replace(ANSI, '');

describe('remote/terminal.describe', () => {
  test('job events become one line each', () => {
    expect(plain(terminal.describe('remote:job', { status: 'accepted' }))).toBe('  agent: job accepted');
    expect(plain(terminal.describe('remote:job', { status: 'preparing', message: 'Checking out abc' }))).toBe('  agent: Checking out abc');
    expect(plain(terminal.describe('remote:job', { status: 'preparing' }))).toBe('  agent: preparing');
    expect(plain(terminal.describe('remote:job', { status: 'running' }))).toBe('  agent: running');
    expect(plain(terminal.describe('remote:job', { status: 'finished', testRun: 'run-1' }))).toBe('  agent: finished (run-1)');
    expect(plain(terminal.describe('remote:job', { status: 'failed', message: 'no' }))).toBe('  agent: failed: no');
    expect(plain(terminal.describe('remote:job', { status: 'rejected' }))).toBe('  agent: rejected: ');
    expect(terminal.describe('remote:job', { status: 'other' })).toBeNull();
    expect(terminal.describe('remote:job', null)).toBeNull();
  });

  test('a run summary lists the flows that started', () => {
    const line = terminal.describe('testrun:update', {
      run: {
        flows: [
          { file: 'a.md', status: 'passed' },
          { file: 'b.md', status: 'failed', error: 'boom' },
          { file: 'c.md', status: 'running' },
          { file: 'd.md', status: 'pending' }
        ]
      }
    });

    expect(plain(line)).toBe('  passed   a.md\n  failed   b.md — boom\n  running  c.md');
    expect(terminal.describe('testrun:update', { run: { flows: [{ file: 'c.md', status: 'pending' }] } })).toBeNull();
    expect(terminal.describe('testrun:update', {})).toBeNull();
  });

  test('steps and the execution itself', () => {
    expect(plain(terminal.describe('flowexecution:update', {
      topic: 'step', data: { id: 's1', data: { id: 's1', execution: { status: 'passed' } } }
    }))).toBe('    passed   s1');

    expect(plain(terminal.describe('flowexecution:update', {
      topic: 'step', data: { id: 's2', data: { id: 's2', execution: { status: 'failed', error: { message: 'bad' } } } }
    }))).toBe('    failed   s2 — bad');

    expect(plain(terminal.describe('flowexecution:update', {
      topic: 'step', data: { id: 's3', data: { id: 's3' } }
    }))).toBe('    running  s3');

    expect(plain(terminal.describe('flowexecution:update', { topic: 'execution', data: { status: 'error' } }))).toBe('  execution error');
    expect(plain(terminal.describe('flowexecution:update', { topic: 'execution', data: { status: 'passed' } }))).toBe('  execution passed');
    expect(terminal.describe('flowexecution:update', { topic: 'execution', data: { status: 'running' } })).toBeNull();
    expect(terminal.describe('flowexecution:update', { topic: 'diagram', data: {} })).toBeNull();
    expect(terminal.describe('flowexecution:update', null)).toBeNull();
    expect(terminal.describe('something:else', {})).toBeNull();
  });
});

describe('remote/terminal.prompt', () => {
  test('reads one line from stdin', async () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const once = jest.spyOn(process.stdin, 'once').mockImplementation(((event, listener) => {
      listener(Buffer.from('  4711\n'));
      return process.stdin;
    }) as any);

    await expect(terminal.prompt({ id: 'i1', kind: 'text', label: 'Barcode' })).resolves.toBe('4711');
    expect(write).toHaveBeenCalled();

    once.mockRestore();
    write.mockRestore();
  });
});
