---
category: basics
order: 1
icon: rocket
title: 'Quick start'
summary: 'From a fresh installation, to a running flow, in four steps.'
keywords:
  - 'start'
  - 'begin'
  - 'first'
  - 'tutorial'
  - 'new'
  - 'welcome'
  - 'example'
---

1. **Installation** Install the npm package globally: `npm i -g @lab34/flows`
2. **The UI** Start the UI: `lab34-flows --server --context <the path where you want to store everything>`
3. **Access the browser** Visit [http://localhost:3001](http://localhost:3001)
4. **Pick and run** From the sidebar, select a flow (or a folder of them), and run any of the demos.
Steps execute in the order they appear in the document, and the execution details of each one (request, response, assertions, timings) appear right below its block, like a notebook.

From now on, you can **write your own.** Use the `+` button next to *Flows* in the sidebar to create a flow, a folder, or to upload a file — and turn on *Create using AI* if you would rather describe the scenario in plain words.

Nothing here is magic: a flow is a Markdown file in your context folder, so it lives in your repository and travels with your team.
