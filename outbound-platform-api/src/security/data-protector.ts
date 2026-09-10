import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

export interface DataProtector {
  encryptUtf8(value: string): string;
  decryptUtf8(value: string): string;
  phoneHmac(normalizedPhone: string): string;
  correlationHmac(value: string): string;
}

export class LocalDataProtector implements DataProtector {
  private readonly encryptionKey: Buffer;
  private readonly phoneKey: Buffer;
  private readonly correlationKey: Buffer;

  constructor(
    rootSecret: string,
    environment: 'development' | 'test' | 'production',
  ) {
    if (environment === 'production') {
      throw new Error('生产环境禁止使用本地数据加密器');
    }
    if (rootSecret.length < 24)
      throw new Error('本地根密钥长度至少为 24 个字符');
    this.encryptionKey = derive(rootSecret, 'data-encryption');
    this.phoneKey = derive(rootSecret, 'phone-hmac');
    this.correlationKey = derive(rootSecret, 'correlation-hmac');
  }

  encryptUtf8(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `local:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  decryptUtf8(value: string): string {
    const [scope, version, encodedIv, encodedTag, encodedCiphertext] =
      value.split(':');
    if (scope !== 'local' || version !== 'v1' || !encodedIv || !encodedTag) {
      throw new Error('不支持的密文格式');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  phoneHmac(normalizedPhone: string): string {
    return createHmac('sha256', this.phoneKey)
      .update(normalizedPhone, 'utf8')
      .digest('hex');
  }

  correlationHmac(value: string): string {
    return createHmac('sha256', this.correlationKey)
      .update(value, 'utf8')
      .digest('hex');
  }
}

function derive(rootSecret: string, purpose: string): Buffer {
  return createHmac('sha256', rootSecret)
    .update(`outbound-platform:v1:${purpose}`)
    .digest();
}
