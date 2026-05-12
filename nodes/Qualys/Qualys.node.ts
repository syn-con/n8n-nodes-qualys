import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

import { description } from './actions/description';
import { router } from './actions/router';

export class Qualys implements INodeType {
  description: INodeTypeDescription = description;

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return router.call(this);
  }
}
