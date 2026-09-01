---
category: reference
order: 1
icon: code
title: 'Filters and formulas'
summary: 'What a view keeps, and what a formula computes.'
keywords:
  - 'filter'
  - 'formula'
  - 'expression'
  - 'operator'
  - 'and'
  - 'or'
  - 'none'
  - 'hasTag'
  - 'inFolder'
  - 'if'
  - 'contains'
---

A view's **filters** decide which flows it lists. A **formula** works out a
column from the others. They are two different things: a filter is picked, a
formula is written.

## Filters

A filter is a **property**, an **operator** and a **value** — chosen from
dropdowns, never typed as code. There is nothing to get syntactically wrong,
which is the point: a filter cannot be a syntax error.

Open **Filter** in the toolbar and each condition reads as a sentence:

    Owner        is            ana
    Priority     is greater…   5
    The file     has tag       smoke

Conditions sit in a **group**, and the group decides how they combine:

| Group | Keeps a flow when |
|-|-|
| All of the following are true | every condition matches |
| Any of the following is true | at least one matches |
| None of the following is true | not one matches |

**Add filter group** nests a group inside a group, so "owner is ana, and
either it is a smoke test or its priority is above 5" is built rather than
written.

The editor has two sections. **This view** filters the view you are on;
**All views** filters every view in the context, on top of whatever each one
asks for. The count above updates as you build, before you apply anything.

### The operators

Which ones a property offers depends on what it holds — a number is never
offered *starts with*.

| The property holds | Operators |
|-|-|
| Text | is, is not, contains, does not contain, starts with, ends with |
| Number | is, is not, is greater than, is greater than or equal to, is less than, is less than or equal to |
| Checkbox | is checked, is not checked |
| Date | is, is before, is on or before, is after, is on or after — against a date, `today` or `now` |
| List | is, is not, has any of, has all of, has none of, contains |
| The file itself | is in folder, is not in folder, has tag, does not have tag, has property, does not have property |

Every type also has **is empty** and **is not empty**.

A property a flow does not carry is empty, and empty never satisfies a
comparison — so a filter is never broken by a flow nobody has annotated yet.
*Is in folder* matches the folder and everything below it.

Values are suggested from what the folder's flows actually hold, so a tag or
an owner is picked from the ones that exist rather than remembered.

### In views.yaml

Filters are stored as what they are:

    views:
      - type: table
        name: Critical
        filters:
          conjunction: and
          conditions:
            - property: note.priority
              operator: greaterThan
              value: 5
            - property: file
              operator: hasTag
              value: [smoke]
            - conjunction: or
              conditions:
                - property: note.owner
                  operator: is
                  value: ana
                - property: note.reviewed
                  operator: isTrue

A bare property name is frontmatter, so `priority` and `note.priority` are the
same thing. `property: file` is the file itself, not a frontmatter key called
"file".

## Formulas

A formula **is** an expression — it computes a value, so it needs a language.
Four namespaces are available:

| Namespace | What it holds |
|-|-|
| `note.<property>` | A frontmatter property of the flow |
| `file.<property>` | `name`, `basename`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags` |
| `flow.<property>` | `title`, `description`, `steps`, `hasErrors` |
| `formula.<name>` | Another formula |

    formulas:
      coverage: 'if(flow.steps > 3, "deep", "shallow")'
      owner: 'default(note.owner, "nobody")'
      age: 'file.mtime.format("YYYY-MM-DD")'

Functions include `if(condition, then, else)`, `min()`, `max()`, `round()`,
`number()`, `date()`, `now()` and `default(value, fallback)`; values carry
methods such as `contains()`, `startsWith()`, `isEmpty()`, `lower()`, `join()`
and `format()`.

A formula that is broken (an unknown function, a typo) is reported above the
table instead of taking the view down.
