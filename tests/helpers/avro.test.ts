import avsc from 'avsc';

import * as avro from '../../src/helpers/avro';

const ORDER: any = {
  type: 'record',
  name: 'OrderPlaced',
  namespace: 'shop',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'total', type: 'double' },
    { name: 'customer', type: 'shop.Customer' }
  ]
};
const CUSTOMER: any = { type: 'record', name: 'Customer', namespace: 'shop', fields: [{ name: 'name', type: 'string' }] };

/** What a Confluent serializer writes: a zero, the schema id, the Avro bytes. */
const wire = (id: number, schema: any, value: any, registry: Record<string, any> = {}) => {
  const header = Buffer.alloc(5);
  header.writeInt32BE(id, 1);
  return Buffer.concat([header, avsc.Type.forSchema(schema, { registry }).toBuffer(value)]);
};

const order = { orderId: 'ord-1', total: 29, customer: { name: 'Ada' } };

/** The schema, as the registry hands it out: as text, with its references. */
const registered = {
  '/schemas/ids/7': { schema: JSON.stringify(ORDER), references: [{ name: 'shop.Customer', subject: 'customer', version: 1 }] },
  '/subjects/customer/versions/1': { schema: JSON.stringify(CUSTOMER) },
  '/schemas/ids/8': { schema: 'syntax = "proto3";', schemaType: 'PROTOBUF' }
};

const encoded = () => {
  const named = {};
  avsc.Type.forSchema(CUSTOMER, { registry: named });
  return wire(7, ORDER, order, named);
};

describe('avro.framed', () => {
  test('a zero and four bytes of schema id, at least', () => {
    expect(avro.framed(encoded())).toBe(true);
    expect(avro.framed(Buffer.from('{"a":1}'))).toBe(false);
    expect(avro.framed(Buffer.from([0, 0, 0]))).toBe(false);
    expect(avro.framed(null)).toBe(false);
    expect(avro.framed('text')).toBe(false);
  });
});

describe('avro.registry', () => {
  test('decodes with the schema of the id, references included, fetching each once', async () => {
    const get = jest.fn(async (path: string) => registered[path]);
    const registry = avro.registry({ url: 'http://registry:8081/' }, get);

    expect(JSON.parse(JSON.stringify(await registry.decode(encoded())))).toEqual(order);
    await registry.decode(encoded());

    expect(get.mock.calls.map(([path]) => path)).toEqual(['/schemas/ids/7', '/subjects/customer/versions/1']);
  });

  test('a schema that is not Avro is left undecoded', async () => {
    const registry = avro.registry({ url: 'http://r' }, async (path: string) => registered[path]);
    const protobuf = Buffer.concat([Buffer.from([0, 0, 0, 0, 8]), Buffer.from('proto bytes')]);

    await expect(registry.decode(protobuf)).resolves.toBeUndefined();
  });

  test('a registry that could not answer is asked again the next time', async () => {
    const get = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockImplementation(async (path: string) => registered[path]);
    const registry = avro.registry({ url: 'http://r' }, get);

    await expect(registry.decode(encoded())).rejects.toThrow('ECONNREFUSED');
    await expect(registry.decode(encoded())).resolves.toEqual(expect.objectContaining({ orderId: 'ord-1' }));
  });

  test('talks to the registry over HTTP, with basic auth when given credentials', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => ({
      ok: true,
      json: async () => registered[String(url).replace('http://registry:8081', '')]
    }) as any);

    const registry = avro.registry({ url: 'http://registry:8081', username: 'key', password: 'secret' });
    await registry.decode(encoded());

    expect(fetch).toHaveBeenCalledWith('http://registry:8081/schemas/ids/7', {
      headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}` })
    });
  });

  test('a registry that answers an error says which', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as any);

    await expect(avro.registry({ url: 'http://r' }).decode(encoded()))
      .rejects.toThrow('The schema registry at http://r answered 404 for /schemas/ids/7');
  });
});
