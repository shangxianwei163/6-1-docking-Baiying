import type { OutboundCallbackEvent } from '@outbound/contracts';

export type MaterializedDeliveryEvent = {
  id: string;
  eventId: string;
  eventKey: string;
  created: boolean;
};

export type ClaimedDeliveryEvent = {
  id: string;
  eventId: string;
  eventKey: string;
  taskId: string;
  sourceSystem: 'ERP' | 'CRM';
  target: 'RESULT' | 'RECORDING';
  eventType: string;
  targetUrl: string;
  payload: Record<string, unknown>;
  signingSecretRef: string;
  attemptCount: number;
  retryCycleAttemptCount: number;
  createdAt: string;
};

export type DeliveryFailureResult = {
  status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
  attempts: number;
  availableAt: string | null;
};

export class DeliveryClaimLostError extends Error {}
export class DeliveryMaterializationError extends Error {}

export interface DeliveryEventStore {
  materialize(event: OutboundCallbackEvent): Promise<MaterializedDeliveryEvent>;
}

export interface DeliveryRepository extends DeliveryEventStore {
  claimNext(input: {
    workerId: string;
    lockTimeoutSeconds?: number;
    deliveryEventId?: string;
  }): Promise<ClaimedDeliveryEvent | null>;
  complete(input: {
    deliveryEventId: string;
    workerId: string;
    responseStatus: number;
    responseSummary: string | null;
    requestedAt: Date;
    durationMs: number;
  }): Promise<void>;
  fail(input: {
    deliveryEventId: string;
    workerId: string;
    retryable: boolean;
    responseStatus: number | null;
    responseSummary: string | null;
    errorClass: string;
    errorMessage: string;
    requestedAt: Date;
    durationMs: number;
    retryDelayMs: number;
    maxAttempts: number;
  }): Promise<DeliveryFailureResult>;
}
