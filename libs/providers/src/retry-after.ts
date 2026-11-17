/** Parses provider backoff in seconds or HTTP-date form without retrying early. */
export function parseRetryAfter(
	value: string | null | undefined,
): number | undefined {
	if (!value?.trim()) return undefined;

	const numeric = Number(value);
	const seconds = Number.isFinite(numeric)
		? numeric
		: (Date.parse(value) - Date.now()) / 1000;

	return Number.isFinite(seconds) && seconds >= 0
		? Math.ceil(seconds)
		: undefined;
}
