import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { argumentsFor, inspectorPort, launch, PROTOCOL } from '../src/core/process';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-process-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/**
 * A stand-in for the CLI, speaking its side of --ipc: it is started the way
 * the extension starts ronsel, and does what the case says.
 */
const fakeCli = (body: string) => {
  const file = path.join(scratch, `cli-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, `
const args = process.argv.slice(2);
const say = (message) => new Promise(resolve => process.send(message, resolve));
${body}
`);
  return file;
};

const base = { node: process.execPath, context: scratch, environment: 'local', files: ['flows/a.md'] };

/** Everything a run said, in order. */
const record = () => {
  const said: any[] = [];
  return {
    said,
    listener: {
      hello: (hello: any) => said.push(['hello', hello]),
      event: (event: string, payload: any) => said.push(['event', event, payload]),
      output: (text: string) => said.push(['output', text])
    }
  };
};

describe('argumentsFor', () => {
  test('names every file, in --ipc mode, on the context and the environment', () => {
    assert.deepEqual(argumentsFor({ ...base, script: '/r/cli.js', files: ['flows/a.md', 'flows/b.md'] }), [
      '/r/cli.js', '--context', scratch, '--ipc', '--env', 'local', '--file', 'flows/a.md', '--file', 'flows/b.md'
    ]);
  });

  test('or a view, scoped to a folder when it is', () => {
    assert.deepEqual(argumentsFor({ ...base, script: '/r/cli.js', files: undefined, view: 'Smoke tests', folder: 'payments' }).slice(6), [
      '--view', 'Smoke tests', '--folder', 'payments'
    ]);
    assert.deepEqual(argumentsFor({ ...base, script: '/r/cli.js', view: '' }).slice(6), ['--view', '']);
  });

  test('a debugged run starts paused, with the inspector on a free port', () => {
    assert.equal(argumentsFor({ ...base, script: '/r/cli.js', inspect: true })[0], '--inspect-brk=127.0.0.1:0');
  });
});

describe('inspectorPort', () => {
  test('reads the port node printed', () => {
    assert.equal(inspectorPort('Debugger listening on ws://127.0.0.1:41234/7d3c-11\nFor help, see: ...'), 41234);
    assert.equal(inspectorPort('nothing yet'), null);
  });
});

describe('launch', () => {
  test('passes on what the run says and prints, and how it ended', async () => {
    const script = fakeCli(`
(async () => {
  await say({ type: 'hello', protocol: ${PROTOCOL}, version: '2.3.0', context: process.cwd() });
  console.log('STEP 1 ' + args.join(' '));
  await say({ type: 'event', event: 'testrun:update', payload: { id: 'r1', run: { status: 'running', flows: [] } } });
  await say({ type: 'done', run: { id: 'r1', status: 'passed', flows: [] } });
  process.exit(0);
})();
`);
    const { said, listener } = record();

    const outcome = await launch({ ...base, script }, listener).done;

    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.hello, { protocol: PROTOCOL, version: '2.3.0', context: fs.realpathSync(scratch) });
    assert.deepEqual(outcome.run, { id: 'r1', status: 'passed', flows: [] });
    assert.equal(outcome.error, null);
    assert.equal(outcome.cancelled, false);
    assert.deepEqual(said.filter(entry => entry[0] === 'event'), [
      ['event', 'testrun:update', { id: 'r1', run: { status: 'running', flows: [] } }]
    ]);

    const printed = said.filter(entry => entry[0] === 'output').map(entry => entry[1]).join('');
    assert.match(printed, /STEP 1 --context .* --ipc --env local --file flows\/a.md/);
  });

  test('keeps the colours: the output lands in a terminal', async () => {
    const script = fakeCli('console.log(process.env.FORCE_COLOR + "," + process.env.EXTRA); process.exit(0);');
    const { said, listener } = record();

    await launch({ ...base, script, env: { EXTRA: 'yes' } }, listener).done;

    assert.match(said.map(entry => entry[1]).join(''), /^1,yes/);
  });

  test('says why a run could not start, as the CLI put it', async () => {
    const script = fakeCli(`
(async () => {
  await say({ type: 'hello', protocol: 1, version: '2.3.0', context: '' });
  await say({ type: 'error', message: 'Missing environment file for "uat": payments' });
  process.exit(1);
})();
`);
    const outcome = await launch({ ...base, script }, record().listener).done;

    assert.equal(outcome.code, 1);
    assert.equal(outcome.error, 'Missing environment file for "uat": payments');
    assert.equal(outcome.run, null);
  });

  test('a CLI too old to answer never says hello', async () => {
    const script = fakeCli('console.error("Unknown argument"); process.exit(1);');
    const { said, listener } = record();

    const outcome = await launch({ ...base, script }, listener).done;

    assert.equal(outcome.hello, null);
    assert.equal(outcome.code, 1);
    assert.match(said.map(entry => entry[1]).join(''), /Unknown argument/);
  });

  test('answers and refuses what steps ask', async () => {
    const script = fakeCli(`
const answers = [];
process.on('message', message => {
  answers.push(message);
  if (answers.length === 2) {
    say({ type: 'done', run: { answers } }).then(() => process.exit(0));
  }
});
say({ type: 'event', event: 'flowexecution:update', payload: { topic: 'input', data: { id: 'q1', status: 'pending' } } });
`);
    let running: ReturnType<typeof launch> | null = null;
    running = launch({ ...base, script }, {
      event: (_event, payload) => {
        if (payload.topic === 'input') {
          running!.answer('q1', '4006');
          running!.refuse('q2');
        }
      },
      output: () => {}
    });

    const outcome = await running.done;

    assert.deepEqual(outcome.run.answers, [
      { type: 'input', id: 'q1', value: '4006' },
      { type: 'input', id: 'q2', cancel: true }
    ]);
  });

  test('a cancel is asked for, so the run can record why it stopped', async () => {
    const script = fakeCli(`
process.on('message', message => {
  if (message.type === 'cancel') { console.log('cancelled: ' + message.reason); process.exit(130); }
});
say({ type: 'hello', protocol: 1, version: '2.3.0', context: '' });
setInterval(() => {}, 1000);
`);
    const { said, listener } = record();
    const running = launch({ ...base, script }, { ...listener, hello: () => running.cancel('Stopped from the editor') });

    const outcome = await running.done;

    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.code, 130);
    assert.match(said.map(entry => entry[1]).join(''), /cancelled: Stopped from the editor/);
  });

  test('a run that does not stop when asked is ended', async () => {
    const script = fakeCli(`
process.on('message', () => {});
say({ type: 'hello', protocol: 1, version: '2.3.0', context: '' });
setInterval(() => {}, 1000);
`);
    const running = launch({ ...base, script, graceMs: 200 }, {
      event: () => {},
      output: () => {},
      hello: () => running.cancel()
    });

    const outcome = await running.done;

    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.signal, 'SIGTERM');
  });

  test('a cancel once the channel is gone ends the process outright', async () => {
    const script = fakeCli(`
process.disconnect();
console.log('ready');
setInterval(() => {}, 1000);
`);
    const running = launch({ ...base, script }, {
      event: () => {},
      output: (text) => { if (text.includes('ready')) { running.cancel(); } }
    });

    const outcome = await running.done;

    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.signal, 'SIGTERM');
  });

  test('tells where the inspector listens, when the run is debugged', async () => {
    const script = fakeCli('process.exit(0);');
    let port: number | null = null;

    // node opens the inspector, on the flag the launch adds, and waits there
    // for a debugger that is not coming: the run is ended once the port is known
    const running = launch({ ...base, script, inspect: true, graceMs: 100 }, {
      event: () => {},
      output: () => {},
      inspector: (found) => {
        port = found;
        running.cancel();
      }
    });
    const outcome = await running.done;

    assert.ok(port !== null && port > 0);
    assert.equal(outcome.cancelled, true);
  });

  test('a node that is not there is said plainly', async () => {
    const outcome = await launch({ ...base, node: path.join(scratch, 'no-node'), script: 'cli.js' }, record().listener).done;

    assert.match(outcome.error || '', /^Could not start .*no-node: .*ENOENT/);
    assert.equal(outcome.hello, null);
  });

  test('a spawn that throws is said plainly too', async () => {
    const outcome = await launch({ ...base, script: 'cli.js' }, record().listener, () => { throw new Error('EPERM'); }).done;

    assert.equal(outcome.error, `Could not start ${process.execPath}: EPERM`);
  });

  test('ignores messages it does not understand', async () => {
    const script = fakeCli(`
(async () => {
  await say('hello');
  await say({ type: 'what' });
  process.exit(0);
})();
`);
    const { said, listener } = record();

    const outcome = await launch({ ...base, script }, listener).done;

    assert.equal(outcome.code, 0);
    assert.deepEqual(said.filter(entry => entry[0] !== 'output'), []);
  });
});
