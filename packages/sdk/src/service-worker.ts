import { z } from 'zod';

const payloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  image: z.string().optional(),
  url: z.string().optional(),
  notificationId: z.string().optional(),
});

/** Returns an HTTPS notification destination, or the application origin on invalid input. */
export function notificationDestination(value: unknown, origin: string): string {
  if (typeof value !== 'string') return origin;

  try {
    const destination = new URL(value);

    return destination.protocol === 'https:' && !destination.username && !destination.password
      ? destination.href
      : origin;
  } catch {
    return origin;
  }
}

/** Installs push and click handlers in your bundled module service worker. */
export function installPushHandlers(scope: ServiceWorkerGlobalScope): void {
  scope.addEventListener('push', (event) => {
    let input: unknown;

    try {
      input = event.data?.json();
    } catch {
      input = undefined;
    }

    const parsed = payloadSchema.safeParse(input);

    if (!parsed.success) {
      event.waitUntil(
        scope.registration.showNotification('New notification', {
          body: 'Open the app to view the update.',
        })
      );
      return;
    }

    const payload = parsed.data;
    const options = {
      body: payload.body,
      ...(payload.image
        ? {
            image: notificationDestination(payload.image, scope.location.origin),
          }
        : {}),
      data: {
        url: notificationDestination(payload.url, scope.location.origin),
      },
    };

    event.waitUntil(scope.registration.showNotification(payload.title, options));
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data: unknown = event.notification.data;
    const parsed = z.object({ url: z.string() }).safeParse(data);
    const destination = notificationDestination(
      parsed.success ? parsed.data.url : undefined,
      scope.location.origin
    );

    event.waitUntil(scope.clients.openWindow(destination));
  });
}
