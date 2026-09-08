# n8n-nodes-qualys

An n8n community node for reading asset and vulnerability data out of Qualys.

Covers three Qualys API planes through one node and one credential:

- **VMDR OT** — OT host assets, OT vulnerabilities, project files
- **CyberSecurity Asset Management** — IT asset inventory and software components
- **VMDR** — scanned hosts with TruRisk, host detections with QDS, the vulnerability
  KnowledgeBase, and CVE scores

Read-only. Nothing this node does modifies your Qualys subscription.

## Upgrading to 2.0

2.0 regrouped the endpoints. Where 1.x had 22 resources that each did one thing, there are now
eight resources named for the kind of data, and the operation names the record — `Vulnerability
> List Detections` instead of `VMDR Detection > List`.

**Both parameter values changed, so nodes saved by 1.x will not resolve.** Reopen each Qualys
node, reselect the resource and operation, and the fields underneath come back with their
saved values. A node left unmigrated fails at run time with `Unsupported operation`, not
silently.

The credential is simpler too: one API client instead of two. A stored 1.x credential keeps
working — its client 1 becomes the client, and a Subscription Level grant is still honoured
under the old field name — but a client that was only in slot 2 needs re-entering.

Authentication is now the API client and nothing else. The username and password fields are
gone, along with the HTTP Basic fallback, so a credential that carried only those will need an
API client ID and secret. Asset Management is sent the client token too — it does not accept
it yet, so IT Asset and the EASM domain operations fail until Qualys ships that support.

## Installation

```bash
npm install @synergyconsulting/n8n-nodes-qualys
```

For a self-hosted n8n, install it into the custom-nodes folder n8n already reads:

```bash
cd ~/.n8n/custom && npm install @synergyconsulting/n8n-nodes-qualys
```

It is also installable from the n8n UI's community-nodes screen, under that package name.

## Credentials

Create a **Qualys API** credential.

**Platform** picks your pod and derives both hosts the node needs — the gateway
(`gateway.*`) and the platform API (`qualysapi.*`). Choose *Custom* for a Private Cloud
Platform and enter the URLs yourself. Help → About in the Qualys UI shows your API server URL.

Then fill in the secrets. There are two, and neither reaches every API on its own:

One API client authenticates every request. There is no username, no password and no HTTP
Basic fallback — one credential, one mode.

**IT Asset and the EASM domain operations do not work yet, and that is a Qualys-side gap.**
CyberSecurity Asset Management rejects a client token with `400 Error validating customer from
token - Invalid Subscription Id` — an error that blames your subscription rather than the
credential. Qualys support confirms client-credential support there is still a work in
progress, whatever the documentation says.

The node sends the client token to Asset Management anyway, so those seven operations start
working the day Qualys ships it, with nothing to change here. Until then they fail, and the
error explains why rather than sending you to check your entitlements.

| Resource | Works today |
|---|---|
| OT | yes |
| VMDR | yes |
| EASM profiles | yes |
| IT Asset, EASM domains | not until Qualys ships client auth for CSAM |

API clients come from **User info → View Profile → Auth ID Client Management** in the Qualys
UI (requires UI 4.0). **Client Type** offers User Level, which mints its token at
`/auth/oidc`; such a client stops working when the user it belongs to is deactivated.

Subscription Level clients (`/auth/oauth`, which survive user deactivation) are not offered.
A credential saved before they were withdrawn keeps using that endpoint — the transport still
honours the stored setting — but new credentials cannot be pointed at it.

The credential's **Test** button mints a token against the endpoint your **Client Type**
selects, so a wrong choice shows up as `Invalid Client ID` before any workflow runs. On
success it reminds you that Asset Management is still pending on the Qualys side.

Tokens are cached for their four-hour lifetime and refreshed automatically.

### Permissions

- API access enabled on the account, and SSO **disabled** — SSO blocks API authentication
- VMDR OT needs `VMDR OT.API.ACCESS`
- CSAM needs the module enabled and "App API Enabled" on the user's role
- KnowledgeBase access is granted separately by Qualys Support

## Resources and operations

Resources group endpoints by what the data is; the operation names the record. Four
resources, 26 operations — one per Qualys product surface.

**OT** — operational technology inventory, from the VMDR OT gateway

| Operation | Qualys endpoint |
|---|---|
| List Host Assets | `/ot/1.0/host/list` |
| List Vulnerabilities | `/ot/1.0/detection/list` |
| List Project Files | `/ot/1.0/projectfile/list` |

**IT Asset** — IT inventory, from the CyberSecurity Asset Management gateway

| Operation | Qualys endpoint |
|---|---|
| List Assets | `/rest/2.0/search/am/asset` |
| Get Asset | `/rest/2.0/get/am/asset` |
| Count Assets | `/rest/2.0/count/am/asset` |
| List Software Components | `/rest/2.0/am/asset/component` |
| Get Software Components | `/rest/2.0/am/asset/component/{assetId}` |

**VMDR** — Vulnerability Management, Detection and Response, on the platform API

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

**EASM** — external attack surface discovery

| Operation | Qualys endpoint |
|---|---|
| List Profiles | `/easm/v2/profile` |
| List Unresolved Domains | `/rest/2.0/am/domain/list` |
| Count Unresolved Domains | `/rest/2.0/am/domain/count` |

Versions are pinned to the ones Qualys still marks Active. Host List and Host List Detection
2.0 through 4.0 reached End-of-Support in December 2025; Report and Dynamic Search List have
each since moved a version on.

Two notes on specific operations. **List IP Addresses** and **List Excluded Hosts** return one
item holding the whole IP set, because Qualys mixes bare addresses and ranges in the same
container. **List Dynamic Search Lists** is slow — Qualys evaluates each list's QID query
server-side, and a handful of lists took over two minutes on a small subscription.

Operation values are unique across resources, which is what lets the panel decide which fields
to show from the operation alone.

## Filtering

Each plane takes a different filter language, so the node shows the right one per operation.

**OT operations** use QQL, built from **Filter Groups**. Rows within a group are bracketed,
and both rows and groups carry their own AND/OR join.

**IT Asset and EASM domain operations** use the Asset Management criteria document: a flat list
of field/operator/value rows plus one **Match** setting for the whole list. There is no
nesting, and the operator must suit the field's type or the API answers 400. Use the `IN`
operator with a comma-separated value for OR within a single field.

**Platform operations** take Qualys' documented named parameters directly, under **Options**.
Combinations the API rejects with an opaque 400 — `ag_ids` with `ag_titles`, a search list
with `qids`, `qds_min` without `show_qds` — are caught before the request goes out. Anything
not surfaced as a field can be passed through **Extra Parameters**.

**Software Components** share the criteria UI but Qualys splits it into two blocks: rows whose
field starts with `component.` become the component filter, everything else becomes the asset
filter, and the two are ANDed. It also pages on its own parameter and allows a page size up to
1000 rather than 300.

## Chaining with other nodes

Every field that carries a value is expression-enabled, so it can be driven from an upstream
node: `Asset ID`, `CVE IDs`, filter fields and values, everything under **Options**, and
`Count` / `Skip` / `Batch Size`. Only `Resource`, `Operation` and the QQL operator/join
dropdowns are fixed, since those drive which fields the panel shows.

How input items map to requests depends on the operation:

| Operation | Behaviour |
|---|---|
| **Get** | One request per input item, always. Parameters resolve against that item. |
| **List**, **Count** | One request in total by default, however many items arrive. |

`List` defaults to a single run because the query is described by the node's own parameters —
running it per item would emit the whole result set once per input item. Turn off
**Run Once For All Items** to get one query per input item instead, with parameters resolving
against each one.

Output items carry `pairedItem`, so n8n can trace each record back to the input that produced
it.

Two ways to do the detection → KnowledgeBase join, both valid:

- **One call.** Leave *Run Once* on and aggregate the QIDs into the `QIDs` field:
  `{{ $input.all().map(i => i.json.QID).join(',') }}`. Cheapest, and the API accepts a list.
- **One call per detection.** Turn *Run Once* off and set `QIDs` to `{{ $json.QID }}`. Slower,
  but each output row pairs with its detection.

## Paging

**List All** pages until the API is exhausted; otherwise **Count** caps the result and
**Skip** discards leading records.

Each plane pages differently and the node handles all three: page numbers for OT, a
`lastSeenAssetId` cursor for IT Asset, and the next-batch URL Qualys returns for VMDR.
**Batch Size** controls records per VMDR call (default 1000). Setting it to 0 removes the
limit, which Qualys advises against unless you also narrow by an ID or IP range.

Requests are issued serially. The platform API's concurrency limit is low — 2 on the
subscriptions we measured — so parallel fetching would simply fail.

## Output

**Output Mode** is either one item per record or the raw response, page by page.

**VMDR > List Detections** additionally offers **Item Granularity**: one item per
detection with its host context flattened in (the default, and what joins cleanly against the
other operations), or one item per host with detections nested.

**Add Response Metadata** attaches `_qualys` to each item with the endpoint, plane, batch
count, and the rate-limit headers.

VMDR responses are XML and are converted to JSON with Qualys' quirks handled: CDATA is
unwrapped, `<QDS severity="LOW">25</QDS>` keeps both parts, attribute-keyed lists such as
`QDS_FACTORS` and `VULN_COUNT` become plain objects, self-closing elements and the literal
string `"null"` become `null`, and repeated elements stay arrays even when only one is
present. Field names are left exactly as Qualys documents them.

## Errors

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

## Joining the operations together

- `List Detections.QID` → **List KnowledgeBase** `QIDs` for descriptions and solutions
- KnowledgeBase CVEs → **List CVE Scores** for per-CVE risk scores
- `List Detections.ASSET_ID` (enable **Show Asset ID**) → **Get Asset** / **List Assets** `assetId`

## Development

```bash
npm install --ignore-scripts   # see the note below
npm run dev                    # n8n with this node loaded, rebuilding on change
```

Then open http://localhost:5678 and add a **Qualys** node to a workflow.

| Script | What it does |
|---|---|
| `npm run dev` | `n8n-node dev` — runs n8n with the node linked, rebuilding on change |
| `npm run build` | `n8n-node build` — compiles and copies the icons |
| `npm run build:watch` | TypeScript only, no n8n |
| `npm run lint` / `lint:fix` | `n8n-node lint` — eslint plus n8n's own node rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 164 tests |
| `npm run test:coverage` | Same, with a 90% line/branch/function gate |
| `npm run format` | Prettier over the sources, tests and config |
| `npm run release` | `n8n-node release` — bumps, tags and pushes; the tag publishes |

### Requirements

**Node 24 or newer for `npm run dev`.** `n8n-node dev` downloads `n8n@latest`, and n8n checks
the Node version at startup and exits:

```
Your Node.js version 22.22.0 is currently not supported by n8n.
Please use a Node.js version that satisfies the following version range: >=24.0.0
```

Everything else — build, lint, typecheck, test — runs fine on Node 20.15+, which is what
`engines` declares and what CI uses.

```bash
winget install OpenJS.NodeJS.LTS    # 24.19.0 at time of writing
```

### `--ignore-scripts`

`@n8n/node-cli` pulls in the whole n8n runtime, which includes native modules —
`isolated-vm` and `cpu-features`. Neither is needed to build, lint or test this node, and
compiling them needs a node-gyp toolchain, so a plain `npm install` fails. CI installs the
same way.

### Tests

The suite is entirely offline: `tests/support.cjs` stubs `n8n-workflow` and scripts
`helpers.httpRequest`, so every code path — authentication, paging, XML parsing, error
mapping — is driven from canned responses rather than a live subscription.

## CI

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | pull requests, pushes to `main` | typecheck, lint, tests with the coverage gate |
| `publish.yml` | version tags (`2.0.1`, `2.1.0-rc.1`, …) | tests, then publishes to npm with a provenance attestation |

Releases are cut locally with `npm run release`, which lints, builds, prompts for the version
bump, writes the changelog, commits, tags and pushes. Pushing that tag is the only thing that
publishes — the workflow never bumps a version or creates a tag of its own.

The trigger matches unprefixed tags, the shape `release-it` writes. Tags left over from the
old workflow are `v`-prefixed (`v2.0.1`, `v2.0.2`) and will not fire it; to publish a version
that is already in `package.json`, push the tag without the `v`.

Provenance is what lets n8n verify the package, and it is only produced when npm publishes
from this workflow — `prepublishOnly` blocks a bare `npm publish` so a release cannot
accidentally go out without it. Authentication is either npm Trusted Publishing via OIDC (no
stored secret) or an `NPM_TOKEN` repository secret; `publish.yml` documents both.
