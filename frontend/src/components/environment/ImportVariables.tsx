import React, { useCallback } from 'react';
import { Upload } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import EnvVariablesImport from '@/components/environment/EnvVariablesImport';
import { useAppState } from '@/context/AppStateContext';

/**
 * The Import section of the Environment variables screen: paste what somebody
 * sent, see what it would do, then write it into this context's env files.
 */
export function ImportVariables() {
  const { refreshEnvironments, refreshApplications } = useAppState();

  // An import creates env files, so it can put a whole environment on the
  // selector and change what every open application page is showing
  const handleImported = useCallback(() => {
    refreshEnvironments();
    refreshApplications();
  }, [refreshEnvironments, refreshApplications]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Upload className="size-5" /> Import
        </h1>
        <p className="text-muted-foreground text-sm">
          Write a teammate's export into your own env files — the ones that are missing are
          created, the ones you have keep everything the document does not name.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The document</CardTitle>
          <CardDescription>
            Paste it and the plan appears on its own: which files would be created, which variables
            added, and which existing values overwritten. Nothing is written until you press
            Import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnvVariablesImport onImported={handleImported} />
        </CardContent>
      </Card>
    </div>
  );
}

export default ImportVariables;
