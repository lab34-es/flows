---
category: reference
order: 1
icon: code
title: 'Filters and formulas'
summary: 'The little expression language behind views.'
keywords:
  - 'filter'
  - 'formula'
  - 'expression'
  - 'and'
  - 'or'
  - 'not'
  - 'hasTag'
  - 'inFolder'
  - 'if'
  - 'contains'
---

What a view keeps, and what a formula computes, are **expressions**. A bare
name is a frontmatter property, so `priority` and `note.priority` mean the
same thing. Four namespaces are available:

| Namespace | What it holds |
|-|-|
| `note.<property>` | A frontmatter property of the flow |
| `file.<property>` | `name`, `basename`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags` |
| `flow.<property>` | `title`, `description`, `steps`, `hasErrors` |
| `formula.<name>` | Another formula |

    filters:
      and:
        - priority > 5                       # > >= < <= == !=
        - owner.contains("an")               # methods on the value
        - file.hasTag("smoke")               # file helpers
        - file.inFolder("payments")          # the folder and everything below
        - flow.steps > 3 && !flow.hasErrors  # && || !

Groups are `and`, `or` and `not`, and they nest. Functions include
`if(condition, then, else)`, `min()`, `max()`, `round()`, `number()`,
`date()`, `now()` and `default(value, fallback)`; values carry methods such
as `contains()`, `startsWith()`, `isEmpty()`, `lower()`, `join()` and
`format()`.

A property a flow does not have is `null`, and `null` never satisfies a
comparison — so a filter is never broken by a flow nobody has annotated yet.
A filter that really is broken (an unknown function, a typo) is reported above
the table instead of taking the view down.
