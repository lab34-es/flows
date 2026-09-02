import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { flowsApi, applicationsApi, environmentApi, contextApi, testRunsApi, settingsApi } from '@/services/api';
import { socket } from '@/services/socket';
import { indexChanges, scopedStatus } from '@/lib/git';

const AppStateContext = createContext<any>(null);

const ENV_STORAGE_KEY = 'lab34-flows:environment';
// '' is this machine; otherwise the name of the agent runs are sent to
const AGENT_STORAGE_KEY = 'lab34-flows:agent';

// Git state goes stale on its own -- a pull in a terminal, a file written by
// another tool -- so it is re-read on a timer as well as after our own writes.
const GIT_POLL_MS = 15000;

export function AppStateProvider({ children }) {
  const [tree, setTree] = useState<any[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [applications, setApplications] = useState<any[]>([]);
  // Bumped every time the applications are re-read. A page showing one of
  // them keeps its own copy, fetched when it opened: this is what tells it
  // that something -- an import on the home page, another tab's Source view,
  // a file created from a template -- has written to the folder since.
  const [applicationsRevision, setApplicationsRevision] = useState(0);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [environments, setEnvironments] = useState<any[]>([]);
  const [environment, setEnvironmentState] = useState(
    () => localStorage.getItem(ENV_STORAGE_KEY) || ''
  );
  const [contextInfo, setContextInfo] = useState<any>(null);
  const [testRuns, setTestRuns] = useState<any[]>([]);
  // The remote agents the server has seen on the broker, and where runs go
  const [agents, setAgents] = useState<any[]>([]);
  const [agent, setAgentState] = useState(
    () => localStorage.getItem(AGENT_STORAGE_KEY) || ''
  );

  const refreshContext = useCallback(async () => {
    try {
      const response = await contextApi.get();
      setContextInfo(response.data || null);
    } catch (error) {
      console.error('Error loading context info:', error);
    }
  }, []);

  const refreshTree = useCallback(async () => {
    try {
      const response = await flowsApi.tree();
      setTree(response.data || []);
    } catch (error) {
      console.error('Error loading flows tree:', error);
    } finally {
      setTreeLoading(false);
    }
    // Whatever moved the tree moved the working copy with it
    refreshContext();
  }, [refreshContext]);

  const refreshApplications = useCallback(async () => {
    try {
      const response = await applicationsApi.list();
      setApplications(response.data || []);
      setApplicationsRevision((revision) => revision + 1);
    } catch (error) {
      console.error('Error loading applications:', error);
    } finally {
      setApplicationsLoading(false);
    }
  }, []);

  const refreshEnvironments = useCallback(async () => {
    try {
      const response = await environmentApi.getAllPossible();
      const list = response.data || [];
      setEnvironments(list);
      // Auto-select when nothing (valid) is selected yet
      setEnvironmentState((current) => {
        if (current && list.includes(current)) { return current; }
        const initial = list.includes('local') ? 'local' : list[0] || '';
        if (initial) { localStorage.setItem(ENV_STORAGE_KEY, initial); }
        return initial;
      });
    } catch (error) {
      console.error('Error loading environments:', error);
    }
  }, []);

  const setEnvironment = useCallback((value) => {
    setEnvironmentState(value);
    localStorage.setItem(ENV_STORAGE_KEY, value);
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      const response = await settingsApi.remoteAgents();
      setAgents(response.data?.agents || []);
    } catch (error) {
      console.error('Error loading remote agents:', error);
    }
  }, []);

  const setAgent = useCallback((value) => {
    setAgentState(value || '');
    localStorage.setItem(AGENT_STORAGE_KEY, value || '');
  }, []);

  const refreshTestRuns = useCallback(async () => {
    try {
      const response = await testRunsApi.list();
      setTestRuns(response.data || []);
    } catch (error) {
      console.error('Error loading test runs:', error);
    }
  }, []);

  useEffect(() => {
    refreshTree();
    refreshApplications();
    refreshEnvironments();
    refreshTestRuns();
    refreshAgents();
    // refreshTree() reads the context state too
  }, [refreshTree, refreshApplications, refreshEnvironments, refreshTestRuns, refreshAgents]);

  // The server pushes the whole list every time an agent's status changes
  useEffect(() => {
    const onUpdate = (event) => { setAgents(event?.agents || []); };
    socket.on('agents:update', onUpdate);
    return () => { socket.off('agents:update', onUpdate); };
  }, []);

  // The backend says so every time a run is created, progresses or ends --
  // a handful of events per run, so re-reading the list is cheap enough
  useEffect(() => {
    const onUpdate = () => { refreshTestRuns(); };
    socket.on('testrun:update', onUpdate);
    return () => { socket.off('testrun:update', onUpdate); };
  }, [refreshTestRuns]);

  // Poll while the tab is in front, and catch up as soon as it comes back:
  // a background tab has nobody looking at its file decorations.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) { refreshContext(); }
    };

    const timer = window.setInterval(onVisible, GIT_POLL_MS);
    window.addEventListener('focus', refreshContext);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshContext);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshContext]);

  // The decorations the sidebar draws, rebuilt only when git state changes
  const gitIndex = useMemo(
    () => indexChanges(contextInfo?.git?.changes),
    [contextInfo]
  );

  const value = useMemo(
    () => ({
      tree,
      treeLoading,
      refreshTree,
      applications,
      applicationsLoading,
      applicationsRevision,
      refreshApplications,
      environments,
      environment,
      setEnvironment,
      refreshEnvironments,
      contextInfo,
      refreshContext,
      gitIndex,
      testRuns,
      refreshTestRuns,
      agents,
      agent,
      setAgent,
      refreshAgents,
    }),
    [tree, treeLoading, refreshTree, applications, applicationsLoading, applicationsRevision, refreshApplications, environments, environment, setEnvironment, refreshEnvironments, contextInfo, refreshContext, gitIndex, testRuns, refreshTestRuns, agents, agent, setAgent, refreshAgents]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
}

/**
 * Git decorations for one of the context's subtrees ('flows' or
 * 'applications'), keyed by the same relative paths the sidebar already uses.
 * @param {string} prefix
 */
export function useGitStatus(prefix) {
  const { gitIndex } = useAppState();
  return useMemo(() => scopedStatus(gitIndex, prefix), [gitIndex, prefix]);
}
