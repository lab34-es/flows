# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`ronsel` — a CLI and web UI for running E2E flows written as Markdown
documents, and a VS Code extension that runs them from the editor. Three
package trees, each with its own `package.json`:

| Tree | What it is | Ships to npm? |
| --- | --- | --- |
| `.` (root) | CLI, API, helpers. TypeScript → CommonJS in `dist/` | yes (`files: ["dist", …]`) |
| `frontend/` | The web UI (React + Vite + Tailwind) | yes, folded into `dist/frontend` |
| `editors/vscode/` | The VS Code extension (TypeScript, bundled by esbuild) | no: its `.vsix` is attached to each GitHub release |

Every dependency is pinned exactly (`.npmrc` sets `save-exact=true`). Node
version comes from `.nvmrc` everywhere — CI, `nvm use`.

The documentation is not here. It lives in **lab34-es/ronsel-website** and is
published at <https://ronsel.lab34.es/>; the **Help** button in the top bar
opens `/docs/` there. The tool used to carry the articles itself, under
`frontend/src/components/help`, and the site read them out of this repository —
that is gone, and a documentation change is a pull request against the website
repository, not this one.

---

## Publishing a new version

### The one rule

**Nobody writes a version number. Ever.** Not you, not the GitHub release UI,
not an agent. `release-please` derives it from the conventional commits on
master and writes `package.json`, `package-lock.json`, `CHANGELOG.md`, the
`v<version>` tag and the GitHub release in a single act. They cannot disagree,
because they are never written separately.

Everything that shows a version still reads it from the root `package.json`:

- `ronsel --version` (and `-v`) — `src/cli.ts`
- the banner in `ronsel --help` and the CLI logo on every run
- the web UI sidebar title — baked into the bundle by `define` in
  `frontend/vite.config.ts`, which reads `../package.json`
- the git tag: `v<version>`, exactly

`frontend/package.json` stays at `0.0.0` on purpose — it is private and never
published. Do not bump it; release-please does not touch it either. The same
goes for `editors/vscode/package.json`: the extension is released with the CLI
it drives, and `editors/vscode/scripts/package.js` stamps the root version into
the `.vsix` as it packages it, writing nothing back.

### The release, step by step

1. **Merge your work into master under a conventional commit title.** The
   repository squash-merges, so the pull request title becomes the commit
   message on master, and the `pr-title` job in `ci.yml` rejects a title that
   cannot be parsed. The type decides the bump: `fix:` → patch, `feat:` →
   minor, `feat!:` or a `BREAKING CHANGE:` footer → major. `chore:`, `docs:`,
   `ci:` and `test:` release nothing on their own.

   Note the space: `feat: upload via playwright` parses, `feat:upload via
   playwright` does not — it is read as an ordinary message and released as
   nothing.

2. **Let the release pull request accumulate.** After each push to master the
   `release` job opens or updates a pull request titled
   `chore(master): release x.y.z`, carrying the bump, the lockfile and the
   generated changelog. It is an ordinary pull request: read its changelog to
   see exactly what the next version would contain.

3. **Merge it when you want to ship.** That is the entire release. The push
   re-runs every gate against the release commit; then `release` tags it
   `v<version>` and creates the GitHub release, and `publish` builds the
   frontend and the package and publishes to npm with provenance.

4. **Check it landed.**

   ```bash
   npm view ronsel version
   npx -y ronsel@<version> --version
   ```

The `release` job needs one repository setting that is easy to miss:
**Settings → Actions → General → Workflow permissions** must have *Allow
GitHub Actions to create and approve pull requests* ticked — on the `lab34-es`
organisation as well as on this repository, since the organisation setting
caps the repository one. Without it release-please cannot open the release
pull request at all, and fails with "GitHub Actions is not permitted to create
or approve pull requests".

### Never bump by hand

Do not run `npm version`, do not edit the version in `package.json`, do not
push a `v*` tag and do not cut a release from the GitHub UI. Each of those puts
a second writer on a number that has exactly one, and this repository has the
scar tissue: seven tags in its history point at commits whose `package.json`
named a different version, and not one of them published anything. Five of the
seven sit on a bot's `Update the ... badge` commit, which is why the badges no
longer land on master.

If a release genuinely needs a version the commits would not produce, say so in
`release-please-config.json` (`release-as`) rather than typing a number into a
file.

### Never run the release by hand

The build and the checks belong to GitHub Actions. Do not run the gates locally
as a pre-flight, and do not build `dist/` on your machine to "make sure" — the
release pipeline builds from a clean checkout of the released commit, and
anything produced locally is neither what ships nor evidence about what ships.

### Never publish from a laptop

Do not run `npm publish` locally. The package uses npm **trusted publishing**:
the `publish` job exchanges a short-lived GitHub OIDC token for a publish
credential, which is also what attaches provenance to the release. There is no
`NPM_TOKEN` anywhere, and a local publish would ship a release with no
provenance from an unverified tree.

The trusted publisher configured on npmjs.com names this repository **and the
workflow file `ci.yml`**. Moving the `publish` job to another file without
updating it there fails the token exchange, and npm reports that only as a bare
`ENEEDAUTH` — re-run with `--loglevel=verbose` to see the real reason.

### The badges

The coverage and CodeQL SVGs are generated by the `badges` job and pushed to an
orphan `badges` branch, never to master, and the README links to that branch.
A bot commit on master steals the tip of the branch; that is how five tags came
to sit on `Update the coverage badge` instead of on a release commit, and it is
also what produced the `Merge branch 'master' of github.com:lab34-es/ronsel`
commits — the bot had pushed while you were working.

The branch is created once, by hand. `git switch --orphan` empties the working
tree, so the SVGs have to be copied out before the switch, not after:

```bash
mkdir -p /tmp/flows-badges && cp .github/badges/*.svg /tmp/flows-badges/
git switch --orphan badges
cp /tmp/flows-badges/*.svg .
git add coverage.svg codeql.svg
git commit -m 'badges: initial branch'
git push -u origin badges
git switch master
```

If the SVGs are not in the tree, generate them first: `npm run coverage:badge`
writes the coverage one and `CODEQL_OPEN_ALERTS=0 node scripts/codeql-badge.js`
the other. `.github/badges/*.svg` is gitignored — the scripts still write there
locally, the files are just never committed.

### The documentation is a separate repository

The docs live in **lab34-es/ronsel-website** and deploy themselves to GitHub
Pages. Nothing about them touches this release: a docs change never bumps a
version here, and a release here never republishes the site.

The one thing that couples them is the address. `DOCS` in
`frontend/src/components/shared/TopBar.tsx` is where the **Help** button goes;
if the site ever moves off `ronsel.lab34.es`, that constant and the outbound
links in `AppSidebar.tsx` are what have to follow it.

### When a release goes wrong

- **Published a broken version.** npm versions are immutable — do not try to
  unpublish. Land a `fix:` commit and merge the next release pull request.
- **No release pull request appeared.** Nothing since the last release was a
  `feat:` or a `fix:`, or the commit titles did not parse. Check them on
  master.
- **`publish` failed after the tag was created.** Use **Re-run failed jobs**,
  not **Re-run all jobs**: a full re-run finds the release already made, so
  `release_created` comes back false and the publish is skipped. A partial
  re-run keeps the outputs of the jobs that succeeded.
- **UI shows the old version.** It cannot any more — `publish` checks out the
  tag and `prepublishOnly` rebuilds the frontend from that tree, so the
  version Vite bakes in is the one being published.

---

## The VS Code extension

`editors/vscode` makes flows tests, the way VS Code shows tests: the Testing
view lists every context of the workspace (and those `ronsel.contexts` adds
from elsewhere), every ` ```step ` block is a test item with the range of its
block -- which is what puts a check or a cross in the gutter -- and runs land
in an Executions view in the panel, read from the contexts' `test-runs`.

It bundles nothing of ronsel. A run is one process of the ronsel the context
depends on: `ronsel --context <ctx> --ipc --env <env> --file <flow>...`
(`src/helpers/ipc.ts`). Over the IPC channel the CLI sends `hello`, then the
very events the web UI's socket gets (`flowexecution:update`,
`testrun:update`), then `done`; the editor answers inputs and sends `cancel`.
That is a contract between two trees, so:

- **The protocol is versioned.** `PROTOCOL` in `src/helpers/ipc.ts` and in
  `editors/vscode/src/core/process.ts` move together, and only when a message
  changes shape -- a new message or field is not a new protocol.
- **The extension restates two rules of the package.** Which fences are steps,
  and the ids the runner gives them (`buildSteps` in `runner/v1`), are
  re-implemented in `editors/vscode/src/core/flowParser.ts`, because the editor
  needs line numbers the package never computes. Changing either rule means
  changing both, or the marks land on the wrong lines.
- **Events are the UI's.** The extension reads them in
  `editors/vscode/src/core/tracker.ts`; `test/run-events.json` there is a
  recording of a real run, so a change to what the runner emits shows up as a
  failing test of the extension.

`src/core` holds everything that does not need VS Code and is unit tested with
node's own runner (`npm test --prefix editors/vscode`); the files above it use
the editor's API and are tried by hand: **Run the VS Code extension** in the
root `.vscode/launch.json` opens an Extension Development Host with it loaded.
CI's `extension` job gates it, and on a release the `vsix` job attaches the
packaged `.vsix` to the GitHub release. Publishing to the Marketplace and to
Open VSX is not set up: it needs the `lab34` publisher and its tokens.

---

## Working in this repo

```bash
npm run dev              # API on :3001 + UI on :3000, both live-reloading
npm run dev:api          # API only (tsx, no build step)
npm run frontend         # UI only, Vite HMR on :3000
npm run build            # src/ -> dist/, plus the bundled examples
npm test                 # jest
npm run coverage:badge   # refresh .github/badges/coverage.svg
```

There is no folder of the tool's in the home directory. Everything a run reads
and writes lives in the *context*: the directory `--context` names, or the one
the command was run from, which the CLI asks about before settling on it. An
empty context is furnished with the bundled examples on first start; a
directory with anything already in it is served exactly as it is, and nothing
of ours is written into it. `npm run dev` therefore works in `.dev-context/`,
a gitignored folder the script creates so development never seeds the
repository itself.

### The address is chosen at start, never written down

No port is a constant any more. `helpers/net` picks the first free one from
3001 up (`--port` or `PORT` move the starting point), builds the CORS and
socket origins from what it settled on, and `api.start` returns the URL so the
CLI prints it -- one copyable line, always -- and opens the browser on it
(`helpers/browser`, which shells out to `open`, `start` or `xdg-open`, and is
injectable so tests launch nothing). It listens on `127.0.0.1`: this API has
no authentication and serves the context's env values, so exposing it is
`--host`'s job, and that prints a warning. Nothing of this reaches the bundle
-- `frontend/src/services/api.ts` and `socket.ts` use relative URLs, so the UI
follows whatever port served it. Keep it that way.

The one place a port is still fixed is the Vite dev proxy, and only for
`npm run dev`: `frontend/vite.config.ts` reads `PORT` with 3001 as its
default, the same variable the API reads, so `PORT=3005 npm run dev` moves
both. If the API had to move because its port was busy, restart `npm run dev`
with `PORT` naming a free one rather than teaching the proxy to guess.

While working on a change, `npm run lint`, `npm run typecheck` and `npm test`
are the fast local feedback loop (add the `--prefix frontend` equivalents when
the UI changed). They are a convenience, not the gate: `ci.yml` decides both
what lands and what ships. CI enforces coverage of `src/`
above 80% on statements, branches, functions and
lines; coverage is collected from all of `src/`, not just what tests import, so
new files need tests to land.
