// DOM side of hide rules. CSS does the fast path (see buildHideCss); this module
// handles what CSS cannot: text anchors, hideClosest hops, "remove" rules, and counting.
// Every function fails safe: a bad selector or a missing element is a no-op.

import type { ResolvedHide } from './engine.ts';

export const HIDDEN_ATTR = 'data-aioff-hidden';
const BLOCK_CONTAINER = 'section, article, aside, li, [role="region"], [role="complementary"], [role="dialog"], div';
const CONTROL = 'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
const BLOCK_SLACK = 48;
const CONTROL_SLACK = 16;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Text must START with an anchor, and the anchor must end at a word boundary ("AI Mode" never matches "AI Models"). */
export function anchorRegex(anchors: string[]): RegExp {
  const alts = [...anchors].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return new RegExp(`^(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');
}

export type CountFn = (siteId: string, ruleId: string, n: number) => void;

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function safeClosest(el: Element, selector: string): Element | null {
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/** Never hide the page itself or anything that wraps the main content. */
export function isUnsafeTarget(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body' || tag === 'main' || tag === 'head') return true;
  if (el.getAttribute('role') === 'main') return true;
  try {
    if (el.querySelector('main, [role="main"], h1')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export class Hider {
  private counted = new WeakSet<Element>();
  private hiddenSoFar = 0;
  private count: CountFn;
  constructor(
    private rules: ResolvedHide[],
    count: CountFn = () => {},
  ) {
    this.count = (s, r, n) => {
      this.hiddenSoFar += n;
      count(s, r, n);
    };
  }

  private mark(el: Element, rule: ResolvedHide): void {
    if (this.counted.has(el)) return;
    this.counted.add(el);
    this.count(rule.siteId, rule.ruleId, 1);
  }

  private hideEl(el: Element, rule: ResolvedHide): void {
    if (isUnsafeTarget(el)) return;
    if (rule.kind === 'remove') {
      this.mark(el, rule);
      el.remove();
      return;
    }
    if (!el.hasAttribute(HIDDEN_ATTR)) el.setAttribute(HIDDEN_ATTR, rule.ruleId);
    this.mark(el, rule);
  }

  private anchorTargetFor(textParent: Element, rule: ResolvedHide): Element | null {
    if (rule.anchorContainer) return safeClosest(textParent, rule.anchorContainer);
    if (rule.anchorTarget === 'self') return textParent;
    if (rule.anchorTarget === 'control') return safeClosest(textParent, CONTROL);
    return safeClosest(textParent, BLOCK_CONTAINER);
  }

  /** One walk over the text nodes serves every rule that still needs its anchors checked. */
  private scanAnchors(root: ParentNode, rules: ResolvedHide[]): Set<ResolvedHide> {
    const hit = new Set<ResolvedHide>();
    const compiled = rules.map((rule) => ({
      rule,
      re: anchorRegex(rule.textAnchors),
      maxLen: Math.max(...rule.textAnchors.map((a) => a.length)) + (rule.anchorTarget === 'control' ? CONTROL_SLACK : BLOCK_SLACK),
      scopes: rule.anchorScope?.length ? rule.anchorScope.flatMap((sel) => safeQueryAll(root, sel)) : null,
    }));
    const longest = Math.max(...compiled.map((c) => c.maxLen));
    const test = (text: string, el: Element) => {
      for (const c of compiled) {
        if (text.length > c.maxLen || !c.re.test(text)) continue;
        if (c.scopes && !c.scopes.some((scope) => scope.contains(el))) continue;
        const target = this.anchorTargetFor(el, c.rule);
        if (!target) continue;
        const before = this.hiddenSoFar;
        this.hideEl(target, c.rule);
        if (this.hiddenSoFar > before || target.hasAttribute(HIDDEN_ATTR)) hit.add(c.rule);
      }
    };
    const doc = (root as Node).ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!raw || raw.length > longest + 32) continue;
      const text = raw.trim();
      if (text.length < 3) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') continue;
      test(text, parent);
    }
    // Accessible names count as visible text for controls.
    if (compiled.some((c) => c.rule.anchorTarget === 'control')) {
      for (const el of safeQueryAll(root, '[aria-label]')) {
        const label = (el.getAttribute('aria-label') ?? '').trim();
        if (label.length >= 3) test(label, el);
      }
    }
    return hit;
  }

  /**
   * One pass over the document (or a subtree). Returns the number of rules that matched something.
   * Pass anchors=false for the cheap selector-only pass; callers throttle the anchor walk.
   */
  scan(root: ParentNode = document, anchors = true): number {
    let matchedRules = 0;
    const needAnchors: ResolvedHide[] = [];
    for (const rule of this.rules) {
      let matched = 0;
      for (const sel of rule.selectors) {
        for (const el of safeQueryAll(root, sel)) {
          matched++;
          if (rule.hideClosest) {
            const target = safeClosest(el, rule.hideClosest);
            if (target) this.hideEl(target, rule);
          } else if (rule.kind === 'remove') {
            this.hideEl(el, rule);
          } else {
            // Already hidden by the injected stylesheet. Count it once.
            this.mark(el, rule);
          }
        }
      }
      if (matched) matchedRules++;
      else if (anchors && rule.textAnchors.length) needAnchors.push(rule);
    }
    if (needAnchors.length) matchedRules += this.scanAnchors(root, needAnchors).size;
    return matchedRules;
  }

  /** Undo everything this module did that CSS removal alone would not undo. */
  static revealAll(root: ParentNode = document): void {
    for (const el of safeQueryAll(root, `[${HIDDEN_ATTR}]`)) el.removeAttribute(HIDDEN_ATTR);
  }
}

/** Which rules match in a document. Used by fixture tests and the health check. */
export function matchReport(
  rules: ResolvedHide[],
  root: ParentNode,
): Record<string, { bySelector: number; byAnchor: number }> {
  const report: Record<string, { bySelector: number; byAnchor: number }> = {};
  for (const rule of rules) {
    let bySelector = 0;
    for (const sel of rule.selectors) bySelector += safeQueryAll(root, sel).length;
    let byAnchor = 0;
    if (rule.textAnchors.length) {
      const h = new Hider([{ ...rule, selectors: [] }], (_s, _r, n) => (byAnchor += n));
      // scan a clone so reporting never mutates the document under test
      const clone = (root as Node).cloneNode(true) as ParentNode;
      h.scan(clone);
    }
    report[rule.ruleId] = { bySelector, byAnchor };
  }
  return report;
}

/** Debounced MutationObserver driver. 50ms. */
export function observe(root: Node, onChange: () => void, debounceMs = 50): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
  };
}
