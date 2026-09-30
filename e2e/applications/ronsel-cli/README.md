# ronsel-cli

The ronsel command line, under test. Every method spawns the compiled CLI
(`dist/cli.js`, named by `CLI` in `env/ci.env`) in a separate process, the way
a person or a pipeline runs it, and brings back the exit code and what was
printed. A flow against this application tests the shipped command, not the
package's internals.

Commands that need a context get a scratch one: an empty temporary folder
furnished with the bundled examples, as ronsel furnishes an empty folder on
first start. It is created once per process and shared by every step after,
so a flow can run a command and then look at what it left behind.

Build first: `npm run build` is what writes `dist/`.
