/**
 * Package the extension as a .vsix, carrying the version of the release it
 * ships with.
 *
 * Nobody writes a version number in this repository (see CLAUDE.md):
 * release-please writes the root package.json, and everything that shows a
 * version reads it from there. The extension is released with the CLI it
 * drives, so its own package.json stays at 0.0.0, like the frontend's, and
 * the release's number is stamped into the .vsix here, on the way out.
 * Nothing is written back.
 *
 * vsce runs the "vscode:prepublish" script first, which bundles the extension
 * minified. The dependencies are inside the bundle, so vsce is told not to
 * look for them.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const { version } = require('../../../package.json');
const extension = path.join(__dirname, '..');
const out = path.join(extension, `ronsel-${version}.vsix`);

execFileSync(process.execPath, [
  path.join(extension, 'node_modules', '@vscode', 'vsce', 'vsce'),
  'package', version,
  '--no-update-package-json',
  '--no-git-tag-version',
  '--no-dependencies',
  '--out', out
], { cwd: extension, stdio: 'inherit' });
