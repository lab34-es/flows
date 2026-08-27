---
category: integrations
order: 2
icon: ticket
title: 'Jira / Xray'
summary: 'Link a flow to a Test issue, and pull the tests of your projects.'
keywords:
  - 'jira'
  - 'xray'
  - 'test key'
  - 'testKey'
  - 'cloud'
  - 'server'
  - 'data center'
  - 'token'
  - 'issue'
  - 'pull'
  - 'sync'
  - 'download'
  - 'test repository'
  - 'feature'
  - 'user story'
  - 'project key'
  - 'projects'
---

A flow maps to an Xray **Test** issue, and every step block to a **step** of
that test. The link is declared in the flow itself, so it travels with the
document:

    ---
    title: Fraud detection
    xray:
      testKey: ABC-1234
    ---

`testKey` can also be set inside a step block; that one is informative for now.

Configure it in **Settings › Xray**. Three flavours are supported:

- **Xray Cloud** — data comes from Xray's API, authenticated with an API key
  you create in Jira at *Apps › Xray › API Keys* (client id + client secret).
  Keep the default Xray URL unless your instance uses a regional endpoint
  (`https://eu.xray.cloud.getxray.app`, `https://us.xray.cloud.getxray.app`).
- **Jira Cloud (API token)** — for when you cannot get an Xray API key (it
  needs Jira admin rights): the data is read from Jira with your **email** and
  an **Atlassian API token**, created at *id.atlassian.com › Security › API
  tokens*. Xray-only data, like the test type, is not available this way.
- **Jira Server / Data Center** — no external service: the data is read from
  Jira with a **personal access token**, created at *your profile › Personal
  Access Tokens*.

**Project keys** is the list of Jira projects a pull downloads, separated by
commas (`ABC, ACME`). Each project is pulled into a folder of its own.

**Test connection** validates the credentials for real. Nothing is downloaded
until a flow that mentions a test key is rendered, and every key is downloaded
at most once per run of the tool.

**Pull tests** downloads every Test of those projects into an `xray` folder in
your flows — one folder per project key, one Markdown document per test, with
the Jira description and the Xray **test details** as its content, and no step
blocks yet. The details block
is the Test Details panel as Markdown: the steps of a Manual test, the scenario
of a Cucumber one, the definition of a Generic one. Xray Cloud answers them
with the tests themselves; on Server/DC the steps come from Xray's own API;
with a Jira API token only what Xray exposes as a Jira field can be read.

Inside a project's folder, with an Xray API key (Cloud) or on Server/DC the
folders mirror the **Test Repository**; with a Jira API token there is no Test Repository to read, so
they are rebuilt from Jira's hierarchy:

    xray/<PROJECT>/<FEATURE>_<slug>/<STORY>_<slug>/<TEST>_<slug>.md

A test that is a child of nothing gets its feature and story from its
**related work** — the issue links — and whatever cannot be resolved lands in
`_no-feature` / `_no-user-story`. A project Jira will not answer is logged and
the pull moves on to the next one. Pulling again rewrites only the frontmatter,
the description block and the details block: the steps you wrote stay, a test
that moved in Jira is moved rather than duplicated, and nothing is ever deleted.

**Overwrite tests already pulled** decides what that second pull does with the
tests that are already on disk. On (the default), a flow whose `xray.testKey`
is already in `xray` is updated with what Jira says now. Off, it is left
exactly as it is — not moved, not rewritten, nothing downloaded for it — and
only tests that were never pulled are written; the modal counts the rest as
**skipped**.

> Uploading executions back to Xray is **not supported yet**: nothing this
> integration does ever writes to Jira.

When Jira cannot be reached, the key is shown as plain text with the error on
hover — a flow never fails to render, or to run, because of Jira.
