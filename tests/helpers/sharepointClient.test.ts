// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn()
}));

import axios from 'axios';
import * as client from '../../src/helpers/sharepoint/client';

const SETTINGS = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  clientSecret: 'super-secret',
  siteUrl: 'https://acme.sharepoint.com/sites/QA',
  libraryName: ''
};

/** An axios rejection the way the library shapes one. */
const httpError = (status, data?) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data }
});

/** Graph answering the site and drive lookups. */
const graphFinds = () => {
  (axios.get as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/sites/site-id/drive')) { return { data: { id: 'drive-id', name: 'Documents' } }; }
    if (url.includes('/sites/acme.sharepoint.com')) {
      return { data: { id: 'site-id', displayName: 'QA' } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
};

const signsIn = () => {
  (axios.post as jest.Mock).mockResolvedValue({ data: { access_token: 'jwt', expires_in: 3600 } });
};

beforeEach(() => {
  (axios.get as jest.Mock).mockReset();
  (axios.post as jest.Mock).mockReset();
  (axios.put as jest.Mock).mockReset();
  client.resetToken();
});

describe('parseSiteUrl', () => {
  test('splits a site URL the way Graph addresses one', () => {
    expect(client.parseSiteUrl('https://acme.sharepoint.com/sites/QA/'))
      .toEqual({ host: 'acme.sharepoint.com', path: '/sites/QA' });
    expect(client.parseSiteUrl('https://acme.sharepoint.com'))
      .toEqual({ host: 'acme.sharepoint.com', path: '' });
    expect(client.parseSiteUrl('https://acme.sharepoint.com/'))
      .toEqual({ host: 'acme.sharepoint.com', path: '' });
  });

  test('refuses anything that is not one', () => {
    expect(() => client.parseSiteUrl('acme.sharepoint.com')).toThrow(/is not a SharePoint site URL/);
    expect(() => client.parseSiteUrl('ftp://acme.sharepoint.com')).toThrow(/is not a SharePoint site URL/);
    expect(() => client.parseSiteUrl('')).toThrow(/is not a SharePoint site URL/);
  });
});

describe('encodePath', () => {
  test('encodes every segment and drops the empty ones', () => {
    expect(client.encodePath('/Test reports//2026/./')).toBe('Test%20reports/2026');
    expect(client.encodePath('')).toBe('');
    expect(client.encodePath('Reports\\2026')).toBe('Reports/2026');
  });
});

describe('authenticating', () => {
  test('asks for a client-credentials token and reuses it', async () => {
    signsIn();
    graphFinds();

    await client.verify(SETTINGS);
    await client.verify(SETTINGS);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
  });

  test('explains a refused sign-in, and does not cache it', async () => {
    (axios.post as jest.Mock).mockRejectedValue(httpError(401, { error_description: 'Invalid client secret' }));

    await expect(client.verify(SETTINGS)).rejects.toThrow(/sign in to SharePoint \(HTTP 401\): Invalid client secret/);

    (axios.post as jest.Mock).mockResolvedValue({ data: { access_token: 'jwt', expires_in: 3600 } });
    graphFinds();

    await expect(client.verify(SETTINGS)).resolves.toMatchObject({ site: 'QA' });
  });

  test('a sign-in that answers without a token is a failure', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: {} });

    await expect(client.verify(SETTINGS)).rejects.toThrow(/without an access token/);
  });

  test('signs in again when the cached token has been revoked', async () => {
    signsIn();
    let calls = 0;
    (axios.get as jest.Mock).mockImplementation(async (url) => {
      calls += 1;
      if (calls === 1) { throw httpError(401, { error: { message: 'Access token has expired' } }); }
      if (url.endsWith('/sites/site-id/drive')) { return { data: { id: 'drive-id', name: 'Documents' } }; }
      return { data: { id: 'site-id', displayName: 'QA' } };
    });

    await expect(client.verify(SETTINGS)).resolves.toMatchObject({ library: 'Documents' });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('a token that is refused twice gives up with the reason', async () => {
    signsIn();
    (axios.get as jest.Mock).mockRejectedValue(httpError(401, { error: { message: 'Access denied' } }));

    await expect(client.verify(SETTINGS)).rejects.toThrow(/HTTP 401.*Access denied/);
  });

  test('a network failure keeps its own message', async () => {
    signsIn();
    (axios.get as jest.Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND graph.microsoft.com'));

    await expect(client.verify(SETTINGS)).rejects.toThrow(/ENOTFOUND/);
  });
});

describe('uploading', () => {
  test('addresses the root site of a tenant by its hostname alone', async () => {
    signsIn();
    graphFinds();
    (axios.put as jest.Mock).mockResolvedValue({ data: { name: 'r.html', webUrl: 'https://acme/r.html' } });

    await client.upload({ ...SETTINGS, siteUrl: 'https://acme.sharepoint.com' }, {
      folderPath: '',
      fileName: 'r.html',
      content: '<html></html>'
    });

    expect((axios.get as jest.Mock).mock.calls[0][0])
      .toBe('https://graph.microsoft.com/v1.0/sites/acme.sharepoint.com');
    expect((axios.put as jest.Mock).mock.calls[0][0])
      .toContain('/drives/drive-id/root:/r.html:/content');
  });

  test('a report too big for one request goes up in chunks', async () => {
    signsIn();
    graphFinds();

    const big = Buffer.alloc(5 * 1024 * 1024, 'x');
    const ranges: string[] = [];

    (axios.post as jest.Mock).mockImplementation(async (url) => {
      if (url.endsWith('/createUploadSession')) {
        return { data: { uploadUrl: 'https://upload.sharepoint.com/session' } };
      }
      return { data: { access_token: 'jwt', expires_in: 3600 } };
    });

    (axios.put as jest.Mock).mockImplementation(async (url, body, options) => {
      ranges.push(options.headers['Content-Range']);
      return { data: { name: 'big.html', size: big.length, webUrl: 'https://acme/big.html' } };
    });

    const result = await client.upload(SETTINGS, { folderPath: 'Reports', fileName: 'big.html', content: big });

    expect(result).toMatchObject({ name: 'big.html', path: 'Reports/big.html', library: 'Documents' });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBe(`bytes 0-3276799/${big.length}`);
    expect(ranges[1]).toBe(`bytes 3276800-${big.length - 1}/${big.length}`);
    // The upload URL carries its own authorization
    expect((axios.put as jest.Mock).mock.calls[0][2].headers.Authorization).toBeUndefined();
  });

  test('a session nobody could start is reported as such', async () => {
    signsIn();
    graphFinds();

    (axios.post as jest.Mock).mockImplementation(async (url) => {
      if (url.endsWith('/createUploadSession')) { throw httpError(507, 'Insufficient storage'); }
      return { data: { access_token: 'jwt', expires_in: 3600 } };
    });

    await expect(client.upload(SETTINGS, {
      folderPath: '',
      fileName: 'big.html',
      content: Buffer.alloc(5 * 1024 * 1024, 'x')
    })).rejects.toThrow(/start the upload to SharePoint \(HTTP 507\): Insufficient storage/);
  });

  test('a session answered without an upload URL is a failure', async () => {
    signsIn();
    graphFinds();

    (axios.post as jest.Mock).mockImplementation(async (url) => {
      if (url.endsWith('/createUploadSession')) { return { data: {} }; }
      return { data: { access_token: 'jwt', expires_in: 3600 } };
    });

    await expect(client.upload(SETTINGS, {
      folderPath: '',
      fileName: 'big.html',
      content: Buffer.alloc(5 * 1024 * 1024, 'x')
    })).rejects.toThrow(/without an upload URL/);
  });

  test('a chunk that is refused stops the upload with the reason', async () => {
    signsIn();
    graphFinds();

    (axios.post as jest.Mock).mockImplementation(async (url) => {
      if (url.endsWith('/createUploadSession')) {
        return { data: { uploadUrl: 'https://upload.sharepoint.com/session' } };
      }
      return { data: { access_token: 'jwt', expires_in: 3600 } };
    });
    (axios.put as jest.Mock).mockRejectedValue(httpError(416, 'Requested range not satisfiable'));

    await expect(client.upload(SETTINGS, {
      folderPath: '',
      fileName: 'big.html',
      content: Buffer.alloc(5 * 1024 * 1024, 'x')
    })).rejects.toThrow(/upload the report to SharePoint \(HTTP 416\)/);
  });

  test('retries a single-request upload with a fresh token', async () => {
    signsIn();
    graphFinds();

    let attempts = 0;
    (axios.put as jest.Mock).mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) { throw httpError(401, { error: { code: 'InvalidAuthenticationToken' } }); }
      return { data: { name: 'r.html', webUrl: 'https://acme/r.html' } };
    });

    await expect(client.upload(SETTINGS, { folderPath: '', fileName: 'r.html', content: 'x' }))
      .resolves.toMatchObject({ url: 'https://acme/r.html' });
    expect(attempts).toBe(2);
  });
});
