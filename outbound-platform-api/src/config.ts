import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  DATABASE_URL: z.string().min(1),
  CONSOLE_ORIGIN: z.url().default('http://localhost:4173'),
  BAIYING_BASE_URL: z.url().optional(),
  BAIYING_TOKEN_URL: z.url().optional(),
  BAIYING_COMPANY_ID: z.string().regex(/^\d+$/).optional(),
  BAIYING_APP_KEY: z.string().optional(),
  BAIYING_APP_SECRET: z.string().optional(),
  SX_ERP_CATEGORY_URL: z.url().default('http://testmc.6161520.cn:8083/SAi/Sx_AllCategoryLevel'),
  SX_ERP_CATEGORY_TOKEN: z.string().optional(),
  SX_ERP_CATEGORY_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(21_600_000),
  VARIABLE_SYNC_QUEUE_NAME: z.string().default('variable-sync-queue'),
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

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}

export function readBaiyingConfig(environment: NodeJS.ProcessEnv = process.env): BaiyingConfig {
  return baiyingConfigSchema.parse(environment);
}
