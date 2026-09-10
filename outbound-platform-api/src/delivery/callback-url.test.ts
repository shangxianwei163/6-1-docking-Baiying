import { describe, expect, it } from 'vitest';
import { parseCallbackTargetUrl } from './callback-url.js';

describe('parseCallbackTargetUrl', () => {
  it.each([
    'http://testmc.6161520.cn:8083/SAi/Sx_AI_CallResult',
    'https://erp.example.com/callback',
    'https://erp.example.com:8443/callback',
  ])('accepts a fixed HTTP or HTTPS callback URL: %s', (value) => {
    expect(parseCallbackTargetUrl(value).toString()).toBe(value);
  });

  it.each([
    'ftp://erp.example.com/callback',
    'http://user:secret@erp.example.com/callback',
    'http://erp.example.com/callback?token=secret',
    'https://erp.example.com/callback#fragment',
  ])('rejects an unsafe callback target: %s', (value) => {
    expect(() => parseCallbackTargetUrl(value)).toThrow('HTTP 或 HTTPS');
  });
});
