import { constants, createHash, publicEncrypt } from 'node:crypto';
import https from 'node:https';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function toPem(compactPublicKey) {
  const body = compactPublicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function encrypt(value, publicKey) {
  return publicEncrypt(
    {
      key: toPem(publicKey),
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(value),
  ).toString('base64');
}

function parseJson(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned a non-JSON response`);
  }
}

export class BaotaClient {
  constructor({ panelUrl, username, password }) {
    const parsedUrl = new URL(panelUrl);
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('BAOTA_PANEL_URL must use HTTPS');
    }
    if (!parsedUrl.pathname.endsWith('/')) parsedUrl.pathname += '/';

    this.entranceUrl = parsedUrl;
    this.origin = parsedUrl.origin;
    this.username = username;
    this.password = password;
    this.cookies = new Map();
    this.requestToken = '';
  }

  async request(urlOrPath, options = {}, redirectsRemaining = 5) {
    const url = new URL(urlOrPath, this.origin);
    const body = options.body ?? null;
    const headers = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'User-Agent': USER_AGENT,
      ...options.headers,
    };

    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);

    const response = await new Promise((resolveResponse, rejectResponse) => {
      const request = https.request(
        url,
        {
          method: options.method ?? 'GET',
          headers,
          rejectUnauthorized: false,
          timeout: options.timeoutMs ?? 15_000,
        },
        (incoming) => {
          const chunks = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.on('end', () => {
            resolveResponse({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      request.once('timeout', () =>
        request.destroy(new Error('request timed out')),
      );
      request.once('error', rejectResponse);
      if (body !== null) request.write(body);
      request.end();
    });

    for (const setCookie of response.headers['set-cookie'] ?? []) {
      const [pair] = setCookie.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.location &&
      redirectsRemaining > 0
    ) {
      return this.request(
        new URL(response.headers.location, url),
        { headers: options.headers },
        redirectsRemaining - 1,
      );
    }

    return response;
  }

  async postForm(path, fields, label) {
    const body = new URLSearchParams(fields).toString();
    const response = await this.request(path, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: this.entranceUrl.href,
        ...(this.requestToken ? { 'x-http-token': this.requestToken } : {}),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${label} failed with HTTP ${response.status}`);
    }
    return parseJson(response.body, label);
  }

  async login() {
    const loginPage = await this.request(this.entranceUrl);
    if (loginPage.status !== 200) {
      throw new Error(`Baota login page returned HTTP ${loginPage.status}`);
    }

    const loginToken = loginPage.body.match(
      /vite_public_login_token\s*=\s*'([^']+)'/,
    )?.[1];
    const publicKey = loginPage.body.match(
      /vite_public_encryption\s*=\s*'([^']+)'/,
    )?.[1];
    if (!loginToken || !publicKey) {
      throw new Error('Could not read the Baota login token or public key');
    }

    const result = await this.postForm(
      '/login',
      {
        username: encrypt(md5(md5(`${this.username}${loginToken}`)), publicKey),
        password: encrypt(md5(`${md5(this.password)}_bt.cn`), publicKey),
        safe_mode: '1',
      },
      'Baota login',
    );
    if (!result?.status) {
      throw new Error(`Baota login failed: ${result?.msg ?? 'unknown error'}`);
    }

    const panelPage = await this.request(this.entranceUrl);
    const requestToken = panelPage.body.match(
      /vite_public_request_token\s*=\s*['"]([^'"]+)['"]/,
    )?.[1];
    if (!requestToken) {
      throw new Error('Could not read the Baota request token after login');
    }
    this.requestToken = requestToken;
  }

  async getNodeProjects() {
    const response = await this.postForm(
      '/project/nodejs/get_project_list',
      {
        data: JSON.stringify({ p: 1, limit: 100, search: '' }),
      },
      'Baota project list',
    );
    return response;
  }

  async restartNodeProject(projectName) {
    const response = await this.postForm(
      '/mod/nodejs/com/set_project_status',
      {
        project_name: projectName,
        project_type: 'nodejs',
        status: 'restart',
      },
      'Baota project restart',
    );
    if (!response?.status) {
      throw new Error(
        `Baota restart failed: ${response?.msg ?? 'unknown error'}`,
      );
    }
    return response;
  }
}
