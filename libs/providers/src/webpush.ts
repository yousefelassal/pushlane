import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { generateRequestDetails } from 'web-push';
import { parseRetryAfter } from './retry-after.js';
import type {
	DispatchRequest,
	DispatchResult,
	PushEndpoint,
} from '../../contracts/src/index.js';

type WebPushRequest = DispatchRequest & {
	endpoint: Extract<PushEndpoint, { kind: 'webpush' }>;
};

const privateIpv4 = new BlockList();
const privateIpv6 = new BlockList();

for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] satisfies Array<[string, number]>) {
	privateIpv4.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
	['::', 128],
	['::1', 128],
	['::ffff:0:0', 96],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
	['2001:db8::', 32],
] satisfies Array<[string, number]>) {
	privateIpv6.addSubnet(address, prefix, 'ipv6');
}

/** Limits destinations to browser-operated push services and standard TLS ports. */
export function isAllowedPushEndpoint(value: string): boolean {
	let url: URL;

	try {
		url = new URL(value);
	} catch {
		return false;
	}

	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.port ||
		url.hash ||
		isIP(url.hostname)
	) {
		return false;
	}

	return (
		url.hostname === 'fcm.googleapis.com' ||
		url.hostname === 'updates.push.services.mozilla.com' ||
		url.hostname.endsWith('.push.services.mozilla.com') ||
		url.hostname === 'web.push.apple.com' ||
		url.hostname.endsWith('.push.apple.com') ||
		url.hostname.endsWith('.notify.windows.com')
	);
}

/** Encrypts with project VAPID keys and pins DNS to a verified public address. */
export async function dispatchWebPush(
	request: WebPushRequest,
): Promise<DispatchResult> {
	const credentials = request.credentials.webpush;

	if (!credentials)
		return {
			kind: 'rejected',
			code: 'WEBPUSH_NOT_CONFIGURED',
			invalidateEndpoint: false,
		};

	if (!isAllowedPushEndpoint(request.endpoint.subscription.endpoint)) {
		return {
			kind: 'rejected',
			code: 'WEBPUSH_ENDPOINT_NOT_ALLOWED',
			invalidateEndpoint: false,
		};
	}

	const signal = AbortSignal.timeout(12_000);
	const destination = new URL(request.endpoint.subscription.endpoint);

	try {
		const addresses = await Promise.race([
			lookup(destination.hostname, { all: true }),
			new Promise<never>((_resolve, reject) =>
				signal.addEventListener(
					'abort',
					() => reject(new Error('DNS timeout')),
					{ once: true },
				),
			),
		]);

		if (
			!addresses.length ||
			addresses.some((address) =>
				(address.family === 6 ? privateIpv6 : privateIpv4).check(
					address.address,
					address.family === 6 ? 'ipv6' : 'ipv4',
				),
			)
		) {
			return {
				kind: 'rejected',
				code: 'WEBPUSH_ADDRESS_NOT_ALLOWED',
				invalidateEndpoint: false,
			};
		}

		const address = addresses[0];

		if (!address) return { kind: 'retry', code: 'WEBPUSH_DNS_ERROR' };

		if (request.expiresAt.getTime() <= Date.now()) {
			return {
				kind: 'rejected',
				code: 'NOTIFICATION_EXPIRED',
				invalidateEndpoint: false,
			};
		}

		let details: ReturnType<typeof generateRequestDetails>;

		try {
			details = generateRequestDetails(
				request.endpoint.subscription,
				JSON.stringify({
					notificationId: request.deliveryId,
					title: request.notification.title,
					body: request.notification.body,
					...(request.notification.image
						? { image: request.notification.image }
						: {}),
					...(request.notification.url
						? { url: request.notification.url }
						: {}),
				}),
				{
					vapidDetails: credentials,
					TTL: Math.max(
						0,
						Math.floor((request.expiresAt.getTime() - Date.now()) / 1000),
					),
					urgency: 'normal',
				},
			);
		} catch {
			return {
				kind: 'rejected',
				code: 'WEBPUSH_CONFIGURATION_INVALID',
				invalidateEndpoint: false,
			};
		}

		return await new Promise<DispatchResult>((resolve) => {
			const outgoing = httpsRequest(
				destination,
				{
					method: details.method,
					headers: details.headers,
					agent: false,
					signal,
					lookup: (_hostname, options, callback) => {
						callback(
							null,
							options.all ? [address] : address.address,
							address.family,
						);
					},
				},
				(response) => {
					response.resume();

					resolve(
						webPushResult(
							response.statusCode ?? 0,
							response.headers['retry-after'],
						),
					);
				},
			);

			outgoing.on('error', () =>
				resolve({
					kind: 'retry',
					code: signal.aborted ? 'WEBPUSH_TIMEOUT' : 'WEBPUSH_TRANSPORT_ERROR',
				}),
			);
			outgoing.end(details.body);
		});
	} catch {
		return {
			kind: 'retry',
			code: signal.aborted ? 'WEBPUSH_TIMEOUT' : 'WEBPUSH_DNS_ERROR',
		};
	}
}

/** Only an expired or unknown subscription is safe to retire automatically. */
export function webPushResult(
	status: number,
	retryAfter: string | undefined,
): DispatchResult {
	if (status >= 200 && status < 300)
		return { kind: 'accepted', providerMessageId: 'webpush-accepted' };

	if (status === 429 || status >= 500) {
		const delay = parseRetryAfter(retryAfter);

		return {
			kind: 'retry',
			code: `WEBPUSH_HTTP_${status}`,
			retryAfterSeconds: delay ?? 60,
		};
	}

	return {
		kind: 'rejected',
		code: `WEBPUSH_HTTP_${status}`,
		invalidateEndpoint: status === 404 || status === 410,
	};
}
