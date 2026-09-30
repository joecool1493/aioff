// Level 2 keyword muting. Plain word lists and regular expressions, nothing smart.
// Items are collapsed, never removed, so scroll position and infinite scroll stay stable.
// The collapsed bar is a ::before pseudo element, so no nodes are inserted into the
// site's own DOM (frameworks such as React stay happy).

import type { MuteConfig, MuteContainer } from './types.ts';

export const MUTED_ATTR = 'data-aioff-muted';
export const SHOWN_ATTR = 'data-aioff-shown';
export const LABEL_ATTR = 'data-aioff-label';

const LETTER = '\\p{L}\\p{N}';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short all-caps tokens such as "AI" match case-sensitively so "said" or "Aid" never fire. */
export function isCaseSensitiveTerm(term: string): boolean {
  const letters = term.replace(/[^\p{L}]/gu, '');
  return letters.length <= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export interface TermMatcher {
  /** Returns the first matching term, or null. */
  find(text: string): string | null;
}

export function compileTerms(terms: string[], exclusions: string[] = []): TermMatcher {
  const clean = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
  const sens = clean.filter(isCaseSensitiveTerm);
  const insens = clean.filter((t) => !isCaseSensitiveTerm(t));
  const build = (list: string[], flags: string) =>
    list.length
      ? new RegExp(`(?<![${LETTER}])(?:${list.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})(?![${LETTER}])`, flags)
      : null;
  const reSens = build(sens, 'u');
  const reInsens = build(insens, 'iu');
  const reExcl = exclusions.length
    ? new RegExp(exclusions.map(escapeRe).sort((a, b) => b.length - a.length).join('|'), 'giu')
    : null;
  return {
    find(text: string): string | null {
      const t = reExcl ? text.replace(reExcl, ' ') : text;
      const a = reSens?.exec(t);
      if (a) return a[0];
      const b = reInsens?.exec(t);
      return b ? b[0] : null;
    },
  };
}

export function effectiveTerms(config: MuteConfig, userTerms: string[], disabledFeedTerms: string[]): string[] {
  const off = new Set(disabledFeedTerms.map((t) => t.toLowerCase()));
  return [...config.terms.filter((t) => !off.has(t.toLowerCase())), ...userTerms];
}

export const MUTE_CSS = `
[${MUTED_ATTR}]:not([${SHOWN_ATTR}]) > * { display: none !important; }
[${MUTED_ATTR}]:not([${SHOWN_ATTR}]) {
  min-height: 24px !important; max-height: 24px !important; height: 24px !important;
  overflow: hidden !important; padding: 0 !important; cursor: pointer !important;
  background: transparent !important; box-sizing: border-box !important;
}
[${MUTED_ATTR}]:not([${SHOWN_ATTR}])::before {
  content: attr(${LABEL_ATTR}) !important; display: block !important;
  font: 12px/24px system-ui, -apple-system, "Segoe UI", sans-serif !important;
  color: #8a8a8a !important; background: rgba(127,127,127,.12) !important;
  padding: 0 12px !important; border-radius: 4px !important; height: 24px !important;
  white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
}
[${MUTED_ATTR}][data-aioff-sibling]:not([${SHOWN_ATTR}]) { display: none !important; }
tr[${MUTED_ATTR}]:not([${SHOWN_ATTR}]) { display: block !important; }
`;

function containerSelector(c: MuteContainer): { selector: string; text?: string; nextSiblings: number } {
  return typeof c === 'string' ? { selector: c, nextSiblings: 0 } : { nextSiblings: 0, ...c };
}

export interface MuteOptions {
  containers: MuteContainer[];
  matcher: TermMatcher;
  /** Headline selectors: when set, only text inside these elements is tested (news sites). */
  headlineSelectors?: string[];
  onMute?: (term: string) => void;
  label?: (term: string) => string;
}

const defaultLabel = (term: string) => `AI post hidden: matched "${term}" (click to show)`;

export class Muter {
  private seen = new WeakMap<Element, string>();
  constructor(private opts: MuteOptions) {}

  private textOf(el: Element, textSel?: string): string {
    const pick = (sel: string) => {
      try {
        return Array.from(el.querySelectorAll(sel))
          .map((n) => n.textContent ?? '')
          .join(' \n ');
      } catch {
        return '';
      }
    };
    if (textSel) return pick(textSel);
    if (this.opts.headlineSelectors?.length) return pick(this.opts.headlineSelectors.join(','));
    return el.textContent ?? '';
  }

  scan(root: ParentNode = document): number {
    let muted = 0;
    for (const c of this.opts.containers) {
      const { selector, text, nextSiblings } = containerSelector(c);
      let els: Element[] = [];
      try {
        els = Array.from(root.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const el of els) {
        if (el.hasAttribute(SHOWN_ATTR)) continue;
        // Skip containers nested inside an already muted container.
        if (el.parentElement?.closest(`[${MUTED_ATTR}]`)) continue;
        const content = this.textOf(el, text);
        // Content can stream in (SPAs). Re-test only when the text changed.
        if (this.seen.get(el) === content) continue;
        this.seen.set(el, content);
        const term = this.opts.matcher.find(content);
        if (!term) {
          continue;
        }
        if (el.hasAttribute(MUTED_ATTR)) continue;
        el.setAttribute(MUTED_ATTR, term);
        el.setAttribute(LABEL_ATTR, (this.opts.label ?? defaultLabel)(term));
        el.setAttribute('title', `AI Off muted this because it contains "${term}". Click to show it.`);
        let sib = el.nextElementSibling;
        for (let i = 0; i < nextSiblings && sib; i++, sib = sib.nextElementSibling) {
          sib.setAttribute(MUTED_ATTR, term);
          sib.setAttribute('data-aioff-sibling', '');
        }
        muted++;
        this.opts.onMute?.(term);
      }
    }
    return muted;
  }

  /** Capture-phase click handler: the first click on a collapsed item reveals it and does nothing else. */
  static handleClick(ev: Event): void {
    const target = ev.target as Element | null;
    const el = target?.closest?.(`[${MUTED_ATTR}]:not([${SHOWN_ATTR}])`);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    Muter.show(el);
  }

  static show(el: Element): void {
    el.setAttribute(SHOWN_ATTR, '');
    el.removeAttribute('title');
    let sib = el.nextElementSibling;
    while (sib && sib.hasAttribute('data-aioff-sibling')) {
      sib.setAttribute(SHOWN_ATTR, '');
      sib = sib.nextElementSibling;
    }
  }

  static revealAll(root: ParentNode = document): void {
    for (const el of Array.from(root.querySelectorAll(`[${MUTED_ATTR}]`))) {
      el.removeAttribute(MUTED_ATTR);
      el.removeAttribute(LABEL_ATTR);
      el.removeAttribute(SHOWN_ATTR);
      el.removeAttribute('data-aioff-sibling');
      if (el.getAttribute('title')?.startsWith('AI Off muted')) el.removeAttribute('title');
    }
  }
}

/** Ad slots that survived the user's ad blocker: hide when the landing domain or text is an AI company. */
export function findAiAdSlots(
  root: ParentNode,
  slotSelectors: string[],
  landingDomains: string[],
  matcher: TermMatcher,
): { el: Element; reason: string }[] {
  const out: { el: Element; reason: string }[] = [];
  for (const sel of slotSelectors) {
    let slots: Element[] = [];
    try {
      slots = Array.from(root.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const slot of slots) {
      let reason: string | null = null;
      for (const a of Array.from(slot.querySelectorAll('a[href]'))) {
        try {
          const host = new URL((a as HTMLAnchorElement).href, 'https://x.invalid').hostname;
          const hit = landingDomains.find((d) => host === d || host.endsWith('.' + d));
          if (hit) {
            reason = `ad for ${hit}`;
            break;
          }
        } catch {
          /* ignore bad hrefs */
        }
      }
      if (!reason) {
        const term = matcher.find(slot.textContent ?? '');
        if (term) reason = `ad text matched "${term}"`;
      }
      if (reason) out.push({ el: slot, reason });
    }
  }
  return out;
}
