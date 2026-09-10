import { describe, expect, it } from 'vitest';
import { OperatorSessionService } from './operator-session.js';

function createService(
  clock: () => Date = () => new Date('2026-09-08T00:00:00Z'),
) {
  return new OperatorSessionService({
    username: 'fc6j1',
    password: 'fc6j18888',
    displayName: '平台管理员',
    organization: '华东运营中心',
    secret: 'operator-session-test-secret-long-enough',
    ttlSeconds: 60,
    clock,
  });
}

describe('operator session service', () => {
  it('authenticates the configured administrator and verifies a signed token', () => {
    const service = createService();
    const identity = service.authenticate('fc6j1', 'fc6j18888');

    expect(identity).toEqual({
      username: 'fc6j1',
      displayName: '平台管理员',
      organization: '华东运营中心',
    });
    expect(service.verify(service.issue(identity!))).toEqual(identity);
  });

  it('rejects invalid credentials, tampered tokens, and expired sessions', () => {
    let now = new Date('2026-09-08T00:00:00Z');
    const service = createService(() => now);
    const identity = service.authenticate('fc6j1', 'fc6j18888')!;
    const token = service.issue(identity);

    expect(service.authenticate('fc6j1', 'wrong-password')).toBeNull();
    expect(service.authenticate('wrong-user', 'fc6j18888')).toBeNull();
    expect(service.verify(`${token}tampered`)).toBeNull();
    expect(service.verify('not-a-session-token')).toBeNull();
    expect(service.verify(`${token}.unexpected`)).toBeNull();

    now = new Date('2026-09-08T00:01:01Z');
    expect(service.verify(token)).toBeNull();
  });

  it('issues independent concurrent sessions without invalidating earlier logins', () => {
    const service = createService();
    const identity = service.authenticate('fc6j1', 'fc6j18888')!;
    const firstSession = service.issue(identity);
    const secondSession = service.issue(identity);

    expect(firstSession).not.toBe(secondSession);
    expect(service.verify(firstSession)).toEqual(identity);
    expect(service.verify(secondSession)).toEqual(identity);
  });

  it('rejects a token issued for a different configured administrator', () => {
    const firstService = createService();
    const identity = firstService.authenticate('fc6j1', 'fc6j18888')!;
    const token = firstService.issue(identity);
    const renamedService = new OperatorSessionService({
      username: 'replacement-admin',
      password: 'replacement-password',
      displayName: '替代管理员',
      organization: '华北运营中心',
      secret: 'operator-session-test-secret-long-enough',
      clock: () => new Date('2026-09-08T00:00:00Z'),
    });

    expect(renamedService.verify(token)).toBeNull();
  });
});
