<div align="center">

# lab34/flows

**Trigger, understand and test E2E flows and behaviours.**

[![CI](https://github.com/lab34-es/flows/actions/workflows/ci.yml/badge.svg)](https://github.com/lab34-es/flows/actions/workflows/ci.yml)
[![Coverage](https://raw.githubusercontent.com/lab34-es/flows/badges/coverage.svg)](https://github.com/lab34-es/flows/actions/workflows/ci.yml)
[![CodeQL](https://raw.githubusercontent.com/lab34-es/flows/badges/codeql.svg)](https://github.com/lab34-es/flows/security/code-scanning)
[![npm](https://img.shields.io/npm/v/@lab34/flows)](https://www.npmjs.com/package/@lab34/flows)
[![license](https://img.shields.io/npm/l/@lab34/flows)](https://www.npmjs.com/package/@lab34/flows)

<p align="center">
  <a href="https://flows.lab34.es/docs/">Documentation</a> ·
  <a href="https://flows.lab34.es/docs/quick-start/">Quick start</a> ·
  <a href="https://flows.lab34.es/">Website</a> ·
  <a href="https://github.com/lab34-es/flows/issues">Issues</a>
</p>

<a href="frontend/public/help-images/flow-light.webp">
  <img src="frontend/public/help-images/flow-light.webp" alt="A flow after a run" width="900">
</a>

</div>

---

Flows is a tool for testing end-to-end flows and behaviours across the systems
you actually run: HTTP APIs, MQTT topics, PostgreSQL databases and web
applications. You can run flow from the web UI while you are writing it, from
the CLI on your machine, and unattended in your CI/CD pipelines.

A flow is a **Markdown document**. You write whatever you want — headings,
prose, notes — and mark the executable parts as ` ```step ` code blocks. Run
it, and the request, response, assertions and timings of each step appear right
below the block that produced them. Like in Python notebooks.

````markdown
---
title: Fraud detection
description: Fraud must be detected when the customer is flagged
---

# Fraud detection

The invoice endpoint must refuse to answer for a flagged customer.

```step
application: "accounting"
method: "getInvoice"
parameters:
  params:
    customerId: "{{ randomInt0_100 }}"
mimic:
  - application: "fraud"
    url: "/fraud-detection"
test:
  status: 404
  body:
    error:
      code: "ACCOUNTING_FRAUD_DETECTED"
```
````

## Screenshots

| Home | Folder | AI create | AI edit | Settings |
| --- | --- | --- | --- | --- |
| [![Home](frontend/public/help-images/home-light.webp)](frontend/public/help-images/home-light.webp) | [![A folder as a table](frontend/public/help-images/folder-light.webp)](frontend/public/help-images/folder-light.webp) | [![Create a flow with AI](frontend/public/help-images/ai-create-light.webp)](frontend/public/help-images/ai-create-light.webp) | [![Edit a flow with AI](frontend/public/help-images/ai-edit-light.webp)](frontend/public/help-images/ai-edit-light.webp) | [![Settings](frontend/public/help-images/settings-light.webp)](frontend/public/help-images/settings-light.webp) |

## Features

- **Flows as Markdown.** Documentation and executable steps in the same file,
  versioned in your own git repository.
- **Notebook-style web UI.** Live status per flow, folder views you can sort and
  filter, and per-step execution details.
- **Write flows with AI.** Describe a scenario and get a flow built from your own
  applications — with local Ollama, Google Gemini or Anthropic.
- **Assertions built in.** Assert status and body, including JavaScript
  expressions, and reuse the same flows in CI/CD through the CLI.
- **Mimic dependencies.** Fake what a dependency answers so failure scenarios
  can be reproduced locally.
- **Multi-protocol.** HTTP APIs, MQTT (including asynchronous, out-of-band
  assertions), PostgreSQL and browser automation via Playwright.
- **Random data on every run.** A large set of replacers for ids, dates and
  fake data.
- **Secrets stay out of the repo.** One env file per application per
  environment, kept in your context folder. An environment exists as soon as
  one application declares it, and a run only asks for the files of the
  applications its flow actually uses.
- **Onboarding in one paste.** Export whichever applications, environments and
  variables a teammate needs as a single YAML document; importing it creates
  the env files they are missing and fills in the rest.
- **Batteries included.** Example applications and flows are seeded on first run.

## Install

Requires Node.js `>= 24.0.0` (the current active LTS line).

```bash
npm install -g @lab34/flows
```

Browser automation needs one extra step: Playwright ships with the package but
its browsers do not, so download them once before running a flow that drives a
browser.

```bash
npx playwright install          # all three browsers
npx playwright install chromium # or just the one you use
```

See [Quick start](https://flows.lab34.es/docs/quick-start/) for the first-run
walkthrough.

## Usage

```bash
lab34-flows --server                                  # web UI on http://localhost:3001
lab34-flows --file flows/my-flow.md --env production  # run a flow headlessly
lab34-flows --view smoke-tests --env production       # run every flow a saved view matches
lab34-flows --import-env env.yaml --view smoke --env uat  # load the env variables, then run
lab34-flows --capabilities                            # list available applications and methods
lab34-flows --version                                 # print the installed version
lab34-flows --help
```

A `--view` is an scopped list of flows that matches criterias you specify via the UI.
You can get the exact cli command to run scopped filters via the UI.

`--import-env` takes the YAML the *Environment variables* screen exports and
writes it into this context's env files before anything runs — which is how a
pipeline carries its credentials as one file next to the command instead of a
folder of env files nobody can commit. Add `--dry-run` to see what it would
write without writing it.

Full reference: [Test runs](https://flows.lab34.es/docs/test-runs/) and
[Command line](https://flows.lab34.es/docs/cli/).

### Running on another machine

When the systems under test are only reachable from somewhere else -- a
machine inside a network you cannot open a port into -- the flows can run
there while you keep writing them here. Both machines connect *out* to an MQTT
broker; nothing listens on either side.

On the machine that can reach the systems, start an agent. It needs a copy of
the context (a clone of the same repository) and a name the broker knows it
by:

```bash
lab34-flows --context ~/flows-agent --agent --agent-id agent-ourense \
  --broker mqtts://mqtt.example:443 --username agent-ourense --password '...'
```

The broker address and username are stored in `config/remote.json` and the
password in the context's `.env`, so the flags are only needed once. The agent
prints its public key and stays up, waiting for jobs.

On your machine, run a flow or a view on it:

```bash
lab34-flows --remote agent-ourense --file flows/my-flow.md --env uat
lab34-flows --remote agent-ourense --view smoke --env uat
```

What travels: the commit your context is on (the agent fetches and checks it
out, so push first), and the values of the env files the flows use, encrypted
to the agent's key so the broker never sees them. What comes back: every event
of the run, printed as it happens, a prompt on your terminal when a step asks
for a value, and the test-run folder, written into your own `test-runs` as if
it had run here.

The same from the web UI: enter the broker under *Settings → Remote agents*,
pick an agent in the top bar next to the environment, and the Run buttons send
the flows there. The run shows up in the notebook and in the test runs as any
other, questions from steps included.

The agent's key is trusted the first time it is seen and refused if it ever
changes, the way ssh treats a host key. The broker itself needs TLS, one user
per machine and an ACL that confines each agent to `flows/agents/<name>/#`;
any MQTT 5 broker does (EMQX, Mosquitto, HiveMQ).

## Documentation

You can access the entire documentation at  at **[flows.lab34.es/docs](https://flows.lab34.es/docs/)**. 
The same articles ship inside the app's Help section.

## Development

The package is written in TypeScript and published as CommonJS: `src/` compiles
into `dist/`, which is what `npm publish` ships, together with the type
declarations. The web UI (`frontend/`) is TypeScript too (react/mui/joy)

```bash
npm install              # CLI, API and helpers
npm run install:frontend # web UI

npm run dev              # API on :3001 + web UI on :3000, both live-reloading
                         # open http://localhost:3000 (:3001 redirects there)
npm run dev:api          # API only, restarted on change (tsx, no build step)
npm run frontend         # web UI only, Vite dev server with HMR on :3000

npm run build            # compile src/ -> dist/ and copy the bundled examples
npm run typecheck        # tsc over src/ and tests/, no emit
npm run lint             # eslint + typescript-eslint
npm test                 # jest
npm run test:coverage    # jest with the coverage gate
npm run coverage:badge   # refresh .github/badges/coverage.svg
npm run audit:ci         # fail if any critical advisory is present
```

The frontend has its own config: `npm run lint|typecheck|build --prefix frontend`.

### Quality gates

Every pull request, and every push to `master`, runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). A change cannot land
unless all of it passes:

| Gate | What it checks |
| --- | --- |
| Lint | `eslint` over `src/`, `tests/` and `frontend/src/`, clean |
| Types | `tsc --noEmit` for the package and for the frontend, clean |
| Coverage | statements, branches, functions and lines of `src/` all **above 80%** |
| Audit | `npm audit` finds **no critical** advisory in the root, frontend or website tree |
| Build | `dist/` compiles and `node dist/cli.js --help` runs; the frontend builds |

The threshold lives in [`jest.config.js`](jest.config.js) (`coverageThreshold`),
so the number is defined once and CI simply runs `npm run test:coverage`.
Coverage is collected from *all* of `src/`, not only the files a test happens to
import. The release runs on the same gates: the `release` and `publish` jobs of
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) depend on all of them,
so nothing ships from a red master.

### Dependency pinning

Every dependency is recorded as an exact version, with no `^` or `~` range, in
all three package trees. `.npmrc` sets `save-exact=true` so `npm install <pkg>`
keeps it that way. Upgrades are deliberate, reviewable commits rather than
something that drifts in on a fresh install.

## License

[MIT](LICENSE.md) © [Lab34](https://lab34.es)
