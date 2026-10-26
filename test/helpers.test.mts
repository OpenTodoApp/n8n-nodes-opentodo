import { describe, expect, it } from 'vitest';

import type { Task } from '../nodes/OpenTodo/shared/helpers';
import {
	applyLimit,
	buildDue,
	buildTaskBody,
	errorEnvelope,
	filterTasks,
	localNow,
	mergeQuickAdd,
	normalizeBaseUrl,
	splitDateInput,
	zonedTimeToUtc,
} from '../nodes/OpenTodo/shared/helpers';

describe('normalizeBaseUrl', () => {
	it('strips slashes and /api/v1', () => {
		expect(normalizeBaseUrl(' https://todo.example.com/ ')).toBe('https://todo.example.com');
		expect(normalizeBaseUrl('http://192.168.1.20:8080/api/v1/')).toBe('http://192.168.1.20:8080');
		expect(normalizeBaseUrl('https://example.com/todo/')).toBe('https://example.com/todo');
	});

	it('refuses an address without a scheme', () => {
		expect(() => normalizeBaseUrl('todo.example.com')).toThrow(/http/);
	});
});

describe('dates', () => {
	it('reads a date or an ISO date-time', () => {
		expect(splitDateInput('2026-11-02')).toEqual({ date: '2026-11-02' });
		expect(splitDateInput('2026-11-02T00:00:00')).toEqual({ date: '2026-11-02' });
		expect(splitDateInput('2026-11-02T15:30:00.000+01:00')).toEqual({
			date: '2026-11-02',
			time: '15:30',
		});
	});

	it('refuses dates that do not exist', () => {
		expect(() => splitDateInput('2026-02-31')).toThrow(/date/);
		expect(() => splitDateInput('tomorrow')).toThrow(/date/);
	});

	it('builds a floating due value', () => {
		expect(buildDue('2026-11-02')).toEqual({ date: '2026-11-02' });
		expect(buildDue('2026-11-02', '09:00')).toEqual({ date: '2026-11-02', time: '09:00' });
		expect(buildDue('2026-11-02T15:30:00', '')).toEqual({ date: '2026-11-02', time: '15:30' });
		expect(buildDue('2026-11-02T15:30:00', '08:15')).toEqual({ date: '2026-11-02', time: '08:15' });
		expect(buildDue('2026-11-02', '09:00', 'Europe/Berlin')).toEqual({
			date: '2026-11-02',
			time: '09:00',
			tz: 'Europe/Berlin',
		});
	});

	it('refuses a bad time and a zone without a time', () => {
		expect(() => buildDue('2026-11-02', '25:00')).toThrow(/HH:MM/);
		expect(() => buildDue('2026-11-02', '', 'Europe/Berlin')).toThrow(/time zone/);
	});

	it('gives today and the time in a zone', () => {
		const at = Date.UTC(2026, 9, 26, 23, 30); // 23:30 UTC
		expect(localNow(at, 'UTC')).toEqual({ today: '2026-10-26', now: '23:30' });
		expect(localNow(at, 'Europe/Rome')).toEqual({ today: '2026-10-27', now: '00:30' });
	});

	it('finds the instant of a wall time, across a DST change', () => {
		expect(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 1, 7, 0));
		expect(zonedTimeToUtc('2026-12-01', '09:00', 'Europe/Berlin')).toBe(
			Date.UTC(2026, 11, 1, 8, 0),
		);
		expect(zonedTimeToUtc('2026-10-25', '12:00', 'Europe/Berlin')).toBe(
			Date.UTC(2026, 9, 25, 11, 0),
		);
		expect(zonedTimeToUtc('2026-11-02', '09:00', 'UTC')).toBe(Date.UTC(2026, 10, 2, 9, 0));
	});
});

describe('buildTaskBody', () => {
	it('maps every field to the API names', () => {
		expect(
			buildTaskBody({
				title: 'Call the plumber',
				description: 'About the **sink**',
				projectId: 'p1',
				sectionId: 's1',
				parentId: 't0',
				labelIds: ['l1', 'l2'],
				priority: 2,
				dueDate: '2026-11-02',
				dueTime: '09:00',
				deadline: '2026-11-05T00:00:00',
				estimateMinutes: 30,
				recurrence: 'every week',
				assigneeId: 'u1',
			}),
		).toEqual({
			title: 'Call the plumber',
			description: 'About the **sink**',
			project_id: 'p1',
			section_id: 's1',
			parent_id: 't0',
			labels: ['l1', 'l2'],
			priority: 2,
			due: { date: '2026-11-02', time: '09:00' },
			deadline: '2026-11-05',
			estimate_minutes: 30,
			recurrence: 'every week',
			assignee_id: 'u1',
		});
	});

	it('sends only what was set', () => {
		expect(buildTaskBody({ title: 'Milk' })).toEqual({ title: 'Milk' });
		expect(buildTaskBody({})).toEqual({});
	});

	it('maps Inbox and empty values to null, and clears', () => {
		expect(
			buildTaskBody({
				projectId: 'inbox',
				sectionId: '',
				parentId: '',
				clearDue: true,
				clearDeadline: true,
				estimateMinutes: 0,
				recurrence: '',
				assigneeId: '',
			}),
		).toEqual({
			project_id: null,
			section_id: null,
			parent_id: null,
			due: null,
			deadline: null,
			estimate_minutes: null,
			recurrence: null,
			assignee_id: null,
		});
	});

	it('accepts labels as a comma separated string (expressions, AI tools)', () => {
		expect(buildTaskBody({ labelIds: 'a, b,,c' })).toEqual({ labels: ['a', 'b', 'c'] });
	});

	it('validates priority, title and a time without a date', () => {
		expect(() => buildTaskBody({ priority: 5 })).toThrow(/Priority/);
		expect(() => buildTaskBody({ priority: '0' })).toThrow(/Priority/);
		expect(buildTaskBody({ priority: '1' })).toEqual({ priority: 1 });
		expect(() => buildTaskBody({ title: '  ' })).toThrow(/Title/);
		expect(() => buildTaskBody({ dueTime: '10:00' })).toThrow(/due date/);
	});
});

const task = (over: Partial<Task>): Task => ({
	id: 'x',
	title: 'x',
	description: '',
	project_id: null,
	parent_id: null,
	labels: [],
	priority: 4,
	due: null,
	completed_at: null,
	deleted_at: null,
	...over,
});

describe('filterTasks', () => {
	const tasks = [
		task({ id: 'inbox-open', title: 'Buy milk' }),
		task({ id: 'home-done', project_id: 'home', completed_at: 1 }),
		task({ id: 'home-due', project_id: 'home', labels: ['l1'], due: { date: '2026-11-02' } }),
		task({
			id: 'work-due',
			project_id: 'work',
			due: { date: '2026-11-10' },
			description: 'Quarterly MILK report',
		}),
		task({ id: 'sub', project_id: 'home', parent_id: 'home-due' }),
		task({ id: 'gone', deleted_at: 5 }),
	];
	const ids = (list: Task[]) => list.map((t) => t.id);

	it('returns open tasks by default and never tombstones', () => {
		expect(ids(filterTasks(tasks, {}))).toEqual(['inbox-open', 'home-due', 'work-due', 'sub']);
		expect(ids(filterTasks(tasks, { status: 'completed' }))).toEqual(['home-done']);
		expect(ids(filterTasks(tasks, { status: 'all' }))).toHaveLength(5);
	});

	it('filters by project, Inbox, label and parent', () => {
		expect(ids(filterTasks(tasks, { projectId: 'home' }))).toEqual(['home-due', 'sub']);
		expect(ids(filterTasks(tasks, { projectId: 'inbox' }))).toEqual(['inbox-open']);
		expect(ids(filterTasks(tasks, { labelId: 'l1' }))).toEqual(['home-due']);
		expect(ids(filterTasks(tasks, { parentId: 'home-due' }))).toEqual(['sub']);
	});

	it('filters by a due range, inclusive', () => {
		expect(
			ids(filterTasks(tasks, { dueFrom: '2026-11-02', dueTo: '2026-11-09T00:00:00' })),
		).toEqual(['home-due']);
		expect(ids(filterTasks(tasks, { dueFrom: '2026-11-03' }))).toEqual(['work-due']);
	});

	it('searches title and description ignoring case', () => {
		expect(ids(filterTasks(tasks, { search: 'milk' }))).toEqual(['inbox-open', 'work-due']);
	});
});

describe('applyLimit', () => {
	it('returns all or the first n', () => {
		expect(applyLimit([1, 2, 3], true, 1)).toEqual([1, 2, 3]);
		expect(applyLimit([1, 2, 3], false, 2)).toEqual([1, 2]);
		expect(applyLimit([1, 2, 3], false, 0)).toEqual([1]);
	});
});

describe('mergeQuickAdd', () => {
	it('lets node fields win and merges labels', () => {
		const parsed = {
			title: 'milk',
			fields: {
				due: { date: '2026-10-27' },
				project_id: 'home',
				priority: 1,
				labels: [{ name: 'errands' }],
				reminders: [{ kind: 'relative', offset_minutes: -30 }],
				spent_minutes: 15,
			},
		};
		expect(
			mergeQuickAdd(parsed, { title: 'milk tomorrow #Home p1', priority: 3, labels: ['l2'] }, [
				'l1',
				'l2',
			]),
		).toEqual({
			title: 'milk',
			due: { date: '2026-10-27' },
			project_id: 'home',
			priority: 3,
			labels: ['l1', 'l2'],
		});
	});

	it('keeps the original title when the parser leaves none', () => {
		expect(mergeQuickAdd({ title: ' ', fields: {} }, { title: 'p1' }, [])).toEqual({ title: 'p1' });
	});
});

describe('errorEnvelope', () => {
	it('reads OpenTodo errors from objects and strings', () => {
		const body = { error: { code: 'invalid_input', message: 'task.priority must be …' } };
		expect(errorEnvelope(body)).toEqual({
			code: 'invalid_input',
			message: 'task.priority must be …',
		});
		expect(errorEnvelope(JSON.stringify(body))?.code).toBe('invalid_input');
		expect(errorEnvelope('nope')).toBeUndefined();
		expect(errorEnvelope({ message: 'other' })).toBeUndefined();
	});
});
