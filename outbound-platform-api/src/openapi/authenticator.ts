import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { SourceSystem } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { apiRequestNonces, integrationClients } from '../db/schema.js';
import type { SecretProvider } from '../security/secret-provider.js';
import { verifyRequestSignature } from '../security/request-signature.js';
import { ExternalApiFailure } from './errors.js';

export type ExternalPrincipal = {
  integrationClientId: string;
  clientId: string;
  sourceSystem: SourceSystem;
};

export type AuthenticationInput = {
  method: string;
  url: string;
  rawBody: Uint8Array;
  clientId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
};

export interface ExternalRequestAuthenticator {
  authenticate(input: AuthenticationInput): Promise<ExternalPrincipal>;
}

export class PostgresExternalRequestAuthenticator implements ExternalRequestAuthenticator {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretProvider,
    private readonly clock: () => Date = () => new Date(),
    private readonly timestampToleranceMs = 5 * 60 * 1000,
    private readonly nonceRetentionMs = 10 * 60 * 1000,
  ) {}

  async authenticate(input: AuthenticationInput): Promise<ExternalPrincipal> {
    const clientId = requiredHeader(input.clientId, 'X-Client-Id');
    const timestamp = requiredHeader(input.timestamp, 'X-Timestamp');
    const nonce = requiredHeader(input.nonce, 'X-Nonce');
    const signature = requiredHeader(input.signature, 'X-Signature');

    if (!/^\d{13}$/.test(timestamp)) {
      throw authenticationFailed('X-Timestamp 必须是 13 位毫秒时间戳');
    }
    if (
      nonce.length < 16 ||
      nonce.length > 128 ||
      !/^[\x21-\x7E]+$/.test(nonce)
    ) {
      throw authenticationFailed('X-Nonce 必须是 16～128 位可见 ASCII 字符');
    }

    const now = this.clock();
    const timestampMs = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampMs) ||
      Math.abs(now.getTime() - timestampMs) > this.timestampToleranceMs
    ) {
      throw authenticationFailed('请求时间戳已过期或超出允许偏差');
    }

    const [client] = await this.db
      .select()
      .from(integrationClients)
      .where(eq(integrationClients.clientId, clientId))
      .limit(1);
    if (
      !client ||
      client.status !== 'ACTIVE' ||
      !isSourceSystem(client.sourceSystem)
    ) {
      throw authenticationFailed('客户端身份无效');
    }

    let secret: Buffer;
    try {
      secret = await this.secrets.getSecretBytes(client.secretRef);
    } catch {
      throw authenticationFailed('客户端密钥不可用');
    }
    if (
      !verifyRequestSignature(
        {
          method: input.method,
          url: input.url,
          timestamp,
          nonce,
          rawBody: input.rawBody,
        },
        secret,
        signature,
      )
    ) {
      throw authenticationFailed('请求签名无效');
    }

    const rateLimited = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`external-auth:${client.id}`}, 0))`,
      );
      await tx
        .delete(apiRequestNonces)
        .where(
          and(
            eq(apiRequestNonces.integrationClientId, client.id),
            lt(apiRequestNonces.expiresAt, now),
          ),
        );
      const inserted = await tx
        .insert(apiRequestNonces)
        .values({
          integrationClientId: client.id,
          nonce,
          receivedAt: now,
          expiresAt: new Date(now.getTime() + this.nonceRetentionMs),
        })
        .onConflictDoNothing()
        .returning({ nonce: apiRequestNonces.nonce });
      if (inserted.length === 0) {
        throw new ExternalApiFailure(
          'REPLAY_DETECTED',
          '请求 Nonce 已使用，请生成新的 Nonce 后重签',
          409,
        );
      }

      const windowStart = new Date(now.getTime() - 60_000);
      const [usage] = await tx
        .select({ value: count() })
        .from(apiRequestNonces)
        .where(
          and(
            eq(apiRequestNonces.integrationClientId, client.id),
            gt(apiRequestNonces.receivedAt, windowStart),
          ),
        );
      return Number(usage?.value ?? 0) > client.rateLimitPerMinute;
    });
    if (rateLimited) {
      throw new ExternalApiFailure(
        'RATE_LIMITED',
        '客户端请求频率超过限制',
        429,
        { rateLimitPerMinute: client.rateLimitPerMinute },
      );
    }

    return {
      integrationClientId: client.id,
      clientId: client.clientId,
      sourceSystem: client.sourceSystem,
    };
  }
}

function requiredHeader(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw authenticationFailed(`缺少 ${name} 请求头`);
  return trimmed;
}

function authenticationFailed(message: string): ExternalApiFailure {
  return new ExternalApiFailure('AUTHENTICATION_FAILED', message, 401);
}

function isSourceSystem(value: string): value is SourceSystem {
  return value === 'ERP' || value === 'CRM';
}
