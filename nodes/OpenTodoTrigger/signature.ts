import { createHmac, timingSafeEqual } from 'crypto';

/**
 * OpenTodo signs every webhook delivery (docs/webhooks.md "Headers and
 * signature"): X-OpenTodo-Signature is "v1=" + hex(HMAC-SHA256(secret,
 * "<X-OpenTodo-Timestamp>.<raw body>")), the key being the whole "whsec_…"
 * secret, and the timestamp Unix seconds of this attempt.
 */
export function sign(secret: string, timestamp: string, body: Buffer | string): string {
	return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

export type VerifyFailure =
	| 'missing_secret'
	| 'missing_headers'
	| 'stale_timestamp'
	| 'bad_signature';

export interface VerifyInput {
	secret: string | undefined;
	timestamp: string | undefined;
	signature: string | undefined;
	body: Buffer | string;
	/** Unix seconds. */
	nowSeconds: number;
	/** Accepted clock difference in seconds; 0 or less disables the check. */
	toleranceSeconds?: number;
}

export function verifySignature(
	input: VerifyInput,
): { ok: true } | { ok: false; reason: VerifyFailure } {
	if (!input.secret) return { ok: false, reason: 'missing_secret' };
	const timestamp = (input.timestamp ?? '').trim();
	const signature = (input.signature ?? '').trim();
	if (!/^\d+$/.test(timestamp) || signature === '') return { ok: false, reason: 'missing_headers' };
	const tolerance = input.toleranceSeconds ?? 300;
	if (tolerance > 0 && Math.abs(input.nowSeconds - Number(timestamp)) > tolerance) {
		return { ok: false, reason: 'stale_timestamp' };
	}
	const expected = Buffer.from(sign(input.secret, timestamp, input.body));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return { ok: false, reason: 'bad_signature' };
	}
	return { ok: true };
}

/**
 * Remembers delivery ids so a redelivered event (delivery is at least once)
 * starts the workflow only once. Returns false for an id seen before.
 */
export function rememberDelivery(store: { deliveries?: unknown }, id: string, max = 200): boolean {
	if (!id) return true;
	const seen = Array.isArray(store.deliveries) ? (store.deliveries as string[]) : [];
	if (seen.includes(id)) return false;
	seen.push(id);
	store.deliveries = seen.slice(-max);
	return true;
}
