---
category: integrations
order: 4
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
  - 'missing'
  - 'not found'
---

**"Context directory does not exist".** `--context` points at a folder that
is not there. The tool does not create it: `mkdir` it first, or drop the flag
to use `~/lab34-flows`.

**The flow tree is empty.** Flows are read from `flows/` in the context folder
shown in the top bar. Use *Refresh* in the `+` menu after adding files by
hand, and check you started the tool with the `--context` you meant.

**"Application not found" when running a step.** The `application` value must
match a folder name under `applications/`. Open the sidebar and check the
exact name, and that the method is exported.

**"Missing environment file" when starting a flow.** An application the flow
uses has no `env/<environment>.env`. Only the applications of that flow are
asked for one, and the message names each missing file. Create them from the
*Environment variables* card on the home page, import a teammate's export
there, or pick an environment the flow's applications do have. See
[Environments](/help/environments).

**"View not found" on the CLI.** `--view` takes the name or the slug of a view
of `views.yaml`, and the error lists the ones that exist. The **CLI** button
of a folder view writes the right command.

**A browser step fails with "Executable doesn't exist" or "is not
installed".** Playwright is installed, its browsers are not: run
`npx playwright install chromium` on the machine running the flows, with
`--with-deps` on a bare Linux box.

**A step fails only sometimes.** Add `retry: { times, delay }` for genuinely
eventual behaviour. If the data is the problem, remember that replacers
generate new values on every run: assert with `$expr:` instead of exact
values.

**A value from an earlier step arrives empty.** Only the steps *above* have
written to the memory, and only `parameters` are templated. In a `test`, use
`$expr: value === memory.key`. See
[Passing data between steps](/help/memory).

**The AI section says "Not configured yet".** Pick a provider and save a key
first, then use *Test connection*: it does a real round trip, so it also
catches a wrong model name or an Ollama that is not running.

**No Xray information on a flow.** The integration has to be configured *and*
the flow needs `xray.testKey` in its frontmatter. When Jira cannot be reached,
the key is shown as plain text with the error on hover.

**Something looks wrong in the UI.** Reload the page: unsaved editor content
is discarded, which is also the way to throw away an AI edit you do not want.

**Nothing else works.** Run the flow from the CLI with `--debug` to see the
environment as the tool sees it, and open an issue with the output. See
[Getting more help](/help/support).
