---
category: running
order: 1
icon: play
title: 'Running flows'
summary: 'What happens when you press Run, and how to read the results.'
keywords:
  - 'run'
  - 'execute'
  - 'status'
  - 'results'
  - 'output'
  - 'notebook'
  - 'retry'
---

Press **Run** and the steps execute in the order they appear in the document.
Below each block you get the request that was actually sent (with the random
values already resolved), the response, the assertions and the timings.

- The dot next to the flow in the sidebar reflects the run: *standby*,
  *running*, *ok*, *error*.
- A failed step can be retried automatically with `retry: { times, delay }`.
  Random values are kept stable across the retries of a step, so a retry does
  not silently test something else.
- The environment used is the one selected in the sidebar footer.

Runs are streamed over a socket, so you can watch a long flow progress instead
of waiting for a final report.
