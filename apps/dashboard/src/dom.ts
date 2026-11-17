export const providerLabels: Record<string, string> = {
  apns: 'APNs',
  fcm: 'FCM',
  webpush: 'Web Push',
};

export const statusLabels: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  provider_accepted: 'Provider accepted',
  retrying: 'Retrying',
  partial: 'Partial result',
  failed: 'Failed',
  expired: 'Expired',
  suppressed: 'Suppressed',
  no_registered_devices: 'No devices',
};

/** Fail during startup if the static page and its controller no longer agree. */
export function requiredElement<T extends Element>(
  selector: string,
  constructor: { new (): T }
): T {
  const element = document.querySelector(selector);

  if (!(element instanceof constructor)) {
    throw new Error(`Missing dashboard element: ${selector}`);
  }

  return element;
}

/** Replace a known page label without interpreting its contents as HTML. */
export function text(selector: string, value: string): void {
  requiredElement(selector, HTMLElement).textContent = value;
}

/** Build a DOM node whose optional content is always plain text. */
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  content?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;

  if (content !== undefined) {
    element.textContent = content;
  }

  return element;
}

/** Keep an actionable boundary error while providing a fallback for unknown values. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

/** Format a server timestamp in the operator's local time zone. */
export function dateLabel(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** Render known status classes while preserving an unfamiliar status as text. */
export function statusBadge(status: string): HTMLSpanElement {
  return node(
    'span',
    `status-badge ${Object.hasOwn(statusLabels, status) ? status : ''}`,
    statusLabels[status] ?? status
  );
}
