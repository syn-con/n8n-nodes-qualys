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

The credential is simpler too: one API client instead of two, with a **Client Type** picker
for the token endpoint. A stored 1.x credential keeps working — its client 1 becomes the
client, and a Subscription Level grant is still honoured under the old field name — but a
client that was only in slot 2 needs re-entering. Open and save the credential once to write
the new **Client Type** field.

## Installation

Published to GitHub Packages, not the public npm registry, so the scope needs pointing at it
once. In `.npmrc` (user-level, or beside the install target):

```ini
@syn-con:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

The token needs `read:packages`. Then:

```bash
npm install @syn-con/n8n-nodes-qualys
```

For a self-hosted n8n, install it into the custom-nodes folder n8n already reads:

```bash
cd ~/.n8n/custom && npm install @syn-con/n8n-nodes-qualys
```

Installing from the n8n UI's community-nodes screen only works for packages on the public
registry, so it will not find this one.

## Credentials

Create a **Qualys API** credential.

**Platform** picks your pod and derives both hosts the node needs — the gateway
(`gateway.*`) and the platform API (`qualysapi.*`). Choose *Custom* for a Private Cloud
Platform and enter the URLs yourself. Help → About in the Qualys UI shows your API server URL.

Then fill in the secrets. There are two, and neither reaches every API on its own:

| API | API client (ID & secret) | Username & password |
|---|---|---|
| OT | yes | yes |
| IT Asset, EASM domains | no | **yes — required** |
| Vulnerability, Host, Scope, Scan, Search List | yes | yes |
| EASM profiles | yes | yes |

The Asset Management API rejects API client credentials outright, answering
`400 Invalid Subscription Id` even on an entitled subscription. The VMDR platform API is the
mirror image: it rejects username-derived tokens with `Token has no access for the
application`, but accepts HTTP Basic. So:

- **Username and password alone** reach every operation. This is the simplest setup.
- **An API client alone** reaches everything except IT Asset and EASM domain operations.
- Supplying both lets the node pick per request, which is what it does by default: the client
  where the API accepts one, the username and password where it does not.

**Client Type** is the one thing you have to get right. API clients come from **User info →
View Profile → Auth ID Client Management** in the Qualys UI (requires UI 4.0), and that screen
shows which kind you created:

| Client Type | Token endpoint | Lifetime |
|---|---|---|
| User Level | `/auth/oidc` | stops working when the user is deactivated |
| Subscription Level | `/auth/oauth` | survives user deactivation |

Picking the wrong one fails authentication at the token endpoint, before any Qualys data is
touched, and the error names the endpoint it tried.

The credential's **Test** button checks each secret against the token endpoint it will
actually use, and says which APIs the result reaches — including telling you that a
client-only credential cannot read IT Asset or EASM domain data. A wrong **Client Type** shows
up here as `Invalid Client ID`, before any workflow runs.

Tokens are cached for their four-hour lifetime and refreshed automatically.

### Permissions

- API access enabled on the account, and SSO **disabled** — SSO blocks API authentication
- VMDR OT needs `VMDR OT.API.ACCESS`
- CSAM needs the module enabled and "App API Enabled" on the user's role
- KnowledgeBase access is granted separately by Qualys Support

## Resources and operations

Resources group endpoints by what the data is; the operation names the record. Eight
resources, 26 operations.

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

**Vulnerability** — detections, vulnerability metadata and CVE risk scores (platform API)

| Operation | Qualys endpoint |
|---|---|
| List Detections | `/api/5.0/fo/asset/host/vm/detection/` |
| List KnowledgeBase | `/api/4.0/fo/knowledge_base/vuln/` |
| List CVE Scores | `/api/2.0/fo/knowledge_base/qvs/` |

**Host** — scanned hosts and virtual host configuration (platform API)

| Operation | Qualys endpoint |
|---|---|
| List Hosts | `/api/5.0/fo/asset/host/` |
| List Virtual Hosts | `/api/2.0/fo/asset/vhost/` |

**Scope** — what is in and out of scope (platform API)

| Operation | Qualys endpoint |
|---|---|
| List Asset Groups | `/api/2.0/fo/asset/group/` |
| List Networks | `/api/2.0/fo/network/` |
| List Domains | `/api/2.0/fo/asset/domain/` |
| List IP Addresses | `/api/2.0/fo/asset/ip/` |
| List Excluded Hosts | `/api/2.0/fo/asset/excluded_ip/` |

**Scan** — scan history, the appliances that run them, the reports they produce (platform API)

| Operation | Qualys endpoint |
|---|---|
| List Scans | `/api/2.0/fo/scan/` |
| List Scanner Appliances | `/api/2.0/fo/appliance/` |
| List Reports | `/api/3.0/fo/report/` |

**Search List** — saved QID search lists (platform API)

| Operation | Qualys endpoint |
|---|---|
| List Static | `/api/2.0/fo/qid/search_list/static/` |
| List Dynamic | `/api/3.0/fo/qid/search_list/dynamic/` |

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
container. **List Dynamic** is slow — Qualys evaluates each list's QID query server-side, and
a handful of lists took over two minutes on a small subscription.

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

**Vulnerability > List Detections** additionally offers **Item Granularity**: one item per
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
only accepts username/password authentication; API client credentials are rejected with
this error even when the subscription is entitled.
```

The **description** identifies the call without needing to reproduce it:

```
Request: POST /rest/2.0/search/am/asset
API: CyberSecurity Asset Management
Authenticated with: username/password token
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
| `publish.yml` | pushes to `main` that change `package.json` | publishes to GitHub Packages when the version is new, then tags `v<version>` |
| `main.yml` | `v*` tags | attaches `dist.zip` to a GitHub release |

`publish.yml` skips itself when the version already exists, so bumping the version in
`package.json` is the whole release action. The tag it pushes triggers `main.yml`.
