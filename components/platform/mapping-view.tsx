'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, GitCompareArrows, History, RefreshCcw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageIntro, Panel, Status } from './shared';

type TransformType = 'TEXT' | 'DATE' | 'MONEY' | 'ENUM' | 'TEMPLATE';
type EmptyPolicy = 'BLOCK' | 'DEFAULT';
type RuleStatus = 'PUBLISHED' | 'REMOVED';
type SceneStatus = 'ACTIVE' | 'PENDING_MAPPING' | 'DRIFT_DETECTED' | 'STALE_SYNC' | 'DISABLED';
type IssueChange = 'NEW' | 'DRIFT' | 'REMOVED';

type MappingRule = {
  id: string;
  variable: string;
  erpField: string;
  crmField: string;
  transform: TransformType;
  transformConfig: string;
  emptyPolicy: EmptyPolicy;
  defaultValue: string;
  status: RuleStatus;
  version: number;
  sampleInput: string;
  sampleOutput: string;
};

type MappingDraft = Omit<MappingRule, 'id' | 'version' | 'status' | 'sampleOutput'> & { remove?: boolean };
type MappingIssue = { id: string; variable: string; sceneNames: string[]; change: IssueChange; discoveredAt: string; note: string };
type Scene = { id: string; name: string; robotDefId: string; companies: string; status: SceneStatus; coverage: number; expected: number; lastSync: string; missingVariables: string[]; issue: string };
type VersionRecord = { version: number; publishedAt: string; publisher: string; ruleCount: number; change: string };

const initialRules: MappingRule[] = [
  { id: 'm1', variable: '婚期', erpField: 'wedding_date', crmField: 'marriage_date', transform: 'DATE', transformConfig: 'YYYY-MM-DD', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sampleInput: '2026/10/18', sampleOutput: '2026-10-18' },
  { id: 'm2', variable: '套餐意向', erpField: 'package_interest', crmField: 'interest_package', transform: 'ENUM', transformConfig: 'A=轻奢婚纱照\nB=高定婚纱照', emptyPolicy: 'DEFAULT', defaultValue: '待确认', status: 'PUBLISHED', version: 12, sampleInput: 'A', sampleOutput: '轻奢婚纱照' },
  { id: 'm3', variable: '门店名称', erpField: 'store_name', crmField: 'branch_name', transform: 'TEXT', transformConfig: '去除首尾空格', emptyPolicy: 'BLOCK', defaultValue: '', status: 'PUBLISHED', version: 12, sampleInput: '上海总店', sampleOutput: '上海总店' },
  { id: 'm4', variable: '顾问姓名', erpField: 'consultant_name', crmField: 'owner_name', transform: 'TEMPLATE', transformConfig: '{{value}}老师', emptyPolicy: 'DEFAULT', defaultValue: '门店顾问', status: 'PUBLISHED', version: 12, sampleInput: '陈顾问', sampleOutput: '陈顾问老师' },
  { id: 'm5', variable: '老客权益', erpField: '', crmField: 'member_benefit', transform: 'TEXT', transformConfig: '去除首尾空格', emptyPolicy: 'DEFAULT', defaultValue: '周年礼遇', status: 'PUBLISHED', version: 11, sampleInput: '周年加片', sampleOutput: '周年加片' },
  { id: 'm6', variable: '客户来源', erpField: 'customer_source', crmField: 'lead_source', transform: 'TEXT', transformConfig: '去除首尾空格', emptyPolicy: 'DEFAULT', defaultValue: '未知来源', status: 'PUBLISHED', version: 12, sampleInput: '婚博会', sampleOutput: '婚博会' },
  { id: 'm7', variable: '活动名称', erpField: 'campaign_name', crmField: 'campaignName', transform: 'TEXT', transformConfig: '去除首尾空格', emptyPolicy: 'DEFAULT', defaultValue: '日常邀约', status: 'PUBLISHED', version: 12, sampleInput: '秋季档期', sampleOutput: '秋季档期' },
];

const initialIssues: MappingIssue[] = [
  { id: 'p1', variable: '预算范围', sceneNames: ['婚博会回访', '秋季档期触达'], change: 'NEW', discoveredAt: '09-03 09:30', note: '百应新增变量，尚无已发布映射。' },
  { id: 'p2', variable: '礼服风格', sceneNames: ['到店未成交激活'], change: 'NEW', discoveredAt: '09-03 09:30', note: '百应新增变量，尚无已发布映射。' },
  { id: 'p3', variable: '客户等级', sceneNames: ['周年礼遇'], change: 'DRIFT', discoveredAt: '09-03 03:30', note: '晨光摄影返回该变量，另外两家公司未返回。' },
  { id: 'p4', variable: '老客权益', sceneNames: ['七夕咨询回访'], change: 'REMOVED', discoveredAt: '09-02 21:30', note: '最新成功快照中已不存在，需确认停用旧映射。' },
];

const initialScenes: Scene[] = [
  { id: 's1', name: '婚博会回访', robotDefId: 'SC-202608-017', companies: '3 家公司', status: 'PENDING_MAPPING', coverage: 6, expected: 7, lastSync: '09-03 09:30', missingVariables: ['预算范围'], issue: '新增变量“预算范围”待发布映射' },
  { id: 's2', name: '秋季档期触达', robotDefId: 'SC-202608-012', companies: '2 家公司', status: 'PENDING_MAPPING', coverage: 5, expected: 6, lastSync: '09-03 09:30', missingVariables: ['预算范围'], issue: '新增变量“预算范围”待发布映射' },
  { id: 's3', name: '到店未成交激活', robotDefId: 'SC-202608-009', companies: '4 家公司', status: 'PENDING_MAPPING', coverage: 5, expected: 6, lastSync: '09-03 09:30', missingVariables: ['礼服风格'], issue: '新增变量“礼服风格”待发布映射' },
  { id: 's4', name: '周年礼遇', robotDefId: 'SC-202608-005', companies: '3 家公司', status: 'DRIFT_DETECTED', coverage: 5, expected: 6, lastSync: '09-03 03:30', missingVariables: ['客户等级'], issue: '不同公司返回的话术变量集合不一致' },
  { id: 's5', name: '七夕咨询回访', robotDefId: 'SC-202607-031', companies: '1 家公司', status: 'STALE_SYNC', coverage: 5, expected: 5, lastSync: '09-02 08:20', missingVariables: [], issue: '超过 24 小时未成功同步' },
  { id: 's6', name: '客资首次触达', robotDefId: 'SC-202609-021', companies: '5 家公司', status: 'ACTIVE', coverage: 6, expected: 6, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's7', name: '订单确认通知', robotDefId: 'SC-202609-019', companies: '2 家公司', status: 'ACTIVE', coverage: 4, expected: 4, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's8', name: '试妆预约提醒', robotDefId: 'SC-202608-020', companies: '4 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's9', name: '档期二次确认', robotDefId: 'SC-202608-018', companies: '3 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's10', name: '到店前关怀', robotDefId: 'SC-202608-016', companies: '2 家公司', status: 'ACTIVE', coverage: 4, expected: 4, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's11', name: '选片通知', robotDefId: 'SC-202608-014', companies: '4 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's12', name: '取件通知', robotDefId: 'SC-202608-011', companies: '4 家公司', status: 'ACTIVE', coverage: 4, expected: 4, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's13', name: '生日关怀', robotDefId: 'SC-202608-008', companies: '3 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's14', name: '孕妈照咨询', robotDefId: 'SC-202608-006', companies: '2 家公司', status: 'ACTIVE', coverage: 6, expected: 6, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's15', name: '亲子照复购', robotDefId: 'SC-202607-029', companies: '2 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's16', name: '周年纪念提醒', robotDefId: 'SC-202607-025', companies: '3 家公司', status: 'ACTIVE', coverage: 4, expected: 4, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's17', name: '活动邀约', robotDefId: 'SC-202607-023', companies: '2 家公司', status: 'ACTIVE', coverage: 5, expected: 5, lastSync: '09-03 09:30', missingVariables: [], issue: '' },
  { id: 's18', name: '历史优惠唤醒', robotDefId: 'SC-202606-018', companies: '1 家公司', status: 'DISABLED', coverage: 3, expected: 3, lastSync: '09-03 03:30', missingVariables: [], issue: '管理员手动停用' },
];

const initialVersions: VersionRecord[] = [
  { version: 12, publishedAt: '2026-09-01 17:24', publisher: '王琪', ruleCount: 7, change: '新增顾问姓名模板转换，调整套餐意向默认值' },
  { version: 11, publishedAt: '2026-08-22 14:08', publisher: '李萌', ruleCount: 5, change: '新增老客权益映射' },
  { version: 10, publishedAt: '2026-08-12 10:32', publisher: '王琪', ruleCount: 4, change: '更新套餐意向枚举规则' },
];

const sceneStatusMeta: Record<SceneStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray'; short: string }> = {
  ACTIVE: { label: 'ACTIVE', tone: 'green', short: '正常' },
  PENDING_MAPPING: { label: 'PENDING_MAPPING', tone: 'amber', short: '待映射' },
  DRIFT_DETECTED: { label: 'DRIFT_DETECTED', tone: 'red', short: '漂移' },
  STALE_SYNC: { label: 'STALE_SYNC', tone: 'blue', short: '同步过期' },
  DISABLED: { label: 'DISABLED', tone: 'gray', short: '已停用' },
};

const issueMeta: Record<IssueChange, { label: string; symbol: string; tone: 'amber' | 'red' | 'gray' }> = {
  NEW: { label: '新增变量', symbol: '+', tone: 'amber' },
  DRIFT: { label: '变量漂移', symbol: '↯', tone: 'red' },
  REMOVED: { label: '变量删除', symbol: '−', tone: 'gray' },
};

const defaultDraft = (variable = ''): MappingDraft => ({ variable, erpField: '', crmField: '', transform: 'TEXT', transformConfig: '去除首尾空格', emptyPolicy: 'BLOCK', defaultValue: '', sampleInput: '' });

function applyPreview(draft: MappingDraft) {
  const source = draft.sampleInput.trim();
  if (!source) return draft.emptyPolicy === 'DEFAULT' ? draft.defaultValue : '空值将阻断导入';
  if (draft.transform === 'DATE') return source.replaceAll('/', '-').replaceAll('.', '-');
  if (draft.transform === 'MONEY') {
    const amount = Number(source.replace(/[^\d.-]/g, ''));
    if (Number.isNaN(amount)) return '格式错误';
    return draft.transformConfig.includes('分转元') ? (amount / 100).toFixed(draft.transformConfig.includes('2位') ? 2 : 0) : amount.toFixed(draft.transformConfig.includes('2位') ? 2 : 0);
  }
  if (draft.transform === 'ENUM') {
    const match = draft.transformConfig.split('\n').map((line) => line.split('=')).find(([key]) => key?.trim() === source);
    return match?.[1]?.trim() || draft.defaultValue || '未命中枚举';
  }
  if (draft.transform === 'TEMPLATE') return (draft.transformConfig || '{{value}}').replaceAll('{{value}}', source);
  return source;
}

export function MappingView() {
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState<MappingDraft[]>([]);
  const [issues, setIssues] = useState(initialIssues);
  const [scenes, setScenes] = useState(initialScenes);
  const [versions, setVersions] = useState(initialVersions);
  const [activeTab, setActiveTab] = useState('issues');
  const [query, setQuery] = useState('');
  const [ruleStatus, setRuleStatus] = useState<'ALL' | 'PUBLISHED' | 'DRAFT' | 'REMOVED'>('ALL');
  const [sceneQuery, setSceneQuery] = useState('');
  const [sceneStatus, setSceneStatus] = useState<'ALL' | SceneStatus>('ALL');
  const [editVariable, setEditVariable] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<MappingDraft>(defaultDraft());
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('2026-09-03 09:30');
  const [feedback, setFeedback] = useState('');

  const currentVersion = versions[0].version;
  const counts = useMemo(() => Object.keys(sceneStatusMeta).reduce((result, status) => ({ ...result, [status]: scenes.filter((scene) => scene.status === status).length }), {} as Record<SceneStatus, number>), [scenes]);
  const ruleRows = useMemo(() => {
    const merged = rules.map((rule) => {
      const draft = drafts.find((item) => item.variable === rule.variable);
      return draft ? { ...rule, ...draft, sampleOutput: applyPreview(draft), displayStatus: draft.remove ? 'REMOVED' : 'DRAFT' } : { ...rule, displayStatus: rule.status };
    });
    drafts.filter((draft) => !rules.some((rule) => rule.variable === draft.variable)).forEach((draft, index) => merged.push({ id: `draft-${index}`, ...draft, status: 'PUBLISHED', version: currentVersion + 1, sampleOutput: applyPreview(draft), displayStatus: 'DRAFT' } as MappingRule & { displayStatus: string }));
    return merged.filter((rule) => `${rule.variable}${rule.erpField}${rule.crmField}${rule.transform}`.toLowerCase().includes(query.toLowerCase()) && (ruleStatus === 'ALL' || rule.displayStatus === ruleStatus));
  }, [rules, drafts, query, ruleStatus, currentVersion]);
  const filteredScenes = scenes.filter((scene) => `${scene.name}${scene.robotDefId}${scene.companies}`.toLowerCase().includes(sceneQuery.toLowerCase()) && (sceneStatus === 'ALL' || scene.status === sceneStatus));
  const sceneVariableRows = useMemo(() => {
    if (!selectedScene) return [];
    const publishedPool = rules.filter((rule) => rule.status === 'PUBLISHED').map((rule) => rule.variable);
    const mappedCount = Math.max(0, selectedScene.expected - selectedScene.missingVariables.length);
    const variables = [...publishedPool.slice(0, mappedCount), ...selectedScene.missingVariables].slice(0, selectedScene.expected);
    return variables.map((variable) => {
      const rule = rules.find((item) => item.variable === variable);
      const draft = drafts.find((item) => item.variable === variable);
      const issue = issues.find((item) => item.variable === variable && item.sceneNames.includes(selectedScene.name));
      const effective = draft ?? rule;
      const apiStatus = issue?.change === 'REMOVED' ? '最新快照已删除' : issue?.change === 'DRIFT' ? '公司间不一致' : issue?.change === 'NEW' ? '本次新增' : selectedScene.status === 'STALE_SYNC' ? '沿用上次快照' : '当前已返回';
      const mappingStatus = draft?.remove ? '待发布移除' : draft ? '草稿待发布' : issue?.change === 'REMOVED' ? '待确认移除' : issue?.change === 'DRIFT' ? '漂移待处理' : !rule ? '待配置' : `v${rule.version} 已发布`;
      const tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' = issue?.change === 'REMOVED' ? 'gray' : issue?.change === 'DRIFT' ? 'red' : !rule || issue?.change === 'NEW' ? 'amber' : draft ? 'blue' : 'green';
      return { variable, erpField: effective?.erpField ?? '', crmField: effective?.crmField ?? '', apiStatus, mappingStatus, tone };
    });
  }, [selectedScene, rules, drafts, issues]);

  const openMapping = (variable: string) => {
    const savedDraft = drafts.find((item) => item.variable === variable);
    const existing = rules.find((rule) => rule.variable === variable);
    setDraftForm(savedDraft ?? (existing ? { variable, erpField: existing.erpField, crmField: existing.crmField, transform: existing.transform, transformConfig: existing.transformConfig, emptyPolicy: existing.emptyPolicy, defaultValue: existing.defaultValue, sampleInput: existing.sampleInput } : { ...defaultDraft(variable), sampleInput: variable === '预算范围' ? '8000-12000' : variable === '礼服风格' ? '法式轻盈' : 'VIP' }));
    setEditVariable(variable);
  };
  const saveDraft = (event: { preventDefault(): void }) => {
    event.preventDefault();
    setDrafts((current) => current.some((item) => item.variable === draftForm.variable) ? current.map((item) => item.variable === draftForm.variable ? draftForm : item) : [...current, draftForm]);
    setEditVariable(null);
    setFeedback(`“${draftForm.variable}”已保存为草稿；相关场景仍保持阻断，发布成功后才会重新计算状态。`);
  };
  const stageRemoval = (variable: string) => {
    const existing = rules.find((rule) => rule.variable === variable);
    if (!existing) return;
    const removal: MappingDraft = { variable, erpField: existing.erpField, crmField: existing.crmField, transform: existing.transform, transformConfig: existing.transformConfig, emptyPolicy: existing.emptyPolicy, defaultValue: existing.defaultValue, sampleInput: existing.sampleInput, remove: true };
    setDrafts((current) => current.some((item) => item.variable === variable) ? current.map((item) => item.variable === variable ? removal : item) : [...current, removal]);
    setFeedback(`“${variable}”已标记为待移除；发布前旧版本仍保持生效。`);
  };
  const publishDrafts = () => {
    const nextVersion = currentVersion + 1;
    const publishedVariables = drafts.filter((draft) => !draft.remove).map((draft) => draft.variable);
    const removedVariables = drafts.filter((draft) => draft.remove).map((draft) => draft.variable);
    setRules((current) => {
      const next = current.map((rule) => {
        const draft = drafts.find((item) => item.variable === rule.variable);
        if (!draft) return rule;
        if (draft.remove) return { ...rule, status: 'REMOVED' as RuleStatus, version: nextVersion };
        return { ...rule, ...draft, status: 'PUBLISHED' as RuleStatus, version: nextVersion, sampleOutput: applyPreview(draft) };
      });
      drafts.filter((draft) => !draft.remove && !current.some((rule) => rule.variable === draft.variable)).forEach((draft) => next.push({ id: `m${Date.now()}-${draft.variable}`, ...draft, status: 'PUBLISHED', version: nextVersion, sampleOutput: applyPreview(draft) }));
      return next;
    });
    setIssues((current) => current.filter((issue) => issue.change === 'DRIFT' || (!publishedVariables.includes(issue.variable) && !removedVariables.includes(issue.variable))));
    setScenes((current) => current.map((scene) => scene.status === 'PENDING_MAPPING' && scene.missingVariables.every((variable) => publishedVariables.includes(variable)) ? { ...scene, status: 'ACTIVE', coverage: scene.expected, missingVariables: [], issue: '' } : scene));
    setVersions((current) => [{ version: nextVersion, publishedAt: '2026-09-03 10:18', publisher: '平台管理员', ruleCount: rules.filter((rule) => rule.status === 'PUBLISHED').length + drafts.filter((draft) => !draft.remove && !rules.some((rule) => rule.variable === draft.variable)).length - removedVariables.length, change: `发布 ${drafts.length} 项变更：${[...publishedVariables, ...removedVariables].join('、')}` }, ...current]);
    setDrafts([]);
    setPublishOpen(false);
    setFeedback(`映射版本 v${nextVersion} 已发布。新任务将锁定此版本，已创建任务继续使用原快照。`);
  };
  const syncVariables = () => {
    setSyncing(true);
    setFeedback('');
    window.setTimeout(() => {
      const driftReady = rules.some((rule) => rule.variable === '客户等级' && rule.status === 'PUBLISHED');
      setScenes((current) => current.map((scene) => scene.status === 'STALE_SYNC' || (scene.status === 'DRIFT_DETECTED' && driftReady) ? { ...scene, status: 'ACTIVE', coverage: scene.expected, missingVariables: [], issue: '', lastSync: '09-03 10:20' } : scene));
      if (driftReady) setIssues((current) => current.filter((issue) => issue.change !== 'DRIFT'));
      setLastSync('2026-09-03 10:20');
      setSyncing(false);
      setFeedback(driftReady ? '同步完成：同步过期与变量漂移场景已复核恢复，其余快照无变化。' : '同步完成：过期场景已恢复；周年礼遇仍存在跨公司变量漂移。');
    }, 850);
  };

  return <div className="mapping-center mapping-center-complete">
    <PageIntro eyebrow="BAIYING VARIABLE MAPPING" title="字段映射中心" summary="只处理百应 4.10 接口返回的话术变量：为每个变量分别指定 ERP 字段和 CRM 字段，发布后供任务与名单导入使用。" action={<button className="primary-button sync-button" onClick={syncVariables} disabled={syncing}><RefreshCcw size={14} className={syncing ? 'spin' : ''} />{syncing ? '正在同步…' : '同步百应变量'}</button>} />
    {feedback ? <output className="notice mapping-feedback"><Check size={14} />{feedback}</output> : null}

    <section className="inspection-board" aria-label="变量巡检">
      <div className="inspection-lead"><div><p className="eyebrow">VARIABLE INSPECTION</p><h3>变量巡检</h3><p>每 6 小时自动巡检；失败时保留上次成功快照，超过 24 小时则阻断使用。</p></div><div className="sync-stamp"><span>最后成功同步</span><b>{lastSync}</b><small>下一次自动同步 15:30</small></div></div>
      <div className="inspection-metrics inspection-metrics-six"><article><span>场景总数</span><b>{scenes.length}</b><small>覆盖 6 家公司</small></article>{(['ACTIVE', 'PENDING_MAPPING', 'DRIFT_DETECTED', 'STALE_SYNC', 'DISABLED'] as SceneStatus[]).map((status) => <article className={status === 'ACTIVE' ? 'metric-ok' : status === 'PENDING_MAPPING' ? 'metric-warn' : status === 'DRIFT_DETECTED' ? 'metric-danger' : 'metric-muted'} key={status}><span>{sceneStatusMeta[status].short}</span><b>{counts[status]}</b><small>{status === 'ACTIVE' ? '允许新任务 / 导入' : status === 'DISABLED' ? '管理员停用' : '阻断新任务 / 导入'}</small></article>)}</div>
    </section>

    <section className="mapping-guide mapping-guide-direct" aria-label="字段映射操作说明">
      <div className="guide-copy"><span>映射范围</span><h3>只映射 4.10 接口拉回的话术变量</h3><p>客户名称、手机号等普通业务字段不在这里维护；百应返回一个变量，平台才新增一条映射。</p></div>
      <div className="mapping-chain-demo">
        <div className="baiying-node"><span>4.10 返回变量</span><b>婚期</b><small>变量名不可手工新增</small></div><ChevronRight size={17} />
        <div className="source-system-pair"><p><span className="source-badge source-erp">ERP</span><code>wedding_date</code></p><p><span className="source-badge source-crm">CRM</span><code>marriage_date</code></p></div><ChevronRight size={17} />
        <div className="standard-node"><span>导入百应</span><b>properties.婚期</b><small>按数据来源读取对应字段</small></div>
      </div>
      <button className="guide-action" onClick={() => setActiveTab('rules')}>查看变量映射 <ChevronRight size={13} /></button>
    </section>

    <Tabs value={activeTab} onValueChange={setActiveTab} className="mapping-tabs-shell">
      <TabsList variant="line" className="mapping-tabs-list" aria-label="字段映射功能区">
        <TabsTrigger value="issues" className="mapping-tab-trigger">待处理变量 <small>{issues.length}</small></TabsTrigger>
        <TabsTrigger value="scenes" className="mapping-tab-trigger">场景状态 <small>{scenes.length}</small></TabsTrigger>
        <TabsTrigger value="rules" className="mapping-tab-trigger">变量映射 <small>{rules.filter((rule) => rule.status === 'PUBLISHED').length}</small></TabsTrigger>
        <TabsTrigger value="versions" className="mapping-tab-trigger">版本记录 <small>{versions.length}</small></TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className="mapping-tab-panel"><Panel title="待处理变量" meta={`${issues.length} 项需处理`} className="pending-panel">
        {issues.length ? <div className="pending-list">{issues.map((issue) => {
          const meta = issueMeta[issue.change];
          const draft = drafts.find((item) => item.variable === issue.variable);
          const driftMapped = rules.some((rule) => rule.variable === issue.variable && rule.status === 'PUBLISHED');
          return <article className="pending-item pending-item-complete" key={issue.id}><div className={`change-mark ${issue.change === 'DRIFT' ? 'change-drift' : issue.change === 'REMOVED' ? 'change-removed' : ''}`}>{meta.symbol}</div><div className="pending-variable"><span className="mapping-code">{issue.variable}</span><b>{meta.label}</b><small>{issue.note}</small></div><div><span className="pending-label">影响话术场景</span><p>{issue.sceneNames.join('、')}</p></div><div><span className="pending-label">处理状态</span><p className={draft || driftMapped ? 'draft-ready' : ''}>{draft ? (draft.remove ? '待发布移除' : '草稿待发布') : driftMapped ? '待同步复核' : '尚未处理'}</p></div><Status tone={draft || driftMapped ? 'blue' : meta.tone}>{draft || driftMapped ? '处理中' : issue.change === 'DRIFT' ? 'DRIFT_DETECTED' : issue.change === 'REMOVED' ? 'REMOVED' : 'PENDING_MAPPING'}</Status><div className="pending-actions">{issue.change === 'REMOVED' ? <button className="table-action" onClick={() => stageRemoval(issue.variable)}><Trash2 size={12} />确认移除</button> : issue.change === 'DRIFT' ? <button className="table-action" onClick={() => setSelectedScene(scenes.find((scene) => scene.name === issue.sceneNames[0]) ?? null)}><GitCompareArrows size={12} />查看差异</button> : <button className="table-action" onClick={() => openMapping(issue.variable)}>配置映射 <ChevronRight size={13} /></button>}</div></article>;
        })}</div> : <div className="pending-empty"><Check size={18} /><div><b>当前没有待处理变量</b><p>全部场景变量均已核对；系统会在下次巡检后继续更新。</p></div></div>}
        {drafts.length ? <div className="draft-publish-bar"><div><ShieldCheck size={17} /><span><b>{drafts.length} 项变更已保存为草稿</b><small>草稿不会解除场景阻断；发布后生成不可变版本 v{currentVersion + 1}</small></span></div><button className="primary-button" onClick={() => setPublishOpen(true)}>审核并发布</button></div> : null}
      </Panel></TabsContent>

      <TabsContent value="scenes" className="mapping-tab-panel"><Panel title="话术场景就绪状态" meta="只有 ACTIVE 可创建新任务"><div className="rules-toolbar"><label className="search-box"><Search size={15} /><input value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} placeholder="搜索话术名称、话术 ID 或公司" /></label><select className="filter-button" aria-label="场景状态" value={sceneStatus} onChange={(event) => setSceneStatus(event.target.value as 'ALL' | SceneStatus)}><option value="ALL">全部状态</option>{Object.entries(sceneStatusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.short}</option>)}</select></div><div className="table-wrap"><table className="data-table scene-readiness-table"><thead><tr><th>话术场景</th><th>公司覆盖</th><th>变量覆盖</th><th>最后成功同步</th><th>就绪状态</th><th>问题摘要</th><th>操作</th></tr></thead><tbody>{filteredScenes.map((scene) => <tr key={scene.id}><td><b>{scene.name}</b><span className="table-meta">{scene.robotDefId}</span></td><td>{scene.companies}</td><td><b>{scene.coverage} / {scene.expected}</b><div className="coverage-track"><i style={{ width: `${scene.coverage / scene.expected * 100}%` }} /></div></td><td>{scene.lastSync}</td><td><Status tone={sceneStatusMeta[scene.status].tone}>{sceneStatusMeta[scene.status].label}</Status></td><td className="scene-issue-cell">{scene.issue || '—'}</td><td><button className="table-action" onClick={() => setSelectedScene(scene)}>查看详情</button></td></tr>)}</tbody></table></div></Panel></TabsContent>

      <TabsContent value="rules" className="mapping-tab-panel"><Panel title="百应话术变量映射" meta={`当前发布版本 v${currentVersion}`} className="rules-panel"><div className="rules-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索百应变量、ERP 字段或 CRM 字段" /></label><select className="filter-button" aria-label="规则状态" value={ruleStatus} onChange={(event) => setRuleStatus(event.target.value as typeof ruleStatus)}><option value="ALL">全部状态</option><option value="PUBLISHED">已发布</option><option value="DRAFT">有草稿</option><option value="REMOVED">已移除</option></select><button className="primary-button" onClick={() => setPublishOpen(true)} disabled={!drafts.length}>发布草稿{drafts.length ? `（${drafts.length}）` : ''}</button></div><div className="rule-scope"><span>变量来自百应 4.10 接口</span><p>这里只展示接口同步到的话术变量。每个变量直接配置 ERP 和 CRM 的取值字段，不维护额外的全量业务字段库。</p></div><div className="table-wrap"><table className="data-table mapping-table direct-mapping-table"><thead><tr><th>百应话术变量</th><th><span className="source-header source-erp">ERP 取值字段</span></th><th><span className="source-header source-crm">CRM 取值字段</span></th><th>写入百应</th><th>转换规则</th><th>空值策略</th><th>版本状态</th><th>样例预览</th><th>操作</th></tr></thead><tbody>{ruleRows.map((rule) => <tr key={rule.id}><td><b>{rule.variable}</b><small className="table-meta">4.10 接口同步</small></td><td><MappedSourceField source="ERP" value={rule.erpField} /></td><td><MappedSourceField source="CRM" value={rule.crmField} /></td><td><span className="payload-path">properties.{rule.variable}</span></td><td><b>{rule.transform}</b><small className="table-meta config-summary">{rule.transformConfig}</small></td><td>{rule.emptyPolicy === 'BLOCK' ? <Status tone="red">缺失阻断</Status> : <div><Status tone="blue">使用默认值</Status><small className="table-meta">{rule.defaultValue}</small></div>}</td><td><Status tone={rule.displayStatus === 'PUBLISHED' ? 'green' : rule.displayStatus === 'REMOVED' ? 'gray' : 'amber'}>{rule.displayStatus === 'PUBLISHED' ? `v${rule.version} 已发布` : rule.displayStatus === 'REMOVED' ? '待移除 / 已移除' : '草稿待发布'}</Status></td><td><span className="sample-preview"><small>{rule.sampleInput || '空值'}</small>{rule.sampleOutput}</span></td><td>{rule.displayStatus === 'REMOVED' ? '—' : <button className="table-action" onClick={() => openMapping(rule.variable)}>编辑映射</button>}</td></tr>)}</tbody></table></div>{!ruleRows.length ? <div className="rule-empty">没有符合条件的变量映射</div> : null}</Panel></TabsContent>

      <TabsContent value="versions" className="mapping-tab-panel"><Panel title="发布版本记录" meta="版本发布后不可修改"><div className="version-list">{versions.map((version, index) => <article key={version.version}><div className="version-marker"><History size={15} /></div><div><span className="mapping-code">v{version.version}{index === 0 ? ' · 当前' : ''}</span><h4>{version.change}</h4><p>{version.publisher} · {version.publishedAt}</p></div><dl><div><dt>规则数量</dt><dd>{version.ruleCount}</dd></div><div><dt>适用范围</dt><dd>全局</dd></div></dl><button className="table-action" onClick={() => setFeedback(`已选择 v${version.version}：历史版本只读，可用于核对已创建任务快照。`)}>查看快照</button></article>)}</div></Panel></TabsContent>
    </Tabs>

    <Dialog open={Boolean(editVariable)} onOpenChange={(open) => { if (!open) setEditVariable(null); }}>
      <DialogContent className="mapping-dialog mapping-dialog-refined max-w-[760px] gap-0 p-0" showCloseButton={false}>
        <form onSubmit={saveDraft}>
          <DialogHeader className="mapping-dialog-header mapping-dialog-header-refined">
            <div>
              <p className="mapping-api-label"><span>4.10 API</span> 同步变量映射</p>
              <DialogTitle>配置 ERP / CRM 取值关系</DialogTitle>
              <DialogDescription>分别指定两套业务系统为该百应话术变量提供值的字段。</DialogDescription>
            </div>
            <button type="button" className="dialog-close-button" aria-label="关闭" onClick={() => setEditVariable(null)}>×</button>
          </DialogHeader>

          <div className="mapping-dialog-body mapping-dialog-body-refined">
            <div className="mapping-target-variable">
              <span>目标百应话术变量</span>
              <b>{editVariable}</b>
              <small>来自 4.10 查询话术变量接口，不支持手工修改</small>
            </div>

            <section className="mapping-editor-section">
              <div className="mapping-section-heading"><span>01</span><div><b>配置数据来源</b><small>至少配置 ERP 或 CRM 中的一个字段</small></div></div>
              <div className="source-edit-grid variable-source-grid">
                <label className="source-input source-input-erp"><span><i>ERP</i> 取值字段</span><input value={draftForm.erpField} onChange={(event) => setDraftForm({ ...draftForm, erpField: event.target.value })} placeholder="例如：package_interest" /><small>ERP 名单导入时只读取这里</small></label>
                <label className="source-input source-input-crm"><span><i>CRM</i> 取值字段</span><input value={draftForm.crmField} onChange={(event) => setDraftForm({ ...draftForm, crmField: event.target.value })} placeholder="例如：interest_package" /><small>CRM 名单导入时只读取这里</small></label>
              </div>
            </section>

            <section className="mapping-editor-section mapping-processing-section">
              <div className="mapping-section-heading"><span>02</span><div><b>设置值处理方式</b><small>两个来源共用同一套转换与空值策略</small></div></div>
              <div className="mapping-form-grid"><label className="profile-field">转换规则 <i>*</i><select value={draftForm.transform} onChange={(event) => { const transform = event.target.value as TransformType; setDraftForm({ ...draftForm, transform, transformConfig: transform === 'DATE' ? 'YYYY-MM-DD' : transform === 'MONEY' ? '元 · 保留2位' : transform === 'ENUM' ? 'A=轻奢\nB=高定' : transform === 'TEMPLATE' ? '{{value}}' : '去除首尾空格' }); }}><option>TEXT</option><option>DATE</option><option>MONEY</option><option>ENUM</option><option>TEMPLATE</option></select></label><label className="profile-field">空值策略 <i>*</i><select value={draftForm.emptyPolicy} onChange={(event) => setDraftForm({ ...draftForm, emptyPolicy: event.target.value as EmptyPolicy })}><option value="BLOCK">BLOCK · 缺失阻断</option><option value="DEFAULT">DEFAULT · 使用默认值</option></select></label></div>
              <div className="mapping-processing-detail"><TransformConfigEditor draft={draftForm} onChange={setDraftForm} />{draftForm.emptyPolicy === 'DEFAULT' ? <label className="profile-field">默认值 <i>*</i><input required value={draftForm.defaultValue} onChange={(event) => setDraftForm({ ...draftForm, defaultValue: event.target.value })} placeholder="字段为空或转换未命中时使用" /></label> : <div className="notice warn"><b>缺失即阻断：</b>对应来源字段为空时进入导入失败明细，不会静默提交到百应。</div>}</div>
            </section>

            <section className="mapping-editor-section mapping-test-section">
              <div className="mapping-section-heading"><span>03</span><div><b>测试映射结果</b><small>发布前用一条示例值验证输出</small></div></div>
              <div className="preview-lab preview-lab-refined"><label className="profile-field">测试原始值<input value={draftForm.sampleInput} onChange={(event) => setDraftForm({ ...draftForm, sampleInput: event.target.value })} placeholder="输入一条原始值" /></label><div><span>转换后写入</span><b>{applyPreview(draftForm)}</b><small>properties.{editVariable}</small></div></div>
            </section>
          </div>

          <DialogFooter className="mapping-dialog-footer mapping-dialog-footer-refined"><p><b>保存为草稿</b>后仍需统一发布，才会应用到新任务。</p><div><button type="button" className="filter-button" onClick={() => setEditVariable(null)}>取消</button><button className="primary-button" disabled={!draftForm.erpField && !draftForm.crmField}>保存为草稿</button></div></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent className="publish-dialog max-w-[540px]" showCloseButton={false}><DialogHeader><DialogTitle>发布全局映射版本 v{currentVersion + 1}</DialogTitle><DialogDescription>发布后，新创建任务和新名单导入将锁定此版本；已创建任务不受影响。</DialogDescription></DialogHeader><div className="publish-summary"><div><span>待发布变更</span><b>{drafts.length}</b></div><div><span>新增 / 修改</span><b>{drafts.filter((draft) => !draft.remove).length}</b></div><div><span>移除规则</span><b>{drafts.filter((draft) => draft.remove).length}</b></div></div><div className="publish-change-list">{drafts.map((draft) => <p key={draft.variable}><span>{draft.remove ? '移除' : rules.some((rule) => rule.variable === draft.variable) ? '修改' : '新增'}</span><b>{draft.variable}</b><small>{draft.remove ? '旧版本继续保留快照' : `ERP ${draft.erpField || '—'} / CRM ${draft.crmField || '—'} · ${draft.transform}`}</small></p>)}</div><div className="notice warn"><b>发布前确认：</b>版本发布后不可原地修改，如需调整必须创建新版本。</div><DialogFooter className="publish-footer"><button className="filter-button" onClick={() => setPublishOpen(false)}>取消</button><button className="primary-button" onClick={publishDrafts} disabled={!drafts.length}>确认发布</button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(selectedScene)} onOpenChange={(open) => { if (!open) setSelectedScene(null); }}>
      <DialogContent className="scene-dialog scene-variable-dialog max-w-[820px]" showCloseButton={false}>
        <DialogHeader className="scene-variable-dialog-header">
          <div><p className="eyebrow">SCENE VARIABLE SNAPSHOT</p><DialogTitle>{selectedScene?.name}</DialogTitle><DialogDescription>{selectedScene?.robotDefId} · {selectedScene?.companies} · 4.10 接口最近同步 {selectedScene?.lastSync}</DialogDescription></div>
          <button type="button" className="dialog-close-button" aria-label="关闭" onClick={() => setSelectedScene(null)}>×</button>
        </DialogHeader>
        {selectedScene ? <>
          <div className="scene-detail-status scene-detail-status-wide"><Status tone={sceneStatusMeta[selectedScene.status].tone}>{sceneStatusMeta[selectedScene.status].label}</Status><p>{selectedScene.issue || '当前变量均已配置发布映射，可以创建新任务和导入名单。'}</p></div>
          <div className="scene-variable-summary scene-variable-summary-compact"><div><span>4.10 返回变量</span><b>{selectedScene.expected}</b></div><div><span>已发布映射</span><b>{selectedScene.coverage}</b></div><div><span>待处理变量</span><b>{selectedScene.expected - selectedScene.coverage}</b></div><div><span>新任务 / 导入</span><b>{selectedScene.status === 'ACTIVE' ? '允许' : '阻断'}</b></div></div>

          <section className="scene-variable-section">
            <div className="scene-variable-section-heading"><div><b>当前话术变量</b><small>以本次 4.10 接口快照为准</small></div><span>{sceneVariableRows.length} 个变量</span></div>
            <div className="table-wrap"><table className="data-table scene-variable-table"><thead><tr><th>百应变量</th><th>接口当前情况</th><th>ERP 字段</th><th>CRM 字段</th><th>映射状态</th><th>操作</th></tr></thead><tbody>{sceneVariableRows.map((row) => <tr key={row.variable}><td><b>{row.variable}</b><small className="table-meta">properties.{row.variable}</small></td><td><span className="api-variable-state">{row.apiStatus}</span></td><td><code className={`scene-source-value scene-source-erp ${row.erpField ? '' : 'is-empty'}`}>{row.erpField || '未配置'}</code></td><td><code className={`scene-source-value scene-source-crm ${row.crmField ? '' : 'is-empty'}`}>{row.crmField || '未配置'}</code></td><td><Status tone={row.tone}>{row.mappingStatus}</Status></td><td><button className="table-action" onClick={() => { setSelectedScene(null); if (row.mappingStatus === '待确认移除') stageRemoval(row.variable); else openMapping(row.variable); }}>{row.mappingStatus === '待确认移除' ? '确认移除' : row.mappingStatus.includes('已发布') ? '编辑' : '配置'}</button></td></tr>)}</tbody></table></div>
          </section>

          {selectedScene.status === 'DRIFT_DETECTED' ? <div className="drift-compare"><h4>跨公司变量差异</h4><p><span>晨光摄影</span><code>婚期、套餐意向、门店名称、顾问姓名、客户等级</code></p><p><span>紫藤影像</span><code>婚期、套餐意向、门店名称、顾问姓名</code></p><p><span>远山摄影</span><code>婚期、套餐意向、门店名称、顾问姓名</code></p></div> : null}
          <DialogFooter className="scene-dialog-footer scene-variable-dialog-footer"><p>变量状态变化后，需要重新发布映射并同步复核。</p><button className="filter-button" onClick={() => setSelectedScene(null)}>关闭</button></DialogFooter>
        </> : null}
      </DialogContent>
    </Dialog>
  </div>;
}

function TransformConfigEditor({ draft, onChange }: { draft: MappingDraft; onChange: (draft: MappingDraft) => void }) {
  if (draft.transform === 'DATE') return <label className="profile-field">日期输出格式 <i>*</i><select value={draft.transformConfig} onChange={(event) => onChange({ ...draft, transformConfig: event.target.value })}><option>YYYY-MM-DD</option><option>YYYY年MM月DD日</option><option>MM/DD/YYYY</option></select></label>;
  if (draft.transform === 'MONEY') return <label className="profile-field">金额处理 <i>*</i><select value={draft.transformConfig} onChange={(event) => onChange({ ...draft, transformConfig: event.target.value })}><option>元 · 保留2位</option><option>元 · 保留0位</option><option>分转元 · 保留2位</option></select></label>;
  if (draft.transform === 'ENUM') return <label className="profile-field">枚举映射 <i>*</i><textarea required value={draft.transformConfig} onChange={(event) => onChange({ ...draft, transformConfig: event.target.value })} placeholder={'每行一项，例如：\nA=轻奢婚纱照\nB=高定婚纱照'} /></label>;
  if (draft.transform === 'TEMPLATE') return <label className="profile-field">文本模板 <i>*</i><input required value={draft.transformConfig} onChange={(event) => onChange({ ...draft, transformConfig: event.target.value })} placeholder="例如：{{value}}老师" /><small className="field-help">使用 {'{{value}}'} 代表原始字段值</small></label>;
  return <label className="profile-field">文本处理 <i>*</i><select value={draft.transformConfig} onChange={(event) => onChange({ ...draft, transformConfig: event.target.value })}><option>去除首尾空格</option><option>保持原值</option><option>转为大写</option><option>转为小写</option></select></label>;
}

function MappedSourceField({ source, value }: { source: 'ERP' | 'CRM'; value: string }) {
  return <div className={`source-field-cell ${source === 'ERP' ? 'source-field-erp' : 'source-field-crm'}`}><span>{source}</span>{value ? <code>{value}</code> : <em>未配置</em>}</div>;
}
