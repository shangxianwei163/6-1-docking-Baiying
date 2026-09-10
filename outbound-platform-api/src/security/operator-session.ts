import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type OperatorIdentity = {
  username: string;
  displayName: string;
  organization: string;
};

type SessionPayload = OperatorIdentity & {
  version: 1;
  sessionId: string;
  expiresAt: number;
};

export type OperatorSessionServiceOptions = OperatorIdentity & {
  password: string;
  secret: string;
  ttlSeconds?: number;
  clock?: () => Date;
};

export class OperatorSessionService {
  readonly ttlSeconds: number;
  private readonly clock: () => Date;

  constructor(private readonly options: OperatorSessionServiceOptions) {
    this.ttlSeconds = options.ttlSeconds ?? 12 * 60 * 60;
    this.clock = options.clock ?? (() => new Date());
  }

  authenticate(username: string, password: string): OperatorIdentity | null {
    if (
      !safeCredentialEqual(
        username,
        this.options.username,
        this.options.secret,
      ) ||
      !safeCredentialEqual(password, this.options.password, this.options.secret)
    ) {
      return null;
    }
    return this.identity();
  }

  issue(identity: OperatorIdentity): string {
    const payload: SessionPayload = {
      version: 1,
      ...identity,
      sessionId: randomUUID(),
      expiresAt: Math.floor(this.clock().getTime() / 1000) + this.ttlSeconds,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  verify(token: string | undefined): OperatorIdentity | null {
    if (!token) return null;
    const [encodedPayload, providedSignature, extra] = token.split('.');
    if (!encodedPayload || !providedSignature || extra) return null;

    const expectedSignature = this.sign(encodedPayload);
    if (!safeTextEqual(providedSignature, expectedSignature)) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<SessionPayload>;
      if (
        payload.version !== 1 ||
        payload.username !== this.options.username ||
        payload.displayName !== this.options.displayName ||
        payload.organization !== this.options.organization ||
        typeof payload.sessionId !== 'string' ||
        payload.sessionId.length === 0 ||
        typeof payload.expiresAt !== 'number' ||
        payload.expiresAt <= Math.floor(this.clock().getTime() / 1000)
      ) {
        return null;
      }
      return this.identity();
    } catch {
      return null;
    }
  }

  private identity(): OperatorIdentity {
    return {
      username: this.options.username,
      displayName: this.options.displayName,
      organization: this.options.organization,
    };
  }

  private sign(value: string): string {
    return createHmac('sha256', this.options.secret)
      .update(value)
      .digest('base64url');
  }
}

function safeCredentialEqual(
  provided: string,
  expected: string,
  secret: string,
): boolean {
  const providedDigest = createHmac('sha256', secret)
    .update(`credential:${provided}`)
    .digest();
  const expectedDigest = createHmac('sha256', secret)
    .update(`credential:${expected}`)
    .digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function safeTextEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}
