---
category: flows
order: 3
icon: check
title: 'Assertions'
summary: 'The test section of a step: status, body, JavaScript expressions, and asserting against what an earlier step remembered.'
keywords:
  - 'test'
  - 'assert'
  - 'assertion'
  - 'expr'
  - 'status'
  - 'body'
  - 'expression'
  - 'validation'
  - 'memory'
  - 'unhappy path'
---

The `test` section of a step asserts the response. Plain values are compared
for equality, and the body is matched key by key, as deep as you write it:

    test:
      status: 400
      body:
        error:
          code: DIVISION_BY_ZERO

A step without a `test` passes as long as the method does not fail.

### JavaScript expressions

For anything beyond equality, prefix the value with `$expr:` and write
JavaScript, where `value` is the actual value being tested:

    test:
      body:
        count: "$expr: value > 10"
        items: "$expr: Array.isArray(value) && value.length >= 3"
        user:
          age: "$expr: value >= 18 && value <= 65"

| Validation | Expression |
|-|-|
| Greater than | `$expr: value > 0` |
| Exact value | `$expr: value === 2` |
| In a range | `$expr: value >= 5 && value <= 10` |
| String contains | `$expr: typeof value === 'string' && value.includes('ok')` |
| Array has items | `$expr: Array.isArray(value) && value.length > 0` |
| Property exists | `$expr: typeof value === 'object' && 'id' in value` |
| Date after | `$expr: new Date(value) > new Date('2023-01-01')` |

Random values are the usual reason to reach for an expression: a body that
echoes `{{ randomEmail }}` cannot be compared to a literal, but it can be
checked for shape.

### Asserting against what an earlier step remembered

A `test` block is **not** templated: `{{ memory.barcode }}` written in one is
compared as the twenty characters it is, not as the barcode. To assert
against something an earlier step left behind, use an expression: `memory` is
in scope beside `value`, and so is the whole `flow`.

    test:
      body:
        barcode: "$expr: value === memory.barcode"
        data: "$expr: value.some(i => i.barcode === memory.barcode)"

How the memory gets written is in [Passing data between steps](/help/memory).

### Messages that arrive later

An effect that does not come back in the response, a message published on
MQTT after the call, is asserted with `test.latentApplications`. See
[Latent applications](/help/latent-applications).

### Cover the unhappy paths

Asserting that a missing resource returns `404` is what catches the
regression that starts answering `200`. A flow that only checks success only
ever fails when everything breaks.
