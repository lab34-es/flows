import fs from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';

/**
 * Carrying a test-run folder from the agent back to the person.
 *
 * A finished run is a folder: run.json and a copy of each flow with its
 * results written in. The agent packs it into one string -- the file list as
 * JSON, gzipped, base64 -- and the person's side unpacks it into their own
 * test-runs folder, where the list, the report and the uploads find it
 * without knowing it ran elsewhere. No tar, no dependency: the folders are a
 * handful of text files.
 */

interface BundledFile {
  /** Relative to the run folder, forward slashes */
  path: string;
  /** base64 of the file's bytes */
  content: string;
}

interface Bundle {
  v: 1;
  files: BundledFile[];
}

const walk = (dir: string, base: string, files: BundledFile[]) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(absolute, base, files);
    }
    else if (entry.isFile()) {
      files.push({
        path: path.relative(base, absolute).split(path.sep).join('/'),
        content: fs.readFileSync(absolute).toString('base64')
      });
    }
  }
};

/**
 * A folder as one transportable string.
 * @param {string} dir - The run folder
 * @returns {string} base64 of the gzipped bundle
 */
const pack = (dir: string): string => {
  const files: BundledFile[] = [];
  walk(dir, dir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const bundle: Bundle = { v: 1, files };
  return gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8')).toString('base64');
};

/**
 * Write a packed folder out. Every path is checked to land inside the target
 * before anything is written: the bundle came over the network.
 * @param {string} packed - What `pack` returned
 * @param {string} dir - Where to write the files
 * @returns {string[]} The relative paths written
 */
const unpack = (packed: string, dir: string): string[] => {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));
  }
  catch {
    throw new Error('The result could not be unpacked');
  }

  if (!bundle || bundle.v !== 1 || !Array.isArray(bundle.files)) {
    throw new Error('The result is not a bundle this version can unpack');
  }

  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });

  const written: string[] = [];

  for (const file of bundle.files) {
    const target = path.resolve(root, String(file.path || ''));

    if (target === root || !target.startsWith(root + path.sep)) {
      throw new Error(`The result names a file outside the run folder: ${file.path}`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(String(file.content || ''), 'base64'));
    written.push(file.path);
  }

  return written;
};

export type { Bundle, BundledFile };
export { pack, unpack };
