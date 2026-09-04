import { describe, expect, it, vi } from 'vitest';
import type { BaiyingLineClient, BaiyingRobotClient, BaiyingWorkflowClient } from '../baiying/client.js';
import type { LineRepository } from '../line/repository.js';
import type { MappingRepository } from '../mapping/repository.js';
import type { PlannedTaskRepository } from '../planned-task/repository.js';
import type { ScriptRepository } from '../script/repository.js';
import { createApp } from './app.js';

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

function createPlannedTaskDependencies() {
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
  const plannedTaskRepository: PlannedTaskRepository = {
    listBindings: vi.fn(async () => [binding]),
    saveBinding,
    listSourceCategories: vi.fn(async () => []),
    syncSourceCategories: vi.fn(async () => []),
  };
  return { workflowClient, plannedTaskRepository, listWorkflows, saveBinding };
}

function createScriptDependencies() {
  const binding = {
    robotDefId: '4845020',
    sourceSystem: 'ERP' as const,
    sourceCategoryId: 'SS1',
    categoryPath: '邀约-百天-SS1',
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

  it('saves data category, studio and line in one script binding', async () => {
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
        sourceCategoryId: 'SS1',
        categoryPath: '邀约-百天-SS1',
        studioId: 'YL-001',
        studioName: '紫藤影像',
        lineId: 'LINE-01',
        lineName: '华东主线路',
      }),
    });
    expect(response.status).toBe(201);
    expect(scripts.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      categoryPath: '邀约-百天-SS1', studioId: 'YL-001', lineId: 'LINE-01',
    }), 'admin-1', fixedId);
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
