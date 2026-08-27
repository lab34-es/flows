---
category: basics
order: 2
icon: file
title: 'Learn the terms'
summary: 'What is each thing'
keywords:
  - 'markdown'
  - 'frontmatter'
  - 'title'
  - 'description'
  - 'document'
  - 'yaml'
  - 'flows'
  - 'applications'
  - 'environments'
  - 'structure'
---

## Terms

- **The context** is the folder where your files live.

- **A flow** is a Markdown document where you can write whatever you want,
including, of course, the actual steps of the e2e flow you want to test.

- **An application** is the action logic of what the steps in a flow do. A connection
to a database, an API call, etc.

- **An environment** is a `.env` file that contains all secrets your applications
needs in order to work. While they live inside each applications' directory, they
stay out of the GIT integration.

--- 

## The context (folder)

Everything the tool reads and writes lives in one folder: your context directory. By default that is lab34-flows in your home folder; pass --context /path/to/folder to work somewhere else — one folder per project, if you like.

Its name is always in the UI.

### Git

A context folder is usually a git repository shared with your team, so the tool treats it as one.

- The branch is shown next to the folder name, with arrows counting the commits you have to pull (↓) and to push (↑). Click it to switch to another branch, to create one, or to fetch every remote — branches your team pushed appear under On remotes only, and picking one checks it out locally, tracking the remote. Git refuses to switch when uncommitted work would be lost; commit or stash it first.
- Changed files are coloured in the sidebar, with a letter at the end of the row: M modified, U untracked, A added, D deleted, R renamed. A folder takes the colour of whatever changed inside it, however deep — so a collapsed folder still tells you something moved.
- The sync button next to the folder name opens a panel with the branch, the list of changed files, a link to the repository online, and the three buttons that matter: Pull (rebasing your commits on top), Commit and Push.

Tick the files you want in a commit, or leave everything unticked to commit the lot. A branch with no upstream gets one on its first push.

If the folder is not a repository, the panel says so: run git init in it and your flows travel with the rest of your code.

## Flows

A flow is a **Markdown document**. Write whatever you want — headings, prose,
lists, links, images — and turn any part of it into an executable step with a
fenced code block tagged as `step`.

    ---
    title: Fraud detection
    description: A payment above the limit is held for review
    ---

    # Fraud detection

    Any prose you want. Then, an executable step:

    ```step
    application: payments
    method: pay
    parameters:
      body:
        amount: 5000
    test:
      status: 402
    ```

**Frontmatter** (the optional YAML block at the top) carries the flow-level
metadata: `title`, `description`, `version`, `latentApplications`, `xray` —
plus any other property you want to keep on the flow. See *Properties*.
When there is no frontmatter title, the first `#` heading is used.

Regular code blocks (```js`, ```bash`…) are **not** steps: only `step` blocks
are executed. Everything else is documentation, and is rendered as such.

Flows are `.md` (or `.markdown`) files: that is the only flow format.

---

## Applications
