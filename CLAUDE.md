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

**The version lives in the root `package.json` and nowhere else.** Everything
that shows a version reads it from there:

- `lab34-flows --version` (and `-v`) — `src/cli.ts`
- the banner in `lab34-flows --help` and the CLI logo on every run
- the web UI sidebar title — baked into the bundle by `define` in
  `frontend/vite.config.ts`, which reads `../package.json`
- the git tag: `v<version>`, exactly

`frontend/package.json` stays at `0.0.0` on purpose — it is private and never
published. Do not bump it.

Because the UI's version is a **build-time** constant, a published package can
only show the right version if the frontend was rebuilt from the same commit.
`prepublishOnly` and both CI workflows do that already; the thing to avoid is
publishing from a stale `frontend/dist`.

### The release, step by step

1. **Start from a clean, up-to-date `master`.** The bump goes on `master`.

   ```bash
   git checkout master && git pull
   git status --porcelain   # must be empty
   ```

2. **Bump the version.** Use `npm version`, never hand-edit `package.json` —
   it keeps `package-lock.json` in sync (the version appears twice in there),
   which is the usual source of a messy release.

   ```bash
   npm version 1.4.0 --no-git-tag-version
   ```

   `--no-git-tag-version` matters: the release workflow creates the tag itself,
   on the commit it actually published. Tagging here would put the tag on a
   commit before CI has had a look at it. Pick the number by semver — breaking
   change → major, new capability → minor, fix only → patch.

3. **Do not verify the release locally.** Every gate — lint, types, the 80%
   coverage threshold, the audits, the frontend build, the package build and
   `node dist/cli.js --help` — is re-run by
   `.github/workflows/npm-publish.yml` against the exact commit being
   released, before anything is published. Running them by hand first proves
   nothing extra and just slows the release down. Publishing is a GitHub
   Actions job; let it do its job.

4. **Commit and push the bump to `master`.**

   ```bash
   git commit -am 'chore: bump version to 1.4.0'
   git push
   ```

5. **Publish.** Trigger the release workflow by hand:

   ```bash
   gh workflow run npm-publish.yml --ref master
   gh run watch
   ```

   A dispatch run re-runs every quality gate against the exact commit being
   released, publishes to npm, and then **creates and pushes the `v1.4.0` tag
   itself**. There is nothing left to tag by hand.

6. **Check it landed.**

   ```bash
   npm view @lab34/flows version
   npx -y @lab34/flows@1.4.0 --version
   ```

### Never run the release by hand

The build and the checks belong to GitHub Actions. Do not run the gates
locally as a pre-flight, and do not build `dist/` on your machine to "make
sure" — the release pipeline builds from a clean checkout of the released
commit, and anything produced locally is neither what ships nor evidence about
what ships.

### The other way in: pushing a tag

`.github/workflows/npm-publish.yml` also fires on a `v*` tag push and on a
GitHub release. That path exists for releases cut from the GitHub UI. If you
use it, the tag **must** equal `v<package.json version>` — the workflow checks
and fails otherwise. Both triggers firing for the same version is safe: the
workflow checks npm first and skips a version that is already there, so it
publishes once, not twice.

### Never publish from a laptop

Do not run `npm publish` locally. The package uses npm **trusted publishing**:
the workflow exchanges a short-lived GitHub OIDC token for a publish
credential, which is also what attaches provenance to the release. There is no
`NPM_TOKEN` anywhere, and a local publish would ship a release with no
provenance from an unverified tree. If the publish step ever fails, re-run it
with `--loglevel=verbose` — npm only reports a failed token exchange at verbose
level and otherwise dies with a bare `ENEEDAUTH`.

### The documentation site is separate

`website/` deploys to GitHub Pages on its own, on every push to `master` that
touches `website/**` or `frontend/src/components/help/**` (the docs are
generated from the app's Help articles). It is not part of the npm release and
needs no version bump.

### When a release goes wrong

- **Published a broken version.** npm versions are immutable — do not try to
  unpublish. Bump a patch and release again.
- **Tag exists but nothing was published.** Re-run the workflow; the "already
  on npm" check makes it a no-op if it did in fact publish.
- **UI shows the old version.** The frontend was not rebuilt for that commit.
  Rebuild and cut a new patch; there is no way to fix it in place.

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
the UI changed). They are a convenience, not the gate: `ci.yml` decides what
lands and `npm-publish.yml` decides what ships. CI enforces coverage of `src/`
above 80% on statements, branches, functions and
lines; coverage is collected from all of `src/`, not just what tests import, so
new files need tests to land.
