'use client';

import { useMemo, useState } from 'react';
import type {
  CallbackPreview,
  CallbackPreviewEventType,
  SourceSystem,
} from '@outbound/contracts';
import {
  Ban,
  Check,
  Copy,
  FileJson2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { UnifiedSelect } from '@/components/ui/unified-select';
import { generateCallbackPreview } from '@/lib/platform-api';
import { PageIntro } from './shared';

const eventOptions: Array<{
  value: CallbackPreviewEventType;
  label: string;
  summary: string;
}> = [
  {
    value: 'OUTBOUND_CALL_RESULT_BATCH',
    label: '通话结果批次',
    summary: '模拟接通结果、进位分钟和脱敏号码',
  },
  {
    value: 'OUTBOUND_TASK_COMPLETED',
    label: '任务完成摘要',
    summary: '模拟任务对账完成后的汇总事件',
  },
  {
    value: 'OUTBOUND_RECORDING_AVAILABLE_BATCH',
    label: '录音可用批次',
    summary: '模拟 OSS 短链元数据，域名固定为 example.invalid',
  },
];

export function CallbackPreviewConsole() {
  const [sourceSystem, setSourceSystem] = useState<SourceSystem>('ERP');
  const [eventType, setEventType] = useState<CallbackPreviewEventType>(
    'OUTBOUND_CALL_RESULT_BATCH',
  );
  const [itemCount, setItemCount] = useState('1');
  const [preview, setPreview] = useState<CallbackPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'headers' | 'body' | null>(null);
  const selectedEvent = eventOptions.find((item) => item.value === eventType)!;
  const headersText = useMemo(
    () =>
      preview
        ? Object.entries(preview.request.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        : '',
    [preview],
  );

  const generate = async () => {
    setLoading(true);
    setError('');
    setCopied(null);
    try {
      setPreview(
        await generateCallbackPreview({
          sourceSystem,
          eventType,
          itemCount: Number(itemCount),
        }),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '模拟报文生成失败',
      );
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (kind: 'headers' | 'body', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_600);
  };

  return (
    <div className="callback-preview-console">
      <PageIntro
        eyebrow="SAFE CALLBACK LAB"
        title="回调报文预览"
        summary="只生成协议一致的脱敏合成报文，不读取业务数据、不访问回调地址，也不会进入投递队列。"
      />

      <section className="callback-safety-banner" aria-label="安全隔离状态">
        <ShieldCheck aria-hidden="true" size={22} />
        <div>
          <span>SAFE_PREVIEW · 本地安全预览</span>
          <b>网络投递已从服务能力中移除</b>
          <p>
            接口不接收 URL 或真实密钥；签名固定为不可用占位值，生成动作不会触发
            ERP、CRM 或百应。
          </p>
        </div>
        <strong>0 次投递</strong>
      </section>

      <section
        className="callback-environment-ladder"
        aria-label="回调环境分级"
      >
        <article className="is-current">
          <span>01</span>
          <div>
            <b>安全预览</b>
            <small>当前可用 · 合成数据 / 无网络</small>
          </div>
          <Check size={15} aria-label="当前环境" />
        </article>
        <article className="is-locked">
          <span>02</span>
          <div>
            <b>真实联调</b>
            <small>未配置 · 需测试地址、测试密钥与白名单</small>
          </div>
          <LockKeyhole size={14} aria-label="尚未开放" />
        </article>
        <article className="is-locked">
          <span>03</span>
          <div>
            <b>生产投递</b>
            <small>系统链路专用 · 本工具永不开放</small>
          </div>
          <Ban size={14} aria-label="禁止使用" />
        </article>
      </section>

      <div className="callback-preview-workspace">
        <section className="callback-generator-card">
          <header>
            <FileJson2 aria-hidden="true" size={18} />
            <div>
              <b>生成参数</b>
              <p>每次生成新的事件 ID，所有字段均为合成示例。</p>
            </div>
          </header>

          <div className="callback-preview-field">
            <span>接收系统</span>
            <UnifiedSelect
              ariaLabel="选择模拟接收系统"
              value={sourceSystem}
              popupLabel="模拟报文接收系统"
              options={[
                { value: 'ERP', label: 'ERP' },
                { value: 'CRM', label: 'CRM' },
              ]}
              onValueChange={(value) => setSourceSystem(value as SourceSystem)}
            />
            <small>只改变报文中的 sourceSystem，不连接目标系统。</small>
          </div>

          <div className="callback-preview-field">
            <span>事件类型</span>
            <UnifiedSelect
              ariaLabel="选择模拟事件类型"
              value={eventType}
              popupLabel="模拟回调事件"
              options={eventOptions.map((event) => ({
                value: event.value,
                label: event.label,
              }))}
              onValueChange={(value) =>
                setEventType(value as CallbackPreviewEventType)
              }
            />
            <small>{selectedEvent.summary}</small>
          </div>

          <div className="callback-preview-field">
            <span>示例条数</span>
            <UnifiedSelect
              ariaLabel="选择模拟数据条数"
              value={itemCount}
              popupLabel="模拟数据条数"
              options={[
                { value: '1', label: '1 条' },
                { value: '2', label: '2 条' },
                { value: '3', label: '3 条' },
              ]}
              onValueChange={setItemCount}
            />
            <small>限制为 1～3 条，避免被误认为批量业务数据。</small>
          </div>

          <div className="callback-boundary-list">
            <p>
              <Check size={13} /> 不读取任务、影楼或客户表
            </p>
            <p>
              <Check size={13} /> 不读取回调端点和 KMS 密钥
            </p>
            <p>
              <Check size={13} /> 不写 Outbox、不创建投递记录
            </p>
          </div>

          {error ? (
            <div className="callback-preview-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            type="button"
            className="callback-generate-button"
            onClick={() => void generate()}
            disabled={loading}
          >
            <RefreshCw
              aria-hidden="true"
              size={14}
              className={loading ? 'is-spinning' : ''}
            />
            {loading ? '正在生成…' : '生成模拟报文（不发送）'}
          </button>
        </section>

        <section className="callback-output-card" aria-live="polite">
          {preview ? (
            <>
              <header>
                <div>
                  <span>{preview.mode}</span>
                  <b>
                    {
                      eventOptions.find(
                        (item) => item.value === preview.eventType,
                      )?.label
                    }
                  </b>
                  <small>
                    {new Date(preview.generatedAt).toLocaleString('zh-CN', {
                      hour12: false,
                    })}
                  </small>
                </div>
                <strong>
                  <Check size={12} /> 已生成 · 未发送
                </strong>
              </header>

              <dl className="callback-preview-facts">
                <div>
                  <dt>目标地址</dt>
                  <dd>无</dd>
                </div>
                <div>
                  <dt>网络访问</dt>
                  <dd>DISABLED</dd>
                </div>
                <div>
                  <dt>签名模式</dt>
                  <dd>占位值</dd>
                </div>
                <div>
                  <dt>接收系统</dt>
                  <dd>{preview.receiver}</dd>
                </div>
              </dl>

              <section className="callback-code-section">
                <div>
                  <b>请求头预览</b>
                  <button
                    type="button"
                    onClick={() => void copyText('headers', headersText)}
                  >
                    {copied === 'headers' ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copied === 'headers' ? '已复制' : '复制'}
                  </button>
                </div>
                <pre>{headersText}</pre>
              </section>

              <section className="callback-code-section callback-body-section">
                <div>
                  <b>JSON Body</b>
                  <button
                    type="button"
                    onClick={() => void copyText('body', preview.request.body)}
                  >
                    {copied === 'body' ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copied === 'body' ? '已复制' : '复制'}
                  </button>
                </div>
                <pre>{preview.request.body}</pre>
              </section>

              <footer>
                <span>SHA-256</span>
                <code>{preview.request.bodySha256}</code>
              </footer>
            </>
          ) : (
            <div className="callback-preview-empty">
              <span>
                <FileJson2 aria-hidden="true" size={24} />
              </span>
              <b>等待生成安全示例</b>
              <p>
                右侧只展示将来 ERP/CRM
                接收的报文形态，不会显示或调用任何真实回调地址。
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
