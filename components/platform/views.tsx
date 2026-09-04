'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Cable, Check, ChevronDown, ChevronRight, Database, Download, RefreshCw, Search, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  loadScripts,
  loadLines,
  loadManagedLines,
  loadPlannedTasks,
  loadSourceCategories,
  savePlannedTaskCategoryBinding,
  saveScriptBinding,
  saveLineStudioBindings,
  type BaiyingLine,
  type BaiyingScript,
  type BaiyingScriptStatus,
  type PlannedTask,
  type PlannedTaskStatus,
  type SourceDataCategory,
} from '@/lib/platform-api';
import { Metric, PageIntro, Panel, Status } from './shared';
export { MappingView } from './mapping-view';

type TaskStatus = '执行中' | '执行完成' | '执行失败';
type TaskTone = 'green' | 'amber' | 'red';

const taskRows: Array<{ id: string; store: string; source: 'ERP' | 'CRM'; type: string; category: string; subcategory: string; script: string; scriptId: string; mappingVersion: string; mappingCoverage: string; numbers: string; title: string; baiyingId: string; status: TaskStatus; tone: TaskTone; createdAt: string; resultStatus: '待回传' | '已回传' | '回传失败'; resultAt: string; recordingCount: string; recordingStatus: '待回传' | '已回传' | '回传失败' | '—'; recordingAt: string }> = [
  { id: 'PT-20260902-00024', store: '紫藤影像 · 上海总店', source: 'ERP', type: '外呼回访', category: '客户激活', subcategory: '婚博会意向', script: '婚博会回访 v3.4', scriptId: 'SC-202608-017', mappingVersion: 'v12', mappingCoverage: '6 / 6', numbers: '10,000', title: '婚博会意向客户回访', baiyingId: 'BY-103829', status: '执行中', tone: 'green', createdAt: '2026-09-02 09:16', resultStatus: '待回传', resultAt: '—', recordingCount: '6,104', recordingStatus: '待回传', recordingAt: '—' },
  { id: 'PT-20260902-00023', store: '远山摄影 · 杭州店', source: 'CRM', type: '外呼回访', category: '二次触达', subcategory: '秋季档期', script: '秋季档期触达 v2.1', scriptId: 'SC-202608-012', mappingVersion: 'v12', mappingCoverage: '5 / 5', numbers: '3,600', title: '秋季档期二次触达', baiyingId: 'BY-103825', status: '执行中', tone: 'green', createdAt: '2026-09-02 08:47', resultStatus: '待回传', resultAt: '—', recordingCount: '1,238', recordingStatus: '待回传', recordingAt: '—' },
  { id: 'PT-20260902-00022', store: '罗曼映像 · 南京店', source: 'ERP', type: '外呼激活', category: '客户激活', subcategory: '到店未成交', script: '未成交激活 v1.8', scriptId: 'SC-202608-009', mappingVersion: 'v11', mappingCoverage: '5 / 5', numbers: '7,200', title: '到店未成交激活', baiyingId: '—', status: '执行失败', tone: 'red', createdAt: '2026-09-02 08:29', resultStatus: '回传失败', resultAt: '2026-09-02 08:32', recordingCount: '0', recordingStatus: '—', recordingAt: '—' },
  { id: 'PT-20260901-00021', store: '晨光摄影 · 苏州园区店', source: 'CRM', type: '外呼关怀', category: '老客维系', subcategory: '周年礼遇', script: '周年礼遇 v1.2', scriptId: 'SC-202608-005', mappingVersion: 'v11', mappingCoverage: '5 / 5', numbers: '2,800', title: '老客周年礼遇', baiyingId: 'BY-103817', status: '执行完成', tone: 'green', createdAt: '2026-09-01 16:21', resultStatus: '已回传', resultAt: '2026-09-01 19:45', recordingCount: '2,742', recordingStatus: '已回传', recordingAt: '2026-09-01 20:03' },
  { id: 'PT-20260901-00020', store: '纪念日影像 · 无锡店', source: 'ERP', type: '外呼回访', category: '咨询跟进', subcategory: '七夕咨询', script: '七夕咨询回访 v1.0', scriptId: 'SC-202607-031', mappingVersion: 'v10', mappingCoverage: '5 / 5', numbers: '1,200', title: '七夕咨询回访', baiyingId: 'BY-103802', status: '执行完成', tone: 'green', createdAt: '2026-09-01 14:05', resultStatus: '已回传', resultAt: '2026-09-01 16:18', recordingCount: '1,174', recordingStatus: '已回传', recordingAt: '2026-09-01 16:41' },
];

function TaskTable({ className = '' }: { className?: string }) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<TaskStatus | '全部'>('全部');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const filteredRows = useMemo(() => taskRows.filter((task) => `${task.id}${task.title}${task.store}${task.baiyingId}`.toLowerCase().includes(keyword.toLowerCase()) && (status === '全部' || task.status === status)), [keyword, status]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const tabs: Array<TaskStatus | '全部'> = ['全部', '执行中', '执行完成', '执行失败'];
  const setTaskStatus = (nextStatus: TaskStatus | '全部') => { setStatus(nextStatus); setPage(1); };
  const statusTone = (value: string): TaskTone => value === '回传失败' ? 'red' : value === '待回传' ? 'amber' : 'green';

  return <Panel title="任务列表" meta={`共 ${filteredRows.length} 笔`} className={className}>
    <div className="task-tabs" aria-label="任务状态筛选">{tabs.map((tab) => <button key={tab} className={status === tab ? 'active' : ''} onClick={() => setTaskStatus(tab)}>{tab} <small>{tab === '全部' ? taskRows.length : taskRows.filter((task) => task.status === tab).length}</small></button>)}</div>
    <div className="toolbar"><label className="search-box"><Search size={15} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索任务编号、任务名称、影楼或百应任务 ID" /></label><select aria-label="任务状态" className="filter-button" value={status} onChange={(event) => setTaskStatus(event.target.value as TaskStatus | '全部')}><option value="全部">全部状态</option><option value="执行中">执行中</option><option value="执行完成">执行完成</option><option value="执行失败">执行失败</option></select><select aria-label="每页展示数量" className="filter-button" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20 条 / 页</option><option value="50">50 条 / 页</option><option value="100">100 条 / 页</option></select></div>
    <div className="table-wrap"><table className="data-table task-table"><caption className="sr-only">呼叫任务列表及映射快照</caption><thead><tr><th>操作</th><th>任务编号</th><th>所属影楼</th><th>任务来源</th><th>任务类型</th><th>任务分类</th><th>任务子分类</th><th>使用话术</th><th>映射快照</th><th>号码数量</th><th>任务名称</th><th>百应任务 ID</th><th>任务状态</th><th>创建时间</th><th>话术名称</th><th>话术 ID</th><th>结果回传</th><th>结果回传时间</th><th>录音获取数量</th><th>录音回传结果</th><th>录音回传时间</th></tr></thead><tbody>{rows.map((task) => <tr key={task.id}><td><div className="operation-cell"><button className="operation-trigger" onClick={() => setActionMenuId(actionMenuId === task.id ? null : task.id)} aria-expanded={actionMenuId === task.id} aria-haspopup="menu">操作 <ChevronDown size={13} /></button>{actionMenuId === task.id ? <div className="operation-menu" role="menu"><button role="menuitem" onClick={() => setActionMenuId(null)}>接口详情</button><button role="menuitem" onClick={() => setActionMenuId(null)}>号码详情</button><button role="menuitem" onClick={() => setActionMenuId(null)}>结果详情</button></div> : null}</div></td><td><span className="mapping-code">{task.id}</span></td><td><b>{task.store}</b></td><td>{task.source}</td><td>{task.type}</td><td>{task.category}</td><td>{task.subcategory}</td><td>{task.script}</td><td><div className="mapping-snapshot" aria-label={`映射快照 ${task.mappingVersion}，覆盖 ${task.mappingCoverage} 个变量`}><b>{task.mappingVersion}</b><small>{task.mappingCoverage} 变量</small></div></td><td>{task.numbers}</td><td><b>{task.title}</b></td><td><span className="mapping-code">{task.baiyingId}</span></td><td><Status tone={task.tone}>{task.status}</Status></td><td className="whitespace-nowrap">{task.createdAt}</td><td>{task.script}</td><td><span className="mapping-code">{task.scriptId}</span></td><td><Status tone={statusTone(task.resultStatus)}>{task.resultStatus}</Status></td><td className="whitespace-nowrap">{task.resultAt}</td><td>{task.recordingCount}</td><td><Status tone={task.recordingStatus === '—' ? 'gray' : statusTone(task.recordingStatus)}>{task.recordingStatus}</Status></td><td className="whitespace-nowrap">{task.recordingAt}</td></tr>)}</tbody></table></div>
    <div className="task-pagination"><span>按创建时间倒序 · 第 {currentPage} / {totalPages} 页</span><span><button className="filter-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><button className="filter-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button></span></div>
  </Panel>;
}

export function OverviewView() {
  return <><PageIntro eyebrow="OPERATIONS OVERVIEW" title="总览" summary="聚焦今天需要处理的外呼、余额与异常。业务任务由 ERP/CRM 创建，平台只负责校验、调度和留痕。" /><div className="metric-grid"><Metric label="今日外呼任务" value="24" note="ERP 15 · CRM 9" color="#4fad78" /><Metric label="正在呼叫" value="1,842" note="全局容量占用 68%" color="#4a9bc2" /><Metric label="已冻结话费" value="¥49,780" note="按 2 分钟 / 号码冻结" color="#d49a37" /><Metric label="待人工处理" value="17" note="3 项为高优先级" color="#c7625b" /></div><div className="split-grid"><Panel title="今日任务走向" meta="09:00 – 20:30"><div className="chart-wrap"><div className="chart-labels"><span>有效接通</span><b>7,268</b><small>较昨日 +12.6%</small></div><div className="bars">{[38,48,43,62,70,57,88,76,95,73,64,82].map((height, index) => <div className="bar-column" key={index}><i style={{ height: `${height}%` }} /><small>{9 + index}:00</small></div>)}</div></div></Panel><Panel title="需要处理" meta="按优先级"><div className="timeline"><div className="timeline-item"><i className="timeline-dot" /><b>罗曼映像 · 任务等待容量</b><p>全局资源余量不足，下一次自动复检：09:35。</p></div><div className="timeline-item"><i className="timeline-dot" /><b>晨光摄影 · 余额不足暂停</b><p>待拨 2,800 人，需先充值并满足启动冻结。</p></div><div className="timeline-item"><i className="timeline-dot" /><b>未知任务回调 · 1 条</b><p>已隔离原始报文，等待人工映射。</p></div></div></Panel></div><div className="mt-[14px]"><TaskTable /></div></>;
}

type StudioStatus = '正常' | '停用';
type BalanceTab = '全部' | '余额充足' | '余额不足' | '欠费';
type StudioModal = 'create' | 'edit' | 'disable' | 'enable' | 'recharge' | 'refund' | null;

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
  status: StudioStatus;
  createdAt: string;
  creator: string;
};

const initialStudios: Studio[] = [
  { id: 'YL-202609-0006', name: '晨光摄影', contact: '周敏', phone: '139****5578', balance: 280, taskCount: 6, rate: '0.48', minutes: 3820, mcCode: 'MC-CG-102', erpUrl: 'https://erp.chenguang.example/callback', crmUrl: 'https://crm.chenguang.example/callback', status: '正常', createdAt: '2026-09-02 09:16:24', creator: '王琪' },
  { id: 'YL-202609-0005', name: '罗曼映像', contact: '李卓', phone: '185****0986', balance: -80.5, taskCount: 11, rate: '0.48', minutes: 6470, mcCode: 'MC-LM-064', erpUrl: 'https://erp.luoman.example/callback', crmUrl: '', status: '正常', createdAt: '2026-09-01 16:48:06', creator: '王琪' },
  { id: 'YL-202609-0004', name: '紫藤影像', contact: '陈思', phone: '138****8210', balance: 13279.4, taskCount: 24, rate: '0.48', minutes: 26840, mcCode: 'MC-ZTY-001', erpUrl: 'https://erp.ziteng.example/callback', crmUrl: 'https://crm.ziteng.example/callback', status: '正常', createdAt: '2026-09-01 14:20:31', creator: '王琪' },
  { id: 'YL-202609-0003', name: '远山摄影', contact: '吴倩', phone: '186****1932', balance: 4315.8, taskCount: 13, rate: '0.48', minutes: 15259, mcCode: 'MC-YS-028', erpUrl: 'https://erp.yuanshan.example/callback', crmUrl: '', status: '正常', createdAt: '2026-08-31 10:12:48', creator: '李萌' },
  { id: 'YL-202609-0002', name: '白屿婚纱摄影', contact: '许宁', phone: '137****1263', balance: 860, taskCount: 3, rate: '0.48', minutes: 970, mcCode: 'MC-BY-019', erpUrl: '', crmUrl: 'https://crm.baiyu.example/callback', status: '停用', createdAt: '2026-08-29 17:35:09', creator: '王琪' },
];

const getBalanceTab = (balance: number): Exclude<BalanceTab, '全部'> => balance <= 0 ? '欠费' : balance < 500 ? '余额不足' : '余额充足';
const formatMoney = (amount: number) => `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const studioFormDefaults = { name: '', contact: '', phone: '', mcCode: '', erpUrl: '', crmUrl: '' };

export function StudioView() {
  const [studios, setStudios] = useState(initialStudios);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | StudioStatus>('全部');
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

  const filteredStudios = useMemo(() => studios.filter((studio) => {
    const matchesKeyword = `${studio.id}${studio.name}${studio.contact}${studio.phone}`.toLowerCase().includes(keyword.toLowerCase());
    return matchesKeyword && (statusFilter === '全部' || studio.status === statusFilter) && (balanceTab === '全部' || getBalanceTab(studio.balance) === balanceTab);
  }), [studios, keyword, statusFilter, balanceTab]);
  const totalPages = Math.max(1, Math.ceil(filteredStudios.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedStudios = filteredStudios.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const tabCounts = (tab: BalanceTab) => tab === '全部' ? studios.length : studios.filter((studio) => getBalanceTab(studio.balance) === tab).length;
  const openModal = (nextModal: Exclude<StudioModal, null>, studio?: Studio) => {
    setFeedback('');
    setActionMenuId(null);
    setActiveStudio(studio ?? null);
    setForm(studio ? { name: studio.name, contact: studio.contact, phone: studio.phone, mcCode: studio.mcCode, erpUrl: studio.erpUrl, crmUrl: studio.crmUrl } : studioFormDefaults);
    setTransactionAmount('');
    setReceiptName('');
    setReceiptError('');
    setModal(nextModal);
  };
  const closeModal = () => { setModal(null); setActiveStudio(null); setTransactionAmount(''); setReceiptName(''); setReceiptError(''); };
  const saveStudio = (event: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    event.preventDefault();
    if (modal === 'create') {
      const nextId = `YL-202609-${String(studios.length + 2).padStart(4, '0')}`;
      setStudios((current) => [{ id: nextId, ...form, balance: 0, taskCount: 0, rate: '0.48', minutes: 0, status: '正常', createdAt: '2026-09-02 10:05:00', creator: '平台管理员' }, ...current]);
      setFeedback('影楼已新增，默认状态为正常。');
    } else if (activeStudio) {
      setStudios((current) => current.map((studio) => studio.id === activeStudio.id ? { ...studio, ...form } : studio));
      setFeedback('影楼信息已更新。');
    }
    closeModal();
  };
  const saveAction = (event: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    event.preventDefault();
    if (!activeStudio || !modal) return;
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get('amount') || 0);
    const actionLabels = { disable: '影楼已停用，停用期间不允许拨打电话。', enable: '影楼已启用。', recharge: `充值成功，已加入账户余额 ${formatMoney(amount)}。`, refund: `退款成功，账户余额已扣减 ${formatMoney(amount)}。` };
    setStudios((current) => current.map((studio) => {
      if (studio.id !== activeStudio.id) return studio;
      if (modal === 'disable') return { ...studio, status: '停用' };
      if (modal === 'enable') return { ...studio, status: '正常' };
      if (modal === 'recharge') return { ...studio, balance: studio.balance + amount };
      if (modal === 'refund') return { ...studio, balance: studio.balance - amount };
      return studio;
    }));
    setFeedback(actionLabels[modal as Exclude<StudioModal, 'create' | 'edit' | null>]);
    closeModal();
  };
  const changePage = (next: number) => setPage(Math.max(1, Math.min(next, totalPages)));
  const setTab = (tab: BalanceTab) => { setBalanceTab(tab); setPage(1); };

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

  return <>
    <header className="studio-page-intro"><div className="studio-page-heading"><h2>影楼管理</h2><p>维护影楼账户、余额、外呼任务与 ERP/CRM 回传地址；停用状态下即使账户有余额也不可拨打电话。</p></div><button className="primary-button" onClick={() => openModal('create')}>+ 新增影楼</button></header>
    {feedback ? <div className="notice mb-[14px]">{feedback}</div> : null}
    <Panel title="影楼列表" meta={`共 ${filteredStudios.length} 家`} className="studio-list-panel">
      <div className="flex flex-wrap gap-2 border-b border-[#edf0ec] px-[17px] pt-3">
        {(['全部', '余额充足', '余额不足', '欠费'] as BalanceTab[]).map((tab) => <button key={tab} onClick={() => setTab(tab)} className={`border-b-2 px-1 pb-3 text-[12px] ${balanceTab === tab ? 'border-[#31785d] text-[#1b624b] font-semibold' : 'border-transparent text-[#748079]'}`}>{tab} <span className="ml-1 rounded-full bg-[#f0f4f1] px-1.5 py-0.5 text-[10px]">{tabCounts(tab)}</span></button>)}
      </div>
      <div className="toolbar">
        <label className="search-box"><Search size={15} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索影楼编号、影楼名称、联系人或联系人手机号" /></label>
        <select aria-label="影楼状态" className="filter-button" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as '全部' | StudioStatus); setPage(1); }}><option value="全部">全部状态</option><option value="正常">正常</option><option value="停用">停用</option></select>
        <select aria-label="每页展示数量" className="filter-button" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20 条 / 页</option><option value="50">50 条 / 页</option><option value="100">100 条 / 页</option></select>
      </div>
      <div className="table-wrap"><table className="data-table studio-table"><thead><tr><th>操作</th><th>影楼编号</th><th>影楼名称</th><th>联系人</th><th>联系人手机号</th><th>账户余额</th><th>余额状态</th><th>任务数量</th><th>电话费（分钟 / 元）</th><th>已拨打分钟数</th><th>MC code</th><th>ERP 回传地址</th><th>CRM 回传地址</th><th>影楼状态</th><th>创建时间</th><th>创建人</th></tr></thead><tbody>{pagedStudios.map((studio) => {
        const balanceTabName = getBalanceTab(studio.balance);
        const balanceTone = balanceTabName === '余额充足' ? 'green' : balanceTabName === '余额不足' ? 'amber' : 'red';
        return <tr key={studio.id}><td><div className="operation-cell"><button className="operation-trigger" onClick={() => setActionMenuId(actionMenuId === studio.id ? null : studio.id)} aria-expanded={actionMenuId === studio.id} aria-haspopup="menu">操作 <ChevronDown size={13} /></button>{actionMenuId === studio.id ? <div className="operation-menu" role="menu"><button role="menuitem" onClick={() => openModal('edit', studio)}>编辑</button>{studio.status === '正常' ? <button role="menuitem" className="operation-danger" onClick={() => openModal('disable', studio)}>停用</button> : <button role="menuitem" onClick={() => openModal('enable', studio)}>启用</button>}<button role="menuitem" onClick={() => openModal('recharge', studio)}>充值</button><button role="menuitem" className="operation-danger" onClick={() => openModal('refund', studio)}>退款</button></div> : null}</div></td><td><span className="mapping-code">{studio.id}</span></td><td><b>{studio.name}</b></td><td>{studio.contact}</td><td>{studio.phone}</td><td><b>{formatMoney(studio.balance)}</b></td><td><Status tone={balanceTone}>{balanceTabName}</Status></td><td>{studio.taskCount}</td><td>{studio.rate}</td><td>{studio.minutes.toLocaleString('zh-CN')}</td><td><span className="mapping-code">{studio.mcCode}</span></td><td className="max-w-[180px] truncate" title={studio.erpUrl}>{studio.erpUrl || '—'}</td><td className="max-w-[180px] truncate" title={studio.crmUrl}>{studio.crmUrl || '—'}</td><td><Status tone={studio.status === '正常' ? 'green' : 'gray'}>{studio.status}</Status></td><td className="whitespace-nowrap">{studio.createdAt}</td><td>{studio.creator}</td></tr>;
      })}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ec] px-[17px] py-3 text-[11px] text-[#748079]"><span>按创建时间倒序 · 第 {currentPage} / {totalPages} 页</span><div className="flex gap-2"><button className="filter-button h-7" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</button><button className="filter-button h-7" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}>下一页</button></div></div>
    </Panel>
    {modal ? <dialog open className="fixed inset-0 z-50 h-auto max-h-none w-auto max-w-none border-0 bg-[#132e28]/40 p-4 backdrop:bg-transparent" aria-labelledby="studio-dialog-title"><div className="w-full max-w-[560px] rounded-lg bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#edf0ec] px-5 py-4"><h3 id="studio-dialog-title" className="font-[Songti_SC,STSong,serif] text-[20px] text-[#1b3832]">{modal === 'create' ? '新增影楼' : modal === 'edit' ? '编辑影楼' : modal === 'disable' ? '停用影楼' : modal === 'enable' ? '启用影楼' : modal === 'recharge' ? '影楼充值' : '影楼退款'}</h3><button aria-label="关闭" className="text-lg text-[#748079]" onClick={closeModal}>×</button></div>
      {(modal === 'create' || modal === 'edit') ? <form onSubmit={saveStudio} className="studio-profile-form"><div className="profile-form-intro"><span className="profile-step">01</span><div><b>完善影楼资料</b><p>先填写基本身份和联系人，再按需要配置系统回传地址。</p></div></div><section className="profile-form-section"><div className="profile-section-heading"><b>基本资料</b><p>这些信息将展示在影楼列表中。</p></div><div className="profile-fields-grid"><label className="profile-field">影楼名称 <i>*</i><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：晨光摄影" autoFocus /></label><label className="profile-field">联系人 <i>*</i><input required value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="请输入联系人姓名" /></label><label className="profile-field">联系人手机号 <i>*</i><input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="例如：138 0000 0000" inputMode="tel" /></label><label className="profile-field">MC code <i>*</i><input required value={form.mcCode} onChange={(event) => setForm({ ...form, mcCode: event.target.value })} placeholder="例如：MC-CG-102" /></label></div></section><section className="profile-form-section profile-callback-section"><div className="profile-section-heading"><b>系统回传地址 <small>可选</small></b><p>用于接收外呼结果；暂不配置也可先保存影楼。</p></div><div className="profile-fields-stack"><label className="profile-field">ERP 回传地址<input type="url" value={form.erpUrl} onChange={(event) => setForm({ ...form, erpUrl: event.target.value })} placeholder="https://erp.example.com/callback" /></label><label className="profile-field">CRM 回传地址<input type="url" value={form.crmUrl} onChange={(event) => setForm({ ...form, crmUrl: event.target.value })} placeholder="https://crm.example.com/callback" /></label></div></section><div className="studio-form-footer"><p><b>*</b> 为必填项，保存后可在操作菜单中继续维护账户信息。</p><div><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button">{modal === 'create' ? '创建影楼' : '保存修改'}</button></div></div></form> : <form onSubmit={saveAction} className="p-5"><>{isMoneyAction ? <div className="transaction-flow"><div className="transaction-context"><div><span>本次操作对象</span><b>{activeStudio?.name}</b><small>{activeStudio?.id}</small></div><div><span>当前账户余额</span><strong>{formatMoney(activeStudio?.balance ?? 0)}</strong></div></div><div className="transaction-intro"><b>{modal === 'recharge' ? '确认到账后，金额会计入可用余额。' : '确认退款后，金额会从可用余额中扣减。'}</b><p>请先填写实际金额并上传对应凭证，确认后将同步更新账户余额。</p></div><div className="transaction-fields"><label className="field-label">{modal === 'recharge' ? '到账金额' : '退款金额'} <b className="text-[#b64c46]">*</b><span className="amount-control"><i>¥</i><input required min="0.01" step="0.01" name="amount" type="number" inputMode="decimal" value={transactionAmount} onChange={(event) => setTransactionAmount(event.target.value)} placeholder="请输入金额" aria-describedby="balance-preview" /></span></label>{modal === 'refund' ? <label className="field-label">退款原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" placeholder="请说明退款原因" /></label> : null}<div className="transaction-result" id="balance-preview"><span>{modal === 'recharge' ? '入账后可用余额' : '扣减后可用余额'}</span><b>{formatMoney((activeStudio?.balance ?? 0) + (modal === 'recharge' ? transactionValue : -transactionValue))}</b></div><label className="receipt-upload" htmlFor="transaction-receipt" onPaste={(event) => { const pastedFile = event.clipboardData.files?.[0]; if (pastedFile) { event.preventDefault(); setReceiptFromFile(pastedFile); } }}><input id="transaction-receipt" name="receipt" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setReceiptFromFile(event.target.files?.[0])} /><Upload size={18} /><span><b>{receiptName ? '已选择凭证' : `上传${modal === 'recharge' ? '付款' : '退款'}凭证`}</b><small>{receiptName || '支持点击选择或直接粘贴 JPG、PNG、PDF，单个文件不超过 10 MB'}</small>{receiptError ? <small className="receipt-error">{receiptError}</small> : null}</span><em>{receiptName ? '更换文件' : '选择文件'}</em></label></div></div> : <p className="text-[13px] leading-6 text-[#68746e]">{modal === 'disable' ? <>停用后，<b>{activeStudio?.name}</b> 即使余额大于 0 也不能拨打电话。</> : <>确认启用 <b>{activeStudio?.name}</b>？</>}</p>}{modal === 'disable' ? <label className="field-label mt-4">停用原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" /></label> : null}</><div className="mt-6 flex justify-end gap-2"><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button" disabled={isMoneyAction && !canSaveTransaction}>{modal === 'enable' ? '确认启用' : modal === 'disable' ? '确认停用' : modal === 'recharge' ? '确认充值入账' : '确认退款扣减'}</button></div></form>}</div></dialog> : null}
  </>;
}


export function TaskView() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedScene, setSelectedScene] = useState('婚博会回访');
  const [created, setCreated] = useState(false);
  const sceneReadiness: Record<string, { status: 'ACTIVE' | 'PENDING_MAPPING' | 'DRIFT_DETECTED'; version: string; coverage: string; lastSync: string; issue: string }> = {
    婚博会回访: { status: 'PENDING_MAPPING', version: '—', coverage: '6 / 7', lastSync: '2026-09-03 09:30', issue: '新增变量“预算范围”尚无已发布映射' },
    客资首次触达: { status: 'ACTIVE', version: 'v12', coverage: '6 / 6', lastSync: '2026-09-03 09:30', issue: '' },
    周年礼遇: { status: 'DRIFT_DETECTED', version: '—', coverage: '5 / 6', lastSync: '2026-09-03 03:30', issue: '不同公司返回的话术变量集合不一致' },
  };
  const readiness = sceneReadiness[selectedScene];
  const isReady = readiness.status === 'ACTIVE';
  const createTask = (event: { preventDefault(): void }) => { event.preventDefault(); if (!isReady) return; setCreated(true); setCreateOpen(false); };
  return <div className={created ? 'task-view task-list-view task-list-created' : 'task-view task-list-view'}><header className="task-page-intro"><div><h2>呼叫任务</h2><p>按创建时间倒序查看任务状态、映射快照、回传进度与录音归档结果。</p></div><button className="primary-button" onClick={() => { setCreated(false); setCreateOpen(true); }}>+ 创建任务</button></header>{created ? <output className="notice compact-task-feedback"><Check size={13} />任务草稿已创建，并锁定映射版本 v12。</output> : null}<TaskTable className="task-list-panel" />
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="task-create-dialog max-w-[590px]" showCloseButton={false}><form onSubmit={createTask}><DialogHeader><DialogTitle>创建外呼任务</DialogTitle><DialogDescription>创建时只校验已发布映射，不允许在此临时编辑字段规则。</DialogDescription></DialogHeader><div className="task-create-fields"><label className="profile-field">任务来源 <i>*</i><select defaultValue="ERP"><option>ERP</option><option>CRM</option></select></label><label className="profile-field">话术场景 <i>*</i><select value={selectedScene} onChange={(event) => setSelectedScene(event.target.value)}><option>婚博会回访</option><option>客资首次触达</option><option>周年礼遇</option></select></label><label className="profile-field task-title-field">任务名称 <i>*</i><input required defaultValue="9 月新客意向回访" /></label></div><section className={`mapping-readiness-card ${isReady ? 'mapping-ready' : 'mapping-blocked'}`}><header><div><span>映射状态</span><Status tone={isReady ? 'green' : readiness.status === 'DRIFT_DETECTED' ? 'red' : 'amber'}>{readiness.status}</Status></div><b>{isReady ? '该场景可以创建新任务' : '该场景暂不可用于新任务'}</b></header><dl><div><dt>映射版本</dt><dd>{readiness.version}</dd></div><div><dt>变量覆盖</dt><dd>{readiness.coverage}</dd></div><div><dt>最后同步</dt><dd>{readiness.lastSync}</dd></div></dl>{!isReady ? <div className="readiness-reason"><span>阻断原因</span><p>{readiness.issue}</p><small>请前往字段映射中心完成处理并发布。</small></div> : <div className="readiness-snapshot"><ShieldCheckIcon />创建后将保存 v12 的变量集合与映射规则快照。</div>}</section><DialogFooter className="task-create-footer"><button type="button" className="filter-button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" disabled={!isReady}>创建任务并锁定快照</button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}

const scriptStatusMeta: Record<BaiyingScriptStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' | 'red' }> = {
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
  const [bindingScript, setBindingScript] = useState<BaiyingScript | null>(null);
  const [sourceSystem, setSourceSystem] = useState<'ERP' | 'CRM'>('ERP');
  const [categories, setCategories] = useState<SourceDataCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [manualPath, setManualPath] = useState('');
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
    void loadScripts({ query: submittedQuery, robotStatus: scope, pageNum, pageSize: 20 })
      .then((page) => {
        if (cancelled) return;
        setScripts(page.scripts);
        setTotal(page.total);
        setPages(page.pages);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : '话术列表加载失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageNum, refreshKey, scope, submittedQuery]);

  useEffect(() => {
    if (!bindingScript) return;
    let cancelled = false;
    void loadSourceCategories(sourceSystem)
      .then(({ categories: sourceCategories }) => { if (!cancelled) setCategories(sourceCategories); })
      .catch((requestError: unknown) => {
        if (!cancelled) setBindingError(requestError instanceof Error ? requestError.message : '数据分类加载失败');
      })
      .finally(() => { if (!cancelled) setCategoryLoading(false); });
    return () => { cancelled = true; };
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
        if (!cancelled) setLineError(requestError instanceof Error ? requestError.message : '线路管理数据加载失败');
      })
      .finally(() => { if (!cancelled) setLineLoading(false); });
    return () => { cancelled = true; };
  }, [bindingScript]);

  const openBinding = (script: BaiyingScript) => {
    const binding = script.binding;
    setBindingScript(script);
    setSourceSystem(binding?.sourceSystem ?? 'ERP');
    setCategoryId(binding?.sourceCategoryId ?? '');
    setManualPath(binding?.categoryPath ?? '');
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
    setCategoryId('');
    setManualPath('');
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
  const selectedCategory = categories.find((category) => category.externalId === categoryId);
  const categoryPath = selectedCategory?.categoryPath ?? manualPath.trim();
  const selectedStudio = studios.find((studio) => studio.id === studioId);
  const selectedLine = lineOptions.find((line) => line.userPhoneId === lineId);
  const canSaveBinding = Boolean(bindingScript && categoryPath && selectedStudio && selectedLine);
  const saveBinding = async () => {
    if (!bindingScript || !categoryPath || !selectedStudio || !selectedLine) return;
    setSavingBinding(true);
    setBindingError('');
    try {
      const { binding } = await saveScriptBinding({
        robotDefId: bindingScript.robotDefId,
        sourceSystem,
        sourceCategoryId: selectedCategory?.externalId ?? `manual:${categoryPath}`,
        categoryPath,
        studioId: selectedStudio.id,
        studioName: selectedStudio.name,
        lineId: selectedLine.userPhoneId,
        lineName: selectedLine.phoneName || selectedLine.phone,
      });
      setScripts((current) => current.map((script) => script.robotDefId === bindingScript.robotDefId ? { ...script, binding } : script));
      setBindingScript(null);
    } catch (requestError) {
      setBindingError(requestError instanceof Error ? requestError.message : '话术绑定保存失败');
    } finally {
      setSavingBinding(false);
    }
  };
  const statusCounts = scripts.reduce<Record<BaiyingScriptStatus, number>>((counts, script) => {
    counts[script.robotStatus] += 1;
    return counts;
  }, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

  return <div className="planned-task-page script-list-page"><PageIntro eyebrow="BAIYING ROBOT LIBRARY" title="话术列表" summary="实时读取百应“获取话术列表”接口，按接口返回的话术名称、状态、行业和上线时间展示；平台仅维护业务绑定，不修改百应话术。" action={<button className="primary-button planned-refresh-button" onClick={requestRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'is-spinning' : ''} />同步百应话术</button>} />
    <section className="planned-overview" aria-label="话术列表概览"><div><span>接口返回话术</span><b>{loading && !total ? '—' : total}</b><small>当前筛选范围</small></div><div><span>当前页已上线</span><b>{statusCounts[5]}</b><small>状态 5</small></div><div><span>当前页待发布</span><b>{statusCounts[0]}</b><small>状态 0</small></div><div><span>当前页已完成绑定</span><b>{scripts.filter((script) => script.binding).length}</b><small>分类 / 影楼 / 线路</small></div></section>
    <Panel title="百应话术" meta={loading ? '正在同步接口…' : `共 ${total} 个 · 第 ${Math.min(pageNum + 1, Math.max(pages, 1))} / ${Math.max(pages, 1)} 页`} className="planned-card-panel"><form className="planned-toolbar" onSubmit={submitSearch}><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按话术名称或话术 ID 搜索" /></label><select aria-label="话术查询范围" className="filter-button" value={scope} onChange={(event) => { setLoading(true); setError(''); setScope(Number(event.target.value) as 0 | 1 | 2); setPageNum(0); }}><option value={0}>所有话术</option><option value={1}>仅已上线</option><option value={2}>所有发布过的话术</option></select><button className="filter-button" type="submit">查询</button></form>
      <div className="planned-api-note"><span>百应实时数据</span><p>卡片字段全部来自 robot-list 接口；数据分类、影楼和线路是本平台保存的调度绑定。</p></div>
      {error ? <div className="planned-state"><span className="planned-state-mark">!</span><b>未能读取百应话术列表</b><p>{error}</p><button className="filter-button" onClick={requestRefresh}>重新加载</button></div> : loading ? <div className="planned-card-grid" aria-label="正在加载话术列表">{Array.from({ length: 6 }, (_, index) => <div className="planned-card planned-card-loading" key={index}><i /><i /><i /></div>)}</div> : scripts.length ? <div className="planned-card-grid script-card-grid">{scripts.map((script) => {
        const statusMeta = scriptStatusMeta[script.robotStatus];
        const industry = [script.industryOneName, script.industryTwoName].filter(Boolean).join(' / ');
        return <article className="planned-card script-card" key={script.robotDefId}><header><div><span className={`planned-status planned-status-${statusMeta.tone}`}>{statusMeta.label}</span><small>状态 {script.robotStatus}</small></div><code>#{script.robotDefId}</code></header><h3>{script.robotName}</h3><dl className="script-card-details"><div><dt>所属行业</dt><dd>{industry || '接口未返回'}</dd></div><div><dt>上线时间</dt><dd>{script.deployTime || '尚未上线'}</dd></div></dl><div className={`script-binding-summary ${script.binding ? 'is-bound' : ''}`}><div><span>数据分类</span><b>{script.binding ? `${script.binding.sourceSystem} · ${script.binding.categoryPath}` : '未绑定'}</b></div><div><span>影楼</span><b>{script.binding?.studioName ?? '未绑定'}</b></div><div><span>线路</span><b>{script.binding?.lineName ?? '未绑定'}</b></div></div><button type="button" className="script-bind-button" onClick={() => openBinding(script)}>{script.binding ? '修改绑定' : '配置绑定'} <ChevronRight size={13} /></button></article>;
      })}</div> : <div className="planned-state"><span className="planned-state-mark">0</span><b>没有符合条件的百应话术</b><p>请调整话术名称或查询范围后重试。</p></div>}
      <footer className="planned-pagination"><span>查询范围直接对应百应接口的 robotStatus 参数。</span><div><button className="filter-button" disabled={loading || pageNum <= 0} onClick={() => { setLoading(true); setPageNum((value) => Math.max(0, value - 1)); }}>上一页</button><button className="filter-button" disabled={loading || pageNum + 1 >= pages} onClick={() => { setLoading(true); setPageNum((value) => value + 1); }}>下一页</button></div></footer>
    </Panel>
    <Dialog open={Boolean(bindingScript)} onOpenChange={(open) => { if (!open && !savingBinding) setBindingScript(null); }}><DialogContent className="script-binding-dialog max-w-[680px]" showCloseButton={false}><DialogHeader><DialogTitle>配置话术业务绑定</DialogTitle><DialogDescription>将百应话术关联到数据分类、影楼和外呼线路。三项配置会作为后续创建呼叫任务时的调度依据。</DialogDescription></DialogHeader><div className="script-binding-context"><div><span>当前话术</span><b>{bindingScript?.robotName}</b></div><code>#{bindingScript?.robotDefId}</code></div><div className="script-binding-form"><section><header><Database size={15} /><div><b>数据分类</b><p>选择 ERP 或 CRM，再指定对应业务分类。</p></div></header><fieldset className="planned-source-switch"><legend className="sr-only">数据来源</legend><button type="button" className={sourceSystem === 'ERP' ? 'active source-erp' : ''} onClick={() => changeSourceSystem('ERP')}>ERP 分类</button><button type="button" className={sourceSystem === 'CRM' ? 'active source-crm' : ''} onClick={() => changeSourceSystem('CRM')}>CRM 分类</button></fieldset><label className="profile-field">接口同步的数据分类<select value={categoryId} disabled={categoryLoading || !categories.length} onChange={(event) => { setCategoryId(event.target.value); const category = categories.find((item) => item.externalId === event.target.value); if (category) setManualPath(category.categoryPath); }}><option value="">{categoryLoading ? '正在读取分类…' : categories.length ? '请选择数据分类' : `${sourceSystem} 暂无同步分类`}</option>{categories.map((category) => <option value={category.externalId} key={category.externalId}>{category.categoryPath}</option>)}</select></label><label className="profile-field">分类路径 <i>*</i><input value={manualPath} onChange={(event) => { setManualPath(event.target.value); setCategoryId(''); }} placeholder="例如：邀约-百天-SS1" /></label></section><section><header><Building2 size={15} /><div><b>影楼归属</b><p>指定使用该话术的业务影楼。</p></div></header><label className="profile-field">影楼 <i>*</i><select value={studioId} onChange={(event) => setStudioId(event.target.value)}><option value="">请选择影楼</option>{studios.map((studio) => <option value={studio.id} key={studio.id}>{studio.name} · {studio.id}</option>)}</select></label></section><section><header><Cable size={15} /><div><b>外呼线路</b><p>选择线路管理中已经同步并维护的线路。</p></div></header><label className="profile-field">线路 <i>*</i><select value={lineId} disabled={lineLoading || !lineOptions.length} onChange={(event) => setLineId(event.target.value)}><option value="">{lineLoading ? '正在读取线路管理…' : lineOptions.length ? '请选择线路' : '线路管理中暂无线路'}</option>{lineId && !lineOptions.some((line) => line.userPhoneId === lineId) ? <option value={lineId}>原绑定线路已不在线路管理中</option> : null}{lineOptions.map((line) => <option value={line.userPhoneId} key={line.userPhoneId}>{line.phoneName || line.phone} · #{line.userPhoneId}</option>)}</select></label>{lineError ? <p className="field-error">{lineError}</p> : null}</section></div>{bindingError ? <div className="notice alert">{bindingError}</div> : null}<DialogFooter><button type="button" className="filter-button" onClick={() => setBindingScript(null)} disabled={savingBinding}>取消</button><button type="button" className="primary-button" onClick={() => void saveBinding()} disabled={!canSaveBinding || savingBinding}>{savingBinding ? '正在保存…' : '保存三项绑定'}</button></DialogFooter></DialogContent></Dialog>
  </div>;
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
    void loadPlannedTasks({ name: submittedQuery, status, pageNum, pageSize: 20 })
      .then((page) => {
        if (cancelled) return;
        setTasks(page.tasks);
        setTotal(page.total);
        setPages(page.pages);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : '话术列表加载失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageNum, refreshKey, status, submittedQuery]);

  useEffect(() => {
    if (!bindingTask) return;
    let cancelled = false;
    void loadSourceCategories(sourceSystem)
      .then(({ categories: sourceCategories }) => { if (!cancelled) setCategories(sourceCategories); })
      .catch((requestError: unknown) => {
        if (!cancelled) setBindingError(requestError instanceof Error ? requestError.message : '数据分类加载失败');
      })
      .finally(() => { if (!cancelled) setCategoryLoading(false); });
    return () => { cancelled = true; };
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
  const closeBinding = () => { if (!savingBinding) setBindingTask(null); };
  const selectedCategory = categories.find((category) => category.externalId === categoryId);
  const categoryPath = selectedCategory?.categoryPath ?? manualPath.trim();
  const saveBinding = async () => {
    if (!bindingTask || !categoryPath) return;
    setSavingBinding(true);
    setBindingError('');
    try {
      const { binding } = await savePlannedTaskCategoryBinding({
        workflowId: bindingTask.id,
        sourceSystem,
        sourceCategoryId: selectedCategory?.externalId ?? `manual:${categoryPath}`,
        categoryPath,
      });
      setTasks((current) => current.map((task) => task.id === bindingTask.id ? { ...task, categoryBinding: binding } : task));
      setBindingTask(null);
    } catch (requestError) {
      setBindingError(requestError instanceof Error ? requestError.message : '数据分类绑定失败');
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
  const visibleCounts = tasks.reduce<Record<PlannedTaskStatus, number>>((counts, task) => {
    counts[task.workflowExecuteStatus] += 1;
    return counts;
  }, { DRAFT: 0, UNSTART: 0, START: 0, FINISH: 0, PAUSE: 0 });

  return <div className="planned-task-page"><PageIntro eyebrow="BAIYING SOP WORKFLOW" title="话术列表" summary="实时读取百应“复杂任务列表 2.0”，展示接口返回的话术任务名称、状态、类型和起止时间，并支持在平台侧绑定 ERP / CRM 数据分类。" action={<button className="primary-button planned-refresh-button" onClick={requestRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'is-spinning' : ''} />同步百应话术</button>} />
    <section className="planned-overview" aria-label="话术列表概览"><div><span>百应话术总数</span><b>{loading && !total ? '—' : total}</b><small>接口当前查询结果</small></div><div><span>当前页进行中</span><b>{visibleCounts.START}</b><small>START</small></div><div><span>当前页已暂停</span><b>{visibleCounts.PAUSE}</b><small>PAUSE</small></div><div><span>当前页已绑定分类</span><b>{tasks.filter((task) => task.categoryBinding).length}</b><small>ERP / CRM</small></div></section>
    <Panel title="百应话术任务" meta={loading ? '正在同步接口…' : `共 ${total} 个 · 第 ${Math.min(pageNum + 1, Math.max(pages, 1))} / ${Math.max(pages, 1)} 页`} className="planned-card-panel"><form className="planned-toolbar" onSubmit={submitSearch}><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按百应话术名称搜索" /></label><select aria-label="话术状态" className="filter-button" value={status} onChange={(event) => { setLoading(true); setError(''); setStatus(event.target.value as PlannedTaskStatus | 'ALL'); setPageNum(0); }}><option value="ALL">全部状态</option><option value="DRAFT">草稿</option><option value="UNSTART">未开始</option><option value="START">进行中</option><option value="PAUSE">已暂停</option><option value="FINISH">已结束</option></select><button className="filter-button" type="submit">查询</button></form>
      <div className="planned-api-note"><span>数据来源</span><p>任务信息来自百应接口；ERP / CRM 分类属于平台绑定信息，不会修改百应原任务。</p></div>
      {error ? <div className="planned-state"><span className="planned-state-mark">!</span><b>未能读取百应话术列表</b><p>{error}</p><button className="filter-button" onClick={requestRefresh}>重新加载</button></div> : loading ? <div className="planned-card-grid" aria-label="正在加载话术列表">{Array.from({ length: 6 }, (_, index) => <div className="planned-card planned-card-loading" key={index}><i /><i /><i /></div>)}</div> : tasks.length ? <div className="planned-card-grid">{tasks.map((task) => {
        const taskStatus = plannedTaskStatusMeta[task.workflowExecuteStatus];
        return <article className="planned-card" key={task.id}><header><div><span className={`planned-status planned-status-${taskStatus.tone}`}>{taskStatus.label}</span><small>{task.workflowExecuteStatus}</small></div><code>#{task.id}</code></header><h3>{task.name}</h3><dl><div><dt>任务类型</dt><dd>{workflowTypeLabel(task.workflowType)}<small>{task.workflowType}</small></dd></div><div><dt>开始时间</dt><dd>{task.startTime || '接口未返回'}</dd></div><div><dt>结束时间</dt><dd>{task.endTime || '接口未返回'}</dd></div></dl><div className={`planned-binding ${task.categoryBinding ? 'is-bound' : ''}`}><div><span>{task.categoryBinding ? `${task.categoryBinding.sourceSystem} 数据分类` : 'ERP / CRM 数据分类'}</span><b>{task.categoryBinding?.categoryPath ?? '尚未绑定'}</b></div><button onClick={() => openBinding(task)}>{task.categoryBinding ? '修改绑定' : '绑定分类'} <ChevronRight size={13} /></button></div></article>;
      })}</div> : <div className="planned-state"><span className="planned-state-mark">0</span><b>没有符合条件的百应话术</b><p>请调整话术名称或状态筛选条件后重试。</p></div>}
      <footer className="planned-pagination"><span>百应接口页码从 0 开始，页面已转换为常用页码展示。</span><div><button className="filter-button" disabled={loading || pageNum <= 0} onClick={() => { setLoading(true); setPageNum((value) => Math.max(0, value - 1)); }}>上一页</button><button className="filter-button" disabled={loading || pageNum + 1 >= pages} onClick={() => { setLoading(true); setPageNum((value) => value + 1); }}>下一页</button></div></footer>
    </Panel>
    <Dialog open={Boolean(bindingTask)} onOpenChange={(open) => { if (!open) closeBinding(); }}><DialogContent className="planned-binding-dialog max-w-[570px]" showCloseButton={false}><DialogHeader><DialogTitle>绑定 ERP / CRM 数据分类</DialogTitle><DialogDescription>为百应计划“{bindingTask?.name}”指定业务来源及分类路径，例如“邀约-百天-SS1”。绑定信息只保存在调度平台。</DialogDescription></DialogHeader><div className="planned-binding-context"><span>百应计划 ID</span><code>{bindingTask?.id}</code></div><fieldset className="planned-source-switch"><legend className="sr-only">数据来源</legend><button className={sourceSystem === 'ERP' ? 'active source-erp' : ''} onClick={() => changeSourceSystem('ERP')}>ERP 分类</button><button className={sourceSystem === 'CRM' ? 'active source-crm' : ''} onClick={() => changeSourceSystem('CRM')}>CRM 分类</button></fieldset><label className="profile-field">接口同步的数据分类<select value={categoryId} disabled={categoryLoading || !categories.length} onChange={(event) => { setCategoryId(event.target.value); const category = categories.find((item) => item.externalId === event.target.value); if (category) setManualPath(category.categoryPath); }}><option value="">{categoryLoading ? '正在读取分类…' : categories.length ? '请选择数据分类' : `${sourceSystem} 尚未同步分类`}</option>{categories.map((category) => <option value={category.externalId} key={category.externalId}>{category.categoryPath}</option>)}</select></label>{!categories.length && !categoryLoading ? <div className="notice warn planned-category-notice"><b>尚无接口分类数据：</b>已预留 ERP / CRM 分类同步接口；取得对方分类接口地址和字段定义后即可自动填充下拉选项。</div> : null}<label className="profile-field">分类路径 <i>*</i><input value={manualPath} onChange={(event) => { setManualPath(event.target.value); setCategoryId(''); }} placeholder="例如：邀约-百天-SS1" /></label>{bindingError ? <div className="notice alert">{bindingError}</div> : null}<DialogFooter><button className="filter-button" onClick={closeBinding} disabled={savingBinding}>取消</button><button className="primary-button" onClick={() => void saveBinding()} disabled={!categoryPath || savingBinding}>{savingBinding ? '正在保存…' : '确认绑定'}</button></DialogFooter></DialogContent></Dialog>
  </div>;
}

const plannedTaskStatusMeta: Record<PlannedTaskStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' }> = {
  DRAFT: { label: '草稿', tone: 'gray' },
  UNSTART: { label: '未开始', tone: 'blue' },
  START: { label: '进行中', tone: 'green' },
  FINISH: { label: '已结束', tone: 'gray' },
  PAUSE: { label: '已暂停', tone: 'amber' },
};

function workflowTypeLabel(value: string) {
  return value === 'OUT_TRIGGER' ? '外呼触发' : value || '接口未返回';
}

function ShieldCheckIcon() { return <span className="snapshot-lock" aria-hidden="true">✓</span>; }


export function BaiyingBillView() {
  return <><PageIntro eyebrow="SUPPLIER STATEMENT" title="百应账单" summary="导入百应正式账单，按公司、任务、单通逐级匹配，保留原始附件与差异处理记录。" action={<button className="primary-button"><Upload size={14} className="mr-1 inline" />导入正式账单</button>} /><div className="split-grid !mt-0"><Panel title="2026-08 百应正式账单" meta="已锁定"><dl className="key-value"><div><dt>账单编号</dt><dd>BY-202608-0001</dd></div><div><dt>导入时间</dt><dd>2026-09-01 14:21</dd></div><div><dt>API 原始成本</dt><dd>¥ 15,886.20</dd></div><div><dt>最终应付金额</dt><dd>¥ 15,921.60</dd></div></dl><div className="mt-5 grid grid-cols-3 gap-2"><div className="bill-stat"><small>已匹配</small><b>12,846</b></div><div className="bill-stat"><small>待处理</small><b className="text-[#b67516]">3</b></div><div className="bill-stat"><small>已冲正</small><b>2</b></div></div><button className="filter-button mt-5"><Download size={13} className="mr-1 inline" />下载原始附件</button></Panel><Panel title="匹配与异常"><div className="notice"><b>匹配优先级：</b>companyId → callJobId → callInstanceId。未命中的行进入人工匹配，不假定供应商文件列名固定。</div><div className="timeline mt-5"><div className="timeline-item"><i className="timeline-dot" /><b>3 条未匹配单通</b><p>账单金额 ¥35.40，等待确认任务归属。</p></div><div className="timeline-item"><i className="timeline-dot" /><b>2 条费用更正已入账</b><p>通过冲正流水处理，不改写原始费用记录。</p></div></div></Panel></div><div className="mt-[14px]"><Panel title="账单导入记录" meta="最近 3 次"><div className="table-wrap"><table className="data-table"><thead><tr><th>账期 / 账单编号</th><th>文件</th><th>总金额</th><th>匹配状态</th><th>操作</th></tr></thead><tbody>{[['2026-08','BY-202608-0001','baiying_202608.xlsx','¥15,921.60','已锁定'],['2026-07','BY-202607-0001','baiying_202607.xlsx','¥14,080.34','已核对'],['2026-06','BY-202606-0001','baiying_202606.pdf','¥13,769.12','已核对']].map(([period, id, file, amount, state]) => <tr key={id}><td><b>{period}</b><span className="table-meta">{id}</span></td><td>{file}</td><td>{amount}</td><td><Status tone="green">{state}</Status></td><td><button className="table-action">查看差异 <ChevronRight size={13} className="inline" /></button></td></tr>)}</tbody></table></div></Panel></div></>;
}

export function StoreBillView() {
  return <><PageIntro eyebrow="STORE ACCOUNTING" title="门店账单" summary="以门店为核算边界展示外呼消耗、冻结、冲正与可用余额；客户看到的金额与供应商成本分开管理。" /><div className="metric-grid"><Metric label="本月门店消耗" value="¥42,610" note="9 家门店 · 含已结算" color="#4fad78" /><Metric label="当前冻结金额" value="¥11,280" note="4 个待执行任务" color="#d49a37" /><Metric label="待确认冲正" value="¥268" note="3 条异常单通" color="#c7625b" /><Metric label="余额预警门店" value="2" note="低于启动冻结线" color="#4a9bc2" /></div><div className="mt-[14px]"><Panel title="门店账单明细" meta="2026-09"><div className="toolbar"><label className="search-box"><Search size={15} /><input placeholder="搜索影楼或门店" /></label><button className="filter-button">2026 年 09 月</button><button className="filter-button">全部影楼</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>影楼 / 门店</th><th>期初余额</th><th>本期消耗</th><th>冻结金额</th><th>可用余额</th><th>状态</th></tr></thead><tbody>{[['紫藤影像 · 上海总店','¥29,600.00','¥12,840.60','¥3,480.00','¥13,279.40','正常','green'],['远山摄影 · 杭州店','¥13,800.00','¥7,324.20','¥2,160.00','¥4,315.80','正常','green'],['晨光摄影 · 苏州园区店','¥2,120.00','¥1,840.00','¥0.00','¥280.00','预警','amber'],['罗曼映像 · 南京店','¥9,600.00','¥3,920.50','¥5,760.00','¥-80.50','欠款','red']].map(([store, opening, consumption, frozen, available, status, tone]) => <tr key={store}><td><b>{store}</b><span className="table-meta">store_id 已绑定</span></td><td>{opening}</td><td>{consumption}</td><td>{frozen}</td><td><b>{available}</b></td><td><Status tone={tone as 'green' | 'amber' | 'red'}>{status}</Status></td></tr>)}</tbody></table></div></Panel></div></>;
}

export function RechargeView() {
  const [showMessage, setShowMessage] = useState(false);
  return <><PageIntro eyebrow="RECHARGE LEDGER" title="充值记录" summary="记录线下充值、到账核验与余额流水。充值优先抵扣欠款，余额变更与流水在同一事务中完成。" action={<button className="primary-button" onClick={() => setShowMessage(true)}>+ 登记线下充值</button>} />{showMessage ? <div className="notice mb-[14px]"><Check size={14} className="mr-1 inline" />已打开充值登记流程：需录入影楼、到账金额、凭证及收款渠道后才可确认入账。</div> : null}<Panel title="充值流水" meta="最近 30 天"><div className="toolbar"><label className="search-box"><Search size={15} /><input placeholder="搜索影楼、流水号或操作人" /></label><button className="filter-button">全部状态</button><button className="filter-button">全部渠道</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>流水编号 / 时间</th><th>影楼 / 门店</th><th>充值金额</th><th>渠道 / 凭证</th><th>入账状态</th><th>操作人</th></tr></thead><tbody>{[['RC-20260902-0008','09-02 09:14','紫藤影像 · 上海总店','¥10,000.00','对公转账 · 凭证已归档','已到账','王琪','green'],['RC-20260901-0007','09-01 16:42','罗曼映像 · 南京店','¥3,000.00','微信收款 · 凭证已归档','已到账','王琪','green'],['RC-20260901-0006','09-01 11:08','晨光摄影 · 苏州园区店','¥2,000.00','对公转账 · 待核验','待核验','李萌','amber'],['RC-20260829-0005','08-29 17:35','远山摄影 · 杭州店','¥5,000.00','银行回单 · 凭证已归档','已到账','王琪','green']].map(([id,time,store,amount,channel,state,operator,tone]) => <tr key={id}><td><b>{id}</b><span className="table-meta">{time}</span></td><td>{store}</td><td><b>{amount}</b></td><td>{channel}</td><td><Status tone={tone as 'green' | 'amber'}>{state}</Status></td><td>{operator}</td></tr>)}</tbody></table></div></Panel><div className="triple-grid"><Panel title="到账规则"><div className="note-list"><p><b>先核验凭证</b><br />支持 JPG / PNG / PDF 凭证</p><p><b>到账即记账</b><br />余额和充值流水一起写入</p></div></Panel><Panel title="欠款处理"><div className="note-list"><p><b>¥1,680.00</b><br />当前全平台待抵欠款</p><p>充值到账后优先抵欠款，剩余金额进入可用余额。</p></div></Panel><Panel title="恢复任务"><div className="notice warn">平台不自动恢复任务。余额满足启动冻结后，由 ERP/CRM 或管理员明确发起恢复。</div></Panel></div></>;
}

export function RateSettingView() {
  const [price, setPrice] = useState('0.40'); const [frozenMinutes, setFrozenMinutes] = useState('2'); const [saved, setSaved] = useState(false);
  return <><PageIntro eyebrow="CALL RATE POLICY" title="话费设置" summary="配置门店对外销售单价与启动冻结规则。价格变更只作用于新创建任务，历史账单保留计费快照。" /><div className="split-grid !mt-0"><Panel title="紫藤影像 · 上海总店"><div className="rate-form"><label><span className="field-label">每分钟销售单价（元）</span><input className="rate-input" value={price} onChange={(event) => { setPrice(event.target.value); setSaved(false); }} inputMode="decimal" /></label><label><span className="field-label">启动冻结分钟数</span><input className="rate-input" value={frozenMinutes} onChange={(event) => { setFrozenMinutes(event.target.value); setSaved(false); }} inputMode="numeric" /></label><label><span className="field-label">适用业务来源</span><select className="rate-input" defaultValue="all"><option value="all">ERP 与 CRM</option><option value="erp">仅 ERP</option><option value="crm">仅 CRM</option></select></label><label><span className="field-label">生效时间</span><select className="rate-input" defaultValue="now"><option value="now">立即对新任务生效</option><option value="tomorrow">明日 00:00 生效</option></select></label></div><div className="notice mt-5"><b>计费方式：</b>ceil(接通时长 / 60) × 门店销售单价。未接通不计销售费用；供应商成本在百应账单内独立核算。</div><div className="mt-5"><button className="primary-button" onClick={() => setSaved(true)}>保存并生成新版本</button>{saved ? <span className="success-inline"><Check size={14} className="mr-1" />已保存为 v5.2，等待发布</span> : null}</div></Panel><Panel title="当前计费快照"><dl className="key-value"><div><dt>当前版本</dt><dd>v5.1</dd></div><div><dt>生效状态</dt><dd>已发布</dd></div><div><dt>当前销售单价</dt><dd>¥ 0.40 / 分钟</dd></div><div><dt>启动冻结</dt><dd>2 个计费分钟</dd></div><div><dt>最后修改</dt><dd>王琪 · 08-21 16:12</dd></div><div><dt>受影响门店</dt><dd>1 家</dd></div></dl><div className="notice warn mt-5">修改价格不会重算已产生费用，也不会改变已进入运行状态任务的冻结金额。</div></Panel></div><div className="mt-[14px]"><Panel title="价格版本历史" meta="保留不可变计费快照"><div className="table-wrap"><table className="data-table"><thead><tr><th>版本</th><th>销售单价</th><th>冻结分钟</th><th>生效时间</th><th>状态</th><th>变更人</th></tr></thead><tbody>{[['v5.1','¥0.40 / 分钟','2','2026-08-21 16:12','当前','王琪'],['v5.0','¥0.38 / 分钟','2','2026-07-01 00:00','已归档','王琪'],['v4.2','¥0.36 / 分钟','2','2026-05-12 09:18','已归档','李萌']].map(([version,rate,minutes,date,state,owner]) => <tr key={version}><td><b>{version}</b></td><td>{rate}</td><td>{minutes}</td><td>{date}</td><td><Status tone={state === '当前' ? 'green' : 'gray'}>{state}</Status></td><td>{owner}</td></tr>)}</tbody></table></div></Panel></div></>;
}

export function AuditLogView() {
  return <><PageIntro eyebrow="AUDIT & EXCEPTION" title="操作日志" summary="完整记录管理员操作、关键状态变更与异常队列处理。回调先原文落库，失败交付进入重试或死信队列。" /><div className="metric-grid"><Metric label="今日管理员操作" value="86" note="所有操作均可追溯" color="#4fad78" /><Metric label="待处理异常" value="17" note="P0：1 · P1：3" color="#c7625b" /><Metric label="回调交付成功率" value="99.6%" note="近 24 小时" color="#4a9bc2" /><Metric label="死信队列" value="4" note="需人工重放或忽略" color="#d49a37" /></div><div className="split-grid"><Panel title="审计事件" meta="按时间倒序"><div className="toolbar"><label className="search-box"><Search size={15} /><input placeholder="搜索操作人、对象或请求 ID" /></label><button className="filter-button">全部操作</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>时间 / 操作人</th><th>操作</th><th>对象</th><th>结果</th></tr></thead><tbody>{[['09:16:32','王琪','更新门店映射','紫藤影像 · 上海总店','成功','green'],['09:12:11','ERP-OP-0211','创建外呼任务','PT-20260902-00022','等待容量','amber'],['09:08:45','王琪','确认充值到账','RC-20260902-0008','成功','green'],['08:58:02','系统','隔离未知回调','INBOX-882193','需处理','red']].map(([time,operator,action,object,result,tone]) => <tr key={`${time}-${action}`}><td><b>{time}</b><span className="table-meta">{operator}</span></td><td>{action}</td><td><span className="mapping-code">{object}</span></td><td><Status tone={tone as 'green' | 'amber' | 'red'}>{result}</Status></td></tr>)}</tbody></table></div></Panel><Panel title="异常队列" meta="3 项需注意"><div className="timeline"><div className="timeline-item"><i className="timeline-dot" /><b>UNKNOWN_TASK_CALLBACK · P0</b><p>callJobId 103825 未映射到平台任务，报文已隔离。</p><button className="table-action mt-2">查看原始报文 <ChevronRight size={13} className="inline" /></button></div><div className="timeline-item"><i className="timeline-dot" /><b>DELIVERY_RETRY_EXHAUSTED · P1</b><p>CRM 结果事件已重试 8 次，等待人工补发。</p></div><div className="timeline-item"><i className="timeline-dot" /><b>RECORDING_ARCHIVE_RETRY · P2</b><p>录音下载超时，正在进行第 3 次重试。</p></div></div><div className="notice alert mt-5">供应商创建结果不确定时，禁止重复调用创建接口；应先按 request_id 或外部任务标识查询。</div></Panel></div></>;
}

export function ApiLogView() {
  return <><PageIntro eyebrow="API OBSERVABILITY" title="接口日志" summary="集中查看 ERP、CRM 与百应接口的请求状态、耗时和失败原因；请求参数、响应内容及认证信息展示前统一脱敏。" /><Panel title="接口调用记录" meta="等待后端接入"><div className="api-log-empty"><span>接口日志</span><b>等待接入真实接口调用记录</b><p>后端完成日志落库后，可在这里按来源系统、接口、调用状态和请求 ID 查询完整调用链路。</p></div></Panel></>;
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
    void loadLines(submittedQuery).then((result) => {
      if (!cancelled) {
        setLines(result.lines);
        setError('');
      }
    }).catch((requestError: unknown) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : '线路列表加载失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [submittedQuery, refreshKey]);

  const boundStudioIds = new Set(lines.flatMap((line) => line.studios.map((studio) => studio.studioId)));
  const openBinding = (line: BaiyingLine) => {
    setBindingLine(line);
    setSelectedStudioIds(line.studios.map((studio) => studio.studioId));
    setBindingError('');
  };
  const toggleStudio = (studioId: string) => setSelectedStudioIds((current) => current.includes(studioId)
    ? current.filter((id) => id !== studioId)
    : [...current, studioId]);
  const saveBindings = async () => {
    if (!bindingLine) return;
    setSaving(true);
    setBindingError('');
    try {
      const selectedStudios = studios.filter((studio) => selectedStudioIds.includes(studio.id));
      const result = await saveLineStudioBindings({
        userPhoneId: bindingLine.userPhoneId,
        studios: selectedStudios.map((studio) => ({ studioId: studio.id, studioName: studio.name })),
      });
      setLines((current) => current.map((line) => line.userPhoneId === bindingLine.userPhoneId
        ? { ...line, studios: result.bindings }
        : line));
      setBindingLine(null);
    } catch (requestError) {
      setBindingError(requestError instanceof Error ? requestError.message : '线路影楼绑定失败');
    } finally {
      setSaving(false);
    }
  };
  const refresh = () => { setLoading(true); setError(''); setRefreshKey((value) => value + 1); };
  const search = (event: { preventDefault(): void }) => { event.preventDefault(); setLoading(true); setSubmittedQuery(query.trim()); };

  return <div className="planned-task-page line-management-page"><PageIntro eyebrow="BAIYING PHONE LINES" title="线路管理" summary="实时读取百应“获得公司的外呼线路列表”接口，卡片内容均来自接口；平台仅维护线路与影楼的多选绑定。" action={<button className="primary-button planned-refresh-button" onClick={refresh} disabled={loading}><RefreshCw size={13} className={loading ? 'is-spinning' : ''} />同步百应线路</button>} />
    <section className="planned-overview line-overview" aria-label="线路资源概览"><div><span>接口返回线路</span><b>{loading && !lines.length ? '—' : lines.length}</b><small>当前查询结果</small></div><div><span>已绑定线路</span><b>{lines.filter((line) => line.studios.length).length}</b><small>至少绑定 1 家影楼</small></div><div><span>已覆盖影楼</span><b>{boundStudioIds.size}</b><small>去重后的影楼数量</small></div><div><span>未绑定线路</span><b>{lines.filter((line) => !line.studios.length).length}</b><small>等待配置影楼</small></div></section>
    <Panel title="百应外呼线路" meta={loading ? '正在同步接口…' : `共 ${lines.length} 条`} className="planned-card-panel"><form className="planned-toolbar" onSubmit={search}><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按线路名称、号码或线路 ID 搜索" /></label><button className="filter-button" type="submit">查询</button></form>
      <div className="planned-api-note"><span>百应实时数据</span><p>线路字段来自 phone-list 接口；影楼绑定由本平台保存，一条线路可以绑定多家影楼。</p></div>
      {error ? <div className="planned-state"><span className="planned-state-mark">!</span><b>未能读取百应线路列表</b><p>{error}</p><button className="filter-button" onClick={refresh}>重新加载</button></div> : loading ? <div className="planned-card-grid" aria-label="正在加载线路列表">{Array.from({ length: 6 }, (_, index) => <div className="planned-card planned-card-loading" key={index}><i /><i /><i /></div>)}</div> : lines.length ? <div className="planned-card-grid line-card-grid">{lines.map((line) => <article className="planned-card line-card" key={line.userPhoneId}><header><div><span className="planned-status planned-status-green">接口返回</span><small>线路 ID</small></div><code>#{line.userPhoneId}</code></header><h3>{line.phoneName || line.phone || `线路 ${line.userPhoneId}`}</h3><dl className="line-api-fields"><div><dt>线路号码</dt><dd>{line.phone || '接口未返回'}</dd></div><div><dt>线路类型</dt><dd>{line.phoneType}</dd></div><div><dt>场景类型</dt><dd>{line.sceneType}</dd></div><div><dt>资费类型</dt><dd>{line.rateType}</dd></div><div><dt>本地资费</dt><dd>{line.localSellingRate}</dd></div><div><dt>异地资费</dt><dd>{line.nonlocalSellingRate}</dd></div><div><dt>线路数量</dt><dd>{line.lineAmount}</dd></div><div><dt>计费周期</dt><dd>{line.billPeriod}</dd></div></dl><div className={`line-studio-summary ${line.studios.length ? 'is-bound' : ''}`}><div><span>绑定影楼</span><b>{line.studios.length ? `${line.studios.length} 家` : '尚未绑定'}</b><small>{line.studios.map((studio) => studio.studioName).join('、') || '点击配置线路适用的影楼'}</small></div><button type="button" onClick={() => openBinding(line)}>{line.studios.length ? '修改绑定' : '绑定影楼'} <ChevronRight size={13} /></button></div></article>)}</div> : <div className="planned-state"><span className="planned-state-mark">0</span><b>没有符合条件的百应线路</b><p>请调整线路名称、号码或线路 ID 后重试。</p></div>}
      <footer className="planned-pagination"><span>查询参数由平台过滤，线路数据实时来自百应 phone-list 接口。</span></footer>
    </Panel>
    <Dialog open={Boolean(bindingLine)} onOpenChange={(open) => { if (!open && !saving) setBindingLine(null); }}><DialogContent className="line-binding-dialog max-w-[620px]" showCloseButton={false}><DialogHeader><DialogTitle>绑定线路适用影楼</DialogTitle><DialogDescription>同一条百应线路可以分配给多家影楼。取消全部选择并保存，可清空该线路的影楼绑定。</DialogDescription></DialogHeader><div className="script-binding-context"><div><span>当前线路</span><b>{bindingLine?.phoneName || bindingLine?.phone || `线路 ${bindingLine?.userPhoneId ?? ''}`}</b></div><code>#{bindingLine?.userPhoneId}</code></div><div className="line-binding-toolbar"><span>已选择 {selectedStudioIds.length} / {studios.length} 家</span><div><button type="button" onClick={() => setSelectedStudioIds(studios.map((studio) => studio.id))}>全选</button><button type="button" onClick={() => setSelectedStudioIds([])}>清空</button></div></div><fieldset className="line-studio-options"><legend className="sr-only">选择影楼</legend>{studios.map((studio) => { const checked = selectedStudioIds.includes(studio.id); return <label className={checked ? 'is-selected' : ''} key={studio.id}><input type="checkbox" checked={checked} onChange={() => toggleStudio(studio.id)} /><span><b>{studio.name}</b><small>{studio.id} · {studio.mcCode}</small></span><i>{checked ? '已选择' : '未选择'}</i></label>; })}</fieldset>{bindingError ? <div className="notice alert">{bindingError}</div> : null}<DialogFooter><button type="button" className="filter-button" onClick={() => setBindingLine(null)} disabled={saving}>取消</button><button type="button" className="primary-button" onClick={() => void saveBindings()} disabled={saving}>{saving ? '正在保存…' : '保存影楼绑定'}</button></DialogFooter></DialogContent></Dialog>
  </div>;
}

export function DataCategoryView() {
  return <><PageIntro eyebrow="SOURCE DATA TAXONOMY" title="数据分类" summary="统一维护 ERP 与 CRM 提供的数据分类，供话术绑定和外呼任务筛选使用。" /><Panel title="ERP / CRM 数据分类" meta="等待接口接入"><div className="api-log-empty"><span>数据分类</span><b>分类数据尚未接入</b><p>后续将在这里按来源系统同步数据分类，并维护分类编码、名称、启用状态及可绑定的话术范围。</p></div></Panel></>;
}
