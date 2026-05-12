import { NodeConnectionType, type INodeProperties, type INodeTypeDescription } from 'n8n-workflow';

export const resourceProperty: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  options: [
    {
      name: 'OT Host Asset',
      value: 'asset',
      description: 'Asset list',
    },
    {
      name: 'OT Vulnerability',
      value: 'vulnerability',
      description: 'Vulnerability list',
    },
    {
      name: 'Project File',
      value: 'projectFile',
      description: 'Project files',
    },
  ],
  default: 'asset',
};

export const operationProperty: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  options: [
    {
      name: 'List',
      value: 'list',
      description: 'List records',
      action: 'List records',
    },
  ],
  default: 'list',
};

export const listProperties: INodeProperties[] = [
  {
    displayName: 'List All',
    name: 'listAll',
    type: 'boolean',
    default: false,
    description: 'Return all records.',
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Count',
    name: 'count',
    type: 'number',
    default: 100,
    typeOptions: {
      minValue: 0,
      numberPrecision: 0,
    },
    description: 'Records to return. Use 0 with List All.',
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Skip',
    name: 'skip',
    type: 'number',
    default: 0,
    typeOptions: {
      minValue: 0,
      numberPrecision: 0,
    },
    description: 'Records to skip.',
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Filter Groups',
    name: 'filterGroups',
    type: 'fixedCollection',
    default: {},
    typeOptions: {
      multipleValues: true,
    },
    description: 'Filter groups.',
    options: [
      {
        name: 'filterGroups',
        displayName: 'Filter Group',
        values: [
          {
            displayName: 'Filters',
            name: 'filters',
            type: 'fixedCollection',
            default: {},
            typeOptions: {
              multipleValues: true,
            },
            description: 'Filter rows.',
            options: [
              {
                name: 'filters',
                displayName: 'Filter Row',
                values: [
                  {
                    displayName: 'Identifier',
                    name: 'identifier',
                    type: 'string',
                    default: '',
                    description: 'Field.',
                  },
                  {
                    displayName: 'Operator',
                    name: 'operator',
                    type: 'options',
                    noDataExpression: true,
                    default: ':',
                    options: [
                      { name: 'Contains / Equals (:)', value: ':' },
                      { name: 'Greater Than (>)', value: '>' },
                      { name: 'Greater Than or Equal (>=)', value: '>=' },
                      { name: 'Less Than (<)', value: '<' },
                      { name: 'Less Than or Equal (<=)', value: '<=' },
                      { name: 'Not Equal (!=)', value: '!=' },
                      { name: 'Is Null', value: 'is null' },
                      { name: 'Is Not Null', value: 'is not null' },
                    ],
                    description: 'Operator.',
                  },
                  {
                    displayName: 'Value',
                    name: 'value',
                    type: 'string',
                    default: '',
                    description: 'Value.',
                  },
                  {
                    displayName: 'Join',
                    name: 'join',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                      { name: 'AND', value: 'AND' },
                      { name: 'OR', value: 'OR' },
                    ],
                    default: 'AND',
                    description: 'Next row join.',
                  },
                ],
              },
            ],
          },
          {
            displayName: 'Join',
            name: 'join',
            type: 'options',
            noDataExpression: true,
            options: [
              { name: 'AND', value: 'AND' },
              { name: 'OR', value: 'OR' },
            ],
            default: 'AND',
            description: 'Next group join.',
          },
        ],
      },
    ],
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Sorts',
    name: 'sorts',
    type: 'fixedCollection',
    default: {},
    typeOptions: {
      multipleValues: true,
    },
    description: 'Sort rules.',
    options: [
      {
        name: 'sorts',
        displayName: 'Sort Rule',
        values: [
          {
            displayName: 'Field',
            name: 'field',
            type: 'string',
            default: '',
            description: 'Field.',
          },
          {
            displayName: 'Direction',
            name: 'direction',
            type: 'options',
            default: 'asc',
            options: [
              { name: 'Ascending', value: 'asc' },
              { name: 'Descending', value: 'desc' },
            ],
            description: 'Direction.',
          },
        ],
      },
    ],
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Output Mode',
    name: 'outputMode',
    type: 'options',
    options: [
      {
        name: 'Items',
        value: 'items',
        description: 'One item per record.',
      },
      {
        name: 'Raw Response',
        value: 'raw',
        description: 'Return the raw response.',
      },
    ],
    default: 'items',
    displayOptions: {
      show: {
        operation: ['list'],
      },
    },
  },
  {
    displayName: 'Add Response Metadata',
    name: 'includeMetadata',
    type: 'boolean',
    default: false,
    description: 'Add metadata.',
    displayOptions: {
      show: {
        operation: ['list'],
        outputMode: ['items'],
      },
    },
  },
];

export const description: INodeTypeDescription = {
  displayName: 'Qualys VMDR OT',
  name: 'qualysVmdrOt',
  group: ['transform'],
  icon: 'file:qualys.svg',
  version: 1,
  subtitle: '={{ $parameter["resource"] + ": " + $parameter["operation"] }}',
  description: 'Qualys VMDR OT node',
  defaults: {
    name: 'Qualys VMDR OT',
  },
  inputs: [NodeConnectionType.Main],
  outputs: [NodeConnectionType.Main],
  usableAsTool: true,
  credentials: [
    {
      name: 'qualysVmdrOtApi',
      required: true,
    },
  ],
  properties: [resourceProperty, operationProperty, ...listProperties],
};
