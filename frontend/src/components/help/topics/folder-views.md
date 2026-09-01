---
category: basics
order: 6
icon: folder
title: 'Folder views'
summary: 'A folder of flows as a table you can sort, filter and search.'
keywords:
  - 'views'
  - 'table'
  - 'folder'
  - 'filter'
  - 'sort'
  - 'columns'
  - 'search'
  - 'base'
  - 'obsidian'
  - 'views.yaml'
  - 'formula'
---

Click a folder in the sidebar and every flow below it — **subfolders
included** — is listed as a table: one row per flow, one column per property.
The toolbar searches, picks which properties are shown and in which order,
sorts, and filters.

Those settings are **views**, saved in a single `views.yaml` at the root of
your context directory, in the shape [Obsidian
Bases](https://help.obsidian.md/bases) uses:

    formulas:
      coverage: 'if(flow.steps > 3, "deep", "shallow")'
    properties:
      note.owner:
        displayName: Responsable
    views:
      - type: table
        name: Critical
        filters:
          conjunction: and
          conditions:
            - property: note.priority
              operator: greaterThan
              value: 5
        order: [file.name, note.owner, note.priority, formula.coverage]
        sort:
          - property: note.priority
            direction: DESC

A view is **not tied to a folder**: every view is a tab on every folder, and
applies to whichever folder is open. Which one a folder was last opened with
is remembered in your browser, so `views.yaml` holds no folder references.

- **Properties** — the columns, and their order. Renaming one here writes a
  `displayName`, which every view then follows. A property holding an object
  also offers its fields: `xray: { testKey: … }` is there as
  `note.xray.testKey`, a column of its own.
- **Sort** — stack several: the first that separates two flows wins.
- **Filter** — which flows the view keeps: a property, an operator and a
  value, picked rather than typed. See *Filters and formulas*.
- **⋯ › Formulas** — columns worked out from the others.
- **Run all** — executes the flows the view is showing, as one test run.
- **CLI** — the command that runs this same view from a terminal or a
  pipeline; see *Command line*.
