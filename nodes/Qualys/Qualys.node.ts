import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { router } from './actions/router';
import { description } from './actions/description';

export class Qualys implements INodeType {
  description: INodeTypeDescription;
  constructor() {
    this.description = description;
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return router.call(this);
  }
}
