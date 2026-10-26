import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { contextRequester, toNodeError } from '../OpenTodo/shared/transport';
import { rememberDelivery, verifySignature } from './signature';

/** The events OpenTodo's webhooks API accepts (docs/webhooks.md "Events"). */
export const WEBHOOK_EVENTS = [
	{ name: 'Task Created', value: 'task.created' },
	{ name: 'Task Updated', value: 'task.updated' },
	{ name: 'Task Completed', value: 'task.completed' },
	{ name: 'Task Reopened', value: 'task.reopened' },
	{ name: 'Task Deleted', value: 'task.deleted' },
	{ name: 'Project Created', value: 'project.created' },
	{ name: 'Project Updated', value: 'project.updated' },
	{ name: 'Project Archived', value: 'project.archived' },
	{ name: 'Project Deleted', value: 'project.deleted' },
	{ name: 'Import Completed', value: 'import.completed' },
	{ name: 'Import Undone', value: 'import.undone' },
];

interface HookState extends IDataObject {
	webhookId?: string;
	secret?: string;
	deliveries?: string[];
}

interface RemoteWebhook {
	id: string;
	url: string;
	events: string[];
	projectId: string | null;
	enabled: boolean;
	secret?: string;
}

function sameSet(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((v) => b.includes(v));
}

function wanted(context: IHookFunctions): {
	url: string;
	events: string[];
	projectId: string | null;
} {
	const events = context.getNodeParameter('events', []) as string[];
	const options = context.getNodeParameter('options', {}) as IDataObject;
	const projectId = String(options.projectId ?? '');
	return {
		url: context.getNodeWebhookUrl('default') as string,
		events,
		projectId: projectId === '' ? null : projectId,
	};
}

function isNotFound(error: unknown): boolean {
	return error instanceof NodeApiError && String(error.httpCode) === '404';
}

export class OpenTodoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenTodo Trigger',
		name: 'openTodoTrigger',
		icon: { light: 'file:../OpenTodo/opentodo.svg', dark: 'file:../OpenTodo/opentodo.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when tasks or projects change in OpenTodo',
		defaults: { name: 'OpenTodo Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'openTodoApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"The OpenTodo server must be able to reach this n8n instance's webhook URL. If n8n runs on a private network, the OpenTodo owner turns on Settings → Integrations → Webhooks → Allow private network targets.",
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: WEBHOOK_EVENTS,
				default: ['task.created'],
				description: 'The changes that start the workflow',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Emit Test Pings',
						name: 'includePing',
						type: 'boolean',
						default: false,
						description:
							'Whether a "ping" sent with Send test in OpenTodo starts the workflow. Off acknowledges pings without starting it.',
					},
					{
						displayName: 'Project Name or ID',
						name: 'projectId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getProjects' },
						default: '',
						description:
							'Only events for this project (its tasks and the project itself). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Timestamp Tolerance (Seconds)',
						name: 'toleranceSeconds',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 300,
						description:
							'Refuse deliveries signed longer ago than this, to stop replays. 0 turns the check off.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await contextRequester(this)({
					method: 'GET',
					path: '/projects',
				})) as IDataObject;
				const projects =
					(response.projects as Array<{ id: string; name: string; archived?: boolean }>) ?? [];
				return projects
					.filter((p) => !p.archived)
					.map((p) => ({ name: p.name, value: p.id }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as HookState;
				if (!state.webhookId || !state.secret) return false;
				const request = contextRequester(this);
				let remote: RemoteWebhook;
				try {
					const response = (await request({
						method: 'GET',
						path: `/webhooks/${encodeURIComponent(state.webhookId)}`,
					})) as { webhook: RemoteWebhook };
					remote = response.webhook;
				} catch (error) {
					if (isNotFound(error)) {
						delete state.webhookId;
						delete state.secret;
						return false;
					}
					throw toNodeError(this.getNode(), error);
				}
				const want = wanted(this);
				if (
					remote.enabled &&
					remote.url === want.url &&
					sameSet(remote.events, want.events) &&
					(remote.projectId ?? null) === want.projectId
				) {
					return true;
				}
				// Settings changed or OpenTodo disabled it after failures: start afresh.
				await request({ method: 'DELETE', path: `/webhooks/${encodeURIComponent(remote.id)}` });
				delete state.webhookId;
				delete state.secret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const want = wanted(this);
				const body: IDataObject = { url: want.url, events: want.events };
				if (want.projectId) body.projectId = want.projectId;
				const response = (await contextRequester(this)({
					method: 'POST',
					path: '/webhooks',
					body,
				})) as {
					webhook: RemoteWebhook;
				};
				const state = this.getWorkflowStaticData('node') as HookState;
				state.webhookId = response.webhook.id;
				state.secret = response.webhook.secret;
				state.deliveries = [];
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as HookState;
				if (state.webhookId) {
					try {
						await contextRequester(this)({
							method: 'DELETE',
							path: `/webhooks/${encodeURIComponent(state.webhookId)}`,
						});
					} catch (error) {
						if (!isNotFound(error)) return false;
					}
				}
				delete state.webhookId;
				delete state.secret;
				delete state.deliveries;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const state = this.getWorkflowStaticData('node') as HookState;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		if (!req.rawBody && typeof req.readRawBody === 'function') await req.readRawBody();
		const raw: Buffer | string = req.rawBody ?? JSON.stringify(req.body ?? {});
		const header = (name: string) => {
			const value = req.headers[name];
			return Array.isArray(value) ? value[0] : value;
		};

		const verdict = verifySignature({
			secret: state.secret,
			timestamp: header('x-opentodo-timestamp'),
			signature: header('x-opentodo-signature'),
			body: raw,
			nowSeconds: Math.floor(Date.now() / 1000),
			toleranceSeconds: Number(options.toleranceSeconds ?? 300),
		});
		if (!verdict.ok) {
			const res = this.getResponseObject();
			res
				.status(401)
				.json({ error: { code: verdict.reason, message: 'OpenTodo signature check failed' } });
			return { noWebhookResponse: true };
		}

		let payload: IDataObject;
		try {
			payload = JSON.parse(raw.toString()) as IDataObject;
		} catch {
			const res = this.getResponseObject();
			res.status(400).json({ error: { code: 'bad_request', message: 'body is not JSON' } });
			return { noWebhookResponse: true };
		}

		if (payload.event === 'ping' && !options.includePing) {
			return { webhookResponse: { ok: true, ignored: 'ping' } };
		}
		const deliveryId = String(payload.id ?? header('x-opentodo-delivery') ?? '');
		if (!rememberDelivery(state, deliveryId)) {
			return { webhookResponse: { ok: true, ignored: 'duplicate' } };
		}

		return { workflowData: [this.helpers.returnJsonArray(payload)] };
	}
}
