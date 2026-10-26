import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class OpenTodoApi implements ICredentialType {
	name = 'openTodoApi';

	displayName = 'OpenTodo API';

	icon: Icon = { light: 'file:opentodo.svg', dark: 'file:opentodo.dark.svg' };

	documentationUrl = 'https://github.com/OpenTodoApp/n8n-nodes-opentodo#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://todo.example.com',
			description:
				'The address you open OpenTodo at, without /api/v1. It must be reachable from the n8n server.',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'ot_…',
			description:
				'Create one in OpenTodo under Settings → Integrations → API tokens. Pick "Full access" to create and change tasks and to use the OpenTodo Trigger. "Read only" works for workflows that only read (Get and Get Many); every write is refused with insufficient_scope. "AI assistant" tokens can create and edit tasks, projects, labels and comments only while the owner and you allow assistant changes, and cannot create the trigger\'s webhook. "Admin" is not needed.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.serverUrl.trim().replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}',
			url: '/api/v1/me',
			method: 'GET',
		},
	};
}
