---
category: writing
order: 8
icon: ghost
title: 'Mimicking dependencies'
summary: 'Fake what a dependency answers, so you can test locally.'
keywords:
  - 'mimic'
  - 'mock'
  - 'stub'
  - 'fake'
  - 'dependency'
  - 'offline'
  - 'fail scenario'
---

A step can replace the behaviour of a dependency it triggers, which is how you
reproduce failure scenarios without breaking anything for real:

    ```step
    application: "accounting"
    method: "getInvoice"
    parameters:
      params:
        customerId: "{{ randomInt0_100 }}"
    mimic:
      - application: "coinscrap"
        url: "/fraud-detection"
    test:
      status: 404
      body:
        error:
          code: "ACCOUNTING_FRAUD_DETECTED"
    ```

Mimicked responses go through the same replacers as the rest of the flow, so
they can contain `{{ uuid }}`, `{{ randomEmail }}` and friends.
