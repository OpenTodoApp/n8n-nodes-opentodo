import type { INodeProperties } from 'n8n-workflow';

function returnAllAndLimit(resource: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
		},
	];
}

// ─── Project ────────────────────────────────────────────────────────────────

const projectFields: INodeProperties[] = [
	{
		displayName: 'Color',
		name: 'color',
		type: 'color',
		default: '',
		description: "The project's colour",
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description: "The project's note, as Markdown",
	},
	{
		displayName: 'Parent Project ID',
		name: 'parentId',
		type: 'string',
		default: '',
		description:
			'Make this a sub-project of another project. Empty moves it to the top level on update.',
	},
];

export const projectOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['project'] } },
		options: [
			{
				name: 'Archive',
				value: 'archive',
				description: 'Archive a project',
				action: 'Archive a project',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project',
				action: 'Create a project',
			},
			{ name: 'Get', value: 'get', description: 'Get a project', action: 'Get a project' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many projects',
				action: 'Get many projects',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project',
				action: 'Update a project',
			},
		],
		default: 'getAll',
	},
];

export const projectProperties: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		description: "The project's name",
		displayOptions: { show: { resource: ['project'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['project'], operation: ['create'] } },
		options: projectFields,
	},
	{
		displayName: 'Project ID',
		name: 'projectId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the project',
		displayOptions: { show: { resource: ['project'], operation: ['get', 'update', 'archive'] } },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['project'], operation: ['update'] } },
		options: [
			{
				displayName: 'Archived',
				name: 'archived',
				type: 'boolean',
				default: false,
				description: 'Whether the project is archived. Turn off to restore an archived project.',
			},
			...projectFields,
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The new name',
			},
		],
	},
	...returnAllAndLimit('project'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['project'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Include Archived',
				name: 'includeArchived',
				type: 'boolean',
				default: false,
				description: 'Whether to include archived projects',
			},
		],
	},
];

// ─── Label ──────────────────────────────────────────────────────────────────

export const labelOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['label'] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create a label', action: 'Create a label' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many labels',
				action: 'Get many labels',
			},
		],
		default: 'getAll',
	},
];

export const labelProperties: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		description: "The label's name",
		displayOptions: { show: { resource: ['label'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['label'], operation: ['create'] } },
		options: [
			{
				displayName: 'Color',
				name: 'color',
				type: 'color',
				default: '',
				description: "The label's colour; picked from the palette when empty",
			},
		],
	},
	...returnAllAndLimit('label'),
];

// ─── Comment ────────────────────────────────────────────────────────────────

export const commentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['comment'] } },
		options: [
			{
				name: 'Add',
				value: 'add',
				description: 'Add a comment to a task',
				action: 'Add a comment to a task',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the comments of a task',
				action: 'Get many comments of a task',
			},
		],
		default: 'add',
	},
];

export const commentProperties: INodeProperties[] = [
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the task',
		displayOptions: { show: { resource: ['comment'] } },
	},
	{
		displayName: 'Comment',
		name: 'commentBody',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The comment, as Markdown',
		displayOptions: { show: { resource: ['comment'], operation: ['add'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['comment'], operation: ['add'] } },
		options: [
			{
				displayName: 'Reply To Comment ID',
				name: 'parentId',
				type: 'string',
				default: '',
				description: 'Post the comment as a reply to this comment on the same task',
			},
		],
	},
	...returnAllAndLimit('comment'),
];
