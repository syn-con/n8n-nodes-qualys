import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class Qualys implements ICredentialType {
    name = 'qualysApi';
    displayName = 'Qualys';
    documentationUrl = '';
	  icon?: Icon = 'file:qualys.svg';
    properties: INodeProperties[] = [
        {
            displayName: 'Base URL',
            name: 'baseUrl',
            type: 'string',
            default: 'https://qualysapi.qg2.apps.qualys.com',
            placeholder: 'https://qualysapi.yourpod.qualys.com',
            description: 'Root URL for the Qualys API you are targeting',
            required: true,
        },
        {
            displayName: 'Auth Method',
            name: 'authMethod',
            type: 'options',
            options: [
                { name: 'Basic (Username & Password)', value: 'basic' },
                { name: 'Bearer Token', value: 'bearer' },
            ],
            default: 'basic',
        },
        {
            displayName: 'Username',
            name: 'username',
            type: 'string',
            default: '',
            typeOptions: { password: false },
            displayOptions: { show: { authMethod: ['basic'] } },
            required: true,
        },
        {
            displayName: 'Password',
            name: 'password',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            displayOptions: { show: { authMethod: ['basic'] } },
            required: true,
        },
        {
            displayName: 'Token',
            name: 'token',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            displayOptions: { show: { authMethod: ['bearer'] } },
            required: true,
        },
        {
            displayName: 'Default Headers (JSON)',
            name: 'headersJson',
            type: 'string',
            default: '{"X-Requested-With":"n8n"}',
            description: 'Optional default headers merged into each request',
        },
    ];
}
