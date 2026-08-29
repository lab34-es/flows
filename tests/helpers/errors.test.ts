import * as errors from '../../src/helpers/errors';

describe('errors.describe', () => {
  test('keeps name, message, code and stack of a plain error', () => {
    const error: NodeJS.ErrnoException = new Error('boom');
    error.code = 'EBOOM';

    const described = errors.describe(error);

    expect(described.name).toBe('Error');
    expect(described.message).toBe('boom');
    expect(described.code).toBe('EBOOM');
    expect(described.stack).toContain('boom');
  });

  test('borrows the message of what an AggregateError aggregates', () => {
    // What pg throws when a connection is refused: an empty message, and
    // everything worth reading in .errors -- the case that showed nothing in
    // the UI while the terminal showed both addresses
    const first: NodeJS.ErrnoException = new Error('connect ECONNREFUSED ::1:5432');
    first.code = 'ECONNREFUSED';
    (first as any).port = 5432;
    const second = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    const aggregate: any = new AggregateError([first, second], '');
    aggregate.code = 'ECONNREFUSED';

    const described = errors.describe(aggregate);

    expect(described.name).toBe('AggregateError');
    expect(described.message).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432'
    );
    expect(described.code).toBe('ECONNREFUSED');
    expect(described.causes).toHaveLength(2);
    expect(described.causes?.[0].code).toBe('ECONNREFUSED');
    expect(described.causes?.[0].details).toEqual({ port: 5432 });
  });

  test('follows the cause chain', () => {
    const root = new Error('the socket died');
    const wrapper = new Error('could not read', { cause: root });

    const described = errors.describe(wrapper);

    expect(described.message).toBe('could not read');
    expect(described.causes?.[0].message).toBe('the socket died');
  });

  test('keeps the driver fields worth showing and drops the rest', () => {
    const error: any = new Error('relation "table_name" does not exist');
    error.detail = 'The table was dropped';
    error.severity = 'ERROR';
    error.internalQuery = 'SELECT 1';

    const described = errors.describe(error);

    expect(described.details).toEqual({ detail: 'The table was dropped', severity: 'ERROR' });
  });

  test('survives a cause that loops back on itself', () => {
    const error: any = new Error('looping');
    error.cause = error;

    expect(errors.describe(error).causes?.[0].message).toBe('(circular reference)');
  });

  test('never leaves the message empty', () => {
    expect(errors.describe(new Error('')).message).toBe('Error (no message)');
    expect(errors.describe('just a string').message).toBe('just a string');
    expect(errors.describe(undefined).message).toBe('Error (no message)');
  });
});

describe('errors.summarize', () => {
  test('appends the causes the message does not already mention', () => {
    const described = {
      name: 'AggregateError',
      message: 'could not connect',
      causes: [
        { name: 'Error', message: 'ECONNREFUSED ::1' },
        { name: 'Error', message: 'could not connect' }
      ]
    };

    expect(errors.summarize(described)).toBe('could not connect (ECONNREFUSED ::1)');
  });

  test('leaves a self-explanatory message alone', () => {
    expect(errors.summarize({ name: 'Error', message: 'nope' })).toBe('nope');
  });
});
