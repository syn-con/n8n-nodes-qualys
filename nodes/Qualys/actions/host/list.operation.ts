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
    displayOptions: { show: { resource: ['host'], operation: ['list'] } },
  },
  {
    displayName: 'Scope',
    name: 'filters',
    type: 'collection',
    displayOptions: { show: { resource: ['host'], operation: ['list'], searchType: ['basic'] } },
    default: {},
    options: [
      { displayName: 'IPs / Ranges / CIDRs', name: 'ips', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ips', displayName: 'IP/Range/CIDR', values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }] }] },
      { displayName: 'Host IDs', name: 'ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ids', displayName: 'Host ID', values: [{ displayName: 'ID', name: 'id', type: 'string', default: '' }] }] },
      { displayName: 'Asset IDs', name: 'asset_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'ids', displayName: 'Asset ID', values: [{ displayName: 'ID', name: 'id', type: 'string', default: '' }] }] },
      { displayName: 'Groups', name: 'ag_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'groups', displayName: 'Group', values: [{ displayName: 'Group ID', name: 'id', type: 'string', default: '' }] }] },
      { displayName: 'Networks', name: 'network_ids', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, options: [{ name: 'nets', displayName: 'Network', values: [{ displayName: 'Network ID', name: 'id', type: 'string', default: '' }] }] },
    ],
  },
  {
    displayName: 'Advanced QQL/QPS',
    name: 'rawFilter',
    type: 'string',
    displayOptions: { show: { resource: ['host'], operation: ['list'], searchType: ['advanced'] } },
    default: '',
  },
  {
    displayName: 'Include Cloud Tags',
    name: 'show_cloud_tags',
    type: 'boolean',
    displayOptions: { show: { resource: ['host'], operation: ['list'] } },
    default: false,
  },
  {
    displayName: 'Cloud Tag Fields',
    name: 'cloud_tag_fields',
    type: 'multiOptions',
    options: [
      { name: 'provider', value: 'provider' },
      { name: 'region', value: 'region' },
      { name: 'accountId', value: 'accountId' },
      { name: 'project', value: 'project' },
    ],
    default: [],
    displayOptions: { show: { resource: ['host'], operation: ['list'], show_cloud_tags: [true] } },
  },
  {
    displayName: 'Count',
    name: 'count',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['host'], operation: ['list'] } },
    default: 100,
    description: 'truncation_limit (0 for no limit)',
  },
  {
    displayName: 'Offset',
    name: 'offset',
    type: 'number',
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: ['host'], operation: ['list'] } },
    default: 0,
    description: 'startFromOffset',
  },
];

export async function execute(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const searchType = this.getNodeParameter('searchType', i) as string;
  const count = this.getNodeParameter('count', i, 100) as number;
  const offset = this.getNodeParameter('offset', i, 0) as number;
  const showCloud = this.getNodeParameter('show_cloud_tags', i, false) as boolean;
  const tagFields = this.getNodeParameter('cloud_tag_fields', i, []) as string[];

  const form: IDataObject = { action: 'list' };
  if (count != null) form['truncation_limit'] = count;
  if (offset) form['startFromOffset'] = offset;
  if (showCloud) form['show_cloud_tags'] = 1;
  if (tagFields.length) form['cloud_tag_fields'] = tagFields.join(',');

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
    pick('ids', 'ids');
    pick('asset_ids', 'ids');
    pick('ag_ids', 'groups');
    pick('network_ids', 'nets');
  }

  const { items } = await qualysApiRequest.call(this, '/api/2.0/fo/asset/host/', form, 'POST');
  return items;
}
