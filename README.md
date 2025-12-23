# n8n-qualys-nodes

This is an n8n community node that lets you interact with the Qualys API in your n8n workflows.

[Qualys](https://www.qualys.com/) is a cloud-based security and compliance platform that provides vulnerability management, policy compliance, and web application security solutions.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation platform.

## Table of Contents

- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Development](#development)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

### Community Node Installation

1. Go to **Settings > Community Nodes** in your n8n instance
2. Select **Install**
3. Enter `n8n-qualys-nodes` in the **Enter npm package name** field
4. Agree to the risks and install

Alternatively, you can install it via npm:

```bash
npm install n8n-qualys-nodes
```

## Prerequisites

- Node.js >= 20.15
- n8n installed (either self-hosted or n8n Cloud)
- A Qualys account with API access

## Configuration

### Qualys API Credentials

You'll need to set up Qualys API credentials in n8n:

1. **Base URL**: Your Qualys API endpoint (e.g., `https://qualysapi.qg2.apps.qualys.com`)
   - The URL varies depending on your Qualys pod location
   - Find your pod URL in [Qualys Platform Identification](https://www.qualys.com/platform-identification/)

2. **Authentication Method**: Choose between:
   - **Basic Authentication** (Username & Password)
   - **Bearer Token**

3. **Default Headers**: Optional JSON object for custom headers
   - Default: `{"X-Requested-With":"n8n"}`

## Operations

This node supports the following Qualys resources and operations:

### Asset List
Retrieve and manage asset information from Qualys Asset Management.

**Operations:**
- List assets

### Host List
Query host detection data from Qualys.

**Operations:**
- List hosts

### IP List
Manage and retrieve IP address information.

**Operations:**
- List IPs

### Asset Vulnerability List
Access vulnerability data for assets in your Qualys account.

**Operations:**
- List asset vulnerabilities

## Credentials

### Setting up Qualys Credentials

#### Option 1: Basic Authentication

1. In n8n, go to **Credentials** > **New**
2. Search for "Qualys" and select it
3. Enter your:
   - **Base URL**: Your Qualys API endpoint
   - **Auth Method**: Select "Basic (Username & Password)"
   - **Username**: Your Qualys username
   - **Password**: Your Qualys password
4. Click **Save**

#### Option 2: Bearer Token

1. Generate a token in your Qualys account
2. In n8n, go to **Credentials** > **New**
3. Search for "Qualys" and select it
4. Enter your:
   - **Base URL**: Your Qualys API endpoint
   - **Auth Method**: Select "Bearer Token"
   - **Token**: Your API token
5. Click **Save**

### Finding Your Qualys API URL

Qualys uses different API URLs based on your account's platform:

- US Platform 1: `https://qualysapi.qualys.com`
- US Platform 2: `https://qualysapi.qg2.apps.qualys.com`
- US Platform 3: `https://qualysapi.qg3.apps.qualys.com`
- US Platform 4: `https://qualysapi.qg4.apps.qualys.com`
- EU Platform 1: `https://qualysapi.qualys.eu`
- EU Platform 2: `https://qualysapi.qg2.apps.qualys.eu`
- India Platform 1: `https://qualysapi.qg1.apps.qualys.in`
- Canada Platform 1: `https://qualysapi.qg1.apps.qualys.ca`
- UAE Platform 1: `https://qualysapi.qg1.apps.qualys.ae`
- UK Platform 1: `https://qualysapi.qg1.apps.qualys.co.uk`

Refer to the [Qualys API documentation](https://www.qualys.com/docs/qualys-api-vmpc-user-guide.pdf) for the complete list.

## Compatibility

- Tested with n8n version 1.x
- Requires Node.js 20.15 or higher
- Compatible with Qualys API v1

## Development

### Setup

1. Clone this repository:
```bash
git clone <repository-url>
cd n8n-qualys
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

### Available Scripts

- `npm run build` - Build the node for production
- `npm run dev` - Watch mode for development (automatically rebuilds on changes)
- `npm run format` - Format code with Prettier
- `npm run lint` - Lint code with ESLint
- `npm run lintfix` - Fix linting issues automatically

### Project Structure

```
n8n-qualys/
├── credentials/
│   ├── Qualys.credentials.ts    # Credentials configuration
│   └── qualys.svg                # Qualys icon
├── nodes/
│   └── Qualys/
│       ├── actions/
│       │   ├── asset/            # Asset operations
│       │   ├── assetVuln/        # Asset vulnerability operations
│       │   ├── host/             # Host operations
│       │   ├── ip/               # IP operations
│       │   ├── description.ts    # Node description
│       │   └── router.ts         # Operation router
│       ├── transport/            # HTTP transport layer
│       ├── Qualys.node.ts        # Main node implementation
│       └── Qualys.node.json      # Node metadata
├── package.json
├── tsconfig.json
└── README.md
```

### Adding New Operations

To add a new operation:

1. Create a new folder under `nodes/Qualys/actions/`
2. Add an `index.ts` file with the operation description
3. Add operation files (e.g., `list.operation.ts`)
4. Update `nodes/Qualys/actions/description.ts` to include the new resource
5. Update `nodes/Qualys/actions/router.ts` to route to the new operation
6. Build and test

### Testing Locally

To test the node in your local n8n instance:

1. Build the node:
```bash
npm run build
```

2. Link it to your local n8n installation:
```bash
npm link
```

3. In your n8n directory:
```bash
npm link n8n-qualys-nodes
```

4. Restart n8n

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Qualys API Documentation](https://www.qualys.com/docs/)
- [Qualys Platform Identification](https://www.qualys.com/platform-identification/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)

## Version History

### 0.1.0
- Initial release
- Support for Asset List operations
- Support for Host List operations
- Support for IP List operations
- Support for Asset Vulnerability List operations
- Basic and Bearer token authentication

## Support

For issues, questions, or contributions, please open an issue on the GitHub repository.

