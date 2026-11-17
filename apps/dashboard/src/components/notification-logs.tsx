import { dateLabel, errorMessage, plural } from '@/lib/format';
import { notificationsQuery } from '@/lib/queries';
import { useConnectedSession } from '@/lib/session';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowRightIcon, LayoutListIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@pushlane/ui/components/alert';
import { Badge } from '@pushlane/ui/components/badge';
import { Button } from '@pushlane/ui/components/button';
import { Input } from '@pushlane/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pushlane/ui/components/table';

import { StatusBadge } from './status-badge';

import type { NotificationLog } from '@/lib/api';

const column = createColumnHelper<NotificationLog>();

/** Paged, filterable notification logs. Opening a row puts its id in the URL. */
export function NotificationLogs({ userId }: { userId: string | undefined }) {
  const session = useConnectedSession();
  const navigate = useNavigate();
  const [filter, setFilter] = useState(userId ?? '');
  const logs = useInfiniteQuery(notificationsQuery(session, userId));
  const notifications = useMemo(
    () => logs.data?.pages.flatMap((page) => page.items) ?? [],
    [logs.data]
  );

  const columns = useMemo(
    () => [
      column.accessor('title', {
        header: 'NOTIFICATION',
        cell: ({ row }) => (
          <div className="flex max-w-xs flex-col">
            <span className="truncate font-medium">{row.original.title}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.id}
            </span>
          </div>
        ),
      }),
      column.accessor('userId', {
        header: 'USER',
        cell: ({ getValue }) => (
          <span className="block max-w-40 truncate" title={getValue()}>
            {getValue()}
          </span>
        ),
      }),
      column.accessor('status', {
        header: 'STATUS',
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      }),
      column.accessor('deliveryCount', {
        header: 'INSTALLATIONS',
        cell: ({ getValue }) => getValue().toLocaleString(),
      }),
      column.accessor('createdAt', {
        header: 'CREATED',
        cell: ({ getValue }) => <span title={getValue()}>{dateLabel(getValue())}</span>,
      }),
      column.display({
        id: 'details',
        header: () => <span className="sr-only">Details</span>,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Inspect ${row.original.title}`}
            onClick={() =>
              void navigate({
                to: '/',
                search: (previous) => ({ ...previous, notification: row.original.id }),
              })
            }
          >
            <ArrowRightIcon aria-hidden="true" />
          </Button>
        ),
      }),
    ],
    [navigate]
  );

  const table = useReactTable({
    data: notifications,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const applyFilter = (value: string) =>
    void navigate({ to: '/', search: (previous) => ({ ...previous, user: value || undefined }) });

  let summary = `${plural(notifications.length, 'notification')} loaded${userId ? ` for ${userId}` : ''}`;

  if (logs.isPending) summary = 'Loading notifications…';
  else if (logs.isError) summary = 'Could not load notifications. Try refreshing.';

  return (
    <section
      aria-labelledby="recent-heading"
      className="flex flex-col gap-4 rounded-3xl border bg-background p-4 md:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="recent-heading" className="flex items-center gap-2 font-medium">
          Recent notifications
          <Badge variant="secondary">{notifications.length.toLocaleString()}</Badge>
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={logs.isFetching}
          onClick={() => void logs.refetch()}
        >
          <RefreshCwIcon aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilter(filter.trim());
        }}
      >
        <div className="relative min-w-0 flex-1 basis-56">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Filter by exact user ID"
            placeholder="Filter by exact user ID"
            autoComplete="off"
            className="pl-9"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply filter
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setFilter('');
            applyFilter('');
          }}
        >
          Clear
        </Button>
      </form>

      {logs.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(logs.error)}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id} className="text-xs">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {logs.isSuccess && notifications.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <LayoutListIcon aria-hidden="true" className="size-8 text-muted-foreground" />
          <h3 className="font-medium">No notifications yet.</h3>
          <p className="text-sm text-muted-foreground">
            Send a notification to an authenticated user ID to see its progress here.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{summary}</span>
        {logs.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={logs.isFetchingNextPage}
            onClick={() => void logs.fetchNextPage()}
          >
            Load older notifications
          </Button>
        )}
      </div>
    </section>
  );
}
