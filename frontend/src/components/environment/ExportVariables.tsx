import React from 'react';
import { Download } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import EnvVariablesExport from '@/components/environment/EnvVariablesExport';
import { useAppState } from '@/context/AppStateContext';

/**
 * The Export section of the Environment variables screen: pick what a
 * teammate needs and get the one document that carries it.
 */
export function ExportVariables() {
  const { applicationsRevision } = useAppState();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Download className="size-5" /> Export
        </h1>
        <p className="text-muted-foreground text-sm">
          Hand the values of your env files over as a single document, without dictating a token
          over a call.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What to send</CardTitle>
          <CardDescription>
            Tick whatever the other person needs — a whole application, one environment of it, or a
            single variable. The values are read when you press Export, so what travels is what the
            files hold at that moment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Re-read whenever the applications are: an import a moment ago
              may have created the very env file this tree should be offering */}
          <EnvVariablesExport revision={applicationsRevision} />
        </CardContent>
      </Card>
    </div>
  );
}

export default ExportVariables;
