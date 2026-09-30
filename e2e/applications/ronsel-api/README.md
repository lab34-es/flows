# ronsel-api

The ronsel HTTP API, under test. `BASE_URL` in `env/ci.env` is a running
`ronsel` -- the same API the web UI talks to -- serving a context that was
empty when it started, so it holds exactly the bundled examples.

The methods are the verbs (`get`, `post`, `put`, `del`): a step names the path,
the query and the body, and asserts the answer, so it reads as the request it
makes and a new endpoint needs no new code here. `waitForRun` is the one
addition: starting a flow through the API answers at once, and the result
lands in a test run that this polls for.

`scripts/e2e.js` starts the API this way and runs the view against it. To do
it by hand:

```bash
npm run build
mkdir -p /tmp/ronsel-scratch && node dist/api.js --context /tmp/ronsel-scratch
```
