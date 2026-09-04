import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import type { MappingDraftInput } from '@outbound/contracts';
import { readConfig } from '../config.js';
import { PostgresMappingRepository } from '../mapping/postgres-repository.js';
import { createDatabase } from './client.js';
import { baiyingScenes, sceneMappingReadiness } from './schema.js';

type SeedScene = {
  sceneDefId: string;
  name: string;
  companyCount: number;
  variables: string[];
  driftVariable?: string;
  stale?: boolean;
  disabled?: boolean;
};

const publishedVariables = ['婚期', '套餐意向', '门店名称', '顾问姓名', '老客权益', '客户来源', '活动名称'];
const seedScenes: SeedScene[] = [
  { sceneDefId: 'SC-202608-017', name: '婚博会回访', companyCount: 3, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源', '活动名称', '预算范围'] },
  { sceneDefId: 'SC-202608-012', name: '秋季档期触达', companyCount: 2, variables: ['婚期', '套餐意向', '门店名称', '客户来源', '活动名称', '预算范围'] },
  { sceneDefId: 'SC-202608-009', name: '到店未成交激活', companyCount: 4, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源', '礼服风格'] },
  { sceneDefId: 'SC-202608-005', name: '周年礼遇', companyCount: 3, variables: ['婚期', '门店名称', '顾问姓名', '老客权益'], driftVariable: '客户等级' },
  { sceneDefId: 'SC-202607-031', name: '七夕咨询回访', companyCount: 1, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '活动名称'], stale: true },
  { sceneDefId: 'SC-202609-021', name: '客资首次触达', companyCount: 5, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源', '活动名称'] },
  { sceneDefId: 'SC-202609-019', name: '订单确认通知', companyCount: 2, variables: ['婚期', '门店名称', '顾问姓名', '活动名称'] },
  { sceneDefId: 'SC-202608-020', name: '试妆预约提醒', companyCount: 4, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '活动名称'] },
  { sceneDefId: 'SC-202608-018', name: '档期二次确认', companyCount: 3, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源'] },
  { sceneDefId: 'SC-202608-016', name: '到店前关怀', companyCount: 2, variables: ['婚期', '门店名称', '顾问姓名', '活动名称'] },
  { sceneDefId: 'SC-202608-014', name: '选片通知', companyCount: 4, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源'] },
  { sceneDefId: 'SC-202608-011', name: '取件通知', companyCount: 4, variables: ['婚期', '门店名称', '顾问姓名', '客户来源'] },
  { sceneDefId: 'SC-202608-008', name: '生日关怀', companyCount: 3, variables: ['婚期', '门店名称', '顾问姓名', '老客权益', '活动名称'] },
  { sceneDefId: 'SC-202608-006', name: '孕妈照咨询', companyCount: 2, variables: ['婚期', '套餐意向', '门店名称', '顾问姓名', '客户来源', '活动名称'] },
  { sceneDefId: 'SC-202607-029', name: '亲子照复购', companyCount: 2, variables: ['婚期', '套餐意向', '门店名称', '老客权益', '活动名称'] },
  { sceneDefId: 'SC-202607-025', name: '周年纪念提醒', companyCount: 3, variables: ['婚期', '门店名称', '顾问姓名', '老客权益'] },
  { sceneDefId: 'SC-202607-023', name: '活动邀约', companyCount: 2, variables: ['婚期', '套餐意向', '门店名称', '客户来源', '活动名称'] },
  { sceneDefId: 'SC-202606-018', name: '历史优惠唤醒', companyCount: 1, variables: ['门店名称', '客户来源', '活动名称'], disabled: true },
];

const mappingDrafts: MappingDraftInput[] = [
  { baiyingVariableName: '婚期', erpField: 'wedding_date', crmField: 'marriage_date', transformConfig: { type: 'DATE', outputFormat: 'YYYY-MM-DD' }, emptyPolicy: 'BLOCK', defaultValue: null },
  { baiyingVariableName: '套餐意向', erpField: 'package_interest', crmField: 'interest_package', transformConfig: { type: 'ENUM', values: { A: '轻奢婚纱照', B: '高定婚纱照' } }, emptyPolicy: 'DEFAULT', defaultValue: '待确认' },
  { baiyingVariableName: '门店名称', erpField: 'store_name', crmField: 'branch_name', transformConfig: { type: 'TEXT', mode: 'TRIM' }, emptyPolicy: 'BLOCK', defaultValue: null },
  { baiyingVariableName: '顾问姓名', erpField: 'consultant_name', crmField: 'owner_name', transformConfig: { type: 'TEMPLATE', template: '{{value}}老师' }, emptyPolicy: 'DEFAULT', defaultValue: '门店顾问' },
  { baiyingVariableName: '老客权益', erpField: null, crmField: 'member_benefit', transformConfig: { type: 'TEXT', mode: 'TRIM' }, emptyPolicy: 'DEFAULT', defaultValue: '周年礼遇' },
  { baiyingVariableName: '客户来源', erpField: 'customer_source', crmField: 'lead_source', transformConfig: { type: 'TEXT', mode: 'TRIM' }, emptyPolicy: 'DEFAULT', defaultValue: '未知来源' },
  { baiyingVariableName: '活动名称', erpField: 'campaign_name', crmField: 'campaignName', transformConfig: { type: 'TEXT', mode: 'TRIM' }, emptyPolicy: 'DEFAULT', defaultValue: '日常邀约' },
];

async function seed() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') throw new Error('禁止向生产环境写入演示数据');
  const database = createDatabase(config.DATABASE_URL);
  try {
    const [existing] = await database.db.select({ count: sql<number>`count(*)::int` }).from(baiyingScenes);
    if ((existing?.count ?? 0) > 0) {
      console.info('Development seed skipped: scene data already exists.');
      return;
    }

    const repository = new PostgresMappingRepository(database.db, config.VARIABLE_SYNC_QUEUE_NAME);
    const current = new Date();
    for (const scene of seedScenes) {
      for (let index = 0; index < scene.companyCount; index += 1) {
        const variables = scene.driftVariable && index === 0 ? [...scene.variables, scene.driftVariable] : scene.variables;
        await repository.recordSuccessfulObservation({
          companyId: `COMPANY-${String(index + 1).padStart(3, '0')}`,
          robotDefId: scene.sceneDefId,
          sceneDefId: scene.sceneDefId,
          sceneName: scene.name,
          variables,
          syncedAt: new Date(current.getTime() - (scene.stale ? 26 : 0) * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    for (const draft of mappingDrafts) {
      await repository.saveDraft(draft, 'development-seed', crypto.randomUUID());
    }
    await repository.publishDrafts({ publisherId: 'development-seed', changeSummary: `初始化 ${publishedVariables.length} 条演示映射` }, crypto.randomUUID());

    const disabledScene = seedScenes.find((scene) => scene.disabled);
    if (disabledScene) {
      await database.db.update(baiyingScenes).set({ disabled: true, updatedAt: current }).where(eq(baiyingScenes.sceneDefId, disabledScene.sceneDefId));
      await database.db.update(sceneMappingReadiness).set({ status: 'DISABLED', issueSummary: '管理员已停用该场景', updatedAt: current }).where(eq(sceneMappingReadiness.sceneDefId, disabledScene.sceneDefId));
    }
    console.info(`Development seed complete: ${seedScenes.length} scenes, ${mappingDrafts.length} published mappings.`);
  } finally {
    await database.close();
  }
}

await seed();
