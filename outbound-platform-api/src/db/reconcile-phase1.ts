import 'dotenv/config';
import { readConfig } from '../config.js';
import { createDatabase } from './client.js';
import { reconcilePhase1 } from './phase1-reconciliation.js';

const config = readConfig();
const database = createDatabase(config.DATABASE_URL);

try {
  const report = await reconcilePhase1(database.db);
  console.info(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await database.close();
}
