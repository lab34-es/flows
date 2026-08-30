---
category: running
order: 2
icon: terminal
title: 'Command line'
summary: 'Run flows headlessly — the CI/CD side of the tool.'
keywords:
  - 'cli'
  - 'terminal'
  - 'ci'
  - 'cd'
  - 'server'
  - 'debug'
  - 'npm'
  - 'install'
  - 'flags'
  - 'view'
  - 'import'
  - 'env'
  - 'variables'
  - 'yaml'
---

    npm install -g @lab34/flows

    lab34-flows --help
    lab34-flows --server
    lab34-flows --file <path-to-flow-file> --env <environment> [--debug]
    lab34-flows --view <view> --env <environment> [--folder <folder>]
    lab34-flows --import-env <path-to-yaml> [--view <view> --env <environment>]
    lab34-flows --capabilities

| Flag | What it does |
|-|-|
| `--file` | Path to the flow (`.md`). Required unless `--view` or `--server`. |
| `--view` | Name or slug of a view of `views.yaml`: every flow it matches runs. |
| `--folder` | Folder of the flows tree `--view` is scoped to. |
| `--env` | Environment to run in. Required with `--file` and `--view`. |
| `--import-env` | Path of a YAML export of environment variables. Its values are written into this context's env files before anything runs. |
| `--dry-run` | With `--import-env`, report what the document would write — writing nothing, and running nothing. |
| `--server` | Start the web UI on http://localhost:3001. |
| `--context` | Use another context directory instead of `~/lab34-flows`. |
| `--debug` | Print environment variables and Node.js paths. |
| `--version` | Print the installed version (`-v` works too). |
| `--help` | Show the help. |

### Running a whole view

`--view` runs every flow a saved view matches, one after the other, as a
single test run — the **CLI** button of a folder view writes the exact command
for what is on screen:

    lab34-flows --context ~/lab34-flows --env staging --view smoke-tests

The view is evaluated **when the command runs**, not when it was written down,
so a flow added later that its filters keep is picked up without touching your
pipeline. Every flow runs even when one fails, and the command exits with a
non-zero code if any of them did.

### Bringing the environment variables with you

Env files hold secrets, so they stay out of git — which leaves a pipeline, or
a machine nobody has set up yet, with no values to run against. `--import-env`
closes that gap: hand it the YAML the *Environment variables* screen exports
and it writes those values into this context's env files **before any flow
runs**.

    lab34-flows --context ~/lab34-flows --import-env ~/Downloads/env.yaml

Give it a run as well and the two happen in that order — variables first, then
the flows, which is what a run needs, since a flow whose applications have no
env file for the environment is refused before it starts:

    lab34-flows --context ~/lab34-flows --import-env env.yaml --view smoke --env uat

The path is resolved against the working directory first and the context
directory second, so `--import-env env.yaml` finds the document whether it sits
next to the command or next to the flows.

It does exactly what the *Import* section of that screen does: env files that
are missing are created, ones that exist keep everything the document does not
name — comments and order included — and an application the document names that
this context does not have is reported and skipped. Every file it touched, and
every entry it left out, is printed:

    Environment variables — imported /home/me/env.yaml:
      updated applications/payments/env/uat.env — 1 added, 1 overwritten
      created applications/checkout/env/uat.env — 1 added
      skipped billing — no such application in this context
      1 created, 1 updated; 2 added, 1 overwritten, 0 already the same, 1 skipped

`--dry-run` prints that same report having written nothing — and runs no flow,
whatever else the command asked for. A document that cannot be read stops the
command before anything runs, rather than letting the flows fail later for a
reason that says much less.

The document carries **real values**, secrets included. Treat it the way you
would treat a password: keep it out of git, and out of the log.
