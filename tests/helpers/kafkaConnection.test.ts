import fs from 'fs';

import { connectionOptions, reason, settingsFromEnv } from '../../src/helpers/kafkaConnection';

describe('kafkaConnection.connectionOptions', () => {
  test('brokers are a list or one comma-separated string, trimmed', () => {
    expect(connectionOptions({ brokers: [' a:9092 ', 'b:9092', ''] }).bootstrapBrokers).toEqual(['a:9092', 'b:9092']);
    expect(connectionOptions({ brokers: 'a:9092,,b:9092 ' }).bootstrapBrokers).toEqual(['a:9092', 'b:9092']);
  });

  test('no broker at all is refused, whatever the shape of nothing', () => {
    expect(() => connectionOptions()).toThrow('No Kafka brokers configured');
    expect(() => connectionOptions({ brokers: '' })).toThrow('No Kafka brokers configured');
    expect(() => connectionOptions({ brokers: [] })).toThrow('No Kafka brokers configured');
  });

  test('plain text and no credentials unless something asks for them', () => {
    expect(connectionOptions({ brokers: 'a:1', clientId: 'shop' })).toEqual({ clientId: 'shop', bootstrapBrokers: ['a:1'] });
    expect(connectionOptions({ brokers: 'a:1', sasl: {} }).sasl).toBeUndefined();
  });

  test('each piece of TLS material implies TLS, and is read off disk', () => {
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('PEM' as any);

    expect(connectionOptions({ brokers: 'a:1', ca: '/ca.pem' }).tls).toEqual({ ca: 'PEM' });
    expect(connectionOptions({ brokers: 'a:1', cert: '/c.pem', key: '/k.pem' }).tls).toEqual({ cert: 'PEM', key: 'PEM' });
    expect(read).toHaveBeenCalledWith('/ca.pem');
  });

  test('a mechanism alone is enough to send credentials, upper-cased as the protocol spells it', () => {
    expect(connectionOptions({ brokers: 'a:1', sasl: { mechanism: 'scram-sha-256' } }).sasl)
      .toEqual({ mechanism: 'SCRAM-SHA-256', username: undefined, password: undefined });
  });
});

describe('kafkaConnection.reason', () => {
  test('the innermost message, following aggregated errors and causes', () => {
    const inner = new Error('Connection to localhost:9092 failed.');
    const wrapped = new AggregateError([new Error('Cannot connect to any broker.', { cause: inner })], 'metadata failed 4 times.');

    expect(reason(wrapped)).toBe('Connection to localhost:9092 failed.');
    expect(reason(new Error('Unknown topic x.'))).toBe('Unknown topic x.');
  });

  test('something that is not an error is put into words all the same', () => {
    expect(reason('refused')).toBe('refused');
    expect(reason({ errors: [{}] })).toBe('[object Object]');
    expect(reason(new AggregateError([{ cause: null }], 'outer'))).toBe('outer');
  });
});

describe('kafkaConnection.settingsFromEnv', () => {
  test('the KAFKA_* variables of an env file, schema registry included', () => {
    expect(settingsFromEnv({
      KAFKA_BROKERS: 'a:9092',
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512',
      KAFKA_USERNAME: 'u',
      KAFKA_PASSWORD: 'p',
      KAFKA_REJECT_UNAUTHORIZED: 'false',
      KAFKA_SCHEMA_REGISTRY_URL: 'http://registry:8081',
      KAFKA_SCHEMA_REGISTRY_USERNAME: 'ru',
      KAFKA_SCHEMA_REGISTRY_PASSWORD: 'rp'
    })).toEqual(expect.objectContaining({
      brokers: 'a:9092',
      ssl: true,
      rejectUnauthorized: false,
      sasl: { mechanism: 'SCRAM-SHA-512', username: 'u', password: 'p' },
      schemaRegistry: { url: 'http://registry:8081', username: 'ru', password: 'rp' }
    }));
  });

  test('nothing configured is nothing asked for', () => {
    expect(settingsFromEnv())
      .toEqual(expect.objectContaining({ ssl: false, sasl: undefined, schemaRegistry: undefined }));
  });
});
