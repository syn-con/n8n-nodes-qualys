import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class QualysVmdrOtApi implements ICredentialType {
  name = 'qualysVmdrOtApi';

  icon?: Icon = 'file:qualys.svg';

  displayName = 'Qualys VMDR OT API';

  documentationUrl = 'https://docs.qualys.com/en/vmdr-ot/api/vmdrot_api/ch01/api.htm';

  properties: INodeProperties[] = [
    {
      displayName: 'API Gateway Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://gateway.qg1.apps.qualys.com',
      required: true,
      description:
        'Qualys API gateway URL for your pod. Bare hosts are automatically prefixed with HTTPS.',
      placeholder: 'https://gateway.qg1.apps.qualys.com',
    },
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string',
      default: '',
      required: true,
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'string',
      default: '',
      required: true,
      typeOptions: {
        password: true,
      },
    },
  ];
}
