'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, Download, Pause, Play, RefreshCcw, Search, Upload, X } from 'lucide-react';
import { Metric, PageIntro, Panel, Status } from './shared';

type TaskStatus = '执行中' | '执行完成' | '执行失败';
type TaskTone = 'green' | 'amber' | 'red';

const taskRows: Array<{ id: string; store: string; source: 'ERP' | 'CRM'; type: string; category: string; subcategory: string; script: string; scriptId: string; numbers: string; title: string; baiyingId: string; status: TaskStatus; tone: TaskTone; createdAt: string; resultStatus: '待回传' | '已回传' | '回传失败'; resultAt: string; recordingCount: string; recordingStatus: '待回传' | '已回传' | '回传失败'; recordingAt: string }> = [
  { id: 'PT-20260902-00024', store: '紫藤影像 · 上海总店', source: 'ERP', type: '外呼回访', category: '客户激活', subcategory: '婚博会意向', script: '婚博会回访 v3.4', scriptId: 'SC-202608-017', numbers: '10,000', title: '婚博会意向客户回访', baiyingId: 'BY-103829', status: '执行中', tone: 'green', createdAt: '2026-09-02 09:16', resultStatus: '待回传', resultAt: '—', recordingCount: '6,104', recordingStatus: '待回传', recordingAt: '—' },
  { id: 'PT-20260902-00023', store: '远山摄影 · 杭州店', source: 'CRM', type: '外呼回访', category: '二次触达', subcategory: '秋季档期', script: '秋季档期触达 v2.1', scriptId: 'SC-202608-012', numbers: '3,600', title: '秋季档期二次触达', baiyingId: 'BY-103825', status: '执行中', tone: 'green', createdAt: '2026-09-02 08:47', resultStatus: '待回传', resultAt: '—', recordingCount: '1,238', recordingStatus: '待回传', recordingAt: '—' },
  { id: 'PT-20260902-00022', store: '罗曼映像 · 南京店', source: 'ERP', type: '外呼激活', category: '客户激活', subcategory: '到店未成交', script: '未成交激活 v1.8', scriptId: 'SC-202608-009', numbers: '7,200', title: '到店未成交激活', baiyingId: '—', status: '执行失败', tone: 'red', createdAt: '2026-09-02 08:29', resultStatus: '回传失败', resultAt: '2026-09-02 08:32', recordingCount: '0', recordingStatus: '—', recordingAt: '—' },
  { id: 'PT-20260901-00021', store: '晨光摄影 · 苏州园区店', source: 'CRM', type: '外呼关怀', category: '老客维系', subcategory: '周年礼遇', script: '周年礼遇 v1.2', scriptId: 'SC-202608-005', numbers: '2,800', title: '老客周年礼遇', baiyingId: 'BY-103817', status: '执行完成', tone: 'green', createdAt: '2026-09-01 16:21', resultStatus: '已回传', resultAt: '2026-09-01 19:45', recordingCount: '2,742', recordingStatus: '已回传', recordingAt: '2026-09-01 20:03' },
  { id: 'PT-20260901-00020', store: '纪念日影像 · 无锡店', source: 'ERP', type: '外呼回访', category: '咨询跟进', subcategory: '七夕咨询', script: '七夕咨询回访 v1.0', scriptId: 'SC-202607-031', numbers: '1,200', title: '七夕咨询回访', baiyingId: 'BY-103802', status: '执行完成', tone: 'green', createdAt: '2026-09-01 14:05', resultStatus: '已回传', resultAt: '2026-09-01 16:18', recordingCount: '1,174', recordingStatus: '已回传', recordingAt: '2026-09-01 16:41' },
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
    <div className="table-wrap"><table className="data-table task-table"><thead><tr><th>操作</th><th>任务编号</th><th>所属影楼</th><th>任务来源</th><th>任务类型</th><th>任务分类</th><th>任务子分类</th><th>使用话术</th><th>号码数量</th><th>任务名称</th><th>百应任务 ID</th><th>任务状态</th><th>创建时间</th><th>话术名称</th><th>话术 ID</th><th>结果回传</th><th>结果回传时间</th><th>录音获取数量</th><th>录音回传结果</th><th>录音回传时间</th></tr></thead><tbody>{rows.map((task) => <tr key={task.id}><td><div className="operation-cell"><button className="operation-trigger" onClick={() => setActionMenuId(actionMenuId === task.id ? null : task.id)} aria-expanded={actionMenuId === task.id} aria-haspopup="menu">操作 <ChevronDown size={13} /></button>{actionMenuId === task.id ? <div className="operation-menu" role="menu"><button role="menuitem" onClick={() => setActionMenuId(null)}>接口详情</button><button role="menuitem" onClick={() => setActionMenuId(null)}>号码详情</button><button role="menuitem" onClick={() => setActionMenuId(null)}>结果详情</button></div> : null}</div></td><td><span className="mapping-code">{task.id}</span></td><td><b>{task.store}</b></td><td>{task.source}</td><td>{task.type}</td><td>{task.category}</td><td>{task.subcategory}</td><td>{task.script}</td><td>{task.numbers}</td><td><b>{task.title}</b></td><td><span className="mapping-code">{task.baiyingId}</span></td><td><Status tone={task.tone}>{task.status}</Status></td><td className="whitespace-nowrap">{task.createdAt}</td><td>{task.script}</td><td><span className="mapping-code">{task.scriptId}</span></td><td><Status tone={statusTone(task.resultStatus)}>{task.resultStatus}</Status></td><td className="whitespace-nowrap">{task.resultAt}</td><td>{task.recordingCount}</td><td><Status tone={task.recordingStatus === '—' ? 'gray' : statusTone(task.recordingStatus)}>{task.recordingStatus}</Status></td><td className="whitespace-nowrap">{task.recordingAt}</td></tr>)}</tbody></table></div>
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
  const saveStudio = (event: FormEvent<HTMLFormElement>) => {
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
  const saveAction = (event: FormEvent<HTMLFormElement>) => {
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
    {modal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#132e28]/40 p-4" role="dialog" aria-modal="true" aria-labelledby="studio-dialog-title"><div className="w-full max-w-[560px] rounded-lg bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#edf0ec] px-5 py-4"><h3 id="studio-dialog-title" className="font-[Songti_SC,STSong,serif] text-[20px] text-[#1b3832]">{modal === 'create' ? '新增影楼' : modal === 'edit' ? '编辑影楼' : modal === 'disable' ? '停用影楼' : modal === 'enable' ? '启用影楼' : modal === 'recharge' ? '影楼充值' : '影楼退款'}</h3><button aria-label="关闭" className="text-lg text-[#748079]" onClick={closeModal}>×</button></div>
      {(modal === 'create' || modal === 'edit') ? <form onSubmit={saveStudio} className="studio-profile-form"><div className="profile-form-intro"><span className="profile-step">01</span><div><b>完善影楼资料</b><p>先填写基本身份和联系人，再按需要配置系统回传地址。</p></div></div><section className="profile-form-section"><div className="profile-section-heading"><b>基本资料</b><p>这些信息将展示在影楼列表中。</p></div><div className="profile-fields-grid"><label className="profile-field">影楼名称 <i>*</i><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：晨光摄影" autoFocus /></label><label className="profile-field">联系人 <i>*</i><input required value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="请输入联系人姓名" /></label><label className="profile-field">联系人手机号 <i>*</i><input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="例如：138 0000 0000" inputMode="tel" /></label><label className="profile-field">MC code <i>*</i><input required value={form.mcCode} onChange={(event) => setForm({ ...form, mcCode: event.target.value })} placeholder="例如：MC-CG-102" /></label></div></section><section className="profile-form-section profile-callback-section"><div className="profile-section-heading"><b>系统回传地址 <small>可选</small></b><p>用于接收外呼结果；暂不配置也可先保存影楼。</p></div><div className="profile-fields-stack"><label className="profile-field">ERP 回传地址<input type="url" value={form.erpUrl} onChange={(event) => setForm({ ...form, erpUrl: event.target.value })} placeholder="https://erp.example.com/callback" /></label><label className="profile-field">CRM 回传地址<input type="url" value={form.crmUrl} onChange={(event) => setForm({ ...form, crmUrl: event.target.value })} placeholder="https://crm.example.com/callback" /></label></div></section><div className="studio-form-footer"><p><b>*</b> 为必填项，保存后可在操作菜单中继续维护账户信息。</p><div><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button">{modal === 'create' ? '创建影楼' : '保存修改'}</button></div></div></form> : <form onSubmit={saveAction} className="p-5"><>{isMoneyAction ? <div className="transaction-flow"><div className="transaction-context"><div><span>本次操作对象</span><b>{activeStudio?.name}</b><small>{activeStudio?.id}</small></div><div><span>当前账户余额</span><strong>{formatMoney(activeStudio?.balance ?? 0)}</strong></div></div><div className="transaction-intro"><b>{modal === 'recharge' ? '确认到账后，金额会计入可用余额。' : '确认退款后，金额会从可用余额中扣减。'}</b><p>请先填写实际金额并上传对应凭证，确认后将同步更新账户余额。</p></div><div className="transaction-fields"><label className="field-label">{modal === 'recharge' ? '到账金额' : '退款金额'} <b className="text-[#b64c46]">*</b><span className="amount-control"><i>¥</i><input required min="0.01" step="0.01" name="amount" type="number" inputMode="decimal" value={transactionAmount} onChange={(event) => setTransactionAmount(event.target.value)} placeholder="请输入金额" aria-describedby="balance-preview" /></span></label>{modal === 'refund' ? <label className="field-label">退款原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" placeholder="请说明退款原因" /></label> : null}<div className="transaction-result" id="balance-preview"><span>{modal === 'recharge' ? '入账后可用余额' : '扣减后可用余额'}</span><b>{formatMoney((activeStudio?.balance ?? 0) + (modal === 'recharge' ? transactionValue : -transactionValue))}</b></div><label className="receipt-upload" htmlFor="transaction-receipt" tabIndex={0} onPaste={(event) => { const pastedFile = event.clipboardData.files?.[0]; if (pastedFile) { event.preventDefault(); setReceiptFromFile(pastedFile); } }}><input id="transaction-receipt" name="receipt" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setReceiptFromFile(event.target.files?.[0])} /><Upload size={18} /><span><b>{receiptName ? '已选择凭证' : `上传${modal === 'recharge' ? '付款' : '退款'}凭证`}</b><small>{receiptName || '支持点击选择或直接粘贴 JPG、PNG、PDF，单个文件不超过 10 MB'}</small>{receiptError ? <small className="receipt-error">{receiptError}</small> : null}</span><em>{receiptName ? '更换文件' : '选择文件'}</em></label></div></div> : <p className="text-[13px] leading-6 text-[#68746e]">{modal === 'disable' ? <>停用后，<b>{activeStudio?.name}</b> 即使余额大于 0 也不能拨打电话。</> : <>确认启用 <b>{activeStudio?.name}</b>？</>}</p>}{modal === 'disable' ? <label className="field-label mt-4">停用原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" /></label> : null}</><div className="mt-6 flex justify-end gap-2"><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button" disabled={isMoneyAction && !canSaveTransaction}>{modal === 'enable' ? '确认启用' : modal === 'disable' ? '确认停用' : modal === 'recharge' ? '确认充值入账' : '确认退款扣减'}</button></div></form>}</div></div> : null}
  </>;
}

function LegacyTaskView() {
  const [gate, setGate] = useState<'checking' | 'ready' | 'running'>('checking');
  const [message, setMessage] = useState('');
  const recheck = () => { setGate('ready'); setMessage('容量已复检：可分配 8 路并发，任务已满足启动条件。'); };
  const start = () => { setGate('running'); setMessage('任务已提交至百应，正在等待任务 ID 与名称回传。'); };
  return <div className="task-view"><header className="task-page-intro"><div><h2>呼叫任务</h2><p>集中处理启动前校验与进行中的任务；列表可在当前页面直接查看。</p></div><Status tone={gate === 'checking' ? 'amber' : gate === 'ready' ? 'green' : 'blue'}>{gate === 'checking' ? '1 项待处理' : gate === 'ready' ? '可以启动' : '任务已发起'}</Status></header><div className="task-workbench"><Panel title="当前待处理任务" meta="PT-20260902-00022" className="task-primary-panel"><div className="task-hero"><div><p className="eyebrow">WAITING_FOR_CAPACITY</p><h3>到店未成交激活</h3><p>罗曼映像 · 南京店 / ERP</p></div><Status tone={gate === 'running' ? 'blue' : gate === 'ready' ? 'green' : 'amber'}>{gate === 'running' ? '已发起启动' : gate === 'ready' ? '可以启动' : '等待容量'}</Status></div><div className="gate-list task-gate-list">{[['影楼与来源映射','罗曼映像 · 南京店 / ERP','通过'],['话术变量与黑名单','到店未成交激活 v1.8 · 0 个命中','通过'],['客户可用余额','¥ 18,400，可覆盖冻结 ¥ 5,760','通过'],['外呼时段','09:00–20:30，当前可呼叫','通过'],['百应实时容量', gate === 'checking' ? '52 / 76 坐席使用中，暂无法占用并发' : '43 / 76 坐席使用中，可占用 8 路并发', gate === 'checking' ? '等待' : '通过']].map(([name, detail, result]) => <div className="gate-line" key={name}><i className={result === '通过' ? 'gate-pass' : 'gate-wait'} /><div><b>{name}</b><p>{detail}</p></div><strong className={result === '通过' ? 'text-[#287156]' : 'text-[#a86814]'}>{result}</strong></div>)}</div>{message ? <div className="notice mt-3">{message}</div> : null}<div className="task-actions">{gate === 'checking' ? <button className="primary-button" onClick={recheck}><RefreshCcw size={14} className="mr-1 inline" />重新校验容量</button> : <button className="primary-button" disabled={gate === 'running'} onClick={start}><Play size={14} className="mr-1 inline" />确认并启动任务</button>}<button className="filter-button"><Pause size={13} className="mr-1 inline" />暂停 / 终止</button><button className="filter-button">查询百应状态</button></div></Panel><Panel title="任务上下文" className="task-context-panel"><dl className="key-value"><div><dt>业务场景</dt><dd>NO_DEAL_REACTIVATE</dd></div><div><dt>计划时间</dt><dd>立即外呼</dd></div><div><dt>名单规模</dt><dd>7,200 人</dd></div><div><dt>启动冻结</dt><dd>¥ 5,760.00</dd></div><div><dt>合规快照</dt><dd>已确认 · v2.1</dd></div><div><dt>请求方</dt><dd>ERP-OP-0211</dd></div></dl><div className="notice warn mt-4"><b>启动资金规则：</b>冻结不足时任务暂停，不自动恢复。</div></Panel><TaskTable className="task-list-panel" /></div></div>;
  return <><PageIntro eyebrow="CALL TASK ORCHESTRATION" title="呼叫任务" summary="按创建、导入、启动前闸门、执行和结果回传的顺序管理任务；供应商结果不确定时，只查询不重复创建。" /><div className="split-grid !mt-0"><Panel title="当前待处理任务" meta="PT-20260902-00022"><div className="task-hero"><div><p className="eyebrow">WAITING_FOR_CAPACITY</p><h3>到店未成交激活</h3><p>罗曼映像 · 南京店 / ERP / callJobId 尚未生成</p></div><Status tone={gate === 'running' ? 'blue' : gate === 'ready' ? 'green' : 'amber'}>{gate === 'running' ? '已发起启动' : gate === 'ready' ? '可以启动' : '等待容量'}</Status></div><div className="gate-steps"><span>1 接收请求</span><ArrowRight size={12} /><span>2 导入名单</span><ArrowRight size={12} /><b>3 启动前复检</b></div><div className="gate-list">{[['影楼与来源映射','罗曼映像 · 南京店 / ERP','通过'],['话术变量与黑名单','到店未成交激活 v1.8 · 0 个命中','通过'],['客户可用余额','¥ 18,400，可覆盖冻结 ¥ 5,760','通过'],['外呼时段','09:00–20:30，当前可呼叫','通过'],['百应实时容量', gate === 'checking' ? '52 / 76 坐席使用中，暂无法占用并发' : '43 / 76 坐席使用中，可占用 8 路并发', gate === 'checking' ? '等待' : '通过']].map(([name, detail, result]) => <div className="gate-line" key={name}><i className={result === '通过' ? 'gate-pass' : 'gate-wait'} /><div><b>{name}</b><p>{detail}</p></div><strong className={result === '通过' ? 'text-[#287156]' : 'text-[#a86814]'}>{result}</strong></div>)}</div>{message ? <div className="notice">{message}</div> : null}<div className="mt-4 flex flex-wrap gap-2">{gate === 'checking' ? <button className="primary-button" onClick={recheck}><RefreshCcw size={14} className="mr-1 inline" />重新校验容量</button> : <button className="primary-button" disabled={gate === 'running'} onClick={start}><Play size={14} className="mr-1 inline" />确认并启动任务</button>}<button className="filter-button"><Pause size={13} className="mr-1 inline" />暂停 / 终止</button><button className="filter-button">查询百应状态</button></div></Panel><Panel title="任务上下文"><dl className="key-value"><div><dt>业务场景</dt><dd>NO_DEAL_REACTIVATE</dd></div><div><dt>计划时间</dt><dd>立即外呼</dd></div><div><dt>名单规模</dt><dd>7,200 人</dd></div><div><dt>启动冻结</dt><dd>¥ 5,760.00</dd></div><div><dt>合规快照</dt><dd>已确认 · v2.1</dd></div><div><dt>请求方</dt><dd>ERP-OP-0211</dd></div></dl><div className="notice warn mt-5"><b>启动资金规则：</b>待拨号码 × 客户单价 × 2 个计费分钟。冻结不足时任务暂停，不自动恢复。</div></Panel></div><div className="mt-[14px]"><TaskTable /></div></>;
}

export function TaskView() {
  return <div className="task-view task-list-view"><header className="task-page-intro"><div><h2>呼叫任务</h2><p>按创建时间倒序查看任务状态、回传进度与录音归档结果。</p></div></header><TaskTable className="task-list-panel" /></div>;
}

export function MappingView() {
  type TransformType = 'TEXT' | 'DATE' | 'MONEY' | 'ENUM' | 'TEMPLATE';
  type EmptyPolicy = 'BLOCK' | 'DEFAULT';
  type RuleStatus = 'PUBLISHED' | 'DRAFT';
  type MappingRule = { id: string; variable: string; standardField: string; transform: TransformType; emptyPolicy: EmptyPolicy; defaultValue: string; status: RuleStatus; version: number; sample: string; builtin?: boolean };
  type PendingVariable = { id: string; variable: string; scenes: string[]; change: '新增变量' | '变量漂移'; discoveredAt: string };

  const standardFields = [
    ['customer_name', '客户名称'], ['mobile', '联系方式'], ['wedding_date', '婚期'], ['package_interest', '套餐意向'],
    ['store_name', '门店名称'], ['consultant_name', '顾问姓名'], ['budget_range', '预算范围'], ['dress_style', '礼服偏好'],
  ];
  const initialRules: MappingRule[] = [
    { id: 'm1', variable: '客户名称', standardField: 'customer_name', transform: 'TEXT', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sample: '王女士', builtin: true },
    { id: 'm2', variable: '联系方式', standardField: 'mobile', transform: 'TEXT', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sample: '13800000000', builtin: true },
    { id: 'm3', variable: '婚期', standardField: 'wedding_date', transform: 'DATE', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sample: '2026-10-18' },
    { id: 'm4', variable: '套餐意向', standardField: 'package_interest', transform: 'ENUM', emptyPolicy: 'DEFAULT', defaultValue: '待确认', status: 'PUBLISHED', version: 12, sample: '轻奢婚纱照' },
    { id: 'm5', variable: '门店名称', standardField: 'store_name', transform: 'TEXT', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sample: '上海总店' },
    { id: 'm6', variable: '顾问姓名', standardField: 'consultant_name', transform: 'TEMPLATE', emptyPolicy: 'DEFAULT', defaultValue: '门店顾问', status: 'PUBLISHED', version: 12, sample: '陈顾问' },
  ];
  const initialPending: PendingVariable[] = [
    { id: 'p1', variable: '预算范围', scenes: ['婚博会回访', '秋季档期触达'], change: '新增变量', discoveredAt: '09-03 09:30' },
    { id: 'p2', variable: '礼服风格', scenes: ['到店未成交激活'], change: '新增变量', discoveredAt: '09-03 09:30' },
    { id: 'p3', variable: '客户等级', scenes: ['周年礼遇'], change: '变量漂移', discoveredAt: '09-03 03:30' },
  ];
  const emptyDraft = { standardField: 'budget_range', transform: 'TEXT' as TransformType, emptyPolicy: 'BLOCK' as EmptyPolicy, defaultValue: '' };

  const [rules, setRules] = useState(initialRules);
  const [pending, setPending] = useState(initialPending);
  const [query, setQuery] = useState('');
  const [ruleStatus, setRuleStatus] = useState<'全部' | RuleStatus>('全部');
  const [activeVariable, setActiveVariable] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('2026-09-03 09:30');
  const [feedback, setFeedback] = useState('');
  const publishedVersion = Math.max(...rules.filter((rule) => rule.status === 'PUBLISHED').map((rule) => rule.version));
  const draftCount = rules.filter((rule) => rule.status === 'DRAFT').length;
  const filteredRules = rules.filter((rule) => `${rule.variable}${rule.standardField}${rule.transform}`.toLowerCase().includes(query.toLowerCase()) && (ruleStatus === '全部' || rule.status === ruleStatus));

  const openMapping = (variable: string) => {
    const existing = rules.find((rule) => rule.variable === variable);
    const suggestedField = standardFields.find((field) => variable.includes(field[1]) || field[1].includes(variable))?.[0] ?? 'budget_range';
    setActiveVariable(variable);
    setDraft(existing ? { standardField: existing.standardField, transform: existing.transform, emptyPolicy: existing.emptyPolicy, defaultValue: existing.defaultValue } : { ...emptyDraft, standardField: suggestedField });
    setFeedback('');
  };
  const saveMapping = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!activeVariable) return;
    const existing = rules.find((rule) => rule.variable === activeVariable);
    const fieldLabel = standardFields.find(([key]) => key === draft.standardField)?.[1] ?? draft.standardField;
    const nextRule: MappingRule = { id: existing?.id ?? `m${Date.now()}`, variable: activeVariable, ...draft, status: 'DRAFT', version: publishedVersion + 1, sample: draft.emptyPolicy === 'DEFAULT' && draft.defaultValue ? draft.defaultValue : fieldLabel === '预算范围' ? '8,000–12,000 元' : fieldLabel === '礼服偏好' ? '法式轻盈' : `示例${fieldLabel}` };
    setRules((current) => existing ? current.map((rule) => rule.id === existing.id ? nextRule : rule) : [...current, nextRule]);
    setPending((current) => current.filter((item) => item.variable !== activeVariable));
    setActiveVariable(null);
    setFeedback(`“${activeVariable}”已保存为草稿，发布后供新任务使用。`);
  };
  const publishDrafts = () => {
    if (!draftCount) return;
    const nextVersion = publishedVersion + 1;
    setRules((current) => current.map((rule) => rule.status === 'DRAFT' ? { ...rule, status: 'PUBLISHED', version: nextVersion } : rule));
    setFeedback(`映射版本 v${nextVersion} 已发布。已创建任务继续使用原快照，新任务将锁定此版本。`);
  };
  const syncVariables = () => {
    setSyncing(true);
    setFeedback('');
    window.setTimeout(() => {
      setSyncing(false);
      setLastSync('2026-09-03 10:06');
      setFeedback('同步完成：已巡检 18 个话术场景，保留最近一次成功快照，未发现新的变量变化。');
    }, 800);
  };
  const activeScenes = 17 - pending.filter((item) => item.change === '新增变量').length - (pending.some((item) => item.change === '变量漂移') ? 1 : 0);

  return <div className="mapping-center">
    <PageIntro eyebrow="GLOBAL VARIABLE GOVERNANCE" title="字段映射中心" summary="统一维护百应话术变量与平台标准字段。规则全局共用；只有巡检正常且映射已发布的场景，才允许创建新任务或导入名单。" action={<button className="primary-button sync-button" onClick={syncVariables} disabled={syncing}><RefreshCcw size={14} className={syncing ? 'spin' : ''} />{syncing ? '正在同步…' : '立即同步'}</button>} />
    {feedback ? <output className="notice mapping-feedback"><Check size={14} />{feedback}</output> : null}

    <section className="inspection-board" aria-label="变量巡检">
      <div className="inspection-lead"><div><p className="eyebrow">VARIABLE INSPECTION</p><h3>变量巡检</h3><p>每 6 小时自动查询百应场景变量；超过 24 小时未成功同步将阻断使用。</p></div><div className="sync-stamp"><span>最后成功同步</span><b>{lastSync}</b><small>下一次自动同步 15:30</small></div></div>
      <div className="inspection-metrics">
        <article><span>场景总数</span><b>18</b><small>覆盖 6 家公司</small></article>
        <article className="metric-ok"><span>正常</span><b>{activeScenes}</b><small>允许新任务 / 导入</small></article>
        <article className="metric-warn"><span>待映射</span><b>{pending.filter((item) => item.change === '新增变量').length}</b><small>新增变量待配置</small></article>
        <article className="metric-danger"><span>漂移</span><b>{pending.some((item) => item.change === '变量漂移') ? 1 : 0}</b><small>变量集合不一致</small></article>
        <article className="metric-muted"><span>同步失败</span><b>1</b><small>使用上次成功快照</small></article>
      </div>
    </section>

    <Panel title="待处理变量" meta={`${pending.length} 项阻断新任务`} className="pending-panel">
      {pending.length ? <div className="pending-list">{pending.map((item) => <article className="pending-item" key={item.id}><div className={`change-mark ${item.change === '变量漂移' ? 'change-drift' : ''}`}>{item.change === '新增变量' ? '+' : '↯'}</div><div className="pending-variable"><span className="mapping-code">{item.variable}</span><b>{item.change}</b></div><div><span className="pending-label">影响话术场景</span><p>{item.scenes.join('、')}</p></div><div><span className="pending-label">发现时间</span><p>{item.discoveredAt}</p></div><Status tone={item.change === '变量漂移' ? 'red' : 'amber'}>{item.change === '变量漂移' ? 'DRIFT_DETECTED' : 'PENDING_MAPPING'}</Status><button className="table-action pending-action" onClick={() => openMapping(item.variable)}>配置映射 <ChevronRight size={13} /></button></article>)}</div> : <div className="pending-empty"><Check size={18} /><div><b>所有新增变量均已配置</b><p>发布草稿后，相关场景将重新计算就绪状态。</p></div></div>}
    </Panel>

    <Panel title="全局映射规则" meta={`当前发布版本 v${publishedVersion}`} className="rules-panel">
      <div className="rules-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索百应变量、标准字段或转换类型" /></label><select className="filter-button" aria-label="规则状态" value={ruleStatus} onChange={(event) => setRuleStatus(event.target.value as '全部' | RuleStatus)}><option value="全部">全部状态</option><option value="PUBLISHED">已发布</option><option value="DRAFT">草稿</option></select><button className="primary-button" onClick={publishDrafts} disabled={!draftCount}>发布草稿{draftCount ? `（${draftCount}）` : ''}</button></div>
      <div className="rule-scope"><span>全局规则</span><p>对全部影楼、公司与话术场景生效。发布会生成不可变版本；已创建任务不受影响。</p></div>
      <div className="table-wrap"><table className="data-table mapping-table"><thead><tr><th>百应变量名</th><th>平台标准字段</th><th>写入位置</th><th>转换规则</th><th>空值策略</th><th>发布版本</th><th>样例预览</th><th>操作</th></tr></thead><tbody>{filteredRules.map((rule) => <tr key={rule.id}><td><b>{rule.variable}</b>{rule.builtin ? <span className="builtin-tag">百应默认</span> : null}</td><td><span className="mapping-code">{rule.standardField}</span></td><td><span className="payload-path">{rule.builtin ? (rule.standardField === 'mobile' ? 'phone' : 'name') : `properties.${rule.variable}`}</span></td><td><b>{rule.transform}</b></td><td>{rule.emptyPolicy === 'BLOCK' ? <Status tone="red">缺失阻断</Status> : <div><Status tone="blue">使用默认值</Status><small className="table-meta">{rule.defaultValue}</small></div>}</td><td><Status tone={rule.status === 'PUBLISHED' ? 'green' : 'amber'}>{rule.status === 'PUBLISHED' ? `v${rule.version} 已发布` : '待发布'}</Status></td><td><span className="sample-preview">{rule.sample}</span></td><td>{rule.builtin ? <span className="locked-rule">系统保护</span> : <button className="table-action" onClick={() => openMapping(rule.variable)}>编辑</button>}</td></tr>)}</tbody></table></div>
      {!filteredRules.length ? <div className="rule-empty">没有符合条件的映射规则</div> : null}
    </Panel>

    {activeVariable ? <dialog open className="mapping-dialog-backdrop" aria-labelledby="mapping-dialog-title"><form className="mapping-dialog" onSubmit={saveMapping}><header><div><p className="eyebrow">MAPPING DRAFT</p><h3 id="mapping-dialog-title">配置变量映射</h3></div><button type="button" aria-label="关闭" onClick={() => setActiveVariable(null)}><X size={18} /></button></header><div className="mapping-dialog-body"><div className="readonly-variable"><span>百应变量名 · 来自同步结果，不可修改</span><b>{activeVariable}</b></div><label className="profile-field">平台标准字段 <i>*</i><select required value={draft.standardField} onChange={(event) => setDraft({ ...draft, standardField: event.target.value })}>{standardFields.filter(([key]) => key !== 'customer_name' && key !== 'mobile').map(([key, label]) => <option value={key} key={key}>{label} · {key}</option>)}</select></label><div className="mapping-form-grid"><label className="profile-field">转换规则 <i>*</i><select value={draft.transform} onChange={(event) => setDraft({ ...draft, transform: event.target.value as TransformType })}><option>TEXT</option><option>DATE</option><option>MONEY</option><option>ENUM</option><option>TEMPLATE</option></select></label><label className="profile-field">空值策略 <i>*</i><select value={draft.emptyPolicy} onChange={(event) => setDraft({ ...draft, emptyPolicy: event.target.value as EmptyPolicy })}><option value="BLOCK">BLOCK · 缺失阻断</option><option value="DEFAULT">DEFAULT · 使用默认值</option></select></label></div>{draft.emptyPolicy === 'DEFAULT' ? <label className="profile-field">默认值 <i>*</i><input required value={draft.defaultValue} onChange={(event) => setDraft({ ...draft, defaultValue: event.target.value })} placeholder="字段为空时写入百应的值" /></label> : <div className="notice warn"><b>缺失即阻断：</b>客户该字段为空时会进入导入失败明细，不会静默提交到百应。</div>}<div className="mapping-flow-preview"><span>平台字段</span><code>{draft.standardField}</code><ArrowRight size={14} /><span>百应 properties</span><code>{activeVariable}</code></div></div><footer><p>保存后先进入草稿；统一发布后才供新任务使用。</p><div><button type="button" className="filter-button" onClick={() => setActiveVariable(null)}>取消</button><button className="primary-button">保存为草稿</button></div></footer></form></dialog> : null}
  </div>;
}

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
