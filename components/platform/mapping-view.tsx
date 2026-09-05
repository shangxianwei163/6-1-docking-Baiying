'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  GitCompareArrows,
  History,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  MappingDraftInput,
  MappingRule as ApiMappingRule,
  MappingVersion,
  SceneReadiness,
  TransformConfig,
} from '@outbound/contracts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedSelect } from '@/components/ui/unified-select';
import {
  loadMappingCenter,
  PlatformApiError,
  publishMappings,
  removeMappingDraft,
  requestVariableSync,
  saveMappingDraft,
  type MappingDraftRecord,
} from '@/lib/platform-api';
import { Panel, Status } from './shared';

type TransformType = 'TEXT' | 'DATE' | 'MONEY' | 'ENUM' | 'TEMPLATE';
type EmptyPolicy = 'BLOCK' | 'DEFAULT';
type RuleStatus = 'PUBLISHED' | 'REMOVED';
type MappingDisplayStatus = 'PUBLISHED' | 'DRAFT' | 'REMOVED' | 'UNMAPPED';
type SceneStatus =
  | 'ACTIVE'
  | 'PENDING_MAPPING'
  | 'DRIFT_DETECTED'
  | 'STALE_SYNC'
  | 'DISABLED';
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

type MappingDraft = Omit<
  MappingRule,
  'id' | 'version' | 'status' | 'sampleOutput'
> & { remove?: boolean };
type MappingIssue = {
  id: string;
  variable: string;
  sceneNames: string[];
  change: IssueChange;
  discoveredAt: string;
  note: string;
};
type Scene = {
  id: string;
  name: string;
  robotDefId: string;
  companies: string;
  status: SceneStatus;
  coverage: number;
  expected: number;
  lastSync: string;
  lastSyncAt: string | null;
  missingVariables: string[];
  variables: string[];
  issue: string;
};
type VersionRecord = {
  version: number;
  publishedAt: string;
  publisher: string;
  ruleCount: number;
  change: string;
};

const sampleInputs: Record<string, string> = {
  婚期: '2026/10/18',
  套餐意向: 'A',
  门店名称: '上海总店',
  顾问姓名: '陈顾问',
  老客权益: '周年加片',
  客户来源: '婚博会',
  活动名称: '秋季档期',
  预算范围: '8000-12000',
  礼服风格: '法式轻盈',
  客户等级: 'VIP',
};

const sceneStatusMeta: Record<
  SceneStatus,
  {
    label: string;
    tone: 'green' | 'amber' | 'red' | 'blue' | 'gray';
    short: string;
  }
> = {
  ACTIVE: { label: 'ACTIVE', tone: 'green', short: '正常' },
  PENDING_MAPPING: { label: 'PENDING_MAPPING', tone: 'amber', short: '待映射' },
  DRIFT_DETECTED: { label: 'DRIFT_DETECTED', tone: 'red', short: '漂移' },
  STALE_SYNC: { label: 'STALE_SYNC', tone: 'blue', short: '同步过期' },
  DISABLED: { label: 'DISABLED', tone: 'gray', short: '已停用' },
};

const issueMeta: Record<
  IssueChange,
  { label: string; symbol: string; tone: 'amber' | 'red' | 'gray' }
> = {
  NEW: { label: '新增变量', symbol: '+', tone: 'amber' },
  DRIFT: { label: '变量漂移', symbol: '↯', tone: 'red' },
  REMOVED: { label: '变量删除', symbol: '−', tone: 'gray' },
};

const defaultDraft = (variable = ''): MappingDraft => ({
  variable,
  erpField: '',
  crmField: '',
  transform: 'TEXT',
  transformConfig: '去除首尾空格',
  emptyPolicy: 'BLOCK',
  defaultValue: '',
  sampleInput: '',
});

function formatDateTime(value: string | null, short = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: short ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>(
      (result, part) => ({ ...result, [part.type]: part.value }),
      {},
    );
  return short
    ? `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
    : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function transformConfigToText(config: TransformConfig) {
  if (config.type === 'TEXT')
    return (
      {
        TRIM: '去除首尾空格',
        PRESERVE: '保持原值',
        UPPERCASE: '转为大写',
        LOWERCASE: '转为小写',
      } as const
    )[config.mode];
  if (config.type === 'DATE') return config.outputFormat;
  if (config.type === 'MONEY')
    return `${config.inputUnit === 'CENT' ? '分转元' : '元'} · 保留${config.decimalPlaces}位`;
  if (config.type === 'ENUM')
    return Object.entries(config.values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  return config.template;
}

function draftToApiInput(draft: MappingDraft): MappingDraftInput {
  let transformConfig: TransformConfig;
  if (draft.transform === 'TEXT') {
    const modes = {
      去除首尾空格: 'TRIM',
      保持原值: 'PRESERVE',
      转为大写: 'UPPERCASE',
      转为小写: 'LOWERCASE',
    } as const;
    transformConfig = {
      type: 'TEXT',
      mode: modes[draft.transformConfig as keyof typeof modes] ?? 'TRIM',
    };
  } else if (draft.transform === 'DATE') {
    transformConfig = {
      type: 'DATE',
      outputFormat: draft.transformConfig as
        | 'YYYY-MM-DD'
        | 'YYYY年MM月DD日'
        | 'MM/DD/YYYY',
    };
  } else if (draft.transform === 'MONEY') {
    transformConfig = {
      type: 'MONEY',
      inputUnit: draft.transformConfig.includes('分转元') ? 'CENT' : 'YUAN',
      decimalPlaces: draft.transformConfig.includes('2位') ? 2 : 0,
    };
  } else if (draft.transform === 'ENUM') {
    const values = Object.fromEntries(
      draft.transformConfig
        .split('\n')
        .map((line) => line.split('='))
        .filter(([key, value]) => key?.trim() && value?.trim())
        .map(([key, value]) => [key.trim(), value.trim()]),
    );
    transformConfig = { type: 'ENUM', values };
  } else {
    transformConfig = {
      type: 'TEMPLATE',
      template: draft.transformConfig || '{{value}}',
    };
  }
  return {
    baiyingVariableName: draft.variable,
    erpField: draft.erpField || null,
    crmField: draft.crmField || null,
    transformConfig,
    emptyPolicy: draft.emptyPolicy,
    defaultValue:
      draft.emptyPolicy === 'DEFAULT' ? draft.defaultValue || null : null,
  };
}

function apiRuleToView(rule: ApiMappingRule): MappingRule {
  const draft: MappingDraft = {
    variable: rule.baiyingVariableName,
    erpField: rule.erpField ?? '',
    crmField: rule.crmField ?? '',
    transform: rule.transformConfig.type,
    transformConfig: transformConfigToText(rule.transformConfig),
    emptyPolicy: rule.emptyPolicy,
    defaultValue: rule.defaultValue ?? '',
    sampleInput: sampleInputs[rule.baiyingVariableName] ?? '',
  };
  return {
    id: rule.id,
    ...draft,
    status: rule.status,
    version: rule.version,
    sampleOutput: applyPreview(draft),
  };
}

function apiDraftToView(
  draft: MappingDraftRecord,
  rules: MappingRule[],
): MappingDraft {
  const existing = rules.find(
    (rule) => rule.variable === draft.baiyingVariableName,
  );
  if (draft.changeType === 'REMOVE')
    return existing
      ? { ...existing, remove: true }
      : { ...defaultDraft(draft.baiyingVariableName), remove: true };
  const config = draft.transformConfig ?? {
    type: 'TEXT' as const,
    mode: 'TRIM' as const,
  };
  return {
    variable: draft.baiyingVariableName,
    erpField: draft.erpField ?? '',
    crmField: draft.crmField ?? '',
    transform: config.type,
    transformConfig: transformConfigToText(config),
    emptyPolicy: draft.emptyPolicy ?? 'BLOCK',
    defaultValue: draft.defaultValue ?? '',
    sampleInput: sampleInputs[draft.baiyingVariableName] ?? '',
  };
}

function apiSceneToView(scene: SceneReadiness): Scene {
  return {
    id: scene.sceneDefId,
    name: scene.sceneName,
    robotDefId: scene.robotDefId,
    companies: `${scene.companyCount} 家公司`,
    status: scene.status,
    coverage: scene.mappedVariables,
    expected: scene.expectedVariables,
    lastSync: formatDateTime(scene.lastSuccessfulSyncAt, true),
    lastSyncAt: scene.lastSuccessfulSyncAt,
    missingVariables: scene.missingVariables,
    variables: scene.variables,
    issue: scene.issueSummary ?? '',
  };
}

function apiVersionToView(version: MappingVersion): VersionRecord {
  return {
    version: version.version,
    publishedAt: formatDateTime(version.publishedAt),
    publisher: version.publisherId,
    ruleCount: version.ruleCount,
    change: version.changeSummary,
  };
}

function deriveIssues(scenes: Scene[]): MappingIssue[] {
  const issueByVariable = new Map<string, MappingIssue>();
  for (const scene of scenes) {
    for (const variable of scene.missingVariables) {
      const existing = issueByVariable.get(variable);
      if (existing) {
        existing.sceneNames.push(scene.name);
        if (scene.status === 'DRIFT_DETECTED') existing.change = 'DRIFT';
        continue;
      }
      const drift = scene.status === 'DRIFT_DETECTED';
      issueByVariable.set(variable, {
        id: `${scene.id}-${variable}`,
        variable,
        sceneNames: [scene.name],
        change: drift ? 'DRIFT' : 'NEW',
        discoveredAt: scene.lastSync,
        note: drift
          ? '不同公司返回的变量集合不一致，需要复核。'
          : '百应话术变量接口已返回该变量，尚无已发布映射。',
      });
    }
  }
  return [...issueByVariable.values()];
}

function applyPreview(draft: MappingDraft) {
  const source = draft.sampleInput.trim();
  if (!source)
    return draft.emptyPolicy === 'DEFAULT'
      ? draft.defaultValue
      : '空值将阻断导入';
  if (draft.transform === 'DATE')
    return source.replaceAll('/', '-').replaceAll('.', '-');
  if (draft.transform === 'MONEY') {
    const amount = Number(source.replace(/[^\d.-]/g, ''));
    if (Number.isNaN(amount)) return '格式错误';
    return draft.transformConfig.includes('分转元')
      ? (amount / 100).toFixed(draft.transformConfig.includes('2位') ? 2 : 0)
      : amount.toFixed(draft.transformConfig.includes('2位') ? 2 : 0);
  }
  if (draft.transform === 'ENUM') {
    const match = draft.transformConfig
      .split('\n')
      .map((line) => line.split('='))
      .find(([key]) => key?.trim() === source);
    return match?.[1]?.trim() || draft.defaultValue || '未命中枚举';
  }
  if (draft.transform === 'TEMPLATE')
    return (draft.transformConfig || '{{value}}').replaceAll(
      '{{value}}',
      source,
    );
  return source;
}

export function MappingView() {
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [drafts, setDrafts] = useState<MappingDraft[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [activeTab, setActiveTab] = useState('issues');
  const [query, setQuery] = useState('');
  const [ruleStatus, setRuleStatus] = useState<'ALL' | MappingDisplayStatus>(
    'ALL',
  );
  const [mappingSceneId, setMappingSceneId] = useState('ALL');
  const [sceneQuery, setSceneQuery] = useState('');
  const [sceneStatus, setSceneStatus] = useState<'ALL' | SceneStatus>('ALL');
  const [editVariable, setEditVariable] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<MappingDraft>(defaultDraft());
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const data = await loadMappingCenter();
      const loadedRules = data.rules.map(apiRuleToView);
      setRules(loadedRules);
      setDrafts(data.drafts.map((draft) => apiDraftToView(draft, loadedRules)));
      setScenes(data.scenes.map(apiSceneToView));
      setVersions(data.versions.map(apiVersionToView));
    } catch (error) {
      const message =
        error instanceof PlatformApiError
          ? error.message
          : '字段映射数据加载失败';
      setFeedback(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshData());
  }, [refreshData]);

  const issues = useMemo(() => deriveIssues(scenes), [scenes]);
  const currentVersion = versions[0]?.version ?? 0;
  const latestSyncAt =
    scenes
      .map((scene) => scene.lastSyncAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const lastSync = formatDateTime(latestSyncAt, true);
  const nextSync = latestSyncAt
    ? formatDateTime(
        new Date(
          new Date(latestSyncAt).getTime() + 6 * 60 * 60 * 1000,
        ).toISOString(),
        true,
      )
    : '—';
  const companyCoverage = Math.max(
    0,
    ...scenes.map((scene) => Number.parseInt(scene.companies, 10) || 0),
  );
  const counts = useMemo(
    () =>
      Object.keys(sceneStatusMeta).reduce(
        (result, status) => ({
          ...result,
          [status]: scenes.filter((scene) => scene.status === status).length,
        }),
        {} as Record<SceneStatus, number>,
      ),
    [scenes],
  );
  const syncedVariables = useMemo(
    () =>
      [...new Set(scenes.flatMap((scene) => scene.variables))].sort(
        (left, right) => left.localeCompare(right, 'zh-CN'),
      ),
    [scenes],
  );
  const sortedScenes = useMemo(
    () =>
      [...scenes].sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN'),
      ),
    [scenes],
  );
  const mappingScene =
    mappingSceneId === 'ALL'
      ? null
      : (scenes.find((scene) => scene.id === mappingSceneId) ?? null);
  const mappingVariables = useMemo(
    () =>
      mappingScene
        ? [...new Set(mappingScene.variables)].sort((left, right) =>
            left.localeCompare(right, 'zh-CN'),
          )
        : syncedVariables,
    [mappingScene, syncedVariables],
  );
  const variableScenes = useMemo(() => {
    const result = new Map<string, Scene[]>();
    for (const scene of scenes) {
      for (const variable of new Set(scene.variables))
        result.set(variable, [...(result.get(variable) ?? []), scene]);
    }
    return result;
  }, [scenes]);
  const mappedVariableCount = mappingVariables.filter((variable) =>
    rules.some(
      (rule) => rule.variable === variable && rule.status === 'PUBLISHED',
    ),
  ).length;
  const ruleRows = useMemo(() => {
    const merged = mappingVariables.map((variable, index) => {
      const rule = rules.find((item) => item.variable === variable);
      const draft = drafts.find((item) => item.variable === variable);
      if (rule)
        return draft
          ? {
              ...rule,
              ...draft,
              sampleOutput: applyPreview(draft),
              displayStatus: draft.remove
                ? ('REMOVED' as const)
                : ('DRAFT' as const),
            }
          : { ...rule, displayStatus: rule.status };
      if (draft)
        return {
          id: `draft-${index}`,
          ...draft,
          status: 'PUBLISHED' as const,
          version: currentVersion + 1,
          sampleOutput: applyPreview(draft),
          displayStatus: 'DRAFT' as const,
        };
      const unmapped = {
        ...defaultDraft(variable),
        sampleInput: sampleInputs[variable] ?? '',
      };
      return {
        id: `unmapped-${index}`,
        ...unmapped,
        status: 'PUBLISHED' as const,
        version: 0,
        sampleOutput: '',
        displayStatus: 'UNMAPPED' as const,
      };
    });
    return merged.filter(
      (rule) =>
        `${rule.variable}${rule.erpField}${rule.crmField}${rule.transform}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (ruleStatus === 'ALL' || rule.displayStatus === ruleStatus),
    );
  }, [mappingVariables, rules, drafts, query, ruleStatus, currentVersion]);
  const filteredScenes = scenes.filter(
    (scene) =>
      `${scene.name}${scene.robotDefId}${scene.companies}`
        .toLowerCase()
        .includes(sceneQuery.toLowerCase()) &&
      (sceneStatus === 'ALL' || scene.status === sceneStatus),
  );
  const sceneVariableRows = useMemo(() => {
    if (!selectedScene) return [];
    return selectedScene.variables.map((variable) => {
      const rule = rules.find((item) => item.variable === variable);
      const draft = drafts.find((item) => item.variable === variable);
      const issue = issues.find(
        (item) =>
          item.variable === variable &&
          item.sceneNames.includes(selectedScene.name),
      );
      const effective = draft ?? rule;
      const apiStatus =
        issue?.change === 'REMOVED'
          ? '最新快照已删除'
          : issue?.change === 'DRIFT'
            ? '公司间不一致'
            : issue?.change === 'NEW'
              ? '本次新增'
              : selectedScene.status === 'STALE_SYNC'
                ? '沿用上次快照'
                : '当前已返回';
      const mappingStatus = draft?.remove
        ? '待发布移除'
        : draft
          ? '草稿待发布'
          : issue?.change === 'REMOVED'
            ? '待确认移除'
            : issue?.change === 'DRIFT'
              ? '漂移待处理'
              : !rule
                ? '待配置'
                : `v${rule.version} 已发布`;
      const tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' =
        issue?.change === 'REMOVED'
          ? 'gray'
          : issue?.change === 'DRIFT'
            ? 'red'
            : !rule || issue?.change === 'NEW'
              ? 'amber'
              : draft
                ? 'blue'
                : 'green';
      return {
        variable,
        erpField: effective?.erpField ?? '',
        crmField: effective?.crmField ?? '',
        apiStatus,
        mappingStatus,
        tone,
      };
    });
  }, [selectedScene, rules, drafts, issues]);

  const openMapping = (variable: string) => {
    const savedDraft = drafts.find((item) => item.variable === variable);
    const existing = rules.find((rule) => rule.variable === variable);
    setDraftForm(
      savedDraft ??
        (existing
          ? {
              variable,
              erpField: existing.erpField,
              crmField: existing.crmField,
              transform: existing.transform,
              transformConfig: existing.transformConfig,
              emptyPolicy: existing.emptyPolicy,
              defaultValue: existing.defaultValue,
              sampleInput: existing.sampleInput,
            }
          : {
              ...defaultDraft(variable),
              sampleInput: sampleInputs[variable] ?? '',
            }),
    );
    setEditVariable(variable);
  };
  const saveDraft = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveMappingDraft(draftToApiInput(draftForm));
      await refreshData();
      setEditVariable(null);
      setFeedback(
        `“${draftForm.variable}”已写入数据库草稿；相关场景仍保持阻断，发布成功后才会重新计算状态。`,
      );
    } catch (error) {
      setFeedback(
        error instanceof PlatformApiError ? error.message : '映射草稿保存失败',
      );
    } finally {
      setSaving(false);
    }
  };
  const stageRemoval = async (variable: string) => {
    setSaving(true);
    try {
      await removeMappingDraft({
        baiyingVariableName: variable,
        removalReason: '百应最新变量快照已移除该变量',
      });
      await refreshData();
      setFeedback(`“${variable}”已写入待移除草稿；发布前旧版本仍保持生效。`);
    } catch (error) {
      setFeedback(
        error instanceof PlatformApiError ? error.message : '标记移除失败',
      );
    } finally {
      setSaving(false);
    }
  };
  const publishDrafts = async () => {
    if (!drafts.length) return;
    setSaving(true);
    try {
      const variables = drafts.map((draft) => draft.variable).join('、');
      const result = await publishMappings({
        publisherId: 'platform-admin',
        changeSummary: `发布 ${drafts.length} 项映射变更：${variables}`,
      });
      await refreshData();
      setPublishOpen(false);
      setFeedback(
        `映射版本 v${result.version.version} 已发布并写入 PostgreSQL。新任务将锁定该版本，已创建任务不受影响。`,
      );
    } catch (error) {
      setFeedback(
        error instanceof PlatformApiError ? error.message : '映射发布失败',
      );
    } finally {
      setSaving(false);
    }
  };
  const syncVariables = async () => {
    setSyncing(true);
    setFeedback('');
    try {
      const job = await requestVariableSync();
      setFeedback(
        `同步任务已进入队列（${job.jobId.slice(0, 8)}），页面状态将在后台完成百应话术变量同步后更新。`,
      );
    } catch (error) {
      setFeedback(
        error instanceof PlatformApiError ? error.message : '同步任务创建失败',
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mapping-center mapping-center-complete">
      <header className="mapping-compact-intro">
        <div>
          <p className="eyebrow">话术变量映射</p>
          <h2>字段映射中心</h2>
          <p>
            同步百应当前可用话术的自定义变量，并配置变量从 ERP 或 CRM
            读取值的字段；同名变量全局共用一套映射。
          </p>
        </div>
        <button
          className="primary-button sync-button"
          onClick={syncVariables}
          disabled={syncing || loading}
        >
          <RefreshCcw size={14} className={syncing ? 'spin' : ''} />
          {syncing ? '正在提交…' : '同步百应变量'}
        </button>
      </header>
      {feedback ? (
        <output className="notice mapping-feedback">
          <Check size={14} />
          {feedback}
        </output>
      ) : null}
      {loading ? (
        <div className="notice mapping-feedback">
          <RefreshCcw size={14} className="spin" />
          正在从平台 API 读取字段映射数据…
        </div>
      ) : null}

      <section className="inspection-board" aria-label="变量巡检">
        <div className="inspection-lead">
          <div>
            <p className="eyebrow">VARIABLE INSPECTION</p>
            <h3>变量巡检</h3>
            <p>
              每 6 小时自动巡检；失败时保留上次成功快照，超过 24
              小时则阻断使用。
            </p>
          </div>
          <div className="sync-stamp">
            <span>最后成功同步</span>
            <b>{lastSync}</b>
            <small>下一次自动同步 {nextSync}</small>
          </div>
        </div>
        <div className="inspection-metrics inspection-metrics-six">
          <article>
            <span>场景总数</span>
            <b>{scenes.length}</b>
            <small>单场景最多覆盖 {companyCoverage} 家公司</small>
          </article>
          {(
            [
              'ACTIVE',
              'PENDING_MAPPING',
              'DRIFT_DETECTED',
              'STALE_SYNC',
              'DISABLED',
            ] as SceneStatus[]
          ).map((status) => (
            <article
              className={
                status === 'ACTIVE'
                  ? 'metric-ok'
                  : status === 'PENDING_MAPPING'
                    ? 'metric-warn'
                    : status === 'DRIFT_DETECTED'
                      ? 'metric-danger'
                      : 'metric-muted'
              }
              key={status}
            >
              <span>{sceneStatusMeta[status].short}</span>
              <b>{counts[status]}</b>
              <small>
                {status === 'ACTIVE'
                  ? '允许新任务 / 导入'
                  : status === 'DISABLED'
                    ? '管理员停用'
                    : '阻断新任务 / 导入'}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section
        className="mapping-guide mapping-guide-direct"
        aria-label="字段映射操作说明"
      >
        <div className="guide-copy">
          <span>映射范围</span>
          <h3>只映射百应返回的自定义变量</h3>
          <p>
            客户名称和联系方式是百应内置字段，分别直接写入
            name、phone；其他自定义变量才配置 ERP / CRM 映射。
          </p>
        </div>
        <div className="mapping-chain-demo">
          <div className="baiying-node">
            <span>百应变量接口返回</span>
            <b>婚期</b>
            <small>变量名不可手工新增</small>
          </div>
          <ChevronRight size={17} />
          <div className="source-system-pair">
            <p>
              <span className="source-badge source-erp">ERP</span>
              <code>wedding_date</code>
            </p>
            <p>
              <span className="source-badge source-crm">CRM</span>
              <code>marriage_date</code>
            </p>
          </div>
          <ChevronRight size={17} />
          <div className="standard-node">
            <span>导入百应</span>
            <b>properties.婚期</b>
            <small>按数据来源读取对应字段</small>
          </div>
        </div>
        <button className="guide-action" onClick={() => setActiveTab('rules')}>
          查看变量映射 <ChevronRight size={13} />
        </button>
      </section>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mapping-tabs-shell"
      >
        <TabsList
          variant="line"
          className="mapping-tabs-list"
          aria-label="字段映射功能区"
        >
          <TabsTrigger value="issues" className="mapping-tab-trigger">
            待处理变量 <small>{issues.length}</small>
          </TabsTrigger>
          <TabsTrigger value="scenes" className="mapping-tab-trigger">
            场景状态 <small>{scenes.length}</small>
          </TabsTrigger>
          <TabsTrigger value="rules" className="mapping-tab-trigger">
            变量映射 <small>{syncedVariables.length}</small>
          </TabsTrigger>
          <TabsTrigger value="versions" className="mapping-tab-trigger">
            版本记录 <small>{versions.length}</small>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="mapping-tab-panel">
          <Panel
            title="待处理变量"
            meta={`${issues.length} 项需处理`}
            className="pending-panel"
          >
            {issues.length ? (
              <div className="pending-list">
                {issues.map((issue) => {
                  const meta = issueMeta[issue.change];
                  const draft = drafts.find(
                    (item) => item.variable === issue.variable,
                  );
                  const driftMapped = rules.some(
                    (rule) =>
                      rule.variable === issue.variable &&
                      rule.status === 'PUBLISHED',
                  );
                  return (
                    <article
                      className="pending-item pending-item-complete"
                      key={issue.id}
                    >
                      <div
                        className={`change-mark ${issue.change === 'DRIFT' ? 'change-drift' : issue.change === 'REMOVED' ? 'change-removed' : ''}`}
                      >
                        {meta.symbol}
                      </div>
                      <div className="pending-variable">
                        <span className="mapping-code">{issue.variable}</span>
                        <b>{meta.label}</b>
                        <small>{issue.note}</small>
                      </div>
                      <div>
                        <span className="pending-label">影响话术场景</span>
                        <p>{issue.sceneNames.join('、')}</p>
                      </div>
                      <div>
                        <span className="pending-label">处理状态</span>
                        <p
                          className={draft || driftMapped ? 'draft-ready' : ''}
                        >
                          {draft
                            ? draft.remove
                              ? '待发布移除'
                              : '草稿待发布'
                            : driftMapped
                              ? '待同步复核'
                              : '尚未处理'}
                        </p>
                      </div>
                      <Status tone={draft || driftMapped ? 'blue' : meta.tone}>
                        {draft || driftMapped
                          ? '处理中'
                          : issue.change === 'DRIFT'
                            ? 'DRIFT_DETECTED'
                            : issue.change === 'REMOVED'
                              ? 'REMOVED'
                              : 'PENDING_MAPPING'}
                      </Status>
                      <div className="pending-actions">
                        {issue.change === 'REMOVED' ? (
                          <button
                            className="table-action"
                            onClick={() => stageRemoval(issue.variable)}
                          >
                            <Trash2 size={12} />
                            确认移除
                          </button>
                        ) : issue.change === 'DRIFT' ? (
                          <button
                            className="table-action"
                            onClick={() =>
                              setSelectedScene(
                                scenes.find(
                                  (scene) => scene.name === issue.sceneNames[0],
                                ) ?? null,
                              )
                            }
                          >
                            <GitCompareArrows size={12} />
                            查看差异
                          </button>
                        ) : (
                          <button
                            className="table-action"
                            onClick={() => openMapping(issue.variable)}
                          >
                            配置映射 <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="pending-empty">
                <Check size={18} />
                <div>
                  <b>当前没有待处理变量</b>
                  <p>全部场景变量均已核对；系统会在下次巡检后继续更新。</p>
                </div>
              </div>
            )}
            {drafts.length ? (
              <div className="draft-publish-bar">
                <div>
                  <ShieldCheck size={17} />
                  <span>
                    <b>{drafts.length} 项变更已保存到数据库草稿</b>
                    <small>
                      草稿不会解除场景阻断；发布后生成不可变版本 v
                      {currentVersion + 1}
                    </small>
                  </span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setPublishOpen(true)}
                  disabled={saving}
                >
                  审核并发布
                </button>
              </div>
            ) : null}
          </Panel>
        </TabsContent>

        <TabsContent value="scenes" className="mapping-tab-panel">
          <Panel title="话术场景就绪状态" meta="只有 ACTIVE 可创建新任务">
            <div className="rules-toolbar">
              <label className="search-box">
                <Search size={15} />
                <input
                  value={sceneQuery}
                  onChange={(event) => setSceneQuery(event.target.value)}
                  placeholder="搜索话术名称、话术 ID 或公司"
                />
              </label>
              <UnifiedSelect
                className="filter-button"
                ariaLabel="场景状态"
                value={sceneStatus}
                popupLabel="按话术场景状态筛选"
                onValueChange={(value) =>
                  setSceneStatus(value as 'ALL' | SceneStatus)
                }
                options={[
                  { value: 'ALL', label: '全部状态' },
                  ...Object.entries(sceneStatusMeta).map(([value, meta]) => ({
                    value,
                    label: meta.short,
                    description: meta.label,
                  })),
                ]}
              />
            </div>
            <div className="table-wrap">
              <table className="data-table scene-readiness-table">
                <thead>
                  <tr>
                    <th>话术场景</th>
                    <th>公司覆盖</th>
                    <th>变量覆盖</th>
                    <th>最后成功同步</th>
                    <th>就绪状态</th>
                    <th>问题摘要</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScenes.map((scene) => (
                    <tr key={scene.id}>
                      <td>
                        <b>{scene.name}</b>
                        <span className="table-meta">{scene.robotDefId}</span>
                      </td>
                      <td>{scene.companies}</td>
                      <td>
                        <b>
                          {scene.coverage} / {scene.expected}
                        </b>
                        <div className="coverage-track">
                          <i
                            style={{
                              width: `${scene.expected ? (scene.coverage / scene.expected) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td>{scene.lastSync}</td>
                      <td>
                        <Status tone={sceneStatusMeta[scene.status].tone}>
                          {sceneStatusMeta[scene.status].label}
                        </Status>
                      </td>
                      <td className="scene-issue-cell">{scene.issue || '—'}</td>
                      <td>
                        <button
                          className="table-action"
                          onClick={() => setSelectedScene(scene)}
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="rules" className="mapping-tab-panel">
          <Panel
            title="百应话术变量映射"
            meta={`${mappingScene ? mappingScene.name : `全部 ${scenes.length} 个话术`} · 当前显示 ${mappingVariables.length} 个变量 · 已发布 ${mappedVariableCount} 个`}
            className="rules-panel"
          >
            <div className="rules-toolbar mapping-rules-toolbar">
              <label className="search-box">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索百应变量、ERP 字段或 CRM 字段"
                />
              </label>
              <div className="mapping-scene-filter">
                <span>话术范围</span>
                <UnifiedSelect
                  className="filter-button"
                  ariaLabel="映射话术范围"
                  value={mappingScene?.id ?? 'ALL'}
                  popupLabel="选择需要核对的话术范围"
                  onValueChange={setMappingSceneId}
                  options={[
                    {
                      value: 'ALL',
                      label: `全部话术 · 去重 ${syncedVariables.length} 个变量`,
                    },
                    ...sortedScenes.map((scene) => ({
                      value: scene.id,
                      label: scene.name,
                      description: `${scene.variables.length} 个变量`,
                    })),
                  ]}
                />
              </div>
              <UnifiedSelect
                className="filter-button"
                ariaLabel="规则状态"
                value={ruleStatus}
                popupLabel="按映射规则状态筛选"
                onValueChange={(value) =>
                  setRuleStatus(value as typeof ruleStatus)
                }
                options={[
                  { value: 'ALL', label: '全部状态' },
                  { value: 'UNMAPPED', label: '待配置' },
                  { value: 'PUBLISHED', label: '已发布' },
                  { value: 'DRAFT', label: '有草稿' },
                  { value: 'REMOVED', label: '已移除' },
                ]}
              />
              <button
                className="primary-button"
                onClick={() => setPublishOpen(true)}
                disabled={!drafts.length || saving}
              >
                发布草稿{drafts.length ? `（${drafts.length}）` : ''}
              </button>
            </div>
            <div className="rule-scope">
              <span>{mappingScene ? '单话术核对' : '全部话术 · 全局去重'}</span>
              <p>
                {mappingScene ? (
                  <>
                    当前只显示“{mappingScene.name}”本次接口快照返回的{' '}
                    {mappingVariables.length} 个变量，与场景状态详情口径一致。
                  </>
                ) : (
                  <>
                    当前显示全部 {scenes.length}{' '}
                    个话术的变量并集，同名变量只保留一行；可在上方选择一个话术，与场景状态逐项核对。
                  </>
                )}
              </p>
            </div>
            <div className="table-wrap">
              <table className="data-table mapping-table direct-mapping-table">
                <thead>
                  <tr>
                    <th>百应话术变量</th>
                    <th>关联话术</th>
                    <th>
                      <span className="source-header source-erp">
                        ERP 取值字段
                      </span>
                    </th>
                    <th>
                      <span className="source-header source-crm">
                        CRM 取值字段
                      </span>
                    </th>
                    <th>写入百应</th>
                    <th>转换规则</th>
                    <th>空值策略</th>
                    <th>版本状态</th>
                    <th>样例预览</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleRows.map((rule) => {
                    const relatedScenes =
                      variableScenes.get(rule.variable) ?? [];
                    const relatedSceneNames = relatedScenes.map(
                      (scene) => scene.name,
                    );
                    return (
                      <tr key={rule.id}>
                        <td>
                          <b>{rule.variable}</b>
                          <small className="table-meta">百应接口同步</small>
                        </td>
                        <td>
                          <div
                            className="variable-scene-usage"
                            aria-label={`关联话术：${relatedSceneNames.join('、')}`}
                            title={relatedSceneNames.join('、')}
                          >
                            <b>{relatedScenes.length} 个话术</b>
                            <small>
                              {mappingScene
                                ? mappingScene.name
                                : relatedSceneNames.length > 1
                                  ? `${relatedSceneNames[0]} 等`
                                  : relatedSceneNames[0] || '无关联话术'}
                            </small>
                          </div>
                        </td>
                        <td>
                          <MappedSourceField
                            source="ERP"
                            value={rule.erpField}
                          />
                        </td>
                        <td>
                          <MappedSourceField
                            source="CRM"
                            value={rule.crmField}
                          />
                        </td>
                        <td>
                          <span className="payload-path">
                            properties.{rule.variable}
                          </span>
                        </td>
                        <td>
                          {rule.displayStatus === 'UNMAPPED' ? (
                            '—'
                          ) : (
                            <>
                              <b>{rule.transform}</b>
                              <small className="table-meta config-summary">
                                {rule.transformConfig}
                              </small>
                            </>
                          )}
                        </td>
                        <td>
                          {rule.displayStatus === 'UNMAPPED' ? (
                            '—'
                          ) : rule.emptyPolicy === 'BLOCK' ? (
                            <Status tone="red">缺失阻断</Status>
                          ) : (
                            <div>
                              <Status tone="blue">使用默认值</Status>
                              <small className="table-meta">
                                {rule.defaultValue}
                              </small>
                            </div>
                          )}
                        </td>
                        <td>
                          <Status
                            tone={
                              rule.displayStatus === 'PUBLISHED'
                                ? 'green'
                                : rule.displayStatus === 'REMOVED'
                                  ? 'gray'
                                  : 'amber'
                            }
                          >
                            {rule.displayStatus === 'PUBLISHED'
                              ? `v${rule.version} 已发布`
                              : rule.displayStatus === 'REMOVED'
                                ? '待移除 / 已移除'
                                : rule.displayStatus === 'DRAFT'
                                  ? '草稿待发布'
                                  : '待配置'}
                          </Status>
                        </td>
                        <td>
                          {rule.displayStatus === 'UNMAPPED' ? (
                            '—'
                          ) : (
                            <span className="sample-preview">
                              <small>{rule.sampleInput || '空值'}</small>
                              {rule.sampleOutput}
                            </span>
                          )}
                        </td>
                        <td>
                          {rule.displayStatus === 'REMOVED' ? (
                            '—'
                          ) : (
                            <button
                              className="table-action"
                              onClick={() => openMapping(rule.variable)}
                            >
                              {rule.displayStatus === 'UNMAPPED'
                                ? '配置映射'
                                : '编辑映射'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!ruleRows.length ? (
              <div className="rule-empty">
                {mappingScene && !mappingVariables.length
                  ? '该话术本次接口快照未返回需要映射的自定义变量'
                  : '没有符合条件的百应变量'}
              </div>
            ) : null}
          </Panel>
        </TabsContent>

        <TabsContent value="versions" className="mapping-tab-panel">
          <Panel title="发布版本记录" meta="版本发布后不可修改">
            <div className="version-list">
              {versions.map((version, index) => (
                <article key={version.version}>
                  <div className="version-marker">
                    <History size={15} />
                  </div>
                  <div>
                    <span className="mapping-code">
                      v{version.version}
                      {index === 0 ? ' · 当前' : ''}
                    </span>
                    <h4>{version.change}</h4>
                    <p>
                      {version.publisher} · {version.publishedAt}
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>规则数量</dt>
                      <dd>{version.ruleCount}</dd>
                    </div>
                    <div>
                      <dt>适用范围</dt>
                      <dd>全局</dd>
                    </div>
                  </dl>
                  <button
                    className="table-action"
                    onClick={() =>
                      setFeedback(
                        `已选择 v${version.version}：历史版本只读，可用于核对已创建任务快照。`,
                      )
                    }
                  >
                    查看快照
                  </button>
                </article>
              ))}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(editVariable)}
        onOpenChange={(open) => {
          if (!open) setEditVariable(null);
        }}
      >
        <DialogContent
          className="mapping-dialog mapping-dialog-refined max-w-[760px] gap-0 p-0"
          showCloseButton={false}
        >
          <form onSubmit={saveDraft}>
            <DialogHeader className="mapping-dialog-header mapping-dialog-header-refined">
              <div>
                <p className="mapping-api-label">
                  <span>百应变量接口</span> 同步变量映射
                </p>
                <DialogTitle>配置 ERP / CRM 取值关系</DialogTitle>
                <DialogDescription>
                  分别指定两套业务系统为该百应话术变量提供值的字段。
                </DialogDescription>
              </div>
              <button
                type="button"
                className="dialog-close-button"
                aria-label="关闭"
                onClick={() => setEditVariable(null)}
              >
                ×
              </button>
            </DialogHeader>

            <div className="mapping-dialog-body mapping-dialog-body-refined">
              <div className="mapping-target-variable">
                <span>目标百应话术变量</span>
                <b>{editVariable}</b>
                <small>来自百应查询话术变量接口，不支持手工修改</small>
              </div>

              <section className="mapping-editor-section">
                <div className="mapping-section-heading">
                  <span>01</span>
                  <div>
                    <b>配置数据来源</b>
                    <small>至少配置 ERP 或 CRM 中的一个字段</small>
                  </div>
                </div>
                <div className="source-edit-grid variable-source-grid">
                  <label className="source-input source-input-erp">
                    <span>
                      <i>ERP</i> 取值字段
                    </span>
                    <input
                      value={draftForm.erpField}
                      onChange={(event) =>
                        setDraftForm({
                          ...draftForm,
                          erpField: event.target.value,
                        })
                      }
                      placeholder="例如：package_interest"
                    />
                    <small>ERP 名单导入时只读取这里</small>
                  </label>
                  <label className="source-input source-input-crm">
                    <span>
                      <i>CRM</i> 取值字段
                    </span>
                    <input
                      value={draftForm.crmField}
                      onChange={(event) =>
                        setDraftForm({
                          ...draftForm,
                          crmField: event.target.value,
                        })
                      }
                      placeholder="例如：interest_package"
                    />
                    <small>CRM 名单导入时只读取这里</small>
                  </label>
                </div>
              </section>

              <section className="mapping-editor-section mapping-processing-section">
                <div className="mapping-section-heading">
                  <span>02</span>
                  <div>
                    <b>设置值处理方式</b>
                    <small>两个来源共用同一套转换与空值策略</small>
                  </div>
                </div>
                <div className="mapping-form-grid">
                  <div className="profile-field">
                    转换规则 <i>*</i>
                    <UnifiedSelect
                      ariaLabel="转换规则"
                      value={draftForm.transform}
                      popupLabel="选择字段值的转换规则"
                      onValueChange={(value) => {
                        const transform = value as TransformType;
                        setDraftForm({
                          ...draftForm,
                          transform,
                          transformConfig:
                            transform === 'DATE'
                              ? 'YYYY-MM-DD'
                              : transform === 'MONEY'
                                ? '元 · 保留2位'
                                : transform === 'ENUM'
                                  ? 'A=轻奢\nB=高定'
                                  : transform === 'TEMPLATE'
                                    ? '{{value}}'
                                    : '去除首尾空格',
                        });
                      }}
                      options={[
                        { value: 'TEXT', label: 'TEXT · 文本处理' },
                        { value: 'DATE', label: 'DATE · 日期格式' },
                        { value: 'MONEY', label: 'MONEY · 金额处理' },
                        { value: 'ENUM', label: 'ENUM · 枚举映射' },
                        { value: 'TEMPLATE', label: 'TEMPLATE · 文本模板' },
                      ]}
                    />
                  </div>
                  <div className="profile-field">
                    空值策略 <i>*</i>
                    <UnifiedSelect
                      ariaLabel="空值策略"
                      value={draftForm.emptyPolicy}
                      popupLabel="选择字段为空时的处理方式"
                      onValueChange={(value) =>
                        setDraftForm({
                          ...draftForm,
                          emptyPolicy: value as EmptyPolicy,
                        })
                      }
                      options={[
                        { value: 'BLOCK', label: 'BLOCK · 缺失阻断' },
                        { value: 'DEFAULT', label: 'DEFAULT · 使用默认值' },
                      ]}
                    />
                  </div>
                </div>
                <div className="mapping-processing-detail">
                  <TransformConfigEditor
                    draft={draftForm}
                    onChange={setDraftForm}
                  />
                  {draftForm.emptyPolicy === 'DEFAULT' ? (
                    <label className="profile-field">
                      默认值 <i>*</i>
                      <input
                        required
                        value={draftForm.defaultValue}
                        onChange={(event) =>
                          setDraftForm({
                            ...draftForm,
                            defaultValue: event.target.value,
                          })
                        }
                        placeholder="字段为空或转换未命中时使用"
                      />
                    </label>
                  ) : (
                    <div className="notice warn">
                      <b>缺失即阻断：</b>
                      对应来源字段为空时进入导入失败明细，不会静默提交到百应。
                    </div>
                  )}
                </div>
              </section>

              <section className="mapping-editor-section mapping-test-section">
                <div className="mapping-section-heading">
                  <span>03</span>
                  <div>
                    <b>测试映射结果</b>
                    <small>发布前用一条示例值验证输出</small>
                  </div>
                </div>
                <div className="preview-lab preview-lab-refined">
                  <label className="profile-field">
                    测试原始值
                    <input
                      value={draftForm.sampleInput}
                      onChange={(event) =>
                        setDraftForm({
                          ...draftForm,
                          sampleInput: event.target.value,
                        })
                      }
                      placeholder="输入一条原始值"
                    />
                  </label>
                  <div>
                    <span>转换后写入</span>
                    <b>{applyPreview(draftForm)}</b>
                    <small>properties.{editVariable}</small>
                  </div>
                </div>
              </section>
            </div>

            <DialogFooter className="mapping-dialog-footer mapping-dialog-footer-refined">
              <p>
                <b>保存为草稿</b>后仍需统一发布，才会应用到新任务。
              </p>
              <div>
                <button
                  type="button"
                  className="filter-button"
                  onClick={() => setEditVariable(null)}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={
                    saving || (!draftForm.erpField && !draftForm.crmField)
                  }
                >
                  {saving ? '正在保存…' : '保存为草稿'}
                </button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent
          className="publish-dialog max-w-[540px]"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>发布全局映射版本 v{currentVersion + 1}</DialogTitle>
            <DialogDescription>
              发布后，新创建任务和新名单导入将锁定此版本；已创建任务不受影响。
            </DialogDescription>
          </DialogHeader>
          <div className="publish-summary">
            <div>
              <span>待发布变更</span>
              <b>{drafts.length}</b>
            </div>
            <div>
              <span>新增 / 修改</span>
              <b>{drafts.filter((draft) => !draft.remove).length}</b>
            </div>
            <div>
              <span>移除规则</span>
              <b>{drafts.filter((draft) => draft.remove).length}</b>
            </div>
          </div>
          <div className="publish-change-list">
            {drafts.map((draft) => (
              <p key={draft.variable}>
                <span>
                  {draft.remove
                    ? '移除'
                    : rules.some((rule) => rule.variable === draft.variable)
                      ? '修改'
                      : '新增'}
                </span>
                <b>{draft.variable}</b>
                <small>
                  {draft.remove
                    ? '旧版本继续保留快照'
                    : `ERP ${draft.erpField || '—'} / CRM ${draft.crmField || '—'} · ${draft.transform}`}
                </small>
              </p>
            ))}
          </div>
          <div className="notice warn">
            <b>发布前确认：</b>版本发布后不可原地修改，如需调整必须创建新版本。
          </div>
          <DialogFooter className="publish-footer">
            <button
              className="filter-button"
              onClick={() => setPublishOpen(false)}
              disabled={saving}
            >
              取消
            </button>
            <button
              className="primary-button"
              onClick={publishDrafts}
              disabled={!drafts.length || saving}
            >
              {saving ? '正在发布…' : '确认发布'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedScene)}
        onOpenChange={(open) => {
          if (!open) setSelectedScene(null);
        }}
      >
        <DialogContent
          className="scene-dialog scene-variable-dialog max-w-[820px]"
          showCloseButton={false}
        >
          <DialogHeader className="scene-variable-dialog-header">
            <div>
              <p className="eyebrow">SCENE VARIABLE SNAPSHOT</p>
              <DialogTitle>{selectedScene?.name}</DialogTitle>
              <DialogDescription>
                {selectedScene?.robotDefId} · {selectedScene?.companies} ·
                百应变量接口最近同步 {selectedScene?.lastSync}
              </DialogDescription>
            </div>
            <button
              type="button"
              className="dialog-close-button"
              aria-label="关闭"
              onClick={() => setSelectedScene(null)}
            >
              ×
            </button>
          </DialogHeader>
          {selectedScene ? (
            <>
              <div className="scene-detail-status scene-detail-status-wide">
                <Status tone={sceneStatusMeta[selectedScene.status].tone}>
                  {sceneStatusMeta[selectedScene.status].label}
                </Status>
                <p>
                  {selectedScene.issue ||
                    '当前变量均已配置发布映射，可以创建新任务和导入名单。'}
                </p>
              </div>
              <div className="scene-variable-summary scene-variable-summary-compact">
                <div>
                  <span>接口返回变量</span>
                  <b>{selectedScene.expected}</b>
                </div>
                <div>
                  <span>已发布映射</span>
                  <b>{selectedScene.coverage}</b>
                </div>
                <div>
                  <span>待处理变量</span>
                  <b>{selectedScene.expected - selectedScene.coverage}</b>
                </div>
                <div>
                  <span>新任务 / 导入</span>
                  <b>{selectedScene.status === 'ACTIVE' ? '允许' : '阻断'}</b>
                </div>
              </div>

              <section className="scene-variable-section">
                <div className="scene-variable-section-heading">
                  <div>
                    <b>当前话术变量</b>
                    <small>以本次百应接口快照为准</small>
                  </div>
                  <span>{sceneVariableRows.length} 个变量</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table scene-variable-table">
                    <thead>
                      <tr>
                        <th>百应变量</th>
                        <th>接口当前情况</th>
                        <th>ERP 字段</th>
                        <th>CRM 字段</th>
                        <th>映射状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sceneVariableRows.map((row) => (
                        <tr key={row.variable}>
                          <td>
                            <b>{row.variable}</b>
                            <small className="table-meta">
                              properties.{row.variable}
                            </small>
                          </td>
                          <td>
                            <span className="api-variable-state">
                              {row.apiStatus}
                            </span>
                          </td>
                          <td>
                            <code
                              className={`scene-source-value scene-source-erp ${row.erpField ? '' : 'is-empty'}`}
                            >
                              {row.erpField || '未配置'}
                            </code>
                          </td>
                          <td>
                            <code
                              className={`scene-source-value scene-source-crm ${row.crmField ? '' : 'is-empty'}`}
                            >
                              {row.crmField || '未配置'}
                            </code>
                          </td>
                          <td>
                            <Status tone={row.tone}>{row.mappingStatus}</Status>
                          </td>
                          <td>
                            <button
                              className="table-action"
                              onClick={() => {
                                setSelectedScene(null);
                                if (row.mappingStatus === '待确认移除')
                                  void stageRemoval(row.variable);
                                else openMapping(row.variable);
                              }}
                            >
                              {row.mappingStatus === '待确认移除'
                                ? '确认移除'
                                : row.mappingStatus.includes('已发布')
                                  ? '编辑'
                                  : '配置'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedScene.status === 'DRIFT_DETECTED' ? (
                <div className="drift-compare">
                  <h4>跨公司变量差异</h4>
                  <p>
                    <span>当前判断</span>
                    <code>最新成功快照的变量集合不一致</code>
                  </p>
                  <p>
                    <span>处理建议</span>
                    <code>重新同步并核对各公司对应的话术版本</code>
                  </p>
                </div>
              ) : null}
              <DialogFooter className="scene-dialog-footer scene-variable-dialog-footer">
                <p>变量状态变化后，需要重新发布映射并同步复核。</p>
                <div className="scene-variable-dialog-actions">
                  <button
                    className="filter-button"
                    onClick={() => setSelectedScene(null)}
                  >
                    关闭
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setMappingSceneId(selectedScene.id);
                      setSelectedScene(null);
                      setActiveTab('rules');
                    }}
                  >
                    查看该话术映射
                  </button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransformConfigEditor({
  draft,
  onChange,
}: {
  draft: MappingDraft;
  onChange: (draft: MappingDraft) => void;
}) {
  if (draft.transform === 'DATE')
    return (
      <div className="profile-field">
        日期输出格式 <i>*</i>
        <UnifiedSelect
          ariaLabel="日期输出格式"
          value={draft.transformConfig}
          popupLabel="选择日期输出格式"
          onValueChange={(value) =>
            onChange({ ...draft, transformConfig: value })
          }
          options={[
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            { value: 'YYYY年MM月DD日', label: 'YYYY年MM月DD日' },
            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
          ]}
        />
      </div>
    );
  if (draft.transform === 'MONEY')
    return (
      <div className="profile-field">
        金额处理 <i>*</i>
        <UnifiedSelect
          ariaLabel="金额处理"
          value={draft.transformConfig}
          popupLabel="选择金额转换方式"
          onValueChange={(value) =>
            onChange({ ...draft, transformConfig: value })
          }
          options={[
            { value: '元 · 保留2位', label: '元 · 保留2位' },
            { value: '元 · 保留0位', label: '元 · 保留0位' },
            { value: '分转元 · 保留2位', label: '分转元 · 保留2位' },
          ]}
        />
      </div>
    );
  if (draft.transform === 'ENUM')
    return (
      <label className="profile-field">
        枚举映射 <i>*</i>
        <textarea
          required
          value={draft.transformConfig}
          onChange={(event) =>
            onChange({ ...draft, transformConfig: event.target.value })
          }
          placeholder={'每行一项，例如：\nA=轻奢婚纱照\nB=高定婚纱照'}
        />
      </label>
    );
  if (draft.transform === 'TEMPLATE')
    return (
      <label className="profile-field">
        文本模板 <i>*</i>
        <input
          required
          value={draft.transformConfig}
          onChange={(event) =>
            onChange({ ...draft, transformConfig: event.target.value })
          }
          placeholder="例如：{{value}}老师"
        />
        <small className="field-help">使用 {'{{value}}'} 代表原始字段值</small>
      </label>
    );
  return (
    <div className="profile-field">
      文本处理 <i>*</i>
      <UnifiedSelect
        ariaLabel="文本处理"
        value={draft.transformConfig}
        popupLabel="选择文本处理方式"
        onValueChange={(value) =>
          onChange({ ...draft, transformConfig: value })
        }
        options={[
          { value: '去除首尾空格', label: '去除首尾空格' },
          { value: '保持原值', label: '保持原值' },
          { value: '转为大写', label: '转为大写' },
          { value: '转为小写', label: '转为小写' },
        ]}
      />
    </div>
  );
}

function MappedSourceField({
  source,
  value,
}: {
  source: 'ERP' | 'CRM';
  value: string;
}) {
  return (
    <div
      className={`source-field-cell ${source === 'ERP' ? 'source-field-erp' : 'source-field-crm'}`}
    >
      <span>{source}</span>
      {value ? <code>{value}</code> : <em>未配置</em>}
    </div>
  );
}
