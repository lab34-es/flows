---
category: integrations
order: 3
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
  - 'telemetry'
---

The tool runs locally: the web UI is served by your own machine and your
flows are files on disk. There is no account and no telemetry. Data leaves
your machine only when you ask for it:

- **Running a flow** reaches whatever your applications reach: an API, a
  broker, a database, a website.
- **AI generation** sends your prompt, the flow being edited and the
  documentation of your applications to the provider picked in
  *Settings › AI*. With **Ollama** that provider is your own machine, so
  nothing leaves it at all. See [Writing flows with AI](/help/ai).
- **Xray** is contacted when a rendered flow mentions a test key, and when
  you pull tests. Nothing is ever written to Jira.
- **SharePoint** receives the HTML report of a finished run, when the
  integration is configured.
- **Remote agents** talk through the MQTT broker you configure. The env
  values a run needs travel encrypted to the agent's key; the broker only
  ever sees ciphertext.

Secrets are stored in the context folder, and nowhere else: API keys in
`config/ai.json`, Jira credentials in `config/jira.json`, the SharePoint
client secret and the broker password in the root `.env`, and the credentials
of your systems in the applications' env files. None of them is ever sent back
to the browser: the UI is only told whether a secret is stored. Keep them out
of git; see [The context folder](/help/context).
