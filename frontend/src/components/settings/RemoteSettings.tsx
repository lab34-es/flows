import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AgentDot } from '@/components/shared/AgentStatus';
import { agentLabel } from '@/lib/agents';
import { useAppState } from '@/context/AppStateContext';
import { settingsApi } from '@/services/api';

const formatSeen = (at?: number) => (at ? new Date(at).toLocaleString() : '—');

/**
 * The broker this UI listens to for agents. The password is write-only: the
 * API keeps it in the context's .env and only says whether one is stored.
 */
function BrokerForm() {
  const { refreshAgents } = useAppState();

  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<any>(null);

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<any>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const apply = useCallback((data) => {
    setSettings(data);
    setUrl(data.broker?.url || '');
    setUsername(data.broker?.username || '');
    setPassword('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await settingsApi.getRemote();
      apply(response.data);
    } catch (ex) {
      setLoadError(ex.response?.data?.error || ex.message);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    try {
      const payload: Record<string, any> = { url, username };
      // The password is only sent when the user typed a new one
      if (password) { payload.password = password; }

      const response = await settingsApi.saveRemote(payload);
      apply(response.data);
      setSaved(true);
      refreshAgents();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await settingsApi.testRemote();
      setTestResult({ ok: true, message: response.data.message });
    } catch (ex) {
      setTestResult({ ok: false, message: ex.response?.data?.error || ex.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Could not load the remote settings</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  const dirty = url !== (settings.broker?.url || '')
    || username !== (settings.broker?.username || '')
    || Boolean(password);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="size-4" /> Broker
        </CardTitle>
        <CardDescription>
          The MQTT broker both this UI and the agents connect to. Neither side opens a
          port: everything travels through the broker, over TLS. The address and username
          are stored in <span className="font-mono">{settings.configFile}</span>; the
          password goes to <span className="font-mono">{settings.envFile}</span> as{' '}
          <span className="font-mono">{settings.passwordEnvKey}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="remote-url">Broker URL</Label>
          <Input
            id="remote-url"
            value={url}
            placeholder="mqtts://mqtt.example.com:443"
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            <span className="font-mono">mqtts://host:port</span> for MQTT over TLS, or{' '}
            <span className="font-mono">wss://host/path</span> for WebSocket, which passes
            firewalls that only let HTTPS out. Leave it empty to turn remote runs off.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="remote-username">Username</Label>
          <Input
            id="remote-username"
            autoComplete="off"
            value={username}
            placeholder="jose"
            onChange={(event) => setUsername(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            One user per machine on the broker, with an ACL that lets this one read every
            agent's status and results and write their requests.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="remote-password">
            <KeyRound className="size-3.5" /> Password
          </Label>
          <Input
            id="remote-password"
            type="password"
            autoComplete="off"
            value={password}
            placeholder={settings.hasPassword ? 'Stored — type to replace it' : 'The broker password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!settings.configured ? (
            <Badge variant="warning" className="gap-1">
              <AlertCircle className="size-3" /> Not configured yet
            </Badge>
          ) : settings.connected ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1" title={settings.error || ''}>
              <AlertCircle className="size-3" /> Not connected
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || dirty || !settings.configured}>
            {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {dirty && (
            <span className="text-muted-foreground text-xs">Save first to test your changes.</span>
          )}
        </div>

        {settings.configured && !settings.connected && settings.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>The server could not connect</AlertTitle>
            <AlertDescription>{settings.error}</AlertDescription>
          </Alert>
        )}

        {testResult && (
          <Alert variant={testResult.ok ? 'default' : 'destructive'}>
            {testResult.ok ? <CheckCircle2 /> : <AlertCircle />}
            <AlertTitle>{testResult.ok ? 'It works' : 'It did not work'}</AlertTitle>
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {saved && !dirty && (
            <span className="text-muted-foreground flex items-center gap-1 text-sm">
              <CheckCircle2 className="size-4" /> Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Every agent the server has seen on the broker, live. An agent is trusted
 * once a run stored its key; forgetting the key is what to do after the agent
 * was reinstalled on purpose.
 */
function AgentsTable() {
  const { agents, agent: picked, setAgent, refreshAgents } = useAppState();
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);

  const forget = async (id: string) => {
    setForgetting(id);
    setError(null);
    try {
      await settingsApi.forgetRemoteAgentKey(id);
      refreshAgents();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setForgetting(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Agents
        </CardTitle>
        <CardDescription>
          Every machine running <span className="font-mono">lab34-flows --agent</span> on this
          broker. Pick one in the top bar and the Run buttons send the flows there. An agent's
          key is trusted the first time a run reaches it and refused if it ever changes; forget
          it here after reinstalling the agent on purpose.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No agent has connected yet. Start one on the machine that can reach your systems:
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((item) => (
                  <TableRow key={item.agent}>
                    <TableCell className="font-medium">
                      {item.agent}
                      {picked === item.agent && (
                        <Badge variant="secondary" className="ml-2">selected</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <AgentDot agent={item} /> {agentLabel(item)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.version || '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-mono text-xs" title={item.fingerprint || ''}>
                        {item.trusted
                          ? <ShieldCheck className="size-3.5 text-emerald-600" />
                          : <ShieldOff className="text-muted-foreground size-3.5" />}
                        {item.fingerprint ? item.fingerprint.slice(0, 23) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatSeen(item.at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {picked !== item.agent && item.online && (
                          <Button variant="outline" size="sm" onClick={() => setAgent(item.agent)}>
                            Use
                          </Button>
                        )}
                        {item.trusted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => forget(item.agent)}
                            disabled={forgetting === item.agent}
                            title="Forget this agent's key, so the next run trusts the one it announces"
                          >
                            {forgetting === item.agent ? <Loader2 className="animate-spin" /> : <ShieldOff />}
                            Forget key
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
{`lab34-flows --context ~/flows-agent --agent --agent-id <name> \\
  --broker <the URL above> --username <name> --password '...'`}
        </pre>
        <p className="text-muted-foreground text-xs">
          The agent needs a clone of this context: runs check out the commit you are on, so push
          before running. The values of the env files the flows use travel with each run,
          encrypted to the agent's key, so the agent needs none of them ahead of time.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Could not forget the key</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The Remote agents section of the Settings screen.
 */
export function RemoteSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Radio className="size-5" /> Remote agents
        </h1>
        <p className="text-muted-foreground text-sm">
          Write the flows here, run them on a machine that can reach the systems under test.
          Both sides connect out to an MQTT broker; nothing listens on either.
        </p>
      </div>

      <BrokerForm />
      <AgentsTable />
    </div>
  );
}

export default RemoteSettings;
