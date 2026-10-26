/**
 * End-to-end in a real n8n: the packed package is installed into an n8n image
 * the way Settings → Community nodes does, next to a real OpenTodo server on a
 * private Docker network.
 *
 * 1. A manual workflow (create with quick-add → get → complete) runs with
 *    `n8n execute` and changes the task in OpenTodo.
 * 2. A published workflow "OpenTodo Trigger → add a comment" is activated by
 *    `n8n start`: the trigger registers its webhook in OpenTodo, OpenTodo
 *    delivers a signed task.created to n8n, n8n's own request handling feeds
 *    the raw body to the signature check, and the workflow comments on the
 *    task. A forged delivery is refused with 401.
 *
 * Needs Docker. Environment: E2E_N8N_IMAGE, E2E_OT_IMAGE, E2E_PREFIX,
 * E2E_KEEP=1 to keep the containers.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	KEEP,
	type OpenTodoServer,
	PREFIX,
	sh,
	startOpenTodo,
	step,
	waitFor,
} from './support/opentodo.mts';

const N8N_IMAGE = process.env.E2E_N8N_IMAGE ?? 'docker.n8n.io/n8nio/n8n:2.44.7';
const OT_PORT = Number(process.env.E2E_OT_PORT ?? 19311);
const N8N_PORT = Number(process.env.E2E_N8N_PORT ?? 19312);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NET = `${PREFIX}-net`;
const N8N = `${PREFIX}-n8n`;
const VOLUME = `${PREFIX}-n8n-data`;
const IMAGE = `${PREFIX}-n8n-image:latest`;
const KEY = 'e2e-only-encryption-key-0123456789';
const CREDENTIAL = { id: 'otE2eCredential1', name: 'OpenTodo E2E' };
const MANUAL_ID = 'otE2eManual00001';
const TRIGGER_ID = 'otE2eTrigger0001';

let ot: OpenTodoServer;
let work = '';

function n8nEnv(): string[] {
	return [
		'-e',
		`N8N_ENCRYPTION_KEY=${KEY}`,
		'-e',
		`N8N_WEBHOOK_URL=http://${N8N}:5678/`,
		'-e',
		'N8N_DIAGNOSTICS_ENABLED=false',
		'-e',
		'N8N_PERSONALIZATION_ENABLED=false',
		'-e',
		'GENERIC_TIMEZONE=Europe/Rome',
		'-e',
		'TZ=Europe/Rome',
	];
}

/** Runs an n8n CLI command against the data volume, on the test network. */
function n8nCli(...args: string[]): string {
	return sh([
		'docker',
		'run',
		'--rm',
		'--network',
		NET,
		'-v',
		`${VOLUME}:/home/node/.n8n`,
		'-v',
		`${work}:/import:ro`,
		...n8nEnv(),
		'--entrypoint',
		'n8n',
		IMAGE,
		...args,
	]);
}

function cleanup(): void {
	sh(['docker', 'rm', '-f', N8N], false);
	ot?.stop();
	if (KEEP) return;
	sh(['docker', 'volume', 'rm', '-f', VOLUME], false);
	sh(['docker', 'network', 'rm', NET], false);
}

function opentodoNode(
	name: string,
	position: [number, number],
	parameters: Record<string, unknown>,
) {
	return {
		id: randomUUID(),
		name,
		type: 'n8n-nodes-opentodo.openTodo',
		typeVersion: 1,
		position,
		parameters,
		credentials: { openTodoApi: CREDENTIAL },
	};
}

function writeImports(): void {
	const manual = {
		id: MANUAL_ID,
		name: 'OpenTodo e2e: create, get, complete',
		active: false,
		settings: { executionOrder: 'v1' },
		nodes: [
			{
				id: randomUUID(),
				name: 'Start',
				type: 'n8n-nodes-base.manualTrigger',
				typeVersion: 1,
				position: [0, 0],
				parameters: {},
			},
			opentodoNode('Create', [220, 0], {
				resource: 'task',
				operation: 'create',
				title: 'Created by n8n tomorrow #Garden p2 @outside',
				quickAdd: true,
				additionalFields: { description: 'From a workflow' },
			}),
			opentodoNode('Get', [440, 0], {
				resource: 'task',
				operation: 'get',
				taskId: '={{ $json.id }}',
			}),
			opentodoNode('Complete', [660, 0], {
				resource: 'task',
				operation: 'complete',
				taskId: '={{ $json.id }}',
			}),
		],
		connections: {
			Start: { main: [[{ node: 'Create', type: 'main', index: 0 }]] },
			Create: { main: [[{ node: 'Get', type: 'main', index: 0 }]] },
			Get: { main: [[{ node: 'Complete', type: 'main', index: 0 }]] },
		},
	};
	const trigger = {
		id: TRIGGER_ID,
		name: 'OpenTodo e2e: comment on new tasks',
		active: false,
		settings: { executionOrder: 'v1' },
		nodes: [
			{
				id: randomUUID(),
				name: 'OpenTodo Trigger',
				type: 'n8n-nodes-opentodo.openTodoTrigger',
				typeVersion: 1,
				position: [0, 0],
				webhookId: randomUUID(),
				parameters: { events: ['task.created'], options: {} },
				credentials: { openTodoApi: CREDENTIAL },
			},
			opentodoNode('Comment', [220, 0], {
				resource: 'comment',
				operation: 'add',
				taskId: '={{ $json.data.task.id }}',
				commentBody: '=seen by n8n: {{ $json.event }} {{ $json.data.task.title }}',
				additionalFields: {},
			}),
		],
		connections: { 'OpenTodo Trigger': { main: [[{ node: 'Comment', type: 'main', index: 0 }]] } },
	};
	const credentials = [
		{
			...CREDENTIAL,
			type: 'openTodoApi',
			data: { serverUrl: `http://${ot.container}:8080`, apiToken: ot.fullToken },
		},
	];
	for (const [file, content] of Object.entries({
		'credentials.json': credentials,
		'manual.json': manual,
		'trigger.json': trigger,
	})) {
		writeFileSync(join(work, file), JSON.stringify(content, null, 2));
		chmodSync(join(work, file), 0o644);
	}
}

beforeAll(async () => {
	cleanup();
	work = mkdtempSync(join(tmpdir(), 'n8n-ot-e2e-'));
	chmodSync(work, 0o755);

	step('packing the package and building the n8n image');
	const tarball = sh(['npm', 'pack', '--silent', '--pack-destination', work], true)
		.split('\n')
		.pop()!;
	sh(['tar', '-xzf', join(work, tarball), '-C', work]);
	cpSync(join(ROOT, 'tests_e2e', 'n8n', 'Dockerfile'), join(work, 'Dockerfile'));
	sh(['docker', 'build', '-q', '--build-arg', `N8N_IMAGE=${N8N_IMAGE}`, '-t', IMAGE, work]);

	sh(['docker', 'network', 'create', NET]);
	sh(['docker', 'volume', 'create', VOLUME]);
	ot = await startOpenTodo({ name: 'ot-n8n', port: OT_PORT, network: NET });
	for (const name of ['Garden', 'Inbox work']) await ot.api('POST', '/projects', { name });

	writeImports();
	step('importing the credential and workflows into n8n');
	n8nCli('import:credentials', '--input=/import/credentials.json');
	n8nCli('import:workflow', '--input=/import/manual.json');
	n8nCli('import:workflow', '--input=/import/trigger.json');
	n8nCli('publish:workflow', `--id=${TRIGGER_ID}`);
}, 600_000);

afterAll(() => {
	if (!KEEP) {
		const logs = sh(['docker', 'logs', '--tail', '80', N8N], false);
		if (logs) step(`n8n log tail:\n${logs}`);
	}
	cleanup();
	if (work && !KEEP) rmSync(work, { recursive: true, force: true });
});

describe('the package in a real n8n', () => {
	it('runs a manual workflow: create with quick-add, get, complete', async () => {
		const output = n8nCli('execute', `--id=${MANUAL_ID}`, '--rawOutput');
		step(`n8n execute printed ${output.length} characters`);
		const tasks = (await ot.api('GET', '/tasks?include_deleted=true')).body.tasks as Array<
			Record<string, any>
		>;
		const task = tasks.find((t) => t.title === 'Created by n8n');
		expect(task, output.slice(-2000)).toBeDefined();
		const projects = (await ot.api('GET', '/projects')).body.projects as Array<Record<string, any>>;
		const labels = (await ot.api('GET', '/labels')).body.labels as Array<Record<string, any>>;
		expect(task).toMatchObject({
			description: 'From a workflow',
			project_id: projects.find((p) => p.name === 'Garden')!.id,
			priority: 2,
			labels: [labels.find((l) => l.name === 'outside')!.id],
		});
		expect(task!.due?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(task!.completed_at).toEqual(expect.any(Number));
	});

	it('activates the trigger: OpenTodo delivers a signed event and the workflow runs', async () => {
		sh([
			'docker',
			'run',
			'-d',
			'--name',
			N8N,
			'--network',
			NET,
			'-p',
			`127.0.0.1:${N8N_PORT}:5678`,
			'-v',
			`${VOLUME}:/home/node/.n8n`,
			...n8nEnv(),
			IMAGE,
		]);
		step('n8n starting');
		await waitFor(
			'n8n /healthz',
			async () => ((await fetch(`http://127.0.0.1:${N8N_PORT}/healthz`)).ok ? true : undefined),
			180_000,
		);

		const webhook = await waitFor(
			'the trigger to register its webhook in OpenTodo',
			async () => {
				const list = (await ot.api('GET', '/webhooks')).body.webhooks as Array<Record<string, any>>;
				return list.find((w) => String(w.url).startsWith(`http://${N8N}:5678/`));
			},
			120_000,
		);
		expect(webhook).toMatchObject({ events: ['task.created'], enabled: true });

		const created = (await ot.api('POST', '/tasks', { title: 'Hello from OpenTodo' })).body;
		const comments = await waitFor(
			'the workflow to comment on the new task',
			async () => {
				const list = (await ot.api('GET', `/tasks/${created.id}/comments`)).body.comments as Array<
					Record<string, any>
				>;
				return list.length > 0 ? list : undefined;
			},
			90_000,
		);
		expect(comments.map((c) => c.body)).toEqual(['seen by n8n: task.created Hello from OpenTodo']);

		const deliveries = (await ot.api('GET', `/webhooks/${webhook.id}/deliveries`)).body
			.deliveries as Array<Record<string, any>>;
		expect(deliveries[0]).toMatchObject({
			event: 'task.created',
			status: 'delivered',
			statusCode: 200,
		});

		// A delivery that OpenTodo did not sign is refused and starts nothing.
		const local = String(webhook.url).replace(`http://${N8N}:5678`, `http://127.0.0.1:${N8N_PORT}`);
		const forged = await fetch(local, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-OpenTodo-Timestamp': String(Math.floor(Date.now() / 1000)),
				'X-OpenTodo-Signature': 'v1=' + '0'.repeat(64),
			},
			body: JSON.stringify({
				version: 1,
				id: randomUUID(),
				event: 'task.created',
				data: { task: { id: created.id, title: 'forged' } },
			}),
		});
		expect(forged.status).toBe(401);
		await new Promise((r) => setTimeout(r, 2000));
		const after = (await ot.api('GET', `/tasks/${created.id}/comments`)).body.comments as unknown[];
		expect(after).toHaveLength(1);
	});
});
