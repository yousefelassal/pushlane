import { generateKeyPair, exportPKCS8 } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	DispatchRequest,
	PushEndpoint,
} from '../../contracts/src/index.js';
import { apnsResult } from './apns.js';
import { dispatchFcm, fcmResult } from './fcm.js';
import { ProviderDispatcher } from './index.js';
import { isAllowedPushEndpoint, webPushResult } from './webpush.js';

const notification = {
	userId: 'user-123',
	title: 'Order shipped',
	body: 'Arriving tomorrow',
	image: 'https://example.com/order.jpg',
	url: 'https://example.com/orders/123',
	ttlSeconds: 60,
};

function delivery(endpoint: PushEndpoint): DispatchRequest {
	return {
		deliveryId: '8d5f24bd-58cb-4421-b5fc-1d5fc5337c0b',
		endpoint,
		notification,
		credentials: {},
		expiresAt: new Date(Date.now() + 60_000),
	};
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	return typeof input === 'string'
		? input
		: input instanceof URL
			? input.href
			: input.url;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ProviderDispatcher', () => {
	it('does not contact a provider after the notification expires', async () => {
		const outgoing = vi.fn();
		vi.stubGlobal('fetch', outgoing);

		const request = delivery({ kind: 'fcm', token: 'device-token' });
		request.expiresAt = new Date(Date.now() - 1);

		expect(await new ProviderDispatcher().dispatch(request)).toEqual({
			kind: 'rejected',
			code: 'NOTIFICATION_EXPIRED',
			invalidateEndpoint: false,
		});
		expect(outgoing).not.toHaveBeenCalled();
	});

	it('reports absent credentials without retiring a device token', async () => {
		expect(
			await new ProviderDispatcher().dispatch(
				delivery({ kind: 'apns', token: 'a'.repeat(64), sandbox: false }),
			),
		).toEqual({
			kind: 'rejected',
			code: 'APNS_NOT_CONFIGURED',
			invalidateEndpoint: false,
		});
	});
});

describe('APNs outcomes', () => {
	it('records provider acceptance without claiming device delivery', () => {
		expect(apnsResult(200, '', 'provider-id')).toEqual({
			kind: 'accepted',
			providerMessageId: 'provider-id',
		});
	});

	it.each([
		[410, 'Unregistered'],
		[400, 'BadDeviceToken'],
	])('retires an explicitly unusable token for HTTP %i', (status, reason) => {
		expect(
			apnsResult(status, JSON.stringify({ reason }), 'provider-id'),
		).toMatchObject({ kind: 'rejected', invalidateEndpoint: true });
	});

	it('preserves a token when the configured bundle ID could be wrong', () => {
		expect(
			apnsResult(
				400,
				JSON.stringify({ reason: 'DeviceTokenNotForTopic' }),
				'provider-id',
			),
		).toEqual({
			kind: 'rejected',
			code: 'APNS_HTTP_400',
			invalidateEndpoint: false,
		});
	});

	it.each([429, 500, 503])('retries HTTP %i', (status) => {
		expect(apnsResult(status, '', 'provider-id')).toEqual({
			kind: 'retry',
			code: `APNS_HTTP_${status}`,
		});
	});
});

describe('FCM outcomes', () => {
	it('retires only the FCM UNREGISTERED error', () => {
		const body = {
			error: {
				details: [
					{
						'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
						errorCode: 'UNREGISTERED',
					},
				],
			},
		};

		expect(fcmResult(404, body, null)).toEqual({
			kind: 'rejected',
			code: 'FCM_UNREGISTERED',
			invalidateEndpoint: true,
		});
		expect(
			fcmResult(404, { error: { message: 'Unknown project' } }, null),
		).toEqual({
			kind: 'rejected',
			code: 'FCM_HTTP_404',
			invalidateEndpoint: false,
		});
	});

	it('does not treat an invalid payload as an invalid token', () => {
		expect(
			fcmResult(400, { error: { status: 'INVALID_ARGUMENT' } }, null),
		).toEqual({
			kind: 'rejected',
			code: 'FCM_HTTP_400',
			invalidateEndpoint: false,
		});
	});

	it('honors bounded retry delays for quota failures', () => {
		expect(fcmResult(429, null, '120')).toEqual({
			kind: 'retry',
			code: 'FCM_HTTP_429',
			retryAfterSeconds: 120,
		});
	});

	it('preserves long backoff and parses provider HTTP-date delays', () => {
		const now = Date.now();

		vi.spyOn(Date, 'now').mockReturnValue(now);

		expect(fcmResult(429, null, '7200')).toMatchObject({
			retryAfterSeconds: 7200,
		});
		expect(
			fcmResult(503, null, new Date(now + 7200_000).toUTCString()),
		).toMatchObject({ retryAfterSeconds: 7200 });
		expect(apnsResult(429, '', 'provider-id', '7200')).toMatchObject({
			retryAfterSeconds: 7200,
		});
	});

	it('shares an OAuth exchange across concurrent and subsequent dispatches', async () => {
		const signingKey = await generateKeyPair('RS256', { extractable: true });
		const privateKey = await exportPKCS8(signingKey.privateKey);
		const request = {
			...delivery({ kind: 'fcm', token: 'device-token' }),
			endpoint: { kind: 'fcm', token: 'device-token' } satisfies Extract<
				PushEndpoint,
				{ kind: 'fcm' }
			>,
			credentials: {
				fcm: {
					projectId: 'cached-example',
					clientEmail: 'service@example.iam.gserviceaccount.com',
					privateKey,
				},
			},
		};
		const outgoing = vi
			.fn<typeof fetch>()
			.mockImplementation(
				async (url) =>
					new Response(
						JSON.stringify(
							requestUrl(url).includes('oauth2')
								? { access_token: 'cached-token', expires_in: 3600 }
								: { name: 'projects/example/messages/123' },
						),
						{ status: 200 },
					),
			);

		vi.stubGlobal('fetch', outgoing);

		const concurrent = await Promise.all([
			dispatchFcm(request),
			dispatchFcm(request),
		]);
		const cached = await dispatchFcm(request);

		expect(concurrent.every((result) => result.kind === 'accepted')).toBe(true);
		expect(cached.kind).toBe('accepted');
		expect(
			outgoing.mock.calls.filter(([url]) => requestUrl(url).includes('oauth2')),
		).toHaveLength(1);
		expect(
			outgoing.mock.calls.filter(([url]) =>
				requestUrl(url).includes('messages:send'),
			),
		).toHaveLength(3);
	});

	it('refreshes cached OAuth credentials before they expire', async () => {
		const signingKey = await generateKeyPair('RS256', { extractable: true });
		const privateKey = await exportPKCS8(signingKey.privateKey);
		const now = Date.now();
		const request = {
			...delivery({ kind: 'fcm', token: 'device-token' }),
			endpoint: { kind: 'fcm', token: 'device-token' } satisfies Extract<
				PushEndpoint,
				{ kind: 'fcm' }
			>,
			credentials: {
				fcm: {
					projectId: 'expiring-example',
					clientEmail: 'service@example.iam.gserviceaccount.com',
					privateKey,
				},
			},
			expiresAt: new Date(now + 300_000),
		};
		const outgoing = vi
			.fn<typeof fetch>()
			.mockImplementation(
				async (url) =>
					new Response(
						JSON.stringify(
							requestUrl(url).includes('oauth2')
								? { access_token: 'cached-token', expires_in: 120 }
								: { name: 'projects/example/messages/123' },
						),
						{ status: 200 },
					),
			);

		vi.stubGlobal('fetch', outgoing);

		expect((await dispatchFcm(request)).kind).toBe('accepted');

		vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);

		expect((await dispatchFcm(request)).kind).toBe('accepted');
		expect(
			outgoing.mock.calls.filter(([url]) => requestUrl(url).includes('oauth2')),
		).toHaveLength(2);
	});

	it('refuses a notification that expires during the OAuth exchange', async () => {
		const signingKey = await generateKeyPair('RS256', { extractable: true });
		const privateKey = await exportPKCS8(signingKey.privateKey);
		const request = {
			...delivery({ kind: 'fcm', token: 'device-token' }),
			endpoint: { kind: 'fcm', token: 'device-token' } satisfies Extract<
				PushEndpoint,
				{ kind: 'fcm' }
			>,
			credentials: {
				fcm: {
					projectId: 'expired-example',
					clientEmail: 'service@example.iam.gserviceaccount.com',
					privateKey,
				},
			},
		};
		const outgoing = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
			request.expiresAt = new Date(Date.now() - 1);

			return new Response(
				JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
				{ status: 200 },
			);
		});

		vi.stubGlobal('fetch', outgoing);

		expect(await dispatchFcm(request)).toEqual({
			kind: 'rejected',
			code: 'NOTIFICATION_EXPIRED',
			invalidateEndpoint: false,
		});
		expect(outgoing).toHaveBeenCalledOnce();
		expect(outgoing.mock.calls[0]?.[0]).toBe(
			'https://oauth2.googleapis.com/token',
		);
	});

	it('maps the common notification and Android lifetime to HTTP v1', async () => {
		const key = await generateKeyPair('RS256', { extractable: true });
		const privateKey = await exportPKCS8(key.privateKey);
		const outgoing = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'access-token' }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ name: 'projects/example/messages/123' }),
					{ status: 200 },
				),
			);
		vi.stubGlobal('fetch', outgoing);

		const request = {
			...delivery({ kind: 'fcm', token: 'device-token' }),
			endpoint: { kind: 'fcm', token: 'device-token' } satisfies Extract<
				PushEndpoint,
				{ kind: 'fcm' }
			>,
			credentials: {
				fcm: {
					projectId: 'example',
					clientEmail: 'service@example.iam.gserviceaccount.com',
					privateKey,
				},
			},
		};
		const result = await dispatchFcm(request);

		expect(result).toEqual({
			kind: 'accepted',
			providerMessageId: 'projects/example/messages/123',
		});
		expect(outgoing).toHaveBeenCalledTimes(2);
		expect(outgoing.mock.calls[0]?.[0]).toBe(
			'https://oauth2.googleapis.com/token',
		);
		expect(outgoing.mock.calls[1]?.[0]).toBe(
			'https://fcm.googleapis.com/v1/projects/example/messages:send',
		);

		const options = outgoing.mock.calls[1]?.[1];
		expect(options?.headers).toMatchObject({
			authorization: 'Bearer access-token',
		});
		expect(typeof options?.body).toBe('string');

		if (typeof options?.body !== 'string')
			throw new Error('Expected a JSON request body.');

		expect(JSON.parse(options.body)).toMatchObject({
			message: {
				token: 'device-token',
				notification: {
					title: 'Order shipped',
					body: 'Arriving tomorrow',
					image: 'https://example.com/order.jpg',
				},
				data: { url: 'https://example.com/orders/123' },
				android: { priority: 'HIGH' },
			},
		});
	});

	it('redacts provider authentication response bodies', async () => {
		const key = await generateKeyPair('RS256', { extractable: true });
		const privateKey = await exportPKCS8(key.privateKey);
		vi.stubGlobal(
			'fetch',
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(
					new Response('secret-provider-diagnostic', { status: 401 }),
				),
		);

		const result = await dispatchFcm({
			...delivery({ kind: 'fcm', token: 'device-token' }),
			endpoint: { kind: 'fcm', token: 'device-token' },
			credentials: {
				fcm: {
					projectId: 'example',
					clientEmail: 'service@example.iam.gserviceaccount.com',
					privateKey,
				},
			},
		});

		expect(result).toEqual({
			kind: 'rejected',
			code: 'FCM_AUTH_HTTP_401',
			invalidateEndpoint: false,
		});
	});
});

describe('Web Push destinations', () => {
	it.each([
		'https://fcm.googleapis.com/fcm/send/subscription',
		'https://updates.push.services.mozilla.com/wpush/v2/subscription',
		'https://web.push.apple.com/subscription',
		'https://wns2-par02p.notify.windows.com/w/?token=value',
	])('accepts a browser-operated push endpoint %s', (endpoint) => {
		expect(isAllowedPushEndpoint(endpoint)).toBe(true);
	});

	it.each([
		'https://127.0.0.1/private',
		'https://[::1]/private',
		'https://169.254.169.254/latest/meta-data',
		'https://fcm.googleapis.com.attacker.example/private',
		'https://attacker.example@fcm.googleapis.com/fcm/send/token',
		'https://fcm.googleapis.com:8443/private',
		'http://fcm.googleapis.com/fcm/send/token',
		'https://attacker.example/private',
	])(
		'blocks a destination outside the supported service boundary %s',
		(endpoint) => {
			expect(isAllowedPushEndpoint(endpoint)).toBe(false);
		},
	);

	it.each([404, 410])('retires a subscription for HTTP %i', (status) => {
		expect(webPushResult(status, undefined)).toEqual({
			kind: 'rejected',
			code: `WEBPUSH_HTTP_${status}`,
			invalidateEndpoint: true,
		});
	});

	it('preserves a subscription when VAPID credentials are rejected', () => {
		expect(webPushResult(403, undefined)).toEqual({
			kind: 'rejected',
			code: 'WEBPUSH_HTTP_403',
			invalidateEndpoint: false,
		});
	});
});
