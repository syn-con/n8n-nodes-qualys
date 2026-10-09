import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

import { properties } from './actions/description';
import { router } from './actions/router';

export class QualysVmdrOt implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Qualys',
    name: 'qualysVmdrOt',
    group: ['transform'],
    icon: { light: 'file:../../icons/qualys.svg', dark: 'file:../../icons/qualys.dark.svg' },
    version: 1,
    subtitle: '={{ $parameter["resource"] + ": " + $parameter["operation"] }}',
    description:
      'Read asset and vulnerability data from Qualys VMDR, VMDR OT and CyberSecurity Asset Management',
    defaults: {
      name: 'Qualys',
    },
    // eslint-disable-next-line @n8n/community-nodes/node-connection-type-literal -- the n8n verification review asked for the literal
    inputs: ['main'],
    // eslint-disable-next-line @n8n/community-nodes/node-connection-type-literal -- the n8n verification review asked for the literal
    outputs: ['main'],
    usableAsTool: true,
    credentials: [
      {
        name: 'qualysVmdrOtApi',
        required: true,
      },
    ],
    properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return router.call(this);
  }
}
