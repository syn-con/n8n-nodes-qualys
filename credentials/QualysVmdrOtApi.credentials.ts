import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * One API client authenticates every request. There is no username/password and
 * no HTTP Basic fallback.
 *
 *   - gateway `/ot/*`      accepts the client token
 *   - `qualysapi` `/api/*` accepts the client token
 *   - gateway `/rest/2.0/` does NOT accept it yet, and answers
 *                          `400 Invalid Subscription Id`. Qualys support
 *                          confirms client support there is a work in progress.
 *                          The node is wired for it anyway, so IT Asset and the
 *                          EASM domain operations start working the day it ships.
 */
export class QualysVmdrOtApi implements ICredentialType {
  name = 'qualysVmdrOtApi';

  icon?: Icon = { light: 'file:qualys.svg', dark: 'file:qualys.dark.svg' };

  displayName = 'Qualys API';

  documentationUrl = 'https://docs.qualys.com/en/csam/api/get_started/API_Authentication.htm';

  properties: INodeProperties[] = [
    {
      displayName: 'Platform',
      name: 'pod',
      type: 'options',
      default: 'eu1',
      description:
        'Qualys platform your subscription lives on. Both the gateway and the qualysapi host are derived from it. Check Help > About in the Qualys UI if unsure.',
      options: [
        { name: 'AU1 - Australia', value: 'au1' },
        { name: 'CA1 - Canada', value: 'ca1' },
        { name: 'EU1 - Europe 1', value: 'eu1' },
        { name: 'EU2 - Europe 2', value: 'eu2' },
        { name: 'EU3 - Europe 3 (Italy)', value: 'eu3' },
        { name: 'GOV1 - US Government', value: 'gov1' },
        { name: 'IN1 - India', value: 'in1' },
        { name: 'KSA1 - Saudi Arabia', value: 'ksa1' },
        { name: 'UAE1 - United Arab Emirates', value: 'ae1' },
        { name: 'UK1 - United Kingdom', value: 'uk1' },
        { name: 'US1 - United States 1', value: 'us1' },
        { name: 'US2 - United States 2', value: 'us2' },
        { name: 'US3 - United States 3', value: 'us3' },
        { name: 'US4 - United States 4', value: 'us4' },
        // Last, because it is the escape hatch rather than a platform anyone picks first.
        { name: 'Custom / Private Cloud Platform', value: 'custom' },
      ],
    },
    {
      displayName: 'API Gateway Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://gateway.qg1.apps.qualys.com',
      description:
        'Gateway host, used for VMDR OT and IT Asset requests. Must be HTTPS; a bare host is assumed to be. A cleartext URL is refused, because the client secret and the token minted from it travel on every request.',
      placeholder: 'https://gateway.qg1.apps.qualys.com',
      displayOptions: {
        show: {
          pod: ['custom'],
        },
      },
    },
    {
      displayName: 'Platform API Base URL',
      name: 'platformUrl',
      type: 'string',
      default: '',
      description:
        'The qualysapi host, used for VMDR vulnerability and KnowledgeBase requests. Must be HTTPS. Leave empty to derive it from the gateway URL.',
      placeholder: 'https://qualysapi.qg1.apps.qualys.com',
      displayOptions: {
        show: {
          pod: ['custom'],
        },
      },
    },

    // ------------------------------------------------------------- API client
    {
      displayName: 'Client Type',
      name: 'clientGrant',
      type: 'options',
      default: 'oidc',
      description:
        'Which kind of client this is, which decides the token endpoint. Auth ID Client Management in the Qualys UI shows which one you created.',
      options: [
        { name: 'User Level (/auth/oidc)', value: 'oidc' },
      ],
    },
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string',
      default: '',
      description:
        'Client ID from Auth ID Client Management in the Qualys UI. Reaches every API except CyberSecurity Asset Management, which does not accept client credentials yet.',
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'string',
      default: '',
      typeOptions: {
        password: true,
      },
    },

    // ---------------------------------------------------------------- options
    {
      displayName: 'X-Requested-With',
      name: 'xRequestedWith',
      type: 'string',
      default: 'n8n-nodes-qualys',
      description:
        'Sent on every platform API request. Qualys requires this header as a CSRF guard; the value itself is arbitrary.',
    },
  ];
}
