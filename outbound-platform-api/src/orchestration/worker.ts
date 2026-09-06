import { z } from 'zod';
import type { OutboxRepository } from '../outbox/repository.js';
import type { TaskOrchestrationService } from './service.js';

const taskAcceptedPayloadSchema = z.object({
  schemaVersion: z.literal('1.0'),
  taskId: z.uuid(),
  taskNo: z.string().min(1),
  sourceSystem: z.enum(['ERP', 'CRM']),
});

export type TaskWorkerRunResult =
  | { status: 'IDLE' }
  | {
      status: 'COMPLETED';
      eventId: string;
      taskId: string;
      executionStatus: string;
    }
  | {
      status: 'RETRY_SCHEDULED' | 'DEAD_LETTERED';
      eventId: string;
      taskId: string | null;
      attempts: number;
      error: string;
    };

export class TaskOrchestrationWorker {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly orchestration: TaskOrchestrationService,
    private readonly options: {
      queueName: string;
      workerId: string;
      maxAttempts?: number;
    },
  ) {}

  async runOnce(): Promise<TaskWorkerRunResult> {
    const event = await this.outbox.claimNext({
      queueName: this.options.queueName,
      eventType: 'TASK_ACCEPTED',
      workerId: this.options.workerId,
    });
    if (!event) return { status: 'IDLE' };

    let taskId: string | null = null;
    try {
      const payload = taskAcceptedPayloadSchema.parse(event.payload);
      taskId = payload.taskId;
      const result = await this.orchestration.run(payload.taskId);
      await this.outbox.complete(event.id, this.options.workerId);
      return {
        status: 'COMPLETED',
        eventId: event.id,
        taskId: payload.taskId,
        executionStatus: result.executionStatus,
      };
    } catch (error) {
      let message = errorMessage(error);
      const configuredMaxAttempts = this.options.maxAttempts ?? 8;
      let maxAttempts = error instanceof z.ZodError ? 1 : configuredMaxAttempts;
      if (taskId && event.attempts >= configuredMaxAttempts) {
        try {
          await this.orchestration.handleRetriesExhausted(taskId, message);
        } catch (terminalError) {
          message = `${message}；写入终态失败：${errorMessage(terminalError)}`;
          // 终态和资金处理未可靠提交时，多保留一次消息机会，不能先形成孤立死信。
          maxAttempts = event.attempts + 1;
        }
      }
      const failure = await this.outbox.fail({
        eventId: event.id,
        workerId: this.options.workerId,
        error: message.slice(0, 2_000),
        retryDelayMs: retryDelayForAttempt(event.attempts),
        maxAttempts,
      });
      return {
        status: failure.status,
        eventId: event.id,
        taskId,
        attempts: failure.attempts,
        error: message,
      };
    }
  }
}

export function retryDelayForAttempt(attempt: number): number {
  const delays = [5_000, 30_000, 120_000, 600_000, 1_800_000];
  return delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]!;
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `TASK_ACCEPTED 事件格式无效：${error.issues.map((item) => item.message).join('；')}`;
  }
  return error instanceof Error ? error.message : '任务编排失败';
}
