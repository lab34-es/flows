---
category: integrations
order: 2
icon: share
title: 'SharePoint'
summary: 'Upload the HTML report of a finished test run to a document library.'
keywords:
  - 'sharepoint'
  - 'microsoft'
  - 'graph'
  - 'office 365'
  - 'onedrive'
  - 'document library'
  - 'upload'
  - 'report'
  - 'html report'
  - 'test run'
  - 'entra'
  - 'azure ad'
  - 'client secret'
  - 'tenant'
  - '.env'
---

Every finished [test run](/help/test-runs) writes a standalone `report.html`
into its run folder.
This integration takes that file and puts it in a **SharePoint document
library**, so the people who never open this tool — and the CI job that has no
UI at all — find it where they already look for documents.

Configure it in **Settings › SharePoint**.

## What it signs in as

Uploads happen as an **application**, not as you: that is what lets an
unattended `--view` run upload its own report with nobody at the keyboard.

1. Register an application in **Microsoft Entra ID** (Azure AD).
2. Give it the **`Sites.ReadWrite.All`** *application* permission, and grant it
   admin consent.
3. Create a **client secret** for it, and copy the secret *value*.

The **Directory (tenant) id** and **Application (client) id** are on the app's
overview page.

## Where the report lands

- **Site URL** — the address of the site as the browser shows it, without the
  library or the folder: `https://your-company.sharepoint.com/sites/QA`.
- **Document library** — empty means the site's default library (*Documents*).
- **Folder** — inside the library. Missing folders are created on the way.
- **File name** — a file already there is replaced.

The folder and the file name can both be written in terms of the run:
`{runId}`, `{status}`, `{environment}`, `{trigger}`, `{date}` and `{time}`. So
`Test reports/{environment}` with `{runId}-{status}.html` files a failed
staging run as:

    Documents/Test reports/staging/2026-08-20_14-30-05-staging-failed.html

**When** decides which runs are uploaded: every one of them, or only the ones
with a failing flow.

## Where the secret lives

The client secret is the one setting that does not go into
`config/sharepoint.json`. It is written to a **`.env` file at the root of your
context folder**, as `SHAREPOINT_CLIENT_SECRET` — and `.env` is added to the
context's `.gitignore` for you, so a context that is a git repository cannot
commit it by accident. Everything else stays in the config file, which is safe
to share and to review.

You can also write the variable yourself instead of typing it in the UI; the
tool reads it back from that same file.

## What happens when it fails

Nothing about the upload can change the outcome of a run: a report that could
not be delivered leaves the run exactly as it was, and shows up as a **Report
upload failed** badge on the run page, with the reason on hover. The report is
always written into the run folder first, whether it is uploaded or not.
