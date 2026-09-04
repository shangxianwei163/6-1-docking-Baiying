import 'dotenv/config';
import { readBaiyingConfig } from '../config.js';
import { HttpBaiyingVariableClient } from './client.js';
import { OAuthBaiyingTokenProvider } from './token-provider.js';

for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  Reflect.deleteProperty(process.env, name);
}

const config = readBaiyingConfig();
const tokenProvider = new OAuthBaiyingTokenProvider({
  tokenUrl: config.BAIYING_TOKEN_URL,
  appKey: config.BAIYING_APP_KEY,
  appSecret: config.BAIYING_APP_SECRET,
  companyId: config.BAIYING_COMPANY_ID,
});
const client = new HttpBaiyingVariableClient({
  baseUrl: config.BAIYING_BASE_URL,
  tokenProvider,
});

try {
  const companies = await client.listCompanies();
  const configuredCompany = companies.find((company) => company.companyId === config.BAIYING_COMPANY_ID);
  if (!configuredCompany) throw new Error('鉴权成功，但绑定公司列表中没有配置的 companyId');
  const robots = await client.listRobots(config.BAIYING_COMPANY_ID, 2);
  const firstRobot = robots[0];
  const variables = firstRobot
    ? await client.querySceneVariables({ companyId: config.BAIYING_COMPANY_ID, robotDefId: firstRobot.robotDefId })
    : [];
  console.info(JSON.stringify({
    authorized: true,
    configuredCompanyFound: true,
    companyCount: companies.length,
    robotCount: robots.length,
    sampleRobot: firstRobot ? {
      robotDefId: firstRobot.robotDefId,
      robotName: firstRobot.robotName,
      robotStatus: firstRobot.robotStatus,
      variableCount: variables.length,
      variables,
    } : null,
  }));
} catch (error) {
  const message = error instanceof Error ? error.message : '百应连接检查失败';
  console.error(JSON.stringify({ authorized: false, message }));
  process.exitCode = 1;
}
