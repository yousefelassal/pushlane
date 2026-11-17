import { createHash } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import type {
	DispatchRequest,
	DispatchResult,
	PushEndpoint,
} from '../../contracts/src/index.js';
import { parseRetryAfter } from './retry-after.js';

type ApnsRequest = DispatchRequest & {
	endpoint: Extract<PushEndpoint, { kind: 'apns' }>;
};
type ApnsCredentials = NonNullable<DispatchRequest['credentials']['apns']>;

const responseSchema = z.object({ reason: z.string() });
const sessions = new Map<string, ClientHttp2Session>();
const authorizations = new Map<
	string,
	{ token: Promise<string>; expiresAt: number }
>();
const maximumConnections = 100;

function connectionKey(credentials: ApnsCredentials, origin: string): string {
	return createHash('sha256')
		.update(JSON.stringify([origin, credentials]))
		.digest('hex');
}

function authorization(
	key: string,
	credentials: ApnsCredentials,
): Promise<string> {
	const cached = authorizations.get(key);

	if (cached && cached.expiresAt > Date.now()) return cached.token;

	const token = importPKCS8(credentials.privateKey, 'ES256')
		.then((signingKey) =>
			new SignJWT({})
				.setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
				.setIssuer(credentials.teamId)
				.setIssuedAt()
				.sign(signingKey),
		)
		.catch((error: unknown) => {
			authorizations.delete(key);

			throw error;
		});

	authorizations.set(key, { token, expiresAt: Date.now() + 50 * 60_000 });

	if (authorizations.size > maximumConnections) {
		const oldest = authorizations.keys().next().value;

		if (oldest) authorizations.delete(oldest);
	}

	return token;
}

function connection(key: string, origin: string): ClientHttp2Session {
	const cached = sessions.get(key);

	if (cached && !cached.destroyed && !cached.closed) return cached;

	const session = connect(origin);

	sessions.set(key, session);

	const retire = () => {
		if (sessions.get(key) === session) sessions.delete(key);

		session.close();
	};

	session.on('goaway', retire);
	session.on('error', () => {
		if (sessions.get(key) === session) sessions.delete(key);

		session.destroy();
	});
	session.on('close', () => {
		if (sessions.get(key) === session) sessions.delete(key);
	});
	session.setTimeout(5 * 60_000, retire);
	session.unref();

	if (sessions.size > maximumConnections) {
		const oldest = sessions.keys().next().value;
		const evicted = oldest ? sessions.get(oldest) : undefined;

		if (oldest) sessions.delete(oldest);

		evicted?.close();
	}

	return session;
}

/** Closes retained APNs transports and clears signing tokens during worker shutdown. */
export function closeApnsConnections(): void {
	for (const session of sessions.values()) session.destroy();

	sessions.clear();
	authorizations.clear();
}

/** Sends through reusable credential-scoped HTTP/2 connections with bounded attempts. */
export async function dispatchApns(
	request: ApnsRequest,
): Promise<DispatchResult> {
	const credentials = request.credentials.apns;

	if (!credentials)
		return {
			kind: 'rejected',
			code: 'APNS_NOT_CONFIGURED',
			invalidateEndpoint: false,
		};

	const origin = request.endpoint.sandbox
		? 'https://api.sandbox.push.apple.com'
		: 'https://api.push.apple.com';
	const key = connectionKey(credentials, origin);
	let token: string;

	try {
		token = await authorization(key, credentials);
	} catch {
		return {
			kind: 'rejected',
			code: 'APNS_CREDENTIALS_INVALID',
			invalidateEndpoint: false,
		};
	}

	if (request.expiresAt.getTime() <= Date.now()) {
		return {
			kind: 'rejected',
			code: 'NOTIFICATION_EXPIRED',
			invalidateEndpoint: false,
		};
	}

	const payload = JSON.stringify({
		aps: {
			alert: {
				title: request.notification.title,
				body: request.notification.body,
			},
			sound: 'default',
			...(request.notification.image ? { 'mutable-content': 1 } : {}),
		},
		notificationId: request.deliveryId,
		...(request.notification.image
			? { image: request.notification.image }
			: {}),
		...(request.notification.url ? { url: request.notification.url } : {}),
	});

	return new Promise<DispatchResult>((resolve) => {
		let finished = false;
		let stream: ReturnType<ClientHttp2Session['request']> | undefined;
		const timer = setTimeout(
			() => finish({ kind: 'retry', code: 'APNS_TIMEOUT' }),
			12_000,
		);

		function finish(result: DispatchResult) {
			if (finished) return;

			finished = true;
			clearTimeout(timer);
			stream?.close(constants.NGHTTP2_CANCEL);
			resolve(result);
		}

		try {
			stream = connection(key, origin).request({
				':method': 'POST',
				':path': `/3/device/${request.endpoint.token}`,
				authorization: `bearer ${token}`,
				'apns-topic': credentials.bundleId,
				'apns-push-type': 'alert',
				'apns-priority': '10',
				'apns-expiration': String(
					Math.floor(request.expiresAt.getTime() / 1000),
				),
				'apns-id': request.deliveryId,
			});
		} catch {
			finish({ kind: 'retry', code: 'APNS_TRANSPORT_ERROR' });

			return;
		}

		let status = 0;
		let providerMessageId = request.deliveryId;
		let retryAfter: string | undefined;
		let body = '';

		stream.on('response', (headers) => {
			status = Number(headers[':status']);

			if (typeof headers['apns-id'] === 'string')
				providerMessageId = headers['apns-id'];
			if (typeof headers['retry-after'] === 'string')
				retryAfter = headers['retry-after'];
		});
		stream.setEncoding('utf8');
		stream.on('data', (chunk: string) => {
			body += chunk;

			if (body.length > 8192)
				finish({ kind: 'retry', code: 'APNS_RESPONSE_INVALID' });
		});
		stream.on('error', () =>
			finish({ kind: 'retry', code: 'APNS_TRANSPORT_ERROR' }),
		);
		stream.on('close', () =>
			finish({ kind: 'retry', code: 'APNS_CONNECTION_CLOSED' }),
		);
		stream.on('end', () =>
			finish(apnsResult(status, body, providerMessageId, retryAfter)),
		);
		stream.end(payload);
	});
}

/** Invalidates only a token Apple explicitly identifies as unusable. */
export function apnsResult(
	status: number,
	body: string,
	providerMessageId: string,
	retryAfter?: string,
): DispatchResult {
	if (status === 200) return { kind: 'accepted', providerMessageId };

	if (status === 429 || status >= 500) {
		const delay = parseRetryAfter(retryAfter);

		return {
			kind: 'retry',
			code: `APNS_HTTP_${status}`,
			...(delay === undefined ? {} : { retryAfterSeconds: delay }),
		};
	}

	let reason: string | undefined;

	try {
		const response = responseSchema.safeParse(JSON.parse(body));

		if (response.success) reason = response.data.reason;
	} catch {
		reason = undefined;
	}

	if (
		(status === 410 && reason === 'Unregistered') ||
		(status === 400 && reason === 'BadDeviceToken')
	) {
		return {
			kind: 'rejected',
			code: `APNS_${reason}`,
			invalidateEndpoint: true,
		};
	}

	return {
		kind: 'rejected',
		code: `APNS_HTTP_${status}`,
		invalidateEndpoint: false,
	};
}
