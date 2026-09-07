'use client';

/* oxlint-disable jsx-a11y/control-has-associated-label -- Interactive table cells render labels through composed task components. */

import { useEffect, useMemo, useState } from 'react';
import type { OperatorStudio } from '@outbound/contracts';
import {
  Building2,
  Cable,
  Check,
  ChevronRight,
  Database,
  ListChecks,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UnifiedSelect } from '@/components/ui/unified-select';
import {
  loadScripts,
  loadLines,
  loadManagedLines,
  loadOperatorStudios,
  loadDataCategories,
  loadPlannedTasks,
  loadSourceCategories,
  savePlannedTaskCategoryBinding,
  saveScriptBinding,
  saveLineStudioBindings,
  syncDataCategories,
  type BaiyingLine,
  type BaiyingScript,
  type BaiyingScriptStatus,
  type DataCategory,
  type LineSyncInfo,
  type PlannedTask,
  type PlannedTaskStatus,
  type SourceDataCategory,
} from '@/lib/platform-api';
import { PageIntro, Panel } from './shared';
import { ApiDocumentation } from './api-documentation';
import { OutboundTaskConsole } from './outbound-task-console';
export { MappingView } from './mapping-view';

export function TaskView() {
  return (
    <div className="task-view task-list-view">
      <header className="task-page-intro">
        <div>
          <h2>呼叫任务</h2>
          <p>
            直接读取平台数据库，查看任务状态、计费余额、通话结果与录音归档进度。
          </p>
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

function useActiveOperatorStudios() {
  const [studios, setStudios] = useState<OperatorStudio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadOperatorStudios({
      studioStatus: 'ACTIVE',
      pageNum: 0,
      pageSize: 100,
    })
      .then((page) => {
        if (cancelled) return;
        setStudios(page.studios);
        setError('');
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : '影楼列表加载失败',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { studios, loading, error };
}

export function ScriptListView() {
  const {
    studios,
    loading: studioLoading,
    error: studioError,
  } = useActiveOperatorStudios();
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
        setLineId(
          (current) =>
            current ||
            lines.find((line) => line.isActive)?.userPhoneId ||
            lines[0]?.userPhoneId ||
            '',
        );
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
    setStudioId(binding?.studioId ?? studios[0]?.businessCode ?? '');
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
  const selectedStudio = studios.find(
    (studio) => studio.businessCode === studioId,
  );
  const selectedLine = lineOptions.find((line) => line.userPhoneId === lineId);
  const canSaveBinding = Boolean(
    bindingScript &&
    selectedCategories.length &&
    selectedStudio &&
    selectedLine?.isActive,
  );
  const saveBinding = async () => {
    if (
      !bindingScript ||
      !selectedCategories.length ||
      !selectedStudio ||
      !selectedLine?.isActive
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
        studioId: selectedStudio.businessCode,
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
                    disabled={studioLoading || !studios.length}
                    placeholder={
                      studioLoading
                        ? '正在读取影楼管理…'
                        : studios.length
                          ? '请选择影楼'
                          : '影楼管理中暂无启用影楼'
                    }
                    popupLabel="选择话术所属影楼"
                    options={studios.map((studio) => ({
                      value: studio.businessCode,
                      label: `${studio.name} · ${studio.businessCode}`,
                      description: studio.mcCode,
                    }))}
                    onValueChange={setStudioId}
                  />
                </div>
                {studioError ? (
                  <p className="field-error">{studioError}</p>
                ) : null}
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
                        description: `${line.isActive ? '百应可用' : '已停用，仅保留历史绑定'} · #${line.userPhoneId}`,
                        disabled: !line.isActive,
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
                  <li className={selectedLine?.isActive ? 'is-ready' : ''}>
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

function formatLineSyncTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function ApiInterfaceView() {
  return <ApiDocumentation />;
}

export function LineManagementView() {
  const {
    studios,
    loading: studioLoading,
    error: studioError,
  } = useActiveOperatorStudios();
  const [lines, setLines] = useState<BaiyingLine[]>([]);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sync, setSync] = useState<LineSyncInfo | null>(null);
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
          setSync(result.sync);
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

  const activeLines = lines.filter((line) => line.isActive);
  const inactiveLines = lines.filter((line) => !line.isActive);
  const boundStudioIds = new Set(
    activeLines.flatMap((line) =>
      line.studios.map((studio) => studio.studioId),
    ),
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
        selectedStudioIds.includes(studio.businessCode),
      );
      const result = await saveLineStudioBindings({
        userPhoneId: bindingLine.userPhoneId,
        studios: selectedStudios.map((studio) => ({
          studioId: studio.businessCode,
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
        summary="优先实时同步百应外呼线路；同步异常时自动展示上次成功缓存，历史线路及其业务绑定会完整保留。"
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
          <span>
            {sync?.status === 'STALE' ? '缓存可用线路' : '百应可用线路'}
          </span>
          <b>{loading && !lines.length ? '—' : activeLines.length}</b>
          <small>
            {sync?.status === 'STALE'
              ? '上次成功同步时可用'
              : '本次同步仍可使用'}
          </small>
        </div>
        <div>
          <span>已绑定线路</span>
          <b>{activeLines.filter((line) => line.studios.length).length}</b>
          <small>至少绑定 1 家影楼</small>
        </div>
        <div>
          <span>已覆盖影楼</span>
          <b>{boundStudioIds.size}</b>
          <small>去重后的影楼数量</small>
        </div>
        <div>
          <span>历史线路</span>
          <b>{inactiveLines.length}</b>
          <small>未在百应本次结果中</small>
        </div>
      </section>
      <Panel
        title="百应外呼线路"
        meta={
          loading
            ? '正在同步接口…'
            : `共 ${lines.length} 条 · ${activeLines.length} 条可用`
        }
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
        <div
          className={`planned-api-note ${sync?.status === 'STALE' ? 'is-stale' : ''}`}
          role={sync?.status === 'STALE' ? 'status' : undefined}
        >
          <span>{sync?.status === 'STALE' ? '缓存数据' : '百应实时数据'}</span>
          <p>
            {sync?.status === 'STALE'
              ? `${sync.message ?? '实时同步失败，当前展示缓存'}${sync.lastSuccessfulAt ? `；缓存同步于 ${formatLineSyncTime(sync.lastSuccessfulAt)}` : ''}；错误代码 ${sync.errorCode ?? 'LINE_SYNC_UNAVAILABLE'}。`
              : `线路字段来自 phone-list 接口；影楼绑定由本平台保存，一条线路可以绑定多家影楼。${sync?.lastSuccessfulAt ? ` 本次同步于 ${formatLineSyncTime(sync.lastSuccessfulAt)}。` : ''}`}
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
                className={`planned-card line-card ${line.isActive ? '' : 'is-inactive'}`}
                key={line.userPhoneId}
              >
                <header>
                  <div>
                    <span
                      className={`planned-status ${line.isActive ? 'planned-status-green' : 'planned-status-amber'}`}
                    >
                      {line.isActive
                        ? sync?.status === 'STALE'
                          ? '上次可用'
                          : '百应可用'
                        : sync?.status === 'STALE'
                          ? '历史停用'
                          : '本次未返回'}
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
                        .join('、') ||
                        (line.isActive
                          ? '点击配置线路适用的影楼'
                          : '历史线路不可新增绑定')}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => openBinding(line)}
                    disabled={!line.isActive}
                  >
                    {!line.isActive
                      ? '历史保留'
                      : line.studios.length
                        ? '修改绑定'
                        : '绑定影楼'}{' '}
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
            {sync?.status === 'STALE'
              ? '百应当前不可用，页面使用本地缓存；点击“同步百应线路”可重新尝试。'
              : '查询参数由平台过滤；未在本次结果中的线路会转为历史状态，不会删除已有绑定。'}
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
                  setSelectedStudioIds(
                    studios.map((studio) => studio.businessCode),
                  )
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
            {studioLoading ? (
              <div className="planned-state">正在读取影楼管理数据…</div>
            ) : studios.length ? (
              studios.map((studio) => {
                const checked = selectedStudioIds.includes(studio.businessCode);
                return (
                  <label
                    className={checked ? 'is-selected' : ''}
                    key={studio.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStudio(studio.businessCode)}
                    />
                    <span>
                      <b>{studio.name}</b>
                      <small>
                        {studio.businessCode} · {studio.mcCode}
                      </small>
                    </span>
                    <i>{checked ? '已选择' : '未选择'}</i>
                  </label>
                );
              })
            ) : (
              <div className="planned-state">影楼管理中暂无启用影楼</div>
            )}
          </fieldset>
          {bindingError || studioError ? (
            <div className="notice alert">{bindingError || studioError}</div>
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
              disabled={saving || studioLoading || Boolean(studioError)}
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
