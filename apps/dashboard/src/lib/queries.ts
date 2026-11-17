import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { detailSchema, listSchema, projectSchema, receiptSchema, request } from './api';

import type { Session } from './session';

type Connected = Extract<Session, { status: 'connected' }>;

const PAGE_SIZE = '25';

/** Combines React Query's cancellation with the session's disconnect signal. */
function signals(session: Connected, signal: AbortSignal): AbortSignal {
  return AbortSignal.any([session.signal, signal]);
}

export function projectQuery(session: Connected) {
  return queryOptions({
    queryKey: ['session', session.id, 'project'],
    queryFn: ({ signal }) =>
      request({
        path: '/v1/project',
        apiKey: session.apiKey,
        schema: projectSchema,
        signal: signals(session, signal),
      }),
    initialData: session.initialProject,
  });
}

/** Newest-first notification logs, paged with the API's keyset cursor. */
export function notificationsQuery(session: Connected, userId: string | undefined) {
  return infiniteQueryOptions({
    queryKey: ['session', session.id, 'notifications', { userId }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: PAGE_SIZE });

      if (userId) params.set('userId', userId);

      if (pageParam) params.set('before', pageParam);

      return request({
        path: `/v1/notifications?${params}`,
        apiKey: session.apiKey,
        schema: listSchema,
        signal: signals(session, signal),
      });
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function notificationQuery(session: Connected, id: string) {
  return queryOptions({
    queryKey: ['session', session.id, 'notification', id],
    queryFn: ({ signal }) =>
      request({
        path: `/v1/notifications/${encodeURIComponent(id)}`,
        apiKey: session.apiKey,
        schema: detailSchema,
        signal: signals(session, signal),
      }),
  });
}

export interface SendInput {
  userId: string;
  title: string;
  body: string;
  image?: string;
  url?: string;
}

export function sendNotification(session: Connected, input: SendInput, idempotencyKey: string) {
  return request({
    path: '/v1/notifications',
    method: 'POST',
    body: JSON.stringify(input),
    apiKey: session.apiKey,
    idempotencyKey,
    schema: receiptSchema,
    signal: session.signal,
  });
}
