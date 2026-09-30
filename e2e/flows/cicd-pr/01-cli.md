---
title: The command line
description: The shipped ronsel command, version, help, a run and every way it refuses.
---

# The command line

Every step here spawns `dist/cli.js` in its own process, through the
`ronsel-cli` application, and reads what a person would see: the exit code
and the output.

## The version is the one package.json names

There is one version number, in `package.json`, and everything that shows a
version reads it from there. `--version` prints exactly that, and the banner
of `--help` carries it too.

```step
application: ronsel-cli
method: packageVersion
description: Read the version out of package.json
test:
  status: 200
  body:
    version: "$expr: /^\\d+\\.\\d+\\.\\d+/.test(value)"
```

```step
application: ronsel-cli
method: run
description: --version prints that version and nothing else
parameters:
  body:
    args: ["--version"]
test:
  status: 200
  body:
    exitCode: 0
    stdout: "$expr: value.trim() === memory.version"
```

```step
application: ronsel-cli
method: run
description: --help prints the usage, with the version in its banner
parameters:
  body:
    args: ["--help"]
test:
  status: 200
  body:
    exitCode: 0
    stdout: "$expr: value.includes('Usage:') && value.includes('--view') && value.includes(memory.version)"
```

## A refusal is exit code 1, and says why

A pipeline only sees the exit code, and a person only sees the message. Both
have to be right.

```step
application: ronsel-cli
method: run
description: A flow without --env is refused
parameters:
  body:
    args: ["--file", "flows/examples/01-welcome.md"]
    context: true
test:
  status: 400
  body:
    exitCode: 1
    stderr: "$expr: value.includes('No environment specified')"
```

```step
application: ronsel-cli
method: run
description: A flow file that is not there is refused
parameters:
  body:
    args: ["--file", "flows/nope.md", "--env", "local"]
    context: true
test:
  status: 400
  body:
    exitCode: 1
    stderr: "$expr: value.includes('File not found')"
```

```step
application: ronsel-cli
method: run
description: A view that does not exist is refused, naming the ones that do
parameters:
  body:
    args: ["--view", "nope", "--env", "local"]
    context: true
test:
  status: 400
  body:
    exitCode: 1
    stderr: "$expr: value.includes('View not found: nope')"
```

## Running a flow

The welcome example runs entirely offline, against the bundled calculator
application. This is ronsel running a flow, from the command line, exactly as
a pipeline would.

```step
application: ronsel-cli
method: run
description: The welcome example passes on the local environment
parameters:
  body:
    args: ["--file", "flows/examples/01-welcome.md", "--env", "local"]
    context: true
test:
  status: 200
  body:
    exitCode: 0
```

```step
application: ronsel-cli
method: testRuns
description: The run was recorded as a passed test run of the CLI
test:
  status: 200
  body:
    total: 1
    runs: "$expr: value[0].trigger === 'cli' && value[0].environment === 'local' && value[0].status === 'passed'"
```

```step
application: ronsel-cli
method: run
description: --capabilities lists the applications of the context and their methods
parameters:
  body:
    args: ["--capabilities"]
    context: true
test:
  status: 200
  body:
    exitCode: 0
    stdout: "$expr: value.includes('Application: calculator') && value.includes('- divide')"
```
