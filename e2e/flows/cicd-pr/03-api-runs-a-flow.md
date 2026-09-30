---
title: The API runs a flow
description: Save a document, run it, read the recorded run and its report, and see a failing flow fail.
---

# The API runs a flow

This is what pressing **Run** in the web UI does: the document is sent to
`/api/flows/start`, the run is recorded as a test run, and the report is
built from it. The flow saved here uses the bundled calculator, so nothing
leaves the machine.

## Save a document

````step
application: ronsel-api
method: post
description: A new flow file is written into the context
parameters:
  params:
    path: /api/flows/file
  body:
    path: cicd-pr/hello.md
    content: |
      ---
      title: Hello from the API
      ---
      ```step
      application: calculator
      method: add
      parameters:
        body:
          a: 2
          b: 40
      test:
        status: 200
        body:
          result: 42
      ```
memory:
  helloPath: "{{ body.path }}"
test:
  status: 200
  body:
    success: true
    relativePath: cicd-pr/hello.md
````

```step
application: ronsel-api
method: get
description: The file is now served with the title it was given
parameters:
  params:
    path: /api/flows/user
  query:
    path: "{{ memory.helloPath }}"
test:
  status: 200
  body:
    title: Hello from the API
    relativePath: cicd-pr/hello.md
    plainText: "$expr: value.includes('result: 42')"
```

```step
application: ronsel-api
method: post
description: Writing it again without overwrite is a conflict
parameters:
  params:
    path: /api/flows/file
  body:
    path: cicd-pr/hello.md
    content: "# Not this one"
test:
  status: 409
```

## Run it

The document is sent as the UI sends it: the editor's content, with the path
it was opened from so the run can name its copy.

````step
application: ronsel-api
method: post
description: Starting the flow answers at once with its execution
parameters:
  params:
    path: /api/flows/start
  body:
    path: cicd-pr/hello.md
    environment: local
    value: |
      ---
      title: Hello from the API
      ---
      ```step
      application: calculator
      method: add
      parameters:
        body:
          a: 2
          b: 40
      test:
        status: 200
        body:
          result: 42
      ```
test:
  status: 200
  body:
    execution: "$expr: value && typeof value === 'object'"
````

```step
application: ronsel-api
method: waitForRun
description: The run finishes, and passed
test:
  status: 200
  body:
    trigger: flow
    environment: local
    status: passed
    flows: "$expr: value.length === 1 && value[0].status === 'passed' && value[0].steps.passed === 1"
```

```step
application: ronsel-api
method: get
description: The run is served by its id
parameters:
  params:
    path: "/api/test-runs/{{ memory.runId }}"
test:
  status: 200
  body:
    id: "$expr: value === memory.runId"
    status: passed
```

```step
application: ronsel-api
method: get
description: The HTML report of the run names the flow
parameters:
  params:
    path: "/api/test-runs/{{ memory.runId }}/report"
test:
  status: 200
  body: "$expr: typeof value === 'string' && value.includes('<html') && value.includes('Hello from the API')"
```

## A failing flow fails

A run that does not pass has to say so: the assertion below cannot hold, and
the recorded run must be a failed one, not an error and not a pass.

````step
application: ronsel-api
method: post
description: A flow whose assertion is wrong starts like any other
parameters:
  params:
    path: /api/flows/start
  body:
    path: cicd-pr/wrong.md
    environment: local
    value: |
      ---
      title: Two plus two is not five
      ---
      ```step
      application: calculator
      method: add
      parameters:
        body:
          a: 2
          b: 2
      test:
        status: 200
        body:
          result: 5
      ```
test:
  status: 200
````

```step
application: ronsel-api
method: waitForRun
description: The run finishes, and failed
test:
  status: 200
  body:
    status: failed
    flows: "$expr: value.length === 1 && value[0].status === 'failed' && value[0].steps.failed === 1"
```

## Clean up

```step
application: ronsel-api
method: del
description: The saved file is deleted
parameters:
  params:
    path: /api/flows/file
  body:
    path: cicd-pr/hello.md
test:
  status: 200
  body:
    success: true
```

```step
application: ronsel-api
method: get
description: And is no longer served
parameters:
  params:
    path: /api/flows/user
  query:
    path: "{{ memory.helloPath }}"
test:
  status: 404
```
