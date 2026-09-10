import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type {
  CreateOutboundTaskRequest,
  SourceSystem,
} from '@outbound/contracts';
import { readConfig } from '../config.js';

async function main() {
  const config = readConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行本地模拟客户端');
  }
  const sourceSystem = parseSource(process.argv[2]);
  const accessToken =
    sourceSystem === 'ERP'
      ? 'erp-local-access-token'
      : 'crm-local-access-token';
  const categoryId =
    sourceSystem === 'ERP' ? 'LOCAL-ERP-WEDDING' : 'LOCAL-CRM-WEDDING';
  const request: CreateOutboundTaskRequest = {
    schemaVersion: '1.0',
    externalRequestId: `local-${sourceSystem.toLowerCase()}-${Date.now()}`,
    sourceSystem,
    mcCode: 'MC-ZTY-001',
    customers: [
      {
        externalCustomerId: `customer-${Date.now()}`,
        name: '本地测试客户',
        phone: '13800138000',
        dataCategoryId: categoryId,
        fields:
          sourceSystem === 'ERP'
            ? {
                salutation: '王女士',
                appointment_date: '2026-09-20',
                consultant_name: '陈顾问',
              }
            : {
                salutation: '李先生',
                preferred_date: '2026-09-21',
                owner_name: '周顾问',
              },
      },
    ],
  };
  const rawBody = Buffer.from(JSON.stringify(request));
  const url = `http://localhost:${config.PORT}/openapi/v1/outbound/tasks`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-access-token': accessToken,
      'idempotency-key': randomUUID(),
      'x-request-id': randomUUID(),
    },
    body: rawBody,
  });
  console.info(`HTTP ${response.status}`);
  console.info(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}

function parseSource(value: string | undefined): SourceSystem {
  const source = value?.toUpperCase() ?? 'ERP';
  if (source !== 'ERP' && source !== 'CRM') {
    throw new Error('参数必须是 ERP 或 CRM');
  }
  return source;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
