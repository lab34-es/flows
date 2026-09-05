---
category: start
order: 3
icon: folder
title: 'The context folder'
summary: 'The one folder everything lives in: its layout, what to commit, and the git panel that pulls, commits and pushes it.'
keywords:
  - 'context'
  - 'folder'
  - 'directory'
  - 'path'
  - 'config'
  - 'storage'
  - 'files'
  - 'git'
  - 'branch'
  - 'commit'
  - 'push'
  - 'pull'
  - 'gitignore'
  - 'repository'
  - 'tsconfig'
  - 'views.yaml'
  - 'test-runs'
---

Everything the tool reads and writes lives under one folder, the **context
directory**. By default that is `~/lab34-flows`; pass `--context <path>` to
use another one, one per project if you like. The folder has to exist
already, and its name is always shown in the top bar, so you know which one
you are looking at.

## What is in it

| Path | What it holds | In git? |
|-|-|-|
| `flows/` | Your flows, as the tree the sidebar shows. Any depth of subfolders. | yes |
| `applications/<app>/index.ts` | The methods of an application, and their JSDoc documentation. | yes |
| `applications/<app>/README.md` | Free-form notes about the application, rendered in its page. | yes |
| `applications/<app>/env/<environment>.env` | The variables of one application in one environment. Secrets. | **no** |
| `applications/<app>/env/<environment>.env.example` | The names of those variables, as a committed template. | yes |
| `views.yaml` | The saved views every folder can be shown through. | yes |
| `test-runs/<date_time>-<environment>/` | One folder per run: `run.json`, a copy of each flow with its results, `report.html`. | your call |
| `config/ai.json` | AI provider, model and API keys. | **no** |
| `config/jira.json` | Jira / Xray URL and credentials. | **no** |
| `config/sharepoint.json` | Where reports are uploaded. Its secret is in `.env`. | yes |
| `config/remote.json` | Broker address and username for remote agents. Its password is in `.env`. | yes |
| `.env` | The secrets of those two integrations: `SHAREPOINT_CLIENT_SECRET`, `FLOWS_BROKER_PASSWORD`. | **no** |
| `tsconfig.json` | Generated on every start; points your editor at the types of the installed package. | no |
| `.gitignore` | The tool adds `.env` to it. The rest is up to you; see below. | yes |

Two things are deliberately not in the folder. The theme picked under
*Settings › UI* and the view each folder was last opened with are remembered
in the browser, not in files, so `views.yaml` carries no folder references and
a teammate's preferences never reach yours.

## What to commit

The folder is meant to be a repository you share with your team, and the split
is simple: everything that describes what to test travels, everything that
says how to reach a real system stays. The `.gitignore` suggested in
[Quick start](/help/quick-start) puts it in one place:

    applications/*/env/*.env
    !applications/*/env/*.env.example
    config/ai.json
    config/jira.json
    .env
    tsconfig.json
    test-runs/

Only `.env` is added by the tool itself, the first time an integration writes
a secret there. Environment files are not ignored for you, so add the rule
before the first commit. `tsconfig.json` is rewritten with absolute paths
into the installation on this machine, which is why it does not belong in
git; delete its generated notice if you want to take the file over, and it is
left alone from then on.

Whether to keep `test-runs/` is a choice. Ignored, the folder is a local
history nothing cleans up; committed, every run travels with its evidence and
the repository grows with each one.

## Git, from the tool

When the folder is inside a git repository, the top bar says so:

- **The branch** is shown next to the folder name, with arrows counting the
  commits you have to pull (↓) and to push (↑). Click it to switch branches,
  create one, or fetch every remote: branches your team pushed appear under
  *On remotes only*, and picking one checks it out locally, tracking the
  remote. Git refuses to switch when uncommitted work would be lost; commit or
  stash first.
- **Changed files** are coloured in the sidebar, with a letter at the end of
  the row: M modified, U untracked, A added, D deleted, R renamed. A folder
  takes the colour of whatever changed inside it, however deep.
- **The sync button** next to the folder name opens a panel with the branch,
  the list of changed files, a link to the repository online, and three
  buttons: **Pull** (rebasing your commits on top), **Commit** and **Push**.
  Tick the files you want in a commit, or leave everything unticked to commit
  the lot. A branch with no upstream gets one on its first push.

Nothing here replaces git: the panel runs the `git` on your machine, and
whatever you do from a terminal is reflected in the UI.

If the folder is not a repository, the panel says so. Run `git init` in it and
your flows travel with the rest of your code.

## Several contexts

`--context` is the whole mechanism: one folder per project, one terminal per
folder. A [remote agent](/help/remote-agents) is a clone of the same
repository on another machine, started with its own `--context`, so the same
commit is what runs there.
