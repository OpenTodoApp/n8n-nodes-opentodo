/**
 * A minimal stand-in for the n8n execution context (IExecuteFunctions,
 * IHookFunctions, IWebhookFunctions, ILoadOptionsFunctions), enough to run the
 * nodes' real code in tests. `http` receives the request exactly as the node
 * builds it, after the credential's Bearer header was added, like n8n's
 * httpRequestWithAuthentication.
 */
import type { IDataObject, IHttpRequestOptions, INode } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type Http = (options: IHttpRequestOptions) => Promise<unknown>;

export interface FakeOptions {
	params?: Record<string, unknown>;
	credentials?: { serverUrl: string; apiToken: string };
	http: Http;
	staticData?: IDataObject;
	webhookUrl?: string;
	timeZone?: string;
	items?: number;
	continueOnFail?: boolean;
	request?: { headers: Record<string, string>; rawBody?: Buffer; body?: unknown };
}

export interface FakeResponse {
	statusCode?: number;
	body?: unknown;
}

export const NODE: INode = {
	id: 'node-1',
	name: 'OpenTodo',
	type: 'n8n-nodes-opentodo.openTodo',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export function makeContext(options: FakeOptions) {
	const params = options.params ?? {};
	const credentials = options.credentials ?? {
		serverUrl: 'https://todo.example.com',
		apiToken: 'ot_test',
	};
	const staticData = options.staticData ?? {};
	const response: FakeResponse = {};
	const res = {
		status(code: number) {
			response.statusCode = code;
			return res;
		},
		json(body: unknown) {
			response.body = body;
			return res;
		},
		send(body: unknown) {
			response.body = body;
			return res;
		},
		end() {
			return res;
		},
	};

	const context = {
		getNode: () => NODE,
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, _item?: number | unknown, fallback?: unknown) => {
			// IHookFunctions/IWebhookFunctions pass (name, fallback); IExecuteFunctions (name, item, fallback).
			const fb = typeof _item === 'number' ? fallback : _item;
			return name in params ? params[name] : fb;
		},
		getInputData: () => Array.from({ length: options.items ?? 1 }, () => ({ json: {} })),
		getTimezone: () => options.timeZone ?? 'UTC',
		continueOnFail: () => options.continueOnFail ?? false,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => options.webhookUrl ?? 'https://n8n.example.com/webhook/abc/webhook',
		getRequestObject: () => ({
			headers: options.request?.headers ?? {},
			rawBody: options.request?.rawBody,
			body: options.request?.body,
		}),
		getResponseObject: () => res,
		helpers: {
			httpRequestWithAuthentication: async (_credential: string, request: IHttpRequestOptions) => {
				const headers = {
					...(request.headers ?? {}),
					Authorization: `Bearer ${credentials.apiToken}`,
				};
				return await options.http({ ...request, headers });
			},
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
	return { context: context as never, response, staticData };
}

/**
 * An `http` for makeContext that talks to a real server with fetch and fails
 * like n8n does: a non-2xx answer becomes a NodeApiError wrapping an
 * axios-style error, with the response body in `context.data`.
 */
export function fetchHttp(): Http {
	return async (options) => {
		const url = new URL(options.url);
		for (const [key, value] of Object.entries(options.qs ?? {})) {
			if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
		}
		const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
		let body: string | undefined;
		if (options.body !== undefined) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(options.body);
		}
		const answer = await fetch(url, { method: options.method ?? 'GET', headers, body });
		const text = await answer.text();
		let data: unknown = text;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			// keep the text
		}
		if (!answer.ok) {
			const axiosLike = {
				message: `Request failed with status code ${answer.status}`,
				isAxiosError: true,
				response: { status: answer.status, data },
			};
			throw new NodeApiError(NODE, axiosLike as never);
		}
		return data;
	};
}
