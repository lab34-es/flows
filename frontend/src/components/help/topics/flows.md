---
category: flows
order: 1
icon: file
title: 'The flow document'
summary: 'A flow is a Markdown file: its frontmatter properties, the prose and callouts around the steps, the steps themselves, and the editor you write it in.'
keywords:
  - 'flow'
  - 'markdown'
  - 'document'
  - 'frontmatter'
  - 'title'
  - 'description'
  - 'properties'
  - 'tags'
  - 'owner'
  - 'prose'
  - 'comments'
  - 'callout'
  - 'note'
  - 'warning'
  - 'tip'
  - 'editor'
  - 'document view'
  - 'source'
  - 'live preview'
  - 'obsidian'
  - 'slash'
  - 'autosave'
  - 'save'
  - 'undo'
  - 'redo'
  - 'keyboard'
  - 'shortcut'
  - 'run'
  - 'enabled'
---

A flow is a Markdown file, `.md` or `.markdown`, under `flows/` in the context
folder. It has three ingredients: an optional **frontmatter** block at the
top, **prose** anywhere, and **step blocks**, which are the only part that
executes.

    ---
    title: Fraud detection
    description: A payment above the limit is held for review
    owner: ana
    tags: [smoke, payments]
    ---

    # Fraud detection

    The invoice endpoint must refuse to answer for a flagged customer.

    > [!WARNING]
    > This flow creates a real customer in the environment it runs against.

    ```step
    application: accounting
    method: getInvoice
    parameters:
      params:
        customerId: "{{ randomInt0_100 }}"
    test:
      status: 404
    ```

## Frontmatter: the properties

Every key of the frontmatter is a **property**. A handful mean something to
the tool, everything else is yours to invent.

| Property | Meaning |
|-|-|
| `title` | The document's heading. Without one, the first `#` heading is used. |
| `description` | The standfirst under the title. |
| `latentApplications` | MQTT clients to connect before the flow starts. See [Latent applications](/help/latent-applications). |
| `xray` | The Jira test this flow maps to, as `xray: { testKey: ABC-1234 }`. See [Jira / Xray](/help/xray). |
| `version` | The runner version. Leave it out. |
| anything else | `owner`, `tags`, `priority`, `reviewed`, `due`… whatever your team filters and sorts by. |

Nothing declares a property's type: it is whatever its value is. A number
sorts numerically, `true` / `false` renders as a checkbox, a list renders as
chips and an ISO date sorts chronologically. A property can hold an object,
and its fields are addressed with a dot, `xray.testKey`.

The **Document** view renders the properties as a list you can edit in place:
click a value to change it, a name to rename it, and **Add property** for a
new one. `title` and `description` are shown above the list, as the heading
and the standfirst, rather than as two more rows.

Properties are what folder tables filter and sort on. See
[Organizing flows](/help/organizing).

## Prose: everything around the steps

Everything that is not a step block is documentation, rendered as such. Use
it to say what the scenario covers, what has to be true before it runs and
what to look at when it fails. It is standard Markdown with the GitHub
extensions: headings, emphasis, lists, links (opened in a new tab), images
scaled to the document width, inline code, fenced code blocks highlighted by
language, pipe tables and `---` separators.

A fenced block tagged `js`, `bash` or anything other than `step` is a code
sample, not a step: only `step` blocks execute.

A blockquote that opens with a `[!TYPE]` marker is rendered as a **callout**,
the syntax GitHub and Obsidian use:

    > [!TIP] Run it against staging first
    > The cancellation is real. Point the environment at staging
    > until the assertions are stable.

Which renders as:

> [!TIP] Run it against staging first
> The cancellation is real. Point the environment at staging
> until the assertions are stable.

Five types are available: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`
and `[!CAUTION]`. The body may span as many lines and blocks as you need, and
a title on the marker line replaces the default one. A blockquote without a
marker stays a plain quote.

The same renderer draws application READMEs and method descriptions, so all
of this works there too.

## Steps

A step is a fenced code block tagged `step`, whose content is YAML: the
application and method to call, the parameters to send, the assertions on the
response, and a few switches. Steps execute in the order they appear in the
document, and the request, response, assertions and timings of each one
appear right below its block once it has run.

Every key is described in [Step blocks](/help/step-blocks). The parts a step
builds on have pages of their own: [Assertions](/help/tests),
[Passing data between steps](/help/memory), and [Replacers](/help/replacers)
for values that change on every run.

The switch in the top-right corner of a step cell turns it off: the step
stays in the document with `enabled: false`, and the run walks past it.

## The editor

The **Document** view is where a flow is written. It is not a preview: click
any paragraph, heading, list or step and that block shows its Markdown right
where it was rendered, like Obsidian's live preview. Click elsewhere and it
is rendered again. The **Source** tab opens the whole file in a plain Markdown
editor, for when it is easier to work on the text as text.

**There is no Save button.** Every change is written to the file a moment
after you stop typing; the toolbar says *Saving…* while the write is in
flight and *Saved* once the file on disk matches the screen. Pressing **Run**
saves first, because what runs is the file. **Cmd/Ctrl + Z** undoes and
**Cmd/Ctrl + Shift + Z** redoes, one burst of typing at a time.

**Between two blocks.** Two steps in a row leave no line to click on. Move
the pointer into the gutter between them and an insertion line appears with a
`+` in the margin: click it and a new block opens there. **Cmd/Ctrl + Enter**
does the same from the keyboard, below the block you are in, or above it with
**Shift**. An insertion point nobody writes in leaves the file exactly as it
was.

**The `/` menu.** Type `/` and a list opens with everything a flow can hold;
keep typing to filter it, ↑ ↓ to move, Enter to insert.

| Group | Entries |
|-|-|
| Flow | Step, step with parameters, step with assertions |
| Basic | Headings, bullet / numbered / task lists, quote, code block, table, divider, link, image |
| Callouts | Note, Tip, Important, Warning, Caution |

Nothing it inserts is special: they are Markdown templates, so `/tip` writes
the same `> [!TIP]` block you would have typed by hand.

| Key | What it does |
|-|-|
| Enter | Splits the block; inside a list it starts the next item, and an empty item closes the list. |
| Shift + Enter | A line break inside the same block. |
| Cmd/Ctrl + Enter | A new block below this one, above it with Shift. |
| Backspace at the start | Merges the block into the one above. |
| Delete at the end | Merges the block below into this one. |
| Backspace / Delete next to a step or a code block | Selects it; press again and it is gone. |
| ↑ ↓ ← → | Walk from block to block, into each one's Markdown. |
| Escape | Leaves the block without leaving the document. |

A step is edited as its YAML, inside its own cell: the header, the assertions
and the execution output stay where they are while you type.

**The magic wand**, next to the Document / Source toggle, rewrites the
document from a description of the change. See
[Writing flows with AI](/help/ai).

## Running it

Pick the environment in the top bar and press **Run**. Before the first
step, the tool checks that every application the flow uses has an env file
for that environment, and refuses the run naming the missing files if not;
the flow page shows the same warning as soon as the document and the selected
environment disagree. The dot next to the flow in the sidebar follows the
run: *standby*, *running*, *ok*, *error*.

Every run is recorded. What is kept, and how to read the report, is in
[Test runs](/help/test-runs).
