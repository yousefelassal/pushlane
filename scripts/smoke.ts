import 'reflect-metadata';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { chromium, expect } from '@playwright/test';
import { z } from 'zod';

import { ProjectsService } from '../apps/api/src/projects/projects.service.js';
import { CliModule } from './cli.module.js';

import type { ChildProcess } from 'node:child_process';

/** Waits for a real HTTP state with a bounded deadline and a useful failure. */
async function eventually(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;

    await setTimeout(100);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = once(child, 'exit');

  child.kill('SIGTERM');

  await exited;
}

/** Reserves an ephemeral local port for a child process. */
async function freePort(): Promise<number> {
  const probe = createServer();

  probe.listen(0, '127.0.0.1');

  await once(probe, 'listening');

  const address = probe.address();

  assert(address && typeof address !== 'string');

  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );

  return address.port;
}

/** Runs a build step to completion and surfaces its output only on failure. */
async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';

  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const [code] = (await once(child, 'exit')) as [number | null];

  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${output}`);
}

const port = await freePort();
const dashboardPort = await freePort();

const context = await NestFactory.createApplicationContext(CliModule, {
  logger: false,
});
const project = await context.get(ProjectsService).create({
  name: 'Local verification',
  environment: 'development',
  plan: 'self_hosted',
  credentials: {},
});

await context.close();

const baseUrl = `http://127.0.0.1:${port}`;
const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;

await run('pnpm', ['--filter', '@pushlane/dashboard', 'build'], {
  ...process.env,
  VITE_API_BASE_URL: baseUrl,
});

const childEnvironment = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  WORKER_INTERVAL_MS: '100',
  CORS_ORIGINS: dashboardUrl,
};
const api = spawn(process.execPath, ['dist/apps/api/src/main.js'], {
  env: childEnvironment,
  stdio: ['ignore', 'ignore', 'pipe'],
});
const worker = spawn(process.execPath, ['dist/apps/worker/src/main.js'], {
  env: childEnvironment,
  stdio: ['ignore', 'ignore', 'pipe'],
});
const dashboard = spawn(
  'pnpm',
  [
    '--filter',
    '@pushlane/dashboard',
    'exec',
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(dashboardPort),
  ],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'ignore', 'pipe'] }
);
let diagnostics = '';

for (const child of [api, worker, dashboard]) {
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
}

async function request(path: string, method = 'GET', body?: unknown, key = project.apiKey) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

try {
  await eventually(async () => (await fetch(`${baseUrl}/health`)).ok, 'the compiled API');
  await eventually(async () => (await fetch(dashboardUrl)).ok, 'the dashboard on Workers assets');

  const installationId = randomUUID();
  const userId = `smoke-${randomUUID()}`;
  const tokenResponse = await request('/v1/registration-tokens', 'POST', {
    userId,
    installationId,
  });
  const { token } = z.object({ token: z.string() }).parse(await tokenResponse.json());
  const registration = await request(
    `/v1/installations/${installationId}`,
    'PUT',
    { kind: 'fcm', token: `smoke-${randomUUID()}` },
    token
  );

  assert.equal(registration.status, 200);

  const sent = await request('/v1/notifications', 'POST', {
    userId,
    title: 'Live local check',
    body: 'Compiled API, database, worker, and dashboard.',
  });
  const receipt = z.object({ id: z.uuid(), deliveryCount: z.number() }).parse(await sent.json());

  assert.equal(sent.status, 202);
  assert.equal(receipt.deliveryCount, 1);

  await eventually(async () => {
    const response = await request(`/v1/notifications/${receipt.id}`);
    const log = z
      .object({
        notification: z.object({ status: z.string() }),
        deliveries: z.array(z.object({ lastError: z.string().nullable() })),
      })
      .parse(await response.json());

    return (
      log.notification.status === 'failed' && log.deliveries[0]?.lastError === 'FCM_NOT_CONFIGURED'
    );
  }, 'the compiled worker to record the missing provider configuration');

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(dashboardUrl);
    await page.getByLabel('Project API key').fill(project.apiKey);
    await page.getByRole('button', { name: 'Connect project' }).click();
    await expect(
      page.getByRole('region', { name: 'Project overview' }).getByText('Local verification')
    ).toBeVisible();
    await expect(page.getByText('Live local check', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect Live local check' }).click();
    await expect(page.getByRole('dialog')).toContainText('FCM_NOT_CONFIGURED');
    await page.getByRole('button', { name: 'Close notification details' }).click();
    await page.getByRole('button', { name: 'Send notification', exact: false }).first().click();
    await page.getByRole('dialog').getByLabel('User ID').fill('no-registered-device');
    await page.getByRole('dialog').getByLabel('Title').fill('Sent from the dashboard');
    await page
      .getByRole('dialog')
      .getByLabel('Body')
      .fill('The live API accepts this dashboard request.');
    await page.getByRole('dialog').getByRole('button', { name: 'Send notification' }).click();
    await expect(page.getByText('Sent from the dashboard', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true
    );
    assert.deepEqual(errors, []);

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByLabel('Project API key')).toHaveValue('');
  } finally {
    await browser.close();
  }

  process.stdout.write(
    'Verified compiled API, PostgreSQL persistence, worker failure logs, and the Workers-served dashboard connection, inspection, sending, mobile layout, and disconnect.\n'
  );
} catch (error) {
  if (diagnostics) process.stderr.write(diagnostics);

  throw error;
} finally {
  await stop(dashboard);
  await stop(worker);
  await stop(api);
}
