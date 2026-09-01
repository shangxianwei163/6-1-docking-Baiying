import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '6+1 智能外呼平台 · 运营后台',
  description: 'ERP/CRM 与百应智能外呼的统一运营、账务、对账与异常处理平台。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
