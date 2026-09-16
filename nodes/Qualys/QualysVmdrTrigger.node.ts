import type {
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IPollFunctions,
  NodeConnectionType,
} from 'n8n-workflow';

import { triggerProperties } from './trigger/events';
import { poll } from './trigger/poll';

/** See the note on the same constant in QualysVmdrOt.node.ts. */
const MAIN: NodeConnectionType = 'main';

/**
 * Polling trigger for the VMDR platform API.
 *
 * Qualys has no outbound webhook for these collections, so the only way to
 * react to a detection or a scan is to ask on an interval. Each poll reads the
 * slice of time since the last one, using the "changed since" parameter the
 * endpoint documents, rather than re-reading the collection and diffing it.
 */
export class QualysVmdrTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Qualys Trigger',
    name: 'qualysVmdrTrigger',
    group: ['trigger'],
    icon: { light: 'file:../../icons/qualys.svg', dark: 'file:../../icons/qualys.dark.svg' },
    version: 1,
    subtitle: '={{ $parameter["event"] }}',
    description: 'Start a workflow when Qualys VMDR reports a change',
    defaults: {
      name: 'Qualys Trigger',
    },
    polling: true,
    inputs: [],
    outputs: [MAIN],
    credentials: [
      {
        name: 'qualysVmdrOtApi',
        required: true,
      },
    ],
    properties: triggerProperties,
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    return poll.call(this);
  }
}
