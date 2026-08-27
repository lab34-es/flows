---
category: writing
order: 5
icon: share
title: 'Passing data between steps'
summary: 'Flow memory: what one step writes, the next one reads.'
keywords:
  - 'memory'
  - 'lastResult'
  - 'variables'
  - 'handlebars'
  - 'between steps'
  - 'reuse'
  - 'share'
  - 'state'
  - 'pass data'
  - 'return'
  - 'tuple'
  - 'write'
  - 'read'
  - 'fallback'
---

A flow carries one plain object called the **memory**. It starts empty every
time you press *Run*, any step can write to it, and every later step can read
it. That is how the id created by step 2 ends up in the body of step 5.

### Writing it: the fourth value a method returns

A method returns a tuple — `[headers, status, body, memory]`. The first three
describe the response; the **fourth** is what this step contributes to the
memory.

    export const add = applications.handler([
      async (ctx: Context, parameters: Parameters) => {
        const { a, b } = parameters.body;
        const result = a + b;
        //       headers  status  body                            memory
        return [ {},      200,    { operation: 'add', result },   { lastResult: result } ];
      }
    ], 'add');

That fourth value is **optional**: leave it out, as most methods do, and the
step writes nothing. The helpers (`httpClient`, `pgClient`, `playwright`)
return the first three, so a method that wants to remember something builds
the object itself:

    const [headers, status, responseBody] = await httpClient.post(ctx, '/posts', { body });
    const memory = responseBody && responseBody.id ? { lastPostId: responseBody.id } : {};
    return [headers, status, responseBody, memory];

Writing conditionally like that is the normal thing to do — remember the id
only when there was one, so a failed call does not leave a stale value behind
for the steps that follow.

### How the writes add up

When a step returns, what it wrote is **merged** into the flow memory:

| | |
|-|-|
| New keys | Are added. |
| Keys that already existed | Are **overwritten** by the newer step. |
| Keys the step did not mention | Are left untouched. |
| Objects | Are replaced whole — the merge is shallow, not deep. |

So `memory.lastResult` always means *the most recent* result, and a step that
returns no memory changes nothing.

### Reading it: `{{ memory.key }}`

Anywhere inside a step's `parameters`, a Handlebars template reads the memory
as it stands when that step starts:

    ```step
    application: calculator
    method: multiply
    description: Multiply the previous result by 2, using memory
    parameters:
      body:
        a: "{{ memory.lastResult }}"
        b: 2
    test:
      status: 200
      body:
        result: 84
    ```

Nested values work the same way — `{{ memory.user.id }}`.

### What to watch out for

| | |
|-|-|
| **Earlier steps only** | A step sees what the steps *above* it wrote. A key nothing has written yet resolves to an empty string. |
| **Parameters only** | Only `parameters` are templated. `test` assertions are **not**, so `{{ memory.x }}` in a test is compared literally — write the expected value out, or assert it with a `$expr` expression. |
| **Everything arrives as text** | `a: "{{ memory.lastResult }}"` passes the string `"42"`, not the number `42`. Methods that expect numbers should accept numeric strings — the `calculator` example does exactly that. |
| **Reach for the leaf** | `{{ memory.user }}` renders `[object Object]`. Interpolate `{{ memory.user.id }}`, or read the object from application code. |
| **Text is HTML-escaped** | `{{ }}` turns `&` into `&amp;` and `'` into `&#x27;`. Triple braces `{{{ }}}` skip the escaping, but a value containing a double quote will break the step. |
| **Retries reuse the values** | Parameters are resolved once, before the first attempt. A `retry` re-sends exactly what was sent the first time; it does not re-read the memory. |
| **One run, one memory** | Memory is never shared between flows and does not survive a run. Press *Run* again and it is empty again. |

### Reading it from application code

A method's third argument is the flow, so `flow.memory` is the whole object —
useful when the value is not a scalar, or when the decision belongs to the
method rather than to the flow author:

    export const readBack = applications.handler([
      (ctx: Context, parameters: Parameters, flow: Flow) =>
        httpClient.get(ctx, `/posts/${flow.memory.lastPostId}`)
    ], 'readBack');

A validator can do the same declaratively: `validate.body` accepts
`fallbacks`, which fill a missing field from the memory before the schema is
checked — the flow may pass `token`, and when it does not, the one remembered
by an earlier login step is used.

    validate.body({
      type: 'object',
      properties: { token: { type: 'string' } },
      fallbacks: { token: [{ type: 'memory', key: 'authToken' }] }
    })

### Documenting it

Which keys a method writes (or reads) is part of its documentation, through
the `@memory` JSDoc tag:

    /**
     * @memory {write} lastResult - The result of the operation.
     * @memory {read} authToken - The token stored by the login step.
     */

The application page lists them per method under *Memory* — that is where to
look when you are writing a flow and need to know what a step leaves behind.
