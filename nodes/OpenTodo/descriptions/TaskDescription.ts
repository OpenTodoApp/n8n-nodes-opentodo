import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['task'], operation } });

const taskIdField: INodeProperties = {
	displayName: 'Task ID',
	name: 'taskId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 0b9a2e4c-8a8e-4d7e-9d7f-3c1b2a0e9f11',
	description: 'The ID of the task, as returned by Create or Get Many, or in a trigger event',
	displayOptions: show(['get', 'update', 'complete', 'reopen', 'delete']),
};

/** Fields shared by Create (Additional Fields) and Update (Update Fields). */
const taskFields: INodeProperties[] = [
	{
		displayName: 'Assignee ID',
		name: 'assigneeId',
		type: 'string',
		default: '',
		description:
			"Account ID of a member of the task's shared project (or yourself for a personal task). Empty clears it on update.",
	},
	{
		displayName: 'Deadline',
		name: 'deadline',
		type: 'dateTime',
		default: '',
		description:
			'The day the task must be finished by, separate from the due date. Only the date is used.',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description: "The task's notes, as Markdown",
	},
	{
		displayName: 'Due Date',
		name: 'dueDate',
		type: 'dateTime',
		default: '',
		description:
			'The day the task is planned for. A floating date: it means the same day in every time zone. A time in this value (other than midnight) becomes the due time.',
	},
	{
		displayName: 'Due Time',
		name: 'dueTime',
		type: 'string',
		default: '',
		placeholder: '09:30',
		description: 'Wall-clock time on the due date, HH:MM in 24 hours. Needs a due date.',
	},
	{
		displayName: 'Due Time Zone',
		name: 'dueTimeZone',
		type: 'string',
		default: '',
		placeholder: 'Europe/Berlin',
		description:
			'Fix the due time to this IANA time zone instead of the floating wall time. Needs a due time.',
	},
	{
		displayName: 'Estimate (Minutes)',
		name: 'estimateMinutes',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 10080 },
		default: 0,
		description: 'Duration estimate in minutes (1 to 10080). 0 clears it.',
	},
	{
		displayName: 'Label Names or IDs',
		name: 'labelIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		default: [],
		description:
			'Labels of the task. On update the list replaces the current labels. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Parent Task ID',
		name: 'parentId',
		type: 'string',
		default: '',
		description:
			'Make this a subtask of another task in the same project. Empty detaches it on update.',
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		options: [
			{ name: 'Priority 1 (Highest)', value: 1 },
			{ name: 'Priority 2', value: 2 },
			{ name: 'Priority 3', value: 3 },
			{ name: 'Priority 4 (Default)', value: 4 },
		],
		default: 4,
		description: 'Priority 1 is the highest, 4 is the default and lowest',
	},
	{
		displayName: 'Project Name or ID',
		name: 'projectId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getProjects' },
		default: '',
		description:
			'The project of the task; "Inbox" for none. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Repeat Rule',
		name: 'recurrence',
		type: 'string',
		default: '',
		placeholder: 'every weekday',
		description:
			'A repeat rule in OpenTodo\'s words, such as "every 2 weeks" or "every 3 days after completion". Needs a due date. Empty removes it on update.',
	},
	{
		displayName: 'Section Name or ID',
		name: 'sectionId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getSections' },
		default: '',
		description:
			'A section of the task\'s project. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
];

export const taskOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['task'] } },
		options: [
			{
				name: 'Complete',
				value: 'complete',
				description: 'Complete a task',
				action: 'Complete a task',
			},
			{ name: 'Create', value: 'create', description: 'Create a task', action: 'Create a task' },
			{
				name: 'Delete',
				value: 'delete',
				description: 'Move a task to the Trash',
				action: 'Delete a task',
			},
			{ name: 'Get', value: 'get', description: 'Get a task', action: 'Get a task' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many tasks',
				action: 'Get many tasks',
			},
			{
				name: 'Reopen',
				value: 'reopen',
				description: 'Reopen a completed task',
				action: 'Reopen a task',
			},
			{ name: 'Update', value: 'update', description: 'Update a task', action: 'Update a task' },
		],
		default: 'create',
	},
];

export const taskProperties: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Call the plumber tomorrow 9am #Home p2',
		description:
			"The task's title. With Parse Quick-Add Syntax on, dates, #project, @label and p1–p4 in it are read like in the app.",
		displayOptions: show(['create']),
	},
	{
		displayName: 'Parse Quick-Add Syntax',
		name: 'quickAdd',
		type: 'boolean',
		default: false,
		description:
			'Whether to read the title like the app\'s quick add, in your account\'s language: "milk tomorrow #Home p1 @errands" becomes "milk", due tomorrow, in Home, priority 1, label errands (created when missing). Fields set below win over the text.',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			...taskFields,
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'1 to 128 letters, digits and . _ : -. A retry with the same key and content returns the task created the first time instead of creating a second one.',
			},
		],
	},
	taskIdField,
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [
			...taskFields,
			{
				displayName: 'Clear Deadline',
				name: 'clearDeadline',
				type: 'boolean',
				default: false,
				description: 'Whether to remove the deadline',
			},
			{
				displayName: 'Clear Due Date',
				name: 'clearDue',
				type: 'boolean',
				default: false,
				description: 'Whether to remove the due date and time',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'The new title',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['task'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Completed After',
				name: 'completedAfter',
				type: 'dateTime',
				default: '',
				description:
					"Only tasks completed on or after this day (in the workflow's time zone). Implies Status: Completed.",
			},
			{
				displayName: 'Completed Before',
				name: 'completedBefore',
				type: 'dateTime',
				default: '',
				description: 'Only tasks completed before this day. Implies Status: Completed.',
			},
			{
				displayName: 'Due From',
				name: 'dueFrom',
				type: 'dateTime',
				default: '',
				description: 'Only tasks due on or after this day. Tasks without a due date are left out.',
			},
			{
				displayName: 'Due To',
				name: 'dueTo',
				type: 'dateTime',
				default: '',
				description: 'Only tasks due on or before this day. Tasks without a due date are left out.',
			},
			{
				displayName: 'Label Name or ID',
				name: 'labelId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				default: '',
				description:
					'Only tasks with this label. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Parent Task ID',
				name: 'parentId',
				type: 'string',
				default: '',
				description: 'Only the direct subtasks of this task',
			},
			{
				displayName: 'Project Name or ID',
				name: 'projectId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getProjects' },
				default: '',
				description:
					'Only tasks in this project; "Inbox" for tasks without a project. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Only tasks whose title or description contains this text (ignoring case)',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Open', value: 'open' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'All', value: 'all' },
				],
				default: 'open',
				description: 'Whether to return open tasks, completed tasks or both',
			},
		],
	},
];
