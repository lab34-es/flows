---
category: writing
order: 1
icon: code
title: 'Step blocks'
summary: 'Every key you can use inside a step block.'
keywords:
  - 'step'
  - 'application'
  - 'method'
  - 'parameters'
  - 'retry'
  - 'mimic'
  - 'block'
  - 'yaml'
  - 'enabled'
  - 'disable'
  - 'skip'
---

The content of a `step` block is YAML:

| Key | What it does |
|-|-|
| `application` | The application to call. Must exist in your context folder. |
| `method` | The method of that application. |
| `description` | Free text shown next to the step in the UI. |
| `enabled` | `false` to park the step: it stays in the document and the run walks past it. |
| `parameters` | What the method receives — usually `body`, `params`, `query`, `headers`. |
| `test` | The assertions for this step. See *Assertions and tests*. |
| `mimic` | Fake the response of a dependency for this step. |
| `retry` | `{ times, delay }` — retry the step when it fails, waiting `delay` ms. |
| `session` | The browser session the step runs in. See *Browser automation*. |
| `closeSession` | `true` when this step is the last one that needs its browser session. |
| `testKey` | The Xray Test key this step maps to (informative). |

    ---
    title: Create and read back
    ---

    ```step
    application: jsonplaceholder
    method: createPost
    description: Create a post signed by a random author
    parameters:
      body:
        title: "{{ randomString }}"
        body: "Written by {{ randomName }}"
        userId: 1
    test:
      status: 201
    retry:
      times: 3
      delay: 1000
    ```

Which parameters a method accepts is documented by the application itself:
click it in the sidebar to see them, with examples ready to paste.

## Turning a step off

The switch in the top-right corner of a step cell writes `enabled: false` into
its YAML, and turning it back on removes the key again — steps run unless the
document says otherwise, so a flow that never mentions `enabled` behaves
exactly as it always did.

    ```step
    enabled: false
    application: jsonplaceholder
    method: deletePost
    parameters:
      params:
        id: 1
    ```

A step that is off is skipped rather than deleted: it keeps its place and its
number, it is reported as *skipped* on the terminal and in the run, and it
counts towards nothing — not the flow's total, and not its result. Nothing is
prepared on its behalf either, so an application only that step calls no
longer needs an environment file for the flow to run.
