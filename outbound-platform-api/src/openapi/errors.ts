import type { ExternalApiErrorCode } from '@outbound/contracts';

export type ExternalHttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 422
  | 429
  | 503;

export class ExternalApiFailure extends Error {
  constructor(
    public readonly code: ExternalApiErrorCode,
    message: string,
    public readonly status: ExternalHttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExternalApiFailure';
  }
}

export function externalFailure(
  code: ExternalApiErrorCode,
  message: string,
  status: ExternalHttpStatus,
  details?: Record<string, unknown>,
): never {
  throw new ExternalApiFailure(code, message, status, details);
}
