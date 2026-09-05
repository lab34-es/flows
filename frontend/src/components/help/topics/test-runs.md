---
category: running
order: 1
icon: play
title: 'Test runs'
summary: 'What happens when you press Run, what is kept of it, and how to read the HTML report.'
keywords:
  - 'run'
  - 'execute'
  - 'test run'
  - 'results'
  - 'output'
  - 'status'
  - 'report'
  - 'html'
  - 'evidence'
  - 'history'
  - 'run.json'
  - 'exit code'
  - 'retry'
  - 'skipped'
  - 'notebook'
  - 'input'
  - 'question'
---

A test run is the record of the flows somebody decided to execute and what
happened to each of them. Every Run produces one, whichever way it was
triggered:

| Trigger | What runs |
|-|-|
| **Run** on a flow page | That flow, against the environment in the top bar. |
| **Run all** on a folder | Every flow the open view lists, one after the other. |
| `lab34-flows --file` or `--view` | The same two things, from a terminal or a pipeline. See [Command line](/help/cli). |

An agent picked in the top bar, or `--remote` on the CLI, sends the run to
another machine and brings its results back here. See
[Remote agents](/help/remote-agents).

## What happens

Before the first step, the environment is checked: every application the
flow uses must have its env file, or the run is refused with the list of the
missing ones (see [Environments](/help/environments)). Then the steps execute
in the order they appear in the document. Below each block you get the
request that was actually sent, with the random values already resolved, the
response, the assertions and the timings; on the CLI the same is printed as it
happens. Runs are streamed, so a long flow is watched rather than waited for.

- A failed step is retried when it says `retry: { times, delay }`, and the
  random values are kept stable across the attempts.
- A step with `enabled: false` is reported as *skipped* and counts towards
  nothing.
- A step can stop and **ask you for a value**: a field appears under it in
  the UI, a prompt on the terminal. The run waits for the answer, or for the
  cancel button.
- Every flow of a folder run executes even when one fails.

The dot next to each flow in the sidebar follows its latest run: *standby*,
*running*, *ok*, *error*.

## What is kept

Every run is a folder of the context directory:

    test-runs/2026-08-20_14-30-05-uat/
      run.json              # the summary: trigger, environment, view, flows, times
      report.html           # the standalone report, written when the run ends
      checkout/refund.md    # a copy of each flow that ran, with its results inside

The copy is the flow's own Markdown with the execution written into it: a
`testRun` block in the frontmatter for the flow as a whole, and a
`step-result` fenced block under every step with that step's request,
response, assertions and timings. The originals under `flows/` are never
touched. Values whose key contains `token`, `password`, `secret` or
`authorization` are masked before anything is written.

Nothing deletes runs; the folder is yours to prune, to ignore in git, or to
commit as evidence. See [The context folder](/help/context).

## The Test runs page

**Test runs** in the sidebar lists every run with its trigger, environment,
view, score and duration. Open one and each flow is a row with its status;
open a flow and its copy is rendered as the flow page would be, results
under each block.

## The HTML report

When a run finishes, `report.html` is written next to `run.json`: the outcome
at a glance, every failure with its evidence (the steps that ran, the
assertion that broke, the response that broke it) and one square per flow,
grouped by suite, which is the flow's top folder. The file is self-contained
and opens anywhere, a browser tab, an email attachment, a CI artifact, with no
server behind it.

The **HTML report** button on the run page opens it; a pipeline picks it up
from the run folder. With the [SharePoint](/help/sharepoint) integration
configured, it is also uploaded to a document library, and the run page says
where it went.

## On the command line

The command exits with `0` when every flow passed and `1` otherwise, so a
pipeline fails on a failed flow. The run is recorded exactly as one from the
UI, and its id is printed at the end.
