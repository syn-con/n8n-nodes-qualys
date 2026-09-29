import type { IDataObject } from 'n8n-workflow';

/**
 * A small, lenient XML reader for Qualys responses.
 *
 * Community nodes may not ship third-party code, bundled or otherwise, so this
 * replaces a general-purpose parser. It covers what the Qualys APIs emit -
 * elements, attributes, text, CDATA, entities - and skips the DOCTYPE,
 * comments and processing instructions. It does not validate: a
 * malformed document yields whatever structure could be read, never a throw.
 *
 * The tree it returns uses these conventions, which `normalise()` in xml.ts
 * then reshapes:
 *   - attributes are `@_name` keys, always strings;
 *   - an element with nothing but text is that text as a string;
 *   - otherwise text sits under `#text` and CDATA under `__cdata`;
 *   - a repeated element becomes an array, as does any element `isArray` names.
 */

export const ATTR_PREFIX = '@_';
export const TEXT_KEY = '#text';
export const CDATA_KEY = '__cdata';

/** Decides by element name and dotted path whether an element is always a list. */
export type IsArray = (name: string, path: string) => boolean;

interface Frame {
  name: string;
  path: string;
  attributes: IDataObject;
  children: IDataObject;
  text: string;
  cdata: string | undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }

  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttributes(source: string): IDataObject {
  const attributes: IDataObject = {};

  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[`${ATTR_PREFIX}${match[1]}`] = decodeEntities((match[2] ?? match[3] ?? '').trim());
  }

  return attributes;
}

function newFrame(name: string, path: string, attributes: IDataObject): Frame {
  return { name, path, attributes, children: {}, text: '', cdata: undefined };
}

/** The value a closed element contributes to its parent. */
function frameValue(frame: Frame): unknown {
  const text = frame.text.trim();
  const hasStructure =
    Object.keys(frame.attributes).length > 0 ||
    Object.keys(frame.children).length > 0 ||
    frame.cdata !== undefined;

  if (!hasStructure) {
    return text;
  }

  const value: IDataObject = { ...frame.attributes, ...frame.children };
  if (text) {
    value[TEXT_KEY] = text;
  }
  if (frame.cdata !== undefined) {
    value[CDATA_KEY] = frame.cdata;
  }
  return value;
}

function attach(parent: Frame, child: Frame, isArray: IsArray): void {
  const value = frameValue(child) as IDataObject[string];
  const existing = parent.children[child.name];

  if (existing === undefined) {
    parent.children[child.name] = isArray(child.name, child.path) ? [value] : value;
  } else if (Array.isArray(existing)) {
    (existing as unknown[]).push(value);
  } else {
    parent.children[child.name] = [existing, value] as IDataObject[string];
  }
}

/** Index just past a `<!DOCTYPE ...>`, including any internal `[...]` subset. */
function skipDoctype(xml: string, start: number): number {
  let depth = 0;

  for (let i = start; i < xml.length; i++) {
    const char = xml[i];
    if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
    } else if (char === '>' && depth <= 0) {
      return i + 1;
    }
  }

  return xml.length;
}

/** Index just past the `>` closing a tag, ignoring any `>` inside quoted values. */
function findTagEnd(xml: string, start: number): number {
  let quote: string | undefined;

  for (let i = start; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }

  return -1;
}

function skipPast(xml: string, start: number, terminator: string): number {
  const end = xml.indexOf(terminator, start);
  return end === -1 ? xml.length : end + terminator.length;
}

interface ReaderState {
  xml: string;
  stack: Frame[];
  isArray: IsArray;
}

/** Close open elements down to, but not including, stack position `depth`. */
function closeTo(state: ReaderState, depth: number): void {
  const { stack } = state;
  while (stack.length > depth) {
    const closed = stack.pop() as Frame;
    attach(stack[stack.length - 1], closed, state.isArray);
  }
}

/**
 * Markup that is not an element: a comment, CDATA, a DOCTYPE or a processing
 * instruction starting at `lt`. Returns the index just past it, or undefined
 * when `lt` starts an element tag instead.
 */
function readNonElement(state: ReaderState, lt: number): number | undefined {
  const { xml, stack } = state;

  if (xml.startsWith('<!--', lt)) {
    return skipPast(xml, lt + 4, '-->');
  }

  if (xml.startsWith('<![CDATA[', lt)) {
    const end = skipPast(xml, lt + 9, ']]>');
    const top = stack[stack.length - 1];
    top.cdata = (top.cdata ?? '') + xml.slice(lt + 9, Math.max(lt + 9, end - 3));
    return end;
  }

  if (xml.startsWith('<!', lt)) {
    return skipDoctype(xml, lt + 2);
  }

  if (xml.startsWith('<?', lt)) {
    const end = skipPast(xml, lt + 2, '?>');
    // The declaration has always surfaced as a `?xml` key; keep it, so the
    // output shape does not change under anyone reading the root.
    const declaration = /^<\?xml(\s[\s\S]*?)?\?>$/.exec(xml.slice(lt, end));
    if (declaration && stack.length === 1) {
      stack[0].children['?xml'] = readAttributes(declaration[1] ?? '');
    }
    return end;
  }

  return undefined;
}

/** An opening, closing or self-closing tag, given what sits between `<` and `>`. */
function readTag(state: ReaderState, tag: string): void {
  const { stack } = state;

  if (tag.startsWith('/')) {
    const name = tag.slice(1).trim();
    let depth = stack.length - 1;
    while (depth > 0 && stack[depth].name !== name) {
      depth--;
    }
    // A closing tag that matches nothing open is ignored; one that skips
    // over unclosed elements closes them too.
    if (depth > 0) {
      closeTo(state, depth);
    }
    return;
  }

  const selfClosing = tag.endsWith('/');
  const body = selfClosing ? tag.slice(0, -1) : tag;
  const name = /^[^\s/>]+/.exec(body)?.[0];
  if (!name) {
    return;
  }

  const top = stack[stack.length - 1];
  const path = top.path ? `${top.path}.${name}` : name;
  const frame = newFrame(name, path, readAttributes(body.slice(name.length)));

  if (selfClosing) {
    attach(top, frame, state.isArray);
  } else {
    stack.push(frame);
  }
}

export function readXml(xml: string, isArray: IsArray): IDataObject {
  const root = newFrame('', '', {});
  const state: ReaderState = { xml, stack: [root], isArray };
  let i = 0;

  while (i < xml.length) {
    const top = state.stack[state.stack.length - 1];
    const lt = xml.indexOf('<', i);
    top.text += decodeEntities(xml.slice(i, lt === -1 ? xml.length : lt));

    if (lt === -1) {
      break;
    }

    const next = readNonElement(state, lt);
    if (next !== undefined) {
      i = next;
      continue;
    }

    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) {
      // An unterminated tag: keep what was read and stop.
      break;
    }

    readTag(state, xml.slice(lt + 1, gt));
    i = gt + 1;
  }

  // Close anything a truncated document left open.
  closeTo(state, 1);

  return root.children;
}
