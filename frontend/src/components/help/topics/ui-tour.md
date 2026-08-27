---
category: basics
order: 3
icon: layout
title: 'The web UI'
summary: 'What every part of the screen does.'
keywords:
  - 'sidebar'
  - 'notebook'
  - 'source'
  - 'document'
  - 'tour'
  - 'interface'
  - 'environment'
---

- **Sidebar › Flows** — your flows tree, with a live status dot per flow
  (*standby*, *running*, *ok*, *error*). Create folders and flows, upload files
  and delete them from the `+` menu and each row's actions.
- **Sidebar › Applications** — every application in your context directory.
  Click one to read its README and browse its methods: input parameters,
  output, memory usage and examples, plus its environment files.
- **Sidebar footer › Environment** — the environment used for every run.
- **Top bar › Context folder** — the folder everything is read from and written
  to, with its git branch next to it -- a menu to switch, create and fetch
  branches -- and a *sync* button (see *The context folder and git*). Changed files are coloured in the sidebar, the way an
  editor's explorer does it.
- **Notebook view** — a flow rendered as a document, with each step block as a
  cell. Press *Run* and the details stream in below each block. It is also
  where you write: click any block to edit its Markdown in place, and type
  `/` for headings, callouts and steps (see *Writing in the Document view*).
  Changes are saved as you type — there is no Save button.
- **Document / Source toggle** — *Source* opens the whole file in a plain
  Markdown editor, for when it is easier to work on the text as text.
  Applications have the same toggle for their `README.md`, `index.ts` and
  `env/*.env` files.
- **Magic wand** — next to the toggle: describe a change and the model rewrites
  the document (see *Writing flows with AI*).
- **Click a folder** and its flows — subfolders included — are listed as a
  table you can search, sort and filter (see *Properties* and *Folder views*).
