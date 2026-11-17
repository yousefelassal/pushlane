import type {
	Dispatcher,
	DispatchRequest,
	DispatchResult,
} from '../../contracts/src/index.js';
import { dispatchApns } from './apns.js';
import { dispatchFcm } from './fcm.js';
import { dispatchWebPush } from './webpush.js';

/** Routes a delivery to its native provider without changing receipt semantics. */
export class ProviderDispatcher implements Dispatcher {
	/** Resolves only after provider acceptance, rejection, or a bounded failure. */
	async dispatch(request: DispatchRequest): Promise<DispatchResult> {
		if (request.expiresAt.getTime() <= Date.now()) {
			return {
				kind: 'rejected',
				code: 'NOTIFICATION_EXPIRED',
				invalidateEndpoint: false,
			};
		}

		switch (request.endpoint.kind) {
			case 'apns':
				return dispatchApns({ ...request, endpoint: request.endpoint });
			case 'fcm':
				return dispatchFcm({ ...request, endpoint: request.endpoint });
			case 'webpush':
				return dispatchWebPush({ ...request, endpoint: request.endpoint });
		}
	}
}

export { closeApnsConnections } from './apns.js';
