import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { AppShell } from './components/app-shell';
import { LogsPage } from './components/logs-page';

/** Filters and open dialogs live in the URL, so they survive a reconnect and can be shared. */
const logsSearchSchema = z.object({
  user: z.string().min(1).max(200).optional().catch(undefined),
  notification: z.string().min(1).max(200).optional().catch(undefined),
  compose: z.boolean().optional().catch(undefined),
});

export type LogsSearch = z.infer<typeof logsSearchSchema>;

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

export const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: logsSearchSchema,
  component: LogsPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([logsRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
