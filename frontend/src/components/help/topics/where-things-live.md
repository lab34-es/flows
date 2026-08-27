---
category: reference
order: 3
icon: folder
title: 'Where things live'
summary: 'Your context folder: flows, applications, credentials.'
keywords:
  - 'context'
  - 'folder'
  - 'path'
  - 'config'
  - 'ai.json'
  - 'jira.json'
  - 'storage'
  - 'files'
---

Everything is stored in your **context directory**, which is `~/lab34-flows` by
default (override it with `--context <path>`):

| Path | What it holds |
|-|-|
| `flows/` | Your flows — the tree you see in the sidebar. |
| `applications/` | One folder per application: `index.ts`, `README.md`, `envs/*.env`. |
| `config/ai.json` | AI provider, model and API keys. |
| `config/jira.json` | Jira / Xray credentials. |

Credentials never leave your machine except to reach the provider or Jira, and
they are never sent back to the browser: the UI is only told whether a secret
is stored.

The theme you pick in **UI** is the exception — it is kept in this browser's
local storage, not in the context folder.
