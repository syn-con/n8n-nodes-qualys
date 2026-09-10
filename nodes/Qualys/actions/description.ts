import type { INodeProperties } from 'n8n-workflow';

import { COUNT_OPS, LIST_OPS } from './shared/operationScopes';
import { csamProperties } from './planes/csam/parameters';
import { otFilterProperties } from './planes/ot/parameters';
import { foProperties } from './planes/fo/parameters';
import { RESOURCES } from './resources';

/** n8n's linter wants dropdown entries in alphabetical order. */
const byName = <T extends { name: string }>(entries: T[]): T[] =>
  [...entries].sort((a, b) => a.name.localeCompare(b.name));

const resourceProperty: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  options: byName(
    Object.entries(RESOURCES).map(([value, definition]) => ({
      name: definition.name,
      value,
      description: definition.description,
    })),
  ),
  default: 'itAsset',
};

/**
 * One dropdown per resource, naming the records that resource can read.
 *
 * `node-param-default-missing` reads defaults out of the syntax tree, so it
 * cannot see one computed per resource. The default is set below, and a test
 * asserts every dropdown defaults to an operation it actually offers - a
 * stronger check than the rule performs.
 */
const operationProperties: INodeProperties[] = Object.entries(RESOURCES).map(
  // eslint-disable-next-line n8n-nodes-base/node-param-default-missing
  ([resource, definition]) => ({
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    options: byName(
      Object.entries(definition.operations).map(([value, operation]) => ({
        name: operation.name,
        value,
        description: operation.description,
        action: operation.action,
      })),
    ),
    default: Object.keys(definition.operations)[0],
    displayOptions: { show: { resource: [resource] } },
  }),
);

// ------------------------------------------------------------ shared paging UI

const pagingProperties: INodeProperties[] = [
  {
    displayName: 'Run Once For All Items',
    name: 'runOnce',
    type: 'boolean',
    default: true,
    description:
      'Whether to run a single query regardless of how many input items arrive. Turn this off to run the query once per input item, so that parameters and filters can reference each item with expressions.',
    displayOptions: { show: { operation: [...LIST_OPS, ...COUNT_OPS] } },
  },
  {
    displayName: 'List All',
    name: 'listAll',
    type: 'boolean',
    default: false,
    description: 'Whether to return every matching record, paging until the API is exhausted',
    displayOptions: { show: { operation: LIST_OPS } },
  },
  {
    displayName: 'Count',
    name: 'count',
    type: 'number',
    default: 100,
    typeOptions: { minValue: 0, numberPrecision: 0 },
    description: 'Maximum records to return. Ignored when List All is enabled.',
    displayOptions: { show: { operation: LIST_OPS, listAll: [false] } },
  },
];

// ------------------------------------------------------------------- output

const outputProperties: INodeProperties[] = [
  {
    displayName: 'Item Granularity',
    name: 'itemGranularity',
    type: 'options',
    default: 'detection',
    options: [
      { name: 'Detection', value: 'detection', description: 'One item per detection, flattened with its host context' },
      { name: 'Host', value: 'host', description: 'One item per host, with detections nested' },
    ],
    description: 'How detections are split into items',
    displayOptions: { show: { operation: ['listDetections'] } },
  },
  {
    displayName: 'Output Mode',
    name: 'outputMode',
    type: 'options',
    options: [
      { name: 'Items', value: 'items', description: 'One item per record' },
      { name: 'Raw Response', value: 'raw', description: 'A single item holding every page verbatim' },
    ],
    default: 'items',
    description: 'How the response is emitted',
    displayOptions: { show: { operation: LIST_OPS } },
  },
  {
    displayName: 'Add Response Metadata',
    name: 'includeMetadata',
    type: 'boolean',
    default: false,
    description: 'Whether to attach a _qualys object carrying endpoint, paging and rate limit details',
    displayOptions: { show: { operation: LIST_OPS, outputMode: ['items'] } },
  },
];

const listProperties: INodeProperties[] = [
  ...pagingProperties,
  ...otFilterProperties,
  ...csamProperties,
  ...foProperties,
  ...outputProperties,
];

/** Every parameter the node shows, in panel order. */
export const properties: INodeProperties[] = [
  resourceProperty,
  ...operationProperties,
  ...listProperties,
];

