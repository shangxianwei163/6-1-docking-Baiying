import { randomUUID } from 'node:crypto';
import { mkdir, lstat, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  PutRecordingObjectInput,
  RecordingObjectStore,
  RecordingObjectReader,
  RecordingObjectDeleter,
} from './object-store.js';

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class LocalRecordingObjectStore
  implements
    RecordingObjectStore,
    RecordingObjectReader,
    RecordingObjectDeleter
{
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    if (!rootDirectory.trim()) {
      throw new TypeError('本地录音存储目录不能为空');
    }
    this.rootDirectory = resolve(rootDirectory);
  }

  async putObject(input: PutRecordingObjectInput): Promise<void> {
    const destination = this.resolveObjectPath(input.bucket, input.objectKey);
    const parent = dirname(destination);
    await ensureSafeDirectory(this.rootDirectory, parent);
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      await pipeline(
        Readable.from(input.body),
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  objectPath(bucket: string, objectKey: string): string {
    return this.resolveObjectPath(bucket, objectKey);
  }

  async openObject(input: { bucket: string; objectKey: string }) {
    const path = this.resolveObjectPath(input.bucket, input.objectKey);
    await assertSafeExistingPath(this.rootDirectory, path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error('本地录音对象不是可读取的普通文件');
    }
    return {
      body: createReadStream(path),
      sizeBytes: BigInt(stats.size),
    };
  }

  async deleteObject(input: { bucket: string; objectKey: string }) {
    const path = this.resolveObjectPath(input.bucket, input.objectKey);
    await assertSafeExistingPath(this.rootDirectory, path);
    await rm(path);
  }

  private resolveObjectPath(bucket: string, objectKey: string): string {
    assertSafeComponent(bucket, 'Bucket');
    if (isAbsolute(objectKey) || objectKey.includes('\\')) {
      throw new TypeError('录音对象键必须是安全的相对路径');
    }
    const components = objectKey.split('/');
    if (
      components.length < 2 ||
      components.some(
        (component) =>
          component === '.' ||
          component === '..' ||
          !SAFE_COMPONENT.test(component),
      )
    ) {
      throw new TypeError('录音对象键包含不安全的路径片段');
    }
    const bucketRoot = resolve(this.rootDirectory, bucket);
    const destination = resolve(bucketRoot, ...components);
    if (!destination.startsWith(`${bucketRoot}${sep}`)) {
      throw new TypeError('录音对象键越过了本地存储根目录');
    }
    return destination;
  }
}

async function ensureSafeDirectory(root: string, destination: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('本地录音存储根目录不允许是符号链接');
  }
  const relative = destination.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const component of relative) {
    current = resolve(current, component);
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
    });
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('本地录音存储路径中不允许出现符号链接');
    }
  }
}

async function assertSafeExistingPath(root: string, destination: string) {
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('本地录音存储根目录不允许是符号链接');
  }
  const relative = destination.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const component of relative) {
    current = resolve(current, component);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new Error('本地录音对象路径中不允许出现符号链接');
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function assertSafeComponent(value: string, label: string): void {
  if (!SAFE_COMPONENT.test(value)) {
    throw new TypeError(`${label} 只能包含字母、数字、点、下划线和连字符`);
  }
}
