import type { z } from 'zod';

/** Connection options shared by the server and installation clients. */
export interface ConnectionOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** An API failure with the HTTP status available for retry decisions. */
export class PushlaneError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'PushlaneError';
  }
}

/** Sends bounded authenticated requests and validates each API response. */
export class HttpClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: ConnectionOptions) {
    this.baseUrl = new URL(options.baseUrl);

    if (
      this.baseUrl.protocol !== 'https:' &&
      !(
        this.baseUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(this.baseUrl.hostname)
      )
    ) {
      throw new Error('Pushlane requires HTTPS except on localhost.');
    }

    if (
      this.baseUrl.username ||
      this.baseUrl.password ||
      this.baseUrl.search ||
      this.baseUrl.hash
    ) {
      throw new Error('The API base URL must not contain credentials, a query, or a fragment.');
    }

    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Parses JSON only after a successful status and never retries a mutation implicitly. */
  async request<Schema extends z.ZodType>(options: {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    token: string;
    schema: Schema;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<z.output<Schema>> {
    const headers = new Headers({
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
    });

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (options.idempotencyKey !== undefined) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    const response = await this.fetcher(new URL(options.path, this.baseUrl), {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });

    if (!response.ok) {
      throw new PushlaneError(`Pushlane returned HTTP ${response.status}.`, response.status);
    }

    const body: unknown = response.status === 204 ? undefined : await response.json();

    return options.schema.parse(body);
  }
}
