import { describe, expect, it } from 'vitest';

import { rememberDelivery, sign, verifySignature } from '../nodes/OpenTodoTrigger/signature';

// The reference vector from OpenTodo's docs/webhooks.md ("Test vector"), also
// checked by the server's TestSignatureMatchesReferenceVector.
const SECRET = 'whsec_opentodo-test-vector-secret-do-not-use';
const TIMESTAMP = '1760060001';
const BODY =
	'{"version":1,"id":"7d3c1f0e-0000-4000-8000-000000000001","event":"ping","time":1760060001000,"webhook_id":"0b9a2e4c-0000-4000-8000-000000000002","source":"server","data":{},"changes":{}}';
const SIGNATURE = 'v1=a049099332920d6f2b44a294b46fc5260f87dfc36294f77069b5ab0058589b98';

describe('sign', () => {
	it('matches the reference vector', () => {
		expect(sign(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE);
		expect(sign(SECRET, TIMESTAMP, Buffer.from(BODY))).toBe(SIGNATURE);
	});
});

describe('verifySignature', () => {
	const base = {
		secret: SECRET,
		timestamp: TIMESTAMP,
		signature: SIGNATURE,
		body: Buffer.from(BODY),
	};

	it('accepts the reference vector within the tolerance', () => {
		expect(verifySignature({ ...base, nowSeconds: 1760060001 + 299 })).toEqual({ ok: true });
	});

	it('refuses an old timestamp (replay)', () => {
		expect(verifySignature({ ...base, nowSeconds: 1760060001 + 301 })).toEqual({
			ok: false,
			reason: 'stale_timestamp',
		});
	});

	it('skips the time check when the tolerance is 0', () => {
		expect(verifySignature({ ...base, nowSeconds: 0, toleranceSeconds: 0 })).toEqual({ ok: true });
	});

	it('refuses a changed body, a wrong secret and a wrong timestamp', () => {
		const now = 1760060001;
		expect(
			verifySignature({ ...base, body: BODY.replace('ping', 'pong'), nowSeconds: now }).ok,
		).toBe(false);
		expect(verifySignature({ ...base, secret: 'whsec_other', nowSeconds: now }).ok).toBe(false);
		expect(verifySignature({ ...base, timestamp: '1760060002', nowSeconds: now }).ok).toBe(false);
	});

	it('refuses missing headers and a missing secret', () => {
		const now = 1760060001;
		expect(verifySignature({ ...base, signature: undefined, nowSeconds: now })).toEqual({
			ok: false,
			reason: 'missing_headers',
		});
		expect(verifySignature({ ...base, timestamp: 'abc', nowSeconds: now }).ok).toBe(false);
		expect(verifySignature({ ...base, secret: undefined, nowSeconds: now })).toEqual({
			ok: false,
			reason: 'missing_secret',
		});
	});

	it('refuses a signature of another length without throwing', () => {
		expect(verifySignature({ ...base, signature: 'v1=abc', nowSeconds: 1760060001 })).toEqual({
			ok: false,
			reason: 'bad_signature',
		});
	});
});

describe('rememberDelivery', () => {
	it('accepts an id once', () => {
		const store: { deliveries?: unknown } = {};
		expect(rememberDelivery(store, 'a')).toBe(true);
		expect(rememberDelivery(store, 'a')).toBe(false);
		expect(rememberDelivery(store, 'b')).toBe(true);
	});

	it('keeps only the newest ids', () => {
		const store: { deliveries?: unknown } = {};
		for (let i = 0; i < 5; i++) rememberDelivery(store, `id-${i}`, 3);
		expect(store.deliveries).toEqual(['id-2', 'id-3', 'id-4']);
		expect(rememberDelivery(store, 'id-0', 3)).toBe(true);
	});

	it('lets an event without an id through', () => {
		expect(rememberDelivery({}, '')).toBe(true);
	});
});
