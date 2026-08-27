---
category: basics
order: 5
icon: file
title: 'Properties'
summary: 'Any frontmatter property you like, editable from the document.'
keywords:
  - 'properties'
  - 'frontmatter'
  - 'metadata'
  - 'owner'
  - 'tags'
  - 'priority'
  - 'title'
  - 'description'
---

Every key in a flow's frontmatter is a **property**. A handful mean something
to the tool — `title`, `description`, `version`, `latentApplications`,
`xray` — and everything else is yours to invent.

    ---
    title: Fraud detection
    description: A payment above the limit is held for review
    owner: ana
    priority: 8
    reviewed: true
    tags:
      - smoke
      - payments
    due: 2026-03-01
    ---

The **Document** view renders them as a list you can edit in place: click a
value to change it, click a name to rename it, and use **Add property** for a
new one. `title` and `description` are ordinary properties, but they are
shown above the list — as the document's heading and standfirst — rather than
as two more rows.

Nothing declares a property's type: it is whatever its value is. A number
sorts numerically, `true` / `false` renders as a checkbox, a list renders as
chips, and an ISO date sorts chronologically. Adding a property asks which kind
of value to start from, and from then on the value itself is the type.

A property can hold an object, and its fields are addressed with a dot:
`xray.testKey` reads `testKey` inside `xray`. Folder views offer those
fields as columns of their own, so an embedded block does not have to be read
as raw JSON.

Properties are what folder views filter and sort on — see *Folder views*.
