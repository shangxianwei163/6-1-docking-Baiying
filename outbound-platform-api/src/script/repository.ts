import type { ScriptBindingInput } from '@outbound/contracts';

export type ScriptBinding = ScriptBindingInput & {
  updatedBy: string;
  updatedAt: string;
};

export class ScriptBindingConflictError extends Error {}

export interface ScriptRepository {
  listAllBindings(): Promise<ScriptBinding[]>;
  listBindings(robotDefIds: string[]): Promise<ScriptBinding[]>;
  saveBinding(
    input: ScriptBindingInput,
    actorId: string,
    requestId: string,
  ): Promise<ScriptBinding>;
}
