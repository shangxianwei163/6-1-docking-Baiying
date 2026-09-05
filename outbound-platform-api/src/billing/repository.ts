export type StudioAccountState = {
  studioId: string;
  currency: 'CNY';
  balance: string;
  activeHoldAmount: string;
  availableBalance: string;
  status: 'ACTIVE' | 'LOW_BALANCE' | 'OVERDUE' | 'DISABLED';
  lockVersion: number;
  updatedAt: string;
};

export type FundHold = {
  id: string;
  studioId: string;
  taskId: string;
  originalAmount: string;
  remainingAmount: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
  createdAt: string;
  releasedAt: string | null;
};

export type AccountLedgerEntry = {
  id: string;
  studioId: string;
  taskId: string | null;
  callInstanceId: string | null;
  entryType:
    | 'TOP_UP'
    | 'TASK_HOLD'
    | 'TASK_HOLD_RELEASE'
    | 'CALL_CHARGE'
    | 'OVERAGE_DEBIT'
    | 'REFUND'
    | 'ADJUSTMENT';
  amount: string;
  balanceAfter: string;
  availableBalanceAfter: string;
  businessKey: string;
  operatorId: string | null;
  reason: string | null;
  occurredAt: string;
};

export type ReservationResult = {
  account: StudioAccountState;
  hold: FundHold;
  ledger: AccountLedgerEntry;
};

export class AccountNotFoundError extends Error {}
export class AccountUnavailableError extends Error {}
export class InsufficientBalanceError extends Error {}
export class FundHoldConflictError extends Error {}
export class LedgerIdempotencyConflictError extends Error {}

export interface AccountRepository {
  getAccount(studioId: string): Promise<StudioAccountState | null>;
  listLedger(studioId: string, limit?: number): Promise<AccountLedgerEntry[]>;
  topUp(input: {
    studioId: string;
    amount: string;
    businessKey: string;
    operatorId: string;
    reason: string;
  }): Promise<{ account: StudioAccountState; ledger: AccountLedgerEntry }>;
  reserveFunds(input: {
    studioId: string;
    taskId: string;
    amount: string;
    operatorId: string;
  }): Promise<ReservationResult>;
  releaseHold(input: {
    taskId: string;
    operatorId: string;
    reason: string;
  }): Promise<ReservationResult>;
}
