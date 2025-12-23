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
    displayOptions: { show: { resource: ['asset'], operation: ['list'] } },
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    displayOptions: { show: { resource: ['asset'], operation: ['list'], searchType: ['basic'] } },
    default: {},
    options: [
      { displayName: 'IPs / Ranges / CIDRs', name: 'ips', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ips', displayName: 'IP/Range/CIDR', values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }] }] },
      { displayName: 'Asset IDs', name: 'asset_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ids', displayName: 'Asset ID', values: [{ displayName: 'ID', name: 'id', type: 'string', default: '' }] }] },
      { displayName: 'Groups', name: 'ag_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'groups', displayName: 'Group', values: [{ displayName: 'Group ID', name: 'id', type: 'string', default: '' }] }] },
      { displayName: 'Networks', name: 'network_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'nets', displayName: 'Network', values: [{ displayName: 'Network ID', name: 'id', type: 'string', default: '' }] }] },
    ],
  },
  {
    displayName: 'Advanced QQL',
    name: 'rawFilter',
    type: 'string',
    displayOptions: { show: { resource: ['asset'], operation: ['list'], searchType: ['advanced'] } },
    default: '',
    description: 'Raw QQL string',
  },
  {
    displayName: 'Fields',
    name: 'fields',
    type: 'multiOptions',
    displayOptions: { show: { resource: ['asset'], operation: ['list'] } },
    options: [
      { name: 'ID', value: 'id' },
      { name: 'IP', value: 'ip' },
      { name: 'DNS', value: 'dns' },
      { name: 'NetBIOS', value: 'netbios' },
      { name: 'Tracking Method', value: 'tracking_method' },
      { name: 'Last Scan', value: 'last_scan_datetime' },
      { name: 'OS', value: 'os' },
    ],
    default: [],
  },
  {
    displayName: 'Count',
    name: 'count',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['asset'], operation: ['list'] } },
    default: 100,
    description: 'truncation_limit (0 for no limit)',
  },
  {
    displayName: 'Offset',
    name: 'offset',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['asset'], operation: ['list'] } },
    default: 0,
    description: 'startFromOffset',
  },
];

export async function execute(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const searchType = this.getNodeParameter('searchType', i) as string;
  const count = this.getNodeParameter('count', i, 100) as number;
  const offset = this.getNodeParameter('offset', i, 0) as number;

  const form: IDataObject = { action: 'list' };
  if (count != null) form['truncation_limit'] = count;
  if (offset) form['startFromOffset'] = offset;

  if (searchType === 'advanced') {
    const raw = (this.getNodeParameter('rawFilter', i) as string) || '';
    if (raw) form['q'] = raw;
  } else {
    const filters = (this.getNodeParameter('filters', i, {}) as IDataObject) || {};
    const pick = (colKey: string, innerKey: string) => {
      const col = (filters as any)[colKey];
      const arr = (col?.[innerKey] ?? []) as Array<any>;
      const values = arr.map(v => v.id ?? v.value).filter((v: any) => String(v || '').trim() !== '');
      if (values.length) form[colKey] = values.join(',');
    };
    pick('ips', 'ips');
    pick('asset_ids', 'ids');
    pick('ag_ids', 'groups');
    pick('network_ids', 'nets');
  }

  const fields = this.getNodeParameter('fields', i, []) as string[];
  if (fields.length) {
    form['fields'] = fields.join(',');
    form['includeFields'] = form['fields'];
  }

  const { items } = await qualysApiRequest.call(this, '/api/2.0/fo/asset/host/', form, 'POST');
  return items;
}
