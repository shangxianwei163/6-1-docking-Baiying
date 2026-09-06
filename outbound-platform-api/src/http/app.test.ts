import { describe, expect, it, vi } from 'vitest';
import type { BaiyingLineClient, BaiyingRobotClient, BaiyingWorkflowClient } from '../baiying/client.js';
import type { LineRepository } from '../line/repository.js';
import type { MappingRepository } from '../mapping/repository.js';
import type { PlannedTaskRepository, SourceDataCategory } from '../planned-task/repository.js';
import type { ScriptRepository } from '../script/repository.js';
import { calculateBillingMinutes, createApp } from './app.js';

function createRepository() {
  const saveDraft = vi.fn(async (input, actorId) => ({
    ...input,
    changeType: 'UPSERT' as const,
    removalReason: null,
    updatedBy: actorId,
    updatedAt: '2026-09-03T02:00:00.000Z',
  }));
  const enqueueVariableSync = vi.fn(async () => undefined);
  const repository: MappingRepository = {
    variableExistsInLatestSnapshot: vi.fn(async () => true),
    saveDraft,
    stageRemoval: vi.fn(),
    listDrafts: vi.fn(async () => []),
    listPublishedRules: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    publishDrafts: vi.fn(),
    recordSuccessfulObservation: vi.fn(),
    listSceneReadiness: vi.fn(async () => []),
    enqueueVariableSync,
  };
  return { repository, saveDraft, enqueueVariableSync };
}

const fixedId = '5f9ad46d-d4a7-4cbc-b388-f505b6141724';

function createPlannedTaskDependencies(categories: SourceDataCategory[] = []) {
  const binding = {
    workflowId: '115315720',
    sourceSystem: 'ERP' as const,
    sourceCategoryId: 'SS1',
    categoryPath: '邀约-百天-SS1',
    updatedBy: 'admin-1',
    updatedAt: '2026-09-03T14:00:00.000Z',
  };
  const listWorkflows = vi.fn<BaiyingWorkflowClient['listWorkflows']>(async () => ({
      total: 1,
      pages: 1,
      pageNum: 0,
      pageSize: 20,
      workflows: [{
        id: '115315720',
        name: '非常六加一-百天-0528-测试',
        workflowExecuteStatus: 'FINISH' as const,
        workflowType: 'OUT_TRIGGER',
        startTime: '2026-05-28 09:57:32',
        endTime: '2099-01-01 00:00:01',
      }],
    }));
  const workflowClient: BaiyingWorkflowClient = { listWorkflows };
  const saveBinding = vi.fn<PlannedTaskRepository['saveBinding']>(async (input, actorId) => ({ ...input, updatedBy: actorId, updatedAt: binding.updatedAt }));
  const syncSourceCategories = vi.fn<PlannedTaskRepository['syncSourceCategories']>(async () => []);
  const listSourceCategories = vi.fn<PlannedTaskRepository['listSourceCategories']>(async () => categories);
  const plannedTaskRepository: PlannedTaskRepository = {
    listBindings: vi.fn(async () => [binding]),
    saveBinding,
    listSourceCategories,
    syncSourceCategories,
  };
  return { workflowClient, plannedTaskRepository, listWorkflows, saveBinding, listSourceCategories, syncSourceCategories };
}

function createScriptDependencies() {
  const binding = {
    robotDefId: '4845020',
    sourceSystem: 'ERP' as const,
    categories: [
      { sourceCategoryId: 'SS1', categoryPath: '邀约-百天-SS1' },
      { sourceCategoryId: 'SS2', categoryPath: '邀约-百天-SS2' },
    ],
    studioId: 'YL-001',
    studioName: '紫藤影像',
    lineId: 'LINE-01',
    lineName: '华东主线路',
    updatedBy: 'admin-1',
    updatedAt: '2026-09-04T02:00:00.000Z',
  };
  const listRobots = vi.fn<BaiyingRobotClient['listRobots']>(async () => [{
    robotDefId: '4845020',
    robotName: '开放平台演示话术',
    robotStatus: 5,
    industryOneName: '大金融',
    industryTwoName: '银行',
    deployTime: '2026-07-24 15:04:38',
  }]);
  const robotClient: BaiyingRobotClient = { listRobots };
  const saveBinding = vi.fn<ScriptRepository['saveBinding']>(async (input, actorId) => ({ ...input, updatedBy: actorId, updatedAt: binding.updatedAt }));
  const scriptRepository: ScriptRepository = {
    listAllBindings: vi.fn(async () => [binding]),
    listBindings: vi.fn(async () => [binding]),
    saveBinding,
  };
  return { robotClient, scriptRepository, listRobots, saveBinding };
}

function createLineDependencies() {
  const sourceLine = {
    userPhoneId: '1788320',
    phone: '测试专用线路',
    phoneName: '华东测试线路',
    phoneType: 9,
    sceneType: 1,
    rateType: 0,
    localSellingRate: 0,
    nonlocalSellingRate: 0,
    lineAmount: 2,
    billPeriod: 60,
  };
  const listPhones = vi.fn<BaiyingLineClient['listPhones']>(async () => [sourceLine]);
  const lineClient: BaiyingLineClient = { listPhones };
  const binding = {
    userPhoneId: '1788320',
    studioId: 'YL-001',
    studioName: '紫藤影像',
    updatedBy: 'admin-1',
    updatedAt: '2026-09-04T02:00:00.000Z',
  };
  const saveBindings = vi.fn<LineRepository['saveBindings']>(async (input, actorId) => input.studios.map((studio) => ({
    userPhoneId: input.userPhoneId,
    ...studio,
    updatedBy: actorId,
    updatedAt: binding.updatedAt,
  })));
  const replaceManagedLines = vi.fn<LineRepository['replaceManagedLines']>(async (lines) => lines.map((line) => ({
    ...line,
    syncedAt: '2026-09-04T02:00:00.000Z',
  })));
  const listManagedLines = vi.fn<LineRepository['listManagedLines']>(async () => [{
    ...sourceLine,
    syncedAt: '2026-09-04T02:00:00.000Z',
  }]);
  const lineRepository: LineRepository = {
    replaceManagedLines,
    listManagedLines,
    listBindings: vi.fn(async () => [binding]),
    saveBindings,
  };
  return { lineClient, lineRepository, listPhones, replaceManagedLines, listManagedLines, saveBindings };
}

describe('mapping API', () => {
  it.each([
    [0, 0],
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
  ])('rounds a %i-second callback duration to %i billing minute(s)', (durationSeconds, expectedMinutes) => {
    expect(calculateBillingMinutes(durationSeconds)).toBe(expectedMinutes);
  });

  it('persists a Baiying callback before returning the required acknowledgement', async () => {
    const ingest = vi.fn(async () => ({
      id: fixedId,
      eventKey: 'event-key',
      replayed: false,
      callbackType: 'CALL_INSTANCE_RESULT',
    }));
    const app = createApp({
      mappingRepository: createRepository().repository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      baiyingCallbackIngress: { ingest },
    });
    const callback = {
      code: 200,
      data: {
        data: {
          callInstance: {
            callJobId: 4849944,
            callInstanceId: 70258002706,
            callInstanceStatus: 2,
            finishStatus: 0,
            customerTelephone: '13646710000',
            robotDefId: 286485,
            duration: 24,
            luyinOssUrl: 'https://example.com/full.mp3',
          },
          phoneLogs: [],
          taskResult: [],
          callRepeat: [],
          jobPhoneInfos: [],
        },
        callbackType: 'CALL_INSTANCE_RESULT',
      },
      resultMsg: '成功',
    };

    const response = await app.request('/api/v1/callbacks/baiying/call-instance', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify(callback),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: 200 });
    expect(ingest).toHaveBeenCalledWith({
      rawBody: JSON.stringify(callback),
      headers: expect.any(Headers),
    });
  });

  it('uses the unified route for job callbacks and ACKs a persisted duplicate', async () => {
    const ingest = vi.fn(async () => ({
      id: fixedId,
      eventKey: 'event-key',
      replayed: true,
      callbackType: 'JOB_INFO_RESULT',
    }));
    const app = createApp({
      mappingRepository: createRepository().repository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      baiyingCallbackIngress: { ingest },
    });
    const rawBody = JSON.stringify({
      code: 200,
      data: {
        data: { companyId: 1, callJobId: 2, callJobStatus: 2 },
        callbackType: 'JOB_INFO_RESULT',
      },
      resultMsg: '成功',
    });
    const response = await app.request('/api/v1/callbacks/baiying', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotent-Replayed')).toBe('true');
    await expect(response.json()).resolves.toEqual({ code: 200 });
    expect(ingest).toHaveBeenCalledWith({
      rawBody,
      headers: expect.any(Headers),
    });
  });

  it('saves a direct ERP/CRM draft', async () => {
    const { repository, saveDraft } = createRepository();
    const app = createApp({
      mappingRepository: repository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });
    const response = await app.request('/api/v1/mappings/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-1' },
      body: JSON.stringify({
        baiyingVariableName: '预算范围',
        erpField: 'budget_range',
        crmField: 'budget',
        transformConfig: { type: 'TEXT', mode: 'TRIM' },
        emptyPolicy: 'BLOCK',
        defaultValue: null,
      }),
    });
    expect(response.status).toBe(201);
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ baiyingVariableName: '预算范围' }), 'admin-1', fixedId);
  });

  it('queues an asynchronous Baiying variable sync', async () => {
    const { repository, enqueueVariableSync } = createRepository();
    const app = createApp({
      mappingRepository: repository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      clock: () => new Date('2026-09-03T02:00:00.000Z'),
    });
    const response = await app.request('/api/v1/variable-sync-jobs', {
      method: 'POST',
      headers: { 'x-actor-id': 'admin-1' },
    });
    expect(response.status).toBe(202);
    expect(enqueueVariableSync).toHaveBeenCalledWith({
      jobId: fixedId,
      requestedAt: '2026-09-03T02:00:00.000Z',
      requestedBy: 'admin-1',
    });
  });

  it('protects the worker-only observation endpoint', async () => {
    const app = createApp({
      mappingRepository: createRepository().repository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });
    const response = await app.request('/api/v1/internal/scene-variable-observations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observations: [] }),
    });
    expect(response.status).toBe(401);
  });

  it('returns Baiying workflows with platform category bindings', async () => {
    const planned = createPlannedTaskDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...planned,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/planned-tasks?pageNum=0&pageSize=20&status=ALL');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.tasks[0]).toMatchObject({
      id: '115315720',
      categoryBinding: { sourceSystem: 'ERP', categoryPath: '邀约-百天-SS1' },
    });
    expect(planned.listWorkflows).toHaveBeenCalledWith(expect.objectContaining({ workflowExecuteStatus: 'ALL' }));
  });

  it('saves a planned task category binding with the current actor', async () => {
    const planned = createPlannedTaskDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...planned,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });
    const response = await app.request('/api/v1/planned-task-category-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-1' },
      body: JSON.stringify({ workflowId: '115315720', sourceSystem: 'ERP', sourceCategoryId: 'SS1', categoryPath: '邀约-百天-SS1' }),
    });
    expect(response.status).toBe(201);
    expect(planned.saveBinding).toHaveBeenCalledWith(expect.objectContaining({ categoryPath: '邀约-百天-SS1' }), 'admin-1', fixedId);
  });

  it('returns Baiying scripts with the fields and platform binding used by cards', async () => {
    const scripts = createScriptDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...scripts,
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/scripts?robotStatus=2&pageNum=0&pageSize=20');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.scripts[0]).toMatchObject({
      robotDefId: '4845020',
      robotStatus: 5,
      industryOneName: '大金融',
      binding: { studioName: '紫藤影像', lineName: '华东主线路' },
    });
    expect(scripts.listRobots).toHaveBeenCalledWith('263120', 2);
  });

  it('aggregates Baiying account balances and seat overview without coupling section failures', async () => {
    const accountClient = {
      getCommunicationBalance: vi.fn(async () => ({ amount: 2680.45 })),
      getAiBalance: vi.fn(async () => { throw new Error('AI 余额接口超时'); }),
      getSeatOverview: vi.fn(async () => ({
        companyUsingCallSeat: 3,
        companyCallSeatDetail: { valid: 4 },
        companyAllCallSeat: 5,
        callSeatList: [],
      })),
    };
    const app = createApp({
      mappingRepository: createRepository().repository,
      accountClient,
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/baiying/account-overview');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        communicationBalance: { status: 'success', data: { amount: 2680.45 } },
        aiBalance: { status: 'error', message: 'AI 余额接口超时' },
        seatOverview: { status: 'success', data: { companyAllCallSeat: 5 } },
      },
    });
  });

  it('saves multiple data categories, studio and line in one script binding', async () => {
    const scripts = createScriptDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...scripts,
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });
    const response = await app.request('/api/v1/script-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-1' },
      body: JSON.stringify({
        robotDefId: '4845020',
        sourceSystem: 'ERP',
        categories: [
          { sourceCategoryId: 'SS1', categoryPath: '邀约-百天-SS1' },
          { sourceCategoryId: 'SS2', categoryPath: '邀约-百天-SS2' },
        ],
        studioId: 'YL-001',
        studioName: '紫藤影像',
        lineId: 'LINE-01',
        lineName: '华东主线路',
      }),
    });
    expect(response.status).toBe(201);
    expect(scripts.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      categories: [
        { sourceCategoryId: 'SS1', categoryPath: '邀约-百天-SS1' },
        { sourceCategoryId: 'SS2', categoryPath: '邀约-百天-SS2' },
      ],
      studioId: 'YL-001', lineId: 'LINE-01',
    }), 'admin-1', fixedId);
  });

  it('returns cached ERP categories with the scripts bound for the selected studio', async () => {
    const scripts = createScriptDependencies();
    const planned = createPlannedTaskDependencies([{
      sourceSystem: 'ERP',
      externalId: 'SS1',
      name: '百天邀约',
      categoryPath: '邀约-百天-SS1',
      level: 3,
      parentId: 'BT',
      active: true,
      fields: { CategoryID: 'SS1', CategoryName: '百天邀约' },
      syncedAt: '2026-09-04T02:00:00.000Z',
    }]);
    const sync = vi.fn(async () => ({ sourceSystem: 'ERP' as const, count: 1, syncedAt: '2026-09-04T02:00:00.000Z' }));
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...scripts,
      plannedTaskRepository: planned.plannedTaskRepository,
      erpCategorySyncService: { sync },
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
      clock: () => new Date('2026-09-04T02:00:00.000Z'),
    });

    const response = await app.request('/api/v1/data-categories?sourceSystem=ERP&studioId=YL-001');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.categories[0]).toMatchObject({
      externalId: 'SS1',
      categoryPath: '邀约-百天-SS1',
      boundScripts: [{ robotDefId: '4845020', robotName: '开放平台演示话术' }],
    });
    expect(planned.listSourceCategories).toHaveBeenCalledWith('ERP');
    expect(sync).not.toHaveBeenCalled();
    expect(planned.syncSourceCategories).not.toHaveBeenCalled();

    const allStudiosResponse = await app.request('/api/v1/data-categories?sourceSystem=ERP');
    expect(allStudiosResponse.status).toBe(200);
    await expect(allStudiosResponse.json()).resolves.toMatchObject({
      data: {
        studioId: null,
        categories: [{ boundScripts: [{ robotDefId: '4845020' }] }],
      },
    });
  });

  it('runs ERP synchronization only through the dedicated command endpoint', async () => {
    const planned = createPlannedTaskDependencies();
    const sync = vi.fn(async () => ({ sourceSystem: 'ERP' as const, count: 469, syncedAt: '2026-09-04T02:00:00.000Z' }));
    const app = createApp({
      mappingRepository: createRepository().repository,
      plannedTaskRepository: planned.plannedTaskRepository,
      erpCategorySyncService: { sync },
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/data-categories/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-1' },
      body: JSON.stringify({ sourceSystem: 'ERP' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { sourceSystem: 'ERP', count: 469 } });
    expect(sync).toHaveBeenCalledOnce();
  });

  it('returns Baiying phone lines with all platform studio bindings', async () => {
    const lines = createLineDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...lines,
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/lines');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.lines[0]).toMatchObject({
      userPhoneId: '1788320', phoneName: '华东测试线路', studios: [{ studioName: '紫藤影像' }],
    });
    expect(lines.listPhones).toHaveBeenCalledWith('263120');
    expect(lines.replaceManagedLines).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ userPhoneId: '1788320' }),
    ]));
  });

  it('returns platform-managed lines without calling Baiying again', async () => {
    const lines = createLineDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      lineRepository: lines.lineRepository,
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/managed-lines');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.lines[0]).toMatchObject({
      userPhoneId: '1788320', phoneName: '华东测试线路', studios: [{ studioName: '紫藤影像' }],
    });
    expect(lines.listManagedLines).toHaveBeenCalledOnce();
    expect(lines.listPhones).not.toHaveBeenCalled();
  });

  it('replaces the multi-studio binding for one phone line', async () => {
    const lines = createLineDependencies();
    const app = createApp({
      mappingRepository: createRepository().repository,
      ...lines,
      baiyingCompanyId: '263120',
      consoleOrigin: 'http://localhost:4173',
      workerSharedSecret: 'a-worker-secret-longer-than-24-characters',
      createId: () => fixedId,
    });

    const response = await app.request('/api/v1/line-studio-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-1' },
      body: JSON.stringify({
        userPhoneId: '1788320',
        studios: [
          { studioId: 'YL-001', studioName: '紫藤影像' },
          { studioId: 'YL-002', studioName: '远山摄影' },
        ],
      }),
    });
    expect(response.status).toBe(201);
    expect(lines.saveBindings).toHaveBeenCalledWith(expect.objectContaining({
      studios: expect.arrayContaining([
        expect.objectContaining({ studioId: 'YL-001' }),
        expect.objectContaining({ studioId: 'YL-002' }),
      ]),
    }), 'admin-1', fixedId);
  });
});
