import { dateLabel, errorMessage, plural, providerLabels, statusLabels } from '@/lib/format';
import { notificationQuery } from '@/lib/queries';
import { useConnectedSession } from '@/lib/session';
import { useQuery } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';

import { Alert, AlertDescription } from '@pushlane/ui/components/alert';
import { Button } from '@pushlane/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pushlane/ui/components/dialog';
import { Skeleton } from '@pushlane/ui/components/skeleton';

import { StatusBadge } from './status-badge';

import type { NotificationDetail } from '@/lib/api';

/** Per-installation deliveries and provider attempts for one notification. */
export function NotificationDetailDialog({
  notificationId,
  onClose,
}: {
  notificationId: string | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog open={notificationId !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              NOTIFICATION DETAILS
            </p>
            <DialogTitle>Delivery activity</DialogTitle>
            <DialogDescription className="sr-only">
              Each installation this notification targeted and its provider attempts.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Close notification details" />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        {notificationId !== undefined && <DetailContent notificationId={notificationId} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailContent({ notificationId }: { notificationId: string }) {
  const session = useConnectedSession();
  const detail = useQuery(notificationQuery(session, notificationId));

  if (detail.isPending) {
    return (
      <div aria-label="Loading delivery activity" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (detail.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(detail.error)}</AlertDescription>
      </Alert>
    );
  }

  return <DetailBody detail={detail.data} />;
}

function DetailBody({ detail: { notification, deliveries } }: { detail: NotificationDetail }) {
  const metadata = [
    ['Notification', notification.id],
    ['User', notification.userId],
    ['Created', dateLabel(notification.createdAt)],
    ['Status', statusLabels[notification.status] ?? notification.status],
    ...(notification.image ? [['Image URL', notification.image]] : []),
    ...(notification.url ? [['Click destination', notification.url]] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-medium break-words">{notification.title}</h3>
        <p className="whitespace-pre-wrap break-words">{notification.body}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {metadata.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <h3 className="font-medium">
        {plural(deliveries.length, 'installation delivery', 'installation deliveries')}
      </h3>

      {deliveries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This user had no active installations when the notification was accepted.
        </p>
      )}

      {deliveries.map((delivery) => (
        <section key={delivery.id} className="flex flex-col gap-2 rounded-2xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <strong>{providerLabels[delivery.provider] ?? delivery.provider}</strong>
            <StatusBadge status={delivery.status} />
          </div>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {delivery.installationId}
          </p>
          {delivery.lastError && (
            <p className="font-mono text-sm break-all text-destructive">{delivery.lastError}</p>
          )}
          {delivery.providerMessageId && (
            <p className="font-mono text-xs break-all text-muted-foreground">
              Provider message {delivery.providerMessageId}
            </p>
          )}
          <ol className="flex flex-col gap-1 text-sm">
            {delivery.attempts.map((attempt) => (
              <li key={attempt.attempt} className="flex flex-wrap justify-between gap-2">
                <span>
                  {`Attempt ${attempt.attempt} · ${attempt.result}${attempt.code ? ` · ${attempt.code}` : ''}`}
                </span>
                <time dateTime={attempt.startedAt} className="text-muted-foreground">
                  {dateLabel(attempt.startedAt)}
                </time>
              </li>
            ))}
            {delivery.attempts.length === 0 && <li>No provider attempt has been recorded.</li>}
          </ol>
        </section>
      ))}
    </div>
  );
}
