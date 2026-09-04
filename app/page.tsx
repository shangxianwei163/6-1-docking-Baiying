'use client';

import { useState } from 'react';
import { Activity, BadgeDollarSign, BellRing, Cable, CalendarClock, CircleDollarSign, FileCog, Gauge, Landmark, PhoneCall, ReceiptText, Settings2, Tags } from 'lucide-react';
import { ApiLogView, AuditLogView, BaiyingBillView, DataCategoryView, LineManagementView, MappingView, OverviewView, RateSettingView, RechargeView, ScriptListView, StoreBillView, StudioView, TaskView } from '@/components/platform/views';

export type PlatformSection = '总览' | '影楼管理' | '话术列表' | '字段映射' | '线路管理' | '数据分类' | '呼叫任务' | '百应账单' | '门店账单' | '充值记录' | '话费设置' | '操作日志' | '接口日志';

const navigation: Array<{ label: PlatformSection; icon: typeof Gauge; hint?: string }> = [
  { label: '总览', icon: Gauge }, { label: '影楼管理', icon: Settings2 }, { label: '话术列表', icon: CalendarClock },
  { label: '字段映射', icon: FileCog }, { label: '线路管理', icon: Cable }, { label: '数据分类', icon: Tags }, { label: '呼叫任务', icon: PhoneCall, hint: '5' }, { label: '百应账单', icon: ReceiptText }, { label: '门店账单', icon: Landmark },
  { label: '充值记录', icon: CircleDollarSign }, { label: '话费设置', icon: BadgeDollarSign }, { label: '操作日志', icon: BellRing, hint: '3' }, { label: '接口日志', icon: Activity },
];

const pageMap: Record<PlatformSection, React.ReactNode> = {
  总览: <OverviewView />, 影楼管理: <StudioView />, 话术列表: <ScriptListView />, 字段映射: <MappingView />, 线路管理: <LineManagementView />, 数据分类: <DataCategoryView />, 呼叫任务: <TaskView />,
  百应账单: <BaiyingBillView />, 门店账单: <StoreBillView />, 充值记录: <RechargeView />,
  话费设置: <RateSettingView />, 操作日志: <AuditLogView />, 接口日志: <ApiLogView />,
};

export default function Home() {
  const [activeSection, setActiveSection] = useState<PlatformSection>('总览');
  return <div className="min-h-screen bg-[#f5f5f1] text-[#182a27]"><div className="app-shell">
    <aside className="sidebar">
      <div className="brand-block"><div className="brand-kicker"><span className="signal-dot" />INTELLIGENT OUTBOUND</div><h1>百应外呼调度台</h1><p>ERP / CRM / 百应 · 统一运营后台</p></div>
      <nav className="nav-list" aria-label="平台功能菜单">{navigation.map(({ label, icon: Icon, hint }) => <button aria-current={activeSection === label ? 'page' : undefined} className={activeSection === label ? 'nav-item nav-item-active' : 'nav-item'} key={label} onClick={() => setActiveSection(label)}><Icon aria-hidden="true" /><span>{label}</span>{hint ? <small>{hint}</small> : null}</button>)}</nav>
      <div className="operator-card"><div className="operator-avatar">王</div><div><b>平台管理员</b><p>华东运营中心 · 在线</p></div><span className="online-state" aria-label="在线" /></div>
    </aside>
    <main className="content-area"><header className="topbar"><p><span className="environment-dot" />生产环境 <i>›</i> 运营后台 <i>›</i> {activeSection}</p><p className="topbar-right">最后同步于 2026-09-02 09:30 · CST</p></header>{pageMap[activeSection]}</main>
  </div></div>;
}
