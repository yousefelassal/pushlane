import type { DeliveryStatus } from '../../../../libs/contracts/src/index.js';
import type { Notification } from '../../../../libs/database/src/entities/index.js';

export type StatusCounts = Partial<Record<DeliveryStatus, number>>;

export type NotificationStatus = DeliveryStatus | 'no_registered_devices' | 'partial';

/** Statuses where every delivery agrees, so the notification shares the same summary. */
const unanimous: readonly DeliveryStatus[] = [
  'provider_accepted',
  'failed',
  'expired',
  'suppressed',
];

/**
 * Summarizes delivery states into one notification status.
 *
 * Provider acceptance is never reported as device receipt. Mixed final outcomes are `partial`.
 */
export function summarize(deliveryCount: number, counts: StatusCounts): NotificationStatus {
  const count = (status: DeliveryStatus) => counts[status] ?? 0;

  if (deliveryCount === 0) return 'no_registered_devices';

  if (count('queued') === deliveryCount) return 'queued';

  if (count('queued') + count('processing') + count('retrying') > 0) return 'processing';

  return unanimous.find((status) => count(status) === deliveryCount) ?? 'partial';
}

/** The public log entry for one notification. */
export function logEntry(notification: Notification, counts: StatusCounts) {
  return {
    id: notification.id,
    ...notification.payload,
    createdAt: notification.createdAt.toISOString(),
    status: summarize(notification.deliveryCount, counts),
    deliveryCount: notification.deliveryCount,
    counts,
  };
}
