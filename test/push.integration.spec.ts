import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../apps/api/src/app.module.js';
import { configureApi } from '../apps/api/src/configure.js';
import {
  type Dispatcher,
  type DispatchRequest,
  type DispatchResult,
} from '../libs/contracts/src/index.js';
import { DeliveryWorker } from '../libs/core/src/delivery-worker.js';
import { Projects } from '../libs/core/src/projects.js';
import { SecretCipher } from '../libs/database/src/cipher.js';
import { Database } from '../libs/database/src/database.js';
import { runMigrations } from '../libs/database/src/migrations.js';
import { ProviderDispatcher } from '../libs/providers/src/index.js';

import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

const receiptSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  deliveryCount: z.number(),
});
const logSchema = z.object({
  notification: z.object({
    id: z.uuid(),
    status: z.string(),
    deliveryCount: z.number(),
  }),
  deliveries: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      attemptCount: z.number(),
      lastError: z.string().nullable(),
      attempts: z.array(
        z.object({
          attempt: z.number(),
          result: z.string(),
          code: z.string().nullable(),
        })
      ),
    })
  ),
});

describe('Pushlane over HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: Database;
  let projects: Projects;
  let worker: DeliveryWorker;
  let receiver: Server;
  let receiverUrl: string;
  const received: unknown[] = [];
  const results = new Map<string, DispatchResult[]>();
  const held = new Map<string, { entered: () => void; release: Promise<void> }>();

  function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });

    return { promise, resolve: () => resolve() };
  }

  const dispatcher: Dispatcher = {
    async dispatch(input: DispatchRequest): Promise<DispatchResult> {
      const response = await fetch(receiverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: input.deliveryId,
          notification: input.notification,
          endpoint: input.endpoint,
        }),
      });

      if (!response.ok) throw new Error('Local receiver failed.');

      const hold = held.get(input.notification.userId);

      hold?.entered();

      await hold?.release;

      return (
        results.get(input.notification.userId)?.shift() ?? {
          kind: 'accepted',
          providerMessageId: input.deliveryId,
        }
      );
    },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://pushlane:pushlane@127.0.0.1:54328/pushlane_test';
    process.env.ENCRYPTION_KEY = '01'.repeat(32);

    await runMigrations(process.env.DATABASE_URL);

    receiver = createServer((request, response) => {
      let body = '';

      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        received.push(JSON.parse(body));
        response.writeHead(202).end();
      });
    });

    receiver.listen(0, '127.0.0.1');

    await once(receiver, 'listening');

    const address = receiver.address();

    if (!address || typeof address === 'string')
      throw new Error('Local receiver has no TCP address.');

    receiverUrl = `http://127.0.0.1:${address.port}`;

    await startApplication();
  });

  async function startApplication() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      providers: [DeliveryWorker, { provide: ProviderDispatcher, useValue: dispatcher }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication({ bodyParser: false, logger: false });

    configureApi(app);

    await app.listen(0, '127.0.0.1');

    baseUrl = await app.getUrl();
    db = app.get(Database);
    projects = app.get(Projects);
    worker = app.get(DeliveryWorker);
  }

  afterAll(async () => {
    await app?.close();

    if (receiver)
      await new Promise<void>((resolve, reject) =>
        receiver.close((error) => (error ? reject(error) : resolve()))
      );
  });

  async function project(plan: 'self_hosted' | 'free' = 'self_hosted') {
    return projects.create({
      name: randomUUID(),
      environment: 'development',
      plan,
      credentials: {},
    });
  }

  async function request(
    path: string,
    key: string,
    method = 'GET',
    body?: unknown,
    idempotencyKey?: string
  ) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function register(
    apiKey: string,
    userId: string,
    installationId = randomUUID(),
    tokenValue = randomUUID()
  ) {
    const issued = await request('/v1/registration-tokens', apiKey, 'POST', {
      userId,
      installationId,
    });

    expect(issued.status).toBe(201);

    const { token } = z.object({ token: z.string() }).parse(await issued.json());
    const endpoint = { kind: 'fcm', token: `fcm-${tokenValue}` };
    const response = await request(`/v1/installations/${installationId}`, token, 'PUT', endpoint);

    expect(response.status).toBe(200);

    return { installationId, token, endpoint };
  }

  async function send(
    apiKey: string,
    userId: string,
    key = randomUUID(),
    extra: Record<string, unknown> = {}
  ) {
    const response = await request(
      '/v1/notifications',
      apiKey,
      'POST',
      {
        userId,
        title: 'Order shipped',
        body: 'Your package arrives tomorrow.',
        ...extra,
      },
      key
    );

    expect(response.status).toBe(202);

    return receiptSchema.parse(await response.json());
  }

  async function detail(apiKey: string, id: string) {
    const response = await request(`/v1/notifications/${id}`, apiKey);

    expect(response.status).toBe(200);

    return logSchema.parse(await response.json());
  }

  it('registers multiple devices and sends their payload to a real local receiver', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);
    await register(apiKey, userId);

    const receipt = await send(apiKey, userId, randomUUID(), {
      image: 'https://example.com/image.png',
    });

    expect(receipt.deliveryCount).toBe(2);

    await worker.tick();

    const log = await detail(apiKey, receipt.id);

    expect(log.notification.status).toBe('provider_accepted');
    expect(log.deliveries).toHaveLength(2);
    expect(
      log.deliveries.every(
        (delivery) => delivery.attemptCount === 1 && delivery.attempts[0]?.result === 'accepted'
      )
    ).toBe(true);
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notification: expect.objectContaining({
            userId,
            title: 'Order shipped',
            image: 'https://example.com/image.png',
          }),
        }),
      ])
    );
  });

  it('replays concurrent idempotency requests once and rejects changed payloads', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();
    const key = randomUUID();

    await register(apiKey, userId);

    const receipts = await Promise.all(Array.from({ length: 5 }, () => send(apiKey, userId, key)));

    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);

    const conflict = await request(
      '/v1/notifications',
      apiKey,
      'POST',
      { userId, title: 'Different', body: 'Changed' },
      key
    );

    expect(conflict.status).toBe(409);

    const usage = await request('/v1/project', apiKey);

    expect(
      z.object({ usage: z.object({ reservedDispatches: z.number() }) }).parse(await usage.json())
        .usage.reservedDispatches
    ).toBe(1);
  });

  it('isolates projects and rejects registration tokens on backend routes', async () => {
    const a = await project();
    const b = await project();
    const installation = await register(a.apiKey, 'same-user');
    const receipt = await send(a.apiKey, 'same-user');

    expect((await request(`/v1/notifications/${receipt.id}`, b.apiKey)).status).toBe(404);
    expect((await send(b.apiKey, 'same-user')).status).toBe('no_registered_devices');
    expect((await request('/v1/notifications', installation.token)).status).toBe(401);
    expect(
      (
        await request(
          `/v1/installations/${randomUUID()}`,
          installation.token,
          'PUT',
          installation.endpoint
        )
      ).status
    ).toBe(401);
  });

  it('suppresses queued messages after logout and rejects token resurrection', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();
    const installation = await register(apiKey, userId);
    const receipt = await send(apiKey, userId);

    expect(
      (
        await request(
          `/v1/installations/${installation.installationId}`,
          installation.token,
          'DELETE'
        )
      ).status
    ).toBe(204);
    expect(
      (
        await request(
          `/v1/installations/${installation.installationId}`,
          installation.token,
          'DELETE'
        )
      ).status
    ).toBe(204);
    expect(
      (
        await request(
          `/v1/installations/${installation.installationId}`,
          installation.token,
          'PUT',
          installation.endpoint
        )
      ).status
    ).toBe(401);

    await worker.tick();

    expect((await detail(apiKey, receipt.id)).notification.status).toBe('suppressed');
  });

  it('prevents stale logout from revoking a new account binding', async () => {
    const { apiKey } = await project();
    const old = await register(apiKey, 'alice');
    const oldReceipt = await send(apiKey, 'alice');

    await register(apiKey, 'bob', old.installationId);

    expect(
      (await request(`/v1/installations/${old.installationId}`, old.token, 'DELETE')).status
    ).toBe(204);

    const newReceipt = await send(apiKey, 'bob');

    await worker.tick();

    expect((await detail(apiKey, oldReceipt.id)).notification.status).toBe('suppressed');
    expect((await detail(apiKey, newReceipt.id)).notification.status).toBe('provider_accepted');
  });

  it('retries transient failures without reserving another dispatch', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    results.set(userId, [{ kind: 'retry', code: 'unavailable', retryAfterSeconds: 1 }]);

    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);

    await worker.tick();

    const first = await detail(apiKey, receipt.id);

    expect(first.deliveries[0]?.status).toBe('retrying');

    await db.execute(
      "UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE notification_id = $1",
      [receipt.id]
    );
    await worker.tick();

    const final = await detail(apiKey, receipt.id);

    expect(final.notification.status).toBe('provider_accepted');
    expect(final.deliveries[0]?.attempts.map((attempt) => attempt.result)).toEqual([
      'retry',
      'accepted',
    ]);

    const usage = z
      .object({ usage: z.object({ reservedDispatches: z.number() }) })
      .parse(await (await request('/v1/project', apiKey)).json());

    expect(usage.usage.reservedDispatches).toBe(1);
  });

  it('reclaims abandoned leases and records uncertainty before retrying', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);

    await db.execute(
      "UPDATE deliveries SET status = 'processing', attempt_count = 1, lease_token = $2, lease_expires_at = now() - interval '1 second' WHERE notification_id = $1",
      [receipt.id, randomUUID()]
    );
    await worker.tick();

    const log = await detail(apiKey, receipt.id);

    expect(log.notification.status).toBe('provider_accepted');
    expect(log.deliveries[0]?.attempts.map((attempt) => attempt.code)).toEqual([
      'worker_lease_expired',
      null,
    ]);
  });

  it('allows two worker instances to claim each delivery once', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);
    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);
    const secondWorker = new DeliveryWorker(
      db,
      app.get(SecretCipher),
      Object.assign(new ProviderDispatcher(), dispatcher)
    );

    await Promise.all([worker.tick(), secondWorker.tick()]);

    const log = await detail(apiKey, receipt.id);

    expect(log.deliveries.every((delivery) => delivery.attemptCount === 1)).toBe(true);
    expect(log.notification.status).toBe('provider_accepted');
  });

  it('expires queued notifications without contacting a provider', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);

    await db.execute(
      "UPDATE notifications SET expires_at = now() - interval '1 second' WHERE id = $1",
      [receipt.id]
    );
    await worker.tick();

    expect((await detail(apiKey, receipt.id)).notification.status).toBe('expired');
    expect(
      received.filter(
        (value) =>
          z.object({ notification: z.object({ userId: z.string() }) }).parse(value).notification
            .userId === userId
      )
    ).toHaveLength(0);
  });

  it('retires an explicitly invalid endpoint', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    results.set(userId, [{ kind: 'rejected', code: 'unregistered', invalidateEndpoint: true }]);

    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);

    await worker.tick();

    expect((await detail(apiKey, receipt.id)).notification.status).toBe('failed');
    expect((await send(apiKey, userId)).status).toBe('no_registered_devices');
  });

  it('enforces cloud allowance atomically and preserves accepted retries', async () => {
    const { apiKey, projectId } = await project('free');
    const userId = randomUUID();

    await register(apiKey, userId);
    await db.execute(
      "INSERT INTO monthly_usage (project_id, month, reserved_dispatches) VALUES ($1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 9999)",
      [projectId]
    );

    const key = randomUUID();
    const receipt = await send(apiKey, userId, key);

    expect((await send(apiKey, userId, key)).id).toBe(receipt.id);
    expect(
      (
        await request(
          '/v1/notifications',
          apiKey,
          'POST',
          { userId, title: 'Over quota', body: 'Blocked' },
          randomUUID()
        )
      ).status
    ).toBe(429);
  });

  it('keeps credentials and endpoints encrypted in database records and out of logs', async () => {
    const { apiKey, projectId } = await project();
    const installation = await register(apiKey, randomUUID());
    const [stored] = await db.rows(
      z.object({ endpoint_ciphertext: z.string() }),
      'SELECT endpoint_ciphertext FROM installations WHERE project_id = $1 AND id = $2',
      [projectId, installation.installationId]
    );

    expect(stored?.endpoint_ciphertext).not.toContain(installation.endpoint.token);

    const response = await request('/v1/project', apiKey);
    const publicConfig = await response.text();

    expect(publicConfig).not.toContain(apiKey);
    expect(publicConfig).not.toContain('credentials_ciphertext');
  });

  it('rejects invalid requests and provides stable pagination', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    expect(
      (
        await request(
          '/v1/notifications',
          apiKey,
          'POST',
          {
            userId,
            title: 'Invalid',
            body: 'Body',
            image: 'http://127.0.0.1/private',
          },
          randomUUID()
        )
      ).status
    ).toBe(400);
    expect((await request('/v1/notifications?before=bad', apiKey)).status).toBe(400);

    const receipts = await Promise.all(Array.from({ length: 3 }, () => send(apiKey, userId)));
    const pageSchema = z.object({
      items: z.array(z.object({ id: z.uuid() })),
      nextCursor: z.string().nullable(),
    });
    const first = pageSchema.parse(
      await (await request('/v1/notifications?limit=2', apiKey)).json()
    );
    const second = pageSchema.parse(
      await (
        await request(
          `/v1/notifications?limit=2&before=${encodeURIComponent(first.nextCursor ?? '')}`,
          apiKey
        )
      ).json()
    );

    expect([...first.items, ...second.items].map((item) => item.id).sort()).toEqual(
      receipts.map((receipt) => receipt.id).sort()
    );
  });

  it('revokes a displaced session when an endpoint moves between installations', async () => {
    const { apiKey } = await project();
    const endpointId = randomUUID();
    const alice = await register(apiKey, 'alice', randomUUID(), endpointId);

    await register(apiKey, 'bob', randomUUID(), endpointId);

    expect(
      (
        await request(
          `/v1/installations/${alice.installationId}`,
          alice.token,
          'PUT',
          alice.endpoint
        )
      ).status
    ).toBe(401);
    expect((await send(apiKey, 'alice')).deliveryCount).toBe(0);
    expect((await send(apiKey, 'bob')).deliveryCount).toBe(1);
  });

  it('treats APNs tokens with different letter casing as the same endpoint', async () => {
    const { apiKey } = await project();
    const alice = await register(apiKey, 'alice');
    const bob = await register(apiKey, 'bob');
    const token = 'ab'.repeat(32);

    expect(
      (
        await request(`/v1/installations/${alice.installationId}`, alice.token, 'PUT', {
          kind: 'apns',
          token,
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(`/v1/installations/${bob.installationId}`, bob.token, 'PUT', {
          kind: 'apns',
          token: token.toUpperCase(),
        })
      ).status
    ).toBe(200);
    expect((await send(apiKey, 'alice')).deliveryCount).toBe(0);
    expect((await send(apiKey, 'bob')).deliveryCount).toBe(1);
  });

  it('preserves replacement endpoint credentials when an old in-flight attempt rejects', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();
    const installation = await register(apiKey, userId);
    const endpoint = { kind: 'apns', token: 'cd'.repeat(32), sandbox: false };

    expect(
      (
        await request(
          `/v1/installations/${installation.installationId}`,
          installation.token,
          'PUT',
          endpoint
        )
      ).status
    ).toBe(200);

    results.set(userId, [{ kind: 'rejected', code: 'unregistered', invalidateEndpoint: true }]);

    const entered = deferred();
    const release = deferred();

    held.set(userId, { entered: entered.resolve, release: release.promise });

    await send(apiKey, userId);

    const processing = worker.tick();

    await entered.promise;

    try {
      expect(
        (
          await request(
            `/v1/installations/${installation.installationId}`,
            installation.token,
            'PUT',
            { ...endpoint, sandbox: true }
          )
        ).status
      ).toBe(200);
    } finally {
      release.resolve();
    }

    await processing;

    held.delete(userId);

    expect((await send(apiKey, userId)).deliveryCount).toBe(1);
  });

  it('allows logout after registration-token expiry and after client restart', async () => {
    const { apiKey } = await project();
    const installation = await register(apiKey, 'alice');

    await db.execute(
      "UPDATE installation_sessions SET expires_at = now() - interval '1 second' WHERE installation_id = $1",
      [installation.installationId]
    );

    expect(
      (
        await request(
          `/v1/installations/${installation.installationId}`,
          installation.token,
          'DELETE'
        )
      ).status
    ).toBe(204);

    await register(apiKey, 'alice', installation.installationId);

    const minted = await request('/v1/registration-tokens', apiKey, 'POST', {
      userId: 'alice',
      installationId: installation.installationId,
    });
    const fresh = z.object({ token: z.string() }).parse(await minted.json());

    expect(
      (await request(`/v1/installations/${installation.installationId}`, fresh.token, 'DELETE'))
        .status
    ).toBe(204);
    expect((await send(apiKey, 'alice')).deliveryCount).toBe(0);
  });

  it('honors long provider backoff and wakes no later than notification expiry', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);

    results.set(userId, [{ kind: 'retry', code: 'rate_limited', retryAfterSeconds: 7200 }]);

    const receipt = await send(apiKey, userId, randomUUID(), {
      ttlSeconds: 60,
    });

    await worker.tick();

    const [scheduled] = await db.rows(
      z.object({ at_expiry: z.boolean() }),
      'SELECT d.next_attempt_at = n.expires_at AS at_expiry FROM deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.id = $1',
      [receipt.id]
    );

    expect(scheduled?.at_expiry).toBe(true);
  });

  it('applies completed log retention by plan without deleting self-hosted history', async () => {
    const free = await project('free');
    const selfHosted = await project();
    const freeReceipt = await send(free.apiKey, randomUUID());
    const selfReceipt = await send(selfHosted.apiKey, randomUUID());

    await db.execute(
      "UPDATE notifications SET created_at = now() - interval '8 days' WHERE id = ANY($1::uuid[])",
      [[freeReceipt.id, selfReceipt.id]]
    );
    await worker.cleanup();

    expect((await request(`/v1/notifications/${freeReceipt.id}`, free.apiKey)).status).toBe(404);
    expect((await detail(selfHosted.apiKey, selfReceipt.id)).notification.id).toBe(selfReceipt.id);
  });

  it('retains notifications across API restart and dispatches persisted work', async () => {
    const { apiKey } = await project();
    const userId = randomUUID();

    await register(apiKey, userId);

    const receipt = await send(apiKey, userId);
    await app.close();
    await startApplication();
    await worker.tick();

    expect((await detail(apiKey, receipt.id)).notification.status).toBe('provider_accepted');
  });
});
