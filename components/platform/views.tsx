'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, Download, Filter, Pause, Play, RefreshCcw, Search, Upload } from 'lucide-react';
import { Metric, PageIntro, Panel, Status } from './shared';

const taskRows = [
  { id: 'PT-20260902-00024', title: '婚博会意向客户回访', store: '紫藤影像 · 上海总店', source: 'ERP', batch: '6,104 / 10,000', progress: '61%', status: '运行中', tone: 'green' as const },
  { id: 'PT-20260902-00023', title: '秋季档期二次触达', store: '远山摄影 · 杭州店', source: 'CRM', batch: '1,238 / 3,600', progress: '34%', status: '运行中', tone: 'green' as const },
  { id: 'PT-20260902-00022', title: '到店未成交激活', store: '罗曼映像 · 南京店', source: 'ERP', batch: '0 / 7,200', progress: '0%', status: '等待容量', tone: 'amber' as const },
  { id: 'PT-20260902-00021', title: '老客周年礼遇', store: '晨光摄影 · 苏州园区店', source: 'CRM', batch: '0 / 2,800', progress: '0%', status: '余额不足暂停', tone: 'red' as const },
  { id: 'PT-20260902-00020', title: '七夕咨询回访', store: '纪念日影像 · 无锡店', source: 'ERP', batch: '0 / 1,200', progress: '0%', status: '准备就绪', tone: 'blue' as const },
];

function TaskTable() {
  const [keyword, setKeyword] = useState('');
  const rows = useMemo(() => taskRows.filter((task) => `${task.id}${task.title}${task.store}`.includes(keyword)), [keyword]);
  return <Panel title="任务列表" meta={`共 ${rows.length} 笔`}><div className="toolbar"><label className="search-box"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务、影楼或任务编号" /></label><button className="filter-button"><Filter size={13} className="mr-1 inline" />全部状态</button><button className="filter-button">创建时间：近 7 天</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>任务 / platform_task_id</th><th>影楼 / 来源</th><th>名单批次</th><th>平台状态</th><th>操作</th></tr></thead><tbody>{rows.map((task) => <tr key={task.id}><td><b>{task.title}</b><span className="table-meta">{task.id} · callJobId 103829</span></td><td>{task.store}<span className="table-meta">{task.source}</span></td><td>{task.batch}<div className="progress-track"><i style={{ width: task.progress }} /></div></td><td><Status tone={task.tone}>{task.status}</Status></td><td><button className="table-action">查看详情 <ChevronRight size={13} className="inline" /></button></td></tr>)}</tbody></table></div></Panel>;
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
    setModal(nextModal);
  };
  const closeModal = () => { setModal(null); setActiveStudio(null); };
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
      {(modal === 'create' || modal === 'edit') ? <form onSubmit={saveStudio} className="grid gap-4 p-5"><div className="grid grid-cols-2 gap-4"><label className="field-label">影楼名称 <b className="text-[#b64c46]">*</b><input required className="rate-input mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="field-label">联系人 <b className="text-[#b64c46]">*</b><input required className="rate-input mt-1" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></label><label className="field-label">联系人手机号 <b className="text-[#b64c46]">*</b><input required className="rate-input mt-1" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label className="field-label">MC code <b className="text-[#b64c46]">*</b><input required className="rate-input mt-1" value={form.mcCode} onChange={(event) => setForm({ ...form, mcCode: event.target.value })} /></label></div><label className="field-label">ERP 回传地址<input className="rate-input mt-1" value={form.erpUrl} onChange={(event) => setForm({ ...form, erpUrl: event.target.value })} /></label><label className="field-label">CRM 回传地址<input className="rate-input mt-1" value={form.crmUrl} onChange={(event) => setForm({ ...form, crmUrl: event.target.value })} /></label><div className="flex justify-end gap-2 pt-2"><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button">保存</button></div></form> : <form onSubmit={saveAction} className="p-5"><p className="text-[13px] leading-6 text-[#68746e]">{modal === 'disable' ? <>停用后，<b>{activeStudio?.name}</b> 即使余额大于 0 也不能拨打电话。</> : modal === 'enable' ? <>确认启用 <b>{activeStudio?.name}</b>？</> : modal === 'recharge' ? <>为 <b>{activeStudio?.name}</b> 充值，到账金额将加入账户余额。</> : <>为 <b>{activeStudio?.name}</b> 退款，退款金额将从账户余额中扣减。</>}</p>{modal === 'disable' ? <label className="field-label mt-4">停用原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" /></label> : null}{modal === 'recharge' || modal === 'refund' ? <div className="mt-4 grid gap-4"><label className="field-label">{modal === 'recharge' ? '充值金额' : '退款金额'} <b className="text-[#b64c46]">*</b><input required min="0.01" step="0.01" name="amount" type="number" className="rate-input mt-1" /></label>{modal === 'refund' ? <label className="field-label">退款原因 <b className="text-[#b64c46]">*</b><textarea required name="reason" className="rate-input mt-1 h-20 py-2" /></label> : null}<label className="field-label">{modal === 'recharge' ? '付款凭证' : '退款凭证'} <b className="text-[#b64c46]">*</b><input required name="receipt" type="file" className="mt-1 block w-full text-[12px] text-[#68746e]" /></label></div> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" className="filter-button" onClick={closeModal}>取消</button><button className="primary-button">{modal === 'enable' ? '确认启用' : modal === 'disable' ? '确认停用' : '保存'}</button></div></form>}</div></div> : null}
  </>;
}

export function TaskView() {
  const [gate, setGate] = useState<'checking' | 'ready' | 'running'>('checking');
  const [message, setMessage] = useState('');
  const recheck = () => { setGate('ready'); setMessage('容量已复检：可分配 8 路并发，任务已满足启动条件。'); };
  const start = () => { setGate('running'); setMessage('启动请求已写入 Outbox，正在等待百应回写 callJobId。'); };
  return <><PageIntro eyebrow="CALL TASK ORCHESTRATION" title="呼叫任务" summary="按创建、导入、启动前闸门、执行和结果回传的顺序管理任务；供应商结果不确定时，只查询不重复创建。" /><div className="split-grid !mt-0"><Panel title="当前待处理任务" meta="PT-20260902-00022"><div className="task-hero"><div><p className="eyebrow">WAITING_FOR_CAPACITY</p><h3>到店未成交激活</h3><p>罗曼映像 · 南京店 / ERP / callJobId 尚未生成</p></div><Status tone={gate === 'running' ? 'blue' : gate === 'ready' ? 'green' : 'amber'}>{gate === 'running' ? '已发起启动' : gate === 'ready' ? '可以启动' : '等待容量'}</Status></div><div className="gate-steps"><span>1 接收请求</span><ArrowRight size={12} /><span>2 导入名单</span><ArrowRight size={12} /><b>3 启动前复检</b></div><div className="gate-list">{[['影楼与来源映射','罗曼映像 · 南京店 / ERP','通过'],['话术变量与黑名单','到店未成交激活 v1.8 · 0 个命中','通过'],['客户可用余额','¥ 18,400，可覆盖冻结 ¥ 5,760','通过'],['外呼时段','09:00–20:30，当前可呼叫','通过'],['百应实时容量', gate === 'checking' ? '52 / 76 坐席使用中，暂无法占用并发' : '43 / 76 坐席使用中，可占用 8 路并发', gate === 'checking' ? '等待' : '通过']].map(([name, detail, result]) => <div className="gate-line" key={name}><i className={result === '通过' ? 'gate-pass' : 'gate-wait'} /><div><b>{name}</b><p>{detail}</p></div><strong className={result === '通过' ? 'text-[#287156]' : 'text-[#a86814]'}>{result}</strong></div>)}</div>{message ? <div className="notice">{message}</div> : null}<div className="mt-4 flex flex-wrap gap-2">{gate === 'checking' ? <button className="primary-button" onClick={recheck}><RefreshCcw size={14} className="mr-1 inline" />重新校验容量</button> : <button className="primary-button" disabled={gate === 'running'} onClick={start}><Play size={14} className="mr-1 inline" />确认并启动任务</button>}<button className="filter-button"><Pause size={13} className="mr-1 inline" />暂停 / 终止</button><button className="filter-button">查询百应状态</button></div></Panel><Panel title="任务上下文"><dl className="key-value"><div><dt>业务场景</dt><dd>NO_DEAL_REACTIVATE</dd></div><div><dt>计划时间</dt><dd>立即外呼</dd></div><div><dt>名单规模</dt><dd>7,200 人</dd></div><div><dt>启动冻结</dt><dd>¥ 5,760.00</dd></div><div><dt>合规快照</dt><dd>已确认 · v2.1</dd></div><div><dt>请求方</dt><dd>ERP-OP-0211</dd></div></dl><div className="notice warn mt-5"><b>启动资金规则：</b>待拨号码 × 客户单价 × 2 个计费分钟。冻结不足时任务暂停，不自动恢复。</div></Panel></div><div className="mt-[14px]"><TaskTable /></div></>;
}

export function MappingView() {
  const [enabled, setEnabled] = useState(true);
  return <><PageIntro eyebrow="FIELD CONTRACT" title="字段映射" summary="配置 ERP/CRM 业务字段与百应任务变量的契约。任务创建时写入快照，后续调整不会影响已导入名单。" action={<button className="primary-button">+ 新增映射版本</button>} /><div className="split-grid !mt-0"><Panel title="紫藤影像 · 婚博会回访" meta="v3.4 · 已发布"><div className="mapping-row"><div><b>客户姓名</b><span className="table-meta">ERP.customer_name</span></div><ArrowRight className="mapping-arrow" /><div><span className="mapping-code">contactName</span><p className="mt-1 text-[10px] text-[#79847e]">百应联系人变量</p></div><Status tone="green">必填</Status></div><div className="mapping-row"><div><b>咨询品类</b><span className="table-meta">CRM.interest_package</span></div><ArrowRight className="mapping-arrow" /><div><span className="mapping-code">interestPackage</span><p className="mt-1 text-[10px] text-[#79847e]">话术分支变量</p></div><Status tone="green">必填</Status></div><div className="mapping-row"><div><b>婚期</b><span className="table-meta">ERP.wedding_date</span></div><ArrowRight className="mapping-arrow" /><div><span className="mapping-code">weddingDate</span><p className="mt-1 text-[10px] text-[#79847e]">可空日期字段</p></div><Status tone="gray">可选</Status></div><div className="mapping-row"><div><b>顾问姓名</b><span className="table-meta">CRM.owner_name</span></div><ArrowRight className="mapping-arrow" /><div><span className="mapping-code">consultantName</span><p className="mt-1 text-[10px] text-[#79847e]">转人工上下文</p></div><Status tone="gray">可选</Status></div></Panel><Panel title="发布控制"><div className="note-list"><p><b>覆盖范围</b><br />紫藤影像 · 上海总店 · ERP</p><p><b>生效时间</b><br />立即生效，仅作用于新建任务</p><p><b>最后发布</b><br />王琪 · 2026-09-01 17:24</p></div><label className="checkbox-row"><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />允许任务创建时校验必填字段</label><div className="notice mt-5">缺失必填字段的名单不会导入；系统返回明细给 ERP/CRM，由业务侧修正后重新提交。</div></Panel></div><div className="triple-grid"><Panel title="映射校验"><div className="note-list"><p><b className="text-[#287156]">100%</b><br />4 个映射字段均已检测通过</p></div></Panel><Panel title="版本历史"><div className="note-list"><p><b>v3.4 · 当前</b><br />新增顾问姓名变量</p><p><b>v3.3 · 2026-08-12</b><br />更新咨询品类枚举</p></div></Panel><Panel title="业务边界"><div className="notice warn">平台不维护话术白名单；字段映射只定义数据契约与校验，不改变业务来源的数据。</div></Panel></div></>;
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
