// Selector generator for the element picker. Preference order:
// id, stable data attributes, aria attributes, custom element names, structural path
// with :nth-of-type, then a text anchor as a separate candidate.

export interface SelectorCandidate {
  selector: string;
  strategy: 'id' | 'data' | 'aria' | 'tag' | 'path';
  /** How many elements the selector matches in the document right now. */
  matches: number;
}

export interface PickResult {
  candidates: SelectorCandidate[];
  best: string;
  textAnchor: string | null;
}

const STABLE_DATA_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-hook',
  'data-component',
  'data-component-type',
  'data-attrid',
  'data-feature-name',
  'data-module',
  'data-name',
  'data-type',
  'data-view-name',
  'data-layout',
];
const ARIA_ATTRS = ['aria-label', 'aria-labelledby', 'aria-controls', 'role', 'title', 'name', 'placeholder'];

/** Ids and classes produced by CSS-in-JS or build hashing change on every deploy. */
export function looksGenerated(value: string): boolean {
  if (!value) return true;
  if (value.length > 40) return true;
  if (/^[0-9]/.test(value)) return true;
  if (/^:r[0-9a-z]+:$/i.test(value)) return true; // React useId
  if (/[0-9]{4,}/.test(value)) return true;
  if (/^(css|sc|jss|emotion|styled)-/i.test(value)) return true;
  if (/^[a-z]{1,3}[A-Z0-9][A-Za-z0-9]{3,}$/.test(value) && /[0-9]/.test(value)) return true;
  // long strings with no vowels or mixed case noise, e.g. "x1lliihq", "VfPpkd-LgbsSe"
  if (/^[a-zA-Z0-9_-]{6,}$/.test(value) && !/[aeiou]{1}[a-z]{2,}/i.test(value)) return true;
  if (/^x[0-9a-z]{5,}$/.test(value)) return true; // Meta atomic classes
  return false;
}

function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function count(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function localCandidates(el: Element): { selector: string; strategy: SelectorCandidate['strategy'] }[] {
  const out: { selector: string; strategy: SelectorCandidate['strategy'] }[] = [];
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id && !looksGenerated(id)) out.push({ selector: `#${cssEscape(id)}`, strategy: 'id' });
  for (const name of STABLE_DATA_ATTRS) {
    const v = el.getAttribute(name);
    if (v && v.length < 80 && !looksGenerated(v)) out.push({ selector: `${tag}${attrSelector(name, v)}`, strategy: 'data' });
  }
  for (const name of ARIA_ATTRS) {
    const v = el.getAttribute(name);
    if (v && v.length < 80 && !(name === 'aria-labelledby' && looksGenerated(v)) && !(name === 'aria-controls' && looksGenerated(v))) {
      out.push({ selector: `${tag}${attrSelector(name, v)}`, strategy: 'aria' });
    }
  }
  if (tag.includes('-')) out.push({ selector: tag, strategy: 'tag' }); // custom elements are stable names
  const href = tag === 'a' ? el.getAttribute('href') : null;
  if (href && href.startsWith('/') && href.length < 60 && !/[0-9]{5,}/.test(href)) {
    out.push({ selector: `a[href^="${href.split('?')[0]}"]`, strategy: 'data' });
  }
  return out;
}

function nthOfType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (same.length === 1) return tag;
  return `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
}

/** Structural path, anchored at the nearest ancestor that has a stable local selector. */
function structuralPath(el: Element, doc: Document): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement && cur !== doc.body) {
    if (cur !== el) {
      const stable = localCandidates(cur).find((c) => count(doc, c.selector) === 1);
      if (stable) {
        parts.unshift(stable.selector);
        return parts.join(' > ');
      }
    }
    parts.unshift(nthOfType(cur));
    cur = cur.parentElement;
  }
  parts.unshift('body');
  return parts.join(' > ');
}

export function textAnchorFor(el: Element): string | null {
  const label = el.getAttribute('aria-label');
  const text = (label || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3) return null;
  // First few words: enough to identify, short enough to survive copy tweaks.
  return text.split(' ').slice(0, 4).join(' ').slice(0, 40);
}

export function generateSelectors(el: Element): PickResult {
  const doc = el.ownerDocument;
  const candidates: SelectorCandidate[] = [];
  const push = (selector: string, strategy: SelectorCandidate['strategy']) => {
    if (candidates.some((c) => c.selector === selector)) return;
    const matches = count(doc, selector);
    if (matches >= 1) candidates.push({ selector, strategy, matches });
  };
  for (const c of localCandidates(el)) push(c.selector, c.strategy);

  // A local selector that matches several elements can be narrowed by a stable ancestor.
  for (const c of [...candidates]) {
    if (c.matches <= 1) continue;
    let anc = el.parentElement;
    for (let depth = 0; anc && depth < 6; depth++, anc = anc.parentElement) {
      const stable = localCandidates(anc).find((a) => count(doc, a.selector) === 1);
      if (stable) {
        push(`${stable.selector} ${c.selector}`, c.strategy);
        break;
      }
    }
  }
  push(structuralPath(el, doc), 'path');

  const order: SelectorCandidate['strategy'][] = ['id', 'data', 'aria', 'tag', 'path'];
  const unique = candidates.filter((c) => c.matches === 1);
  const pool = unique.length ? unique : candidates;
  pool.sort((a, b) => order.indexOf(a.strategy) - order.indexOf(b.strategy) || a.selector.length - b.selector.length);
  const best = pool[0]?.selector ?? structuralPath(el, doc);
  return { candidates, best, textAnchor: textAnchorFor(el) };
}

/** Prefilled GitHub issue URL. Nothing is sent until the user submits the form on GitHub. */
export function buildIssueUrl(opts: {
  repo: string;
  pageUrl: string;
  result: PickResult;
  extensionVersion: string;
  rulesVersion?: string;
}): string {
  const u = new URL(opts.pageUrl);
  const cleanUrl = `${u.origin}${u.pathname}`; // query and hash stripped
  const body = [
    '### Page',
    cleanUrl,
    '',
    '### What is this AI element?',
    '<!-- One sentence. Example: "Ask AI" button under every product photo -->',
    '',
    '### Selector candidates',
    '```',
    ...opts.result.candidates.map((c) => `${c.selector}    (${c.strategy}, matches ${c.matches})`),
    '```',
    '',
    '### Text anchor',
    opts.result.textAnchor ? `\`${opts.result.textAnchor}\`` : '(none)',
    '',
    '### Versions',
    `Extension ${opts.extensionVersion}${opts.rulesVersion ? `, rules ${opts.rulesVersion}` : ''}`,
  ].join('\n');
  const params = new URLSearchParams({
    template: 'new-rule.md',
    labels: 'new-rule',
    title: `New rule: ${u.hostname}`,
    body,
  });
  return `https://github.com/${opts.repo}/issues/new?${params.toString()}`;
}
