import { useSession } from '@/lib/session';
import { Link, useNavigate } from '@tanstack/react-router';
import { BookOpenIcon, ExternalLinkIcon, LayoutListIcon, SendIcon } from 'lucide-react';

import { Button } from '@pushlane/ui/components/button';
import { cn } from '@pushlane/ui/lib/utils';

import type { ReactNode } from 'react';

const DOCS_URL = 'https://github.com/yousefelassal/pushlane/tree/main/apps/docs';
const REPOSITORY_URL = 'https://github.com/yousefelassal/pushlane';

/** Navigation, connection status, and disconnect, shared by every page. */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, disconnect } = useSession();
  const navigate = useNavigate();
  const connected = session.status === 'connected';
  const project = connected ? session.initialProject : null;

  return (
    <div className="flex min-h-svh bg-background">
      <aside
        aria-label="Workspace navigation"
        className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-6 border-r bg-background p-5 md:flex"
      >
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-xl bg-foreground text-background"
          >
            p
          </span>
          pushlane
          <span className="rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">
            OSS
          </span>
        </Link>

        <div className="rounded-2xl border p-3">
          <strong className="block truncate text-sm">{project?.name ?? 'Your workspace'}</strong>
          <span className="text-xs text-muted-foreground">
            {project?.environment ?? 'Connect a project'}
          </span>
        </div>

        <nav className="flex flex-col gap-1 text-sm">
          <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground">WORKSPACE</p>
          <Link
            to="/"
            aria-current="page"
            className="flex items-center gap-2 rounded-xl bg-muted px-2 py-1.5 font-medium"
          >
            <LayoutListIcon aria-hidden="true" className="size-4" />
            Notification logs
          </Link>
          <Button
            variant="ghost"
            className="justify-start"
            disabled={!connected}
            onClick={() =>
              void navigate({ to: '/', search: (previous) => ({ ...previous, compose: true }) })
            }
          >
            <SendIcon aria-hidden="true" />
            Send a notification
          </Button>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted"
          >
            <BookOpenIcon aria-hidden="true" className="size-4" />
            Documentation
            <ExternalLinkIcon aria-hidden="true" className="ml-auto size-3 text-muted-foreground" />
          </a>
        </nav>

        <div className="mt-auto text-xs text-muted-foreground">
          <p>Open source. Your infrastructure.</p>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="underline">
            View on GitHub
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col border-l bg-muted/40 md:border-l-0">
        <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3 md:px-8">
          <p className="text-sm text-muted-foreground">
            Workspace <span aria-hidden="true">/</span>{' '}
            <strong className="text-foreground">Notification logs</strong>
          </p>
          <div className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 rounded-full',
                connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              )}
            />
            <span>{project?.environment ?? 'Not connected'}</span>
            {connected && (
              <Button variant="ghost" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            )}
          </div>
        </header>

        <main id="logs" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-8">
          {children}
        </main>

        <footer className="flex flex-wrap justify-between gap-2 border-t px-4 py-4 text-xs text-muted-foreground md:px-8">
          <span>Pushlane</span>
          <span>Transactional push, with a record of every attempt.</span>
        </footer>
      </div>
    </div>
  );
}
