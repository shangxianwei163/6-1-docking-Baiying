export type CallbackParseStatus =
  | 'PENDING'
  | 'VALID'
  | 'INVALID'
  | 'UNKNOWN_TYPE';

export type ClaimedCallback = {
  id: string;
  callbackType: string;
  eventKey: string;
  rawBodyCiphertext: string;
  rawBodySha256: string;
  processAttempts: number;
  receivedAt: string;
};

export type CallbackIngestResult = {
  id: string;
  eventKey: string;
  replayed: boolean;
};

export type CallbackFailureResult = {
  status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
  attempts: number;
  availableAt: string | null;
};

export class CallbackClaimLostError extends Error {}

export interface CallbackInboxRepository {
  save(input: {
    callbackType: string;
    eventKey: string;
    companyId: string | null;
    callJobId: string | null;
    callInstanceId: string | null;
    rawBodyCiphertext: string;
    rawBodySha256: string;
    headers: Record<string, string>;
  }): Promise<CallbackIngestResult>;
  claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    eventKey?: string;
  }): Promise<ClaimedCallback | null>;
  complete(input: { inboxId: string; workerId: string }): Promise<void>;
  reject(input: {
    inboxId: string;
    workerId: string;
    parseStatus: 'INVALID' | 'UNKNOWN_TYPE';
    error: string;
  }): Promise<void>;
  fail(input: {
    inboxId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
    parseStatus?: 'PENDING' | 'VALID';
  }): Promise<CallbackFailureResult>;
}
