---
category: flows
order: 2
icon: code
title: 'Step blocks'
summary: 'Every key a step block accepts: what to call, what to send, what to assert, and the switches around it.'
keywords:
  - 'step'
  - 'application'
  - 'method'
  - 'parameters'
  - 'body'
  - 'params'
  - 'query'
  - 'headers'
  - 'test'
  - 'memory'
  - 'retry'
  - 'mimic'
  - 'mock'
  - 'stub'
  - 'fake'
  - 'enabled'
  - 'disable'
  - 'skip'
  - 'slug'
  - 'session'
  - 'testKey'
  - 'yaml'
  - 'block'
  - 'input'
---

The content of a `step` block is YAML.

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
    memory:
      postId: "{{ body.id }}"
    retry:
      times: 3
      delay: 1000
    ```

| Key | What it does |
|-|-|
| `application` | The application to call: a folder name under `applications/`. |
| `method` | An exported method of that application. |
| `description` | Free text shown in the step's header. |
| `parameters` | What the method receives. See below. |
| `test` | The assertions on the response. See [Assertions](/help/tests). |
| `memory` | What this step keeps for later ones, out of its response. See [Passing data between steps](/help/memory). |
| `retry` | `{ times, delay }`: run the step again when it fails, waiting `delay` milliseconds between attempts. |
| `mimic` | Fake a dependency of the system under test, for this step. See below. |
| `enabled` | `false` parks the step: it stays in the document and the run walks past it. |
| `slug` | A name for the step, so later steps can refer to it. |
| `session` | The browser session the step runs in. See [Browser automation](/help/playwright). |
| `closeSession` | `true` when this step is the last one that needs its browser session. |
| `testKey` | The Xray Test key this step maps to. Informative. |

Which parameters a method accepts, and what it answers, is documented by the
application itself: click it in the sidebar to read its methods, each with an
example ready to paste.

## Parameters

`parameters` is handed to the method as it is. By convention the built-in
helpers read four keys, the way an HTTP request is shaped:

| Key | Reaches |
|-|-|
| `body` | The request body. |
| `params` | Path parameters, `/posts/{id}`. |
| `query` | The query string. |
| `headers` | Request headers. |

Two kinds of template are resolved inside `parameters` before the step runs.
**Replacers** produce a fresh value on every run: `"{{ randomEmail }}"`,
`"{{ uuid }}"`, `"{{ timestamp }}"`; the list is in
[Replacers](/help/replacers). **Memory** reads what earlier steps left
behind: `"{{ memory.postId }}"`. Both arrive as text, so a method expecting a
number should accept a numeric string.

Parameters are resolved once, before the first attempt. A `retry` re-sends
exactly what was sent the first time, so a retried step does not silently
test something else.

## Turning a step off

The switch in the top-right corner of a step cell writes `enabled: false` into
its YAML, and turning it back on removes the key again. A step that is off
keeps its place and its number, is reported as *skipped* on the terminal and
in the run, and counts towards nothing: not the flow's total and not its
result. Nothing is prepared on its behalf either, so an application only that
step calls no longer needs an environment file for the flow to run.

## Naming a step

Every step has an id, `<application>-<method>`, numbered when the same pair
appears twice in a flow. A `slug` replaces it with a name of your choosing,
which is how a later step's `memory` mapping reaches it:
`{{ steps.login.response.body.token }}` reads the response of the step whose
slug is `login`.

## Mimicking a dependency

A step can replace the behaviour of a dependency the system under test calls,
which is how a failure scenario is reproduced without breaking anything for
real:

    ```step
    application: accounting
    method: getInvoice
    parameters:
      params:
        customerId: "{{ randomInt0_100 }}"
    mimic:
      - application: fraud
        url: "/fraud-detection"
    test:
      status: 404
      body:
        error:
          code: ACCOUNTING_FRAUD_DETECTED
    ```

Here `accounting` is called for real, and what it asks `fraud` at
`/fraud-detection` is answered by a fake for the duration of the step. The
fake is code of the `fraud` application, a `mimic.ts` next to its `index.ts`,
and the system under test has to be pointed at it; how to write one is in
[Applications](/help/applications). Mimicked responses go through the same
replacers as the rest of the flow, so they can carry `{{ uuid }}`,
`{{ randomEmail }}` and friends.

## Asking the person running the flow

A method can stop and ask for a value only a human has: the code shown on a
device, the barcode of the parcel on the desk. From the UI the question
appears as a field under the step; on the CLI it is read from the terminal.
The flow author does nothing for it, the application decides when to ask. See
[Applications](/help/applications).
