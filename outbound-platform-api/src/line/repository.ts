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
  syncedAt: string;
};

export interface LineRepository {
  replaceManagedLines(lines: Omit<ManagedLine, 'syncedAt'>[]): Promise<ManagedLine[]>;
  listManagedLines(): Promise<ManagedLine[]>;
  listBindings(userPhoneIds: string[]): Promise<LineStudioBinding[]>;
  saveBindings(input: LineStudioBindingInput, actorId: string, requestId: string): Promise<LineStudioBinding[]>;
}
