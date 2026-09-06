import type { SourceSystem, TaskExecutionStatus } from '@outbound/contracts';
import type { BaiyingImportSummary } from '../baiying/call-job-client.js';

export type TaskOperationType =
  | 'CREATE'
  | 'IMPORT'
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'TERMINATE'
  | 'QUERY';

export type TaskOperationStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export type OrchestrationCallItem = {
  id: string;
  ordinal: number;
  phoneCiphertext: string;
  customerNameCiphertext: string | null;
  mappedPropertiesCiphertext: string;
};

export type OrchestrationTask = {
  id: string;
  taskNo: string;
  taskName: string;
  sourceSystem: SourceSystem;
  mcCode: string;
  phoneCount: number;
  baiyingCompanyId: string;
  baiyingCallJobId: string | null;
  robotDefId: string;
  userPhoneId: string;
  executionStatus: TaskExecutionStatus;
  callItems: OrchestrationCallItem[];
};

export type OperationHandle = {
  id: string;
  attemptNo: number;
};

export type TaskFailureStage =
  | 'BAIYING_CREATE'
  | 'BAIYING_IMPORT'
  | 'BAIYING_START';

export class TaskNotFoundError extends Error {}
export class TaskStateConflictError extends Error {}

export interface TaskOrchestrationRepository {
  getTask(taskId: string): Promise<OrchestrationTask | null>;
  beginOperation(input: {
    taskId: string;
    operationType: TaskOperationType;
    expectedStatuses: TaskExecutionStatus[];
    nextStatus?: TaskExecutionStatus;
    requestPayloadRedacted: Record<string, unknown>;
  }): Promise<OperationHandle>;
  finishOperation(input: {
    operationId: string;
    status: Exclude<TaskOperationStatus, 'PENDING'>;
    responsePayloadRedacted?: Record<string, unknown>;
    providerRequestId?: string;
    errorClass?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void>;
  markPendingOperationsUnknown(input: {
    taskId: string;
    operationType: TaskOperationType;
    message: string;
  }): Promise<void>;
  countOperations(
    taskId: string,
    operationType: TaskOperationType,
  ): Promise<number>;
  recordCreated(taskId: string, callJobId: string): Promise<void>;
  recordImported(taskId: string, summary: BaiyingImportSummary): Promise<void>;
  recordCalling(taskId: string): Promise<void>;
  recordFailure(input: {
    taskId: string;
    executionStatus: 'CREATE_FAILED' | 'IMPORT_FAILED' | 'START_FAILED';
    stage: TaskFailureStage;
    code: string;
    message: string;
    retryable: boolean;
    releaseHold: boolean;
    importSummary?: BaiyingImportSummary;
  }): Promise<void>;
}
