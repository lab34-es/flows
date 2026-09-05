---
category: running
order: 2
icon: terminal
title: 'Command line'
summary: 'Run a flow or a whole view headlessly, feed it the environment variables, and wire it into a CI/CD pipeline.'
keywords:
  - 'cli'
  - 'terminal'
  - 'command'
  - 'ci'
  - 'cd'
  - 'pipeline'
  - 'github actions'
  - 'gitlab'
  - 'headless'
  - 'server'
  - 'debug'
  - 'npm'
  - 'install'
  - 'flags'
  - 'file'
  - 'view'
  - 'folder'
  - 'env'
  - 'import-env'
  - 'dry-run'
  - 'capabilities'
  - 'remote'
  - 'agent'
  - 'exit code'
  - 'version'
---

    npm install -g @lab34/flows

    lab34-flows --server [--context <folder>]
    lab34-flows --file <flow.md> --env <environment>
    lab34-flows --view <view> --env <environment> [--folder <folder>]
    lab34-flows --import-env <env.yaml> [--view <view> --env <environment>] [--dry-run]
    lab34-flows --capabilities
    lab34-flows --agent --agent-id <name> [--broker <url> --username <user> --password <secret>]
    lab34-flows --remote <agent> --file <flow.md> --env <environment>

| Flag | What it does |
|-|-|
| `--context` | The context folder. Defaults to `~/lab34-flows`. Every other path is resolved against it. |
| `--server` | Start the web UI on http://localhost:3001. |
| `--file` | Run one flow. The path is relative to the context: `flows/checkout/refund.md`. |
| `--view` | Run every flow a saved view matches, as one test run. The name or the slug of a view of `views.yaml`. |
| `--folder` | With `--view`, scope the view to a folder of the flows tree. Default: every flow. |
| `--env` | The environment to run against. Required with `--file` and `--view`. |
| `--import-env` | Write a YAML export of environment variables into the context's env files before anything runs. |
| `--dry-run` | With `--import-env`, print what it would write, write nothing and run nothing. |
| `--capabilities` | List every application of the context with its methods. |
| `--agent`, `--agent-id`, `--broker`, `--username`, `--password` | Run this machine as a remote agent. See [Remote agents](/help/remote-agents). |
| `--remote <agent>` | Run `--file` or `--view` on that agent instead of here. |
| `--debug` | Print the environment variables and Node.js paths, for when nothing else explains a failure. |
| `--version`, `-v` | Print the installed version. |
| `--help` | Show the help. |

Writing flows with AI is a web UI feature: the provider and keys are
configured there, and the CLI has no flag for it.

## Running one flow

    lab34-flows --context ~/projects/shop/e2e --file flows/checkout/refund.md --env uat

The steps are printed as they run, with their request, response and
assertions, and the run is recorded under `test-runs/` exactly as one from
the UI. The command exits with `0` when the flow passed and `1` otherwise.

## Running a view

    lab34-flows --context ~/projects/shop/e2e --view smoke --env uat

`--view` runs every flow a saved view matches, one after the other, as a
single test run. The **CLI** button of a folder view writes the exact command
for what is on screen, `--folder` included when the view is scoped to a
folder.

The view is evaluated **when the command runs**, not when it was written
down: a flow added later that its filters keep is picked up without touching
the pipeline. Every flow runs even when one fails, the summary lists the
failed ones, and the exit code is `1` if any did. Why a view rather than a
list of files is the right thing to hand a pipeline is explained in
[Organizing flows](/help/organizing).

## Bringing the environment variables with you

Env files hold secrets, so they are not in the repository a pipeline clones.
`--import-env` takes the YAML document the *Environment variables* screen
exports and writes its values into the context's env files **before any flow
runs**:

    lab34-flows --context . --import-env env.yaml --view smoke --env uat

The path is resolved against the working directory first and the context
second. Missing files are created, existing ones keep everything the document
does not name, and an application the document names that the context does
not have is reported and skipped. Every file touched and every entry left out
is printed:

    Environment variables — imported /home/ci/env.yaml:
      updated applications/payments/env/uat.env — 1 added, 1 overwritten
      created applications/checkout/env/uat.env — 1 added
      skipped billing — no such application in this context
      1 created, 1 updated; 2 added, 1 overwritten, 0 already the same, 1 skipped

A document that cannot be read stops the command before anything runs. The
document carries real values: keep it out of git and out of the job's log.

## In a pipeline

A job needs Node.js 24, the package, the context and the environment
document. With GitHub Actions, the context being the `e2e` folder of the
repository and the export stored as the secret `FLOWS_ENV_UAT`:

    jobs:
      smoke:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: 24
          - run: npm install -g @lab34/flows
          - run: printf '%s' "$FLOWS_ENV" > env.yaml
            env:
              FLOWS_ENV: ${{ secrets.FLOWS_ENV_UAT }}
          - run: lab34-flows --context e2e --import-env env.yaml --view smoke --env uat
          - uses: actions/upload-artifact@v4
            if: always()
            with:
              name: flows-report
              path: e2e/test-runs/**/report.html

The job fails when a flow fails, and the HTML report of the run is kept as an
artifact either way. Flows that drive a browser need
`npx playwright install --with-deps chromium` before the run. Any other CI
system is the same four steps: install, write the document, run the view,
keep the report.

## Remote

    lab34-flows --remote agent-ourense --view smoke --env uat

runs the view on a machine that can reach the systems under test, and prints
and records the run here as if it had run locally. See
[Remote agents](/help/remote-agents).
