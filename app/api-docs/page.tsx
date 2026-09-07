import type { Metadata } from 'next';
import { ApiDocumentation } from '@/components/platform/api-documentation';

export const metadata: Metadata = {
  title: '外部集成 API · 公开接口文档',
  description: 'ERP、CRM、百应与外呼调度平台之间的标准接口文档。',
};

export default function PublicApiDocumentation() {
  return <main className="api-public-shell"><ApiDocumentation publicView /></main>;
}
