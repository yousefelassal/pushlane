import { z } from 'zod';

import { HttpClient } from './http.js';

import type { ConnectionOptions } from './http.js';

export { PushlaneError } from './http.js';

const storageKey = 'pushlane.installation-id';

/** Browser push setup. Obtain registration tokens from your authenticated backend. */
export interface BrowserPushOptions extends ConnectionOptions {
  applicationServerKey: string;
  serviceWorkerUrl?: string;
  serviceWorkerScope?: string;
  getRegistrationToken: (installationId: string) => Promise<string>;
}

/** Returns an origin-local installation ID without requesting notification permission. */
export function getInstallationId(storage: Storage = localStorage): string {
  const existing = storage.getItem(storageKey);

  if (existing && z.uuid().safeParse(existing).success) {
    return existing;
  }

  const installationId = crypto.randomUUID();
  storage.setItem(storageKey, installationId);

  return installationId;
}

/** Registers a browser subscription and revokes its identity binding on logout. */
export class BrowserPush {
  private readonly http: HttpClient;
  private token: string | undefined;
  private lifecycle: Promise<void> = Promise.resolve();

  constructor(private readonly options: BrowserPushOptions) {
    this.http = new HttpClient(options);
  }

  /** Call from a user gesture. This is the only operation that asks for permission. */
  register(): Promise<{ installationId: string }> {
    return this.serialize(() => this.registerInstallation());
  }

  private async registerInstallation(): Promise<{ installationId: string }> {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in globalThis) ||
      !('Notification' in globalThis)
    ) {
      throw new Error('This browser does not support Web Push.');
    }

    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;

    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted.');
    }

    const installationId = getInstallationId();
    const registration = await navigator.serviceWorker.register(
      this.options.serviceWorkerUrl ?? '/pushlane-sw.js',
      { scope: this.options.serviceWorkerScope ?? '/' }
    );

    await waitForActiveWorker(registration);

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(this.options.applicationServerKey),
      }));
    const token = await this.options.getRegistrationToken(installationId);
    const serialized = subscription.toJSON();

    await this.http.request({
      path: `/v1/installations/${installationId}`,
      method: 'PUT',
      token,
      body: {
        kind: 'webpush',
        subscription: { endpoint: serialized.endpoint, keys: serialized.keys },
      },
      schema: z.unknown(),
    });

    this.token = token;

    return { installationId };
  }

  /** Revokes only this session. Shared browser subscriptions remain available to other tabs. */
  unregister(registrationToken?: string): Promise<void> {
    return this.serialize(async () => {
      const installationId = getInstallationId();
      const token = registrationToken ?? this.token;

      if (!token) {
        throw new Error('An installation registration token is required.');
      }

      await this.http.request({
        path: `/v1/installations/${installationId}`,
        method: 'DELETE',
        token,
        schema: z.unknown(),
      });

      if (this.token === token) this.token = undefined;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation);

    this.lifecycle = result.then(
      () => undefined,
      () => undefined
    );

    return result;
  }
}

/** Converts an unpadded URL-safe VAPID public key to its binary representation. */
function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));

  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

/** Waits on this registration, including scopes that do not control the current page. */
function waitForActiveWorker(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();

  const worker = registration.installing ?? registration.waiting;

  if (!worker) return Promise.reject(new Error('The service worker did not activate.'));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('The service worker activation timed out.')),
      15_000
    );

    function finish(error?: Error): void {
      clearTimeout(timeout);
      worker?.removeEventListener('statechange', checkState);

      if (error) reject(error);
      else resolve();
    }

    function checkState(): void {
      if (worker?.state === 'activated') finish();
      else if (worker?.state === 'redundant')
        finish(new Error('The service worker installation failed.'));
    }

    worker.addEventListener('statechange', checkState);
    checkState();
  });
}
