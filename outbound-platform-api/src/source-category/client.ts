import { z } from 'zod';

const primitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const envelopeSchema = z.looseObject({
  Code: z.union([z.string(), z.number()]),
  Msg: z.string().optional().default(''),
  Data: z.unknown(),
});

export type ExternalDataCategory = {
  externalId: string;
  name: string;
  categoryPath: string;
  level: number | null;
  parentId: string | null;
  active: boolean;
  fields: Record<string, string | number | boolean | null>;
};

export interface ErpCategoryClient {
  listCategories(token: string): Promise<ExternalDataCategory[]>;
}

export class HttpSxErpCategoryClient implements ErpCategoryClient {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listCategories(token: string): Promise<ExternalDataCategory[]> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ Token: token }),
    });
    if (!response.ok) throw new Error(`素玄 ERP 分类接口请求失败（HTTP ${response.status}）`);
    const envelope = envelopeSchema.parse(await response.json());
    const code = String(envelope.Code);
    if (!['0', '200'].includes(code)) throw new Error(envelope.Msg || `素玄 ERP 分类接口返回错误码 ${code}`);
    return normalizeCategories(envelope.Data);
  }
}

export function normalizeCategories(input: unknown): ExternalDataCategory[] {
  const parsed = parseMaybeJson(input);
  const categories: ExternalDataCategory[] = [];
  visit(parsed, [], null, categories);
  return categories;
}

function visit(value: unknown, ancestors: string[], parentId: string | null, categories: ExternalDataCategory[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, ancestors, parentId, categories);
    return;
  }
  if (!isRecord(value)) return;

  const fields = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] => primitiveSchema.safeParse(entry[1]).success));
  const sxCategory = normalizeSxCategoryRow(fields);
  if (sxCategory) {
    categories.push(sxCategory);
    return;
  }
  const name = pickString(fields, ['CategoryName', 'CateName', 'Name', 'Title', 'ClassName', 'TypeName']) || firstMeaningfulString(fields);
  const id = pickString(fields, ['CategoryId', 'CategoryID', 'CateId', 'CateID', 'Id', 'ID', 'Code', 'CategoryCode']) || `${categories.length + 1}`;
  const ownParentId = pickString(fields, ['ParentId', 'ParentID', 'Pid', 'PID', 'ParentCode']) || parentId;
  const levelValue = pickNumber(fields, ['Level', 'CategoryLevel', 'LevelNo', 'Depth']);
  const pathValue = pickString(fields, ['CategoryPath', 'Path', 'FullName', 'FullPath']);
  const path = pathValue || [...ancestors, name || `分类 ${id}`].join('-');
  const shouldCreate = Boolean(name || Object.keys(fields).length);

  if (shouldCreate) {
    categories.push({
      externalId: id,
      name: name || `分类 ${id}`,
      categoryPath: path,
      level: levelValue ?? (ancestors.length + 1),
      parentId: ownParentId,
      active: pickActive(fields),
      fields,
    });
  }

  const nextAncestors = shouldCreate ? [...ancestors, name || `分类 ${id}`] : ancestors;
  const nextParentId = shouldCreate ? id : parentId;
  for (const child of Object.values(value)) {
    if (Array.isArray(child) || isRecord(child)) visit(child, nextAncestors, nextParentId, categories);
  }
}

function normalizeSxCategoryRow(fields: Record<string, string | number | boolean | null>): ExternalDataCategory | null {
  const mainCategory = pickString(fields, ['main_category']);
  const subCategory = pickString(fields, ['sub_category']);
  if (!mainCategory && !subCategory) return null;

  const categoryLevel = pickString(fields, ['c_level']);
  const pathParts = [mainCategory, subCategory, categoryLevel].filter(Boolean);
  const categoryPath = pathParts.join('-');
  const externalId = pickString(fields, ['id']) || categoryPath;
  return {
    externalId,
    name: categoryPath,
    categoryPath,
    level: pathParts.length,
    parentId: null,
    active: true,
    fields,
  };
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(fields: Record<string, string | number | boolean | null>, names: string[]): string {
  const entry = Object.entries(fields).find(([key, value]) => names.some((name) => name.toLowerCase() === key.toLowerCase()) && value !== null && String(value).trim());
  return entry ? String(entry[1]).trim() : '';
}

function pickNumber(fields: Record<string, string | number | boolean | null>, names: string[]): number | null {
  const raw = pickString(fields, names);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function firstMeaningfulString(fields: Record<string, string | number | boolean | null>): string {
  const ignored = /(^|_)(id|code|status|state|level|sort|parent)(_|$)/i;
  const entry = Object.entries(fields).find(([key, value]) => !ignored.test(key) && typeof value === 'string' && value.trim());
  return entry?.[1] as string || '';
}

function pickActive(fields: Record<string, string | number | boolean | null>): boolean {
  const raw = pickString(fields, ['Active', 'Enabled', 'IsEnable', 'IsEnabled', 'Status', 'State']).toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'disabled', 'inactive', '停用', '禁用'].includes(raw);
}
