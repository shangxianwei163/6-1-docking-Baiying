'use client';

/* oxlint-disable jsx-a11y/control-has-associated-label -- Interactive table cells render labels through composed task components. */

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Cable,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { zhCN } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { UnifiedSelect } from '@/components/ui/unified-select';
import {
  loadScripts,
  loadLines,
  loadManagedLines,
  loadDataCategories,
  loadBaiyingAccountOverview,
  loadPlannedTasks,
  loadSourceCategories,
  savePlannedTaskCategoryBinding,
  saveScriptBinding,
  saveLineStudioBindings,
  syncDataCategories,
  type BaiyingLine,
  type BaiyingAccountOverview,
  type BaiyingScript,
  type BaiyingScriptStatus,
  type DataCategory,
  type PlannedTask,
  type PlannedTaskStatus,
  type SourceDataCategory,
} from '@/lib/platform-api';
import { Metric, PageIntro, Panel, Status } from './shared';
import { ApiDocumentation } from './api-documentation';
import { OutboundTaskConsole } from './outbound-task-console';
export { MappingView } from './mapping-view';

type TaskStatus = '执行中' | '执行完成' | '执行失败';
type TaskTone = 'green' | 'amber' | 'red';

const taskRows: Array<{
  id: string;
  store: string;
  source: 'ERP' | 'CRM';
  sourceCategoryPath: string;
  script: string;
  scriptId: string;
  mappingVersion: string;
  mappingCoverage: string;
  mappingVariables: string[];
  numbers: string;
  title: string;
  baiyingId: string;
  status: TaskStatus;
  tone: TaskTone;
  createdAt: string;
  resultStatus: '待回传' | '已回传' | '回传失败';
  resultAt: string;
  recordingCount: string;
  recordingStatus: '待回传' | '已回传' | '回传失败' | '—';
  recordingAt: string;
  durationSeconds: number;
  billingMinutes: number;
}> = [
  {
    id: 'PT-20260902-00024',
    store: '紫藤影像 · 上海总店',
    source: 'ERP',
    sourceCategoryPath: '邀约-百天-SS1',
    script: '【新】喜悦-满月照-单agent',
    scriptId: '5421020',
    mappingVersion: 'v12',
    mappingCoverage: '6 / 6',
    mappingVariables: [
      '客户称呼',
      '宝宝姓名',
      '宝宝年龄',
      '套餐名称',
      '套餐购买时间',
      '预约时间',
    ],
    numbers: '10,000',
    title: '婚博会意向客户回访',
    baiyingId: 'BY-103829',
    status: '执行中',
    tone: 'green',
    createdAt: '2026-09-02 09:16:00',
    resultStatus: '待回传',
    resultAt: '—',
    recordingCount: '6,104',
    recordingStatus: '待回传',
    recordingAt: '—',
    durationSeconds: 431820,
    billingMinutes: 7197,
  },
  {
    id: 'PT-20260902-00023',
    store: '远山摄影 · 杭州店',
    source: 'CRM',
    sourceCategoryPath: '秋季档期-二次触达',
    script: '【新】非常幸孕-孕妈写真-单agent',
    scriptId: '5390020',
    mappingVersion: 'v12',
    mappingCoverage: '5 / 5',
    mappingVariables: [
      '客户称呼',
      '预产期',
      '套餐名称',
      '套餐购买时间',
      '预约时间',
    ],
    numbers: '3,600',
    title: '秋季档期二次触达',
    baiyingId: 'BY-103825',
    status: '执行中',
    tone: 'green',
    createdAt: '2026-09-02 08:47:00',
    resultStatus: '待回传',
    resultAt: '—',
    recordingCount: '1,238',
    recordingStatus: '待回传',
    recordingAt: '—',
    durationSeconds: 195620,
    billingMinutes: 3261,
  },
  {
    id: 'PT-20260902-00022',
    store: '罗曼映像 · 南京店',
    source: 'ERP',
    sourceCategoryPath: '到店-未成交-激活',
    script: '【新】六加一周岁照-单agent',
    scriptId: '5363420',
    mappingVersion: 'v11',
    mappingCoverage: '5 / 5',
    mappingVariables: [
      '客户称呼',
      '宝宝姓名',
      '宝宝年龄',
      '套餐名称',
      '预约时间',
    ],
    numbers: '7,200',
    title: '到店未成交激活',
    baiyingId: '—',
    status: '执行失败',
    tone: 'red',
    createdAt: '2026-09-02 08:29:00',
    resultStatus: '回传失败',
    resultAt: '2026-09-02 08:32:00',
    recordingCount: '0',
    recordingStatus: '—',
    recordingAt: '—',
    durationSeconds: 0,
    billingMinutes: 0,
  },
  {
    id: 'PT-20260901-00021',
    store: '晨光摄影 · 苏州园区店',
    source: 'CRM',
    sourceCategoryPath: '老客-周年礼遇',
    script: '【新】素玄科技-星贝优京东获客-单agent',
    scriptId: '5281320',
    mappingVersion: 'v11',
    mappingCoverage: '5 / 5',
    mappingVariables: [
      '客户称呼',
      '客户姓名',
      '意向套餐',
      '最近咨询时间',
      '所属门店',
    ],
    numbers: '2,800',
    title: '老客周年礼遇',
    baiyingId: 'BY-103817',
    status: '执行完成',
    tone: 'green',
    createdAt: '2026-09-01 16:21:00',
    resultStatus: '已回传',
    resultAt: '2026-09-01 19:45:00',
    recordingCount: '2,742',
    recordingStatus: '已回传',
    recordingAt: '2026-09-01 20:03:00',
    durationSeconds: 176540,
    billingMinutes: 2943,
  },
  {
    id: 'PT-20260901-00020',
    store: '纪念日影像 · 无锡店',
    source: 'ERP',
    sourceCategoryPath: '七夕-咨询回访',
    script: '【新】六加一百天照-单agent',
    scriptId: '5259720',
    mappingVersion: 'v10',
    mappingCoverage: '5 / 5',
    mappingVariables: [
      '客户称呼',
      '宝宝姓名',
      '宝宝年龄',
      '套餐名称',
      '预约时间',
    ],
    numbers: '1,200',
    title: '七夕咨询回访',
    baiyingId: 'BY-103802',
    status: '执行完成',
    tone: 'green',
    createdAt: '2026-09-01 14:05:00',
    resultStatus: '已回传',
    resultAt: '2026-09-01 16:18:00',
    recordingCount: '1,174',
    recordingStatus: '已回传',
    recordingAt: '2026-09-01 16:41:00',
    durationSeconds: 71400,
    billingMinutes: 1190,
  },
];

function TaskCategoryCell({
  script,
  loading,
  failed,
}: {
  script?: BaiyingScript;
  loading: boolean;
  failed: boolean;
}) {
  const categories = script?.binding?.categories ?? [];
  if (loading) return <span className="task-category-empty">读取中…</span>;
  if (failed)
    return (
      <span className="task-category-empty task-category-error">读取失败</span>
    );
  if (!categories.length)
    return <span className="task-category-empty">未绑定</span>;
  const sourceSystem = script?.binding?.sourceSystem;
  const fullText = categories
    .map((category) => category.categoryPath)
    .join('\n');
  return (
    <button
      type="button"
      className="task-category-cell"
      title={fullText}
      aria-label={`${sourceSystem} 数据分类：${categories.map((category) => category.categoryPath).join('、')}`}
    >
      <span className="task-category-summary">
        <b>{sourceSystem}</b>
        <em>{categories[0].categoryPath}</em>
        {categories.length > 1 ? <small>+{categories.length - 1}</small> : null}
      </span>
      <span className="task-category-tooltip" role="tooltip">
        <strong>
          {sourceSystem} 数据分类 · {categories.length} 个
        </strong>
        {categories.map((category) => (
          <i key={`${category.sourceCategoryId}-${category.categoryPath}`}>
            {category.categoryPath}
          </i>
        ))}
      </span>
    </button>
  );
}

function TaskLineCell({
  script,
  loading,
  failed,
}: {
  script?: BaiyingScript;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) return <span className="task-line-empty">读取中…</span>;
  if (failed)
    return (
      <span className="task-line-empty task-category-error">读取失败</span>
    );
  if (!script?.binding?.lineId)
    return <span className="task-line-empty">未配置</span>;
  const lineLabel = script.binding.lineName || `线路 ${script.binding.lineId}`;
  return (
    <span
      className="task-line-cell"
      title={`${lineLabel} · #${script.binding.lineId}`}
    >
      <b>{lineLabel}</b>
      <code>#{script.binding.lineId}</code>
    </span>
  );
}

function getTaskDisplayName(task: (typeof taskRows)[number]) {
  const monthDay = task.createdAt.slice(5, 10).replace('-', '');
  const normalizedCategory = task.sourceCategoryPath.replace(/[\s\-/]+/g, '');
  const sequence = task.id.match(/(\d{5})$/)?.[1] ?? '00000';
  return `${monthDay}${task.source}${normalizedCategory}-${sequence}`;
}

function formatTaskDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function formatTaskMoney(value: number) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type TaskPlatformPricing = {
  rate: number | null;
  tierName: string;
  monthlyMinutes: number;
  settled: boolean;
};

type TaskCustomerPricing = {
  rate: number | null;
  sourceLabel: string;
};

function TaskBillingCells({
  task,
  platformPricing,
  customerPricing,
}: {
  task: (typeof taskRows)[number];
  platformPricing: TaskPlatformPricing;
  customerPricing: TaskCustomerPricing;
}) {
  const billingMinutes = task.billingMinutes;
  const customerFee =
    customerPricing.rate === null
      ? null
      : billingMinutes * customerPricing.rate;
  const studio = initialStudios.find((candidate) =>
    task.store.includes(candidate.name),
  );
  const studioBalance =
    studio && customerFee !== null ? studio.balance - customerFee : null;
  const platformFee =
    platformPricing.rate === null
      ? null
      : billingMinutes * platformPricing.rate;
  const revenue =
    customerFee === null || platformFee === null
      ? null
      : customerFee - platformFee;
  const platformPricingTitle =
    platformPricing.rate === null
      ? `海南人像月度供应价格未配置匹配阶梯 · 本月累计 ${platformPricing.monthlyMinutes.toLocaleString('zh-CN')} 分钟`
      : `来源：海南人像月度供应价格 · ${platformPricing.tierName} · 本月累计 ${platformPricing.monthlyMinutes.toLocaleString('zh-CN')} 分钟 · ${platformPricing.settled ? '月末最终结算价' : '当月暂估价，将于月末最后一天 23:30 结算'}`;
  const customerPricingTitle =
    customerPricing.rate === null
      ? customerPricing.sourceLabel
      : `来源：话费设置 · 影楼话费 · ${customerPricing.sourceLabel}`;

  return (
    <>
      <td
        className="task-duration"
        title={`来源：data.data.callInstance.duration · 累计 ${task.durationSeconds.toLocaleString('zh-CN')} 秒`}
      >
        {formatTaskDuration(task.durationSeconds)}
      </td>
      <td
        className="task-billing-minutes"
        title="每条通话分别按 ceil(duration / 60) 计算后汇总"
      >
        {billingMinutes.toLocaleString('zh-CN')} 分钟
      </td>
      <td className="task-money-rate" title={customerPricingTitle}>
        {customerPricing.rate === null
          ? '—'
          : `¥${customerPricing.rate.toFixed(2)} / 分钟`}
      </td>
      <td className="task-money" title={customerPricingTitle}>
        {customerFee === null ? '—' : `¥${formatTaskMoney(customerFee)}`}
      </td>
      <td
        className={`task-studio-balance ${studioBalance !== null && studioBalance < 0 ? 'is-negative' : ''}`}
        title={
          studio && customerFee !== null
            ? `来源：影楼管理 · ${studio.name} · 账户余额 ¥${formatTaskMoney(studio.balance)} − 客户话费 ¥${formatTaskMoney(customerFee)}`
            : '未找到影楼账户余额或客户话费'
        }
      >
        {studioBalance === null ? '—' : `¥${formatTaskMoney(studioBalance)}`}
      </td>
      <td className="task-money-rate" title={platformPricingTitle}>
        {platformPricing.rate === null
          ? '—'
          : `¥${platformPricing.rate.toFixed(2)} / 分钟`}
      </td>
      <td className="task-money" title={platformPricingTitle}>
        {platformFee === null ? '—' : `¥${formatTaskMoney(platformFee)}`}
      </td>
      <td
        className={`task-revenue ${revenue === null || revenue >= 0 ? 'is-positive' : 'is-negative'}`}
      >
        {revenue === null ? '—' : `¥${formatTaskMoney(revenue)}`}
      </td>
    </>
  );
}

function TaskMappingVariables({
  version,
  coverage,
  variables,
  'aria-label': ariaLabel = '映射变量',
}: {
  version: string;
  coverage: string;
  variables: string[];
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      className="mapping-snapshot mapping-variable-cell"
      title={variables.join('\n')}
      aria-label={`${ariaLabel}：版本 ${version}，${coverage} 个变量，${variables.join('、')}`}
    >
      <b>{version}</b>
      <small>{coverage} 变量</small>
      <span className="mapping-variable-tooltip" role="tooltip">
        <strong>映射变量 · {variables.length} 个</strong>
        {variables.map((variable) => (
          <i key={variable}>{variable}</i>
        ))}
      </span>
    </button>
  );
}

function TaskCallbackAddress({
  task,
  kind,
}: {
  task: (typeof taskRows)[number];
  kind: 'data' | 'recording';
}) {
  const studio = initialStudios.find((item) => task.store.includes(item.name));
  const address = studio
    ? task.source === 'ERP'
      ? kind === 'data'
        ? studio.erpUrl
        : studio.erpRecordingUrl
      : kind === 'data'
        ? studio.crmUrl
        : studio.crmRecordingUrl
    : '';
  return (
    <span
      className={
        address ? 'task-callback-address' : 'task-callback-address is-empty'
      }
      title={address || undefined}
    >
      {address || '未配置'}
    </span>
  );
}

function getTaskCallbackAddressValue(
  task: (typeof taskRows)[number],
  kind: 'data' | 'recording',
) {
  const studio = initialStudios.find((item) => task.store.includes(item.name));
  if (!studio) return '';
  if (task.source === 'ERP')
    return kind === 'data' ? studio.erpUrl : studio.erpRecordingUrl;
  return kind === 'data' ? studio.crmUrl : studio.crmRecordingUrl;
}

type TaskDateField = 'createdAt' | 'resultAt' | 'recordingAt';
type TaskDatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | '';
type TaskExportMode = 'all' | 'studio' | 'platform';

function escapeCsvValue(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getTaskDatePresetRange(
  preset: Exclude<TaskDatePreset, 'custom' | ''>,
  now = new Date(),
) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (preset === 'month') {
    start.setDate(1);
  }
  return { startDate: formatDateInput(start), endDate: formatDateInput(end) };
}

function TaskTable({ className = '' }: { className?: string }) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<TaskStatus | '全部'>('全部');
  const [dateField, setDateField] = useState<TaskDateField>('createdAt');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [datePreset, setDatePreset] = useState<TaskDatePreset>('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<TaskExportMode>('all');
  const [exportStudio, setExportStudio] = useState('');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportDatePickerOpen, setExportDatePickerOpen] = useState(false);
  const [exportDatePreset, setExportDatePreset] =
    useState<TaskDatePreset>('month');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [scriptsById, setScriptsById] = useState<Map<string, BaiyingScript>>(
    new Map(),
  );
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsFailed, setScriptsFailed] = useState(false);
  const [hainanRateTiers, setHainanRateTiers] = useState<HainanRateTier[]>(
    initialHainanRateTiers,
  );
  const [monthlySettlements, setMonthlySettlements] = useState<
    Record<string, HainanMonthlySettlement>
  >({});
  const [studioRateSettings, setStudioRateSettings] =
    useState<StudioRateSettings>(() => createDefaultStudioRateSettings());
  useEffect(() => {
    let cancelled = false;
    void loadScripts({ robotStatus: 0, pageNum: 0, pageSize: 100 })
      .then((result) => {
        if (cancelled) return;
        setScriptsById(
          new Map(result.scripts.map((script) => [script.robotDefId, script])),
        );
        setScriptsFailed(false);
      })
      .catch(() => {
        if (!cancelled) setScriptsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setScriptsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refreshPricing = () => {
      const storedTiers = loadStoredHainanRateTiers();
      const storedSettlements = loadHainanMonthlySettlements();
      const reconciledSettlements = settleEligibleTaskMonths(
        taskRows,
        storedTiers,
        storedSettlements,
      );
      const storedStudioRates = loadStudioRateSettings();
      if (!cancelled) {
        setHainanRateTiers(storedTiers);
        setMonthlySettlements(reconciledSettlements);
        setStudioRateSettings(storedStudioRates);
      }
    };
    queueMicrotask(refreshPricing);
    const settlementTimer = window.setInterval(refreshPricing, 30_000);
    window.addEventListener('storage', refreshPricing);
    window.addEventListener('hainan-rate-tiers-updated', refreshPricing);
    window.addEventListener('studio-rate-settings-updated', refreshPricing);
    return () => {
      cancelled = true;
      window.clearInterval(settlementTimer);
      window.removeEventListener('storage', refreshPricing);
      window.removeEventListener('hainan-rate-tiers-updated', refreshPricing);
      window.removeEventListener(
        'studio-rate-settings-updated',
        refreshPricing,
      );
    };
  }, []);
  const filteredRows = useMemo(
    () =>
      taskRows.filter(
        (task) =>
          `${task.id}${getTaskDisplayName(task)}${task.store}${task.baiyingId}`
            .toLowerCase()
            .includes(keyword.toLowerCase()) &&
          (status === '全部' || task.status === status) &&
          ((!startDate && !endDate) ||
            (() => {
              const rawDate = task[dateField];
              const taskDate = rawDate === '—' ? '' : rawDate.slice(0, 10);
              return Boolean(
                taskDate &&
                (!startDate || taskDate >= startDate) &&
                (!endDate || taskDate <= endDate),
              );
            })()),
      ),
    [dateField, endDate, keyword, startDate, status],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const tabs: Array<TaskStatus | '全部'> = [
    '全部',
    '执行中',
    '执行完成',
    '执行失败',
  ];
  const setTaskStatus = (nextStatus: TaskStatus | '全部') => {
    setStatus(nextStatus);
    setPage(1);
  };
  const applyDatePreset = (preset: Exclude<TaskDatePreset, 'custom' | ''>) => {
    const range = getTaskDatePresetRange(preset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setDatePreset(preset);
    setPage(1);
  };
  const clearDateRange = () => {
    setStartDate('');
    setEndDate('');
    setDatePreset('');
    setPage(1);
  };
  const selectedDateRange: DateRange | undefined =
    startDate || endDate
      ? {
          from: parseDateInput(startDate),
          to: parseDateInput(endDate),
        }
      : undefined;
  const dateRangeLabel =
    startDate && endDate
      ? startDate === endDate
        ? startDate
        : `${startDate} — ${endDate}`
      : startDate
        ? `${startDate} — 请选择结束日期`
        : '选择日期范围';
  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setStartDate(range?.from ? formatDateInput(range.from) : '');
    setEndDate(range?.to ? formatDateInput(range.to) : '');
    setDatePreset(range?.from ? 'custom' : '');
    setPage(1);
  };
  const statusTone = (value: string): TaskTone =>
    value === '回传失败' ? 'red' : value === '待回传' ? 'amber' : 'green';
  const openExportDialog = () => {
    const range = getTaskDatePresetRange('month');
    setExportMode('all');
    setExportStudio('');
    setExportStartDate(range.startDate);
    setExportEndDate(range.endDate);
    setExportDatePreset('month');
    setExportOpen(true);
  };
  const exportRows = taskRows.filter((task) => {
    const callDate = task.createdAt.slice(0, 10);
    const matchesDate =
      (!exportStartDate || callDate >= exportStartDate) &&
      (!exportEndDate || callDate <= exportEndDate);
    const matchesStudio =
      exportMode !== 'studio' ||
      Boolean(exportStudio && task.store.includes(exportStudio));
    return matchesDate && matchesStudio;
  });
  const exportDateRange: DateRange | undefined =
    exportStartDate || exportEndDate
      ? {
          from: parseDateInput(exportStartDate),
          to: parseDateInput(exportEndDate),
        }
      : undefined;
  const exportDateLabel =
    exportStartDate && exportEndDate
      ? exportStartDate === exportEndDate
        ? exportStartDate
        : `${exportStartDate} — ${exportEndDate}`
      : '选择呼叫时间范围';
  const applyExportDatePreset = (
    preset: Exclude<TaskDatePreset, 'custom' | ''>,
  ) => {
    const range = getTaskDatePresetRange(preset);
    setExportStartDate(range.startDate);
    setExportEndDate(range.endDate);
    setExportDatePreset(preset);
  };
  const exportTaskData = () => {
    const commonColumns = [
      '任务编号',
      '所属影楼',
      '任务来源',
      '任务状态',
      '数据分类',
      '使用话术',
      '映射变量',
      '号码数量',
      '百应任务 ID',
      '任务名称',
      '使用线路',
      '结果回传',
      '结果回传时间',
      '数据回传地址',
      '录音获取数量',
      '录音回传结果',
      '录音回传时间',
      '录音回传地址',
      '呼叫时间',
      '通话时长',
      '计费时长',
    ];
    const customerColumns = ['客户话费单价', '客户话费', '影楼账户余额'];
    const platformColumns = ['平台话费单价', '平台话费', '收益'];
    const columns = [
      ...commonColumns,
      ...(exportMode === 'platform' ? [] : customerColumns),
      ...(exportMode === 'studio' ? [] : platformColumns),
    ];
    const data = exportRows.map((task) => {
      const script = scriptsById.get(task.scriptId);
      const lineLabel = script?.binding?.lineId
        ? `${script.binding.lineName || `线路 ${script.binding.lineId}`} (#${script.binding.lineId})`
        : '未配置';
      const customerPricing = getTaskCustomerPricing(task, studioRateSettings);
      const platformPricing = getTaskPlatformPricing(
        task,
        taskRows,
        hainanRateTiers,
        monthlySettlements,
      );
      const customerFee =
        customerPricing.rate === null
          ? null
          : task.billingMinutes * customerPricing.rate;
      const platformFee =
        platformPricing.rate === null
          ? null
          : task.billingMinutes * platformPricing.rate;
      const studio = initialStudios.find((candidate) =>
        task.store.includes(candidate.name),
      );
      const studioBalance =
        studio && customerFee !== null ? studio.balance - customerFee : null;
      const revenue =
        customerFee !== null && platformFee !== null
          ? customerFee - platformFee
          : null;
      return {
        任务编号: task.id,
        所属影楼: task.store,
        任务来源: task.source,
        任务状态: task.status,
        数据分类: task.sourceCategoryPath,
        使用话术: `${script?.robotName ?? task.script} (#${task.scriptId})`,
        映射变量: `${task.mappingVersion} ${task.mappingCoverage}：${task.mappingVariables.join('、')}`,
        号码数量: task.numbers,
        '百应任务 ID': task.baiyingId,
        任务名称: getTaskDisplayName(task),
        使用线路: lineLabel,
        结果回传: task.resultStatus,
        结果回传时间: task.resultAt,
        数据回传地址: getTaskCallbackAddressValue(task, 'data') || '未配置',
        录音获取数量: task.recordingCount,
        录音回传结果: task.recordingStatus,
        录音回传时间: task.recordingAt,
        录音回传地址:
          getTaskCallbackAddressValue(task, 'recording') || '未配置',
        呼叫时间: task.createdAt,
        通话时长: formatTaskDuration(task.durationSeconds),
        计费时长: task.billingMinutes,
        客户话费单价: customerPricing.rate ?? '',
        客户话费: customerFee === null ? '' : customerFee.toFixed(2),
        影楼账户余额: studioBalance === null ? '' : studioBalance.toFixed(2),
        平台话费单价: platformPricing.rate ?? '',
        平台话费: platformFee === null ? '' : platformFee.toFixed(2),
        收益: revenue === null ? '' : revenue.toFixed(2),
      };
    });
    const csv = `\uFEFF${[
      columns.map(escapeCsvValue).join(','),
      ...data.map((record) =>
        columns
          .map((column) =>
            escapeCsvValue(record[column as keyof typeof record]),
          )
          .join(','),
      ),
    ].join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const modeLabel =
      exportMode === 'all'
        ? '全部'
        : exportMode === 'studio'
          ? exportStudio
          : '平台';
    anchor.href = url;
    anchor.download = `呼叫任务_${modeLabel}_${exportStartDate}_${exportEndDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  return (
    <Panel
      title="任务列表"
      meta={`共 ${filteredRows.length} 笔`}
      className={className}
    >
      <div className="task-tabs" aria-label="任务状态筛选">
        <div className="task-tab-options">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={status === tab ? 'active' : ''}
              onClick={() => setTaskStatus(tab)}
            >
              {tab}{' '}
              <small>
                {tab === '全部'
                  ? taskRows.length
                  : taskRows.filter((task) => task.status === tab).length}
              </small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="task-export-button"
          onClick={openExportDialog}
        >
          <Download aria-hidden="true" size={13} />
          导出任务
        </button>
      </div>
      <div className="toolbar task-filter-toolbar">
        <label className="search-box">
          <Search size={15} />
          <input
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
            placeholder="搜索任务编号、任务名称、影楼或百应任务 ID"
          />
        </label>
        <UnifiedSelect
          ariaLabel="任务状态"
          triggerLabel="任务状态"
          value={status}
          className="task-toolbar-select-trigger task-status-select-trigger"
          contentClassName="task-status-select-content"
          popupLabel="按执行状态筛选"
          onValueChange={(value) => setTaskStatus(value as TaskStatus | '全部')}
          options={[
            {
              value: '全部',
              label: '全部状态',
              description: '展示所有呼叫任务',
            },
            {
              value: '执行中',
              label: '执行中',
              description: '任务正在呼叫',
            },
            {
              value: '执行完成',
              label: '执行完成',
              description: '任务已正常结束',
            },
            {
              value: '执行失败',
              label: '执行失败',
              description: '任务执行出现异常',
            },
          ]}
        />
        <UnifiedSelect
          ariaLabel="时间范围字段"
          triggerLabel="时间类型"
          value={dateField}
          className="task-toolbar-select-trigger task-date-field-select"
          contentClassName="task-date-field-content"
          popupLabel="选择筛选所依据的时间"
          onValueChange={(value) => {
            setDateField(value as TaskDateField);
            setPage(1);
          }}
          options={[
            {
              value: 'createdAt',
              label: '呼叫时间',
              description: '任务发起呼叫的时间',
            },
            {
              value: 'resultAt',
              label: '结果回传时间',
              description: '呼叫结果完成回传的时间',
            },
            {
              value: 'recordingAt',
              label: '录音回传时间',
              description: '录音文件完成回传的时间',
            },
          ]}
        />
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger
            aria-label="时间范围筛选"
            className={`task-date-range-trigger${startDate || endDate ? ' is-active' : ''}`}
          >
            <CalendarDays aria-hidden="true" size={16} />
            <span>
              <small>日期范围</small>
              <strong>{dateRangeLabel}</strong>
            </span>
            <ChevronDown aria-hidden="true" size={14} />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="task-date-popover"
          >
            <header className="task-date-popover-header">
              <div>
                <strong>选择日期范围</strong>
                <span>
                  按
                  {dateField === 'createdAt'
                    ? '呼叫时间'
                    : dateField === 'resultAt'
                      ? '结果回传时间'
                      : '录音回传时间'}
                  筛选
                </span>
              </div>
              <button
                type="button"
                className="task-date-popover-clear"
                disabled={!startDate && !endDate}
                onClick={clearDateRange}
              >
                清空
              </button>
            </header>
            <div className="task-date-popover-shortcuts" aria-label="快捷日期">
              {(
                [
                  ['today', '今天'],
                  ['yesterday', '昨天'],
                  ['week', '本周'],
                  ['month', '本月'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  type="button"
                  key={preset}
                  className={datePreset === preset ? 'is-active' : ''}
                  onClick={() => applyDatePreset(preset)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Calendar
              mode="range"
              locale={zhCN}
              numberOfMonths={2}
              selected={selectedDateRange}
              defaultMonth={selectedDateRange?.from}
              onSelect={handleDateRangeSelect}
              className="task-date-calendar"
            />
            <footer className="task-date-popover-footer">
              <span>{dateRangeLabel}</span>
              <button
                type="button"
                onClick={() => setDatePickerOpen(false)}
                disabled={Boolean(startDate) !== Boolean(endDate)}
              >
                完成
              </button>
            </footer>
          </PopoverContent>
        </Popover>
        <UnifiedSelect
          ariaLabel="每页展示数量"
          className="filter-button"
          value={String(pageSize)}
          popupLabel="每页展示数量"
          options={[
            { value: '20', label: '20 条 / 页' },
            { value: '50', label: '50 条 / 页' },
            { value: '100', label: '100 条 / 页' },
          ]}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setPage(1);
          }}
        />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- TaskMappingVariables receives an explicit aria-label and renders it on its button. */}
      <div className="table-wrap">
        <table className="data-table task-table">
          <caption className="sr-only">呼叫任务列表及映射变量</caption>
          <thead>
            <tr>
              <th>操作</th>
              <th>任务编号</th>
              <th>所属影楼</th>
              <th>任务来源</th>
              <th>任务状态</th>
              <th>数据分类</th>
              <th>使用话术</th>
              <th>映射变量</th>
              <th>号码数量</th>
              <th>百应任务 ID</th>
              <th>任务名称</th>
              <th>使用线路</th>
              <th>结果回传</th>
              <th>结果回传时间</th>
              <th>数据回传地址</th>
              <th>录音获取数量</th>
              <th>录音回传结果</th>
              <th>录音回传时间</th>
              <th>录音回传地址</th>
              <th>呼叫时间</th>
              <th title="取自 data.data.callInstance.duration，单位为秒">
                通话时长
              </th>
              <th title="每条通话不足一分钟按一分钟计算">计费时长</th>
              <th>客户话费单价</th>
              <th>客户话费</th>
              <th>影楼账户余额</th>
              <th>平台话费单价</th>
              <th>平台话费</th>
              <th>收益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td>
                  <div className="operation-cell">
                    <button
                      className="operation-trigger"
                      onClick={() =>
                        setActionMenuId(
                          actionMenuId === task.id ? null : task.id,
                        )
                      }
                      aria-expanded={actionMenuId === task.id}
                      aria-haspopup="menu"
                    >
                      操作 <ChevronDown size={13} />
                    </button>
                    {actionMenuId === task.id ? (
                      <div className="operation-menu" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => setActionMenuId(null)}
                        >
                          接口详情
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => setActionMenuId(null)}
                        >
                          号码详情
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => setActionMenuId(null)}
                        >
                          结果详情
                        </button>
                      </div>
                    ) : null}
                  </div>
                </td>
                <td>
                  <span className="mapping-code">{task.id}</span>
                </td>
                <td>
                  <b>{task.store}</b>
                </td>
                <td>{task.source}</td>
                <td>
                  <Status tone={task.tone}>{task.status}</Status>
                </td>
                <td>
                  <TaskCategoryCell
                    script={scriptsById.get(task.scriptId)}
                    loading={scriptsLoading}
                    failed={scriptsFailed}
                  />
                </td>
                <td>
                  <span className="task-script-cell">
                    <b>
                      {scriptsById.get(task.scriptId)?.robotName ?? task.script}
                    </b>
                    <code>#{task.scriptId}</code>
                  </span>
                </td>
                <td>
                  <TaskMappingVariables
                    aria-label="映射变量"
                    version={task.mappingVersion}
                    coverage={task.mappingCoverage}
                    variables={task.mappingVariables}
                  />
                </td>
                <td>{task.numbers}</td>
                <td>
                  <span className="mapping-code">{task.baiyingId}</span>
                </td>
                <td>
                  <b>{getTaskDisplayName(task)}</b>
                </td>
                <td>
                  <TaskLineCell
                    script={scriptsById.get(task.scriptId)}
                    loading={scriptsLoading}
                    failed={scriptsFailed}
                  />
                </td>
                <td>
                  <Status tone={statusTone(task.resultStatus)}>
                    {task.resultStatus}
                  </Status>
                </td>
                <td className="whitespace-nowrap">{task.resultAt}</td>
                <td>
                  <TaskCallbackAddress task={task} kind="data" />
                </td>
                <td>{task.recordingCount}</td>
                <td>
                  <Status
                    tone={
                      task.recordingStatus === '—'
                        ? 'gray'
                        : statusTone(task.recordingStatus)
                    }
                  >
                    {task.recordingStatus}
                  </Status>
                </td>
                <td className="whitespace-nowrap">{task.recordingAt}</td>
                <td>
                  <TaskCallbackAddress task={task} kind="recording" />
                </td>
                <td className="whitespace-nowrap">{task.createdAt}</td>
                <TaskBillingCells
                  task={task}
                  platformPricing={getTaskPlatformPricing(
                    task,
                    taskRows,
                    hainanRateTiers,
                    monthlySettlements,
                  )}
                  customerPricing={getTaskCustomerPricing(
                    task,
                    studioRateSettings,
                  )}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="task-pagination">
        <span>
          按呼叫时间倒序 · 第 {currentPage} / {totalPages} 页
        </span>
        <span>
          <button
            className="filter-button"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            上一页
          </button>
          <button
            className="filter-button"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </button>
        </span>
      </div>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="task-export-dialog">
          <DialogHeader className="task-export-dialog-header">
            <span className="task-export-eyebrow">TASK DATA EXPORT</span>
            <DialogTitle>导出呼叫任务</DialogTitle>
            <DialogDescription>
              按呼叫时间筛选数据，并选择适合接收方的数据口径。
            </DialogDescription>
          </DialogHeader>

          <section className="task-export-section">
            <header>
              <span>01</span>
              <div>
                <strong>选择呼叫时间范围</strong>
                <small>仅导出呼叫时间落在所选日期内的任务</small>
              </div>
            </header>
            <Popover
              open={exportDatePickerOpen}
              onOpenChange={setExportDatePickerOpen}
            >
              <PopoverTrigger className="task-export-date-trigger">
                <CalendarDays aria-hidden="true" size={17} />
                <span>
                  <small>呼叫时间</small>
                  <strong>{exportDateLabel}</strong>
                </span>
                <ChevronDown aria-hidden="true" size={14} />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={7}
                className="task-date-popover task-export-date-popover"
              >
                <header className="task-date-popover-header">
                  <div>
                    <strong>选择呼叫时间范围</strong>
                    <span>开始和结束日期均包含在导出范围内</span>
                  </div>
                </header>
                <div
                  className="task-date-popover-shortcuts"
                  aria-label="导出快捷日期"
                >
                  {(
                    [
                      ['today', '今天'],
                      ['yesterday', '昨天'],
                      ['week', '本周'],
                      ['month', '本月'],
                    ] as const
                  ).map(([preset, label]) => (
                    <button
                      type="button"
                      key={preset}
                      className={exportDatePreset === preset ? 'is-active' : ''}
                      onClick={() => applyExportDatePreset(preset)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Calendar
                  mode="range"
                  locale={zhCN}
                  numberOfMonths={2}
                  selected={exportDateRange}
                  defaultMonth={exportDateRange?.from}
                  onSelect={(range) => {
                    setExportStartDate(
                      range?.from ? formatDateInput(range.from) : '',
                    );
                    setExportEndDate(
                      range?.to ? formatDateInput(range.to) : '',
                    );
                    setExportDatePreset(range?.from ? 'custom' : '');
                  }}
                  className="task-date-calendar"
                />
                <footer className="task-date-popover-footer">
                  <span>{exportDateLabel}</span>
                  <button
                    type="button"
                    disabled={!exportStartDate || !exportEndDate}
                    onClick={() => setExportDatePickerOpen(false)}
                  >
                    完成
                  </button>
                </footer>
              </PopoverContent>
            </Popover>
          </section>

          <section className="task-export-section">
            <header>
              <span>02</span>
              <div>
                <strong>选择导出口径</strong>
                <small>不同接收方将获得不同的费用字段</small>
              </div>
            </header>
            <div className="task-export-mode-grid">
              {(
                [
                  {
                    value: 'all',
                    title: '全部导出',
                    description: '导出列表中的全部业务与费用字段',
                    icon: ListChecks,
                  },
                  {
                    value: 'studio',
                    title: '影楼导出',
                    description: '隐藏平台成本单价、平台话费与收益',
                    icon: Building2,
                  },
                  {
                    value: 'platform',
                    title: '平台导出',
                    description: '隐藏客户价格、客户话费与影楼余额',
                    icon: Database,
                  },
                ] as const
              ).map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    type="button"
                    key={mode.value}
                    aria-pressed={exportMode === mode.value}
                    className={`task-export-mode${exportMode === mode.value ? ' is-selected' : ''}`}
                    onClick={() => {
                      setExportMode(mode.value);
                      if (mode.value !== 'studio') setExportStudio('');
                    }}
                  >
                    <Icon aria-hidden="true" size={16} />
                    <span>
                      <strong>{mode.title}</strong>
                      <small>{mode.description}</small>
                    </span>
                    <i>{exportMode === mode.value ? '已选择' : '选择'}</i>
                  </button>
                );
              })}
            </div>
            {exportMode === 'studio' ? (
              <div className="task-export-studio-field">
                <span>选择影楼</span>
                <UnifiedSelect
                  ariaLabel="导出影楼"
                  value={exportStudio}
                  placeholder="请选择需要导出的影楼"
                  popupLabel="选择需要导出的影楼"
                  options={initialStudios.map((studio) => ({
                    value: studio.name,
                    label: studio.name,
                    description: studio.id,
                  }))}
                  onValueChange={setExportStudio}
                />
              </div>
            ) : null}
          </section>

          <div className="task-export-summary">
            <span>
              <Download aria-hidden="true" size={15} />
            </span>
            <div>
              <strong>
                {exportMode === 'studio' && !exportStudio
                  ? '选择影楼后计算可导出数据'
                  : `预计导出 ${exportRows.length} 条任务`}
              </strong>
              <small>文件格式 CSV · UTF-8 编码，可直接使用 Excel 打开</small>
            </div>
          </div>

          <DialogFooter className="task-export-dialog-footer">
            <button
              type="button"
              className="task-export-cancel"
              onClick={() => setExportOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="task-export-submit"
              disabled={
                !exportStartDate ||
                !exportEndDate ||
                (exportMode === 'studio' && !exportStudio) ||
                exportRows.length === 0
              }
              onClick={exportTaskData}
            >
              <Download aria-hidden="true" size={14} />
              导出 CSV
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function OverviewView() {
  return (
    <>
      <PageIntro
        eyebrow="OPERATIONS OVERVIEW"
        title="总览"
        summary="聚焦今天需要处理的外呼、余额与异常。业务任务由 ERP/CRM 创建，平台只负责校验、调度和留痕。"
      />
      <div className="metric-grid">
        <Metric
          label="今日外呼任务"
          value="24"
          note="ERP 15 · CRM 9"
          color="#4fad78"
        />
        <Metric
          label="正在呼叫"
          value="1,842"
          note="全局容量占用 68%"
          color="#4a9bc2"
        />
        <Metric
          label="已冻结话费"
          value="¥49,780"
          note="按 2 分钟 / 号码冻结"
          color="#d49a37"
        />
        <Metric
          label="待人工处理"
          value="17"
          note="3 项为高优先级"
          color="#c7625b"
        />
      </div>
      <div className="split-grid">
        <Panel title="今日任务走向" meta="09:00 – 20:30">
          <div className="chart-wrap">
            <div className="chart-labels">
              <span>有效接通</span>
              <b>7,268</b>
              <small>较昨日 +12.6%</small>
            </div>
            <div className="bars">
              {[38, 48, 43, 62, 70, 57, 88, 76, 95, 73, 64, 82].map(
                (height, index) => (
                  <div className="bar-column" key={index}>
                    <i style={{ height: `${height}%` }} />
                    <small>{9 + index}:00</small>
                  </div>
                ),
              )}
            </div>
          </div>
        </Panel>
        <Panel title="需要处理" meta="按优先级">
          <div className="timeline">
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>罗曼映像 · 任务等待容量</b>
              <p>全局资源余量不足，下一次自动复检：09:35。</p>
            </div>
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>晨光摄影 · 余额不足暂停</b>
              <p>待拨 2,800 人，需先充值并满足启动冻结。</p>
            </div>
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>未知任务回调 · 1 条</b>
              <p>已隔离原始报文，等待人工映射。</p>
            </div>
          </div>
        </Panel>
      </div>
      <div className="mt-[14px]">
        <TaskTable />
      </div>
    </>
  );
}

type StudioStatus = '正常' | '停用';
type BalanceTab = '全部' | '余额充足' | '余额不足' | '欠费';
type StudioModal =
  | 'create'
  | 'edit'
  | 'disable'
  | 'enable'
  | 'recharge'
  | 'refund'
  | null;

type Studio = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  balance: number;
  taskCount: number;
  rate: string;
  minutes: number;
  mcCode: string;
  erpUrl: string;
  crmUrl: string;
  erpRecordingUrl: string;
  crmRecordingUrl: string;
  status: StudioStatus;
  createdAt: string;
  creator: string;
};

const initialStudios: Studio[] = [
  {
    id: 'YL-202609-0006',
    name: '晨光摄影',
    contact: '周敏',
    phone: '139****5578',
    balance: 280,
    taskCount: 6,
    rate: '0.48',
    minutes: 3820,
    mcCode: 'MC-CG-102',
    erpUrl: 'https://erp.chenguang.example/callback',
    crmUrl: 'https://crm.chenguang.example/callback',
    erpRecordingUrl: 'https://erp.chenguang.example/recording-callback',
    crmRecordingUrl: 'https://crm.chenguang.example/recording-callback',
    status: '正常',
    createdAt: '2026-09-02 09:16:24',
    creator: '王琪',
  },
  {
    id: 'YL-202609-0005',
    name: '罗曼映像',
    contact: '李卓',
    phone: '185****0986',
    balance: -80.5,
    taskCount: 11,
    rate: '0.48',
    minutes: 6470,
    mcCode: 'MC-LM-064',
    erpUrl: 'https://erp.luoman.example/callback',
    crmUrl: '',
    erpRecordingUrl: 'https://erp.luoman.example/recording-callback',
    crmRecordingUrl: '',
    status: '正常',
    createdAt: '2026-09-01 16:48:06',
    creator: '王琪',
  },
  {
    id: 'YL-202609-0004',
    name: '紫藤影像',
    contact: '陈思',
    phone: '138****8210',
    balance: 13279.4,
    taskCount: 24,
    rate: '0.48',
    minutes: 26840,
    mcCode: 'MC-ZTY-001',
    erpUrl: 'https://erp.ziteng.example/callback',
    crmUrl: 'https://crm.ziteng.example/callback',
    erpRecordingUrl: 'https://erp.ziteng.example/recording-callback',
    crmRecordingUrl: 'https://crm.ziteng.example/recording-callback',
    status: '正常',
    createdAt: '2026-09-01 14:20:31',
    creator: '王琪',
  },
  {
    id: 'YL-202609-0003',
    name: '远山摄影',
    contact: '吴倩',
    phone: '186****1932',
    balance: 4315.8,
    taskCount: 13,
    rate: '0.48',
    minutes: 15259,
    mcCode: 'MC-YS-028',
    erpUrl: 'https://erp.yuanshan.example/callback',
    crmUrl: '',
    erpRecordingUrl: 'https://erp.yuanshan.example/recording-callback',
    crmRecordingUrl: '',
    status: '正常',
    createdAt: '2026-08-31 10:12:48',
    creator: '李萌',
  },
  {
    id: 'YL-202609-0002',
    name: '白屿婚纱摄影',
    contact: '许宁',
    phone: '137****1263',
    balance: 860,
    taskCount: 3,
    rate: '0.48',
    minutes: 970,
    mcCode: 'MC-BY-019',
    erpUrl: '',
    crmUrl: 'https://crm.baiyu.example/callback',
    erpRecordingUrl: '',
    crmRecordingUrl: 'https://crm.baiyu.example/recording-callback',
    status: '停用',
    createdAt: '2026-08-29 17:35:09',
    creator: '王琪',
  },
];

const getBalanceTab = (balance: number): Exclude<BalanceTab, '全部'> =>
  balance <= 0 ? '欠费' : balance < 500 ? '余额不足' : '余额充足';
const formatMoney = (amount: number) =>
  `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const studioFormDefaults = {
  name: '',
  contact: '',
  phone: '',
  mcCode: '',
  erpUrl: '',
  crmUrl: '',
  erpRecordingUrl: '',
  crmRecordingUrl: '',
};

export function StudioView() {
  const [studios, setStudios] = useState(initialStudios);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | StudioStatus>(
    '全部',
  );
  const [balanceTab, setBalanceTab] = useState<BalanceTab>('全部');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<StudioModal>(null);
  const [activeStudio, setActiveStudio] = useState<Studio | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [form, setForm] = useState(studioFormDefaults);
  const [feedback, setFeedback] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [receiptError, setReceiptError] = useState('');

  const filteredStudios = useMemo(
    () =>
      studios.filter((studio) => {
        const matchesKeyword =
          `${studio.id}${studio.name}${studio.contact}${studio.phone}`
            .toLowerCase()
            .includes(keyword.toLowerCase());
        return (
          matchesKeyword &&
          (statusFilter === '全部' || studio.status === statusFilter) &&
          (balanceTab === '全部' ||
            getBalanceTab(studio.balance) === balanceTab)
        );
      }),
    [studios, keyword, statusFilter, balanceTab],
  );
  const totalPages = Math.max(1, Math.ceil(filteredStudios.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedStudios = filteredStudios.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const tabCounts = (tab: BalanceTab) =>
    tab === '全部'
      ? studios.length
      : studios.filter((studio) => getBalanceTab(studio.balance) === tab)
          .length;
  const openModal = (
    nextModal: Exclude<StudioModal, null>,
    studio?: Studio,
  ) => {
    setFeedback('');
    setActionMenuId(null);
    setActiveStudio(studio ?? null);
    setForm(
      studio
        ? {
            name: studio.name,
            contact: studio.contact,
            phone: studio.phone,
            mcCode: studio.mcCode,
            erpUrl: studio.erpUrl,
            crmUrl: studio.crmUrl,
            erpRecordingUrl: studio.erpRecordingUrl,
            crmRecordingUrl: studio.crmRecordingUrl,
          }
        : studioFormDefaults,
    );
    setTransactionAmount('');
    setReceiptName('');
    setReceiptError('');
    setModal(nextModal);
  };
  const closeModal = () => {
    setModal(null);
    setActiveStudio(null);
    setTransactionAmount('');
    setReceiptName('');
    setReceiptError('');
  };
  const saveStudio = (event: {
    preventDefault(): void;
    currentTarget: HTMLFormElement;
  }) => {
    event.preventDefault();
    if (modal === 'create') {
      const nextId = `YL-202609-${String(studios.length + 2).padStart(4, '0')}`;
      setStudios((current) => [
        {
          id: nextId,
          ...form,
          balance: 0,
          taskCount: 0,
          rate: '0.48',
          minutes: 0,
          status: '正常',
          createdAt: '2026-09-02 10:05:00',
          creator: '平台管理员',
        },
        ...current,
      ]);
      setFeedback('影楼已新增，默认状态为正常。');
    } else if (activeStudio) {
      setStudios((current) =>
        current.map((studio) =>
          studio.id === activeStudio.id ? { ...studio, ...form } : studio,
        ),
      );
      setFeedback('影楼信息已更新。');
    }
    closeModal();
  };
  const saveAction = (event: {
    preventDefault(): void;
    currentTarget: HTMLFormElement;
  }) => {
    event.preventDefault();
    if (!activeStudio || !modal) return;
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get('amount') || 0);
    const actionLabels = {
      disable: '影楼已停用，停用期间不允许拨打电话。',
      enable: '影楼已启用。',
      recharge: `充值成功，已加入账户余额 ${formatMoney(amount)}。`,
      refund: `退款成功，账户余额已扣减 ${formatMoney(amount)}。`,
    };
    setStudios((current) =>
      current.map((studio) => {
        if (studio.id !== activeStudio.id) return studio;
        if (modal === 'disable') return { ...studio, status: '停用' };
        if (modal === 'enable') return { ...studio, status: '正常' };
        if (modal === 'recharge')
          return { ...studio, balance: studio.balance + amount };
        if (modal === 'refund')
          return { ...studio, balance: studio.balance - amount };
        return studio;
      }),
    );
    setFeedback(
      actionLabels[modal as Exclude<StudioModal, 'create' | 'edit' | null>],
    );
    closeModal();
  };
  const changePage = (next: number) =>
    setPage(Math.max(1, Math.min(next, totalPages)));
  const setTab = (tab: BalanceTab) => {
    setBalanceTab(tab);
    setPage(1);
  };

  const transactionValue = Number(transactionAmount) || 0;
  const isMoneyAction = modal === 'recharge' || modal === 'refund';
  const canSaveTransaction = transactionValue > 0 && Boolean(receiptName);
  const setReceiptFromFile = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) {
      setReceiptName('');
      setReceiptError('仅支持 JPG、PNG 或 PDF 格式的凭证。');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setReceiptName('');
      setReceiptError('凭证文件不能超过 10 MB。');
      return;
    }
    setReceiptName(file.name || '已粘贴凭证');
    setReceiptError('');
  };

  return (
    <>
      <header className="studio-page-intro">
        <div className="studio-page-heading">
          <h2>影楼管理</h2>
          <p>
            维护影楼账户、余额、外呼任务与 ERP/CRM
            回传地址；停用状态下即使账户有余额也不可拨打电话。
          </p>
        </div>
        <button className="primary-button" onClick={() => openModal('create')}>
          + 新增影楼
        </button>
      </header>
      {feedback ? <div className="notice mb-[14px]">{feedback}</div> : null}
      <Panel
        title="影楼列表"
        meta={`共 ${filteredStudios.length} 家`}
        className="studio-list-panel"
      >
        <div className="flex flex-wrap gap-2 border-b border-[#edf0ec] px-[17px] pt-3">
          {(['全部', '余额充足', '余额不足', '欠费'] as BalanceTab[]).map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setTab(tab)}
                className={`border-b-2 px-1 pb-3 text-[12px] ${balanceTab === tab ? 'border-[#31785d] text-[#1b624b] font-semibold' : 'border-transparent text-[#748079]'}`}
              >
                {tab}{' '}
                <span className="ml-1 rounded-full bg-[#f0f4f1] px-1.5 py-0.5 text-[10px]">
                  {tabCounts(tab)}
                </span>
              </button>
            ),
          )}
        </div>
        <div className="toolbar">
          <label className="search-box">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="搜索影楼编号、影楼名称、联系人或联系人手机号"
            />
          </label>
          <UnifiedSelect
            ariaLabel="影楼状态"
            className="filter-button"
            value={statusFilter}
            popupLabel="按影楼状态筛选"
            options={[
              { value: '全部', label: '全部状态' },
              { value: '正常', label: '正常' },
              { value: '停用', label: '停用' },
            ]}
            onValueChange={(value) => {
              setStatusFilter(value as '全部' | StudioStatus);
              setPage(1);
            }}
          />
          <UnifiedSelect
            ariaLabel="每页展示数量"
            className="filter-button"
            value={String(pageSize)}
            popupLabel="每页展示数量"
            options={[
              { value: '20', label: '20 条 / 页' },
              { value: '50', label: '50 条 / 页' },
              { value: '100', label: '100 条 / 页' },
            ]}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          />
        </div>
        <div className="table-wrap">
          <table className="data-table studio-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>影楼编号</th>
                <th>影楼名称</th>
                <th>联系人</th>
                <th>联系人手机号</th>
                <th>账户余额</th>
                <th>余额状态</th>
                <th>任务数量</th>
                <th>电话费（分钟 / 元）</th>
                <th>已拨打分钟数</th>
                <th>MC code</th>
                <th>ERP 回传地址</th>
                <th>ERP 录音回传地址</th>
                <th>CRM 回传地址</th>
                <th>CRM 录音回传地址</th>
                <th>影楼状态</th>
                <th>创建时间</th>
                <th>创建人</th>
              </tr>
            </thead>
            <tbody>
              {pagedStudios.map((studio) => {
                const balanceTabName = getBalanceTab(studio.balance);
                const balanceTone =
                  balanceTabName === '余额充足'
                    ? 'green'
                    : balanceTabName === '余额不足'
                      ? 'amber'
                      : 'red';
                return (
                  <tr key={studio.id}>
                    <td>
                      <div className="operation-cell">
                        <button
                          className="operation-trigger"
                          onClick={() =>
                            setActionMenuId(
                              actionMenuId === studio.id ? null : studio.id,
                            )
                          }
                          aria-expanded={actionMenuId === studio.id}
                          aria-haspopup="menu"
                        >
                          操作 <ChevronDown size={13} />
                        </button>
                        {actionMenuId === studio.id ? (
                          <div className="operation-menu" role="menu">
                            <button
                              role="menuitem"
                              onClick={() => openModal('edit', studio)}
                            >
                              编辑
                            </button>
                            {studio.status === '正常' ? (
                              <button
                                role="menuitem"
                                className="operation-danger"
                                onClick={() => openModal('disable', studio)}
                              >
                                停用
                              </button>
                            ) : (
                              <button
                                role="menuitem"
                                onClick={() => openModal('enable', studio)}
                              >
                                启用
                              </button>
                            )}
                            <button
                              role="menuitem"
                              onClick={() => openModal('recharge', studio)}
                            >
                              充值
                            </button>
                            <button
                              role="menuitem"
                              className="operation-danger"
                              onClick={() => openModal('refund', studio)}
                            >
                              退款
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="mapping-code">{studio.id}</span>
                    </td>
                    <td>
                      <b>{studio.name}</b>
                    </td>
                    <td>{studio.contact}</td>
                    <td>{studio.phone}</td>
                    <td>
                      <b>{formatMoney(studio.balance)}</b>
                    </td>
                    <td>
                      <Status tone={balanceTone}>{balanceTabName}</Status>
                    </td>
                    <td>{studio.taskCount}</td>
                    <td>{studio.rate}</td>
                    <td>{studio.minutes.toLocaleString('zh-CN')}</td>
                    <td>
                      <span className="mapping-code">{studio.mcCode}</span>
                    </td>
                    <td
                      className="max-w-[180px] truncate"
                      title={studio.erpUrl}
                    >
                      {studio.erpUrl || '—'}
                    </td>
                    <td
                      className="max-w-[180px] truncate"
                      title={studio.erpRecordingUrl}
                    >
                      {studio.erpRecordingUrl || '—'}
                    </td>
                    <td
                      className="max-w-[180px] truncate"
                      title={studio.crmUrl}
                    >
                      {studio.crmUrl || '—'}
                    </td>
                    <td
                      className="max-w-[180px] truncate"
                      title={studio.crmRecordingUrl}
                    >
                      {studio.crmRecordingUrl || '—'}
                    </td>
                    <td>
                      <Status
                        tone={studio.status === '正常' ? 'green' : 'gray'}
                      >
                        {studio.status}
                      </Status>
                    </td>
                    <td className="whitespace-nowrap">{studio.createdAt}</td>
                    <td>{studio.creator}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ec] px-[17px] py-3 text-[11px] text-[#748079]">
          <span>
            按创建时间倒序 · 第 {currentPage} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              className="filter-button h-7"
              disabled={currentPage === 1}
              onClick={() => changePage(currentPage - 1)}
            >
              上一页
            </button>
            <button
              className="filter-button h-7"
              disabled={currentPage === totalPages}
              onClick={() => changePage(currentPage + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </Panel>
      {modal ? (
        <dialog
          open
          className="studio-dialog-backdrop"
          aria-labelledby="studio-dialog-title"
        >
          <div className="studio-dialog-panel w-full max-w-[560px] rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#edf0ec] px-5 py-4">
              <h3
                id="studio-dialog-title"
                className="font-[Songti_SC,STSong,serif] text-[20px] text-[#1b3832]"
              >
                {modal === 'create'
                  ? '新增影楼'
                  : modal === 'edit'
                    ? '编辑影楼'
                    : modal === 'disable'
                      ? '停用影楼'
                      : modal === 'enable'
                        ? '启用影楼'
                        : modal === 'recharge'
                          ? '影楼充值'
                          : '影楼退款'}
              </h3>
              <button
                aria-label="关闭"
                className="text-lg text-[#748079]"
                onClick={closeModal}
              >
                ×
              </button>
            </div>
            {modal === 'create' || modal === 'edit' ? (
              <form onSubmit={saveStudio} className="studio-profile-form">
                <div className="profile-form-intro">
                  <span className="profile-step">01</span>
                  <div>
                    <b>完善影楼资料</b>
                    <p>先填写基本身份和联系人，再按需要配置系统回传地址。</p>
                  </div>
                </div>
                <section className="profile-form-section">
                  <div className="profile-section-heading">
                    <b>基本资料</b>
                    <p>这些信息将展示在影楼列表中。</p>
                  </div>
                  <div className="profile-fields-grid">
                    <label className="profile-field">
                      影楼名称 <i>*</i>
                      <input
                        required
                        value={form.name}
                        onChange={(event) =>
                          setForm({ ...form, name: event.target.value })
                        }
                        placeholder="例如：晨光摄影"
                        autoFocus
                      />
                    </label>
                    <label className="profile-field">
                      联系人 <i>*</i>
                      <input
                        required
                        value={form.contact}
                        onChange={(event) =>
                          setForm({ ...form, contact: event.target.value })
                        }
                        placeholder="请输入联系人姓名"
                      />
                    </label>
                    <label className="profile-field">
                      联系人手机号 <i>*</i>
                      <input
                        required
                        value={form.phone}
                        onChange={(event) =>
                          setForm({ ...form, phone: event.target.value })
                        }
                        placeholder="例如：138 0000 0000"
                        inputMode="tel"
                      />
                    </label>
                    <label className="profile-field">
                      MC code <i>*</i>
                      <input
                        required
                        value={form.mcCode}
                        onChange={(event) =>
                          setForm({ ...form, mcCode: event.target.value })
                        }
                        placeholder="例如：MC-CG-102"
                      />
                    </label>
                  </div>
                </section>
                <section className="profile-form-section profile-callback-section">
                  <div className="profile-section-heading">
                    <b>
                      系统回传地址 <small>可选</small>
                    </b>
                    <p>分别配置数据与录音回传地址；暂不配置也可先保存影楼。</p>
                  </div>
                  <div className="profile-fields-grid">
                    <label className="profile-field">
                      ERP 数据回传地址
                      <input
                        type="url"
                        value={form.erpUrl}
                        onChange={(event) =>
                          setForm({ ...form, erpUrl: event.target.value })
                        }
                        placeholder="https://erp.example.com/data-callback"
                      />
                    </label>
                    <label className="profile-field">
                      ERP 录音回传地址
                      <input
                        type="url"
                        value={form.erpRecordingUrl}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            erpRecordingUrl: event.target.value,
                          })
                        }
                        placeholder="https://erp.example.com/recording-callback"
                      />
                    </label>
                    <label className="profile-field">
                      CRM 数据回传地址
                      <input
                        type="url"
                        value={form.crmUrl}
                        onChange={(event) =>
                          setForm({ ...form, crmUrl: event.target.value })
                        }
                        placeholder="https://crm.example.com/data-callback"
                      />
                    </label>
                    <label className="profile-field">
                      CRM 录音回传地址
                      <input
                        type="url"
                        value={form.crmRecordingUrl}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            crmRecordingUrl: event.target.value,
                          })
                        }
                        placeholder="https://crm.example.com/recording-callback"
                      />
                    </label>
                  </div>
                </section>
                <div className="studio-form-footer">
                  <p>
                    <b>*</b> 为必填项，保存后可在操作菜单中继续维护账户信息。
                  </p>
                  <div>
                    <button
                      type="button"
                      className="filter-button"
                      onClick={closeModal}
                    >
                      取消
                    </button>
                    <button className="primary-button">
                      {modal === 'create' ? '创建影楼' : '保存修改'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <form onSubmit={saveAction} className="p-5">
                <>
                  {isMoneyAction ? (
                    <div className="transaction-flow">
                      <div className="transaction-context">
                        <div>
                          <span>本次操作对象</span>
                          <b>{activeStudio?.name}</b>
                          <small>{activeStudio?.id}</small>
                        </div>
                        <div>
                          <span>当前账户余额</span>
                          <strong>
                            {formatMoney(activeStudio?.balance ?? 0)}
                          </strong>
                        </div>
                      </div>
                      <div className="transaction-intro">
                        <b>
                          {modal === 'recharge'
                            ? '确认到账后，金额会计入可用余额。'
                            : '确认退款后，金额会从可用余额中扣减。'}
                        </b>
                        <p>
                          请先填写实际金额并上传对应凭证，确认后将同步更新账户余额。
                        </p>
                      </div>
                      <div className="transaction-fields">
                        <label className="field-label">
                          {modal === 'recharge' ? '到账金额' : '退款金额'}{' '}
                          <b className="text-[#b64c46]">*</b>
                          <span className="amount-control">
                            <i>¥</i>
                            <input
                              required
                              min="0.01"
                              step="0.01"
                              name="amount"
                              type="number"
                              inputMode="decimal"
                              value={transactionAmount}
                              onChange={(event) =>
                                setTransactionAmount(event.target.value)
                              }
                              placeholder="请输入金额"
                              aria-describedby="balance-preview"
                            />
                          </span>
                        </label>
                        {modal === 'refund' ? (
                          <label className="field-label">
                            退款原因 <b className="text-[#b64c46]">*</b>
                            <textarea
                              required
                              name="reason"
                              className="rate-input mt-1 h-20 py-2"
                              placeholder="请说明退款原因"
                            />
                          </label>
                        ) : null}
                        <div
                          className="transaction-result"
                          id="balance-preview"
                        >
                          <span>
                            {modal === 'recharge'
                              ? '入账后可用余额'
                              : '扣减后可用余额'}
                          </span>
                          <b>
                            {formatMoney(
                              (activeStudio?.balance ?? 0) +
                                (modal === 'recharge'
                                  ? transactionValue
                                  : -transactionValue),
                            )}
                          </b>
                        </div>
                        <label
                          className="receipt-upload"
                          htmlFor="transaction-receipt"
                          onPaste={(event) => {
                            const pastedFile = event.clipboardData.files?.[0];
                            if (pastedFile) {
                              event.preventDefault();
                              setReceiptFromFile(pastedFile);
                            }
                          }}
                        >
                          <input
                            id="transaction-receipt"
                            name="receipt"
                            type="file"
                            accept="image/png,image/jpeg,application/pdf"
                            onChange={(event) =>
                              setReceiptFromFile(event.target.files?.[0])
                            }
                          />
                          <Upload size={18} />
                          <span>
                            <b>
                              {receiptName
                                ? '已选择凭证'
                                : `上传${modal === 'recharge' ? '付款' : '退款'}凭证`}
                            </b>
                            <small>
                              {receiptName ||
                                '支持点击选择或直接粘贴 JPG、PNG、PDF，单个文件不超过 10 MB'}
                            </small>
                            {receiptError ? (
                              <small className="receipt-error">
                                {receiptError}
                              </small>
                            ) : null}
                          </span>
                          <em>{receiptName ? '更换文件' : '选择文件'}</em>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] leading-6 text-[#68746e]">
                      {modal === 'disable' ? (
                        <>
                          停用后，<b>{activeStudio?.name}</b> 即使余额大于 0
                          也不能拨打电话。
                        </>
                      ) : (
                        <>
                          确认启用 <b>{activeStudio?.name}</b>？
                        </>
                      )}
                    </p>
                  )}
                  {modal === 'disable' ? (
                    <label className="field-label mt-4">
                      停用原因 <b className="text-[#b64c46]">*</b>
                      <textarea
                        required
                        name="reason"
                        className="rate-input mt-1 h-20 py-2"
                      />
                    </label>
                  ) : null}
                </>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    className="filter-button"
                    onClick={closeModal}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={isMoneyAction && !canSaveTransaction}
                  >
                    {modal === 'enable'
                      ? '确认启用'
                      : modal === 'disable'
                        ? '确认停用'
                        : modal === 'recharge'
                          ? '确认充值入账'
                          : '确认退款扣减'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </dialog>
      ) : null}
    </>
  );
}

export function TaskView() {
  return (
    <div className="task-view task-list-view">
      <header className="task-page-intro">
        <div>
          <h2>呼叫任务</h2>
          <p>直接读取平台数据库，查看任务状态、计费余额、通话结果与录音归档进度。</p>
        </div>
      </header>
      <OutboundTaskConsole />
    </div>
  );
}

const scriptStatusMeta: Record<
  BaiyingScriptStatus,
  { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' | 'red' }
> = {
  0: { label: '待发布', tone: 'gray' },
  1: { label: '待审核', tone: 'amber' },
  2: { label: '待录音', tone: 'blue' },
  3: { label: '待上线', tone: 'blue' },
  4: { label: '审核不通过', tone: 'red' },
  5: { label: '已上线', tone: 'green' },
};

export function ScriptListView() {
  const studios = initialStudios.filter((studio) => studio.status === '正常');
  const [scripts, setScripts] = useState<BaiyingScript[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [pageNum, setPageNum] = useState(0);
  const [scope, setScope] = useState<0 | 1 | 2>(0);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bindingScript, setBindingScript] = useState<BaiyingScript | null>(
    null,
  );
  const [sourceSystem, setSourceSystem] = useState<'ERP' | 'CRM'>('ERP');
  const [categories, setCategories] = useState<SourceDataCategory[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [studioId, setStudioId] = useState('');
  const [lineId, setLineId] = useState('');
  const [lineOptions, setLineOptions] = useState<BaiyingLine[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState('');
  const [savingBinding, setSavingBinding] = useState(false);
  const [bindingError, setBindingError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadScripts({
      query: submittedQuery,
      robotStatus: scope,
      pageNum,
      pageSize: 20,
    })
      .then((page) => {
        if (cancelled) return;
        setScripts(page.scripts);
        setTotal(page.total);
        setPages(page.pages);
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : '话术列表加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageNum, refreshKey, scope, submittedQuery]);

  useEffect(() => {
    if (!bindingScript) return;
    let cancelled = false;
    void loadSourceCategories(sourceSystem)
      .then(({ categories: sourceCategories }) => {
        if (cancelled) return;
        setCategories(sourceCategories);
        const savedCategories =
          bindingScript.binding?.sourceSystem === sourceSystem
            ? bindingScript.binding.categories
            : [];
        if (savedCategories.length) {
          setSelectedCategoryIds(
            savedCategories.flatMap((saved) => {
              const current = sourceCategories.find(
                (category) =>
                  category.externalId === saved.sourceCategoryId ||
                  category.categoryPath === saved.categoryPath,
              );
              return current ? [current.externalId] : [];
            }),
          );
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setBindingError(
            requestError instanceof Error
              ? requestError.message
              : '数据分类加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setCategoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bindingScript, sourceSystem]);

  useEffect(() => {
    if (!bindingScript) return;
    let cancelled = false;
    void loadManagedLines()
      .then(({ lines }) => {
        if (cancelled) return;
        setLineOptions(lines);
        setLineId((current) => current || lines[0]?.userPhoneId || '');
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setLineError(
            requestError instanceof Error
              ? requestError.message
              : '线路管理数据加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setLineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bindingScript]);

  const openBinding = (script: BaiyingScript) => {
    const binding = script.binding;
    setBindingScript(script);
    setSourceSystem(binding?.sourceSystem ?? 'ERP');
    setSelectedCategoryIds(
      binding?.categories.map((category) => category.sourceCategoryId) ?? [],
    );
    setCategoryQuery('');
    setStudioId(binding?.studioId ?? studios[0]?.id ?? '');
    setLineId(binding?.lineId ?? '');
    setLineOptions([]);
    setLineLoading(true);
    setLineError('');
    setCategories([]);
    setCategoryLoading(true);
    setBindingError('');
  };
  const changeSourceSystem = (nextSourceSystem: 'ERP' | 'CRM') => {
    setSourceSystem(nextSourceSystem);
    setSelectedCategoryIds([]);
    setCategoryQuery('');
    setCategories([]);
    setCategoryLoading(true);
    setBindingError('');
  };
  const requestRefresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((value) => value + 1);
  };
  const submitSearch = (event: { preventDefault(): void }) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPageNum(0);
    setSubmittedQuery(query.trim());
    setRefreshKey((value) => value + 1);
  };
  const selectedCategories = categories.filter((category) =>
    selectedCategoryIds.includes(category.externalId),
  );
  const categoryGroups = useMemo(() => {
    const needle = categoryQuery.trim().toLocaleLowerCase('zh-CN');
    const filtered = categories.filter(
      (category) =>
        !needle ||
        `${category.name} ${category.categoryPath} ${Object.values(category.fields).join(' ')}`
          .toLocaleLowerCase('zh-CN')
          .includes(needle),
    );
    const groups = new Map<string, Map<string, SourceDataCategory[]>>();
    for (const category of filtered) {
      const pathParts = category.categoryPath.split('-');
      const mainCategory =
        String(
          category.fields.main_category ?? pathParts[0] ?? '其他分类',
        ).trim() || '其他分类';
      const subCategory =
        String(
          category.fields.sub_category ?? pathParts[1] ?? '未分组',
        ).trim() || '未分组';
      const subgroups =
        groups.get(mainCategory) ?? new Map<string, SourceDataCategory[]>();
      const items = subgroups.get(subCategory) ?? [];
      items.push(category);
      subgroups.set(subCategory, items);
      groups.set(mainCategory, subgroups);
    }
    return Array.from(groups, ([name, subgroups]) => ({
      name,
      subgroups: Array.from(subgroups, ([name, items]) => ({ name, items })),
    }));
  }, [categories, categoryQuery]);
  const toggleCategory = (categoryId: string) =>
    setSelectedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : current.length >= 100
          ? current
          : [...current, categoryId],
    );
  const toggleSubgroupCategories = (subgroupCategories: SourceDataCategory[]) =>
    setSelectedCategoryIds((current) => {
      const subgroupIds = subgroupCategories.map(
        (category) => category.externalId,
      );
      const subgroupIdSet = new Set(subgroupIds);
      const allSelected = subgroupIds.every((id) => current.includes(id));
      if (allSelected) return current.filter((id) => !subgroupIdSet.has(id));
      const missingIds = subgroupIds.filter((id) => !current.includes(id));
      return [
        ...current,
        ...missingIds.slice(0, Math.max(0, 100 - current.length)),
      ];
    });
  const selectedStudio = studios.find((studio) => studio.id === studioId);
  const selectedLine = lineOptions.find((line) => line.userPhoneId === lineId);
  const canSaveBinding = Boolean(
    bindingScript &&
    selectedCategories.length &&
    selectedStudio &&
    selectedLine,
  );
  const saveBinding = async () => {
    if (
      !bindingScript ||
      !selectedCategories.length ||
      !selectedStudio ||
      !selectedLine
    )
      return;
    setSavingBinding(true);
    setBindingError('');
    try {
      const { binding } = await saveScriptBinding({
        robotDefId: bindingScript.robotDefId,
        sourceSystem,
        categories: selectedCategories.map((category) => ({
          sourceCategoryId: category.externalId,
          categoryPath: category.categoryPath,
        })),
        studioId: selectedStudio.id,
        studioName: selectedStudio.name,
        lineId: selectedLine.userPhoneId,
        lineName: selectedLine.phoneName || selectedLine.phone,
      });
      setScripts((current) =>
        current.map((script) =>
          script.robotDefId === bindingScript.robotDefId
            ? { ...script, binding }
            : script,
        ),
      );
      setBindingScript(null);
    } catch (requestError) {
      setBindingError(
        requestError instanceof Error
          ? requestError.message
          : '话术绑定保存失败',
      );
    } finally {
      setSavingBinding(false);
    }
  };
  const statusCounts = scripts.reduce<Record<BaiyingScriptStatus, number>>(
    (counts, script) => {
      counts[script.robotStatus] += 1;
      return counts;
    },
    { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  );

  return (
    <div className="planned-task-page script-list-page">
      <PageIntro
        eyebrow="BAIYING ROBOT LIBRARY"
        title="话术列表"
        summary="实时读取百应“获取话术列表”接口，按接口返回的话术名称、状态、行业和上线时间展示；平台仅维护业务绑定，不修改百应话术。"
        action={
          <button
            className="primary-button planned-refresh-button"
            onClick={requestRefresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
            同步百应话术
          </button>
        }
      />
      <section className="planned-overview" aria-label="话术列表概览">
        <div>
          <span>接口返回话术</span>
          <b>{loading && !total ? '—' : total}</b>
          <small>当前筛选范围</small>
        </div>
        <div>
          <span>当前页已上线</span>
          <b>{statusCounts[5]}</b>
          <small>状态 5</small>
        </div>
        <div>
          <span>当前页待发布</span>
          <b>{statusCounts[0]}</b>
          <small>状态 0</small>
        </div>
        <div>
          <span>当前页已完成绑定</span>
          <b>{scripts.filter((script) => script.binding).length}</b>
          <small>分类 / 影楼 / 线路</small>
        </div>
      </section>
      <Panel
        title="百应话术"
        meta={
          loading
            ? '正在同步接口…'
            : `共 ${total} 个 · 第 ${Math.min(pageNum + 1, Math.max(pages, 1))} / ${Math.max(pages, 1)} 页`
        }
        className="planned-card-panel"
      >
        <form className="planned-toolbar" onSubmit={submitSearch}>
          <label className="search-box">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按话术名称或话术 ID 搜索"
            />
          </label>
          <UnifiedSelect
            ariaLabel="话术查询范围"
            className="filter-button"
            value={String(scope)}
            popupLabel="选择话术查询范围"
            options={[
              { value: '0', label: '所有话术' },
              { value: '1', label: '仅已上线' },
              { value: '2', label: '所有发布过的话术' },
            ]}
            onValueChange={(value) => {
              setLoading(true);
              setError('');
              setScope(Number(value) as 0 | 1 | 2);
              setPageNum(0);
            }}
          />
          <button className="filter-button" type="submit">
            查询
          </button>
        </form>
        <div className="planned-api-note">
          <span>百应实时数据</span>
          <p>
            卡片字段全部来自 robot-list
            接口；数据分类、影楼和线路是本平台保存的调度绑定。
          </p>
        </div>
        {error ? (
          <div className="planned-state">
            <span className="planned-state-mark">!</span>
            <b>未能读取百应话术列表</b>
            <p>{error}</p>
            <button className="filter-button" onClick={requestRefresh}>
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div className="planned-card-grid" aria-label="正在加载话术列表">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="planned-card planned-card-loading" key={index}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : scripts.length ? (
          <div className="planned-card-grid script-card-grid">
            {scripts.map((script) => {
              const statusMeta = scriptStatusMeta[script.robotStatus];
              const industry = [script.industryOneName, script.industryTwoName]
                .filter(Boolean)
                .join(' / ');
              const categorySummary = script.binding?.categories.length
                ? `${script.binding.sourceSystem} · ${script.binding.categories[0].categoryPath}${script.binding.categories.length > 1 ? ` 等 ${script.binding.categories.length} 个` : ''}`
                : '未绑定';
              return (
                <article
                  className="planned-card script-card"
                  key={script.robotDefId}
                >
                  <header>
                    <div>
                      <span
                        className={`planned-status planned-status-${statusMeta.tone}`}
                      >
                        {statusMeta.label}
                      </span>
                      <small>状态 {script.robotStatus}</small>
                    </div>
                    <code>#{script.robotDefId}</code>
                  </header>
                  <h3>{script.robotName}</h3>
                  <dl className="script-card-details">
                    <div>
                      <dt>所属行业</dt>
                      <dd>{industry || '接口未返回'}</dd>
                    </div>
                    <div>
                      <dt>上线时间</dt>
                      <dd>{script.deployTime || '尚未上线'}</dd>
                    </div>
                  </dl>
                  <div
                    className={`script-binding-summary ${script.binding ? 'is-bound' : ''}`}
                  >
                    <div>
                      <span>数据分类</span>
                      <b>{categorySummary}</b>
                    </div>
                    <div>
                      <span>影楼</span>
                      <b>{script.binding?.studioName ?? '未绑定'}</b>
                    </div>
                    <div>
                      <span>线路</span>
                      <b>{script.binding?.lineName ?? '未绑定'}</b>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="script-bind-button"
                    onClick={() => openBinding(script)}
                  >
                    {script.binding ? '修改绑定' : '配置绑定'}{' '}
                    <ChevronRight size={13} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="planned-state">
            <span className="planned-state-mark">0</span>
            <b>没有符合条件的百应话术</b>
            <p>请调整话术名称或查询范围后重试。</p>
          </div>
        )}
        <footer className="planned-pagination">
          <span>查询范围直接对应百应接口的 robotStatus 参数。</span>
          <div>
            <button
              className="filter-button"
              disabled={loading || pageNum <= 0}
              onClick={() => {
                setLoading(true);
                setPageNum((value) => Math.max(0, value - 1));
              }}
            >
              上一页
            </button>
            <button
              className="filter-button"
              disabled={loading || pageNum + 1 >= pages}
              onClick={() => {
                setLoading(true);
                setPageNum((value) => value + 1);
              }}
            >
              下一页
            </button>
          </div>
        </footer>
      </Panel>
      <Dialog
        open={Boolean(bindingScript)}
        onOpenChange={(open) => {
          if (!open && !savingBinding) setBindingScript(null);
        }}
      >
        <DialogContent
          className="script-binding-dialog script-binding-dialog-wide max-w-[1040px]"
          showCloseButton={false}
        >
          <DialogHeader className="script-binding-dialog-header">
            <div>
              <DialogTitle>配置话术业务绑定</DialogTitle>
              <DialogDescription>
                先选择一个数据来源，再从本地分类库中勾选一个或多个分类；影楼和线路将作为创建呼叫任务时的调度依据。
              </DialogDescription>
            </div>
            <button
              type="button"
              className="dialog-icon-close"
              aria-label="关闭绑定弹窗"
              onClick={() => setBindingScript(null)}
              disabled={savingBinding}
            >
              <X size={16} />
            </button>
          </DialogHeader>
          <div className="script-binding-dialog-body script-binding-dialog-split">
            <aside
              className="script-binding-sidebar"
              aria-label="话术与调度信息"
            >
              <div className="script-binding-context">
                <div>
                  <span>当前话术</span>
                  <b>{bindingScript?.robotName}</b>
                </div>
                <code>#{bindingScript?.robotDefId}</code>
              </div>
              <section className="script-binding-side-section">
                <header>
                  <Building2 size={15} />
                  <div>
                    <b>影楼归属</b>
                    <p>指定使用该话术的业务影楼。</p>
                  </div>
                </header>
                <div className="profile-field">
                  影楼 <i>*</i>
                  <UnifiedSelect
                    ariaLabel="绑定影楼"
                    value={studioId}
                    placeholder="请选择影楼"
                    popupLabel="选择话术所属影楼"
                    options={studios.map((studio) => ({
                      value: studio.id,
                      label: `${studio.name} · ${studio.id}`,
                    }))}
                    onValueChange={setStudioId}
                  />
                </div>
              </section>
              <section className="script-binding-side-section">
                <header>
                  <Cable size={15} />
                  <div>
                    <b>外呼线路</b>
                    <p>线路取自“线路管理”中的本地数据。</p>
                  </div>
                </header>
                <div className="profile-field">
                  线路 <i>*</i>
                  <UnifiedSelect
                    ariaLabel="绑定线路"
                    value={lineId}
                    disabled={lineLoading || !lineOptions.length}
                    placeholder={
                      lineLoading
                        ? '正在读取线路管理…'
                        : lineOptions.length
                          ? '请选择线路'
                          : '线路管理中暂无线路'
                    }
                    popupLabel="选择话术使用线路"
                    options={[
                      ...(lineId &&
                      !lineOptions.some((line) => line.userPhoneId === lineId)
                        ? [
                            {
                              value: lineId,
                              label: '原绑定线路已不在线路管理中',
                              description: `#${lineId}`,
                            },
                          ]
                        : []),
                      ...lineOptions.map((line) => ({
                        value: line.userPhoneId,
                        label: line.phoneName || line.phone,
                        description: `#${line.userPhoneId}`,
                      })),
                    ]}
                    onValueChange={setLineId}
                  />
                </div>
                {lineError ? <p className="field-error">{lineError}</p> : null}
              </section>
              <div className="script-binding-readiness">
                <span>配置进度</span>
                <ul>
                  <li className={selectedStudio ? 'is-ready' : ''}>
                    <Check size={12} />
                    影楼
                  </li>
                  <li className={selectedLine ? 'is-ready' : ''}>
                    <Check size={12} />
                    线路
                  </li>
                  <li className={selectedCategories.length ? 'is-ready' : ''}>
                    <Check size={12} />
                    分类
                  </li>
                </ul>
                <p>
                  {canSaveBinding
                    ? '配置完整，可以保存本次业务绑定。'
                    : '完成三项配置后即可保存。'}
                </p>
              </div>
              {bindingError ? (
                <div className="notice alert">{bindingError}</div>
              ) : null}
            </aside>
            <section
              className="script-category-section script-binding-main"
              aria-label="数据分类选择"
            >
              <header>
                <Database size={15} />
                <div>
                  <b>数据分类</b>
                  <p>
                    分类来自“数据分类”菜单的本地快照，ERP 与 CRM 数据严格分开。
                  </p>
                </div>
                <span className="category-selected-count">
                  已选 {selectedCategoryIds.length} 个
                </span>
              </header>
              <fieldset className="planned-source-switch">
                <legend className="sr-only">数据来源</legend>
                <button
                  type="button"
                  className={sourceSystem === 'ERP' ? 'active source-erp' : ''}
                  onClick={() => changeSourceSystem('ERP')}
                >
                  ERP 分类
                </button>
                <button
                  type="button"
                  className={sourceSystem === 'CRM' ? 'active source-crm' : ''}
                  onClick={() => changeSourceSystem('CRM')}
                >
                  CRM 分类
                </button>
              </fieldset>
              <label className="category-search">
                <Search size={14} />
                <input
                  value={categoryQuery}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="搜索分类名称、路径或等级"
                />
                <small>
                  {categoryLoading
                    ? '正在读取本地分类…'
                    : `本地分类 ${categories.length} 项`}
                </small>
              </label>
              <div
                className="category-tree"
                role="tree"
                aria-label={`${sourceSystem} 数据分类，多选`}
                aria-multiselectable="true"
              >
                {categoryLoading ? (
                  <div className="category-picker-state">
                    正在读取本地分类快照…
                  </div>
                ) : categoryGroups.length ? (
                  categoryGroups.map((group, groupIndex) => {
                    const groupCount = group.subgroups.reduce(
                      (count, subgroup) => count + subgroup.items.length,
                      0,
                    );
                    return (
                      <details
                        className="category-tree-group"
                        open={Boolean(categoryQuery.trim()) || groupIndex === 0}
                        key={group.name}
                      >
                        <summary>
                          <span>
                            <ChevronRight size={13} />
                            {group.name}
                          </span>
                          <small>{groupCount} 项</small>
                        </summary>
                        <div className="category-tree-subgroups">
                          {group.subgroups.map((subgroup) => {
                            const selectedCount = subgroup.items.filter(
                              (category) =>
                                selectedCategoryIds.includes(
                                  category.externalId,
                                ),
                            ).length;
                            const allSelected =
                              selectedCount === subgroup.items.length;
                            return (
                              <section
                                className="category-tree-subgroup"
                                key={`${group.name}-${subgroup.name}`}
                              >
                                <header
                                  className={
                                    selectedCount ? 'has-selection' : ''
                                  }
                                >
                                  <div className="category-subgroup-title">
                                    <b>{subgroup.name}</b>
                                    <small>
                                      {subgroup.items.length} 个分类
                                    </small>
                                  </div>
                                  <div className="category-subgroup-actions">
                                    {selectedCount ? (
                                      <span>
                                        {allSelected
                                          ? '已全部选择'
                                          : `已选 ${selectedCount} 个`}
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      className={
                                        allSelected ? 'is-all-selected' : ''
                                      }
                                      aria-label={`${allSelected ? '取消选择' : '选择'}${subgroup.name}层级的全部分类`}
                                      onClick={() =>
                                        toggleSubgroupCategories(subgroup.items)
                                      }
                                    >
                                      {allSelected ? (
                                        <Check size={11} />
                                      ) : (
                                        <ListChecks size={11} />
                                      )}
                                      {allSelected ? '取消全选' : '全选本组'}
                                    </button>
                                  </div>
                                </header>
                                <div className="category-tree-options">
                                  {subgroup.items.map((category) => {
                                    const checked =
                                      selectedCategoryIds.includes(
                                        category.externalId,
                                      );
                                    return (
                                      <label
                                        className={checked ? 'is-selected' : ''}
                                        key={category.externalId}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={
                                            !checked &&
                                            selectedCategoryIds.length >= 100
                                          }
                                          onChange={() =>
                                            toggleCategory(category.externalId)
                                          }
                                        />
                                        <span>
                                          <b>{category.name}</b>
                                          <small>
                                            {category.categoryPath !==
                                            category.name
                                              ? category.categoryPath
                                              : `第 ${category.level ?? '—'} 级 · #${category.externalId}`}
                                          </small>
                                        </span>
                                        {checked ? <Check size={13} /> : null}
                                      </label>
                                    );
                                  })}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })
                ) : (
                  <div className="category-picker-state">
                    {categoryQuery
                      ? '没有匹配的分类'
                      : `${sourceSystem} 本地分类库暂无数据`}
                  </div>
                )}
              </div>
              <div className="selected-category-list">
                <header>
                  <span>已选分类</span>
                  {selectedCategoryIds.length ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryIds([])}
                    >
                      清空全部
                    </button>
                  ) : null}
                </header>
                {selectedCategories.length ? (
                  <div>
                    {selectedCategories.map((category) => (
                      <button
                        type="button"
                        key={category.externalId}
                        onClick={() => toggleCategory(category.externalId)}
                        title="移除此分类"
                      >
                        <span>{category.categoryPath}</span>
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>请至少选择 1 个分类，可同时选择多个。</p>
                )}
              </div>
            </section>
          </div>
          <DialogFooter className="script-binding-dialog-footer">
            <p>
              {canSaveBinding
                ? `将保存 ${selectedCategoryIds.length} 个${sourceSystem}分类、1 家影楼和 1 条线路`
                : `请完成${[!selectedCategories.length ? '数据分类' : '', !selectedStudio ? '影楼' : '', !selectedLine ? '线路' : ''].filter(Boolean).join('、')}配置`}
            </p>
            <div>
              <button
                type="button"
                className="filter-button"
                onClick={() => setBindingScript(null)}
                disabled={savingBinding}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveBinding()}
                disabled={!canSaveBinding || savingBinding}
              >
                {savingBinding ? '正在保存…' : '保存业务绑定'}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PlannedTaskView() {
  const [tasks, setTasks] = useState<PlannedTask[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [pageNum, setPageNum] = useState(0);
  const [status, setStatus] = useState<PlannedTaskStatus | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bindingTask, setBindingTask] = useState<PlannedTask | null>(null);
  const [sourceSystem, setSourceSystem] = useState<'ERP' | 'CRM'>('ERP');
  const [categories, setCategories] = useState<SourceDataCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [bindingError, setBindingError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadPlannedTasks({
      name: submittedQuery,
      status,
      pageNum,
      pageSize: 20,
    })
      .then((page) => {
        if (cancelled) return;
        setTasks(page.tasks);
        setTotal(page.total);
        setPages(page.pages);
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : '话术列表加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageNum, refreshKey, status, submittedQuery]);

  useEffect(() => {
    if (!bindingTask) return;
    let cancelled = false;
    void loadSourceCategories(sourceSystem)
      .then(({ categories: sourceCategories }) => {
        if (!cancelled) setCategories(sourceCategories);
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setBindingError(
            requestError instanceof Error
              ? requestError.message
              : '数据分类加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setCategoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bindingTask, sourceSystem]);

  const openBinding = (task: PlannedTask) => {
    setBindingTask(task);
    setSourceSystem(task.categoryBinding?.sourceSystem ?? 'ERP');
    setCategoryId(task.categoryBinding?.sourceCategoryId ?? '');
    setManualPath(task.categoryBinding?.categoryPath ?? '');
    setCategoryLoading(true);
    setCategories([]);
    setBindingError('');
  };
  const changeSourceSystem = (nextSourceSystem: 'ERP' | 'CRM') => {
    setSourceSystem(nextSourceSystem);
    setCategoryLoading(true);
    setCategories([]);
    setCategoryId('');
    setManualPath('');
    setBindingError('');
  };
  const requestRefresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((value) => value + 1);
  };
  const closeBinding = () => {
    if (!savingBinding) setBindingTask(null);
  };
  const selectedCategory = categories.find(
    (category) => category.externalId === categoryId,
  );
  const categoryPath = selectedCategory?.categoryPath ?? manualPath.trim();
  const saveBinding = async () => {
    if (!bindingTask || !categoryPath) return;
    setSavingBinding(true);
    setBindingError('');
    try {
      const { binding } = await savePlannedTaskCategoryBinding({
        workflowId: bindingTask.id,
        sourceSystem,
        sourceCategoryId:
          selectedCategory?.externalId ?? `manual:${categoryPath}`,
        categoryPath,
      });
      setTasks((current) =>
        current.map((task) =>
          task.id === bindingTask.id
            ? { ...task, categoryBinding: binding }
            : task,
        ),
      );
      setBindingTask(null);
    } catch (requestError) {
      setBindingError(
        requestError instanceof Error
          ? requestError.message
          : '数据分类绑定失败',
      );
    } finally {
      setSavingBinding(false);
    }
  };
  const submitSearch = (event: { preventDefault(): void }) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPageNum(0);
    setSubmittedQuery(query.trim());
    setRefreshKey((value) => value + 1);
  };
  const visibleCounts = tasks.reduce<Record<PlannedTaskStatus, number>>(
    (counts, task) => {
      counts[task.workflowExecuteStatus] += 1;
      return counts;
    },
    { DRAFT: 0, UNSTART: 0, START: 0, FINISH: 0, PAUSE: 0 },
  );

  return (
    <div className="planned-task-page">
      <PageIntro
        eyebrow="BAIYING SOP WORKFLOW"
        title="话术列表"
        summary="实时读取百应“复杂任务列表 2.0”，展示接口返回的话术任务名称、状态、类型和起止时间，并支持在平台侧绑定 ERP / CRM 数据分类。"
        action={
          <button
            className="primary-button planned-refresh-button"
            onClick={requestRefresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
            同步百应话术
          </button>
        }
      />
      <section className="planned-overview" aria-label="话术列表概览">
        <div>
          <span>百应话术总数</span>
          <b>{loading && !total ? '—' : total}</b>
          <small>接口当前查询结果</small>
        </div>
        <div>
          <span>当前页进行中</span>
          <b>{visibleCounts.START}</b>
          <small>START</small>
        </div>
        <div>
          <span>当前页已暂停</span>
          <b>{visibleCounts.PAUSE}</b>
          <small>PAUSE</small>
        </div>
        <div>
          <span>当前页已绑定分类</span>
          <b>{tasks.filter((task) => task.categoryBinding).length}</b>
          <small>ERP / CRM</small>
        </div>
      </section>
      <Panel
        title="百应话术任务"
        meta={
          loading
            ? '正在同步接口…'
            : `共 ${total} 个 · 第 ${Math.min(pageNum + 1, Math.max(pages, 1))} / ${Math.max(pages, 1)} 页`
        }
        className="planned-card-panel"
      >
        <form className="planned-toolbar" onSubmit={submitSearch}>
          <label className="search-box">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按百应话术名称搜索"
            />
          </label>
          <UnifiedSelect
            ariaLabel="话术状态"
            className="filter-button"
            value={status}
            popupLabel="按百应话术任务状态筛选"
            options={[
              { value: 'ALL', label: '全部状态' },
              { value: 'DRAFT', label: '草稿' },
              { value: 'UNSTART', label: '未开始' },
              { value: 'START', label: '进行中' },
              { value: 'PAUSE', label: '已暂停' },
              { value: 'FINISH', label: '已结束' },
            ]}
            onValueChange={(value) => {
              setLoading(true);
              setError('');
              setStatus(value as PlannedTaskStatus | 'ALL');
              setPageNum(0);
            }}
          />
          <button className="filter-button" type="submit">
            查询
          </button>
        </form>
        <div className="planned-api-note">
          <span>数据来源</span>
          <p>
            任务信息来自百应接口；ERP / CRM
            分类属于平台绑定信息，不会修改百应原任务。
          </p>
        </div>
        {error ? (
          <div className="planned-state">
            <span className="planned-state-mark">!</span>
            <b>未能读取百应话术列表</b>
            <p>{error}</p>
            <button className="filter-button" onClick={requestRefresh}>
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div className="planned-card-grid" aria-label="正在加载话术列表">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="planned-card planned-card-loading" key={index}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : tasks.length ? (
          <div className="planned-card-grid">
            {tasks.map((task) => {
              const taskStatus =
                plannedTaskStatusMeta[task.workflowExecuteStatus];
              return (
                <article className="planned-card" key={task.id}>
                  <header>
                    <div>
                      <span
                        className={`planned-status planned-status-${taskStatus.tone}`}
                      >
                        {taskStatus.label}
                      </span>
                      <small>{task.workflowExecuteStatus}</small>
                    </div>
                    <code>#{task.id}</code>
                  </header>
                  <h3>{task.name}</h3>
                  <dl>
                    <div>
                      <dt>任务类型</dt>
                      <dd>
                        {workflowTypeLabel(task.workflowType)}
                        <small>{task.workflowType}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>开始时间</dt>
                      <dd>{task.startTime || '接口未返回'}</dd>
                    </div>
                    <div>
                      <dt>结束时间</dt>
                      <dd>{task.endTime || '接口未返回'}</dd>
                    </div>
                  </dl>
                  <div
                    className={`planned-binding ${task.categoryBinding ? 'is-bound' : ''}`}
                  >
                    <div>
                      <span>
                        {task.categoryBinding
                          ? `${task.categoryBinding.sourceSystem} 数据分类`
                          : 'ERP / CRM 数据分类'}
                      </span>
                      <b>{task.categoryBinding?.categoryPath ?? '尚未绑定'}</b>
                    </div>
                    <button onClick={() => openBinding(task)}>
                      {task.categoryBinding ? '修改绑定' : '绑定分类'}{' '}
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="planned-state">
            <span className="planned-state-mark">0</span>
            <b>没有符合条件的百应话术</b>
            <p>请调整话术名称或状态筛选条件后重试。</p>
          </div>
        )}
        <footer className="planned-pagination">
          <span>百应接口页码从 0 开始，页面已转换为常用页码展示。</span>
          <div>
            <button
              className="filter-button"
              disabled={loading || pageNum <= 0}
              onClick={() => {
                setLoading(true);
                setPageNum((value) => Math.max(0, value - 1));
              }}
            >
              上一页
            </button>
            <button
              className="filter-button"
              disabled={loading || pageNum + 1 >= pages}
              onClick={() => {
                setLoading(true);
                setPageNum((value) => value + 1);
              }}
            >
              下一页
            </button>
          </div>
        </footer>
      </Panel>
      <Dialog
        open={Boolean(bindingTask)}
        onOpenChange={(open) => {
          if (!open) closeBinding();
        }}
      >
        <DialogContent
          className="planned-binding-dialog max-w-[570px]"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>绑定 ERP / CRM 数据分类</DialogTitle>
            <DialogDescription>
              为百应计划“{bindingTask?.name}
              ”指定业务来源及分类路径，例如“邀约-百天-SS1”。绑定信息只保存在调度平台。
            </DialogDescription>
          </DialogHeader>
          <div className="planned-binding-context">
            <span>百应计划 ID</span>
            <code>{bindingTask?.id}</code>
          </div>
          <fieldset className="planned-source-switch">
            <legend className="sr-only">数据来源</legend>
            <button
              className={sourceSystem === 'ERP' ? 'active source-erp' : ''}
              onClick={() => changeSourceSystem('ERP')}
            >
              ERP 分类
            </button>
            <button
              className={sourceSystem === 'CRM' ? 'active source-crm' : ''}
              onClick={() => changeSourceSystem('CRM')}
            >
              CRM 分类
            </button>
          </fieldset>
          <div className="profile-field">
            接口同步的数据分类
            <UnifiedSelect
              ariaLabel="接口同步的数据分类"
              value={categoryId}
              disabled={categoryLoading || !categories.length}
              placeholder={
                categoryLoading
                  ? '正在读取分类…'
                  : categories.length
                    ? '请选择数据分类'
                    : `${sourceSystem} 尚未同步分类`
              }
              popupLabel={`选择 ${sourceSystem} 数据分类`}
              options={categories.map((category) => ({
                value: category.externalId,
                label: category.categoryPath,
              }))}
              onValueChange={(value) => {
                setCategoryId(value);
                const category = categories.find(
                  (item) => item.externalId === value,
                );
                if (category) setManualPath(category.categoryPath);
              }}
            />
          </div>
          {!categories.length && !categoryLoading ? (
            <div className="notice warn planned-category-notice">
              <b>尚无接口分类数据：</b>已预留 ERP / CRM
              分类同步接口；取得对方分类接口地址和字段定义后即可自动填充下拉选项。
            </div>
          ) : null}
          <label className="profile-field">
            分类路径 <i>*</i>
            <input
              value={manualPath}
              onChange={(event) => {
                setManualPath(event.target.value);
                setCategoryId('');
              }}
              placeholder="例如：邀约-百天-SS1"
            />
          </label>
          {bindingError ? (
            <div className="notice alert">{bindingError}</div>
          ) : null}
          <DialogFooter>
            <button
              className="filter-button"
              onClick={closeBinding}
              disabled={savingBinding}
            >
              取消
            </button>
            <button
              className="primary-button"
              onClick={() => void saveBinding()}
              disabled={!categoryPath || savingBinding}
            >
              {savingBinding ? '正在保存…' : '确认绑定'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const plannedTaskStatusMeta: Record<
  PlannedTaskStatus,
  { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' }
> = {
  DRAFT: { label: '草稿', tone: 'gray' },
  UNSTART: { label: '未开始', tone: 'blue' },
  START: { label: '进行中', tone: 'green' },
  FINISH: { label: '已结束', tone: 'gray' },
  PAUSE: { label: '已暂停', tone: 'amber' },
};

function workflowTypeLabel(value: string) {
  return value === 'OUT_TRIGGER' ? '外呼触发' : value || '接口未返回';
}

export function RechargeView() {
  const [showMessage, setShowMessage] = useState(false);
  return (
    <>
      <PageIntro
        eyebrow="RECHARGE LEDGER"
        title="充值记录"
        summary="记录线下充值、到账核验与余额流水。充值优先抵扣欠款，余额变更与流水在同一事务中完成。"
        action={
          <button
            className="primary-button"
            onClick={() => setShowMessage(true)}
          >
            + 登记线下充值
          </button>
        }
      />
      {showMessage ? (
        <div className="notice mb-[14px]">
          <Check size={14} className="mr-1 inline" />
          已打开充值登记流程：需录入影楼、到账金额、凭证及收款渠道后才可确认入账。
        </div>
      ) : null}
      <Panel title="充值流水" meta="最近 30 天">
        <div className="toolbar">
          <label className="search-box">
            <Search size={15} />
            <input placeholder="搜索影楼、流水号或操作人" />
          </label>
          <button className="filter-button">全部状态</button>
          <button className="filter-button">全部渠道</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>流水编号 / 时间</th>
                <th>影楼 / 门店</th>
                <th>充值金额</th>
                <th>渠道 / 凭证</th>
                <th>入账状态</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  'RC-20260902-0008',
                  '09-02 09:14',
                  '紫藤影像 · 上海总店',
                  '¥10,000.00',
                  '对公转账 · 凭证已归档',
                  '已到账',
                  '王琪',
                  'green',
                ],
                [
                  'RC-20260901-0007',
                  '09-01 16:42',
                  '罗曼映像 · 南京店',
                  '¥3,000.00',
                  '微信收款 · 凭证已归档',
                  '已到账',
                  '王琪',
                  'green',
                ],
                [
                  'RC-20260901-0006',
                  '09-01 11:08',
                  '晨光摄影 · 苏州园区店',
                  '¥2,000.00',
                  '对公转账 · 待核验',
                  '待核验',
                  '李萌',
                  'amber',
                ],
                [
                  'RC-20260829-0005',
                  '08-29 17:35',
                  '远山摄影 · 杭州店',
                  '¥5,000.00',
                  '银行回单 · 凭证已归档',
                  '已到账',
                  '王琪',
                  'green',
                ],
              ].map(
                ([id, time, store, amount, channel, state, operator, tone]) => (
                  <tr key={id}>
                    <td>
                      <b>{id}</b>
                      <span className="table-meta">{time}</span>
                    </td>
                    <td>{store}</td>
                    <td>
                      <b>{amount}</b>
                    </td>
                    <td>{channel}</td>
                    <td>
                      <Status tone={tone as 'green' | 'amber'}>{state}</Status>
                    </td>
                    <td>{operator}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="triple-grid">
        <Panel title="到账规则">
          <div className="note-list">
            <p>
              <b>先核验凭证</b>
              <br />
              支持 JPG / PNG / PDF 凭证
            </p>
            <p>
              <b>到账即记账</b>
              <br />
              余额和充值流水一起写入
            </p>
          </div>
        </Panel>
        <Panel title="欠款处理">
          <div className="note-list">
            <p>
              <b>¥1,680.00</b>
              <br />
              当前全平台待抵欠款
            </p>
            <p>充值到账后优先抵欠款，剩余金额进入可用余额。</p>
          </div>
        </Panel>
        <Panel title="恢复任务">
          <div className="notice warn">
            平台不自动恢复任务。余额满足启动冻结后，由 ERP/CRM
            或管理员明确发起恢复。
          </div>
        </Panel>
      </div>
    </>
  );
}

type RateDraft = {
  voiceRate: string;
  smsRate: string;
  frozenMinutes: string;
  effectiveAt: 'now' | 'tomorrow';
};

const defaultRateDraft: RateDraft = {
  voiceRate: '0.48',
  smsRate: '0.08',
  frozenMinutes: '2',
  effectiveAt: 'now',
};
type StudioRateSettings = {
  mode: 'uniform' | 'per-studio';
  uniformRate: RateDraft;
  studioRates: Record<string, RateDraft>;
};

const studioRateSettingsStorageKey = 'outbound-platform:studio-rate-settings';

function createDefaultStudioRateSettings(): StudioRateSettings {
  return {
    mode: 'uniform',
    uniformRate: { ...defaultRateDraft },
    studioRates: Object.fromEntries(
      initialStudios.map((studio) => [
        studio.id,
        { ...defaultRateDraft, voiceRate: studio.rate },
      ]),
    ),
  };
}

function isRateDraft(value: unknown): value is RateDraft {
  if (!value || typeof value !== 'object') return false;
  const rate = value as Record<string, unknown>;
  return (
    typeof rate.voiceRate === 'string' &&
    typeof rate.smsRate === 'string' &&
    typeof rate.frozenMinutes === 'string' &&
    (rate.effectiveAt === 'now' || rate.effectiveAt === 'tomorrow')
  );
}

function loadStudioRateSettings(): StudioRateSettings {
  const defaults = createDefaultStudioRateSettings();
  if (typeof window === 'undefined') return defaults;
  try {
    const savedSettings = window.localStorage.getItem(
      studioRateSettingsStorageKey,
    );
    if (!savedSettings) return defaults;
    const parsed: unknown = JSON.parse(savedSettings);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const settings = parsed as Record<string, unknown>;
    const mode =
      settings.mode === 'uniform' || settings.mode === 'per-studio'
        ? settings.mode
        : defaults.mode;
    const uniformRate = isRateDraft(settings.uniformRate)
      ? settings.uniformRate
      : defaults.uniformRate;
    const storedStudioRates =
      settings.studioRates && typeof settings.studioRates === 'object'
        ? (settings.studioRates as Record<string, unknown>)
        : {};
    const studioRates = Object.fromEntries(
      Object.entries(defaults.studioRates).map(([studioId, fallback]) => [
        studioId,
        isRateDraft(storedStudioRates[studioId])
          ? storedStudioRates[studioId]
          : fallback,
      ]),
    );
    return { mode, uniformRate, studioRates };
  } catch {
    return defaults;
  }
}

function persistStudioRateSettings(settings: StudioRateSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    studioRateSettingsStorageKey,
    JSON.stringify(settings),
  );
  window.dispatchEvent(new Event('studio-rate-settings-updated'));
}

type HainanRateTier = {
  id: string;
  name: string;
  minVolumeWan: string;
  maxVolumeWan: string;
  voiceRate: string;
  smsRate: string;
};
type LegacyHainanRateTier = Omit<
  HainanRateTier,
  'minVolumeWan' | 'maxVolumeWan'
> & { volumeWan: string };
type HainanMonthlySettlement = {
  month: string;
  tierId: string;
  tierName: string;
  rate: number;
  monthlyMinutes: number;
  settledAt: string;
};

const initialHainanRateTiers: HainanRateTier[] = [
  {
    id: 'tier-basic',
    name: '基础阶梯',
    minVolumeWan: '0',
    maxVolumeWan: '1',
    voiceRate: '0.20',
    smsRate: '0.08',
  },
  {
    id: 'tier-growth',
    name: '成长阶梯',
    minVolumeWan: '1',
    maxVolumeWan: '5',
    voiceRate: '0.18',
    smsRate: '0.07',
  },
  {
    id: 'tier-scale',
    name: '规模阶梯',
    minVolumeWan: '5',
    maxVolumeWan: '',
    voiceRate: '0.16',
    smsRate: '0.06',
  },
];

const emptyHainanRateTier: HainanRateTier = {
  id: '',
  name: '',
  minVolumeWan: '',
  maxVolumeWan: '',
  voiceRate: '',
  smsRate: '',
};
const hainanRateTierStorageKey = 'outbound-platform:hainan-rate-tiers';
const hainanMonthlySettlementStorageKey =
  'outbound-platform:hainan-monthly-settlements';

function isHainanRateTier(value: unknown): value is HainanRateTier {
  if (!value || typeof value !== 'object') return false;
  const tier = value as Record<string, unknown>;
  return [
    'id',
    'name',
    'minVolumeWan',
    'maxVolumeWan',
    'voiceRate',
    'smsRate',
  ].every((key) => typeof tier[key] === 'string');
}

function isLegacyHainanRateTier(value: unknown): value is LegacyHainanRateTier {
  if (!value || typeof value !== 'object') return false;
  const tier = value as Record<string, unknown>;
  return ['id', 'name', 'volumeWan', 'voiceRate', 'smsRate'].every(
    (key) => typeof tier[key] === 'string',
  );
}

function normalizeStoredHainanRateTiers(value: unknown) {
  if (!Array.isArray(value)) return null;
  if (value.every(isHainanRateTier)) return value;
  if (!value.every(isLegacyHainanRateTier)) return null;
  const sortedTiers = [...value].sort(
    (left, right) => Number(left.volumeWan) - Number(right.volumeWan),
  );
  return sortedTiers.map(
    (tier, index): HainanRateTier => ({
      id: tier.id,
      name: tier.name,
      minVolumeWan: tier.volumeWan,
      maxVolumeWan: sortedTiers[index + 1]?.volumeWan ?? '',
      voiceRate: tier.voiceRate,
      smsRate: tier.smsRate,
    }),
  );
}

function persistHainanRateTiers(tiers: HainanRateTier[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      hainanRateTierStorageKey,
      JSON.stringify(tiers),
    );
    window.dispatchEvent(new Event('hainan-rate-tiers-updated'));
  }
}

function loadStoredHainanRateTiers() {
  if (typeof window === 'undefined') return initialHainanRateTiers;
  try {
    const savedTiers = window.localStorage.getItem(hainanRateTierStorageKey);
    if (!savedTiers) return initialHainanRateTiers;
    return (
      normalizeStoredHainanRateTiers(JSON.parse(savedTiers) as unknown) ??
      initialHainanRateTiers
    );
  } catch {
    return initialHainanRateTiers;
  }
}

function loadHainanMonthlySettlements(): Record<
  string,
  HainanMonthlySettlement
> {
  if (typeof window === 'undefined') return {};
  try {
    const savedSettlements = window.localStorage.getItem(
      hainanMonthlySettlementStorageKey,
    );
    if (!savedSettlements) return {};
    const parsed: unknown = JSON.parse(savedSettlements);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Record<string, HainanMonthlySettlement>;
  } catch {
    return {};
  }
}

function getActiveHainanTier(tiers: HainanRateTier[], monthlyMinutes: number) {
  const monthlyVolumeWan = monthlyMinutes / 10_000;
  return tiers.find((tier) => {
    const minimum = Number(tier.minVolumeWan);
    const maximum =
      tier.maxVolumeWan === ''
        ? Number.POSITIVE_INFINITY
        : Number(tier.maxVolumeWan);
    return (
      Number.isFinite(minimum) &&
      monthlyVolumeWan >= minimum &&
      monthlyVolumeWan < maximum
    );
  });
}

function getLocalMonthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function isMonthEndSettlementWindow(value: Date) {
  const nextDay = new Date(value);
  nextDay.setDate(value.getDate() + 1);
  const isLastDayOfMonth = nextDay.getMonth() !== value.getMonth();
  return (
    isLastDayOfMonth && value.getHours() === 23 && value.getMinutes() >= 30
  );
}

function settleEligibleTaskMonths(
  allTasks: typeof taskRows,
  tiers: HainanRateTier[],
  settlements: Record<string, HainanMonthlySettlement>,
  now = new Date(),
) {
  const nextSettlements = { ...settlements };
  const currentMonth = getLocalMonthKey(now);
  let changed = false;
  for (const taskMonth of new Set(
    allTasks.map((task) => task.createdAt.slice(0, 7)),
  )) {
    const eligible =
      taskMonth < currentMonth ||
      (taskMonth === currentMonth && isMonthEndSettlementWindow(now));
    if (!eligible || nextSettlements[taskMonth]) continue;
    const monthlyMinutes = allTasks
      .filter((task) => task.createdAt.startsWith(taskMonth))
      .reduce((total, task) => total + task.billingMinutes, 0);
    const tier = getActiveHainanTier(tiers, monthlyMinutes);
    const rate = tier ? Number(tier.voiceRate) : Number.NaN;
    if (!tier || !Number.isFinite(rate)) continue;
    nextSettlements[taskMonth] = {
      month: taskMonth,
      tierId: tier.id,
      tierName: tier.name,
      rate,
      monthlyMinutes,
      settledAt: now.toISOString(),
    };
    changed = true;
  }
  if (changed && typeof window !== 'undefined')
    window.localStorage.setItem(
      hainanMonthlySettlementStorageKey,
      JSON.stringify(nextSettlements),
    );
  return nextSettlements;
}

function getTaskPlatformPricing(
  task: (typeof taskRows)[number],
  allTasks: typeof taskRows,
  tiers: HainanRateTier[],
  settlements: Record<string, HainanMonthlySettlement>,
): TaskPlatformPricing {
  const taskMonth = task.createdAt.slice(0, 7);
  const settlement = settlements[taskMonth];
  if (settlement) {
    return {
      rate: settlement.rate,
      tierName: settlement.tierName,
      monthlyMinutes: settlement.monthlyMinutes,
      settled: true,
    };
  }
  const monthlyMinutes = allTasks
    .filter((candidate) => candidate.createdAt.startsWith(taskMonth))
    .reduce((total, candidate) => total + candidate.billingMinutes, 0);
  const activeTier = getActiveHainanTier(tiers, monthlyMinutes);
  const parsedRate = activeTier ? Number(activeTier.voiceRate) : Number.NaN;
  return {
    rate: Number.isFinite(parsedRate) ? parsedRate : null,
    tierName: activeTier?.name ?? '未匹配阶梯',
    monthlyMinutes,
    settled: false,
  };
}

function getTaskCustomerPricing(
  task: (typeof taskRows)[number],
  settings: StudioRateSettings,
): TaskCustomerPricing {
  if (settings.mode === 'uniform') {
    const rate = settings.uniformRate.voiceRate.trim()
      ? Number(settings.uniformRate.voiceRate)
      : Number.NaN;
    return {
      rate: Number.isFinite(rate) ? rate : null,
      sourceLabel: '统一价格（当前启用）',
    };
  }
  const studio = initialStudios.find((candidate) =>
    task.store.includes(candidate.name),
  );
  if (!studio) {
    return { rate: null, sourceLabel: '未找到任务所属影楼的独立价格' };
  }
  const voiceRate = settings.studioRates[studio.id]?.voiceRate ?? '';
  const rate = voiceRate.trim() ? Number(voiceRate) : Number.NaN;
  return {
    rate: Number.isFinite(rate) ? rate : null,
    sourceLabel: `单影楼定价（当前启用） · ${studio.name}`,
  };
}

function formatTierRange(tier: HainanRateTier) {
  return tier.maxVolumeWan === ''
    ? `≥ ${tier.minVolumeWan} 万分钟`
    : `${tier.minVolumeWan}（含）– ${tier.maxVolumeWan}（不含）万分钟`;
}

function RateFields({
  value,
  onChange,
}: {
  value: RateDraft;
  onChange: (key: keyof RateDraft, value: string) => void;
}) {
  return (
    <div className="rate-form rate-policy-fields">
      <div>
        <span className="field-label">话费单价（分钟/元）</span>
        <input
          aria-label="话费单价（分钟/元）"
          className="rate-input"
          inputMode="decimal"
          value={value.voiceRate}
          onChange={(event) => onChange('voiceRate', event.target.value)}
        />
      </div>
      <label>
        <span className="field-label">短信单价（条/元）</span>
        <input
          aria-label="短信单价（条/元）"
          className="rate-input"
          inputMode="decimal"
          value={value.smsRate}
          onChange={(event) => onChange('smsRate', event.target.value)}
        />
      </label>
      <label>
        <span className="field-label">冻结分钟数</span>
        <input
          aria-label="冻结分钟数"
          className="rate-input"
          inputMode="numeric"
          value={value.frozenMinutes}
          onChange={(event) => onChange('frozenMinutes', event.target.value)}
        />
      </label>
      <div>
        <span className="field-label">生效时间</span>
        <UnifiedSelect
          ariaLabel="生效时间"
          className="rate-input"
          value={value.effectiveAt}
          popupLabel="选择价格生效时间"
          options={[
            {
              value: 'now',
              label: '立即对新任务生效',
              description: '保存后新创建任务立即使用',
            },
            {
              value: 'tomorrow',
              label: '明日 00:00 生效',
              description: '次日零点起创建的任务使用',
            },
          ]}
          onValueChange={(nextValue) => onChange('effectiveAt', nextValue)}
        />
      </div>
    </div>
  );
}

function AccountDataState({
  loading,
  error,
}: {
  loading: boolean;
  error?: string;
}) {
  if (loading)
    return (
      <div className="account-data-state">
        <i />
        <span>正在直连百应读取…</span>
      </div>
    );
  return (
    <div className="account-data-state is-error">
      <b>!</b>
      <span>{error || '接口暂不可用'}</span>
    </div>
  );
}

function formatAccountValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return `${value}`;
  return '—';
}

export function RateSettingView() {
  const [scope, setScope] = useState<'studio' | 'hainan'>('studio');
  const [pricingMode, setPricingMode] = useState<'uniform' | 'per-studio'>(
    'uniform',
  );
  const [uniformRate, setUniformRate] = useState<RateDraft>(defaultRateDraft);
  const [studioRates, setStudioRates] = useState<Record<string, RateDraft>>(
    () =>
      Object.fromEntries(
        initialStudios.map((studio) => [
          studio.id,
          { ...defaultRateDraft, voiceRate: studio.rate },
        ]),
      ),
  );
  const [savedMessage, setSavedMessage] = useState('');
  const [accountOverview, setAccountOverview] =
    useState<BaiyingAccountOverview | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [hainanRateTiers, setHainanRateTiers] = useState<HainanRateTier[]>(
    initialHainanRateTiers,
  );
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [tierDraft, setTierDraft] =
    useState<HainanRateTier>(emptyHainanRateTier);
  const [tierError, setTierError] = useState('');
  const [tierMessage, setTierMessage] = useState('');
  const [deletingTier, setDeletingTier] = useState<HainanRateTier | null>(null);
  const monthlyEffectiveMinutes = taskRows.reduce(
    (total, task) => total + task.billingMinutes,
    0,
  );
  const activeTier = getActiveHainanTier(
    hainanRateTiers,
    monthlyEffectiveMinutes,
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const settings = loadStudioRateSettings();
      if (cancelled) return;
      setPricingMode(settings.mode);
      setUniformRate(settings.uniformRate);
      setStudioRates(settings.studioRates);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const savedTiers = window.localStorage.getItem(hainanRateTierStorageKey);
      if (!savedTiers)
        return () => {
          cancelled = true;
        };
      const parsedTiers: unknown = JSON.parse(savedTiers);
      const normalizedTiers = normalizeStoredHainanRateTiers(parsedTiers);
      if (normalizedTiers) {
        queueMicrotask(() => {
          if (!cancelled) {
            setHainanRateTiers(normalizedTiers);
            persistHainanRateTiers(normalizedTiers);
          }
        });
      }
    } catch {
      window.localStorage.removeItem(hainanRateTierStorageKey);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scope !== 'hainan') return;
    let cancelled = false;
    void loadBaiyingAccountOverview()
      .then((result) => {
        if (!cancelled) setAccountOverview(result);
      })
      .catch((error) => {
        if (!cancelled)
          setAccountError(
            error instanceof Error ? error.message : '百应账户接口暂不可用',
          );
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, accountRefresh]);

  const updateUniformRate = (key: keyof RateDraft, value: string) => {
    setSavedMessage('');
    setUniformRate((current) => ({ ...current, [key]: value }));
  };
  const updateStudioRate = (
    studioId: string,
    key: keyof RateDraft,
    value: string,
  ) => {
    setSavedMessage('');
    setStudioRates((current) => ({
      ...current,
      [studioId]: { ...current[studioId], [key]: value },
    }));
  };
  const saveStudioRateSettings = () => {
    persistStudioRateSettings({
      mode: pricingMode,
      uniformRate,
      studioRates,
    });
    setSavedMessage(
      pricingMode === 'uniform'
        ? '统一价格已保存并启用'
        : '单影楼价格已保存并启用',
    );
  };
  const chooseScope = (nextScope: 'studio' | 'hainan') => {
    setScope(nextScope);
    setSavedMessage('');
    if (nextScope === 'hainan') {
      setAccountLoading(true);
      setAccountError('');
    }
  };
  const beginAddTier = () => {
    setEditingTierId('new');
    setTierDraft({ ...emptyHainanRateTier, id: `tier-${Date.now()}` });
    setTierError('');
    setTierMessage('');
  };
  const beginEditTier = (tier: HainanRateTier) => {
    setEditingTierId(tier.id);
    setTierDraft({ ...tier });
    setTierError('');
    setTierMessage('');
  };
  const cancelTierEdit = () => {
    setEditingTierId(null);
    setTierDraft(emptyHainanRateTier);
    setTierError('');
  };
  const saveTier = () => {
    const normalizedTier = {
      ...tierDraft,
      name: tierDraft.name.trim(),
      minVolumeWan: tierDraft.minVolumeWan.trim(),
      maxVolumeWan: tierDraft.maxVolumeWan.trim(),
      voiceRate: tierDraft.voiceRate.trim(),
      smsRate: tierDraft.smsRate.trim(),
    };
    const minimum = Number(normalizedTier.minVolumeWan);
    const maximum =
      normalizedTier.maxVolumeWan === ''
        ? Number.POSITIVE_INFINITY
        : Number(normalizedTier.maxVolumeWan);
    const priceValues = [normalizedTier.voiceRate, normalizedTier.smsRate].map(
      Number,
    );
    if (
      !normalizedTier.name ||
      !Number.isFinite(minimum) ||
      minimum < 0 ||
      priceValues.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      setTierError('请完整填写阶梯名称、起始通话量及两个非负单价。');
      return;
    }
    if (
      maximum !== Number.POSITIVE_INFINITY &&
      (!Number.isFinite(maximum) || maximum <= minimum)
    ) {
      setTierError('结束值必须大于起始值；最后一档可留空表示无上限。');
      return;
    }
    const overlapsExistingTier = hainanRateTiers.some((tier) => {
      if (tier.id === normalizedTier.id) return false;
      const tierMinimum = Number(tier.minVolumeWan);
      const tierMaximum =
        tier.maxVolumeWan === ''
          ? Number.POSITIVE_INFINITY
          : Number(tier.maxVolumeWan);
      return minimum < tierMaximum && tierMinimum < maximum;
    });
    if (overlapsExistingTier) {
      setTierError('该通话量范围与其他阶梯重叠，请调整起始值或结束值。');
      return;
    }
    setHainanRateTiers((current) => {
      const next =
        editingTierId === 'new'
          ? [...current, normalizedTier]
          : current.map((tier) =>
              tier.id === normalizedTier.id ? normalizedTier : tier,
            );
      const sortedTiers = next.sort(
        (left, right) => Number(left.minVolumeWan) - Number(right.minVolumeWan),
      );
      persistHainanRateTiers(sortedTiers);
      return sortedTiers;
    });
    setEditingTierId(null);
    setTierDraft(emptyHainanRateTier);
    setTierError('');
    setTierMessage(editingTierId === 'new' ? '阶梯已新增' : '阶梯已更新');
  };
  const confirmDeleteTier = () => {
    if (!deletingTier) return;
    setHainanRateTiers((current) => {
      const next = current.filter((tier) => tier.id !== deletingTier.id);
      persistHainanRateTiers(next);
      return next;
    });
    if (editingTierId === deletingTier.id) cancelTierEdit();
    setDeletingTier(null);
    setTierMessage('阶梯已删除');
  };
  const updateTierDraft = (
    key: keyof Pick<
      HainanRateTier,
      'name' | 'minVolumeWan' | 'maxVolumeWan' | 'voiceRate' | 'smsRate'
    >,
    value: string,
  ) => {
    setTierDraft((current) => ({ ...current, [key]: value }));
    setTierError('');
  };

  return (
    <div className="rate-settings-page">
      <PageIntro
        eyebrow="CALL RATE POLICY"
        title="话费设置"
        summary="分别维护影楼销售价格与海南人像供应侧账户，价格变更只作用于新创建任务。"
      />
      <div className="rate-scope-tabs" role="tablist" aria-label="话费设置范围">
        <button
          role="tab"
          aria-selected={scope === 'studio'}
          className={scope === 'studio' ? 'is-active' : ''}
          onClick={() => chooseScope('studio')}
        >
          <b>影楼话费</b>
          <span>销售定价与任务冻结规则</span>
        </button>
        <button
          role="tab"
          aria-selected={scope === 'hainan'}
          className={scope === 'hainan' ? 'is-active' : ''}
          onClick={() => chooseScope('hainan')}
        >
          <b>海南人像话费</b>
          <span>供应阶梯与百应账户资源</span>
        </button>
      </div>

      {scope === 'studio' ? (
        <section className="rate-scope-panel" role="tabpanel">
          <header className="rate-section-heading">
            <div>
              <span>计费方式</span>
              <h3>选择影楼销售价格的维护范围</h3>
              <p>两种方式只能选择一种，切换不会清除尚未保存的填写内容。</p>
            </div>
            <small>
              {pricingMode === 'uniform'
                ? `统一作用于 ${initialStudios.length} 家影楼`
                : `分别维护 ${initialStudios.length} 家影楼`}
            </small>
          </header>
          <fieldset className="rate-mode-selector">
            <legend className="rate-mode-legend">
              <span>单选模式</span>
              <b>
                当前仅启用：
                {pricingMode === 'uniform' ? '统一价格' : '单影楼定价'}
              </b>
              <small>选择另一项会切换当前计费方式</small>
            </legend>
            <div className="rate-mode-options">
              <label
                htmlFor="pricing-mode-uniform"
                className={pricingMode === 'uniform' ? 'is-selected' : ''}
              >
                <input
                  aria-label="统一价格"
                  className="sr-only"
                  id="pricing-mode-uniform"
                  type="radio"
                  name="pricing-mode"
                  checked={pricingMode === 'uniform'}
                  onChange={() => {
                    setPricingMode('uniform');
                    setSavedMessage('');
                  }}
                />
                <i className="rate-mode-indicator" aria-hidden="true">
                  {pricingMode === 'uniform' ? <Check size={12} /> : null}
                </i>
                <span>
                  <b>统一价格</b>
                  <small>一套价格应用到全部影楼</small>
                </span>
                <em>{pricingMode === 'uniform' ? '当前启用' : '点击切换'}</em>
              </label>
              <label
                htmlFor="pricing-mode-studio"
                className={pricingMode === 'per-studio' ? 'is-selected' : ''}
              >
                <input
                  aria-label="单影楼定价"
                  className="sr-only"
                  id="pricing-mode-studio"
                  type="radio"
                  name="pricing-mode"
                  checked={pricingMode === 'per-studio'}
                  onChange={() => {
                    setPricingMode('per-studio');
                    setSavedMessage('');
                  }}
                />
                <i className="rate-mode-indicator" aria-hidden="true">
                  {pricingMode === 'per-studio' ? <Check size={12} /> : null}
                </i>
                <span>
                  <b>单影楼定价</b>
                  <small>逐家维护独立销售价格</small>
                </span>
                <em>
                  {pricingMode === 'per-studio' ? '当前启用' : '点击切换'}
                </em>
              </label>
            </div>
          </fieldset>

          {pricingMode === 'uniform' ? (
            <div className="rate-uniform-layout">
              <div className="rate-form-card">
                <header>
                  <span>统一价格</span>
                  <b>新任务销售计费标准</b>
                </header>
                <RateFields value={uniformRate} onChange={updateUniformRate} />
                <div className="notice">
                  <b>生效规则：</b>
                  已创建或正在执行的任务继续使用原计费快照，不会被新价格覆盖。
                </div>
              </div>
              <aside className="rate-policy-summary">
                <span>发布预览</span>
                <strong>
                  ¥{uniformRate.voiceRate || '0.00'}
                  <small>/ 分钟</small>
                </strong>
                <dl>
                  <div>
                    <dt>短信</dt>
                    <dd>¥{uniformRate.smsRate || '0.00'} / 条</dd>
                  </div>
                  <div>
                    <dt>冻结</dt>
                    <dd>{uniformRate.frozenMinutes || '0'} 分钟</dd>
                  </div>
                  <div>
                    <dt>范围</dt>
                    <dd>{initialStudios.length} 家影楼</dd>
                  </div>
                  <div>
                    <dt>生效</dt>
                    <dd>
                      {uniformRate.effectiveAt === 'now'
                        ? '立即'
                        : '明日 00:00'}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          ) : (
            <div className="studio-rate-editor">
              <header>
                <div>
                  <span>影楼价格清单</span>
                  <b>每家影楼独立填写并批量发布</b>
                </div>
                <small>数据来自影楼管理 · 共 {initialStudios.length} 家</small>
              </header>
              <div className="table-wrap">
                <table className="data-table studio-rate-table">
                  <thead>
                    <tr>
                      <th>影楼</th>
                      <th>话费单价（分钟/元）</th>
                      <th>短信单价（条/元）</th>
                      <th>冻结分钟数</th>
                      <th>生效时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initialStudios.map((studio) => {
                      const rate = studioRates[studio.id] ?? defaultRateDraft;
                      return (
                        <tr key={studio.id}>
                          <td>
                            <b>{studio.name}</b>
                            <span className="table-meta">
                              {studio.id} · {studio.status}
                            </span>
                          </td>
                          <td>
                            <input
                              aria-label={`${studio.name}话费单价`}
                              className="rate-table-input"
                              inputMode="decimal"
                              value={rate.voiceRate}
                              onChange={(event) =>
                                updateStudioRate(
                                  studio.id,
                                  'voiceRate',
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`${studio.name}短信单价`}
                              className="rate-table-input"
                              inputMode="decimal"
                              value={rate.smsRate}
                              onChange={(event) =>
                                updateStudioRate(
                                  studio.id,
                                  'smsRate',
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`${studio.name}冻结分钟数`}
                              className="rate-table-input"
                              inputMode="numeric"
                              value={rate.frozenMinutes}
                              onChange={(event) =>
                                updateStudioRate(
                                  studio.id,
                                  'frozenMinutes',
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <UnifiedSelect
                              ariaLabel={`${studio.name}生效时间`}
                              className="rate-table-input"
                              value={rate.effectiveAt}
                              popupLabel={`${studio.name}价格生效时间`}
                              options={[
                                {
                                  value: 'now',
                                  label: '立即对新任务生效',
                                },
                                {
                                  value: 'tomorrow',
                                  label: '明日 00:00 生效',
                                },
                              ]}
                              onValueChange={(nextValue) =>
                                updateStudioRate(
                                  studio.id,
                                  'effectiveAt',
                                  nextValue,
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <footer className="rate-save-bar">
            <p>
              <b>发布后保留版本快照</b>
              <span>历史任务金额与冻结额度不会重新计算。</span>
            </p>
            <div>
              {savedMessage ? (
                <span className="success-inline">
                  <Check size={14} />
                  {savedMessage}
                </span>
              ) : null}
              <button
                className="primary-button"
                onClick={saveStudioRateSettings}
              >
                保存计费设置
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <section className="rate-scope-panel hainan-rate-panel" role="tabpanel">
          <div className="hainan-tier-panel">
            <header className="rate-section-heading hainan-tier-heading">
              <div>
                <span>阶梯价格单</span>
                <h3>海南人像月度供应价格</h3>
                <p>
                  月度有效通话量按“起始值（含）—结束值（不含）”配置，最后一档可不设上限。
                </p>
              </div>
              <div className="hainan-tier-heading-actions">
                <div className="monthly-volume">
                  <span>本月有效通话量</span>
                  <b>{monthlyEffectiveMinutes.toLocaleString('zh-CN')} 分钟</b>
                  <small>当前：{activeTier?.name ?? '未匹配阶梯'}</small>
                </div>
                <button
                  type="button"
                  aria-label="新增价格阶梯"
                  className="primary-button"
                  onClick={beginAddTier}
                  disabled={editingTierId !== null}
                >
                  <Plus size={13} />
                  新增阶梯
                </button>
              </div>
            </header>
            <div className="table-wrap">
              <table className="data-table hainan-tier-table">
                <thead>
                  <tr>
                    <th>阶梯名称</th>
                    <th>月度有效通话量（万分钟）</th>
                    <th>语音单价（分钟/元）</th>
                    <th>短信单价（条/元）</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {hainanRateTiers.map((tier) => {
                    const isActive = tier.id === activeTier?.id;
                    const isEditing = editingTierId === tier.id;
                    return (
                      <tr
                        key={tier.id}
                        className={isActive ? 'is-current' : ''}
                      >
                        {isEditing ? (
                          <>
                            <td>
                              <input
                                aria-label="阶梯名称"
                                className="rate-table-input"
                                value={tierDraft.name}
                                onChange={(event) =>
                                  updateTierDraft('name', event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <div className="tier-range-editor">
                                <input
                                  aria-label="月度有效通话量起始值（万分钟，含）"
                                  className="rate-table-input"
                                  inputMode="decimal"
                                  placeholder="起始（含）"
                                  value={tierDraft.minVolumeWan}
                                  onChange={(event) =>
                                    updateTierDraft(
                                      'minVolumeWan',
                                      event.target.value,
                                    )
                                  }
                                />
                                <span>—</span>
                                <input
                                  aria-label="月度有效通话量结束值（万分钟，不含）"
                                  className="rate-table-input"
                                  inputMode="decimal"
                                  placeholder="结束（不含），留空为不限"
                                  value={tierDraft.maxVolumeWan}
                                  onChange={(event) =>
                                    updateTierDraft(
                                      'maxVolumeWan',
                                      event.target.value,
                                    )
                                  }
                                />
                              </div>
                            </td>
                            <td>
                              <input
                                aria-label="语音单价（分钟/元）"
                                className="rate-table-input"
                                inputMode="decimal"
                                value={tierDraft.voiceRate}
                                onChange={(event) =>
                                  updateTierDraft(
                                    'voiceRate',
                                    event.target.value,
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label="短信单价（条/元）"
                                className="rate-table-input"
                                inputMode="decimal"
                                value={tierDraft.smsRate}
                                onChange={(event) =>
                                  updateTierDraft('smsRate', event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <span className="tier-editing-state">编辑中</span>
                            </td>
                            <td>
                              <div className="tier-row-actions">
                                <button
                                  type="button"
                                  aria-label={`保存${tier.name}`}
                                  className="tier-action is-save"
                                  onClick={saveTier}
                                >
                                  <Check size={12} />
                                  保存
                                </button>
                                <button
                                  type="button"
                                  aria-label={`取消编辑${tier.name}`}
                                  className="tier-action"
                                  onClick={cancelTierEdit}
                                >
                                  <X size={12} />
                                  取消
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <b>{tier.name}</b>
                            </td>
                            <td>
                              <b>{formatTierRange(tier)}</b>
                            </td>
                            <td>
                              <strong>
                                ¥{Number(tier.voiceRate).toFixed(2)}
                              </strong>
                            </td>
                            <td>¥{Number(tier.smsRate).toFixed(2)}</td>
                            <td>
                              {isActive ? (
                                <Status tone="green">当前阶梯</Status>
                              ) : (
                                <span className="tier-waiting">
                                  {Number(tier.minVolumeWan) >
                                  monthlyEffectiveMinutes / 10_000
                                    ? '未达到'
                                    : '已跨过'}
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="tier-row-actions">
                                <button
                                  type="button"
                                  aria-label={`编辑${tier.name}`}
                                  className="tier-action"
                                  onClick={() => beginEditTier(tier)}
                                  disabled={editingTierId !== null}
                                >
                                  <Pencil size={12} />
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  aria-label={`删除${tier.name}`}
                                  className="tier-action is-danger"
                                  onClick={() => setDeletingTier(tier)}
                                  disabled={editingTierId !== null}
                                >
                                  <Trash2 size={12} />
                                  删除
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {editingTierId === 'new' ? (
                    <tr className="tier-new-row">
                      <td>
                        <input
                          aria-label="新阶梯名称"
                          className="rate-table-input"
                          placeholder="例如：旗舰阶梯"
                          value={tierDraft.name}
                          onChange={(event) =>
                            updateTierDraft('name', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <div className="tier-range-editor">
                          <input
                            aria-label="新阶梯月度有效通话量起始值（万分钟，含）"
                            className="rate-table-input"
                            inputMode="decimal"
                            placeholder="起始（含）"
                            value={tierDraft.minVolumeWan}
                            onChange={(event) =>
                              updateTierDraft(
                                'minVolumeWan',
                                event.target.value,
                              )
                            }
                          />
                          <span>—</span>
                          <input
                            aria-label="新阶梯月度有效通话量结束值（万分钟，不含）"
                            className="rate-table-input"
                            inputMode="decimal"
                            placeholder="结束（不含），留空为不限"
                            value={tierDraft.maxVolumeWan}
                            onChange={(event) =>
                              updateTierDraft(
                                'maxVolumeWan',
                                event.target.value,
                              )
                            }
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label="新阶梯语音单价（分钟/元）"
                          className="rate-table-input"
                          inputMode="decimal"
                          placeholder="例如：0.15"
                          value={tierDraft.voiceRate}
                          onChange={(event) =>
                            updateTierDraft('voiceRate', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="新阶梯短信单价（条/元）"
                          className="rate-table-input"
                          inputMode="decimal"
                          placeholder="例如：0.05"
                          value={tierDraft.smsRate}
                          onChange={(event) =>
                            updateTierDraft('smsRate', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <span className="tier-editing-state">新增中</span>
                      </td>
                      <td>
                        <div className="tier-row-actions">
                          <button
                            type="button"
                            aria-label="保存新阶梯"
                            className="tier-action is-save"
                            onClick={saveTier}
                          >
                            <Check size={12} />
                            保存
                          </button>
                          <button
                            type="button"
                            aria-label="取消新增阶梯"
                            className="tier-action"
                            onClick={cancelTierEdit}
                          >
                            <X size={12} />
                            取消
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {tierError || tierMessage ? (
              <div className={`tier-feedback ${tierError ? 'is-error' : ''}`}>
                {tierError || tierMessage}
              </div>
            ) : null}
          </div>

          <div className="account-overview-grid">
            <article className="account-overview-card">
              <header>
                <span>通信余额</span>
                <small>百应实时接口</small>
              </header>
              {accountOverview?.communicationBalance.status === 'success' &&
              !accountLoading ? (
                <>
                  <strong>
                    ¥
                    {formatTaskMoney(
                      accountOverview.communicationBalance.data.amount,
                    )}
                  </strong>
                  <p>当前可用于语音与短信通信消耗的账户余额。</p>
                </>
              ) : (
                <AccountDataState
                  loading={accountLoading}
                  error={
                    accountOverview?.communicationBalance.status === 'error'
                      ? accountOverview.communicationBalance.message
                      : accountError
                  }
                />
              )}
            </article>
            <article className="account-overview-card">
              <header>
                <span>AI 账户余额</span>
                <small>百应实时接口</small>
              </header>
              {accountOverview?.aiBalance.status === 'success' &&
              !accountLoading ? (
                <>
                  <strong>
                    ¥{formatTaskMoney(accountOverview.aiBalance.data.amount)}
                  </strong>
                  <dl>
                    <div>
                      <dt>AI 单价</dt>
                      <dd>{accountOverview.aiBalance.data.price}</dd>
                    </div>
                    <div>
                      <dt>账户数量</dt>
                      <dd>{accountOverview.aiBalance.data.num}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <AccountDataState
                  loading={accountLoading}
                  error={
                    accountOverview?.aiBalance.status === 'error'
                      ? accountOverview.aiBalance.message
                      : accountError
                  }
                />
              )}
            </article>
            <article className="account-overview-card seat-overview-card">
              <header>
                <span>AI 坐席概况</span>
                <small>百应实时接口</small>
              </header>
              {accountOverview?.seatOverview.status === 'success' &&
              !accountLoading ? (
                <>
                  <strong>
                    {accountOverview.seatOverview.data.companyAllCallSeat}
                    <small> 个坐席</small>
                  </strong>
                  <dl>
                    <div>
                      <dt>使用中</dt>
                      <dd>
                        {accountOverview.seatOverview.data.companyUsingCallSeat}
                      </dd>
                    </div>
                    <div>
                      <dt>当前空闲</dt>
                      <dd>
                        {Math.max(
                          0,
                          accountOverview.seatOverview.data.companyAllCallSeat -
                            accountOverview.seatOverview.data
                              .companyUsingCallSeat,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>坐席批次</dt>
                      <dd>
                        {accountOverview.seatOverview.data.callSeatList.length}
                      </dd>
                    </div>
                    {Object.entries(
                      accountOverview.seatOverview.data.companyCallSeatDetail,
                    )
                      .slice(0, 2)
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd title={formatAccountValue(value)}>
                            {formatAccountValue(value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </>
              ) : (
                <AccountDataState
                  loading={accountLoading}
                  error={
                    accountOverview?.seatOverview.status === 'error'
                      ? accountOverview.seatOverview.message
                      : accountError
                  }
                />
              )}
            </article>
          </div>
          <div className="hainan-source-note">
            <span>直连模式</span>
            <p>
              账户数据由本地后端绕过系统代理访问百应 OpenAPI，页面不会接触或暴露
              accessToken。
            </p>
            <button
              className="filter-button"
              onClick={() => {
                setAccountLoading(true);
                setAccountError('');
                setAccountRefresh((value) => value + 1);
              }}
            >
              <RefreshCw size={13} />
              重新读取
            </button>
          </div>
          <Dialog
            open={Boolean(deletingTier)}
            onOpenChange={(open) => {
              if (!open) setDeletingTier(null);
            }}
          >
            <DialogContent
              className="tier-delete-dialog max-w-[430px]"
              showCloseButton={false}
            >
              <DialogHeader>
                <DialogTitle>删除价格阶梯</DialogTitle>
                <DialogDescription>
                  确定删除“{deletingTier?.name}
                  ”吗？删除后系统会立即根据剩余阶梯重新判断当前价格。
                </DialogDescription>
              </DialogHeader>
              <div className="tier-delete-summary">
                <span>将删除的阶梯</span>
                <b>{deletingTier?.name}</b>
                <small>
                  {deletingTier ? formatTierRange(deletingTier) : '—'} · 语音 ¥
                  {deletingTier?.voiceRate} / 分钟 · 短信 ¥
                  {deletingTier?.smsRate} / 条
                </small>
              </div>
              <DialogFooter>
                <button
                  type="button"
                  className="filter-button"
                  onClick={() => setDeletingTier(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="tier-delete-confirm"
                  onClick={confirmDeleteTier}
                >
                  <Trash2 size={13} />
                  确认删除
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}

export function AuditLogView() {
  return (
    <>
      <PageIntro
        eyebrow="AUDIT & EXCEPTION"
        title="操作日志"
        summary="完整记录管理员操作、关键状态变更与异常队列处理。回调先原文落库，失败交付进入重试或死信队列。"
      />
      <div className="metric-grid">
        <Metric
          label="今日管理员操作"
          value="86"
          note="所有操作均可追溯"
          color="#4fad78"
        />
        <Metric
          label="待处理异常"
          value="17"
          note="P0：1 · P1：3"
          color="#c7625b"
        />
        <Metric
          label="回调交付成功率"
          value="99.6%"
          note="近 24 小时"
          color="#4a9bc2"
        />
        <Metric
          label="死信队列"
          value="4"
          note="需人工重放或忽略"
          color="#d49a37"
        />
      </div>
      <div className="split-grid">
        <Panel title="审计事件" meta="按时间倒序">
          <div className="toolbar">
            <label className="search-box">
              <Search size={15} />
              <input placeholder="搜索操作人、对象或请求 ID" />
            </label>
            <button className="filter-button">全部操作</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间 / 操作人</th>
                  <th>操作</th>
                  <th>对象</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    '09:16:32',
                    '王琪',
                    '更新门店映射',
                    '紫藤影像 · 上海总店',
                    '成功',
                    'green',
                  ],
                  [
                    '09:12:11',
                    'ERP-OP-0211',
                    '创建外呼任务',
                    'PT-20260902-00022',
                    '等待容量',
                    'amber',
                  ],
                  [
                    '09:08:45',
                    '王琪',
                    '确认充值到账',
                    'RC-20260902-0008',
                    '成功',
                    'green',
                  ],
                  [
                    '08:58:02',
                    '系统',
                    '隔离未知回调',
                    'INBOX-882193',
                    '需处理',
                    'red',
                  ],
                ].map(([time, operator, action, object, result, tone]) => (
                  <tr key={`${time}-${action}`}>
                    <td>
                      <b>{time}</b>
                      <span className="table-meta">{operator}</span>
                    </td>
                    <td>{action}</td>
                    <td>
                      <span className="mapping-code">{object}</span>
                    </td>
                    <td>
                      <Status tone={tone as 'green' | 'amber' | 'red'}>
                        {result}
                      </Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="异常队列" meta="3 项需注意">
          <div className="timeline">
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>UNKNOWN_TASK_CALLBACK · P0</b>
              <p>callJobId 103825 未映射到平台任务，报文已隔离。</p>
              <button className="table-action mt-2">
                查看原始报文 <ChevronRight size={13} className="inline" />
              </button>
            </div>
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>DELIVERY_RETRY_EXHAUSTED · P1</b>
              <p>CRM 结果事件已重试 8 次，等待人工补发。</p>
            </div>
            <div className="timeline-item">
              <i className="timeline-dot" />
              <b>RECORDING_ARCHIVE_RETRY · P2</b>
              <p>录音下载超时，正在进行第 3 次重试。</p>
            </div>
          </div>
          <div className="notice alert mt-5">
            供应商创建结果不确定时，禁止重复调用创建接口；应先按 request_id
            或外部任务标识查询。
          </div>
        </Panel>
      </div>
    </>
  );
}

export function ApiLogView() {
  return (
    <>
      <PageIntro
        eyebrow="API OBSERVABILITY"
        title="接口日志"
        summary="集中查看 ERP、CRM 与百应接口的请求状态、耗时和失败原因；请求参数、响应内容及认证信息展示前统一脱敏。"
      />
      <Panel title="接口调用记录" meta="等待后端接入">
        <div className="api-log-empty">
          <span>接口日志</span>
          <b>等待接入真实接口调用记录</b>
          <p>
            后端完成日志落库后，可在这里按来源系统、接口、调用状态和请求 ID
            查询完整调用链路。
          </p>
        </div>
      </Panel>
    </>
  );
}

export function ApiInterfaceView() {
  return <ApiDocumentation />;
}

export function LineManagementView() {
  const studios = initialStudios.filter((studio) => studio.status === '正常');
  const [lines, setLines] = useState<BaiyingLine[]>([]);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bindingLine, setBindingLine] = useState<BaiyingLine | null>(null);
  const [selectedStudioIds, setSelectedStudioIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [bindingError, setBindingError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadLines(submittedQuery)
      .then((result) => {
        if (!cancelled) {
          setLines(result.lines);
          setError('');
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : '线路列表加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submittedQuery, refreshKey]);

  const boundStudioIds = new Set(
    lines.flatMap((line) => line.studios.map((studio) => studio.studioId)),
  );
  const openBinding = (line: BaiyingLine) => {
    setBindingLine(line);
    setSelectedStudioIds(line.studios.map((studio) => studio.studioId));
    setBindingError('');
  };
  const toggleStudio = (studioId: string) =>
    setSelectedStudioIds((current) =>
      current.includes(studioId)
        ? current.filter((id) => id !== studioId)
        : [...current, studioId],
    );
  const saveBindings = async () => {
    if (!bindingLine) return;
    setSaving(true);
    setBindingError('');
    try {
      const selectedStudios = studios.filter((studio) =>
        selectedStudioIds.includes(studio.id),
      );
      const result = await saveLineStudioBindings({
        userPhoneId: bindingLine.userPhoneId,
        studios: selectedStudios.map((studio) => ({
          studioId: studio.id,
          studioName: studio.name,
        })),
      });
      setLines((current) =>
        current.map((line) =>
          line.userPhoneId === bindingLine.userPhoneId
            ? { ...line, studios: result.bindings }
            : line,
        ),
      );
      setBindingLine(null);
    } catch (requestError) {
      setBindingError(
        requestError instanceof Error
          ? requestError.message
          : '线路影楼绑定失败',
      );
    } finally {
      setSaving(false);
    }
  };
  const refresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((value) => value + 1);
  };
  const search = (event: { preventDefault(): void }) => {
    event.preventDefault();
    setLoading(true);
    setSubmittedQuery(query.trim());
  };

  return (
    <div className="planned-task-page line-management-page">
      <PageIntro
        eyebrow="BAIYING PHONE LINES"
        title="线路管理"
        summary="实时读取百应“获得公司的外呼线路列表”接口，卡片内容均来自接口；平台仅维护线路与影楼的多选绑定。"
        action={
          <button
            className="primary-button planned-refresh-button"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
            同步百应线路
          </button>
        }
      />
      <section
        className="planned-overview line-overview"
        aria-label="线路资源概览"
      >
        <div>
          <span>接口返回线路</span>
          <b>{loading && !lines.length ? '—' : lines.length}</b>
          <small>当前查询结果</small>
        </div>
        <div>
          <span>已绑定线路</span>
          <b>{lines.filter((line) => line.studios.length).length}</b>
          <small>至少绑定 1 家影楼</small>
        </div>
        <div>
          <span>已覆盖影楼</span>
          <b>{boundStudioIds.size}</b>
          <small>去重后的影楼数量</small>
        </div>
        <div>
          <span>未绑定线路</span>
          <b>{lines.filter((line) => !line.studios.length).length}</b>
          <small>等待配置影楼</small>
        </div>
      </section>
      <Panel
        title="百应外呼线路"
        meta={loading ? '正在同步接口…' : `共 ${lines.length} 条`}
        className="planned-card-panel"
      >
        <form className="planned-toolbar" onSubmit={search}>
          <label className="search-box">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按线路名称、号码或线路 ID 搜索"
            />
          </label>
          <button className="filter-button" type="submit">
            查询
          </button>
        </form>
        <div className="planned-api-note">
          <span>百应实时数据</span>
          <p>
            线路字段来自 phone-list
            接口；影楼绑定由本平台保存，一条线路可以绑定多家影楼。
          </p>
        </div>
        {error ? (
          <div className="planned-state">
            <span className="planned-state-mark">!</span>
            <b>未能读取百应线路列表</b>
            <p>{error}</p>
            <button className="filter-button" onClick={refresh}>
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div className="planned-card-grid" aria-label="正在加载线路列表">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="planned-card planned-card-loading" key={index}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : lines.length ? (
          <div className="planned-card-grid line-card-grid">
            {lines.map((line) => (
              <article
                className="planned-card line-card"
                key={line.userPhoneId}
              >
                <header>
                  <div>
                    <span className="planned-status planned-status-green">
                      接口返回
                    </span>
                    <small>线路 ID</small>
                  </div>
                  <code>#{line.userPhoneId}</code>
                </header>
                <h3>
                  {line.phoneName || line.phone || `线路 ${line.userPhoneId}`}
                </h3>
                <dl className="line-api-fields">
                  <div>
                    <dt>线路号码</dt>
                    <dd>{line.phone || '接口未返回'}</dd>
                  </div>
                  <div>
                    <dt>线路类型</dt>
                    <dd>{line.phoneType}</dd>
                  </div>
                  <div>
                    <dt>场景类型</dt>
                    <dd>{line.sceneType}</dd>
                  </div>
                  <div>
                    <dt>资费类型</dt>
                    <dd>{line.rateType}</dd>
                  </div>
                  <div>
                    <dt>本地资费</dt>
                    <dd>{line.localSellingRate}</dd>
                  </div>
                  <div>
                    <dt>异地资费</dt>
                    <dd>{line.nonlocalSellingRate}</dd>
                  </div>
                  <div>
                    <dt>线路数量</dt>
                    <dd>{line.lineAmount}</dd>
                  </div>
                  <div>
                    <dt>计费周期</dt>
                    <dd>{line.billPeriod}</dd>
                  </div>
                </dl>
                <div
                  className={`line-studio-summary ${line.studios.length ? 'is-bound' : ''}`}
                >
                  <div>
                    <span>绑定影楼</span>
                    <b>
                      {line.studios.length
                        ? `${line.studios.length} 家`
                        : '尚未绑定'}
                    </b>
                    <small>
                      {line.studios
                        .map((studio) => studio.studioName)
                        .join('、') || '点击配置线路适用的影楼'}
                    </small>
                  </div>
                  <button type="button" onClick={() => openBinding(line)}>
                    {line.studios.length ? '修改绑定' : '绑定影楼'}{' '}
                    <ChevronRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="planned-state">
            <span className="planned-state-mark">0</span>
            <b>没有符合条件的百应线路</b>
            <p>请调整线路名称、号码或线路 ID 后重试。</p>
          </div>
        )}
        <footer className="planned-pagination">
          <span>
            查询参数由平台过滤，线路数据实时来自百应 phone-list 接口。
          </span>
        </footer>
      </Panel>
      <Dialog
        open={Boolean(bindingLine)}
        onOpenChange={(open) => {
          if (!open && !saving) setBindingLine(null);
        }}
      >
        <DialogContent
          className="line-binding-dialog max-w-[620px]"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>绑定线路适用影楼</DialogTitle>
            <DialogDescription>
              同一条百应线路可以分配给多家影楼。取消全部选择并保存，可清空该线路的影楼绑定。
            </DialogDescription>
          </DialogHeader>
          <div className="script-binding-context">
            <div>
              <span>当前线路</span>
              <b>
                {bindingLine?.phoneName ||
                  bindingLine?.phone ||
                  `线路 ${bindingLine?.userPhoneId ?? ''}`}
              </b>
            </div>
            <code>#{bindingLine?.userPhoneId}</code>
          </div>
          <div className="line-binding-toolbar">
            <span>
              已选择 {selectedStudioIds.length} / {studios.length} 家
            </span>
            <div>
              <button
                type="button"
                onClick={() =>
                  setSelectedStudioIds(studios.map((studio) => studio.id))
                }
              >
                全选
              </button>
              <button type="button" onClick={() => setSelectedStudioIds([])}>
                清空
              </button>
            </div>
          </div>
          <fieldset className="line-studio-options">
            <legend className="sr-only">选择影楼</legend>
            {studios.map((studio) => {
              const checked = selectedStudioIds.includes(studio.id);
              return (
                <label className={checked ? 'is-selected' : ''} key={studio.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStudio(studio.id)}
                  />
                  <span>
                    <b>{studio.name}</b>
                    <small>
                      {studio.id} · {studio.mcCode}
                    </small>
                  </span>
                  <i>{checked ? '已选择' : '未选择'}</i>
                </label>
              );
            })}
          </fieldset>
          {bindingError ? (
            <div className="notice alert">{bindingError}</div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              className="filter-button"
              onClick={() => setBindingLine(null)}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void saveBindings()}
              disabled={saving}
            >
              {saving ? '正在保存…' : '保存影楼绑定'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DataCategoryView() {
  const pageSize = 30;
  const [sourceSystem, setSourceSystem] = useState<'ERP' | 'CRM'>('ERP');
  const [categories, setCategories] = useState<DataCategory[]>([]);
  const [configured, setConfigured] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void loadDataCategories(sourceSystem)
      .then((result) => {
        if (cancelled) return;
        setCategories(result.categories);
        setConfigured(result.configured);
        setSyncedAt(result.syncedAt);
        setError('');
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : '分类数据加载失败',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, sourceSystem]);

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const visibleCategories = useMemo(
    () =>
      categories.filter((category) => {
        if (!normalizedQuery) return true;
        const rawValues = Object.values(category.fields).join(' ');
        return `${category.externalId} ${category.name} ${category.categoryPath} ${rawValues}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery);
      }),
    [categories, normalizedQuery],
  );
  const boundCategories = categories.filter(
    (category) => category.boundScripts.length,
  ).length;
  const boundScriptCount = new Set(
    categories.flatMap((category) =>
      category.boundScripts.map((script) => script.robotDefId),
    ),
  ).size;
  const totalPages = Math.max(
    1,
    Math.ceil(visibleCategories.length / pageSize),
  );
  const currentPage = Math.min(page, totalPages);
  const pageCategories = visibleCategories.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const switchSource = (next: 'ERP' | 'CRM') => {
    setLoading(true);
    setError('');
    setQuery('');
    setCategories([]);
    setPage(1);
    setSourceSystem(next);
  };
  const refresh = async () => {
    if (sourceSystem !== 'ERP') {
      setLoading(true);
      setRefreshKey((value) => value + 1);
      return;
    }
    setSyncing(true);
    setError('');
    try {
      await syncDataCategories(sourceSystem);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '分类同步失败，继续显示上次成功数据',
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="planned-task-page data-category-page">
      <PageIntro
        eyebrow="SOURCE DATA TAXONOMY"
        title="数据分类"
        summary="页面直接读取平台数据库中的分类快照；后台定期从来源系统同步，失败时继续保留上次成功数据。"
        action={
          <button
            className="primary-button planned-refresh-button"
            onClick={() => void refresh()}
            disabled={loading || syncing}
          >
            <RefreshCw size={13} className={syncing ? 'is-spinning' : ''} />
            {syncing
              ? '正在同步'
              : sourceSystem === 'ERP'
                ? '立即同步 ERP'
                : '刷新分类'}
          </button>
        }
      />
      <section className="category-scope-bar" aria-label="数据分类查询范围">
        <div
          className="category-source-tabs"
          role="tablist"
          aria-label="分类来源"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sourceSystem === 'ERP'}
            className={sourceSystem === 'ERP' ? 'active source-erp' : ''}
            onClick={() => switchSource('ERP')}
          >
            ERP 分类
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceSystem === 'CRM'}
            className={sourceSystem === 'CRM' ? 'active source-crm' : ''}
            onClick={() => switchSource('CRM')}
          >
            CRM 分类
          </button>
        </div>
        <p>
          <b>{sourceSystem === 'ERP' ? '素玄 ERP' : 'CRM'}</b>
          <span>全量分类</span>
        </p>
      </section>
      <section
        className="planned-overview category-overview"
        aria-label="分类概览"
      >
        <div>
          <span>接口返回分类</span>
          <b>{loading && !categories.length ? '—' : categories.length}</b>
          <small>{sourceSystem} · 全量分类</small>
        </div>
        <div>
          <span>启用分类</span>
          <b>{categories.filter((category) => category.active).length}</b>
          <small>接口状态</small>
        </div>
        <div>
          <span>已绑定分类</span>
          <b>{boundCategories}</b>
          <small>至少关联 1 个话术</small>
        </div>
        <div>
          <span>关联话术</span>
          <b>{boundScriptCount}</b>
          <small>按话术 ID 去重</small>
        </div>
      </section>
      <Panel
        title={`${sourceSystem} 分类目录`}
        meta={
          loading
            ? '正在读取本地缓存…'
            : `共 ${visibleCategories.length} 项 · 第 ${currentPage} / ${totalPages} 页${syncedAt ? ` · 同步于 ${new Date(syncedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`
        }
        className="planned-card-panel category-card-panel"
      >
        <div className="planned-toolbar">
          <label className="search-box">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="搜索分类名称、编码、路径或接口字段"
            />
          </label>
          <span className="category-readonly-badge">只读数据</span>
        </div>
        <div className="planned-api-note">
          <span>
            {sourceSystem === 'ERP' ? '本地 ERP 分类快照' : '本地 CRM 分类快照'}
          </span>
          <p>
            {sourceSystem === 'ERP'
              ? '后台每 6 小时从 SAi/Sx_AllCategoryLevel 同步一次；页面查询不直接调用 ERP。'
              : 'CRM 分类从本地分类快照展示；未配置接口时不生成模拟分类。'}
          </p>
        </div>
        {error && categories.length ? (
          <div className="notice alert">
            {error}；下方仍为上次成功同步的数据。
          </div>
        ) : null}
        {error && !categories.length ? (
          <div className="planned-state">
            <span className="planned-state-mark">!</span>
            <b>未能读取{sourceSystem}分类</b>
            <p>{error}</p>
            <button className="filter-button" onClick={() => void refresh()}>
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div
            className="planned-card-grid category-card-grid"
            aria-label="正在加载分类"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <div className="planned-card planned-card-loading" key={index}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : !configured && !categories.length ? (
          <div className="planned-state">
            <span className="planned-state-mark">i</span>
            <b>
              {sourceSystem === 'ERP'
                ? '素玄 ERP 分类接口尚未配置 Token'
                : 'CRM 分类接口尚未接入'}
            </b>
            <p>
              {sourceSystem === 'ERP'
                ? '接口地址已经接入；配置 ERP 提供的访问令牌后即可显示真实分类。'
                : '取得 CRM 分类接口和鉴权信息后，此处会直接显示真实数据。'}
            </p>
          </div>
        ) : visibleCategories.length ? (
          <div className="planned-card-grid category-card-grid">
            {pageCategories.map((category) => {
              const fields = Object.entries(category.fields).slice(0, 6);
              return (
                <article
                  className="planned-card category-card"
                  key={`${category.externalId}-${category.categoryPath}`}
                >
                  <header>
                    <div>
                      <span
                        className={`planned-status ${category.active ? 'planned-status-green' : 'planned-status-gray'}`}
                      >
                        {category.active ? '启用' : '停用'}
                      </span>
                      <small>
                        {category.level
                          ? `第 ${category.level} 级`
                          : '层级未返回'}
                      </small>
                    </div>
                    <code>#{category.externalId}</code>
                  </header>
                  <h3>{category.name}</h3>
                  {category.categoryPath !== category.name ? (
                    <p className="category-path">{category.categoryPath}</p>
                  ) : null}
                  {fields.length ? (
                    <dl className="category-fields">
                      {fields.map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {value === null || value === ''
                              ? '—'
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="category-no-fields">接口未返回其他展示字段</p>
                  )}
                  <section
                    className={`category-script-links ${category.boundScripts.length ? 'has-bindings' : ''}`}
                  >
                    <header>
                      <span>已绑定话术</span>
                      <b>{category.boundScripts.length} 个</b>
                    </header>
                    {category.boundScripts.length ? (
                      <ul>
                        {category.boundScripts.map((script) => (
                          <li key={script.robotDefId}>
                            <span>
                              {script.robotName || '话术名称暂不可用'}
                            </span>
                            <code>#{script.robotDefId}</code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>当前没有话术使用此分类</p>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="planned-state">
            <span className="planned-state-mark">0</span>
            <b>没有符合条件的分类</b>
            <p>请调整搜索关键字后重试。</p>
          </div>
        )}
        <footer className="planned-pagination">
          <span>每页 {pageSize} 条；分类同步失败时保留上次成功快照。</span>
          <div>
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              上一页
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
            >
              下一页
            </button>
          </div>
        </footer>
      </Panel>
    </div>
  );
}
