import { ECSRAMRoleCredentialsProvider } from '@alicloud/credentials';
import OSS from 'ali-oss';
import { Readable } from 'node:stream';
import type {
  PutRecordingObjectInput,
  RecordingObjectDeleter,
  RecordingObjectReader,
  RecordingObjectStore,
} from './object-store.js';

const SAFE_OBJECT_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

export interface RecordingOssClient {
  putStream(objectKey: string, body: Readable): Promise<void>;
  getStream(objectKey: string): Promise<{
    stream: AsyncIterable<Uint8Array> | undefined;
    headers: Record<string, unknown>;
  }>;
  delete(objectKey: string): Promise<void>;
}

export class OssRecordingObjectStore
  implements
    RecordingObjectStore,
    RecordingObjectReader,
    RecordingObjectDeleter
{
  constructor(
    private readonly client: RecordingOssClient,
    private readonly bucket: string,
  ) {}

  async putObject(input: PutRecordingObjectInput): Promise<void> {
    this.assertTarget(input);
    await this.client.putStream(input.objectKey, Readable.from(input.body));
  }

  async openObject(input: { bucket: string; objectKey: string }) {
    this.assertTarget(input);
    const response = await this.client.getStream(input.objectKey);
    const contentLength = response.headers['content-length'];
    if (
      !response.stream ||
      typeof response.stream[Symbol.asyncIterator] !== 'function' ||
      (typeof contentLength !== 'string' && typeof contentLength !== 'number')
    ) {
      throw new Error('OSS 下载响应缺少有效的响应流或 Content-Length');
    }
    const sizeBytes = BigInt(contentLength);
    if (sizeBytes < 0n) throw new Error('OSS 下载响应长度无效');
    return { body: response.stream, sizeBytes };
  }

  async deleteObject(input: { bucket: string; objectKey: string }) {
    this.assertTarget(input);
    await this.client.delete(input.objectKey);
  }

  private assertTarget(input: { bucket: string; objectKey: string }): void {
    if (input.bucket !== this.bucket) {
      throw new Error(`OSS Bucket 不匹配: ${input.bucket}`);
    }
    if (
      input.objectKey.startsWith('/') ||
      input.objectKey.includes('\\') ||
      input.objectKey
        .split('/')
        .some(
          (component) =>
            component === '.' ||
            component === '..' ||
            !SAFE_OBJECT_COMPONENT.test(component),
        )
    ) {
      throw new TypeError('OSS 录音对象键包含不安全的路径片段');
    }
  }
}

export async function createEcsRamRoleOssObjectStore(input: {
  bucket: string;
  endpoint: string;
  region: string;
  roleName: string;
}): Promise<OssRecordingObjectStore> {
  const credential = ECSRAMRoleCredentialsProvider.builder()
    .withRoleName(input.roleName)
    .withDisableIMDSv1(true)
    .withConnectTimeout(1_000)
    .withReadTimeout(2_000)
    .withAsyncCredentialUpdateEnabled(false)
    .build();
  const refresh = async () => {
    const value = await credential.getCredentials();
    if (!value.accessKeyId || !value.accessKeySecret || !value.securityToken) {
      throw new Error('ECS RAM 角色未返回完整的 OSS 临时凭据');
    }
    return {
      accessKeyId: value.accessKeyId,
      accessKeySecret: value.accessKeySecret,
      stsToken: value.securityToken,
    };
  };
  const initial = await refresh();
  const client = new OSS({
    ...initial,
    bucket: input.bucket,
    endpoint: input.endpoint,
    region: input.region,
    secure: true,
    authorizationV4: true,
    refreshSTSToken: refresh,
    refreshSTSTokenInterval: 240_000,
    timeout: 60_000,
  });
  return new OssRecordingObjectStore(
    {
      async putStream(objectKey, body) {
        await client.putStream(objectKey, body);
      },
      async getStream(objectKey) {
        const response = await client.getStream(objectKey);
        return {
          stream: response.stream,
          headers: response.res.headers as Record<string, unknown>,
        };
      },
      async delete(objectKey) {
        await client.delete(objectKey);
      },
    },
    input.bucket,
  );
}
