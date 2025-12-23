import type { INodeExecutionData, INodeProperties, IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { qualysApiRequest } from '../../transport';

export const properties: INodeProperties[] = [
  {
    displayName: 'Host ID',
    name: 'hostId',
    type: 'string',
    default: '',
    required: true,
    displayOptions: { show: { resource: ['assetVuln'], operation: ['list'] } },
    description: 'Qualys host (asset) ID to query. For multiple, separate by commas.',
  },
  {
    displayName: 'Severity',
    name: 'severities',
    type: 'multiOptions',
    options: [
      { name: '1', value: '1' },
      { name: '2', value: '2' },
      { name: '3', value: '3' },
      { name: '4', value: '4' },
      { name: '5', value: '5' },
    ],
    default: [],
    displayOptions: { show: { resource: ['assetVuln'], operation: ['list'] } },
  },
  {
    displayName: 'Count',
    name: 'count',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['assetVuln'], operation: ['list'] } },
    default: 100,
    description: 'truncation_limit (0 for no limit)',
  },
  {
    displayName: 'Offset',
    name: 'offset',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['assetVuln'], operation: ['list'] } },
    default: 0,
    description: 'startFromOffset',
  },
];

export async function execute(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const hostId = (this.getNodeParameter('hostId', i) as string).trim();
  if (!hostId) {
    throw new Error('Host ID is required');
  }
  const count = this.getNodeParameter('count', i, 100) as number;
  const offset = this.getNodeParameter('offset', i, 0) as number;
  const severities = this.getNodeParameter('severities', i, []) as string[];

  const form: IDataObject = { action: 'list', ids: hostId };
  if (count != null) form['truncation_limit'] = count;
  if (offset) form['startFromOffset'] = offset;
  if (severities.length) form['severities'] = severities.join(',');

  const { items } = await qualysApiRequest.call(this, '/api/2.0/fo/asset/host/vm/detection/', form, 'POST');
  return items;
}
