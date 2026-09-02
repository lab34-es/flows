import fs from 'fs';
import os from 'os';
import path from 'path';

import * as bundle from '../../../src/helpers/remote/bundle';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-bundle-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('remote/bundle', () => {
  test('a packed folder unpacks to the same files', () => {
    const source = path.join(dir, 'run');
    fs.mkdirSync(path.join(source, 'payments'), { recursive: true });
    fs.writeFileSync(path.join(source, 'run.json'), '{"id":"run-1"}');
    fs.writeFileSync(path.join(source, 'payments', 'refund.md'), '# Refund\n\nresult');

    const packed = bundle.pack(source);
    expect(typeof packed).toBe('string');

    const target = path.join(dir, 'copy');
    const written = bundle.unpack(packed, target);

    expect(written).toEqual(['payments/refund.md', 'run.json']);
    expect(fs.readFileSync(path.join(target, 'run.json'), 'utf8')).toBe('{"id":"run-1"}');
    expect(fs.readFileSync(path.join(target, 'payments', 'refund.md'), 'utf8')).toBe('# Refund\n\nresult');
  });

  test('refuses a file that would land outside the folder', () => {
    const packed = Buffer.from(require('zlib').gzipSync(JSON.stringify({
      v: 1,
      files: [{ path: '../escape.txt', content: Buffer.from('x').toString('base64') }]
    }))).toString('base64');

    expect(() => bundle.unpack(packed, path.join(dir, 'target'))).toThrow('outside the run folder');
    expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(false);
  });

  test('refuses what is not a bundle', () => {
    expect(() => bundle.unpack('not base64 gzip', dir)).toThrow('could not be unpacked');

    const wrong = Buffer.from(require('zlib').gzipSync(JSON.stringify({ v: 9 }))).toString('base64');
    expect(() => bundle.unpack(wrong, dir)).toThrow('not a bundle this version can unpack');
  });
});
