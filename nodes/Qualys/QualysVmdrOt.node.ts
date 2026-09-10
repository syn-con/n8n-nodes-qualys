import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
} from 'n8n-workflow';

import { properties } from './actions/description';
import { router } from './actions/router';

/**
 * n8n-workflow 2.x turned `NodeConnectionType` into a type and moved the runtime
 * value to `NodeConnectionTypes`, so the old `NodeConnectionType.Main` is
 * `undefined` there. The wire value is 'main' in both generations, so using the
 * literal keeps this correct whichever version the host resolves.
 */
const MAIN: NodeConnectionType = 'main';

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
    inputs: [MAIN],
    outputs: [MAIN],
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
