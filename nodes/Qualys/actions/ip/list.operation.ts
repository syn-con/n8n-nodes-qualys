import type { INodeExecutionData, INodeProperties, IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { qualysApiRequest } from '../../transport';

export const properties: INodeProperties[] = [
  {
    displayName: 'Search Type',
    name: 'searchType',
    type: 'options',
    options: [
      { name: 'Basic', value: 'basic' },
      { name: 'Advanced (Raw)', value: 'advanced' },
    ],
    default: 'basic',
    displayOptions: { show: { resource: ['ip'], operation: ['list'] } },
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    displayOptions: { show: { resource: ['ip'], operation: ['list'], searchType: ['basic'] } },
    default: {},
    options: [
      { displayName: 'IPs / Ranges / CIDRs', name: 'ips', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ips', displayName: 'IP/Range/CIDR', values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }] }] },
    ],
  },
  {
    displayName: 'Advanced QQL/QPS',
    name: 'rawFilter',
    type: 'string',
    displayOptions: { show: { resource: ['ip'], operation: ['list'], searchType: ['advanced'] } },
    default: '',
  },
];

export async function execute(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const searchType = this.getNodeParameter('searchType', i) as string;

  const form: IDataObject = { action: 'list' };

  if (searchType === 'advanced') {
    const raw = (this.getNodeParameter('rawFilter', i) as string) || '';
    if (raw) form['q'] = raw;
  } else {
    const filters = (this.getNodeParameter('filters', i, {}) as IDataObject) || {};
    const col = (filters as any)['ips'];
    const arr = (col?.['ips'] ?? []) as Array<any>;
    const values = arr.map(v => v.value).filter((v: any) => String(v || '').trim() !== '');
    if (values.length) form['ips'] = values.join(',');
  }

  const { items } = await qualysApiRequest.call(this, '/api/2.0/fo/asset/ip/', form, 'POST');
  return items;
}
