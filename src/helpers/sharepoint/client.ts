import axios from 'axios';

/**
 * Raw access to SharePoint through the Microsoft Graph API.
 *
 * The integration authenticates as an application (the OAuth2 client
 * credentials grant), not as a person: an app registration in Entra ID with
 * the `Sites.ReadWrite.All` application permission, granted admin consent.
 * That is what lets a headless CLI run upload its report without anybody
 * being at the keyboard.
 *
 * Only the access token is cached here -- it lives about an hour and is
 * expensive to obtain. Site and drive identifiers are resolved per upload,
 * which is one cheap request each and keeps a renamed library from silently
 * uploading into the wrong place.
 */

const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

// SharePoint is an external service: never let a hung request block a run
const TIMEOUT = 30000;

// Graph accepts a simple PUT up to 4 MB; anything above goes through an
// upload session
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

// Chunks of an upload session must be a multiple of 320 KiB
const CHUNK_SIZE = 320 * 1024 * 10;

/** The token of the last authenticated app, kept while it is valid. */
let token: { id: string; expiresAt: number; promise: Promise<string> } | null = null;

/**
 * Forget the cached access token.
 */
const resetToken = () => { token = null; };

export { resetToken };

/**
 * Turn an axios error into a message worth showing in the UI.
 * @param {Error} error
 * @param {string} what - What was being done, e.g. "sign in to SharePoint"
 * @returns {Error}
 */
const describeError = (error, what) => {
  const response = error && error.response;

  if (response) {
    const body = response.data;
    let detail;

    if (typeof body === 'string') {
      detail = body.slice(0, 200);
    }
    else if (body && body.error) {
      // Graph answers { error: { code, message } }, the login endpoint
      // { error, error_description }
      detail = body.error.message || body.error_description || body.error.code || body.error;
    }
    else if (body && body.error_description) {
      detail = body.error_description;
    }

    const suffix = detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '';
    return new Error(`Could not ${what} (HTTP ${response.status})${suffix}`);
  }

  return new Error(`Could not ${what}: ${(error && error.message) || String(error)}`);
};

export { describeError };

/**
 * Identity of an app registration, so a token is never reused for different
 * credentials.
 * @param {Object} settings
 * @returns {string}
 */
const credentialsId = (settings) => [settings.tenantId, settings.clientId, settings.clientSecret].join('|');

/**
 * An access token for the Graph API, reusing the cached one while it lasts.
 *
 * The token is stored as a promise, so concurrent callers share a single
 * authentication request.
 *
 * @param {Object} settings - Full SharePoint settings
 * @param {boolean} [force] - Ignore the cached token (used after a 401)
 * @returns {Promise<string>}
 */
const authenticate = (settings, force = false) => {
  const id = credentialsId(settings);

  if (!force && token && token.id === id && token.expiresAt > Date.now()) {
    return token.promise;
  }

  const body = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const promise = axios
    .post(
      `${LOGIN_HOST}/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`,
      body.toString(),
      { timeout: TIMEOUT, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    .then(response => {
      const access = response.data && response.data.access_token;

      if (!access) {
        throw new Error('SharePoint answered without an access token');
      }

      // Renew a minute early rather than discover the expiry mid-upload
      const seconds = Number(response.data.expires_in) || 3600;
      if (token && token.id === id) { token.expiresAt = Date.now() + (seconds - 60) * 1000; }

      return String(access);
    })
    .catch(error => {
      // A failed authentication must not be cached
      if (token && token.id === id) { token = null; }
      throw describeError(error, 'sign in to SharePoint');
    });

  token = { id, expiresAt: Date.now() + 60000, promise };

  return promise;
};

export { authenticate };

/**
 * A GET against Graph, retried once with a fresh token when the cached one
 * has been revoked.
 *
 * @param {Object} settings
 * @param {string} url - Absolute Graph URL
 * @param {string} what - What is being done, for the error message
 * @returns {Promise<Object>} The response body
 */
const get = async (settings, url, what) => {
  const call = async (force) => {
    const jwt = await authenticate(settings, force);
    const response = await axios.get(url, {
      timeout: TIMEOUT,
      headers: { Authorization: `Bearer ${jwt}` }
    });
    return response.data;
  };

  try {
    return await call(false);
  }
  catch (error) {
    if (error && error.response && error.response.status === 401) {
      try {
        return await call(true);
      }
      catch (retry) {
        throw describeError(retry, what);
      }
    }
    throw error.response ? describeError(error, what) : error;
  }
};

/**
 * Split a SharePoint site URL into what Graph addresses a site by.
 *
 * https://acme.sharepoint.com/sites/QA  ->  { host, path: '/sites/QA' }
 * https://acme.sharepoint.com           ->  { host, path: '' }
 *
 * @param {string} siteUrl
 * @returns {{host: string, path: string}}
 */
const parseSiteUrl = (siteUrl) => {
  let url;

  try {
    url = new URL(String(siteUrl || ''));
  }
  catch {
    throw new Error(`"${siteUrl}" is not a SharePoint site URL`);
  }

  if (!/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error(`"${siteUrl}" is not a SharePoint site URL`);
  }

  // The library and the folder are configured separately: a URL pasted from
  // the browser keeps only the site part
  const path = url.pathname.replace(/\/+$/, '');

  return { host: url.hostname, path: path === '/' ? '' : path };
};

export { parseSiteUrl };

/**
 * The site the settings point at.
 * @param {Object} settings
 * @returns {Promise<Object>} { id, displayName, webUrl }
 */
const resolveSite = async (settings) => {
  const { host, path } = parseSiteUrl(settings.siteUrl);

  // Graph addresses a site as {hostname}:{server-relative path}, and the
  // root site of the tenant as the hostname alone
  const address = path ? `${host}:${path.split('/').map(encodeURIComponent).join('/')}` : host;

  return get(settings, `${GRAPH}/sites/${address}`, `find the site ${settings.siteUrl}`);
};

export { resolveSite };

/**
 * The document library to upload into: the one named in the settings, or the
 * site's default one ("Documents") when no name was given.
 *
 * @param {Object} settings
 * @param {string} siteId
 * @returns {Promise<Object>} { id, name, webUrl }
 */
const resolveDrive = async (settings, siteId) => {
  if (!settings.libraryName) {
    return get(settings, `${GRAPH}/sites/${siteId}/drive`, 'find the site’s default document library');
  }

  const body = await get(settings, `${GRAPH}/sites/${siteId}/drives`, 'list the site’s document libraries');
  const drives = (body && body.value) || [];

  const wanted = settings.libraryName.toLowerCase();
  const drive = drives.find(candidate => String(candidate.name || '').toLowerCase() === wanted);

  if (!drive) {
    const names = drives.map(candidate => candidate.name).filter(Boolean).join(', ');
    throw new Error(
      `The site has no document library called "${settings.libraryName}"` +
      (names ? `. It has: ${names}` : '')
    );
  }

  return drive;
};

export { resolveDrive };

/**
 * A folder path as a Graph item address: each segment encoded, empty
 * segments dropped.
 * @param {string} folderPath
 * @returns {string} '' for the root of the library
 */
const encodePath = (folderPath) => String(folderPath || '')
  .replace(/\\/g, '/')
  .split('/')
  .map(part => part.trim())
  .filter(part => part && part !== '.')
  .map(encodeURIComponent)
  .join('/');

export { encodePath };

/**
 * Upload a file in a single request. Graph creates the missing folders of
 * the path on the way.
 *
 * @param {Object} settings
 * @param {string} driveId
 * @param {string} itemPath - Encoded path of the file inside the library
 * @param {Buffer} content
 * @param {string} contentType
 * @returns {Promise<Object>} The driveItem Graph answers with
 */
const putContent = async (settings, driveId, itemPath, content, contentType) => {
  const call = async (force) => {
    const jwt = await authenticate(settings, force);
    const response = await axios.put(
      `${GRAPH}/drives/${driveId}/root:/${itemPath}:/content?@microsoft.graph.conflictBehavior=replace`,
      content,
      {
        timeout: TIMEOUT,
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': contentType },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );
    return response.data;
  };

  try {
    return await call(false);
  }
  catch (error) {
    if (error && error.response && error.response.status === 401) {
      return call(true).catch(retry => { throw describeError(retry, 'upload the report to SharePoint'); });
    }
    throw describeError(error, 'upload the report to SharePoint');
  }
};

/**
 * Upload a file through an upload session, in chunks. Used for anything Graph
 * will not take in one request.
 *
 * @param {Object} settings
 * @param {string} driveId
 * @param {string} itemPath - Encoded path of the file inside the library
 * @param {Buffer} content
 * @returns {Promise<Object>} The driveItem Graph answers with
 */
const putInChunks = async (settings, driveId, itemPath, content) => {
  const jwt = await authenticate(settings);

  let session;
  try {
    const response = await axios.post(
      `${GRAPH}/drives/${driveId}/root:/${itemPath}:/createUploadSession`,
      { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
      { timeout: TIMEOUT, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } }
    );
    session = response.data;
  }
  catch (error) {
    throw describeError(error, 'start the upload to SharePoint');
  }

  if (!session || !session.uploadUrl) {
    throw new Error('SharePoint answered without an upload URL');
  }

  let uploaded;

  for (let start = 0; start < content.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, content.length);
    const chunk = content.subarray(start, end);

    try {
      // The upload URL carries its own authorization: sending the token too
      // is what makes Graph reject the chunk
      const response = await axios.put(session.uploadUrl, chunk, {
        timeout: TIMEOUT,
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end - 1}/${content.length}`
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      uploaded = response.data;
    }
    catch (error) {
      throw describeError(error, 'upload the report to SharePoint');
    }
  }

  return uploaded;
};

/**
 * Put one file into a document library, creating the folders it needs.
 *
 * @param {Object} settings - Full SharePoint settings
 * @param {Object} options
 * @param {string} options.folderPath - Folder inside the library ('' for its root)
 * @param {string} options.fileName
 * @param {Buffer|string} options.content
 * @param {string} [options.contentType]
 * @returns {Promise<Object>} { name, path, url, size, library, site }
 */
const upload = async (settings, { folderPath, fileName, content, contentType = 'text/html' }) => {
  const site = await resolveSite(settings);
  const drive = await resolveDrive(settings, site.id);

  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');

  const folder = encodePath(folderPath);
  const itemPath = [folder, encodeURIComponent(fileName)].filter(Boolean).join('/');

  const item = body.length > SIMPLE_UPLOAD_MAX
    ? await putInChunks(settings, drive.id, itemPath, body)
    : await putContent(settings, drive.id, itemPath, body, contentType);

  return {
    name: (item && item.name) || fileName,
    path: [decodeURIComponent(folder), fileName].filter(Boolean).join('/'),
    url: (item && item.webUrl) || null,
    size: (item && item.size) || body.length,
    library: drive.name,
    site: site.displayName || site.name || settings.siteUrl
  };
};

export { upload };

/**
 * Check the credentials for real: sign in, find the site and find the
 * library the reports would land in.
 *
 * @param {Object} settings - Full SharePoint settings
 * @returns {Promise<Object>} { message, site, library }
 */
const verify = async (settings) => {
  const site = await resolveSite(settings);
  const drive = await resolveDrive(settings, site.id);

  const name = site.displayName || site.name || settings.siteUrl;

  return {
    message: `Connected to "${name}", uploading into the "${drive.name}" library.`,
    site: name,
    library: drive.name,
    webUrl: drive.webUrl || site.webUrl || null
  };
};

export { verify };
