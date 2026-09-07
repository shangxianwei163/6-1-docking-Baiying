import { describe, expect, it, vi } from 'vitest';
import type {
  ConsoleTaskPage,
  ConsoleTaskRecord,
  OutboundCallPage,
} from '@outbound/contracts';
import type { MappingRepository } from '../mapping/repository.js';
import { ExternalApiFailure } from '../openapi/errors.js';
import type { OutboundTaskService } from '../outbound-task/service.js';
import { createApp } from './app.js';

const task: ConsoleTaskRecord = {
  taskId: 'cf9806bb-2166-43b0-8fdc-c7bb48115880',
  taskNo: 'PT-20260906-00001',
  externalRequestId: 'erp-order-001',
  sourceSystem: 'ERP',
  mcCode: 'MC-ZTY-001',
  studioId: 'YL-202609-0004',
  studioName: '紫藤影像',
  taskName: '本地闭环验证',
  phoneCount: 1,
  dataCategories: [{ id: 'LOCAL-ERP-WEDDING', path: '本地联调/ERP/婚礼邀约' }],
  script: { robotDefId: 'LOCAL-ROBOT-ERP-001', name: '本地联调话术' },
  line: { userPhoneId: 'LOCAL-LINE-001', name: '本地模拟线路' },
  mapping: {
    version: 1,
    variableCount: 3,
    variables: ['客户称呼', '预约日期', '顾问姓名'],
  },
  baiyingCallJobId: 'LOCAL-JOB-001',
  providerStatus: { code: 1, description: '进行中' },
  statuses: {
    execution: 'CALLING',
    display: '呼叫中',
    resultDelivery: 'PENDING',
    recordingArchive: 'PENDING',
    recordingDelivery: 'PENDING',
    billing: 'RESERVED',
  },
  importSummary: { requested: 1, succeeded: 1, failed: 0, repeated: 0 },
  counts: {
    imported: 1,
    callInstances: 0,
    recordingsDiscovered: 0,
    recordingsArchived: 0,
    recordingsDelivered: 0,
  },
  durations: { totalSeconds: 0, billingMinutes: 0 },
  billing: {
    currency: 'CNY',
    customerRate: '0.480000',
    frozenMinutes: 2,
    reservedAmount: '0.960000',
    customerCharge: '0.000000',
    platformRate: null,
    platformRateStatus: 'NOT_AVAILABLE',
    platformCost: null,
    profit: null,
    studioBalance: '10000.000000',
    availableBalance: '9999.040000',
    status: 'RESERVED',
  },
  failure: null,
  timestamps: {
    createdAt: '2026-09-06T02:00:00.000Z',
    acceptedAt: '2026-09-06T02:00:00.000Z',
    startedAt: '2026-09-06T02:00:01.000Z',
    providerCompletedAt: null,
    reconciledAt: null,
    closedAt: null,
  },
  callbacks: {
    resultUrl: 'https://erp.mock.invalid/outbound/result',
    recordingUrl: 'https://erp.mock.invalid/outbound/recording',
  },
  actions: {
    commands: ['PAUSE', 'TERMINATE'],
    retry: { available: false, blockedReason: null },
  },
};

const page: ConsoleTaskPage = {
  total: 1,
  pages: 1,
  pageNum: 0,
  pageSize: 20,
  statusCounts: {
    all: 1,
    running: 0,
    calling: 1,
    completed: 0,
    failed: 0,
  },
  tasks: [task],
};

const calls: OutboundCallPage = { items: [], nextCursor: null };

function setup() {
  const listConsoleTasks = vi.fn(async () => page);
  const getConsoleTask = vi.fn(async () => task);
  const listConsoleCalls = vi.fn(async () => calls);
  const taskService = {
    accept: vi.fn(),
    getTask: vi.fn(),
    listCalls: vi.fn(),
    listConsoleTasks,
    getConsoleTask,
    listConsoleCalls,
  } as unknown as OutboundTaskService;
  const app = createApp({
    mappingRepository: {} as MappingRepository,
    consoleOrigin: 'http://localhost:4173',
    workerSharedSecret: 'test-worker-secret-at-least-24',
    outboundTaskService: taskService,
    createId: () => 'request-console-001',
  });
  return { app, listConsoleTasks, getConsoleTask, listConsoleCalls };
}

describe('operator outbound task HTTP API', () => {
  it('returns a filtered real-task page to an identified operator', async () => {
    const { app, listConsoleTasks } = setup();
    const response = await app.request(
      '/api/v1/outbound-tasks?keyword=%E6%9C%AC%E5%9C%B0&status=CALLING&createdFrom=2026-09-05T16%3A00%3A00.000Z&createdBefore=2026-09-06T16%3A00%3A00.000Z&pageNum=0&pageSize=20',
      { headers: { 'x-actor-id': 'platform-admin' } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestId: 'request-console-001',
      data: page,
    });
    expect(listConsoleTasks).toHaveBeenCalledWith({
      keyword: '本地',
      status: 'CALLING',
      createdFrom: new Date('2026-09-05T16:00:00.000Z'),
      createdBefore: new Date('2026-09-06T16:00:00.000Z'),
      pageNum: 0,
      pageSize: 20,
    });
  });

  it('requires the operator identity header', async () => {
    const { app, listConsoleTasks } = setup();
    const response = await app.request('/api/v1/outbound-tasks');
    expect(response.status).toBe(401);
    expect(listConsoleTasks).not.toHaveBeenCalled();
  });

  it('serves task details and masked call pages', async () => {
    const { app, getConsoleTask, listConsoleCalls } = setup();
    const headers = { 'x-actor-id': 'platform-admin' };
    const detailResponse = await app.request(
      '/api/v1/outbound-tasks/PT-20260906-00001',
      { headers },
    );
    const callResponse = await app.request(
      '/api/v1/outbound-tasks/PT-20260906-00001/calls?limit=50',
      { headers },
    );

    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { task: { taskNo: task.taskNo } },
    });
    expect(callResponse.status).toBe(200);
    await expect(callResponse.json()).resolves.toEqual({
      requestId: 'request-console-001',
      data: calls,
    });
    expect(getConsoleTask).toHaveBeenCalledWith(task.taskNo);
    expect(listConsoleCalls).toHaveBeenCalledWith(task.taskNo, { limit: 50 });
  });

  it('keeps service errors in the admin error envelope', async () => {
    const { app, getConsoleTask } = setup();
    getConsoleTask.mockRejectedValueOnce(
      new ExternalApiFailure('TASK_NOT_FOUND', '任务不存在', 404),
    );
    const response = await app.request(
      '/api/v1/outbound-tasks/PT-20260906-99999',
      { headers: { 'x-actor-id': 'platform-admin' } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'TASK_NOT_FOUND',
        message: '任务不存在',
        requestId: 'request-console-001',
      },
    });
  });
});
