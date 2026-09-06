'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BellRing,
  Braces,
  Cable,
  CalendarClock,
  CircleDollarSign,
  FileCog,
  Gauge,
  PhoneCall,
  Settings2,
  Tags,
} from 'lucide-react';
import {
  ApiInterfaceView,
  DataCategoryView,
  LineManagementView,
  MappingView,
  ScriptListView,
  TaskView,
} from '@/components/platform/views';
import { loadOutboundTasks } from '@/lib/platform-api';
import { PricingOperationsConsole } from '@/components/platform/pricing-operations-console';
import { RechargeLedgerConsole } from '@/components/platform/recharge-ledger-console';
import { StudioOperationsConsole } from '@/components/platform/studio-operations-console';
import { AuditOperationsConsole } from '@/components/platform/audit-operations-console';
import { OperationsOverviewConsole } from '@/components/platform/operations-overview-console';
import { IntegrationLogConsole } from '@/components/platform/integration-log-console';

export type PlatformSection =
  | '总览'
  | '影楼管理'
  | '话术列表'
  | '字段映射'
  | '线路管理'
  | '数据分类'
  | '呼叫任务'
  | '充值记录'
  | '话费设置'
  | '操作日志'
  | '接口日志'
  | 'API接口';

const navigation: Array<{
  label: PlatformSection;
  icon: typeof Gauge;
  hint?: string;
}> = [
  { label: '总览', icon: Gauge },
  { label: '影楼管理', icon: Settings2 },
  { label: '线路管理', icon: Cable },
  { label: '字段映射', icon: FileCog },
  { label: '数据分类', icon: Tags },
  { label: '话术列表', icon: CalendarClock },
  { label: '呼叫任务', icon: PhoneCall },
  { label: '话费设置', icon: BadgeDollarSign },
  { label: '充值记录', icon: CircleDollarSign },
  { label: '接口日志', icon: Activity },
  { label: '操作日志', icon: BellRing },
  { label: 'API接口', icon: Braces },
];

export default function Home() {
  const [activeSection, setActiveSection] = useState<PlatformSection>('总览');
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const environmentLabel = import.meta.env.DEV ? '本地联调环境' : '生产环境';
  useEffect(() => {
    let cancelled = false;
    void loadOutboundTasks({ pageNum: 0, pageSize: 1 })
      .then((result) => {
        if (!cancelled) setTaskCount(result.total);
      })
      .catch(() => {
        if (!cancelled) setTaskCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#182a27]">
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-kicker">
              <span className="signal-dot" />
              INTELLIGENT OUTBOUND
            </div>
            <h1>百应外呼调度台</h1>
            <p>ERP / CRM / 百应 · 统一运营后台</p>
          </div>
          <nav className="nav-list" aria-label="平台功能菜单">
            {navigation.map(({ label, icon: Icon, hint }) => {
              const visibleHint =
                label === '呼叫任务' && taskCount !== null
                  ? String(taskCount)
                  : hint;
              return (
                <button
                  aria-current={activeSection === label ? 'page' : undefined}
                  className={
                    activeSection === label
                      ? 'nav-item nav-item-active'
                      : 'nav-item'
                  }
                  key={label}
                  onClick={() => setActiveSection(label)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {visibleHint ? <small>{visibleHint}</small> : null}
                </button>
              );
            })}
          </nav>
          <div className="operator-card">
            <div className="operator-avatar">王</div>
            <div>
              <b>平台管理员</b>
              <p>华东运营中心 · 在线</p>
            </div>
            <span className="online-state" aria-label="在线" />
          </div>
        </aside>
        <main className="content-area">
          <header className="topbar">
            <p>
              <span className="environment-dot" />
              {environmentLabel} <i>›</i> 运营后台 <i>›</i> {activeSection}
            </p>
            <p className="topbar-right">PostgreSQL 实时读取 · CST</p>
          </header>
          {renderSection(activeSection, setActiveSection)}
        </main>
      </div>
    </div>
  );
}

function renderSection(
  section: PlatformSection,
  navigate: (section: PlatformSection) => void,
) {
  switch (section) {
    case '总览':
      return <OperationsOverviewConsole onNavigate={navigate} />;
    case '影楼管理':
      return <StudioOperationsConsole />;
    case '话术列表':
      return <ScriptListView />;
    case '字段映射':
      return <MappingView />;
    case '线路管理':
      return <LineManagementView />;
    case '数据分类':
      return <DataCategoryView />;
    case '呼叫任务':
      return <TaskView />;
    case '充值记录':
      return <RechargeLedgerConsole />;
    case '话费设置':
      return <PricingOperationsConsole />;
    case '操作日志':
      return <AuditOperationsConsole />;
    case '接口日志':
      return <IntegrationLogConsole />;
    case 'API接口':
      return <ApiInterfaceView />;
  }
}
