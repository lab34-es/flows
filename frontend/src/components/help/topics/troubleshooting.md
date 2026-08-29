---
category: help
order: 1
icon: life-buoy
title: 'Troubleshooting'
summary: 'The things that usually go wrong, and what to check first.'
keywords:
  - 'error'
  - 'problem'
  - 'not working'
  - 'fails'
  - 'debug'
  - 'fix'
  - 'issue'
  - 'broken'
---

**The flow tree is empty.** Flows are read from `flows/` in your context
directory (`~/lab34-flows` by default). Use *Refresh* in the `+` menu after
adding files by hand.

**"Application not found" when running a step.** The `application` value must
match a folder name in `applications/`. Open the sidebar and check the exact
name — and that the method is exported and documented.

**"Missing environment file" when starting a flow.** The run is refused before
it starts because an application the flow uses has no
`env/<environment>.env`. Only the applications of *that* flow are asked for
one — the message names each missing file. Create them from the *Environments*
card on the home page (the cell links straight to the file, template included),
or pick an environment the flow's applications do have.

**A browser step fails with "Executable doesn't exist".** Playwright is
installed, its browsers are not: they are a separate download. Run `npx
playwright install` (or `npx playwright install chromium` for a single one) on
the machine running the flows — with `--with-deps` on a bare Linux box, which
also installs the system libraries the browsers need.

**A step fails only sometimes.** Add `retry: { times, delay }` for genuinely
eventual behaviour. If the data is the problem, remember that replacers
generate new values on every run: assert with `$expr:` instead of exact values.

**The AI section says "Not configured yet".** Pick a provider and save a key
first, then use *Test connection* — it does a real round trip, so it also
catches a wrong model name or an Ollama that is not running.

**No Xray information on a flow.** The integration has to be configured *and*
the flow needs `xray.testKey` in its frontmatter. When Jira cannot be reached
the key is shown as plain text with the error on hover.

**Something looks wrong in the UI.** Reload the page: unsaved editor content is
discarded, which is also the way to throw away an AI edit you do not want.

**Nothing else works.** Run the flow from the CLI with `--debug` to see the
environment as the tool sees it.
