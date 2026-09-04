import type { PlannedTaskBindingInput, SourceCategoryObservation, SourceSystem } from '@outbound/contracts';

export type PlannedTaskCategoryBinding = PlannedTaskBindingInput & {
  updatedBy: string;
  updatedAt: string;
};

export type SourceDataCategory = SourceCategoryObservation & {
  syncedAt: string;
};

export interface PlannedTaskRepository {
  listBindings(workflowIds: string[]): Promise<PlannedTaskCategoryBinding[]>;
  saveBinding(input: PlannedTaskBindingInput, actorId: string, requestId: string): Promise<PlannedTaskCategoryBinding>;
  listSourceCategories(sourceSystem?: SourceSystem): Promise<SourceDataCategory[]>;
  syncSourceCategories(observations: SourceCategoryObservation[]): Promise<SourceDataCategory[]>;
}
