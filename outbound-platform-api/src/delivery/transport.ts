import { outboundCallbackEventSchema } from '@outbound/contracts';
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
    const event = outboundCallbackEventSchema.parse(JSON.parse(raw));
    const eventId = requiredHeader(request.headers, 'X-Platform-Event-Id');
    const timestamp = requiredHeader(request.headers, 'X-Timestamp');
    const signature = requiredHeader(request.headers, 'X-Signature');
    if (eventId !== event.eventId) {
      throw new Error('本地接收器拒绝 Header 与 Body 不一致的 eventId');
    }
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
      eventType: event.eventType,
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
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  if (!found) throw new Error(`本地接收器缺少 ${name}`);
  return found;
}
