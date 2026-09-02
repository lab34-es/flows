import * as topics from '../../../src/helpers/remote/topics';

describe('remote/topics', () => {
  test('names the status and job channels of an agent', () => {
    expect(topics.status('agent-ourense')).toBe('flows/agents/agent-ourense/status');
    expect(topics.allStatus()).toBe('flows/agents/+/status');
    expect(topics.job('agent-ourense', 'j1', 'request')).toBe('flows/agents/agent-ourense/jobs/j1/request');
    expect(topics.jobs('agent-ourense', 'events')).toBe('flows/agents/agent-ourense/jobs/+/events');
  });

  test('refuses names that could not be a topic segment', () => {
    expect(() => topics.status('a/b')).toThrow('Agent name "a/b" is not usable');
    expect(() => topics.job('ok', '../x', 'events')).toThrow('Job id "../x" is not usable');
    expect(() => topics.assertName('', 'Thing')).toThrow('Thing "" is not usable');
    expect(topics.assertName('fine.name-1_2')).toBe('fine.name-1_2');
  });

  test('parses its own topics back', () => {
    expect(topics.parse('flows/agents/a1/status')).toEqual({ agent: 'a1', channel: 'status' });
    expect(topics.parse('flows/agents/a1/jobs/j9/result')).toEqual({ agent: 'a1', job: 'j9', channel: 'result' });
    expect(topics.parse('flows/agents/a1/jobs/j9/other')).toBeNull();
    expect(topics.parse('flows/agents/a1/jobs/j9')).toBeNull();
    expect(topics.parse('something/else')).toBeNull();
    expect(topics.parse('flows/agents/bad name/status')).toBeNull();
    expect(topics.parse('')).toBeNull();
  });

  test('matches filters with + and #', () => {
    expect(topics.matches('flows/agents/+/status', 'flows/agents/a1/status')).toBe(true);
    expect(topics.matches('flows/agents/+/status', 'flows/agents/a1/jobs/j1/status')).toBe(false);
    expect(topics.matches('flows/#', 'flows/agents/a1/jobs/j1/events')).toBe(true);
    expect(topics.matches('flows/agents/a1/jobs/+/events', 'flows/agents/a1/jobs/j1/events')).toBe(true);
    expect(topics.matches('flows/agents/a1/jobs/+/events', 'flows/agents/a1/jobs/j1')).toBe(false);
    expect(topics.matches('a/b', 'a/b/c')).toBe(false);
    expect(topics.matches('a/b/c', 'a/b')).toBe(false);
    expect(topics.matches('a/b', 'a/b')).toBe(true);
  });
});
