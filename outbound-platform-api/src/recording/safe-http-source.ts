import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { OpenedRecordingSource, RecordingSource } from './source.js';

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type RecordingHttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  discard(): void;
};

export interface RecordingHttpTransport {
  request(
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
  ): Promise<RecordingHttpResponse>;
}

export class RecordingSourceSecurityError extends Error {}
export class RecordingSourceHttpError extends Error {}

export class SecureHttpRecordingSource implements RecordingSource {
  private readonly allowedHosts: ReadonlySet<string>;

  constructor(
    allowedHosts: readonly string[],
    private readonly options: {
      resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
      transport?: RecordingHttpTransport;
      maxRedirects?: number;
      timeoutMs?: number;
    } = {},
  ) {
    const normalized = allowedHosts.map(normalizeAllowedHost);
    if (!normalized.length) {
      throw new TypeError('真实录音下载必须配置非空域名允许列表');
    }
    this.allowedHosts = new Set(normalized);
  }

  async open(sourceUrl: string): Promise<OpenedRecordingSource> {
    const resolver = this.options.resolver ?? resolveAddresses;
    const transport = this.options.transport ?? new NodePinnedHttpsTransport();
    const maxRedirects = this.options.maxRedirects ?? 3;
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    let current = parseRecordingUrl(sourceUrl, this.allowedHosts);

    for (let redirects = 0; ; redirects += 1) {
      const addresses = await resolver(current.hostname);
      assertPublicAddresses(addresses);
      const response = await transport.request(
        current,
        addresses[0]!,
        timeoutMs,
      );
      if (isRedirect(response.status)) {
        const location = firstHeader(response.headers.location);
        response.discard();
        if (!location) {
          throw new RecordingSourceHttpError('录音下载重定向缺少 Location');
        }
        if (redirects >= maxRedirects) {
          throw new RecordingSourceSecurityError('录音下载重定向次数超过上限');
        }
        current = parseRecordingUrl(
          new URL(location, current).toString(),
          this.allowedHosts,
        );
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.discard();
        throw new RecordingSourceHttpError(
          `录音源返回非成功状态 ${response.status}`,
        );
      }
      return {
        body: response.body,
        contentType: firstHeader(response.headers['content-type']) ?? '',
        contentLength: parseContentLength(response.headers['content-length']),
      };
    }
  }
}

export class NodePinnedHttpsTransport implements RecordingHttpTransport {
  request(
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
  ): Promise<RecordingHttpResponse> {
    return new Promise((resolve, reject) => {
      let response: IncomingMessage | undefined;
      const request = httpsRequest(
        url,
        {
          method: 'GET',
          agent: false,
          family: address.family,
          servername: url.hostname,
          headers: {
            accept: 'audio/*, application/octet-stream;q=0.5',
            'user-agent': 'outbound-platform-recording-worker/1.0',
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, address.address, address.family);
          },
        },
        (incoming) => {
          response = incoming;
          const body = withTotalTimeout(incoming, request, timeoutMs);
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
            discard() {
              incoming.resume();
              incoming.destroy();
            },
          });
        },
      );
      request.once('error', (error) => {
        if (!response)
          reject(new RecordingSourceHttpError(safeNetworkMessage(error)));
      });
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error('timeout'));
        if (!response) {
          reject(new RecordingSourceHttpError('录音源连接或首字节超时'));
        }
      });
      request.end();
    });
  }
}

export function parseRecordingUrl(
  rawUrl: string,
  allowedHosts: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RecordingSourceSecurityError('录音地址不是有效 URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:') {
    throw new RecordingSourceSecurityError('录音地址只允许 HTTPS');
  }
  if (url.username || url.password) {
    throw new RecordingSourceSecurityError('录音地址不能包含用户凭证');
  }
  if (url.port && url.port !== '443') {
    throw new RecordingSourceSecurityError('录音地址只允许 HTTPS 标准端口');
  }
  if (isIP(hostname)) {
    throw new RecordingSourceSecurityError('录音地址必须使用允许列表中的域名');
  }
  if (!allowedHosts.has(hostname)) {
    throw new RecordingSourceSecurityError('录音地址域名不在允许列表中');
  }
  if (rawUrl.length > 4_096) {
    throw new RecordingSourceSecurityError('录音地址长度超过上限');
  }
  url.hostname = hostname;
  return url;
}

export function assertPublicAddresses(addresses: readonly ResolvedAddress[]) {
  if (!addresses.length) {
    throw new RecordingSourceSecurityError('录音域名没有可用 DNS 地址');
  }
  for (const item of addresses) {
    if (isIP(item.address) !== item.family) {
      throw new RecordingSourceSecurityError('录音域名解析结果无效');
    }
    const blocked =
      item.family === 4
        ? NON_PUBLIC_IPV4.check(item.address, 'ipv4')
        : NON_PUBLIC_IPV6.check(item.address, 'ipv6');
    if (blocked) {
      throw new RecordingSourceSecurityError(
        '录音域名解析到了禁止访问的网络地址',
      );
    }
  }
}

async function resolveAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, order: 'verbatim' });
  return addresses.map((item) => ({
    address: item.address,
    family: item.family === 6 ? 6 : 4,
  }));
}

async function* withTotalTimeout(
  response: IncomingMessage,
  request: ReturnType<typeof httpsRequest>,
  timeoutMs: number,
) {
  const timer = setTimeout(() => {
    request.destroy(new Error('recording download timeout'));
  }, timeoutMs);
  try {
    for await (const chunk of response) {
      yield chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
    }
  } catch (error) {
    throw new RecordingSourceHttpError(safeNetworkMessage(error));
  } finally {
    clearTimeout(timer);
  }
}

function safeNetworkMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String(error.code)
      : undefined;
  return code ? `录音源网络请求失败（${code}）` : '录音源网络请求失败或超时';
}

function parseContentLength(
  value: string | string[] | undefined,
): number | null {
  const header = firstHeader(value);
  if (header === undefined) return null;
  if (!/^\d+$/.test(header)) {
    throw new RecordingSourceHttpError('录音源 Content-Length 无效');
  }
  const size = Number(header);
  if (!Number.isSafeInteger(size)) {
    throw new RecordingSourceHttpError('录音源 Content-Length 超出安全范围');
  }
  return size;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function normalizeAllowedHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  const dnsName =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!dnsName.test(host) || isIP(host)) {
    throw new TypeError(`无效的录音域名允许项：${value}`);
  }
  return host;
}

const NON_PUBLIC_IPV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4');
}
const NON_PUBLIC_IPV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
] as const) {
  NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6');
}
