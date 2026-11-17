import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Pushlane, PushlaneError } from './server.js';
import { notificationDestination } from './service-worker.js';

const requests: Array<{
  url: string;
  authorization: string | undefined;
  key: string | undefined;
  body: unknown;
}> = [];

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  const key = request.headers['idempotency-key'];

  requests.push({
    url: request.url ?? '',
    authorization: request.headers.authorization,
    key: typeof key === 'string' ? key : undefined,
    body,
  });
  response.setHeader('Content-Type', 'application/json');

  if (key === 'conflict') {
    response.writeHead(409).end(JSON.stringify({ message: 'Conflict' }));
    return;
  }

  if (request.url === '/v1/registration-tokens') {
    response.end(
      JSON.stringify({
        token: 'installation-session',
        expiresAt: '2026-11-17T23:00:00.000Z',
      })
    );
    return;
  }

  response.writeHead(202).end(
    JSON.stringify({
      id: 'notification-1',
      status: 'queued',
      deliveryCount: 2,
    })
  );
});

let client: Pushlane;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');

  client = new Pushlane({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: 'server-secret',
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe('server client', () => {
  it('sends content, backend credentials, and idempotency without transforming the user ID', async () => {
    const input = {
      userId: 'tenant/user-1',
      title: 'Shipped',
      body: 'Arrives tomorrow',
      image: 'https://example.com/image.jpg',
    };

    expect(await client.send(input, { idempotencyKey: 'order-123' })).toEqual({
      id: 'notification-1',
      status: 'queued',
      deliveryCount: 2,
    });
    expect(requests.at(-1)).toEqual({
      url: '/v1/notifications',
      authorization: 'Bearer server-secret',
      key: 'order-123',
      body: input,
    });
  });

  it('issues a session scoped to the authenticated user and installation', async () => {
    const input = {
      userId: 'user-1',
      installationId: '0b629250-bc86-431c-93ac-27f066ea0cfe',
    };

    expect((await client.createRegistrationToken(input)).token).toBe('installation-session');
    expect(requests.at(-1)?.body).toEqual(input);
  });

  it('exposes conflicts without retrying a send', async () => {
    const before = requests.length;

    await expect(
      client.send(
        { userId: 'user-1', title: 'Title', body: 'Body' },
        { idempotencyKey: 'conflict' }
      )
    ).rejects.toMatchObject({ name: 'PushlaneError', status: 409 });
    expect(requests.length).toBe(before + 1);
    expect(new PushlaneError('Conflict', 409)).toBeInstanceOf(Error);
  });

  it('rejects remote plaintext API connections', () => {
    expect(() => new Pushlane({ baseUrl: 'http://api.example.com', apiKey: 'secret' })).toThrow(
      'HTTPS'
    );
  });
});

describe('notification navigation', () => {
  it('preserves HTTPS destinations and rejects executable or credential-bearing URLs', () => {
    const origin = 'https://app.example.com';

    expect(notificationDestination('https://app.example.com/orders/123', origin)).toBe(
      'https://app.example.com/orders/123'
    );
    expect(notificationDestination('javascript:alert(1)', origin)).toBe(origin);
    expect(notificationDestination('https://user:password@example.com', origin)).toBe(origin);
    expect(notificationDestination(undefined, origin)).toBe(origin);
  });
});
