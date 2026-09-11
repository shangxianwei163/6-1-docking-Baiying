import { z } from 'zod';

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8788),
    DATABASE_URL: z.string().min(1),
    CONSOLE_ORIGIN: z.url().default('http://localhost:4173'),
    BAIYING_BASE_URL: z.url().optional(),
    BAIYING_TOKEN_URL: z.url().optional(),
    BAIYING_COMPANY_ID: z.string().regex(/^\d+$/).optional(),
    BAIYING_APP_KEY: z.string().optional(),
    BAIYING_APP_SECRET: z.string().optional(),
    BAIYING_WRITE_ENABLED: z.preprocess(
      (value) => value === true || value === 'true',
      z.boolean(),
    ),
    BAIYING_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(10_000),
    SX_ERP_CATEGORY_URL: z
      .url()
      .default('http://testmc.6161520.cn:8083/SAi/Sx_AllCategoryLevel'),
    SX_ERP_CATEGORY_TOKEN: z.string().optional(),
    SX_ERP_CATEGORY_SYNC_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(21_600_000),
    VARIABLE_SYNC_QUEUE_NAME: z.string().default('variable-sync-queue'),
    TASK_ORCHESTRATION_QUEUE_NAME: z
      .string()
      .default('task-orchestration-queue'),
    CALLBACK_DELIVERY_QUEUE_NAME: z.string().default('callback-delivery-queue'),
    RECONCILIATION_WORKER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(5_000),
    RECONCILIATION_STALE_TASK_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(300_000),
    RECONCILIATION_MANUAL_REVIEW_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(900_000),
    RECORDING_LOCAL_ROOT: z.string().min(1).default('.local-recordings'),
    RECORDING_STORAGE_DRIVER: z.enum(['local', 'oss']).default('local'),
    RECORDING_LOCAL_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .default('local-recordings'),
    OSS_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .optional(),
    OSS_ENDPOINT: z.string().refine(isSafeOssEndpoint).optional(),
    OSS_REGION: z
      .string()
      .regex(/^oss-[a-z0-9-]+$/)
      .optional(),
    OSS_ECS_RAM_ROLE_NAME: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
      .optional(),
    RECORDING_PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:8788'),
    RECORDING_CALLBACK_BASE_URL: z
      .url()
      .default('https://recordings.mock.invalid'),
    RECORDING_SOURCE_ALLOWED_HOSTS: z.string().default(''),
    RECORDING_DOWNLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3_600)
      .default(900),
    RECORDING_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_073_741_824)
      .default(104_857_600),
    RECORDING_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_650)
      .default(180),
    CONSOLE_ADMIN_USERNAME: z.string().min(1).default('fc6j1'),
    CONSOLE_ADMIN_PASSWORD: z.string().min(8).default('fc6j18888'),
    WORKER_SHARED_SECRET: z.string().min(24),
  })
  .superRefine((config, context) => {
    if (config.RECORDING_STORAGE_DRIVER !== 'oss') return;
    for (const key of [
      'OSS_BUCKET',
      'OSS_ENDPOINT',
      'OSS_REGION',
      'OSS_ECS_RAM_ROLE_NAME',
    ] as const) {
      if (!config[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `使用 OSS 录音存储时必须配置 ${key}`,
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

const baiyingConfigSchema = z.object({
  BAIYING_BASE_URL: z.url(),
  BAIYING_TOKEN_URL: z.url(),
  BAIYING_COMPANY_ID: z.string().regex(/^\d+$/),
  BAIYING_APP_KEY: z.string().min(1),
  BAIYING_APP_SECRET: z.string().min(1),
});

export type BaiyingConfig = z.infer<typeof baiyingConfigSchema>;

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}

export function readBaiyingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BaiyingConfig {
  return baiyingConfigSchema.parse(environment);
}

function isSafeOssEndpoint(value: string): boolean {
  const normalized = value.startsWith('https://') ? value : `https://${value}`;
  try {
    const endpoint = new URL(normalized);
    return (
      endpoint.protocol === 'https:' &&
      !endpoint.username &&
      !endpoint.password &&
      endpoint.pathname === '/' &&
      !endpoint.search &&
      !endpoint.hash &&
      endpoint.hostname.endsWith('.aliyuncs.com')
    );
  } catch {
    return false;
  }
}
