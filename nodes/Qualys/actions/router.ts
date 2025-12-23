import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import * as asset from './asset/list.operation';
import * as host from './host/list.operation';
import * as ip from './ip/list.operation';
import * as assetVuln from './assetVuln/list.operation';

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const out: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    const resource = this.getNodeParameter('resource', i) as string;
    const operation = this.getNodeParameter('operation', i) as string;

    let exec: ((this: IExecuteFunctions, i: number) => Promise<INodeExecutionData[]>);
    if (resource === 'asset' && operation === 'list') exec = asset.execute;
    else if (resource === 'host' && operation === 'list') exec = host.execute;
    else if (resource === 'ip' && operation === 'list') exec = ip.execute;
        else if (resource === 'assetVuln' && operation === 'list') exec = assetVuln.execute;
    else throw new Error(`Unsupported resource/operation: ${resource}/${operation}`);

    const res = await exec.call(this, i);
    out.push(...res);
  }
  return [out];
}
