import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	commentOperations,
	commentProperties,
	labelOperations,
	labelProperties,
	projectOperations,
	projectProperties,
} from './descriptions/OtherDescriptions';
import { taskOperations, taskProperties } from './descriptions/TaskDescription';
import { INBOX } from './shared/helpers';
import { runOperation } from './shared/operations';
import { contextRequester, toNodeError } from './shared/transport';

interface Named extends IDataObject {
	id: string;
	name: string;
	archived?: boolean;
	project_id?: string;
}

async function listNamed(context: ILoadOptionsFunctions, collection: string): Promise<Named[]> {
	const response = (await contextRequester(context)({
		method: 'GET',
		path: `/${collection}`,
	})) as IDataObject;
	const list = (response?.[collection] as Named[] | undefined) ?? [];
	return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export class OpenTodo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenTodo',
		name: 'openTodo',
		icon: { light: 'file:opentodo.svg', dark: 'file:opentodo.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create, read and update tasks, projects, labels and comments in OpenTodo',
		defaults: { name: 'OpenTodo' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'openTodoApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Comment', value: 'comment' },
					{ name: 'Label', value: 'label' },
					{ name: 'Project', value: 'project' },
					{ name: 'Task', value: 'task' },
				],
				default: 'task',
			},
			...taskOperations,
			...taskProperties,
			...projectOperations,
			...projectProperties,
			...labelOperations,
			...labelProperties,
			...commentOperations,
			...commentProperties,
		],
	};

	methods = {
		loadOptions: {
			async getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const projects = (await listNamed(this, 'projects')).filter((p) => !p.archived);
				return [
					{ name: 'Inbox (No Project)', value: INBOX },
					...projects.map((p) => ({ name: p.name, value: p.id })),
				];
			},
			async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return (await listNamed(this, 'labels')).map((l) => ({ name: l.name, value: l.id }));
			},
			async getSections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const projects = new Map((await listNamed(this, 'projects')).map((p) => [p.id, p.name]));
				return (await listNamed(this, 'sections'))
					.map((s) => ({
						name: `${projects.get(String(s.project_id)) ?? 'Unknown project'} / ${s.name}`,
						value: s.id,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const request = contextRequester(this);
		const timeZone = this.getTimezone();

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const result = await runOperation(
					{
						request,
						param: (name, fallback) => this.getNodeParameter(name, i, fallback),
						now: () => Date.now(),
						timeZone,
					},
					resource,
					operation,
				);
				const list = Array.isArray(result) ? result : [result];
				for (const json of list) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw toNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
