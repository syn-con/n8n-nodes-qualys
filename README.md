# n8n-qualys

This package provides a focused n8n community node for Qualys VMDR OT.

## What it does

- Lists OT host assets
- Lists OT vulnerabilities
- Lists OT project files

It uses the Qualys VMDR OT API with OIDC client credentials.

## Installation

Install it as a community node in n8n or via npm:

```bash
npm install n8n-qualys
```

## Credentials

Create a `Qualys VMDR OT API` credential in n8n and provide:

- API Gateway Base URL
- Client ID
- Client Secret

The node requests a bearer token from the Qualys OIDC endpoint before calling VMDR OT APIs.

## Node

The node exposes a single `List` operation across these resources:

- OT Host Asset
- OT Vulnerability
- Project File

Supported options include `List All`, `count`, `skip`, grouped QQL filters with chained rows, structured sorts, raw response mode, and optional metadata injection on returned items.

## Development

```bash
npm install
npm run build
npm run lint
npm run typecheck
npm test
```

## Project Structure

```text
credentials/
nodes/Qualys/
scripts/
tests/
```
