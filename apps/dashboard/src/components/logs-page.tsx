import { useSession } from '@/lib/session';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { CircleCheckIcon, InfoIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@pushlane/ui/components/alert';
import { Button } from '@pushlane/ui/components/button';

import { ConnectPanel } from './connect-panel';
import { NotificationDetailDialog } from './notification-detail-dialog';
import { NotificationLogs } from './notification-logs';
import { ProjectOverview } from './project-overview';
import { SendDialog } from './send-dialog';

const logsRoute = getRouteApi('/');

export function LogsPage() {
  const { session } = useSession();
  const search = logsRoute.useSearch();
  const navigate = useNavigate();
  const connected = session.status === 'connected';
  const [notice, setNotice] = useState<{ sessionId: string; message: string } | null>(null);
  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ to: '/', search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            DELIVERY ACTIVITY
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Notification logs</h1>
          <p className="text-muted-foreground">
            Every send, every installation, and what happened next.
          </p>
        </div>
        <Button disabled={!connected} onClick={() => setSearch({ compose: true })}>
          <PlusIcon aria-hidden="true" />
          Send notification
        </Button>
      </div>

      {connected ? (
        <>
          {notice?.sessionId === session.id && (
            <Alert role="status">
              <CircleCheckIcon aria-hidden="true" />
              <AlertDescription>{notice.message}</AlertDescription>
            </Alert>
          )}
          <ProjectOverview />
          <NotificationLogs key={search.user ?? ''} userId={search.user} />
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Provider acceptance means the push service accepted the request. Device receipt and
            display are not confirmed.
          </p>
          <NotificationDetailDialog
            notificationId={search.notification}
            onClose={() => setSearch({ notification: undefined })}
          />
          <SendDialog
            open={search.compose === true}
            onClose={() => setSearch({ compose: undefined })}
            onSent={(message) => setNotice({ sessionId: session.id, message })}
          />
        </>
      ) : (
        <ConnectPanel />
      )}
    </>
  );
}
