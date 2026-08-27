---
category: writing
order: 6
icon: check
title: 'Assertions and tests'
summary: 'Assert the status and the body, including JavaScript expressions.'
keywords:
  - 'test'
  - 'assert'
  - 'expr'
  - 'status'
  - 'body'
  - 'expression'
  - 'validation'
---

The `test` section of a step asserts the response. Plain values are compared
for equality, and the body is matched key by key, as deep as you write it:

    test:
      status: 400
      body:
        error:
          code: DIVISION_BY_ZERO

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

Cover the unhappy paths too: asserting that a missing resource returns `404`
is what catches the regression that starts answering `200`.
