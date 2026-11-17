import '@pushlane/ui/globals.css';

import { Toaster } from '@pushlane/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SessionProvider } from './lib/session';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

const root = document.getElementById('root');

if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
        <Toaster position="top-center" />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>
);
