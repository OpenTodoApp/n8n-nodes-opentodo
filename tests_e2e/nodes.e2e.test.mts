/**
 * End-to-end: the nodes' real code against a real OpenTodo server.
 *
 * The OpenTodo node runs every resource and operation through a fake n8n
 * context whose HTTP helper is plain fetch; the OpenTodo Trigger registers its
 * webhook, OpenTodo delivers signed events to a receiver in this process, and
 * the trigger's webhook() checks them. Needs Docker. Run with `npm run test:e2e`.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { IDataObject } from 'n8n-workflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OpenTodo } from '../nodes/OpenTodo/OpenTodo.node';
import { OpenTodoTrigger } from '../nodes/OpenTodoTrigger/OpenTodoTrigger.node';
import { fetchHttp, makeContext } from '../test/support/fakeContext.mts';
import { type OpenTodoServer, startOpenTodo, step, waitFor } from './support/opentodo.mts';

const OT_PORT = Number(process.env.E2E_OT_PORT ?? 19301);
const TZ = 'Europe/Rome';

let ot: OpenTodoServer;
let receiver: Server;
let receiverPort = 0;
const received: Array<{ headers: Record<string, string>; rawBody: Buffer }> = [];

function today(offsetDays = 0): string {
	const at = new Date(Date.now() + offsetDays * 86_400_000);
	return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);
}

/** Runs the OpenTodo node once with these parameters and returns the output items' JSON. */
async function node(params: Record<string, unknown>, token = ot.fullToken): Promise<IDataObject[]> {
	const { context } = makeContext({
		params,
		credentials: { serverUrl: `${ot.url}/`, apiToken: token },
		http: fetchHttp(),
		timeZone: TZ,
	});
	const [items] = await new OpenTodo().execute.call(context);
	return items.map((item) => item.json);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

beforeAll(async () => {
	ot = await startOpenTodo({ name: 'nodes', port: OT_PORT });
	receiver = createServer(async (req, res) => {
		received.push({ headers: req.headers as Record<string, string>, rawBody: await readBody(req) });
		res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
	});
	await new Promise<void>((resolve) => receiver.listen(0, '0.0.0.0', resolve));
	receiverPort = (receiver.address() as AddressInfo).port;
	step(`receiver listening on ${receiverPort}`);
}, 180_000);

afterAll(async () => {
	ot?.stop();
	await new Promise<void>((resolve) => (receiver ? receiver.close(() => resolve()) : resolve()));
});

describe('OpenTodo node against a real server', () => {
	const ids: Record<string, string> = {};

	it('passes the credential test request (GET /api/v1/me)', async () => {
		const me = await ot.api('GET', '/me');
		expect(me.status).toBe(200);
		expect(me.body.auth).toMatchObject({ method: 'token', scope: 'full' });
	});

	it('creates a project and a label', async () => {
		const [project] = await node({
			resource: 'project',
			operation: 'create',
			name: 'Home',
			additionalFields: { color: '#10b981' },
		});
		expect(project).toMatchObject({ name: 'Home', color: '#10b981' });
		ids.project = String(project.id);
		const [label] = await node({
			resource: 'label',
			operation: 'create',
			name: 'errands',
			additionalFields: {},
		});
		expect(label).toMatchObject({ name: 'errands' });
		ids.label = String(label.id);
		const labels = await node({ resource: 'label', operation: 'getAll', returnAll: true });
		expect(labels.map((l) => l.id)).toContain(ids.label);
	});

	it('creates a task with every field', async () => {
		const [task] = await node({
			resource: 'task',
			operation: 'create',
			title: 'Call the plumber',
			quickAdd: false,
			additionalFields: {
				description: 'About the **sink**',
				projectId: ids.project,
				labelIds: [ids.label],
				priority: 2,
				dueDate: `${today(1)}T00:00:00`,
				dueTime: '09:30',
				deadline: today(3),
				estimateMinutes: 45,
				idempotencyKey: 'e2e-plumber',
			},
		});
		expect(task).toMatchObject({
			title: 'Call the plumber',
			description: 'About the **sink**',
			project_id: ids.project,
			labels: [ids.label],
			priority: 2,
			due: { date: today(1), time: '09:30' },
			deadline: today(3),
			estimate_minutes: 45,
		});
		ids.task = String(task.id);

		// The idempotency key makes a retry return the same task.
		const [again] = await node({
			resource: 'task',
			operation: 'create',
			title: 'Call the plumber',
			additionalFields: {
				description: 'About the **sink**',
				projectId: ids.project,
				labelIds: [ids.label],
				priority: 2,
				dueDate: `${today(1)}T00:00:00`,
				dueTime: '09:30',
				deadline: today(3),
				estimateMinutes: 45,
				idempotencyKey: 'e2e-plumber',
			},
		});
		expect(again.id).toBe(ids.task);
	});

	it('creates a task from quick-add text, with a new label and a reminder', async () => {
		const [task] = await node({
			resource: 'task',
			operation: 'create',
			title: 'Buy milk tomorrow 18:00 #Home p1 @shopping remind me 30 min before',
			quickAdd: true,
			additionalFields: {},
		});
		expect(task).toMatchObject({
			title: 'Buy milk',
			project_id: ids.project,
			priority: 1,
			due: { date: today(1), time: '18:00' },
		});
		const labels = await node({ resource: 'label', operation: 'getAll', returnAll: true });
		const shopping = labels.find((l) => l.name === 'shopping');
		expect(shopping).toBeDefined();
		expect(task.labels).toEqual([shopping!.id]);
		const reminders = (await ot.api('GET', '/reminders')).body.reminders as IDataObject[];
		expect(reminders.filter((r) => r.task_id === task.id)).toEqual([
			expect.objectContaining({ kind: 'relative', offset_minutes: -30 }),
		]);
		ids.milk = String(task.id);
	});

	it('gets a task and gets many with filters and a limit', async () => {
		const [task] = await node({ resource: 'task', operation: 'get', taskId: ids.task });
		expect(task.title).toBe('Call the plumber');

		await node({
			resource: 'task',
			operation: 'create',
			title: 'Inbox thing',
			additionalFields: {},
		});
		const inProject = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { projectId: ids.project },
		});
		expect(inProject.map((t) => t.id).sort()).toEqual([ids.task, ids.milk].sort());
		const inbox = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { projectId: 'inbox' },
		});
		expect(inbox.map((t) => t.title)).toEqual(['Inbox thing']);
		const labelled = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { labelId: ids.label },
		});
		expect(labelled.map((t) => t.id)).toEqual([ids.task]);
		const searched = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { search: 'SINK' },
		});
		expect(searched.map((t) => t.id)).toEqual([ids.task]);
		const due = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { dueFrom: today(1), dueTo: today(1) },
		});
		expect(due).toHaveLength(2);
		const one = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: false,
			limit: 1,
			filters: {},
		});
		expect(one).toHaveLength(1);
	});

	it('updates, completes and reopens a task', async () => {
		const [updated] = await node({
			resource: 'task',
			operation: 'update',
			taskId: ids.task,
			updateFields: {
				title: 'Call the plumber again',
				priority: 1,
				clearDue: true,
				projectId: 'inbox',
			},
		});
		expect(updated).toMatchObject({
			title: 'Call the plumber again',
			priority: 1,
			due: null,
			project_id: null,
		});

		const [completed] = await node({ resource: 'task', operation: 'complete', taskId: ids.task });
		expect(completed.completed_at).toEqual(expect.any(Number));
		const done = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { status: 'completed' },
		});
		expect(done.map((t) => t.id)).toEqual([ids.task]);
		const finishedToday = await node({
			resource: 'task',
			operation: 'getAll',
			returnAll: true,
			filters: { completedAfter: today(-1), completedBefore: today(1) },
		});
		expect(finishedToday.map((t) => t.id)).toEqual([ids.task]);

		const [reopened] = await node({ resource: 'task', operation: 'reopen', taskId: ids.task });
		expect(reopened.completed_at).toBeNull();
	});

	it('adds and lists comments', async () => {
		const [comment] = await node({
			resource: 'comment',
			operation: 'add',
			taskId: ids.task,
			commentBody: 'Booked for **Monday**',
			additionalFields: {},
		});
		expect(comment).toMatchObject({ body: 'Booked for **Monday**', task_id: ids.task });
		const [reply] = await node({
			resource: 'comment',
			operation: 'add',
			taskId: ids.task,
			commentBody: 'Confirmed',
			additionalFields: { parentId: comment.id },
		});
		expect(reply.parent_id).toBe(comment.id);
		const comments = await node({
			resource: 'comment',
			operation: 'getAll',
			taskId: ids.task,
			returnAll: true,
		});
		expect(comments.map((c) => c.body)).toEqual(['Booked for **Monday**', 'Confirmed']);
	});

	it('updates, lists and archives projects', async () => {
		const [project] = await node({
			resource: 'project',
			operation: 'update',
			projectId: ids.project,
			updateFields: { name: 'House', description: 'Everything at home' },
		});
		expect(project).toMatchObject({ name: 'House', description: 'Everything at home' });
		const [got] = await node({ resource: 'project', operation: 'get', projectId: ids.project });
		expect(got.name).toBe('House');
		const [archived] = await node({
			resource: 'project',
			operation: 'archive',
			projectId: ids.project,
		});
		expect(archived.archived).toBe(true);
		expect(
			(await node({ resource: 'project', operation: 'getAll', returnAll: true })).map((p) => p.id),
		).not.toContain(ids.project);
		const all = await node({
			resource: 'project',
			operation: 'getAll',
			returnAll: true,
			filters: { includeArchived: true },
		});
		expect(all.map((p) => p.id)).toContain(ids.project);
	});

	it('deletes a task to the Trash', async () => {
		expect(await node({ resource: 'task', operation: 'delete', taskId: ids.milk })).toEqual([
			{ id: ids.milk, deleted: true },
		]);
		await expect(
			node({ resource: 'task', operation: 'get', taskId: ids.milk }),
		).rejects.toMatchObject({
			message: 'OpenTodo: not found',
			httpCode: '404',
		});
		const trash = await ot.api('GET', '/tasks?include_deleted=true');
		expect(trash.body.tasks.find((t: IDataObject) => t.id === ids.milk).deleted_at).toEqual(
			expect.any(Number),
		);
	});

	it('reads with a read-only token and reports the refused write', async () => {
		const tasks = await node(
			{ resource: 'task', operation: 'getAll', returnAll: true },
			ot.readToken,
		);
		expect(tasks.length).toBeGreaterThan(0);
		await expect(
			node(
				{ resource: 'task', operation: 'create', title: 'nope', additionalFields: {} },
				ot.readToken,
			),
		).rejects.toMatchObject({
			httpCode: '403',
			description: expect.stringContaining('insufficient_scope'),
		});
	});

	it("shows the server's validation message", async () => {
		await expect(
			node({
				resource: 'task',
				operation: 'update',
				taskId: ids.task,
				updateFields: { recurrence: 'whenever I feel like it' },
			}),
		).rejects.toMatchObject({
			httpCode: '400',
			description: expect.stringContaining('invalid_input'),
		});
	});
});

describe('OpenTodo Trigger against a real server', () => {
	const trigger = new OpenTodoTrigger();
	const staticData: IDataObject = {};
	const webhookUrl = () => `http://host.docker.internal:${receiverPort}/webhook`;

	function hookContext(events: string[]) {
		return makeContext({
			params: { events, options: {} },
			credentials: { serverUrl: ot.url, apiToken: ot.fullToken },
			http: fetchHttp(),
			staticData,
			webhookUrl: webhookUrl(),
		}).context;
	}

	async function deliver(index: number) {
		const request = received[index];
		const { context, response } = makeContext({
			params: { options: {} },
			http: fetchHttp(),
			staticData,
			request: { headers: request.headers, rawBody: request.rawBody },
		});
		return { result: await trigger.webhook.call(context), response };
	}

	it('registers the webhook on activation', async () => {
		const hooks = trigger.webhookMethods.default;
		const context = hookContext(['task.created', 'task.completed']);
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(await hooks.create.call(context)).toBe(true);
		expect(String(staticData.secret)).toMatch(/^whsec_/);
		expect(await hooks.checkExists.call(context)).toBe(true);
		const remote = await ot.api('GET', `/webhooks/${staticData.webhookId}`);
		expect(remote.body.webhook).toMatchObject({ url: webhookUrl(), enabled: true });
	});

	it('accepts a signed delivery once and refuses a tampered one', async () => {
		const [task] = await node({
			resource: 'task',
			operation: 'create',
			title: 'Water plants',
			additionalFields: {},
		});
		await waitFor(
			'task.created delivery',
			async () => (received.length > 0 ? true : undefined),
			30_000,
		);
		expect(received[0].headers['x-opentodo-event']).toBe('task.created');

		const first = await deliver(0);
		const payload = (first.result.workflowData as Array<Array<{ json: IDataObject }>>)[0][0].json;
		expect(payload).toMatchObject({
			event: 'task.created',
			data: { task: { id: task.id, title: 'Water plants' } },
		});

		// A redelivery with the same id (at-least-once delivery) is acknowledged without a second run.
		expect((await deliver(0)).result).toEqual({
			webhookResponse: { ok: true, ignored: 'duplicate' },
		});

		// A changed body fails the signature check.
		received.push({
			headers: received[0].headers,
			rawBody: Buffer.from(received[0].rawBody.toString().replace('Water', 'Burn')),
		});
		const tampered = await deliver(received.length - 1);
		expect(tampered.result).toEqual({ noWebhookResponse: true });
		expect(tampered.response.statusCode).toBe(401);

		await node({ resource: 'task', operation: 'complete', taskId: task.id });
		const index = await waitFor(
			'task.completed delivery',
			async () => {
				const i = received.findIndex((r) => r.headers['x-opentodo-event'] === 'task.completed');
				return i >= 0 ? i : undefined;
			},
			30_000,
		);
		const completed = await deliver(index);
		expect(
			(completed.result.workflowData as Array<Array<{ json: IDataObject }>>)[0][0].json,
		).toMatchObject({
			event: 'task.completed',
			changes: { completed_at: { from: null } },
		});

		const log = await ot.api('GET', `/webhooks/${staticData.webhookId}/deliveries`);
		expect(log.body.deliveries.every((d: IDataObject) => d.status === 'delivered')).toBe(true);
	});

	it('acknowledges a test ping without starting the workflow', async () => {
		const before = received.length;
		const test = await ot.api('POST', `/webhooks/${staticData.webhookId}/test`);
		expect(test.body.ok).toBe(true);
		await waitFor('ping', async () => (received.length > before ? true : undefined), 10_000);
		expect((await deliver(before)).result).toEqual({
			webhookResponse: { ok: true, ignored: 'ping' },
		});
	});

	it('replaces the webhook when the events change and deletes it on deactivation', async () => {
		const hooks = trigger.webhookMethods.default;
		const oldId = String(staticData.webhookId);
		const changed = hookContext(['task.created']);
		expect(await hooks.checkExists.call(changed)).toBe(false);
		expect((await ot.api('GET', `/webhooks/${oldId}`)).status).toBe(404);
		expect(await hooks.create.call(changed)).toBe(true);
		const newId = String(staticData.webhookId);
		expect(newId).not.toBe(oldId);

		expect(await hooks.delete.call(changed)).toBe(true);
		expect((await ot.api('GET', `/webhooks/${newId}`)).status).toBe(404);
		expect(staticData.webhookId).toBeUndefined();
	});
});
