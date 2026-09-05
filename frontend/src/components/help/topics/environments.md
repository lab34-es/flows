---
category: environments
order: 1
icon: key
title: 'Environments'
summary: 'One env file per application per environment. Where they live, how to edit them, and how the values reach a colleague or a pipeline without going through git.'
keywords:
  - 'environment'
  - 'env'
  - 'secrets'
  - 'credentials'
  - 'variables'
  - 'staging'
  - 'uat'
  - 'production'
  - 'local'
  - 'template'
  - 'example'
  - 'export'
  - 'import'
  - 'share'
  - 'onboarding'
  - 'ci'
  - 'cd'
  - 'pipeline'
  - 'yaml'
  - 'import-env'
  - 'BASE_URL'
  - 'postgres'
  - 'mqtt'
---

An environment is a name, `local`, `uat`, `production`, and behind the name
one file per application:

    applications/<app>/env/<environment>.env

The file is plain `KEY=value` lines. A method reads them as `ctx.env`, so
`BASE_URL`, a token, a database connection string, and whatever else that
application needs to reach that instance, go there. Credentials are never
written in a flow: the same flow runs against `uat` or `production` by
picking a different environment in the top bar.

## Which environments exist

The list in the top bar is the union of what the applications declare: one
application with an `env/uat.env`, or an `env/uat.env.example`, is enough for
**uat** to be on it. No application has to keep a file for an environment it
has nothing to do with.

What is checked is the flow being run. When a run starts, from the UI, from a
folder view or from the CLI, each application *that flow's steps use* must
have its `env/<environment>.env`. Only those. If one is missing, the run is
refused before it starts, naming the files to create, and the flow page shows
the same warning as soon as the document and the selected environment
disagree. A step that is turned off is not counted.

## Editing the files

- **The application page**, *Environments* tab: every env file of the
  application, editable variable by variable.
- **The application page**, *Source* view: the same files as raw text,
  comments included. A file that does not exist yet opens ready to be
  created, and writing the first `env/<name>.env` is how a brand new
  environment is declared.
- **The Environment variables card** on the home page shows, for the selected
  environment, which applications have their file and which do not, and
  offers **Create N missing files from templates**: every missing file that
  has a committed `.env.example` next to it is created from it, as it is,
  leaving you the secrets to fill in.

## Templates: `.env.example`

Env files hold secrets, so they stay out of git. Commit a template next to
where each one belongs instead:

    applications/<app>/env/<environment>.env.example

A template carries the variable **names**, with empty values or safe
defaults. It is the committed contract of what that environment needs, it
declares the environment in the selector on its own, and it is what *Create
missing files* copies. Keep it in step with the real file when a variable is
added.

## Handing the values to a colleague

A template says which variables an environment needs; it does not say what to
put in them. The **Environment variables** screen, opened from the card on
the home page, moves the values themselves.

**Export** opens a tree, application, then environment, then variable, with a
checkbox at each level. Tick what the other person needs and you get one YAML
document to copy:

    version: 1
    applications:
      payments:
        uat:
          API_URL: https://uat.payments.example
          API_TOKEN: 5f3e-…

**Import** takes that document back. As it is pasted, the screen shows what
it would do before doing it: which env files it would create, which variables
it would add, which existing values it would overwrite. Nothing is written
until you press *Import*. An import fills env files in and never invents
applications: one the document names that this context does not have is
reported and skipped. Files that already exist keep everything the document
does not name, comments and order included.

The document carries **real values**. Share it the way you would share a
password, and keep it out of git.

## Handing the values to a pipeline

The same document is what a CI/CD job, or a machine nobody has set up yet,
gets its values from:

    lab34-flows --context . --import-env env.yaml --view smoke --env uat

`--import-env` writes the document into the context's env files **first**,
then the flows run and find the files they need already there. On its own it
imports and exits; `--dry-run` prints what it would write, writes nothing and
runs nothing. Store the document as a secret of your CI system and write it
to a file right before the command; [Command line](/help/cli) has a complete
pipeline example.

## The root `.env` is something else

At the root of the context, next to the applications, the tool keeps one
`.env` of its own for the secrets of the integrations configured in Settings:
`SHAREPOINT_CLIENT_SECRET` and `FLOWS_BROKER_PASSWORD`. It is added to the
context's `.gitignore` automatically. It has nothing to do with the
environments a flow runs against.

## Variables the built-in helpers read

| Helper | Variables |
|-|-|
| `httpClient` | `BASE_URL`, prefixed to every path a method requests. |
| `pgClient` | `DATABASE_CONNECTION_STRING`, or `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATABASE`; `PGQUERY_TIMEOUT`, `PGLOCK_TIMEOUT`, `PGCLIENT_ENCODING`, `PGOPTIONS`; SSL with `PGSSL_ENABLED`, `PGSSL_REJECT_UNAUTHORIZED`, `PGSSL_CA`, `PGSSL_CERT`, `PGSSL_KEY`. The connection string wins when both are present. |
| `mqttClient` | `MQTT_HOST`, and optionally `MQTT_PORT`, `MQTT_PROTOCOL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_KEY`, `MQTT_CERT`, `MQTT_CA`, `MQTT_REJECT_UNAUTHORIZED`, `MQTT_QOS`. |

Your own methods read anything else through `ctx.env`.
