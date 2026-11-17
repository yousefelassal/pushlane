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

/** Keeps an actionable boundary error while providing a fallback for unknown values. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

/** Formats a server timestamp in the operator's local time zone. */
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

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}
