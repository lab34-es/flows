import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { settingsApi } from '@/services/api';

/**
 * The form of the SharePoint integration: where the HTML report of a finished
 * test run is uploaded, and as whom.
 *
 * The integration signs in as an application, so an unattended CLI run
 * uploads its own report. The client secret is write-only here — the API
 * stores it in the context's .env and only ever says whether one is there.
 */
function SharepointForm() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<any>(null);

  // Drafts, so nothing is written until Save is pressed
  const [enabled, setEnabled] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [libraryName, setLibraryName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploadOn, setUploadOn] = useState('always');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<any>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const apply = useCallback((data) => {
    setSettings(data);
    setEnabled(Boolean(data.enabled));
    setTenantId(data.tenantId || '');
    setClientId(data.clientId || '');
    setClientSecret('');
    setSiteUrl(data.siteUrl || '');
    setLibraryName(data.libraryName || '');
    setFolderPath(data.folderPath || '');
    setFileName(data.fileName || '');
    setUploadOn(data.uploadOn || 'always');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await settingsApi.getSharepoint();
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
      const payload: Record<string, any> = {
        enabled,
        tenantId,
        clientId,
        siteUrl,
        libraryName,
        folderPath,
        fileName,
        uploadOn,
      };
      // The secret is only sent when the user typed a new one
      if (clientSecret) { payload.clientSecret = clientSecret; }

      const response = await settingsApi.saveSharepoint(payload);
      apply(response.data);
      setSaved(true);
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
      const response = await settingsApi.testSharepoint();
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
        <AlertTitle>Could not load the SharePoint settings</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  const dirty = enabled !== Boolean(settings.enabled)
    || tenantId !== (settings.tenantId || '')
    || clientId !== (settings.clientId || '')
    || siteUrl !== (settings.siteUrl || '')
    || libraryName !== (settings.libraryName || '')
    || folderPath !== (settings.folderPath || '')
    || fileName !== (settings.fileName || '')
    || uploadOn !== (settings.uploadOn || 'always')
    || Boolean(clientSecret);

  // What the settings as drafted would call the next report
  const destination = [
    settings.libraryName || 'Documents',
    folderPath,
    fileName || settings.defaults.fileName,
  ].filter(Boolean).join('/');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="size-4" /> SharePoint
        </CardTitle>
        <CardDescription>
          Upload the HTML report of every finished test run to a SharePoint document
          library, so the people who never open this tool — and the CI job that has no UI at
          all — find it where they already look. The settings are stored in your context
          folder, at <span className="font-mono">{settings.configFile}</span>; the client
          secret goes to <span className="font-mono">{settings.envFile}</span> instead, as{' '}
          <span className="font-mono">{settings.secretEnvKey}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-1">
            <Label htmlFor="sharepoint-enabled">Upload finished reports</Label>
            <p className="text-muted-foreground text-xs">
              Off, nothing leaves your machine: the report is still written into the run folder.
            </p>
          </div>
          <Switch id="sharepoint-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-when">When</Label>
          <Select value={uploadOn} onValueChange={setUploadOn}>
            <SelectTrigger id="sharepoint-when" className="w-full" aria-label="When to upload">
              <SelectValue placeholder="Select when to upload" />
            </SelectTrigger>
            <SelectContent>
              {settings.available.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {settings.available.find((item) => item.id === uploadOn)?.hint}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-site">Site URL</Label>
          <Input
            id="sharepoint-site"
            value={siteUrl}
            placeholder="https://your-company.sharepoint.com/sites/QA"
            onChange={(event) => setSiteUrl(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            The address of the site itself, as the browser shows it — without the library or
            the folder, which are configured below.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-library">Document library</Label>
          <Input
            id="sharepoint-library"
            value={libraryName}
            placeholder="Documents"
            onChange={(event) => setLibraryName(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Leave it empty to use the site's default library.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-folder">Folder</Label>
          <Input
            id="sharepoint-folder"
            value={folderPath}
            placeholder={settings.defaults.folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Inside the library. Missing folders are created on the way; leave it empty to
            upload into the library's root.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-file">File name</Label>
          <Input
            id="sharepoint-file"
            value={fileName}
            placeholder={settings.defaults.fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            The folder and the file name can both be written in terms of the run:{' '}
            {settings.placeholders.map((item, index) => (
              <React.Fragment key={item.token}>
                {index ? ', ' : ''}
                <span className="font-mono" title={item.hint}>{item.token}</span>
              </React.Fragment>
            ))}. A file that is already there is replaced.
          </p>
          <p className="text-muted-foreground text-xs">
            Next report: <span className="font-mono">{destination}</span>
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-tenant">Directory (tenant) id</Label>
          <Input
            id="sharepoint-tenant"
            autoComplete="off"
            value={tenantId}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(event) => setTenantId(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-client">Application (client) id</Label>
          <Input
            id="sharepoint-client"
            autoComplete="off"
            value={clientId}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(event) => setClientId(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sharepoint-secret">
            <KeyRound className="size-3.5" /> Client secret
          </Label>
          <Input
            id="sharepoint-secret"
            type="password"
            autoComplete="off"
            value={clientSecret}
            placeholder={settings.hasClientSecret
              ? 'Stored — type to replace it'
              : 'Paste the client secret value'}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Written to <span className="font-mono">{settings.envFile}</span> in your context
            folder, which is added to <span className="font-mono">.gitignore</span> for you.
          </p>
        </div>

        <p className="text-muted-foreground text-xs">
          Register an application in Microsoft Entra ID (Azure AD), give it the{' '}
          <span className="font-mono">Sites.ReadWrite.All</span> application permission, grant
          it admin consent, and create a client secret for it. Uploads then happen as that
          application, with nobody signed in.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {settings.configured ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" /> Configured
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <AlertCircle className="size-3" /> Not configured yet
            </Badge>
          )}
          {settings.configured && !settings.enabled && (
            <Badge variant="secondary">Uploads are off</Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || dirty}>
            {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {dirty && (
            <span className="text-muted-foreground text-xs">Save first to test your changes.</span>
          )}
        </div>

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
 * The SharePoint section of the Settings screen. The card below loads on its
 * own, so a failure here never hides the rest of the settings.
 */
export function SharepointSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <CloudUpload className="size-5" /> SharePoint
        </h1>
        <p className="text-muted-foreground text-sm">
          Publish the report of every finished test run to a SharePoint document library,
          straight from the run that produced it.
        </p>
      </div>

      <SharepointForm />
    </div>
  );
}

export default SharepointSettings;
