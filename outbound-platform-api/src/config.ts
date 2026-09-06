import { z } from 'zod';

const configSchema = z.object({
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
  TASK_ORCHESTRATION_QUEUE_NAME: z.string().default('task-orchestration-queue'),
  CALLBACK_DELIVERY_QUEUE_NAME: z.string().default('callback-delivery-queue'),
  RECORDING_LOCAL_ROOT: z.string().min(1).default('.local-recordings'),
  RECORDING_LOCAL_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
    .default('local-recordings'),
  RECORDING_PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:8788'),
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
  WORKER_SHARED_SECRET: z.string().min(24),
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
