# Ronsel for VS Code

Run [Ronsel](https://ronsel.lab34.es/) E2E flows without leaving the editor:
a play button on every flow, a check or a cross on every step once it ran,
and every execution in a panel next to the terminal.

Flows are Markdown documents whose executable parts are ` ```step ` blocks.
This extension shows them the way VS Code shows tests -- because that is what
they are.

## What you get

- **A play button on every flow.** In the gutter next to the flow's title, in
  the editor's title bar (the same place as VS Code's own *Run*), in the
  explorer's context menu, and in the **Testing** view, where every flows
  folder, folder and flow can be run at once.
- **A check or a cross on every step.** Each ` ```step ` block is a test of its
  own: when the flow runs, its gutter mark turns into a check, a cross, or a
  skip, drawn by VS Code like any test's. A failed assertion opens where it
  happened, with what was expected next to what came.
- **Executions in the panel.** The **Ronsel** panel, next to the Terminal and
  the Output, lists every run, newest first: each flow, and each step with its
  mark and its time. Runs started from the CLI or the web UI show up too, as
  they happen. Click a step to open the run's copy of the flow at its result;
  *Run Again*, *Open Report* and *Reveal Run Folder* are on each run.
- **The output where VS Code puts test output.** What the run prints -- the
  requests, the responses, the assertions -- streams into **Test Results**,
  colours and all.
- **The environment in the status bar.** Flows run against one environment
  (`--env`); it is chosen once, from the status bar, like an interpreter.
- **Questions asked in the editor.** A step that needs a value from you (an
  `inputs.text`) asks in an input box; Escape refuses to answer and fails the
  step.
- **Debug.** *Debug Flow* starts the run under the debugger: breakpoints in the
  applications' TypeScript bind, wherever the applications live.
- **The web UI, one command away.** *Ronsel: Open Web UI* starts it on the
  flows folder, in a terminal.

## Flows of another repository

Working on a service whose flows live in a repository of their own? Add that
folder with **Ronsel: Add Flows Folder...** (or list it in `ronsel.contexts`)
and its flows show up in the Testing view next to this workspace's, ready to
run against the code you are changing.

## Requirements

- **ronsel**, with editor support (`ronsel --ipc`): the release this extension
  came with, or a newer one. The extension carries no copy of it: flows run
  with the ronsel the flows folder depends on (`npm install ronsel`, which
  `ronsel start` does), the workspace's, or a global one -- or the one
  `ronsel.cliPath` names. An older ronsel is told apart, and you are told so.
- **Node.js 24** or newer, on the `PATH` or in `ronsel.nodePath`.

A *flows folder* is any folder with a `flows/` folder and an `applications/`
one -- a ronsel context, as `ronsel start` creates it. Every one in the
workspace is found.

## Settings

| Setting | What it does |
| --- | --- |
| `ronsel.contexts` | Flows folders to show besides the workspace's, from anywhere: another repository, say. |
| `ronsel.exclude` | Globs of folders the workspace search never takes for flows folders. |
| `ronsel.cliPath` | The ronsel to run flows with, when it is not found on its own. |
| `ronsel.nodePath` | The Node.js flows run with. |
| `ronsel.executions.limit` | How many runs the Executions panel lists. |
| `ronsel.executions.revealOnRun` | Show the Executions panel on a run started from the editor. |

## How it works

Every run is a process of its own: `ronsel --ipc --env <environment> --file
<flow>...`, in the flows folder. Applications are loaded fresh each time, so
the next run picks up an edit without restarting anything. The CLI prints what
it always prints -- that is the Test Results output -- and reports every step
over the IPC channel as it starts and ends, the same events the web UI draws
from. Every run is recorded in the flows folder's `test-runs`, exactly like a
run from anywhere else.

Running a single step runs its flow: steps hand each other their results
through the flow's memory, and none of them makes sense alone.

## Development

The extension lives in `editors/vscode` of [lab34-es/ronsel](https://github.com/lab34-es/ronsel).

```bash
npm install
npm run build       # esbuild: src/ -> dist/extension.js
npm run typecheck
npm run lint
npm test            # node's test runner, on src/core (no VS Code needed)
npm run package     # ronsel-<version>.vsix
```

Open the folder in VS Code and press F5 to start an Extension Development
Host with it loaded.
