# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`@lab34/flows` — a CLI and web UI for running E2E flows written as Markdown
documents. Three package trees, each with its own `package.json`:

| Tree | What it is | Ships to npm? |
| --- | --- | --- |
| `.` (root) | CLI, API, helpers. TypeScript → CommonJS in `dist/` | yes (`files: ["dist", …]`) |
| `frontend/` | The web UI (React + Vite + Tailwind) | yes, folded into `dist/frontend` |
| `website/` | The documentation site (Astro → GitHub Pages) | no |

Every dependency is pinned exactly (`.npmrc` sets `save-exact=true`). Node
version comes from `.nvmrc` everywhere — CI, the website build, `nvm use`.

---

## Publishing a new version

### The one rule

**Nobody writes a version number. Ever.** Not you, not the GitHub release UI,
not an agent. `release-please` derives it from the conventional commits on
master and writes `package.json`, `package-lock.json`, `CHANGELOG.md`, the
`v<version>` tag and the GitHub release in a single act. They cannot disagree,
because they are never written separately.

Everything that shows a version still reads it from the root `package.json`:

- `lab34-flows --version` (and `-v`) — `src/cli.ts`
- the banner in `lab34-flows --help` and the CLI logo on every run
- the web UI sidebar title — baked into the bundle by `define` in
  `frontend/vite.config.ts`, which reads `../package.json`
- the git tag: `v<version>`, exactly

`frontend/package.json` stays at `0.0.0` on purpose — it is private and never
published. Do not bump it; release-please does not touch it either.

### The release, step by step

1. **Merge your work into master under a conventional commit title.** The
   repository squash-merges, so the pull request title becomes the commit
   message on master, and the `pr-title` job in `ci.yml` rejects a title that
   cannot be parsed. The type of that title decides the bump:

   | Title | Bump | 1.5.5 becomes |
   | --- | --- | --- |
   | `feat: …` | minor | 1.6.0 |
   | `fix: …`, `perf: …`, `revert: …` | patch | 1.5.6 |
   | `feat!: …` — any type with `!` | major | 2.0.0 |
   | `docs:` `style:` `chore:` `refactor:` `test:` `build:` `ci:` | none | — |

   The last row does not block a release, it just cannot start one. Those
   types are hidden from the changelog, and release-please skips a release
   whose changelog would come out empty. Merge them alongside a `feat:` and
   they ship with it, simply unlisted.

   A major needs the `!` in the title. `BREAKING CHANGE:` in a commit body
   works too, but the repository squash-merges with the pull request title as
   the entire message, so there is no body to put it in unless you edit the
   message in the merge dialog.

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
   npm view @lab34/flows version
   npx -y @lab34/flows@1.6.0 --version
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
also what produced the `Merge branch 'master' of github.com:lab34-es/flows`
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

### The documentation site is separate

`website/` deploys to GitHub Pages on its own, on every push to `master` that
touches `website/**` or `frontend/src/components/help/**` (the docs are
generated from the app's Help articles). It is not part of the npm release, and
`release-please-config.json` excludes `website` from the package, so a
docs-only change does not bump the version.

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

## Working in this repo

```bash
npm run dev              # API on :3001 + UI on :3000, both live-reloading
npm run dev:api          # API only (tsx, no build step)
npm run frontend         # UI only, Vite HMR on :3000
npm run build            # src/ -> dist/, plus the bundled examples
npm test                 # jest
npm run coverage:badge   # refresh .github/badges/coverage.svg
```

While working on a change, `npm run lint`, `npm run typecheck` and `npm test`
are the fast local feedback loop (add the `--prefix frontend` equivalents when
the UI changed). They are a convenience, not the gate: `ci.yml` decides both
what lands and what ships. CI enforces coverage of `src/`
above 80% on statements, branches, functions and
lines; coverage is collected from all of `src/`, not just what tests import, so
new files need tests to land.
