import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve) => listener.close(resolve));

const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: appDirectory, stdio: 'pipe' }
);
const base = `http://127.0.0.1:${port}`;
let browser;

try {
  let ready = false;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/`);

      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The preview process has not bound its port yet.
    }

    await setTimeout(100);
  }

  assert(ready, 'The built dashboard starts.');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const project = {
    id: 'project-test',
    name: 'Browser test',
    environment: 'development',
    plan: 'self_hosted',
    providers: ['webpush'],
    webPushPublicKey: null,
    usage: {
      month: '2026-11',
      reservedDispatches: 1,
      limit: null,
      remaining: null,
    },
    logRetentionDays: null,
  };
  const notification = {
    id: 'notification-test',
    userId: 'user_123',
    title: '<img src=x onerror=alert(1)>',
    body: 'Browser smoke notification',
    createdAt: '2026-11-17T12:00:00.000Z',
    status: 'provider_accepted',
    deliveryCount: 1,
    counts: { provider_accepted: 1 },
  };
  const queries = [];
  const sends = [];

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.headers().authorization, 'Bearer browser-test-key');

    if (url.pathname === '/v1/project') {
      await route.fulfill({ json: project });
    } else if (url.pathname === '/v1/notifications' && request.method() === 'GET') {
      queries.push(url.searchParams);
      await route.fulfill({
        json: { items: [notification], nextCursor: null },
      });
    } else if (url.pathname === '/v1/notifications/notification-test') {
      await route.fulfill({
        json: {
          notification,
          deliveries: [
            {
              id: 'delivery-test',
              installationId: 'installation-test',
              provider: 'webpush',
              status: 'provider_accepted',
              attemptCount: 1,
              createdAt: notification.createdAt,
              updatedAt: notification.createdAt,
              lastError: null,
              providerMessageId: 'provider-test',
              attempts: [
                {
                  attempt: 1,
                  startedAt: notification.createdAt,
                  finishedAt: notification.createdAt,
                  result: 'accepted',
                  code: null,
                },
              ],
            },
          ],
        },
      });
    } else if (url.pathname === '/v1/notifications' && request.method() === 'POST') {
      sends.push({
        body: request.postDataJSON(),
        key: request.headers()['idempotency-key'],
      });

      if (sends.length === 1) {
        await route.fulfill({
          status: 503,
          json: { message: 'Please retry this request.' },
        });
      } else {
        await route.fulfill({
          status: 202,
          json: { id: 'new-notification', status: 'queued', deliveryCount: 1 },
        });
      }
    } else {
      await route.fulfill({
        status: 404,
        json: { message: 'Unexpected route.' },
      });
    }
  });

  await page.goto(`${base}/`);
  assert(
    await page.getByRole('heading', { name: 'Your next notification starts here.' }).isVisible()
  );
  await page.getByLabel('Project API key').fill('browser-test-key');
  await page.getByRole('button', { name: 'Connect project' }).click();
  await page.getByText(notification.title, { exact: true }).waitFor();
  assert.equal(
    await page.locator('#notification-rows img').count(),
    0,
    'Notification titles remain text.'
  );
  assert.equal(
    await page.getByLabel('Project API key').inputValue(),
    '',
    'The credential input clears after connecting.'
  );
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
    'The dashboard does not persist credentials.'
  );

  await page.getByRole('button', { name: `Inspect ${notification.title}` }).click();
  await page.getByText('Attempt 1 · accepted', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close notification details' }).click();

  await page.getByRole('searchbox', { name: 'Filter by exact user ID' }).fill('another-user');
  await page.getByRole('button', { name: 'Apply filter' }).click();
  await page.getByText('1 notification loaded for another-user', { exact: true }).waitFor();
  assert.equal(queries.at(-1).get('userId'), 'another-user');

  await page.locator('#send-button').click();
  await page.getByLabel('User ID', { exact: true }).fill('user_123');
  await page.getByLabel('Title', { exact: true }).fill('Order shipped');
  await page.getByLabel('Body', { exact: true }).fill('Arrives tomorrow.');
  await page.locator('#submit-send').click();
  await page.getByText('Please retry this request.', { exact: true }).waitFor();
  await page.locator('#submit-send').click();
  await page
    .getByText('Notification new-notification was queued for 1 installation.', {
      exact: true,
    })
    .waitFor();
  assert.equal(sends.length, 2);
  assert.equal(
    sends[0].key,
    sends[1].key,
    'Retrying an uncertain send preserves its idempotency key.'
  );
  assert.deepEqual(sends[1].body, {
    userId: 'user_123',
    title: 'Order shipped',
    body: 'Arrives tomorrow.',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'The connected mobile page does not overflow.'
  );

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert(
    await page.getByRole('heading', { name: 'Your next notification starts here.' }).isVisible()
  );
  assert.equal(await page.locator('#notification-rows tr').count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'The disconnected mobile page does not overflow.'
  );
  assert.deepEqual(errors, [], 'No browser exceptions occur.');
  process.stdout.write(
    'PASS dashboard connection, safe logs, details, filtering, send retry, disconnect, and mobile layout.\n'
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
}
