import type { Metadata } from 'next';
import { ApiDocumentation } from '@/components/platform/api-documentation';

export const metadata: Metadata = {
  title: 'AI 外呼完成回调 · 公开接口文档',
  description: '百应 AI 外呼完成回调接口的公开接入文档。',
};

export default function PublicCallInstanceApiDocumentation() {
  return <main className="api-public-shell"><ApiDocumentation publicView /></main>;
}
