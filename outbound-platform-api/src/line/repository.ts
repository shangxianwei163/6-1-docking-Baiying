import type { LineStudioBindingInput } from '@outbound/contracts';

export type LineStudioBinding = {
  userPhoneId: string;
  studioId: string;
  studioName: string;
  updatedBy: string;
  updatedAt: string;
};

export type ManagedLine = {
  userPhoneId: string;
  phone: string;
  phoneName: string;
  phoneType: number;
  sceneType: number;
  rateType: number;
  localSellingRate: number;
  nonlocalSellingRate: number;
  lineAmount: number;
  billPeriod: number;
  isActive: boolean;
  syncedAt: string;
};

export type LineSyncErrorCode = 'LINE_SYNC_CONFLICT' | 'LINE_SYNC_UNAVAILABLE';

export class LineSyncFailure extends Error {
  readonly name = 'LineSyncFailure';

  constructor(
    readonly code: LineSyncErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LineBindingConflictError extends Error {}

export interface LineRepository {
  synchronizeManagedLines(
    lines: Omit<ManagedLine, 'isActive' | 'syncedAt'>[],
  ): Promise<ManagedLine[]>;
  listManagedLines(): Promise<ManagedLine[]>;
  listBindings(userPhoneIds: string[]): Promise<LineStudioBinding[]>;
  saveBindings(
    input: LineStudioBindingInput,
    actorId: string,
    requestId: string,
  ): Promise<LineStudioBinding[]>;
}
