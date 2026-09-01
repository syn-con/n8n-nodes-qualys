import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Qualys exposes three API planes that do not share an authentication mechanism:
 *
 *   - gateway `/ot/*`      accepts a client token or a user (password) token
 *   - gateway `/rest/2.0/` accepts ONLY a user token; client tokens are rejected
 *                          with a misleading "Invalid Subscription Id"
 *   - `qualysapi` `/api/*` accepts a client token or HTTP Basic; a user token is
 *                          rejected with "Token has no access for the application"
 *
 * So one API client covers everything except CyberSecurity Asset Management,
 * and a username and password covers everything except the platform API. Supply
 * both to reach all three; the transport picks whichever the target accepts.
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
      default: 'custom',
      description:
        'Qualys platform your subscription lives on. Both the gateway and the qualysapi host are derived from it. Check Help > About in the Qualys UI if unsure.',
      options: [
        { name: 'Custom / Private Cloud Platform', value: 'custom' },
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
      ],
    },
    {
      displayName: 'API Gateway Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://gateway.qg1.apps.qualys.com',
      description:
        'Gateway host, used for VMDR OT and IT Asset requests. Bare hosts are automatically prefixed with HTTPS.',
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
        'The qualysapi host, used for VMDR vulnerability and KnowledgeBase requests. Leave empty to derive it from the gateway URL.',
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
        'Which kind of client this is, which decides the token endpoint. User Level clients stop working when the user is deactivated; Subscription Level clients survive it. Auth ID Client Management in the Qualys UI shows which one you created.',
      options: [
        { name: 'User Level (/auth/oidc)', value: 'oidc' },
        { name: 'Subscription Level (/auth/oauth)', value: 'oauth' },
      ],
    },
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string',
      default: '',
      description:
        'Client ID from Auth ID Client Management in the Qualys UI. Reaches every API except CyberSecurity Asset Management, which needs the username and password below.',
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

    // ------------------------------------------------------ username/password
    {
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: '',
      description:
        'Qualys account username. Required for IT Asset and EASM domain operations, which reject client credentials. Optional otherwise, where it also serves as HTTP Basic on the platform API.',
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      default: '',
      typeOptions: {
        password: true,
      },
      description: 'Password for the Qualys account above. SSO must be disabled for API access.',
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
