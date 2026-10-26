/**
 * Pure helpers shared by the OpenTodo nodes: no n8n context, no network, so they
 * are unit tested directly. Field names follow OpenTodo's REST API
 * (docs/api.md "Task fields"): priority 1 = highest … 4 = default, `due` is a
 * floating {date, time?, tz?}, timestamps are Unix milliseconds.
 */

export type JsonObject = { [key: string]: unknown };

export interface Due {
	date: string;
	time?: string;
	tz?: string;
}

export interface Task extends JsonObject {
	id: string;
	title: string;
	description?: string;
	project_id: string | null;
	parent_id?: string | null;
	section_id?: string | null;
	labels: string[];
	priority: number;
	due: Due | null;
	completed_at: number | null;
	deleted_at?: number | null;
}

/** The value the project pickers use for "no project". Project ids are UUIDs, so it cannot clash. */
export const INBOX = 'inbox';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "https://todo.example.com/api/v1/" → "https://todo.example.com". */
export function normalizeBaseUrl(url: string): string {
	let out = String(url ?? '').trim();
	out = out.replace(/\/+$/, '');
	out = out.replace(/\/api\/v1$/, '');
	out = out.replace(/\/+$/, '');
	if (!/^https?:\/\/[^/]+/i.test(out)) {
		throw new Error(`The server URL "${url}" must start with http:// or https://`);
	}
	return out;
}

function validDate(date: string): boolean {
	if (!DATE.test(date)) return false;
	const [y, m, d] = date.split('-').map(Number);
	const at = new Date(Date.UTC(y, m - 1, d));
	return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/**
 * Reads a date parameter: "2026-11-02", or an ISO date-time such as n8n's date
 * picker gives ("2026-11-02T15:30:00"). Returns the date and, when the input
 * carries a time other than midnight, that wall time.
 */
export function splitDateInput(input: string, field = 'date'): { date: string; time?: string } {
	const value = String(input ?? '').trim();
	const match =
		/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
			value,
		);
	if (!match || !validDate(match[1])) {
		throw new Error(`${field} must be a date like 2026-11-02, got "${value}"`);
	}
	const out: { date: string; time?: string } = { date: match[1] };
	if (match[2] !== undefined && !(match[2] === '00' && match[3] === '00')) {
		out.time = `${match[2]}:${match[3]}`;
	}
	return out;
}

/**
 * Builds OpenTodo's floating `due` value. `time` wins over a time inside the
 * date input; `tz` (an IANA zone) is only allowed together with a time.
 */
export function buildDue(dateInput: string, timeInput?: string, tz?: string): Due {
	const { date, time: timeFromDate } = splitDateInput(dateInput, 'Due date');
	const time = (timeInput ?? '').trim() || timeFromDate;
	const due: Due = { date };
	if (time) {
		if (!TIME.test(time)) throw new Error(`Due time must be HH:MM (24 hours), got "${time}"`);
		due.time = time;
	}
	const zone = (tz ?? '').trim();
	if (zone) {
		if (!due.time) throw new Error('A due time zone needs a due time');
		due.tz = zone;
	}
	return due;
}

export function projectValue(value: unknown): string | null {
	return value === INBOX || value === null ? null : String(value);
}

export interface TaskFieldInput {
	title?: string;
	description?: string;
	projectId?: string;
	sectionId?: string;
	parentId?: string;
	labelIds?: string[] | string;
	priority?: number | string;
	dueDate?: string;
	dueTime?: string;
	dueTimeZone?: string;
	clearDue?: boolean;
	deadline?: string;
	clearDeadline?: boolean;
	estimateMinutes?: number;
	recurrence?: string;
	assigneeId?: string;
}

function labelList(value: string[] | string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) return value.map(String).filter((v) => v !== '');
	return String(value)
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v !== '');
}

/**
 * Maps the node's task parameters to a body for POST/PATCH /api/v1/tasks. Only
 * fields the user set are sent: the API writes exactly what it receives and
 * refuses unknown fields.
 */
export function buildTaskBody(input: TaskFieldInput): JsonObject {
	const body: JsonObject = {};
	if (input.title !== undefined) {
		const title = String(input.title);
		if (title.trim() === '') throw new Error('Title must not be empty');
		body.title = title;
	}
	if (input.description !== undefined) body.description = String(input.description);
	if (input.projectId !== undefined && input.projectId !== '') {
		body.project_id = projectValue(input.projectId);
	}
	if (input.sectionId !== undefined)
		body.section_id = input.sectionId === '' ? null : input.sectionId;
	if (input.parentId !== undefined) body.parent_id = input.parentId === '' ? null : input.parentId;
	const labels = labelList(input.labelIds);
	if (labels !== undefined) body.labels = labels;
	if (input.priority !== undefined && input.priority !== '') {
		const priority = Number(input.priority);
		if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
			throw new Error('Priority must be 1 (highest), 2, 3 or 4 (default)');
		}
		body.priority = priority;
	}
	if (input.clearDue) {
		body.due = null;
	} else if (input.dueDate !== undefined && String(input.dueDate).trim() !== '') {
		body.due = buildDue(input.dueDate, input.dueTime, input.dueTimeZone);
	} else if ((input.dueTime ?? '').trim() !== '') {
		throw new Error('A due time needs a due date');
	}
	if (input.clearDeadline) {
		body.deadline = null;
	} else if (input.deadline !== undefined && String(input.deadline).trim() !== '') {
		body.deadline = splitDateInput(input.deadline, 'Deadline').date;
	}
	if (input.estimateMinutes !== undefined) {
		const minutes = Number(input.estimateMinutes);
		body.estimate_minutes = minutes > 0 ? Math.round(minutes) : null;
	}
	if (input.recurrence !== undefined) {
		body.recurrence = String(input.recurrence).trim() === '' ? null : String(input.recurrence);
	}
	if (input.assigneeId !== undefined)
		body.assignee_id = input.assigneeId === '' ? null : input.assigneeId;
	return body;
}

export interface TaskFilters {
	projectId?: string;
	labelId?: string;
	status?: 'open' | 'completed' | 'all';
	dueFrom?: string;
	dueTo?: string;
	search?: string;
	parentId?: string;
}

/**
 * OpenTodo's GET /api/v1/tasks returns every task the account can read (the
 * only server-side filter is the completion range), so the node filters here.
 */
export function filterTasks<T extends Task>(tasks: T[], filters: TaskFilters): T[] {
	const status = filters.status ?? 'open';
	const dueFrom = filters.dueFrom ? splitDateInput(filters.dueFrom, 'Due from').date : undefined;
	const dueTo = filters.dueTo ? splitDateInput(filters.dueTo, 'Due to').date : undefined;
	const needle = (filters.search ?? '').trim().toLowerCase();
	return tasks.filter((task) => {
		if (task.deleted_at) return false;
		if (status === 'open' && task.completed_at) return false;
		if (status === 'completed' && !task.completed_at) return false;
		if (filters.projectId !== undefined && filters.projectId !== '') {
			if ((task.project_id ?? null) !== projectValue(filters.projectId)) return false;
		}
		if (filters.parentId !== undefined && filters.parentId !== '') {
			if ((task.parent_id ?? null) !== filters.parentId) return false;
		}
		if (filters.labelId && !(task.labels ?? []).includes(filters.labelId)) return false;
		if (dueFrom || dueTo) {
			const date = task.due?.date;
			if (!date) return false;
			if (dueFrom && date < dueFrom) return false;
			if (dueTo && date > dueTo) return false;
		}
		if (needle) {
			const text = `${task.title ?? ''}\n${task.description ?? ''}`.toLowerCase();
			if (!text.includes(needle)) return false;
		}
		return true;
	});
}

/** Return-all / limit for Get Many operations. */
export function applyLimit<T>(items: T[], returnAll: boolean, limit: number): T[] {
	if (returnAll) return items;
	const n = Math.max(1, Math.floor(Number(limit) || 0));
	return items.slice(0, n);
}

/** Today's date and wall time in an IANA zone, for the quick-add parser. */
export function localNow(now: number, timeZone: string): { today: string; now: string } {
	const parts = zonedParts(now, timeZone);
	return {
		today: `${parts.year}-${parts.month}-${parts.day}`,
		now: `${parts.hour}:${parts.minute}`,
	};
}

function zonedParts(at: number, timeZone: string): Record<string, string> {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	const parts: Record<string, string> = {};
	for (const part of formatter.formatToParts(new Date(at))) parts[part.type] = part.value;
	return parts;
}

/** The instant of a wall time in an IANA zone (for quick-add "absolute" reminders). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): number {
	const [y, m, d] = date.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	const wall = Date.UTC(y, m - 1, d, hh, mm);
	const offsetAt = (at: number) => {
		const p = zonedParts(at, timeZone);
		const asUtc = Date.UTC(
			Number(p.year),
			Number(p.month) - 1,
			Number(p.day),
			Number(p.hour),
			Number(p.minute),
			Number(p.second),
		);
		return asUtc - Math.floor(at / 1000) * 1000;
	};
	const first = wall - offsetAt(wall);
	const second = wall - offsetAt(first);
	return second;
}

export interface QuickAddResult {
	title: string;
	fields: JsonObject & {
		labels?: Array<{ id?: string; name: string }>;
		reminders?: Array<{ kind: string; offset_minutes?: number; date?: string; time?: string }>;
		spent_minutes?: number;
	};
}

/**
 * Combines what the quick-add parser read from the title with the fields set on
 * the node: a field set on the node wins, labels are merged.
 */
export function mergeQuickAdd(
	parsed: QuickAddResult,
	explicit: JsonObject,
	parsedLabelIds: string[],
): JsonObject {
	const rest: JsonObject = { ...parsed.fields };
	delete rest.labels;
	delete rest.reminders;
	delete rest.spent_minutes;
	const body: JsonObject = { ...rest, ...explicit };
	body.title = parsed.title.trim() !== '' ? parsed.title : explicit.title;
	const labels = [...parsedLabelIds, ...((explicit.labels as string[] | undefined) ?? [])];
	if (labels.length > 0) body.labels = Array.from(new Set(labels));
	return body;
}

/** Pulls the message out of OpenTodo's {error:{code,message}} envelope, if present. */
export function errorEnvelope(body: unknown): { code: string; message: string } | undefined {
	let value = body;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (value && typeof value === 'object' && 'error' in value) {
		const inner = (value as { error: unknown }).error;
		if (inner && typeof inner === 'object' && 'message' in inner) {
			const e = inner as { code?: unknown; message?: unknown };
			return { code: String(e.code ?? ''), message: String(e.message ?? '') };
		}
	}
	return undefined;
}
