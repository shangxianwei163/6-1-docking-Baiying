import 'dotenv/config';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { readConfig } from '../config.js';
import { createDatabase, type Database } from './client.js';
import {
  baiyingLineStudioBindings,
  baiyingPhoneLines,
  baiyingRobotBindings,
  baiyingSceneCompanies,
  baiyingScenes,
  integrationClients,
  integrationClientStudios,
  integrationEndpoints,
  mappingRules,
  mappingVersions,
  sceneMappingReadiness,
  sceneVariableSnapshots,
  scriptBindings,
  scriptCategoryBindings,
  sourceDataCategories,
  studios,
} from './schema.js';

const LOCAL_STUDIO_MC_CODE = 'MC-ZTY-001';
const LOCAL_LINE_ID = 'LOCAL-LINE-001';
const LOCAL_COMPANY_ID = 'LOCAL-MOCK';
const VARIABLES = ['客户称呼', '预约日期', '顾问姓名'];

const localSources = [
  {
    sourceSystem: 'ERP' as const,
    clientId: 'erp-local-01',
    categoryId: 'LOCAL-ERP-WEDDING',
    categoryPath: '本地联调/ERP/婚礼邀约',
    robotDefId: 'LOCAL-ROBOT-ERP-001',
    sceneDefId: 'LOCAL-SCENE-ERP-001',
  },
  {
    sourceSystem: 'CRM' as const,
    clientId: 'crm-local-01',
    categoryId: 'LOCAL-CRM-WEDDING',
    categoryPath: '本地联调/CRM/婚礼邀约',
    robotDefId: 'LOCAL-ROBOT-CRM-001',
    sceneDefId: 'LOCAL-SCENE-CRM-001',
  },
] as const;

export async function bootstrapStage2Local(db: Database, now = new Date()) {
  return db.transaction(async (tx) => {
    const [studio] = await tx
      .select()
      .from(studios)
      .where(eq(studios.mcCode, LOCAL_STUDIO_MC_CODE))
      .limit(1);
    if (!studio) {
      throw new Error(
        `未找到 ${LOCAL_STUDIO_MC_CODE}，请先执行 npm run db:import:phase1`,
      );
    }

    await tx
      .insert(baiyingPhoneLines)
      .values({
        userPhoneId: LOCAL_LINE_ID,
        phone: '01000000000',
        phoneName: '本地模拟线路（不发起真实呼叫）',
        phoneType: 1,
        sceneType: 1,
        rateType: 1,
        localSellingRate: 0,
        nonlocalSellingRate: 0,
        lineAmount: 0,
        billPeriod: 60,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: baiyingPhoneLines.userPhoneId,
        set: {
          phoneName: '本地模拟线路（不发起真实呼叫）',
          syncedAt: now,
        },
      });
    await tx
      .insert(baiyingLineStudioBindings)
      .values({
        userPhoneId: LOCAL_LINE_ID,
        studioId: studio.businessCode,
        studioName: studio.name,
        updatedBy: 'stage2-local-bootstrap',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          baiyingLineStudioBindings.userPhoneId,
          baiyingLineStudioBindings.studioId,
        ],
        set: {
          studioName: studio.name,
          updatedBy: 'stage2-local-bootstrap',
          updatedAt: now,
        },
      });

    const mappingVersion = await ensureLocalMappingVersion(tx, now);
    const variablesHash = createHash('sha256')
      .update(JSON.stringify([...VARIABLES].sort()), 'utf8')
      .digest('hex');

    for (const source of localSources) {
      const [client] = await tx
        .insert(integrationClients)
        .values({
          clientId: source.clientId,
          sourceSystem: source.sourceSystem,
          displayName: `${source.sourceSystem} 本地模拟客户端`,
          secretRef: `local-hkdf://${source.clientId}`,
          status: 'ACTIVE',
          rateLimitPerMinute: 120,
          createdBy: 'stage2-local-bootstrap',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: integrationClients.clientId,
          set: {
            sourceSystem: source.sourceSystem,
            displayName: `${source.sourceSystem} 本地模拟客户端`,
            secretRef: `local-hkdf://${source.clientId}`,
            status: 'ACTIVE',
            rateLimitPerMinute: 120,
            updatedAt: now,
          },
        })
        .returning();
      await tx
        .insert(integrationClientStudios)
        .values({ integrationClientId: client!.id, studioId: studio.id })
        .onConflictDoNothing();

      const [activeEndpoint] = await tx
        .select()
        .from(integrationEndpoints)
        .where(
          and(
            eq(integrationEndpoints.studioId, studio.id),
            eq(integrationEndpoints.sourceSystem, source.sourceSystem),
            eq(integrationEndpoints.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (
        activeEndpoint &&
        activeEndpoint.createdBy !== 'stage2-local-bootstrap'
      ) {
        throw new Error(
          `${source.sourceSystem} 已存在非本地模拟的 ACTIVE 端点；为避免覆盖或误用真实回调，已停止 bootstrap`,
        );
      }
      if (!activeEndpoint) {
        const versions = await tx
          .select({ version: integrationEndpoints.version })
          .from(integrationEndpoints)
          .where(
            and(
              eq(integrationEndpoints.studioId, studio.id),
              eq(integrationEndpoints.sourceSystem, source.sourceSystem),
            ),
          );
        const nextVersion =
          Math.max(0, ...versions.map((item) => item.version)) + 1;
        await tx.insert(integrationEndpoints).values({
          studioId: studio.id,
          sourceSystem: source.sourceSystem,
          version: nextVersion,
          resultUrl: `https://${source.sourceSystem.toLowerCase()}.mock.invalid/outbound/result`,
          recordingUrl: `https://${source.sourceSystem.toLowerCase()}.mock.invalid/outbound/recording`,
          signingSecretRef: `local-hkdf://callback:${source.clientId}`,
          status: 'ACTIVE',
          effectiveAt: now,
          createdBy: 'stage2-local-bootstrap',
          createdAt: now,
        });
      }

      await tx
        .insert(sourceDataCategories)
        .values({
          sourceSystem: source.sourceSystem,
          externalId: source.categoryId,
          name: '本地联调婚礼邀约',
          categoryPath: source.categoryPath,
          level: 3,
          active: true,
          fields: { fixture: 'STAGE2_LOCAL_MOCK' },
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            sourceDataCategories.sourceSystem,
            sourceDataCategories.externalId,
          ],
          set: {
            name: '本地联调婚礼邀约',
            categoryPath: source.categoryPath,
            active: true,
            fields: { fixture: 'STAGE2_LOCAL_MOCK' },
            syncedAt: now,
          },
        });

      const [existingBinding] = await tx
        .select()
        .from(scriptBindings)
        .where(
          and(
            eq(scriptBindings.robotDefId, source.robotDefId),
            eq(scriptBindings.studioId, studio.id),
            eq(scriptBindings.sourceSystem, source.sourceSystem),
            eq(scriptBindings.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const binding =
        existingBinding ??
        (
          await tx
            .insert(scriptBindings)
            .values({
              robotDefId: source.robotDefId,
              studioId: studio.id,
              sourceSystem: source.sourceSystem,
              userPhoneId: LOCAL_LINE_ID,
              status: 'ACTIVE',
              version: 1,
              createdBy: 'stage2-local-bootstrap',
              createdAt: now,
            })
            .returning()
        )[0]!;
      await tx
        .insert(scriptCategoryBindings)
        .values({
          scriptBindingId: binding.id,
          studioId: studio.id,
          sourceSystem: source.sourceSystem,
          sourceCategoryId: source.categoryId,
          categoryPath: source.categoryPath,
          active: true,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            scriptCategoryBindings.scriptBindingId,
            scriptCategoryBindings.sourceCategoryId,
          ],
          set: { categoryPath: source.categoryPath, active: true },
        });
      await tx
        .insert(baiyingRobotBindings)
        .values({
          robotDefId: source.robotDefId,
          sourceSystem: source.sourceSystem,
          sourceCategoryId: source.categoryId,
          categoryPath: source.categoryPath,
          categories: [
            {
              sourceCategoryId: source.categoryId,
              categoryPath: source.categoryPath,
            },
          ],
          studioId: studio.businessCode,
          studioName: studio.name,
          lineId: LOCAL_LINE_ID,
          lineName: '本地模拟线路（不发起真实呼叫）',
          updatedBy: 'stage2-local-bootstrap',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: baiyingRobotBindings.robotDefId,
          set: {
            categories: [
              {
                sourceCategoryId: source.categoryId,
                categoryPath: source.categoryPath,
              },
            ],
            updatedAt: now,
          },
        });

      await tx
        .insert(baiyingScenes)
        .values({
          sceneDefId: source.sceneDefId,
          robotDefId: source.robotDefId,
          sceneName: `${source.sourceSystem} 本地模拟话术`,
          disabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: baiyingScenes.sceneDefId,
          set: {
            robotDefId: source.robotDefId,
            sceneName: `${source.sourceSystem} 本地模拟话术`,
            disabled: false,
            updatedAt: now,
          },
        });
      await tx
        .insert(baiyingSceneCompanies)
        .values({
          sceneDefId: source.sceneDefId,
          companyId: LOCAL_COMPANY_ID,
          enabled: true,
          createdAt: now,
        })
        .onConflictDoNothing();
      const [snapshot] = await tx
        .select({ id: sceneVariableSnapshots.id })
        .from(sceneVariableSnapshots)
        .where(eq(sceneVariableSnapshots.sceneDefId, source.sceneDefId))
        .limit(1);
      if (!snapshot) {
        await tx.insert(sceneVariableSnapshots).values({
          companyId: LOCAL_COMPANY_ID,
          robotDefId: source.robotDefId,
          sceneDefId: source.sceneDefId,
          variables: VARIABLES,
          variablesHash,
          syncedAt: now,
          syncStatus: 'SUCCESS',
          createdAt: now,
        });
      }
      await tx
        .insert(sceneMappingReadiness)
        .values({
          sceneDefId: source.sceneDefId,
          status: 'ACTIVE',
          expectedVariablesHash: variablesHash,
          publishedMappingVersionId: mappingVersion.id,
          variables: VARIABLES,
          missingVariables: [],
          lastSuccessfulSyncAt: now,
          issueSummary: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: sceneMappingReadiness.sceneDefId,
          set: {
            status: 'ACTIVE',
            expectedVariablesHash: variablesHash,
            publishedMappingVersionId: mappingVersion.id,
            variables: VARIABLES,
            missingVariables: [],
            lastSuccessfulSyncAt: now,
            issueSummary: null,
            updatedAt: now,
          },
        });
    }

    return {
      mode: 'LOCAL-MOCK' as const,
      mcCode: studio.mcCode,
      studio: studio.name,
      lineId: LOCAL_LINE_ID,
      mappingVersion: mappingVersion.version,
      clients: localSources.map((source) => ({
        sourceSystem: source.sourceSystem,
        clientId: source.clientId,
        categoryId: source.categoryId,
      })),
    };
  });
}

async function ensureLocalMappingVersion(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  now: Date,
) {
  const marker = 'STAGE2_LOCAL_MOCK_V1';
  const [existing] = await tx
    .select()
    .from(mappingVersions)
    .where(eq(mappingVersions.changeSummary, marker))
    .limit(1);
  if (existing) return existing;
  const result = await tx.execute<{ nextVersion: number }>(sql`
    select coalesce(max(${mappingVersions.version}), 0)::int + 1 as "nextVersion"
    from ${mappingVersions}
  `);
  const [version] = await tx
    .insert(mappingVersions)
    .values({
      version: Number(result[0]!.nextVersion),
      publisherId: 'stage2-local-bootstrap',
      changeSummary: marker,
      publishedAt: now,
    })
    .returning();
  const rules = [
    {
      baiyingVariableName: '客户称呼',
      erpField: 'salutation',
      crmField: 'salutation',
      transformConfig: { type: 'TEXT' as const, mode: 'TRIM' as const },
    },
    {
      baiyingVariableName: '预约日期',
      erpField: 'appointment_date',
      crmField: 'preferred_date',
      transformConfig: {
        type: 'DATE' as const,
        outputFormat: 'YYYY年MM月DD日' as const,
      },
    },
    {
      baiyingVariableName: '顾问姓名',
      erpField: 'consultant_name',
      crmField: 'owner_name',
      transformConfig: { type: 'TEXT' as const, mode: 'TRIM' as const },
    },
  ];
  await tx.insert(mappingRules).values(
    rules.map((rule) => ({
      mappingVersionId: version!.id,
      ...rule,
      emptyPolicy: 'BLOCK' as const,
      defaultValue: null,
      status: 'PUBLISHED' as const,
      createdAt: now,
    })),
  );
  return version!;
}

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止写入 Stage 2 本地模拟配置');
  }
  const database = createDatabase(config.DATABASE_URL);
  try {
    const result = await bootstrapStage2Local(database.db);
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
