import pg from 'pg';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';
import createDebug from 'debug';

const debug = createDebug('lab34:flows:helpers:pgClient');

/**
 * Executes a query on a PostgreSQL database.
 *
 * @param {Object} ctx - The context object containing the database configuration.
 * @param {Object} ctx.env - Environment variables for database configuration.
 * @param {string} [ctx.env.DATABASE_CONNECTION_STRING] - The connection string for the PostgreSQL database.
 * @param {string} [ctx.env.PGUSER] - Database user.
 * @param {string} [ctx.env.PGPASSWORD] - Database password.
 * @param {string} [ctx.env.PGHOST] - Database host.
 * @param {string} [ctx.env.PGPORT] - Database port.
 * @param {string} [ctx.env.PGDATABASE] - Database name.
 * @param {string} [ctx.env.PGQUERY_TIMEOUT] - Query timeout in milliseconds.
 * @param {string} [ctx.env.PGLOCK_TIMEOUT] - Lock timeout in milliseconds.
 * @param {string} [ctx.env.PGCLIENT_ENCODING] - Client encoding.
 * @param {string} [ctx.env.PGOPTIONS] - Command-line options to be sent to the server.
 * @param {string} [ctx.env.PGSSL_ENABLED] - Enable SSL connection (true/false).
 * @param {string} [ctx.env.PGSSL_REJECT_UNAUTHORIZED] - Reject unauthorized certificates (true/false).
 * @param {string} [ctx.env.PGSSL_CA] - Path to CA certificate file.
 * @param {string} [ctx.env.PGSSL_CERT] - Path to client certificate file.
 * @param {string} [ctx.env.PGSSL_KEY] - Path to client key file.
 * @param {string} query - The SQL query to be executed.
 * @param {Array} values - The values to be used in the SQL query.
 * @returns {Promise<pg.QueryResult>} - A promise that resolves to the result
 *   of the query, i.e. `rows` as objects keyed by column name.
 * @throws {Error} - Throws an error if the query execution fails.
 */
// The types matter here beyond this file: pg overloads `query`, and an untyped
// SQL string picks the array-of-arrays overload, which would tell every
// application that `res.rows[0]` is an array rather than a row.
export const query = (ctx, query: string, values?: any[]): Promise<pg.QueryResult> => {
  // Build database configuration object
  const dbConfig: pg.ClientConfig = {};

  // Priority 1: Use connection string if provided (for backward compatibility)
  if (ctx.env.DATABASE_CONNECTION_STRING) {
    dbConfig.connectionString = ctx.env.DATABASE_CONNECTION_STRING;
    // Debug connection string (mask sensitive parts)
    const maskedConnectionString = ctx.env.DATABASE_CONNECTION_STRING.replace(
      /(?<=:\/\/[^:]+:)[^@]+(?=@)/,
      '****'
    );
    debug('Authentication: Using connection string: %s', maskedConnectionString);
  } else {
    // Priority 2: Use individual parameters
    if (ctx.env.PGUSER) {
      dbConfig.user = ctx.env.PGUSER;
      debug('Authentication: Database user: %s', ctx.env.PGUSER);
    }
    
    if (ctx.env.PGPASSWORD) {
      dbConfig.password = ctx.env.PGPASSWORD;
      debug('Authentication: Database password: [REDACTED]');
    }
    
    if (ctx.env.PGHOST) {
      dbConfig.host = ctx.env.PGHOST;
      debug('Authentication: Database host: %s', ctx.env.PGHOST);
    }
    
    if (ctx.env.PGPORT) {
      dbConfig.port = parseInt(ctx.env.PGPORT, 10);
      debug('Authentication: Database port: %d', dbConfig.port);
    }
    
    if (ctx.env.PGDATABASE) {
      dbConfig.database = ctx.env.PGDATABASE;
      debug('Authentication: Database name: %s', ctx.env.PGDATABASE);
    }
  }

  // Additional configuration parameters (work with both connection string and individual params)
  if (ctx.env.PGQUERY_TIMEOUT) {
    dbConfig.query_timeout = parseInt(ctx.env.PGQUERY_TIMEOUT, 10);
  }
  
  if (ctx.env.PGLOCK_TIMEOUT) {
    dbConfig.lock_timeout = parseInt(ctx.env.PGLOCK_TIMEOUT, 10);
  }
  
  if (ctx.env.PGCLIENT_ENCODING) {
    dbConfig.client_encoding = ctx.env.PGCLIENT_ENCODING;
  }
  
  if (ctx.env.PGOPTIONS) {
    dbConfig.options = ctx.env.PGOPTIONS;
  }

  // SSL configuration
  if (ctx.env.PGSSL_ENABLED === 'true') {
    const ssl: TlsConnectionOptions = {};
    debug('SSL: Enabled');
    
    if (ctx.env.PGSSL_REJECT_UNAUTHORIZED === 'false') {
      ssl.rejectUnauthorized = false;
      debug('SSL: Certificate validation disabled (rejectUnauthorized: false)');
    }
    
    if (ctx.env.PGSSL_CA) {
      ssl.ca = ctx.env.PGSSL_CA;
      debug('SSL: CA certificate path: %s', ctx.env.PGSSL_CA);
    }
    
    if (ctx.env.PGSSL_CERT) {
      ssl.cert = ctx.env.PGSSL_CERT;
      debug('SSL: Client certificate path: %s', ctx.env.PGSSL_CERT);
    }
    
    if (ctx.env.PGSSL_KEY) {
      ssl.key = ctx.env.PGSSL_KEY;
      debug('SSL: Client key path: %s', ctx.env.PGSSL_KEY);
    }

    dbConfig.ssl = ssl;
  }

  // Debug query details
  debug('SQL Query: %s', query);
  if (values && values.length > 0) {
    debug('Query Parameters: %O', values);
  }

  debug('Database configuration: %O', {
    ...dbConfig
  });

  // Create a new PostgreSQL client
  const client = new pg.Client(dbConfig);

  // Connect to the database
  return client.connect()
    .then(() => {
      debug('Database connection established');
      // Execute the query with the provided values
      return client.query(query, values);
    })
    .then((res) => {
      debug('Query executed successfully. Rows affected: %d', res.rowCount);
      // Close the database connection
      client.end();
      debug('Database connection closed');
      // Return the query result
      return res;
    })
    .catch((err) => {
      debug('Query execution failed: %s', err.message);
      // Close the database connection in case of an error
      client.end();
      debug('Database connection closed due to error');
      // Throw the error to be handled by the caller
      throw err;
    });
};
