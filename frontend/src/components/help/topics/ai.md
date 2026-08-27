---
category: integrations
order: 1
icon: sparkles
title: 'Writing flows with AI'
summary: 'Generate a flow from a description, or rewrite one with the magic wand.'
keywords:
  - 'ai'
  - 'ollama'
  - 'gemini'
  - 'anthropic'
  - 'claude'
  - 'generate'
  - 'prompt'
  - 'magic wand'
  - 'model'
---

### Configure a provider

In **Settings › AI**, pick one of:

| Provider | What you need |
|-|-|
| **Ollama (local)** | A running Ollama and a pulled model (`ollama pull llama3.1`). Nothing leaves your machine. |
| **Google Gemini** | An API key from aistudio.google.com. |
| **Anthropic (Claude)** | An API key from console.anthropic.com. Defaults to `claude-opus-5`. |

Use **Test connection** before generating anything: it does a real round trip
to the provider.

### Create a flow

When creating a flow, turn on **Create using AI** under the file name. The file
is created first — so it exists whatever happens next — and a second dialog
asks what it should test:

> Create a post on jsonplaceholder with a random title, check it comes back
> with a 201, and then fetch a post that does not exist.

What comes back is a Markdown flow built from the applications you actually
have. It is validated before being saved — it has to parse, contain at least
one step, and only use existing applications and methods — and the model gets
one chance to fix its own mistakes before the error reaches you.

### Edit a flow

Open any flow and use the **magic wand** next to the Document/Source toggle:
describe the change ("also cover the unhappy path", "explain each section") and
the document is rewritten. The result lands in the editor as an **unsaved**
change, so you can read it — and reload to throw it away — before saving.
