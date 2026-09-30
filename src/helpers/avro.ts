/**
 * Reading Avro off Kafka, the way a Confluent serializer wrote it.
 *
 * A message in the Confluent wire format is one magic byte (0), the id of its
 * schema in a registry as four big-endian bytes, and the Avro encoding of the
 * value. Nothing in the bytes says what the fields are called: the schema
 * does, so it is fetched from the registry once per id and kept.
 *
 * Only Avro is decoded. A registry holds Protobuf and JSON Schema too, framed
 * the same way; those, and anything that is not framed at all, are left to
 * the caller -- which reads them as JSON, or as text, like any other message.
 */
import avro from 'avsc';

/** Where the schemas live, and how to get in. */
export interface SchemaRegistrySettings {
  url: string;
  username?: string;
  password?: string;
}

/** A registry's answer for a schema: the schema itself, as text. */
interface RegisteredSchema {
  schema: string;
  /** `AVRO` when absent, which is what a registry says for Avro. */
  schemaType?: string;
  references?: { name: string; subject: string; version: number }[];
}

/** Whether bytes are in the Confluent wire format: a zero, and a schema id. */
export const framed = (bytes): boolean => Buffer.isBuffer(bytes) && bytes.length >= 5 && bytes[0] === 0;

/**
 * A decoder bound to one registry, with the schemas it has already fetched.
 *
 * @param {SchemaRegistrySettings} settings
 * @param {Function} [get] - Fetches a path of the registry as JSON: `fetch`,
 *   replaceable by the tests.
 * @returns {{ decode: (bytes: Buffer) => Promise<any> }} `decode` answers the
 *   decoded value, or `undefined` for a schema that is not Avro.
 */
export const registry = (settings: SchemaRegistrySettings, get?: (path: string) => Promise<any>) => {
  const base = String(settings.url).replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/vnd.schemaregistry.v1+json, application/json' };

  if (settings.username) {
    headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password ?? ''}`).toString('base64')}`;
  }

  const fetchJson = get || (async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`The schema registry at ${base} answered ${response.status} for ${path}`);
    }

    return response.json();
  });

  /**
   * An Avro type out of a registered schema. A schema that references others
   * -- a record whose field is a type registered under another subject --
   * has them parsed first, into the same set of named types.
   */
  const parse = async (entry: RegisteredSchema, named: Record<string, any>, seen: Set<string>) => {
    for (const reference of entry.references || []) {
      const key = `${reference.subject}:${reference.version}`;
      if (seen.has(key)) { continue; }
      seen.add(key);

      const referenced = await fetchJson(`/subjects/${encodeURIComponent(reference.subject)}/versions/${reference.version}`);
      await parse(referenced, named, seen);
    }

    return avro.Type.forSchema(JSON.parse(entry.schema), { registry: named });
  };

  const types = new Map<number, Promise<avro.Type | null>>();

  const typeOf = (id: number) => {
    if (!types.has(id)) {
      const pending = fetchJson(`/schemas/ids/${id}`).then((entry: RegisteredSchema) => (
        entry.schemaType && entry.schemaType.toUpperCase() !== 'AVRO' ? null : parse(entry, {}, new Set())
      ));

      // A registry that could not be reached is asked again next time
      pending.catch(() => types.delete(id));
      types.set(id, pending);
    }

    return types.get(id) as Promise<avro.Type | null>;
  };

  return {
    decode: async (bytes: Buffer) => {
      const type = await typeOf(bytes.readInt32BE(1));
      return type ? type.fromBuffer(bytes.subarray(5)) : undefined;
    }
  };
};
