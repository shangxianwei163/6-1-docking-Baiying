import { hkdfSync } from 'node:crypto';

export interface SecretProvider {
  getSecretBytes(reference: string): Promise<Buffer>;
}

/**
 * Local-only deterministic secrets. Production must replace this adapter with
 * an Alibaba Cloud KMS-backed SecretProvider without changing domain logic.
 */
export class LocalDevelopmentSecretProvider implements SecretProvider {
  constructor(
    private readonly rootSecret: string,
    environment: 'development' | 'test' | 'production',
  ) {
    if (environment === 'production') {
      throw new Error('生产环境禁止使用本地派生密钥提供器');
    }
    if (rootSecret.length < 24) {
      throw new Error('本地根密钥长度至少为 24 个字符');
    }
  }

  async getSecretBytes(reference: string): Promise<Buffer> {
    const prefix = 'local-hkdf://';
    if (!reference.startsWith(prefix) || reference.length === prefix.length) {
      throw new Error(`本地密钥引用不受支持: ${reference}`);
    }
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(this.rootSecret, 'utf8'),
        Buffer.from('outbound-platform:v1', 'utf8'),
        Buffer.from(reference.slice(prefix.length), 'utf8'),
        32,
      ),
    );
  }
}

export class StaticSecretProvider implements SecretProvider {
  constructor(private readonly secrets: ReadonlyMap<string, Buffer>) {}

  async getSecretBytes(reference: string): Promise<Buffer> {
    const secret = this.secrets.get(reference);
    if (!secret) throw new Error(`密钥不存在: ${reference}`);
    return Buffer.from(secret);
  }
}
