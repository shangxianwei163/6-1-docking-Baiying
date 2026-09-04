import type {
  MappingDraftInput,
  MappingRule,
  MappingVersion,
  PublishMappingInput,
  RemoveMappingDraftInput,
  SceneReadiness,
  SyncSceneObservation,
} from '@outbound/contracts';

export type StoredDraft = {
  baiyingVariableName: string;
  erpField: string | null;
  crmField: string | null;
  transformConfig: MappingDraftInput['transformConfig'] | null;
  emptyPolicy: MappingDraftInput['emptyPolicy'] | null;
  defaultValue: string | null;
  changeType: 'UPSERT' | 'REMOVE';
  removalReason: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type PublishResult = {
  version: MappingVersion;
  rules: MappingRule[];
};

export interface MappingRepository {
  variableExistsInLatestSnapshot(variableName: string): Promise<boolean>;
  saveDraft(input: MappingDraftInput, actorId: string, requestId: string): Promise<StoredDraft>;
  stageRemoval(input: RemoveMappingDraftInput, actorId: string, requestId: string): Promise<StoredDraft>;
  listDrafts(): Promise<StoredDraft[]>;
  listPublishedRules(): Promise<MappingRule[]>;
  listVersions(): Promise<MappingVersion[]>;
  publishDrafts(input: PublishMappingInput, requestId: string): Promise<PublishResult>;
  recordSuccessfulObservation(input: SyncSceneObservation): Promise<SceneReadiness>;
  listSceneReadiness(): Promise<SceneReadiness[]>;
  enqueueVariableSync(input: { jobId: string; requestedAt: string; requestedBy: string }): Promise<void>;
}

export class MappingNotFoundError extends Error {}
export class MappingConflictError extends Error {}
