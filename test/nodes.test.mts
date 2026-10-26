import type { IDataObject, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { OpenTodoApi } from '../credentials/OpenTodoApi.credentials';
import { OpenTodo } from '../nodes/OpenTodo/OpenTodo.node';
import { OpenTodoTrigger, WEBHOOK_EVENTS } from '../nodes/OpenTodoTrigger/OpenTodoTrigger.node';
import { sign } from '../nodes/OpenTodoTrigger/signature';
import { makeContext, NODE } from './support/fakeContext.mts';

function notFound(): never {
	throw new NodeApiError(NODE, {
		message: 'Request failed with status code 404',
		response: { status: 404, data: { error: { code: 'not_found', message: 'not found' } } },
	} as never);
}

describe('description', () => {
	const node = new OpenTodo();

	it('is usable as an AI tool and uses the credential', () => {
		expect(node.description.usableAsTool).toBe(true);
		expect(node.description.credentials).toEqual([{ name: 'openTodoApi', required: true }]);
		expect(new OpenTodoTrigger().description.credentials).toEqual([
			{ name: 'openTodoApi', required: true },
		]);
	});

	it('handles every operation it offers', async () => {
		const operations = node.description.properties.filter(
			(p: INodeProperties) => p.name === 'operation',
		);
		const seen: string[] = [];
		for (const property of operations) {
			const resource = (property.displayOptions?.show?.resource as string[])[0];
			for (const option of property.options as Array<{ value: string }>) {
				seen.push(`${resource}.${option.value}`);
				const { context } = makeContext({
					params: {
						resource,
						operation: option.value,
						taskId: 't1',
						projectId: 'p1',
						title: 'x',
						name: 'x',
						commentBody: 'x',
						updateFields: { title: 'y', name: 'y' },
					},
					http: async (req) =>
						req.method === 'GET'
							? { tasks: [], projects: [], labels: [], comments: [] }
							: { id: 'r' },
				});
				await expect(node.execute.call(context)).resolves.toBeDefined();
			}
		}
		expect(seen.sort()).toEqual(
			[
				'comment.add',
				'comment.getAll',
				'label.create',
				'label.getAll',
				'project.archive',
				'project.create',
				'project.get',
				'project.getAll',
				'project.update',
				'task.complete',
				'task.create',
				'task.delete',
				'task.get',
				'task.getAll',
				'task.reopen',
				'task.update',
			].sort(),
		);
	});

	it('tests the credential against GET /api/v1/me with a Bearer token', () => {
		const credential = new OpenTodoApi();
		expect(credential.test.request.url).toBe('/api/v1/me');
		expect(credential.authenticate.properties.headers).toEqual({
			Authorization: '=Bearer {{$credentials.apiToken}}',
		});
	});

	it('offers exactly the events of the webhooks API', () => {
		expect(WEBHOOK_EVENTS.map((e) => e.value)).toEqual([
			'task.created',
			'task.updated',
			'task.completed',
			'task.reopened',
			'task.deleted',
			'project.created',
			'project.updated',
			'project.archived',
			'project.deleted',
			'import.completed',
			'import.undone',
		]);
	});
});

describe('OpenTodo node', () => {
	it('sends authenticated requests to the server URL and returns one item per task', async () => {
		const requests: IHttpRequestOptions[] = [];
		const { context } = makeContext({
			params: { resource: 'task', operation: 'getAll', returnAll: true, filters: {} },
			credentials: { serverUrl: 'https://todo.example.com/api/v1/', apiToken: 'ot_abc' },
			http: async (req) => {
				requests.push(req);
				return {
					tasks: [
						{ id: 'a', labels: [], completed_at: null },
						{ id: 'b', labels: [], completed_at: null },
					],
				};
			},
		});
		const [items] = await new OpenTodo().execute.call(context);
		expect(requests[0]).toMatchObject({
			method: 'GET',
			url: 'https://todo.example.com/api/v1/tasks',
			json: true,
			headers: { Authorization: 'Bearer ot_abc' },
		});
		expect(items).toEqual([
			{ json: { id: 'a', labels: [], completed_at: null }, pairedItem: { item: 0 } },
			{ json: { id: 'b', labels: [], completed_at: null }, pairedItem: { item: 0 } },
		]);
	});

	it("shows OpenTodo's error message", async () => {
		const { context } = makeContext({
			params: { resource: 'task', operation: 'update', taskId: 't', updateFields: { priority: 1 } },
			http: async () => {
				throw new NodeApiError(NODE, {
					message: 'Request failed with status code 403',
					response: {
						status: 403,
						data: { error: { code: 'insufficient_scope', message: 'this token can only read' } },
					},
				} as never);
			},
		});
		await expect(new OpenTodo().execute.call(context)).rejects.toMatchObject({
			message: 'OpenTodo: this token can only read',
			description: 'Error code: insufficient_scope (HTTP 403)',
		});
	});

	it('continues on fail with the error as the item', async () => {
		const { context } = makeContext({
			params: { resource: 'task', operation: 'get', taskId: '' },
			continueOnFail: true,
			http: async () => ({}),
		});
		const [items] = await new OpenTodo().execute.call(context);
		expect(items).toEqual([{ json: { error: 'Task ID is required' }, pairedItem: { item: 0 } }]);
	});

	it('loads projects with an Inbox entry, labels and sections', async () => {
		const { context } = makeContext({
			http: async (req) => {
				if (req.url.endsWith('/projects'))
					return {
						projects: [
							{ id: 'p2', name: 'Work' },
							{ id: 'p1', name: 'Home' },
							{ id: 'p3', name: 'Old', archived: true },
						],
					};
				if (req.url.endsWith('/labels')) return { labels: [{ id: 'l1', name: 'errands' }] };
				return { sections: [{ id: 's1', name: 'Doing', project_id: 'p2' }] };
			},
		});
		const loaders = new OpenTodo().methods.loadOptions;
		expect(await loaders.getProjects.call(context)).toEqual([
			{ name: 'Inbox (No Project)', value: 'inbox' },
			{ name: 'Home', value: 'p1' },
			{ name: 'Work', value: 'p2' },
		]);
		expect(await loaders.getLabels.call(context)).toEqual([{ name: 'errands', value: 'l1' }]);
		expect(await loaders.getSections.call(context)).toEqual([
			{ name: 'Work / Doing', value: 's1' },
		]);
	});
});

describe('OpenTodo Trigger', () => {
	const trigger = new OpenTodoTrigger();
	const hooks = trigger.webhookMethods.default;
	const URL = 'https://n8n.example.com/webhook/abc/webhook';

	it('creates the webhook and keeps its id and secret', async () => {
		const requests: IHttpRequestOptions[] = [];
		const { context, staticData } = makeContext({
			params: { events: ['task.created', 'task.completed'], options: { projectId: 'p1' } },
			webhookUrl: URL,
			http: async (req) => {
				requests.push(req);
				return {
					webhook: {
						id: 'w1',
						url: URL,
						events: ['task.created', 'task.completed'],
						secret: 'whsec_x',
					},
				};
			},
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(await hooks.create.call(context)).toBe(true);
		expect(requests[0]).toMatchObject({
			method: 'POST',
			url: 'https://todo.example.com/api/v1/webhooks',
			body: { url: URL, events: ['task.created', 'task.completed'], projectId: 'p1' },
		});
		expect(staticData).toMatchObject({ webhookId: 'w1', secret: 'whsec_x', deliveries: [] });
	});

	it('finds an unchanged webhook and replaces a changed or disabled one', async () => {
		const remote = {
			id: 'w1',
			url: URL,
			events: ['task.completed', 'task.created'],
			projectId: null,
			enabled: true,
		};
		const requests: string[] = [];
		const run = async (over: IDataObject) => {
			requests.length = 0;
			const { context, staticData } = makeContext({
				params: { events: ['task.created', 'task.completed'], options: {} },
				webhookUrl: URL,
				staticData: { webhookId: 'w1', secret: 'whsec_x' },
				http: async (req) => {
					requests.push(`${req.method} ${req.url}`);
					return req.method === 'GET' ? { webhook: { ...remote, ...over } } : undefined;
				},
			});
			return { exists: await hooks.checkExists.call(context), staticData };
		};
		expect((await run({})).exists).toBe(true);
		expect(requests).toEqual(['GET https://todo.example.com/api/v1/webhooks/w1']);

		for (const change of [
			{ enabled: false },
			{ url: 'https://elsewhere/x' },
			{ events: ['task.created'] },
			{ projectId: 'p9' },
		]) {
			const { exists, staticData } = await run(change);
			expect(exists).toBe(false);
			expect(requests).toContain('DELETE https://todo.example.com/api/v1/webhooks/w1');
			expect(staticData.webhookId).toBeUndefined();
		}
	});

	it('treats a webhook deleted in OpenTodo as missing', async () => {
		const { context, staticData } = makeContext({
			params: { events: ['task.created'] },
			staticData: { webhookId: 'w1', secret: 'whsec_x' },
			http: async () => notFound(),
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(staticData.secret).toBeUndefined();
		// delete tolerates a webhook that is already gone
		expect(
			await hooks.delete.call(
				makeContext({ staticData: { webhookId: 'w1' }, http: async () => notFound() }).context,
			),
		).toBe(true);
	});

	it('deletes the webhook on deactivation', async () => {
		const requests: string[] = [];
		const { context, staticData } = makeContext({
			staticData: { webhookId: 'w1', secret: 'whsec_x', deliveries: ['d'] },
			http: async (req) => {
				requests.push(`${req.method} ${req.url}`);
				return undefined;
			},
		});
		expect(await hooks.delete.call(context)).toBe(true);
		expect(requests).toEqual(['DELETE https://todo.example.com/api/v1/webhooks/w1']);
		expect(staticData).toEqual({});
	});

	function delivery(
		body: IDataObject,
		secret = 'whsec_x',
		timestamp = Math.floor(Date.now() / 1000),
	) {
		const raw = Buffer.from(JSON.stringify(body));
		return {
			headers: {
				'x-opentodo-timestamp': String(timestamp),
				'x-opentodo-signature': sign(secret, String(timestamp), raw),
				'x-opentodo-delivery': String(body.id),
			},
			rawBody: raw,
		};
	}

	const event = {
		version: 1,
		id: 'd1',
		event: 'task.completed',
		data: { task: { id: 't1', title: 'Water plants' } },
	};

	it('starts the workflow for a signed delivery, once per delivery id', async () => {
		const staticData: IDataObject = { webhookId: 'w1', secret: 'whsec_x' };
		const first = makeContext({
			params: { options: {} },
			staticData,
			request: delivery(event),
			http: async () => ({}),
		});
		expect(await trigger.webhook.call(first.context)).toEqual({
			workflowData: [[{ json: event }]],
		});

		const again = makeContext({
			params: { options: {} },
			staticData,
			request: delivery(event),
			http: async () => ({}),
		});
		expect(await trigger.webhook.call(again.context)).toEqual({
			webhookResponse: { ok: true, ignored: 'duplicate' },
		});
	});

	it('answers 401 to a bad or stale signature without starting the workflow', async () => {
		const staticData: IDataObject = { webhookId: 'w1', secret: 'whsec_x' };
		for (const request of [delivery(event, 'whsec_wrong'), delivery(event, 'whsec_x', 1000)]) {
			const { context, response } = makeContext({
				params: { options: {} },
				staticData,
				request,
				http: async () => ({}),
			});
			expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
			expect(response.statusCode).toBe(401);
		}
		expect(staticData.deliveries).toBeUndefined();
	});

	it('accepts an old delivery when the tolerance is off', async () => {
		const { context } = makeContext({
			params: { options: { toleranceSeconds: 0 } },
			staticData: { secret: 'whsec_x' },
			request: delivery(event, 'whsec_x', 1000),
			http: async () => ({}),
		});
		expect(await trigger.webhook.call(context)).toHaveProperty('workflowData');
	});

	it('acknowledges pings unless asked to emit them', async () => {
		const ping = { version: 1, id: 'p1', event: 'ping', data: {} };
		const quiet = makeContext({
			params: { options: {} },
			staticData: { secret: 'whsec_x' },
			request: delivery(ping),
			http: async () => ({}),
		});
		expect(await trigger.webhook.call(quiet.context)).toEqual({
			webhookResponse: { ok: true, ignored: 'ping' },
		});
		const loud = makeContext({
			params: { options: { includePing: true } },
			staticData: { secret: 'whsec_x' },
			request: delivery(ping),
			http: async () => ({}),
		});
		expect(await trigger.webhook.call(loud.context)).toEqual({ workflowData: [[{ json: ping }]] });
	});
});
