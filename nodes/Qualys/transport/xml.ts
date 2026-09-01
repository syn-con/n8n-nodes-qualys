import { XMLParser } from 'fast-xml-parser';
import type { IDataObject } from 'n8n-workflow';

/** Elements that repeat and must stay arrays even when a single one is present. */
const ALWAYS_ARRAY = new Set([
  'HOST',
  'DETECTION',
  'QDS_FACTOR',
  'VULN_COUNT',
  'TAG',
  'USER',
  'VULN',
  'CVE',
  'SOFTWARE',
  'VENDOR_REFERENCE',
  'BUGTRAQ',
  'COMPLIANCE',
  'THREAT_INTEL',
  'ASSET_GROUP',
  'ID_RANGE',
  'PARAM',
  'WARNING',
  'VHOST',
  'SCAN',
  'APPLIANCE',
  'REPORT',
  'STATIC_LIST',
  'DYNAMIC_LIST',
  'RANGE',
  'SCANNER_APPLIANCE',
]);

/**
 * Elements whose repetition depends on where they sit. `<IP>` is a single value
 * on a host but a list inside an `IP_SET`, so the decision is made by path.
 */
const ARRAY_BY_PATH = [
  'IP_SET.IP',
  'IP_SET.IP_RANGE',
  'ASSET_GROUP_LIST.ASSET_GROUP',
  // DOMAIN is a record in DOMAIN_LIST but a scalar inside DNS_DATA.
  'DOMAIN_LIST.DOMAIN',
  // NETWORK is a record in NETWORK_LIST but a nested object on a domain.
  'NETWORK_LIST.NETWORK',
  // QID is a record in a search list but a scalar on a detection.
  'QID_LIST.QID',
];

/**
 * Lists keyed by an attribute rather than by element name. Qualys uses this shape
 * in two places, and both are far easier to consume flattened into an object.
 *   <QDS_FACTOR name="CVSS">4.7</QDS_FACTOR>          -> { CVSS: '4.7' }
 *   <VULN_COUNT qds_severity="2">50</VULN_COUNT>      -> { '2': 50 }
 */
const ATTRIBUTE_KEYED: Record<string, string> = {
  QDS_FACTOR: 'name',
  VULN_COUNT: 'qds_severity',
};

/**
 * Containers whose only child is an attribute-keyed list, so the map can be
 * exposed one level higher. Listed explicitly: deciding this from the data
 * would make the output shape depend on which optional siblings a given record
 * happens to carry.
 */
const HOISTABLE_CONTAINERS: Record<string, string> = {
  QDS_FACTORS: 'QDS_FACTOR',
};

const ATTR_PREFIX = '@_';
const TEXT_KEY = '#text';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_KEY,
  cdataPropName: '__cdata',
  trimValues: true,
  // Coerce deliberately in normalise() instead: automatic coercion mangles IP
  // addresses, leading-zero identifiers and version strings.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name, jpath) => {
    if (ALWAYS_ARRAY.has(name)) {
      return true;
    }
    // jpath is a string unless the parser is configured with `jPath: false`.
    const path = typeof jpath === 'string' ? jpath : '';
    return ARRAY_BY_PATH.some((suffix) => path.endsWith(suffix));
  },
});

function coerce(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  // Qualys emits the four-character string "null" for absent values.
  if (trimmed === '' || trimmed === 'null') {
    return null;
  }

  // Leading zeros are significant in serials, asset tags and BIOS identifiers,
  // so those stay strings. So do integers beyond safe-integer precision.
  if (/^-?[1-9]\d{0,14}$/.test(trimmed) || trimmed === '0') {
    return Number(trimmed);
  }

  return trimmed;
}

function isPlainObject(value: unknown): value is IDataObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collapse `{ '__cdata': 'x' }` and `{ '#text': 'x' }` wrappers to their value. */
function unwrapText(node: IDataObject): unknown | undefined {
  const keys = Object.keys(node);
  const contentKeys = keys.filter((k) => k === '__cdata' || k === TEXT_KEY);

  if (contentKeys.length === 0 || keys.some((k) => !k.startsWith(ATTR_PREFIX) && k !== '__cdata' && k !== TEXT_KEY)) {
    return undefined;
  }

  const raw = node.__cdata ?? node[TEXT_KEY];
  return typeof raw === 'string' ? coerce(raw) : (raw ?? null);
}

/** An element with text content: `{ value, ...attributes }`, or the bare value. */
function normaliseTextNode(node: IDataObject, text: unknown): unknown {
  const attrs = Object.keys(node).filter((key) => key.startsWith(ATTR_PREFIX));

  if (attrs.length === 0) {
    return text;
  }

  const withAttrs: IDataObject = { value: text as IDataObject['value'] };
  for (const key of attrs) {
    withAttrs[key.slice(ATTR_PREFIX.length)] = coerce(String(node[key]));
  }

  return withAttrs;
}

/** One child of an element: an attribute, its text, a keyed list, or a subtree. */
function normaliseChild(key: string, value: unknown, out: IDataObject): void {
  if (key.startsWith(ATTR_PREFIX)) {
    out[key.slice(ATTR_PREFIX.length)] = coerce(String(value)) as IDataObject['value'];
    return;
  }

  if (key === '__cdata' || key === TEXT_KEY) {
    out.value = (typeof value === 'string' ? coerce(value) : value) as IDataObject['value'];
    return;
  }

  const attributeKey = ATTRIBUTE_KEYED[key];
  if (attributeKey && Array.isArray(value)) {
    out[key] = flattenAttributeKeyed(value, attributeKey);
    return;
  }

  out[key] = normalise(value, key) as IDataObject['value'];
}

function normaliseElement(node: IDataObject, tagName?: string): unknown {
  const out: IDataObject = {};

  for (const key of Object.keys(node)) {
    normaliseChild(key, node[key], out);
  }

  // `<QDS_FACTORS>` wraps nothing but `<QDS_FACTOR>` entries, so expose the
  // flattened map directly instead of burying it one level deeper.
  const hoistable = tagName ? HOISTABLE_CONTAINERS[tagName] : undefined;
  if (hoistable && isPlainObject(out[hoistable]) && Object.keys(out).length === 1) {
    return out[hoistable];
  }

  return out;
}

function normalise(node: unknown, tagName?: string): unknown {
  if (typeof node === 'string') {
    return coerce(node);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => normalise(entry, tagName));
  }

  if (!isPlainObject(node)) {
    return node ?? null;
  }

  // `<DOMAIN />` parses to an empty object; it means "no value".
  if (Object.keys(node).length === 0) {
    return null;
  }

  const text = unwrapText(node);

  return text === undefined ? normaliseElement(node, tagName) : normaliseTextNode(node, text);
}

function flattenAttributeKeyed(entries: unknown[], attributeKey: string): IDataObject {
  const flat: IDataObject = {};

  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const name = entry[`${ATTR_PREFIX}${attributeKey}`];
    if (name === undefined) {
      continue;
    }

    const raw = entry.__cdata ?? entry[TEXT_KEY];
    flat[String(name)] = (typeof raw === 'string' ? coerce(raw) : (raw ?? null)) as IDataObject['value'];
  }

  return flat;
}

export function parseQualysXml(xml: string): IDataObject {
  const parsed = parser.parse(xml) as IDataObject;
  const normalised = normalise(parsed);
  return isPlainObject(normalised) ? normalised : ({ value: normalised } as IDataObject);
}

/** Walk a dotted path, tolerating missing links. */
export function pluck(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split('.')) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

/**
 * Qualys signals "more results available" with a WARNING element carrying a
 * ready-made URL for the next batch. Returns it, or undefined when done.
 */
export function findNextBatchUrl(body: IDataObject): string | undefined {
  let found: string | undefined;

  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as IDataObject;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'WARNING') {
        const warnings = Array.isArray(value) ? value : [value];
        for (const warning of warnings) {
          if (isPlainObject(warning) && typeof warning.URL === 'string' && warning.URL.trim()) {
            found = warning.URL.trim();
            return;
          }
        }
      }
      visit(value);
    }
  };

  visit(body);
  return found;
}

/** Extract `<TEXT>` from an FO `SIMPLE_RETURN` error envelope. */
export function extractXmlErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'string') {
    return undefined;
  }

  const text = /<TEXT>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/TEXT>/i.exec(body);
  return text?.[1]?.trim() || undefined;
}
