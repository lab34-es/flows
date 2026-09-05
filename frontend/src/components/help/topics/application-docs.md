---
category: applications
order: 2
icon: file
title: 'Documenting an application'
summary: 'The JSDoc blocks of index.ts are the method reference the UI shows and the catalogue the AI writes flows from. How to write them well.'
keywords:
  - 'jsdoc'
  - 'documentation'
  - 'docs'
  - 'param'
  - 'returns'
  - 'memory'
  - 'example'
  - 'readme'
  - 'description'
  - 'guidelines'
  - 'ai'
  - 'catalogue'
  - 'capabilities'
---

An application documents itself in its own code. There is no `docs.json` and
no wiki page to keep in sync: the JSDoc block at the top of `index.ts`
describes the application, and the block right above each exported method
describes that method. Three readers use exactly that text:

- the **application page**, which renders it as the method reference, with
  the example ready to paste;
- `lab34-flows --capabilities`, on the terminal;
- the **AI**, which is handed the whole catalogue when it writes or rewrites
  a flow. It knows nothing else about your systems, so the quality of the
  generated flows is the quality of these blocks.

## The tags

    /**
     * Creates an order for a customer and reserves its stock.
     *
     * @param {string} body.customerId - The customer placing the order.
     * @param {string[]} body.skus - What is ordered, one SKU per line.
     * @param {string} [body.channel=web] - Where the order comes from.
     * @returns {201 | 409} The order as created, or 409 when a SKU is out of stock.
     * ```json
     * { "orderId": "ORD-3817", "status": "reserved", "lines": 2 }
     * ```
     * @memory {write} orderId - The id of the order, for the steps that follow.
     * @memory {read} customerId - Used when body.customerId is left out.
     * @example
     * application: orders
     * method: createOrder
     * parameters:
     *   body:
     *     customerId: "{{ memory.customerId }}"
     *     skus: ["SKU-1"]
     * test:
     *   status: 201
     */
    export const createOrder = applications.handler([...], 'createOrder');

| Tag | Meaning |
|-|-|
| The free text | The description, in Markdown. What the method does, in one or two sentences. |
| `@param {type} name - description` | An input, named as the flow writes it: `body.customerId`, `query.page`, `params.id`. `[name]` marks it optional, `[name=value]` adds a default. |
| `@returns {status} description` | What comes back. Several statuses as `{201 \| 409}`. A fenced `json` block right after it is the example body. |
| `@memory {write} key - description` | A key this method writes into the flow memory. |
| `@memory {read} key - description` | A key it reads, and what happens without it. |
| `@example` | A complete step, in YAML, that runs as it is. |

A tag owns every line until the next tag, so a description can wrap. The
block at the top of the file has no tags: it is the application's
description, and the place to say what the system is and which environments
it knows.

## What makes a good one

**Name inputs the way a flow spells them.** `body.customerId`, not
`customerId`: the reader is copying the name into a `parameters` block, and
so is the model.

**Say what fails, not only what succeeds.** `@returns {200 | 404}` with a
sentence on when the 404 happens is what lets a flow cover the unhappy path. A
method that only documents its success is only ever tested for success.

**One example that runs.** The `@example` is pasted as it is, by people and by
the model. Use real-looking values, replacers where a value must be fresh
(`{{ randomEmail }}`), and memory where the value comes from an earlier step.
If the method needs a step before it, say so in the description.

**Declare the memory.** Every key a method writes or reads goes in a `@memory`
tag. It is how the next person, or the model, knows that `createOrder` leaves
`orderId` behind and that `refund` expects it.

**Keep the README for context.** Who owns the system, which environments
exist, what has to be true before running against production, where the
credentials come from. Not the method list: the UI reads that from the code,
and a copy in the README only goes stale.

**Write for the model too.** Use the vocabulary of the business, not of the
transport: "reserves the stock", not "POSTs to /orders". When two methods look
alike, say in the description when to use which.

## Checking it

Open the application in the sidebar: the **Methods** tab is exactly what the
JSDoc produced, and a method without a block shows up with little more than
its name. Then ask the AI for a flow that uses the method: when what comes back
is wrong, the block is usually what needs fixing.
