import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { socket } from '@/services/socket';
import { flowsApi } from '@/services/api';

/**
 * Tracks flow executions, keyed by flow file path.
 *
 * The API answers a "start" request with the execution id, while socket.io
 * pushes `flowexecution:update` events (topics: execution / diagram / step).
 * Events may arrive before the HTTP response resolves, so unknown execution
 * ids are buffered and replayed once the id -> path mapping is known.
 *
 * Execution state per flow path:
 * {
 *   status: 'starting' | 'running' | 'passed' | 'error',
 *   execution,       // { id, status, times, error } from the runner
 *   stepOrder,       // ordered step ids (from the diagram event)
 *   steps,           // stepId -> live step data (request, response, tests...)
 *   inputs,          // stepId -> what that step is asking the person for
 *   startError,      // error message when the run could not even start
 *   environment,
 * }
 */
const ExecutionContext = createContext<any>(null);

export function ExecutionProvider({ children }) {
  const [executions, setExecutions] = useState<any>({});
  const idToPath = useRef({});
  const pendingEvents = useRef<any[]>([]);

  const applyEvent = useCallback((path, event) => {
    const { topic, data } = event;

    setExecutions((prev) => {
      const current = prev[path] || { steps: {}, stepOrder: [], inputs: {} };

      if (topic === 'execution') {
        // Nothing can be answered once the run is over
        const inputs = data.status === 'running' ? current.inputs : {};
        return {
          ...prev,
          [path]: { ...current, execution: data, status: data.status, inputs },
        };
      }

      if (topic === 'diagram') {
        const steps = { ...current.steps };
        (data.steps || []).forEach((step) => {
          steps[step.id] = { ...steps[step.id], ...step };
        });
        return {
          ...prev,
          [path]: {
            ...current,
            stepOrder: (data.steps || []).map((step) => step.id),
            steps,
          },
        };
      }

      // A step is stopped waiting for a value only a person can give. The
      // request is keyed by step so the field appears under the step that
      // asked for it, and 'resolved' is what takes it away again.
      if (topic === 'input' && data && data.id) {
        const stepId = data.stepId || '__flow__';
        const inputs = { ...(current.inputs || {}) };

        if (data.status === 'resolved') {
          if (inputs[stepId]?.id === data.id) { delete inputs[stepId]; }
        } else {
          inputs[stepId] = data;
        }

        return { ...prev, [path]: { ...current, inputs } };
      }

      if (topic === 'step' && data && data.id) {
        return {
          ...prev,
          [path]: {
            ...current,
            steps: { ...current.steps, [data.id]: data.data },
          },
        };
      }

      return prev;
    });
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (!event || !event.id) { return; }
      const path = idToPath.current[event.id];
      if (!path) {
        pendingEvents.current.push(event);
        if (pendingEvents.current.length > 500) {
          pendingEvents.current.shift();
        }
        return;
      }
      applyEvent(path, event);
    };

    // If the connection drops mid-run we lose events for good: surface it
    // instead of leaving flows in "running" forever (which would also keep
    // the Run button disabled everywhere)
    const onDisconnect = () => {
      setExecutions((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.entries<any>(next).forEach(([path, run]) => {
          if (run.status === 'starting' || run.status === 'running') {
            next[path] = {
              ...run,
              status: 'error',
              startError: 'Connection to the server was lost while the flow was running.',
            };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };

    socket.on('flowexecution:update', handler);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('flowexecution:update', handler);
      socket.off('disconnect', onDisconnect);
    };
  }, [applyEvent]);

  const startRun = useCallback(async (flowPath, { value, environment, path }) => {
    setExecutions((prev) => ({
      ...prev,
      [flowPath]: { steps: {}, stepOrder: [], inputs: {}, status: 'starting', environment },
    }));

    try {
      // `path` tells the backend which file this is, so the test run it
      // records can store the copy under the flow's own name
      const response = await flowsApi.start({ value, environment, path });
      const execution = response.data.execution;

      idToPath.current[execution.id] = flowPath;

      // Replay any events that arrived before we knew the execution id
      const buffered = pendingEvents.current.filter((event) => event.id === execution.id);
      pendingEvents.current = pendingEvents.current.filter((event) => event.id !== execution.id);

      applyEvent(flowPath, { topic: 'execution', data: execution });
      buffered.forEach((event) => applyEvent(flowPath, event));
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Could not start the flow';
      setExecutions((prev) => ({
        ...prev,
        [flowPath]: { ...prev[flowPath], status: 'error', startError: message },
      }));
    }
  }, [applyEvent]);

  /**
   * Answer -- or give up on -- what a step asked for. The runner resumes (or
   * fails) the step; the socket is what takes the field away, so nothing is
   * removed here.
   *
   * @param {string} id - The request id
   * @param {string} value - What the person typed. Ignored when cancelling.
   * @param {boolean} [cancel]
   */
  const answerInput = useCallback(async (id, value, cancel = false) => {
    if (cancel) {
      await flowsApi.cancelInput(id);
      return;
    }
    await flowsApi.answerInput(id, value);
  }, []);

  const clearRun = useCallback((flowPath) => {
    setExecutions((prev) => {
      const next = { ...prev };
      delete next[flowPath];
      return next;
    });
  }, []);

  // 'standby' | 'running' | 'ok' | 'error' — the sidebar status indicator
  const statusFor = useCallback(
    (flowPath) => {
      const run = executions[flowPath];
      if (!run) { return 'standby'; }
      if (run.status === 'starting' || run.status === 'running') { return 'running'; }
      if (run.status === 'passed') { return 'ok'; }
      if (run.status === 'error') { return 'error'; }
      return 'standby';
    },
    [executions]
  );

  const anyRunning = useMemo(
    () => Object.values<any>(executions).some((run) => run.status === 'starting' || run.status === 'running'),
    [executions]
  );

  const value = useMemo(
    () => ({ executions, startRun, clearRun, answerInput, statusFor, anyRunning }),
    [executions, startRun, clearRun, answerInput, statusFor, anyRunning]
  );

  return <ExecutionContext.Provider value={value}>{children}</ExecutionContext.Provider>;
}

export function useExecutions() {
  const context = useContext(ExecutionContext);
  if (!context) {
    throw new Error('useExecutions must be used within an ExecutionProvider');
  }
  return context;
}
