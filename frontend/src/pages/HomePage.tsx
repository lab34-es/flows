import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppWindow, ArrowRight, BookOpen, FileText, Play, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import EnvironmentVariablesCard from '@/components/home/EnvironmentVariablesCard';
import { useAppState } from '@/context/AppStateContext';
import { flowUrl } from '@/lib/flows';

const countFlows = (nodes) =>
  nodes.reduce((total, node) => {
    if (node.type === 'folder') { return total + countFlows(node.children || []); }
    return total + 1;
  }, 0);

const findFirstFlow = (nodes) => {
  for (const node of nodes) {
    if (node.type === 'flow') { return node; }
    if (node.type === 'folder') {
      const found = findFirstFlow(node.children || []);
      if (found) { return found; }
    }
  }
  return null;
};

export function HomePage() {
  const { tree, applications } = useAppState();

  const flowsCount = useMemo(() => countFlows(tree), [tree]);
  const firstFlow = useMemo(() => findFirstFlow(tree), [tree]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-6">
      <div className="space-y-2 pt-6">
        {/* The tool's mark over the open-source lockup: ink panel, bone
            stroke, brand radius. */}
        <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-md">
          <Workflow className="size-6" />
        </div>
        <h1 className="font-mono text-3xl tracking-[-0.04em]">
          <span className="font-medium">lab34</span>
          <span className="text-brass">/</span>
          <span className="font-normal">flows</span>
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Flows are <strong>Markdown documents</strong>: write anything — prose, headings, lists —
          and turn any part into an executable step with a <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">```step</code> code
          block. Run a flow and the execution details of each step appear below its block, like a notebook.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="text-muted-foreground size-4" /> Flows
              <Badge variant="secondary">{flowsCount}</Badge>
            </CardTitle>
            <CardDescription>
              Your flows live in the sidebar — organize them in folders, upload files, and run them
              against any environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {firstFlow ? (
              <Link
                to={flowUrl(firstFlow)}
                className="text-brass-text inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
              >
                <Play className="size-3.5" /> Open “{firstFlow.title || firstFlow.name}” <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm">Create your first flow with the + button in the sidebar.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AppWindow className="text-muted-foreground size-4" /> Applications
              <Badge variant="secondary">{applications.length}</Badge>
            </CardTitle>
            <CardDescription>
              Applications define the methods your steps can call. Click one in the sidebar to read
              its README and browse its methods: input parameters, outputs and memory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {applications[0] ? (
              <Link
                to={`/applications/${applications[0].slug}`}
                className="text-brass-text inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
              >
                <BookOpen className="size-3.5" /> Browse “{applications[0].name}” <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm">No applications found yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <EnvironmentVariablesCard />

      <div className="text-muted-foreground space-y-1 text-xs">
        <p>Example applications (calculator, httpbin, jsonplaceholder) and example flows are seeded on first run.</p>
        <p>The <strong>01 · Welcome</strong> flow works fully offline — a good place to start.</p>
      </div>
    </div>
  );
}

export default HomePage;
