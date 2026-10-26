/**
 * Starts a real OpenTodo server in Docker for the end-to-end tests, creates the
 * owner account and API tokens, and allows private webhook targets (the
 * receivers run on this machine or on the same Docker network).
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const OT_IMAGE = process.env.E2E_OT_IMAGE ?? 'ghcr.io/pixari/opentodo:0.13.0';
export const PREFIX = process.env.E2E_PREFIX ?? 'n8n-ot-e2e';
export const KEEP = process.env.E2E_KEEP === '1';

export function sh(args: string[], check = true): string {
	try {
		return execFileSync(args[0], args.slice(1), {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (error) {
		if (check)
			throw new Error(
				`${args.join(' ')} failed: ${(error as { stderr?: string }).stderr ?? error}`,
			);
		return '';
	}
}

export function step(message: string): void {
	process.stdout.write(`[e2e] ${message}\n`);
}

export async function waitFor<T>(
	what: string,
	probe: () => Promise<T | undefined>,
	timeoutMs = 60_000,
): Promise<T> {
	const until = Date.now() + timeoutMs;
	let last: unknown;
	while (Date.now() < until) {
		try {
			const value = await probe();
			if (value !== undefined) return value;
		} catch (error) {
			last = error;
		}
		await sleep(250);
	}
	throw new Error(`timed out waiting for ${what}${last ? `: ${last}` : ''}`);
}

export interface OpenTodoServer {
	/** Address from this machine. */
	url: string;
	/** Container name (its address on a shared Docker network). */
	container: string;
	fullToken: string;
	readToken: string;
	/** A Bearer request as a test fixture, outside the node under test. */
	api: (
		method: string,
		path: string,
		body?: unknown,
		token?: string,
	) => Promise<{ status: number; body: any }>;
	stop: () => void;
}

export async function startOpenTodo(options: {
	name: string;
	port: number;
	network?: string;
}): Promise<OpenTodoServer> {
	const container = `${PREFIX}-${options.name}`;
	sh(['docker', 'rm', '-f', container], false);
	const args = ['docker', 'run', '-d', '--name', container, '-p', `127.0.0.1:${options.port}:8080`];
	args.push('--add-host', 'host.docker.internal:host-gateway');
	if (options.network) args.push('--network', options.network);
	sh([...args, OT_IMAGE]);
	const url = `http://127.0.0.1:${options.port}`;
	step(`OpenTodo ${OT_IMAGE} starting at ${url}`);
	await waitFor('OpenTodo /healthz', async () =>
		(await fetch(`${url}/healthz`)).ok ? true : undefined,
	);

	const register = await fetch(`${url}/api/v1/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email: 'owner@example.com',
			name: 'Owner',
			password: 'correct horse battery staple',
		}),
	});
	if (register.status !== 201)
		throw new Error(`register: ${register.status} ${await register.text()}`);
	const cookie = register.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	const session = async (method: string, path: string, body: unknown) => {
		const res = await fetch(`${url}/api/v1${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
		return JSON.parse(text);
	};
	const fullToken = (await session('POST', '/tokens', { name: 'n8n', scope: 'full' }))
		.secret as string;
	const readToken = (await session('POST', '/tokens', { name: 'n8n read', scope: 'read' }))
		.secret as string;
	await session('PUT', '/settings/webhooks', { allowPrivate: true });

	const api: OpenTodoServer['api'] = async (method, path, body, token = fullToken) => {
		const res = await fetch(`${url}/api/v1${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		return { status: res.status, body: text ? JSON.parse(text) : undefined };
	};

	return {
		url,
		container,
		fullToken,
		readToken,
		api,
		stop: () => {
			if (!KEEP) sh(['docker', 'rm', '-f', container], false);
		},
	};
}
