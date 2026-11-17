import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { projectSchema, request } from './api';

import type { Project } from './api';
import type { ReactNode } from 'react';

/**
 * The connected project and its backend key.
 *
 * The key lives only in React state, so a reload or disconnect drops it. Each connection gets a new
 * `id` that scopes query keys, and an abort signal that cancels its in-flight requests.
 */
export type Session =
  | { status: 'disconnected' }
  | {
      status: 'connected';
      id: string;
      apiKey: string;
      initialProject: Project;
      signal: AbortSignal;
    };

type ConnectedSession = Extract<Session, { status: 'connected' }>;

interface SessionContextValue {
  session: Session;
  connect: (apiKey: string) => Promise<void>;
  disconnect: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>({ status: 'disconnected' });
  const controller = useRef<AbortController | null>(null);

  const connect = useCallback(
    async (apiKey: string) => {
      const project = await request({ path: '/v1/project', apiKey, schema: projectSchema });

      controller.current?.abort();
      controller.current = new AbortController();
      queryClient.clear();

      setSession({
        status: 'connected',
        id: crypto.randomUUID(),
        apiKey,
        initialProject: project,
        signal: controller.current.signal,
      });
    },
    [queryClient]
  );

  const disconnect = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    queryClient.clear();

    setSession({ status: 'disconnected' });
  }, [queryClient]);

  const value = useMemo(() => ({ session, connect, disconnect }), [session, connect, disconnect]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);

  if (!value) throw new Error('useSession must be used inside SessionProvider.');

  return value;
}

/** The current connection. Only call it from components rendered while connected. */
export function useConnectedSession(): ConnectedSession {
  const { session } = useSession();

  if (session.status !== 'connected') throw new Error('No project is connected.');

  return session;
}
