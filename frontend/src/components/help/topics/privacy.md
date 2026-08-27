---
category: help
order: 2
icon: shield
title: 'Privacy and what leaves your machine'
summary: 'Exactly which network calls the tool makes, and when.'
keywords:
  - 'privacy'
  - 'security'
  - 'keys'
  - 'secrets'
  - 'network'
  - 'data'
  - 'offline'
  - 'local'
---

The tool runs locally: the web UI is served by your own machine and your flows
are files on disk.

Data leaves your machine only when you ask for it:

- **Running a flow** reaches whatever your applications reach (an API, a broker,
  a database, a website).
- **AI generation** sends your prompt, the flow, and your applications'
  documentation to the provider you picked in *Settings › AI*. With **Ollama**
  that provider is your own machine, so nothing leaves it at all.
- **Xray** is contacted only when a rendered flow mentions a test key.

API keys and tokens are stored in `config/ai.json` and `config/jira.json` inside
your context folder, and are never sent back to the browser — the UI is only
told whether a secret is stored.
