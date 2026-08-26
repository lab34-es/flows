/**
 * The content of the Help section: a set of articles rendered as Markdown.
 *
 * Every article is searchable by title, summary, keywords and body, so keep
 * the keywords list close to the words someone would actually type.
 *
 * `icon` is a key of the ICONS map in HelpSection.jsx.
 */

// Fenced blocks inside template literals need their backticks escaped, which
// is unreadable for the ```step fences that show up everywhere. Indented code
// blocks (four spaces) are used instead where a fence would nest.

export const HELP_CATEGORIES = [
  { id: 'basics', label: 'Basics' },
  { id: 'writing', label: 'Writing flows' },
  { id: 'reference', label: 'Reference' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'running', label: 'Running' },
  { id: 'help', label: 'Help & support' },
];

export const HELP_TOPICS = [
  /* ------------------------------- Basics ------------------------------- */
  {
    id: 'quick-start',
    category: 'basics',
    icon: 'rocket',
    title: 'Quick start',
    summary: 'From an empty screen to a flow that runs, in four steps.',
    keywords: ['start', 'begin', 'first', 'tutorial', 'new', 'welcome', 'example'],
    body: `
1. **Pick an environment** in the sidebar footer. It decides which \`env\` file
   your applications are loaded with.
2. **Open a flow.** The tool seeds a few examples on first run — start with
   **01 · Welcome**, which works fully offline.
3. **Press Run.** Steps execute in the order they appear in the document, and
   the execution details of each one (request, response, assertions, timings)
   appear right below its block, like a notebook.
4. **Write your own.** Use the \`+\` button next to *Flows* in the sidebar to
   create a flow, a folder, or to upload a file — and turn on *Create using AI*
   if you would rather describe the scenario in plain words.

Nothing here is magic: a flow is a Markdown file in your context folder, so it
lives in your repository and travels with your team.
`,
  },
  {
    id: 'flow-anatomy',
    category: 'basics',
    icon: 'file',
    title: 'Anatomy of a flow',
    summary: 'Frontmatter, prose and executable step blocks.',
    keywords: ['markdown', 'frontmatter', 'title', 'description', 'document', 'yaml', 'structure'],
    body: `
A flow is a **Markdown document**. Write whatever you want — headings, prose,
lists, links, images — and turn any part of it into an executable step with a
fenced code block tagged as \`step\`.

    ---
    title: Fraud detection
    description: A payment above the limit is held for review
    ---

    # Fraud detection

    Any prose you want. Then, an executable step:

    \`\`\`step
    application: payments
    method: pay
    parameters:
      body:
        amount: 5000
    test:
      status: 402
    \`\`\`

**Frontmatter** (the optional YAML block at the top) carries the flow-level
metadata: \`title\`, \`description\`, \`version\`, \`latentApplications\`, \`xray\` —
plus any other property you want to keep on the flow. See *Properties*.
When there is no frontmatter title, the first \`#\` heading is used.

Regular code blocks (\`\`\`js\`, \`\`\`bash\`…) are **not** steps: only \`step\` blocks
are executed. Everything else is documentation, and is rendered as such.

Flows are \`.md\` (or \`.markdown\`) files: that is the only flow format.
`,
  },
  {
    id: 'ui-tour',
    category: 'basics',
    icon: 'layout',
    title: 'The web UI',
    summary: 'What every part of the screen does.',
    keywords: ['sidebar', 'notebook', 'source', 'document', 'tour', 'interface', 'environment'],
    body: `
- **Sidebar › Flows** — your flows tree, with a live status dot per flow
  (*standby*, *running*, *ok*, *error*). Create folders and flows, upload files
  and delete them from the \`+\` menu and each row's actions.
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
  \`/\` for headings, callouts and steps (see *Writing in the Document view*).
  Changes are saved as you type — there is no Save button.
- **Document / Source toggle** — *Source* opens the whole file in a plain
  Markdown editor, for when it is easier to work on the text as text.
  Applications have the same toggle for their \`README.md\`, \`index.ts\` and
  \`env/*.env\` files.
- **Magic wand** — next to the toggle: describe a change and the model rewrites
  the document (see *Writing flows with AI*).
- **Click a folder** and its flows — subfolders included — are listed as a
  table you can search, sort and filter (see *Properties* and *Folder views*).
`,
  },
  {
    id: 'context-and-git',
    category: 'basics',
    icon: 'folder',
    title: 'The context folder and git',
    summary: 'Where your flows live, which branch they are on, and how to sync.',
    keywords: ['context', 'folder', 'directory', 'git', 'branch', 'branches',
      'checkout', 'switch', 'fetch', 'commit', 'push', 'pull', 'sync',
      'repository', 'github', 'bitbucket', 'gitlab', 'changes'],
    body: `
Everything the tool reads and writes lives in one folder: your **context
directory**. By default that is \`lab34-flows\` in your home folder; pass
\`--context /path/to/folder\` to work somewhere else — one folder per project,
if you like.

Its name is always on screen, at the left of the top bar, with the full path in
its tooltip.

### Git

A context folder is usually a git repository shared with your team, so the tool
treats it as one.

- The **branch** is shown next to the folder name, with arrows counting the
  commits you have to pull (↓) and to push (↑). Click it to switch to another
  branch, to **create** one, or to **fetch** every remote — branches your team
  pushed appear under *On remotes only*, and picking one checks it out locally,
  tracking the remote. Git refuses to switch when uncommitted work would be
  lost; commit or stash it first.
- **Changed files are coloured** in the sidebar, with a letter at the end of the
  row: *M* modified, *U* untracked, *A* added, *D* deleted, *R* renamed. A
  folder takes the colour of whatever changed inside it, however deep — so a
  collapsed folder still tells you something moved.
- The **sync button** next to the folder name opens a panel with the branch, the
  list of changed files, a link to the repository online, and the three buttons
  that matter: **Pull** (rebasing your commits on top), **Commit** and **Push**.

Tick the files you want in a commit, or leave everything unticked to commit the
lot. A branch with no upstream gets one on its first push.

If the folder is not a repository, the panel says so: run \`git init\` in it and
your flows travel with the rest of your code.
`,
  },
  {
    id: 'properties',
    category: 'basics',
    icon: 'file',
    title: 'Properties',
    summary: 'Any frontmatter property you like, editable from the document.',
    keywords: ['properties', 'frontmatter', 'metadata', 'owner', 'tags', 'priority', 'title', 'description'],
    body: `
Every key in a flow's frontmatter is a **property**. A handful mean something
to the tool — \`title\`, \`description\`, \`version\`, \`latentApplications\`,
\`xray\` — and everything else is yours to invent.

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
new one. \`title\` and \`description\` are ordinary properties, but they are
shown above the list — as the document's heading and standfirst — rather than
as two more rows.

Nothing declares a property's type: it is whatever its value is. A number
sorts numerically, \`true\` / \`false\` renders as a checkbox, a list renders as
chips, and an ISO date sorts chronologically. Adding a property asks which kind
of value to start from, and from then on the value itself is the type.

Properties are what folder views filter and sort on — see *Folder views*.
`,
  },
  {
    id: 'folder-views',
    category: 'basics',
    icon: 'folder',
    title: 'Folder views',
    summary: 'A folder of flows as a table you can sort, filter and search.',
    keywords: ['views', 'table', 'folder', 'filter', 'sort', 'columns', 'search', 'base', 'obsidian', 'views.yaml', 'formula'],
    body: `
Click a folder in the sidebar and every flow below it — **subfolders
included** — is listed as a table: one row per flow, one column per property.
The toolbar searches, picks which properties are shown and in which order,
sorts, and filters.

Those settings are **views**, saved in a single \`views.yaml\` at the root of
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
          and:
            - priority > 5
        order: [file.name, note.owner, note.priority, formula.coverage]
        sort:
          - property: note.priority
            direction: DESC

A view is **not tied to a folder**: every view is a tab on every folder, and
applies to whichever folder is open. Which one a folder was last opened with
is remembered in your browser, so \`views.yaml\` holds no folder references.

- **Properties** — the columns, and their order. Renaming one here writes a
  \`displayName\`, which every view then follows.
- **Sort** — stack several: the first that separates two flows wins.
- **Filter** — see *Filters and formulas*.
- **⋯ › Formulas** — columns worked out from the others.
`,
  },
  {
    id: 'view-expressions',
    category: 'reference',
    icon: 'code',
    title: 'Filters and formulas',
    summary: 'The little expression language behind views.',
    keywords: ['filter', 'formula', 'expression', 'and', 'or', 'not', 'hasTag', 'inFolder', 'if', 'contains'],
    body: `
What a view keeps, and what a formula computes, are **expressions**. A bare
name is a frontmatter property, so \`priority\` and \`note.priority\` mean the
same thing. Four namespaces are available:

| Namespace | What it holds |
|-|-|
| \`note.<property>\` | A frontmatter property of the flow |
| \`file.<property>\` | \`name\`, \`basename\`, \`path\`, \`folder\`, \`ext\`, \`size\`, \`ctime\`, \`mtime\`, \`tags\` |
| \`flow.<property>\` | \`title\`, \`description\`, \`steps\`, \`hasErrors\` |
| \`formula.<name>\` | Another formula |

    filters:
      and:
        - priority > 5                       # > >= < <= == !=
        - owner.contains("an")               # methods on the value
        - file.hasTag("smoke")               # file helpers
        - file.inFolder("payments")          # the folder and everything below
        - flow.steps > 3 && !flow.hasErrors  # && || !

Groups are \`and\`, \`or\` and \`not\`, and they nest. Functions include
\`if(condition, then, else)\`, \`min()\`, \`max()\`, \`round()\`, \`number()\`,
\`date()\`, \`now()\` and \`default(value, fallback)\`; values carry methods such
as \`contains()\`, \`startsWith()\`, \`isEmpty()\`, \`lower()\`, \`join()\` and
\`format()\`.

A property a flow does not have is \`null\`, and \`null\` never satisfies a
comparison — so a filter is never broken by a flow nobody has annotated yet.
A filter that really is broken (an unknown function, a typo) is reported above
the table instead of taking the view down.
`,
  },

  /* ---------------------------- Writing flows ---------------------------- */
  {
    id: 'step-blocks',
    category: 'writing',
    icon: 'code',
    title: 'Step blocks',
    summary: 'Every key you can use inside a step block.',
    keywords: ['step', 'application', 'method', 'parameters', 'retry', 'mimic', 'block', 'yaml'],
    body: `
The content of a \`step\` block is YAML:

| Key | What it does |
|-|-|
| \`application\` | The application to call. Must exist in your context folder. |
| \`method\` | The method of that application. |
| \`description\` | Free text shown next to the step in the UI. |
| \`parameters\` | What the method receives — usually \`body\`, \`params\`, \`query\`, \`headers\`. |
| \`test\` | The assertions for this step. See *Assertions and tests*. |
| \`mimic\` | Fake the response of a dependency for this step. |
| \`retry\` | \`{ times, delay }\` — retry the step when it fails, waiting \`delay\` ms. |
| \`session\` | The browser session the step runs in. See *Browser automation*. |
| \`closeSession\` | \`true\` when this step is the last one that needs its browser session. |
| \`testKey\` | The Xray Test key this step maps to (informative). |

    ---
    title: Create and read back
    ---

    \`\`\`step
    application: jsonplaceholder
    method: createPost
    description: Create a post signed by a random author
    parameters:
      body:
        title: "{{ randomString }}"
        body: "Written by {{ randomName }}"
        userId: 1
    test:
      status: 201
    retry:
      times: 3
      delay: 1000
    \`\`\`

Which parameters a method accepts is documented by the application itself:
click it in the sidebar to see them, with examples ready to paste.
`,
  },
  {
    id: 'markdown',
    category: 'writing',
    icon: 'file',
    title: 'Markdown in flows',
    summary: 'Everything you can write around the steps — and how to make a note or a warning stand out.',
    keywords: ['markdown', 'prose', 'note', 'tip', 'important', 'warning', 'caution', 'callout', 'alert', 'admonition', 'blockquote', 'table', 'heading', 'list', 'image', 'link', 'readme'],
    body: `
A flow is a Markdown document. Everything that is not a \`step\` block is
prose, and the document view renders it — it is where you explain what the
scenario covers, what has to be true before it runs, and what to look at when
it fails. The same renderer draws application READMEs and method
descriptions, so everything below works in all three.

## What you can write

Standard Markdown, with the GitHub extensions:

| Syntax | Result |
|-|-|
| \`# Title\`, \`## Section\` | Headings. |
| \`**bold**\`, \`*italic*\` | Emphasis. |
| \`- item\`, \`1. item\` | Bullet and numbered lists. |
| \`[text](https://…)\` | A link, opened in a new tab. |
| \`![alt](./diagram.png)\` | An image, scaled to the document width. |
| Backticked text | Inline code. |
| A fenced block | A code block, highlighted by language. |
| Pipe tables | Tables. |
| \`---\` | A separator. |

A fenced block tagged \`step\` is the one exception: it is not prose, it is an
executable step. See *Step blocks*.

## Notes, warnings and other callouts

A blockquote that opens with a \`[!TYPE]\` marker is rendered as a callout —
the same syntax GitHub and Obsidian use.

    > [!WARNING]
    > This step cancels the reservation for real.
    > Point it at the staging environment first.

Five types are available:

| Marker | Use it for |
|-|-|
| \`[!NOTE]\` | Helpful info the reader should notice. |
| \`[!TIP]\` | Extra advice or a best practice. |
| \`[!IMPORTANT]\` | Crucial data the reader needs. |
| \`[!WARNING]\` | Urgent risks or negative consequences. |
| \`[!CAUTION]\` | Dangerous actions or likely mistakes. |

The body may span as many lines and blocks as you need — paragraphs, lists,
links, inline \`code\`, everything Markdown offers. Add a custom title by
writing it on the marker line:

    > [!TIP] Keep credentials out of the flow
    > Read them from the environment instead:
    >
    > - \`{{ env.API_TOKEN }}\` resolves at run time
    > - the flow stays safe to commit

Which renders as:

> [!TIP] Keep credentials out of the flow
> Read them from the environment instead:
>
> - \`{{ env.API_TOKEN }}\` resolves at run time
> - the flow stays safe to commit

A blockquote without a marker stays a plain quote, so nothing you already
wrote changes.
`,
  },
  {
    id: 'editing',
    category: 'writing',
    icon: 'file',
    title: 'Writing in the Document view',
    summary: 'Type where the document is rendered, insert blocks with "/", and never press Save.',
    keywords: ['edit', 'editing', 'write', 'live', 'preview', 'wysiwyg', 'obsidian', 'slash', 'command', 'menu', 'insert', 'between', 'block', 'delete', 'undo', 'redo', 'autosave', 'save', 'shortcut', 'keyboard'],
    body: `
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
gutter between them and an **insertion line** appears, with a \`+\` in the
margin: click it and a new block opens there, ready for a heading, a
paragraph or another step.

**Cmd/Ctrl + Enter** does the same from the keyboard — a new block below the
one you are in, or above it with **Shift**. That is the way in and out of a
step, where Enter is an ordinary newline in the YAML.

An insertion point nobody writes in is not a change: leave it and the file is
exactly as it was.

## The "/" menu

Type \`/\` and a list opens with everything a flow can hold — keep typing to
filter it, ↑ ↓ to move, Enter to insert:

| Group | Entries |
|-|-|
| Flow | Step, step with parameters, step with assertions |
| Basic | Headings, bullet / numbered / task lists, quote, code block, table, divider, link, image |
| Callouts | Note, Tip, Important, Warning, Caution |

Nothing it inserts is special: they are Markdown templates, so \`/tip\` writes
the same \`> [!TIP]\` block you would have typed by hand.

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
`,
  },
  {
    id: 'applications',
    category: 'writing',
    icon: 'app',
    title: 'Applications and methods',
    summary: 'Where the callable methods come from, and how they document themselves.',
    keywords: ['application', 'method', 'jsdoc', 'docs', 'index.ts', 'typescript', 'readme', 'http', 'mqtt', 'postgres'],
    body: `
Applications live in the \`applications\` folder of your context directory. Each
one is a **TypeScript** module that exports methods, and each method is what a
step can call. They can talk to HTTP APIs, MQTT, PostgreSQL databases, or drive
a browser with Playwright.

    import { applications, httpClient } from '@lab34/flows';
    import type { Context, Parameters } from '@lab34/flows';

    export const search = applications.handler([
      (ctx: Context, parameters: Parameters) =>
        httpClient.get(ctx, \`/search/\${parameters.query?.barcode}\`)
    ], 'search');

Types are there to help you write the code: applications are transpiled when
they run, never type checked, so a type error never stops a flow. A
\`tsconfig.json\` is kept up to date in your context directory — that is what
points your editor at the types of the installed package.

Documentation is read straight from the **JSDoc blocks** of the application's
\`index.ts\` — there is no \`docs.json\`. That documentation is what the UI renders
*and* what the model is given when it writes a flow for you, so the better the
JSDoc, the better the generated flows.

| Tag | Meaning |
|-|-|
| \`@param {type} name - description\` | An input parameter. \`[name]\` marks it optional, \`[name=value]\` adds a default. |
| \`@returns {status} description\` | The response, with an optional JSON example body. |
| \`@memory {write\\|read} key - description\` | Flow memory the method writes or reads. |
| \`@example\` | An example step, in YAML, ready to paste into a step block. |

A \`README.md\` in the application folder is rendered in the UI as well.

The tool seeds three example applications on first run: \`calculator\` (fully
offline), \`httpbin\` and \`jsonplaceholder\`.
`,
  },
  {
    id: 'memory',
    category: 'writing',
    icon: 'share',
    title: 'Passing data between steps',
    summary: 'Flow memory: what one step writes, the next one reads.',
    keywords: [
      'memory', 'lastResult', 'variables', 'handlebars', 'between steps', 'reuse',
      'share', 'state', 'pass data', 'return', 'tuple', 'write', 'read', 'fallback',
    ],
    body: `
A flow carries one plain object called the **memory**. It starts empty every
time you press *Run*, any step can write to it, and every later step can read
it. That is how the id created by step 2 ends up in the body of step 5.

### Writing it: the fourth value a method returns

A method returns a tuple — \`[headers, status, body, memory]\`. The first three
describe the response; the **fourth** is what this step contributes to the
memory.

    export const add = applications.handler([
      async (ctx: Context, parameters: Parameters) => {
        const { a, b } = parameters.body;
        const result = a + b;
        //       headers  status  body                            memory
        return [ {},      200,    { operation: 'add', result },   { lastResult: result } ];
      }
    ], 'add');

That fourth value is **optional**: leave it out, as most methods do, and the
step writes nothing. The helpers (\`httpClient\`, \`pgClient\`, \`playwright\`)
return the first three, so a method that wants to remember something builds
the object itself:

    const [headers, status, responseBody] = await httpClient.post(ctx, '/posts', { body });
    const memory = responseBody && responseBody.id ? { lastPostId: responseBody.id } : {};
    return [headers, status, responseBody, memory];

Writing conditionally like that is the normal thing to do — remember the id
only when there was one, so a failed call does not leave a stale value behind
for the steps that follow.

### How the writes add up

When a step returns, what it wrote is **merged** into the flow memory:

| | |
|-|-|
| New keys | Are added. |
| Keys that already existed | Are **overwritten** by the newer step. |
| Keys the step did not mention | Are left untouched. |
| Objects | Are replaced whole — the merge is shallow, not deep. |

So \`memory.lastResult\` always means *the most recent* result, and a step that
returns no memory changes nothing.

### Reading it: \`{{ memory.key }}\`

Anywhere inside a step's \`parameters\`, a Handlebars template reads the memory
as it stands when that step starts:

    \`\`\`step
    application: calculator
    method: multiply
    description: Multiply the previous result by 2, using memory
    parameters:
      body:
        a: "{{ memory.lastResult }}"
        b: 2
    test:
      status: 200
      body:
        result: 84
    \`\`\`

Nested values work the same way — \`{{ memory.user.id }}\`.

### What to watch out for

| | |
|-|-|
| **Earlier steps only** | A step sees what the steps *above* it wrote. A key nothing has written yet resolves to an empty string. |
| **Parameters only** | Only \`parameters\` are templated. \`test\` assertions are **not**, so \`{{ memory.x }}\` in a test is compared literally — write the expected value out, or assert it with a \`$expr\` expression. |
| **Everything arrives as text** | \`a: "{{ memory.lastResult }}"\` passes the string \`"42"\`, not the number \`42\`. Methods that expect numbers should accept numeric strings — the \`calculator\` example does exactly that. |
| **Reach for the leaf** | \`{{ memory.user }}\` renders \`[object Object]\`. Interpolate \`{{ memory.user.id }}\`, or read the object from application code. |
| **Text is HTML-escaped** | \`{{ }}\` turns \`&\` into \`&amp;\` and \`'\` into \`&#x27;\`. Triple braces \`{{{ }}}\` skip the escaping, but a value containing a double quote will break the step. |
| **Retries reuse the values** | Parameters are resolved once, before the first attempt. A \`retry\` re-sends exactly what was sent the first time; it does not re-read the memory. |
| **One run, one memory** | Memory is never shared between flows and does not survive a run. Press *Run* again and it is empty again. |

### Reading it from application code

A method's third argument is the flow, so \`flow.memory\` is the whole object —
useful when the value is not a scalar, or when the decision belongs to the
method rather than to the flow author:

    export const readBack = applications.handler([
      (ctx: Context, parameters: Parameters, flow: Flow) =>
        httpClient.get(ctx, \`/posts/\${flow.memory.lastPostId}\`)
    ], 'readBack');

A validator can do the same declaratively: \`validate.body\` accepts
\`fallbacks\`, which fill a missing field from the memory before the schema is
checked — the flow may pass \`token\`, and when it does not, the one remembered
by an earlier login step is used.

    validate.body({
      type: 'object',
      properties: { token: { type: 'string' } },
      fallbacks: { token: [{ type: 'memory', key: 'authToken' }] }
    })

### Documenting it

Which keys a method writes (or reads) is part of its documentation, through
the \`@memory\` JSDoc tag:

    /**
     * @memory {write} lastResult - The result of the operation.
     * @memory {read} authToken - The token stored by the login step.
     */

The application page lists them per method under *Memory* — that is where to
look when you are writing a flow and need to know what a step leaves behind.
`,
  },
  {
    id: 'tests',
    category: 'writing',
    icon: 'check',
    title: 'Assertions and tests',
    summary: 'Assert the status and the body, including JavaScript expressions.',
    keywords: ['test', 'assert', 'expr', 'status', 'body', 'expression', 'validation'],
    body: `
The \`test\` section of a step asserts the response. Plain values are compared
for equality, and the body is matched key by key, as deep as you write it:

    test:
      status: 400
      body:
        error:
          code: DIVISION_BY_ZERO

### JavaScript expressions

For anything beyond equality, prefix the value with \`$expr:\` and write
JavaScript, where \`value\` is the actual value being tested:

    test:
      body:
        count: "$expr: value > 10"
        items: "$expr: Array.isArray(value) && value.length >= 3"
        user:
          age: "$expr: value >= 18 && value <= 65"

| Validation | Expression |
|-|-|
| Greater than | \`$expr: value > 0\` |
| Exact value | \`$expr: value === 2\` |
| In a range | \`$expr: value >= 5 && value <= 10\` |
| String contains | \`$expr: typeof value === 'string' && value.includes('ok')\` |
| Array has items | \`$expr: Array.isArray(value) && value.length > 0\` |
| Property exists | \`$expr: typeof value === 'object' && 'id' in value\` |
| Date after | \`$expr: new Date(value) > new Date('2023-01-01')\` |

Cover the unhappy paths too: asserting that a missing resource returns \`404\`
is what catches the regression that starts answering \`200\`.
`,
  },
  {
    id: 'latent-applications',
    category: 'writing',
    icon: 'radio',
    title: 'Latent applications (MQTT)',
    summary: 'Assert on messages produced asynchronously, out of band.',
    keywords: ['mqtt', 'async', 'latent', 'subscribe', 'topic', 'message', 'events'],
    body: `
Some effects do not come back in the response: an HTTP call triggers a job that
eventually publishes an MQTT message. **Latent applications** let you assert on
those. *(Only MQTT is supported at the moment.)*

Declare the client in the flow's frontmatter, so it is connected and subscribed
before the flow starts:

    latentApplications:
      - application: "mqtt"
        client: "client1"
        connection:
          host: "1234567890-ats.iot.eu-west-1.amazonaws.com"
          key: "/path/private.key"
          cert: "/path/cert.crt"
          ca: "/path/ca1.pem"
        subscribe:
          - topic: "client/1"

Then assert on it from any step:

    test:
      latentApplications:
        - application: "mqtt"
          client: "client1"
          test:
            - topic: "client/1"
              message:
                status: "switched_to_on"
          retry:
            attempts: 1
            delay: 1
`,
  },
  {
    id: 'mimic',
    category: 'writing',
    icon: 'ghost',
    title: 'Mimicking dependencies',
    summary: 'Fake what a dependency answers, so you can test locally.',
    keywords: ['mimic', 'mock', 'stub', 'fake', 'dependency', 'offline', 'fail scenario'],
    body: `
A step can replace the behaviour of a dependency it triggers, which is how you
reproduce failure scenarios without breaking anything for real:

    \`\`\`step
    application: "accounting"
    method: "getInvoice"
    parameters:
      params:
        customerId: "{{ randomInt0_100 }}"
    mimic:
      - application: "coinscrap"
        url: "/fraud-detection"
    test:
      status: 404
      body:
        error:
          code: "ACCOUNTING_FRAUD_DETECTED"
    \`\`\`

Mimicked responses go through the same replacers as the rest of the flow, so
they can contain \`{{ uuid }}\`, \`{{ randomEmail }}\` and friends.
`,
  },

  /* ------------------------------ Reference ------------------------------ */
  {
    id: 'replacers',
    category: 'reference',
    icon: 'wand',
    title: 'Replacers reference',
    summary: 'Every {{ template }} you can use in a flow — random data, dates, ids.',
    keywords: [
      'replacer', 'random', 'handlebars', 'template', 'uuid', 'timestamp', 'faker',
      'email', 'name', 'barcode', 'oneOf', 'date',
    ],
    body: `
Replacers customise requests, and mimicked responses, with values generated on
every run. They are Handlebars templates: write \`{{ randomInt0_100 }}\` and it
becomes a different number each time the flow runs.

### Numbers, ids and time

| Replacer | Result |
|-|-|
| \`timestamp\` | Current timestamp in ms — \`1633024800000\` |
| \`datetime\` | Current date and time, ISO — \`2023-10-01T12:00:00.000Z\` |
| \`randomInt\` | Integer between 0 and 999 |
| \`randomInt0_5\`, \`randomInt0_10\`, \`randomInt0_100\` | Integer under 5 / 10 / 100 |
| \`randomInt0_200\` … \`randomInt0_5000\` | Same idea, larger ranges |
| \`randomInt0_9999\` | Integer under 9999 |
| \`uuid\` | Random UUID |
| \`randomPostmanId\` | Random 6-digit integer |

### People

| Replacer | Result |
|-|-|
| \`randomEmail\` | \`user123@example.com\` |
| \`randomName\` | Full name — \`John Doe\` |
| \`randomPersonName\` / \`randomPersonSurname\` / \`randomPersonPrefix\` | \`Jane\` / \`Smith\` / \`Mr.\` |
| \`phoneIntl\` | \`+1 555-123-4567\` |
| \`randomString\` | 10-character alphanumeric string |

### Places and companies

| Replacer | Result |
|-|-|
| \`belgianCityEn\` | \`Brussels\` |
| \`randomCompanyName\` | \`Acme Corporation\` |
| \`randomStreet\` / \`randomStreetNumber\` / \`randomPostalCode\` | \`Main Street\` / \`42\` / \`1000\` |

### Dates in the past

\`timeAgo\`, \`timestampAgo\` and \`tsAgo\` take an amount and a unit (\`ms\`,
\`seconds\`, \`minutes\`, \`hours\`, \`days\`, \`months\`, \`years\`):

    timeAgo 5 "days"        # a Date, 5 days ago
    timestampAgo 2 "hours"  # milliseconds, 2 hours ago
    tsAgo 1 "month"         # YYYYMMDDHHMMSS, a month ago

### Helpers

    barcode(["123456", 3, "789"])   # "123456123789" — numbers add N digits
    oneOf(["a", "b", "c"])          # picks one at random

More replacers can be added in \`src/helpers/replacer.js\`.
`,
  },
  {
    id: 'where-things-live',
    category: 'reference',
    icon: 'folder',
    title: 'Where things live',
    summary: 'Your context folder: flows, applications, credentials.',
    keywords: ['context', 'folder', 'path', 'config', 'ai.json', 'jira.json', 'storage', 'files'],
    body: `
Everything is stored in your **context directory**, which is \`~/lab34-flows\` by
default (override it with \`--context <path>\`):

| Path | What it holds |
|-|-|
| \`flows/\` | Your flows — the tree you see in the sidebar. |
| \`applications/\` | One folder per application: \`index.ts\`, \`README.md\`, \`envs/*.env\`. |
| \`config/ai.json\` | AI provider, model and API keys. |
| \`config/jira.json\` | Jira / Xray credentials. |

Credentials never leave your machine except to reach the provider or Jira, and
they are never sent back to the browser: the UI is only told whether a secret
is stored.

The theme you pick in **UI** is the exception — it is kept in this browser's
local storage, not in the context folder.
`,
  },

  /* ---------------------------- Integrations ---------------------------- */
  {
    id: 'ai',
    category: 'integrations',
    icon: 'sparkles',
    title: 'Writing flows with AI',
    summary: 'Generate a flow from a description, or rewrite one with the magic wand.',
    keywords: ['ai', 'ollama', 'gemini', 'anthropic', 'claude', 'generate', 'prompt', 'magic wand', 'model'],
    body: `
### Configure a provider

In **Settings › AI**, pick one of:

| Provider | What you need |
|-|-|
| **Ollama (local)** | A running Ollama and a pulled model (\`ollama pull llama3.1\`). Nothing leaves your machine. |
| **Google Gemini** | An API key from aistudio.google.com. |
| **Anthropic (Claude)** | An API key from console.anthropic.com. Defaults to \`claude-opus-5\`. |

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
`,
  },
  {
    id: 'xray',
    category: 'integrations',
    icon: 'ticket',
    title: 'Jira / Xray',
    summary: 'Link a flow to a Test issue, and pull the tests of your projects.',
    keywords: ['jira', 'xray', 'test key', 'testKey', 'cloud', 'server', 'data center', 'token', 'issue', 'pull', 'sync', 'download', 'test repository', 'feature', 'user story', 'project key', 'projects'],
    body: `
A flow maps to an Xray **Test** issue, and every step block to a **step** of
that test. The link is declared in the flow itself, so it travels with the
document:

    ---
    title: Fraud detection
    xray:
      testKey: ABC-1234
    ---

\`testKey\` can also be set inside a step block; that one is informative for now.

Configure it in **Settings › Xray**. Three flavours are supported:

- **Xray Cloud** — data comes from Xray's API, authenticated with an API key
  you create in Jira at *Apps › Xray › API Keys* (client id + client secret).
  Keep the default Xray URL unless your instance uses a regional endpoint
  (\`https://eu.xray.cloud.getxray.app\`, \`https://us.xray.cloud.getxray.app\`).
- **Jira Cloud (API token)** — for when you cannot get an Xray API key (it
  needs Jira admin rights): the data is read from Jira with your **email** and
  an **Atlassian API token**, created at *id.atlassian.com › Security › API
  tokens*. Xray-only data, like the test type, is not available this way.
- **Jira Server / Data Center** — no external service: the data is read from
  Jira with a **personal access token**, created at *your profile › Personal
  Access Tokens*.

**Project keys** is the list of Jira projects a pull downloads, separated by
commas (\`ABC, ACME\`). Each project is pulled into a folder of its own.

**Test connection** validates the credentials for real. Nothing is downloaded
until a flow that mentions a test key is rendered, and every key is downloaded
at most once per run of the tool.

**Pull tests** downloads every Test of those projects into an \`xray\` folder in
your flows — one folder per project key, one Markdown document per test, with
the Jira description and the Xray **test details** as its content, and no step
blocks yet. The details block
is the Test Details panel as Markdown: the steps of a Manual test, the scenario
of a Cucumber one, the definition of a Generic one. Xray Cloud answers them
with the tests themselves; on Server/DC the steps come from Xray's own API;
with a Jira API token only what Xray exposes as a Jira field can be read.

Inside a project's folder, with an Xray API key (Cloud) or on Server/DC the
folders mirror the **Test Repository**; with a Jira API token there is no Test Repository to read, so
they are rebuilt from Jira's hierarchy:

    xray/<PROJECT>/<FEATURE>_<slug>/<STORY>_<slug>/<TEST>_<slug>.md

A test that is a child of nothing gets its feature and story from its
**related work** — the issue links — and whatever cannot be resolved lands in
\`_no-feature\` / \`_no-user-story\`. A project Jira will not answer is logged and
the pull moves on to the next one. Pulling again rewrites only the frontmatter,
the description block and the details block: the steps you wrote stay, a test
that moved in Jira is moved rather than duplicated, and nothing is ever deleted.

**Overwrite tests already pulled** decides what that second pull does with the
tests that are already on disk. On (the default), a flow whose \`xray.testKey\`
is already in \`xray\` is updated with what Jira says now. Off, it is left
exactly as it is — not moved, not rewritten, nothing downloaded for it — and
only tests that were never pulled are written; the modal counts the rest as
**skipped**.

> Uploading executions back to Xray is **not supported yet**: nothing this
> integration does ever writes to Jira.

When Jira cannot be reached, the key is shown as plain text with the error on
hover — a flow never fails to render, or to run, because of Jira.
`,
  },
  {
    id: 'playwright',
    category: 'integrations',
    icon: 'globe',
    title: 'Browser automation (Playwright)',
    summary: 'Drive a web application from a flow. Experimental.',
    keywords: ['playwright', 'browser', 'web', 'ui test', 'headless', 'chromium', 'selenium', 'session', 'reuse browser', 'keep open'],
    body: `
Web applications are tested through [Playwright](https://playwright.dev).
Playwright automations have their **own YAML files**, and an application
integrates with them by calling \`playwright.run\` with the path to one.

The application's \`envs/*.env\` decide the browser configuration: which browser,
launch options (headless, slowMo…) and context options (viewport, locale,
credentials…).

### Sessions

A browser step opens a browser, runs its YAML and closes it again — so three
browser steps in a row means three browsers, and each one starts from a blank
page.

A **session** keeps one browser, one context and one page alive across steps.
Name it on the step, and the next step naming the same one finds the page
exactly as this one left it: same tab, same cookies, same half-filled form.

\`\`\`step
application: shop
method: search
session: storefront      # the browser this step runs in
closeSession: true       # ... and this step is the last one that needs it
\`\`\`

| Key | Where | What it does |
|-|-|-|
| \`session\` | step, or the YAML file | The session the run belongs to. The step wins over the file. |
| \`session: false\` | step | A throw-away browser, even when the YAML file names a session. |
| \`closeSession\` | step, or the YAML file | Close the session once this step is done with it. |

\`closeSession\` is optional: whatever a flow leaves open is closed when the flow
ends, pass or fail. Leaving it out helps while writing a flow — what went wrong
is still on screen when a step fails. A session opened by a YAML file with
\`keepOpen: true\` is the exception: it is left running on purpose.

An application supports all of this by passing its context to \`playwright.run\`,
which is what it already does:

\`\`\`js
export const search = applications.handler([
  // ctx carries the session the flow step asked for
  (ctx, parameters) => playwright.run(ctx, 'playwright.search.yaml', parameters)
], 'search');
\`\`\`

\`playwright.run\` takes a fourth argument for what the step cannot decide, and
the helper exposes the sessions themselves:

\`\`\`js
playwright.run(ctx, 'search.yaml', parameters, { session: 'storefront' });

playwright.hasSession('storefront');   // is it open?
playwright.openSessions();             // the names of the open ones
playwright.closeSession('storefront'); // close one
playwright.closeSessions();            // close them all — what the runner does
\`\`\`

Two things a session cannot do. It is **one page**, so a step that opens a new
tab is on its own; and the browser it was opened with is the browser it keeps,
so a later step asking for a different \`browserType\` or \`device\` is given the
one already running.

This part is **experimental**: the set of available methods lives with the
Playwright helper, and the seeded \`playful_website\` example application shows a
complete YAML automation end to end.
`,
  },
  {
    id: 'environments',
    category: 'integrations',
    icon: 'key',
    title: 'Environments and secrets',
    summary: 'One env file per application per environment — nothing in the repo.',
    keywords: ['environment', 'env', 'secrets', 'credentials', 'staging', 'production', 'postgres', 'database', 'template', 'example', 'onboarding'],
    body: `
Credentials are never stored in the flows. Each application keeps one env file
per environment, in its own folder:

    applications/<app>/env/<environment>.env

The environment selected in the sidebar footer is the one every run uses, and
the *Applications* page lets you edit those files — variable by variable, or as
raw text — without leaving the UI.

### Templates: \`.env.example\`

Because env files hold secrets, they stay out of git — which used to mean a
new tester had to write every one of them by hand. Commit a template next to
where each env file belongs instead:

    applications/<app>/env/<environment>.env.example

A template carries the variable **names** (values empty or safe defaults),
so it is the committed contract of what that environment needs. An
environment declared only by templates already shows up in the selector.

The **Environments** card on the home page reads all of this: a table with
one row per application shows which env files exist, which are missing (and
have a template to start from), and which are missing variables their
template declares. From there you can open any file directly in the Source
view, create every missing file from its template in one click, or add a new
environment to all applications at once.

### PostgreSQL

The PostgreSQL client accepts either a connection string or individual
parameters:

    DATABASE_CONNECTION_STRING=postgres://user:password@host:5432/database

    # …or
    PGUSER=myuser
    PGPASSWORD=mypassword
    PGHOST=localhost
    PGPORT=5432
    PGDATABASE=mydatabase
    PGQUERY_TIMEOUT=30000

\`DATABASE_CONNECTION_STRING\` wins when both are present. SSL is configured with
\`PGSSL_ENABLED\`, \`PGSSL_REJECT_UNAUTHORIZED\`, \`PGSSL_CA\`, \`PGSSL_CERT\` and
\`PGSSL_KEY\`.
`,
  },

  /* ------------------------------- Running ------------------------------- */
  {
    id: 'running',
    category: 'running',
    icon: 'play',
    title: 'Running flows',
    summary: 'What happens when you press Run, and how to read the results.',
    keywords: ['run', 'execute', 'status', 'results', 'output', 'notebook', 'retry'],
    body: `
Press **Run** and the steps execute in the order they appear in the document.
Below each block you get the request that was actually sent (with the random
values already resolved), the response, the assertions and the timings.

- The dot next to the flow in the sidebar reflects the run: *standby*,
  *running*, *ok*, *error*.
- A failed step can be retried automatically with \`retry: { times, delay }\`.
  Random values are kept stable across the retries of a step, so a retry does
  not silently test something else.
- The environment used is the one selected in the sidebar footer.

Runs are streamed over a socket, so you can watch a long flow progress instead
of waiting for a final report.
`,
  },
  {
    id: 'cli',
    category: 'running',
    icon: 'terminal',
    title: 'Command line',
    summary: 'Run flows headlessly — the CI/CD side of the tool.',
    keywords: ['cli', 'terminal', 'ci', 'cd', 'server', 'debug', 'npm', 'install', 'flags'],
    body: `
    npm install -g @lab34/flows

    lab34-flows --help
    lab34-flows --server
    lab34-flows --file <path-to-flow-file> --env <environment> [--debug]
    lab34-flows --capabilities

| Flag | What it does |
|-|-|
| \`--file\` | Path to the flow (\`.md\`). Required unless \`--server\`. |
| \`--env\` | Environment to run in. Required with \`--file\`. |
| \`--server\` | Start the web UI on http://localhost:3001. |
| \`--context\` | Use another context directory instead of \`~/lab34-flows\`. |
| \`--debug\` | Print environment variables and Node.js paths. |
| \`--help\` | Show the help. |

`,
  },

  /* --------------------------- Help & support --------------------------- */
  {
    id: 'troubleshooting',
    category: 'help',
    icon: 'life-buoy',
    title: 'Troubleshooting',
    summary: 'The things that usually go wrong, and what to check first.',
    keywords: ['error', 'problem', 'not working', 'fails', 'debug', 'fix', 'issue', 'broken'],
    body: `
**The flow tree is empty.** Flows are read from \`flows/\` in your context
directory (\`~/lab34-flows\` by default). Use *Refresh* in the \`+\` menu after
adding files by hand.

**"Application not found" when running a step.** The \`application\` value must
match a folder name in \`applications/\`. Open the sidebar and check the exact
name — and that the method is exported and documented.

**A step fails only sometimes.** Add \`retry: { times, delay }\` for genuinely
eventual behaviour. If the data is the problem, remember that replacers
generate new values on every run: assert with \`$expr:\` instead of exact values.

**The AI section says "Not configured yet".** Pick a provider and save a key
first, then use *Test connection* — it does a real round trip, so it also
catches a wrong model name or an Ollama that is not running.

**No Xray information on a flow.** The integration has to be configured *and*
the flow needs \`xray.testKey\` in its frontmatter. When Jira cannot be reached
the key is shown as plain text with the error on hover.

**Something looks wrong in the UI.** Reload the page: unsaved editor content is
discarded, which is also the way to throw away an AI edit you do not want.

**Nothing else works.** Run the flow from the CLI with \`--debug\` to see the
environment as the tool sees it.
`,
  },
  {
    id: 'privacy',
    category: 'help',
    icon: 'shield',
    title: 'Privacy and what leaves your machine',
    summary: 'Exactly which network calls the tool makes, and when.',
    keywords: ['privacy', 'security', 'keys', 'secrets', 'network', 'data', 'offline', 'local'],
    body: `
The tool runs locally: the web UI is served by your own machine and your flows
are files on disk.

Data leaves your machine only when you ask for it:

- **Running a flow** reaches whatever your applications reach (an API, a broker,
  a database, a website).
- **AI generation** sends your prompt, the flow, and your applications'
  documentation to the provider you picked in *Settings › AI*. With **Ollama**
  that provider is your own machine, so nothing leaves it at all.
- **Xray** is contacted only when a rendered flow mentions a test key.

API keys and tokens are stored in \`config/ai.json\` and \`config/jira.json\` inside
your context folder, and are never sent back to the browser — the UI is only
told whether a secret is stored.
`,
  },
  {
    id: 'support',
    category: 'help',
    icon: 'message',
    title: 'Getting more help',
    summary: 'Docs, source and issues.',
    keywords: ['support', 'github', 'issue', 'bug', 'contact', 'docs', 'readme', 'contribute'],
    body: `
- **Full documentation** — the project's README covers everything here in more
  depth, including the Playwright method list:
  [github.com/lab34-es/flows](https://github.com/lab34-es/flows)
- **Bugs and ideas** — open an issue at
  [github.com/lab34-es/flows/issues](https://github.com/lab34-es/flows/issues)
- **The examples** are documentation too: the seeded \`01 · Welcome\`,
  \`02 · HTTP basics\` and \`03 · Posts and memory\` flows are meant to be read as
  much as run. They are only copied when missing, so you can edit them freely —
  or delete them and get them back on the next start.
`,
  },
];

export default HELP_TOPICS;
