import 'reflect-metadata';

import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../apps/api/src/app.module.js';
import { PAYMOB_CONFIGURATION } from '../apps/api/src/billing/billing.service.js';
import { transactionHmacMessage } from '../apps/api/src/billing/paymob.js';
import { configureApi } from '../apps/api/src/configure.js';
import { ProjectsService } from '../apps/api/src/projects/projects.service.js';
import { RetentionModule } from '../apps/worker/src/retention/retention.module.js';
import { RetentionService } from '../apps/worker/src/retention/retention.service.js';
import { dataSourceOptions } from '../libs/database/src/data-source.js';

import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { PaymobConfiguration, TransactionCallback } from '../apps/api/src/billing/paymob.js';

const HMAC_SECRET = 'test-hmac-secret';
const MONTH_MS = 28 * 86_400_000;

const sessionSchema = z.object({ paymentId: z.uuid(), checkoutUrl: z.url() });
const projectSchema = z.object({ plan: z.string(), planExpiresAt: z.iso.datetime().nullable() });
const intentionSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  payment_methods: z.array(z.number()),
  special_reference: z.string(),
  notification_url: z.string(),
  redirection_url: z.string(),
  billing_data: z.object({ phone_number: z.string(), email: z.string() }),
});

describe('Paymob billing over HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let baseUrl: string;
  let projects: ProjectsService;
  let retention: RetentionService;
  let db: DataSource;
  let paymob: Server;
  const intentions: Array<{ authorization?: string; body: unknown }> = [];

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://pushlane:pushlane@127.0.0.1:54328/pushlane_test';
    process.env.ENCRYPTION_KEY = '01'.repeat(32);

    const migrator = await new DataSource(dataSourceOptions(process.env.DATABASE_URL)).initialize();

    await migrator.dropDatabase();
    await migrator.runMigrations();
    await migrator.destroy();

    paymob = createServer((request, response) => {
      let body = '';

      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        intentions.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
        response.writeHead(201, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            id: 'pi_test',
            client_secret: `csk_test_${intentions.length}`,
            intention_order_id: 1000 + intentions.length,
          })
        );
      });
    });

    paymob.listen(0, '127.0.0.1');

    await once(paymob, 'listening');

    const address = paymob.address();

    if (!address || typeof address === 'string') throw new Error('Fake Paymob has no address.');

    const config: PaymobConfiguration = {
      PAYMOB_BASE_URL: `http://127.0.0.1:${address.port}`,
      PAYMOB_SECRET_KEY: 'sk_test_secret',
      PAYMOB_PUBLIC_KEY: 'pk_test_public',
      PAYMOB_HMAC_SECRET: HMAC_SECRET,
      PAYMOB_INTEGRATION_IDS: [4569876],
      PAYMOB_CURRENCY: 'EGP',
      PAYMOB_PRO_MONTH_AMOUNT_CENTS: 50_000,
      PUBLIC_API_URL: 'https://api.pushlane.test',
      BILLING_RETURN_URL: 'https://app.pushlane.test/billing',
    };
    const module = await Test.createTestingModule({ imports: [AppModule, RetentionModule] })
      .overrideProvider(PAYMOB_CONFIGURATION)
      .useValue(config)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication({ bodyParser: false, logger: false });

    configureApi(app);

    await app.listen(0, '127.0.0.1');

    baseUrl = await app.getUrl();
    projects = app.get(ProjectsService);
    retention = app.get(RetentionService);
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();

    if (paymob)
      await new Promise<void>((resolve, reject) =>
        paymob.close((error) => (error ? reject(error) : resolve()))
      );
  });

  const customer = {
    firstName: 'Mona',
    lastName: 'Adel',
    email: 'mona@example.com',
    phone: '+201234567890',
  };

  async function project(plan: 'free' | 'self_hosted' = 'free') {
    return projects.create({
      name: randomUUID(),
      environment: 'production',
      plan,
      credentials: {},
    });
  }

  async function checkout(apiKey: string, body: unknown = { customer }) {
    return fetch(`${baseUrl}/v1/billing/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function describeProject(apiKey: string) {
    const response = await fetch(`${baseUrl}/v1/project`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return projectSchema.parse(await response.json());
  }

  async function paidCheckout(apiKey: string) {
    const response = await checkout(apiKey);

    expect(response.status).toBe(201);

    return { ...sessionSchema.parse(await response.json()), orderId: 1000 + intentions.length };
  }

  function transaction(
    orderId: number,
    overrides: Partial<TransactionCallback['obj']> = {}
  ): TransactionCallback {
    return {
      type: 'TRANSACTION',
      obj: {
        amount_cents: 50_000,
        created_at: '2026-11-17T18:39:44.719228',
        currency: 'EGP',
        error_occured: false,
        has_parent_transaction: false,
        id: Math.floor(Math.random() * 1e9),
        integration_id: 4569876,
        is_3d_secure: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: {
          id: orderId,
          merchant_order_id: randomUUID(),
        } as TransactionCallback['obj']['order'],
        owner: 4705,
        pending: false,
        source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
        success: true,
        ...overrides,
      },
    };
  }

  async function deliver(callback: TransactionCallback, hmac?: string) {
    const signature =
      hmac ??
      createHmac('sha512', HMAC_SECRET).update(transactionHmacMessage(callback.obj)).digest('hex');

    return fetch(`${baseUrl}/v1/billing/paymob/callback?hmac=${signature}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callback),
    });
  }

  it('prices the checkout on the server and correlates it by payment ID', async () => {
    const { apiKey } = await project();
    const session = await paidCheckout(apiKey);
    const intention = intentions.at(-1);
    const body = intentionSchema.parse(intention?.body);
    const url = new URL(session.checkoutUrl);

    expect(intention?.authorization).toBe('Token sk_test_secret');
    expect(body).toMatchObject({
      amount: 50_000,
      currency: 'EGP',
      payment_methods: [4569876],
      special_reference: session.paymentId,
      notification_url: 'https://api.pushlane.test/v1/billing/paymob/callback',
      redirection_url: 'https://app.pushlane.test/billing',
      billing_data: { phone_number: '+201234567890', email: 'mona@example.com' },
    });
    expect(url.pathname).toBe('/unifiedcheckout/');
    expect(url.searchParams.get('publicKey')).toBe('pk_test_public');
    expect(url.searchParams.get('clientSecret')).toBe(`csk_test_${intentions.length}`);
    expect(await describeProject(apiKey)).toEqual({ plan: 'free', planExpiresAt: null });
  });

  it('rejects checkouts without a contact or for plans that cannot be bought', async () => {
    const free = await project();
    const selfHosted = await project('self_hosted');

    expect((await checkout(free.apiKey, { customer: { ...customer, phone: '' } })).status).toBe(
      400
    );
    expect((await checkout(free.apiKey, { customer, amount: 1 })).status).toBe(400);
    expect((await checkout(selfHosted.apiKey)).status).toBe(409);
  });

  it('upgrades to Pro for one month only on a signed, settled, correctly priced callback', async () => {
    const { apiKey } = await project();
    const { orderId } = await paidCheckout(apiKey);

    expect((await deliver(transaction(orderId), '0'.repeat(128))).status).toBe(401);
    expect((await deliver(transaction(orderId, { success: false }))).status).toBe(200);
    expect((await deliver(transaction(orderId, { pending: true }))).status).toBe(200);
    expect((await deliver(transaction(orderId, { amount_cents: 100 }))).status).toBe(200);
    expect((await deliver(transaction(orderId, { currency: 'USD' }))).status).toBe(200);
    expect(await describeProject(apiKey)).toEqual({ plan: 'free', planExpiresAt: null });

    const startedAt = Date.now();

    expect((await deliver(transaction(orderId))).status).toBe(200);

    const upgraded = await describeProject(apiKey);
    const expiresAt = Date.parse(upgraded.planExpiresAt ?? '');

    expect(upgraded.plan).toBe('pro');
    expect(expiresAt - startedAt).toBeGreaterThan(MONTH_MS);
    expect(expiresAt - startedAt).toBeLessThan(32 * 86_400_000);
  });

  it('extends once per payment, however often or concurrently Paymob retries', async () => {
    const { apiKey } = await project();
    const first = await paidCheckout(apiKey);
    const firstCallback = transaction(first.orderId);

    const replies = await Promise.all(Array.from({ length: 5 }, () => deliver(firstCallback)));

    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200, 200]);

    const once = await describeProject(apiKey);

    expect((await deliver(firstCallback)).status).toBe(200);
    expect(await describeProject(apiKey)).toEqual(once);

    const second = await paidCheckout(apiKey);

    await deliver(transaction(second.orderId));

    const renewed = await describeProject(apiKey);
    const added = Date.parse(renewed.planExpiresAt ?? '') - Date.parse(once.planExpiresAt ?? '');

    expect(renewed.plan).toBe('pro');
    expect(added).toBeGreaterThan(MONTH_MS);
  });

  it('accepts callbacks larger than the general request limit', async () => {
    const { apiKey } = await project();
    const { orderId } = await paidCheckout(apiKey);
    const callback = transaction(orderId);
    const padded = { ...callback, obj: { ...callback.obj, data: { message: 'x'.repeat(20_000) } } };
    const signature = createHmac('sha512', HMAC_SECRET)
      .update(transactionHmacMessage(callback.obj))
      .digest('hex');
    const response = await fetch(`${baseUrl}/v1/billing/paymob/callback?hmac=${signature}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(padded),
    });

    expect(response.status).toBe(200);
    expect((await describeProject(apiKey)).plan).toBe('pro');
  });

  it('credits only the payment whose signed Paymob order the callback names', async () => {
    const payer = await project();
    const other = await project();
    const paid = await paidCheckout(payer.apiKey);
    const pending = await paidCheckout(other.apiKey);
    const callback = transaction(paid.orderId);

    callback.obj.order = {
      ...callback.obj.order,
      merchant_order_id: pending.paymentId,
    } as TransactionCallback['obj']['order'];

    expect((await deliver(callback)).status).toBe(200);
    expect((await describeProject(payer.apiKey)).plan).toBe('pro');
    expect((await describeProject(other.apiKey)).plan).toBe('free');
    expect((await deliver(transaction(9_999_999))).status).toBe(200);
  });

  it('leaves the payment pending when the plan changed to one that cannot be bought', async () => {
    const selfHosted = await project();
    const permanent = await project();
    const first = await paidCheckout(selfHosted.apiKey);
    const second = await paidCheckout(permanent.apiKey);

    await db.query(`UPDATE projects SET plan = 'self_hosted' WHERE id = $1`, [
      selfHosted.projectId,
    ]);
    await db.query(`UPDATE projects SET plan = 'pro' WHERE id = $1`, [permanent.projectId]);

    expect((await deliver(transaction(first.orderId))).status).toBe(200);
    expect((await deliver(transaction(second.orderId))).status).toBe(200);
    expect(await describeProject(selfHosted.apiKey)).toEqual({
      plan: 'self_hosted',
      planExpiresAt: null,
    });
    expect(await describeProject(permanent.apiKey)).toEqual({ plan: 'pro', planExpiresAt: null });
    expect(
      await db.query(`SELECT status FROM payments WHERE id IN ($1, $2)`, [
        first.paymentId,
        second.paymentId,
      ])
    ).toEqual([{ status: 'pending' }, { status: 'pending' }]);
  });

  it('returns a lapsed Pro project to the free plan', async () => {
    const { apiKey, projectId } = await project();
    const { orderId } = await paidCheckout(apiKey);

    await deliver(transaction(orderId));
    await retention.expireLapsedPlans();

    expect((await describeProject(apiKey)).plan).toBe('pro');

    await db.query(
      `UPDATE projects SET plan_expires_at = now() - interval '1 second' WHERE id = $1`,
      [projectId]
    );
    await retention.cleanup();

    expect(await describeProject(apiKey)).toEqual({ plan: 'free', planExpiresAt: null });
  });
});
