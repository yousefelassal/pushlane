import { once } from 'node:events';
import { createServer } from 'node:http2';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeApnsConnections, dispatchApns } from './apns.js';

import type * as Http2 from 'node:http2';

const transport = vi.hoisted<{
  origin: string | null;
  requestedOrigin: string | null;
  connections: Http2.ClientHttp2Session[];
}>(() => ({ origin: null, requestedOrigin: null, connections: [] }));

vi.mock('node:http2', async (importOriginal) => {
  const original = await importOriginal<typeof Http2>();

  return {
    ...original,
    connect: (authority: string | URL) => {
      transport.requestedOrigin = String(authority);

      const session = original.connect(transport.origin ?? authority);

      transport.connections.push(session);

      return session;
    },
  };
});

afterEach(() => {
  closeApnsConnections();

  transport.origin = null;
  transport.requestedOrigin = null;
  transport.connections = [];
});

async function receiver() {
  const server = createServer();
  const sessions: Http2.ServerHttp2Session[] = [];
  const received: Array<{
    headers: Record<string, unknown>;
    payload: unknown;
  }> = [];

  server.on('session', (session) => sessions.push(session));
  server.on('stream', (stream, headers) => {
    let body = '';

    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('end', () => {
      received.push({ headers, payload: JSON.parse(body) });
      stream.respond({ ':status': 200, 'apns-id': 'provider-receipt' });
      stream.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('Expected a listening HTTP/2 port.');

  transport.origin = `http://127.0.0.1:${address.port}`;

  const key = await generateKeyPair('ES256', { extractable: true });
  const privateKey = await exportPKCS8(key.privateKey);
  const expiresAt = new Date(Date.now() + 60_000);
  const request: Parameters<typeof dispatchApns>[0] = {
    deliveryId: '58d9a1a3-170f-4629-922b-122c9880a9de',
    endpoint: { kind: 'apns', token: 'a'.repeat(64), sandbox: true },
    notification: {
      userId: 'user-123',
      title: 'Shipped',
      body: 'Arriving tomorrow',
      image: 'https://example.com/order.jpg',
      url: 'https://example.com/orders/123',
      ttlSeconds: 60,
    },
    credentials: {
      apns: {
        teamId: 'TEAM123',
        keyId: 'KEY123',
        privateKey,
        bundleId: 'com.example.app',
      },
    },
    expiresAt,
  };

  return {
    request,
    received,
    sessions,
    async close() {
      closeApnsConnections();

      for (const session of sessions) session.destroy();

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

describe('APNs HTTP/2 transport', () => {
  it('sends a signed alert with an image and expiry to the selected environment', async () => {
    const fixture = await receiver();

    try {
      const result = await dispatchApns(fixture.request);

      expect(result).toEqual({
        kind: 'accepted',
        providerMessageId: 'provider-receipt',
      });
      expect(transport.requestedOrigin).toBe('https://api.sandbox.push.apple.com');
      expect(fixture.received).toHaveLength(1);
      expect(fixture.received[0]?.headers).toMatchObject({
        ':method': 'POST',
        ':path': `/3/device/${'a'.repeat(64)}`,
        'apns-topic': 'com.example.app',
        'apns-push-type': 'alert',
        'apns-expiration': String(Math.floor(fixture.request.expiresAt.getTime() / 1000)),
      });
      expect(fixture.received[0]?.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(fixture.received[0]?.payload).toEqual({
        aps: {
          alert: { title: 'Shipped', body: 'Arriving tomorrow' },
          sound: 'default',
          'mutable-content': 1,
        },
        notificationId: fixture.request.deliveryId,
        image: 'https://example.com/order.jpg',
        url: 'https://example.com/orders/123',
      });
    } finally {
      await fixture.close();
    }
  });

  it('reuses the connection and signing token across notifications', async () => {
    const fixture = await receiver();

    try {
      expect((await dispatchApns(fixture.request)).kind).toBe('accepted');
      expect(
        (
          await dispatchApns({
            ...fixture.request,
            deliveryId: '68d9a1a3-170f-4629-922b-122c9880a9de',
          })
        ).kind
      ).toBe('accepted');

      expect(transport.connections).toHaveLength(1);
      expect(fixture.received).toHaveLength(2);
      expect(fixture.received[0]?.headers.authorization).toBe(
        fixture.received[1]?.headers.authorization
      );
    } finally {
      await fixture.close();
    }
  });

  it('reconnects after the provider retires a session with GOAWAY', async () => {
    const fixture = await receiver();

    try {
      expect((await dispatchApns(fixture.request)).kind).toBe('accepted');

      const client = transport.connections[0];
      const session = fixture.sessions[0];

      if (!client || !session) throw new Error('Expected a live APNs session.');

      const retired = once(client, 'goaway');

      session.goaway();

      await retired;

      expect((await dispatchApns(fixture.request)).kind).toBe('accepted');
      expect(transport.connections).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it('does not share a connection between distinct credential scopes', async () => {
    const fixture = await receiver();

    try {
      expect((await dispatchApns(fixture.request)).kind).toBe('accepted');

      const apns = fixture.request.credentials.apns;

      if (!apns) throw new Error('Expected APNs credentials.');

      expect(
        (
          await dispatchApns({
            ...fixture.request,
            credentials: { apns: { ...apns, bundleId: 'com.example.other' } },
          })
        ).kind
      ).toBe('accepted');
      expect(transport.connections).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });
});
