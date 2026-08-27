---
category: writing
order: 2
icon: file
title: 'Markdown in flows'
summary: 'Everything you can write around the steps — and how to make a note or a warning stand out.'
keywords:
  - 'markdown'
  - 'prose'
  - 'note'
  - 'tip'
  - 'important'
  - 'warning'
  - 'caution'
  - 'callout'
  - 'alert'
  - 'admonition'
  - 'blockquote'
  - 'table'
  - 'heading'
  - 'list'
  - 'image'
  - 'link'
  - 'readme'
---

A flow is a Markdown document. Everything that is not a `step` block is
prose, and the document view renders it — it is where you explain what the
scenario covers, what has to be true before it runs, and what to look at when
it fails. The same renderer draws application READMEs and method
descriptions, so everything below works in all three.

## What you can write

Standard Markdown, with the GitHub extensions:

| Syntax | Result |
|-|-|
| `# Title`, `## Section` | Headings. |
| `**bold**`, `*italic*` | Emphasis. |
| `- item`, `1. item` | Bullet and numbered lists. |
| `[text](https://…)` | A link, opened in a new tab. |
| `![alt](./diagram.png)` | An image, scaled to the document width. |
| Backticked text | Inline code. |
| A fenced block | A code block, highlighted by language. |
| Pipe tables | Tables. |
| `---` | A separator. |

A fenced block tagged `step` is the one exception: it is not prose, it is an
executable step. See *Step blocks*.

## Notes, warnings and other callouts

A blockquote that opens with a `[!TYPE]` marker is rendered as a callout —
the same syntax GitHub and Obsidian use.

    > [!WARNING]
    > This step cancels the reservation for real.
    > Point it at the staging environment first.

Five types are available:

| Marker | Use it for |
|-|-|
| `[!NOTE]` | Helpful info the reader should notice. |
| `[!TIP]` | Extra advice or a best practice. |
| `[!IMPORTANT]` | Crucial data the reader needs. |
| `[!WARNING]` | Urgent risks or negative consequences. |
| `[!CAUTION]` | Dangerous actions or likely mistakes. |

The body may span as many lines and blocks as you need — paragraphs, lists,
links, inline `code`, everything Markdown offers. Add a custom title by
writing it on the marker line:

    > [!TIP] Keep credentials out of the flow
    > Read them from the environment instead:
    >
    > - `{{ env.API_TOKEN }}` resolves at run time
    > - the flow stays safe to commit

Which renders as:

> [!TIP] Keep credentials out of the flow
> Read them from the environment instead:
>
> - `{{ env.API_TOKEN }}` resolves at run time
> - the flow stays safe to commit

A blockquote without a marker stays a plain quote, so nothing you already
wrote changes.
