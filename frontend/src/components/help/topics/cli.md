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
---

    npm install -g @lab34/flows

    lab34-flows --help
    lab34-flows --server
    lab34-flows --file <path-to-flow-file> --env <environment> [--debug]
    lab34-flows --view <view> --env <environment> [--folder <folder>]
    lab34-flows --capabilities

| Flag | What it does |
|-|-|
| `--file` | Path to the flow (`.md`). Required unless `--view` or `--server`. |
| `--view` | Name or slug of a view of `views.yaml`: every flow it matches runs. |
| `--folder` | Folder of the flows tree `--view` is scoped to. |
| `--env` | Environment to run in. Required with `--file` and `--view`. |
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
