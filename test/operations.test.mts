import { describe, expect, it } from 'vitest';

import type { OperationContext } from '../nodes/OpenTodo/shared/operations';
import { runOperation } from '../nodes/OpenTodo/shared/operations';
import type { ApiRequest } from '../nodes/OpenTodo/shared/transport';

const NOW = Date.UTC(2026, 9, 26, 8, 0);

/** A requester that records calls and answers from a route table. */
function fake(
	params: Record<string, unknown>,
	routes: Record<string, (req: ApiRequest) => unknown> = {},
) {
	const calls: ApiRequest[] = [];
	let n = 0;
	const ctx: OperationContext = {
		param: (name, fallback) => (name in params ? params[name] : fallback),
		now: () => NOW,
		timeZone: 'Europe/Rome',
		request: async (req) => {
			calls.push(req);
			const route = routes[`${req.method} ${req.path}`];
			if (route) return route(req);
			if (req.method === 'POST') return { id: `new-${++n}`, ...req.body };
			if (req.method === 'DELETE') return undefined;
			return { id: req.path.split('/').pop(), ...req.body };
		},
	};
	return { ctx, calls };
}

describe('task', () => {
	it('creates a task with the mapped fields and an idempotency key', async () => {
		const { ctx, calls } = fake({
			title: 'Call the plumber',
			additionalFields: {
				projectId: 'p1',
				priority: 2,
				dueDate: '2026-11-02',
				dueTime: '09:00',
				idempotencyKey: 'k1',
			},
		});
		const task = await runOperation(ctx, 'task', 'create');
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/tasks',
				body: {
					title: 'Call the plumber',
					project_id: 'p1',
					priority: 2,
					due: { date: '2026-11-02', time: '09:00' },
				},
				headers: { 'Idempotency-Key': 'k1' },
			},
		]);
		expect(task).toMatchObject({ id: 'new-1', title: 'Call the plumber' });
	});

	it('parses quick-add text, creates missing labels and reminders', async () => {
		const { ctx, calls } = fake(
			{
				title: 'milk tomorrow 9am #Home p1 @errands @shop',
				quickAdd: true,
				additionalFields: { priority: 3 },
			},
			{
				'POST /quick-add/parse': () => ({
					title: 'milk',
					fields: {
						due: { date: '2026-10-27', time: '09:00' },
						project_id: 'home',
						priority: 1,
						labels: [{ id: 'l-shop', name: 'shop' }, { name: 'errands' }],
						reminders: [
							{ kind: 'relative', offset_minutes: -30 },
							{ kind: 'absolute', date: '2026-10-27', time: '08:00' },
						],
					},
					chips: [],
					unmatched: [],
					origin: null,
				}),
				'POST /labels': () => ({ id: 'l-errands', name: 'errands' }),
				'POST /tasks': (req) => ({ id: 't1', ...req.body }),
			},
		);
		const task = await runOperation(ctx, 'task', 'create');
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'POST /quick-add/parse',
			'POST /labels',
			'POST /tasks',
			'POST /reminders',
			'POST /reminders',
		]);
		// today and now in the workflow's zone (Rome is UTC+1 on 26 October 2026)
		expect(calls[0].body).toEqual({
			line: 'milk tomorrow 9am #Home p1 @errands @shop',
			today: '2026-10-26',
			now: '09:00',
		});
		expect(calls[1].body).toEqual({ name: 'errands' });
		expect(calls[2].body).toEqual({
			title: 'milk',
			due: { date: '2026-10-27', time: '09:00' },
			project_id: 'home',
			priority: 3,
			labels: ['l-shop', 'l-errands'],
		});
		expect(calls[3].body).toEqual({ task_id: 't1', kind: 'relative', offset_minutes: -30 });
		expect(calls[4].body).toEqual({
			task_id: 't1',
			kind: 'absolute',
			fire_at: Date.UTC(2026, 9, 27, 7, 0),
		});
		expect(task).toMatchObject({ id: 't1', title: 'milk' });
	});

	const list = {
		'GET /tasks': () => ({
			tasks: [
				{ id: 'a', title: 'A', project_id: null, labels: [], completed_at: null, due: null },
				{
					id: 'b',
					title: 'B',
					project_id: 'p',
					labels: ['l'],
					completed_at: null,
					due: { date: '2026-11-01' },
				},
				{ id: 'c', title: 'C', project_id: 'p', labels: [], completed_at: 5, due: null },
				{
					id: 'd',
					title: 'D',
					project_id: 'p',
					labels: [],
					completed_at: null,
					due: { date: '2026-11-03' },
				},
			],
		}),
	};

	it('gets many open tasks with a limit', async () => {
		const { ctx, calls } = fake({ returnAll: false, limit: 2 }, list);
		const result = (await runOperation(ctx, 'task', 'getAll')) as Array<{ id: string }>;
		expect(result.map((t) => t.id)).toEqual(['a', 'b']);
		expect(calls).toEqual([{ method: 'GET', path: '/tasks', qs: undefined }]);
	});

	it('gets all tasks matching the filters', async () => {
		const { ctx } = fake(
			{ returnAll: true, filters: { projectId: 'p', dueFrom: '2026-11-01' } },
			list,
		);
		const result = (await runOperation(ctx, 'task', 'getAll')) as Array<{ id: string }>;
		expect(result.map((t) => t.id)).toEqual(['b', 'd']);
	});

	it('sends a completed range to the server in the workflow zone', async () => {
		const { ctx, calls } = fake(
			{
				returnAll: true,
				filters: { completedAfter: '2026-10-19T00:00:00', completedBefore: '2026-10-26' },
			},
			list,
		);
		const result = (await runOperation(ctx, 'task', 'getAll')) as Array<{ id: string }>;
		expect(calls[0].qs).toEqual({
			completed_after: '2026-10-19',
			completed_before: '2026-10-26',
			timezone: 'Europe/Rome',
		});
		expect(result.map((t) => t.id)).toEqual(['c']);
	});

	it('gets, updates, completes, reopens and deletes', async () => {
		const { ctx, calls } = fake({ taskId: 'a b', updateFields: { title: 'New', clearDue: true } });
		await runOperation(ctx, 'task', 'get');
		await runOperation(ctx, 'task', 'update');
		await runOperation(ctx, 'task', 'complete');
		await runOperation(ctx, 'task', 'reopen');
		expect(await runOperation(ctx, 'task', 'delete')).toEqual({ id: 'a b', deleted: true });
		expect(calls).toEqual([
			{ method: 'GET', path: '/tasks/a%20b' },
			{ method: 'PATCH', path: '/tasks/a%20b', body: { title: 'New', due: null } },
			{ method: 'PATCH', path: '/tasks/a%20b', body: { completed_at: NOW } },
			{ method: 'PATCH', path: '/tasks/a%20b', body: { completed_at: null } },
			{ method: 'DELETE', path: '/tasks/a%20b' },
		]);
	});

	it('refuses an update without fields and a missing id', async () => {
		await expect(
			runOperation(fake({ taskId: 't', updateFields: {} }).ctx, 'task', 'update'),
		).rejects.toThrow(/at least one/);
		await expect(runOperation(fake({}).ctx, 'task', 'get')).rejects.toThrow(/Task ID is required/);
	});
});

describe('project', () => {
	it('creates, updates and archives', async () => {
		const { ctx, calls } = fake({
			name: 'Home',
			projectId: 'p1',
			additionalFields: { color: '#ff0000', parentId: '' },
			updateFields: { name: 'House', archived: false },
		});
		await runOperation(ctx, 'project', 'create');
		await runOperation(ctx, 'project', 'update');
		await runOperation(ctx, 'project', 'archive');
		await runOperation(ctx, 'project', 'get');
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/projects',
				body: { name: 'Home', color: '#ff0000', parent_id: null },
			},
			{ method: 'PATCH', path: '/projects/p1', body: { name: 'House', archived: false } },
			{ method: 'PATCH', path: '/projects/p1', body: { archived: true } },
			{ method: 'GET', path: '/projects/p1' },
		]);
	});

	it('leaves archived projects out unless asked', async () => {
		const routes = {
			'GET /projects': () => ({ projects: [{ id: 'a' }, { id: 'b', archived: true }] }),
		};
		const open = (await runOperation(
			fake({ returnAll: true }, routes).ctx,
			'project',
			'getAll',
		)) as Array<{ id: string }>;
		expect(open.map((p) => p.id)).toEqual(['a']);
		const all = (await runOperation(
			fake({ returnAll: true, filters: { includeArchived: true } }, routes).ctx,
			'project',
			'getAll',
		)) as Array<{ id: string }>;
		expect(all.map((p) => p.id)).toEqual(['a', 'b']);
	});
});

describe('label and comment', () => {
	it('creates and lists labels', async () => {
		const routes = { 'GET /labels': () => ({ labels: [{ id: '1' }, { id: '2' }, { id: '3' }] }) };
		const { ctx, calls } = fake(
			{ name: 'errands', additionalFields: { color: '#00ff00' }, limit: 2 },
			routes,
		);
		await runOperation(ctx, 'label', 'create');
		expect(calls[0]).toEqual({
			method: 'POST',
			path: '/labels',
			body: { name: 'errands', color: '#00ff00' },
		});
		expect(await runOperation(ctx, 'label', 'getAll')).toHaveLength(2);
	});

	it('adds and lists comments', async () => {
		const routes = { 'GET /tasks/t1/comments': () => ({ comments: [{ id: 'c1' }] }) };
		const { ctx, calls } = fake(
			{
				taskId: 't1',
				commentBody: 'Done **today**',
				additionalFields: { parentId: 'c0' },
				returnAll: true,
			},
			routes,
		);
		await runOperation(ctx, 'comment', 'add');
		expect(calls[0]).toEqual({
			method: 'POST',
			path: '/tasks/t1/comments',
			body: { body: 'Done **today**', parent_id: 'c0' },
		});
		expect(await runOperation(ctx, 'comment', 'getAll')).toEqual([{ id: 'c1' }]);
	});

	it('refuses unknown resources and operations', async () => {
		await expect(runOperation(fake({}).ctx, 'nope', 'get')).rejects.toThrow(/not supported/);
		await expect(runOperation(fake({ taskId: 't' }).ctx, 'task', 'nope')).rejects.toThrow(
			/not supported/,
		);
	});
});
