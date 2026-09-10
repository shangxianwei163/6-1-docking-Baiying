import type { DataProtector } from './data-protector.js';

export function buildCallItemCorrelationToken(
  protector: Pick<DataProtector, 'correlationHmac'>,
  taskId: string,
  itemId: string,
  phoneHmac: string,
): string {
  return protector.correlationHmac(
    ['outbound-call-item', 'v1', taskId, itemId, phoneHmac].join('\0'),
  );
}
