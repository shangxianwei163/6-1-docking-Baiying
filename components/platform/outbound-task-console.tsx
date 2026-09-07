'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileAudio,
  LoaderCircle,
  OctagonX,
  Pause,
  PhoneCall,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import type {
  ConsoleTaskCommand,
  ConsoleTaskPage,
  ConsoleTaskRecord,
  ConsoleTaskStatusFilter,
  OutboundCallDetail,
} from '@outbound/contracts';
import {
  commandOutboundTask,
  loadOutboundTask,
  loadOutboundTaskCalls,
  loadOutboundTasks,
  PlatformApiError,
  retryOutboundTask,
} from '@/lib/platform-api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UnifiedSelect } from '@/components/ui/unified-select';
import { UnifiedDatePicker } from '@/components/ui/unified-date-picker';
import { Panel, Status } from './shared';

type DetailTab = 'summary' | 'calls';
type StatusTone = 'green' | 'amber' | 'red' | 'blue' | 'gray';

const emptyPage: ConsoleTaskPage = {
  total: 0,
  pages: 0,
  pageNum: 0,
  pageSize: 20,
  statusCounts: {
    all: 0,
    running: 0,
    calling: 0,
    completed: 0,
    failed: 0,
  },
  tasks: [],
};

const statusOptions: Array<{
  value: ConsoleTaskStatusFilter;
  label: string;
  countKey: keyof ConsoleTaskPage['statusCounts'];
}> = [
  { value: 'ALL', label: '全部', countKey: 'all' },
  { value: 'RUNNING', label: '执行中', countKey: 'running' },
  { value: 'CALLING', label: '呼叫中', countKey: 'calling' },
  { value: 'COMPLETED', label: '执行完成', countKey: 'completed' },
  { value: 'FAILED', label: '执行失败', countKey: 'failed' },
];

const executionLabels: Record<
  ConsoleTaskRecord['statuses']['execution'],
  string
> = {
  ACCEPTED: '已受理',
  BAIYING_CREATING: '正在创建百应任务',
  BAIYING_CREATED: '百应任务已创建',
  IMPORTING: '正在导入号码',
  IMPORTED: '号码已导入',
  STARTING: '正在启动',
  CALLING: '正在呼叫',
  PAUSED: '已暂停',
  CALL_COMPLETED: '呼叫已结束',
  RECONCILING: '正在对账',
  COMPLETED: '已完成',
  CREATE_FAILED: '创建失败',
  IMPORT_FAILED: '导入失败',
  START_FAILED: '启动失败',
  CANCELLED: '已取消',
  TERMINATED: '已终止',
};

const callStatusMeta: Record<
  OutboundCallDetail['callStatus'],
  { label: string; tone: StatusTone }
> = {
  ANSWERED: { label: '已接通', tone: 'green' },
  NO_ANSWER: { label: '未接听', tone: 'amber' },
  BUSY: { label: '忙线', tone: 'amber' },
  REJECTED: { label: '拒接', tone: 'red' },
  FAILED: { label: '失败', tone: 'red' },
  UNKNOWN: { label: '未知', tone: 'gray' },
};

export function OutboundTaskConsole() {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ConsoleTaskStatusFilter>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState<ConsoleTaskPage>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedTaskNo, setSelectedTaskNo] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordDraft.trim());
      setPageNum(0);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [keywordDraft]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    void loadOutboundTasks({
      keyword: keyword || undefined,
      status,
      createdFrom: startDate ? shanghaiDayStart(startDate) : undefined,
      createdBefore: endDate ? shanghaiNextDayStart(endDate) : undefined,
      pageNum,
      pageSize,
    })
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        if (result.pages > 0 && pageNum >= result.pages) {
          setPageNum(Math.max(0, result.pages - 1));
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, keyword, pageNum, pageSize, refreshToken, startDate, status]);

  const selectedTask = useMemo(
    () => page.tasks.find((task) => task.taskNo === selectedTaskNo) ?? null,
    [page.tasks, selectedTaskNo],
  );

  const chooseStatus = (value: ConsoleTaskStatusFilter) => {
    setStatus(value);
    setPageNum(0);
  };

  const exportCurrentPage = () => {
    if (!page.tasks.length) return;
    const columns = [
      '任务编号',
      '影楼',
      '来源',
      '任务名称',
      '执行状态',
      '号码数',
      '已产生通话',
      '计费分钟',
      '客户话费',
      '可用余额',
      '百应任务ID',
      '创建时间',
    ];
    const records = page.tasks.map((task) => [
      task.taskNo,
      task.studioName,
      task.sourceSystem,
      task.taskName,
      executionLabels[task.statuses.execution],
      task.phoneCount,
      task.counts.callInstances,
      task.durations.billingMinutes,
      task.billing.customerCharge,
      task.billing.availableBalance,
      task.baiyingCallJobId ?? '',
      formatDateTime(task.timestamps.createdAt),
    ]);
    const csv = `\uFEFF${[columns, ...records]
      .map((record) => record.map(escapeCsv).join(','))
      .join('\r\n')}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `呼叫任务_第${page.pageNum + 1}页.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Panel
        title="真实任务列表"
        meta={loading ? '正在读取数据库…' : `共 ${page.total} 笔`}
        className="real-task-panel"
      >
        <div className="real-task-tabs" aria-label="真实任务状态筛选">
          <div>
            {statusOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={status === option.value ? 'is-active' : ''}
                onClick={() => chooseStatus(option.value)}
              >
                {option.label}
                <small>{page.statusCounts[option.countKey]}</small>
              </button>
            ))}
          </div>
          <span className="real-data-seal">
            <ShieldCheck aria-hidden="true" size={13} />
            PostgreSQL 实时数据
          </span>
        </div>

        <div className="real-task-toolbar">
          <label className="search-box real-task-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索任务编号、名称、影楼、外部请求或百应任务 ID"
            />
          </label>
          <div className="real-task-date-field">
            <span>创建日期从</span>
            <UnifiedDatePicker
              ariaLabel="任务创建开始日期"
              value={startDate}
              max={endDate || undefined}
              clearable
              popupLabel="选择开始日期"
              onValueChange={(value) => {
                setStartDate(value);
                setPageNum(0);
              }}
            />
          </div>
          <div className="real-task-date-field">
            <span>至</span>
            <UnifiedDatePicker
              ariaLabel="任务创建结束日期"
              value={endDate}
              min={startDate || undefined}
              clearable
              popupLabel="选择结束日期"
              onValueChange={(value) => {
                setEndDate(value);
                setPageNum(0);
              }}
            />
          </div>
          <UnifiedSelect
            ariaLabel="真实任务每页数量"
            value={String(pageSize)}
            className="filter-button"
            popupLabel="每页展示数量"
            options={[
              { value: '20', label: '20 条 / 页' },
              { value: '50', label: '50 条 / 页' },
              { value: '100', label: '100 条 / 页' },
            ]}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPageNum(0);
            }}
          />
          <button
            type="button"
            className="real-task-icon-button"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? 'is-spinning' : ''}
              size={14}
            />
            刷新
          </button>
          <button
            type="button"
            className="real-task-icon-button"
            disabled={!page.tasks.length}
            onClick={exportCurrentPage}
          >
            <Download aria-hidden="true" size={14} />
            导出本页
          </button>
        </div>

        {error ? (
          <div className="real-task-feedback is-error" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <div>
              <b>真实任务读取失败</b>
              <span>{error}</span>
            </div>
            <button type="button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : null}

        <div className="table-wrap real-task-table-wrap" aria-busy={loading}>
          <table className="data-table real-task-table">
            <caption className="sr-only">数据库中的外呼任务</caption>
            <thead>
              <tr>
                <th>任务 / 创建时间</th>
                <th>影楼 / 来源</th>
                <th>执行状态</th>
                <th>任务内容</th>
                <th>呼叫进度</th>
                <th>计费 / 余额</th>
                <th>百应任务</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !page.tasks.length
                ? Array.from({ length: 4 }, (_, index) => (
                    <tr className="real-task-skeleton" key={index}>
                      {Array.from({ length: 8 }, (__, cell) => (
                        <td aria-label="正在加载" key={cell}>
                          <i />
                        </td>
                      ))}
                    </tr>
                  ))
                : page.tasks.map((task) => (
                    <TaskRow
                      key={task.taskId}
                      task={task}
                      onOpen={() => setSelectedTaskNo(task.taskNo)}
                    />
                  ))}
            </tbody>
          </table>
          {!loading && !error && !page.tasks.length ? (
            <div className="real-task-empty">
              <PhoneCall aria-hidden="true" size={24} />
              <b>数据库中没有符合条件的任务</b>
              <p>
                可运行本地 ERP/CRM
                示例创建任务；刷新后页面会直接读取数据库结果。
              </p>
            </div>
          ) : null}
        </div>

        <footer className="real-task-pagination">
          <span>
            第 {page.total ? page.pageNum + 1 : 0} / {page.pages} 页 · 当前显示{' '}
            {page.tasks.length} 条
          </span>
          <div>
            <button
              type="button"
              disabled={loading || pageNum === 0}
              onClick={() => setPageNum((current) => Math.max(0, current - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={loading || pageNum + 1 >= page.pages}
              onClick={() => setPageNum((current) => current + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
      </Panel>

      <TaskDetailDialog
        key={selectedTaskNo ?? 'closed'}
        initialTask={selectedTask}
        taskNo={selectedTaskNo}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskNo(null);
        }}
      />
    </>
  );
}

function TaskRow({
  task,
  onOpen,
}: {
  task: ConsoleTaskRecord;
  onOpen: () => void;
}) {
  const progress = task.phoneCount
    ? Math.min(
        100,
        Math.round((task.counts.callInstances / task.phoneCount) * 100),
      )
    : 0;
  const displayTone = taskDisplayTone(task.statuses.display);
  return (
    <tr>
      <td>
        <button type="button" className="real-task-number" onClick={onOpen}>
          {task.taskNo}
        </button>
        <span className="table-meta">
          {formatDateTime(task.timestamps.createdAt)}
        </span>
      </td>
      <td>
        <b>{task.studioName}</b>
        <span className="real-task-source">
          {task.sourceSystem} · {task.mcCode}
        </span>
      </td>
      <td>
        <Status tone={displayTone}>{task.statuses.display}</Status>
        <span className="real-task-state-detail">
          {taskExecutionDetailLabel(task)}
        </span>
      </td>
      <td>
        <strong className="real-task-name">{task.taskName}</strong>
        <span className="real-task-route">
          {task.script.name} · {task.line.name}
        </span>
      </td>
      <td>
        <div className="real-task-progress-copy">
          <b>
            {task.counts.callInstances.toLocaleString('zh-CN')} /{' '}
            {task.phoneCount.toLocaleString('zh-CN')}
          </b>
          <small>{progress}%</small>
        </div>
        <div
          className="real-task-progress"
          aria-label={`呼叫进度 ${progress}%`}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="real-task-progress-note">
          已导入 {task.counts.imported.toLocaleString('zh-CN')} 个号码
        </span>
      </td>
      <td>
        <b className="real-task-charge">
          {formatMoney(task.billing.customerCharge)}
        </b>
        <span className="real-task-balance">
          可用 {formatMoney(task.billing.availableBalance)}
        </span>
        <small className="real-task-rate-state">
          {platformRateLabel(task.billing.platformRateStatus)}
        </small>
      </td>
      <td>
        <code className="real-task-provider-id">
          {task.baiyingCallJobId ?? '尚未创建'}
        </code>
        <span className="real-task-provider-state">
          {task.providerStatus.description ?? '等待供应商状态'}
        </span>
      </td>
      <td>
        <button
          type="button"
          className="real-task-detail-button"
          onClick={onOpen}
        >
          查看详情
          <ExternalLink aria-hidden="true" size={12} />
        </button>
      </td>
    </tr>
  );
}

function TaskDetailDialog({
  taskNo,
  initialTask,
  onOpenChange,
}: {
  taskNo: string | null;
  initialTask: ConsoleTaskRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [task, setTask] = useState<ConsoleTaskRecord | null>(null);
  const [calls, setCalls] = useState<OutboundCallDetail[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('summary');
  const [loading, setLoading] = useState(false);
  const [callsLoading, setCallsLoading] = useState(false);
  const [error, setError] = useState('');
  const [callsError, setCallsError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    if (!taskNo) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setTask(initialTask);
        setCalls([]);
        setNextCursor(null);
        setTab('summary');
        setLoading(true);
        setCallsLoading(true);
        setError('');
        setCallsError('');
      }
    });
    void Promise.allSettled([
      loadOutboundTask(taskNo),
      loadOutboundTaskCalls(taskNo, { limit: 50 }),
    ]).then(([taskResult, callResult]) => {
      if (cancelled) return;
      if (taskResult.status === 'fulfilled') setTask(taskResult.value);
      else setError(apiErrorMessage(taskResult.reason));
      if (callResult.status === 'fulfilled') {
        setCalls(callResult.value.items);
        setNextCursor(callResult.value.nextCursor);
      } else {
        setCallsError(apiErrorMessage(callResult.reason));
      }
      setLoading(false);
      setCallsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [initialTask, refreshToken, taskNo]);

  const loadMoreCalls = async () => {
    if (!taskNo || !nextCursor || callsLoading) return;
    setCallsLoading(true);
    setCallsError('');
    try {
      const result = await loadOutboundTaskCalls(taskNo, {
        cursor: nextCursor,
        limit: 50,
      });
      setCalls((current) => [
        ...current,
        ...result.items.filter(
          (item) =>
            !current.some(
              (existing) => existing.platformCallId === item.platformCallId,
            ),
        ),
      ]);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setCallsError(apiErrorMessage(caught));
    } finally {
      setCallsLoading(false);
    }
  };

  return (
    <Dialog open={Boolean(taskNo)} onOpenChange={onOpenChange}>
      <DialogContent className="real-task-detail-dialog">
        <DialogHeader className="real-task-detail-header">
          <div>
            <span className="real-task-detail-kicker">LIVE TASK RECORD</span>
            <DialogTitle>{task?.taskName ?? taskNo ?? '任务详情'}</DialogTitle>
            <DialogDescription>
              {task
                ? `${task.taskNo} · ${task.studioName} · ${task.sourceSystem}`
                : '正在读取任务详情'}
            </DialogDescription>
          </div>
          {task ? (
            <Status tone={taskDisplayTone(task.statuses.display)}>
              {task.statuses.display}
            </Status>
          ) : null}
        </DialogHeader>

        <div
          className="real-task-detail-tabs"
          role="tablist"
          aria-label="任务详情区域"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'summary'}
            className={tab === 'summary' ? 'is-active' : ''}
            onClick={() => setTab('summary')}
          >
            任务总览
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calls'}
            className={tab === 'calls' ? 'is-active' : ''}
            onClick={() => setTab('calls')}
          >
            通话明细 <small>{task?.counts.callInstances ?? calls.length}</small>
          </button>
          <button
            type="button"
            className="real-task-detail-refresh"
            disabled={loading}
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? 'is-spinning' : ''}
              size={13}
            />
            刷新
          </button>
        </div>

        {error ? (
          <div className="real-task-feedback is-error" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <div>
              <b>任务详情读取失败</b>
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {loading && !task ? (
          <div className="real-task-detail-loading">
            <LoaderCircle aria-hidden="true" size={20} />
            正在读取任务、计费与通话数据…
          </div>
        ) : task && tab === 'summary' ? (
          <TaskSummary
            task={task}
            actionMessage={actionMessage}
            onActionCompleted={(message) => {
              setActionMessage(message);
              setRefreshToken((current) => current + 1);
            }}
          />
        ) : task && tab === 'calls' ? (
          <CallList
            calls={calls}
            error={callsError}
            loading={callsLoading}
            nextCursor={nextCursor}
            onLoadMore={() => void loadMoreCalls()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskSummary({
  task,
  actionMessage,
  onActionCompleted,
}: {
  task: ConsoleTaskRecord;
  actionMessage: string;
  onActionCompleted: (message: string) => void;
}) {
  const [action, setAction] = useState<ConsoleTaskCommand | 'RETRY' | null>(
    null,
  );
  return (
    <div className="real-task-summary">
      <div className="real-task-summary-metrics">
        <SummaryMetric
          icon={PhoneCall}
          label="号码 / 通话"
          value={`${task.counts.callInstances.toLocaleString('zh-CN')} / ${task.phoneCount.toLocaleString('zh-CN')}`}
          note={`成功导入 ${task.importSummary.succeeded.toLocaleString('zh-CN')}`}
        />
        <SummaryMetric
          icon={FileAudio}
          label="通话 / 计费时长"
          value={formatDuration(task.durations.totalSeconds)}
          note={`${task.durations.billingMinutes.toLocaleString('zh-CN')} 分钟`}
        />
        <SummaryMetric
          icon={WalletCards}
          label="客户话费"
          value={formatMoney(task.billing.customerCharge)}
          note={`冻结 ${formatMoney(task.billing.reservedAmount)}`}
        />
        <SummaryMetric
          icon={CheckCircle2}
          label="当前可用余额"
          value={formatMoney(task.billing.availableBalance)}
          note={`账户余额 ${formatMoney(task.billing.studioBalance)}`}
        />
      </div>

      {actionMessage ? (
        <output className="real-task-action-success">
          <CheckCircle2 aria-hidden="true" size={15} />
          {actionMessage}
        </output>
      ) : null}

      {task.actions.commands.length || task.actions.retry.available ? (
        <section className="real-task-control-strip">
          <div>
            <span>OPERATOR CONTROL</span>
            <b>任务处置</b>
            <small>
              每次操作都会记录原因、幂等键和操作人；本地环境不会连接百应或发起电话。
            </small>
          </div>
          <div>
            {task.actions.commands.includes('PAUSE') ? (
              <button type="button" onClick={() => setAction('PAUSE')}>
                <Pause aria-hidden="true" size={13} /> 暂停
              </button>
            ) : null}
            {task.actions.commands.includes('RESUME') ? (
              <button type="button" onClick={() => setAction('RESUME')}>
                <Play aria-hidden="true" size={13} /> 恢复
              </button>
            ) : null}
            {task.actions.retry.available ? (
              <button type="button" onClick={() => setAction('RETRY')}>
                <RotateCcw aria-hidden="true" size={13} /> 安全重试
              </button>
            ) : null}
            {task.actions.commands.includes('TERMINATE') ? (
              <button
                type="button"
                className="is-danger"
                onClick={() => setAction('TERMINATE')}
              >
                <OctagonX aria-hidden="true" size={13} /> 终止
              </button>
            ) : null}
          </div>
        </section>
      ) : task.actions.retry.blockedReason ? (
        <div className="real-task-retry-blocked">
          <ShieldCheck aria-hidden="true" size={14} />
          <span>{task.actions.retry.blockedReason}</span>
        </div>
      ) : null}

      {task.failure ? (
        <div className="real-task-failure">
          <AlertTriangle aria-hidden="true" size={16} />
          <div>
            <b>{task.failure.code}</b>
            <p>{task.failure.message}</p>
            <small>
              {task.failure.stage} · {formatDateTime(task.failure.occurredAt)} ·{' '}
              {task.failure.retryable ? '可以重试' : '需要人工检查'}
            </small>
          </div>
        </div>
      ) : null}

      <div className="real-task-summary-grid">
        <DetailSection title="任务身份" eyebrow="IDENTITY">
          <DetailPair label="平台任务编号" value={task.taskNo} code />
          <DetailPair
            label="外部请求编号"
            value={task.externalRequestId}
            code
          />
          <DetailPair label="来源系统" value={task.sourceSystem} />
          <DetailPair
            label="影楼 / MC Code"
            value={`${task.studioName} · ${task.mcCode}`}
          />
          <DetailPair
            label="创建时间"
            value={formatDateTime(task.timestamps.createdAt)}
          />
          <DetailPair
            label="启动时间"
            value={formatDateTime(task.timestamps.startedAt)}
          />
        </DetailSection>

        <DetailSection title="编排快照" eyebrow="ORCHESTRATION">
          <DetailPair
            label="百应任务 ID"
            value={task.baiyingCallJobId ?? '尚未创建'}
            code
          />
          <DetailPair
            label="供应商状态"
            value={task.providerStatus.description ?? '尚未返回'}
            note={
              task.providerStatus.code === null
                ? undefined
                : `原始码 ${task.providerStatus.code}`
            }
          />
          <DetailPair
            label="话术"
            value={task.script.name}
            note={`#${task.script.robotDefId}`}
          />
          <DetailPair
            label="线路"
            value={task.line.name}
            note={`#${task.line.userPhoneId}`}
          />
          <DetailPair
            label="映射版本"
            value={`v${task.mapping.version} · ${task.mapping.variableCount} 个变量`}
            note={task.mapping.variables.join('、') || '无变量'}
          />
          <DetailPair
            label="数据分类"
            value={task.dataCategories
              .map((category) => category.path)
              .join('、')}
          />
        </DetailSection>

        <DetailSection title="状态与交付" eyebrow="STATE LINES">
          <DetailPair label="平台执行" value={taskExecutionDetailLabel(task)} />
          <DetailPair
            label="结果回传"
            value={deliveryLabel(task.statuses.resultDelivery)}
          />
          <DetailPair
            label="录音归档"
            value={archiveLabel(task.statuses.recordingArchive)}
          />
          <DetailPair
            label="录音回传"
            value={deliveryLabel(task.statuses.recordingDelivery)}
          />
          <DetailPair
            label="计费状态"
            value={billingLabel(task.statuses.billing)}
          />
          <DetailPair
            label="完成 / 对账时间"
            value={formatDateTime(
              task.timestamps.reconciledAt ??
                task.timestamps.providerCompletedAt,
            )}
          />
        </DetailSection>

        <DetailSection title="计费与回调" eyebrow="BILLING & CALLBACK">
          <DetailPair
            label="客户单价"
            value={`${formatMoney(task.billing.customerRate)} / 分钟`}
          />
          <DetailPair
            label="冻结规则"
            value={`${task.billing.frozenMinutes} 分钟 / 号码`}
          />
          <DetailPair
            label="平台成本"
            value={
              task.billing.platformCost
                ? formatMoney(task.billing.platformCost)
                : '尚未结算'
            }
            note={platformRateLabel(task.billing.platformRateStatus)}
          />
          <DetailPair
            label="收益"
            value={
              task.billing.profit
                ? formatMoney(task.billing.profit)
                : '尚未结算'
            }
          />
          <DetailPair
            label="结果回调地址"
            value={task.callbacks.resultUrl}
            code
          />
          <DetailPair
            label="录音回调地址"
            value={task.callbacks.recordingUrl}
            code
          />
        </DetailSection>
      </div>

      <TaskActionDialog
        key={action ?? 'closed'}
        action={action}
        task={task}
        onClose={() => setAction(null)}
        onCompleted={onActionCompleted}
      />
    </div>
  );
}

function TaskActionDialog({
  task,
  action,
  onClose,
  onCompleted,
}: {
  task: ConsoleTaskRecord;
  action: ConsoleTaskCommand | 'RETRY' | null;
  onClose: () => void;
  onCompleted: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!action || reason.trim().length < 2) {
      setError('请填写至少 2 个字的操作原因');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const idempotencyKey = window.crypto.randomUUID();
      const result =
        action === 'RETRY'
          ? await retryOutboundTask(task.taskNo, {
              reason: reason.trim(),
              idempotencyKey,
            })
          : await commandOutboundTask(task.taskNo, {
              command: action,
              reason: reason.trim(),
              idempotencyKey,
            });
      onCompleted(result.message);
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const metadata = action ? taskActionMeta(action) : null;
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="ops-dialog task-action-dialog">
        <DialogHeader>
          <DialogTitle>{metadata?.title ?? '任务操作'}</DialogTitle>
          <DialogDescription>{metadata?.description}</DialogDescription>
        </DialogHeader>
        <div className="task-action-body">
          <dl>
            <div>
              <dt>任务编号</dt>
              <dd>{task.taskNo}</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>{executionLabels[task.statuses.execution]}</dd>
            </div>
          </dl>
          {action === 'TERMINATE' ? (
            <div className="task-action-warning">
              <AlertTriangle aria-hidden="true" size={14} />
              终止不可恢复；确认终态后会释放剩余冻结，迟到通话仍按真实结果补扣。
            </div>
          ) : null}
          <label className="ops-field">
            <span>操作原因</span>
            <textarea
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder={metadata?.placeholder}
            />
          </label>
          {error ? (
            <div className="ops-error-banner" role="alert">
              <AlertTriangle aria-hidden="true" size={13} />
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className={
              action === 'TERMINATE' ? 'danger-button' : 'primary-button'
            }
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? '正在提交…' : metadata?.confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function taskActionMeta(action: ConsoleTaskCommand | 'RETRY') {
  if (action === 'PAUSE') {
    return {
      title: '暂停呼叫任务',
      description: '百应确认暂停后，平台状态才会变更为“已暂停”。',
      placeholder: '例如：影楼临时暂停本次营销活动',
      confirmLabel: '确认暂停',
    };
  }
  if (action === 'RESUME') {
    return {
      title: '恢复呼叫任务',
      description: '仅已暂停任务可以恢复，操作将使用独立幂等键。',
      placeholder: '例如：影楼确认活动恢复，继续剩余号码',
      confirmLabel: '确认恢复',
    };
  }
  if (action === 'RETRY') {
    return {
      title: '安全重试失败阶段',
      description: '系统会先恢复资金与状态，再把同一任务重新加入编排队列。',
      placeholder: '例如：已确认供应商短时故障恢复，批准重新编排',
      confirmLabel: '提交重试',
    };
  }
  return {
    title: '终止呼叫任务',
    description: '该操作不可恢复，请确认影楼已经同意终止。',
    placeholder: '例如：影楼撤销活动，批准立即终止剩余呼叫',
    confirmLabel: '确认终止',
  };
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <span>
        <Icon aria-hidden="true" size={15} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{note}</em>
      </div>
    </article>
  );
}

function DetailSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="real-task-detail-section">
      <header>
        <span>{eyebrow}</span>
        <b>{title}</b>
      </header>
      <dl>{children}</dl>
    </section>
  );
}

function DetailPair({
  label,
  value,
  note,
  code = false,
}: {
  label: string;
  value: string;
  note?: string;
  code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={code ? 'is-code' : undefined}>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function CallList({
  calls,
  loading,
  error,
  nextCursor,
  onLoadMore,
}: {
  calls: OutboundCallDetail[];
  loading: boolean;
  error: string;
  nextCursor: string | null;
  onLoadMore: () => void;
}) {
  return (
    <div className="real-call-list">
      {error ? (
        <div className="real-task-feedback is-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <div>
            <b>通话明细读取失败</b>
            <span>{error}</span>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data-table real-call-table">
          <thead>
            <tr>
              <th>客户 / 脱敏号码</th>
              <th>百应通话 ID</th>
              <th>结果</th>
              <th>通话时长</th>
              <th>计费</th>
              <th>录音</th>
              <th>结果回传</th>
              <th>完成时间</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => {
              const status = callStatusMeta[call.callStatus];
              return (
                <tr key={call.platformCallId}>
                  <td>
                    <b>{call.externalCustomerId}</b>
                    <span className="table-meta">{call.phoneMasked}</span>
                  </td>
                  <td>
                    <code>{call.baiyingCallInstanceId}</code>
                  </td>
                  <td>
                    <Status tone={status.tone}>{status.label}</Status>
                  </td>
                  <td>{formatDuration(call.durationSeconds)}</td>
                  <td>
                    <b>{call.billingMinutes} 分钟</b>
                    <span className="table-meta">
                      {formatMoney(call.customerCharge)}
                    </span>
                  </td>
                  <td>{archiveLabel(call.recording.status)}</td>
                  <td>{deliveryLabel(call.resultDeliveryStatus)}</td>
                  <td>{formatDateTime(call.completedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !calls.length ? (
          <div className="real-task-empty is-compact">
            <FileAudio aria-hidden="true" size={22} />
            <b>尚未收到通话结果</b>
            <p>任务开始后，百应回调会在这里形成脱敏通话明细和逐通话计费。</p>
          </div>
        ) : null}
      </div>
      {loading ? (
        <div className="real-call-loading">
          <LoaderCircle aria-hidden="true" size={15} /> 正在读取通话明细…
        </div>
      ) : null}
      {nextCursor ? (
        <button
          type="button"
          className="real-call-load-more"
          disabled={loading}
          onClick={onLoadMore}
        >
          加载更多通话
        </button>
      ) : calls.length ? (
        <p className="real-call-end">已加载全部 {calls.length} 条通话</p>
      ) : null}
    </div>
  );
}

function taskDisplayTone(
  value: ConsoleTaskRecord['statuses']['display'],
): StatusTone {
  if (value === '执行失败') return 'red';
  if (value === '执行完成') return 'green';
  if (value === '呼叫中') return 'blue';
  return 'amber';
}

function taskExecutionDetailLabel(task: ConsoleTaskRecord): string {
  if (task.statuses.display === '执行完成') return '全部业务回传成功';
  if (task.statuses.execution === 'COMPLETED') {
    if (
      task.statuses.resultDelivery === 'FAILED' ||
      task.statuses.recordingDelivery === 'FAILED'
    ) {
      return '业务回传失败，等待重试';
    }
    return '等待业务回传';
  }
  return executionLabels[task.statuses.execution];
}

function platformRateLabel(
  value: ConsoleTaskRecord['billing']['platformRateStatus'],
) {
  if (value === 'FINAL') return '平台成本已最终结算';
  if (value === 'PROVISIONAL') return '平台成本暂估';
  return '平台成本待月度结算';
}

function billingLabel(value: ConsoleTaskRecord['statuses']['billing']) {
  return (
    {
      RESERVED: '已冻结',
      SETTLING: '正在结算',
      SETTLED: '已结算',
      FAILED: '结算失败',
    } as const
  )[value];
}

function deliveryLabel(
  value:
    | ConsoleTaskRecord['statuses']['resultDelivery']
    | ConsoleTaskRecord['statuses']['recordingDelivery'],
) {
  return (
    {
      PENDING: '待回传',
      DELIVERING: '正在回传',
      SUCCEEDED: '已回传',
      FAILED: '回传失败',
      NOT_APPLICABLE: '无需回传',
    } as const
  )[value];
}

function archiveLabel(
  value: ConsoleTaskRecord['statuses']['recordingArchive'],
) {
  return (
    {
      PENDING: '待归档',
      DOWNLOADING: '下载中',
      ARCHIVED: '已归档',
      PARTIAL: '部分归档',
      FAILED: '归档失败',
      NOT_AVAILABLE: '暂无录音',
    } as const
  )[value];
}

function formatMoney(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function shanghaiDayStart(value: string) {
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

function shanghaiNextDayStart(value: string) {
  const start = new Date(`${value}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

function escapeCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function apiErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError) {
    return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  }
  return error instanceof Error ? error.message : '平台 API 请求失败';
}
