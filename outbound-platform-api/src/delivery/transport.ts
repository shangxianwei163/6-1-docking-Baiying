import {
  outboundCallbackEventSchema,
  outboundCallResultCallbackEnvelopeV2Schema,
  outboundCallResultLegacyV2Schema,
} from '@outbound/contracts';
import { parseCallbackTargetUrl } from './callback-url.js';
import { verifyCallbackRequestSignature } from './signature.js';

export type DeliveryHttpRequest = {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  timeoutMs: number;
};

export type DeliveryHttpResponse = {
  status: number;
  body: string;
};

export interface DeliveryTransport {
  send(request: DeliveryHttpRequest): Promise<DeliveryHttpResponse>;
}

export class HttpDeliveryTransport implements DeliveryTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;

  constructor(
    options: {
      fetchImpl?: typeof fetch;
      maxResponseBytes?: number;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? 65_536;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error('回调响应大小上限必须是正整数');
    }
  }

  async send(request: DeliveryHttpRequest): Promise<DeliveryHttpResponse> {
    const target = parseCallbackTargetUrl(request.url);
    const response = await this.fetchImpl(target, {
      method: 'POST',
      headers: request.headers,
      body: Buffer.from(request.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    return {
      status: response.status,
      body: await readLimitedResponseBody(response, this.maxResponseBytes),
    };
  }
}

export type LocalDeliveryReceipt = {
  eventId: string;
  eventType: string;
  url: string;
  timestamp: string;
  body: string;
  duplicate: boolean;
};

/**
 * A deterministic callback receiver for local verification. It never opens a
 * socket and production construction is rejected explicitly.
 */
export class LocalNoNetworkDeliveryTransport implements DeliveryTransport {
  private readonly receivedEventIds = new Set<string>();
  readonly receipts: LocalDeliveryReceipt[] = [];

  constructor(
    private readonly options: {
      environment: 'development' | 'test' | 'production';
      secretForUrl: (url: string) => Promise<Uint8Array>;
      responseForAttempt?: (
        request: DeliveryHttpRequest,
        receipt: LocalDeliveryReceipt,
      ) => DeliveryHttpResponse | Promise<DeliveryHttpResponse>;
      allowedHosts?: readonly string[];
    },
  ) {
    if (options.environment === 'production') {
      throw new Error('生产环境禁止使用本地零网络回调接收器');
    }
  }

  async send(request: DeliveryHttpRequest): Promise<DeliveryHttpResponse> {
    const url = validateLocalDestination(
      request.url,
      this.options.allowedHosts ?? ['erp.mock.invalid', 'crm.mock.invalid'],
    );
    const raw = Buffer.from(request.body).toString('utf8');
    const eventId = requiredHeader(request.headers, 'X-Platform-Event-Id');
    const contractVersion = findHeader(request.headers, 'X-Contract-Version');
    let eventType: string;
    if (contractVersion === '2.1') {
      const result = outboundCallResultCallbackEnvelopeV2Schema.parse(
        JSON.parse(raw),
      );
      if (eventId !== result.Data.event_id) {
        throw new Error('本地接收器拒绝 Header 与 Body 不一致的 eventId');
      }
      eventType = 'OUTBOUND_CALL_RESULT_V2';
    } else if (contractVersion === '2.0') {
      outboundCallResultLegacyV2Schema.parse(JSON.parse(raw));
      eventType = 'OUTBOUND_CALL_RESULT_V2';
    } else {
      const event = outboundCallbackEventSchema.parse(JSON.parse(raw));
      if (eventId !== event.eventId) {
        throw new Error('本地接收器拒绝 Header 与 Body 不一致的 eventId');
      }
      eventType = event.eventType;
    }
    const timestamp = requiredHeader(request.headers, 'X-Timestamp');
    const signature = requiredHeader(request.headers, 'X-Signature');
    if (!/^\d{13}$/.test(timestamp)) {
      throw new Error('本地接收器拒绝无效的毫秒时间戳');
    }
    const secret = await this.options.secretForUrl(url.toString());
    if (
      !verifyCallbackRequestSignature(
        { url, timestamp, eventId, rawBody: request.body },
        secret,
        signature,
      )
    ) {
      throw new Error('本地接收器拒绝无效的回调签名');
    }
    const duplicate = this.receivedEventIds.has(eventId);
    this.receivedEventIds.add(eventId);
    const receipt = {
      eventId,
      eventType,
      url: url.toString(),
      timestamp,
      body: raw,
      duplicate,
    };
    this.receipts.push(receipt);
    return (
      (await this.options.responseForAttempt?.(request, receipt)) ?? {
        status: 200,
        body: '{"code":200,"message":"success"}',
      }
    );
  }
}

function validateLocalDestination(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  const url = new URL(rawUrl);
  const normalizedHosts = new Set(
    allowedHosts.map((host) => host.trim().toLowerCase()),
  );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !normalizedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new Error('本地零网络接收器只接受允许列表中的 HTTPS 模拟地址');
  }
  return url;
}

function requiredHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string {
  const found = findHeader(headers, name);
  if (!found) throw new Error(`本地接收器缺少 ${name}`);
  return found;
}

function findHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    const chunk = Buffer.from(value.subarray(0, remaining));
    chunks.push(chunk);
    received += chunk.length;
    if (value.length > remaining) {
      await reader.cancel();
      break;
    }
  }
  if (received === maxBytes) await reader.cancel();
  return Buffer.concat(chunks).toString('utf8');
}
