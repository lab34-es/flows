---
category: integrations
order: 4
icon: key
title: 'Environments and secrets'
summary: 'One env file per application per environment — a flow only needs its own, and the values can be handed over.'
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
  - 'export'
  - 'import'
  - 'share'
  - 'yaml'
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
    need one — create it from the Environment variables card on the home
    page, or import a teammate's export there.

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

### Handing the values over

A template says which variables an environment needs; it does not say what to
put in them. The **Environment variables** screen — opened from the card of
that name on the home page — is how that part travels, without anybody
dictating a token over a call. It has a sidebar of its own, with one section
for each half of the job.

**Export** opens a tree — application, then environment, then variable — with
a checkbox at each of the three levels. Tick whatever the other person needs
and you get one YAML document to copy:

```yaml
version: 1
applications:
  payments:
    uat:
      API_URL: https://uat.payments.example
      API_TOKEN: 5f3e-…
```

**Import** takes that document back. As it is pasted, the section shows
exactly what it would do before doing it: which env files it would create,
which variables it would add, and which existing values it would overwrite.
Nothing is written until you press *Import*.

An import fills env files in; it never invents applications. An application
the document names that this context does not have is reported and skipped —
as is a name that could not be a file, or a value that is not one. Files that
already exist keep everything the document does not name, comments and order
included: importing `API_TOKEN` does not disturb the `DATABASE_URL` sitting
two lines below it.

The document carries **real values**, secrets included. Share it the way you
would share a password, and keep it out of git.

### Files that need no document

Some of them nobody has to be asked for. **Create N missing files from
templates**, on the home page card, writes every `env/<environment>.env` that
has a committed `.env.example` next to it, copying the template as it is. You
are then left filling in the secrets.

Any single file can also be written by hand from the *Applications* page,
Source view — including one that does not exist yet, so the editor opens ready
to create it. That is also how a brand new environment is declared: write the
first `env/<name>.env` and the name is on the selector.

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
