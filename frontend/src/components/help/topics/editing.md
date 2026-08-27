---
category: writing
order: 3
icon: file
title: 'Writing in the Document view'
summary: 'Type where the document is rendered, insert blocks with "/", and never press Save.'
keywords:
  - 'edit'
  - 'editing'
  - 'write'
  - 'live'
  - 'preview'
  - 'wysiwyg'
  - 'obsidian'
  - 'slash'
  - 'command'
  - 'menu'
  - 'insert'
  - 'between'
  - 'block'
  - 'delete'
  - 'undo'
  - 'redo'
  - 'autosave'
  - 'save'
  - 'shortcut'
  - 'keyboard'
---

The **Document** view is where a flow is written. It is not a preview: click
any paragraph, heading, list or step and that block shows its Markdown, right
where it was rendered — like Obsidian's live preview. Click somewhere else and
it is rendered again. The **Source** tab is still there for the whole file at
once.

## There is no Save button

Every change is written to the file a moment after you stop typing. The
toolbar says *Saving…* while the write is in flight and *Saved* once the file
on disk matches what you see. What runs is the file, so pressing **Run** saves
first.

**Cmd/Ctrl + Z** undoes, **Cmd/Ctrl + Shift + Z** (or **Ctrl + Y**) redoes.
Edits made in one burst of typing undo together, not character by character.

## Writing between two blocks

Two steps one after the other leave no line between them to click on, and
neither does a step at the top of the document. Move the pointer into the
gutter between them and an **insertion line** appears, with a `+` in the
margin: click it and a new block opens there, ready for a heading, a
paragraph or another step.

**Cmd/Ctrl + Enter** does the same from the keyboard — a new block below the
one you are in, or above it with **Shift**. That is the way in and out of a
step, where Enter is an ordinary newline in the YAML.

An insertion point nobody writes in is not a change: leave it and the file is
exactly as it was.

## The "/" menu

Type `/` and a list opens with everything a flow can hold — keep typing to
filter it, ↑ ↓ to move, Enter to insert:

| Group | Entries |
|-|-|
| Flow | Step, step with parameters, step with assertions |
| Basic | Headings, bullet / numbered / task lists, quote, code block, table, divider, link, image |
| Callouts | Note, Tip, Important, Warning, Caution |

Nothing it inserts is special: they are Markdown templates, so `/tip` writes
the same `> [!TIP]` block you would have typed by hand.

## Keys

| Key | What it does |
|-|-|
| Enter | Splits the block; inside a list it starts the next item, and an empty item closes the list. |
| Shift + Enter | A line break inside the same block. |
| Cmd/Ctrl + Enter | Opens a new block below this one — above it with Shift. |
| Backspace at the start | Merges the block into the one above. |
| Delete at the end | Merges the block below into this one. |
| Backspace / Delete next to a step or a code block | Selects it — press again and it is gone. |
| ↑ ↓ ← → | Walk from block to block, into each one's Markdown. |
| Escape | Leaves the block, without leaving the document. |

A step is edited as its YAML, inside its own cell: the header, the assertions
and the execution output stay where they are while you type.
