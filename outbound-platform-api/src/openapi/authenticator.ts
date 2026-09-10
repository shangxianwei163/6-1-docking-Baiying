import { eq } from 'drizzle-orm';
import type { SourceSystem } from '@outbound/contracts';
import type { Database } from '../db/client.js';
import { integrationClients } from '../db/schema.js';
import { ExternalApiFailure } from './errors.js';

export type ExternalPrincipal = {
  integrationClientId: string;
  clientId: string;
  sourceSystem: SourceSystem;
};

export type AuthenticationInput = {
  accessToken?: string;
};

export interface ExternalRequestAuthenticator {
  authenticate(input: AuthenticationInput): Promise<ExternalPrincipal>;
}

export class PostgresExternalRequestAuthenticator implements ExternalRequestAuthenticator {
  constructor(private readonly db: Database) {}

  async authenticate(input: AuthenticationInput): Promise<ExternalPrincipal> {
    const accessToken = requiredHeader(input.accessToken, 'X-Access-Token');

    const [client] = await this.db
      .select()
      .from(integrationClients)
      .where(eq(integrationClients.accessToken, accessToken))
      .limit(1);
    if (
      !client ||
      client.status !== 'ACTIVE' ||
      !isSourceSystem(client.sourceSystem)
    ) {
      throw authenticationFailed('请求 Token 无效');
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
