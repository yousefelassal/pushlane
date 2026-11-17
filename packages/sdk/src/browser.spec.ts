import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserPush } from './browser.js';

afterEach(() => vi.unstubAllGlobals());

describe('browser installation lifecycle', () => {
  it('requests permission only during registration and revokes without removing a shared subscription', async () => {
    const events: string[] = [];
    const requests: Array<{
      method: string | undefined;
      body: unknown;
      authorization: string | null;
    }> = [];
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/example',
        expirationTime: null,
        keys: { p256dh: 'public-key', auth: 'auth-key' },
      }),
      unsubscribe: async () => {
        events.push('unsubscribe');
        return true;
      },
    };
    const registration = {
      active: {},
      pushManager: { getSubscription: async () => subscription },
    };
    const requestPermission = vi.fn(async () => 'granted');
    const stored = new Map<string, string>();

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    vi.stubGlobal('PushManager', {});
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: async () => registration,
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
      },
    });

    const fetcher: typeof fetch = async (_url, init) => {
      events.push(init?.method ?? 'GET');
      requests.push({
        method: init?.method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        authorization: new Headers(init?.headers).get('Authorization'),
      });

      return new Response(null, { status: 204 });
    };
    const getRegistrationToken = vi.fn(async () => 'scoped-installation-token');
    const client = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'test-key',
      getRegistrationToken,
      fetch: fetcher,
    });

    expect(requestPermission).not.toHaveBeenCalled();

    const result = await client.register();

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getRegistrationToken).toHaveBeenCalledWith(result.installationId);
    expect(requests[0]).toEqual({
      method: 'PUT',
      authorization: 'Bearer scoped-installation-token',
      body: {
        kind: 'webpush',
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/example',
          keys: { p256dh: 'public-key', auth: 'auth-key' },
        },
      },
    });

    await client.unregister();

    expect(events).toEqual(['PUT', 'DELETE']);
  });

  it('keeps the browser subscription when server revocation fails', async () => {
    const unsubscribe = vi.fn(async () => true);

    vi.stubGlobal('localStorage', {
      getItem: () => '0b629250-bc86-431c-93ac-27f066ea0cfe',
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => ({ unsubscribe }) },
        }),
      },
    });

    const client = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'test-key',
      getRegistrationToken: async () => 'token',
      fetch: async () => new Response(null, { status: 503 }),
    });

    await expect(client.unregister('token')).rejects.toMatchObject({
      status: 503,
    });
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('does not mint a token during logout after a client reload', async () => {
    const getRegistrationToken = vi.fn(async () => 'new-token');
    const fetcher = vi.fn<typeof fetch>();

    vi.stubGlobal('localStorage', {
      getItem: () => '0b629250-bc86-431c-93ac-27f066ea0cfe',
    });

    const client = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'key',
      getRegistrationToken,
      fetch: fetcher,
    });

    await expect(client.unregister()).rejects.toThrow(
      'An installation registration token is required.'
    );
    expect(getRegistrationToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stale client logout leaves the newer account browser subscription intact', async () => {
    const unsubscribe = vi.fn(async () => true);
    stubBrowser(unsubscribe);

    const authorizations: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      authorizations.push(`${init?.method} ${new Headers(init?.headers).get('Authorization')}`);
      return new Response(null, { status: 204 });
    };
    const oldClient = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'key',
      getRegistrationToken: async () => 'old-session',
      fetch: fetcher,
    });
    const currentClient = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'key',
      getRegistrationToken: async () => 'current-session',
      fetch: fetcher,
    });

    await oldClient.register();
    await currentClient.register();
    await oldClient.unregister();

    expect(authorizations).toEqual([
      'PUT Bearer old-session',
      'PUT Bearer current-session',
      'DELETE Bearer old-session',
    ]);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('keeps the current token when explicitly revoking an older session', async () => {
    stubBrowser(vi.fn(async () => true));

    const authorizations: Array<string | null> = [];
    const client = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'key',
      getRegistrationToken: async () => 'current-session',
      fetch: async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return new Response(null, { status: 204 });
      },
    });

    await client.register();
    await client.unregister('old-session');
    await client.unregister();

    expect(authorizations).toEqual([
      'Bearer current-session',
      'Bearer old-session',
      'Bearer current-session',
    ]);
  });

  it('serializes overlapping registrations and logout without retaining an old token', async () => {
    stubBrowser(vi.fn(async () => true));

    const firstResponse = deferred();
    const requests: string[] = [];
    let issued = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(`${init?.method} ${new Headers(init?.headers).get('Authorization')}`);

      if (requests.length === 1) await firstResponse.promise;

      return new Response(null, { status: 204 });
    };
    const client = new BrowserPush({
      baseUrl: 'https://push.example.com',
      applicationServerKey: 'key',
      getRegistrationToken: async () => `session-${++issued}`,
      fetch: fetcher,
    });
    const first = client.register();

    await vi.waitFor(() => expect(requests).toEqual(['PUT Bearer session-1']));

    const second = client.register();
    const logout = client.unregister();

    await Promise.resolve();

    expect(requests).toEqual(['PUT Bearer session-1']);

    firstResponse.resolve();

    await Promise.all([first, second, logout]);

    expect(requests).toEqual([
      'PUT Bearer session-1',
      'PUT Bearer session-2',
      'DELETE Bearer session-2',
    ]);
  });
});

function stubBrowser(unsubscribe: () => Promise<boolean>): void {
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/shared',
      keys: { p256dh: 'public-key', auth: 'auth-key' },
    }),
    unsubscribe,
  };
  const registration = {
    active: {},
    pushManager: { getSubscription: async () => subscription },
  };

  vi.stubGlobal('localStorage', {
    getItem: () => '0b629250-bc86-431c-93ac-27f066ea0cfe',
  });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('PushManager', {});
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: async () => registration,
      getRegistration: async () => registration,
    },
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let complete = () => {};
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });

  return { promise, resolve: () => complete() };
}
