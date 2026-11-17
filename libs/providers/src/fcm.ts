import { createHash } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { parseRetryAfter } from './retry-after.js';
import type {
	DispatchRequest,
	DispatchResult,
	PushEndpoint,
} from '../../contracts/src/index.js';

type FcmRequest = DispatchRequest & {
	endpoint: Extract<PushEndpoint, { kind: 'fcm' }>;
};

const oauthSchema = z.object({
	access_token: z.string().min(1),
	expires_in: z.number().positive().default(3600),
});
const successSchema = z.object({ name: z.string().min(1) });
const errorSchema = z.object({
	error: z
		.object({
			details: z
				.array(
					z
						.object({ '@type': z.string(), errorCode: z.string().optional() })
						.passthrough(),
				)
				.optional(),
		})
		.passthrough(),
});

type TokenResult =
	| { kind: 'token'; value: string; expiresAt: number }
	| DispatchResult;
type FcmCredentials = NonNullable<DispatchRequest['credentials']['fcm']>;

const accessTokens = new Map<
	string,
	{ promise: Promise<TokenResult>; expiresAt: number }
>();

function credentialsKey(credentials: FcmCredentials): string {
	return createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
}

async function exchangeToken(
	credentials: FcmCredentials,
	signal: AbortSignal,
): Promise<TokenResult> {
	let assertion: string;

	try {
		const key = await importPKCS8(credentials.privateKey, 'RS256');

		assertion = await new SignJWT({
			scope: 'https://www.googleapis.com/auth/firebase.messaging',
		})
			.setProtectedHeader({ alg: 'RS256' })
			.setIssuer(credentials.clientEmail)
			.setAudience('https://oauth2.googleapis.com/token')
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(key);
	} catch {
		return {
			kind: 'rejected',
			code: 'FCM_CREDENTIALS_INVALID',
			invalidateEndpoint: false,
		};
	}

	try {
		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion,
			}),
			signal,
			redirect: 'error',
		});

		if (!response.ok) {
			await response.body?.cancel();

			return response.status === 429 || response.status >= 500
				? {
						kind: 'retry',
						code: `FCM_AUTH_HTTP_${response.status}`,
						retryAfterSeconds:
							parseRetryAfter(response.headers.get('retry-after')) ?? 60,
					}
				: {
						kind: 'rejected',
						code: `FCM_AUTH_HTTP_${response.status}`,
						invalidateEndpoint: false,
					};
		}

		const token = oauthSchema.safeParse(await response.json());

		if (!token.success)
			return { kind: 'retry', code: 'FCM_AUTH_RESPONSE_INVALID' };

		return {
			kind: 'token',
			value: token.data.access_token,
			expiresAt:
				Date.now() +
				Math.max(0, Math.min(token.data.expires_in, 3600) - 60) * 1000,
		};
	} catch {
		return {
			kind: 'retry',
			code: signal.aborted ? 'FCM_TIMEOUT' : 'FCM_TRANSPORT_ERROR',
		};
	}
}

function accessToken(
	credentials: FcmCredentials,
	signal: AbortSignal,
): Promise<TokenResult> {
	const key = credentialsKey(credentials);
	const cached = accessTokens.get(key);

	if (cached && cached.expiresAt > Date.now()) return cached.promise;

	const promise = exchangeToken(credentials, signal);
	const entry = { promise, expiresAt: Date.now() + 12_000 };

	accessTokens.set(key, entry);

	void promise.then((result) => {
		if (accessTokens.get(key) !== entry) return;

		if (result.kind === 'token') entry.expiresAt = result.expiresAt;
		else accessTokens.delete(key);
	});

	if (accessTokens.size > 100) {
		const oldest = accessTokens.keys().next().value;

		if (oldest) accessTokens.delete(oldest);
	}

	return promise;
}

/** Uses cached service-account authorization and refuses to send expired payloads. */
export async function dispatchFcm(
	request: FcmRequest,
): Promise<DispatchResult> {
	const credentials = request.credentials.fcm;

	if (!credentials)
		return {
			kind: 'rejected',
			code: 'FCM_NOT_CONFIGURED',
			invalidateEndpoint: false,
		};

	const signal = AbortSignal.timeout(12_000);
	const token = await accessToken(credentials, signal);

	if (token.kind !== 'token') return token;

	const remainingMilliseconds = request.expiresAt.getTime() - Date.now();

	if (remainingMilliseconds <= 0) {
		return {
			kind: 'rejected',
			code: 'NOTIFICATION_EXPIRED',
			invalidateEndpoint: false,
		};
	}

	try {
		const response = await fetch(
			`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${token.value}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					message: {
						token: request.endpoint.token,
						notification: {
							title: request.notification.title,
							body: request.notification.body,
							...(request.notification.image
								? { image: request.notification.image }
								: {}),
						},
						data: {
							notificationId: request.deliveryId,
							...(request.notification.url
								? { url: request.notification.url }
								: {}),
						},
						android: {
							ttl: `${(remainingMilliseconds / 1000).toFixed(3)}s`,
							priority: 'HIGH',
						},
					},
				}),
				signal,
				redirect: 'error',
			},
		);
		const body: unknown = await response.json().catch(() => null);

		if (response.status === 401)
			accessTokens.delete(credentialsKey(credentials));

		return fcmResult(
			response.status,
			body,
			response.headers.get('retry-after'),
		);
	} catch {
		return {
			kind: 'retry',
			code: signal.aborted ? 'FCM_TIMEOUT' : 'FCM_TRANSPORT_ERROR',
		};
	}
}

/** Keeps invalid payload and credential errors from retiring a valid endpoint. */
export function fcmResult(
	status: number,
	body: unknown,
	retryAfter: string | null,
): DispatchResult {
	if (status >= 200 && status < 300) {
		const response = successSchema.safeParse(body);

		return response.success
			? { kind: 'accepted', providerMessageId: response.data.name }
			: { kind: 'retry', code: 'FCM_RESPONSE_INVALID' };
	}

	if (status === 429 || status >= 500) {
		const retryAfterSeconds = parseRetryAfter(retryAfter) ?? 60;

		return { kind: 'retry', code: `FCM_HTTP_${status}`, retryAfterSeconds };
	}

	const response = errorSchema.safeParse(body);
	const unregistered =
		response.success &&
		response.data.error.details?.some(
			(detail) =>
				detail['@type'] ===
					'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
				detail.errorCode === 'UNREGISTERED',
		);

	if (status === 404 && unregistered) {
		return {
			kind: 'rejected',
			code: 'FCM_UNREGISTERED',
			invalidateEndpoint: true,
		};
	}

	return {
		kind: 'rejected',
		code: `FCM_HTTP_${status}`,
		invalidateEndpoint: false,
	};
}
