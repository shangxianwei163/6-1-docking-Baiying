import type { SourceSystem } from '@outbound/contracts';
import type { StudioAccountState } from '../billing/repository.js';

export type IntegrationEndpointVersion = {
  id: string;
  studioId: string;
  sourceSystem: SourceSystem;
  version: number;
  resultUrl: string;
  recordingUrl: string;
  signingSecretRef: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'DISABLED';
  effectiveAt: string | null;
  retiredAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type StudioPricingVersion = {
  id: string;
  studioId: string;
  version: number;
  voiceRate: string;
  smsRate: string;
  frozenMinutes: number;
  sourceMode: 'UNIFORM' | 'PER_STUDIO';
  status: 'SCHEDULED' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
  publishedBy: string;
  publishedAt: string;
};

export type StudioConfiguration = {
  id: string;
  businessCode: string;
  mcCode: string;
  name: string;
  contactName: string | null;
  contactPhoneMasked: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  account: StudioAccountState | null;
  endpoints: IntegrationEndpointVersion[];
  pricingVersions: StudioPricingVersion[];
};

export type SupplierPricingTier = {
  id: string;
  tierCode: string;
  name: string;
  minMonthlyMinutes: string;
  maxMonthlyMinutes: string | null;
  voiceRate: string;
  smsRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  publishedBy: string;
  publishedAt: string;
};

export type NormalizedScriptBinding = {
  id: string;
  robotDefId: string;
  studioId: string;
  sourceSystem: SourceSystem;
  userPhoneId: string;
  status: 'ACTIVE' | 'RETIRED' | 'DISABLED';
  version: number;
  categories: Array<{ sourceCategoryId: string; categoryPath: string }>;
};

export interface ConfigurationRepository {
  listStudioConfigurations(): Promise<StudioConfiguration[]>;
  findStudioByMcCode(mcCode: string): Promise<StudioConfiguration | null>;
  findActiveEndpoint(
    studioId: string,
    sourceSystem: SourceSystem,
  ): Promise<IntegrationEndpointVersion | null>;
  findCurrentPricing(
    studioId: string,
    at?: Date,
  ): Promise<StudioPricingVersion | null>;
  listSupplierPricingTiers(): Promise<SupplierPricingTier[]>;
  listNormalizedScriptBindings(
    studioId: string,
    sourceSystem: SourceSystem,
    categoryIds?: string[],
  ): Promise<NormalizedScriptBinding[]>;
}
