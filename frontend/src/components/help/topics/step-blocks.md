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
---

The content of a `step` block is YAML:

| Key | What it does |
|-|-|
| `application` | The application to call. Must exist in your context folder. |
| `method` | The method of that application. |
| `description` | Free text shown next to the step in the UI. |
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
