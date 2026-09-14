'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BellRing,
  Braces,
  Cable,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  FileCog,
  Gauge,
  PhoneCall,
  ReceiptText,
  LogOut,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  ScrollText,
  Tags,
  WalletCards,
} from 'lucide-react';
import {
  ApiInterfaceView,
  DataCategoryView,
  LineManagementView,
  MappingView,
  ScriptListView,
  TaskView,
} from '@/components/platform/views';
import {
  loadOperatorSession,
  loadOutboundTasks,
  logoutOperator,
  PlatformApiError,
  type OperatorSession,
} from '@/lib/platform-api';
import { PricingOperationsConsole } from '@/components/platform/pricing-operations-console';
import { RechargeLedgerConsole } from '@/components/platform/recharge-ledger-console';
import { StudioOperationsConsole } from '@/components/platform/studio-operations-console';
import { AuditOperationsConsole } from '@/components/platform/audit-operations-console';
import { OperationsOverviewConsole } from '@/components/platform/operations-overview-console';
import { IntegrationLogConsole } from '@/components/platform/integration-log-console';
import { RecoveryOperationsConsole } from '@/components/platform/recovery-operations-console';
import { CallbackPreviewConsole } from '@/components/platform/callback-preview-console';
import { PlatformCostDetailConsole } from '@/components/platform/platform-cost-detail-console';
import {
  OperatorLogin,
  OperatorLoginLoading,
} from '@/components/platform/operator-login';

export type PlatformSection =
  | '总览'
  | '影楼管理'
  | '话术列表'
  | '字段映射'
  | '线路管理'
  | '数据分类'
  | '呼叫任务'
  | '平台明细'
  | '充值记录'
  | '话费设置'
  | '操作日志'
  | '接口日志'
  | '回调测试'
  | '异常中心'
  | 'API接口';

type NavigationLink = {
  label: PlatformSection;
  icon: typeof Gauge;
  hint?: string;
};

type NavigationGroupId = 'setup' | 'finance' | 'system';

type NavigationGroup = {
  kind: 'group';
  id: NavigationGroupId;
  label: '初始管理' | '财务管理' | '系统日志';
  icon: typeof Gauge;
  items: NavigationLink[];
};

type NavigationNode = (NavigationLink & { kind: 'link' }) | NavigationGroup;

const navigation: NavigationNode[] = [
  { kind: 'link', label: '总览', icon: Gauge },
  { kind: 'link', label: '影楼管理', icon: Settings2 },
  {
    kind: 'group',
    id: 'setup',
    label: '初始管理',
    icon: SlidersHorizontal,
    items: [
      { label: '线路管理', icon: Cable },
      { label: '字段映射', icon: FileCog },
      { label: '数据分类', icon: Tags },
      { label: '话术列表', icon: CalendarClock },
      { label: '话费设置', icon: BadgeDollarSign },
    ],
  },
  { kind: 'link', label: '呼叫任务', icon: PhoneCall },
  {
    kind: 'group',
    id: 'finance',
    label: '财务管理',
    icon: WalletCards,
    items: [
      { label: '平台明细', icon: ReceiptText },
      { label: '充值记录', icon: CircleDollarSign },
    ],
  },
  {
    kind: 'group',
    id: 'system',
    label: '系统日志',
    icon: ScrollText,
    items: [
      { label: '接口日志', icon: Activity },
      { label: '回调测试', icon: ShieldCheck },
      { label: '异常中心', icon: ShieldAlert },
      { label: '操作日志', icon: BellRing },
    ],
  },
  { kind: 'link', label: 'API接口', icon: Braces },
];

export default function Home() {
  const [session, setSession] = useState<OperatorSession | null>();
  const [activeSection, setActiveSection] = useState<PlatformSection>('总览');
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [openGroup, setOpenGroup] = useState<NavigationGroupId | null>('setup');
  const [compactNavigation, setCompactNavigation] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<NavigationGroupId | null>(
    null,
  );
  const environmentLabel = import.meta.env.DEV ? '本地联调环境' : '生产环境';
  const activeNavigationGroup = navigationGroupForSection(activeSection);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorSession()
      .then((current) => {
        if (!cancelled) setSession(current);
      })
      .catch((caught) => {
        if (
          !cancelled &&
          caught instanceof PlatformApiError &&
          caught.code === 'UNAUTHORIZED'
        ) {
          setSession(null);
        } else if (!cancelled) {
          setSession(null);
        }
      });
    const expire = () => setSession(null);
    window.addEventListener('operator-session-expired', expire);
    return () => {
      cancelled = true;
      window.removeEventListener('operator-session-expired', expire);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
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
  }, [session]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 720px)');
    const updateNavigationMode = () =>
      setCompactNavigation(mediaQuery.matches);
    queueMicrotask(updateNavigationMode);
    mediaQuery.addEventListener('change', updateNavigationMode);
    return () => mediaQuery.removeEventListener('change', updateNavigationMode);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutOperator();
    } finally {
      setTaskCount(null);
      setSession(null);
      setLoggingOut(false);
    }
  };

  const selectSection = (section: PlatformSection) => {
    const targetGroup = navigationGroupForSection(section);
    setActiveSection(section);
    if (targetGroup) {
      setOpenGroup(targetGroup.id);
      if (compactNavigation) setMobileGroup(targetGroup.id);
    } else if (compactNavigation) {
      setMobileGroup(null);
    }
  };

  const toggleGroup = (groupId: NavigationGroupId) => {
    if (compactNavigation) {
      setMobileGroup((current) => (current === groupId ? null : groupId));
      return;
    }
    setOpenGroup((current) => (current === groupId ? null : groupId));
  };

  if (session === undefined) return <OperatorLoginLoading />;
  if (session === null) {
    return (
      <OperatorLogin
        environmentLabel={environmentLabel}
        onAuthenticated={setSession}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#182a27]">
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-kicker">
              <span className="signal-dot" />
              INTELLIGENT OUTBOUND
            </div>
            <h1>
              <span>图形AI</span>
              <span>外呼调度平台</span>
            </h1>
            <p>ERP / CRM / 百应 · 统一运营后台</p>
          </div>
          <nav className="nav-list" aria-label="平台功能菜单">
            <div className="nav-primary-list">
              {navigation.map((node) => {
                if (node.kind === 'link') {
                  const Icon = node.icon;
                  const visibleHint =
                    node.label === '呼叫任务' && taskCount !== null
                      ? String(taskCount)
                      : node.hint;
                  return (
                    <button
                      type="button"
                      aria-current={
                        activeSection === node.label ? 'page' : undefined
                      }
                      className={
                        activeSection === node.label
                          ? 'nav-item nav-item-active'
                          : 'nav-item'
                      }
                      key={node.label}
                      onClick={() => selectSection(node.label)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{node.label}</span>
                      {visibleHint ? <small>{visibleHint}</small> : null}
                    </button>
                  );
                }

                const Icon = node.icon;
                const groupIsActive = activeNavigationGroup?.id === node.id;
                const groupIsOpen = compactNavigation
                  ? mobileGroup === node.id
                  : openGroup === node.id;
                return (
                  <section
                    className={
                      groupIsActive ? 'nav-group is-active' : 'nav-group'
                    }
                    key={node.id}
                  >
                    <button
                      type="button"
                      className={
                        groupIsOpen
                          ? 'nav-item nav-group-trigger is-open'
                          : 'nav-item nav-group-trigger'
                      }
                      aria-expanded={groupIsOpen}
                      aria-controls={
                        compactNavigation
                          ? `mobile-nav-group-${node.id}`
                          : `nav-group-${node.id}`
                      }
                      onClick={() => toggleGroup(node.id)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{node.label}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="nav-group-chevron"
                      />
                    </button>
                    <div
                      id={`nav-group-${node.id}`}
                      className="nav-submenu"
                      hidden={openGroup !== node.id}
                    >
                      {node.items.map(({ label, icon: ItemIcon }) => (
                        <button
                          type="button"
                          aria-current={
                            activeSection === label ? 'page' : undefined
                          }
                          className={
                            activeSection === label
                              ? 'nav-item nav-subitem nav-item-active'
                              : 'nav-item nav-subitem'
                          }
                          key={label}
                          onClick={() => selectSection(label)}
                        >
                          <ItemIcon aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            {compactNavigation && mobileGroup ? (
              <div
                id={`mobile-nav-group-${mobileGroup}`}
                className="nav-mobile-submenu"
                aria-label={
                  navigationGroupById(mobileGroup)?.label ?? '二级菜单'
                }
              >
                {navigationGroupById(mobileGroup)?.items.map(
                  ({ label, icon: ItemIcon }) => (
                    <button
                      type="button"
                      aria-current={
                        activeSection === label ? 'page' : undefined
                      }
                      className={
                        activeSection === label
                          ? 'nav-item nav-subitem nav-item-active'
                          : 'nav-item nav-subitem'
                      }
                      key={label}
                      onClick={() => selectSection(label)}
                    >
                      <ItemIcon aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </nav>
          <div className="operator-card">
            <div className="operator-identity">
              <div className="operator-avatar">
                {session.displayName.slice(0, 1)}
              </div>
              <div className="operator-copy">
                <b>{session.displayName}</b>
                <p>{session.organization} · 在线</p>
              </div>
              <span className="online-state" aria-label="在线" />
            </div>
            <button
              type="button"
              className="operator-logout"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut aria-hidden="true" size={14} />
              <span>{loggingOut ? '正在退出' : '退出登录'}</span>
            </button>
          </div>
        </aside>
        <main className="content-area">
          <header className="topbar">
            <p>
              <span className="environment-dot" />
              {environmentLabel} <i>›</i> 运营后台
              {activeNavigationGroup ? (
                <>
                  {' '}
                  <i>›</i> {activeNavigationGroup.label}
                </>
              ) : null}{' '}
              <i>›</i> {activeSection}
            </p>
            <p className="topbar-right">PostgreSQL 实时读取 · CST</p>
          </header>
          <div className="section-viewport">
            {renderSection(activeSection, selectSection)}
          </div>
        </main>
      </div>
    </div>
  );
}

function navigationGroupForSection(section: PlatformSection) {
  return navigation.find(
    (node): node is NavigationGroup =>
      node.kind === 'group' &&
      node.items.some((item) => item.label === section),
  );
}

function navigationGroupById(groupId: NavigationGroupId) {
  return navigation.find(
    (node): node is NavigationGroup =>
      node.kind === 'group' && node.id === groupId,
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
    case '平台明细':
      return <PlatformCostDetailConsole />;
    case '充值记录':
      return <RechargeLedgerConsole />;
    case '话费设置':
      return <PricingOperationsConsole />;
    case '操作日志':
      return <AuditOperationsConsole />;
    case '接口日志':
      return <IntegrationLogConsole />;
    case '回调测试':
      return <CallbackPreviewConsole />;
    case '异常中心':
      return <RecoveryOperationsConsole />;
    case 'API接口':
      return <ApiInterfaceView />;
  }
}
