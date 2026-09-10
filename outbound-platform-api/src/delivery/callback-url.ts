export class CallbackTargetValidationError extends Error {
  constructor(message = '回调目标不是有效的 HTTP 或 HTTPS URL') {
    super(message);
    this.name = 'CallbackTargetValidationError';
  }
}

export function parseCallbackTargetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CallbackTargetValidationError('回调目标不是有效 URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    rawUrl.length > 2_048
  ) {
    throw new CallbackTargetValidationError(
      '回调目标必须是无凭证、无查询串、无片段的 HTTP 或 HTTPS 地址',
    );
  }
  return url;
}
