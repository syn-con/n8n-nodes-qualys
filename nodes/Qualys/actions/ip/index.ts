import type { INodeProperties } from 'n8n-workflow';
import * as list from './list.operation';

export { list };

export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['ip'] } },
    options: [
      { name: 'List', value: 'list', action: 'List' }
    ],
    default: 'list',
  },
  ...list.properties,
];
