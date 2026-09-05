'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';

const callbackPath = '/api/v1/callbacks/baiying/call-instance';
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const callbackUrl = `${apiBaseUrl}${callbackPath}`;

const topLevelParameters = [
  ['code', 'number', '是', '百应响应码'],
  ['data', 'object', '是', '响应数据'],
  ['data.data', 'object', '是', '本次通话的回调内容'],
  ['data.callbackType', 'string', '是', '固定为 CALL_INSTANCE_RESULT'],
  ['resultMsg', 'string', '是', '响应内容'],
];

const callInstanceParameters = [
  ['callJobId', 'number', 'AI 外呼任务 ID'], ['callInstanceId', 'number', '通话记录 ID'], ['callInstanceStatus', 'number', '固定值 2，表示已完成'],
  ['finishStatus', 'number', '通话结果状态，0 已接听；1 拒接；2 无法接通；3 外呼失败；4 空号；5 关机；6 占线；7 停机；8 未接；9 主叫欠费；10 呼损；11 黑名单；12 天盾拦截；22 线路盲区；23 呼出拦截；25 无可用线路'],
  ['customerTelephone', 'string', '客户联系方式'], ['customerName', 'string', '客户名称'], ['robotDefId', 'number', '话术 ID'], ['robotDefName', 'string', '话术名称'],
  ['startTime', 'string', '未接通时为开始拨打时间；已接通时为客户接通时间'], ['endTime', 'string', '通话结束且话后处理完成的时间'], ['duration', 'number', '通话时长，单位：秒'],
  ['luyinOssUrl', 'string', '完整录音地址，包含 AI 与被叫声音'], ['userLuyinOssUrl', 'string', '仅被叫侧录音地址'], ['calledTimes', 'number', '已拨打次数'],
  ['chatRound', 'number', '有效通话轮次'], ['hangUp', 'number', '挂机人：0 AI，1 用户'], ['perceptionResult', 'string', '感知结果：有感知或无感知'],
  ['collectProperties', 'object', '数据采集变量'], ['properties', 'object', '话术变量、自定义参数及转人工信息'], ['transferred', 'boolean', '是否发生转接'], ['lineIn', 'boolean', '是否进线'], ['takeover', 'boolean', '是否人工接管'],
];

const collectionParameters = [
  ['phoneLogs[]', '通话对话日志', 'speaker、content、startTime、endTime、decisionName、answerStatus 等'],
  ['taskResult[]', '通话结果', 'resultName、resultValue、resultDesc、resultLabels'],
  ['callRepeat[]', '多次拨打记录', 'repeatIndex、finishStatus、startTime、endTime、callerPhone、userPhoneId、sipErrorCode 等'],
  ['jobPhoneInfos[]', '任务线路信息', 'lineName、callerAccountId、userPhoneId'],
];

const requestExample = `{
  "code": 200,
  "data": {
    "data": {
      "jobPhoneInfos": [{
        "lineName": "华东主线路",
        "callerAccountId": 12345,
        "userPhoneId": 45678
      }],
      "callInstance": {
        "callJobId": 4849944,
        "callInstanceId": 70258002706,
        "callInstanceStatus": 2,
        "finishStatus": 0,
        "customerTelephone": "136****0000",
        "robotDefId": 286485,
        "robotDefName": "百天邀约",
        "startTime": "2026-09-05 10:18:20",
        "endTime": "2026-09-05 10:18:44",
        "duration": 24,
        "luyinOssUrl": "https://example.com/full.mp3",
        "userLuyinOssUrl": "https://example.com/user.mp3",
        "properties": {
          "originalWorkflowId": "38028",
          "callStartTime": "2026-09-05 10:18:14"
        }
      },
      "phoneLogs": [],
      "taskResult": [],
      "callRepeat": []
    },
    "callbackType": "CALL_INSTANCE_RESULT"
  },
  "resultMsg": "成功"
}`;

const responseExample = `{
  "code": 200
}`;

function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button type="button" className="api-copy-button" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : label}</button>;
}

function ParameterTable({ rows, collection = false }: { rows: string[][]; collection?: boolean }) {
  return <div className="api-parameter-table"><table><thead><tr><th>参数名</th><th>{collection ? '内容' : '类型'}</th><th>{collection ? '主要字段' : '必传'}</th>{collection ? null : <th>说明</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`}><code>{index === 0 ? cell : ''}</code>{index === 0 ? null : cell}</td>)}</tr>)}</tbody></table></div>;
}

export function ApiDocumentation({ publicView = false }: { publicView?: boolean }) {
  const shareUrl = typeof window === 'undefined' ? '/api-docs/call-instance' : `${window.location.origin}/api-docs/call-instance`;
  return <div className={publicView ? 'api-docs-page api-docs-public' : 'api-docs-page'}>
    <header className="api-docs-header">
      <div><span>{publicView ? 'PUBLIC API DOCUMENTATION' : 'API INTEGRATION'}</span><h2>API 接口文档</h2><p>百应通话完成回调的接入地址、字段协议、返回要求与联调说明。</p></div>
      <CopyButton value={shareUrl} label="复制公开链接" />
    </header>
    <div className="api-docs-workspace">
      <aside className="api-catalog" aria-label="接口目录">
        <header><span>接口目录</span><small>1 个接口</small></header>
        <div className="api-catalog-list">
          <button type="button" className="api-catalog-card is-active"><span><b>POST</b><i>百应回调</i></span><strong>AI 外呼完成回调</strong><code>{callbackPath}</code><small>接收通话结果、录音地址和通话日志</small></button>
        </div>
      </aside>
      <article className="api-reference">
        <section className="api-reference-hero"><div><span className="api-method">POST</span><span className="api-state">已开放</span><h1>AI 外呼完成回调</h1><p>百应在通话状态变为“已完成”后推送本接口。需要重播的通话会在重播完成后回调。</p></div><a href="https://open.byai.com/v2/event-callbacks/call-instance.html" target="_blank" rel="noreferrer">百应原始文档 <ExternalLink size={12} /></a></section>

        <section className="api-reference-section"><h3>请求地址</h3><div className="api-endpoint"><span>POST</span><code>{callbackUrl}</code><CopyButton value={callbackUrl} /></div><div className="api-callouts"><p><b>Content-Type</b><code>application/json;charset=utf-8</code></p><p><b>认证</b><span>百应文档未要求请求签名；生产环境应在网关放行官方回调 IP</span></p><p><b>来源 IP</b><code>120.55.46.3、42.192.127.32/27</code></p></div></section>

        <section className="api-reference-section"><h3>请求参数</h3><p className="api-section-lead">顶层包裹字段为必传；通话、日志、结果及重拨信息按实际通话情况返回。</p><ParameterTable rows={topLevelParameters} /></section>
        <section className="api-reference-section"><h3>callInstance 通话信息</h3><ParameterTable rows={callInstanceParameters.map(([name, type, description]) => [`data.data.callInstance.${name}`, type, '否', description])} /></section>
        <section className="api-reference-section"><h3>集合字段</h3><ParameterTable rows={collectionParameters} collection /></section>

        <section className="api-reference-section"><div className="api-section-title"><h3>请求示例</h3><CopyButton value={requestExample} /></div><pre className="api-code-block"><code>{requestExample}</code></pre></section>
        <section className="api-reference-section"><div className="api-section-title"><h3>成功响应</h3><CopyButton value={responseExample} /></div><p className="api-section-lead">必须返回文本 <code>success</code>，或返回以下 JSON。当前接口采用 JSON 响应。</p><pre className="api-code-block api-code-short"><code>{responseExample}</code></pre></section>

        <section className="api-reference-section"><h3>处理规则</h3><div className="api-rule-grid"><article><b>幂等键</b><p>建议以 <code>callInstanceId</code> 作为通话回调幂等标识，避免重试造成重复处理。</p></article><article><b>录音归档</b><p><code>luyinOssUrl</code> 为完整录音，<code>userLuyinOssUrl</code> 仅含被叫声音；应及时下载归档。</p></article><article><b>开始拨打时间</b><p>已接通取 <code>properties.callStartTime</code>；未接通取 <code>startTime</code>。</p></article><article><b>计费分钟</b><p>每条通话分别按 <code>ceil(data.data.callInstance.duration / 60)</code> 计算后汇总；1–59 秒均计 1 分钟，0 秒计 0 分钟。</p></article></div></section>
        <section className="api-reference-section"><h3>失败重试</h3><p className="api-section-lead">未返回规定成功内容时，百应最多重试 15 次，共尝试 16 次。</p><div className="api-retry-list">{['10 秒','30 秒','1 分钟','2 分钟','3 分钟','5 分钟','6 分钟','7 分钟','8 分钟','9 分钟','10 分钟','20 分钟','30 分钟','1 小时','2 小时'].map((interval, index) => <span key={interval + index}><b>{index + 1}</b>{interval}</span>)}</div></section>
      </article>
    </div>
    {publicView ? <footer className="api-public-footer"><Share2 size={13} />此公开链接仅展示本接口文档，不包含运营后台入口或业务数据。</footer> : null}
  </div>;
}
