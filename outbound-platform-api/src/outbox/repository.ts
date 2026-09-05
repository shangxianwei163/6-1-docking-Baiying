export type ClaimedOutboxEvent = {
  id: string;
  eventType: string;
  queueName: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: string;
};

export type OutboxFailureResult = {
  status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
  attempts: number;
  availableAt: string | null;
};

export class OutboxClaimLostError extends Error {}

export interface OutboxRepository {
  claimNext(input: {
    queueName: string;
    eventType: string;
    workerId: string;
    lockTimeoutSeconds?: number;
  }): Promise<ClaimedOutboxEvent | null>;
  complete(eventId: string, workerId: string): Promise<void>;
  fail(input: {
    eventId: string;
    workerId: string;
    error: string;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<OutboxFailureResult>;
}
