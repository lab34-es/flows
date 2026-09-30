---
title: The API describes the context
description: Flows, applications, environments and views, as the web UI reads them.
---

# The API describes the context

The API under test serves a context that was empty when it started. ronsel
furnishes such a folder with its bundled examples on first start, so this is
also a test of that: every list below has to hold what the examples put there.

## The context

```step
application: ronsel-api
method: get
description: The API says which folder it serves
parameters:
  params:
    path: /api/context
memory:
  contextPath: "{{ body.path }}"
test:
  status: 200
  body:
    path: "$expr: typeof value === 'string' && value.length > 0"
    custom: true
```

## Flows

```step
application: ronsel-api
method: get
description: The example flows are listed, with their paths and titles
parameters:
  params:
    path: /api/flows
test:
  status: 200
  body: "$expr: Array.isArray(value) && value.some(flow => flow.relativePath === 'examples/01-welcome.md' && typeof flow.title === 'string')"
```

```step
application: ronsel-api
method: get
description: One flow is served with its parsed steps
parameters:
  params:
    path: /api/flows/user
  query:
    path: "{{ memory.contextPath }}/flows/examples/01-welcome.md"
test:
  status: 200
  body:
    relativePath: examples/01-welcome.md
    steps: "$expr: Array.isArray(value) && value.length === 3 && value.every(step => step.application === 'calculator')"
```

```step
application: ronsel-api
method: post
description: A document is parsed into steps without being saved
parameters:
  params:
    path: /api/flows/parse
  body:
    value: |
      ---
      title: Parsed, not saved
      ---
      ```step
      application: calculator
      method: add
      parameters:
        body:
          a: 1
          b: 2
      ```
test:
  status: 200
  body:
    title: Parsed, not saved
    steps: "$expr: value.length === 1 && value[0].method === 'add'"
    errors: "$expr: Array.isArray(value) && value.length === 0"
```

## Applications and environments

```step
application: ronsel-api
method: get
description: The example applications are listed, with the methods their code exports
parameters:
  params:
    path: /api/applications
test:
  status: 200
  body: "$expr: value.some(app => app.name === 'calculator' && ['add', 'multiply', 'divide'].every(name => app.methods.some(method => method.name === name)))"
```

```step
application: ronsel-api
method: get
description: The environments are the union of every application's env files
parameters:
  params:
    path: /api/environment/all-possible
test:
  status: 200
  body: "$expr: Array.isArray(value) && value.includes('local')"
```

```step
application: ronsel-api
method: post
description: A flow is ready to run when every application it uses has the env file
parameters:
  params:
    path: /api/environment/readiness
  body:
    environment: local
    applications: [calculator]
test:
  status: 200
  body:
    known: true
    ready: true
    missing: "$expr: value.length === 0"
```

```step
application: ronsel-api
method: post
description: An environment nobody declared is not ready, and is said to be unknown
parameters:
  params:
    path: /api/environment/readiness
  body:
    environment: nowhere
    applications: [calculator]
test:
  status: 200
  body:
    known: false
    ready: false
```

## Views

```step
application: ronsel-api
method: get
description: A context without views.yaml still has the default view
parameters:
  params:
    path: /api/views
test:
  status: 200
  body:
    views: "$expr: Array.isArray(value) && value.length >= 1"
```

```step
application: ronsel-api
method: get
description: The filter operators the editor offers are the ones the evaluator implements
parameters:
  params:
    path: /api/views/operators
test:
  status: 200
  body:
    operators: "$expr: ['is', 'contains', 'inFolder', 'hasTag'].every(id => value.some(operator => operator.id === id))"
```

```step
application: ronsel-api
method: get
description: Running the default view over every flow lists all the examples
parameters:
  params:
    path: /api/views/query
test:
  status: 200
  body:
    total: "$expr: value >= 4"
    rows: "$expr: value.length === flow.steps[flow.steps.length - 1].response.body.total"
    errors: "$expr: value.length === 0"
```
