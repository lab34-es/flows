import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, KeyRound, Upload } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { environmentApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';
import { useWorkspace } from '@/workspace/WorkspaceContext';

/**
 * Home page card for the env files: what state they are in, and the way into
 * the Environment variables screen where their values are exported and
 * imported.
 *
 * `applications/<app>/env/<environment>.env` holds secrets, so it never
 * travels with the repository. What can be created without anyone's help --
 * the files a committed `.env.example` already describes -- is created from
 * here; the values themselves are the other screen's job.
 */
export function EnvironmentVariablesCard() {
  const { applicationsRevision, refreshEnvironments, refreshApplications } = useAppState();
  const { openTab } = useWorkspace();

  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await environmentApi.getStatus();
      setStatus(response.data);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // This tab stays mounted while the work happens elsewhere: an import on the
  // Environment variables screen, a file saved in an application's Source
  // view. Both re-read the applications, and the counts below follow.
  const readAtRevision = useRef(applicationsRevision);

  useEffect(() => {
    if (readAtRevision.current === applicationsRevision) { return; }
    readAtRevision.current = applicationsRevision;
    fetchStatus();
  }, [applicationsRevision, fetchStatus]);

  const handleCreateMissing = async () => {
    setCreating(true);
    setError(null);
    try {
      await environmentApi.createMissing();
      // Whatever wrote env files also changed the selector and the applications
      fetchStatus();
      refreshEnvironments();
      refreshApplications();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setCreating(false);
    }
  };

  const environments = status?.environments || [];
  const summary = status?.summary;

  // Opening a tab hides the panel these buttons are in, and the workspace
  // moves the focus to the panel that takes its place. The browser then
  // scrolls whatever it has to for the focused element -- parked below the
  // fold until it is shown -- to be on screen, taking the app's own header
  // with it. Letting go of the button first leaves it nothing to chase.
  const open = (route) => (event) => {
    event.currentTarget.blur();
    openTab(route);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <KeyRound className="text-muted-foreground size-4" /> Environment variables
          <Badge variant="secondary">{environments.length} environment{environments.length === 1 ? '' : 's'}</Badge>
        </CardTitle>
        <CardDescription>
          The values your flows run with live in{' '}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">applications/&lt;app&gt;/env/&lt;environment&gt;.env</code>,
          which holds secrets and so stays out of git. Export the ones a teammate needs as a
          single document, and let them import it into their own context — new files are
          created, existing ones keep everything the document does not name.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openTab('/environment-variables/export')}>
            <Download /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => openTab('/environment-variables/import')}>
            <Upload /> Import
          </Button>
          {summary && summary.creatable > 0 && (
            <Button size="sm" variant="outline" onClick={handleCreateMissing} disabled={creating}>
              <FilePlus2 />
              {creating
                ? 'Creating…'
                : `Create ${summary.creatable} missing file${summary.creatable > 1 ? 's' : ''} from templates`}
            </Button>
          )}
        </div>

        {summary && summary.incomplete > 0 && (
          <p className="text-muted-foreground text-xs">
            {summary.incomplete} env file{summary.incomplete === 1 ? '' : 's'} lack variables
            their <span className="font-mono">.env.example</span> declares.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default EnvironmentVariablesCard;
