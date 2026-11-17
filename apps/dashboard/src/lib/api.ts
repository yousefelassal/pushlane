import { z } from 'zod';

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment: z.string(),
  plan: z.string(),
  providers: z.array(z.string()),
  webPushPublicKey: z.string().nullable(),
  usage: z.object({
    month: z.string(),
    reservedDispatches: z.number(),
    limit: z.number().nullable(),
    remaining: z.number().nullable(),
  }),
  logRetentionDays: z.number().nullable(),
});

const notificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  body: z.string(),
  image: z.string().nullish(),
  url: z.string().nullish(),
  createdAt: z.string(),
  status: z.string(),
  deliveryCount: z.number(),
  counts: z.record(z.string(), z.number()),
});

export const listSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});

export const detailSchema = z.object({
  notification: notificationSchema,
  deliveries: z.array(
    z.object({
      id: z.string(),
      installationId: z.string(),
      provider: z.enum(['apns', 'fcm', 'webpush']),
      status: z.string(),
      attemptCount: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
      lastError: z.string().nullable(),
      providerMessageId: z.string().nullable(),
      attempts: z.array(
        z.object({
          attempt: z.number(),
          startedAt: z.string(),
          finishedAt: z.string(),
          result: z.string(),
          code: z.string().nullable(),
        })
      ),
    })
  ),
});

export const receiptSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'no_registered_devices']),
  deliveryCount: z.number(),
});

const errorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type NotificationLog = z.infer<typeof notificationSchema>;
export type NotificationDetail = z.infer<typeof detailSchema>;
export type Receipt = z.infer<typeof receiptSchema>;

const apiBase = readApiBase();

/** Read a deployment override while keeping all requests on the chosen API origin. */
function readApiBase(): string {
  const value: unknown = import.meta.env.VITE_API_BASE_URL;

  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('VITE_API_BASE_URL must be an HTTPS origin or a local HTTP origin.');
  }

  return url.origin;
}

/** Validate every API response before it enters page state. */
export async function request<T>(options: {
  path: string;
  apiKey: string;
  schema: z.ZodType<T>;
  method?: string;
  body?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const headers = new Headers({ Authorization: `Bearer ${options.apiKey}` });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const response = await fetch(`${apiBase}${options.path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
    signal: options.signal,
    credentials: 'omit',
    cache: 'no-store',
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    const message = parsed.success ? parsed.data.message : undefined;

    throw new Error(
      Array.isArray(message)
        ? message.join(' ')
        : (message ?? `Request failed with HTTP ${response.status}.`)
    );
  }

  const parsed = options.schema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(
      'The API returned an unexpected response. Check that the dashboard and API versions match.'
    );
  }

  return parsed.data;
}
