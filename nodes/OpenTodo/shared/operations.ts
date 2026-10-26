import type { IDataObject } from 'n8n-workflow';

import type { QuickAddResult, Task, TaskFieldInput, TaskFilters } from './helpers';
import {
	applyLimit,
	buildTaskBody,
	filterTasks,
	localNow,
	mergeQuickAdd,
	splitDateInput,
	zonedTimeToUtc,
} from './helpers';
import type { Requester } from './transport';

/** Reads one node parameter for the current item (getNodeParameter in n8n). */
export type ParamReader = (name: string, fallback?: unknown) => unknown;

export interface OperationContext {
	request: Requester;
	param: ParamReader;
	/** Unix milliseconds; injectable for tests. */
	now: () => number;
	/** The workflow's time zone (IANA). */
	timeZone: string;
}

export type OperationResult = IDataObject | IDataObject[];

const enc = encodeURIComponent;

function required(ctx: OperationContext, name: string, label: string): string {
	const value = String(ctx.param(name, '') ?? '').trim();
	if (value === '') throw new Error(`${label} is required`);
	return value;
}

function listOf(response: unknown, key: string): IDataObject[] {
	const list = (response as Record<string, unknown> | undefined)?.[key];
	return Array.isArray(list) ? (list as IDataObject[]) : [];
}

function limited(ctx: OperationContext, items: IDataObject[]): IDataObject[] {
	const returnAll = Boolean(ctx.param('returnAll', false));
	const limit = Number(ctx.param('limit', 50));
	return applyLimit(items, returnAll, limit);
}

function nonEmpty(body: IDataObject, what: string): IDataObject {
	if (Object.keys(body).length === 0) throw new Error(`Choose at least one ${what} to update`);
	return body;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/** Turns quick-add label names into ids, creating labels that do not exist yet (as the app does). */
async function resolveLabels(
	ctx: OperationContext,
	labels: Array<{ id?: string; name: string }>,
): Promise<string[]> {
	const ids: string[] = [];
	for (const label of labels) {
		if (label.id) {
			ids.push(label.id);
			continue;
		}
		const created = (await ctx.request({
			method: 'POST',
			path: '/labels',
			body: { name: label.name },
		})) as IDataObject;
		ids.push(String(created.id));
	}
	return ids;
}

async function createTask(ctx: OperationContext): Promise<IDataObject> {
	const title = required(ctx, 'title', 'Title');
	const fields = { ...(ctx.param('additionalFields', {}) as IDataObject) };
	const idempotencyKey = String(fields.idempotencyKey ?? '').trim();
	delete fields.idempotencyKey;
	const explicit = buildTaskBody({ title, ...(fields as TaskFieldInput) }) as IDataObject;
	const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;

	if (!ctx.param('quickAdd', false)) {
		return (await ctx.request({
			method: 'POST',
			path: '/tasks',
			body: explicit,
			headers,
		})) as IDataObject;
	}

	const { today, now } = localNow(ctx.now(), ctx.timeZone);
	const parsed = (await ctx.request({
		method: 'POST',
		path: '/quick-add/parse',
		body: { line: title, today, now },
	})) as QuickAddResult;
	const labelIds = await resolveLabels(ctx, parsed.fields?.labels ?? []);
	const body = mergeQuickAdd(parsed, explicit, labelIds) as IDataObject;
	const task = (await ctx.request({
		method: 'POST',
		path: '/tasks',
		body,
		headers,
	})) as IDataObject;

	for (const reminder of parsed.fields?.reminders ?? []) {
		if (reminder.kind === 'relative' && typeof reminder.offset_minutes === 'number') {
			await ctx.request({
				method: 'POST',
				path: '/reminders',
				body: { task_id: task.id, kind: 'relative', offset_minutes: reminder.offset_minutes },
			});
		} else if (reminder.kind === 'absolute' && reminder.date && reminder.time) {
			await ctx.request({
				method: 'POST',
				path: '/reminders',
				body: {
					task_id: task.id,
					kind: 'absolute',
					fire_at: zonedTimeToUtc(reminder.date, reminder.time, ctx.timeZone),
				},
			});
		}
	}
	return task;
}

async function getManyTasks(ctx: OperationContext): Promise<IDataObject[]> {
	const filters = { ...(ctx.param('filters', {}) as IDataObject) };
	const qs: IDataObject = {};
	if (filters.completedAfter)
		qs.completed_after = splitDateInput(String(filters.completedAfter), 'Completed after').date;
	if (filters.completedBefore) {
		qs.completed_before = splitDateInput(String(filters.completedBefore), 'Completed before').date;
	}
	const ranged = qs.completed_after !== undefined || qs.completed_before !== undefined;
	if (ranged) qs.timezone = ctx.timeZone;
	const response = await ctx.request({
		method: 'GET',
		path: '/tasks',
		qs: Object.keys(qs).length ? qs : undefined,
	});
	const status = ranged ? 'completed' : ((filters.status as TaskFilters['status']) ?? 'open');
	const tasks = filterTasks(listOf(response, 'tasks') as unknown as Task[], {
		projectId: filters.projectId as string | undefined,
		labelId: filters.labelId as string | undefined,
		parentId: filters.parentId as string | undefined,
		status,
		dueFrom: filters.dueFrom as string | undefined,
		dueTo: filters.dueTo as string | undefined,
		search: filters.search as string | undefined,
	});
	return limited(ctx, tasks as unknown as IDataObject[]);
}

async function task(ctx: OperationContext, operation: string): Promise<OperationResult> {
	switch (operation) {
		case 'create':
			return await createTask(ctx);
		case 'get': {
			const id = required(ctx, 'taskId', 'Task ID');
			return (await ctx.request({ method: 'GET', path: `/tasks/${enc(id)}` })) as IDataObject;
		}
		case 'getAll':
			return await getManyTasks(ctx);
		case 'update': {
			const id = required(ctx, 'taskId', 'Task ID');
			const fields = ctx.param('updateFields', {}) as TaskFieldInput;
			const body = nonEmpty(buildTaskBody(fields) as IDataObject, 'field');
			return (await ctx.request({
				method: 'PATCH',
				path: `/tasks/${enc(id)}`,
				body,
			})) as IDataObject;
		}
		case 'complete': {
			const id = required(ctx, 'taskId', 'Task ID');
			return (await ctx.request({
				method: 'PATCH',
				path: `/tasks/${enc(id)}`,
				body: { completed_at: ctx.now() },
			})) as IDataObject;
		}
		case 'reopen': {
			const id = required(ctx, 'taskId', 'Task ID');
			return (await ctx.request({
				method: 'PATCH',
				path: `/tasks/${enc(id)}`,
				body: { completed_at: null },
			})) as IDataObject;
		}
		case 'delete': {
			const id = required(ctx, 'taskId', 'Task ID');
			await ctx.request({ method: 'DELETE', path: `/tasks/${enc(id)}` });
			return { id, deleted: true };
		}
	}
	throw new Error(`The task operation "${operation}" is not supported`);
}

// ─── Projects ───────────────────────────────────────────────────────────────

function projectBody(fields: IDataObject): IDataObject {
	const body: IDataObject = {};
	if (fields.name !== undefined) {
		if (String(fields.name).trim() === '') throw new Error('Name must not be empty');
		body.name = String(fields.name);
	}
	if (fields.color !== undefined && fields.color !== '') body.color = String(fields.color);
	if (fields.parentId !== undefined)
		body.parent_id = fields.parentId === '' ? null : String(fields.parentId);
	if (fields.description !== undefined) body.description = String(fields.description);
	if (fields.archived !== undefined) body.archived = Boolean(fields.archived);
	return body;
}

async function project(ctx: OperationContext, operation: string): Promise<OperationResult> {
	switch (operation) {
		case 'create': {
			const name = required(ctx, 'name', 'Name');
			const body = projectBody({ ...(ctx.param('additionalFields', {}) as IDataObject), name });
			return (await ctx.request({ method: 'POST', path: '/projects', body })) as IDataObject;
		}
		case 'get': {
			const id = required(ctx, 'projectId', 'Project ID');
			return (await ctx.request({ method: 'GET', path: `/projects/${enc(id)}` })) as IDataObject;
		}
		case 'getAll': {
			const filters = ctx.param('filters', {}) as IDataObject;
			let projects = listOf(await ctx.request({ method: 'GET', path: '/projects' }), 'projects');
			if (!filters.includeArchived) projects = projects.filter((p) => !p.archived);
			return limited(ctx, projects);
		}
		case 'update': {
			const id = required(ctx, 'projectId', 'Project ID');
			const body = nonEmpty(projectBody(ctx.param('updateFields', {}) as IDataObject), 'field');
			return (await ctx.request({
				method: 'PATCH',
				path: `/projects/${enc(id)}`,
				body,
			})) as IDataObject;
		}
		case 'archive': {
			const id = required(ctx, 'projectId', 'Project ID');
			return (await ctx.request({
				method: 'PATCH',
				path: `/projects/${enc(id)}`,
				body: { archived: true },
			})) as IDataObject;
		}
	}
	throw new Error(`The project operation "${operation}" is not supported`);
}

// ─── Labels and comments ────────────────────────────────────────────────────

async function label(ctx: OperationContext, operation: string): Promise<OperationResult> {
	switch (operation) {
		case 'create': {
			const body: IDataObject = { name: required(ctx, 'name', 'Name') };
			const color = String((ctx.param('additionalFields', {}) as IDataObject).color ?? '');
			if (color) body.color = color;
			return (await ctx.request({ method: 'POST', path: '/labels', body })) as IDataObject;
		}
		case 'getAll':
			return limited(ctx, listOf(await ctx.request({ method: 'GET', path: '/labels' }), 'labels'));
	}
	throw new Error(`The label operation "${operation}" is not supported`);
}

async function comment(ctx: OperationContext, operation: string): Promise<OperationResult> {
	const taskId = required(ctx, 'taskId', 'Task ID');
	switch (operation) {
		case 'add': {
			const body: IDataObject = { body: required(ctx, 'commentBody', 'Comment') };
			const parentId = String((ctx.param('additionalFields', {}) as IDataObject).parentId ?? '');
			if (parentId) body.parent_id = parentId;
			return (await ctx.request({
				method: 'POST',
				path: `/tasks/${enc(taskId)}/comments`,
				body,
			})) as IDataObject;
		}
		case 'getAll':
			return limited(
				ctx,
				listOf(
					await ctx.request({ method: 'GET', path: `/tasks/${enc(taskId)}/comments` }),
					'comments',
				),
			);
	}
	throw new Error(`The comment operation "${operation}" is not supported`);
}

/** Runs one resource/operation for one input item. */
export async function runOperation(
	ctx: OperationContext,
	resource: string,
	operation: string,
): Promise<OperationResult> {
	switch (resource) {
		case 'task':
			return await task(ctx, operation);
		case 'project':
			return await project(ctx, operation);
		case 'label':
			return await label(ctx, operation);
		case 'comment':
			return await comment(ctx, operation);
	}
	throw new Error(`The resource "${resource}" is not supported`);
}
