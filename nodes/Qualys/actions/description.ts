import { NodeConnectionType, type INodeTypeDescription } from 'n8n-workflow';
import * as asset from './asset';
import * as host from './host';
import * as ip from './ip';
import * as assetVuln from './assetVuln';

export const description: INodeTypeDescription = {
  displayName: 'Qualys',
  name: 'qualys',
  group: ['transform'],
  subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
	icon: { light: 'file:qualys.svg', dark: 'file:qualys.svg' },
  version: 1,
  description: 'Interact with Qualys API',
  inputs: [NodeConnectionType.Main],
  outputs: [NodeConnectionType.Main],
  credentials: [{ name: 'qualysApi', required: true }],
  defaults: { name: 'Qualys' },
  properties: [
    {
      displayName: 'Resource',
      name: 'resource',
      type: 'options',
      options: [
        { name: 'Asset List', value: 'asset' },
        { name: 'Host List', value: 'host' },
        { name: 'IP List', value: 'ip' },
        { name: 'Asset Vulnerability List', value: 'assetVuln' },
      ],
      default: 'asset',
    },
    ...asset.description,
    ...host.description,
    ...ip.description,
    ...assetVuln.description,
  ],
};
