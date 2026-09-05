---
category: running
order: 3
icon: radio
title: 'Remote agents'
summary: 'Write the flows here, run them on a machine that can reach the systems under test.'
keywords:
  - 'remote'
  - 'agent'
  - 'mqtt'
  - 'broker'
  - 'firewall'
  - 'another machine'
  - 'emqx'
  - 'mosquitto'
  - 'network'
  - 'encrypted'
  - 'public key'
---

Sometimes the systems a flow talks to are only reachable from somewhere else:
a machine inside a network you cannot open a port into, a box next to the
devices, a jump host. Remote agents let you keep writing and running flows
from here while the steps execute there.

## How it works

Both machines connect *out* to an MQTT broker — any MQTT 5 broker over TLS
does: EMQX, Mosquitto, HiveMQ. Nothing listens on either side, so no firewall
has to change. The agent announces itself on the broker; when you run a flow
on it, this machine sends the job and follows the run exactly as if it were
local: the same events, the same notebook, the same [test run](/help/test-runs)
at the end.

What travels to the agent:

- **The commit your context is on.** The agent has its own clone of the
  [context](/help/context) and checks that commit out first, so push before
  running. The
  editor's unsaved draft does not travel — the committed file does.
- **The values of the env files the flows use**, encrypted to the agent's own
  key. The broker only ever sees ciphertext, and the agent needs none of your
  variables ahead of time.

What comes back: every event of the run, a question on your screen when a
step asks for a value, and the test-run folder, written into your own
`test-runs` as if it had run here.

## Starting an agent

On the machine that can reach the systems, with a clone of the context:

```bash
lab34-flows --context ~/flows-agent --agent --agent-id agent-ourense \
  --broker mqtts://mqtt.example.com:443 --username agent-ourense --password '...'
```

The broker address and username are stored in the context's
`config/remote.json` and the password in its `.env`, so the flags are only
needed the first time. The agent prints its public key and its fingerprint,
and stays up waiting for jobs. Playwright's browsers have to be installed
there, and anything a flow mimics has to be able to reach that machine.

## Running on it

In **Settings → Remote agents**, enter the broker URL, your username and your
password and save. The agents the server has seen appear in the table, live.
Then pick one in the top bar, next to the environment: the Run button on a
flow and *Run all* on a folder send the flows there, and the run shows up as
any other.

From the command line the same thing is:

```bash
lab34-flows --remote agent-ourense --file flows/my-flow.md --env uat
lab34-flows --remote agent-ourense --view smoke --env uat
```

## Trust

An agent's key is trusted the first time a run reaches it and refused if it
ever changes — the way ssh treats a host key. After reinstalling an agent on
purpose, forget its key in the agents table and the next run trusts the one
it announces.

The broker is what keeps agents apart: give every machine its own user, and
an ACL that lets an agent publish only under `flows/agents/<its name>/` and a
person read every agent's status and results and write their requests.
