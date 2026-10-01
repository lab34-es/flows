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
 *
 * The README is shown by the Extensions view and the Marketplace, away from
 * the repository, so vsce turns its relative links into addresses on GitHub.
 * Left to guess, it takes them as relative to the root of the repository, but
 * the README sits in editors/vscode -- and its screenshots, shared with the
 * root README, in .github/screenshots. It is told where the README really is.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const { version } = require('../../../package.json');
const { repository } = require('../package.json');

const extension = path.join(__dirname, '..');
const out = path.join(extension, `ronsel-${version}.vsix`);

// https://github.com/<owner>/<repository>, and the folder the README is in
const github = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const at = (kind) => `${github}/${kind}/HEAD/${repository.directory}`;

execFileSync(process.execPath, [
  path.join(extension, 'node_modules', '@vscode', 'vsce', 'vsce'),
  'package', version,
  '--no-update-package-json',
  '--no-git-tag-version',
  '--no-dependencies',
  '--baseContentUrl', at('blob'),
  '--baseImagesUrl', at('raw'),
  '--out', out
], { cwd: extension, stdio: 'inherit' });
