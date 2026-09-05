---
category: start
order: 1
icon: rocket
title: 'Quick start'
summary: 'Install the tool, create a context folder inside your own repository, run a demo and commit your first flow.'
keywords:
  - 'start'
  - 'begin'
  - 'first'
  - 'tutorial'
  - 'new'
  - 'welcome'
  - 'install'
  - 'context'
  - 'repository'
  - 'git'
  - 'gitignore'
  - 'example'
---

From nothing to a flow of your own, committed next to the code it tests.

## 1. Install

The tool is an npm package. It needs Node.js 24 or newer.

    npm install -g @lab34/flows

Flows that drive a browser also need Playwright's browsers, which are a
separate download. Skip this until you need it:

    npx playwright install chromium

## 2. Create a context folder

Everything the tool reads and writes lives in one folder: the **context**.
Flows, applications, environment files, saved views and test runs are all
plain files under it, which is why the right place for it is a git repository
of yours: a dedicated one, or a folder of the repository that holds the code
under test.

    mkdir e2e
    lab34-flows --server --context e2e

The folder has to exist. The first start seeds it with four example
applications and four example flows, and writes a `tsconfig.json` so your
editor understands the applications. Leave `--context` out and the default
folder, `~/lab34-flows`, is used instead. The name of the folder in use is
always shown in the top bar.

## 3. Run a demo

Open [http://localhost:3001](http://localhost:3001). In the top bar, pick the
**local** environment: the example applications declare it, so every demo
runs against it.

![The home page: the flows and applications of the context, and the environment picked in the top bar](/help-images/home.webp)

From the sidebar, open **01 · Welcome** and press **Run**. The steps execute
in the order they appear in the document, and the request, response,
assertions and timings of each one appear right below its block, like a
notebook. The flow works fully offline: the `calculator` application it calls
is a few lines of TypeScript on your disk.

The other examples reach out: **02 · HTTP basics** calls httpbin.org,
**03 · Posts and memory** a fake REST API, and **04 · Browser, scraping and
memory** drives a browser against a page it serves itself.

## 4. Write your own

Use the `+` button next to **Flows** in the sidebar: a new flow, a folder, or
a file to upload. Turn on **Create using AI** if you would rather describe the
scenario in plain words and have the document written for you.

A flow is a Markdown document. Write whatever you want around the steps, and
make a step out of a fenced code block tagged `step`:

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

Click any paragraph or step in the **Document** view to edit it in place;
type `/` for headings, callouts and steps. Changes are saved as you type. See
[The flow document](/help/flows).

When a step has to call something of yours, create an application for it with
the `+` next to **Applications**: a folder with documented example methods to
replace, and one environment file. See [Applications](/help/applications).

## 5. Commit it

The context folder is yours, so version it like the rest of your code. Before
the first commit, add a `.gitignore` at its root:

    # Secrets: one env file per application per environment.
    # Commit the .env.example templates next to them instead.
    applications/*/env/*.env
    !applications/*/env/*.env.example

    # Credentials of the AI and Jira integrations, and the secrets of the
    # SharePoint and remote agents ones (their config files are safe to commit)
    config/ai.json
    config/jira.json
    .env

    # Regenerated on every start, with paths into this machine's installation
    tsconfig.json

    # Runs are evidence, not source. Keep them if you want the history in git.
    test-runs/

Everything else is meant to travel: the flows, the applications with their
README and `.env.example` templates, `views.yaml`, and the config of
SharePoint and remote agents.

Then commit and push, from your terminal or from the tool: the sync button
next to the folder name in the top bar lists the changed files and offers
**Pull**, **Commit** and **Push**. Whoever clones the repository gets the
flows and the applications, starts the tool with `--context` pointing at the
folder, and only has to fill in the environment files.
[Environments](/help/environments) explains how those values are handed over
without ending up in git.

## Where to go next

- [Concepts](/help/concepts): flows, applications and environments, and how
  they fit together.
- [The context folder](/help/context): every file in it, and what the git
  panel does.
- [Command line](/help/cli): the same flows in a CI/CD pipeline.
