---
category: start
order: 2
icon: layout
title: 'Concepts'
summary: 'Flows, applications and environments: the three things every other page is about, and how they fit together.'
keywords:
  - 'concepts'
  - 'terms'
  - 'glossary'
  - 'flow'
  - 'application'
  - 'environment'
  - 'context'
  - 'test run'
  - 'view'
  - 'property'
  - 'structure'
---

Three nouns carry the whole tool. A **flow** says what to test. An
**application** knows how to talk to a system. An **environment** says which
instance of that system, with which credentials. Everything else is a
container for those three, or a record of running them.

    flows/checkout/refund.md              the flow: prose + steps
      └─ step: payments.refund
          └─▶ applications/payments/index.ts   the application
                └─ env/uat.env                 the environment
                    └─▶ https://uat.payments.example
    test-runs/2026-08-20_14-30-05-uat/    what happened, as files

## Flows

A flow is a **Markdown document**: headings, prose, lists, images, and among
them fenced code blocks tagged `step`. Each block names an application and one
of its methods, the parameters to send and what the response must look like.
Press Run and the steps execute in order, each one showing its request,
response and assertions right below the block.

Prose and steps in the same file is the point: the document explains what the
scenario covers, what has to be true before it runs and what to look at when
it fails, and that same file is what the pipeline executes. Flows live under
`flows/` in the context folder, in whatever tree of subfolders you like.

    ```step
    application: payments
    method: refund
    parameters:
      body:
        orderId: "{{ memory.orderId }}"
    test:
      status: 202
    ```

Read more in [The flow document](/help/flows).

## Applications

An application is a folder under `applications/` with a TypeScript module,
`index.ts`, that exports **methods**. A method is what a step calls: it
receives the step's parameters, does the work (an HTTP request, a SQL query,
an MQTT publish, a browser automation) and returns the headers, status and
body the step asserts on, plus anything worth remembering for later steps.

Applications document themselves in the JSDoc blocks of that file. The UI
renders those blocks as the method reference, `--capabilities` lists them on
the terminal and the AI reads them when it writes a flow. Read more in
[Applications](/help/applications).

## Environments

An environment is a name, `local`, `uat`, `production`, and behind the name
one **env file per application**: `applications/<app>/env/<environment>.env`.
The file holds the URL, credentials and options that application needs to
reach that instance. A method reads them as `ctx.env`.

An environment exists as soon as one application has a file for it, and a run
only needs the files of the applications its flow actually uses. The env
files hold secrets, so they stay out of git; committed `.env.example`
templates say which variables each one needs, and the tool moves the values
between machines as one document. Read more in
[Environments](/help/environments).

## The two containers

The **context folder** holds all of the above, and it is meant to be a git
repository of yours. See [The context folder](/help/context).

A **test run** is what a Run produces: a folder under `test-runs/` with a
summary, a copy of every flow that ran with the results written into it, and
a standalone HTML report. See [Test runs](/help/test-runs).

## Two more words

**Properties** are the keys of a flow's frontmatter: `title`, `description`,
and anything you add, `owner`, `tags`, `priority`. They are what folder tables
sort and filter on.

**Views** are saved filters over the flows, kept in `views.yaml` at the root of
the context. A folder is shown through a view, *Run all* runs what a view
lists, and `--view` runs the same list from a pipeline. See
[Organizing flows](/help/organizing).
