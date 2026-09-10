# @syn-con/n8n-nodes-qualys

This is an n8n community node. It lets you use [Qualys](https://www.qualys.com/) in your n8n
workflows.

Qualys is a cloud platform for vulnerability management and asset inventory. This node reads
from three of its API surfaces through a single node and a single credential: VMDR, VMDR OT and
CyberSecurity Asset Management.

The node is read-only. Nothing it does modifies your Qualys subscription.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)
[Development](#development)
[License](#license)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation, using the package name `@syn-con/n8n-nodes-qualys`.

To install it manually into a self-hosted instance:

```bash
cd ~/.n8n/custom && npm install @syn-con/n8n-nodes-qualys
```

## Operations

Resources group endpoints by what the data is; the operation names the record. Four resources,
26 operations.

### OT

Operational technology inventory, from the VMDR OT gateway.

| Operation | Qualys endpoint |
|---|---|
| List Host Assets | `/ot/1.0/host/list` |
| List Vulnerabilities | `/ot/1.0/detection/list` |
| List Project Files | `/ot/1.0/projectfile/list` |

### IT Asset

IT inventory, from the CyberSecurity Asset Management gateway.

| Operation | Qualys endpoint |
|---|---|
| List Assets | `/rest/2.0/search/am/asset` |
| Get Asset | `/rest/2.0/get/am/asset` |
| Count Assets | `/rest/2.0/count/am/asset` |
| List Software Components | `/rest/2.0/am/asset/component` |
| Get Software Components | `/rest/2.0/am/asset/component/{assetId}` |

### VMDR

Vulnerability Management, Detection and Response, on the platform API.

| Operation | Qualys endpoint |
|---|---|
| List Detections | `/api/5.0/fo/asset/host/vm/detection/` |
| List KnowledgeBase | `/api/4.0/fo/knowledge_base/vuln/` |
| List CVE Scores | `/api/2.0/fo/knowledge_base/qvs/` |
| List Hosts | `/api/5.0/fo/asset/host/` |
| List Virtual Hosts | `/api/2.0/fo/asset/vhost/` |
| List Asset Groups | `/api/2.0/fo/asset/group/` |
| List Networks | `/api/2.0/fo/network/` |
| List Domains | `/api/2.0/fo/asset/domain/` |
| List IP Addresses | `/api/2.0/fo/asset/ip/` |
| List Excluded Hosts | `/api/2.0/fo/asset/excluded_ip/` |
| List Scans | `/api/2.0/fo/scan/` |
| List Scanner Appliances | `/api/2.0/fo/appliance/` |
| List Reports | `/api/3.0/fo/report/` |
| List Static Search Lists | `/api/2.0/fo/qid/search_list/static/` |
| List Dynamic Search Lists | `/api/3.0/fo/qid/search_list/dynamic/` |

### EASM

External attack surface discovery.

| Operation | Qualys endpoint |
|---|---|
| List Profiles | `/easm/v2/profile` |
| List Unresolved Domains | `/rest/2.0/am/domain/list` |
| Count Unresolved Domains | `/rest/2.0/am/domain/count` |

Endpoint versions are pinned to the ones Qualys still marks Active. Host List and Host List
Detection 2.0 through 4.0 reached End-of-Support in December 2025; Report and Dynamic Search
List have each since moved a version on.

Two operations behave unusually. **List IP Addresses** and **List Excluded Hosts** return a
single item holding the whole IP set, because Qualys mixes bare addresses and ranges in the
same container. **List Dynamic Search Lists** is slow: Qualys evaluates each list's QID query
server-side, and a handful of lists took over two minutes on a small subscription.

## Credentials

Create a **Qualys API** credential.

**Platform** picks your pod and derives both hosts the node needs — the gateway (`gateway.*`)
and the platform API (`qualysapi.*`). Choose *Custom* for a Private Cloud Platform and enter
the URLs yourself. Help → About in the Qualys UI shows your API server URL. Both URLs must be
HTTPS: the client secret and the token minted from it travel on every request.

One API client authenticates every request. There is no username, no password and no HTTP
Basic fallback — one credential, one mode.

API clients come from **User info → View Profile → Auth ID Client Management** in the Qualys UI
(requires UI 4.0). **Client Type** offers User Level, which mints its token at `/auth/oidc`;
such a client stops working when the user it belongs to is deactivated.

Subscription Level clients (`/auth/oauth`, which survive user deactivation) are not offered. A
credential saved before they were withdrawn keeps using that endpoint — the transport still
honours the stored setting — but new credentials cannot be pointed at it.

The credential's **Test** button mints a token against the endpoint your **Client Type**
selects, so a wrong choice shows up as `Invalid Client ID` before any workflow runs. Tokens are
cached for their four-hour lifetime and refreshed automatically.

### Known gap: IT Asset and EASM domains

**These operations do not work yet, and that is a Qualys-side gap.** CyberSecurity Asset
Management rejects a client token with `400 Error validating customer from token - Invalid
Subscription Id`, an error that blames your subscription rather than the credential. Qualys
support confirms client-credential support there is still a work in progress, whatever the
documentation says.

The node sends the client token to Asset Management anyway, so those operations start working
the day Qualys ships it, with nothing to change here. Until then they fail, and the error
explains why rather than sending you to check your entitlements.

| Resource | Works today |
|---|---|
| OT | yes |
| VMDR | yes |
| EASM profiles | yes |
| IT Asset, EASM domains | not until Qualys ships client auth for CSAM |

### Permissions

- API access enabled on the account, and SSO **disabled** — SSO blocks API authentication
- VMDR OT needs `VMDR OT.API.ACCESS`
- CSAM needs the module enabled and "App API Enabled" on the user's role
- KnowledgeBase access is granted separately by Qualys Support

## Compatibility

Built against `n8nNodesApiVersion` 1 and requires Node.js 20.15 or later, matching n8n's own
floor. Developed and tested against n8n 1.x.

The package declares no runtime dependencies. The XML parser the Qualys platform API requires
is bundled into the published build, so installing this node adds nothing to the n8n instance.

## Usage

### Filtering

Each plane takes a different filter language, so the node shows the right one per operation.

**OT operations** use QQL, built from **Filter Groups**. Rows within a group are bracketed, and
both rows and groups carry their own AND/OR join.

**IT Asset and EASM domain operations** use the Asset Management criteria document: a flat list
of field/operator/value rows plus one **Match** setting for the whole list. There is no
nesting, and the operator must suit the field's type or the API answers 400. Use the `IN`
operator with a comma-separated value for OR within a single field.

**Platform operations** take Qualys' documented named parameters directly, under **Options**.
Combinations the API rejects with an opaque 400 — `ag_ids` with `ag_titles`, a search list with
`qids`, `qds_min` without `show_qds` — are caught before the request goes out. Anything not
surfaced as a field can be passed through **Extra Parameters**.

**Software Components** share the criteria UI, but Qualys splits it into two blocks: rows whose
field starts with `component.` become the component filter, everything else becomes the asset
filter, and the two are ANDed. It also pages on its own parameter and allows a page size up to
1000 rather than 300.

### Paging

**List All** pages until the API is exhausted; otherwise **Count** caps the result.

Each plane pages differently and the node handles all three: page numbers for OT, a
`lastSeenAssetId` cursor for IT Asset, and the next-batch URL Qualys returns for VMDR. **Batch
Size** controls records per VMDR call (default 1000). Setting it to 0 removes the limit, which
Qualys advises against unless you also narrow by an ID or IP range.

Requests are issued serially. The platform API's concurrency limit is low — 2 on the
subscriptions we measured — so parallel fetching would simply fail.

### Output

**Output Mode** is either one item per record or the raw response, page by page.

**VMDR > List Detections** additionally offers **Item Granularity**: one item per detection
with its host context flattened in (the default, and what joins cleanly against the other
operations), or one item per host with detections nested.

**Add Response Metadata** attaches `_qualys` to each item with the endpoint, plane, batch count
and the rate-limit headers.

VMDR responses are XML and are converted to JSON with Qualys' quirks handled: CDATA is
unwrapped, `<QDS severity="LOW">25</QDS>` keeps both parts, attribute-keyed lists such as
`QDS_FACTORS` and `VULN_COUNT` become plain objects, self-closing elements and the literal
string `"null"` become `null`, and repeated elements stay arrays even when only one is present.
Field names are left exactly as Qualys documents them.

### Using upstream data

Every field that carries a value is expression-enabled, so it can be driven from an upstream
node: `Asset ID`, `CVE IDs`, filter fields and values, everything under **Options**, and
`Count` and `Batch Size`. Only `Resource`, `Operation` and the QQL operator/join dropdowns are
fixed, since those drive which fields the panel shows.

How input items map to requests depends on the operation:

| Operation | Behaviour |
|---|---|
| **Get** | One request per input item, always. Parameters resolve against that item. |
| **List**, **Count** | One request in total by default, however many items arrive. |

`List` defaults to a single run because the query is described by the node's own parameters —
running it per item would emit the whole result set once per input item. Turn off **Run Once
For All Items** to get one query per input item instead, with parameters resolving against each
one.

Output items carry `pairedItem`, so n8n can trace each record back to the input that produced
it.

### Joining the operations together

- `List Detections.QID` → **List KnowledgeBase** `QIDs` for descriptions and solutions
- KnowledgeBase CVEs → **List CVE Scores** for per-CVE risk scores
- `List Detections.ASSET_ID` (enable **Show Asset ID**) → **Get Asset** / **List Assets**
  `assetId`

Two ways to do the detection → KnowledgeBase join, both valid:

- **One call.** Leave *Run Once* on and aggregate the QIDs into the `QIDs` field:
  `{{ $input.all().map(i => i.json.QID).join(',') }}`. Cheapest, and the API accepts a list.
- **One call per detection.** Turn *Run Once* off and set `QIDs` to `{{ $json.QID }}`. Slower,
  but each output row pairs with its detection.

### Errors

Failures keep everything diagnostic and nothing secret.

The **message** is what Qualys said, with an actionable hint appended rather than substituted:

```
Error validating customer from token - Invalid Subscription Id. The Asset Management API
does not accept API client credentials yet, and reports that as a subscription problem.
Qualys support has confirmed client support there is still a work in progress; this node
is already wired for it, so the operation will start working once Qualys ships it.
Nothing to change here.
```

The **description** identifies the call without needing to reproduce it:

```
Request: POST /rest/2.0/search/am/asset
API: CyberSecurity Asset Management
Authenticated with: API client
HTTP status: 400
Qualys code: FAILED
```

The **payload** is the parsed response body, so a workflow can branch on
`error.body.responseCode` rather than parsing a string. `httpCode` is set for HTTP failures.

Credentials never appear. A transport failure in n8n arrives as an axios error carrying the
outgoing request, including `Authorization`; before that is handed on it is sanitized —
credential-bearing keys redacted, `Bearer`/`Basic`/JWT patterns stripped from any string,
raw-header and socket internals dropped, reference cycles broken, and size bounded. With
**Continue On Fail** the same enriched message is emitted as item data.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Qualys VMDR OT API](https://docs.qualys.com/en/vmdr-ot/api/)
* [Qualys CyberSecurity Asset Management API](https://docs.qualys.com/en/csam/api/)
* [Qualys VM/VMDR API](https://docs.qualys.com/en/vm/api/index.htm)
* [Qualys API authentication](https://docs.qualys.com/en/csam/api/get_started/API_Authentication.htm)

## Version history

### 2.1

**The `Skip` parameter has been removed from the list operations.** It discarded leading
records client-side after they had already been fetched, spending API quota to throw data away.
Narrow the query with a filter instead. A workflow that set `Skip` keeps running — the stored
value is simply ignored, so it now returns the leading records it previously discarded.

The published build is now bundled, so the package declares no runtime dependencies.

### 2.0

2.0 regrouped the endpoints. Where 1.x had 22 resources that each did one thing, there are now
four resources named for the kind of data, and the operation names the record — `Vulnerability
> List Detections` instead of `VMDR Detection > List`.

**Both parameter values changed, so nodes saved by 1.x will not resolve.** Reopen each Qualys
node, reselect the resource and operation, and the fields underneath come back with their saved
values. A node left unmigrated fails at run time with `Unsupported operation`, not silently.

The credential is simpler too: one API client instead of two. A stored 1.x credential keeps
working — its client 1 becomes the client, and a Subscription Level grant is still honoured
under the old field name — but a client that was only in slot 2 needs re-entering.

Authentication is now the API client and nothing else. The username and password fields are
gone, along with the HTTP Basic fallback, so a credential that carried only those will need an
API client ID and secret.

## Development

```bash
npm install --ignore-scripts   # see the note below
npm run dev                    # n8n with this node loaded, rebuilding on change
```

Then open http://localhost:5678 and add a **Qualys** node to a workflow.

| Script | What it does |
|---|---|
| `npm run dev` | `n8n-node dev` — runs n8n with the node linked, rebuilding on change |
| `npm run build` | Bundles the publishable artifact into `dist` (see below) |
| `npm run build:test` | Unbundled TypeScript build into `.test-build`, for the test suite |
| `npm run build:watch` | The same unbundled build, in watch mode |
| `npm run lint` | `n8n-node lint` — the verification-equivalent check |
| `npm run lint:house` | The same ruleset plus this repo's extra strictness |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 174 tests |
| `npm run test:coverage` | Same, with a 90% line/branch/function gate |
| `npm run format` | Prettier over the sources, tests and config |
| `npm run release` | `n8n-node release` — bumps, tags and pushes |

### Layout

```
nodes/Qualys/
  actions/
    resources/    one folder per resource: the endpoint tables
    planes/       one folder per Qualys API plane: filters, paging, parameters
    shared/       what belongs to neither
    router.ts     executes an operation
    description.ts
  transport/      authentication, requests, XML, error shaping
```

Resources are the UI grouping — what the data is. Planes are the transport grouping — how the
API behaves. They are not the same: IT Asset and EASM both sit on the CSAM plane and share its
filter document and cursor paging, which is why that machinery lives in `planes/` rather than
inside a resource folder.

### The build

`n8n-node build` is `tsc` plus an icon copy, which is not enough here. Community nodes may not
declare runtime dependencies, so `scripts/build.mjs` bundles the XML parser into the emitted
JavaScript with esbuild, emits declarations, and copies the icons and the `.node.json` codex
that `tsc` leaves behind. `tests/bundle.test.cjs` asserts the published artifact is
self-contained, since a stray `require` would only fail on an n8n host.

### Requirements

**Node 24 or newer for `npm run dev`.** `n8n-node dev` downloads `n8n@latest`, and n8n checks
the Node version at startup and exits:

```
Your Node.js version 22.22.0 is currently not supported by n8n.
Please use a Node.js version that satisfies the following version range: >=24.0.0
```

Everything else — build, lint, typecheck, test — runs fine on Node 20.15+, which is what
`engines` declares and what CI uses.

### `--ignore-scripts`

`@n8n/node-cli` pulls in the whole n8n runtime, which includes native modules — `isolated-vm`
and `cpu-features`. Neither is needed to build, lint or test this node, and compiling them
needs a node-gyp toolchain, so a plain `npm install` fails. CI installs the same way. esbuild
is unaffected: it resolves its binary from the `@esbuild/<platform>` package, which npm
installs without running scripts.

### Tests

The suite is entirely offline: `tests/support.cjs` stubs `n8n-workflow` and scripts
`helpers.httpRequest`, so every code path — authentication, paging, XML parsing, error mapping
— is driven from canned responses rather than a live subscription.

### CI

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | pull requests, pushes to `main` | typecheck, both lint passes, tests with the coverage gate |
| `publish.yml` | pushes to `main` that change `package.json` | builds and publishes to GitHub Packages, then tags the release |

`publish.yml` publishes to GitHub Packages, not the public npm registry. n8n discovers and
verifies community nodes on npmjs.org, so publishing there is a prerequisite for listing this
node in the n8n community catalogue.

## License

[MIT](LICENSE) — Copyright (c) 2026 UAB Synergy.

The published build bundles
[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), also MIT licensed;
see [NOTICE](NOTICE).
