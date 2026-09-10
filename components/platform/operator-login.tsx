'use client';

import { useState, type ComponentProps } from 'react';
import {
  ArrowRight,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  loginOperator,
  PlatformApiError,
  type OperatorSession,
} from '@/lib/platform-api';

export function OperatorLogin({
  environmentLabel,
  onAuthenticated,
}: {
  environmentLabel: string;
  onAuthenticated: (session: OperatorSession) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit: ComponentProps<'form'>['onSubmit'] = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await loginOperator(username.trim(), password));
    } catch (caught) {
      setError(
        caught instanceof PlatformApiError
          ? caught.message
          : '登录失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="operator-login-page">
      <section className="operator-login-brand" aria-label="平台介绍">
        <div className="operator-login-brand-copy">
          <p className="operator-login-kicker">
            <span /> INTELLIGENT OUTBOUND
          </p>
          <h1>
            <span>图形AI</span>
            <span>外呼调度平台</span>
          </h1>
          <p>
            将 ERP、CRM
            与百应外呼编排收束在同一个运营工作台，统一管理任务、计费和回传链路。
          </p>
        </div>
        <div className="operator-login-trust">
          <article>
            <ShieldCheck aria-hidden="true" size={18} />
            <div>
              <b>安全会话</b>
              <small>凭据仅提交至平台服务端</small>
            </div>
          </article>
          <article>
            <KeyRound aria-hidden="true" size={18} />
            <div>
              <b>操作留痕</b>
              <small>关键变更写入审计日志</small>
            </div>
          </article>
        </div>
        <p className="operator-login-environment">
          <span /> {environmentLabel} · Asia/Shanghai
        </p>
      </section>

      <section className="operator-login-access">
        <form className="operator-login-card" onSubmit={submit}>
          <header>
            <span className="operator-login-mark">
              <LockKeyhole aria-hidden="true" size={20} />
            </span>
            <div>
              <small>OPERATIONS CONSOLE</small>
              <h2>登录运营后台</h2>
              <p>请输入管理员账号和密码继续。</p>
            </div>
          </header>

          <label className="operator-login-field">
            <span>管理员账号</span>
            <div>
              <UserRound aria-hidden="true" size={16} />
              <input
                autoComplete="username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入账号"
                required
              />
            </div>
          </label>

          <label className="operator-login-field">
            <span>登录密码</span>
            <div>
              <LockKeyhole aria-hidden="true" size={16} />
              <input
                autoComplete="current-password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
              />
            </div>
          </label>

          {error ? (
            <p className="operator-login-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="operator-login-submit"
            disabled={submitting}
            type="submit"
          >
            {submitting ? '正在验证…' : '登录'}
            {!submitting ? <ArrowRight aria-hidden="true" size={16} /> : null}
          </button>

          <p className="operator-login-footnote">
            登录即代表本次操作将关联当前管理员身份并记录审计信息。
          </p>
        </form>
      </section>
    </main>
  );
}

export function OperatorLoginLoading() {
  return (
    <main className="operator-login-page is-loading" aria-busy="true">
      <div className="operator-login-loading">
        <span />
        <b>正在验证登录状态</b>
        <p>图形AI外呼调度平台</p>
      </div>
    </main>
  );
}
