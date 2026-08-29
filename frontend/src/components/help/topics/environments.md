---
category: integrations
order: 4
icon: key
title: 'Environments and secrets'
summary: 'One env file per application per environment — and a flow only needs its own.'
keywords:
  - 'environment'
  - 'env'
  - 'secrets'
  - 'credentials'
  - 'staging'
  - 'production'
  - 'postgres'
  - 'database'
  - 'template'
  - 'example'
  - 'onboarding'
---

Credentials are never stored in the flows. Each application keeps one env file
per environment, in its own folder:

    applications/<app>/env/<environment>.env

The environment selected in the sidebar footer is the one every run uses, and
the *Applications* page lets you edit those files — variable by variable, or as
raw text — without leaving the UI.

### Which environments exist, and what a flow needs

The environments you can pick are the union of what the applications declare:
one application with an `env/uat.env` is enough for **uat** to be on the list.
No application has to keep an env file for an environment it has nothing to do
with — with a few hundred applications, that would mean writing a few hundred
files before running anything.

What is checked instead is the flow you are running. When a run is triggered —
from the UI, from a folder view or from the CLI — the applications *that flow's
steps use* must each have their `env/<environment>.env`. Only those: everything
else in the context is left alone. If one is missing the run is refused before
it starts, naming the files to create:

    Missing environment file for "uat": payments
    (applications/payments/env/uat.env). Only the applications a flow uses
    need one — create them from the Environments card on the home page.

The flow page says the same thing before you press Run, as soon as the flow and
the selected environment disagree.

### Templates: `.env.example`

Because env files hold secrets, they stay out of git — which used to mean a
new tester had to write every one of them by hand. Commit a template next to
where each env file belongs instead:

    applications/<app>/env/<environment>.env.example

A template carries the variable **names** (values empty or safe defaults),
so it is the committed contract of what that environment needs. An
environment declared only by templates already shows up in the selector.

The **Environments** card on the home page reads all of this: a table with
one row per application shows which env files exist, which are not written yet
(and have a template to start from), and which are missing variables their
template declares. From there you can open any file directly in the Source
view — including one that does not exist yet, so the editor opens ready to
create it — create every missing file from its template in one click, or add a
new environment to all applications at once.

An empty cell is not a problem in itself: it only matters to the flows that use
that application on that environment, which is what the run checks.

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

`DATABASE_CONNECTION_STRING` wins when both are present. SSL is configured with
`PGSSL_ENABLED`, `PGSSL_REJECT_UNAUTHORIZED`, `PGSSL_CA`, `PGSSL_CERT` and
`PGSSL_KEY`.
