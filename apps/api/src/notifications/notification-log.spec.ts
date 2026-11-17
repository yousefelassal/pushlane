import { describe, expect, it } from 'vitest';

import { summarize } from './notification-log.js';

describe('notification status summary', () => {
  it.each([
    [0, {}, 'no_registered_devices'],
    [2, { queued: 2 }, 'queued'],
    [2, { queued: 1, provider_accepted: 1 }, 'processing'],
    [2, { retrying: 1, failed: 1 }, 'processing'],
    [2, { provider_accepted: 2 }, 'provider_accepted'],
    [2, { failed: 2 }, 'failed'],
    [1, { expired: 1 }, 'expired'],
    [1, { suppressed: 1 }, 'suppressed'],
    [2, { provider_accepted: 1, failed: 1 }, 'partial'],
  ] as const)('reports %i deliveries with %o as %s', (deliveryCount, counts, status) => {
    expect(summarize(deliveryCount, counts)).toBe(status);
  });
});
