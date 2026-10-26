import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { errorEnvelope, normalizeBaseUrl } from './helpers';

export const CREDENTIAL = 'openTodoApi';

export interface ApiRequest {
	method: IHttpRequestMethods;
	path: string;
	body?: IDataObject;
	qs?: IDataObject;
	headers?: Record<string, string>;
}

/** One authenticated call to OpenTodo's REST API; resolves to the parsed JSON body (undefined for 204). */
export type Requester = (request: ApiRequest) => Promise<unknown>;

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

function responseBody(error: unknown): unknown {
	const e = error as {
		context?: { data?: unknown };
		response?: { body?: unknown; data?: unknown };
		cause?: { response?: { body?: unknown; data?: unknown } };
		description?: unknown;
	};
	return (
		e?.context?.data ??
		e?.response?.body ??
		e?.response?.data ??
		e?.cause?.response?.body ??
		e?.cause?.response?.data ??
		e?.description
	);
}

function statusCode(error: unknown): string | undefined {
	const e = error as {
		httpCode?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown; statusCode?: unknown };
		cause?: { response?: { status?: unknown } };
	};
	const code =
		e?.httpCode ??
		e?.statusCode ??
		e?.response?.status ??
		e?.response?.statusCode ??
		e?.cause?.response?.status;
	return code === undefined || code === null ? undefined : String(code);
}

/** A Requester bound to an n8n execution context and the OpenTodo API credential. */
export function contextRequester(context: Context): Requester {
	return async ({ method, path, body, qs, headers }) => {
		const credentials = await context.getCredentials(CREDENTIAL);
		const baseUrl = normalizeBaseUrl(String(credentials.serverUrl ?? ''));
		const options: IHttpRequestOptions = {
			method,
			url: `${baseUrl}/api/v1${path}`,
			json: true,
			headers: { Accept: 'application/json', ...(headers ?? {}) },
		};
		if (body !== undefined) options.body = body;
		if (qs !== undefined) options.qs = qs;
		try {
			return await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL, options);
		} catch (error) {
			throw apiError(context.getNode(), error);
		}
	};
}

/**
 * Turns a failed request into a NodeApiError whose message is OpenTodo's own
 * ({error:{code,message}}). n8n's request helper may already have wrapped the
 * failure in a NodeApiError (wrapping it again returns it unchanged), with the
 * response body in `context.data`.
 */
export function apiError(node: INode, error: unknown): NodeApiError {
	const envelope = errorEnvelope(responseBody(error));
	const httpCode = statusCode(error);
	const wrapped =
		error instanceof NodeApiError
			? error
			: new NodeApiError(node, error as JsonObject, { httpCode });
	if (envelope) {
		wrapped.message = `OpenTodo: ${envelope.message}`;
		wrapped.description = `Error code: ${envelope.code}${httpCode ? ` (HTTP ${httpCode})` : ''}`;
		if (httpCode) wrapped.httpCode = httpCode;
	}
	return wrapped;
}

/** n8n's own error classes pass through (with the item index); anything else is wrapped. */
export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (itemIndex !== undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(node, error as Error, itemIndex === undefined ? {} : { itemIndex });
}
