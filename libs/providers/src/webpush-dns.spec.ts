import { randomBytes } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVAPIDKeys } from 'web-push';

import { dispatchWebPush } from './webpush.js';

import type { LookupAddress } from 'node:dns';

const dns = vi.hoisted(() => ({
  lookup: vi.fn<() => Promise<LookupAddress[]>>(),
}));
const network = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('node:dns/promises', () => dns);
vi.mock('node:https', () => network);

beforeEach(() => {
  dns.lookup.mockReset();
  network.request.mockReset();
  network.request.mockImplementation(
    (_url: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
      const response = new IncomingMessage(new Socket());
      response.statusCode = 201;

      queueMicrotask(() => {
        callback(response);
        response.push(null);
      });

      return new PassThrough();
    }
  );
});

describe('Web Push public DNS boundary', () => {
  it.each([
    [{ address: '8.8.8.8', family: 4 }],
    [{ address: '2606:4700:4700::1111', family: 6 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  ])('submits encrypted push to a verified public address', async (...addresses) => {
    const sender = generateVAPIDKeys();
    const subscriber = generateVAPIDKeys();

    dns.lookup.mockResolvedValue(addresses);

    const result = await dispatchWebPush({
      deliveryId: '58d9a1a3-170f-4629-922b-122c9880a9de',
      endpoint: {
        kind: 'webpush',
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/subscription',
          keys: {
            p256dh: subscriber.publicKey,
            auth: randomBytes(16).toString('base64url'),
          },
        },
      },
      notification: {
        userId: 'user-123',
        title: 'Shipped',
        body: 'Arriving tomorrow',
        ttlSeconds: 60,
      },
      credentials: {
        webpush: { ...sender, subject: 'mailto:push@example.com' },
      },
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(result.kind).toBe('accepted');
    expect(network.request).toHaveBeenCalledOnce();
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1'])(
    'blocks an allowed hostname resolving to %s',
    async (address) => {
      const sender = generateVAPIDKeys();
      const subscriber = generateVAPIDKeys();
      dns.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);

      const result = await dispatchWebPush({
        deliveryId: '58d9a1a3-170f-4629-922b-122c9880a9de',
        endpoint: {
          kind: 'webpush',
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/subscription',
            keys: {
              p256dh: subscriber.publicKey,
              auth: randomBytes(16).toString('base64url'),
            },
          },
        },
        notification: {
          userId: 'user-123',
          title: 'Shipped',
          body: 'Arriving tomorrow',
          ttlSeconds: 60,
        },
        credentials: {
          webpush: { ...sender, subject: 'mailto:push@example.com' },
        },
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(result).toEqual({
        kind: 'rejected',
        code: 'WEBPUSH_ADDRESS_NOT_ALLOWED',
        invalidateEndpoint: false,
      });
      expect(dns.lookup).toHaveBeenCalledWith('fcm.googleapis.com', {
        all: true,
      });
    }
  );
});
